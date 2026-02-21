#!/usr/bin/env python3
"""Preprocess NHTSA SGO crash data CSV into a clean JSON file for the web tool.

Reads nhtsa-2025-jun-2026-jan.csv, filters to Driver/Operator Type = "None",
deduplicates by Same Incident ID (keeping highest Report Version), and injects
the data inline into index.html (between marker comments). Also writes
incidents.json as a side output.
"""

import csv
import json
import math
import urllib.request
from collections import Counter

INPUT  = "nhtsa-2025-jun-2026-jan.csv"
OUTPUT = "incidents.json"
HTML   = "index.html"
VMT_SHEET_ID = "1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w"
VMT_SHEET_GID = "844581871"
VMT_SHEET_URL = (
    f"https://docs.google.com/spreadsheets/d/{VMT_SHEET_ID}/export"
    f"?format=csv&gid={VMT_SHEET_GID}"
)
FAULT_INPUTS = {
    "claude": "faultfrac-claude.csv",
    "codex": "faultfrac-codex.csv",
    "gemini": "faultfrac-gemini.csv",
}

# Fields to extract for each incident
FIELDS = [
    "Report ID",
    "Report Version",
    "Reporting Entity",
    "Incident Date",
    "Incident Time (24:00)",
    "Same Incident ID",
    "City",
    "State",
    "Roadway Type",
    "Crash With",
    "Highest Injury Severity Alleged",
    "SV Precrash Speed (MPH)",
    "SV Pre-Crash Movement",
    "CP Pre-Crash Movement",
    "Narrative",
    "Narrative - CBI?",
    "Weather - Clear",
    "Weather - Rain",
    "Weather - Cloudy",
    "Weather - Partly Cloudy",
]

# Shorter keys for the JSON output (greppable, pronounceable jargon)
KEY_MAP = {
    "Report ID":                     "reportId",
    "Report Version":                "version",
    "Reporting Entity":              "company",
    "Incident Date":                 "date",
    "Incident Time (24:00)":         "time",
    "Same Incident ID":              "incidentId",
    "City":                          "city",
    "State":                         "state",
    "Roadway Type":                  "road",
    "Crash With":                    "crashWith",
    "Highest Injury Severity Alleged": "severity",
    "SV Precrash Speed (MPH)":       "speed",
    "SV Pre-Crash Movement":         "svMovement",
    "CP Pre-Crash Movement":         "cpMovement",
    "Narrative":                     "narrative",
    "Narrative - CBI?":              "narrativeCbi",
    "Weather - Clear":               "wxClear",
    "Weather - Rain":                "wxRain",
    "Weather - Cloudy":              "wxCloudy",
    "Weather - Partly Cloudy":       "wxPartlyCloudy",
}

# Canonical short names for companies
COMPANY_SHORT = {
    "Waymo LLC":    "Waymo",
    "Tesla, Inc.":  "Tesla",
    "Zoox, Inc.":   "Zoox",
}


def must(cond, msg, **ctx):
    if not cond:
        raise AssertionError(f"{msg}: {ctx}")


def parse_fault_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    must(len(rows) > 0, "fault csv has no rows", path=path)
    must({"Report ID", "faultfrac", "reasoning"} <= set(rows[0].keys()),
         "fault csv header mismatch", path=path, header=list(rows[0].keys()))
    data = {}
    for row in rows:
        rid = row["Report ID"].strip()
        must(rid != "", "fault row missing Report ID", path=path)
        faultfrac = float(row["faultfrac"])
        must(math.isfinite(faultfrac), "faultfrac not finite", path=path, reportId=rid, faultfrac=row["faultfrac"])
        must(0.0 <= faultfrac <= 1.0, "faultfrac out of range", path=path, reportId=rid, faultfrac=faultfrac)
        reasoning = row["reasoning"].strip()
        item = {"faultfrac": faultfrac, "reasoning": reasoning}
        if rid in data:
            must(data[rid] == item, "duplicate Report ID with conflicting fault row", path=path, reportId=rid)
            continue
        data[rid] = item
    return data


def load_fault_models():
    models = {}
    for model, path in FAULT_INPUTS.items():
        models[model] = parse_fault_csv(path)
    ids = set(models["claude"])
    for model in ("codex", "gemini"):
        must(set(models[model]) == ids, "fault model ID sets must match", model=model)
    return models, ids


def fetch_vmt_sheet_csv():
    with urllib.request.urlopen(VMT_SHEET_URL, timeout=30) as resp:
        payload = resp.read()
    text = payload.decode("utf-8")
    lines = text.splitlines()
    must(len(lines) > 1, "VMT sheet CSV must include header and rows")
    must(lines[0] == "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,rationale",
         "VMT sheet CSV header mismatch", header=lines[0])
    return text


def main():
    with open(INPUT, newline="") as f:
        rows = list(csv.DictReader(f))
    fault_models, fault_ids = load_fault_models()

    # Filter to driverless incidents only
    none_rows = [r for r in rows if r["Driver / Operator Type"] == "None"]

    # Dedup: group by Same Incident ID, keep highest Report Version
    by_incident = {}
    for r in none_rows:
        iid = r["Same Incident ID"]
        ver = int(r["Report Version"])
        if iid not in by_incident or ver > by_incident[iid]["_ver"]:
            by_incident[iid] = {"_ver": ver, "_row": r}

    incidents = []
    for iid, entry in by_incident.items():
        r = entry["_row"]
        rec = {}
        for csv_field in FIELDS:
            key = KEY_MAP[csv_field]
            val = r[csv_field].strip()
            rec[key] = val
        # Shorten company name
        rec["company"] = COMPANY_SHORT.get(rec["company"], rec["company"])
        # Parse speed as number
        try:
            rec["speed"] = int(rec["speed"])
        except (ValueError, TypeError):
            rec["speed"] = None
        rid = rec["reportId"]
        must(rid in fault_ids, "missing fault estimates for report", reportId=rid)
        rec["fault"] = {
            "claude": fault_models["claude"][rid]["faultfrac"],
            "codex": fault_models["codex"][rid]["faultfrac"],
            "gemini": fault_models["gemini"][rid]["faultfrac"],
            "rclaude": fault_models["claude"][rid]["reasoning"],
            "rcodex": fault_models["codex"][rid]["reasoning"],
            "rgemini": fault_models["gemini"][rid]["reasoning"],
        }
        incidents.append(rec)

    incident_ids = {r["reportId"] for r in incidents}
    must(incident_ids == fault_ids, "incident/fault Report ID sets must match",
         incidents_only=sorted(incident_ids - fault_ids)[:5],
         fault_only=sorted(fault_ids - incident_ids)[:5])

    # Sort by company then date
    month_order = {
        "JUN-2025": 1, "JUL-2025": 2, "AUG-2025": 3, "SEP-2025": 4,
        "OCT-2025": 5, "NOV-2025": 6, "DEC-2025": 7, "JAN-2026": 8,
        "APR-2025": 0,
    }
    incidents.sort(key=lambda r: (
        r["company"],
        month_order.get(r["date"], 99),
        r["time"],
    ))

    with open(OUTPUT, "w") as f:
        json.dump(incidents, f, indent=2)

    # Inject data inline into index.html
    with open(HTML) as f:
        html = f.read()

    incident_json = json.dumps(incidents, separators=(",", ":"))
    vmt_text = fetch_vmt_sheet_csv()
    vmt_escaped = json.dumps(vmt_text)  # properly escapes for JS string

    def inject(html, start_marker, end_marker, payload):
        """Replace content between marker comments with payload."""
        si = html.index(start_marker)
        ei = html.index(end_marker, si)
        return html[:si] + start_marker + payload + html[ei:]

    html = inject(html,
                  "/* INCIDENT_DATA_START */", "/* INCIDENT_DATA_END */",
                  incident_json)
    html = inject(html,
                  "/* VMT_CSV_START */", "/* VMT_CSV_END */",
                  vmt_escaped)

    with open(HTML, "w") as f:
        f.write(html)

    # Summary
    counts = Counter(r["company"] for r in incidents)
    total = len(incidents)
    print(f"Wrote {total} incidents to {OUTPUT}")
    print(f"Injected data inline into {HTML}")
    for company, n in counts.most_common():
        print(f"  {company}: {n}")


if __name__ == "__main__":
    main()

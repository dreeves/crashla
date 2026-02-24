#!/usr/bin/env python3
"""Preprocess NHTSA SGO crash data CSV into inline data for the web tool.

Fetches the ADS incident CSV from NHTSA, filters to Driver/Operator Type =
"None", deduplicates by Same Incident ID (keeping highest Report Version), and
injects the data into incidents.js and vmt.js (between marker comments).
"""

import csv
import datetime
import io
import json
import math
import urllib.request
from collections import Counter

NHTSA_ADS_CSV_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/"
    "SGO-2021-01_Incident_Reports_ADS.csv"
)
INCIDENT_JS = "incidents.js"
VMT_JS      = "vmt.js"
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

# Manual overrides for number of vehicles involved, keyed by Same Incident ID.
# The NHTSA CSV's "Crash With" field is singular and doesn't capture multi-
# vehicle pileups. Default is 2 (the AV + one crash partner). Override here
# when the narrative reveals more vehicles were involved.
VEHICLES_INVOLVED = {
    # Waymo SEP-2025 Tempe fatality: AV + motorcycle + hit-and-run passenger car
    "dc166aecd5b4265": 3,
}


def must(cond, msg, **ctx):
    if not cond:
        raise AssertionError(f"{msg}: {ctx}")


def fetch_nhtsa_csv():
    """Fetch the ADS incident reports CSV from NHTSA."""
    print(f"Fetching NHTSA ADS CSV from {NHTSA_ADS_CSV_URL} ...")
    with urllib.request.urlopen(NHTSA_ADS_CSV_URL, timeout=60) as resp:
        payload = resp.read()
    text = payload.decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


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


NHTSA_WINDOW_START = "2025-06-15"
NHTSA_WINDOW_END   = "2026-01-15"

def month_coverage(month_str):
    """Fraction of the month inside the NHTSA observation window."""
    year, mon = int(month_str[:4]), int(month_str[5:7])
    import calendar
    days_in_month = calendar.monthrange(year, mon)[1]
    # Window: June 15 through January 15
    if month_str == "2025-06":
        return (30 - 15 + 1) / days_in_month  # Jun 15–30
    if month_str == "2026-01":
        return 15 / days_in_month              # Jan 1–15
    return 1.0

def fetch_vmt_sheet_csv():
    with urllib.request.urlopen(VMT_SHEET_URL, timeout=30) as resp:
        payload = resp.read()
    text = payload.decode("utf-8")
    lines = text.splitlines()
    must(len(lines) > 1, "VMT sheet CSV must include header and rows")
    must(lines[0] == "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,rationale",
         "VMT sheet CSV header mismatch", header=lines[0])
    # Add coverage column (partial-month fraction for NHTSA window)
    out = [lines[0].replace(",rationale", ",coverage,rationale")]
    for line in lines[1:]:
        if not line.strip():
            continue
        parts = line.split(",", 6)  # company,month,vmt,cum,min,max,rationale
        month = parts[1]
        cov = month_coverage(month)
        cov_str = str(round(cov, 3))
        parts.insert(6, cov_str)
        out.append(",".join(parts))
    return "\n".join(out)


def js_template_literal(text):
    return text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def main():
    rows = fetch_nhtsa_csv()
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
        iid_short = rec["incidentId"]
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(iid_short, 2)
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

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(incidents, indent=2) + "\n"
    vmt_text = fetch_vmt_sheet_csv().replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    vmt_template = "\n`" + js_template_literal(vmt_text) + "\n`\n"

    def inject(source, start_marker, end_marker, payload):
        """Replace content between marker comments with payload."""
        si = source.index(start_marker)
        ei = source.index(end_marker, si)
        return source[:si] + start_marker + payload + source[ei:]

    fetch_date = datetime.date.today().isoformat()

    with open(INCIDENT_JS) as f:
        inc_js = f.read()
    inc_js = inject(inc_js,
                    "/* NHTSA_FETCH_DATE_START */", "/* NHTSA_FETCH_DATE_END */",
                    f'"{fetch_date}"')
    inc_js = inject(inc_js,
                    "/* INCIDENT_DATA_START */", "/* INCIDENT_DATA_END */",
                    incident_json)
    with open(INCIDENT_JS, "w") as f:
        f.write(inc_js)

    with open(VMT_JS) as f:
        vmt_js = f.read()
    vmt_js = inject(vmt_js,
                    "/* VMT_CSV_START */", "/* VMT_CSV_END */",
                    vmt_template)
    with open(VMT_JS, "w") as f:
        f.write(vmt_js)

    # Summary
    counts = Counter(r["company"] for r in incidents)
    total = len(incidents)
    print(f"Injected {total} incidents into {INCIDENT_JS} and VMT into {VMT_JS}")
    for company, n in counts.most_common():
        print(f"  {company}: {n}")


if __name__ == "__main__":
    main()

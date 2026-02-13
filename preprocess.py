#!/usr/bin/env python3
"""Preprocess NHTSA SGO crash data CSV into a clean JSON file for the web tool.

Reads nhtsa-2025-jun-dec.csv, filters to Driver/Operator Type = "None",
deduplicates by Same Incident ID (keeping highest Report Version), and writes
incidents.json.
"""

import csv
import json
import sys

INPUT  = "nhtsa-2025-jun-dec.csv"
OUTPUT = "incidents.json"

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


def main():
    with open(INPUT, newline="") as f:
        rows = list(csv.DictReader(f))

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
        incidents.append(rec)

    # Sort by company then date
    month_order = {
        "JUN-2025": 1, "JUL-2025": 2, "AUG-2025": 3, "SEP-2025": 4,
        "OCT-2025": 5, "NOV-2025": 6, "DEC-2025": 7, "APR-2025": 0,
    }
    incidents.sort(key=lambda r: (
        r["company"],
        month_order.get(r["date"], 99),
        r["time"],
    ))

    with open(OUTPUT, "w") as f:
        json.dump(incidents, f, indent=2)

    # Summary
    from collections import Counter
    counts = Counter(r["company"] for r in incidents)
    total = len(incidents)
    print(f"Wrote {total} incidents to {OUTPUT}:")
    for company, n in counts.most_common():
        print(f"  {company}: {n}")


if __name__ == "__main__":
    main()

import sys
sys.path.insert(0, './data')
import slurp

rows = slurp.read_fault_csv_rows("data/faultfrac-gemini.csv")
rids = {r["reportID"] for r in rows}

nhtsa_rows, _ = slurp.fetch_nhtsa_csv(None)

seen = set()
deduped = []
for row in nhtsa_rows:
    if "Report ID" in row and row["Report ID"] not in seen:
        if slurp.valid_incident(row):
            seen.add(row["Report ID"])
            deduped.append(row)

missing = []
for row in deduped:
    rid = row["Report ID"]
    if rid not in rids:
        missing.append(row)

print(f"Remaining: {len(missing)}")
for row in missing[:6]:
    print(f"ID: {row['Report ID']}")
    print(f"Speed: {row['SV Precrash Speed (MPH)']}")
    print(f"Crash With: {row['Crash With']}")
    print(f"Severity: {row['Highest Injury Severity Alleged']}")
    print(f"Narrative: {row.get('Narrative', row.get('Narrative ', ''))[:500]}")
    print("---")

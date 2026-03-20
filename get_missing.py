import sys, csv
sys.path.insert(0, './data')
import slurp
nhtsa = slurp.fetch_nhtsa_csv(slurp.latest_snapshot_path("nhtsa-current-"))
rows = slurp.read_fault_csv_rows("data/faultfrac-gemini.csv")
rids = {r["reportID"] for r in rows}
missing = []
for row in nhtsa:
    if slurp.determine_driver(row) and slurp.valid_incident(row):
        rid = row["Report ID"]
        if rid not in rids:
            missing.append(row)
print("Total missing:", len(missing))

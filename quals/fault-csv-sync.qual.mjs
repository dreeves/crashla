import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const py = `
import csv
import json
import os
import sys
import tempfile
sys.path.insert(0, "data")
import slurp

row = {
    "Report ID": "RID-1",
    "SV Precrash Speed (MPH)": "17",
    "Crash With": "Pickup Truck",
    "Highest Injury Severity Alleged": "Minor W/O Hospitalization",
    "SV Contact Area - Front Left": "Y",
    "SV Contact Area - Front": "",
    "SV Contact Area - Front Right": "",
    "SV Contact Area - Left": "",
    "SV Contact Area - Top": "",
    "SV Contact Area - Right": "",
    "SV Contact Area - Rear Left": "",
    "SV Contact Area - Rear": "",
    "SV Contact Area - Rear Right": "",
    "SV Contact Area - Bottom": "",
    "SV Contact Area - Unknown": "",
    "CP Contact Area - Front Left": "",
    "CP Contact Area - Front": "",
    "CP Contact Area - Front Right": "",
    "CP Contact Area - Left": "",
    "CP Contact Area - Top": "",
    "CP Contact Area - Right": "",
    "CP Contact Area - Rear Left": "",
    "CP Contact Area - Rear": "Y",
    "CP Contact Area - Rear Right": "",
    "CP Contact Area - Bottom": "",
    "CP Contact Area - Unknown": "",
}

master = slurp.fault_master_row(row)
built = slurp.build_fault_master_rows([
    row,
    dict(row),
    {
        **row,
        "Report ID": "RID-2",
        "Highest Injury Severity Alleged": "Wrong A",
    },
    {
        **row,
        "Report ID": "RID-2",
        "Highest Injury Severity Alleged": "Wrong B",
    },
], {"RID-1"})

tmp = tempfile.NamedTemporaryFile("w", newline="", delete=False, suffix=".csv")
try:
    writer = csv.DictWriter(tmp, fieldnames=slurp.FAULT_CSV_FIELDS, lineterminator="\\n")
    writer.writeheader()
    writer.writerow({
        "reportID": "RID-1",
        "speed": "999",
        "crashwith": "Wrong",
        "svhit": "wrong",
        "cphit": "wrong",
        "severity": "Wrong",
        "faultfrac": "0.25",
        "reasoning": "keep me",
    })
    tmp.close()
    slurp.sync_fault_csv(tmp.name, {"RID-1": master})
    out = slurp.read_fault_csv_rows(tmp.name)
    print(json.dumps({"master": master, "row": out[0], "built": built}))
finally:
    os.unlink(tmp.name)
`;

const raw = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").at(-1);
const out = JSON.parse(raw);

assert.deepEqual(
  out.master,
  {
    reportID: "RID-1",
    speed: "17",
    crashwith: "Pickup Truck",
    svhit: "front left",
    cphit: "rear",
    severity: "Minor W/O Hospitalization",
  },
  `Replicata: call data/slurp.py fault_master_row on a synthetic NHTSA row.
Expectata: the helper emits the canonical first-six fault CSV columns from master NHTSA data.
Resultata: got ${JSON.stringify(out.master)}.`,
);

assert.deepEqual(
  out.built,
  {
    "RID-1": {
      reportID: "RID-1",
      speed: "17",
      crashwith: "Pickup Truck",
      svhit: "front left",
      cphit: "rear",
      severity: "Minor W/O Hospitalization",
    },
  },
  `Replicata: call data/slurp.py build_fault_master_rows with duplicate non-target report IDs and a duplicated identical target row.
Expectata: only the targeted report ID survives, and non-target duplicate report IDs do not trigger a conflict.
Resultata: got ${JSON.stringify(out.built)}.`,
);

assert.ok(
  out.row.reportID === "RID-1" &&
    out.row.speed === "17" &&
    out.row.crashwith === "Pickup Truck" &&
    out.row.svhit === "front left" &&
    out.row.cphit === "rear" &&
    out.row.severity === "Minor W/O Hospitalization" &&
    out.row.faultfrac === "0.25" &&
    out.row.reasoning === "keep me",
  `Replicata: run data/slurp.py sync_fault_csv on a temp fault CSV whose master columns drifted.
Expectata: the first six columns are replaced from NHTSA master data while faultfrac and reasoning are preserved.
Resultata: synced row was ${JSON.stringify(out.row)}.`,
);

console.log("qual pass: data/slurp.py syncs fault CSV metadata from NHTSA master rows");

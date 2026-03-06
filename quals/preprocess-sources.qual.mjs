import assert from "node:assert/strict";
import fs from "node:fs";

const preprocess = fs.readFileSync("preprocess.py", "utf8");
const doc = fs.readFileSync("DATA-SOURCES.md", "utf8");

assert.ok(
  preprocess.includes("NHTSA_ADS_CSV_URL") &&
    preprocess.includes("NHTSA_ADS_ARCHIVE_URL") &&
    preprocess.includes("VMT_SHEET_URL"),
  `Replicata: inspect preprocess.py data-source constants.
Expectata: preprocess.py defines live NHTSA current/archive URLs and the live VMT sheet URL.
Resultata: expected live-source constants were missing.`,
);

assert.ok(
  preprocess.includes("fetch_nhtsa_csv()") &&
    preprocess.includes("fetch_vmt_sheet_csv(inc_cov)") &&
    preprocess.includes("urllib.request.urlopen"),
  `Replicata: inspect preprocess.py fetch code path.
Expectata: preprocess.py fetches NHTSA and VMT data over the network during regeneration.
Resultata: expected live-fetch code path was missing.`,
);

assert.ok(
  !preprocess.includes("nhtsa-2025-jun-dec.csv") &&
    !preprocess.includes("nhtsa-2025-jun-2026-jan.csv"),
  `Replicata: inspect preprocess.py for local archival snapshot usage.
Expectata: preprocess.py does not read the checked-in nhtsa-*.csv archival snapshot files.
Resultata: preprocess.py still referenced a checked-in archival snapshot file.`,
);

assert.ok(
  doc.includes("archival snapshots only") &&
    doc.includes("does not read `nhtsa-2025-jun-dec.csv` or `nhtsa-2025-jun-2026-jan.csv`") &&
    doc.includes("fetches NHTSA and Google Sheets data live"),
  `Replicata: inspect DATA-SOURCES.md.
Expectata: the data-sources document states that the checked-in NHTSA CSVs are archival and preprocess.py fetches live upstream data.
Resultata: the expected documentation text was missing.`,
);

console.log("qual pass: preprocess data-source documentation matches the live fetch pipeline");

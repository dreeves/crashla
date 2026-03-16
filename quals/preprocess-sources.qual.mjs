import assert from "node:assert/strict";
import fs from "node:fs";

const preprocess = fs.readFileSync("data/slurp.py", "utf8");
const doc = fs.readFileSync("data/README.md", "utf8");

assert.ok(
  preprocess.includes("NHTSA_ADS_CSV_URL") &&
    preprocess.includes("NHTSA_ADS_ARCHIVE_URL") &&
    preprocess.includes("VMT_SHEET_URL"),
  `Replicata: inspect data/slurp.py data-source constants.
Expectata: data/slurp.py defines live NHTSA current/archive URLs and the live VMT sheet URL.
Resultata: expected live-source constants were missing.`,
);

assert.ok(
  preprocess.includes("def fetch_nhtsa_csv(stamp):") &&
    preprocess.includes("def fetch_vmt_sheet_raw(stamp):") &&
    preprocess.includes("def build_vmt_csv(raw_text, inc_cov):") &&
    preprocess.includes("def snapshot_csv_if_changed(prefix, text, stamp):") &&
    preprocess.includes("urllib.request.urlopen"),
  `Replicata: inspect data/slurp.py fetch code path.
Expectata: data/slurp.py fetches NHTSA and VMT data over the network during regeneration and snapshots each live fetch.
Resultata: expected live-fetch code path was missing.`,
);

assert.ok(
  preprocess.includes("LEGACY_SNAPSHOT_PATHS") &&
    preprocess.includes("snapshot_csv_if_changed") &&
    preprocess.includes("return legacy[-1] if legacy else None"),
  `Replicata: inspect data/slurp.py legacy snapshot bridge.
Expectata: data/slurp.py may compare against the latest legacy current snapshot, but only through the snapshot helper path that avoids duplicate archival files.
Resultata: the expected legacy-snapshot bridge was missing.`,
);

assert.ok(
  doc.includes("archival snapshots only") &&
    doc.includes("does not read `data/snapshots/nhtsa-2025-jun-dec.csv` or") &&
    doc.includes("fetches NHTSA and Google Sheets data live") &&
    doc.includes("New snapshots use timestamped filenames") &&
    doc.includes("They are not parsed as incident inputs"),
  `Replicata: inspect data/README.md.
Expectata: the data-sources document states that the checked-in NHTSA CSVs are archival, data/slurp.py fetches live upstream data, and changed fetches create timestamped snapshots without treating legacy snapshots as live inputs.
Resultata: the expected documentation text was missing.`,
);

console.log("qual pass: data/slurp.py documentation matches the live fetch pipeline");

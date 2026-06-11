import assert from "node:assert/strict";
import fs from "node:fs";

const preprocess = fs.readFileSync("data/slurp.py", "utf8");
const doc = fs.readFileSync("data/README.md", "utf8");

assert.ok(
  preprocess.includes("NHTSA_ADS_CSV_URL") &&
    preprocess.includes("NHTSA_ADS_ARCHIVE_URL") &&
    preprocess.includes('VMT_MASTER = DATA_DIR / "vmt.csv"') &&
    !preprocess.includes("VMT_SHEET_URL"),
  `Replicata: inspect data/slurp.py data-source constants.
Expectata: data/slurp.py defines live NHTSA current/archive URLs and the in-repo VMT master path, with no Google Sheet URL remaining.
Resultata: expected data-source constants were missing or stale.`,
);

assert.ok(
  preprocess.includes("def fetch_nhtsa_csv(stamp):") &&
    preprocess.includes("def read_vmt_master():") &&
    !preprocess.includes("def fetch_vmt_sheet_raw") &&
    preprocess.includes("def build_vmt_csv(raw_text, inc_cov, active_months):") &&
    preprocess.includes("def snapshot_csv_if_changed(prefix, text, stamp):") &&
    preprocess.includes("urllib.request.urlopen"),
  `Replicata: inspect data/slurp.py data-loading code path.
Expectata: data/slurp.py fetches NHTSA data over the network (snapshotting each live fetch) and reads VMT from the in-repo master rather than fetching it.
Resultata: expected data-loading code path was missing or stale.`,
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
    doc.includes("fetches NHTSA data live") &&
    doc.includes("`data/vmt.csv` is the in-repo master") &&
    doc.includes("New snapshots use timestamped filenames") &&
    doc.includes("They are not parsed as incident inputs"),
  `Replicata: inspect data/README.md.
Expectata: the data-sources document states that the checked-in NHTSA CSVs are archival, data/slurp.py fetches live NHTSA data, data/vmt.csv is the in-repo VMT master, and changed fetches create timestamped snapshots without treating legacy snapshots as live inputs.
Resultata: the expected documentation text was missing.`,
);

console.log("qual pass: data/slurp.py documentation matches the live fetch pipeline");

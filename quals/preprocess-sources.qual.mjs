import assert from "node:assert/strict";
import fs from "node:fs";

const preprocess = fs.readFileSync("data/slurp.py", "utf8");

assert.ok(
  preprocess.includes("NHTSA_ADS_CSV_URL") &&
    preprocess.includes("NHTSA_ADS_ARCHIVE_URL") &&
    /^NHTSA_DATA_THROUGH_DATE = "\d{4}-\d{2}-\d{2}"$/m.test(preprocess) &&
    !preprocess.includes("NHTSA_EXPECTED_ETAG") &&
    !preprocess.includes("NHTSA_EXPECTED_LAST_MODIFIED") &&
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
    preprocess.includes("def build_vmt_csv(raw_text, sources, list_cov):") &&
    preprocess.includes("def month_sources(vmt, last_month, list_cov):") &&
    preprocess.includes("def check_data_through_month(data_through_date, last_month):") &&
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

// Until 2026-11-21 this qual also required the constant
// FIVE_DAY_RECEIPT_COVERAGE_MAX and the signatures of release_month_coverage()
// and of build_vmt_csv() with its coverage arguments: the estimate of NHTSA's
// partly reported newest month, which the human dropped that day. What a
// row's coverage is now comes from month_sources() (which line-months count,
// and from which source) and the cutoff-month check is
// check_data_through_month()'s.
//
// Until 2026-11-07 this qual also required six phrases of data/README.md
// ("archival snapshots only", "fetches NHTSA data live" and four more), so a
// correct rewording of that doc, which the human may edit, turned it red (the
// human's rule of 2026-11-03: no qual requires the wording of text the human
// might edit). The pipeline itself is checked above, in data/slurp.py's code.

console.log("qual pass: data/slurp.py fetches NHTSA data live, snapshotting each changed fetch, and reads VMT from the in-repo master");

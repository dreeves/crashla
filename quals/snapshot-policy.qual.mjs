import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const py = `
import json
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, "data")
import slurp

with tempfile.TemporaryDirectory() as tmp:
    tmpdir = Path(tmp)
    legacy = tmpdir / "legacy-old.csv"
    legacy.write_text("same\\n")
    slurp.SNAPSHOT_DIR = tmpdir
    slurp.LEGACY_SNAPSHOT_PATHS = {"demo": [legacy]}

    first = slurp.snapshot_csv_if_changed("demo", "same\\n", "20260306T010101")
    second = slurp.snapshot_csv_if_changed("demo", "same\\n", "20260306T020202")
    third = slurp.snapshot_csv_if_changed("demo", "different\\n", "20260306T030303")
    crlf_first = slurp.snapshot_csv_if_changed("crlf", "a,b\\r\\n1,2\\r\\n", "20260306T040404")
    crlf_second = slurp.snapshot_csv_if_changed("crlf", "a,b\\r\\n1,2\\r\\n", "20260306T050505")
    files = sorted(path.name for path in tmpdir.glob("*.csv"))
    print(json.dumps({
        "first": first.name,
        "second": second.name,
        "third": third.name,
        "crlf_first": crlf_first.name,
        "crlf_second": crlf_second.name,
        "files": files,
        "latest": slurp.latest_snapshot_path("demo").name,
    }))
`;

const raw = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").at(-1);
const out = JSON.parse(raw);

assert.equal(
  out.first,
  "legacy-old.csv",
  `Replicata: call data/slurp.py snapshot_csv_if_changed with a legacy snapshot containing identical CSV text.
Expectata: the helper reuses the latest legacy snapshot instead of creating a duplicate timestamped file.
Resultata: the first returned snapshot was ${JSON.stringify(out.first)}.`,
);

assert.equal(
  out.second,
  "legacy-old.csv",
  `Replicata: call data/slurp.py snapshot_csv_if_changed twice with unchanged CSV text.
Expectata: unchanged content reuses the latest snapshot path.
Resultata: the second returned snapshot was ${JSON.stringify(out.second)}.`,
);

assert.equal(
  out.third,
  "demo-20260306T030303.csv",
  `Replicata: call data/slurp.py snapshot_csv_if_changed after changing the fetched CSV text.
Expectata: changed content creates a new timestamped snapshot file.
Resultata: the changed-content snapshot was ${JSON.stringify(out.third)}.`,
);

assert.deepEqual(
  out.files,
  ["crlf-20260306T040404.csv", "demo-20260306T030303.csv", "legacy-old.csv"],
  `Replicata: inspect the temp snapshot directory after unchanged LF and CRLF fetches plus one changed fetch.
Expectata: the directory keeps the legacy snapshot and adds exactly one timestamped snapshot per distinct CSV payload.
Resultata: snapshot files were ${JSON.stringify(out.files)}.`,
);

assert.equal(
  out.latest,
  "demo-20260306T030303.csv",
  `Replicata: ask data/slurp.py for the latest snapshot after a changed fetch.
Expectata: the newest timestamped snapshot supersedes the legacy snapshot.
Resultata: latest snapshot was ${JSON.stringify(out.latest)}.`,
);

assert.equal(
  out.crlf_second,
  out.crlf_first,
  `Replicata: call data/slurp.py snapshot_csv_if_changed twice with identical CRLF CSV text.
Expectata: unchanged content is compared exactly, so the helper reuses the first snapshot instead of creating a duplicate.
Resultata: the CRLF snapshots were ${JSON.stringify({ first: out.crlf_first, second: out.crlf_second })}.`,
);

console.log("qual pass: data/slurp.py snapshots only changed fetches and bridges legacy snapshot names");

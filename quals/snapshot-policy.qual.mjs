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
    out = {
        "first": first.name,
        "second": second.name,
        "third": third.name,
        "crlf_first": crlf_first.name,
        "crlf_second": crlf_second.name,
        "files": files,
        "latest": slurp.latest_snapshot_path("demo").name,
    }

# An offline regeneration with one NHTSA file's snapshot missing: the newest
# snapshot of every other file (current, archive, ADAS) linked into an empty
# directory, the last file's (OTHER) left out. slurp.newest_snapshot_rows()
# must stop naming the missing file's prefix; until 2026-11-06 it stopped on
# a TypeError from open(None), naming no file.
prefixes = [p for _u, p, _parse in slurp.NHTSA_SOURCES] + [p for _u, p in slurp.NON_ADS_SOURCES]
slurp.SNAPSHOT_DIR = Path("data/snapshots").resolve()
real = {p: slurp.latest_snapshot_path(p) for p in prefixes}
assert all(real.values()), ("Replicata: find the newest snapshot of each NHTSA file in data/snapshots. "
                            "Expectata: one per prefix, the files this check links. "
                            f"Resultata: {real}.")
with tempfile.TemporaryDirectory() as tmp:
    tmpdir = Path(tmp)
    for p in prefixes[:-1]:
        (tmpdir / real[p].name).symlink_to(real[p])
    slurp.SNAPSHOT_DIR = tmpdir
    slurp.LEGACY_SNAPSHOT_PATHS = {}
    try:
        slurp.newest_snapshot_rows()
        out["missing"] = {"prefix": prefixes[-1], "raised": None, "message": None}
    except Exception as e:
        out["missing"] = {"prefix": prefixes[-1], "raised": type(e).__name__, "message": str(e)}
print(json.dumps(out))
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

assert.ok(
  out.missing.raised === "AssertionError" && out.missing.message.includes(out.missing.prefix),
  `Replicata: call data/slurp.py newest_snapshot_rows() with data/snapshots holding the newest snapshot of every NHTSA file but ${out.missing.prefix}'s.
Expectata: it stops on its own check, an AssertionError naming the missing file's prefix (${out.missing.prefix}).
Resultata: ${out.missing.raised === null ? "it returned" : `${out.missing.raised}: ${JSON.stringify(out.missing.message)}`}.`,
);

console.log("qual pass: data/slurp.py snapshots only changed fetches and bridges legacy snapshot names, and an offline regeneration missing one NHTSA file's snapshot stops naming it");

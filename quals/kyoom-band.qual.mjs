import assert from "node:assert/strict";
import fs from "node:fs";

// The kyoom band (kyoom_min/kyoom_max = min/max of cumulative VMT) is the
// authored cumulative-uncertainty band. A cumulative/quarterly anchor can only
// TIGHTEN it relative to the running sum of the independent monthly bands, never
// widen it; it must bracket the central cumulative; and it must be monotonic
// (cumulative miles can't decrease). This qual enforces those invariants on the
// master and checks that the Tesla anchor actually tightens the band.

const lines = fs.readFileSync("data/vmt.csv", "utf8").trim().split("\n");
assert.equal(
  lines[0],
  "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale",
  `Replicata: read data/vmt.csv header.
Expectata: schema includes kyoom_min,kyoom_max after helmer_cumulative_vmt.
Resultata: ${JSON.stringify(lines[0])}.`,
);

const rows = lines.slice(1).filter(l => l.trim() !== "").map(l => {
  const p = l.split(",", 8);
  return {
    helmer: p[0], month: p[1], cume: +p[3],
    kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7],
  };
});

// Per helmer (rows are chronological in file order), track running sums.
const run = {};
let tightened = 0;
for (const r of rows) {
  const first = run[r.helmer] === undefined;
  const s = run[r.helmer] ??= { min: 0, max: 0, pkmin: 0, pkmax: 0 };
  s.min += r.vmin;
  s.max += r.vmax;

  // A helmer's first month has no prior miles, so its cumulative IS its
  // monthly value — the two bands describe the same quantity and must agree.
  if (first) assert.ok(
    r.kmin === r.vmin && r.kmax === r.vmax,
    `Replicata: compare ${r.helmer}'s first row (${r.month}) kyoom band to its monthly band.
Expectata: identical — cumulative == monthly at the first month, so [kyoom_min, kyoom_max] == [vmt_min, vmt_max].
Resultata: kyoom [${r.kmin}, ${r.kmax}] vs vmt [${r.vmin}, ${r.vmax}].`,
  );

  assert.ok(
    r.kmin <= r.cume && r.cume <= r.kmax,
    `Replicata: check ${r.helmer} ${r.month} kyoom brackets the central cumulative.
Expectata: kyoom_min <= helmer_cumulative_vmt <= kyoom_max.
Resultata: ${r.kmin} <= ${r.cume} <= ${r.kmax}.`,
  );
  assert.ok(
    r.kmin >= s.min && r.kmax <= s.max,
    `Replicata: compare ${r.helmer} ${r.month} kyoom band to the running sum of monthly bands.
Expectata: the cumulative band is no wider than the running sum (an anchor only tightens) — kyoom_min >= ${s.min} and kyoom_max <= ${s.max}.
Resultata: kyoom [${r.kmin}, ${r.kmax}].`,
  );
  assert.ok(
    r.kmin >= s.pkmin && r.kmax >= s.pkmax,
    `Replicata: check ${r.helmer} ${r.month} kyoom is monotonic vs the prior month.
Expectata: cumulative miles don't decrease, so kyoom_min and kyoom_max are non-decreasing.
Resultata: prev [${s.pkmin}, ${s.pkmax}], this [${r.kmin}, ${r.kmax}].`,
  );
  if (r.kmin > s.min || r.kmax < s.max) tightened += 1;
  s.pkmin = r.kmin;
  s.pkmax = r.kmax;
}

// The Tesla Q1-2026 cumulative anchor must actually tighten the band somewhere.
const teslaMar = rows.find(r => r.helmer === "tesla" && r.month === "2026-03");
assert.ok(
  teslaMar && (teslaMar.kmax - teslaMar.kmin) > 0,
  "Replicata: locate the Tesla 2026-03 row. Expectata: present. Resultata: missing.",
);
assert.ok(
  tightened > 0,
  `Replicata: count rows whose kyoom band is strictly tighter than the running sum.
Expectata: at least one anchored row (the cumulative anchor is exercised, not just the running-sum default).
Resultata: ${tightened} tightened rows.`,
);

console.log(`qual pass: kyoom cumulative band is bracketed, monotonic, anchor-tightened (${tightened} rows)`);

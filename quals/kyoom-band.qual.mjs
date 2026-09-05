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
  // Local chain invariant (added 2026-09-04): this month's cumulative band
  // can be no wider than last month's band plus this month's monthly band,
  // because cume[t] = cume[t-1] + vmt[t]. The global running-sum check above
  // cannot see a single loose knot (the Waymo Dec-2025 anchor sat at ±8.8%
  // while its neighbours were ±1%, and Jan-2026's floor fell below Dec's
  // floor plus January's minimum).
  if (!first) assert.ok(
    r.kmin >= s.pkmin + r.vmin && r.kmax <= s.pkmax + r.vmax,
    `Replicata: compare ${r.helmer} ${r.month} kyoom band to last month's band plus this month's monthly band.
Expectata: kyoom_min >= ${s.pkmin} + ${r.vmin} = ${s.pkmin + r.vmin} and kyoom_max <= ${s.pkmax} + ${r.vmax} = ${s.pkmax + r.vmax}.
Resultata: kyoom [${r.kmin}, ${r.kmax}].`,
  );
  if (r.kmin > s.min || r.kmax < s.max) tightened += 1;
  s.pkmin = r.kmin;
  s.pkmax = r.kmax;
}

// The Tesla Q1-2026 deck-chart anchor must actually tighten the band AT that
// row (not merely somewhere in the file: 101 of 105 rows tighten, so a global
// count could not fail).
const teslaRun = { min: 0, max: 0 };
let teslaMar = null;
for (const r of rows.filter(r => r.helmer === "tesla")) {
  teslaRun.min += r.vmin;
  teslaRun.max += r.vmax;
  if (r.month === "2026-03") { teslaMar = { ...r, runMin: teslaRun.min, runMax: teslaRun.max }; break; }
}
assert.ok(
  teslaMar !== null,
  "Replicata: locate the Tesla 2026-03 row. Expectata: present. Resultata: missing.",
);
assert.ok(
  teslaMar.kmin > teslaMar.runMin && teslaMar.kmax < teslaMar.runMax,
  `Replicata: compare the Tesla 2026-03 kyoom band to the running sum of Tesla's monthly bands.
Expectata: strictly tighter on both edges — kyoom_min ${teslaMar.kmin} > ${teslaMar.runMin} and kyoom_max ${teslaMar.kmax} < ${teslaMar.runMax} (the deck chart pins the cumulative).
Resultata: not tighter.`,
);

console.log(`qual pass: kyoom cumulative band is bracketed, monotonic, anchor-tightened (${tightened} rows)`);

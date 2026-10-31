import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";

// The reviewed authoring model must actually reach the master, rather than
// leaving an old monthly profile beneath new provenance prose. California
// source/calibration checks live separately in waymo-allocation.qual; published
// anchor checks remain in waymo-vmt-provenance.qual. Since 2026-10-31 (open
// question 15, "Rebuild on Waymo's figures") the model covers the series from
// its July 2021 start; until then it began at July 2024 and the earlier rows
// kept an older ramp that did not follow Waymo's figures.
const expected = JSON.parse(execFileSync("python3", ["data/waymo_vmt.py"], {encoding: "utf8"}));
const names = ["helmer", "month", "vmt", "helmer_cumulative_vmt", "kyoom_min", "kyoom_max", "vmt_min", "vmt_max", "rationale"];
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(r => r[0] === "waymo")
  .map(r => Object.fromEntries(names.map((k, i) => [k, i >= 2 && i <= 7 ? +r[i] : r[i]])));
assert.deepEqual([expected.length, expected[0].month, expected[expected.length - 1].month], [57, "2021-07", "2026-03"],
  `Replicata: run data/waymo_vmt.py.
Expectata: 57 months, July 2021 through March 2026.
Resultata: ${expected.length} months, ${expected[0]?.month} through ${expected[expected.length - 1]?.month}.`);
const fields = names.slice(2);
const mismatches = expected.flatMap(r => {
  const actual = master.find(m => m.month === r.month);
  assert.ok(actual, `Replicata: find Waymo ${r.month}. Expectata: model month exists. Resultata: missing.`);
  return fields.filter(k => actual[k] !== r[k]).map(k => `${r.month} ${k}: master ${actual[k]}, model ${r[k]}`);
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute July 2021–March 2026 from measured California miles plus anchor-conserving residual allocation.
Expectata: every monthly central, cumulative, band and rationale in the master matches the documented authoring model.
Resultata: ${mismatches.join("; ")}.`);

// Independently derive each knot's cumulative envelope from its published
// figure's precision, explicitly excluded miles and the pre-series offset
// (central 150,000, range 150,000-260,000; data/README.md, Waymo anchors):
// central = figure - 150,000, bounds = [figure low - 260,000, figure high -
// 150,000]. Until 2026-10-31 the offset was a fixed 150,000 and the June,
// July and December 2024 knots kept the rounded milestones' centrals (22M,
// 25M, 50M less 150,000) inside envelopes stretched to hold them.
const OFFSET = {central: 150000, lo: 150000, hi: 260000};
// [month, figure, minus, plus, residue]: the figure's range is [figure -
// minus, figure + plus]; January 2025's central keeps the series' one-mile
// ledger residue.
for (const [month, published, minus, plus, residue] of [
  ["2021-12", 422400, 600, 600, 0],          // Table 2: three significant figures per city-year
  ["2022-12", 946400, 1150, 1150, 0],
  ["2023-07", 3868506, 35560, 0, 0],          // Swiss Re: "to 8/1/2023" may hold Aug 1
  ["2023-10", 7140000, 0, 10000, 0],          // "over 7.14 million"
  ["2023-12", 10066400, 11650, 11650, 0],
  ["2024-06", 22199000, 2000, 2000 + 5500, 0], // CSV1: four values to 1,000; Mountain View omitted
  ["2024-07", 25308000, 2000, 2000 + 5500, 0],
  ["2024-09", 33103000, 2000, 2000 + 5500, 0],
  ["2024-12", 50083000, 2000, 2000 + 5500, 0],
  ["2025-01", 56700000, 500, 500 + 9250, 1],   // the paper's total; Mountain View and Atlanta listed apart
]) {
  const row = master.find(r => r.month === month);
  const central = published - OFFSET.central + residue;
  const bounds = [published - minus - OFFSET.hi, published + plus - OFFSET.lo];
  assert.deepEqual([row.helmer_cumulative_vmt, row.kyoom_min, row.kyoom_max], [central, ...bounds],
    `Replicata: derive ${month}'s cumulative envelope from published miles, rounding, explicitly excluded cities and the pre-series offset.
Expectata: central ${central}, bounds ${bounds}.
Resultata: ${JSON.stringify(row)}.`);
}

// The authored rows after the model (April 2026 on) chain their cumulative
// bands from the model's March 2026 knot with their own monthly bands:
// April and May forward from March and back from the June 2026 knot (hub +
// E, less the offset's range), June the knot, later months forward from it.
{
  const after = master.filter(r => r.month > "2026-03");
  const mar = master.find(r => r.month === "2026-03");
  const knots = {"2026-06": [271329379 + 4000000 - OFFSET.hi, 271329379 + 10200000 - OFFSET.lo]};
  const chain = [];
  let prev = {kmin: mar.kyoom_min, kmax: mar.kyoom_max};
  for (const r of after) {
    const knot = knots[r.month] ?? [-Infinity, Infinity];
    prev = {month: r.month, kmin: Math.max(prev.kmin + r.vmt_min, knot[0]), kmax: Math.min(prev.kmax + r.vmt_max, knot[1])};
    chain.push(prev);
  }
  for (let i = chain.length - 1; i > 0; i--) {
    chain[i - 1].kmin = Math.max(chain[i - 1].kmin, chain[i].kmin - after[i].vmt_max);
    chain[i - 1].kmax = Math.min(chain[i - 1].kmax, chain[i].kmax - after[i].vmt_min);
  }
  const off = after.flatMap((r, i) => r.kyoom_min === chain[i].kmin && r.kyoom_max === chain[i].kmax ? []
    : [`${r.month}: [${r.kyoom_min}, ${r.kyoom_max}], chain [${chain[i].kmin}, ${chain[i].kmax}]`]);
  assert.deepEqual(off, [],
    `Replicata: chain Waymo's April 2026-on cumulative bands from the model's March 2026 knot and the June 2026 knot.
Expectata: each row's band is the chain's.
Resultata: ${off.join("; ")}.`);
}
console.log("qual pass: Waymo's rows from July 2021 reproduce the measured-California/residual model and source-precision knots");

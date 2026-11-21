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
const [caHeader, ...caMonths] = parseCsv(fs.readFileSync("data/waymo-ca.csv", "utf8"));
const totalCol = caHeader.indexOf("total");
assert.ok(totalCol >= 0,
  `Replicata: read the column names in data/waymo-ca.csv.
Expectata: a total column for combined deployment and pilot miles.
Resultata: ${caHeader.join(",")}.`);
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
// (central 205,000, range 150,000-260,000; data/README.md, Waymo anchors):
// central = figure - 205,000, bounds = [figure low - 260,000, figure high -
// 150,000]. Until 2026-10-31 the offset was a fixed 150,000 and the June,
// July and December 2024 knots kept the rounded milestones' centrals (22M,
// 25M, 50M less 150,000) inside envelopes stretched to hold them; until
// 2026-11-02 its central was the range's floor, 150,000 (open question 20(b)).
const OFFSET = {central: 205000, lo: 150000, hi: 260000};
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

// California covers San Diego. Remove its estimated share from the newer
// metros while retaining their original total and the three mature metros.
const q2Ratio = 30625484 / 28957564; // Q2 California hub miles / CPUC miles
// The judged parts of the July-November 2026 rows (data/vmt.csv's rationales;
// data/README.md, Waymo anchors and Ghost months), named since 2026-11-20 so
// that the page's list of assumptions (crashla.js ASSUMPTIONS) is checked
// against them (quals/assumptions-list.qual.mjs reads these consts; until
// then it pinned copies of them): California's filed miles times q2Ratio
// within CA_BAND, and the three mature metros extrapolated from the hub's Q2
// monthly rates within MATURE_BAND (July-September, multipliers of the
// estimate); E_RATE, the newer metros' reports per million miles (Austin's
// and Atlanta's young-market rate) with the low and high rate the San Diego
// split allows; SAN_DIEGO, San Diego's reports of the newer metros' in
// September 2026; the weather pauses taken off (PAUSES) and the openings and
// added service area put on (OPENINGS), by month and part; and GHOST_BAND,
// October's and November's range, e^-(lo[0] + lo[1] k) to e^(hi[0] + hi[1] k)
// times the estimate for a month k months past Q2.
const CA_BAND = [0.97, 1.03];
const MATURE_BAND = [0.75, 1.25];
const E_RATE = { best: 6.6, lo: 4.5, hi: 9.5 };
const SAN_DIEGO = { reports: 3, of: 25 };
const PAUSES = {
  "2026-09": { phoenix: 100000 },
  "2026-10": { phoenix: 50000, storms: 50000, rain: 70000 },
};
const OPENINGS = {
  "2026-10": { opened: 150000, area: 20000 },
  "2026-11": { opened: 250000, area: 130000 },
};
const GHOST_BAND = { lo: [0.17, 0.028], hi: [0.15, 0.02] };
const total = parts => Object.values(parts).reduce((a, b) => a + b, 0);
// Counts from data/snapshots/nhtsa-current-20261116T120804.csv: public-service
// Waymo reports in San Diego divided by those in all newer metros, including
// Miami Beach. Later releases can revise the counts available for this estimate.
// For zero reports the two-sided 95% Clopper-Pearson upper endpoint solves
// (1 - p)^n = .025. For 3 of 25 the endpoints are the .025 quantile of
// Beta(3, 23) and the .975 quantile of Beta(4, 22), respectively.
const retained = (share, rateRatio) => (1 - share) / (1 - share + share / rateRatio);
// [month, the three mature metros' miles, the newer metros' best, low and
// high (before the San Diego split), San Diego's share of the newer metros'
// reports and its Clopper-Pearson low and high]
const Q3_METROS = [
  ["2026-07", 7060000, 2000000, 1200000, 3300000, 0/12, 0, 1 - 0.025 ** (1/12)],
  ["2026-08", 7460000, 2300000, 1400000, 3800000, 0/14, 0, 1 - 0.025 ** (1/14)],
  ["2026-09", 7580000, 2850000, 1700000, 4800000, SAN_DIEGO.reports / SAN_DIEGO.of, 0.025465396647733, 0.312190307286235],
];
const q3 = new Map();
for (const [month, mature, newerBest, newerLo, newerHi, share, shareLo, shareHi] of Q3_METROS) {
  const filed = Number(caMonths.find(r => r[0] === month)[totalCol]);
  const ca = filed * q2Ratio;
  q3.set(month, [
    ca + mature + newerBest * (1 - share),
    ca * CA_BAND[0] + mature * MATURE_BAND[0] + newerLo * retained(shareHi, E_RATE.lo / E_RATE.best),
    ca * CA_BAND[1] + mature * MATURE_BAND[1] + newerHi * retained(shareLo, E_RATE.hi / E_RATE.best),
  ]);
}
const wantedMonthly = Array.from(q3, ([month, miles]) => [month, ...miles.map(Math.round)]);
const septemberBeforePhoenixPause = q3.get("2026-09")[0] + total(PAUSES["2026-09"]);
for (const [month, days, k, adjustments] of [
  // October: openings and area expansion, less the Phoenix pause, storm and rain.
  ["2026-10", 31, 4, total(OPENINGS["2026-10"]) - total(PAUSES["2026-10"])],
  // November: full month of openings and area expansion.
  ["2026-11", 30, 5, total(OPENINGS["2026-11"])],
]) {
  const best = septemberBeforePhoenixPause * days / 30 + adjustments;
  const band = [best, best * Math.exp(-(GHOST_BAND.lo[0] + GHOST_BAND.lo[1] * k)), best * Math.exp(GHOST_BAND.hi[0] + GHOST_BAND.hi[1] * k)];
  wantedMonthly.push([month, ...band.map(miles => 1000 * Math.round(miles / 1000))]);
}
const actualMonthly = wantedMonthly.map(([month]) => {
  const row = master.find(r => r.month === month);
  return [month, row.vmt, row.vmt_min, row.vmt_max];
});
assert.deepEqual(actualMonthly, wantedMonthly,
  `Replicata: combine filed Q3 California miles with the other metros and carry September's daily rate into October and November.
Expectata: monthly US miles and bounds ${JSON.stringify(wantedMonthly)} allowing for the San Diego split in Q3 and the forecast horizon thereafter.
Resultata: ${JSON.stringify(actualMonthly)}.`);

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

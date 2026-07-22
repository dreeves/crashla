import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Waymo's cumulative-rides history must respect Waymo's published ride-count
// milestones (Tesla's lane anchors to its deck-disclosed cumulative miles and
// Zoox's to published rider milestones; all three are pinned here):
//   10M cumulative paid trips announced May 20 2025 (CNBC / Google I/O), so
//     every later month's cumulative -- even its LOW bound -- must clear 10M.
//   ~20M lifetime trips by end of 2025 (Waymo 2025 year-in-review blog:
//     ">14M trips in 2025 alone ... set to exceed 20 million lifetime").
// This qual exists because the history was once derived from weekly rates
// alone and sat ~30% below the published cumulative milestones.

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const hist = vm.runInContext("JSON.stringify(RIDES_HISTORY)", ctx);
const waymo = JSON.parse(hist).Waymo;
const byMonth = Object.fromEntries(waymo.map(r => [r.month, r]));

const juneRow = byMonth["2025-06"];
assert.ok(juneRow !== undefined && juneRow.lo >= 10000000 && juneRow.best >= 10500000 && juneRow.best <= 13000000,
  `Replicata: read RIDES_HISTORY.Waymo's 2025-06 row against the 10M-trips milestone (May 20 2025).
Expectata: lo >= 10,000,000 (the milestone predates end-June) and best in [10.5M, 13M].
Resultata: ${JSON.stringify(juneRow)}.`);

const decRow = byMonth["2025-12"];
assert.ok(decRow !== undefined && decRow.lo <= 20000000 && 20000000 <= decRow.hi
    && decRow.best >= 18500000 && decRow.best <= 22000000,
  `Replicata: read RIDES_HISTORY.Waymo's 2025-12 row against the ~20M-lifetime-by-end-2025 milestone.
Expectata: band contains 20M and best in [18.5M, 22M].
Resultata: ${JSON.stringify(decRow)}.`);

vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

// Tesla's rides derive from its (deck-anchored) cumulative miles at the
// total-scope miles-per-ride corridor [4.7, 6.2, 8.3]: the trackers' observed
// 4-5 mi average paid ride divided by a 0.6-0.85 passenger-on-board share of
// fleet service miles (deadhead 15-40%). A history row that strays outside
// that corridor has come unglued from the miles data. (Repinned 2026-07-22,
// human-approved, from [7, 14]: that corridor reconciled the miles with a
// "~700k paid miles by late Apr 2026" figure that was actually mid-February
// vintage — Tesla's Q1-2026 deck puts end-Mar cumulative paid at ~1.717M.)
const teslaHist = JSON.parse(hist).Tesla;
const teslaCume = JSON.parse(vm.runInContext(
  `JSON.stringify(Object.fromEntries(vmtRows.filter(r => r.helmer === "Tesla").map(r => [r.month, r.vmtCume])))`, ctx));
for (const row of teslaHist) {
  const cume = teslaCume[row.month];
  if (cume === undefined) continue; // rows past the VMT master's last month
  const implied = cume / row.best;
  assert.ok(implied >= 4.5 && implied <= 8.5,
    `Replicata: divide Tesla's cumulative VMT at ${row.month} (${cume}) by the rides row's best (${row.best}).
Expectata: implied miles-per-ride in [4.5, 8.5] (tracker-observed paid-ride lengths / on-trip share of service miles).
Resultata: ${implied.toFixed(1)}.`);
}

// Zoox's rides anchor to its published cumulative RIDER counts (>300k riders
// by late 2025, >350k by late Mar 2026 — the same milestones the VMT series
// cites) divided by an occupancy band of 1.2-2.0 riders per ride.
const zooxByMonth = Object.fromEntries(JSON.parse(hist).Zoox.map(r => [r.month, r]));
const zooxFirst = JSON.parse(hist).Zoox[0];
assert.ok(zooxFirst.month >= "2025-12" && zooxFirst.best >= 150000,
  `Replicata: read Zoox's first rides row against the >300k-riders-by-late-2025 milestone.
Expectata: at least 150,000 rides (300k riders even at 2 riders/ride).
Resultata: ${JSON.stringify(zooxFirst)}.`);
const zooxMar = zooxByMonth["2026-03"];
assert.ok(zooxMar !== undefined && zooxMar.lo <= 233000 && 233000 <= zooxMar.hi
    && zooxMar.best >= 175000 && zooxMar.best <= 292000,
  `Replicata: read Zoox's 2026-03 row against the >350k-riders milestone.
Expectata: band contains ~233k (350k / 1.5 riders per ride) and best in [175k, 292k] (occupancy 1.2-2.0).
Resultata: ${JSON.stringify(zooxMar)}.`);

// Cumulative rides can't decrease: every rendered rides lane (history +
// forecast endpoint, incl. the Tesla scope lanes) must be non-decreasing in
// best/lo/hi. Checked on the lanes the chart actually draws.
const lanes = JSON.parse(vm.runInContext(
  `JSON.stringify(growthMetricSpec("rides").lanes().map(l => ({label: l.label, points: l.points})))`, ctx));
assert.equal(lanes.length, 4,
  `Replicata: build the rides trajectory lanes.
Expectata: four (Waymo, Zoox, Tesla robotaxi, Tesla HW4 fork).
Resultata: ${lanes.length}.`);
for (const lane of lanes) {
  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i-1], b = lane.points[i];
    assert.ok(b.best >= a.best && b.lo >= a.lo && b.hi >= a.hi,
      `Replicata: scan the "${lane.label}" rides lane's points in order.
Expectata: best/lo/hi all non-decreasing (cumulative counts).
Resultata: ${JSON.stringify(a)} then ${JSON.stringify(b)}.`);
  }
}

// The forecast endpoint stays consistent with the sourced trajectory: 500k
// paid rides/week as of Mar 2026 (TechCrunch 2026-03-27) makes anything under
// ~40M by Jan 2027 arithmetically impossible without ridership SHRINKING.
const waymoEnd = lanes.find(l => l.label === "Waymo").points.at(-1);
assert.ok(waymoEnd.best >= 40000000,
  `Replicata: check the Waymo rides forecast endpoint against the 500k/week Mar-2026 run rate.
Expectata: median >= 40,000,000.
Resultata: ${JSON.stringify(waymoEnd)}.`);

console.log("qual pass: Waymo cumulative rides track the published 10M/20M milestones; all rides lanes monotone");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

// Waymo's cumulative-rides history must respect Waymo's published ride-count
// milestones (Tesla's lane derives from the VMT master's cumulative miles,
// deck-disclosed through 2026-06, and Zoox's from published rider milestones;
// all three are pinned here):
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

// "Over half a million trips each week" (Waymo, Sep 14 2026; the floor it has
// stated since late March; data/vmt.csv's 2026-07..09 Waymo rationales):
// from the end-May row through Sep 30, 17.4 weeks at no less than 500k a week
// (audit #87: the history stopped at 2026-05 until 2026-10-03).
{
  const may = byMonth["2026-05"], sep = byMonth["2026-09"];
  const weeks = (Date.UTC(2026, 8, 30) - Date.UTC(2026, 4, 31)) / (7 * 86400000);
  const floor = r => Math.round(r + weeks * 500000);
  assert.ok(may !== undefined && sep !== undefined && sep.lo >= floor(may.lo) && sep.best >= floor(may.best),
    `Replicata: read RIDES_HISTORY.Waymo's 2026-05 and 2026-09 rows against Waymo's Sep-14 "over half a million trips each week".
Expectata: a 2026-09 row whose low edge is at least May's low edge plus ${weeks.toFixed(1)} weeks at 500k (${floor(may.lo)}) and whose best is at least May's best plus the same (${floor(may.best)}).
Resultata: May ${JSON.stringify(may)}, September ${JSON.stringify(sep)}.`);
}

vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

// Tesla's rides derive from its (deck-anchored) cumulative miles at the
// total-scope miles-per-ride corridor [4.7, 6.2, 8.3]: an author-set ~4-5 mi
// average paid ride (corroborated by robotaxitracker's receipt-synced trips,
// mean 3.81 mi ex hops, contributor-skewed low) divided by a 0.6-0.85
// passenger-on-board share of fleet service miles (deadhead 15-40%). A history row that strays outside
// that corridor has come unglued from the miles data. (Repinned 2026-07-22,
// human-approved, from [7, 14]: that corridor reconciled the miles with a
// "~700k paid miles by late Apr 2026" figure that was actually mid-February
// vintage — Tesla's Q1-2026 deck puts end-Mar cumulative paid at ~1.717M.)
// The rows are checked against the VMT MASTER, data/vmt.csv, which holds
// months data/vmt.js does not draw until their NHTSA release (until
// 2026-10-03 this read vmt.js and skipped any row past its last month, so a
// September row derived from the master's 2026-09 miles went unchecked).
const teslaHist = JSON.parse(hist).Tesla;
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(p => p[0] === "tesla")
  .map(p => ({ month: p[1], cume: Number(p[3]), kyoomMin: Number(p[4]), kyoomMax: Number(p[5]) }));
const teslaCume = Object.fromEntries(master.map(r => [r.month, r.cume]));
const corridor = JSON.parse(vm.runInContext("JSON.stringify(TESLA_MILES_PER_RIDE)", ctx));
for (const row of teslaHist) {
  const cume = teslaCume[row.month];
  assert.ok(cume !== undefined,
    `Replicata: look up Tesla's ${row.month} rides row in data/vmt.csv.
Expectata: the master has Tesla miles for that month (the row derives from them).
Resultata: no Tesla row for ${row.month}.`);
  const implied = cume / row.best;
  assert.ok(implied >= 4.5 && implied <= 8.5,
    `Replicata: divide Tesla's cumulative VMT at ${row.month} (${cume}) by the rides row's best (${row.best}).
Expectata: implied miles-per-ride in [4.5, 8.5] (author-set ~4-5 mi paid-ride length / on-trip share of service miles; receipt-corroborated).
Resultata: ${implied.toFixed(1)}.`);
  // The band is at least the corridor applied to the month's miles: the
  // deck-chart months' miles are near-exact, so their bands are the
  // corridor's (cume / 8.3 .. cume / 4.7); a month whose miles are an
  // estimate divides its kyoom band by the corridor, which is wider.
  assert.ok(row.lo <= cume / corridor.hi * 1.005 && row.hi >= cume / corridor.lo * 0.995,
    `Replicata: compare Tesla's ${row.month} rides band [${row.lo}, ${row.hi}] with the month's cumulative miles ${cume} over the [${corridor.lo}, ${corridor.best}, ${corridor.hi}] miles-per-ride corridor.
Expectata: lo <= ${Math.round(cume / corridor.hi)} and hi >= ${Math.round(cume / corridor.lo)}.
Resultata: [${row.lo}, ${row.hi}].`);
}
// The rides history runs as far as the master's miles (audit #87): to the
// last quarter-end month data/vmt.csv holds for Tesla, the rows' cadence.
// Until 2026-10-03 it stopped at 2026-06 while the master held 2026-09, so
// the all-HW4 fork left from 2026-06 under Rides but 2026-08 under Fleet and
// Miles.
{
  const quarterEnds = master.map(r => r.month).filter(m => ["03", "06", "09", "12"].includes(m.slice(5)));
  const want = quarterEnds.at(-1);
  assert.equal(teslaHist.at(-1).month, want,
    `Replicata: compare the last month of RIDES_HISTORY.Tesla with the last quarter-end month of data/vmt.csv's Tesla rows.
Expectata: ${want} (add the row as cumulative miles over the [${corridor.lo}, ${corridor.best}, ${corridor.hi}] miles-per-ride corridor).
Resultata: ${teslaHist.at(-1).month}.`);
}

// Zoox's rides anchor to its published cumulative RIDER counts (>300k riders
// by late 2025, >350k by late Mar 2026, >500k by late Jun 2026 — the first
// two are the same milestones the VMT series cites; the third is from the
// robotaxi-redesign announcement, 2026-06-25) divided by an occupancy band
// of 1.2-2.0 riders per ride.
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
const zooxJun = zooxByMonth["2026-06"];
assert.ok(zooxJun !== undefined && zooxJun.lo <= 333000 && 333000 <= zooxJun.hi
    && zooxJun.best >= 250000 && zooxJun.best <= 417000,
  `Replicata: read Zoox's 2026-06 row against the >500k-riders milestone (redesign PR, Jun 25 2026).
Expectata: band contains ~333k (500k / 1.5 riders per ride) and best in [250k, 417k] (occupancy 1.2-2.0).
Resultata: ${JSON.stringify(zooxJun)}.`);

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

console.log("qual pass: Waymo cumulative rides track the published 10M/20M milestones and the Sep-14 weekly floor; Tesla's rows follow data/vmt.csv through its last quarter end; all rides lanes monotone");

import assert from "node:assert/strict";
import fs from "node:fs";

// Waymo's cumulative VMT series must track Waymo's own published cumulative
// mileage milestones. The series counts SGO-era months only (2021-07 onward),
// while the published lifetime figures start at the beginning of driverless
// operations, so each pin below subtracts PRE_SERIES_MILES (the estimated
// driverless miles driven before 2021-07 -- small, and it only matters for the
// earliest pin). Milestones:
//   ~1.0M  lifetime, crossed during Jan 2023 (Waymo blog 2023-02-28,
//          "First Million Rider-Only Miles")
//   7.14M  lifetime through Oct 31 2023 (arXiv 2312.12675)
//   25.3M  lifetime through Jul 31 2024 (Swiss Re / Di Lillo et al. 2024)
//   56.7M  lifetime through Jan 31 2025 (arXiv 2505.01515)
//   100M   lifetime, crossed ~Jul 15 2025 (Waymo announcement)
//   170.7M lifetime end Dec 2025, 220.6M end Mar 2026 (Waymo safety hub)
// This qual exists because the pre-2025 rows were once interpolated without
// respecting the early milestones and overstated Jan-2023 cumulative ~4x.
//
// Hub scope (settled 2026-08-28 from the hub's own per-location CSV1 files
// and release notes): a hub "All Locations" total counts only BENCHMARKED
// locations. Metros with rider-only service but no county benchmark are
// left out until one exists — Atlanta (rider-only from Jan 30, 2025) was
// absent from the 96M/127M/170.7M totals and entered whole (5.379M lifetime)
// at 220.6M; Santa Clara entered at 170.7M; Miami, Dallas, Houston, San
// Antonio, Orlando and Nashville are still out at 220.6M. The repo's series is
// US-wide (its incident numerator already includes those metros), so each
// pin is hub + E, where E is the estimated rider-only mileage of the excluded
// metros at that date (data/README.md, Waymo anchor table; lo/best/hi). When
// the hub adds a metro, set that metro's share of E to 0 at that anchor and
// re-chain data/vmt.csv.

const PRE_SERIES_MILES = 150000;

const rows = fs.readFileSync("data/vmt.csv", "utf8").trim().split("\n").slice(1)
  .map(l => l.split(",", 8))
  .filter(p => p[0] === "waymo")
  .map(p => ({month: p[1], cume: Number(p[3]), kmin: Number(p[4]), kmax: Number(p[5])}));
const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));

// [month, published figure, excluded-metro E (lo, best, hi), lo tolerance,
// hi tolerance, midMonth] -- tolerances are on the SERIES value (figure +
// E_best - PRE_SERIES_MILES), generous enough for milestone rounding,
// exact-crossing-date ambiguity, and offset uncertainty. midMonth milestones
// were crossed during the month, so the end-of-month row legitimately sits
// above them and only the cume range (not band containment) is checked. The
// kyoom band must contain the whole [figure + E_lo, figure + E_hi] range.
// Pre-2025 hub totals also excluded Mountain View employee rider-only miles
// (<= 0.13M, inside tolerance; E left at 0). Milestone STATEMENTS (the ~1M,
// 100M and ~200M crossings) are company-wide, so they carry E = 0.
const PINS = [
  ["2023-01", 1000000, [0, 0, 0], 0.80, 1.30, true], // crossed during Jan 2023
  ["2023-10", 7140000, [0, 0, 0], 0.93, 1.03, false],
  ["2023-12", 9300000, [0, 0, 0], 0.93, 1.07, false],  // ~9.3M end-2023 (Driverless Digest / Waymo)
  ["2024-06", 22000000, [0, 0, 0], 0.97, 1.03, false], // Waymo Safety Hub
  ["2024-07", 25300000, [0, 0, 0], 0.95, 1.03, false], // 25M hub end-Jul + 25.3M Swiss Re through Jul 31
  ["2024-12", 50000000, [0, 0, 0], 0.97, 1.03, false], // year-in-review
  ["2025-01", 56700000, [0, 0, 0], 0.96, 1.02, false],
  // Hub CSV1 202503: blended 71.432M; Atlanta 0.056M + Mountain View 0.132M listed but excluded (exact E)
  ["2025-03", 71432000, [188000, 188000, 188000], 0.98, 1.02, false],
  // Hub CSV1 202506: 95.965M (PHX/SF/LA/ATX); Atlanta + Santa Clara/MTV excluded
  ["2025-06", 95965000, [400000, 700000, 1300000], 0.98, 1.02, false],
  // Company-wide milestone statement (not a hub total): no scope exclusion, E = 0
  ["2025-07", 100000000, [0, 0, 0], 1.00, 1.13, true], // crossed ~Jul 15
  // Hub CSV1 202509: 127.158M; Atlanta + Santa Clara excluded
  ["2025-09", 127158000, [1300000, 2000000, 3100000], 0.98, 1.02, false],
  // Hub CSV1 202512: 170.712M (county basis, Santa Clara now in); Atlanta ~3.5M, Miami, DAL/HOU/SAT/ORL excluded
  ["2025-12", 170712000, [3000000, 3700000, 4600000], 0.98, 1.02, false],
  // Hub CSV1 202603: 220.613M (Atlanta now in); Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson excluded
  ["2026-03", 220613000, [1200000, 2000000, 3300000], 0.98, 1.02, false],
];

for (const [month, figure, [eLo, eBest, eHi], loTol, hiTol, midMonth] of PINS) {
  const row = byMonth[month];
  assert.ok(row !== undefined,
    `Replicata: look up waymo ${month} in data/vmt.csv.
Expectata: a row exists for every milestone month.
Resultata: no such row.`);
  const target = figure + eBest - PRE_SERIES_MILES;
  const lo = target * loTol, hi = target * hiTol;
  assert.ok(row.cume >= lo && row.cume <= hi,
    `Replicata: compare waymo cumulative VMT at ${month} to Waymo's published figure plus the excluded-metro estimate.
Expectata: helmer_cumulative_vmt within [${Math.round(lo)}, ${Math.round(hi)}] (published ${figure} + E ${eBest} minus ~${PRE_SERIES_MILES} pre-series miles, with tolerance).
Resultata: ${row.cume}.`);
  if (!midMonth) assert.ok(row.kmin <= figure + eLo - PRE_SERIES_MILES && figure + eHi - PRE_SERIES_MILES <= row.kmax,
    `Replicata: check waymo ${month}'s kyoom band against the published figure and the excluded-metro range.
Expectata: the authored cumulative band [kyoom_min, kyoom_max] contains [${figure + eLo - PRE_SERIES_MILES}, ${figure + eHi - PRE_SERIES_MILES}].
Resultata: [${row.kmin}, ${row.kmax}].`);
}

// The 100M milestone was crossed ~Jul 15 2025, so the mid-July cumulative
// (end-June plus ~15/31 of July's miles) must sit at ~100M, not just be
// bracketed by the month-end rows.
const midJul = byMonth["2025-06"].cume +
  (15 / 31) * (byMonth["2025-07"].cume - byMonth["2025-06"].cume);
const midJulTarget = 100000000 - PRE_SERIES_MILES;
assert.ok(midJul >= midJulTarget * 0.97 && midJul <= midJulTarget * 1.03,
  `Replicata: interpolate waymo cumulative VMT at Jul 15 2025 from the month-end rows.
Expectata: within 3% of the 100M-crossing milestone (${midJulTarget} series).
Resultata: ${Math.round(midJul)}.`);

console.log("qual pass: waymo cumulative VMT tracks all published mileage milestones");

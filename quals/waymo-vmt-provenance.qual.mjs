import assert from "node:assert/strict";
import fs from "node:fs";

// Waymo's cumulative VMT series must track Waymo's own published cumulative
// mileage figures. The series counts SGO-era months only (2021-07 onward),
// while the published lifetime figures count every rider-only mile, so each
// pin below subtracts the pre-series offset, OFFSET (the rider-only miles
// driven before 2021-07): central 150,000, range 150,000-260,000 since
// 2026-10-31 (decision #49b): Kusano et al. 2025 Table 2 (arXiv 2505.01515)
// puts 94,400 in 2019-2020 and 328,000 in 2021; Schwall et al. 2020 (arXiv
// 2011.00038) puts 65,000 in Jan 2019-Sep 2020, so Q4 2020 ran ~320 a day,
// and Jan-Jun 2021 held between that rate and half of 2021 (152,200-258,400,
// rounded outward). A series value is the lifetime value less the offset:
// its central less 150,000, its band's low edge less the offset's high,
// its high edge less its low. Figures (data/README.md, Waymo anchors and
// Waymo monthly allocation):
//   Kusano et al. 2025, Table 2: 0.4224M through 2021, 0.9464M through 2022,
//          10.0664M through 2023 (each city-year to three significant figures)
//   1.0M   lifetime on Jan 21, 2023 (Victor et al. 2023, Waymo's
//          one-million-mile paper, p. 8)
//   3,868,506 through Jul 31, 2023, Phoenix + San Francisco ("from 1/1/2018
//          to 8/1/2023"; Di Lillo et al. 2023, Swiss Re, arXiv 2309.01206)
//   7.14M  "over 7.14 million RO miles through the end of October 2023"
//          (Kusano et al. 2024, arXiv 2312.12675)
//   14.8M  "Over 14.8M rider-only miles driven through the end of March"
//          (Waymo on X, Jun 18, 2024), a floor
//   22.199M / 25.308M / 33.103M / 50.083M through Jun / Jul / Sep / Dec 2024
//          (hub CSV1 files); 56.7M through Jan 2025 (Kusano et al. 2025)
//   100M   lifetime, crossed ~Jul 15 2025 (Waymo announcement)
//   hub CSV1 totals plus E from Mar 2025 (below)
// This qual exists because the pre-2025 rows were once interpolated without
// respecting the early milestones and overstated Jan-2023 cumulative ~4x;
// until 2026-10-31 the end-2023 pin was 9.3M, an analyst's estimate (Egil
// Juliussen, EE Times, Jul 2, 2025) that Table 2 contradicts (open
// question 15), and the 2024 pins were the rounded milestones 22M, 25.3M and
// 50M, which CSV1 refines.
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
//
// Atlanta D, withdrawn: from 2026-09-25 to 2026-09-29 each pin also
// subtracted D, the Atlanta miles the hub's detail file (CSV4) appeared to
// count twice (~85 Fulton/DeKalb S2 cells listed twice, and the county
// totals equal to the sums that count both copies). Waymo's corrected
// CSV4 v2 (Sep 28, 2026) lists each cell once and still sums to the
// published county totals: per-cell miles are shares of FIXED county totals
// computed by a separate process, so the equality was by construction and
// the published totals stand. The pins below are hub + E again.

const OFFSET = {central: 150000, lo: 150000, hi: 260000};

const rows = fs.readFileSync("data/vmt.csv", "utf8").trim().split("\n").slice(1)
  .map(l => l.split(",", 8))
  .filter(p => p[0] === "waymo")
  .map(p => ({month: p[1], cume: Number(p[3]), kmin: Number(p[4]), kmax: Number(p[5])}));
const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));

// Knots: [month, lifetime figure, its low and high edge (the figure's own
// precision), excluded-metro E (lo, best, hi), tolerance on the series
// central (figure + E_best - OFFSET.central)]. The kyoom band at a knot IS the
// knot's band: [low + E_lo - OFFSET.hi, high + E_hi - OFFSET.lo] (until
// 2026-10-31 the offset was a fixed 150,000, so Mar-2025's band was a single
// value). Waymo's own figures carry their displayed precision: Table 2 rounds
// each city-year to three significant figures; each 2024 CSV1 total sums four
// values rounded to 1,000 miles (+/-2,000) and omits at most 5,500 Mountain
// View miles; the Jan-2025 paper total is +/-500 with at most 9,250 Mountain
// View and Atlanta miles; the Swiss Re count may run through Aug 1, one more
// day (35,560 miles, August-October 2023's daily average). The hub anchors
// (Mar 2025 on) carry E, whose range their bands hold.
const KNOTS = [
  ["2021-12", 422400, 421800, 423000, [0, 0, 0], 0.001],      // Table 2 through 2021
  ["2022-12", 946400, 945250, 947550, [0, 0, 0], 0.001],      // Table 2 through 2022
  ["2023-07", 3868506, 3832946, 3868506, [0, 0, 0], 0.001],   // Swiss Re, through Jul 31
  ["2023-10", 7140000, 7140000, 7150000, [0, 0, 0], 0.001],   // "over 7.14 million"
  ["2023-12", 10066400, 10054750, 10078050, [0, 0, 0], 0.001], // Table 2 through 2023
  ["2024-06", 22199000, 22197000, 22206500, [0, 0, 0], 0.001], // hub CSV1 202406
  ["2024-07", 25308000, 25306000, 25315500, [0, 0, 0], 0.001], // hub CSV1 202407
  ["2024-09", 33103000, 33101000, 33110500, [0, 0, 0], 0.001], // hub CSV1 202409
  ["2024-12", 50083000, 50081000, 50090500, [0, 0, 0], 0.001], // hub CSV1 202412
  ["2025-01", 56700000, 56699500, 56709750, [0, 0, 0], 0.001], // Kusano et al. 2025
  // Hub CSV1 202503: blended 71.432M; Atlanta 0.056M + Mountain View 0.132M
  // listed but excluded (exact E). Exact hub-CSV1 anchors carry ±0.1% on the
  // central: the rows land on figure + E_best - 0.15M to within 400 mi.
  ["2025-03", 71432000, 71432000, 71432000, [188000, 188000, 188000], 0.001],
  // Hub CSV1 202506: 95.965M (PHX/SF/LA/ATX); Atlanta + Santa Clara/MTV excluded
  ["2025-06", 95965000, 95965000, 95965000, [400000, 700000, 1300000], 0.001],
  // Hub CSV1 202509: 127.158M; Atlanta + Santa Clara excluded
  ["2025-09", 127158000, 127158000, 127158000, [1300000, 2000000, 3100000], 0.001],
  // Hub CSV1 202512: 170.712M (county basis, Santa Clara now in); Atlanta ~3.5M, Miami, DAL/HOU/SAT/ORL excluded
  ["2025-12", 170712000, 170712000, 170712000, [3000000, 3700000, 4600000], 0.001],
  // Hub CSV1 202603: 220.613M (Atlanta now in); Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson excluded
  ["2026-03", 220613000, 220613000, 220613000, [1200000, 2000000, 3300000], 0.001],
  // Hub CSV1 202606 (Sep 24, 2026): 271.329M, same eight counties; E best =
  // the carried monthly E (2.0M thru Mar + 1.4/1.45/1.8M Apr-Jun). E lo/hi =
  // the crash proxy on the 41 unbenchmarked-county crashes Jan-Jun at the
  // young-market rate (Travis + Atlanta pooled, 6.61/M), Poisson-widened:
  // 4.0M / 10.2M.
  ["2026-06", 271329379, 271329379, 271329379, [4000000, 6650000, 10200000], 0.001],
];

for (const [month, figure, low, high, [eLo, eBest, eHi], tol] of KNOTS) {
  const row = byMonth[month];
  assert.ok(row !== undefined,
    `Replicata: look up waymo ${month} in data/vmt.csv.
Expectata: a row exists for every knot month.
Resultata: no such row.`);
  const target = figure + eBest - OFFSET.central;
  assert.ok(Math.abs(row.cume - target) <= tol * target,
    `Replicata: compare waymo cumulative VMT at ${month} to Waymo's published figure plus the excluded-metro estimate.
Expectata: helmer_cumulative_vmt within ${100 * tol}% of ${target} (published ${figure} + E ${eBest} minus the ${OFFSET.central} pre-series miles).
Resultata: ${row.cume}.`);
  const wantMin = low + eLo - OFFSET.hi, wantMax = high + eHi - OFFSET.lo;
  assert.ok(row.kmin === wantMin && row.kmax === wantMax,
    `Replicata: compare waymo ${month}'s kyoom band with its knot band.
Expectata: exactly [${wantMin}, ${wantMax}] (the figure's range plus E's, less the pre-series offset's range ${OFFSET.lo}-${OFFSET.hi}).
Resultata: [${row.kmin}, ${row.kmax}].`);
}

// Milestones crossed during a month, so the end-of-month row legitimately
// sits above them: [month, lifetime figure, lo tolerance, hi tolerance] on
// the series value. Company-wide statements, so E = 0.
const CROSSINGS = [
  ["2025-07", 100000000, 1.00, 1.13], // crossed ~Jul 15
];
for (const [month, figure, loTol, hiTol] of CROSSINGS) {
  const row = byMonth[month];
  const target = figure - OFFSET.central;
  assert.ok(row.cume >= target * loTol && row.cume <= target * hiTol,
    `Replicata: compare waymo cumulative VMT at ${month} with the ${figure} milestone crossed during it.
Expectata: helmer_cumulative_vmt within [${Math.round(target * loTol)}, ${Math.round(target * hiTol)}].
Resultata: ${row.cume}.`);
}

// The first million rider-only miles on Jan 21, 2023 (Victor et al. 2023,
// p. 8): Table 2's end-2022 cumulative plus January's first 21 days, the
// month's miles spread evenly over its days, reach 1,000,000 less the
// offset. January's band: the crossing by the end of Jan 21 (1,000,000 to
// 1,002,600, up to one more day's miles) plus Jan 22-31 at half to twice
// Jan 1-21's daily rate.
{
  const dec = byMonth["2022-12"], jan = byMonth["2023-01"];
  const atJan21 = dec.cume + 21 / 31 * (jan.cume - dec.cume);
  assert.ok(Math.abs(atJan21 - (1000000 - OFFSET.central)) <= 1,
    `Replicata: interpolate waymo's cumulative to the end of Jan 21, 2023.
Expectata: ${1000000 - OFFSET.central} (the first million rider-only miles, less the offset).
Resultata: ${Math.round(atJan21)}.`);
  const rateLo = (1000000 - 947550) / 21, rateHi = (1002600 - 945250) / 21;
  const wantMin = Math.floor(1000000 + 10 * 0.5 * rateLo) - OFFSET.hi;
  const wantMax = Math.ceil(1002600 + 10 * 2 * rateHi) - OFFSET.lo;
  assert.ok(jan.kmin === wantMin && jan.kmax === wantMax,
    `Replicata: compare waymo 2023-01's kyoom band with the Jan 21 crossing's band.
Expectata: exactly [${wantMin}, ${wantMax}].
Resultata: [${jan.kmin}, ${jan.kmax}].`);
}

// "Over 14.8M rider-only miles driven through the end of March" (2024): a
// floor on the central and on the band.
{
  const mar = byMonth["2024-03"];
  assert.ok(mar.cume + OFFSET.central >= 14800000 && mar.kmin >= 14800000 - OFFSET.hi,
    `Replicata: compare waymo 2024-03 with Waymo's "Over 14.8M" through the end of March 2024.
Expectata: helmer_cumulative_vmt >= ${14800000 - OFFSET.central} and kyoom_min >= ${14800000 - OFFSET.hi}.
Resultata: ${mar.cume}, kyoom_min ${mar.kmin}.`);
}

// The 100M milestone was crossed ~Jul 15 2025, so the mid-July cumulative
// (end-June plus ~15/31 of July's miles) must sit at ~100M, not just be
// bracketed by the month-end rows.
const midJul = byMonth["2025-06"].cume +
  (15 / 31) * (byMonth["2025-07"].cume - byMonth["2025-06"].cume);
const midJulTarget = 100000000 - OFFSET.central;
assert.ok(midJul >= midJulTarget * 0.97 && midJul <= midJulTarget * 1.03,
  `Replicata: interpolate waymo cumulative VMT at Jul 15 2025 from the month-end rows.
Expectata: within 3% of the 100M-crossing milestone (${midJulTarget} series).
Resultata: ${Math.round(midJul)}.`);

console.log("qual pass: waymo cumulative VMT tracks all published mileage milestones");

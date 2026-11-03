import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// Zoox's rows from June 2025 on follow one model (data/README.md, Zoox
// anchors), which this qual recomputes from its inputs.
//
// June-December 2025 (2026-11-02, the human's answer to open question 21,
// "Smooth path, honest bands"; until then a constant tilt put the 1M crossing
// on Dec 4 and held Dec 31 at exactly 1.3M, a December spike):
//   - California: the CA DMV's driverless miles (permit AVDT004), June-
//     November measured; December, in no DMV report yet, is November's times
//     CPUC's December/November ratio, its range CPUC's December (a floor) to
//     that figure over 0.6 (the 60% pilot-share reading).
//   - The rest, mostly Las Vegas: the smoothest path, the one whose miles per
//     Las Vegas driving day change least from month to month (the least sum
//     of squared month-to-month changes in their logarithm), from May 2025
//     (fixed: the early rows' rule, Las Vegas = California) through the 2026
//     rows below, that keeps every Zoox statement within its range: the 1M
//     lifetime mark crossed during Dec 1-7 (Fortune, Dec 8, 2025: "just last
//     week") and "approximately 1.3 million" at Dec 31 read as [1.25M, 1.35M],
//     lifetime being the series plus the 40,080 pre-series driverless miles.
//     Each month's miles count as spread evenly over its days. The 2026 rows
//     depend on the path through its Dec-31 cumulative (below), so the
//     criterion runs through April 2026; past it every step is fixed.
//   - Months round to whole miles, December absorbing the residue.
//   - Band: California plus half to twice the Las Vegas share (the allowance
//     the early rows give an unmeasured Las Vegas split), within what the
//     statements allow: each month inside the difference of its lifetime
//     cumulative bands, swept from May's lifetime band (its series band plus
//     the pre-series miles' band) with knots at November (the crossing: not
//     before Dec 1, by the end of Dec 7 with December's miles at most its
//     California high plus twice its Las Vegas share) and December (the 1.3M
//     statement). Edges round outward.
//   - Both earlier shapes stay inside the June-November bands, the 10e2343
//     rows and the 2026-10-31 reshape; December's 10e2343 value is ruled out
//     by the statements (at least 250,000: 1.25M at Dec 31 less 1M at Nov 30).
//
// 2026 (2026-10-27; restated 2026-11-02):
//   - Zoox's three cumulative statements (company basis): "approximately 1.3
//     million driverless autonomous miles" at Dec 31, 2025 (letter to NHTSA,
//     Jan 28, 2026), "nearly two million autonomous miles" (Mar 24, 2026) and
//     "more than 3 million miles on public roads" (Aug 5, 2026), read as
//     [1.25M, 1.35M], [1.88M, 2.00M] and [3.00M, 3.20M]. Jan 1-Mar 24 (83
//     days) holds the March statement's midpoint less the smooth path's Dec-31
//     lifetime (until 2026-11-02: less the Dec-31 statement's midpoint, 1.30M,
//     640,000 miles), Mar 25-Aug 5 (134 days) the midpoints' difference,
//     1,160,000.
//   - California: CPUC's driverless pilot miles (TCP 0038380-P) x 1.19 for
//     the DMV-reported driverless miles CPUC misses (an assumption: the
//     midpoint of 1.05-1.33, the DMV/CPUC ratio having fallen from 3.97 to
//     1.33 over Apr-Nov 2025), measured through June and grown e^0.05 a
//     calendar month after it.
//   - The rest, mostly Las Vegas: each interval's remainder spread evenly
//     over its driving days (January's Las Vegas outage, Jan 22-26, taken as
//     5 days without it), held flat after Aug 5.
//   - Each month rounds to 10,000 (the statements are rounded by 3-7%).
//   - Band: vmt x e^(-1.96 sigma) to vmt x e^(1.96 sigma'), sigma =
//     sqrt(0.065^2 + 0.07^2 h + 0.09^2) (statement rounding, drift, month
//     noise), h = months from the governing interval's midpoint to the
//     month's (January-March: Jan 1-Mar 24; April on: Mar 25-Aug 5); sigma'
//     adds 0.10 in quadrature from October, when fleet growth was announced
//     but not quantified (the NTA's 100-vehicle cap expired Sep 25). Edges
//     round to 1,000.
//
// Cumulative bands: one sweep over the whole series from its exact zero
// (May 2024), forward with the monthly bands and back from each knot: the
// November 2025 crossing and the December 2025 knot (above), a knot at
// end-March and a floor at end-July from the March and August statements
// (each read as of up to a week before its date, less the 40,080 pre-series
// driverless miles at their own band, 30,127.3 to 59,986.6, then carried to
// the month's end at 0.7x-1.3x the model's daily miles, rounded outward).
// The July bound is a floor only: "more than" sets no ceiling, and Zoox's own
// "more than one million autonomous miles" of Mar 11, 2026 came when the
// series stood near 1.84M. The early rows' monthly bands (May 2024-May 2025,
// the 2026-10-03 rule) are read from the master.

const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(p => p[0] === "zoox")
  .map(p => ({ month: p[1], vmt: +p[2], cume: +p[3], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7] }));
const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));
const nextMonth = m => { const n = +m.slice(0, 4) * 12 + +m.slice(5, 7); return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; };
assert.ok(rows.length > 0 && rows[0].month === "2024-05" && rows.every((r, i) => i === 0 || r.month === nextMonth(rows[i - 1].month)),
  `Replicata: list data/vmt.csv's zoox months.
Expectata: consecutive months starting at 2024-05.
Resultata: ${JSON.stringify(rows.map(r => r.month))}.`);
const mid = ([a, b]) => (a + b) / 2;
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const round = (x, unit) => Math.round(x / unit) * unit;

const PRE = [20174.2 + 0.5 * 19906.2, 20174.2 + 2 * 19906.2]; // pre-series driverless miles' band
const PRE_C = 40080; // its central, as the series counts it (20,174.2 + 19,906.2)
const S0 = [1250000, 1350000];
const S1 = [1880000, 2000000];
const S2 = [3000000, 3200000];
const CROSS = 1000000;

// --- 2026 inputs --------------------------------------------------------------
const CPUC = {
  "2026-01": 31996.94, "2026-02": 38162.55, "2026-03": 51137.72,
  "2026-04": 47322.83, "2026-05": 65708.40, "2026-06": 67922.81,
};
const DMV_FACTOR = 1.19;
const GROWTH = 0.05;
const LV_PAUSE_JAN = 5;
// The months the model covers: every zoox row of data/vmt.csv from January
// 2026 on, ghost months included, each with its calendar length. Until
// 2026-10-31 this was a fixed list ending at 2026-10, so the November row each
// release adds went unchecked (audit 2026-10-30, QT-10 and R8).
const MONTHS = rows.map(r => r.month).filter(m => m >= "2026-01");
assert.ok(MONTHS.length > 0 && MONTHS[0] === "2026-01",
  `Replicata: list data/vmt.csv's zoox months from 2026-01 on.
Expectata: consecutive months starting at 2026-01.
Resultata: ${JSON.stringify(MONTHS)}.`);
const DAYS = Object.fromEntries(MONTHS.map(m => [m, daysIn(m)]));

// Day of year of each month's first day, and of its mean day (Jan 16).
const FIRST = {};
{ let d = 1; for (const m of MONTHS) { FIRST[m] = d; d += DAYS[m]; } }
const monthMid = m => FIRST[m] + (DAYS[m] - 1) / 2;
const Q1 = { first: 1, last: 83, days: 83 };   // Jan 1 - Mar 24
const W2 = { first: 84, last: 217, days: 134 }; // Mar 25 - Aug 5
const winMid = w => (w.first + w.last) / 2;

// California's miles a day, CPUC basis: measured through June, then June's
// daily rate grown e^GROWTH a month.
const caDay = m => m <= "2026-06" ? CPUC[m] / DAYS[m]
  : CPUC["2026-06"] / 30 * Math.exp(GROWTH * (MONTHS.indexOf(m) - MONTHS.indexOf("2026-06")));
const caQ1 = DMV_FACTOR * (CPUC["2026-01"] + CPUC["2026-02"] + 24 * caDay("2026-03"));
const caW2 = DMV_FACTOR * (7 * caDay("2026-03") + CPUC["2026-04"] + CPUC["2026-05"] + CPUC["2026-06"]
  + 31 * caDay("2026-07") + 5 * caDay("2026-08"));
// The Las Vegas share per driving day over Jan 1-Mar 24, given the series'
// Dec-31 cumulative, and over Mar 25-Aug 5.
const lvQ1Of = decCume => (mid(S1) - (decCume + PRE_C) - caQ1) / (Q1.days - LV_PAUSE_JAN);
const lvW2 = (mid(S2) - mid(S1) - caW2) / W2.days;

// --- June-December 2025: the smooth path --------------------------------------
const M25 = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"];
const D25 = M25.map(daysIn);
const CA_DMV = [22507.9, 26629.5, 36071.5, 35016.9, 42285.5, 56274.8]; // CA DMV, permit AVDT004, Jun-Nov 2025
const CPUC_NOV_2025 = 42347.31, CPUC_DEC_2025 = 36481.55;
const CA = [...CA_DMV, CA_DMV[5] * CPUC_DEC_2025 / CPUC_NOV_2025];
const CA_LO = [...CA_DMV, CPUC_DEC_2025], CA_HI = [...CA_DMV, CPUC_DEC_2025 / 0.6];
const may = byMonth["2025-05"];
assert.ok(may !== undefined, "Replicata: find zoox 2025-05 in data/vmt.csv. Expectata: present. Resultata: missing.");
const LV_MAY_RATE = may.vmt / 2 / daysIn("2025-05"); // the early rows' rule: Las Vegas = California

// The Las Vegas share per driving day through the 2026 rows: January and
// February at the Jan 1-Mar 24 rate, March 24 days at it and 7 at the Mar
// 25-Aug 5 rate, April on at the latter (constant past April).
const tailRates = lvq1 => [lvq1, lvq1, (24 * lvq1 + 7 * lvW2) / 31, lvW2];
const roughness = (u, lvq1) => {
  const seq = [Math.log(LV_MAY_RATE), ...u, ...tailRates(lvq1).map(Math.log)];
  return seq.slice(1).reduce((s, x, i) => s + (x - seq[i]) ** 2, 0);
};
// The smoothest Jun-Dec log daily rates u given the Dec-31 series cumulative
// S: Newton on the Lagrange conditions 2(2u_m - u_{m-1} - u_{m+1}) = nu x
// (month m's miles) and the month sum, from the straight line in log rate
// between May and January shifted to that sum.
function solveAt(S) {
  const lvq1 = lvQ1Of(S);
  assert.ok(lvq1 > 0, `Replicata: the Jan 1-Mar 24 Las Vegas rate at a Dec-31 cumulative of ${S}. Expectata: positive. Resultata: ${lvq1}.`);
  const lo = Math.log(LV_MAY_RATE), hi = Math.log(lvq1), n = 7;
  const target = S - may.cume - CA.reduce((a, b) => a + b, 0);
  const line = Array.from({length: n}, (_, k) => lo + (hi - lo) * (k + 1) / (n + 1));
  const shift = Math.log(target / line.reduce((a, x, k) => a + D25[k] * Math.exp(x), 0));
  let u = line.map(x => x + shift);
  let nu = 0;
  for (let it = 0; it < 200; it++) {
    const e = u.map((x, k) => D25[k] * Math.exp(x));
    const full = [lo, ...u, hi];
    const F = [...u.map((_, k) => 2 * (2 * full[k + 1] - full[k] - full[k + 2]) - nu * e[k]), e.reduce((a, b) => a + b, 0) - target];
    const A = Array.from({length: n + 1}, () => new Array(n + 2).fill(0));
    for (let k = 0; k < n; k++) {
      A[k][k] = 4 - nu * e[k];
      if (k > 0) A[k][k - 1] = -2;
      if (k < n - 1) A[k][k + 1] = -2;
      A[k][n] = -e[k];
      A[n][k] = e[k];
    }
    F.forEach((f, r) => { A[r][n + 1] = -f; });
    for (let c = 0; c <= n; c++) {
      let p = c;
      for (let r = c + 1; r <= n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r <= n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let cc = c; cc <= n + 1; cc++) A[r][cc] -= f * A[c][cc];
      }
    }
    const dx = A.map((row, r) => row[n + 1] / row[r]);
    u = u.map((x, k) => x + dx[k]);
    nu += dx[n];
    if (Math.max(...dx.slice(0, n).map(Math.abs)) < 1e-13) break;
  }
  return {u, lvq1, rough: roughness(u, lvq1)};
}
// The Dec-31 series cumulative the statement allows, and the roughness of
// the smoothest path at each: the minimum over the range (grid, then
// golden-section in the best cell; an end of the range when it is lowest).
const S_RANGE = [S0[0] - PRE_C, S0[1] - PRE_C];
const grid = [];
for (let i = 0; i <= 200; i++) {
  const S = S_RANGE[0] + (S_RANGE[1] - S_RANGE[0]) * i / 200;
  grid.push({S, rough: solveAt(S).rough});
}
let iBest = grid.reduce((b, g, i) => g.rough < grid[b].rough ? i : b, 0);
let sBest = grid[iBest].S;
if (iBest > 0 && iBest < grid.length - 1) {
  let a = grid[iBest - 1].S, b = grid[iBest + 1].S;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 80; it++) {
    const c = b - phi * (b - a), d = a + phi * (b - a);
    if (solveAt(c).rough < solveAt(d).rough) b = d; else a = c;
  }
  sBest = Math.round((a + b) / 2);
}
const path = solveAt(sBest);
const LV = path.u.map((x, k) => D25[k] * Math.exp(x));
const T = LV.map((l, k) => CA[k] + l);
const want25 = T.map(t => Math.round(t));
want25[6] += sBest - may.cume - want25.reduce((a, b) => a + b, 0);
const novCume = may.cume + want25.slice(0, 6).reduce((a, b) => a + b, 0);
const crossingDay = daysIn("2025-12") * (CROSS - PRE_C - novCume) / want25[6];
assert.ok(crossingDay > 0 && crossingDay <= 7 && sBest + PRE_C >= S0[0] && sBest + PRE_C <= S0[1],
  `Replicata: take the smoothest path's Dec-31 cumulative (${sBest}) and its 1M crossing.
Expectata: the crossing during Dec 1-7, 2025 and the Dec-31 lifetime in [${S0}], the statements' ranges (the roughness minimum need not hold the crossing; if it does not, the model must add it as a constraint).
Resultata: crossing on Dec ${crossingDay.toFixed(2)}, Dec-31 lifetime ${sBest + PRE_C}.`);

// Bands: California plus half to twice the Las Vegas share, within what the
// statements allow on the lifetime basis.
const band0 = LV.map((l, k) => [CA_LO[k] + 0.5 * l, CA_HI[k] + 2 * l]);
const crossLo = CROSS - 7 / 31 * band0[6][1];
const knotLife = {"2025-11": [crossLo, CROSS], "2025-12": S0};
const life = [[may.kmin + PRE[0], may.kmax + PRE[1]], ...M25.map(m => knotLife[m] ?? [-Infinity, Infinity])];
for (let j = 1; j <= 7; j++) life[j] = [Math.max(life[j][0], life[j - 1][0] + band0[j - 1][0]), Math.min(life[j][1], life[j - 1][1] + band0[j - 1][1])];
for (let j = 7; j > 0; j--) life[j - 1] = [Math.max(life[j - 1][0], life[j][0] - band0[j - 1][1]), Math.min(life[j - 1][1], life[j][1] - band0[j - 1][0])];
assert.ok(life[0][0] === may.kmin + PRE[0] && life[0][1] === may.kmax + PRE[1],
  `Replicata: sweep Zoox's lifetime cumulative band from end-May 2025 through the November and December 2025 knots.
Expectata: May 2025's band, its series band plus the pre-series miles' band, is not narrowed (the early rows keep their running-sum bands).
Resultata: [${life[0]}] vs [${may.kmin + PRE[0]}, ${may.kmax + PRE[1]}].`);
const expected = {};
M25.forEach((m, k) => {
  expected[m] = {
    vmt: want25[k],
    vmin: Math.floor(Math.max(band0[k][0], life[k + 1][0] - life[k][1])),
    vmax: Math.ceil(Math.min(band0[k][1], life[k + 1][1] - life[k][0])),
  };
});

// The earlier shapes, which the bands must hold unless a statement rules one
// out: the 10e2343 rows (crossing about Nov 22, before the Fortune statement
// allows) and the 2026-10-31 reshape (crossing Dec 4, Dec 31 at 1.3M; the
// first fix run, AGENTS.md ledger 2026-11-01).
const SHAPES = {
  "10e2343": [68653, 86733, 109852, 136097, 166865, 204599, 245852],
  "2026-10-31": [40616, 56015, 81014, 111730, 160082, 231013, 338181],
};
const decMin = S0[0] - CROSS; // December at least 1.25M at Dec 31 less 1M at Nov 30
const outside = [];
for (const [name, vals] of Object.entries(SHAPES)) {
  M25.forEach((m, k) => {
    const r = byMonth[m];
    const ruledOut = m === "2025-12" && vals[k] < decMin;
    if (!ruledOut && (vals[k] < r.vmin || vals[k] > r.vmax)) outside.push(`${m} ${name} ${vals[k]} outside [${r.vmin}, ${r.vmax}]`);
  });
}
assert.deepEqual(outside, [],
  `Replicata: compare Zoox's June-December 2025 monthly bands with the two earlier shapes of those months (the 10e2343 rows and the 2026-10-31 reshape).
Expectata: every value inside its month's band unless the statements rule it out (December below ${decMin}).
Resultata: ${outside.join("; ")}.`);
assert.ok(byMonth["2025-12"].vmin >= decMin,
  `Replicata: read Zoox's December 2025 band floor.
Expectata: at least ${decMin} (1.25M at Dec 31 less 1M at Nov 30: the statements' least December).
Resultata: ${byMonth["2025-12"].vmin}.`);

// --- 2026 rows -----------------------------------------------------------------
const lvQ1 = lvQ1Of(sBest);
const lvMiles = {
  "2026-01": lvQ1 * (DAYS["2026-01"] - LV_PAUSE_JAN),
  "2026-02": lvQ1 * DAYS["2026-02"],
  "2026-03": lvQ1 * 24 + lvW2 * 7,
};
const model = m => DMV_FACTOR * caDay(m) * DAYS[m] + (lvMiles[m] ?? lvW2 * DAYS[m]);
for (const m of MONTHS) {
  const vmt = round(model(m), 10000);
  const h = Math.abs(monthMid(m) - winMid(m <= "2026-03" ? Q1 : W2)) / 30.44;
  const sigma = Math.sqrt(0.065 ** 2 + 0.07 ** 2 * h + 0.09 ** 2);
  const sigmaUp = m >= "2026-10" ? Math.sqrt(sigma ** 2 + 0.10 ** 2) : sigma;
  expected[m] = {
    vmt,
    vmin: round(vmt * Math.exp(-1.96 * sigma), 1000),
    vmax: round(vmt * Math.exp(1.96 * sigmaUp), 1000),
  };
}
// The statements' midpoints, as the 2026 rows read them, stay in range.
{
  const mar24 = sBest + PRE_C + caQ1 + lvQ1 * (Q1.days - LV_PAUSE_JAN);
  assert.ok(Math.abs(mar24 - mid(S1)) < 1e-6 && mar24 >= S1[0] && mar24 <= S1[1],
    `Replicata: the lifetime at Mar 24, 2026 on the model (Dec-31 lifetime plus Jan 1-Mar 24's California and Las Vegas miles).
Expectata: ${mid(S1)}, inside "nearly two million" read as [${S1}].
Resultata: ${mar24}.`);
}

// --- Cumulative bands ------------------------------------------------------------
const dayTotal = (m, lv) => DMV_FACTOR * caDay(m) + lv;
const knots = {
  "2025-11": [Math.floor(crossLo - PRE[1]), Math.ceil(CROSS - PRE[0])],
  "2025-12": [Math.floor(S0[0] - PRE[1]), Math.ceil(S0[1] - PRE[0])],
  "2026-03": [
    Math.floor(S1[0] - PRE[1] + 0.7 * 7 * dayTotal("2026-03", lvW2)),
    Math.ceil(S1[1] - PRE[0] + 1.3 * (7 * dayTotal("2026-03", lvQ1) + 7 * dayTotal("2026-03", lvW2))),
  ],
  "2026-07": [Math.floor(S2[0] - PRE[1] - 1.3 * 5 * dayTotal("2026-08", lvW2)), Infinity],
};
const bandOf = m => expected[m] ?? byMonth[m];
const chain = rows.map(() => ({}));
rows.forEach((r, i) => {
  const prev = i === 0 ? {kmin: 0, kmax: 0} : chain[i - 1];
  const [lo, hi] = knots[r.month] ?? [-Infinity, Infinity];
  chain[i] = {kmin: Math.max(prev.kmin + bandOf(r.month).vmin, lo), kmax: Math.min(prev.kmax + bandOf(r.month).vmax, hi)};
});
for (let i = rows.length - 1; i > 0; i--) {
  chain[i - 1].kmin = Math.max(chain[i - 1].kmin, chain[i].kmin - bandOf(rows[i].month).vmax);
  chain[i - 1].kmax = Math.min(chain[i - 1].kmax, chain[i].kmax - bandOf(rows[i].month).vmin);
}
assert.ok(chain[0].kmin - bandOf(rows[0].month).vmax <= 0 && chain[0].kmax - bandOf(rows[0].month).vmin >= 0,
  `Replicata: sweep Zoox's cumulative bands back to the series start.
Expectata: the start stays exactly zero (no knot contradicts the monthly bands).
Resultata: first month's band [${chain[0].kmin}, ${chain[0].kmax}].`);
const iDec = rows.findIndex(r => r.month === "2025-12");
assert.ok(chain[iDec].kmin === knots["2025-12"][0] && chain[iDec].kmax === knots["2025-12"][1],
  `Replicata: sweep Zoox's cumulative bands forward and back through every knot.
Expectata: December 2025's band is the Dec-2025 knot itself (the other knots agree with it).
Resultata: [${chain[iDec].kmin}, ${chain[iDec].kmax}] vs the knot [${knots["2025-12"]}].`);

const mismatches = [];
let cume = 0;
rows.forEach((r, i) => {
  cume += (expected[r.month] ?? r).vmt;
  const want = {...(expected[r.month] ?? {vmt: r.vmt, vmin: r.vmin, vmax: r.vmax}), cume, kmin: chain[i].kmin, kmax: chain[i].kmax};
  for (const k of ["vmt", "vmin", "vmax", "cume", "kmin", "kmax"]) {
    if (r[k] !== want[k]) mismatches.push(`${r.month} ${k}: ${r[k]} (model ${want[k]})`);
  }
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute Zoox's rows from June 2025 (the smooth 2025 path, the 2026 statement-window model, one cumulative sweep) from its statements and California's miles (this file's header; data/README.md, Zoox anchors).
Expectata: each month's miles, band, cumulative and cumulative band equal the model's.
Resultata: ${mismatches.join("; ")}.`);

console.log(`qual pass: Zoox's rows from June 2025 follow the model: the smoothest 2025 path (Dec-31 lifetime ${sBest + PRE_C}, the 1M crossing on Dec ${crossingDay.toFixed(2)}, December ${want25[6]}), bands holding both earlier shapes, the 2026 statement windows (rest ${Math.round(lvQ1)} a day Jan 1-Mar 24, ${Math.round(lvW2)} a day from Mar 25), knots at end-November [${knots["2025-11"]}], end-December [${knots["2025-12"]}] and end-March [${knots["2026-03"]}], a floor at end-July (${knots["2026-07"][0]})`);

import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// Zoox's 2026 rows follow one method (2026-10-27; data/README.md, Zoox
// anchors), which this qual recomputes from its inputs:
//   - Zoox's three cumulative statements (company basis): "approximately 1.3
//     million driverless autonomous miles" at Dec 31, 2025 (letter to NHTSA,
//     Jan 28, 2026), "nearly two million autonomous miles" (Mar 24, 2026) and
//     "more than 3 million miles on public roads" (Aug 5, 2026), read as
//     [1.25M, 1.35M], [1.88M, 2.00M] and [3.00M, 3.20M]. The midpoints give
//     each interval's miles: 640,000 over Jan 1-Mar 24 (83 days) and
//     1,160,000 over Mar 25-Aug 5 (134 days).
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
//   - Cumulative band: a knot at end-March and a floor at end-July, from the
//     March and August statements (each read as of up to a week before its
//     date, less the 40,080 pre-series driverless miles at their own band,
//     30,127.3 to 59,986.6, then carried to the month's end at 0.7x-1.3x the
//     model's daily miles, rounded outward), and the Dec-2025 knot as
//     zoox-vmt-provenance.qual pins it, chained forward with the monthly
//     bands and narrowed back from each. The July bound is a floor only:
//     "more than" sets no ceiling, and Zoox's own "more than one million
//     autonomous miles" of Mar 11, 2026 came when the series stood near 1.84M.

const CPUC = {
  "2026-01": 31996.94, "2026-02": 38162.55, "2026-03": 51137.72,
  "2026-04": 47322.83, "2026-05": 65708.40, "2026-06": 67922.81,
};
const DMV_FACTOR = 1.19;
const GROWTH = 0.05;
const S0 = [1250000, 1350000];
const S1 = [1880000, 2000000];
const S2 = [3000000, 3200000];
const PRE = [20174.2 + 0.5 * 19906.2, 20174.2 + 2 * 19906.2];
const LV_PAUSE_JAN = 5;
// The months the model covers: every zoox row of data/vmt.csv from January
// 2026 on, ghost months included, each with its calendar length. Until
// 2026-10-31 this was a fixed list ending at 2026-10, so the November row each
// release adds went unchecked (audit 2026-10-30, QT-10 and R8).
const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(p => p[0] === "zoox")
  .map(p => ({ month: p[1], vmt: +p[2], cume: +p[3], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7] }));
const MONTHS = rows.map(r => r.month).filter(m => m >= "2026-01");
const nextMonth = m => { const n = +m.slice(0, 4) * 12 + +m.slice(5, 7); return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; };
assert.ok(MONTHS.length > 0 && MONTHS[0] === "2026-01" && MONTHS.every((m, i) => i === 0 || m === nextMonth(MONTHS[i - 1])),
  `Replicata: list data/vmt.csv's zoox months from 2026-01 on.
Expectata: consecutive months starting at 2026-01.
Resultata: ${JSON.stringify(MONTHS)}.`);
const DAYS = Object.fromEntries(MONTHS.map(m => [m, new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()]));
const mid = ([a, b]) => (a + b) / 2;

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
const lvQ1 = (mid(S1) - mid(S0) - caQ1) / (Q1.days - LV_PAUSE_JAN);
const lvW2 = (mid(S2) - mid(S1) - caW2) / W2.days;

const lvMiles = {
  "2026-01": lvQ1 * (DAYS["2026-01"] - LV_PAUSE_JAN),
  "2026-02": lvQ1 * DAYS["2026-02"],
  "2026-03": lvQ1 * 24 + lvW2 * 7,
};
const model = m => DMV_FACTOR * caDay(m) * DAYS[m] + (lvMiles[m] ?? lvW2 * DAYS[m]);
const round = (x, unit) => Math.round(x / unit) * unit;

const expected = {};
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

// Knots: miles a day in the days around each statement, then the statement's
// rounding, as-of slack and pre-series band.
const dayTotal = (m, lv) => DMV_FACTOR * caDay(m) + lv;
const knots = {
  "2026-03": [
    Math.floor(S1[0] - PRE[1] + 0.7 * 7 * dayTotal("2026-03", lvW2)),
    Math.ceil(S1[1] - PRE[0] + 1.3 * (7 * dayTotal("2026-03", lvQ1) + 7 * dayTotal("2026-03", lvW2))),
  ],
  "2026-07": [Math.floor(S2[0] - PRE[1] - 1.3 * 5 * dayTotal("2026-08", lvW2)), Infinity],
};

const dec = rows.find(r => r.month === "2025-12");
assert.ok(dec !== undefined, "Replicata: find zoox 2025-12 in data/vmt.csv. Expectata: present. Resultata: missing.");

// Forward with the monthly bands and the knots, then back from each knot.
const chain = MONTHS.map(() => ({}));
MONTHS.forEach((m, i) => {
  const prev = i === 0 ? { kmin: dec.kmin, kmax: dec.kmax } : chain[i - 1];
  const [lo, hi] = knots[m] ?? [-Infinity, Infinity];
  chain[i] = { kmin: Math.max(prev.kmin + expected[m].vmin, lo), kmax: Math.min(prev.kmax + expected[m].vmax, hi) };
});
for (let i = MONTHS.length - 1; i > 0; i--) {
  chain[i - 1].kmin = Math.max(chain[i - 1].kmin, chain[i].kmin - expected[MONTHS[i]].vmax);
  chain[i - 1].kmax = Math.min(chain[i - 1].kmax, chain[i].kmax - expected[MONTHS[i]].vmin);
}
assert.ok(chain[0].kmin - expected[MONTHS[0]].vmax <= dec.kmin && chain[0].kmax - expected[MONTHS[0]].vmin >= dec.kmax,
  `Replicata: narrow Zoox's 2025-12 cumulative band back from January 2026's.
Expectata: no narrowing needed (the 2026 knots agree with the Dec-2025 knot).
Resultata: January's band [${chain[0].kmin}, ${chain[0].kmax}] would narrow December's [${dec.kmin}, ${dec.kmax}].`);

const mismatches = [];
MONTHS.forEach((m, i) => {
  const r = rows.find(x => x.month === m);
  if (r === undefined) { mismatches.push(`${m}: row missing`); return; }
  const want = { ...expected[m], kmin: chain[i].kmin, kmax: chain[i].kmax };
  for (const k of ["vmt", "vmin", "vmax", "kmin", "kmax"]) {
    if (r[k] !== want[k]) mismatches.push(`${m} ${k}: ${r[k]} (model ${want[k]})`);
  }
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute Zoox's 2026 rows from its statements and CPUC's California miles (this file's header; data/README.md, Zoox anchors).
Expectata: each month's miles, band and cumulative band equal the model's.
Resultata: ${mismatches.join("; ")}.`);

console.log(`qual pass: Zoox's 2026 rows follow the statement-window model (rest ${Math.round(lvQ1)} a day Jan 1-Mar 24, ${Math.round(lvW2)} a day from Mar 25), with a knot at end-March [${knots["2026-03"]}] and a floor at end-July (${knots["2026-07"][0]})`);

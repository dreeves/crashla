import assert from "node:assert/strict";
import fs from "node:fs";

// Tesla's cumulative VMT series must track Tesla's own published cumulative
// series: the "Cumulative Paid Robotaxi Miles" chart in the quarterly update
// decks (Q4-2025 deck p11, Q1-2026 deck p9). The monthly values below were
// vector-extracted from the two PDFs' chart paths; the decks' overlapping
// months (Jun-Dec 2025) agree within ~3k miles, so chart-read precision is
// roughly +/-5k per point. Provenance notes:
//   - Scope is the Texas driverless service only: the Q3-2025 earnings call
//     tracks the Bay Area as a SEPARATE supervised series (Elluswamy: "In the
//     Bay Area, we still have a person in the driver's seat ... we've crossed
//     more than a million miles"), and Aug-2025's ~13k delta is far too small
//     to contain the Bay fleet. (That separate Bay series is also a likely
//     source of stray "Tesla ~1M miles" claims.)
//   - "Paid" reads as fleet service miles incl. deadhead: the same 250k figure
//     is described on the Q3-2025 call as the Austin fleet having "covered
//     more than a quarter million miles", and the trackers' 115 mi/veh/day
//     model equates these disclosures to fleet-wide miles. If "paid" is
//     literally passenger-on-board miles the true total is HIGHER, so the
//     chart value is also a hard floor (kyoom_min stays within read noise).
//   - Known ~10% tension, chart wins: the call's "more than a quarter million"
//     (Oct 22) vs the chart's interpolated ~224k at Oct 22 — verbal rounding.
//   - Q1 deck text "paid Robotaxi miles nearly doubled sequentially" = the
//     QUARTERLY delta ratio: (Mar cume - Dec cume)/(Dec cume - Sep cume) ~ 2.
// This qual exists because the rows were once interpolated from tracker
// guesses between sparse verbal anchors: Aug-2025 sat at 76,498 vs the
// chart's ~20k (3.8x high) and end-Q1-2026 at 1,563,047 vs the chart's
// ~1,717k (9% low, below the disclosed floor).

const rows = fs.readFileSync("data/vmt.csv", "utf8").trim().split("\n").slice(1)
  .map(l => l.split(",", 8))
  .filter(p => p[0] === "tesla")
  .map(p => ({month: p[1], cume: Number(p[3]), kmin: Number(p[4]), kmax: Number(p[5])}));
const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));

// [month, chart value (miles), lo bound, hi bound, hard (band must contain)]
// Bounds are absolute, generous enough for chart-read noise on both our side
// and any future re-extraction, tighter in relative terms as months grow.
const PINS = [
  ["2025-07", 7000,    6800,    10000,   false], // verbal: 7,000 mi @ Jul 23 call
  ["2025-08", 20000,   14000,   28000,   false],
  ["2025-09", 121000,  108000,  134000,  false],
  ["2025-10", 266000,  240000,  292000,  false],
  ["2025-11", 457000,  412000,  503000,  false],
  ["2025-12", 658000,  620000,  700000,  true],
  ["2026-01", 955000,  860000,  1050000, false],
  ["2026-02", 1279000, 1150000, 1410000, false],
  ["2026-03", 1717000, 1630000, 1890000, true],
];

for (const [month, chart, lo, hi, hard] of PINS) {
  const row = byMonth[month];
  assert.ok(row !== undefined,
    `Replicata: look up tesla ${month} in data/vmt.csv.
Expectata: a row exists for every deck-chart month.
Resultata: no such row.`);
  assert.ok(row.cume >= lo && row.cume <= hi,
    `Replicata: compare tesla cumulative VMT at ${month} to Tesla's own deck chart.
Expectata: helmer_cumulative_vmt within [${lo}, ${hi}] (chart reads ~${chart}).
Resultata: ${row.cume}.`);
  if (hard) assert.ok(row.kmin <= chart && chart <= row.kmax,
    `Replicata: check tesla ${month}'s kyoom band against the deck-chart value.
Expectata: the authored cumulative band [kyoom_min, kyoom_max] contains ${chart}.
Resultata: [${row.kmin}, ${row.kmax}].`);
}

// The disclosed series is a floor on total in-scope VMT (deadhead ambiguity is
// one-directional), so the low edge of the cumulative band at the last chart
// month may sit at most ~7% below the chart value (read noise), never at
// "maybe it's really only ~1M" territory.
const mar = byMonth["2026-03"];
assert.ok(mar.kmin >= 1600000,
  `Replicata: read tesla 2026-03 kyoom_min against the 1,717k disclosed floor.
Expectata: kyoom_min >= 1,600,000 (chart value minus read noise; paid miles are a subset of total scope).
Resultata: ${mar.kmin}.`);

// "Paid Robotaxi miles nearly doubled sequentially" (Q1-2026 deck): the
// quarterly deltas must keep that ratio in the neighborhood of 2.
const q4 = byMonth["2025-12"].cume - byMonth["2025-09"].cume;
const q1 = byMonth["2026-03"].cume - byMonth["2025-12"].cume;
assert.ok(q1 / q4 >= 1.6 && q1 / q4 <= 2.4,
  `Replicata: divide the Q1-2026 cumulative delta by the Q4-2025 delta.
Expectata: ratio in [1.6, 2.4] ("nearly doubled sequentially", Q1-2026 deck).
Resultata: ${q1} / ${q4} = ${(q1 / q4).toFixed(2)}.`);

console.log("qual pass: tesla cumulative VMT tracks the deck-chart disclosure series");

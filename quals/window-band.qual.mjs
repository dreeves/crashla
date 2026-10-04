import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { monthlyLagKeys } from "./monthly-lag.mjs";

// The window VMT band (2026-09-04). Summing each month's 95% band edges
// treats the monthly errors as perfectly correlated, which overstates the
// window's spread wherever data/vmt.csv pins the CUMULATIVE more tightly than
// the months (Waymo's hub anchors: the Jun-2025..Mar-2026 total is known to
// ~±3% while every month carries ±25%). The window total is
// cume(end) - cume(start-1), so its band is bounded by
// [kyoom_min(end) - kyoom_max(before), kyoom_max(end) - kyoom_min(before)];
// the app takes the intersection of that difference and the summed month
// bands over the fully received months, then adds the partially received
// months' own thinned bands: the data-through month's (receipt coverage; plus
// the Monthly-track factor for non-five-day metrics) and, for the Monthly
// track, those of the months inside a helmer's extra Monthly-report lag
// (data/slurp.py MONTHLY_ARRIVAL_LAG, since 2026-10-04). This qual recomputes
// that from the CSV for the default window and pins that the anchors
// actually bite for Waymo, Tesla and Zoox.

const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// The partially received months are NHTSA's data-through month (both tracks)
// and the months inside a helmer's Monthly-report lag (the Monthly track),
// derived from the reviewed cutoff constant (as incident-coverage.qual does)
// and slurp.py's lag table, so this qual needs no re-pin when a release
// advances the cutoff.
const dataThroughMonth = vm.runInContext("NHTSA_DATA_THROUGH_DATE", ctx).slice(0, 7);
const lagged = monthlyLagKeys(dataThroughMonth);

const out = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const start = full.months.indexOf(DEFAULT_START_MONTH);
  const series = sliceSeries(full, start, full.months.length - 1);
  const rows = monthlySummaryRows(series);
  const res = {};
  for (const helmer of ADS_HELMERS) {
    const row = rows.find(r => r.helmer === helmer);
    const pts = series.points.map(p => p.helmers[helmer]).filter(p => p !== null);
    const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    const csv = Object.fromEntries(master.map(r => [r.month, r]));
    // From the coverage columns: a month is partially received for the five-day
    // track when its receipt coverage is below 1, for the Monthly track when
    // its receipt or its Monthly-track incident coverage is.
    const short = (r, keys) => keys.some(k => r[k] < 1);
    const receipt = ["coverage", "coverageMin", "coverageMax"], incident = ["incCov", "incCovMin", "incCovMax"];
    const sum = (arr, f) => arr.reduce((s, p) => s + f(p), 0);
    const band = (minOf, maxOf, isPartial) => {
      const fullPts = pts.filter(p => !isPartial(csv[p.month])), partial = pts.filter(p => isPartial(csv[p.month]));
      const before = master.filter(r => r.month < fullPts[0].month).at(-1) || {kyoomMin: 0, kyoomMax: 0};
      const last = master.find(r => r.month === fullPts.at(-1).month);
      return {
        min: Math.max(sum(fullPts, minOf), last.kyoomMin - before.kyoomMax) + sum(partial, minOf),
        max: Math.min(sum(fullPts, maxOf), last.kyoomMax - before.kyoomMin) + sum(partial, maxOf),
        sumMin: sum(pts, minOf), sumMax: sum(pts, maxOf),
        partialMonths: partial.map(p => p.month),
      };
    };
    const expMonthly = band(p => p.vmtMin, p => p.vmtMax, r => short(r, [...receipt, ...incident]));
    const expFiveDay = band(p => p.vmtRawMin, p => p.vmtRawMax, r => short(r, receipt));
    res[helmer] = {
      row: {min: row.vmtMin, best: row.vmtBest, max: row.vmtMax},
      all: {min: row.mpiEstimates.all.vmtMin, max: row.mpiEstimates.all.vmtMax},
      fatality: {min: row.mpiEstimates.fatality.vmtMin, max: row.mpiEstimates.fatality.vmtMax},
      expMonthly, expFiveDay,
      partialMonths: {monthly: expMonthly.partialMonths, fiveDay: expFiveDay.partialMonths},
    };
  }
  return res;
})()`, ctx);

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  const r = out[helmer];
  assert.ok(near(r.row.min, r.expMonthly.min) && near(r.row.max, r.expMonthly.max) &&
    near(r.all.min, r.expMonthly.min) && near(r.all.max, r.expMonthly.max),
    `Replicata: recompute ${helmer}'s default-window Monthly-track VMT band from data/vmt.js (summed month bands ∩ kyoom difference, plus the partially received months' thinned bands).
Expectata: [${r.expMonthly.min}, ${r.expMonthly.max}] for both the summary row and the all-incidents estimate.
Resultata: row [${r.row.min}, ${r.row.max}], all-incidents [${r.all.min}, ${r.all.max}].`);
  assert.ok(near(r.fatality.min, r.expFiveDay.min) && near(r.fatality.max, r.expFiveDay.max),
    `Replicata: recompute ${helmer}'s default-window five-day VMT band (receipt-scaled data-through month, no Monthly-track thinning).
Expectata: [${r.expFiveDay.min}, ${r.expFiveDay.max}].
Resultata: [${r.fatality.min}, ${r.fatality.max}].`);
  assert.ok(r.row.min <= r.row.best && r.row.best <= r.row.max,
    `Replicata: check ${helmer}'s window band brackets its best. Resultata: [${r.row.min}, ${r.row.best}, ${r.row.max}].`);
  const lagMonths = [...lagged].filter(k => k.startsWith(helmer + "|")).map(k => k.slice(helmer.length + 1)).sort();
  assert.equal(JSON.stringify(r.partialMonths), JSON.stringify({monthly: [...lagMonths, dataThroughMonth], fiveDay: [dataThroughMonth]}),
    `Replicata: list ${helmer}'s partially received months in the default window, per track.
Expectata: the Monthly track's are the months inside ${helmer}'s Monthly-report lag (${JSON.stringify(lagMonths)}) and the NHTSA data-through month ${dataThroughMonth}; the five-day track's the data-through month alone.
Resultata: ${JSON.stringify(r.partialMonths)}.`);
}
// The anchors bite: Waymo's hub-pinned cumulative, Tesla's deck-pinned
// cumulative and (since 2026-10-03) Zoox's Dec-2025 knot on its official 1.3M
// disclosure all tighten the window band on BOTH edges vs the plain sum.
for (const helmer of ["Waymo", "Tesla", "Zoox"]) {
  const r = out[helmer];
  assert.ok(r.row.min > r.expMonthly.sumMin && r.row.max < r.expMonthly.sumMax,
    `Replicata: compare ${helmer}'s window band to the plain sum of its month bands.
Expectata: strictly tighter on both edges (sum [${r.expMonthly.sumMin}, ${r.expMonthly.sumMax}]).
Resultata: [${r.row.min}, ${r.row.max}].`);
}
// Waymo: the summed bands ran 0.76x-1.28x of best; the anchors imply ~0.93x-1.12x.
assert.ok(out.Waymo.row.max / out.Waymo.row.min < 1.3,
  `Replicata: Waymo default-window band ratio hi/lo. Expectata: < 1.3 (was 1.68 with summed month bands). Resultata: ${(out.Waymo.row.max / out.Waymo.row.min).toFixed(3)}.`);
console.log(`qual pass: window VMT band = summed month bands ∩ kyoom difference (+ the partially received months' thinned bands); Waymo default window ${(out.Waymo.row.min / 1e6).toFixed(1)}-${(out.Waymo.row.max / 1e6).toFixed(1)}M`);

// --- One month, one posterior (2026-10-03, audit #15) -----------------------
// A one-month window's cards and distribution chart take that month's band
// through the window rule above, which intersects the authored month band
// with the single-month kyoom difference; the MPI-over-time chart drew the
// same month from the authored band alone. Where the kyoom knots are tighter
// than the month band (Tesla 2025-09; Waymo 2025-09..12 and 2026-03 since the
// 2026-09-04 re-anchoring) the page showed two posteriors for one month, e.g.
// Waymo 2025-12 all incidents: card 189,004 (149,304 - 241,728), chart 183.2K
// (124.0K - 262.1K). Every chart point must be its one-month window's card.
const oneMonth = vm.runInContext(`
(() => {
  const full = monthSeriesData();
  const diffs = [];
  let compared = 0;
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  full.months.forEach((month, i) => {
    const rows = monthlySummaryRows(sliceSeries(full, i, i));
    for (const helmer of ADS_HELMERS) {
      const entry = full.points[i].helmers[helmer];
      if (entry === null) continue;
      const row = rows.find(r => r.helmer === helmer);
      for (const m of METRIC_DEFS) {
        const chart = entry.mpiByMetric[m.key];
        if (chart === null) continue;
        const card = row.mpiEstimates[m.key];
        const ci = chart.bands[chart.bands.length - 1];
        compared++;
        const gap = Math.max(rel(chart.mpiMedian, card.postMedian), rel(ci.lo, card.lo), rel(ci.hi, card.hi));
        if (gap > 1e-9) diffs.push({helmer, month, metric: m.key,
          chart: [chart.mpiMedian, ci.lo, ci.hi].map(Math.round), card: [card.postMedian, card.lo, card.hi].map(Math.round)});
      }
    }
  });
  return {compared, diffs};
})()`, ctx);
assert.ok(oneMonth.compared > 1000 && oneMonth.diffs.length === 0,
  `Replicata: for every helmer, month and metric, compare the MPI-over-time chart's posterior (median and 95% CI) with the summary card of a one-month window on that month.
Expectata: identical (one posterior per month on the page); ${oneMonth.compared} pairs compared.
Resultata: ${oneMonth.diffs.length} differ, e.g. ${JSON.stringify(oneMonth.diffs.slice(0, 4))}.`);
console.log(`qual pass: every one of ${oneMonth.compared} per-month chart posteriors equals its one-month window's card`);

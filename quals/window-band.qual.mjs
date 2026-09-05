import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// The window VMT band (2026-09-04). Summing each month's 95% band edges
// treats the monthly errors as perfectly correlated, which overstates the
// window's spread wherever data/vmt.csv pins the CUMULATIVE more tightly than
// the months (Waymo's hub anchors: the Jun-2025..Mar-2026 total is known to
// ~±3% while every month carries ±25%). The window total is
// cume(end) - cume(start-1), so its band is bounded by
// [kyoom_min(end) - kyoom_max(before), kyoom_max(end) - kyoom_min(before)];
// the app takes the intersection of that difference and the summed month
// bands over the fully received months, then adds the data-through month's
// own thinned band (receipt coverage; plus the Monthly-track factor for
// non-five-day metrics). This qual recomputes that from the CSV for the
// default window and pins that the anchors actually bite for Waymo and Tesla.

const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

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
    const fullPts = pts.filter(p => p.coverage === 1), partial = pts.filter(p => p.coverage < 1);
    const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    const before = master.filter(r => r.month < fullPts[0].month).at(-1) || {kyoomMin: 0, kyoomMax: 0};
    const last = master.find(r => r.month === fullPts.at(-1).month);
    const sum = (arr, f) => arr.reduce((s, p) => s + f(p), 0);
    const band = (minOf, maxOf) => ({
      min: Math.max(sum(fullPts, minOf), last.kyoomMin - before.kyoomMax) + sum(partial, minOf),
      max: Math.min(sum(fullPts, maxOf), last.kyoomMax - before.kyoomMin) + sum(partial, maxOf),
      sumMin: sum(pts, minOf), sumMax: sum(pts, maxOf),
    });
    res[helmer] = {
      row: {min: row.vmtMin, best: row.vmtBest, max: row.vmtMax},
      all: {min: row.mpiEstimates.all.vmtMin, max: row.mpiEstimates.all.vmtMax},
      fatality: {min: row.mpiEstimates.fatality.vmtMin, max: row.mpiEstimates.fatality.vmtMax},
      expMonthly: band(p => p.vmtMin, p => p.vmtMax),
      expFiveDay: band(p => p.vmtRawMin, p => p.vmtRawMax),
      partialMonths: partial.map(p => p.month),
    };
  }
  return res;
})()`, ctx);

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  const r = out[helmer];
  assert.ok(near(r.row.min, r.expMonthly.min) && near(r.row.max, r.expMonthly.max) &&
    near(r.all.min, r.expMonthly.min) && near(r.all.max, r.expMonthly.max),
    `Replicata: recompute ${helmer}'s default-window Monthly-track VMT band from data/vmt.js (summed month bands ∩ kyoom difference, plus the data-through month's thinned band).
Expectata: [${r.expMonthly.min}, ${r.expMonthly.max}] for both the summary row and the all-incidents estimate.
Resultata: row [${r.row.min}, ${r.row.max}], all-incidents [${r.all.min}, ${r.all.max}].`);
  assert.ok(near(r.fatality.min, r.expFiveDay.min) && near(r.fatality.max, r.expFiveDay.max),
    `Replicata: recompute ${helmer}'s default-window five-day VMT band (receipt-scaled data-through month, no Monthly-track thinning).
Expectata: [${r.expFiveDay.min}, ${r.expFiveDay.max}].
Resultata: [${r.fatality.min}, ${r.fatality.max}].`);
  assert.ok(r.row.min <= r.row.best && r.row.best <= r.row.max,
    `Replicata: check ${helmer}'s window band brackets its best. Resultata: [${r.row.min}, ${r.row.best}, ${r.row.max}].`);
  assert.equal(JSON.stringify([...r.partialMonths]), JSON.stringify(["2026-07"]),
    `Replicata: list ${helmer}'s partially received months in the default window. Expectata: only the NHTSA data-through month 2026-07. Resultata: ${JSON.stringify(r.partialMonths)}.`);
}
// The anchors bite: Waymo's hub-pinned cumulative and Tesla's deck-pinned
// cumulative both tighten the window band on BOTH edges vs the plain sum.
for (const helmer of ["Waymo", "Tesla"]) {
  const r = out[helmer];
  assert.ok(r.row.min > r.expMonthly.sumMin && r.row.max < r.expMonthly.sumMax,
    `Replicata: compare ${helmer}'s window band to the plain sum of its month bands.
Expectata: strictly tighter on both edges (sum [${r.expMonthly.sumMin}, ${r.expMonthly.sumMax}]).
Resultata: [${r.row.min}, ${r.row.max}].`);
}
// Waymo: the summed bands ran 0.76x-1.28x of best; the anchors imply ~0.93x-1.12x.
assert.ok(out.Waymo.row.max / out.Waymo.row.min < 1.3,
  `Replicata: Waymo default-window band ratio hi/lo. Expectata: < 1.3 (was 1.68 with summed month bands). Resultata: ${(out.Waymo.row.max / out.Waymo.row.min).toFixed(3)}.`);
// Zoox's kyoom band IS its running sum (no anchor tightens it), so the two
// bounds coincide and the band equals the plain sum.
assert.ok(near(out.Zoox.row.min, out.Zoox.expMonthly.sumMin) && near(out.Zoox.row.max, out.Zoox.expMonthly.sumMax),
  `Replicata: compare Zoox's window band to its summed month bands. Expectata: equal (its kyoom band is the running sum). Resultata: [${out.Zoox.row.min}, ${out.Zoox.row.max}] vs [${out.Zoox.expMonthly.sumMin}, ${out.Zoox.expMonthly.sumMax}].`);
console.log(`qual pass: window VMT band = summed month bands ∩ kyoom difference (+ the data-through month's thinned band); Waymo default window ${(out.Waymo.row.min / 1e6).toFixed(1)}-${(out.Waymo.row.max / 1e6).toFixed(1)}M`);

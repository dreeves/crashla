import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// The distribution chart's frame must contain every drawn curve's density
// PEAK, not just its median (2026-09-04). A prior-only (k=0) curve on the
// fatality view has its mode at ~2 x VMT and its median at ~4.4 x VMT; when
// the frame was widened to the medians only, the mode sat off-frame, the
// "Peak" marker degenerated to the frame edge, and its tooltip reported the
// median (11.3M instead of 5.2M for Tesla). Peaks are also refined between
// grid nodes, so the reported value must not depend on the grid.

// escAttr/escHtml escape through an element's textContent -> innerHTML, so the
// stub must implement that (a bare object leaves every tooltip empty).
class ElementStub {
  constructor() { this._html = ""; this._attributes = {}; this.style = {}; this.children = []; }
  set textContent(v) { this._html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  get textContent() { return this._html; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  setAttribute(n, v) { this._attributes[n] = v; }
  getAttribute(n) { return this._attributes[n] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
}
const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return new ElementStub(); }, createElement() { return new ElementStub(); } },
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
  const res = {};
  for (const mk of ["fatality", "atfaultInjury", "atfault"]) {
    selectedMetricKey = mk;
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
    for (const d of ["HumansAV", "Tesla", "Waymo"]) monthHelmerEnabled[d] = true;   // the default toggles
    const rows = monthlySummaryRows(series);
    const curves = rows.filter(r => monthHelmerEnabled[r.helmer] && r.mpiEstimates[mk]).map(r => ({helmer: r.helmer, est: r.mpiEstimates[mk]}));
    const {xMin, xMax} = distributionExtent(curves.map(c => c.est));
    const html = renderDistributionChart(series);
    const peaks = [...html.matchAll(/<circle[^>]*cx="([\\d.]+)"[^>]*data-tip="([^"]*)"/g)]
      .map(m => ({cx: Number(m[1]), text: m[2].split("\\n")[0]})).filter(p => p.text.startsWith("Peak:"));
    const mLeft = 68, svgW = 900, mRight = 16;
    res[mk] = {xMin, xMax, frame: [mLeft, svgW - mRight], peaks, curves: curves.map(c => {
      // true mode: fine log grid over the curve's own extent
      let best = -Infinity, arg = NaN;
      for (let i = 0; i <= 4000; i++) {
        const x = Math.exp(Math.log(c.est.xMin) + (Math.log(c.est.xMax) - Math.log(c.est.xMin)) * i / 4000);
        const y = c.est.densityFn(x); if (y > best) { best = y; arg = x; }
      }
      return {helmer: c.helmer, k: c.est.k, mode: arg, median: c.est.postMedian};
    })};
  }
  return res;
})()`, ctx);

for (const [mk, r] of Object.entries(out)) {
  for (const c of r.curves) {
    assert.ok(c.mode >= r.xMin && c.mode <= r.xMax,
      `Replicata: locate the ${c.helmer} ${mk} curve's density mode (fine grid) and the chart frame.
Expectata: the mode ${c.mode.toExponential(3)} lies inside the frame [${r.xMin.toExponential(3)}, ${r.xMax.toExponential(3)}].
Resultata: off-frame.`);
    if (c.k === 0) assert.ok(c.mode < c.median,
      `Replicata: compare the k=0 ${c.helmer} ${mk} curve's mode and median. Expectata: mode < median (right-skewed prior-only bell). Resultata: mode ${c.mode}, median ${c.median}.`);
  }
  assert.equal(r.peaks.length, r.curves.length,
    `Replicata: count "Peak:" markers on the ${mk} chart. Expectata: ${r.curves.length}. Resultata: ${r.peaks.length}.`);
  const edge = r.peaks.filter(p => Math.abs(p.cx - r.frame[0]) < 0.5 || Math.abs(p.cx - r.frame[1]) < 0.5);
  assert.equal(edge.length, 0,
    `Replicata: check no ${mk} Peak marker sits on the frame edge (${r.frame}).
Expectata: none — an edge peak means the frame cut the curve's mode off.
Resultata: ${JSON.stringify(edge)}.`);
}
console.log("qual pass: distribution-chart frame contains every curve's density peak; k=0 peaks sit left of their medians and off the frame edge");

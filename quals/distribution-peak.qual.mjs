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
    // The plot frame is the clip rect (its right margin follows the tick
    // labels since 2026-10-03, so it is read, not assumed).
    const clip = html.match(/<clipPath id="dist-clip"><rect x="([\\d.]+)" y="[\\d.]+" width="([\\d.]+)"/);
    res[mk] = {xMin, xMax, frame: [Number(clip[1]), Number(clip[1]) + Number(clip[2])], peaks, curves: curves.map(c => {
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

// --- Median markers are on-frame with margin, on every toggle set ---------
// distributionExtent covered each curve's median only with equality, so the
// curve with the largest median could put its Median dot at exactly the
// frame's right edge, where the clip-path cut it to a half-disc (fatality
// with all six helmers, until 2026-09-26). Medians now get the same one-probe
// margin the peaks have.
{
  const medians = vm.runInContext(`
    (() => {
      selectedMetricKey = "fatality";
      for (const d of ALL_HELMERS) monthHelmerEnabled[d] = true;
      const full = monthSeriesData();
      const series = sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH), full.months.length - 1);
      const html = renderDistributionChart(series);
      const clip = html.match(/<clipPath id="dist-clip"><rect x="([\\d.]+)" y="[\\d.]+" width="([\\d.]+)"/);
      return {frame: [Number(clip[1]), Number(clip[1]) + Number(clip[2])],
        medians: [...html.matchAll(/<circle[^>]*cx="([\\d.]+)"[^>]*r="([\\d.]+)"[^>]*data-tip="([^"]*)"/g)]
          .map(m => ({cx: Number(m[1]), r: Number(m[2]), text: m[3].split("\\n")[0]})).filter(p => p.text.startsWith("Median:"))};
    })()`, ctx);
  const [left, right] = medians.frame;
  assert.ok(medians.medians.length >= 6 && medians.medians.every(p => p.cx - p.r > left && p.cx + p.r < right),
    `Replicata: render the fatality distribution with all six helmers on and locate every Median marker.
Expectata: each disc fully inside the frame [${left}, ${right}].
Resultata: ${JSON.stringify(medians.medians.map(p => [p.text, p.cx]))}.`);
}

// --- Every marker drawn whole, every curve drawn from its own samples -------
// (2026-10-03, audit #25, #26, #89.) Three defects of the same render, swept
// over helmer sets x metrics x windows:
//  (a) The y scale topped out at the tallest SAMPLED density while the Peak
//      marker sat at the refined peak above it, and every marker lived inside
//      the plot's clip-path group, so the tallest curve's markers were cut in
//      half at the top in all 680 states that drew a curve (k = 0 markers on
//      the baseline lost their lower half too). Markers now draw outside the
//      clip group, inside the frame, below a margin of headroom.
//  (b) Every curve was sampled on one 250-point grid across the frame, so a
//      narrow band (Humans (US average) on fatality, sigma 0.020 in ln x)
//      became a 3-9 sample spike, and its markers rode above the plot. Each
//      curve now also samples its own extent densely: its bell (density at or
//      above half its height) must carry at least 24 path vertices.
//  (c) The peak was a parabola through three linear density samples, inexact
//      for a log-normal, so a human band's Peak read 87.5M against its
//      Median's 87.4M, though a log-normal's mode is its median. The parabola
//      is now fit to ln(density), which is exact there.
{
  const HALO = 0.75; // half the .month-dot stroke (style.css), drawn outside r
  const sweep = vm.runInContext(`
    (() => {
      const full = monthSeriesData();
      const N = full.months.length, def = full.months.indexOf(DEFAULT_START_MONTH);
      const windows = [[def, N - 1], [0, N - 1], [N - 1, N - 1], [N - 2, N - 1], [0, 5],
        [full.months.indexOf("2025-01"), full.months.indexOf("2025-06")]];
      const sets = [ALL_HELMERS, ["HumansAV", "Tesla", "Waymo"], ["HumansUS", "Tesla", "Zoox"], ["HumansUS"], ["Waymo"]];
      const out = [];
      for (const set of sets) {
        for (const d of ALL_HELMERS) monthHelmerEnabled[d] = set.includes(d);
        for (const mk of METRIC_KEYS) {
          selectedMetricKey = mk;
          for (const [a, b] of windows) out.push({state: set.join("+") + " / " + mk + " / " + full.months[a] + ".." + full.months[b],
            colors: Object.fromEntries(ALL_HELMERS.map(h => [HELMER_COLORS[h], h])),
            html: renderDistributionChart(sliceSeries(full, a, b))});
        }
      }
      return out;
    })()`, ctx);
  const problems = {clipGroup: [], disc: [], top: [], coarse: [], humanPeak: []};
  let markers = 0, curvesSeen = 0;
  for (const {state, html, colors} of sweep) {
    const vb = html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
    const clip = html.match(/<clipPath id="dist-clip"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number);
    const [x0, y0, x1, y1] = [clip[0], clip[1], clip[0] + clip[2], clip[1] + clip[3]];
    const group = html.indexOf('<g clip-path="url(#dist-clip)">');
    const groupEnd = html.indexOf("</g>", group);
    // Each marker is a visible dot (class month-dot, its own style) and,
    // since 2026-10-03 (audit #28), an invisible hit circle carrying its
    // tooltip; the hit circles follow the dots in the same order, so the
    // i-th target is the i-th dot's.
    const dots = [...html.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)" class="month-dot" style="([^"]*)">/g)];
    const tips = [...html.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.]+" fill="none" data-tip="([^"]*)"/g)];
    if (dots.length !== tips.length || dots.some((d, i) => Math.abs(Number(d[1]) - Number(tips[i][1])) > 0.01 || Math.abs(Number(d[2]) - Number(tips[i][2])) > 0.01))
      problems.disc.push(`${state}: ${dots.length} marker dots but ${tips.length} hit circles, or not in step`);
    const circles = dots.map((m, i) => ({at: m.index, cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]),
        color: (m[4].match(/(?:fill|stroke):(#[0-9a-f]{6})(?!.*fill:#)/i) || [])[1], tip: (tips[i] ? tips[i][3] : "").split("\n")}));
    markers += circles.length;
    for (const c of circles) {
      const where = `${state}: ${c.tip[0]} at (${c.cx}, ${c.cy})`;
      if (c.at > group && c.at < groupEnd) problems.clipGroup.push(where);
      if (c.cx - c.r - HALO < 0 || c.cx + c.r + HALO > vb[1] || c.cy - c.r - HALO < 0 || c.cy + c.r + HALO > vb[2]
          || c.cx < x0 || c.cx > x1) problems.disc.push(where);
      if (c.cy - c.r - HALO < y0) problems.top.push(where);
    }
    // human curves carry a "Range:" line, not a "median/peak" line
    for (let i = 0; i + 1 < circles.length; i += 2) {
      const [peak, median] = [circles[i], circles[i + 1]];
      if (peak.tip[1] && peak.tip[1].startsWith("Range:")
          && peak.tip[0].replace("Peak: ", "") !== median.tip[0].replace("Median: ", ""))
        problems.humanPeak.push(`${state}: ${peak.tip[0]} vs ${median.tip[0]}`);
    }
    for (const m of html.matchAll(/<path d="(M [^"]+)" style="stroke:(#[0-9a-f]{6});stroke-width:2;fill:none/gi)) {
      curvesSeen++;
      const ys = m[1].slice(2).split(" L ").map(p => Number(p.split(" ")[1]));
      const top = Math.min(...ys);
      const bell = ys.filter(y => y1 - y >= (y1 - top) / 2).length;
      if (bell < 24) problems.coarse.push(`${state}: ${colors[m[2]] || m[2]} bell drawn from ${bell} vertices`);
    }
  }
  assert.ok(problems.clipGroup.length === 0,
    `Replicata: render the distribution chart in ${sweep.length} states and find each marker relative to the clip-path group.
Expectata: no marker inside the clipped group (it would be cut wherever it meets the frame).
Resultata: ${problems.clipGroup.length} of ${markers} inside it, e.g. ${JSON.stringify(problems.clipGroup.slice(0, 3))}.`);
  assert.ok(problems.top.length === 0,
    `Replicata: render the distribution chart in ${sweep.length} states and compare each marker's disc (r plus the ${HALO} halo) with the plot frame's top.
Expectata: every disc at or below the frame's top edge -- the y scale leaves headroom above the tallest refined peak.
Resultata: ${problems.top.length} of ${markers} reach above it, e.g. ${JSON.stringify(problems.top.slice(0, 3))}.`);
  assert.ok(problems.disc.length === 0,
    `Replicata: render the distribution chart in ${sweep.length} states and locate every marker.
Expectata: each centre inside the frame horizontally and each whole disc inside the SVG.
Resultata: ${JSON.stringify(problems.disc.slice(0, 4))} (${problems.disc.length} in all).`);
  assert.ok(problems.coarse.length === 0,
    `Replicata: render the distribution chart in ${sweep.length} states and count each curve's path vertices at or above half its drawn height.
Expectata: at least 24 for every one of ${curvesSeen} curves -- a smooth bell, not a spike of a few frame-grid samples.
Resultata: ${problems.coarse.length} coarse, e.g. ${JSON.stringify(problems.coarse.slice(0, 4))}.`);
  assert.ok(markers === 2 * curvesSeen,
    `Replicata: render the distribution chart in ${sweep.length} states and count its marker dots against its curves.
Expectata: two markers (Peak and Median) per curve, ${2 * curvesSeen} in all.
Resultata: ${markers}.`);
  assert.ok(problems.humanPeak.length === 0,
    `Replicata: hover each human benchmark curve's Peak and Median markers (all ${sweep.length} states).
Expectata: the same value -- the bands are log-normal, whose mode is its median.
Resultata: ${JSON.stringify(problems.humanPeak.slice(0, 4))} (${problems.humanPeak.length} in all).`);
  console.log(`qual pass: ${markers} distribution markers in ${sweep.length} states drawn whole outside the clip, ${curvesSeen} curves drawn from their own samples, human Peak = Median`);
}

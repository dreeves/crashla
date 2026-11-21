import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// The distribution chart's frame ends where no drawn curve still stands at
// the visibility floor (crashla.js DIST_VIS_FLOOR, a share of the tallest
// drawn peak) or higher: a curve is drawn "only while it clears" that floor,
// so none may be visibly sliced off at an edge (audit finding A3 of
// 2026-11-20). Until 2026-11-21 distributionExtent ended its band AT the last
// point of its coarse probe grid that still cleared the floor, so every frame
// cut some curve at 5% or more of the tallest peak, and a narrow curve, which
// can fall from near half its height to under the floor within one probe
// step, at up to 28% in the windows that end at the newest month (Waymo's
// at-fault curve with every helmer checked from July 2023; Humans (AV cities)
// on fatality in the newest month alone, inside the band's own printed range)
// and 43% in an earlier one (Humans (AV cities) on fatality, January 2024 to
// April 2025). The band now gets the one-probe margin the peaks and medians
// already had. Spec:
//  1. Threshold cases on synthetic curves, apart from the data: at each edge
//     of distributionExtent's frame every curve stands under the floor, and
//     the edge lies no more than a fortieth of the curves' combined extent
//     beyond the point where the last curve crosses the floor (the frame is
//     not widened past its reason: a fortieth is about four of the probe's
//     steps).
//  2. As drawn, in every window that ends at the slider's last month (each
//     start), for every metric, with the default helmers and with every
//     helmer checked, and, with the default helmers, in a grid of the other
//     windows (every sixth start, every fifth end; there the cut ran highest:
//     Humans (AV cities) on fatality at 43% of the tallest peak in
//     2024-01..2025-04): each curve's stroke runs from the frame's left edge
//     to its right edge, and at both its height is under the floor's share
//     of the tallest drawn point (strokes and markers), to the drawing's
//     rounding of its coordinates.
// No figure of the data is pinned: the frames, heights and counts are read
// from each drawing.

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
vm.runInContext(`incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);`, ctx);
const FLOOR = vm.runInContext("DIST_VIS_FLOOR", ctx);
assert.ok(typeof FLOOR === "number" && FLOOR > 0 && FLOOR < 1,
  `Replicata: read crashla.js DIST_VIS_FLOOR. Expectata: a share between 0 and 1. Resultata: ${FLOOR}.`);

// --- 1. Threshold cases on synthetic curves ----------------------------------
// Each case: curves as the chart hands them to distributionExtent (a density
// over ln x, the curve's own extent, its median), built from the app's own
// density functions, and, computed here, the tallest peak and the points
// where the last curve crosses the floor on each side.
{
  const cases = vm.runInContext(`
    (() => {
      const bell = (median, sigma) => ({ densityFn: x => logNormalLogDensity(x, Math.log(median), sigma),
        xMin: median * Math.exp(-3.09 * sigma), xMax: median * Math.exp(3.09 * sigma), postMedian: median });
      // A prior-only curve: the rate's Jeffreys posterior with no incident over v miles.
      const priorOnly = v => ({ densityFn: x => invGammaLogDensity(x, 0.5, v),
        xMin: 1 / gammaquant(0.5, v, 0.999), xMax: 1 / gammaquant(0.5, v, 0.001), postMedian: 1 / gammaquant(0.5, v, 0.5) });
      const sets = {
        "one bell (sigma 0.3 in ln x)": [bell(1e6, 0.3)],
        "a narrow bell (sigma 0.05) over a wide one a tenth as tall (sigma 0.5)": [bell(1e6, 0.05), bell(1e6, 0.5)],
        "one prior-only curve (no incident in a million miles)": [priorOnly(1e6)],
        "a wide bell (sigma 0.4) beside a prior-only curve": [bell(3e5, 0.4), priorOnly(2e6)],
      };
      const out = {};
      for (const [name, curves] of Object.entries(sets)) {
        const { xMin, xMax } = distributionExtent(curves);
        // On a fine grid over the curves' combined extent (20,001 points): the
        // tallest peak, and the outermost points where a curve stands at the
        // floor or higher.
        const lo = Math.log(Math.min(...curves.map(c => c.xMin))), hi = Math.log(Math.max(...curves.map(c => c.xMax)));
        const N = 20000, at = i => lo + (hi - lo) * i / N;
        const top = i => Math.max(...curves.map(c => c.densityFn(Math.exp(at(i)))));
        let peak = 0;
        for (let i = 0; i <= N; i++) peak = Math.max(peak, top(i));
        let first = null, last = null;
        for (let i = 0; i <= N; i++) if (top(i) >= DIST_VIS_FLOOR * peak) { if (first === null) first = at(i); last = at(i); }
        out[name] = { frame: [Math.log(xMin), Math.log(xMax)], crossing: [first, last], extent: hi - lo,
          edges: [xMin, xMax].map(x => Math.max(...curves.map(c => c.densityFn(x))) / peak) };
      }
      return out;
    })()`, ctx);
  const problems = [];
  for (const [name, c] of Object.entries(cases)) {
    const slack = c.extent / 40;
    for (const [side, i, sign] of [["low", 0, -1], ["high", 1, 1]]) {
      if (!(c.edges[i] < FLOOR)) problems.push(`${name}: at the frame's ${side} edge a curve stands at ${(100 * c.edges[i]).toFixed(2)}% of the tallest peak`);
      const beyond = sign * (c.frame[i] - c.crossing[i]);
      if (!(beyond >= 0 && beyond <= slack)) problems.push(`${name}: the frame's ${side} edge lies ${beyond.toFixed(4)} in ln x beyond the last point at the floor, not between 0 and ${slack.toFixed(4)}, a fortieth of the curves' extent`);
    }
  }
  assert.deepEqual(problems, [],
    `Replicata: give distributionExtent synthetic curves (${Object.keys(cases).join("; ")}) and read each frame's two edges.
Expectata: at each edge every curve under DIST_VIS_FLOOR (${FLOOR}) of the tallest peak, and the edge no more than a fortieth of the curves' combined extent beyond the outermost point where a curve stands at the floor.
Resultata: ${problems.length} problems:\n${problems.join("\n")}`);
}

// --- 2. As drawn --------------------------------------------------------------
// A drawing's coordinates are printed to 0.01 of a unit, so a height is known
// to 0.005, the edge's and the tallest point's alike.
const ROUNDING = 0.005 * (1 + FLOOR);
const setup = vm.runInContext(`
  (() => {
    fullMonthSeries = monthSeriesData();
    const defaults = ALL_HELMERS.filter(h => monthHelmerEnabled[h]);
    return { months: fullMonthSeries.months, metrics: METRIC_KEYS, sets: [defaults, ALL_HELMERS], labels: Object.fromEntries(ALL_HELMERS.map(h => [h, helmerLabel(h)])) };
  })()`, ctx);
const setupJson = JSON.parse(JSON.stringify(setup));
assert.ok(setupJson.months.length > 1 && setupJson.metrics.length > 0 && setupJson.sets[0].length > 0 && setupJson.sets[0].length < setupJson.sets[1].length,
  `Replicata: read the slider's months, the metrics and the helmers checked by default. Expectata: several months, a metric, and a default set that is part of the helmers. Resultata: ${JSON.stringify({ months: setupJson.months.length, metrics: setupJson.metrics, sets: setupJson.sets })}.`);
const last = setupJson.months.length - 1;
// The windows, each [start, end, the helmer sets drawn]: every start with the
// slider's last month as its end, both sets; then a grid of the windows that
// end earlier, the default set.
const windows = [];
for (let a = 0; a <= last; a++) windows.push([a, last, setupJson.sets]);
const ending = windows.length;
for (let a = 0; a <= last; a += 6) for (let b = a; b < last; b += 5) windows.push([a, b, [setupJson.sets[0]]]);
const cut = [];
let states = 0, curveStates = 0, worst = 0;
for (const [a, b, sets] of windows) {
  const drawings = JSON.parse(JSON.stringify(vm.runInContext(`
    (() => {
      const series = sliceSeries(fullMonthSeries, ${a}, ${b});
      const saved = { metric: selectedMetricKey, enabled: { ...monthHelmerEnabled } };
      const out = [];
      for (const set of ${JSON.stringify(sets)}) {
        for (const h of ALL_HELMERS) monthHelmerEnabled[h] = set.includes(h);
        for (const mk of METRIC_KEYS) {
          selectedMetricKey = mk;
          const drawn = windowSummaryRows(series).filter(r => monthHelmerEnabled[r.helmer] && r.mpiEstimates[mk]).map(r => r.helmer);
          out.push({ set: set.length, metric: mk, drawn, html: renderDistributionChart(series) });
        }
      }
      selectedMetricKey = saved.metric;
      for (const h of ALL_HELMERS) monthHelmerEnabled[h] = saved.enabled[h];
      return out;
    })()`, ctx)));
  for (const d of drawings) {
    const state = `${setupJson.months[a]}..${setupJson.months[b]}, ${d.metric}, ${d.set} helmers checked`;
    const clip = d.html.match(/<clipPath id="dist-clip"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    const groupAt = d.html.indexOf('<g clip-path="url(#dist-clip)">');
    assert.ok(clip !== null && groupAt >= 0,
      `Replicata: render the distribution chart (${state}) and read its plot frame, the dist-clip clip rect, and the group it clips.
Expectata: both. Resultata: clip rect ${JSON.stringify(clip && clip[0])}, group at ${groupAt}, in ${JSON.stringify(d.html.slice(0, 300))}.`);
    const [x0, y0, w, h] = clip.slice(1).map(Number);
    const baseline = y0 + h;
    const group = d.html.slice(groupAt, d.html.indexOf("</g>", groupAt));
    // The strokes are the group's paths that fill nothing, in the curves' order.
    const strokes = [...group.matchAll(/<path d="([^"]*)" style="([^"]*)"><\/path>/g)].filter(m => /(?:^|;)fill:none(?:;|$)/.test(m[2]))
      .map(m => m[1].replace(/[ML]/g, " ").trim().split(/\s+/).map(Number));
    const dots = [...d.html.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.]+" class="month-dot"/g)].map(m => Number(m[2]));
    assert.ok(strokes.length === d.drawn.length && strokes.every(p => p.length >= 4 && p.length % 2 === 0 && p.every(Number.isFinite)) && dots.length === 2 * strokes.length,
      `Replicata: render the distribution chart (${state}) and read its strokes (the clipped group's unfilled paths) and its markers.
Expectata: a stroke of x y pairs for each drawn curve (${d.drawn.join(", ")}) and two markers for each.
Resultata: ${strokes.length} strokes of ${strokes.map(p => p.length / 2)} points, ${dots.length} markers.`);
    if (strokes.length === 0) continue;
    states++;
    const heights = strokes.map(p => p.filter((_, i) => i % 2 === 1).map(y => baseline - y));
    const tallest = Math.max(...heights.flat(), ...dots.map(y => baseline - y));
    strokes.forEach((p, i) => {
      curveStates++;
      const ends = [[p[0], heights[i][0], x0, "left"], [p[p.length - 2], heights[i][heights[i].length - 1], x0 + w, "right"]];
      for (const [x, height, edge, side] of ends) {
        const share = height / tallest;
        if (share > worst) worst = share;
        if (!(Math.abs(x - edge) <= 0.011)) cut.push(`${state}: ${setupJson.labels[d.drawn[i]]}'s stroke ends at x ${x}, not the frame's ${side} edge ${edge}`);
        if (!(height < FLOOR * tallest + ROUNDING)) cut.push(`${state}: ${setupJson.labels[d.drawn[i]]} stands at ${(100 * share).toFixed(1)}% of the tallest drawn point at the frame's ${side} edge`);
      }
    });
  }
}
assert.ok(windows.length > ending && states >= windows.length && curveStates >= 2 * states,
  `Replicata: draw the distribution chart in every window ending at the slider's last month, for every metric and both helmer sets, and in a grid of the other windows for the default helmers (${windows.length} windows, ${windows.length - ending} of them the grid's).
Expectata: a grid window, a drawing with curves for each window at least, and two curves a drawing or more on average.
Resultata: ${states} drawings with a curve, ${curveStates} curves.`);
assert.equal(cut.length, 0,
  `Replicata: draw the distribution chart in every window that ends at the slider's last month (${setupJson.months[last]}; ${last + 1} starts), for each of the ${setupJson.metrics.length} metrics, with the default helmers (${setupJson.sets[0].map(h => setupJson.labels[h]).join(", ")}) and with every helmer checked, and, with the default helmers, in ${windows.length - ending} of the windows that end earlier (every sixth start, every fifth end); read each curve's stroke at the frame's two edges against the tallest drawn point.
Expectata: every stroke runs from the frame's left edge to its right edge, and stands under DIST_VIS_FLOOR (${100 * FLOOR}%) of the tallest drawn point at both (the floor's comment: a curve is drawn only while it clears that share of the tallest peak).
Resultata: ${cut.length} of ${2 * curveStates} stroke ends in ${states} drawings fail; the first:\n${cut.slice(0, 12).join("\n")}`);

console.log(`qual pass: the distribution chart's frame ends where every curve is under the visibility floor (${100 * FLOOR}% of the tallest peak): 4 synthetic threshold cases, and ${curveStates} drawn curves in ${states} drawings (every window ending ${setupJson.months[last]} x ${setupJson.metrics.length} metrics x 2 helmer sets, and ${windows.length - ending} earlier-ending windows x ${setupJson.metrics.length} metrics with the default helmers), the highest at ${(100 * worst).toFixed(3)}% at an edge as drawn (coordinates rounded to 0.01 of a unit)`);

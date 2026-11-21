import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { MARKUP_TEXT, markLabel } from "./page-text.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this._textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }

  // escHtml() round-trips through textContent->innerHTML, so the stub must escape
  // here or every escAttr()'d data-tip would render empty (and tooltip checks moot).
  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  get textContent() { return this._textContent; }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const node of nodes) node.parentNode = this;
    this.children = [...nodes];
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] || []), fn];
  }

  setAttribute(k, v) { this[k] = v; }

  querySelector() { return new ElementStub("queried"); }

  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// A helmer's row of monthlySummaryRows (rows), read, never assumed: until
// 2026-11-06 a missing row stopped this qual on a TypeError naming nothing.
// <where> says how the rows were built. assert is crashla.js's, which throws
// its message with the details appended.
vm.runInContext(`function summaryRow(rows, helmer, where) {
  const row = rows.find(r => r.helmer === helmer);
  assert(row !== undefined, "Replicata: " + where + " and find " + helmer + "'s row of monthlySummaryRows.\\nExpectata: one, holding the estimates this check reads.\\nResultata: none; the rows are", rows.map(r => r.helmer));
  return row;
}`, ctx);
// The distribution chart's plot frame: the rect in its dist-clip clip path,
// each attribute read on its own (until 2026-11-07 a pattern that also
// required the rect right after the clipPath's tag, with its x, y and width
// in that order, so a template listing them in another order found no
// frame). <where> says how the chart was drawn. assert is crashla.js's.
vm.runInContext(String.raw`function distFrame(html, where) {
  const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const clipPaths = [...html.matchAll(/<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/g)];
  const rects = clipPaths.filter(m => attrsOf(m[1]).id === "dist-clip")
    .flatMap(m => [...m[2].matchAll(/<rect\b([^>]*)>/g)].map(r => attrsOf(r[1])));
  const frame = rects.map(a => ({x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height)}));
  assert(frame.length === 1 && Object.values(frame[0]).every(Number.isFinite), "Replicata: " + where + " and read its plot frame, the rect in its dist-clip clip path, each attribute on its own.\nExpectata: one rect, with a number for each of its x, y, width and height.\nResultata: the dist-clip rects' attributes, and the chart's clip paths:", {rects, clipPaths: clipPaths.map(m => m[0])});
  return frame[0];
}`, ctx);

// --- 1. invGammaLogDensity math correctness ---

const invGammaTests = vm.runInContext(`
(() => {
  const alpha = 10;
  const beta = 1e6;
  const mode = beta / (alpha + 1); // ~90909
  const atMode = invGammaLogDensity(mode, alpha, beta);
  const atTiny = invGammaLogDensity(1, alpha, beta);
  const atHuge = invGammaLogDensity(1e12, alpha, beta);

  // Numerical integration over log-uniform grid
  const nPts = 5000;
  const logMin = Math.log(100);
  const logMax = Math.log(1e9);
  const logStep = (logMax - logMin) / (nPts - 1);
  let integral = 0;
  for (let i = 0; i < nPts; i++) {
    const x = Math.exp(logMin + logStep * i);
    integral += invGammaLogDensity(x, alpha, beta) * logStep;
  }

  return { mode, atMode, atTiny, atHuge, integral };
})()
`, ctx);

assert.ok(
  invGammaTests.atMode > 0,
  `Replicata: evaluate invGammaLogDensity at the mode (beta/(alpha+1)).
Expectata: density is positive at the mode.
Resultata: density was ${invGammaTests.atMode}.`,
);

assert.ok(
  invGammaTests.atTiny < invGammaTests.atMode * 1e-6,
  `Replicata: evaluate invGammaLogDensity at x=1 (far below the mode).
Expectata: density is negligible compared to the mode density.
Resultata: atTiny=${invGammaTests.atTiny}, atMode=${invGammaTests.atMode}.`,
);

assert.ok(
  invGammaTests.atHuge < invGammaTests.atMode * 1e-6,
  `Replicata: evaluate invGammaLogDensity at x=1e12 (far above the mode).
Expectata: density is negligible compared to the mode density.
Resultata: atHuge=${invGammaTests.atHuge}, atMode=${invGammaTests.atMode}.`,
);

assert.ok(
  Math.abs(invGammaTests.integral - 1) < 0.02,
  `Replicata: numerically integrate invGammaLogDensity over log-uniform grid.
Expectata: integral approximates 1 (within 2%).
Resultata: integral was ${invGammaTests.integral}.`,
);

// --- 1b. marginalMpiLogDensity: VMT-band marginalization for the bell ---
// The drawn bell integrates InvGamma(alpha, VMT) over a two-piece log-normal VMT
// prior (mode vmtBest) with [vmtMin, vmtMax] holding exactly 95% of its mass, so it must (i) stay a normalized density,
// (ii) be WIDER (more log-variance) than the point-estimate curve at vmtBest,
// (iii) reduce exactly to invGammaLogDensity when the band is degenerate
// (vmtMin == vmtMax), and (iv) stay PEAKED (no flat-topped mesa) even when a
// narrow sampling bell sits inside a wide band.
const marginTests = vm.runInContext(`
(() => {
  const alpha = 1.5, best = 2e6, lo = 1e6, hi = 4e6; // 0.5x-2x band, alpha for k=1
  const moments = densFn => {
    const nPts = 8000, logMin = Math.log(100), logMax = Math.log(1e10);
    const step = (logMax - logMin) / (nPts - 1);
    let m0 = 0, m1 = 0, m2 = 0;
    for (let i = 0; i < nPts; i++) {
      const u = logMin + step * i;
      const d = densFn(Math.exp(u)) * step;
      m0 += d; m1 += u * d; m2 += u * u * d;
    }
    return { mass: m0, varLog: m2 / m0 - (m1 / m0) ** 2 };
  };
  const point = moments(x => invGammaLogDensity(x, alpha, best));
  const marg = moments(x => marginalMpiLogDensity(x, alpha, lo, best, hi));
  // Degenerate band must match the point density bit-for-bit at sample points.
  const xs = [3e5, 1.3e6, 9e6];
  const degenMatchesPoint = xs.every(x =>
    marginalMpiLogDensity(x, alpha, best, best, best) === invGammaLogDensity(x, alpha, best));
  // Mesa regression: a data-rich helmer (large alpha => narrow sampling bell)
  // against a wide VMT band must stay PEAKED, not a flat-topped plateau (which a
  // log-uniform VMT prior produced). Peak must clearly exceed its shoulders.
  const bigA = 200.5, sig = (Math.log(hi) - Math.log(lo)) / (2 * 1.96);
  const peakX = best / bigA; // approx mode of MPI for large alpha
  const dBig = xx => marginalMpiLogDensity(xx, bigA, lo, best, hi);
  const peaked = dBig(peakX) > 1.1 * dBig(peakX * Math.exp(-sig)) &&
                 dBig(peakX) > 1.1 * dBig(peakX * Math.exp(sig));
  return { point, marg, degenMatchesPoint, peaked };
})()
`, ctx);

assert.ok(
  marginTests.peaked,
  `Replicata: evaluate the VMT-marginal for a large alpha (narrow bell) over a wide band.
Expectata: a smooth peaked bell -- the center density exceeds its shoulders (no flat-topped mesa).
Resultata: marginal was flat across the band center (mesa); check the VMT prior is smooth, not log-uniform.`,
);

assert.ok(
  Math.abs(marginTests.marg.mass - 1) < 0.02,
  `Replicata: numerically integrate marginalMpiLogDensity over a log grid.
Expectata: the VMT-marginal stays a normalized density (integral ~1 within 2%).
Resultata: integral was ${marginTests.marg.mass}.`,
);

assert.ok(
  marginTests.marg.varLog > marginTests.point.varLog,
  `Replicata: compare log-variance of the VMT-marginal bell vs the point-estimate bell at vmtBest.
Expectata: marginalizing over the VMT band widens the bell (more log-variance).
Resultata: marginal varLog=${marginTests.marg.varLog}, point varLog=${marginTests.point.varLog}.`,
);

assert.ok(
  marginTests.degenMatchesPoint,
  `Replicata: evaluate marginalMpiLogDensity with vmtMin == vmtMax == vmtBest.
Expectata: a degenerate band reduces exactly to invGammaLogDensity at vmtBest.
Resultata: degenerate marginal did not equal the point density at all sample points.`,
);

// --- 2. logNormalLogDensity math correctness ---

const logNormalTests = vm.runInContext(`
(() => {
  const mu = Math.log(1e6);
  const sigma = 0.5;
  const atPeak = logNormalLogDensity(1e6, mu, sigma);
  const atPeakExact = logNormalLogDensity(Math.exp(mu), mu, sigma);
  // Symmetry: density at exp(mu - d) should equal density at exp(mu + d)
  const d = 0.7;
  const left = logNormalLogDensity(Math.exp(mu - d), mu, sigma);
  const right = logNormalLogDensity(Math.exp(mu + d), mu, sigma);

  // Numerical integration
  const nPts = 5000;
  const logMin = mu - 5 * sigma;
  const logMax = mu + 5 * sigma;
  const logStep = (logMax - logMin) / (nPts - 1);
  let integral = 0;
  for (let i = 0; i < nPts; i++) {
    const x = Math.exp(logMin + logStep * i);
    integral += logNormalLogDensity(x, mu, sigma) * logStep;
  }

  return { atPeak, atPeakExact, left, right, integral };
})()
`, ctx);

assert.ok(
  logNormalTests.atPeak > 0,
  `Replicata: evaluate logNormalLogDensity at x=1e6 with mu=log(1e6).
Expectata: density is positive at the peak.
Resultata: density was ${logNormalTests.atPeak}.`,
);

assert.ok(
  Math.abs(logNormalTests.left - logNormalTests.right) < 1e-12,
  `Replicata: compare logNormalLogDensity at symmetric points exp(mu-d) and exp(mu+d).
Expectata: density is symmetric in log-space around mu.
Resultata: left=${logNormalTests.left}, right=${logNormalTests.right}.`,
);

assert.ok(
  Math.abs(logNormalTests.integral - 1) < 0.01,
  `Replicata: numerically integrate logNormalLogDensity over +/- 5 sigma.
Expectata: integral approximates 1 (within 1%).
Resultata: integral was ${logNormalTests.integral}.`,
);

// --- 3. Anti-Postel: logNormalLogDensity throws for sigma <= 0 ---

for (const badSigma of [0, -1, -0.5]) {
  let threw = false;
  try {
    vm.runInContext(`logNormalLogDensity(1e6, Math.log(1e6), ${badSigma})`, ctx);
  } catch (e) {
    threw = true;
  }
  assert.ok(
    threw,
    `Replicata: call logNormalLogDensity with sigma=${badSigma}.
Expectata: immediate throw for invalid sigma.
Resultata: no throw.`,
  );
}

// --- 4. renderDistributionChart produces valid SVG ---

vm.runInContext(`
incidents = INCIDENT_DATA;
vmtRows = parseVmtCsv(VMT_CSV_TEXT);
faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
selectedMetricKey = "all";
for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
activeSeries = monthSeriesData();
`, ctx);

const distChart = vm.runInContext(`renderDistributionChart(activeSeries)`, ctx);

assert.ok(
  distChart.includes("<svg"),
  `Replicata: call renderDistributionChart with all metrics and helmers enabled.
Expectata: result contains an SVG element.
Resultata: no <svg found in output.`,
);

assert.ok(
  distChart.includes("dist-clip"),
  `Replicata: call renderDistributionChart with all metrics enabled.
Expectata: SVG includes clip-path id "dist-clip" to constrain curves.
Resultata: "dist-clip" not found in output.`,
);

assert.ok(
  distChart.includes("#d13b2d") &&
    distChart.includes("#2060c0") &&
    distChart.includes("#2a8f57"),
  `Replicata: call renderDistributionChart with all helmers enabled.
Expectata: SVG includes helmer colors (Tesla #d13b2d, Waymo #2060c0, Zoox #2a8f57).
Resultata: one or more helmer colors missing.`,
);

assert.ok(
  distChart.includes("data-tip="),
  `Replicata: call renderDistributionChart with all metrics enabled.
Expectata: SVG includes peak markers with data-tip tooltips.
Resultata: no data-tip attributes found.`,
);

// Legend: one entry per curve; two markers per curve (mode + median), each a
// visible dot plus (since 2026-10-03, audit #28) its own invisible hit circle
// carrying the tooltip.
const legendItemCount = (distChart.match(/month-legend-item/g) || []).length;
const peakMarkerCount = (distChart.match(/<circle[^>]*class="month-dot"/g) || []).length;
const markerTargetCount = (distChart.match(/<circle[^>]*fill="none" data-tip=/g) || []).length;
assert.ok(
  legendItemCount > 0 && peakMarkerCount === 2 * legendItemCount && markerTargetCount === peakMarkerCount,
  `Replicata: call renderDistributionChart and count legend items vs markers and their tooltip targets.
Expectata: two markers (mode + median) per legend entry, one target per marker.
Resultata: ${legendItemCount} legend items, ${peakMarkerCount} markers, ${markerTargetCount} targets.`,
);

// Each chip is labelled with its helmer's label, read from the app (until
// 2026-10-29 spelled out here).
const escText = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const labelOf = helmer => vm.runInContext(`helmerLabel(${JSON.stringify(helmer)})`, ctx);
const chip = (color, helmer) => `month-chip" style="background:${color}"></span>${escText(labelOf(helmer))}`;
for (const [helmer, color] of [
  ["HumansAV", "#c9a800"],
  ["Tesla", "#d13b2d"],
  ["Waymo", "#2060c0"],
  ["Zoox", "#2a8f57"],
]) {
  assert.ok(
    distChart.includes(chip(color, helmer)),
    `Replicata: render the distribution chart with ${helmer} enabled.
Expectata: legend shows a ${color} chip labeled with ${helmer}'s label, ${JSON.stringify(labelOf(helmer))}.
Resultata: chip+label pair not found in output.`,
  );
}

assert.ok(
  !distChart.includes(escText(labelOf("HumansUS"))),
  `Replicata: render the distribution chart with HumansUS disabled (default).
Expectata: legend has no entry for HumansUS (its label, ${JSON.stringify(labelOf("HumansUS"))}).
Resultata: found it in output.`,
);

// The y axis is titled (until 2026-10-29 the title's words were pinned; its
// text read as MARKUP_TEXT since 2026-11-07, so a "<" in it that opens no tag
// is text, as the browser shows it).
assert.ok(
  new RegExp(`<text class="month-label"[^>]*>(?!<\\/text>)${MARKUP_TEXT}<\\/text>`).test(distChart),
  `Replicata: call renderDistributionChart and inspect the y-axis title.
Expectata: a y-axis title (a month-label text) that is not empty.
Resultata: no such title in output.`,
);

assert.ok(
  distChart.includes("fill:#c9a800"),
  `Replicata: call renderDistributionChart with metrics that have human benchmarks.
Expectata: SVG includes gold (fill:#c9a800) human benchmark log-normal curves.
Resultata: human curve color not found in output.`,
);

// The distribution title now lives in the collapsible section header
// (#dist-heading), set by renderWindowedViews — so the title tracks the
// selected metric and active window there, not in the chart body.
const seriousTitle = vm.runInContext(`
(() => {
  selectedMetricKey = "seriousInjury";
  fullMonthSeries = monthSeriesData();
  monthRangeStart = 0; monthRangeEnd = Infinity;
  renderWindowedViews();
  return {
    heading: document.getElementById("dist-heading").textContent,
    chartHtml: document.getElementById("chart-distributions").innerHTML,
    label: METRIC_BY_KEY.seriousInjury.label,
    start: activeSeries.months[0],
    end: activeSeries.months[activeSeries.months.length - 1],
  };
})()
`, ctx);

// The header names the metric by its label (METRIC_DEFS label) and the
// window by its first and last months, in that order. Until 2026-10-29 the
// whole header was pinned to the character.
const headingMonths = heading => heading.match(/\d{4}-\d{2}/g) || [];
assert.ok(
  seriousTitle.heading.includes(seriousTitle.label) &&
    JSON.stringify(headingMonths(seriousTitle.heading)) === JSON.stringify([seriousTitle.start, seriousTitle.end]),
  `Replicata: render the windowed views with the serious-injury metric selected.
Expectata: the section header reuses the exact selected metric label (${JSON.stringify(seriousTitle.label)}) and active date window (${seriousTitle.start} to ${seriousTitle.end}).
Resultata: heading was ${JSON.stringify(seriousTitle.heading)}.`,
);

assert.ok(
  !seriousTitle.chartHtml.includes("<h3>"),
  `Replicata: inspect the distribution chart body after rendering.
Expectata: the title is in the section header, not duplicated as an <h3> in the chart body.
Resultata: chart body was ${JSON.stringify(seriousTitle.chartHtml.slice(0, 120))}.`,
);

const windowEffect = vm.runInContext(`
(() => {
  selectedMetricKey = "all";
  fullMonthSeries = monthSeriesData();
  const fullWaymo = summaryRow(monthlySummaryRows(fullMonthSeries), "Waymo", "build the full history's summary rows (All incidents)").mpiEstimates.all.median;
  monthRangeStart = 0; monthRangeEnd = 5;
  renderWindowedViews();
  const slicedWaymo = summaryRow(monthlySummaryRows(activeSeries), "Waymo", "slice the window to its first six months and build its summary rows (All incidents)").mpiEstimates.all.median;
  return {
    fullWaymo,
    slicedWaymo,
    heading: document.getElementById("dist-heading").textContent,
    label: METRIC_BY_KEY.all.label,
    start: activeSeries.months[0],
    end: activeSeries.months[activeSeries.months.length - 1],
  };
})()
`, ctx);

assert.ok(
  windowEffect.fullWaymo !== windowEffect.slicedWaymo &&
    windowEffect.heading.includes(windowEffect.label) &&
    JSON.stringify(headingMonths(windowEffect.heading)) === JSON.stringify([windowEffect.start, windowEffect.end]),
  `Replicata: compare the all-incident distribution inputs for the full month window vs a sliced month window.
Expectata: narrowing the month window changes the bell-curve inputs and the section header reflects the sliced date range.
Resultata: fullWaymo=${windowEffect.fullWaymo}, slicedWaymo=${windowEffect.slicedWaymo}, heading=${JSON.stringify(windowEffect.heading)}.`,
);

// Edge case: no helmers enabled → empty string
const emptyChart = vm.runInContext(`
(() => {
  for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
  const result = renderDistributionChart(activeSeries);
  for (const d of ALL_HELMERS) monthHelmerEnabled[d] = true;
  return result;
})()
`, ctx);

assert.ok(
  emptyChart === "" || !emptyChart.includes("#d13b2d"),
  `Replicata: call renderDistributionChart with all helmers disabled.
Expectata: returns empty string or SVG without helmer curves.
Resultata: output was ${JSON.stringify(emptyChart.slice(0, 200))}.`,
);

// --- 5. Both top charts share one legend (same markup for the same state) ---

const legendPair = vm.runInContext(`
(() => {
  const grab = html => {
    const hit = /<div class="month-legend">[\\s\\S]*?<\\/div>/.exec(html);
    return hit === null ? null : hit[0];
  };
  return {
    mpiAll: grab(renderAllHelmersMpiChart(activeSeries)),
    dist: grab(renderDistributionChart(activeSeries)),
  };
})()
`, ctx);

assert.ok(
  legendPair.mpiAll !== null && legendPair.mpiAll.includes("month-legend-item"),
  `Replicata: render the cross-helmer MPI chart and extract its legend div.
Expectata: chart contains a non-empty month-legend.
Resultata: legend was ${JSON.stringify(legendPair.mpiAll)}.`,
);

assert.equal(
  legendPair.mpiAll,
  legendPair.dist,
  `Replicata: render both top charts with identical helmer/metric state and extract each legend div.
Expectata: byte-identical legend markup (both come from helmerChipLegend).
Resultata: mpiAll=${JSON.stringify(legendPair.mpiAll)} dist=${JSON.stringify(legendPair.dist)}.`,
);

// --- 6. Every real (helmer × metric) marginal bell is healthy ---
// Exercise the actual app inputs (alpha from 0.6 for Zoox at-fault up to ~1800 for
// Waymo all-incident, each with its real VMT band): every drawn bell must stay a
// normalized density and stay unimodal (no quadrature bumps, no mesa) over its own
// plotted extent. This is the broad regression net behind the unit checks above.
const comboHealth = vm.runInContext(`
(() => {
  for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
  monthRangeStart = 0; monthRangeEnd = Infinity;
  const sr = monthlySummaryRows(monthSeriesData());
  const rows = [];
  for (const mk of METRIC_KEYS) for (const h of ADS_HELMERS) {
    const e = summaryRow(sr, h, "enable every company and build the full history's summary rows").mpiEstimates[mk];
    if (!e || !e.densityFn) continue;
    const n = 8000, L0 = Math.log(1), L1 = Math.log(1e13), st = (L1 - L0) / (n - 1);
    let mass = 0;
    for (let i = 0; i < n; i++) mass += e.densityFn(Math.exp(L0 + st * i)) * st;
    const N2 = 400, a = Math.log(e.xMin), b = Math.log(e.xMax), ys = [];
    for (let i = 0; i < N2; i++) ys.push(e.densityFn(Math.exp(a + (b - a) * i / (N2 - 1))));
    const pk = Math.max(...ys);
    let sc = 0, prev = 0;
    for (let i = 1; i < N2; i++) {
      const dd = ys[i] - ys[i - 1];
      const s = Math.abs(dd) < pk * 1e-6 ? prev : Math.sign(dd);
      if (s !== 0 && s !== prev && prev !== 0) sc++;
      if (s !== 0) prev = s;
    }
    rows.push({ mk, h, mass, signChanges: sc });
  }
  return rows;
})()
`, ctx);

const badMass = comboHealth.filter(r => Math.abs(r.mass - 1) > 0.02);
assert.ok(
  badMass.length === 0,
  `Replicata: integrate every real helmer×metric marginal bell over a wide log grid.
Expectata: each is a normalized density (integral ~1 within 2%).
Resultata: ${JSON.stringify(badMass)}.`,
);
const bumpy = comboHealth.filter(r => r.signChanges > 1);
assert.ok(
  bumpy.length === 0,
  `Replicata: walk every real helmer×metric marginal bell across its plotted extent.
Expectata: a single rise-then-fall (unimodal) -- no quadrature bumps, no flat-topped mesa.
Resultata: ${JSON.stringify(bumpy)}.`,
);

// --- 7. Marker dots sit at the MPI values their own tooltips report ---
// Two dots per curve: "Median" at mapX(postMedian) (the marginal posterior's
// median, the same quantity as the CI) and "Peak" at the sampled density's
// refined argmax. (The old MLE/mpiPoint marker convention was retired
// 2026-06-19; distribution-peak.qual pins that the frame contains every peak.)
// Replicates the chart's own mapX exactly.
const markerCheck = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  monthRangeStart = 0; monthRangeEnd = Infinity;
  const out = {};
  for (const mk of ["atfault", "fatality"]) {              // skewed finite-median + k=0 cases
    selectedMetricKey = mk;
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
    for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
    monthHelmerEnabled.HumansAV = true;
    const series = monthSeriesData();
    const curves = monthlySummaryRows(series)
      .filter(r => monthHelmerEnabled[r.helmer] && r.mpiEstimates[mk]).map(r => r.mpiEstimates[mk]);
    const {xMin, xMax} = distributionExtent(curves); // same visible-band extent the chart uses
    const html = renderDistributionChart(series);
    // The plot frame is the clip rect: since 2026-10-03 its right margin
    // follows the axis labels (axisRightMargin), so it is read, not assumed
    // (and until 2026-11-06 a chart without one stopped here on a TypeError
    // naming nothing; distFrame, above).
    const {x: mLeft, width: pW} = distFrame(html, "render the distribution chart on " + mk + " (every company and Humans (AV cities) on, the full history)");
    const mapX = x => mLeft + (Math.log(x) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin)) * pW;
    const medians = curves.map(e => ({ cx: mapX(e.postMedian), shown: fmtMiles(e.postMedian),
      finite: Number.isFinite(e.postMedian), inCI: e.postMedian >= e.lo && e.postMedian <= e.hi }));
    const circles = [...html.matchAll(/<circle[^>]*cx="([\\d.]+)"[^>]*data-tip="([^"]*)"/g)]
      .map(m => ({ cx: Number(m[1]), tip: m[2], head: m[2].split("\\n")[0] }));
    out[mk] = { nCurves: curves.length, medians, circles,
      frame: [mLeft, mLeft + pW], helmers: ALL_HELMERS.map(h => helmerLabel(h)) };
  }
  return out;
})()
`, ctx);

for (const mk of ["atfault", "fatality"]) {
  const { nCurves, medians, circles, frame, helmers } = markerCheck[mk];
  // Two markers per curve (peak and median), each tip opening "<label>:
  // <value>", none naming a helmer, none using the "≥" bound form, all inside
  // the plot frame. The labels' words are the human's ("Peak" for the S11
  // rename, 2026-08-22) and were pinned here until 2026-10-28, when the human
  // dropped such pins (one went red on each of the human's edits and caught
  // no agent's; the human reviews every diff).
  assert.equal(circles.length, 2 * nCurves,
    `Replicata: render the ${mk} distribution and count markers.
Expectata: two markers (mode + median) per curve = ${2 * nCurves}.
Resultata: ${circles.length}.`);
  for (const c of circles) {
    assert.ok(/^[^:\n]+: \S/.test(c.head),
      `Replicata: read a ${mk} marker tooltip's first line.
Expectata: "<label>: <value>".
Resultata: ${JSON.stringify(c.head)}.`);
    assert.ok(!helmers.some(h => c.tip.includes(h)),
      `Replicata: scan a ${mk} marker tooltip for a helmer name.
Expectata: none — the dot colour identifies the curve.
Resultata: ${JSON.stringify(c.tip)}.`);
    assert.ok(!c.tip.includes("≥"),
      `Replicata: scan ${mk} tooltips for the "≥ lo" bound form. Expectata: none. Resultata: found one.`);
    assert.ok(c.cx >= frame[0] && c.cx <= frame[1],
      `Replicata: check a ${mk} marker is inside the plot frame [${frame}]. Resultata: cx=${c.cx}.`);
  }
  // Each curve's median dot sits exactly at mapX(postMedian), finite and inside the CI.
  for (const m of medians) {
    assert.ok(m.finite && m.inCI,
      `Replicata: check a ${mk} posterior median. Expectata: finite and within [lo,hi]. Resultata: finite=${m.finite} inCI=${m.inCI}.`);
    assert.ok(circles.some(c => c.head.endsWith(`: ${m.shown}`) && Math.abs(c.cx - m.cx) < 0.05),
      `Replicata: find the median dot at mapX(postMedian)=${m.cx.toFixed(2)} in the ${mk} chart.
Expectata: a marker there whose tip reports the median, ${m.shown} (the dot sits at the value it reports).
Resultata: none within 0.05px.`);
  }
}

// --- 8. k=0 (prior-only) curves are de-emphasised: dashed stroke + hollow dots ---
const k0vis = vm.runInContext(`
(() => {
  selectedMetricKey = "fatality";                 // Tesla & Zoox have 0 fatalities
  for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
  for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
  const series = monthSeriesData();
  const k0 = monthlySummaryRows(series).filter(r => monthHelmerEnabled[r.helmer]
    && r.mpiEstimates.fatality && r.mpiEstimates.fatality.k === 0).length;
  const html = renderDistributionChart(series);
  return { k0, dashed: (html.match(/stroke-dasharray/g) || []).length,
    hollow: (html.match(/fill:none;stroke:#/g) || []).length };
})()
`, ctx);
assert.ok(
  k0vis.k0 > 0 && k0vis.dashed === k0vis.k0 && k0vis.hollow === 2 * k0vis.k0,
  `Replicata: render the fatality distribution (some helmers k=0) and count dashed strokes + hollow dots.
Expectata: one dashed stroke and two hollow dots per k=0 curve (${k0vis.k0}).
Resultata: ${k0vis.dashed} dashed, ${k0vis.hollow} hollow.`,
);

// --- 9. No mean: the density functions carry none, and a marker's tooltip
// holds the figures still shown and no other (2026-11-21, audit A35) ---------
// Until 2026-11-21 each marker tooltip also printed the curve's mean (the
// density builders' .mean, crashla.js marginalMpiMean): infinite whenever a
// mixture component has a_K <= 1, which for an at-fault mixture turned on
// whether the 1e-12 trim of the Poisson-binomial weights (MIX_WEIGHT_FLOOR)
// kept the K = 0 component. Waymo's at-fault injuries read "mean ∞" in the
// default window and "mean 15.7M" in full history (15.8M when the audit read
// it), the model's mean being infinite in both. The page's estimate is the
// median everywhere and nothing else read the mean, so the human had it
// dropped (2026-11-21: "ok, 1"). This
// section's earlier form, which found the mean's figures by setting
// densityFn.mean to a sentinel and held them to the drawn curve's own mean,
// went with it (approved by that decision).
// In the default window and in full history, on every metric, with every
// line and human cohort on:
// (a) no estimate's density function carries a mean, and the app defines no
//     marginalMpiMean;
// (b) each marker's tooltip holds the figures still shown: for an ADS curve
//     its peak and its median (the marker's own value and the other
//     marker's), its MLE (infinite with no incident), the two ends of its 95%
//     CI and its count; for a human band the marker's value and the band's
//     two ends. Each is found as a figure, wherever and in whatever words the
//     tooltip puts it: no word, order, line or separator is read. The peak's
//     value is read off the chart, from where its marker is drawn (its cx is
//     printed to two decimals, which sets the tolerance);
// (c) and no other figure that differs from curve to curve: what a tooltip
//     holds beyond those is the same on every ADS curve's markers of a
//     drawing (figures of the page's own words: its interval's level, a
//     count's note), and the same on every human band's; and none of it is
//     the infinite value's glyph (a mean printed as "∞" on every curve of a
//     drawing would be the same on each).
// How the marker tooltips print an infinite value (crashla.js's infOr in
// renderDistributionChart): the MLE of a curve with no incident.
const INF = "∞";
const noMean = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  const full = monthSeriesData();
  const windows = [["the default window", sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH), full.months.length - 1)], ["the full history", full]];
  // The tooltip targets (hitCircles), each attribute read on its own.
  const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const out = {meanDefined: typeof marginalMpiMean, drawings: []};
  for (const [name, series] of windows) for (const mk of METRIC_KEYS) {
    selectedMetricKey = mk;
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = true;
    const where = "open " + name + " with every line and human cohort on and draw the distribution chart on " + mk;
    // The estimates the chart draws: those windowSummaryRows keeps for the
    // series (renderDistributionChart reads them there).
    const rows = windowSummaryRows(series).filter(r => r.mpiEstimates[mk]);
    const {xMin, xMax} = distributionExtent(rows.map(r => r.mpiEstimates[mk]));
    const html = renderDistributionChart(series);
    const {x: mLeft, width: pW} = distFrame(html, where);
    out.drawings.push({where, mLeft, pW, logMin: Math.log(xMin), logMax: Math.log(xMax),
      targets: [...html.matchAll(/<circle\\b([^>]*)>/g)].map(m => attrsOf(m[1])).filter(a => "data-tip" in a)
        .map(a => ({cx: Number(a.cx), tip: a["data-tip"], name: a["aria-label"]})),
      labels: ALL_HELMERS.map(h => escAttr(helmerLabel(h))),
      curves: rows.map(r => {
        const e = r.mpiEstimates[mk];
        return {label: escAttr(helmerLabel(r.helmer)), ads: e.k !== null, carriesMean: "mean" in e.densityFn, median: e.postMedian,
          // The values still shown, as the page prints each (the peak aside,
          // read off the chart): an ADS curve's median, MLE (null where
          // infinite), CI ends and count; a human band's two ends.
          shown: e.k !== null
            ? [fmtMiles(e.postMedian), Number.isFinite(e.median) ? fmtMiles(e.median) : null, fmtMiles(e.lo), fmtMiles(e.hi), splur(e.k, "incident")]
            : [fmtMiles(e.lo), fmtMiles(e.hi)]};
      })});
  }
  return out;
})()`, ctx);
// A figure as the tooltips print one: fmtMiles' number (whole numbers under
// 1,000 with a thousands comma, as "1,000"), with its unit letter if it has
// one, a count ("1,365", "297.3"), or the infinite value's glyph.
const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const FIGURE = new RegExp(`${INF}|${NUM}[KMBT]?`, "g");
const figuresOf = text => [...text.matchAll(FIGURE)].map(m => m[0]);
const UNIT = {"": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12};
// A finite figure: its value, and half a unit of its last printed digit, the
// most its rounding moves it.
const finiteFigure = s => {
  const m = new RegExp(`^(${NUM})([KMBT]?)$`).exec(s);
  assert.ok(m !== null,
    `Replicata: read the tooltip figure ${JSON.stringify(s)} as fmtMiles prints one.
Expectata: digits (a thousands comma group or a decimal part), then an optional unit letter K, M, B or T.
Resultata: no match.`);
  const digits = m[1].replace(/,/g, "");
  const decimals = `${digits}.`.split(".")[1].length;
  return {value: Number(digits) * UNIT[m[2]], half: 0.5 * UNIT[m[2]] * 10 ** -decimals};
};
// Whether a finite figure prints a value read to a relative precision of
// <slack>: within half a unit of its last printed digit, and that slack.
const prints = (f, value, slack) => f !== INF && Math.abs(finiteFigure(f).value - value) <= finiteFigure(f).half * 1.001 + slack * value;
const noMeanProblems = [];
if (noMean.meanDefined !== "undefined") noMeanProblems.push(`(a) crashla.js defines marginalMpiMean (${noMean.meanDefined})`);
let markersRead = 0, adsCurvesRead = 0;
for (const d of noMean.drawings) {
  // (a)
  noMeanProblems.push(...d.curves.filter(c => c.carriesMean).map(c => `(a) ${d.where}: ${c.label}'s density function carries a mean`));
  const mapX = x => d.mLeft + (Math.log(x) - d.logMin) / (d.logMax - d.logMin) * d.pW;
  // A value read off a marker's cx, printed to two decimals: its relative
  // precision.
  const slack = 0.0051 * (d.logMax - d.logMin) / d.pW;
  const beyond = {true: [], false: []};
  for (const c of d.curves) {
    // The curve's markers: the targets whose name carries its label beside
    // their tip, in any words (markLabel).
    const markers = d.targets.filter(t => markLabel(t.name, t.tip, d.labels) === c.label);
    if (markers.length === 0) { noMeanProblems.push(`(b) ${d.where}: no marker is named for ${c.label}`); continue; }
    adsCurvesRead += Number(c.ads);
    // The peak, read where its marker is drawn: the curve's marker farthest
    // from its median's place (a human band's markers both sit on its median).
    const atPeak = markers.reduce((far, t) => Math.abs(t.cx - mapX(c.median)) > Math.abs(far.cx - mapX(c.median)) ? t : far);
    const peak = Math.exp(d.logMin + (atPeak.cx - d.mLeft) / d.pW * (d.logMax - d.logMin));
    for (const t of markers) {
      markersRead++;
      const left = figuresOf(t.tip);
      // (b) Each value still shown is among the tooltip's figures: taken out,
      // one occurrence each, it leaves what the tooltip holds beyond them.
      const missing = [];
      for (const shown of c.shown.flatMap(s => s === null ? [INF] : figuresOf(s))) {
        const at = left.indexOf(shown);
        if (at < 0) missing.push(shown); else left.splice(at, 1);
      }
      const atValue = left.findIndex(f => prints(f, peak, slack));
      if (atValue < 0) missing.push(`its peak, about ${Math.round(peak)}`); else left.splice(atValue, 1);
      if (missing.length > 0) noMeanProblems.push(`(b) ${d.where}: a marker of ${c.label} (${JSON.stringify(t.tip)}) does not print ${missing.join(", ")}`);
      beyond[c.ads].push({label: c.label, figures: left.sort().join(" ")});
    }
  }
  // (c)
  for (const [ads, kind] of [[true, "ADS curves'"], [false, "human bands'"]]) {
    const sets = [...new Set(beyond[ads].map(b => b.figures))];
    if (sets.length > 1) noMeanProblems.push(`(c) ${d.where}: beyond the values still shown, the ${kind} markers hold figures that differ from curve to curve: ${JSON.stringify(Object.fromEntries(beyond[ads].map(b => [b.label, b.figures])))}`);
    if (sets.some(s => s.includes(INF))) noMeanProblems.push(`(c) ${d.where}: beyond the values still shown, the ${kind} markers hold ${JSON.stringify(sets)}, an infinite value among them`);
  }
}
assert.ok(noMean.drawings.length >= 2 && adsCurvesRead >= 2 * noMean.drawings.length && markersRead >= 4 * noMean.drawings.length && noMeanProblems.length === 0,
  `Replicata: open the default window, then the full history, with every line and human cohort on; on every metric read each estimate's density function, draw the distribution chart and read every marker's tooltip as figures (wherever and in whatever words it holds them).
Expectata: (a) no density function carries a mean, and crashla.js defines no marginalMpiMean; (b) each ADS marker's tooltip holds its curve's peak (as drawn: the value at its Peak marker's place) and median, its MLE ("${INF}" with no incident), both ends of its 95% CI and its count, and each human marker's its value and its band's two ends; (c) beyond those, every ADS marker of a drawing holds the same figures (the page's own words'), every human marker likewise, and none of them "${INF}": no mean, and no other value of the curve.
Resultata: ${noMean.drawings.length} drawings, ${adsCurvesRead} ADS curves and ${markersRead} markers read; ${noMeanProblems.length} problems:
${noMeanProblems.slice(0, 12).join("\n")}${noMeanProblems.length > 12 ? `\n... ${noMeanProblems.length - 12} more` : ""}`);

console.log(`qual pass: distribution chart renders inverse-gamma and log-normal density curves (${comboHealth.length} marginal bells healthy; over ${noMean.drawings.length} drawings no density function carries a mean, and each of ${markersRead} marker tooltips holds the figures still shown, its curve's peak, median, MLE, interval and count, and beyond them only what every curve's holds)`);

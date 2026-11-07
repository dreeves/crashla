import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { MARKUP_TEXT } from "./page-text.mjs";

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

// --- 9. The tooltip's mean is the drawn curve's mean (2026-10-03, audit #14) --
// The marker tooltips list the curve's peak, median, mean and MLE. The peak,
// median and CI come from the plotted, VMT-marginalized posterior; the mean
// was its value at the best-estimate VMT alone, sum_K w_K vmtBest/(a_K - 1),
// so a right-skewed curve printed mean < peak < median (Tesla all incidents:
// 'mean 121.1K' for a drawn curve whose mean is 130.7K). Each ADS curve's mean
// must be the integral of x over its own drawn density -- computed here
// numerically, independent of the app's formula -- and infinite exactly when
// a mixture component has a_K <= 1. Every metric is read (until 2026-11-07
// six were; at-fault injury adds Waymo's and Zoox's curves, whose infinite
// mean sits beside a finite MLE).
// The mean's figures on a tooltip are found by perturbation: each company's
// densityFn.mean, the value renderDistributionChart prints as the mean, is
// set to a sentinel and the chart drawn again; the figures of a marker's
// tooltip that the sentinel then takes over are the mean's, wherever and
// however the tooltip places them, and in the normal drawing each must print
// the drawn curve's mean, or "∞". The Median marker must hold at least one;
// the curve's other markers (its Peak marker) may hold none, but any they
// hold must print the mean too. No word, order, line or separator is read.
// The sentinels, one for each company, are over 90 trillion miles, far above
// any figure the chart prints, and distinct, so the figures found on a
// curve's tooltip are its own mean's.
// History: until 2026-10-29 the mean was read after the tooltip's word
// "mean"; until 2026-11-04 a tooltip without that part read as a mean of
// ""; until 2026-11-06 it was the second of the second line's
// " · "-separated parts (an edit of that separator in crashla.js turned
// this qual red), then, the same day, the second figure on that line (a
// reordering of the line did); until 2026-11-07 it was a figure on that line
// that printed the mean, then, the same day, one on any line after the
// first, each found by its value alone, and then the figures the sentinel
// took over on the Median marker's lines after its first (so a mean printed
// on the first line was red, and a wrong mean on the Peak marker alone
// passed, which the package start's reading by position had caught).
// That let a wrong mean pass wherever another figure printed like the right
// one (Waymo's at-fault, injury and airbag curves: their peak, and on injury
// the MLE too), and a finite figure printed for an infinite mean pass on a
// curve with no incident, whose MLE's "∞" was there. Taking the peak's and
// the MLE's figures out first (a review's proposal, 2026-11-06) would have
// turned it red when an edit dropped the peak from the line: the peak and
// the mean both print 2.2M on Waymo's at-fault curve, so the peak's figure
// taken out is the mean's.
// Not read: the word that labels the figure. So a tooltip that prints the
// mean's value under another value's word, and that value under the mean's,
// passes: a check blind to the words cannot tell a swap of two values' words
// from a reordering of the line (the two print the same figures in the same
// order), and they are words the human might edit (2026-10-28: a qual reads
// such a label from an app constant, and there is none for these).
// What it relies on, each a coupling that a correct change of the app could
// break (each then fails with a message naming it):
// - the chart prints the mean from the estimates that windowSummaryRows
//   keeps for the series, their densityFn.mean. If the mean comes to be
//   computed or copied elsewhere, no figure takes the sentinel, and the
//   message says to perturb that source instead;
// - densityFn.mean is a property that can be redefined (configurable, as a
//   value or an accessor): a frozen or non-configurable one is named by an
//   assert;
// - the drawing takes any value for the mean. The sentinels are finite, so
//   on a curve with a component a_K <= 1 they contradict the model (its mean
//   is infinite): an app check that rejects a finite mean there, true to the
//   model, stops the perturbed drawing, and the error is named as this
//   check's, with the sentinels. A curve's infinite mean cannot be perturbed
//   without leaving the model, so this coupling stays.
// How the marker tooltips print an infinite value (crashla.js's infOr in
// renderDistributionChart), the mean of a curve with a component a_K <= 1.
const INF = "∞";
const meanCheck = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  const full = monthSeriesData();
  const series = sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH), full.months.length - 1);
  const where = mk => "open the default window with Humans (AV cities), Tesla, Waymo and Zoox on and draw the distribution chart on " + mk;
  // Each company's sentinel: distinct, and over 90 trillion miles.
  const sentinel = h => (91.1 + 1.1 * ADS_HELMERS.indexOf(h)) * 1e12;
  // The tooltip targets (hitCircles), each attribute read on its own.
  const attrsOf = tag => Object.fromEntries([...tag.matchAll(/([\\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const out = [];
  for (const mk of METRIC_DEFS.map(m => m.key)) {
    selectedMetricKey = mk;
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = ["HumansAV", "Tesla", "Waymo", "Zoox"].includes(d);
    // The estimates the chart draws: those windowSummaryRows keeps for the
    // series (renderDistributionChart reads them there).
    const rows = windowSummaryRows(series);
    const ests = ADS_HELMERS.map(h => summaryRow(rows, h, where(mk)).mpiEstimates[mk]);
    assert(ests.every(e => e !== null && e !== undefined), "Replicata: " + where(mk) + " and read each company's estimate in its summary row.\\nExpectata: one for each company (each has miles in the window).\\nResultata:", Object.fromEntries(ADS_HELMERS.map((h, i) => [h, String(ests[i] && "an estimate")])));
    // The chart's mapX, replicated as section 7 does: its frame from the
    // dist-clip rect, its extent from distributionExtent over the drawn curves.
    const curves = rows.filter(r => monthHelmerEnabled[r.helmer] && r.mpiEstimates[mk]).map(r => r.mpiEstimates[mk]);
    const {xMin, xMax} = distributionExtent(curves);
    // One drawing's markers for each company: the targets named for it
    // (seriesMarkName), each with its tooltip and its distance from the
    // median's place on the chart, read below.
    const draw = () => {
      const html = renderDistributionChart(series);
      const {x: mLeft, width: pW} = distFrame(html, where(mk));
      const mapX = x => mLeft + (Math.log(x) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin)) * pW;
      const targets = [...html.matchAll(/<circle\\b([^>]*)>/g)].map(m => attrsOf(m[1])).filter(a => "data-tip" in a)
        .map(a => ({cx: Number(a.cx), tip: a["data-tip"], name: a["aria-label"]}));
      return ADS_HELMERS.map((h, i) => targets.filter(t => t.name === escAttr(seriesMarkName(h, "")) + t.tip)
        .map(t => ({tip: t.tip, dx: t.cx - mapX(ests[i].postMedian)})));
    };
    const normal = draw();
    // Each sentinel is set through the property's descriptor, saved first and
    // restored after, then read back, so a mean held as an accessor or a
    // read-only value is perturbed too, and one that cannot be redefined is
    // named (until 2026-11-07 a plain assignment, which a getter silently
    // ignored: every curve then failed with a false diagnosis).
    const saved = ests.map(e => Object.getOwnPropertyDescriptor(e.densityFn, "mean"));
    assert(saved.every(d => d !== undefined && d.configurable), "Replicata: " + where(mk) + " and read each company's densityFn.mean property, to set it to a sentinel.\\nExpectata: a property that can be redefined (configurable).\\nResultata: the descriptors", Object.fromEntries(ADS_HELMERS.map((h, i) => [h, saved[i] === undefined ? "absent" : {configurable: saved[i].configurable, writable: saved[i].writable, accessor: "get" in saved[i]}])));
    ests.forEach((e, i) => Object.defineProperty(e.densityFn, "mean", {value: sentinel(ADS_HELMERS[i]), writable: true, configurable: true, enumerable: true}));
    assert(ests.every((e, i) => e.densityFn.mean === sentinel(ADS_HELMERS[i])), "Replicata: " + where(mk) + " and set each company's densityFn.mean to its sentinel.\\nExpectata: each reads back as its sentinel.\\nResultata:", ests.map(e => e.densityFn.mean));
    // The perturbed drawing; an error from it is named as this check's, with
    // the sentinels it was drawn with (an app check that rejects a finite
    // mean on a curve with a_K <= 1, true to the model, stops it here).
    let perturbed;
    try {
      perturbed = draw();
    } catch (err) {
      throw new Error("Replicata: " + where(mk) + ", then draw it again with each company's densityFn.mean set to its sentinel " + JSON.stringify(Object.fromEntries(ADS_HELMERS.map(h => [h, fmtMiles(sentinel(h))]))) + ".\\nExpectata: the chart draws, printing the sentinel where it printed the mean (this check relies on the drawing taking any value for the mean: see 'What it relies on').\\nResultata: it threw: " + err.message);
    } finally {
      ests.forEach((e, i) => Object.defineProperty(e.densityFn, "mean", saved[i]));
    }
    ADS_HELMERS.forEach((h, i) => {
      const e = ests[i];
      const aMin = Math.min(...e.comps.map(c => c.a));
      // numeric mean of the drawn density (w.r.t. ln x): wide fine grid
      let m0 = 0, m1 = 0;
      const lo = Math.log(e.postMedian) - 9, hi = Math.log(e.postMedian) + 9, n = 40000, st = (hi - lo) / (n - 1);
      for (let j = 0; j < n; j++) { const x = Math.exp(lo + st * j), d = e.densityFn(x); m0 += d; m1 += x * d; }
      out.push({mk, h, normal: normal[i], perturbed: perturbed[i], sentinel: sentinel(h), sentinelShown: fmtMiles(sentinel(h)),
        aMin, numeric: m1 / m0, median: e.postMedian});
    });
  }
  return out;
})()`, ctx);
const meanProblems = [];
// A figure as the tooltips print one: fmtMiles' number (whole numbers under
// 1,000 with a thousands comma, as "1,000"), with its unit letter if it has
// one, or the infinite value's glyph.
const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const FIGURE = new RegExp(`${INF}|${NUM}[KMBT]?`, "g");
const figuresOf = line => [...line.matchAll(FIGURE)].map(m => m[0]);
const UNIT = {"": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12};
// A finite figure: its value, and half a unit of its last printed digit, the
// most its rounding moves it (until 2026-11-07 every figure was taken to print
// one decimal of its unit, so a plain "523" or "1,000" was allowed a tenth of
// that; until 2026-11-06 a "T" figure read as NaN, which no tolerance check
// below could fail).
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
// Whether a finite figure prints a value: within half a unit of its last
// printed digit.
const prints = (f, value) => f !== INF && Math.abs(finiteFigure(f).value - value) <= finiteFigure(f).half * 1.001;
for (const r of meanCheck) {
  // The curve's markers (named for it), paired across the two drawings in
  // drawing order: the perturbation moves no marker, so each drawing holds
  // as many.
  assert.ok(r.normal.length >= 1 && r.perturbed.length === r.normal.length,
    `Replicata: open the default window with Humans (AV cities), Tesla, Waymo and Zoox on, draw the distribution chart on ${r.mk}, then draw it again with ${r.h}'s densityFn.mean set to ${r.sentinelShown}, and in each drawing find ${r.h}'s markers (the tooltip targets named for it).
Expectata: at least one in the first drawing, and as many in the second.
Resultata: ${r.normal.length} and ${r.perturbed.length}.`);
  // The Median marker in each drawing: the curve's marker at the median's
  // place on the chart, mapX(postMedian) to 0.05 px, as section 7 finds it:
  // by the value it reports, not by its words or separators (until
  // 2026-11-06 the text after its ": "; then until 2026-11-07 the first
  // marker whose tooltip's first line held the median's figure, which, on a
  // curve whose peak prints like its median, was the Peak marker). Two only
  // if the peak sits there too. Its other markers (the Peak marker) are read
  // too, below.
  const atMedian = ts => ts.filter(t => Math.abs(t.dx) < 0.05).map(t => t.tip);
  const [normal, perturbed] = [r.normal, r.perturbed].map(atMedian);
  assert.ok(normal.length >= 1 && perturbed.length === normal.length,
    `Replicata: open the default window with Humans (AV cities), Tesla, Waymo and Zoox on, draw the distribution chart on ${r.mk}, then draw it again with ${r.h}'s densityFn.mean set to ${r.sentinelShown}, and in each drawing find ${r.h}'s Median marker: of its markers (named for it), one at the median's place, mapX(postMedian) to 0.05 px.
Expectata: one in each drawing (two only where the curve's peak sits there too), as many in the second as in the first.
Resultata: ${normal.length} and ${perturbed.length}; the markers' distances from that place: ${JSON.stringify(r.normal.map(t => t.dx))} and ${JSON.stringify(r.perturbed.map(t => t.dx))}.`);
  // The mean: "∞" for an infinite one, else a figure that prints the drawn
  // curve's (a mean with 1 < a_K <= 3 is not checked).
  const isMean = r.aMin <= 1 ? f => f === INF : f => prints(f, r.numeric);
  if (r.aMin <= 1 || r.aMin > 3) {
    // A marker's tooltip in the two drawings: the figures the perturbation
    // moves, those that differ between the drawings at the same place among
    // the tooltip's figures (null if the two hold different numbers of
    // figures). Each must be the mean: in the perturbed drawing it prints the
    // curve's own sentinel (not a transform of it, nor another company's),
    // and in the normal one the drawn curve's mean. The whole tooltip is read
    // (until 2026-11-07 its first line was set aside, so a tooltip printing
    // the mean there was red; the marker's own value on that line never
    // moves).
    const pairOf = (tip, tipPerturbed) => {
      const a = figuresOf(tip), b = figuresOf(tipPerturbed);
      const moved = a.length === b.length ? [...b.keys()].filter(j => b[j] !== a[j]) : null;
      return {normal: a, perturbed: b, moved: moved === null ? null : moved.map(j => [a[j], b[j]])};
    };
    const isTheMean = p => p.moved !== null && p.moved.every(([f, fp]) => prints(fp, r.sentinel) && isMean(f));
    const wantMean = r.aMin <= 1 ? `is infinite (a component has a_K = ${r.aMin}), "${INF}"` : `is the drawn curve's, ${Math.round(r.numeric)}, to within half a unit of the figure's last digit (median ${Math.round(r.median)})`;
    // The Median marker must print the mean, at one place or more.
    const pairs = normal.map((tip, i) => pairOf(tip, perturbed[i]));
    if (!pairs.some(p => isTheMean(p) && p.moved.length >= 1))
      meanProblems.push(`${r.h} ${r.mk}, its Median marker (its sentinel ${r.sentinelShown}): ${JSON.stringify(pairs)}; the mean ${wantMean}`);
    // The curve's other markers (its Peak marker) need not print the mean,
    // but any figure on them that the perturbation moves must be it (until
    // 2026-11-07 they were not read, so a wrong mean on the Peak marker
    // alone passed).
    const others = r.normal.map((t, i) => [t, r.perturbed[i]]).filter(([t]) => Math.abs(t.dx) >= 0.05).map(([t, tp]) => pairOf(t.tip, tp.tip));
    if (!others.every(isTheMean))
      meanProblems.push(`${r.h} ${r.mk}, its other markers (its sentinel ${r.sentinelShown}): ${JSON.stringify(others)}; the mean ${wantMean}`);
  }
}
const finiteChecked = meanCheck.filter(r => r.aMin > 3).length;
assert.ok(finiteChecked >= 6 && meanProblems.length === 0,
  `Replicata: open the default window with Humans (AV cities), Tesla, Waymo and Zoox on; on every metric, draw the distribution chart, then draw it again with each company's densityFn.mean (on the estimates windowSummaryRows keeps for the series, which the chart draws) set to a sentinel over 90 trillion miles, one for each company; in both drawings hover each ADS curve's markers.
Expectata: on each marker's tooltip, every figure the perturbation moves (one that differs between the two drawings, at the same place among the figures, the two drawings holding as many) prints, in the second drawing, the curve's own sentinel, and, in the first, the drawn curve's own mean (numerically, the integral of x over the plotted density) to within half a unit of its last digit, or "${INF}" when a mixture component has a_K <= 1; the Median marker holds at least one such figure (the curve's other markers may hold none); at least six curves with a finite mean checked. No word, order, line or separator is read. A Median marker with no figure the perturbation moves prints something other than densityFn.mean, a value computed elsewhere (then perturb that source here); a moved figure that does not print the sentinel is a transform of the mean, or another curve's.
Resultata: ${finiteChecked} curves with a finite mean checked; ${meanProblems.length} problems, each giving, for each marker, its figures in the normal drawing, in the perturbed one, and the moved figures as [normal, perturbed] pairs (null where the drawings hold different numbers of figures):
${meanProblems.join("\n")}`);

console.log(`qual pass: distribution chart renders inverse-gamma and log-normal density curves (${comboHealth.length} marginal bells healthy; on ${meanCheck.filter(r => r.aMin <= 1 || r.aMin > 3).length} curves, ${meanCheck.filter(r => r.aMin <= 1).length} of them with an infinite mean, the markers' figures for the mean, found by perturbing densityFn.mean, print the drawn curve's)`);

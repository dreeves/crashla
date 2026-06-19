import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }

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
// The drawn bell integrates InvGamma(alpha, VMT) over a log-uniform VMT prior on
// [vmtMin, vmtMax], so it must (i) stay a normalized density, (ii) be WIDER (more
// log-variance) than the point-estimate curve at vmtBest, and (iii) reduce exactly
// to invGammaLogDensity when the band is degenerate (vmtMin == vmtMax).
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

// Legend: one entry per rendered curve, chip-colored and labeled
const legendItemCount = (distChart.match(/month-legend-item/g) || []).length;
const peakMarkerCount = (distChart.match(/<circle/g) || []).length;
assert.ok(
  legendItemCount > 0 && legendItemCount === peakMarkerCount,
  `Replicata: call renderDistributionChart and count legend items vs peak markers.
Expectata: exactly one month-legend-item per rendered curve (peak marker).
Resultata: ${legendItemCount} legend items, ${peakMarkerCount} peak markers.`,
);

for (const [helmer, color, label] of [
  ["HumansAV", "#c9a800", "Humans (AV cities)"],
  ["Tesla", "#d13b2d", "Tesla"],
  ["Waymo", "#2060c0", "Waymo"],
  ["Zoox", "#2a8f57", "Zoox"],
]) {
  assert.ok(
    distChart.includes(`month-chip" style="background:${color}"></span>${label}`),
    `Replicata: render the distribution chart with ${helmer} enabled.
Expectata: legend shows a ${color} chip labeled "${label}".
Resultata: chip+label pair not found in output.`,
  );
}

assert.ok(
  !distChart.includes("Humans (US average)"),
  `Replicata: render the distribution chart with HumansUS disabled (default).
Expectata: legend has no "Humans (US average)" entry.
Resultata: found "Humans (US average)" in output.`,
);

assert.ok(
  distChart.includes("Probability Density for True MPI"),
  `Replicata: call renderDistributionChart and inspect y-axis label.
Expectata: y-axis label is "Probability Density for True MPI".
Resultata: expected label not found in output.`,
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
    start: activeSeries.months[0],
    end: activeSeries.months[activeSeries.months.length - 1],
  };
})()
`, ctx);

assert.equal(
  seriousTitle.heading,
  `Miles per serious-injury-causing incident probability distributions using data from ${seriousTitle.start} to ${seriousTitle.end}`,
  `Replicata: render the windowed views with the serious-injury metric selected.
Expectata: the section header reuses the exact selected metric label and active date window.
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
  const fullWaymo = monthlySummaryRows(fullMonthSeries).find(row => row.helmer === "Waymo").mpiEstimates.all.median;
  monthRangeStart = 0; monthRangeEnd = 5;
  renderWindowedViews();
  const slicedWaymo = monthlySummaryRows(activeSeries).find(row => row.helmer === "Waymo").mpiEstimates.all.median;
  return {
    fullWaymo,
    slicedWaymo,
    heading: document.getElementById("dist-heading").textContent,
    start: activeSeries.months[0],
    end: activeSeries.months[activeSeries.months.length - 1],
  };
})()
`, ctx);

assert.ok(
  windowEffect.fullWaymo !== windowEffect.slicedWaymo &&
    windowEffect.heading ===
      `Miles per any incident probability distributions using data from ${windowEffect.start} to ${windowEffect.end}`,
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

console.log("qual pass: distribution chart renders inverse-gamma and log-normal density curves");

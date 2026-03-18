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
for (const c of ADS_COMPANIES) monthCompanyEnabled[c] = true;
activeSeries = monthSeriesData();
`, ctx);

const distChart = vm.runInContext(`renderDistributionChart(activeSeries)`, ctx);

assert.ok(
  distChart.includes("<svg"),
  `Replicata: call renderDistributionChart with all metrics and companies enabled.
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
  `Replicata: call renderDistributionChart with all companies enabled.
Expectata: SVG includes company colors (Tesla #d13b2d, Waymo #2060c0, Zoox #2a8f57).
Resultata: one or more company colors missing.`,
);

assert.ok(
  distChart.includes("data-tip="),
  `Replicata: call renderDistributionChart with all metrics enabled.
Expectata: SVG includes peak markers with data-tip tooltips.
Resultata: no data-tip attributes found.`,
);

assert.ok(
  distChart.includes("Probability Density for True MPI"),
  `Replicata: call renderDistributionChart and inspect y-axis label.
Expectata: y-axis label is "Probability Density for True MPI".
Resultata: expected label not found in output.`,
);

assert.ok(
  distChart.includes("fill:#888"),
  `Replicata: call renderDistributionChart with metrics that have human benchmarks.
Expectata: SVG includes gray (fill:#888) human benchmark log-normal curves.
Resultata: human curve color not found in output.`,
);

// Edge case: no companies enabled → empty string
const emptyChart = vm.runInContext(`
(() => {
  for (const c of ADS_COMPANIES) monthCompanyEnabled[c] = false;
  const result = renderDistributionChart(activeSeries);
  for (const c of ADS_COMPANIES) monthCompanyEnabled[c] = true;
  return result;
})()
`, ctx);

assert.ok(
  emptyChart === "" || !emptyChart.includes("#d13b2d"),
  `Replicata: call renderDistributionChart with all companies disabled.
Expectata: returns empty string or SVG without company curves.
Resultata: output was ${JSON.stringify(emptyChart.slice(0, 200))}.`,
);

console.log("qual pass: distribution chart renders inverse-gamma and log-normal density curves");

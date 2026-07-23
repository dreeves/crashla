import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// renderFleetForecastChart and the mixture helpers touch no DOM, so a thin stub
// context suffices (matching the distribution-chart qual's setup).
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// The "miles" metric reads vmtRows (repo VMT master), so populate it like init does.
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

// --- 1. The chart renders an SVG with all four curves + median markers ---
// Four curves: Waymo, Zoox, and Tesla split into its two scopes (robotaxi + the
// conditional all-HW4-ADS scenario, drawn in its own colour).

const html = vm.runInContext("renderFleetForecastChart()", ctx);

assert.ok(
  html.includes("<svg") && html.includes("fleet-clip"),
  `Replicata: call renderFleetForecastChart.
Expectata: output is an SVG using the fleet-clip clip-path.
Resultata: no <svg / fleet-clip found.`,
);

for (const [label, color] of [["Tesla robotaxi", "#d13b2d"], ["Tesla HW4", "#e08a2e"],
  ["Waymo", "#2060c0"], ["Zoox", "#2a8f57"]]) {
  assert.ok(
    html.includes(color),
    `Replicata: render the fleet forecast chart.
Expectata: ${label}'s curve colour ${color} appears.
Resultata: colour not found.`,
  );
}

// Both Tesla scopes are labeled with their scenario probability; the HW4 curve is dashed.
assert.ok(
  html.includes("Tesla robotaxi (~95%)") && html.includes("Tesla all-HW4 ADS (~5%)"),
  `Replicata: read the fleet chart legend/markers.
Expectata: Tesla's two scopes are labeled "Tesla robotaxi (~95%)" and "Tesla all-HW4 ADS (~5%)".
Resultata: labels not found.`,
);
assert.ok(
  (html.match(/stroke-dasharray/g) || []).length >= 1,
  `Replicata: inspect the fleet chart strokes.
Expectata: the conditional HW4 curve is dashed.
Resultata: no dashed stroke found.`,
);

// One median marker per curve (4), each carrying a data-tip tooltip.
const markerCount = (html.match(/<circle/g) || []).length;
const tipCount = (html.match(/data-tip=/g) || []).length;
assert.ok(
  markerCount === 4 && tipCount === 4,
  `Replicata: count median markers and tooltips in the fleet chart.
Expectata: one median dot with one tooltip per curve (4 each).
Resultata: ${markerCount} circles, ${tipCount} tooltips.`,
);

// --- 2. The chart container exists in index.html (init has a render target) ---

const indexHtml = fs.readFileSync("index.html", "utf8");
assert.ok(
  indexHtml.includes('id="chart-fleet-forecast"'),
  `Replicata: search index.html for the fleet chart container.
Expectata: a #chart-fleet-forecast element exists for the init render.
Resultata: not found.`,
);

// --- 3. Each curve is a normalized density; there are four of them ---

const stats = vm.runInContext(`
(() => {
  const curves = fleetForecastCurves();
  const integ = densFn => {
    const n = 12000, L0 = Math.log(1), L1 = Math.log(1e9), st = (L1 - L0) / (n - 1);
    let mass = 0;
    for (let i = 0; i < n; i++) mass += densFn(Math.exp(L0 + st * i)) * st;
    return mass;
  };
  // Slope-sign changes across each curve's probe extent: 1 = unimodal, >1 = multimodal.
  const signChanges = c => {
    const N = 600, a = Math.log(c.xMin), b = Math.log(c.xMax), ys = [];
    for (let i = 0; i < N; i++) ys.push(c.densityFn(Math.exp(a + (b - a) * i / (N - 1))));
    const pk = Math.max(...ys);
    let sc = 0, prev = 0;
    for (let i = 1; i < N; i++) {
      const dd = ys[i] - ys[i - 1];
      const s = Math.abs(dd) < pk * 1e-6 ? prev : Math.sign(dd);
      if (s !== 0 && s !== prev && prev !== 0) sc++;
      if (s !== 0) prev = s;
    }
    return sc;
  };
  return curves.map(c => ({
    key: c.key, mainline: c.mainline, scenarioProb: c.scenarioProb, mass: integ(c.densityFn),
    lo90: c.lo90, median: c.median, hi90: c.hi90, signChanges: signChanges(c),
  }));
})()
`, ctx);

assert.equal(
  stats.length, 4,
  `Replicata: build the fleet forecast curves.
Expectata: four curves (Waymo, Zoox, Tesla robotaxi, Tesla HW4).
Resultata: ${stats.length} curves.`,
);

for (const s of stats) {
  assert.ok(
    Math.abs(s.mass - 1) < 0.02,
    `Replicata: integrate the ${s.key} fleet density over a wide log grid.
Expectata: a normalized density (integral ~1 within 2%).
Resultata: mass was ${s.mass}.`,
  );
  assert.ok(
    s.lo90 < s.median && s.median < s.hi90,
    `Replicata: read the ${s.key} 5th/50th/95th fleet-size quantiles.
Expectata: strictly ordered lo90 < median < hi90.
Resultata: ${s.lo90} / ${s.median} / ${s.hi90}.`,
  );
}

// --- 4. The forecast's qualitative shape is the one we drew ---

const byKey = Object.fromEntries(stats.map(s => [s.key, s]));

// Waymo carries a base + hockeystick mode: one unimodal curve (the hockeystick is a
// fat right shoulder, not a second peak), central ~6,000 with a tail past ~8,000.
assert.ok(
  byKey.Waymo.median > 5000 && byKey.Waymo.median < 7000 &&
    byKey.Waymo.hi90 > 8000 && byKey.Waymo.signChanges === 1,
  `Replicata: inspect Waymo's fleet forecast.
Expectata: unimodal, median ~6,000 (5000-7000), with a hockeystick tail past 8,000.
Resultata: median=${byKey.Waymo.median}, hi90=${byKey.Waymo.hi90}, signChanges=${byKey.Waymo.signChanges}.`,
);

assert.ok(
  byKey.Zoox.median > 100 && byKey.Zoox.median < 220 && byKey.Zoox.signChanges === 1,
  `Replicata: inspect Zoox's fleet forecast.
Expectata: a unimodal distribution with median ~150 (100-220).
Resultata: median=${byKey.Zoox.median}, signChanges=${byKey.Zoox.signChanges}.`,
);

// Tesla robotaxi (mainline, ~95%): the apples-to-apples fleet — a low-hundreds
// median, bimodal (A+B), and its tail stays in robotaxi territory (no HW4 blow-up).
assert.ok(
  byKey.robotaxi.mainline && Math.abs(byKey.robotaxi.scenarioProb - 0.95) < 0.02 &&
    byKey.robotaxi.median > 100 && byKey.robotaxi.median < 600 &&
    byKey.robotaxi.hi90 < 50000 && byKey.robotaxi.signChanges > 1,
  `Replicata: inspect Tesla's robotaxi-scope curve.
Expectata: mainline, ~95% weight, median 100-600, bimodal, 95th percentile under 50k (no HW4 tail).
Resultata: mainline=${byKey.robotaxi.mainline}, prob=${byKey.robotaxi.scenarioProb}, median=${byKey.robotaxi.median}, hi90=${byKey.robotaxi.hi90}, signChanges=${byKey.robotaxi.signChanges}.`,
);

// Tesla all-HW4 ADS (conditional, ~5%): the broad scenario, in the hundreds-of-
// thousands to millions, drawn as its own unimodal curve.
assert.ok(
  !byKey.hw4.mainline && Math.abs(byKey.hw4.scenarioProb - 0.05) < 0.02 &&
    byKey.hw4.median > 100000 && byKey.hw4.hi90 > 1000000 && byKey.hw4.signChanges === 1,
  `Replicata: inspect Tesla's HW4-scope curve.
Expectata: conditional (not mainline), ~5% weight, six-figure median, tail past 1M, unimodal.
Resultata: mainline=${byKey.hw4.mainline}, prob=${byKey.hw4.scenarioProb}, median=${byKey.hw4.median}, hi90=${byKey.hw4.hi90}, signChanges=${byKey.hw4.signChanges}.`,
);

// --- 4b. Miles/rides curves: scenario mixtures with honest quantiles. Tesla's
// miles/rides mirror the FLEET_FORECAST scenario structure (same A/B/C weights,
// same robotaxi-vs-HW4 scope split into two lanes), so every metric draws four
// curves. Each displayed median/CI must be a real quantile of the drawn
// density — the single two-piece curve this replaced put its 8M "Median" dot
// at the 14th percentile of its own curve, and a one-humped band can't
// represent "71% boring / 24% aggressive / 5% HW4" at all. ---

const quantileStats = vm.runInContext(`
(() => {
  const out = [];
  for (const metric of ["miles", "rides"]) {
    const curves = fleetDistributionCurves(metric);
    for (const c of curves) {
      const cdfAt = xq => {
        const a = Math.log(c.lo90) - 8, b = Math.log(c.hi90) + 8, n = 20000;
        const st = (b - a) / (n - 1);
        let cum = 0;
        for (let i = 0; i < n; i++) {
          const x = Math.exp(a + st * i);
          if (x > xq) break;
          cum += c.densityFn(x) * st;
        }
        return cum;
      };
      out.push({metric, key: c.key, count: curves.length, legendLabel: c.legendLabel,
        dashed: c.dashed, median: c.median, lo90: c.lo90, hi90: c.hi90,
        cdfMedian: cdfAt(c.median), cdfLo: cdfAt(c.lo90), cdfHi: cdfAt(c.hi90)});
    }
  }
  return out;
})()
`, ctx);

for (const q of quantileStats) {
  assert.equal(q.count, 4,
    `Replicata: build the ${q.metric} distribution curves.
Expectata: four curves (Waymo, Zoox, Tesla robotaxi, Tesla HW4) — same scope split as the fleet metric.
Resultata: ${q.count}.`);
  assert.ok(
    Math.abs(q.cdfMedian - 0.5) < 0.03 && Math.abs(q.cdfLo - 0.05) < 0.02 && Math.abs(q.cdfHi - 0.95) < 0.02,
    `Replicata: integrate the drawn ${q.metric}/${q.key} density up to its stated median and CI endpoints.
Expectata: CDF(median) ~ 0.5, CDF(lo90) ~ 0.05, CDF(hi90) ~ 0.95 — displayed numbers are quantiles of the drawn curve.
Resultata: CDF(median=${q.median}) = ${q.cdfMedian.toFixed(3)}, CDF(lo90) = ${q.cdfLo.toFixed(3)}, CDF(hi90) = ${q.cdfHi.toFixed(3)}.`,
  );
}

// The scenario mixture restores the property that motivated it: Tesla's
// robotaxi-scope miles median sits with scenario A's ~71% mass, not in the
// no-man's-land (~32M) the single fat-tailed curve produced; the HW4 lane
// is dashed/conditional in the hundreds of millions. Range re-pinned
// [7M, 15M] -> [3.4M, 6.5M] (= scenario A's band) on 2026-07-22 when A was
// recalibrated down to the Q2-deck actuals (end-Jun 2.44M after the
// utilization-led Q2 slowdown); the median lands ~5M.
const milesByKey = Object.fromEntries(quantileStats.filter(q => q.metric === "miles").map(q => [q.key, q]));
assert.ok(milesByKey.robotaxi.median > 3400000 && milesByKey.robotaxi.median < 6500000 && !milesByKey.robotaxi.dashed,
  `Replicata: read Tesla's robotaxi-scope cumulative-miles median.
Expectata: in [3.4M, 6.5M] (scenario A's band; A carries ~71% of the mass) and drawn solid.
Resultata: ${JSON.stringify(milesByKey.robotaxi)}.`);
assert.ok(milesByKey.hw4.median > 150000000 && milesByKey.hw4.dashed,
  `Replicata: read Tesla's HW4-scope cumulative-miles curve.
Expectata: median past 150M and drawn dashed (conditional scenario).
Resultata: ${JSON.stringify(milesByKey.hw4)}.`);

// The trajectory chart's miles/rides forecast endpoints must carry the same
// computed quantiles (its tooltip also says "Median:").
const laneEnds = vm.runInContext(`
(() => {
  const out = [];
  for (const metric of ["miles", "rides"]) {
    const curves = Object.fromEntries(fleetDistributionCurves(metric).map(c => [c.legendLabel, c]));
    for (const lane of growthMetricSpec(metric).lanes()) {
      const fc = lane.points[lane.points.length - 1];
      const c = curves[lane.label];
      out.push({metric, label: lane.label, fcBest: fc.best, fcLo: fc.lo, fcHi: fc.hi,
        median: c.median, lo90: c.lo90, hi90: c.hi90});
    }
  }
  return out;
})()
`, ctx);

for (const l of laneEnds) {
  assert.ok(
    l.fcBest === l.median && l.fcLo === l.lo90 && l.fcHi === l.hi90,
    `Replicata: compare the ${l.metric}/${l.label} trajectory forecast endpoint to the distribution curve's quantiles.
Expectata: identical (both charts show the same median + 90% CI).
Resultata: endpoint {${l.fcBest}, ${l.fcLo}, ${l.fcHi}} vs quantiles {${l.median}, ${l.lo90}, ${l.hi90}}.`,
  );
}

// --- 5. Anti-Postel: malformed forecast weights crash loudly, not silently ---

let threw = false;
try {
  vm.runInContext(`
    const saved = FLEET_FORECAST[1].components[0].weight;
    FLEET_FORECAST[1].components[0].weight = 0.9; // Waymo no longer sums to 1
    try { fleetForecastCurves(); } finally { FLEET_FORECAST[1].components[0].weight = saved; }
  `, ctx);
} catch (_e) {
  threw = true;
}
assert.ok(
  threw,
  `Replicata: corrupt a helmer's mixture weights so they no longer sum to 1, then build the curves.
Expectata: immediate throw (the weights are a hard invariant).
Resultata: no throw.`,
);

console.log("qual pass: fleet forecast draws four normalized curves; Tesla split into robotaxi (~95%) + all-HW4-ADS (~5%) scopes");

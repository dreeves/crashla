import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// escHtml() round-trips through textContent -> innerHTML, so createElement must
// escape there or every escAttr()'d data-tip renders empty (tooltip checks moot).
const escapingEl = () => {
  let html = "";
  return {
    set textContent(v) {
      html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    get innerHTML() { return html; },
  };
};
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return escapingEl(); },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// The "miles" metric reads vmtRows (repo VMT master), so populate it like init does.
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

// --- 1. Month index <-> ISO round-trips, anchored at 2025-05 = 0 ---

const monthMap = vm.runInContext(`
(() => ({
  may25: fleetMonthIndex("2025-05"),
  jan27: fleetMonthIndex("2027-01"),
  roundtrip: [0, 7, 20].every(i => fleetMonthIndex(fleetMonthIso(i)) === i),
}))()
`, ctx);
assert.equal(monthMap.may25, 0,
  `Replicata: fleetMonthIndex("2025-05"). Expectata: 0. Resultata: ${monthMap.may25}.`);
assert.equal(monthMap.jan27, 20,
  `Replicata: fleetMonthIndex("2027-01"). Expectata: 20 (Jan 2027). Resultata: ${monthMap.jan27}.`);
assert.ok(monthMap.roundtrip,
  `Replicata: round-trip fleetMonthIso through fleetMonthIndex.
Expectata: index -> iso -> index is the identity.
Resultata: round-trip failed.`);

// --- 2. The fleet trajectory renders four lanes (Tesla forks into two scopes) ---
// Three extrapolation legs (Waymo, Zoox, Tesla robotaxi) plus the conditional HW4
// fork => four colours and four dashed segments.

const html = vm.runInContext("renderFleetTimeSeriesChart()", ctx);

assert.ok(
  html.includes("<svg") && html.includes("fleet-ts-clip"),
  `Replicata: call renderFleetTimeSeriesChart.
Expectata: an SVG using the fleet-ts-clip clip-path.
Resultata: no <svg / fleet-ts-clip.`,
);

for (const [label, color] of [["Tesla robotaxi", "#d13b2d"], ["Tesla HW4", "#e08a2e"],
  ["Waymo", "#2060c0"], ["Zoox", "#2a8f57"]]) {
  assert.ok(html.includes(color),
    `Replicata: render the fleet trajectory chart.
Expectata: ${label}'s colour ${color} appears.
Resultata: colour not found.`);
}

// Four dashed segments on fleet: one extrapolation per mainline lane + the HW4 fork.
const dashCount = (html.match(/stroke-dasharray/g) || []).length;
assert.equal(dashCount, 4,
  `Replicata: count dashed segments in the fleet trajectory.
Expectata: four (three extrapolation legs + the conditional HW4 fork).
Resultata: ${dashCount}.`);

// --- 3. The trajectory endpoints equal the FLEET_FORECAST distribution ---
// The trajectory shows the mainline (apples-to-apples) curves — Waymo, Zoox, and
// Tesla's robotaxi scope — plus the HW4 fork; every endpoint median must match a
// distribution curve exactly (the two charts share the same forecast).

const endpoints = JSON.parse(JSON.stringify(vm.runInContext(`
(() => fleetForecastCurves().map(c => ({
  key: c.key, mainline: c.mainline, median: c.median })))()
`, ctx)));

const fmtWhole = vm.runInContext("fmtWhole", ctx);
for (const e of endpoints) {
  const tip = `Median: ${fmtWhole(e.median)}`;
  assert.ok(html.includes(tip),
    `Replicata: look for the ${e.key} forecast-endpoint median in the fleet trajectory chart.
Expectata: the chart reports "${tip}" (same value as the distribution chart, incl. the HW4 fork).
Resultata: not found.`);
}

// --- 3b. The toggle offers all three metrics; each renders both charts ---

const METRICS = ["fleet", "rides", "miles"];
const CUMULATIVE = ["rides", "miles"];
const toggle = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const metrics = ${JSON.stringify(METRICS)};
  const cumulative = ${JSON.stringify(CUMULATIVE)};
  const out = {};
  for (const key of metrics) {
    selectedGrowthMetric = key;
    const html = renderFleetTimeSeriesChart();
    const dist = renderFleetForecastChart();
    const spec = growthMetricSpec(key);
    // Cumulative metrics: every lane's history (non-forecast points) is non-decreasing.
    const monotone = !cumulative.includes(key) || spec.lanes().every(lane => {
      const b = lane.points.filter(p => !p.forecast).map(p => p.best);
      return b.every((v, i) => i === 0 || v >= b[i - 1]);
    });
    out[key] = {
      hasSvg: html.includes("<svg") && html.includes("fleet-ts-clip"),
      yLabel: spec.yLabel,
      hasYLabel: html.includes(spec.yLabel),
      radios: (html.match(/name="growth-metric"/g) || []).length,
      checkedKey: (html.match(/value="([a-z]+)" checked/) || [])[1],
      dashes: (html.match(/stroke-dasharray/g) || []).length,
      distMarkers: (dist.match(/<circle/g) || []).length,
      distHasXLabel: dist.includes(spec.yLabel),
      monotone,
    };
  }
  selectedGrowthMetric = "fleet";
  return out;
})()
`, ctx)));

for (const key of METRICS) {
  const t = toggle[key];
  const expectedCurves = 4; // every metric: Waymo, Zoox, Tesla robotaxi, + the HW4 fork
  const expectedDashes = 4; // one dashed forecast leg per lane (incl. the HW4 fork leg)
  assert.ok(t.hasSvg && t.dashes === expectedDashes,
    `Replicata: select the "${key}" growth metric and render the extrapolator.
Expectata: a valid SVG with ${expectedDashes} dashed segments.
Resultata: hasSvg=${t.hasSvg}, dashes=${t.dashes}.`);
  assert.ok(t.radios === METRICS.length && t.checkedKey === key,
    `Replicata: render the "${key}" metric and inspect the toggle radios.
Expectata: ${METRICS.length} radios with "${key}" checked.
Resultata: radios=${t.radios}, checked=${t.checkedKey}.`);
  assert.ok(t.hasYLabel,
    `Replicata: render the "${key}" trajectory.
Expectata: its y-axis label "${t.yLabel}" appears.
Resultata: not found.`);
  assert.ok(t.distMarkers === expectedCurves && t.distHasXLabel,
    `Replicata: render the distribution chart for the "${key}" metric.
Expectata: ${expectedCurves} median markers and the x-axis labeled "${t.yLabel}".
Resultata: markers=${t.distMarkers}, hasXLabel=${t.distHasXLabel}.`);
  assert.ok(t.monotone,
    `Replicata: read the "${key}" cumulative history per lane.
Expectata: non-decreasing (cumulative can't shrink).
Resultata: a lane's series decreases.`);
}

// --- 4. Every fleet lane is well-formed and ends at the 2027-01 forecast ---

const lanes = JSON.parse(JSON.stringify(vm.runInContext(`
(() => growthMetricSpec("fleet").lanes().map(lane => {
  const pts = lane.points;
  return {
    label: lane.label,
    branchOnly: lane.branchOnly === true,
    ordered: pts.every(p => p.lo <= p.best && p.best <= p.hi),
    endMonth: pts[pts.length - 1].month,
    endIsForecast: pts[pts.length - 1].forecast === true,
  };
}))()
`, ctx)));

assert.equal(lanes.length, 4,
  `Replicata: build the fleet trajectory lanes.
Expectata: four (Waymo, Zoox, Tesla robotaxi, Tesla HW4 fork).
Resultata: ${lanes.length}.`);
assert.equal(lanes.filter(l => l.branchOnly).length, 1,
  `Replicata: look for the conditional HW4 fork lane.
Expectata: exactly one branch-only lane.
Resultata: ${lanes.filter(l => l.branchOnly).length}.`);
for (const l of lanes) {
  assert.ok(l.ordered,
    `Replicata: read ${l.label}'s points. Expectata: lo <= best <= hi. Resultata: out of order.`);
  assert.equal(l.endMonth, "2027-01",
    `Replicata: read ${l.label}'s last point. Expectata: 2027-01. Resultata: ${l.endMonth}.`);
  assert.ok(l.endIsForecast,
    `Replicata: check ${l.label}'s endpoint. Expectata: forecast === true. Resultata: not flagged.`);
}

// --- 5. Anti-Postel: a malformed history anchor (lo > best) crashes loudly ---

let threw = false;
try {
  vm.runInContext(`
    const saved = FLEET_HISTORY.Zoox[0].lo;
    FLEET_HISTORY.Zoox[0].lo = 1e6; // now lo > best
    try { growthMetricSpec("fleet").lanes(); }
    finally { FLEET_HISTORY.Zoox[0].lo = saved; }
  `, ctx);
} catch (_e) {
  threw = true;
}
assert.ok(threw,
  `Replicata: corrupt a history anchor so lo > best, then build the fleet lanes.
Expectata: immediate throw (lo <= best <= hi is a hard invariant).
Resultata: no throw.`);

// --- 6. The chart container exists in index.html (init has a render target) ---

const indexHtml = fs.readFileSync("index.html", "utf8");
assert.ok(indexHtml.includes('id="chart-fleet-timeseries"'),
  `Replicata: search index.html for the trajectory chart container.
Expectata: a #chart-fleet-timeseries element exists for the init render.
Resultata: not found.`);

console.log("qual pass: fleet trajectory chart renders history + dashed extrapolation, sharing the FLEET_FORECAST endpoint");

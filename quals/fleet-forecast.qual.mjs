import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

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

const svgHeight = Number((html.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/) || [])[1]);
const tickLabels = [...html.matchAll(
  /<text class="month-tick"[^>]*\by="([\d.]+)"[^>]*>([^<]+)<\/text>/g,
)];
// The axis title, read from the app (no wording pins in quals, 2026-10-28).
const fleetTitle = vm.runInContext('growthMetricSpec("fleet").yLabel', ctx);
const bottomLabel = tickLabels.find(match => match[2] === fleetTitle);
const bottomLabelInset = svgHeight - Number(bottomLabel?.[1]);
assert.equal(
  bottomLabelInset,
  9,
  `Replicata: render the fleet forecast at 320px through 1000px wide.
Expectata: the bottom label's baseline is inset nine SVG units, keeping the
label's descenders inside the viewport in Chromium, Firefox, and WebKit.
Resultata: ${JSON.stringify(bottomLabel?.[2])} was inset ${bottomLabelInset}.`,
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

// Both Tesla scopes are labeled with their scenario probability, computed here
// from FLEET_FORECAST's weights; the names come from the app (FLEET_LANE_META)
// and are not pinned (no wording pins, 2026-10-28). The HW4 curve is dashed.
{
  const scopes = JSON.parse(vm.runInContext(`JSON.stringify({meta: FLEET_LANE_META,
    weights: FLEET_FORECAST.find(f => f.helmer === "Tesla").components.map(c => ({scope: c.scope, weight: c.weight}))})`, ctx));
  const want = ["robotaxi", "hw4"].map(k => `${scopes.meta[k].label} (~${Math.round(100 * scopes.weights.filter(w => w.scope === k).reduce((t, w) => t + w.weight, 0))}%)`);
  assert.ok(want.every(w => html.includes(w)),
    `Replicata: read the fleet chart legend/markers.
Expectata: Tesla's two scopes labeled with their scenario shares from the weights: ${JSON.stringify(want)}.
Resultata: not found.`,
  );
}
assert.ok(
  (html.match(/stroke-dasharray/g) || []).length >= 1,
  `Replicata: inspect the fleet chart strokes.
Expectata: the conditional HW4 curve is dashed.
Resultata: no dashed stroke found.`,
);

// One median marker per curve (4), each with one tooltip target: since
// 2026-10-03 (audit #28) an invisible hit circle over the visible dot.
const markerCount = (html.match(/<circle[^>]*class="month-dot"/g) || []).length;
const tipCount = (html.match(/<circle[^>]*fill="none" data-tip=/g) || []).length;
assert.ok(
  markerCount === 4 && tipCount === 4 && (html.match(/data-tip=/g) || []).length === 4,
  `Replicata: count median markers and tooltips in the fleet chart.
Expectata: one median dot with one tooltip target per curve (4 each).
Resultata: ${markerCount} dots, ${tipCount} targets.`,
);

// --- 1b. Median markers are drawn whole (2026-10-03, audit #25) -------------
// The y scale topped out at the tallest sampled density and the markers sat
// inside the clip-path group, so Waymo's median marker (near its curve's peak)
// lost its top 1.5-2.3 units on every metric. Markers now draw outside the
// clip group, and the scale leaves headroom above the tallest marker and
// sample.
for (const key of ["fleet", "rides", "miles"]) {
  const svg = vm.runInContext(`selectedGrowthMetric = ${JSON.stringify(key)}; renderFleetForecastChart()`, ctx);
  const clip = svg.match(/<clipPath id="fleet-clip"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/).slice(1).map(Number);
  const group = svg.indexOf('<g clip-path="url(#fleet-clip)">');
  const groupEnd = svg.indexOf("</g>", group);
  // The visible dots (class month-dot); their hit circles follow them, also
  // outside the clip group.
  const circles = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)" class="month-dot"/g)]
    .map(m => ({at: m.index, cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3])}));
  const hits = [...svg.matchAll(/<circle cx="[\d.-]+" cy="[\d.-]+" r="[\d.]+" fill="none" data-tip=/g)];
  const bad = circles.filter(c => (c.at > group && c.at < groupEnd) || c.cy - c.r - 0.75 < clip[1]
    || c.cx < clip[0] || c.cx > clip[0] + clip[2]);
  assert.ok(circles.length === 4 && bad.length === 0 && hits.length === 4 && hits.every(h => h.index > groupEnd),
    `Replicata: render the fleet forecast's ${key} chart and locate its four median markers.
Expectata: each drawn outside the clip-path group, its centre inside the frame and its disc (r plus the 0.75 halo) at or below the frame's top edge (y ${clip[1]}).
Resultata: ${JSON.stringify(bad)} of ${circles.length}.`);
}
vm.runInContext(`selectedGrowthMetric = "fleet";`, ctx);

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

// Re-pinned 2026-10-29 for the Jan 1, 2028 forecast (the human moved the
// date; the re-pin was part of that choice). Until then: Waymo ~6,000
// (5,000-7,000) with a tail past 8,000; Zoox ~150 (100-220); Tesla robotaxi
// 200-2,000 at ~95%; Tesla HW4 at ~5%.
//
// Waymo carries a base + plan mode: one unimodal curve (the plan toward
// Semafor's reported 20,000 is a fat right shoulder, not a second peak),
// central ~12,000 with a tail past 18,000.
assert.ok(
  byKey.Waymo.median > 9000 && byKey.Waymo.median < 15000 &&
    byKey.Waymo.hi90 > 18000 && byKey.Waymo.signChanges === 1,
  `Replicata: inspect Waymo's fleet forecast.
Expectata: unimodal, median ~12,000 (9,000-15,000), with a tail past 18,000.
Resultata: median=${byKey.Waymo.median}, hi90=${byKey.Waymo.hi90}, signChanges=${byKey.Waymo.signChanges}.`,
);

assert.ok(
  byKey.Zoox.median > 250 && byKey.Zoox.median < 600 && byKey.Zoox.signChanges === 1,
  `Replicata: inspect Zoox's fleet forecast.
Expectata: a unimodal distribution with median ~400 (250-600).
Resultata: median=${byKey.Zoox.median}, signChanges=${byKey.Zoox.signChanges}.`,
);

// Tesla robotaxi (mainline, the large majority of Tesla's mass): the
// apples-to-apples fleet in car-equivalents, a mixture of A and B, its tail
// in robotaxi territory (no HW4 blow-up). Its median's band was 100-600 until
// 2026-10-23 and 200-2,000 until 2026-10-29. Until 2026-10-29 the curve also
// had to be bimodal (B a second hump); the 2028 scenarios' bands overlap
// (A 900-8,000, B 5,000-40,000), so B is a fat right shoulder.
assert.ok(
  byKey.robotaxi.mainline && byKey.robotaxi.scenarioProb > 0.8 &&
    byKey.robotaxi.median > 1000 && byKey.robotaxi.median < 10000 &&
    byKey.robotaxi.hi90 < 50000,
  `Replicata: inspect Tesla's robotaxi-scope curve.
Expectata: mainline, over 80% of Tesla's weight, median 1,000-10,000, 95th percentile under 50k (no HW4 tail).
Resultata: mainline=${byKey.robotaxi.mainline}, prob=${byKey.robotaxi.scenarioProb}, median=${byKey.robotaxi.median}, hi90=${byKey.robotaxi.hi90}, signChanges=${byKey.robotaxi.signChanges}.`,
);

// Tesla all-HW4 ADS (conditional, a small share): the broad scenario, drawn
// as its own unimodal curve, in car-equivalents like Tesla's line (the
// human's choice, 2026-10-30: its ADS miles a day / TESLA_MILES_PER_CAR_DAY),
// so tens of thousands to hundreds of thousands. Until 2026-10-31 it counted
// distinct customer cars, and this pinned a six-figure median and a tail past
// 1M.
assert.ok(
  !byKey.hw4.mainline && byKey.hw4.scenarioProb < 0.2 &&
    byKey.hw4.median > 10000 && byKey.hw4.hi90 > 100000 && byKey.hw4.signChanges === 1,
  `Replicata: inspect Tesla's HW4-scope curve.
Expectata: conditional (not mainline), under 20% of Tesla's weight, median past 10,000 car-equivalents, tail past 100,000, unimodal.
Resultata: mainline=${byKey.hw4.mainline}, prob=${byKey.hw4.scenarioProb}, median=${byKey.hw4.median}, hi90=${byKey.hw4.hi90}, signChanges=${byKey.hw4.signChanges}.`,
);

// --- 4b. Miles/rides curves: scenario mixtures with honest quantiles. Tesla's
// miles/rides mirror the FLEET_FORECAST scenario structure (same A/B/C weights,
// same robotaxi-vs-HW4 scope split into two lanes), so every metric draws four
// curves. Each displayed median/CI must be a real quantile of the drawn
// density — the single two-piece curve this replaced put its 8M "Median" dot
// at the 14th percentile of its own curve, and a one-humped band can't
// represent three weighted futures (slow, aggressive, HW4) at all. ---

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
// robotaxi-scope miles median sits with scenario A's mass (most of Tesla's
// weight), not in the no-man's-land (~32M) the single fat-tailed curve
// produced; the HW4 lane is dashed/conditional in the hundreds of millions.
// The band is read from MILES_FORECAST A itself (2026-09-26): the hardcoded
// [3.4M, 6.5M] of 2026-07-22 went stale when A was re-based on 2026-09-04
// and the median sat 3% under its ceiling with no regression.
const milesA = JSON.parse(vm.runInContext(`JSON.stringify(MILES_FORECAST.find(f => f.helmer === "Tesla").components.find(c => c.weight > 0.5))`, ctx));
const milesByKey = Object.fromEntries(quantileStats.filter(q => q.metric === "miles").map(q => [q.key, q]));
assert.ok(milesByKey.robotaxi.median > milesA.lo && milesByKey.robotaxi.median < milesA.hi && !milesByKey.robotaxi.dashed,
  `Replicata: read Tesla's robotaxi-scope cumulative-miles median.
Expectata: inside scenario A's band [${milesA.lo}, ${milesA.hi}] (A carries weight ${milesA.weight} of Tesla's mass) and drawn solid.
Resultata: ${JSON.stringify(milesByKey.robotaxi)}.`);

// --- 4c. Tesla's all-HW4 lane contains its robotaxi lane (2026-10-30) ---
// Scenario C is Tesla's whole ADS service in that world: the robotaxi's own
// cars, miles and rides plus eyes-off driving on customer HW4 cars (the
// human's decision, 2026-10-30, which the comments' own definitions
// require). The HW4 lane is drawn as a fork from Tesla's own history line,
// so at the 5th percentile, the median and the 95th percentile it may sit
// nowhere below the robotaxi lane. Until 2026-10-31 it did, for rides (median
// 16.7M against 20.0M, 5th percentile 2.08M against 7.33M) and miles (5th
// percentile 16.8M against 60.2M): its rides had kept the Jan-1-2027
// forecast's numbers, and its miles counted customer cars alone. Since
// 2026-11-03 C's robotaxi part is the robotaxi lane's own A/B mix (the
// section after the rides-corridor check below), so the distribution of C's
// sum lies above the robotaxi lane at every percentile; the lanes drawn here
// put each C component's two parts in one two-piece band through their
// summed edges, whose low side is wider, so this checks the drawn lanes at
// the three percentiles the charts print. (On the 2026-11-03 tables the drawn
// all-HW4 lane falls under the robotaxi lane only below about the 3rd
// percentile: miles 2.8%, rides 2.7%, the fleet under 0.001%.)
{
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(["fleet", "rides", "miles"].map(metric => ({metric,
    curves: fleetDistributionCurves(metric).filter(c => c.historyHelmer === "Tesla")
      .map(c => ({key: c.key, lo90: c.lo90, median: c.median, hi90: c.hi90}))})))`, ctx));
  const below = [];
  for (const {metric, curves} of lanes) {
    const robotaxi = curves.find(c => c.key === "robotaxi"), hw4 = curves.find(c => c.key === "hw4");
    for (const q of ["lo90", "median", "hi90"]) {
      if (!(hw4[q] >= robotaxi[q])) below.push(`${metric} ${q}: all-HW4 ${Math.round(hw4[q]).toLocaleString("en-US")} < robotaxi ${Math.round(robotaxi[q]).toLocaleString("en-US")}`);
    }
  }
  assert.ok(below.length === 0,
    `Replicata: build Tesla's robotaxi and all-HW4 lanes for the fleet, rides and miles forecasts and read each lane's 5th percentile, median and 95th percentile.
Expectata: for every metric, each of the all-HW4 lane's three at or above the robotaxi lane's (C contains the robotaxi's own cars, rides and miles).
Resultata: ${below.join("; ")}.`);
}

// --- 4d. ... and at every percentile inside the charts' 90% interval -------
// The question on which the human settled open question 30 (2026-11-03) put
// the rule as C's curve never sitting below the robotaxi curve. The
// distribution of C's sum meets that at every percentile; the drawn lanes
// (4c) depart from it only in the low tail, under about the 3rd percentile.
// So at every whole percentile from the 5th to the 95th (the span of the
// charts' 90% interval) the drawn all-HW4 lane must sit at or above the
// robotaxi lane, by the quantile function the charts use
// (bandMixtureQuantiles).
{
  const ps = Array.from({length: 91}, (_, i) => (5 + i) / 100);
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(["fleet", "rides", "miles"].map(metric => ({metric,
    q: Object.fromEntries(fleetDistributionCurves(metric).filter(c => c.historyHelmer === "Tesla")
      .map(c => [c.key, bandMixtureQuantiles(c.components, ${JSON.stringify(ps)})]))})))`, ctx));
  const below = [];
  for (const {metric, q} of lanes) {
    const under = ps.filter((_, i) => !(q.hw4[i] >= q.robotaxi[i]));
    if (under.length > 0) below.push(`${metric}: under at ${under.map(p => `${Math.round(100 * p)}%`).join(", ")}`);
  }
  assert.ok(below.length === 0,
    `Replicata: build Tesla's robotaxi and all-HW4 lanes for the fleet, rides and miles forecasts and read each lane's quantiles at every whole percentile from the 5th to the 95th (bandMixtureQuantiles).
Expectata: at each, the all-HW4 lane's at or above the robotaxi lane's.
Resultata: ${below.join("; ")}.`);
}

// No FLEET lane may put 5% of its mass below the LAST OBSERVED floor of its
// helmer, nor its median below the last observed best.
// Tesla's robotaxi lane broke this until 2026-09-26: FLEET_HISTORY's 2026-08
// row (150 [90, 220]) re-based the miles scenarios on 2026-09-04 but not the
// fleet scenario A, which still sat on the mid-2026 ~25-28-car anchor (median
// 180, 5th percentile 79 < 90). The rule held for Tesla alone until
// 2026-10-03, when Zoox's June setting (median 150, sigma 0.45) still put its
// 5th percentile at 72 under a fleet observed at 100 [80, 130] (audit #19).
// Every lane is checked, Tesla's all-HW4 fork against Tesla's history.
{
  const forecastDate = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(fleetDistributionCurves("fleet").map(c => ({
    label: c.legendLabel, helmer: c.historyHelmer, lo90: c.lo90, median: c.median,
    last: FLEET_HISTORY[c.historyHelmer].at(-1)})))`, ctx));
  const below = lanes.filter(l => !(l.lo90 >= l.last.lo && l.median >= l.last.best));
  assert.ok(lanes.length === 4 && below.length === 0,
    `Replicata: compare each fleet lane's forecast for ${forecastDate} with its helmer's latest FLEET_HISTORY observation.
Expectata: in all 4 lanes, 5th percentile >= the observed low edge and median >= the observed best.
Resultata: ${below.map(l => `${l.label}: lo90 ${Math.round(l.lo90)}, median ${Math.round(l.median)} vs ${l.last.month} ${l.last.best} [${l.last.lo}, ${l.last.hi}]`).join("; ")}.`);
}

// Each fleet history runs as far as the evidence the repo holds (audit #87,
// #19): Waymo said "more than 4,000 vehicles" on Sep 1, 2026 (TechCrunch;
// data/vmt.csv's 2026-07..09 Waymo rationales), and Zoox had "about 100
// custom-built robotaxis ... spread across four U.S. cities" on Sep 17, 2026
// (TechCrunch), after recall 26E044000 covered 105 units, its whole deployed
// driverless fleet, on Jul 10. Until 2026-10-03 the histories stopped at
// 2026-05 (Waymo, 3,750) and 2026-06 (Zoox, 100). A stock counted on Sep 1
// or Sep 17 sits at the 2026-09 step, as the fleet forecast sits at its
// date's month (GROWTH_FORECAST_DATE's).
{
  const hist = JSON.parse(vm.runInContext(`JSON.stringify(FLEET_HISTORY)`, ctx));
  const at = (helmer, month) => hist[helmer].find(r => r.month === month);
  const waymo = at("Waymo", "2026-09"), zoox = at("Zoox", "2026-09");
  const problems = [];
  if (!(waymo && waymo.lo >= 4000)) problems.push(`Waymo 2026-09: ${JSON.stringify(waymo)}, want a row whose low edge is at least 4,000 ("more than 4,000 vehicles")`);
  if (!(zoox && zoox.lo <= 100 && 105 <= zoox.hi)) problems.push(`Zoox 2026-09: ${JSON.stringify(zoox)}, want a row whose range holds "about 100" and the Jul-10 recall's 105`);
  for (const helmer of ["Waymo", "Zoox"]) {
    if (hist[helmer].at(-1).month < "2026-09") problems.push(`${helmer}'s history ends at ${hist[helmer].at(-1).month}`);
  }
  assert.ok(problems.length === 0,
    `Replicata: read FLEET_HISTORY's last Waymo and Zoox rows.
Expectata: both run through 2026-09, on the Sep-1 Waymo and Sep-17 Zoox fleet statements.
Resultata: ${problems.join("; ")}.`);
}
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

console.log("qual pass: fleet forecast draws four normalized curves; Tesla split into its robotaxi and all-HW4-ADS scopes");

// --- Tesla's rides scenarios are the miles scenarios over the ride corridor -
// RIDES_FORECAST Tesla A stayed at the 2026-07-22 miles figures when
// MILES_FORECAST A was re-based on 2026-09-04; the two tables are now tied in
// code, so a miles re-base moves rides with it.
{
  const d = vm.runInContext(`(() => {
    const m = MILES_FORECAST.find(f => f.helmer === "Tesla").components.filter(c => c.scope === "robotaxi");
    const r = RIDES_FORECAST.find(f => f.helmer === "Tesla").components.filter(c => c.scope === "robotaxi");
    return {m, r, corridor: TESLA_MILES_PER_RIDE};
  })()`, ctx);
  assert.ok(d.m.length === 2 && d.r.length === 2,
    `Replicata: read the robotaxi-scope Tesla components of MILES_FORECAST and RIDES_FORECAST.
Expectata: two each (A and B).
Resultata: ${d.m.length} / ${d.r.length}.`);
  d.m.forEach((mc, i) => {
    const rc = d.r[i];
    const want = { best: mc.best / d.corridor.best, lo: mc.lo / d.corridor.hi, hi: mc.hi / d.corridor.lo };
    assert.ok(rc.weight === mc.weight && ["best", "lo", "hi"].every(k => Math.abs(rc[k] - want[k]) / want[k] < 1e-9),
      `Replicata: divide Tesla miles scenario ${i === 0 ? "A" : "B"} {${mc.best}, ${mc.lo}, ${mc.hi}} by the [${d.corridor.lo}, ${d.corridor.best}, ${d.corridor.hi}] miles-per-ride corridor.
Expectata: the rides scenario {${want.best}, ${want.lo}, ${want.hi}} with the same weight.
Resultata: {${rc.best}, ${rc.lo}, ${rc.hi}} weight ${rc.weight}.`);
  });
}

// --- Tesla's scenario C is the robotaxi lane's own mix plus eyes-off driving ---
// (the human's decisions, 2026-10-30 and 2026-11-03.) C is Tesla's whole ADS
// service in that world: the robotaxi lane's own scenarios, A or B at their
// relative weights, each plus eyes-off driving on customer HW4 cars
// (crashla.js TESLA_EYES_OFF), edge by edge (the two parts taken as moving
// together). So each table carries one C component (scope "hw4") per robotaxi
// scenario, weighted TESLA_EYES_OFF.weight times that scenario's share of the
// robotaxi weights, and each C component less the eyes-off part is that
// scenario's own robotaxi band in the same table: C contains the robotaxi
// lane by construction. The fleet table's robotaxi bands are
// TESLA_ROBOTAXI_SCENARIOS' daily miles over TESLA_MILES_PER_CAR_DAY
// (car-equivalents, the unit of Tesla's line), and its eyes-off part the
// eyes-off cars times their miles a car-day over the same rate; the miles
// table's eyes-off part is the customer cars' cumulative eyes-off miles, the
// rides table's the Tesla-Network rides on them (cumulative x
// TESLA_EYES_OFF.ridesPerMile). From 2026-10-31 to 2026-11-03 C was one
// component per table, scenario A's robotaxi band alone plus the eyes-off
// part (open question 30); until 2026-10-31 C counted distinct customer cars,
// its miles left out the robotaxi's, and its rides kept the Jan-1-2027
// forecast's.
{
  const d = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const comps = t => t.find(f => f.helmer === "Tesla").components;
    return {fleet: comps(FLEET_FORECAST), miles: comps(MILES_FORECAST), rides: comps(RIDES_FORECAST),
      daily: TESLA_ROBOTAXI_SCENARIOS, eyesOff: TESLA_EYES_OFF, perCarDay: TESLA_MILES_PER_CAR_DAY};
  })())`, ctx));
  const EDGES = ["best", "lo", "hi"];
  const close = (x, y) => Math.abs(x - y) <= 1e-9 * Math.abs(y);
  const eyesOffPart = {
    fleet: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cars[k] * d.eyesOff.milesPerCarDay[k] / d.perCarDay])),
    miles: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cumulative[k]])),
    rides: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cumulative[k] * d.eyesOff.ridesPerMile])),
  };
  const problems = [];
  // The eyes-off part is a band of positive figures, so each C component sits
  // on top of its robotaxi band at every edge.
  for (const metric of ["fleet", "miles", "rides"]) {
    const e = eyesOffPart[metric];
    if (!(0 < e.lo && e.lo <= e.best && e.best <= e.hi)) problems.push(`${metric}: the eyes-off part ${JSON.stringify(e)} is not 0 < lo <= best <= hi`);
  }
  // The fleet table's robotaxi bands, one per scenario in TESLA_ROBOTAXI_SCENARIOS' order.
  const fleetRobotaxi = d.fleet.filter(c => c.scope === "robotaxi");
  if (fleetRobotaxi.length !== d.daily.length || d.daily.some((s, i) => fleetRobotaxi[i].weight !== s.weight
    || EDGES.some(k => !close(fleetRobotaxi[i][k], s[k] / d.perCarDay))))
    problems.push(`fleet: robotaxi bands ${JSON.stringify(fleetRobotaxi)}; want TESLA_ROBOTAXI_SCENARIOS ${JSON.stringify(d.daily)} over ${d.perCarDay}, same weights`);
  for (const metric of ["fleet", "miles", "rides"]) {
    const robotaxi = d[metric].filter(c => c.scope === "robotaxi"), cs = d[metric].filter(c => c.scope === "hw4");
    const robotaxiWeight = robotaxi.reduce((s, c) => s + c.weight, 0);
    if (cs.length !== robotaxi.length) problems.push(`${metric}: ${cs.length} C components for ${robotaxi.length} robotaxi scenarios`);
    const matched = new Set();
    for (const c of cs) {
      const part = Object.fromEntries(EDGES.map(k => [k, c[k] - eyesOffPart[metric][k]]));
      const i = robotaxi.findIndex((r, j) => !matched.has(j) && EDGES.every(k => close(part[k], r[k])));
      if (i < 0) {
        problems.push(`${metric}: C component ${JSON.stringify(c)} less the eyes-off part ${JSON.stringify(eyesOffPart[metric])} is ${JSON.stringify(part)}, no robotaxi scenario's band (${JSON.stringify(robotaxi)})`);
        continue;
      }
      matched.add(i);
      const wantWeight = d.eyesOff.weight * robotaxi[i].weight / robotaxiWeight;
      if (!(Math.abs(c.weight - wantWeight) <= 1e-12)) problems.push(`${metric}: C component on robotaxi scenario ${i} weighs ${c.weight}; want TESLA_EYES_OFF.weight ${d.eyesOff.weight} x ${robotaxi[i].weight} / ${robotaxiWeight} = ${wantWeight}`);
    }
  }
  assert.ok(problems.length === 0,
    `Replicata: read Tesla's components in FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST (scope "robotaxi" and scope "hw4", scenario C), with TESLA_ROBOTAXI_SCENARIOS, TESLA_EYES_OFF and TESLA_MILES_PER_CAR_DAY.
Expectata: the fleet table's robotaxi bands are TESLA_ROBOTAXI_SCENARIOS over TESLA_MILES_PER_CAR_DAY; in every table one C component per robotaxi scenario, each the scenario's own robotaxi band in that table plus the eyes-off part (positive, 0 < lo <= best <= hi), edge by edge (fleet: the eyes-off cars x their miles a car-day / TESLA_MILES_PER_CAR_DAY; miles: TESLA_EYES_OFF.cumulative; rides: TESLA_EYES_OFF.cumulative x TESLA_EYES_OFF.ridesPerMile), weighted TESLA_EYES_OFF.weight x the scenario's weight / the robotaxi weights' sum.
Resultata: ${problems.join("; ")}.`);
}

// --- Waymo's and Zoox's miles low edges hold their newest month flat ---
// MILES_FORECAST's Waymo and Zoox comments set each low edge by one rule: the
// line's newest data/vmt.csv month held flat, that month's miles a day from
// the next day through the day before GROWTH_FORECAST_DATE on top of its
// cumulative, at three significant figures (on October 2026's rows, 426
// days: Waymo 667M; Zoox 7.86M on the rows of 2026-10-31 and 8.01M on the
// joint path of 2026-11-03). Until 2026-11-03 no qual checked the rule and
// each edge was re-derived by hand; this re-derives both from data/vmt.csv,
// so a new month or a revised row moves the edge it sets.
{
  const forecastDate = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
  const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
  const lows = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(["Waymo", "Zoox"].map(h => [h,
    MILES_FORECAST.find(f => f.helmer === h).components.map(c => c.lo)])))`, ctx));
  const problems = [];
  for (const helmer of ["Waymo", "Zoox"]) {
    const own = rows.filter(r => r[0] === helmer.toLowerCase());
    assert.ok(own.length > 0,
      `Replicata: read data/vmt.csv's ${helmer} rows.
Expectata: at least one (the line's newest month sets its forecast's low edge).
Resultata: none.`);
    const newest = own.reduce((a, r) => (r[1] > a[1] ? r : a));
    const [year, month] = newest[1].split("-").map(Number);
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const heldDays = (Date.parse(forecastDate) - Date.UTC(year, month, 1)) / 86400000;
    const flat = Number(newest[3]) + Number(newest[2]) / monthDays * heldDays;
    const want = Number(flat.toPrecision(3));
    if (lows[helmer].length !== 1 || lows[helmer][0] !== want)
      problems.push(`${helmer}: MILES_FORECAST's low edge ${JSON.stringify(lows[helmer])}; want ${want.toLocaleString("en-US")}, ${newest[1]}'s cumulative ${Number(newest[3]).toLocaleString("en-US")} plus its ${Number(newest[2]).toLocaleString("en-US")} miles over its ${monthDays} days held flat for the ${heldDays} days to ${forecastDate} (${Math.round(flat).toLocaleString("en-US")}) at three significant figures`);
  }
  assert.ok(problems.length === 0,
    `Replicata: read MILES_FORECAST's Waymo and Zoox low edges, and each line's newest data/vmt.csv month (its miles and cumulative).
Expectata: each low edge is that month's cumulative plus its miles a day held flat from the next day through the day before ${forecastDate}, at three significant figures.
Resultata: ${problems.join("; ")}.`);
}

console.log("qual pass: Tesla's scenario C is the robotaxi lane's own A/B mix plus the eyes-off part, and Waymo's and Zoox's miles low edges hold their newest month flat");

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

// --- 4. The forecast's qualitative shape is the authored one ---

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
// sum lies at or above the robotaxi lane at every percentile; the lanes
// drawn here put each C component's two parts in one two-piece band through
// their summed edges, whose low side is wider, so this checks the drawn lanes
// at the three percentiles the charts print. (On the 2026-11-03 tables the
// drawn all-HW4 lane falls under the robotaxi lane only below about the 3rd
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
    assert.ok(Array.isArray(q.hw4) && Array.isArray(q.robotaxi),
      `Replicata: build Tesla's ${metric} forecast lanes.
Expectata: a robotaxi lane and an all-HW4 lane.
Resultata: lanes ${JSON.stringify(Object.keys(q))}.`);
    const under = ps.filter((_, i) => !(q.hw4[i] >= q.robotaxi[i]));
    if (under.length > 0) below.push(`${metric}: under at ${under.map(p => `${Math.round(100 * p)}%`).join(", ")}`);
  }
  assert.ok(below.length === 0,
    `Replicata: build Tesla's robotaxi and all-HW4 lanes for the fleet, rides and miles forecasts and read each lane's quantiles at every whole percentile from the 5th to the 95th (bandMixtureQuantiles).
Expectata: at each, the all-HW4 lane's at or above the robotaxi lane's.
Resultata: ${below.join("; ")}.`);
}

// --- 4e. Every lane is drawn as its own density, and each with one peak is
// drawn with one (2026-11-04) ---------------------------------------------
// The distribution chart (renderFleetForecastChart) samples each lane's
// density on one grid of points evenly spaced in ln x and draws the samples
// as a stroke, a fill under it and a median marker. The chart's densities are
// read by keeping the curves it builds (fleetDistributionCurves, wrapped for
// this check and restored after it, as selectedGrowthMetric is to the metric
// it held before the check), each lane's density wrapped to record the
// points the chart asks it for; the grid is the points every lane is asked
// for (each lane is also asked for its density at its median, for the scale
// and its marker). Then, on every metric, for every lane:
//   - the grid has as many points as each stroke, evenly spaced in ln x, and
//     its two ends lie past every lane's 5th and 95th percentiles (the chart
//     frames the lanes' 90% intervals, with a margin);
//   - the lane's samples (the ys the chart keeps on each curve) are its own
//     density, as fleetDistributionCurves built it, at the grid's points;
//   - with x mapped evenly in ln x from the grid's first point at the frame's
//     left edge to its last at the frame's right edge, and y linearly from 0
//     at the frame's bottom to DENSITY_HEADROOM times the tallest of every
//     lane's samples and densities at their medians at its top (the scale the
//     chart's comment states), each point of the lane's stroke is its own
//     density at its grid point, to the path's 0.01 rounding; its fill runs
//     through its stroke's points, closed along the frame's bottom; and its
//     median marker sits at its median and its density there, to the same
//     rounding. Strokes, fills and markers come in the order of the lanes,
//     each in its lane's colour.
// So a fault in how the chart samples, scales or draws any lane turns this
// red. Until later on 2026-11-04 4e read only the samples, matched each lane
// to its stroke by their point counts, and caught only a fault that changed
// the sign of a slope, so a stroke point drawn off its sample (the review's
// mutant STROKEY, Waymo's fleet point 125 drawn at half its sample) passed
// this qual and growth-charts, chart-targets, axis-ticks, fleet-timeseries
// and density-charts; so did a sample off its density that left the slope's
// signs as they were (WAYFLEET2, a 3% dent on the rising side of Waymo's
// fleet lane), and any sample fault on a lane 4e did not read for shape
// (Tesla's robotaxi lanes, and its rides and miles all-HW4 lanes).
// And each lane whose density has one peak, by its construction or by this
// qual's requirement, must rise then fall on the chart's grid: its slope
// changes sign once, from up to down, a step under a millionth of the lane's
// peak carrying the sign before it, as in section 3's count of sign changes
// (which runs on each lane's own grid of 600 points). The lanes read for
// shape: every lane drawn from one band (one two-piece band has one peak;
// today Waymo's rides and miles lanes and Zoox's on all three metrics), and
// the lanes ONE_PEAK_KEYS names: on the fleet metric those whose one peak
// section 4 requires (Waymo's, from its base and plan bands, Zoox's and
// Tesla's all-HW4 lane), and on rides and miles Tesla's all-HW4 lanes, built
// as the fleet's (C on A and C on B since 2026-11-03), each with one peak at
// every share of B in the lane from 0 to 0.95 on today's tables. Tesla's
// robotaxi lanes (A and B) are not read for shape: they have the peaks A's
// and B's bands and weights give, on today's tables (on a fine grid) a second
// hump on the fleet metric for B's share of the lane (0.16 today) from about
// 0.34 to 0.63 and on miles from about 0.38 to 0.68, none on rides at any
// share up to 0.95, and nothing requires their shape since section 4
// stopped requiring a second hump of the fleet's robotaxi lane on 2026-10-29
// (the human's re-pin, B then a shoulder). On 2026-11-04 this first required
// one sign change of every drawn lane; later that day it read only the lanes
// drawn from one band, which left out Waymo's fleet lane, then those and the
// fleet lanes section 4 requires one peak of, and then, with the drawing
// checks above, Tesla's rides and miles all-HW4 lanes too.
{
  const drawn = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const build = fleetDistributionCurves;
    const shown = selectedGrowthMetric;
    let built = null;
    fleetDistributionCurves = metric => (built = build(metric).map(c => {
      const own = c.densityFn, calls = [];
      return {...c, own, calls, densityFn: x => { calls.push(x); return own(x); }};
    }));
    try {
      return ["fleet", "rides", "miles"].map(metric => {
        selectedGrowthMetric = metric;
        built = null;
        const svg = renderFleetForecastChart();
        return {metric, svg, lanes: built?.map(c => ({key: c.key, label: c.legendLabel, color: c.color,
          bands: c.components.length, median: c.median, lo90: c.lo90, hi90: c.hi90, ys: c.ys,
          calls: c.calls, ownAtCalls: c.calls.map(x => c.own(x)), ownAtMedian: c.own(c.median)}))};
      });
    } finally {
      fleetDistributionCurves = build;
      selectedGrowthMetric = shown;
    }
  })())`, ctx));
  const HEADROOM = vm.runInContext("DENSITY_HEADROOM", ctx);
  // toFixed(2)'s rounding, plus float slack.
  const ROUNDING = 0.005 + 1e-9;
  const near = (a, b) => Math.abs(a - b) <= ROUNDING;
  const num = v => Number(v.toFixed(4));
  for (const {metric, svg, lanes} of drawn) {
    const clip = (svg.match(/<clipPath id="fleet-clip"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/) || []).slice(1).map(Number);
    const strokes = [...svg.matchAll(/<path d="(M [^"]*)" style="stroke:([^;"]*)[;"]/g)]
      .map(m => ({d: m[1], color: m[2], points: m[1].slice(2).split(" L ").map(p => p.split(" ").map(Number))}));
    const fills = [...svg.matchAll(/<path d="(M [^"]*)" style="fill:([^;"]*)[;"]/g)].map(m => ({d: m[1], color: m[2]}));
    const markers = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.]+" class="month-dot" style="fill:([^"]*)"/g)]
      .map(m => ({cx: Number(m[1]), cy: Number(m[2]), color: m[3]}));
    const counts = {lanes: lanes?.length, strokes: strokes.length, fills: fills.length, markers: markers.length};
    assert.ok(Array.isArray(lanes) && lanes.length > 0 && clip.length === 4
      && [strokes, fills, markers].every(marks => marks.length === lanes.length),
      `Replicata: render the ${metric} distribution chart (renderFleetForecastChart), keep the curves it builds through fleetDistributionCurves, and read its frame (the fleet-clip rectangle), strokes, fills and median markers.
Expectata: a frame, and one stroke, one fill and one marker per curve.
Resultata: frame ${JSON.stringify(clip)}, counts ${JSON.stringify(counts)}.`);
    const [left, top, width, height] = clip, bottom = top + height;
    // The grid: the points every lane's density was asked for, in the order
    // the first lane was asked for them.
    const asked = lanes.map(l => new Set(l.calls));
    const grid = [...new Set(lanes[0].calls.filter(x => asked.every(s => s.has(x))))];
    const n = grid.length, span = Math.log(grid[n - 1]) - Math.log(grid[0]), step = span / (n - 1);
    const uneven = grid.slice(1).map((x, i) => i).filter(i => !(Math.abs(Math.log(grid[i + 1]) - Math.log(grid[i]) - step) <= 1e-9 * step));
    const unframed = lanes.filter(l => !(grid[0] < l.lo90 && l.hi90 < grid[n - 1]));
    // Not finite: a sample, or the lane's own density at a point it was asked for or at its median.
    const nonFinite = lanes.filter(l => ![...(l.ys ?? [NaN]), ...l.ownAtCalls, l.ownAtMedian].every(Number.isFinite));
    assert.ok(n > 1 && strokes.every(s => s.points.length === n) && lanes.every(l => l.ys?.length === n)
      && uneven.length === 0 && unframed.length === 0 && nonFinite.length === 0,
      `Replicata: render the ${metric} distribution chart (renderFleetForecastChart) and record the points it asks each lane's density for.
Expectata: a grid (the points every lane is asked for) with as many points as each stroke and each lane's samples, evenly spaced in ln x, its ends past every lane's 5th and 95th percentiles; every sample, and each lane's own density at each point it was asked for, finite.
Resultata: ${n} grid points from ${grid[0]} to ${grid[n - 1]}; stroke points ${JSON.stringify(strokes.map(s => s.points.length))}; samples ${JSON.stringify(lanes.map(l => l.ys?.length))}; uneven steps after points ${JSON.stringify(uneven.slice(0, 10))}; lanes whose 5th-95th percentiles reach past the grid ${JSON.stringify(unframed.map(l => [l.label, l.lo90, l.hi90]))}; lanes with a value not finite ${JSON.stringify(nonFinite.map(l => l.label))}.`);
    // Each lane's own density at the grid's points, from its recorded calls.
    const own = lanes.map(l => grid.map(x => l.ownAtCalls[l.calls.indexOf(x)]));
    const yMax = Math.max(...lanes.flatMap((l, i) => [...own[i], l.ownAtMedian]));
    const mapX = x => left + (Math.log(x) - Math.log(grid[0])) / span * width;
    const mapY = y => top + height * (1 - y / (yMax * HEADROOM));
    const problems = [];
    lanes.forEach((l, i) => {
      const peak = Math.max(...own[i]);
      const offSamples = own[i].map((y, j) => j).filter(j => !(Math.abs(l.ys[j] - own[i][j]) <= 1e-9 * Math.abs(own[i][j]) + 1e-15 * peak));
      if (offSamples.length > 0) problems.push(`${l.label}: samples off its density at grid points ${JSON.stringify(offSamples.slice(0, 5))} (first: ${l.ys[offSamples[0]]} against ${own[i][offSamples[0]]})`);
      const stroke = strokes[i], fill = fills[i], marker = markers[i];
      for (const [what, mark] of [["stroke", stroke], ["fill", fill], ["marker", marker]]) {
        if (mark.color !== l.color) problems.push(`${l.label}: ${what} ${i + 1} in ${mark.color}, the lane's colour ${l.color}`);
      }
      const offPoints = stroke.points.map((p, j) => j).filter(j => !(near(stroke.points[j][0], mapX(grid[j])) && near(stroke.points[j][1], mapY(own[i][j]))));
      if (offPoints.length > 0) {
        const j = offPoints[0];
        problems.push(`${l.label}: stroke points ${JSON.stringify(offPoints.slice(0, 5))} off the lane's density (first: (${stroke.points[j].join(", ")}) against (${num(mapX(grid[j]))}, ${num(mapY(own[i][j]))}))`);
      }
      const wantFill = `M ${stroke.points[0][0].toFixed(2)} ${bottom.toFixed(2)} L ${stroke.d.slice(2)} L ${stroke.points[n - 1][0].toFixed(2)} ${bottom.toFixed(2)} Z`;
      if (fill.d !== wantFill) problems.push(`${l.label}: its fill is not its stroke's points closed along the frame's bottom (y ${bottom})`);
      if (!(near(marker.cx, mapX(l.median)) && near(marker.cy, mapY(l.ownAtMedian)))) {
        problems.push(`${l.label}: median marker at (${marker.cx}, ${marker.cy}) against its median and its density there (${num(mapX(l.median))}, ${num(mapY(l.ownAtMedian))})`);
      }
    });
    assert.ok(problems.length === 0,
      `Replicata: render the ${metric} distribution chart (renderFleetForecastChart), keep the curves it builds and record the points it asks each lane's density for, then compare each lane's samples, stroke, fill and median marker with its own density.
Expectata: for every lane, its samples are its own density at the grid's points, and, with x evenly in ln x from the grid's first point at the frame's left edge (${left}) to its last at the right edge (${left + width}) and y linear from 0 at the frame's bottom (${bottom}) to DENSITY_HEADROOM (${HEADROOM}) times the tallest sample or median density of any lane (${yMax}) at its top (${top}), its stroke's points are its density at the grid points, its fill runs through them closed along the bottom, and its median marker sits at its median and its density there, each to the path's 0.01 rounding; strokes, fills and markers in the order of the lanes and in each lane's colour.
Resultata: ${problems.join("; ")}.`);
  }
  // The slope's runs on the grid: a new run starts where a step's sign
  // differs from the run before it; a step under a millionth of the lane's
  // peak carries the run before it.
  const slopeRuns = ys => {
    const peak = Math.max(...ys);
    const runs = [];
    for (let i = 1; i < ys.length; i++) {
      const step = ys[i] - ys[i - 1];
      if (Math.abs(step) < peak * 1e-6) continue;
      if (runs.length === 0 || runs.at(-1).sign !== Math.sign(step)) runs.push({sign: Math.sign(step), from: i});
    }
    return runs;
  };
  const SLOPE = {"1": "up", "-1": "down", "0": "flat"};
  // The lanes drawn from several bands that must have one peak, by metric:
  // on the fleet metric those section 4 requires one sign change of (its
  // Waymo, Zoox and all-HW4 asserts); on rides and miles Tesla's all-HW4
  // lanes, built as the fleet's.
  const ONE_PEAK_KEYS = {fleet: ["Waymo", "Zoox", "hw4"], rides: ["hw4"], miles: ["hw4"]};
  const onePeak = l => l.bands === 1 || ONE_PEAK_KEYS[l.metric].includes(l.key);
  const all = drawn.flatMap(({metric, lanes}) => lanes.map(lane => ({metric, key: lane.key, label: lane.label, bands: lane.bands, ys: lane.ys})));
  const read = all.filter(onePeak).map(l => ({...l, points: l.ys.length, runs: slopeRuns(l.ys)}));
  const skipped = all.filter(l => !onePeak(l));
  // Each lane ONE_PEAK_KEYS names is drawn (rule 12: a renamed key or metric
  // would leave it unread and pass silently); each metric so has a lane read.
  const unread = Object.entries(ONE_PEAK_KEYS).flatMap(([metric, keys]) => keys
    .filter(key => !read.some(l => l.metric === metric && l.key === key)).map(key => `${metric}: no lane keyed ${key}`));
  assert.ok(unread.length === 0,
    `Replicata: render the growth section's distribution chart (renderFleetForecastChart) for the fleet, rides and miles metrics, and list the drawn lanes read for shape (those drawn from one band, and those ONE_PEAK_KEYS names: ${JSON.stringify(ONE_PEAK_KEYS)}).
Expectata: on each metric, a lane keyed each of its ONE_PEAK_KEYS.
Resultata: ${unread.join("; ")} (the lanes drawn, by key, and their band counts: ${all.map(l => `${l.metric} ${l.key} ${l.bands}`).join(", ")}).`);
  const failing = read.filter(l => !(l.runs.length === 2 && l.runs[0].sign === 1 && l.runs[1].sign === -1));
  assert.ok(failing.length === 0,
    `Replicata: render the growth section's distribution chart (renderFleetForecastChart) for the fleet, rides and miles metrics, and read each drawn lane's density on the chart's grid (the curves the chart builds).
Expectata: each of the ${read.length} lanes whose density has one peak (${read.map(l => `${l.metric} ${l.label}`).join(", ")}: those drawn from one band, and those ONE_PEAK_KEYS names) rises then falls on that grid: its slope changes sign once, from up to down, a step under a millionth of the lane's peak carrying the sign before it. The ${skipped.length} other lanes (${skipped.map(l => `${l.metric} ${l.label}`).join(", ")}), each drawn from several bands and named nowhere in ONE_PEAK_KEYS, are not read for shape.
Resultata: ${failing.map(l => `${l.metric} ${l.label}: ${l.runs.map(r => `${SLOPE[r.sign]} from grid point ${r.from}`).join(", ")} (of ${l.points})`).join("; ")}.`);
}

// --- 4f. 4d's rule from the 4th percentile to the 99.9th (2026-11-04) ------
// 4d reads Tesla's two lanes at the whole percentiles of the charts' 90%
// interval. The drawn all-HW4 lane departs from the rule 4d states (C's curve
// never below the robotaxi curve) only in the low tail (crashla.js's comment
// above TESLA_ROBOTAXI_SCENARIOS): on the 2026-11-03 tables it falls under
// the robotaxi lane below about the 3rd percentile (miles 2.8%, rides 2.7%,
// the fleet under 0.001%) and sits at or above it everywhere above that. So
// at every tenth of a percentile from the 4th to the 99.9th it must sit at or
// above the robotaxi lane, by the quantile function the charts use
// (bandMixtureQuantiles): a crossing between whole percentiles, one past the
// 95th, or the low tail's crossing moving up past the 4th turns this red
// where 4d stays green.
{
  const ps = Array.from({length: 960}, (_, i) => (40 + i) / 1000);
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(["fleet", "rides", "miles"].map(metric => ({metric,
    q: Object.fromEntries(fleetDistributionCurves(metric).filter(c => c.historyHelmer === "Tesla")
      .map(c => [c.key, bandMixtureQuantiles(c.components, ${JSON.stringify(ps)})]))})))`, ctx));
  const pct = p => `${(100 * p).toFixed(1)}%`;
  // Runs of consecutive grid points, printed as their spans of percentiles.
  const spans = idx => idx.reduce((runs, i) => {
    if (runs.length > 0 && runs.at(-1)[1] === i - 1) runs.at(-1)[1] = i;
    else runs.push([i, i]);
    return runs;
  }, []).map(([a, b]) => `${pct(ps[a])} to ${pct(ps[b])}`).join(", ");
  const below = [];
  for (const {metric, q} of lanes) {
    assert.ok(Array.isArray(q.hw4) && q.hw4.length === ps.length && Array.isArray(q.robotaxi) && q.robotaxi.length === ps.length,
      `Replicata: build Tesla's ${metric} forecast lanes and read their quantiles at ${ps.length} percentiles (bandMixtureQuantiles).
Expectata: a robotaxi lane and an all-HW4 lane, ${ps.length} quantiles each.
Resultata: quantiles per lane ${JSON.stringify(Object.fromEntries(Object.entries(q).map(([key, v]) => [key, v.length])))}.`);
    const under = ps.map((_, i) => i).filter(i => !(q.hw4[i] >= q.robotaxi[i]));
    if (under.length > 0) {
      const farthest = under.reduce((a, i) => (q.hw4[i] / q.robotaxi[i] < q.hw4[a] / q.robotaxi[a] ? i : a));
      below.push(`${metric}: under at ${under.length} of ${ps.length} percentiles (${spans(under)}), farthest at ${pct(ps[farthest])}: all-HW4 ${Math.round(q.hw4[farthest]).toLocaleString("en-US")} against robotaxi ${Math.round(q.robotaxi[farthest]).toLocaleString("en-US")}`);
    }
  }
  assert.ok(below.length === 0,
    `Replicata: build Tesla's robotaxi and all-HW4 lanes for the fleet, rides and miles forecasts and read each lane's quantiles at every tenth of a percentile from the 4th to the 99.9th (bandMixtureQuantiles).
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

console.log("qual pass: fleet forecast draws four normalized curves; Tesla split into its robotaxi and all-HW4-ADS scopes; on every metric every lane is drawn as its own density on the chart's grid and scale (its samples, stroke, fill and median marker), and every lane with one peak (each drawn from one band, the fleet's Waymo lane and every all-HW4 lane) rises then falls on that grid; Tesla's all-HW4 lane sits at or above its robotaxi lane from the 4th percentile to the 99.9th");

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

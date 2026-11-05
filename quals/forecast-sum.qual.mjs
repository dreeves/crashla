// Tesla's scenario C is the comonotonic sum of its two parts (the human's
// decision, 2026-11-04: "Hold exactly"): each C component's p-quantile is its
// robotaxi scenario's p-quantile plus the eyes-off band's, at every p, on all
// three growth metrics (crashla.js, TESLA_EYES_OFF and the forecast tables),
// so Tesla's all-HW4 lane sits at or above its robotaxi lane at every
// percentile (fleet-forecast.qual.mjs, 4f). Until then each C component was
// one two-piece band through its parts' summed edges: on the tables of
// 2026-11-03 the all-HW4 lane printed fleet 50,200 [5,860, 324,000]
// car-equivalents, miles 810M [87.1M, 6.06B] and rides 38.1M [8.78M, 176M]
// for Jan 1, 2028, where the sum gives 48,400 [5,870, 319,000], 571M [84.7M,
// 5.22B] and 30.2M [8.37M, 155M].
//
// Every figure here is computed independently of the app's quantile and
// density machinery: each two-piece band's CDF in closed form (mode at its
// best, lo and hi 1.6449 sigmas out on their own sides, in ln x), with the
// normal CDF from Numerical Recipes' erfc (fractional error under 1.2e-7);
// a band's quantile by bisection on its CDF; and a two-part comonotonic sum's
// CDF at x as the level at which its parts' quantiles add to x, the crossing
// F_R(y) = F_E(x - y) found by bisection on y. The checks:
//  1. each C component's quantiles (the app's, bandMixtureQuantiles on that
//     component alone) are the sum of its parts' at 999 levels, from 0.001 to
//     0.999, with the parts taken from first principles (the robotaxi
//     scenario's band in the table's unit: TESLA_ROBOTAXI_SCENARIOS over
//     TESLA_MILES_PER_CAR_DAY for the fleet, their cumulative miles on
//     teslaCumulativeMiles' path for miles, those over the miles-per-ride
//     corridor (teslaRidesBand) for rides; and the eyes-off band: its cars
//     times their miles a car-day over TESLA_MILES_PER_CAR_DAY,
//     TESLA_EYES_OFF.cumulative, and that times its rides a mile);
//  2. every drawn lane's density (the app's, as the distribution chart draws
//     it) integrates to 1 within 1e-3, and to its printed 5th, 50th and 95th
//     percentiles within 1e-3 of 0.05, 0.5 and 0.95 (Simpson's rule in ln x);
//  3. every drawn lane's printed 5th, 50th and 95th percentiles are within
//     0.1% of this computation's quantiles of the lane: Tesla's two lanes
//     from first principles (as in 1, the robotaxi lane A and B at their
//     relative weights, the all-HW4 lane C on A and C on B at the same
//     relative weights), Waymo's and Zoox's from their tables' bands.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object, JSON, Array, String, Date, Set, Intl,
  document: { getElementById() { return { textContent: "", innerHTML: "" }; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

const METRICS = ["fleet", "miles", "rides"];
const TABLE = { fleet: "FLEET_FORECAST", miles: "MILES_FORECAST", rides: "RIDES_FORECAST" };
const LEVELS = Array.from({length: 999}, (_, i) => (i + 1) / 1000);
const EDGES = ["best", "lo", "hi"];
const app = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const perCarDay = b => ({ best: b.best / TESLA_MILES_PER_CAR_DAY, lo: b.lo / TESLA_MILES_PER_CAR_DAY, hi: b.hi / TESLA_MILES_PER_CAR_DAY });
  const eyes = TESLA_EYES_OFF;
  const tables = {fleet: FLEET_FORECAST, miles: MILES_FORECAST, rides: RIDES_FORECAST};
  return {
    weights: TESLA_ROBOTAXI_SCENARIOS.map(s => s.weight),
    robotaxi: {
      fleet: TESLA_ROBOTAXI_SCENARIOS.map(perCarDay),
      miles: TESLA_ROBOTAXI_SCENARIOS.map(teslaCumulativeMiles),
      rides: TESLA_ROBOTAXI_SCENARIOS.map(s => teslaRidesBand(teslaCumulativeMiles(s))),
    },
    eyesOff: {
      fleet: {best: eyes.cars.best * eyes.milesPerCarDay.best / TESLA_MILES_PER_CAR_DAY,
        lo: eyes.cars.lo * eyes.milesPerCarDay.lo / TESLA_MILES_PER_CAR_DAY, hi: eyes.cars.hi * eyes.milesPerCarDay.hi / TESLA_MILES_PER_CAR_DAY},
      miles: eyes.cumulative,
      rides: {best: eyes.cumulative.best * eyes.ridesPerMile, lo: eyes.cumulative.lo * eyes.ridesPerMile, hi: eyes.cumulative.hi * eyes.ridesPerMile},
    },
    // Each C component's quantiles at LEVELS, by the app, the component alone.
    cQuantiles: Object.fromEntries(Object.entries(tables).map(([metric, t]) => [metric,
      t.find(f => f.helmer === "Tesla").components.filter(c => c.scope === "hw4")
        .map(c => bandMixtureQuantiles([{...c, weight: 1}], ${JSON.stringify(LEVELS)}))])),
    lanes: Object.fromEntries(Object.keys(tables).map(metric => [metric, fleetDistributionCurves(metric).map(c => ({
      key: c.key, label: c.legendLabel, helmer: c.historyHelmer, lo90: c.lo90, median: c.median, hi90: c.hi90}))])),
    others: Object.fromEntries(Object.entries(tables).map(([metric, t]) => [metric,
      Object.fromEntries(t.filter(f => f.helmer !== "Tesla").map(f => [f.helmer, f.components]))])),
  };
})())`, ctx));

// --- The independent two-piece machinery ------------------------------------
// The normal CDF from Numerical Recipes' erfcc (fractional error < 1.2e-7).
const erfc = x => {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
};
const Phi = z => 0.5 * erfc(-z / Math.SQRT2);
const Z90 = 1.6449; // a band's lo and hi sit this many sigmas from its mode
const shape = b => {
  const mu = Math.log(b.best);
  return {mu, a: Math.max((mu - Math.log(b.lo)) / Z90, 1e-6), c: Math.max((Math.log(b.hi) - mu) / Z90, 1e-6)};
};
// A band's CDF at ln x = u.
const bandCdf = (b, u) => {
  const {mu, a, c} = shape(b);
  return u < mu ? 2 * a / (a + c) * Phi((u - mu) / a) : 1 - 2 * c / (a + c) * Phi(-(u - mu) / c);
};
// The u at which an increasing f reaches target, by bisection on [lo, hi].
const bisect = (f, target, lo, hi, n = 100) => {
  for (let i = 0; i < n; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < target) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
};
// A band's quantile at level p, as x.
const bandQuantile = (b, p) => {
  const {mu, a, c} = shape(b);
  return Math.exp(bisect(u => bandCdf(b, u), p, mu - 40 * a, mu + 40 * c));
};
// A component's CDF at x: one band's in closed form; two parts' comonotonic
// sum at the level where F_R(y) = F_E(x - y), the crossing found by
// bisection on y = x / (1 + e^-s), so x - y = x / (1 + e^s) keeps its
// precision too.
const componentCdf = (parts, x) => {
  assert.ok(parts.length === 1 || parts.length === 2,
    `Replicata: compute a forecast component's CDF in this qual.
Expectata: a component of one part or two (this qual's independent sum reads two; scenario C has two).
Resultata: ${parts.length} parts: ${JSON.stringify(parts)}.`);
  if (parts.length === 1) return bandCdf(parts[0], Math.log(x));
  const [r, e] = parts;
  const s = bisect(s => bandCdf(r, Math.log(x) - Math.log1p(Math.exp(-s))) - bandCdf(e, Math.log(x) - Math.log1p(Math.exp(s))), 0, -200, 200);
  return bandCdf(r, Math.log(x) - Math.log1p(Math.exp(-s)));
};
// A lane's quantile at level p: components [{weight, parts}], weights summing to 1.
const laneQuantile = (components, p) =>
  Math.exp(bisect(u => components.reduce((F, k) => F + k.weight * componentCdf(k.parts, Math.exp(u)), 0), p, Math.log(1e-3), Math.log(1e14)));

const problems = [];
const fmt = v => Number(v.toPrecision(6)).toLocaleString("en-US");

// --- 1. Each C component's quantiles are its parts' summed ------------------
const IDENTITY_TOLERANCE = 1e-5; // this qual's quantiles are good to ~1e-6
for (const metric of METRICS) {
  const cs = app.cQuantiles[metric];
  if (cs.length !== app.weights.length) {
    problems.push(`${metric}: ${cs.length} C components (scope hw4) in ${TABLE[metric]} for ${app.weights.length} robotaxi scenarios`);
    continue;
  }
  cs.forEach((q, i) => {
    const r = app.robotaxi[metric][i], e = app.eyesOff[metric];
    const off = LEVELS.map((p, j) => ({p, got: q[j], want: bandQuantile(r, p) + bandQuantile(e, p)}))
      .filter(({got, want}) => !(Math.abs(got / want - 1) <= IDENTITY_TOLERANCE));
    if (off.length > 0) {
      const worst = off.reduce((w, o) => (Math.abs(o.got / o.want - 1) > Math.abs(w.got / w.want - 1) ? o : w));
      problems.push(`${metric}: C component ${i + 1} (on robotaxi scenario ${i + 1}, ${JSON.stringify(r)}, and the eyes-off band ${JSON.stringify(e)}) off the sum of its parts' quantiles at ${off.length} of ${LEVELS.length} levels, worst at ${worst.p}: ${fmt(worst.got)} against ${fmt(worst.want)} (x${(worst.got / worst.want).toFixed(4)})`);
    }
  });
}

// --- 2. Each drawn lane's density is normalized, and its printed
// percentiles are its own -----------------------------------------------------
const MASS_TOLERANCE = 1e-3;
// Simpson's rule on n (even) intervals of [a, b].
const simpson = (f, a, b, n) => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return s * h / 3;
};
const integrals = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const simpson = ${simpson.toString()};
  return Object.fromEntries(${JSON.stringify(METRICS)}.map(metric => [metric, fleetDistributionCurves(metric).map(c => {
    const g = u => c.densityFn(Math.exp(u));
    const a = Math.log(c.lo90) - 15, b = Math.log(c.hi90) + 15;
    return {label: c.legendLabel, mass: simpson(g, a, b, 4000),
      at: [c.lo90, c.median, c.hi90].map(q => simpson(g, a, Math.log(q), 4000))};
  })]));
})())`, ctx));
for (const metric of METRICS) {
  for (const lane of integrals[metric]) {
    if (!(Math.abs(lane.mass - 1) <= MASS_TOLERANCE)) problems.push(`${metric} ${lane.label}: its density integrates to ${lane.mass} over its 5th-95th percentiles widened by 15 in ln x on each side`);
    [0.05, 0.5, 0.95].forEach((p, i) => {
      if (!(Math.abs(lane.at[i] - p) <= MASS_TOLERANCE)) problems.push(`${metric} ${lane.label}: its density integrates to ${lane.at[i]} up to its printed ${100 * p}th percentile`);
    });
  }
}

// --- 3. Each drawn lane's printed percentiles, computed independently --------
const PERCENTILE_TOLERANCE = 1e-3;
const robotaxiShare = app.weights.map(w => w / app.weights.reduce((s, v) => s + v, 0));
for (const metric of METRICS) {
  const want = {
    robotaxi: robotaxiShare.map((w, i) => ({weight: w, parts: [app.robotaxi[metric][i]]})),
    hw4: robotaxiShare.map((w, i) => ({weight: w, parts: [app.robotaxi[metric][i], app.eyesOff[metric]]})),
  };
  for (const lane of app.lanes[metric]) {
    const comps = lane.helmer === "Tesla" ? want[lane.key] : app.others[metric][lane.helmer];
    const malformed = comps === undefined || !comps.every(k => Array.isArray(k.parts) && k.parts.length > 0);
    if (malformed) {
      problems.push(`${metric} ${lane.label}: no components of parts to compute it from (${JSON.stringify(comps)})`);
      continue;
    }
    const total = comps.reduce((s, k) => s + k.weight, 0);
    const lanes = comps.map(k => ({...k, weight: k.weight / total}));
    [[0.05, "lo90"], [0.5, "median"], [0.95, "hi90"]].forEach(([p, key]) => {
      const exact = laneQuantile(lanes, p);
      if (!(Math.abs(lane[key] / exact - 1) <= PERCENTILE_TOLERANCE))
        problems.push(`${metric} ${lane.label}: its printed ${100 * p}th percentile ${fmt(lane[key])} against ${fmt(exact)} computed here (x${(lane[key] / exact).toFixed(4)})`);
    });
  }
}

assert.ok(problems.length === 0,
  `Replicata: build the growth forecasts (crashla.js FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST) and their drawn lanes, and compute the figures this qual's header describes with closed-form two-piece CDFs and bisection.
Expectata: (1) each C component's quantile at each of ${LEVELS.length} levels from 0.001 to 0.999 is its robotaxi scenario's band's quantile plus the eyes-off band's, within ${IDENTITY_TOLERANCE} (relative); (2) each drawn lane's density integrates to 1, and to its printed 5th, 50th and 95th percentiles 0.05, 0.5 and 0.95, each within ${MASS_TOLERANCE}; (3) each drawn lane's printed 5th, 50th and 95th percentiles within ${100 * PERCENTILE_TOLERANCE}% of this qual's (Tesla's lanes from first principles, Waymo's and Zoox's from their tables).
Resultata: ${problems.length} problems: ${problems.join("; ")}.`);

console.log(`qual pass: each of Tesla's scenario-C components is the comonotonic sum of its robotaxi scenario's band and the eyes-off band at ${LEVELS.length} levels on all three growth metrics, and every drawn lane's density is normalized and its printed percentiles match an independent computation within ${100 * PERCENTILE_TOLERANCE}%`);

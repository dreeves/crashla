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
// This qual's own figures are computed independently of the app's quantile
// and density machinery: each two-piece band's CDF in closed form (mode at its
// best, lo and hi 1.6449 sigmas out on their own sides, in ln x), with the
// normal CDF from Numerical Recipes' erfc (fractional error under 1.2e-7), and
// its density over ln x in closed form; a band's quantile by bisection on its
// CDF; and a two-part comonotonic sum's CDF at x as the level at which its
// parts' quantiles add to x, the crossing F_R(y) = F_E(x - y) found by
// bisection on y, and its density over ln x there as x over the sum of each
// part's quantile over its density (the sum's quantile moves with the level
// by its parts' moves added, each a quantile over its density over ln x).
// First, every metric must draw one lane per helmer and scope of its table
// (until the sixth fix run's third review, 2026-11-05, a
// fleetDistributionCurves that drew no lanes left 2-4 nothing to read, and
// this qual green). The checks:
//  1. each C component's quantiles (the app's, bandMixtureQuantiles on that
//     component alone) are the sum of its parts' at 999 levels, from 0.001 to
//     0.999, with the parts taken from first principles (the robotaxi
//     scenario's band in the table's unit: TESLA_ROBOTAXI_SCENARIOS over
//     TESLA_MILES_PER_CAR_DAY for the fleet, their cumulative miles on
//     teslaCumulativeMiles' path for miles, those over the miles-per-ride
//     corridor (teslaRidesBand) for rides; and the eyes-off band: its cars
//     times their miles a car-day over TESLA_MILES_PER_CAR_DAY,
//     TESLA_EYES_OFF.cumulative, and that times its rides a mile); the C
//     components are paired with distinct robotaxi scenarios in whatever
//     order the table lists them, by the pairing whose sums they are off at
//     the fewest levels in all (until the sixth fix run's second review,
//     2026-11-05, each in turn with the unpaired scenario it was off at the
//     fewest, so that a faulty first component could take a correct second
//     one's scenario and have it reported off; until its first review,
//     2026-11-04, the n-th with the n-th, so a table listing them in another
//     order, the same mixture, read as off);
//  2. every drawn lane's density (the app's, as the distribution chart draws
//     it) integrates to 1 within 1e-3 over its 5th to 95th percentiles
//     widened by 15 in ln x on each side, and to its printed 5th, 50th and
//     95th percentiles within 1e-3 of 0.05, 0.5 and 0.95 (Simpson's rule in
//     ln x, on pieces that follow the lane's mass: between its own quantiles,
//     this qual's, and the places its components' densities change side;
//     until 2026-11-07 on a fixed grid, which misread narrow or one-sided
//     bands): each lane is read whole, since the distribution chart's frame,
//     every lane's 90% interval widened 1.6 times, holds 97.8-98.2% of the
//     all-HW4 lanes (about 98% before the sum too) and 99.3-99.9% of the
//     fleet's and the rides' Zoox lanes and the rides' robotaxi lane;
//  3. every drawn lane's printed 5th, 50th and 95th percentiles are within
//     0.1% of this computation's quantiles of the lane: Tesla's two lanes
//     from first principles (as in 1, the robotaxi lane A and B at their
//     relative weights, the all-HW4 lane C on A and C on B at the same
//     relative weights), Waymo's and Zoox's from their tables' bands;
//  4. every drawn lane's density (as in 2) is this computation's density of
//     the lane (its components as in 3) within 1e-5, relative, at 199 points
//     evenly spaced in ln x from its 0.5th to its 99.5th percentile (this
//     computation's): a fault in the density that its integrals in 2 do not
//     see shows here (until the sixth fix run's first review, 2026-11-04, no
//     check compared the drawn density point by point with one computed
//     apart from the app's).
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
const app = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const perCarDay = b => ({ best: b.best / TESLA_MILES_PER_CAR_DAY, lo: b.lo / TESLA_MILES_PER_CAR_DAY, hi: b.hi / TESLA_MILES_PER_CAR_DAY });
  const eyes = TESLA_EYES_OFF;
  const tables = {fleet: FLEET_FORECAST, miles: MILES_FORECAST, rides: RIDES_FORECAST};
  // Tesla's entry of a table, read, never assumed (until 2026-11-06 a table
  // without one stopped this qual on a TypeError naming nothing). assert is
  // crashla.js's, which throws its message with the details appended.
  const teslaEntry = (metric, t) => {
    const entry = t.find(f => f.helmer === "Tesla");
    assert(entry !== undefined, "Replicata: read the " + metric + " forecast table (FLEET_FORECAST, MILES_FORECAST or RIDES_FORECAST) and find Tesla's entry.\\nExpectata: one, its components the scenarios this check sums.\\nResultata: none; the table's helmers are", t.map(f => f.helmer));
    return entry;
  };
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
      teslaEntry(metric, t).components.filter(c => c.scope === "hw4")
        .map(c => bandMixtureQuantiles([{...c, weight: 1}], ${JSON.stringify(LEVELS)}))])),
    lanes: Object.fromEntries(Object.keys(tables).map(metric => [metric, fleetDistributionCurves(metric).map(c => ({
      key: c.key, label: c.legendLabel, helmer: c.historyHelmer, lo90: c.lo90, median: c.median, hi90: c.hi90}))])),
    // Each table's helmers and scopes: an entry's components' scope, or the
    // helmer's name where a component has none.
    tableLanes: Object.fromEntries(Object.entries(tables).map(([metric, t]) => [metric,
      t.flatMap(entry => [...new Set(entry.components.map(c => c.scope ?? entry.helmer))])])),
    others: Object.fromEntries(Object.entries(tables).map(([metric, t]) => [metric,
      Object.fromEntries(t.filter(f => f.helmer !== "Tesla").map(f => [f.helmer, f.components]))])),
  };
})())`, ctx));

// Every metric draws one lane per helmer and scope of its table, so that 2-4
// read every lane. The lists are compared as sets (sorted), not in order:
// the chart may draw the lanes in any order (until 2026-11-07 the table's
// order was required, so a correct reordering, the conditional lane drawn
// last, was red).
const undrawn = METRICS.filter(m => !(app.tableLanes[m].length > 0
  && JSON.stringify(app.lanes[m].map(lane => lane.key).sort()) === JSON.stringify([...app.tableLanes[m]].sort())));
assert.ok(undrawn.length === 0,
  `Replicata: read each growth metric's drawn lanes (crashla.js fleetDistributionCurves, each lane's key) and its forecast table's helmers and scopes (${METRICS.map(m => TABLE[m]).join(", ")}: each entry's components' scope, or the helmer's name where a component has none).
Expectata: for each metric, one lane per helmer and scope of its table, in any order, and at least one.
Resultata: ${undrawn.map(m => `${m}: drawn ${JSON.stringify(app.lanes[m].map(lane => lane.key))} for the table's ${JSON.stringify(app.tableLanes[m])}`).join("; ")}.`);

// Each drawn lane's components, for 3 and 4: Tesla's from first principles
// (the robotaxi lane A and B at their relative weights, the all-HW4 lane C on
// A and C on B at the same relative weights), Waymo's and Zoox's from their
// tables, weights summing to 1. Each must hold its parts, one band or more.
const robotaxiShare = app.weights.map(w => w / app.weights.reduce((s, v) => s + v, 0));
const rawComponents = Object.fromEntries(METRICS.map(metric => {
  const tesla = {
    robotaxi: robotaxiShare.map((w, i) => ({weight: w, parts: [app.robotaxi[metric][i]]})),
    hw4: robotaxiShare.map((w, i) => ({weight: w, parts: [app.robotaxi[metric][i], app.eyesOff[metric]]})),
  };
  return [metric, app.lanes[metric].map(lane => (lane.helmer === "Tesla" ? tesla[lane.key] : app.others[metric][lane.helmer]))];
}));
const malformed = METRICS.flatMap(metric => app.lanes[metric].map((lane, li) => ({lane, comps: rawComponents[metric][li]}))
  .filter(({comps}) => !(Array.isArray(comps) && comps.every(k => Array.isArray(k.parts) && k.parts.length > 0)))
  .map(({lane, comps}) => `${metric} ${lane.label}: ${JSON.stringify(comps)}`));
assert.ok(malformed.length === 0,
  `Replicata: read each drawn growth lane's components (crashla.js fleetDistributionCurves; Tesla's from TESLA_ROBOTAXI_SCENARIOS and TESLA_EYES_OFF, Waymo's and Zoox's from FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST).
Expectata: for every lane, components each holding its parts, one band or more.
Resultata: ${malformed.join("; ")}.`);
const laneComponents = Object.fromEntries(METRICS.map(metric => [metric, rawComponents[metric].map(comps => {
  const total = comps.reduce((s, k) => s + k.weight, 0);
  return comps.map(k => ({...k, weight: k.weight / total}));
})]));

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
// A band's density over ln x at u: in u a normal on each side of the mode,
// its sides' sigmas a and c, the two halves joined at the mode.
const bandDensity = (b, u) => {
  const {mu, a, c} = shape(b);
  const z = (u - mu) / (u < mu ? a : c);
  return 2 / (Math.sqrt(2 * Math.PI) * (a + c)) * Math.exp(-0.5 * z * z);
};
// The u at which an increasing f reaches target, by bisection on [lo, hi],
// halved 100 times.
const bisect = (f, target, lo, hi) => {
  for (let i = 0; i < 100; i++) {
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
// A two-part comonotonic sum's crossing at x: its parts' quantiles at the
// sum's level at x, y for the first part and x - y for the second, where
// F_R(y) = F_E(x - y), by bisection on y = x / (1 + e^-s), so x - y = x /
// (1 + e^s) keeps its precision too. This qual reads components of one part
// or two (scenario C has two); the app's format allows more (crashla.js
// forecastLanes: "one band or more"), and a component of three or more
// parts stops this qual here until its crossing is generalized.
const twoParts = (parts, x) => {
  assert.ok(parts.length === 2,
    `Replicata: compute a forecast component's CDF or density in this qual.
Expectata: a component of one part or two (this qual's independent sum reads two; scenario C has two).
Resultata: ${parts.length} parts: ${JSON.stringify(parts)}.`);
  const [r, e] = parts;
  const s = bisect(s => bandCdf(r, Math.log(x) - Math.log1p(Math.exp(-s))) - bandCdf(e, Math.log(x) - Math.log1p(Math.exp(s))), 0, -200, 200);
  return {r, e, y: x / (1 + Math.exp(-s)), z: x / (1 + Math.exp(s))};
};
// A component's CDF at x: one band's in closed form; two parts' comonotonic
// sum's at the crossing level, F_R(y).
const componentCdf = (parts, x) => {
  if (parts.length === 1) return bandCdf(parts[0], Math.log(x));
  const {r, y} = twoParts(parts, x);
  return bandCdf(r, Math.log(y));
};
// A component's density over ln x at x: one band's in closed form; two
// parts' comonotonic sum's at the crossing level, x over the sum of y over
// the first part's density there and x - y over the second's.
const componentDensity = (parts, x) => {
  if (parts.length === 1) return bandDensity(parts[0], Math.log(x));
  const {r, e, y, z} = twoParts(parts, x);
  return x / (y / bandDensity(r, Math.log(y)) + z / bandDensity(e, Math.log(z)));
};
// A lane's quantile at level p: components [{weight, parts}], weights summing to 1.
const laneQuantile = (components, p) =>
  Math.exp(bisect(u => components.reduce((F, k) => F + k.weight * componentCdf(k.parts, Math.exp(u)), 0), p, Math.log(1e-3), Math.log(1e14)));
// A lane's density over ln x at x.
const laneDensity = (components, x) => components.reduce((g, k) => g + k.weight * componentDensity(k.parts, x), 0);

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
  const e = app.eyesOff[metric];
  // Each robotaxi scenario's band summed with the eyes-off band, at LEVELS.
  const sums = app.robotaxi[metric].map(r => LEVELS.map(p => bandQuantile(r, p) + bandQuantile(e, p)));
  // offs[k][j]: the levels at which C component k is off scenario j's sum.
  const offs = cs.map(q => sums.map(s => LEVELS.map((p, i) => ({p, got: q[i], want: s[i]}))
    .filter(({got, want}) => !(Math.abs(got / want - 1) <= IDENTITY_TOLERANCE))));
  // The pairing of the components with distinct scenarios (component k with
  // scenario pairing[k]) off at the fewest levels in all, the first such in
  // lexicographic order.
  const orders = rest => (rest.length === 0 ? [[]] : rest.flatMap((j, i) => orders([...rest.slice(0, i), ...rest.slice(i + 1)]).map(o => [j, ...o])));
  const total = order => order.reduce((sum, j, k) => sum + offs[k][j].length, 0);
  const pairing = orders(cs.map((_, k) => k)).reduce((best, order) => (total(order) < total(best) ? order : best));
  pairing.forEach((j, k) => {
    const off = offs[k][j];
    if (off.length > 0) {
      const worst = off.reduce((w, o) => (Math.abs(o.got / o.want - 1) > Math.abs(w.got / w.want - 1) ? o : w));
      problems.push(`${metric}: C component ${k + 1} of ${cs.length} in ${TABLE[metric]}, paired with robotaxi scenario ${j + 1} of TESLA_ROBOTAXI_SCENARIOS (${JSON.stringify(app.robotaxi[metric][j])}; the pairing of the C components with distinct scenarios whose sums with the eyes-off band ${JSON.stringify(e)} they are off at the fewest levels in all), off that sum at ${off.length} of ${LEVELS.length} levels, worst at ${worst.p}: ${fmt(worst.got)} against ${fmt(worst.want)} (x${(worst.got / worst.want).toFixed(4)})`);
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
// The pieces each lane is integrated on, in ln x, so that each holds a small
// share of the lane's mass and none a jump or kink inside it: their ends are
// the lane's own quantiles (this qual's, computed apart from the app's) at
// 401 levels spread evenly over (0, 1) and at tail levels down to 1e-14 on
// each side, the places where a component's density changes its side (for
// each of its parts, at the level of that part's mode, a/(a + c) of the way
// in sigma, the sum of the parts' quantiles there: the part's own mode in a
// one-part component), and the range's two ends. Simpson's rule takes 16
// intervals of each piece. Until 2026-11-07 the lane was integrated on a
// fixed grid of 4,000 intervals over its whole range, which read a correct
// lane as not integrating to 1 when a band was narrower than a grid step
// (Zoox's fleet {400, 399, 401}) or had its mode at an edge, a jump in its
// density between grid points (Zoox's miles {8.01M, 8.01M, 24M}).
const TAIL_LEVELS = [1e-14, 1e-12, 1e-10, 1e-8, 1e-6, 1e-5, 1e-4, 3e-4, 1e-3];
const NODE_LEVELS = [...TAIL_LEVELS, ...Array.from({length: 401}, (_, i) => (i + 0.5) / 401), ...TAIL_LEVELS.map(p => 1 - p)];
const PIECE_INTERVALS = 16;
const pieceEnds = Object.fromEntries(METRICS.map(metric => [metric, app.lanes[metric].map((lane, li) => {
  const comps = laneComponents[metric][li];
  const a = Math.log(lane.lo90) - 15, b = Math.log(lane.hi90) + 15;
  const quantiles = NODE_LEVELS.map(p => Math.log(laneQuantile(comps, p)));
  const sides = comps.flatMap(k => k.parts.map(part => {
    const {a: below, c: above} = shape(part);
    const p = below / (below + above);
    return Math.log(k.parts.reduce((x, q) => x + bandQuantile(q, p), 0));
  }));
  return [...new Set([a, b, ...quantiles, ...sides].filter(u => u >= a && u <= b))].sort((u, v) => u - v);
})]));
const integrals = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const simpson = ${simpson.toString()};
  const pieceEnds = ${JSON.stringify(pieceEnds)};
  return Object.fromEntries(${JSON.stringify(METRICS)}.map(metric => [metric, fleetDistributionCurves(metric).map((c, li) => {
    const g = u => c.densityFn(Math.exp(u));
    const ends = pieceEnds[metric][li];
    // The integral from the range's low end up to t, piece by piece.
    const upTo = t => {
      let mass = 0;
      for (let i = 0; i + 1 < ends.length && ends[i] < t; i++) mass += simpson(g, ends[i], Math.min(ends[i + 1], t), ${PIECE_INTERVALS});
      return mass;
    };
    return {label: c.legendLabel, mass: upTo(ends[ends.length - 1]),
      at: [c.lo90, c.median, c.hi90].map(q => upTo(Math.log(q)))};
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
for (const metric of METRICS) {
  app.lanes[metric].forEach((lane, li) => {
    const comps = laneComponents[metric][li];
    [[0.05, "lo90"], [0.5, "median"], [0.95, "hi90"]].forEach(([p, key]) => {
      const exact = laneQuantile(comps, p);
      if (!(Math.abs(lane[key] / exact - 1) <= PERCENTILE_TOLERANCE))
        problems.push(`${metric} ${lane.label}: its printed ${100 * p}th percentile ${fmt(lane[key])} against ${fmt(exact)} computed here (x${(lane[key] / exact).toFixed(4)})`);
    });
  });
}

// --- 4. Each drawn lane's density, point by point, computed independently ---
// The two-part lanes agree to about 3e-8 (this qual's erfc), the one-part
// lanes to about 4e-12.
const DENSITY_TOLERANCE = 1e-5;
const DENSITY_POINTS = 199;
for (const metric of METRICS) {
  const points = laneComponents[metric].map(comps => {
    const a = Math.log(laneQuantile(comps, 0.005)), b = Math.log(laneQuantile(comps, 0.995));
    return Array.from({length: DENSITY_POINTS}, (_, i) => Math.exp(a + (b - a) * i / (DENSITY_POINTS - 1)));
  });
  const drawn = JSON.parse(vm.runInContext(`JSON.stringify(fleetDistributionCurves(${JSON.stringify(metric)})
    .map((c, li) => ${JSON.stringify(points)}[li].map(x => c.densityFn(x))))`, ctx));
  app.lanes[metric].forEach((lane, li) => {
    const comps = laneComponents[metric][li];
    const off = points[li].map((x, i) => ({x, got: drawn[li][i], want: laneDensity(comps, x)}))
      .filter(({got, want}) => !(Math.abs(got / want - 1) <= DENSITY_TOLERANCE));
    if (off.length > 0) {
      const worst = off.reduce((w, o) => (Math.abs(o.got / o.want - 1) > Math.abs(w.got / w.want - 1) ? o : w));
      problems.push(`${metric} ${lane.label}: its drawn density off this qual's at ${off.length} of ${DENSITY_POINTS} points from ${fmt(points[li][0])} to ${fmt(points[li].at(-1))}, worst at ${fmt(worst.x)}: ${worst.got} against ${worst.want} (x${worst.got / worst.want})`);
    }
  });
}

assert.ok(problems.length === 0,
  `Replicata: build the growth forecasts (crashla.js FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST) and their drawn lanes, and compute the figures this qual's header describes with closed-form two-piece CDFs and densities and bisection.
Expectata: (1) each C component's quantile at each of ${LEVELS.length} levels from 0.001 to 0.999 is a distinct robotaxi scenario's band's quantile plus the eyes-off band's, within ${IDENTITY_TOLERANCE.toExponential()} (relative), whatever order the table lists the C components in; (2) each drawn lane's density integrates to 1, and to its printed 5th, 50th and 95th percentiles 0.05, 0.5 and 0.95, each within ${MASS_TOLERANCE}; (3) each drawn lane's printed 5th, 50th and 95th percentiles within ${100 * PERCENTILE_TOLERANCE}% of this qual's (Tesla's lanes from first principles, Waymo's and Zoox's from their tables); (4) each drawn lane's density within ${DENSITY_TOLERANCE.toExponential()} (relative) of this qual's at ${DENSITY_POINTS} points evenly spaced in ln x from its 0.5th to its 99.5th percentile.
Resultata: ${problems.length} problems: ${problems.join("; ")}.`);

console.log(`qual pass: each of Tesla's scenario-C components is the comonotonic sum of a distinct robotaxi scenario's band and the eyes-off band at ${LEVELS.length} levels on all three growth metrics, and every drawn lane's density is normalized, matches an independent computation within ${DENSITY_TOLERANCE.toExponential()} (relative) at ${DENSITY_POINTS} points, and has its printed percentiles within ${100 * PERCENTILE_TOLERANCE}% of an independent computation`);

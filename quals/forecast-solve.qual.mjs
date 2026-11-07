// The growth forecasts' two solves, and the asserts on what each reaches
// (crashla.js): componentAt finds the level at which a forecast component's
// quantile is a given x, solving for the level's log-odds in a fixed range,
// and bandMixtureQuantiles finds the x at which a lane's CDF (its
// components', weighted) is a given level, solving in ln x. Both date from
// 2026-11-04, when scenario C became the comonotonic sum of its parts (the
// human's "Hold exactly"); their asserts came in the sixth fix run's first
// review (2026-11-04) and were restated at its second (2026-11-05), when
// sumAtLevel's density stopped overflowing and the mixture's solve moved to
// its CDF's log-odds, and the mixture's at its third (2026-11-05), when it
// gained a term for steep CDFs. Until the second no qual read either assert
// (deleting both left every qual green), nor forecastLanes' check that each
// component holds its parts (2026-11-04); until the third none read the
// tolerances the asserts state (loosening any of them 10^5-fold or more left
// every qual green), nor the high end of componentAt's range. First, every
// metric must draw one lane per helmer and scope of its table (until the
// third review, a fleetDistributionCurves that drew no lanes left checks 2
// and 3 nothing to read, and this qual green). The checks:
//  1. every component of FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST,
//     and four made-up components, of one, two and three parts, each part's
//     lo and hi 50 to 10,000 times from its best (today's widest part, the
//     eyes-off miles, 37.5 times below and 8 above), and a point band (lo,
//     best and hi equal, its sigmas floored at 1e-6), at x from 1e-300 to
//     1e300 (ln x in steps of 0.5): componentAt returns without a throw,
//     with a positive, finite density, and either reaches ln x within 1e-8
//     of its scale or stops at a level whose smaller tail is under 1e-300 on
//     the side x lies beyond: x past every quantile the solve can reach,
//     where no figure drawn or printed can tell that tail from the true one
//     (until 2026-11-05 the density's terms overflowed far out in the upper
//     tail, the density then 0, and the solve stopped there, its tail up to
//     about 7e-282 on these tables; on the made-up components it threw);
//  2. every drawn lane (fleetDistributionCurves, the three metrics) at 16
//     levels from 1e-300 to 1 - 1e-15, and two made-up lanes of one band
//     (sigmas 1 and 2 each side) whose quantiles from 1e-300 to 1e-280 pass
//     near x = 1, at 401 levels from 1e-300 to 1e-280, where a step in ln x
//     moves the log-odds less than componentAt's solves leave them off, so
//     that the mixture assert's 1e-8 must hold that error (an assert on the
//     step alone threw there on 25 and 55 of those levels, in the sixth fix
//     run's third review, 2026-11-05): bandMixtureQuantiles returns without
//     a throw, its quantiles increase with the level, and the lane's CDF at
//     each, as componentAt computes it (its components' p and q, weighted),
//     has its smaller tail within 1e-8 (relative) of the level's (until
//     2026-11-05 the solve on the CDF itself, which near 1 resolves only
//     about 1e-16, threw past about 1 - 1e-8 on some lanes and missed by up
//     to 3.7% at 1 - 1e-15 on others). That is the app's own CDF: a
//     component whose quantile at its level range's low end lies above x
//     reports that end's p, about 1e-304, above its true one, so below about
//     1e-296 the app's CDF sits above the true one by up to about 1e-304
//     times the component's weight (8.3e-5 of the level at 1e-300, by
//     mpmath, on the tables of 2026-11-05; quals/forecast-sum.qual.mjs reads
//     the printed percentiles against the true CDF);
//  2b. three made-up mixtures whose CDF is steep, a point band, or a band
//     0.05% wide, beside a wide band, at 999 levels from 0.001 to 0.999:
//     bandMixtureQuantiles returns without a throw, its quantiles increase
//     with the level, and the CDF (as in 2) at ln x less and plus 1e-11 of
//     its scale brackets the level: the quantile is within the mixture
//     assert's step of the solution (until the sixth fix run's third review,
//     2026-11-05, the assert read the log-odds alone, within 1e-8, and threw
//     on correct quantiles of these mixtures at 153, 232 and 16 of these
//     levels, where the solve's precision in ln x leaves the log-odds up to
//     1.6e-5 off);
//  3. each assert fires on the fault it guards against, its throw's details
//     (the JSON object closing its message, read as data; no words read)
//     holding the keys named here, among them keys only its own details
//     hold: componentAt's ("u", "reached", "L", "p", "q") when its solve
//     stops without solving, ten units of log-odds below its start; when it
//     stops at either end of its range away from x (for x a lane's median;
//     until 2026-11-05 a stop at the low end passed, and until the third
//     review no case read the high end); when it reaches a level whose
//     quantile is five times its tolerance from ln x, either side; and, for
//     x past every quantile at either end, when it stops five times its
//     tolerance short of that end; bandMixtureQuantiles' ("level",
//     "target", "logOdds", "u") when its solve stops one unit of ln x below
//     its start; when the quantile it finds leaves the log-odds five times
//     the assert's whole bound (its 1e-8 plus its step term) from the
//     level's, either side, at the median and at the levels 1e-10 and
//     1 - 1e-10 (where componentAt's near miss of its reach is also read;
//     until 2026-11-07 the log-odds near miss was five times the 1e-8 alone,
//     at the median alone); on the steep made-up
//     mixtures, where the assert's step term rules, when the quantile is
//     five times that step from the solution, either side; and when it
//     stops one unit of ln x below its start with an infinite slope there,
//     which no step may then excuse; forecastLanes' ("helmer", "component")
//     for a component whose list of parts is empty, or missing. Each near
//     miss is five times the tolerance it tests, so a tolerance loosened
//     tenfold leaves it silent. The solves' faults come from a stand-in for
//     solveIncreasing that, at the outermost of the solves under way
//     (componentAt's for a density, the mixture's for a quantile), returns
//     its function's result at the faulty point, which a near miss finds
//     with the app's own solve, and solves every inner one as the app does
//     (until the third review the details also had to lack another
//     assert's key, so that a correct key added to componentAt's, "level",
//     read as the wrong assert's).
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
const fmt = v => Number(v.toPrecision(6)).toLocaleString("en-US");
const problems = [];

// --- Every metric draws one lane per helmer and scope of its table ----------
const lanesDrawn = JSON.parse(vm.runInContext(`JSON.stringify(Object.entries({${METRICS.map(m => `${m}: ${TABLE[m]}`).join(", ")}})
  .map(([metric, table]) => ({metric,
    table: table.flatMap(entry => [...new Set(entry.components.map(c => c.scope ?? entry.helmer))]),
    drawn: fleetDistributionCurves(metric).map(lane => lane.key)})))`, ctx));
// The two lists are compared as sets (sorted), not in order: the chart may
// draw the lanes in any order (until 2026-11-07 the table's order was
// required, so a correct reordering, the conditional lane drawn last, was red).
const undrawn = lanesDrawn.filter(m => !(m.table.length > 0 && JSON.stringify([...m.drawn].sort()) === JSON.stringify([...m.table].sort())));
assert.ok(undrawn.length === 0,
  `Replicata: read each growth metric's drawn lanes (crashla.js fleetDistributionCurves, each lane's key) and its forecast table's helmers and scopes (${METRICS.map(m => TABLE[m]).join(", ")}: each entry's components' scope, or the helmer's name where a component has none).
Expectata: for each metric, one lane per helmer and scope of its table, in any order, and at least one, so that checks 2 and 3 read every lane.
Resultata: ${undrawn.map(m => `${m.metric}: drawn ${JSON.stringify(m.drawn)} for the table's ${JSON.stringify(m.table)}`).join("; ")}.`);

// --- 1. componentAt from x = 1e-300 to 1e300 --------------------------------
const MADE_UP = [
  {name: "made-up, one part", parts: [{best: 1e6, lo: 1e3, hi: 1e10}]},
  {name: "made-up, two parts", parts: [{best: 1e6, lo: 1e3, hi: 1e10}, {best: 1e8, lo: 1e4, hi: 1e12}]},
  {name: "made-up, three parts", parts: [{best: 1e6, lo: 1e3, hi: 1e10}, {best: 1e8, lo: 1e4, hi: 1e12}, {best: 50, lo: 1, hi: 1e5}]},
  {name: "made-up, a point band", parts: [{best: 1e6, lo: 1e6, hi: 1e6}]},
];
const REACH = 1e-8; // the distance from ln x a reached level may be, of ln x's scale
const END = 1e-9; // the distance, relative, from an end of componentAt's level range within which its solve may stop away from x
const FAR_TAIL = 1e-300; // the smaller tail under which a solve may stop away from x
const sweep = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const tables = {fleet: FLEET_FORECAST, miles: MILES_FORECAST, rides: RIDES_FORECAST};
  const components = [
    ...Object.entries(tables).flatMap(([metric, t]) => t.flatMap(entry => entry.components.map((c, i) => ({
      name: metric + " " + entry.helmer + " component " + (i + 1) + " of " + entry.components.length + (c.scope === undefined ? "" : " (" + c.scope + ")"), c})))),
    ...${JSON.stringify(MADE_UP)}.map(m => ({name: m.name, c: {weight: 1, parts: m.parts}})),
  ];
  return components.map(({name, c}) => {
    const bad = [];
    let points = 0;
    for (let u = -690; u <= 690; u += 0.5) {
      points++;
      try {
        const at = componentAt(c, u);
        const reached = Math.abs(at.u - u) <= ${REACH} * (1 + Math.abs(u));
        const beyond = Math.min(at.p, at.q) < ${FAR_TAIL} && Math.sign(u - at.u) === Math.sign(at.p - at.q);
        if (!(Number.isFinite(at.g) && at.g > 0) || !(reached || beyond))
          bad.push({u, reached: at.u, p: at.p, q: at.q, g: at.g});
      } catch (e) { bad.push({u, threw: String(e.message).slice(0, 200)}); }
    }
    return {name, points, bad};
  });
})())`, ctx));
for (const {name, points, bad} of sweep) {
  if (bad.length > 0) {
    const first = bad[0];
    problems.push(`(1) ${name}: wrong at ${bad.length} of ${points} points, the first at ln x = ${first.u}: ${first.threw === undefined
      ? `reached ln x = ${first.reached}, p ${first.p}, q ${first.q}, density ${first.g}` : `threw: ${first.threw}`}`);
  }
}

// --- 2. bandMixtureQuantiles from level 1e-300 to 1 - 1e-15 -----------------
const LEVELS = [1e-300, 1e-100, 1e-15, 1e-10, 1e-8, 1e-5, 0.001, 0.05, 0.5, 0.95, 0.999, 1 - 1e-5, 1 - 1e-8, 1 - 1e-10, 1 - 1e-12, 1 - 1e-15];
const TAIL = 1e-8; // the smaller tail's distance from the level's, relative
const FAR_MADE_UP = [1, 2].map(sigma => ({name: `made-up, one band of sigma ${sigma} each side`, components: [{weight: 1, parts: [{
  best: Math.exp(37.04 * sigma), lo: Math.exp(37.04 * sigma - 1.6449 * sigma), hi: Math.exp(37.04 * sigma + 1.6449 * sigma)}]}]}));
const FAR_LEVELS = Array.from({length: 401}, (_, i) => Math.pow(10, -300 + 20 * i / 400));
// A lane's quantiles at some levels, and its CDF's smaller tail at each, as
// componentAt computes it (for a level whose quantile threw, what it threw).
vm.runInContext(`globalThis.__invert = (components, levels) => levels.map(level => {
  try {
    const [x] = bandMixtureQuantiles(components, [level]);
    let p = 0, q = 0;
    for (const c of components) {
      const at = componentAt(c, Math.log(x));
      p += c.weight * at.p;
      q += c.weight * at.q;
    }
    return {level, x, tail: level < 0.5 ? p : q};
  } catch (e) { return {level, threw: String(e.message).slice(0, 200)}; }
});`, ctx);
const far = JSON.parse(vm.runInContext(`JSON.stringify([
  ...${JSON.stringify(METRICS)}.flatMap(metric => fleetDistributionCurves(metric).map(lane => ({label: metric + " " + lane.legendLabel, at: __invert(lane.components, ${JSON.stringify(LEVELS)})}))),
  ...${JSON.stringify(FAR_MADE_UP)}.map(m => ({label: m.name, at: __invert(m.components, ${JSON.stringify(FAR_LEVELS)})})),
])`, ctx));
for (const {label, at} of far) {
  for (const a of at) {
    const want = a.level < 0.5 ? a.level : 1 - a.level;
    if (a.threw !== undefined) problems.push(`(2) ${label} at level ${a.level}: threw: ${a.threw}`);
    else if (!(Math.abs(a.tail / want - 1) <= TAIL))
      problems.push(`(2) ${label} at level ${a.level}: quantile ${fmt(a.x)}, where the CDF's smaller tail is ${a.tail} against the level's ${want} (x${a.tail / want})`);
  }
  const xs = at.filter(a => a.threw === undefined);
  const falling = xs.slice(1).filter((a, i) => !(a.x > xs[i].x));
  if (falling.length > 0) problems.push(`(2) ${label}: quantiles not increasing with the level at ${falling.map(a => a.level).join(", ")}`);
}

// --- 2b. bandMixtureQuantiles where the CDF is steep ------------------------
// Each mixture's steep level, inside the narrow band's rise, is where 3's
// near misses of the assert's step term are made.
const STEEP = [
  {name: "a point band (weight 0.22) beside a wide band", level: 0.95,
    components: [{weight: 0.78, parts: [{best: 11500, lo: 7000, hi: 16000}]}, {weight: 0.22, parts: [{best: 20000, lo: 20000, hi: 20000}]}]},
  {name: "a point band (weight 0.5) at a wide band's mode", level: 0.5,
    components: [{weight: 0.5, parts: [{best: 400, lo: 400, hi: 400}]}, {weight: 0.5, parts: [{best: 400, lo: 150, hi: 1000}]}]},
  {name: "a band 0.05% wide (weight 0.22) beside a wide band", level: 0.95,
    components: [{weight: 0.78, parts: [{best: 11500, lo: 7000, hi: 16000}]}, {weight: 0.22, parts: [{best: 20000, lo: 19990, hi: 20010}]}]},
];
const STEP = 1e-11; // the mixture assert's step term: a step in ln x of this, of ln x's scale, times the CDF's slope
const STEEP_LEVELS = Array.from({length: 999}, (_, i) => (i + 1) / 1000);
const steep = JSON.parse(vm.runInContext(`JSON.stringify(${JSON.stringify(STEEP)}.map(({name, components}) => {
  const cdf = u => components.reduce((P, c) => P + c.weight * componentAt(c, u).p, 0);
  return {name, at: ${JSON.stringify(STEEP_LEVELS)}.map(level => {
    try {
      const [x] = bandMixtureQuantiles(components, [level]);
      const u = Math.log(x), step = ${STEP} * (1 + Math.abs(u));
      return {level, x, below: cdf(u - step), above: cdf(u + step)};
    } catch (e) { return {level, threw: String(e.message).slice(0, 200)}; }
  })};
}))`, ctx));
for (const {name, at} of steep) {
  const threw = at.filter(a => a.threw !== undefined);
  if (threw.length > 0) problems.push(`(2b) ${name}: threw at ${threw.length} of ${at.length} levels, the first at ${threw[0].level}: ${threw[0].threw}`);
  const unbracketed = at.filter(a => a.threw === undefined && !(a.below <= a.level && a.level <= a.above));
  if (unbracketed.length > 0) problems.push(`(2b) ${name}: the CDF at ln x less and plus ${STEP} of its scale does not bracket the level at ${unbracketed.length} of ${at.length} levels, the first at ${unbracketed[0].level}: quantile ${fmt(unbracketed[0].x)}, the CDF ${unbracketed[0].below} and ${unbracketed[0].above}`);
  const xs = at.filter(a => a.threw === undefined);
  const falling = xs.slice(1).filter((a, i) => !(a.x > xs[i].x));
  if (falling.length > 0) problems.push(`(2b) ${name}: quantiles not increasing with the level at ${falling.length} levels, the first ${falling[0].level}`);
}

// --- 3. Each assert fires on its fault -------------------------------------
// The details an Error's message closes with: the JSON object the app's
// fail() writes there, found as the first "{" from which the rest of the
// message parses (null when there is none), as window-band.qual.mjs reads.
const detailsOf = message => {
  for (let i = message.indexOf("{"); i !== -1; i = message.indexOf("{", i + 1)) {
    try { return JSON.parse(message.slice(i)); } catch (_e) { /* a brace among the message's words */ }
  }
  return null;
};
assert.equal(vm.runInContext("typeof solveIncreasing", ctx), "function",
  `Replicata: load crashla.js and look up solveIncreasing, the solver both of the forecasts' solves call.
Expectata: a function, which section 3 stands in for to make each solve's fault.
Resultata: ${vm.runInContext("typeof solveIncreasing", ctx)}.`);
// The levels in the lanes' far tails at which the near misses below are also
// tested, where a solve's error is largest (until 2026-11-07 they were tested
// at the median alone).
const TAIL_LEVELS = [1e-10, 1 - 1e-10];
vm.runInContext(`globalThis.__lanes = Object.fromEntries(${JSON.stringify(METRICS)}.map(metric => [metric, fleetDistributionCurves(metric)]));
globalThis.__steep = ${JSON.stringify(STEEP)};
globalThis.__tails = Object.fromEntries(Object.entries(__lanes).map(([metric, lanes]) => [metric, lanes.map(l => bandMixtureQuantiles(l.components, ${JSON.stringify(TAIL_LEVELS)}))]));`, ctx);
const LOGODDS = 1e-8; // the mixture assert's distance of the log-odds from the level's, before its step term
const NEAR = 5; // a near miss's distance, in multiples of the tolerance it tests
// Runs code with solveIncreasing's outermost solve replaced by stop(at,
// target, lo, hi, t, solve), solve the app's own solveIncreasing, which stop
// may call for the solution it then misses: what it threw (null for
// nothing), and how many times the stand-in stopped a solve (none would mean
// the app's solves no longer go through solveIncreasing, so that this qual
// tests nothing). plain runs code with no stand-in (missed null).
const faulty = (stop, code) => {
  const {thrown, missed} = vm.runInContext(`(() => {
    const real = solveIncreasing;
    let depth = 0, missed = 0;
    solveIncreasing = (at, target, lo, hi, t) => {
      depth++;
      try { return depth === 1 ? (missed++, (${stop})(at, target, lo, hi, t, real)) : real(at, target, lo, hi, t); }
      finally { depth--; }
    };
    try { ${code}; return {thrown: null, missed}; }
    catch (e) { return {thrown: String(e.message), missed}; }
    finally { solveIncreasing = real; }
  })()`, ctx);
  return {missed, thrown: thrown === null ? null : {message: thrown, details: detailsOf(thrown)}};
};
const plain = code => {
  const thrown = vm.runInContext(`(() => { try { ${code}; return null; } catch (e) { return String(e.message); } })()`, ctx);
  return {missed: null, thrown: thrown === null ? null : {message: thrown, details: detailsOf(thrown)}};
};
const ASSERTS = {
  componentAt: ["u", "reached", "L", "p", "q"],
  bandMixtureQuantiles: ["level", "target", "logOdds", "u"],
  forecastLanes: ["helmer", "component"],
};
const cases = [];
for (const metric of METRICS) {
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(__lanes.${metric}.map(l => l.legendLabel))`, ctx));
  lanes.forEach((label, li) => {
    const lane = `__lanes.${metric}[${li}]`;
    const density = x => `bandMixtureLogDensity(${lane}.components, ${x})`;
    const median = `bandMixtureQuantiles(${lane}.components, [0.5])`;
    cases.push({what: `${metric} ${label}: its density at its median, componentAt's solve stopping ten units of log-odds below its start`,
      want: "componentAt", got: faulty("(at, target, lo, hi, t) => at(t - 10)", density(`${lane}.median`))});
    for (const [end, stop] of [["low", "lo"], ["high", "hi"]]) {
      cases.push({what: `${metric} ${label}: its density at its median, componentAt's solve stopping at its range's ${end} end`,
        want: "componentAt", got: faulty(`(at, target, lo, hi, t) => at(${stop})`, density(`${lane}.median`))});
    }
    for (const [side, sign] of [["above", 1], ["below", -1]]) {
      cases.push({what: `${metric} ${label}: its density at its median, componentAt's solve reaching the level whose quantile is ${NEAR} times its tolerance (${REACH} of ln x's scale) ${side} ln x`,
        want: "componentAt", got: faulty(`(at, target, lo, hi, t, solve) => solve(at, target + ${sign * NEAR * REACH} * (1 + Math.abs(target)), lo, hi, t)`, density(`${lane}.median`))});
    }
    for (const [end, stop, u] of [["high", "hi", 690], ["low", "lo", -690]]) {
      cases.push({what: `${metric} ${label}: its density at x = e^${u}, past every quantile, componentAt's solve stopping ${NEAR} times its tolerance (${END} of the end, relative) short of its range's ${end} end`,
        want: "componentAt", got: faulty(`(at, target, lo, hi, t) => at(${stop} * (1 - ${NEAR * END}))`, density(`Math.exp(${u})`))});
    }
    cases.push({what: `${metric} ${label}: its median, the mixture's solve stopping one unit of ln x below its start`,
      want: "bandMixtureQuantiles", got: faulty("(at, target, lo, hi, t) => at(t - 1)", median)});
    // The log-odds near miss is five times the assert's whole bound at the
    // root, its 1e-8 plus its step term (until 2026-11-07 five times the 1e-8
    // alone, which on a steep lane the step term outgrows, so that a correct
    // lane's near miss could fall inside the bound and a loosened step term
    // pass unseen).
    const nearLogOdds = sign => `(at, target, lo, hi, t, solve) => { const r = solve(at, target, lo, hi, t); return at(r.u + ${sign * NEAR} * (${LOGODDS} + r.slope * ${STEP} * (1 + Math.abs(r.u))) / r.slope); }`;
    for (const [side, sign] of [["above", 1], ["below", -1]]) {
      cases.push({what: `${metric} ${label}: its median, the mixture's solve finding a quantile whose log-odds are ${NEAR} times the assert's whole bound (${LOGODDS} plus its step term) ${side} the level's`,
        want: "bandMixtureQuantiles", got: faulty(nearLogOdds(sign), median)});
    }
    // The reach and log-odds near misses again at the far tails' levels.
    TAIL_LEVELS.forEach((level, k) => {
      const atLevel = `bandMixtureQuantiles(${lane}.components, [${level}])`;
      const x = `__tails.${metric}[${li}][${k}]`;
      for (const [side, sign] of [["above", 1], ["below", -1]]) {
        cases.push({what: `${metric} ${label}: its density at its quantile at ${level}, componentAt's solve reaching the level whose quantile is ${NEAR} times its tolerance (${REACH} of ln x's scale) ${side} ln x`,
          want: "componentAt", got: faulty(`(at, target, lo, hi, t, solve) => solve(at, target + ${sign * NEAR * REACH} * (1 + Math.abs(target)), lo, hi, t)`, density(x))});
        cases.push({what: `${metric} ${label}: its quantile at ${level}, the mixture's solve finding a quantile whose log-odds are ${NEAR} times the assert's whole bound ${side} the level's`,
          want: "bandMixtureQuantiles", got: faulty(nearLogOdds(sign), atLevel)});
      }
    });
    cases.push({what: `${metric} ${label}: its median, the mixture's solve stopping one unit of ln x below its start, its slope there infinite`,
      want: "bandMixtureQuantiles", got: faulty("(at, target, lo, hi, t) => ({...at(t - 1), slope: Infinity})", median)});
  });
}
STEEP.forEach(({name, level}, si) => {
  for (const [side, sign] of [["above", 1], ["below", -1]]) {
    cases.push({what: `the made-up mixture with ${name}: its quantile at ${level}, the mixture's solve finding a quantile ${NEAR} times the assert's step (${STEP} of ln x's scale) ${side} the solution`,
      want: "bandMixtureQuantiles", got: faulty(`(at, target, lo, hi, t, solve) => { const r = solve(at, target, lo, hi, t); return at(r.u + ${sign * NEAR * STEP} * (1 + Math.abs(r.u))); }`,
        `bandMixtureQuantiles(__steep[${si}].components, [${level}])`)});
  }
});
cases.push({what: "forecastLanes on a table whose one component's list of parts is empty",
  want: "forecastLanes", got: plain(`forecastLanes([{helmer: "Zoox", components: [{weight: 1, parts: []}]}])`)});
cases.push({what: "forecastLanes on a table whose one component has no list of parts",
  want: "forecastLanes", got: plain(`forecastLanes([{helmer: "Zoox", components: [{weight: 1}]}])`)});
for (const {what, want, got: {missed, thrown}} of cases) {
  const keys = ASSERTS[want];
  if (missed === 0) problems.push(`(3) ${what}: the stand-in for solveIncreasing stopped no solve, so the fault never happened`);
  else if (thrown === null) problems.push(`(3) ${what}: no throw, where the assert in ${want} must fire`);
  else if (!(thrown.details !== null && keys.every(k => k in thrown.details)))
    problems.push(`(3) ${what}: threw, its details ${JSON.stringify(thrown.details)}, not those of the assert in ${want} (message: ${thrown.message.slice(0, 200)})`);
}

assert.ok(problems.length === 0,
  `Replicata: (1) evaluate crashla.js componentAt for every component of ${Object.values(TABLE).join(", ")} and ${MADE_UP.length} made-up components (${MADE_UP.map(m => `${m.name}: ${JSON.stringify(m.parts)}`).join("; ")}) at ln x from -690 to 690 in steps of 0.5; (2) evaluate bandMixtureQuantiles for every drawn growth lane at levels ${LEVELS.join(", ")}, and for ${FAR_MADE_UP.length} made-up lanes (${FAR_MADE_UP.map(m => `${m.name}: ${JSON.stringify(m.components)}`).join("; ")}) at ${FAR_LEVELS.length} levels from 1e-300 to 1e-280, and the lane's CDF at each quantile (componentAt's p and q, weighted); (2b) evaluate bandMixtureQuantiles for ${STEEP.length} made-up mixtures (${STEEP.map(s => `${s.name}: ${JSON.stringify(s.components)}`).join("; ")}) at ${STEEP_LEVELS.length} levels from 0.001 to 0.999, and their CDF (as in 2) at ln x less and plus ${STEP} of its scale; (3) run each solve with a stand-in solveIncreasing whose outermost solve stops at a faulty point, or a near miss of a tolerance (${NEAR} times it), and forecastLanes on tables whose component has no parts.
Expectata: (1) no throw, a positive, finite density, and ln x reached within ${REACH} of its scale, or a stop at a level whose smaller tail is under ${FAR_TAIL} on the side x lies beyond; (2) no throw, quantiles increasing with the level, and the CDF's smaller tail within ${TAIL} (relative) of the level's; (2b) no throw, quantiles increasing with the level, and the level between the CDF at ln x less and plus ${STEP} of its scale; (3) each fault made (the stand-in stopping a solve) and thrown by its assert, its details holding, for the assert in ${Object.entries(ASSERTS).map(([name, keys]) => `${name}, ${keys.join(", ")}`).join("; in ")}.
Resultata: ${problems.length} problems: ${problems.join("; ")}.`);

console.log(`qual pass: componentAt reaches every x from 1e-300 to 1e300 or stops past a tail under ${FAR_TAIL} on x's side, for ${sweep.length} components; bandMixtureQuantiles inverts every drawn lane's CDF, as componentAt computes it, its smaller tail within ${TAIL} (relative) of the level's, at ${LEVELS.length} levels from 1e-300 to 1 - 1e-15, and ${FAR_MADE_UP.length} made-up lanes' at ${FAR_LEVELS.length} levels from 1e-300 to 1e-280, and ${STEEP.length} steep made-up mixtures' within ${STEP} of ln x's scale at ${STEEP_LEVELS.length} levels; and ${cases.length} faults, near misses among them, each fire their assert`);

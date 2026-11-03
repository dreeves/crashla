// Tesla's growth-forecast inputs reproduce the sources crashla.js records for
// them (open question 22 of 2026-11-01, settled by the human 2026-11-02).
//
// 1. The scenario weights are the fit their comment (FLEET_FORECAST) records:
//    Manifold's "Will Tesla have more autonomous vehicles providing
//    ridehailing than Waymo on Dec 31 2027?" at 0.184638, its price on
//    2026-11-02 (read from Manifold's API at 18:31 PST; last trade Oct 23).
//    Under each robotaxi scenario (A and B, fleets in car-equivalents) the
//    probability that Tesla's distinct cars, ~1.3x its car-equivalents,
//    exceed Waymo's end-2027 fleet, a log-normal with median 14,000 and sigma
//    0.45 (from Manifold's "How many Waymo robotaxis at the end of 2027?");
//    C, the all-HW4 scope, counts toward the market at 0.8 with its judged
//    weight 0.07. B is solved so the mixture equals the price and A takes the
//    rest; the weights are that fit at two decimals, so the mixture must sit
//    within half a 0.01 step of B's weight of the price (a step moves it by
//    0.01 x (P_B - P_A), ~0.006). Until 2026-11-02 the weights were the
//    2026-10-29 fit (A 0.79, B 0.14, at 18.5%, with B's high at 60,000);
//    B's high moved to 40,000 that day without a refit, and those weights
//    gave 17.8% (audit 2026-10-30, forecasts-comment-arithmetic).
// 2. Scenario C's eyes-off miles a car-day (TESLA_EYES_OFF.milesPerCarDay)
//    has its best at Tesla's own latest FSD (Supervised) miles per active FSD
//    car-day, at two significant figures. Until 2026-11-02 it was ~16, with
//    no source. From Tesla's Q3-2026 Update (Oct 21, 2026): the chart
//    "Cumulative Miles Driven with FSD (Supervised) (billions)" (p. 8),
//    vector-extracted, 11.818 at the end of June 2026 and 15.493 at the end
//    of September; "Active FSD Subscriptions (mil)" (p. 5), 1.48 at Q2's end
//    and 1.74 at Q3's ("includes both upfront payment and monthly
//    subscriptions and excludes free trials"). Q3's miles over its 92 days
//    and the quarter's mean count give 24.8 miles a car-day.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Float64Array, Object, String, Map, JSON,
  document: { getElementById() { return { textContent: "", innerHTML: "" }; }, createElement() { return { textContent: "", innerHTML: "" }; } } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const app = JSON.parse(vm.runInContext(`JSON.stringify({
  tesla: FLEET_FORECAST.find(f => f.helmer === "Tesla").components,
  eyesOff: TESLA_EYES_OFF,
})`, ctx));
const problems = [];

// --- 1. The weights reproduce their recorded market fit ---------------------
const MARKET_PRICE = 0.184638;
const DISTINCT_PER_CAR_EQUIVALENT = 1.3, WAYMO_MEDIAN = 14000, WAYMO_SIGMA = 0.45;
const C_COUNTS = 0.8, C_WEIGHT = 0.07;
const Z90 = 1.6449; // a band's lo and hi sit this many sigmas from its mode
// Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8).
const phi = z => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const p = 0.3989422804014327 * Math.exp(-z * z / 2) *
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
};
// P(1.3 X > W) for a two-piece log-normal X {best, lo, hi} (mode at best, lo
// and hi Z90 sigmas out on their own sides), by the midpoint rule in ln x.
const pBeatsWaymo = c => {
  const mu = Math.log(c.best), sLo = (mu - Math.log(c.lo)) / Z90, sHi = (Math.log(c.hi) - mu) / Z90;
  const a = mu - 10 * sLo, b = mu + 10 * sHi, n = 40000, h = (b - a) / n;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const u = a + (i + 0.5) * h, z = (u - mu) / (u < mu ? sLo : sHi);
    const dens = 2 / (Math.sqrt(2 * Math.PI) * (sLo + sHi)) * Math.exp(-0.5 * z * z);
    p += dens * phi((u + Math.log(DISTINCT_PER_CAR_EQUIVALENT) - Math.log(WAYMO_MEDIAN)) / WAYMO_SIGMA) * h;
  }
  return p;
};
const robotaxi = app.tesla.filter(c => c.scope === "robotaxi");
const hw4 = app.tesla.filter(c => c.scope === "hw4");
if (robotaxi.length !== 2 || hw4.length !== 1) problems.push(`Tesla's fleet components: ${robotaxi.length} robotaxi (want A and B) and ${hw4.length} hw4 (want C)`);
else {
  const [A, B] = [...robotaxi].sort((x, y) => x.best - y.best);
  const C = hw4[0];
  const pA = pBeatsWaymo(A), pB = pBeatsWaymo(B);
  const mixture = A.weight * pA + B.weight * pB + C.weight * C_COUNTS;
  const tolerance = 0.005 * (pB - pA);
  const fitB = (MARKET_PRICE - C_WEIGHT * C_COUNTS - (1 - C_WEIGHT) * pA) / (pB - pA);
  if (C.weight !== C_WEIGHT || C.weight !== app.eyesOff.weight) problems.push(`C's weight is ${C.weight} (TESLA_EYES_OFF.weight ${app.eyesOff.weight}); the fit holds it at its judged ${C_WEIGHT}`);
  if (Math.abs(A.weight + B.weight + C.weight - 1) > 1e-12) problems.push(`the weights sum to ${A.weight + B.weight + C.weight}`);
  if (!(Math.abs(mixture - MARKET_PRICE) <= tolerance))
    problems.push(`weights A ${A.weight}, B ${B.weight}, C ${C.weight} with P_A ${pA.toFixed(4)}, P_B ${pB.toFixed(4)} and C counting ${C_COUNTS} give ${mixture.toFixed(4)}, ${(mixture - MARKET_PRICE).toFixed(4)} from the market's ${MARKET_PRICE} (tolerance ${tolerance.toFixed(4)}, half a 0.01 step of B); the fit is B ${fitB.toFixed(4)}, A ${(1 - C_WEIGHT - fitB).toFixed(4)}`);
  console.log(`weights A ${A.weight} B ${B.weight} C ${C.weight}: P_A ${pA.toFixed(4)}, P_B ${pB.toFixed(4)}, mixture ${mixture.toFixed(4)} against ${MARKET_PRICE}; fit B ${fitB.toFixed(4)}`);
}

// --- 2. C's eyes-off miles a car-day at Tesla's latest FSD miles a car-day ---
const FSD_MILES_END_JUN_2026 = 11.818e9, FSD_MILES_END_SEP_2026 = 15.493e9;
const ACTIVE_FSD_END_Q2_2026 = 1.48e6, ACTIVE_FSD_END_Q3_2026 = 1.74e6;
const Q3_DAYS = 92;
const sourced = (FSD_MILES_END_SEP_2026 - FSD_MILES_END_JUN_2026) / Q3_DAYS / ((ACTIVE_FSD_END_Q2_2026 + ACTIVE_FSD_END_Q3_2026) / 2);
const perCarDay = app.eyesOff.milesPerCarDay;
if (perCarDay === undefined || perCarDay === null) problems.push(`TESLA_EYES_OFF has no milesPerCarDay band (its keys: ${Object.keys(app.eyesOff).join(", ")})`);
else {
  if (perCarDay.best !== Number(sourced.toPrecision(2)))
    problems.push(`TESLA_EYES_OFF.milesPerCarDay.best is ${perCarDay.best}; Tesla's Q3-2026 FSD (Supervised) miles per active FSD car-day is ${sourced.toFixed(2)}, ${Number(sourced.toPrecision(2))} at two significant figures`);
  if (!(0 < perCarDay.lo && perCarDay.lo <= perCarDay.best && perCarDay.best <= perCarDay.hi))
    problems.push(`TESLA_EYES_OFF.milesPerCarDay ${JSON.stringify(perCarDay)} must satisfy 0 < lo <= best <= hi`);
}
console.log(`Q3-2026 FSD (Supervised) miles per active FSD car-day: ${sourced.toFixed(2)}; TESLA_EYES_OFF.milesPerCarDay ${JSON.stringify(perCarDay)}`);

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: read Tesla's scenario components (FLEET_FORECAST) and TESLA_EYES_OFF, and recompute the market fit and the Q3-2026 FSD miles a car-day from the figures this qual records.
Expectata: the weights reproduce the market's 2026-11-02 price, ${MARKET_PRICE}, within half a 0.01 step of B's weight, with C at its judged ${C_WEIGHT}; C's eyes-off miles a car-day has its best at ${Number(sourced.toPrecision(2))} (${sourced.toFixed(2)}, Tesla's Q3-2026 FSD (Supervised) miles per active FSD car-day).
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: Tesla's scenario weights reproduce their 2026-11-02 market fit and C's eyes-off miles a car-day is Tesla's Q3-2026 FSD miles per active FSD car-day");

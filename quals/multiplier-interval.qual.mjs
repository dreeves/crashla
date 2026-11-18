// The summary cards' multipliers and their 95% intervals. Since 2026-11-17
// each card line prints a multiplier and its own 95% interval, in the
// human's layout ("Injury: 155 incidents → 1,660,192 MPI (6.00x)" over
// "95% CI: 1,387,848 – 2,010,475 (3.15x – 11.5x)", then "ok, build it"). A
// multiplier is the ratio R = (the line's MPI) / (the human MPI): the line's
// MPI is its marginal posterior (the page's, makeMarginalMpiCdf), the human
// MPI log-normal with the metric's Humans (AV cities) band as its 95%
// interval (as the distribution chart draws the human curve), the two
// independent. The card prints R's median and its 2.5% and 97.5% quantiles
// (multiplierInterval). Until 2026-11-17 the card printed the line's median
// over the band's geometric middle, with no interval; the page's only range of
// multiples was the sensitivity table's, the line's 95% CI over the band's
// ends read as hard limits (Waymo's at-fault injury: 9.54x to 245x, where R's
// 95% interval is 14.4x to 147x).
//
// The reference here is independent of the app's method, which integrates
// over nodes in ln(VMT / human MPI) placed by that quantity's closed-form
// density (ratioPriorNodes): P(R <= r) = E_z[F(r e^(mu + sigma z))], F the
// app's marginal MPI CDF and z the human's standard normal, by the trapezoid
// rule on [-8.5, 8.5] in steps of 0.04. At each quantile the app gives, the
// reference's CDF and density there give the quantile's error in ln R,
// (F_ref - p) / f_ref, held to TOL: a relative error of 1e-4, a fifth of the
// smallest half-unit of a figure printed to three significant figures
// (5e-4, for figures of 999), so that a printed figure can round differently
// from the exact one only when the exact one lies within 1e-4 of a rounding
// boundary. Seen on 2026-11-17: at most 3.4e-5 over the default window's 40
// multipliers, and 6e-5 on the synthetic zero-incident case (a 0.8x-3x VMT
// band against the fatality band's narrow sigma, 0.06), which missed by
// 5e-4 before ratioPriorNodes' spacing resolved the density's shoulder.
//
// Checked on every multiplier the default window's cards print, and on
// synthetic cases that live data may not hold: a symmetric band; zero
// incidents on an asymmetric band against a narrow human band (the fatality
// metric's kind); a fault mixture (fractional counts); 1,500 incidents; and a
// degenerate VMT band (min = best = max: both halves of the VMT prior then
// vanish, and the nodes take the human normal alone). A human band of no
// width must stop the computation (its sigma would be 0).
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const TOL = 1e-4;

class ElementStub {
  constructor(t) { this.tagName = t; this._text = ""; this._html = ""; }
  set textContent(v) { this._text = v; this._html = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
}
const ctx = vm.createContext({ console, document: { getElementById: () => new ElementStub("div"), createElement: t => new ElementStub(t) } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));

assert.equal(vm.runInContext("typeof multiplierInterval", ctx), "function",
  `Replicata: load crashla.js and look for multiplierInterval, the summary cards' multiplier and its 95% interval.
Expectata: a function of (an estimate, a human band) giving {median, lo, hi}.
Resultata: ${vm.runInContext("typeof multiplierInterval", ctx)}.`);

// The reference, in the app's context (so that it calls the app's own
// marginal CDF): the error in ln R of the app's quantile at level p.
vm.runInContext(`
  var __refError = (est, human, p, r) => {
    const cdf = makeMarginalMpiCdf(est.comps, est.vmtMin, est.vmtBest, est.vmtMax);
    const mu = (Math.log(human.lo) + Math.log(human.hi)) / 2, sigma = (Math.log(human.hi) - Math.log(human.lo)) / (2 * 1.96);
    let F = 0, f = 0;
    for (let i = 0; i <= 425; i++) {
      const z = -8.5 + 0.04 * i, w = (i === 0 || i === 425 ? 0.02 : 0.04) * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      const e = cdf.evalBoth(r * Math.exp(mu + sigma * z));
      F += w * e.cdf; f += w * e.dens;
    }
    return (F - p) / f;
  };
`, ctx);

// The cases: {name, est (from estimateMpiWindow or the cards' rows), human}.
vm.runInContext(`
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  var __full = monthSeriesData();
  var __cases = [];
  for (const row of monthlySummaryRows(sliceSeries(__full, __full.months.indexOf(DEFAULT_START_MONTH), __full.months.length - 1))) {
    if (!ADS_SERIES.includes(row.helmer) || row.vmtBest === 0) continue;
    for (const m of METRIC_DEFS) {
      const est = row.mpiEstimates[m.key], human = m.humanMPI && m.humanMPI.HumansAV;
      if (est && human && est.k !== null) __cases.push({name: row.helmer + " " + m.key, est, human});
    }
  }
  __cases.push(
    {name: "synthetic: 2 incidents, symmetric band", est: estimateMpiWindow(2, null, 1e6, 2e6, 4e6), human: {lo: 150000, hi: 500000}},
    {name: "synthetic: 0 incidents, asymmetric band, narrow human band", est: estimateMpiWindow(0, null, 8e5, 1e6, 3e6), human: {lo: 83e6, hi: 105e6}},
    {name: "synthetic: fault mixture", est: estimateMpiWindow(1.3, [0.9, 0.2, 0.1, 0.1], 800818, 1931503, 13342289), human: {lo: 103000, hi: 430000}},
    {name: "synthetic: 1,500 incidents", est: estimateMpiWindow(1500, null, 2.3e8, 2.5e8, 2.8e8), human: {lo: 103000, hi: 214000}},
    {name: "synthetic: degenerate VMT band", est: estimateMpiWindow(5, null, 2e6, 2e6, 2e6), human: {lo: 150000, hi: 500000}});
`, ctx);
const nLive = run("__cases.filter(c => !c.name.startsWith('synthetic')).length");
assert.ok(nLive >= 30,
  `Replicata: collect the default window's card multipliers (every ADS line with miles, every metric with a Humans (AV cities) band).
Expectata: at least 30 (40 on 2026-11-17: four lines, ten metrics).
Resultata: ${nLive}.`);

const results = run(`__cases.map(c => {
  const m = multiplierInterval(c.est, c.human);
  const errors = [[0.025, m.lo], [0.5, m.median], [0.975, m.hi]].map(([p, r]) => Number.isFinite(r) && r > 0 ? __refError(c.est, c.human, p, r) : NaN);
  return {name: c.name, k: c.est.k, m, errors};
})`);
const bad = results.filter(r => !(r.m.lo > 0 && r.m.lo < r.m.median && r.m.median < r.m.hi && Number.isFinite(r.m.hi)) ||
  !r.errors.every(e => Number.isFinite(e) && Math.abs(e) <= TOL));
const worst = Math.max(...results.flatMap(r => r.errors.map(Math.abs)));
assert.deepEqual(bad.map(r => r.name), [],
  `Replicata: compute multiplierInterval for the default window's ${nLive} card multipliers and ${results.length - nLive} synthetic cases, and the error of each of its three quantiles in ln R against the reference (the app's marginal MPI CDF over the human log-normal, trapezoid rule in z).
Expectata: 0 < lo < median < hi, and each quantile within ${TOL} of the reference's in ln R.
Resultata: ${JSON.stringify(bad.slice(0, 6))}.`);

// A human band of no width has no log-normal (sigma 0): the computation stops.
const zeroWidth = vm.runInContext(`(() => { try { multiplierInterval(estimateMpiWindow(2, null, 1e6, 2e6, 4e6), {lo: 2e5, hi: 2e5}); return "no error"; } catch (e) { return String(e.message); } })()`, ctx);
assert.ok(zeroWidth !== "no error",
  `Replicata: call multiplierInterval with a human band of no width (lo = hi = 200,000).
Expectata: it stops with an error (the human MPI's log-normal needs a sigma above 0).
Resultata: ${zeroWidth}.`);

const waymo = results.find(r => r.name === "Waymo injury");
console.log(`qual pass: ${results.length} multipliers (${nLive} on the default window's cards, ${results.length - nLive} synthetic) match the reference to ${worst.toExponential(1)} in ln R (tolerance ${TOL})${waymo ? `; Waymo injury ${waymo.m.median.toPrecision(3)}x, 95% ${waymo.m.lo.toPrecision(3)}x to ${waymo.m.hi.toPrecision(3)}x` : ""}; a human band of no width stops it`);

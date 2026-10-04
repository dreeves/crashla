// The at-fault metrics count incidents fractionally by faultfrac =
// P(an expert human driver would have avoided the collision). The
// faultfrac-uncertainty model (2026-08-21) stops treating the summed
// fractional mass as an EXACT Poisson count: the true at-fault count K is
// K ~ PoissonBinomial({p_i}), so the rate posterior is the mixture
// sum_K P(K|{p_i}) Gamma(K + 1/2, VMT) — reducing exactly to the plain
// Gamma posterior when every p_i is 0 or 1. In the same decision, displayed
// CIs became exact quantiles of the posterior MARGINALIZED over the VMT
// prior (the drawn bell), replacing the conservative double-extreme
// envelope, so "95% CI" now means exactly 95%.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, URLSearchParams });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));

// --- 1. Poisson-binomial pmf correctness ---
const pb = run(`poissonBinomialWeights([0.5, 0.5])`);
assert.ok(
  Math.abs(pb[0] - 0.25) < 1e-12 && Math.abs(pb[1] - 0.5) < 1e-12 &&
    Math.abs(pb[2] - 0.25) < 1e-12,
  `Replicata: poissonBinomialWeights([0.5, 0.5]).
Expectata: [0.25, 0.5, 0.25] (two fair coins).
Resultata: ${JSON.stringify(pb)}.`);
const pbSum = run(`poissonBinomialWeights([0.9, 0.4, 0.15, 0.75, 0.05])
  .reduce((s, w) => s + w, 0)`);
assert.ok(Math.abs(pbSum - 1) < 1e-12,
  `Replicata: sum the Poisson-binomial pmf over K.
Expectata: 1 (it is a probability distribution).
Resultata: ${pbSum}.`);

// --- 2. mixtureComponents: integer path and degenerate all-certain path ---
const intComps = run(`mixtureComponents(2, null)`);
assert.ok(intComps.length === 1 && intComps[0].a === 2.5 && intComps[0].w === 1,
  `Replicata: mixtureComponents(2, null) (integer-count metric).
Expectata: single component Gamma(2.5) with weight 1 (plain Jeffreys posterior).
Resultata: ${JSON.stringify(intComps)}.`);
const certComps = run(`mixtureComponents(2, [1, 1])`);
assert.ok(certComps.length === 1 && certComps[0].a === 2.5 &&
    Math.abs(certComps[0].w - 1) < 1e-12,
  `Replicata: mixtureComponents(2, [1, 1]) (all fault fractions certain).
Expectata: collapses to the single Gamma(2.5) component — the mixture must
reduce exactly to the plain posterior when every p is 0 or 1.
Resultata: ${JSON.stringify(certComps)}.`);

// --- 3. Fractional fault mass widens the CI vs the point-count treatment ---
const widen = run(`
(() => {
  const mix = estimateMpiWindow(0.5, [0.5], 1e6, 2e6, 4e6);
  const pt = estimateMpiWindow(0.5, null, 1e6, 2e6, 4e6);
  return { mixLo: mix.lo, mixHi: mix.hi, ptLo: pt.lo, ptHi: pt.hi };
})()`);
assert.ok(widen.mixLo < widen.ptLo && widen.mixHi > widen.ptHi,
  `Replicata: estimateMpiWindow(k=0.5, fracs=[0.5], ...) vs the same k as a point count.
Expectata: the Poisson-binomial mixture (50% K=0, 50% K=1) is WIDER on both
ends than pretending k=0.5 was an exact count.
Resultata: mixture [${widen.mixLo}, ${widen.mixHi}] vs point [${widen.ptLo}, ${widen.ptHi}].`);

// --- 4. Displayed CI = exact quantiles of the drawn bell (the M4 resolution) ---
// Integrate each summary estimate's own densityFn between est.lo and est.hi:
// the mass must be massFrac (95%), not the >=95% of the old conservative
// double-extreme envelope (which ran 97.9-99.4%).
const masses = run(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const series = sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH),
    full.months.length - 1);
  const rows = monthlySummaryRows(series);
  const ciMass = est => {
    const nPts = 4000;
    const uLo = Math.log(est.lo), uHi = Math.log(est.hi);
    const step = (uHi - uLo) / (nPts - 1);
    let mass = 0;
    for (let i = 0; i < nPts; i++) {
      const w = i === 0 || i === nPts - 1 ? 0.5 : 1;
      mass += w * est.densityFn(Math.exp(uLo + step * i)) * step;
    }
    return mass;
  };
  const out = {};
  for (const helmer of ["Waymo", "Zoox"]) {
    const row = rows.find(r => r.helmer === helmer);
    for (const key of ["all", "atfault"]) {
      out[helmer + "." + key] = ciMass(row.mpiEstimates[key]);
    }
  }
  return out;
})()`);
for (const [key, mass] of Object.entries(masses)) {
  assert.ok(Math.abs(mass - 0.95) < 0.005,
    `Replicata: integrate ${key}'s drawn density between its displayed 95% CI endpoints.
Expectata: 0.95 within 0.005 — the CI is the exact quantile pair of the
plotted marginal posterior, not a conservative envelope.
Resultata: ${mass}.`);
}

// --- 5. Per-month fan bands carry exact mass too ---
const fanMass = run(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const entry = full.points[full.months.indexOf("2026-06")].helmers.Waymo;
  const mpi = entry.mpiByMetric.atfault;
  const fracs = entry.incidents.atFaultFracs;
  const comps = mixtureComponents(entry.incidents.atFault, fracs);
  // the band behind the month's posterior (the one-month window band, which
  // the record carries since 2026-10-03)
  const cdf = makeMarginalMpiCdf(comps, mpi.vmtMin, mpi.vmtBest, mpi.vmtMax);
  return CI_FAN_LEVELS.map((level, i) =>
    ({ level, mass: cdf(mpi.bands[i].hi) - cdf(mpi.bands[i].lo) }));
})()`);
for (const { level, mass } of fanMass) {
  assert.ok(Math.abs(mass - level) < 0.005,
    `Replicata: Waymo 2026-06 at-fault fan band mass at level ${level}.
Expectata: the band [lo, hi] contains exactly ${level} of the month's marginal
posterior (within 0.005).
Resultata: ${mass}.`);
}

// --- 6. Asymmetric authored bands: the VMT prior honors the endpoints ---
// The prior is a two-piece ("split") log-normal with MODE at vmtBest and each
// authored endpoint at exactly +/-1.96 of its own side's sigma, so total mass
// outside [vmtMin, vmtMax] is exactly 5% (split sigmaLo:sigmaHi between the
// tails) even when the band is asymmetric — the S1 audit finding: a single
// symmetric sigma left only 92.45% between Tesla-July-style endpoints.
// Pinned against an INDEPENDENT scipy integration, NOT against the app's own
// machinery. Until 2026-10-03 the pins were 14996 / 67703 / 419456 within
// 0.3%: the values of the prior TRUNCATED at +/-4 sigma (the app's
// integration range then), which moves this band's 2.5% edge by 4e-4. They
// are now the untruncated prior's (Gauss-Legendre on each half of the prior,
// gammaincc + brentq; impl/reports/E1-evidence/scripts/ref_pins.py), held to
// the model tolerance of section 7.
const MODEL_TOL = 5e-5;
const asym = run(`
(() => {
  const est = estimateMpiWindow(2, null, 55000, 170000, 340000);
  return { lo: est.lo, median: est.quant(0.5), hi: est.hi };
})()`);
const ASYM_PINS = { lo: 14989.976863, median: 67702.026848, hi: 419518.508250 };
for (const [key, pin] of Object.entries(ASYM_PINS)) {
  assert.ok(Math.abs(asym[key] / pin - 1) < MODEL_TOL,
    `Replicata: estimateMpiWindow(k=2, asymmetric band [55k, 170k, 340k]), ${key} quantile.
Expectata: ${pin} within ${MODEL_TOL} relative (independent scipy integration of
the untruncated two-piece prior — mode at vmtBest, endpoints at 1.96 of their
own side's sigma).
Resultata: ${asym[key]} (${(asym[key] / pin - 1).toExponential(2)}).`);
}

// --- 7. Displayed quantiles are the documented model's (audit #88) ---------
// The page's cards and tooltips print MPIs to the mile and to four
// significant figures, so the quadrature behind them must reproduce the
// model those numbers claim: until 2026-10-03 the Simpson grid straddled the
// two-piece prior's kink at its mode and cut the prior at +/-4 sigma, and the
// default window's Tesla card read 126,364 (83,588 - 202,762) for a model
// value of 126,328 (83,576 - 202,725); a data-through month's wide band missed
// by up to 1.2e-3. Synthetic inputs shaped like the page's hardest estimates
// (a 23-incident window, a fault mixture on it, the widest single-month band
// with 10 incidents, a 1.1-incident mixture and k = 0 on wide bands, 1,164
// incidents on a tight one), pinned to the untruncated model by the same
// independent recompute as section 6.
const MODEL_PINS = {
  "k=23 window": [23, null, [2534258.56, 2723730.68, 3498000], [83575.547504, 126328.332973, 202724.861202]],
  "k=8.55 fault mixture": [8.55, [1, 1, 0.75, 0.9, 1, 1, 1, 1, 0.9], [2534258.56, 2723730.68, 3498000], [179390.468547, 336182.511894, 739438.709780]],
  "k=10, widest band": [10, null, [800818.32768, 1931502.908188, 13342288.96], [74613.841714, 275894.293438, 1694666.935489]],
  "k=1.1 mixture, widest band": [1.1, [0.1, 0.1, 0.9], [800818.32768, 1931502.908188, 13342288.96], [333840.885551, 2463490.814450, 85526942.372793]],
  "k=0, wide band": [0, null, [8656.536, 23726.22, 172380], [8826.256018, 164979.315485, 84521164.084808]],
  "k=1164, tight band": [1164, null, [200843798.32768, 211033758.908188, 232946420.96], [169252.198746, 184539.003026, 204701.744262]],
};
for (const [name, [k, fracs, band, pins]] of Object.entries(MODEL_PINS)) {
  const got = run(`(() => {
    const est = estimateMpiWindow(${k}, ${JSON.stringify(fracs)}, ${band.join(", ")});
    return [est.lo, est.quant(0.5), est.hi];
  })()`);
  got.forEach((value, i) => {
    const which = ["2.5%", "50%", "97.5%"][i];
    assert.ok(Math.abs(value / pins[i] - 1) < MODEL_TOL,
      `Replicata: estimateMpiWindow for "${name}" (k=${k}, fracs ${JSON.stringify(fracs)}, band [${band.join(", ")}]), ${which} quantile.
Expectata: the documented model's ${pins[i]} within ${MODEL_TOL} relative.
Resultata: ${value} (${(value / pins[i] - 1).toExponential(2)}).`);
  });
}

console.log("qual pass: fault fractions enter as a Poisson-binomial mixture and every displayed CI is an exact quantile pair of its drawn posterior");

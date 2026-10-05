"use strict";

function fail(msg, details) {
  const suffix = details === undefined ? "" : " " + JSON.stringify(details);
  throw new Error(msg + suffix);
}

function assert(cond, msg, details) {
  cond || fail(msg, details);
}

function byId(id) {
  const node = document.getElementById(id);
  assert(node !== null, "Missing required DOM node", {id});
  return node;
}

// --- Gamma distribution math ---

// Log-gamma via Lanczos approximation (g=7, n=9)
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + 7.5; // g + 0.5
  for (let i = 1; i < 9; i++) a += LANCZOS_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Lower regularized incomplete gamma function P(a, x)
// Series expansion for x < a + 1, continued fraction otherwise
function gammainc(a, x) {
  if (x < 0) return 0;
  if (x === 0) return 0;
  // Iteration cap for both branches. Near x ~ a the series terms decay like
  // exp(-n^2 / 2a), so reaching 1e-14 needs ~sqrt(64a) terms (~360 at
  // a = 2000, the Waymo all-incident shape); a fixed cap of 200 used to
  // truncate silently for a >~ 1000 (5e-6 error at a = 2000, 5e-3 at 6000).
  // The cap scales with a and non-convergence fails loudly (anti-Postel).
  const nMax = Math.max(200, Math.ceil(8 * Math.sqrt(a)) + 50);
  if (x < a + 1) {
    // Series: P(a,x) = e^{-x} x^a sum_{n=0}^{inf} x^n / Gamma(a+n+1)
    let sum = 1 / a;
    let term = 1 / a;
    let converged = false;
    for (let n = 1; n <= nMax; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) { converged = true; break; }
    }
    assert(converged, "gammainc: series did not converge", {a, x, nMax});
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  // Continued fraction for upper gamma Q(a,x) = 1 - P(a,x)
  // Using modified Lentz's method
  let f = x - a + 1;
  if (Math.abs(f) < 1e-30) f = 1e-30;
  let c = f;
  let d = 0;
  let converged = false;
  for (let n = 1; n <= nMax; n++) {
    const an = n * (a - n);
    const bn = x - a + 1 + 2 * n;
    d = bn + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = bn + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-14) { converged = true; break; }
  }
  assert(converged, "gammainc: continued fraction did not converge", {a, x, nMax});
  const q = Math.exp(-x + a * Math.log(x) - lgamma(a)) / f;
  return 1 - q;
}

// Gamma quantile: find x such that P(a, x*b) = p, where Gamma(a, b) has rate b
// Returns x (the quantile of Gamma(shape=a, rate=b))
// Normal quantile approximation (Abramowitz & Stegun 26.2.23)
function normalQuantApprox(p) {
  const t = p < 0.5 ? p : 1 - p;
  const s = Math.sqrt(-2 * Math.log(t));
  const zabs = s - (2.515517 + 0.802853*s + 0.010328*s*s) /
                     (1 + 1.432788*s + 0.189269*s*s + 0.001308*s*s*s);
  return p < 0.5 ? -zabs : zabs;
}

// Closed-form approximate quantile of Gamma(shape a, rate b) via the
// Wilson-Hilferty chi-squared approximation — no iteration, accurate to a few
// percent for a >~ 2 over the p range in play (several-fold off in the tails
// at a = 0.5, which the padded, widening bracket absorbs). Used for Newton starting points and
// (padded) search brackets; gammaquant refines it when exactness matters.
function approxGammaQuant(a, b, p) {
  const nu = 2 * a;
  const wh = 1 - 2/(9*nu) + normalQuantApprox(p) * Math.sqrt(2/(9*nu));
  return (nu / 2) * Math.max(wh * wh * wh, 0.001) / b;
}

function gammaquant(a, b, p) {
  assert(a > 0 && b > 0 && p > 0 && p < 1,
    "gammaquant: invalid params", {a, b, p});
  // Initial guess via Wilson-Hilferty approximation on chi-squared
  let x = approxGammaQuant(a, b, p);
  // Newton's method to refine
  for (let i = 0; i < 50; i++) {
    const cdf = gammainc(a, x * b);
    const err = cdf - p;
    if (Math.abs(err) < 1e-12) break;
    // PDF of Gamma(a, b): b^a x^{a-1} e^{-bx} / Gamma(a)
    const logpdf = a * Math.log(b) + (a-1) * Math.log(x) - b*x - lgamma(a);
    const pdf = Math.exp(logpdf);
    if (pdf < 1e-100) break; // avoid division by ~0
    const step = err / pdf;
    x = Math.max(x - step, x / 10); // don't go negative or overshoot
  }
  return x;
}

// --- Fault-fraction (Poisson-binomial) mixture machinery ---
// The at-fault metrics count each incident fractionally by faultfrac =
// P(an expert human driver would have avoided the collision). Treating the
// summed fractional mass as an EXACT Poisson count ignores that the true
// at-fault count K is itself uncertain: K ~ PoissonBinomial({p_i}). The rate
// posterior is therefore the mixture sum_K P(K|{p_i}) · Gamma(K + 1/2, VMT),
// which reduces exactly to the plain Jeffreys-Gamma posterior when every p_i
// is 0 or 1. (The fatality metric's 1/vehiclesInvolved fractions are
// deliberate DETERMINISTIC allocations — Koopman's fractional-death
// accounting, see the fatality comment below — not probabilities, so that
// metric stays on the single-component path.)
function poissonBinomialWeights(fracs) {
  let w = [1];
  for (const p of fracs) {
    assert(p > 0 && p <= 1, "poissonBinomialWeights: p outside (0, 1]", {p});
    const next = new Array(w.length + 1).fill(0);
    for (let i = 0; i < w.length; i++) {
      next[i] += w[i] * (1 - p);
      next[i + 1] += w[i] * p;
    }
    w = next;
  }
  return w;
}

// Posterior mixture components [{a, w}] over the at-fault count K, trimmed to
// the K range carrying non-negligible probability. Trimming only the ENDS is
// safe: the Poisson-binomial pmf is log-concave, hence unimodal, so no
// above-floor weight can hide beyond a below-floor tail. Consecutive
// components differ by exactly 1 in shape — the density/CDF recurrences below
// rely on that. fracs = null (or empty) is the single-component path, used by
// every integer-count metric and by fatality's deterministic fractions.
const MIX_WEIGHT_FLOOR = 1e-12;
function mixtureComponents(k, fracs) {
  if (!fracs || fracs.length === 0) return [{a: k + 0.5, w: 1}];
  const sum = fracs.reduce((s, p) => s + p, 0);
  assert(Math.abs(sum - k) < 1e-6, "mixtureComponents: fracs don't sum to k", {k, sum});
  const w = poissonBinomialWeights(fracs);
  let first = 0;
  while (first < w.length - 1 && w[first] <= MIX_WEIGHT_FLOOR) first++;
  let last = w.length - 1;
  while (last > first && w[last] <= MIX_WEIGHT_FLOOR) last--;
  const comps = [];
  for (let K = first; K <= last; K++) comps.push({a: K + 0.5, w: w[K]});
  return comps;
}

// Marginal CDF of true MPI: P(MPI <= x) with the rate-posterior mixture
// integrated over the same two-piece log-normal VMT prior as the drawn bell
// (makeMarginalMpiDensity), on the same nodes (vmtPriorNodes). P(MPI <= x |
// K, v) = Q(a_K, v/x) (upper regularized gamma). Consecutive shapes use the
// recurrence Q(a+1, w) = Q(a, w) + w^a e^{-w} / Γ(a+1), so each prior node
// costs ONE gammainc plus cheap multiplies regardless of how many K
// components exist. Returns cdf(x); cdf.evalBoth(x) gives {cdf, dens} where
// dens is dF/d(ln x) (the marginal density w.r.t. log x), for Newton
// quantile-finding. The fault-flip search uses this same CDF (it forced a
// 13-node one until 2026-10-03). Accuracy: see vmtPriorNodes.
function makeMarginalMpiCdf(comps, vmtMin, vmtBest, vmtMax) {
  const prior = vmtPriorNodes(vmtMin, vmtBest, vmtMax, comps[comps.length - 1].a);
  const a0 = comps[0].a;
  const lg0 = lgamma(a0);      // for the density recurrence base
  const lg1 = lgamma(a0 + 1);  // for the CDF recurrence base
  // The recurrences need consecutive shapes (a, a+1, a+2, ...), which is what
  // mixtureComponents produces. The flip-multiplier's mass-scaled mixtures
  // space shapes by s instead, so keep a generic per-component path for them.
  const consecutive = comps.every((c, j) =>
    j === 0 || Math.abs(c.a - comps[j - 1].a - 1) < 1e-12);
  const lgs = consecutive ? null : comps.map(c => lgamma(c.a));
  const evalBoth = x => {
    const lnx = Math.log(x);
    let cdf = 0, dens = 0;
    for (let i = 0; i < prior.v.length; i++) {
      const w = prior.v[i] / x;
      const lnw = prior.lnv[i] - lnx;
      let cdfSum = 0, densSum = 0;
      if (consecutive) {
        let q = 1 - gammainc(a0, w);              // Q(a0, w)
        let t = Math.exp(a0 * lnw - w - lg1);     // w^a0 e^-w / Γ(a0+1)
        let d = Math.exp(a0 * lnw - w - lg0);     // gamma pdf · w = dQ/d(ln x)
        cdfSum = comps[0].w * q;
        densSum = comps[0].w * d;
        for (let j = 1; j < comps.length; j++) {
          q += t;                    // Q(a+1, w) = Q(a, w) + w^a e^-w / Γ(a+1)
          d *= w / comps[j - 1].a;   // pdf recurrence: ratio w / a
          t *= w / comps[j].a;       // term recurrence: ratio w / (a+1)
          cdfSum += comps[j].w * q;
          densSum += comps[j].w * d;
        }
      } else {
        for (let j = 0; j < comps.length; j++) {
          cdfSum += comps[j].w * (1 - gammainc(comps[j].a, w));
          densSum += comps[j].w * Math.exp(comps[j].a * lnw - w - lgs[j]);
        }
      }
      cdf += prior.w[i] * cdfSum;
      dens += prior.w[i] * densSum;
    }
    return {cdf, dens};
  };
  const cdf = x => evalBoth(x).cdf;
  cdf.evalBoth = evalBoth;
  return cdf;
}

// p-quantile of the marginal MPI posterior: safeguarded Newton on ln(x) with
// a hard bracket from the most extreme (component, prior-edge) conditional
// quantiles. Shares one CDF closure across quantile calls via makeMarginal-
// MpiQuant so the per-estimate node setup happens once.
function makeMarginalMpiQuant(comps, vmtMin, vmtBest, vmtMax) {
  const cdf = makeMarginalMpiCdf(comps, vmtMin, vmtBest, vmtMax);
  const {sigmaLo, sigmaHi} = splitPriorSigmas(vmtMin, vmtBest, vmtMax);
  const vLo = vmtBest * Math.exp(-VMT_MARGIN_SIGMAS * sigmaLo);
  const vHi = vmtBest * Math.exp(VMT_MARGIN_SIGMAS * sigmaHi);
  const aLo = comps[0].a, aHi = comps[comps.length - 1].a;
  const aMean = comps.reduce((s, c) => s + c.w * c.a, 0);
  return p => {
    assert(p > 0 && p < 1, "marginal quantile: p out of range", {p});
    // MPI quantile conditional on (a, v) is 1 / gammaquant(a, v, 1-p); the
    // mixture's quantile lies between the two extreme conditionals. Cheap
    // closed-form Wilson-Hilferty conditionals suffice here — padded 2x each
    // way (and widened further below if the pad ever falls short), since the
    // safeguarded Newton supplies the exactness. The conditional at the MEAN
    // shape and central VMT is the starting point (typically within a few
    // percent of the answer).
    let xLo = 1 / (approxGammaQuant(aHi, vLo, 1 - p) * 2);
    let xHi = 2 / approxGammaQuant(aLo, vHi, 1 - p);
    for (let g = 0; g < 8 && cdf(xLo) > p; g++) xLo /= 8;
    for (let g = 0; g < 8 && cdf(xHi) < p; g++) xHi *= 8;
    let x = Math.min(Math.max(1 / approxGammaQuant(aMean, vmtBest, 1 - p), xLo), xHi);
    for (let i = 0; i < 40; i++) {
      const {cdf: F, dens} = cdf.evalBoth(x);
      const err = F - p;
      // Displayed values are whole miles: 1e-8 of CI mass moves the quantile
      // by far less than a mile at every magnitude in play.
      if (Math.abs(err) < 1e-8) break;
      if (err > 0) xHi = Math.min(xHi, x); else xLo = Math.max(xLo, x);
      // Newton step on ln(x); fall back to log-bisection when the step
      // escapes the bracket or the density underflows.
      const step = dens > 1e-300 ? err / dens : NaN;
      const next = Number.isFinite(step) ? x * Math.exp(-step) : NaN;
      x = next > xLo && next < xHi ? next : Math.sqrt(xLo * xHi);
      if (xHi / xLo < 1 + 1e-9) break;
    }
    return x;
  };
}

// Mixture version of makeMarginalMpiDensity (below): the drawn bell for a
// fault metric is the weighted sum of the per-K marginal bells. Falls back to
// the single-component builder for integer-count metrics. Same nodes and
// recurrence trick as the CDF: consecutive shapes differ by 1, so each node
// costs one exp plus cheap multiplies. The returned function carries .mean,
// the drawn curve's mean (marginalMpiMean).
function makeMixtureMarginalMpiDensity(comps, vmtMin, vmtBest, vmtMax) {
  if (comps.length === 1) {
    return makeMarginalMpiDensity(comps[0].a, vmtMin, vmtBest, vmtMax);
  }
  const prior = vmtPriorNodes(vmtMin, vmtBest, vmtMax, comps[comps.length - 1].a);
  const a0 = comps[0].a;
  const lg0 = lgamma(a0);
  const logW = prior.w.map(w => Math.log(w)); // ln(prior weight), no alpha terms
  const density = x => {
    const lnx = Math.log(x);
    let sum = 0;
    for (let i = 0; i < prior.v.length; i++) {
      const r = prior.v[i] / x;    // v/x
      let d = Math.exp(logW[i] + a0 * (prior.lnv[i] - lnx) - r - lg0);
      let inner = comps[0].w * d;
      for (let j = 1; j < comps.length; j++) {
        d *= r / comps[j - 1].a;
        inner += comps[j].w * d;
      }
      sum += inner;
    }
    return sum;
  };
  density.mean = marginalMpiMean(comps, prior);
  return density;
}

// Inverse-gamma density w.r.t. log(x): f(x)·x where f is the InvGamma PDF.
// If λ ~ Gamma(α, β) then MPI = 1/λ ~ InvGamma(α, β).
// log(f(x)·x) = α·ln(β) − lnΓ(α) − α·ln(x) − β/x
function invGammaLogDensity(x, alpha, beta) {
  return Math.exp(alpha * Math.log(beta) - lgamma(alpha) - alpha * Math.log(x) - beta / x);
}

// Log-normal density w.r.t. log(x): if ln(X) ~ N(μ, σ²) then this is
// the density on a log-scaled axis, i.e., the normal PDF in log-space.
function logNormalLogDensity(x, mu, sigma) {
  assert(sigma > 0, "logNormalLogDensity: sigma must be positive", {sigma});
  const z = (Math.log(x) - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

// Marginal density of true MPI over the VMT band: integrates the inverse-gamma
// posterior InvGamma(alpha, VMT) against a two-piece log-normal prior on VMT
// (mode vmtBest, with [vmtMin, vmtMax] as its exact 95% interval; see
// splitPriorSigmas). The point-estimate curve
// (InvGamma at vmtBest alone) shows only Poisson/sampling uncertainty;
// marginalizing folds in exposure uncertainty too, so the drawn bell is the
// posterior over true MPI rather than one conditional on knowing VMT exactly.
// A log-UNIFORM prior's hard edges show through as a flat-topped "mesa" whenever
// the sampling bell is narrower than the band (e.g. data-rich Waymo), so the prior
// must be smooth. Returns a density w.r.t. log(x), matching invGammaLogDensity so
// the two compose on the same log axis.

// Two-piece ("split") log-normal prior on VMT: MODE at vmtBest, and each
// authored band endpoint sits at exactly ±1.96 of its own side's sigma, so
// the mass outside [vmtMin, vmtMax] is exactly 5% even for asymmetric bands
// (split sigmaLo:sigmaHi between the tails, not 2.5/2.5 — the price of an
// everywhere-continuous density with the mode at vmtBest). This is the same
// family as the forecast machinery's splitLogNormalSigmas (best-at-mode), per
// the S1 decision 2026-08-21; a single symmetric sigma left only ~92.45%
// between Tesla-July-style asymmetric endpoints. Degenerates to the symmetric
// log-normal (bit-exactly) when the band is log-symmetric.
function splitPriorSigmas(vmtMin, vmtBest, vmtMax) {
  const mu = Math.log(vmtBest);
  const sigmaLo = (mu - Math.log(vmtMin)) / 1.96;
  const sigmaHi = (Math.log(vmtMax) - mu) / 1.96;
  assert(sigmaLo >= 0 && sigmaHi >= 0, "splitPriorSigmas: band not ordered",
    {vmtMin, vmtBest, vmtMax});
  return {mu, sigmaLo, sigmaHi};
}

// Quadrature nodes for integrating over the two-piece VMT prior: every
// marginal MPI CDF, density and mean on the page integrates on these.
// Simpson's rule in z = (ln VMT - mu) / sigma, on each half of the prior
// separately, out to VMT_MARGIN_SIGMAS of that half's own sigma, so the mode
// is a node of both halves. Until 2026-10-03 one grid spanned
// mu - 4·sigmaLo .. mu + 4·sigmaHi, so for any asymmetric band a panel
// straddled the mode, where the prior's second derivative jumps (from
// -1/sigmaLo² to -1/sigmaHi², relative to its height) and Simpson's rule loses
// its h^4 accuracy; together with the ±4σ cut that put displayed MPIs up to
// 7.7e-4 from the documented (untruncated) model (audit #88; the default
// Tesla card read 126,364 for a model value of 126,328). Each half's panel
// count is even and grows with two needs: a z-step of at most
// VMT_MARGIN_SIGMAS / VMT_PRIOR_MIN_PANELS for the Gaussian itself, and a
// step in ln(VMT) of at most VMT_PRIOR_LNV_STEP / sqrt(aMax), because the
// conditional CDF Q(a, v/x) turns over a width of ~1/sqrt(a) in ln v (a
// fixed 21 nodes once biased Waymo's all-incident CI mass to 0.952) and the
// drawn density's narrow sampling bell must not drift between nodes (61 fixed
// nodes put sub-pixel bumps in it). VMT_PRIOR_MAX_PANELS caps the cost.
// Weights carry the Simpson factor, the step and the prior's shape, and are
// normalized to sum to 1 (the stranded tail mass beyond VMT_MARGIN_SIGMAS is
// ~4e-8). Measured on 2026-10-03 against an independent integration of the
// untruncated model (Gauss-Legendre in scipy) over 150 window cards and all
// 1,050 per-month posteriors, the displayed 2.5/50/97.5% quantiles sit
// within 4e-5 relative (the worst are k = 0 on a data-through month's wide
// band; the median window card's error is 3.2e-6), against up to 7.7e-4
// before. That is finer than any tooltip's rounding (one decimal of K, M or
// B: at most four figures) but not the cards' whole miles: the default
// window's Tesla card reads 126,329 for the model's 126,328, 322 of the 450
// whole-mile card values still differ from the model's in their last
// digits, and 16 of 3,150 tooltip values round differently from the model's
// (211 before), each within 4e-5 of a rounding boundary.
// fault-mixture.qual holds six such estimates to 5e-5.
// A degenerate band (vmtMin = vmtBest = vmtMax) is one node of weight 1 at
// vmtBest exactly, so the marginal reduces bit-for-bit to the point posterior.
const VMT_MARGIN_SIGMAS = 5.5;     // each half of the prior out to this many of its sigmas
const VMT_PRIOR_MIN_PANELS = 20;   // per half: z-steps of at most 5.5 / 20
const VMT_PRIOR_MAX_PANELS = 160;  // per half
const VMT_PRIOR_LNV_STEP = 0.25;   // ln(VMT) steps of at most this / sqrt(aMax)
function vmtPriorNodes(vmtMin, vmtBest, vmtMax, aMax) {
  const {mu, sigmaLo, sigmaHi} = splitPriorSigmas(vmtMin, vmtBest, vmtMax);
  if (sigmaLo + sigmaHi === 0) return {lnv: [mu], v: [vmtBest], w: [1]};
  const lnv = [], w = [];
  for (const [sigma, sign] of [[sigmaLo, -1], [sigmaHi, 1]]) {
    const wanted = Math.ceil(VMT_MARGIN_SIGMAS * sigma * Math.sqrt(aMax) / VMT_PRIOR_LNV_STEP);
    const panels = 2 * Math.ceil(Math.min(VMT_PRIOR_MAX_PANELS, Math.max(VMT_PRIOR_MIN_PANELS, wanted)) / 2);
    const dz = VMT_MARGIN_SIGMAS / panels;
    for (let j = 0; j <= panels; j++) {
      const z = j * dz;
      const simpson = j === 0 || j === panels ? 1 : j % 2 ? 4 : 2;
      lnv.push(mu + sign * sigma * z);
      w.push(simpson * sigma * dz * Math.exp(-0.5 * z * z));
    }
  }
  // A half of zero width (vmtMin = vmtBest, or vmtBest = vmtMax) carries no
  // mass; its nodes are dropped rather than evaluated.
  const total = w.reduce((s, x) => s + x, 0);
  const keep = w.map(x => x > 0);
  return {
    lnv: lnv.filter((_, i) => keep[i]),
    v: lnv.filter((_, i) => keep[i]).map(u => Math.exp(u)),
    w: w.filter((_, i) => keep[i]).map(x => x / total),
  };
}

// Mean of a marginal MPI curve: MPI | K, v ~ InvGamma(a_K, v) has mean
// v / (a_K - 1), so E[MPI] = E[V] · sum_K w_K / (a_K - 1), infinite when a
// component has a_K <= 1 (k = 0, or fractional fault mass reaching K = 0).
// E[V] is the prior's mean on the curve's own nodes, so this is the mean of
// the drawn curve. Until 2026-10-03 the distribution tooltip used v = vmtBest,
// the mean at the prior's mode, so right-skewed curves printed mean < peak <
// median (Tesla all incidents: 121.1K for a drawn mean of 130.7K; audit #14).
function marginalMpiMean(comps, prior) {
  const meanV = prior.v.reduce((s, v, i) => s + prior.w[i] * v, 0);
  return comps.some(c => c.a <= 1) ? Infinity
    : meanV * comps.reduce((s, c) => s + c.w / (c.a - 1), 0);
}

// Build a density function for true MPI marginalized over the VMT band. All the
// alpha/band-dependent work (lgamma, node positions, two-piece prior weights) is
// hoisted here so the returned closure's per-x hot loop is just one exp per node —
// the distribution chart evaluates it a few hundred times per curve, live, on the
// slider drag. Each node's exponent stays combined in a single exp (the large
// alpha*u, lgamma, and alpha*ln(x) terms cancel) to avoid overflow at large
// alpha, in the same order as invGammaLogDensity, so a degenerate band's single
// node reproduces the point density bit-for-bit. The returned function carries
// .mean, the drawn curve's mean (marginalMpiMean).
function makeMarginalMpiDensity(alpha, vmtMin, vmtBest, vmtMax) {
  const prior = vmtPriorNodes(vmtMin, vmtBest, vmtMax, alpha);
  const lg = lgamma(alpha);
  // ln(prior weight) + alpha·ln(v) − lgamma, per node
  const logW = prior.lnv.map((u, i) => Math.log(prior.w[i]) + alpha * u - lg);
  const density = x => {
    const alnx = alpha * Math.log(x);
    let sum = 0;
    for (let i = 0; i < prior.v.length; i++) sum += Math.exp(logW[i] - alnx - prior.v[i] / x);
    return sum;
  };
  density.mean = marginalMpiMean([{a: alpha, w: 1}], prior);
  return density;
}
// Convenience point-evaluator (rebuilds the closure for one x); used by quals.
function marginalMpiLogDensity(x, alpha, vmtMin, vmtBest, vmtMax) {
  return makeMarginalMpiDensity(alpha, vmtMin, vmtBest, vmtMax)(x);
}

// Compute miles-per-incident estimate with credible interval.
// k = incident count, m = miles driven, massFrac = CI mass (e.g., 0.95)
function estimateMpi(k, m, massFrac) {
  const a = k + 0.5; // posterior shape (Jeffreys prior)
  const tail = (1 - massFrac) / 2;
  return {
    median: 1 / gammaquant(a, m, 0.5),
    lo:     1 / gammaquant(a, m, 1 - tail),
    hi:     1 / gammaquant(a, m, tail),
  };
}

// --- Data and UI ---

let incidents = [];
let vmtRows = [];
let faultData = {}; // reportId -> {faultfrac, reasoning}
let monthHelmerEnabled = {HumansAV: true, HumansUS: false, HumansRideshare: false, Tesla: true, Waymo: true, Zoox: false};
// Collapsible page sections (each <section class="collapsible" id="sec-<id>">).
// Collapsed set is shareable via the URL so a link can foreground one section.
const SECTION_IDS = ["controls", "vmt", "mpi", "dist", "browser", "markets", "summary", "sanity", "fleet"];
let sectionCollapsed = Object.fromEntries(SECTION_IDS.map(id => [id, false]));
// Unified metric definitions. Each entry fully specifies one MPI variant:
// key/blank (-> label), cardLabel (summary card), incField, countFn (plus
// fracsFn for the at-fault mixtures), fiveDay, the human benchmark bands, and
// whether it's enabled by default. (Line style is per helmer — HELMER_COLORS —
// not per metric.)
//
// To add a new MPI variant, just add one entry here and (if needed) add the
// corresponding incident field accumulation in monthSeriesData().
//
// Human reference MPI ranges from Kusano/Scanlon methodology
// (surface streets, passenger vehicles, Blincoe underreporting adjustment)
// and FARS/NHTSA. We show ranges because the exact apples-to-apples
// correction is uncertain. The true value should lie within [lo, hi].
//
// lo = most SGO-comparable (Blincoe-adjusted, surface streets, higher rate)
// hi = most conservative (police-reported or observed, lower rate)
//
// Sources:
//   Kusano et al. 7.1M-mi paper (arxiv 2312.12675, Table 3):
//     All crashes: Blincoe-adj 9.67 IPMM, police-reported 4.68 IPMM
//     Any-injury:  Blincoe-adj 2.80 IPMM, observed 1.92 IPMM (Table 3; the
//       paper's results table prints 1.91)
//   Waymo Safety Impact hub per-city human IPMM (thru Jun 2026, five areas,
//   Sep-24-2026 release; supersedes the Kusano et al. 56.7M paper
//   2026-08-22): Any-injury 1.95..6.64 -> blended 3.77 (observed, i.e.
//   without the hub's 32% Blincoe correction: 1.34..4.54 -> 2.58); Airbag
//   (any vehicle) 1.27..2.83 -> 1.62; SSI+ 0.104..0.391 -> 0.213.
//   CRSS 2024 microdata (NHTSA; weighted crashed in-transport vehicles, VMT
//   3,294,031M per 813791): Hospitalization+ (anyone transported for
//   treatment, or an A or K injury) 0.512 per M mi nationally; for urban
//   non-interstate passenger vehicles, Hospitalization+ involvements per
//   injury-crash involvement 0.543 and per airbag-crash involvement 0.657;
//   "Stopped in Roadway" pre-crash movement 14.6% of crashed in-transport
//   vehicles (urban non-interstate passenger vehicles), 12.9% (all vehicles,
//   all roads). human-benchmark-provenance.qual holds the recipe.
//   Blincoe et al. 2023 (813403): 31.9% of injury-crash vehicles and 59.7% of
//   PDO vehicles unreported (Table 2-9); its crashes exclude parking lots.
//   FARS 2024: national 1.19 fatalities/100M VMT (2023: 1.26).
//   IIHS urban/rural: urban all-road deaths 1.17 (2022), 1.07 (2023), 1.01 (2024)
//   per 100M VMT; 2021 urban peak 1.20.
//
// Derived metrics use the subset-bounding approach: if metric B is a subset
// of metric A, then MPI-B >= MPI-A. The true value is bounded by neighbors.
//
// srcLinks: the URLs of the sources a band's numbers come from; each URL's
// one label is in BENCHMARK_SOURCES below.
//
// fiveDay: true marks metrics whose qualifying incidents are structurally on
// NHTSA's five-day reporting track — Third Amended SGO (Apr 24, 2025)
// Request No. 1.D requires a report within 5 days of notice for a crash
// involving a fatality, hospital transport, a vulnerable-road-user strike,
// an airbag deployment, or (ADS) a tow-away. Everything else rides the
// Monthly track (Request No. 2) and gets the incident-coverage thinning for
// the structurally incomplete data-through month, on top of the receipt-
// coverage scaling every metric gets there, and for the months inside a
// helmer's extra Monthly-report lag (slurp.py MONTHLY_ARRIVAL_LAG; see
// monthSeriesData). Only metrics
// whose counting predicate GUARANTEES a Request No. 1.D trigger get the flag
// (fatality, hospitalization, airbag, and since 2026-09-04 seriousInjury:
// every SSI+ severity the whitelist admits — "Serious", "Serious W/
// Hospitalization", "Fatality" — is hosp:true in SEVERITY_INFO, so SSI+ is a
// strict subset of the five-day hospitalization metric and must not get a
// smaller denominator than its superset; the dictionary's unseen "Serious
// Without Hospitalization" would crash the severity whitelist and reopen this).
//
// Note: the AV-cities (HumansAV) benchmarks are scoped to AV operating
// areas, which have higher crash rates than the nationwide average — more
// apples-to-apples than the raw national numbers. Scope varies by metric:
// the Kusano/hub-derived bands (all/injury/airbag/seriousInjury) are
// surface-street rates, the fatality band is all-urban-roads
// (freeway-inclusive, matching the AV side's all-roads scope), and the
// HumansUS bands are national all-road-type rates. The AV numerators and
// denominators include some freeway driving (Waymo from mid-2026, Tesla
// highway rides from Sep 2025) that the surface-street benchmarks exclude —
// a pro-AV residual for the crash-frequency metrics; per the 2026-06-26
// investigation it is immaterial today (9 of 2049 incidents freeway-coded,
// all Waymo, none airbag/serious/fatal).
//
// One label per benchmark source, keyed by URL (audit #68, 2026-10-03). Every
// humanMPI srcLinks entry is a URL from this table, so a list that gathers
// several bands' sources (a human card's "Benchmarks:" line) names each
// source once. Until 2026-10-03 each srcLinks entry carried its own label, and
// the same URL appeared under two (e.g. arXiv 2312.12675 as "... 2024, Table 3"
// and "... 2024"); where it did, the table keeps the more specific one.
const BENCHMARK_SOURCES = {
  "https://arxiv.org/abs/2312.12675": "Kusano et al. 2024, Table 3",
  "https://arxiv.org/abs/2505.01515": "Kusano et al. 56.7M (arxiv 2505.01515)",
  "https://waymo.com/safety/impact/": "Waymo safety impact (271.3M mi)",
  "https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/Waymo_Safety_Impact_Data_Hub_Release_Notes_20260924.pdf": "Waymo Data Hub release notes",
  "https://www.nhtsa.gov/sites/nhtsa.gov/files/2025-04/third-amended-SGO-2021-01_2025.pdf": "Third Amended SGO (2025)",
  "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791": "NHTSA 2024 crash summary",
  "https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/": "NHTSA CRSS 2024",
  "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013": "Blincoe et al. 2015 (underreporting)",
  "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403": "Blincoe et al. 2023",
  "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115": "NHTSA critical reason (94%)",
  "https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison": "IIHS urban/rural comparison",
  "https://www.uber.com/us/en/about/reports/us-safety-report/": "Uber US Safety Report",
  "https://www.lyft.com/blog/posts/2024-safety-transparency-report": "Lyft Safety Transparency Report",
};
// Link lists join with a semicolon: "Kusano et al. 2024, Table 3" carries a
// comma, which made a comma-joined list read it as two entries.
const SOURCE_LIST_SEP = "; ";
function sourceLink(url) {
  const label = BENCHMARK_SOURCES[url];
  assert(label !== undefined, "benchmark source URL missing from BENCHMARK_SOURCES", {url});
  return `<a href="${escAttr(url)}">${escHtml(label)}</a>`;
}
const METRIC_DEFS = [
  { key: "all",
    blank: "any",
    cardLabel: "All incidents",
    incField: "incTotal",

    defaultEnabled: false, primary: true,
    countFn: rec => rec.incidents.total,
    humanMPI: {
      HumansAV: {lo: 103000, hi: 214000,
        // Kusano Blincoe-adj (9.67 IPMM) to police-reported (4.68 IPMM)
        src: 'lo: 1M/9.67 Blincoe-adj IPMM; hi: 1M/4.68 police-reported IPMM; caveat: since June 16, 2025 (Third Amended SGO) minor crashes where another vehicle struck the AV (under $1,000 damage, no severity trigger) are exempt from AV reporting; this deflates AV all-incident counts vs any human benchmark; Waymo now calls this comparison impossible.',
        // Kusano's 9.67 is Blincoe et al. 2023-adjusted (its p. 5); the release
        // notes are the current (Sep 24, 2026) edition, which keeps the cited
        // "impossible" passage (audit #42, #69).
        srcLinks: [
          'https://arxiv.org/abs/2312.12675',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/sites/nhtsa.gov/files/2025-04/third-amended-SGO-2021-01_2025.pdf',
          'https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/Waymo_Safety_Impact_Data_Hub_Release_Notes_20260924.pdf',
        ]},
      // CRSS 2024 (813791): ~6.18M police-reported crashes/yr, ~1.77 vehicles
      // per crash, ~3,294B VMT -> ~3.3 crashed vehicles per M mi (unchanged
      // from the 2022/2023 inputs at this precision). Blincoe underreporting
      // (~60% of property-damage-only and 24% (Blincoe 2015, 812013) to 32%
      // (Blincoe 2023, 813403) of injury crashes unreported) roughly doubles
      // that -> ~7.1 per M mi.
      HumansUS: {lo: 140000, hi: 300000,
        src: 'lo: ~7 IPMM Blincoe-adjusted crashed-vehicle rate; hi: ~3 IPMM police-reported (CRSS national, all road types); caveat: same as for humans in AV cities above',
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/sites/nhtsa.gov/files/2025-04/third-amended-SGO-2021-01_2025.pdf',
          'https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/Waymo_Safety_Impact_Data_Hub_Release_Notes_20260924.pdf',
        ]},
    },
  },
  { key: "nonstationary",
    blank: "nonstationary",
    cardLabel: "Nonstationary",
    incField: "incNonstationary",

    defaultEnabled: false, primary: false,
    countFn: rec => nonstationaryIncidentCount(rec.incidents.speeds),
    // The AV side drops every 0-mph incident (nonstationaryIncidentCount), so
    // the human band drops the crashed vehicles that were stationary at
    // impact: the all-crash band / (1 - the CRSS 2024 share of crashed
    // in-transport vehicles whose pre-crash movement was "Stopped in
    // Roadway", P_CRASH1 = 5) — 14.587% for urban non-interstate passenger
    // vehicles (AV cities; 14.79% if the 1.35% coded "Unknown" (P_CRASH1 = 99)
    // are left out of the base, 14.62% with "Disabled or Parked in Travel Lane"
    // added), 12.937% for all vehicles on all roads (US average). Both human
    // benchmarks count in-transport vehicles only (Kusano et al. 2024: those
    // "traveling (moving or stopped) in the roadway"), so parked vehicles were
    // never in them. Until 2026-10-03 the bands instead divided by 0.95-0.97
    // for a "hit-while-parked" share and kept the stopped vehicles the AV side
    // drops (106k-225k and 144k-316k; audit #2). P_CRASH1 is the movement
    // before the critical event, so a vehicle coded "Decelerating" (5% of
    // vehicles) or "Starting in Road" (0.9%) may also have been at 0 mph at
    // impact: the share is a floor, a pro-AV residual if anything. Edges to 3
    // significant figures; human-benchmark-provenance.qual re-derives them.
    humanMPI: {
      HumansAV: {lo: 121000, hi: 251000,
        // All-crash range (AV cities)
        // divided by (1 - 14.6%), the CRSS 2024 share of crashed in-transport
        // vehicles that were stopped in the roadway at impact (pre-crash
        // movement "Stopped in Roadway"; urban non-interstate passenger
        // vehicles), matching the AV side's removal of its 0-mph incidents;
        // parked vehicles are not in the in-transport benchmark, so there is no
        // parked-vehicle step.
        src: "All-crash range (AV cities) divided by (1 - 14.6%), the CRSS 2024 share of crashed in-transport vehicles that were stopped in the roadway at impact, matching the AV side's removal of its 0mph incidents",
        srcLinks: [
          'https://arxiv.org/abs/2312.12675',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
        ]},
      HumansUS: {lo: 161000, hi: 345000,
        // US-average all-crash range
        // divided by (1 - 12.9%), the CRSS 2024 share of crashed in-transport
        // vehicles stopped in the roadway at impact (all vehicles, all roads).
        src: "US-average all-crash range divided by (1 - 12.9%), the CRSS 2024 share of crashed in-transport vehicles stopped in the roadway at impact (all vehicles, all roads).",
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
        ]},
    },
  },
  { key: "roadwayNonstationary",
    blank: "nonstationary non-parking-lot",
    cardLabel: "Nonstationary non-parking-lot",
    incField: "incRoadwayNonstationary",

    defaultEnabled: false, primary: false,
    countFn: rec => roadwayNonstationaryIncidentCount(rec),
    // Same bands as nonstationary: both human benchmarks already exclude
    // parking-lot crashes. CRSS samples trafficway crashes only; Kusano et
    // al.'s AV-city benchmark is state police crash data restricted to
    // surface streets (not CRSS, as the src said until 2026-10-03; audit #2),
    // whose Blincoe et al. 2023 underreporting adjustment "does not include
    // off-road or parking lot crashes" (813403 p. 1, note 1). So the human
    // band is a non-parking-lot band for both metrics; the nonstationary
    // metric's AV count keeps its parking-lot incidents, an anti-AV residual
    // there, which this metric removes. (Until 2026-10-03 these edges were
    // the nonstationary ones nudged up ~1.3% for a "similar ratio".)
    humanMPI: {
      HumansAV: {lo: 121000, hi: 251000,
        // the same band as
        // Nonstationary (the all-crash range minus the CRSS 2024 share of
        // crashed vehicles stopped in the roadway), because the police-reported
        // benchmark (state crash records for the AV counties, per Kusano et al.
        // 2024) and Blincoe et al. 2023's underreporting estimate both cover
        // crashes on roadways only, not parking-lot crashes, so the human
        // benchmark is already a non-parking-lot benchmark.
        src: "The same band as Nonstationary because the police-reported benchmark and Blincoe et al 2023's underreporting estimate both cover crashes on roadways only, not parking-lot crashes. Ie, the human benchmark is already a non-parking-lot benchmark.",
        srcLinks: [
          'https://arxiv.org/abs/2312.12675',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
        ]},
      HumansUS: {lo: 161000, hi: 345000,
        // the same band as
        // Nonstationary (the US all-crash range minus the CRSS 2024 share of
        // crashed vehicles stopped in the roadway), because CRSS covers
        // trafficway crashes only and Blincoe et al. 2023's underreporting
        // estimate excludes parking-lot crashes.
        src: "The same band as Nonstationary because CRSS covers roadway crashes only and Blincoe et al 2023's underreporting estimate excludes parking-lot crashes.",
        //'Idem ambitus ac "Nonstationary" (omnes collisiones demptis vehiculis in via stantibus, CRSS 2024): CRSS solas collisiones in viis publicis comprehendit, et aestimatio Blincoe et al. 2023 collisiones in areis stationis excludit.',
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
        ]},
    },
  },
  { key: "atfault",
    blank: "at-fault",
    cardLabel: "At-fault",
    incField: "incAtFault",

    needsFault: true,
    defaultEnabled: true, primary: false,
    countFn: rec => rec.incidents.atFault,
    // Fractional faultfracs are PROBABILITIES, so the posterior mixes over the
    // Poisson-binomial of the true at-fault count (see mixtureComponents).
    fracsFn: rec => rec.incidents.atFaultFracs,
    // At-fault MPI = all-crash MPI / at-fault share, where the share must
    // match the universe of the anchor it divides. Police-reported universe:
    // ~50-65% of involvements are at-fault (single-vehicle 100%,
    // multi-vehicle ~50%). Any-property-damage universe (what SGO captures):
    // the marginal unreported/sub-threshold contacts are predominantly
    // single-vehicle/self-inflicted (curb strikes, fixed objects), so the
    // share rises toward ~1 and the lo anchor collapses to the all-crash lo.
    humanMPI: {
      HumansAV: {lo: 103000, hi: 430000,
        src: 'lo: all-crash lo (at-fault share \u2192 ~1 at any-property-damage severity; marginal unreported contacts are mostly self-inflicted); hi: all-crash hi / 50% police-reported-universe share',
        // Blincoe et al. 2023, the edition behind Kusano's 9.67 (until
        // 2026-10-03 this linked the 2015 edition; audit #42).
        srcLinks: [
          'https://arxiv.org/abs/2312.12675',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
        ]},
      HumansUS: {lo: 140000, hi: 600000,
        src: 'lo: US-average all-crash lo (at-fault share \u2192 ~1 at any-property-damage severity); hi: US-average all-crash hi / 50% police-reported-universe share',
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
        ]},
    },
  },
  { key: "injury",
    blank: "injury-causing",
    cardLabel: "Injury",
    incField: "incInjury",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.injury,
    // AV-cities band = the Waymo Safety Impact hub's per-city human benchmark
    // range (Phoenix 1.95 to SF 6.64 IPMM across five areas, thru Jun 2026;
    // supersedes Kusano 56.7M), blended central 3.77. Band edges = 1M /
    // per-city IPMM.
    humanMPI: {
      HumansAV: {lo: 151000, hi: 513000,
        src: 'Waymo Safety Impact hub (thru Jun 2026, five areas): human any-injury 1.95 (Phoenix) to 6.64 (SF) IPMM, blended 3.77 (supersedes the Kusano 56.7M paper values 2.09-8.02)',
        srcLinks: [
          'https://waymo.com/safety/impact/',
          'https://arxiv.org/abs/2505.01515',
        ]},
      // CRSS/813791 (2024): 1,676,700 injury crashes/yr * ~1.77 vehicles per
      // crash (1.83 for injury crashes) / 3,294B VMT -> ~0.90-0.93
      // injury-crashed vehicles per M mi police-reported (the band's 0.92 was
      // derived on the 2022 inputs 1.66M / ~3.2T VMT; within 3%, kept);
      // Blincoe (24-32% of injury crashes unreported) -> ~1.28 per M mi.
      HumansUS: {lo: 780000, hi: 1090000,
        src: 'lo: ~1.28 IPMM Blincoe-adjusted injury crashed-vehicle rate; hi: ~0.92 IPMM police-reported (CRSS national)',
        // Both Blincoe editions: 0.92/(1 - 0.28) = 1.28, 28% being the
        // midpoint of 2015's 24% and 2023's 32% (audit #42).
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
        ]},
    },
  },
  { key: "atfaultInjury",
    blank: "at-fault injury-causing",
    cardLabel: "At-fault injury",
    incField: "incAtFaultInjury",

    needsFault: true,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.atFaultInjury,
    fracsFn: rec => rec.incidents.atFaultInjuryFracs,
    // At-fault injury: intersection of at-fault and injury crashes.
    // Shares use the expert-avoidability standard to match the faultfrac
    // criterion (P(expert human avoids)), not legal allocation:
    // lo: injury lo (151k) / ~94% share (NHTSA critical reason: driver error
    //   in ~94% of crashes; taken as the LARGEST share an expert could avoid —
    //   an upper bound, which is what dividing the LOW edge by it needs) ≈ 161k
    //   NB: NHTSA 812115 itself disclaims that "critical reason" means crash
    //   cause or fault assignment; reading driver-error-as-critical-reason as
    //   an upper bound on expert avoidability is this repo's own assumption
    //   (ratified 2026-06-12, re-ratified 2026-08-21 as Codex M3).
    // hi: injury hi (513k) / 50% share ≈ 1,026k
    //   50% = legal-allocation floor (single-vehicle 100%, multi ~50%);
    //   expert-avoidability can't be lower. Cross-check: 513k/214k × atfault
    //   hi (430k) ≈ 1.03M. (Re-derived 2026-09-25 on the thru-Jun-2026 hub
    //   injury band, and 2026-07-24 when the injury band's
    //   repin to the Kusano 56.7M per-city range left this stale at the old
    //   blended anchors, 272k–1,050k.)
    humanMPI: {
      HumansAV: {lo: 161000, hi: 1026000,
        src: 'lo: injury lo (151k) / ~94% expert-avoidability share (NHTSA critical reason); hi: injury hi (513k) / 50% legal-allocation floor',
        srcNote: "94% = NHTSA 812115's share of crashes critically attributed to the driver (neither cause nor fault, per NHTSA) which we use here as an upper bound on expert avoidability.",
        // The injury band's source and the 94%'s (audit #41: Kusano Table 3
        // and NHTSA 813791, linked until 2026-10-03, feed no number here).
        srcLinks: [
          'https://waymo.com/safety/impact/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115',
        ]},
      HumansUS: {lo: 830000, hi: 2180000,
        src: 'lo: US injury lo (780k) / ~94% expert-avoidability share (NHTSA critical reason); hi: US injury hi (1.09M) / 50% legal-allocation floor',
        srcNote: "[same as above for humans in AV cities]",
        // The US injury band's sources and the 94%'s (audit #41: 812115 was
        // missing until 2026-10-03).
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115',
        ]},
    },
  },
  { key: "hospitalization",
    blank: "hospitalization",
    cardLabel: "Hospitalization+",
    incField: "incHospitalization",

    defaultEnabled: false, primary: false,
    fiveDay: true, // hospital transport = SGO Request No. 1.D.ii
    countFn: rec => rec.incidents.hospitalization,
    // SGO "W/ Hospitalization" = transported to hospital (incl ER visits for
    // minor injuries — most Waymo hosp are "Minor W/ Hosp"); with "Serious"
    // and "Fatality" (hosp: true in SEVERITY_INFO) this is Hospitalization+.
    // The human bands rest on CRSS's direct measurement of transport (audit
    // #1, 2026-10-03; until then both said no human hospital-transport rate
    // exists: AV cities was bracketed between airbag and SSI+, 617k-4.695M,
    // and US average log-interpolated, 1.8M-7.9M, both centers ~2x too safe).
    // CRSS 2024 person.csv HOSPITAL 1-6 = transported for treatment (EMS air,
    // law enforcement, EMS unknown mode, transported unknown source, EMS
    // ground, other; 0 = not transported; 8/9 not reported/unknown, counted
    // as not transported: imputing them at the known transport rate of their
    // injury severity would add ~3.5%). The human Hospitalization+ crash
    // = anyone transported, or an A or K injury (MAX_SEV 3-4), the analog of
    // the page's hosp severities. Weighted crashed in-transport vehicles,
    // VMT 3,294,031M (813791). human-benchmark-provenance.qual holds the
    // per-area inputs and re-derives every edge.
    humanMPI: {
      // AV cities: CRSS 2024 urban non-interstate passenger vehicles (BODY_TYP
      // 1-49): Hospitalization+ involvements / injury-crash involvements =
      // 0.54291, / airbag-crash involvements = 0.65732 (a ratio of rates, not
      // a share: only 37% of airbag-crash involvements had a transport).
      // Applied to the hub's per-area police-reported rates (CSV3 v1, thru
      // Jun 2026, Dynamic): OBSERVED any-injury (not the 32% Blincoe-
      // corrected 1.95..6.64 the injury band uses, since the CRSS ratio is
      // police-reported on both sides) Phoenix 1.339, SF Bay 4.539, LA 1.747,
      // Austin 2.226, Atlanta 4.487; any-vehicle airbag 1.323 / 1.919 /
      // 1.266 / 2.323 / 2.831. Band = the per-area extremes across both
      // routes: lo 1M/(4.539 x 0.54291) = 405.8k (SF Bay, injury route), hi
      // 1M/(1.339 x 0.54291) = 1.376M (Phoenix, injury route); the
      // mileage-blended routes give 714k (injury) and 942k (airbag), and the
      // band's geometric center is 749k. On the all-vehicle basis the ratios
      // are 0.552 / 0.702 (edges within 2%); restricted to posted limits <= 50
      // mph (a surface-street proxy that also drops the 15% with no limit
      // reported) they are 0.525 / 0.600 (injury-route edges +3.5%). The
      // hub's injury and airbag benchmarks carry no underreporting correction
      // here (the hub applies none to airbag), so unlike the US band this one
      // has no Blincoe edge.
      // HumansRideshare is computed from HumansAV by the loop below.
      HumansAV: {lo: 406000, hi: 1380000,
        // CRSS-measured ratio of
        // crash involvements with a hospital transport (or a serious or fatal
        // injury) to injury-crash involvements (0.543) and to airbag-crash
        // involvements (0.657) (CRSS 2024, urban non-interstate passenger
        // vehicles), applied to the Waymo hub's per-area police-reported
        // any-injury rates (observed, not underreporting-adjusted: 1.34 Phoenix
        // to 4.54 SF Bay Area IPMM) and airbag rates (1.27 LA to 2.83 Atlanta)
        // (hub CSV3, thru Jun 2026); the band spans the per-area extremes of
        // both routes, 1M/2.46 (SF Bay Area, injury route) to 1M/0.727
        // (Phoenix, injury route); mileage-blended: 1M/1.40 (injury route),
        // 1M/1.06 (airbag route).
        src: "CRSS-measured ratio of crashes with hospital transport or serious/fatal injury to injury crashes and to airbag crashes applied to Waymo's published per-area police-reported any-injury rates, not underreporting-adjusted",
        srcLinks: [
          'https://waymo.com/safety/impact/',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
        ]},
      // US average: hi = the police-reported national Hospitalization+ rate,
      // 0.51169 per M mi (all in-transport vehicles, all roads) = 1.954M;
      // lo = that rate raised for the 31.9% of injury-crash vehicles not
      // reported to police (Blincoe et al. 2023, Table 2-9) = 1.331M. 31.9%
      // is an upper bound for transport crashes: unreported injury crashes
      // "tend to involve only minor or moderate injuries" (813403 p. 3), and
      // the unreported share falls with severity (MAIS1 33.9%, MAIS2 27.2%,
      // MAIS3 6.3%, MAIS4+ 0). Transport alone (no A/K) gives 0.504 per M mi
      // (1.98M). Edges to 4 significant figures (at 3, fmtMiles would show
      // 1,950,000 as "1.9M").
      HumansUS: {lo: 1331000, hi: 1954000,
        // hi is the CRSS 2024
        // national rate of crashed in-transport vehicles in police-reported
        // crashes with a hospital transport or a serious or fatal injury, 0.512
        // per M mi (all vehicles, all roads; VMT from NHTSA 813791); lo is that
        // rate raised for the 31.9% of injury-crash vehicles not reported to
        // police (Blincoe et al. 2023, Table 2-9), an upper bound for transport
        // crashes since unreported injury crashes are mostly minor or moderate.
        src: "hi is the CRSS 2024 national rate of crashed in-transport vehicles in police-reported crashes with hospital transport or serious/fatal injury; lo is that rate raised for the 31.9% of injury-crash vehicles not reported to police (Blincoe et al 2023, Table 2-9) which is an upper bound for transport crashes since unreported injury crashes are mostly minor or moderate",
        srcLinks: [
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
        ]},
    },
  },
  { key: "airbag",
    blank: "airbag-deploying",
    cardLabel: "Airbag deployment",
    incField: "incAirbag",

    defaultEnabled: false, primary: false,
    fiveDay: true, // airbag deployment = SGO Request No. 1.D.iv
    countFn: rec => rec.incidents.airbag,
    // Airbag deployment in any vehicle. AV-cities band = the Waymo Safety
    // Impact hub's per-city human benchmark (1.27 LA to 2.83 Atlanta IPMM
    // across five areas, thru Jun 2026; supersedes Kusano 56.7M; airbags are
    // mechanically triggered and rarely underreported, so no Blincoe
    // adjustment), blended 1.62. Waymo's unlinked CSV3 v2 (Sep 28, 2026, after
    // fixing duplicated Atlanta cells in CSV4) moves these edges to 1.23 / 2.77;
    // re-pin when the hub links it or posts release notes.
    humanMPI: {
      // HumansUS airbag and SSI+ are estimated by log-interpolation between
      // the national injury and fatality anchors (positioned by the AV-cities
      // severity ladder) with a wide band. Re-derived 2026-09-25 on the
      // thru-Jun-2026 hub ladder (and 2026-09-04, when the 06-18 values used
      // the pre-repin anchors and sat 13-23% low): t = ln(c_metric/c_injury) /
      // ln(c_fatality/c_injury) on AV-cities geometric centers (injury 278k,
      // airbag 527k, SSI+ 4.96M, fatality 93.4M) -> t = 0.11 / 0.50, mapped
      // onto the national injury..fatality centers (922k..87.4M) -> airbag
      // 1.52M, SSI+ 8.79M; each band keeps its prior log-width (2.9x / 4.7x)
      // around that center, edges to 2 significant figures.
      // human-benchmark-provenance.qual re-derives the centers. (Hospitalization+
      // was the third such band until 2026-10-03; it is now CRSS-measured.)
      // CRSS 2024 measures both directly too (police-reported, all vehicles,
      // all roads): airbag 0.740 per M mi (1.35M MPI), A+K 0.086 (11.6M), each
      // inside its band; the src text's "no national ... rate" predates that
      // check.
      // HumansRideshare is computed from HumansAV by the loop below.
      HumansAV: {lo: 353000, hi: 787000,
        src: 'Waymo Safety Impact hub (thru Jun 2026, five areas): human any-vehicle airbag 1.27 (LA) to 2.83 (Atlanta) IPMM, blended 1.62 (supersedes the Kusano 56.7M paper values 1.42-2.31; Austin, Tesla\'s main market, sits at 2.32)',
        srcLinks: [
          'https://waymo.com/safety/impact/',
          'https://arxiv.org/abs/2505.01515',
        ]},
      HumansUS: {lo: 900000, hi: 2600000,
        src: 'No national airbag-deployment per-mile rate; log-interpolated between the national injury and fatality anchors by AV-cities severity position, widened for the urban→national severity-mix shift',
        // The interpolation's inputs (audit 2026-10-04 #34): the AV-cities
        // centres (the hub's injury and this band's, IIHS's fatality), the
        // national injury centre (CRSS 2024, both Blincoe editions) and the
        // national fatality centre (FARS 2024, NHTSA 813791).
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://waymo.com/safety/impact/',
          'https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison',
        ]},
    },
  },
  { key: "seriousInjury",
    blank: "serious-injury-causing",
    cardLabel: "Serious injury+",
    incField: "incSeriousInjury",

    defaultEnabled: false, primary: false,
    fiveDay: true, // SSI+ ⊂ hospitalization (every ssi severity is hosp:true) = SGO Request No. 1.D.ii
    countFn: rec => rec.incidents.seriousInjury,
    // SSI+ (KABCO A+K): "Serious" + "Fatality" (suspected serious injury or
    // worse). AV-cities band = the hub's per-city human SSI+ range (SF 0.391
    // to Phoenix 0.104 IPMM across five areas, thru Jun 2026), blended 0.213.
    humanMPI: {
      // HumansUS is estimated by log-interpolation between the national injury
      // and fatality anchors (see the airbag entry for the derivation).
      // HumansRideshare is computed from HumansAV by the loop below.
      HumansAV: {lo: 2560000, hi: 9620000,
        src: 'Waymo Safety Impact hub (thru Jun 2026, five areas): human SSI+ 0.104 (Phoenix) to 0.391 (SF) IPMM, blended 0.213 (supersedes the Kusano 56.7M paper values 0.12-0.46)',
        srcLinks: [
          'https://waymo.com/safety/impact/',
          'https://arxiv.org/abs/2505.01515',
        ]},
      HumansUS: {lo: 4000000, hi: 19000000,
        src: 'No clean national SSI+ (KABCO A+K) per-mile rate; log-interpolated between the national injury and fatality anchors by AV-cities severity position, widened for the urban\u2192national severity-mix shift',
        // The interpolation's inputs (audit 2026-10-04 #34): the AV-cities
        // centres (the hub's injury and this band's, IIHS's fatality), the
        // national injury centre (CRSS 2024, both Blincoe editions) and the
        // national fatality centre (FARS 2024, NHTSA 813791).
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
          'https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013',
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403',
          'https://waymo.com/safety/impact/',
          'https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison',
        ]},
    },
  },
  { key: "fatality",
    blank: "fatal",
    cardLabel: "Fatality",
    incField: "incFatality",

    defaultEnabled: false, primary: false,
    fiveDay: true, // fatality = SGO Request No. 1.D.i
    countFn: rec => rec.incidents.fatality,
    // FLEET basis matching the fractional-death AV count above (Koopman/
    // Piper): the 1/N-per-fatal-crash sum equals fatal crashes fleet-wide and
    // proxies deaths (deaths ≈ 1.08x fatal crashes nationally). HumansAV uses
    // the IIHS ALL-urban-roads (freeway-inclusive — matching the AV side's
    // all-roads scope) deaths rate: IIHS 2022-2024 1.17/1.07/1.01 per 100M
    // VMT, banded 0.95-1.20 (re-vintaged 2026-08-28 from the 2012-era
    // 0.77-1.15 sensitivity band); HumansUS spans the
    // deaths..fatal-crashes numerators (FARS 2024).
    humanMPI: {
      HumansAV: {lo: 83000000, hi: 105000000,
        src: "Claude: IIHS urban all-road fatality rate, 2022–2024: 1.17 / 1.07 / 1.01 deaths per 100M VMT; band 0.95–1.20 (the 2021 urban peak 1.20 as the high-rate edge, 0.95 as a continued-improvement floor below the 2024 value)",
        srcLinks: [
          'https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison',
        ]},
      HumansUS: {lo: 84000000, hi: 91000000,
        // Re-derived 2026-08-24 on the numerators consistent with the AV
        // side's fractional-death count (audit fix; was 59M/91M from the
        // 2026-08-22 FARS rework): the AV adds 1/vehiclesInvolved per fatal
        // crash, so its fleet-universe sum equals FATAL CRASHES, proxying
        // DEATHS under deaths≈fatal-crashes. FARS 2024: 39,254 deaths and
        // 36,297 fatal crashes over 3,294B VMT -> 1.19 deaths/100M (84M
        // miles/death, lo) and 1.10 fatal crashes/100M (91M, hi). The old lo
        // (1.70/100M per crashed VEHICLE -> 59M) counted each involvement
        // whole — the very convention the AV side's 1/N division rejects —
        // so it was dropped as numerator-inconsistent (it was also the
        // AV-favorable edge).
        src: "FARS 2024 national: 1.19 deaths per 100M VMT (39,254 deaths) to 1.10 fatal crashes per 100M VMT (36,297 crashes) — numerators matching the AV side's fractional-death count.",
        srcLinks: [
          'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791',
        ]},
      // The one rideshare-specific per-mile rate that is published (the
      // safety reports otherwise cover only fatalities and assaults). Lyft's
      // 2020-2022 report (p. 11) gives 2021 as 36 deaths at 0.86 and 2022 as
      // 50 at 1.02 per 100M VMT: 86 deaths over 36/0.86 + 50/1.02 = 90.88 x
      // 100M miles = 0.946 mile-weighted (0.95); until 2026-10-03 the src
      // said 0.94, the plain mean (audit #71). lo = 1e8/0.946 = 105.7M, kept
      // at 106M (3 significant figures; 1e8/0.94 = 106.4M rounds the same).
      HumansRideshare: {lo: 106000000, hi: 161000000,
        src: 'Uber & Lyft US Safety Reports: 0.62 (Uber, 2019-2020) to 0.95 (Lyft, 2021-2022 mile-weighted average of its 0.86 and 1.02 yearly rates) fatalities per 100M VMT',
        srcLinks: [
          'https://www.uber.com/us/en/about/reports/us-safety-report/',
          'https://www.lyft.com/blog/posts/2024-safety-transparency-report',
        ]},
    },
  },
];

// Every metric's user-facing label is "Miles per ___ incident", with m.blank
// filling the slot; that same slot text is the metric dropdown's option label.
for (const m of METRIC_DEFS) m.label = `Miles per ${m.blank} incident`;

// Humans (Uber/Lyft): a rideshare driver is NOT the generic AV-cities human
// driver. On fatalities — the one published rideshare per-mile rate (set
// explicitly above) — they run ~1.4x safer by geometric center (130.6M vs
// 93.4M miles per death after the 2026-08-28 IIHS re-vintage; the sourced
// band sits entirely above the urban band), because they're sober, working,
// rated, and in inspected vehicles. No rideshare rate exists for non-fatal
// crashes, so for the general crash metrics we lean the AV-cities band safer
// with a wide range: as bad as ~1.2x worse (heavy low-speed urban exposure and
// in-app distraction can raise minor-crash frequency) up to ~1.5x safer (the
// driver self-selection seen in the fatality data, whose band spans up to
// ~1.9x; 1.5x is the 2026-06-16 judgment for NON-fatal crashes, where
// impairment matters less). Every non-fatality metric
// now carries a HumansUS band (sourced or estimated), so this loop covers the
// severity-tail metrics too; the self-selection advantage is, if anything,
// larger for severe crashes, where impairment dominates the human baseline.
const RIDESHARE_WORST = 1.2; // band floor: up to 1.2x MORE crashes than AV cities
const RIDESHARE_BEST = 1.5;  // band ceiling: up to 1.5x FEWER
const sig2 = x => { const p = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.round(x / p) * p; };
for (const m of METRIC_DEFS) {
  const h = m.humanMPI;
  if (h && h.HumansAV && h.HumansUS && !h.HumansRideshare) {
    h.HumansRideshare = {
      lo: sig2(h.HumansAV.lo / RIDESHARE_WORST),
      hi: sig2(h.HumansAV.hi * RIDESHARE_BEST),
      // derived from the AV-cities band, not independently sourced; the flag
      // makes these modeled-proxy bands render dashed (see derivedBandDash),
      // unlike the sourced fatality band above.
      derived: true,
      // Papers these rows link cite some safety numbers (arXiv 2312.12675:
      // Flannagan et al. 2023, 64.9 crashes per M mi, SF, any contact; Chen &
      // Shladover 2024, 15.5 injury crashes per M mi; arXiv 2505.01515: 36.2
      // and 50.5). Each is less safe than the matching derived band's
      // least-safe edge (all incidents: 86K MPI); the 1.2x/1.5x lean stays
      // as settled.
      src: 'Computed from the AV-cities human rate (~1.2× worse to ~1.5× safer): sober/professional drivers vs heavy urban exposure & in-app distraction',
      srcLinks: h.HumansAV.srcLinks,
    };
  }
}
// Anti-Postel: every band cites at least one source, and every source it
// cites has its one label (sourceLink also asserts at render time; this
// catches a mistyped URL at load).
for (const m of METRIC_DEFS) {
  for (const [cohort, h] of Object.entries(m.humanMPI || {})) {
    assert(Array.isArray(h.srcLinks) && h.srcLinks.length > 0, "human benchmark band without srcLinks",
      {metric: m.key, cohort});
    for (const url of h.srcLinks) {
      assert(BENCHMARK_SOURCES[url] !== undefined, "srcLinks URL missing from BENCHMARK_SOURCES",
        {metric: m.key, cohort, url});
    }
  }
}

// Derived accessors — consumed by rendering code throughout
const METRIC_KEYS = METRIC_DEFS.map(m => m.key);
const METRIC_BY_KEY = Object.fromEntries(
  METRIC_DEFS.map(m => [m.key, m]));
const STRESS_VERDICT_META = {
  safer: {label: "robustly safer", className: "safer"},
  worse: {label: "robustly worse", className: "worse"},
  ambiguous: {label: "ambiguous", className: "ambiguous"},
};
const PRIOR_ONLY_TIP = "Zero incidents of this type observed in the window so this verdict is based on priors, i.e., be skeptical! This mirrors the chart's hollow dot convention for k=0.";
// The prior-only marking of an estimate resting on zero incidents (k = 0):
// the class "prior-only" (faded, italic) and PRIOR_ONLY_TIP, whose target is a
// Tab stop named by what it shows (`shown`) and the tip (htmlTipAttrs). The
// stress badges and the summary cards' multipliers share it; until 2026-10-03
// only the badges had it, so Tesla's k = 0 fatality multiplier was a solid red
// "0.1x" beside a faded "ambiguous" badge (audit #16).
function priorOnlyMarks(k, shown) {
  return k === 0
    ? {cls: " prior-only", attrs: htmlTipAttrs(`${shown} ${PRIOR_ONLY_TIP}`, PRIOR_ONLY_TIP)}
    : {cls: "", attrs: ""};
}
// Verdict badge; k = 0 gets the prior-only marking.
function stressBadge(meta, k) {
  const marks = priorOnlyMarks(k, meta.label);
  return `<span class="stress-badge ${meta.className}${marks.cls}"${marks.attrs}>${meta.label}</span>`;
}
// This label heads the summary
// card's stress line, which is the verdict on the All incidents metric alone
// (the AV's CI against the AV-cities band, as in the Sensitivity analysis),
// not a summary over every metric. It read "Overall:" until 2026-10-03, so
// the Waymo card said "Overall: ambiguous" while the Sensitivity analysis
// called Waymo robustly safer on most metrics (audit #6).
const CARD_STRESS_LABEL = "All incidents:";
let selectedMetricKey = METRIC_DEFS.find(m => m.defaultEnabled).key;
let vmtCumulative = false; // per-helmer VMT charts: false = monthly, true = cumulative
let selectedGrowthMetric = "fleet"; // growth extrapolator metric: fleet | miles | rides
const DEFAULT_START_MONTH = "2025-06"; // default slider start (NHTSA analysis window)
let monthRangeStart = -1; // -1 = use DEFAULT_START_MONTH
let monthRangeEnd = Infinity;
let fullMonthSeries = null;
let activeSeries = null;

function metricLineStyle(helmer) {
  return `stroke:${HELMER_COLORS[helmer]};stroke-width:2`;
}

// Modeled-proxy bands (humanMPI entries with derived: true — today the
// HumansRideshare nonfatal bands, generated from HumansAV rather than
// measured) draw dashed, reusing the k=0 prior-only dash idiom, so they
// don't read as sourced data. Sourced bands and ADS curves get no dash.
function derivedBandDash(metric, helmer) {
  const h = metric.humanMPI && metric.humanMPI[helmer];
  return h && h.derived === true ? ";stroke-dasharray:6 4" : "";
}

function metricMarkerColor(helmer) {
  return HELMER_COLORS[helmer];
}


function metricErrStyle(helmer) {
  return `stroke:${HELMER_COLORS[helmer]}`;
}
const CI_MASS_DEFAULT_PCT = 95;
const CI_FAN_LEVELS = [0.50, 0.80, 0.95]; // nested CI bands from tight to wide
const ADS_HELMERS = ["Tesla", "Waymo", "Zoox"];
// Human benchmark cohorts: HumansAV = drivers on surface streets in AV
// operating cities (Kusano/Scanlon + Waymo safety hub); HumansUS = the
// nationwide average (CRSS/FARS, all road types). Same "driver", two
// reference populations.
// HumansRideshare = a rider's typical alternative to an AV (human-driven
// Uber/Lyft). Same urban surface streets as the AVs; see the humanMPI proxy
// derivation below the metric defs.
const HUMAN_HELMERS = ["HumansAV", "HumansUS", "HumansRideshare"];
const ALL_HELMERS = [...HUMAN_HELMERS, ...ADS_HELMERS];
const HELMER_LABELS = {
  HumansAV: "Humans (AV cities)",
  HumansUS: "Humans (US average)",
  HumansRideshare: "Humans (Uber/Lyft)",
  Tesla: "Tesla",
  Waymo: "Waymo",
  Zoox: "Zoox",
};
function helmerLabel(helmer) {
  const label = HELMER_LABELS[helmer];
  assert(label !== undefined, "Unknown helmer", {helmer});
  return label;
}
const HELMER_COLORS = {
  HumansAV: "#c9a800",
  // The human cohorts step down in lightness (gold, orange, dark olive), the
  // one dimension every colour-vision deficiency keeps. HumansUS was #8a7400
  // until 2026-10-03, which a deuteranope sees as the same olive as Tesla
  // (CIEDE2000 2.9); #4b3b00 stays >= 12 from every series under normal
  // vision, deuteranopia, protanopia and tritanopia (helmer-colors-cvd.qual).
  HumansUS: "#4b3b00",
  HumansRideshare: "#cc7a00",
  Tesla: "#d13b2d",
  Waymo: "#2060c0",
  Zoox: "#2a8f57",
};

const MONTH_TOKENS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

// Count incidents per helmer from loaded data
function countByHelmer(rows = incidents) {
  const counts = {};
  for (const inc of rows) {
    counts[inc.helmer] = (counts[inc.helmer] || 0) + 1;
  }
  return counts;
}

function incidentsInVmtWindow(rows = incidents) {
  assert(vmtRows.length > 0, "incident browser requires vmtRows");
  const monthSet = new Set(vmtRows.map(row => row.month));
  for (const inc of rows) {
    assert(monthSet.has(monthKeyFromIncidentLabel(inc.date)),
      "incident date outside VMT window",
      {reportId: inc.reportId, helmer: inc.helmer, date: inc.date});
  }
  return rows;
}

function activeIncidents() {
  const all = incidentsInVmtWindow();
  const months = new Set(activeSeries.months);
  return all.filter(inc => months.has(monthKeyFromIncidentLabel(inc.date)));
}

function activeVmt() {
  const months = new Set(activeSeries.months);
  return vmtRows.filter(r => months.has(r.month));
}

function scaleLinear(v, d0, d1, r0, r1) {
  const span = (d1 - d0) || 1;
  return r0 + (v - d0) * (r1 - r0) / span;
}

// The x of month i among a chart's n month columns: centred between left and
// right, a pitch apart that spans the two when there are at least two. A
// one-month window's lone column sits at the middle; until 2026-10-04 the
// zero span put it at the left inset, ~90% of the plot empty to its right
// (audit #70).
function monthColumnX(n, left, right) {
  const pitch = (right - left) / Math.max(1, n - 1);
  const first = (left + right - pitch * (n - 1)) / 2;
  return i => first + pitch * i;
}

// The locale of every number the page prints: its English copy and its "."
// decimals (toFixed) are en-US, so the grouping must be too. A locale-less
// toLocaleString() follows the browser: in a de-DE browser "1.164 incidents"
// (1,164) sat beside "93.2 incidents", and "37.125x" (37,125x) beside "11x",
// until 2026-10-03 (audit #37).
const NUMBER_LOCALE = "en-US";

function fmtMiles(n) {
  assert(Number.isFinite(n) && n >= 0, "fmtMiles: invalid input", {n});
  const suffixes = ["", "K", "M", "B", "T"];
  let tier = 0;
  let val = n;
  // 999.95 is where toFixed(1) would roll over to "1000.0"; bump tier instead
  while (val >= 999.95 && tier < suffixes.length - 1) {
    val /= 1000;
    tier++;
  }
  // A whole number of its unit drops the ".0" ("200K", "1M": tick labels and
  // authored band edges read "200.0K", "1.0M", "103.0K" until 2026-10-03;
  // audit #58). A value that only rounds to one keeps it, as a digit of
  // precision: 1,954,000 is "2.0M", not "2M".
  const digits = Number.isInteger(val) ? 0 : 1;
  return tier === 0 ? Math.round(n).toLocaleString(NUMBER_LOCALE) : val.toFixed(digits) + suffixes[tier];
}

// A count's share of its total, as a whole percent. A nonzero share that
// rounds to 0 reads "<1%", so a percent never contradicts its count (the
// Severity breakdown printed Waymo's 2 fatalities in 1,164 as "2 (0%)" until
// 2026-10-03; audit #58).
function fmtShare(count, total) {
  assert(Number.isFinite(count) && count >= 0 && total > 0 && count <= total, "fmtShare: invalid input", {count, total});
  const pct = Math.round(100 * count / total);
  return count > 0 && pct === 0 ? "<1%" : `${pct}%`;
}

function csvUnquote(field) {
  const quoted = field.startsWith("\"") && field.endsWith("\"");
  return quoted ? field.slice(1, -1).replace(/""/g, "\"") : field;
}

function parseVmtCsv(text) {
  const lines = text.split(/\r?\n/).map(line => line.trimEnd());
  assert(lines.length > 1, "VMT sheet CSV must include header and rows");
  assert(lines[0] === "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,coverage,coverage_min,coverage_max,incident_coverage,incident_coverage_min,incident_coverage_max,rationale",
    "VMT sheet CSV header mismatch", {header: lines[0]});
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const N = "\\d+(?:\\.\\d+)?"; // number pattern
    const re = new RegExp(
      `^([^,]+),(\\d{4}-\\d{2}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(.*)$`
    );
    const hit = re.exec(line);
    assert(hit !== null, "Malformed VMT sheet CSV row", {lineNo: i + 1, line});
    const helmerRaw = hit[1].trim();
    const helmer = ADS_HELMERS.find(c => c.toLowerCase() === helmerRaw.toLowerCase());
    assert(helmer !== undefined, "VMT sheet CSV has unknown helmer", {helmerRaw});
    const vmtBest = Number(hit[3]);
    const vmtCume = Number(hit[4]);
    const kyoomMin = Number(hit[5]); // min of cumulative VMT (the kyoom band)
    const kyoomMax = Number(hit[6]); // max of cumulative VMT
    const vmtMin = Number(hit[7]);
    const vmtMax = Number(hit[8]);
    // Receipt coverage: the fraction of the month's five-day-track incidents
    // present in the NHTSA release. 1 for every month except the release's
    // data-through month (reports received through the cutoff: the 15th of
    // the prior month, or the next business day), where slurp.py
    // supplies the measured (best, lo, hi) triple FIVE_DAY_RECEIPT_COVERAGE.
    // Scales the raw VMT that five-day-track metrics (m.fiveDay) use.
    const coverage    = Number(hit[9]);
    const coverageMin = Number(hit[10]);
    const coverageMax = Number(hit[11]);
    // Incident reporting completeness (Poisson thinning factor).
    // When Monthly reports are structurally absent for the last month, this
    // is slurp.py's pooled cross-helmer rate-ratio (observed incidents vs
    // the receipt-coverage-scaled VMT expectation from each helmer's
    // reference month); in the months inside a helmer's extra Monthly-report
    // lag (slurp.py MONTHLY_ARRIVAL_LAG) it is that helmer's measured 5-Day
    // share, its Monthly reports being still to come. Multiplied into
    // effective VMT on top of receipt coverage so the Gamma posterior
    // reflects the thinned observation — for Monthly-track metrics only;
    // five-day-track metrics skip it.
    const incCov     = Number(hit[12]); // best estimate
    const incCovMin  = Number(hit[13]); // most pessimistic (smallest p)
    const incCovMax  = Number(hit[14]); // most optimistic (largest p)
    assert(Number.isFinite(vmtBest) && vmtBest >= 0, "vmt must be non-negative number",
      {lineNo: i + 1, vmtBest});
    assert(Number.isFinite(vmtCume) && vmtCume >= 0,
      "helmer_cumulative_vmt must be non-negative number", {lineNo: i + 1, vmtCume});
    assert(Number.isFinite(kyoomMin) && kyoomMin >= 0, "kyoom_min must be non-negative number",
      {lineNo: i + 1, kyoomMin});
    assert(Number.isFinite(kyoomMax) && kyoomMax >= 0, "kyoom_max must be non-negative number",
      {lineNo: i + 1, kyoomMax});
    assert(kyoomMin <= vmtCume && vmtCume <= kyoomMax,
      "expected kyoom_min <= helmer_cumulative_vmt <= kyoom_max",
      {lineNo: i + 1, kyoomMin, vmtCume, kyoomMax});
    assert(Number.isFinite(vmtMin) && vmtMin >= 0, "vmt_min must be non-negative number",
      {lineNo: i + 1, vmtMin});
    assert(Number.isFinite(vmtMax) && vmtMax >= 0, "vmt_max must be non-negative number",
      {lineNo: i + 1, vmtMax});
    assert(vmtMin <= vmtBest && vmtBest <= vmtMax,
      "expected vmt_min <= vmt <= vmt_max", {lineNo: i + 1, vmtMin, vmtBest, vmtMax});
    assert(coverage > 0 && coverage <= 1, "coverage must be in (0, 1]",
      {lineNo: i + 1, coverage});
    assert(coverageMin > 0 && coverageMin <= coverage && coverage <= coverageMax && coverageMax <= 1,
      "expected 0 < coverage_min <= coverage <= coverage_max <= 1",
      {lineNo: i + 1, coverageMin, coverage, coverageMax});
    assert(incCov > 0 && incCov <= 1, "incident_coverage must be in (0, 1]",
      {lineNo: i + 1, incCov});
    assert(incCovMin > 0 && incCovMin <= incCov,
      "incident_coverage_min must be in (0, incident_coverage]",
      {lineNo: i + 1, incCovMin, incCov});
    assert(incCovMax >= incCov && incCovMax <= 1,
      "incident_coverage_max must be in [incident_coverage, 1]",
      {lineNo: i + 1, incCovMax, incCov});
    rows.push({
      helmer,
      month: hit[2],
      kyoomMin,
      kyoomMax,
      vmtMin,
      vmtBest,
      vmtMax,
      vmtCume,
      coverage,
      coverageMin,
      coverageMax,
      incCov,
      incCovMin,
      incCovMax,
      rationale: csvUnquote(hit[15]),
    });
  }
  assert(rows.length > 0, "VMT sheet CSV has no data rows");
  return rows;
}


function monthKeyFromIncidentLabel(label) {
  const hit = /^([A-Z]{3})-(\d{4})$/.exec(label);
  assert(hit !== null, "Invalid incident month label", {label});
  const month = MONTH_TOKENS[hit[1]];
  assert(month !== undefined, "Unknown incident month token", {label});
  return `${hit[2]}-${String(month).padStart(2, "0")}`;
}

function speedBinForIncident(speed) {
  if (speed === null) return "unknown";
  if (speed === 0) return "0";
  if (speed <= 10) return "1-10";
  if (speed <= 30) return "11-30";
  return "31+";
}

function emptySpeedBins() {
  return {"31+": 0, "11-30": 0, "1-10": 0, unknown: 0, "0": 0};
}

// Severity classification for the SGO "Highest Injury Severity Alleged" field
// — the SINGLE SOURCE OF TRUTH. Every severity string in INCIDENT_DATA must
// have a row here (asserted per-incident at load); the per-metric sets below
// are DERIVED from these flags, so a value can never be silently dropped from
// one classification while counted in another. That silent-drop bug hid 58
// injury crashes — bare "Minor" (the older NHTSA encoding) and "Serious" —
// from the injury and serious-injury metrics until it was caught 2026-06.
//   rank:   ordinal severity for sorting (higher = more severe)
//   injury: any reported injury (KABCO B+); bare "Minor"/"Moderate" are the
//           older NHTSA encoding, the "W/ Hospitalization" variants the newer
//   hosp:   occupant transported to a hospital (the SGO "W/ Hospitalization"
//           flag; "Serious"/"Fatality" imply transport)
//   ssi:    suspected serious injury or worse (KABCO A+K) = "Serious"/"Fatality"
//   fatal:  a fatality
const SEVERITY_INFO = {
  "No Injuries Reported":                 {rank: 0},
  "No Injured Reported":                  {rank: 0},
  "Property Damage. No Injured Reported": {rank: 0},
  // unk: injuriness unreported — rank 0 for sorting, but NOT property-damage-
  // only; severity-bucketing displays must count it separately.
  "Unknown":                              {rank: 0, unk: true},
  "Minor":                                {rank: 1, injury: true},
  "Minor W/O Hospitalization":            {rank: 1, injury: true},
  "Minor W/ Hospitalization":             {rank: 2, injury: true, hosp: true},
  "Moderate":                             {rank: 3, injury: true},
  "Moderate W/O Hospitalization":         {rank: 3, injury: true},
  "Moderate W/ Hospitalization":          {rank: 4, injury: true, hosp: true},
  "Serious":                              {rank: 5, injury: true, hosp: true, ssi: true},
  // First seen in NHTSA's Aug-2026 data (Waymo 30270-15547). The SGO data
  // dictionary (2026-08-17, field 73) defines it as "serious injuries that
  // required hospitalization or emergency treatment" — the same KABCO A meaning
  // as bare "Serious" (which already implies transport), so identical flags and
  // rank. NB the dictionary also defines a "Serious Without Hospitalization"
  // sibling, unseen so far; if it arrives it is ssi but NOT hosp, which breaks
  // the ssi ⊆ hosp nesting the quals assume — a human decision, not a row.
  "Serious W/ Hospitalization":           {rank: 5, injury: true, hosp: true, ssi: true},
  "Fatality":                             {rank: 6, injury: true, hosp: true, ssi: true, fatal: true},
};
const severitiesWhere = flag =>
  new Set(Object.keys(SEVERITY_INFO).filter(s => SEVERITY_INFO[s][flag]));
// Derived per-metric sets (DRY — never hand-edit; change SEVERITY_INFO instead).
const INJURY_SEVERITIES = severitiesWhere("injury");
const HOSPITALIZATION_SEVERITIES = severitiesWhere("hosp");
const SERIOUS_INJURY_SEVERITIES = severitiesWhere("ssi");  // SSI+ = KABCO A+K
const UNKNOWN_SEVERITIES = severitiesWhere("unk");
const SEVERITY_RANK =
  Object.fromEntries(Object.entries(SEVERITY_INFO).map(([s, i]) => [s, i.rank]));

// A linear axis's ticks from min: the multiples of a 1-2-5 step (a rung of
// LOG_LADDER times a power of ten) up to the first one at or above max, so
// the labels are round and the axis tops out at a labelled value; callers
// scale the axis to the last tick. The step is the rung nearest, in log
// terms, to (max - min) / count: below the geometric mean of two
// neighbouring rungs (sqrt 2, sqrt 10, sqrt 50) the lower one, as d3's tick
// increment chooses. Until 2026-10-04 the ticks sat at count-ths of max,
// unround and mixed (Tesla's cumulative VMT read 0 / 946.5K / 1.9M / 2.8M /
// 3.8M; audit #71). A range with no width (a chart with no data, whose max
// stays at its floor) has one tick, the floor: a placeholder 0..1 scale
// rounded to "0, 0, 1, 1, 1" on empty charts until 2026-10-03 (audit #51).
function linearTicks(min, max, count) {
  assert(Number.isFinite(min) && max >= min && count >= 1, "linearTicks: invalid range", {min, max, count});
  if (max === min) return [min];
  const rough = (max - min) / count;
  const decade = Math.pow(10, Math.floor(Math.log10(rough)));
  const mantissa = rough / decade;
  const rung = mantissa < Math.SQRT2 ? 1 : mantissa < Math.sqrt(10) ? 2 : mantissa < Math.sqrt(50) ? 5 : 10;
  const step = rung * decade;
  // (The 1e-9 absorbs float error, so a max on a rung tops out there.)
  return Array.from({length: Math.ceil((max - min) / step - 1e-9) + 1}, (_, i) => min + i * step);
}

// Fault values sit on a 0.05 grid (data/faultfrac.csv: 0, 0.05, ..., 1), so
// a sum of them is a whole number of twentieths. Summed as doubles it drifts
// off the grid: Waymo's default-window at-fault mass came to
// 93.24999999999997 and printed 93.2, while 8.55 printed 8.6, until
// 2026-10-03 (audit #56). So fault mass is summed in twentieths, and a value
// off the grid is an error, not a rounding.
const FAULT_GRID = 20;
function faultSum(fracs) {
  return fracs.reduce((sum, f) => {
    const twentieths = Math.round(f * FAULT_GRID);
    assert(Math.abs(f * FAULT_GRID - twentieths) < 1e-9, "fault fraction off the 0.05 grid", {f});
    return sum + twentieths;
  }, 0) / FAULT_GRID;
}

function nonstationaryIncidentCount(speeds) {
  return speeds["unknown"] + speeds["1-10"] + speeds["11-30"] + speeds["31+"];
}

function roadwayNonstationaryIncidentCount(rec) {
  return rec.incidents.roadwayNonstationary;
}

// A count to one decimal, grouped whether whole or fractional ("1,164",
// "93.3", "1,234.5"); a whole count prints no decimals. Until 2026-10-03 the
// fractional branch was toFixed(1), ungrouped, so a fault mass of 1,234.5
// would have read "1234.5" beside "1,234" (audit #54's one format).
function fmtCount(n) {
  assert(Number.isFinite(n) && n >= 0, "fmtCount: invalid input", {n});
  return (Math.round(n * 10) / 10).toLocaleString(NUMBER_LOCALE, {maximumFractionDigits: 1});
}

// Pluralize a count: splur(1, "incident") -> "1 incident"; splur(2) -> "2 incidents".
// The plural agrees with the DISPLAYED count: 0.96 shows as "1", so "1 incident".
function splur(n, singular, plural = singular + "s") {
  const shown = fmtCount(n);
  return `${shown} ${shown === "1" ? singular : plural}`;
}

function monthHelmerToggleId(helmer) {
  return "month-helmer-toggle-" + helmer.toLowerCase();
}

function includedHelmers() {
  return ALL_HELMERS.filter(helmer => monthHelmerEnabled[helmer]);
}

function selectedMonthMetric() {
  const metric = METRIC_BY_KEY[selectedMetricKey];
  assert(metric !== undefined, "Missing selected metric", {selectedMetricKey});
  return metric;
}

function seriesMonthBounds(series) {
  assert(series.months.length > 0, "Missing series months");
  return {
    start: series.months[0],
    end: series.months[series.months.length - 1],
  };
}

function fmtWhole(n) {
  assert(Number.isFinite(n), "fmtWhole: invalid input", {n});
  return Math.round(n).toLocaleString(NUMBER_LOCALE);
}

// A VMT chart dot's tooltip: the month, its miles and their range (the
// month's authored band; the kyoom band in the cumulative view), and the
// incidents on the same basis as the miles (that month's, or all of them
// through it). The range is also its error-bar ends', so an end hidden under
// its dot (Tesla's 2025 bands are a fraction of a unit tall) loses nothing
// (audit #28); until 2026-10-03 the cumulative view paired all-time miles
// with the month's count alone (audit #59).
function vmtDotTooltip(month, miles, lo, hi, incidents) {
  return `${month}\n${fmtWhole(miles)} miles\nRange: ${fmtWhole(lo)} – ${fmtWhole(hi)}\n${splur(incidents, "incident")}`;
}
// An error-bar end's tooltip: the month, the end's miles, and which end it is
// (until 2026-10-03 the two ends read alike; audit #59).
// The two labels: the low end and the high end of the
// month's VMT range (of the cumulative range, in the cumulative view).
const VMT_RANGE_EDGE = {lo: "Low end", hi: "High end"};
function vmtEndTooltip(month, miles, edge) {
  return `${month}\n${fmtWhole(miles)} miles\n${edge}`;
}
// The line under a partially received month's incident count (the
// data-through month, or a month inside a helmer's extra Monthly-report lag),
// which holds only the reports received by the cutoff: an estimated
// coverage x incCov of the month's eventual incidents, coverage x incCovMin
// at worst (incCov is conditional on the receipt-coverage best, so the
// product is the month's expected share; data/vmt.js). The VMT chart's miles are the full month's,
// so August's 10 Waymo incidents beside 20.8M miles read as a tenth of the
// usual crash rate until 2026-10-03 (audit #60). This is not the MPI chart's
// "incident coverage", which is incCov alone: there the receipt coverage is
// already in the denominator.
// Note must say that the count above holds only
// the reports NHTSA had received by the cutoff date shown, about X% of the
// month's eventual incidents (worst case about Y%), so it is far below the
// month's full count.
function vmtPartialNote(share, worst) {
  return `Count above only includes incidents received by ${NHTSA_DATA_THROUGH_DATE}: ~${Math.round(share * 100)}% of the month's eventual incidents (worst case ~${Math.round(worst * 100)}%)`;
}

function helmerMonthRows(series, helmer) {
  return series.points.map(point => point.helmers[helmer]);
}

// The VMT band of a window's exposure: one helper for every window the page
// shows, a single month included, so a month's chart posterior and a
// one-month window's card are one posterior (until 2026-10-03 the chart took
// the authored month band alone, and six months showed two posteriors; audit
// #15). Summing each month's 95% edges treats the monthly errors as
// perfectly correlated, which overstates the window's spread wherever the
// master pins the CUMULATIVE more tightly than the months (Waymo's hub
// anchors, Tesla's deck chart). The window total is
// cume(end) - cume(start-1), whose band is
// [kyoom_min(end) - kyoom_max(before), kyoom_max(end) - kyoom_min(before)]
// (before = the helmer's last master row before the window, or zero miles
// if its series begins inside the window). That difference and the summed
// month bands both bound the total, so the band is their intersection,
// taken over the fully received months (where every metric's triple equals
// the authored month band); the partially received months' own thinned
// bands are then added, since their kyoom rows are full-month: the
// data-through month (receipt coverage, plus the Monthly-track factor for
// non-five-day metrics) and, for Monthly-track metrics, the months inside the
// helmer's extra Monthly-report lag just before it (slurp.py
// MONTHLY_ARRIVAL_LAG: Zoox's 2026-07 on the Sep-15-2026 release). The kyoom
// difference bounds a CONTIGUOUS span only, so it applies when the fully
// received rows cover every master month in their span (always, today; a
// needsFault gap would fall back to the plain sum). Until 2026-09-04 the
// plain sum was used: Waymo's default window ran 0.76x-1.28x of best where
// its anchors imply ~0.93x-1.12x (window-band.qual pins the recompute).
function windowVmtBand(helmer, metricRows, minOf, bestOf, maxOf) {
  // Fully received, for this metric: its triple is the authored month band
  // (no receipt or Monthly-track factor below 1 applies to it), which is what
  // the full-month kyoom difference bounds. Testing the triple rather than
  // the receipt coverage alone keeps a month thinned by the Monthly-track
  // factor only (a lagged month) out of the kyoom intersection.
  const isFull = r => minOf(r) === r.vmtMonthMin && maxOf(r) === r.vmtMonthMax;
  const full = metricRows.filter(isFull);
  const partial = metricRows.filter(r => !isFull(r));
  // Partially received months are the release frontier, so they come after
  // every fully received one. Until 2026-10-04 this asserted at most one,
  // the data-through month.
  assert(partial.every(p => full.every(f => f.month < p.month)),
    "a partially received month precedes a fully received one in a window",
    {helmer, partial: partial.map(r => r.month), full: full.map(r => r.month)});
  let min = full.reduce((sum, r) => sum + minOf(r), 0);
  const best = metricRows.reduce((sum, r) => sum + bestOf(r), 0);
  let max = full.reduce((sum, r) => sum + maxOf(r), 0);
  const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
  const first = full[0], last = full[full.length - 1];
  const span = full.length === 0 ? 0
    : master.filter(r => r.month >= first.month && r.month <= last.month).length;
  if (span > 0 && span === full.length) {
    const earlier = master.filter(r => r.month < first.month);
    const before = earlier.length === 0 ? {kyoomMin: 0, kyoomMax: 0} : earlier[earlier.length - 1];
    min = Math.max(min, last.kyoomMin - before.kyoomMax);
    max = Math.min(max, last.kyoomMax - before.kyoomMin);
  }
  for (const r of partial) { min += minOf(r); max += maxOf(r); }
  assert(min <= best && best <= max, "window VMT band does not bracket its best",
    {helmer, min, best, max});
  return {min, best, max};
}

function monthlySummaryRows(series) {
  return ALL_HELMERS.map(helmer => {
    const rows = series.points
      .filter(p => p.helmers[helmer] !== null)
      .map(p => p.helmers[helmer]);
    const {min: vmtMin, best: vmtBest, max: vmtMax} =
      windowVmtBand(helmer, rows, row => row.vmtMin, row => row.vmtBest, row => row.vmtMax);
    // Raw window total — the authored monthly estimates with neither the
    // receipt-coverage nor the Monthly-track thinning — for the summary cards'
    // Effective-VMT tooltip (the five-day denominator is listed separately).
    const vmtRawBest = rows.reduce((sum, row) => sum + row.vmtMonthBest, 0);
    const metricRowsByKey = Object.fromEntries(
      METRIC_DEFS.map(m => [m.key, rows.filter(row => row.mpiByMetric[m.key] !== null)]));
    // Each metric's window count. Fault mass (the metrics with fracsFn) is the
    // exact grid sum of the window's fault fractions (faultSum; a float sum of
    // the months' masses drifts off the grid, audit #56), and the fractions
    // also feed its Poisson-binomial mixture; every other count is a plain
    // sum (whole incidents, and fatality's 1/vehicles fractions).
    const windowCounts = Object.fromEntries(METRIC_DEFS.map(m => {
      const metricRows = metricRowsByKey[m.key];
      if (!m.fracsFn) return [m.key, {k: metricRows.reduce((sum, row) => sum + m.countFn(row), 0), fracs: null}];
      const fracs = metricRows.flatMap(row => m.fracsFn(row));
      return [m.key, {k: faultSum(fracs), fracs}];
    }));
    // Auto-generate inc fields from METRIC_DEFS
    const incFields = Object.fromEntries(
      METRIC_DEFS.map(m => [m.incField, windowCounts[m.key].k]));

    const vmtRationales = [...new Set(rows.map(r => r.rationale).filter(Boolean))];
    // Pre-compute MPI estimates for each metric (consumed by cards + distribution).
    // vmtBest > 0: Bayesian Gamma posterior from observed incidents + VMT.
    // vmtBest === 0: log-normal from literature CI (humanMPI on METRIC_DEFS).
    const mpiEstimates = Object.fromEntries(METRIC_DEFS.map(m => {
      const metricRows = metricRowsByKey[m.key];
      // Five-day-track metrics (m.fiveDay, see METRIC_DEFS) sum the raw
      // receipt-coverage-scaled VMT; Monthly-track metrics keep the incCov-thinned
      // sums — mirroring the per-month selection in mpiByMetric.
      const {min: metricVmtMin, best: metricVmtBest, max: metricVmtMax} = windowVmtBand(helmer, metricRows,
        row => m.fiveDay === true ? row.vmtRawMin : row.vmtMin,
        row => m.fiveDay === true ? row.vmtRawBest : row.vmtBest,
        row => m.fiveDay === true ? row.vmtRawMax : row.vmtMax);
      if (metricVmtBest > 0) {
        const {k, fracs} = windowCounts[m.key];
        const est = estimateMpiWindow(k, fracs, metricVmtMin, metricVmtBest, metricVmtMax);
        return [m.key, {
          ...est,
          // Bell marginalizes over the VMT band (see marginalMpiLogDensity) so it
          // shows exposure uncertainty too, not just Poisson uncertainty at vmtBest —
          // and, for the at-fault metrics, over the Poisson-binomial fault count.
          // For data-rich helmers the marginal is much wider than the sampling bell,
          // so the plot extent must bracket it: combine the extreme mixture
          // components' sampling tails with the VMT band extremes (vmtMin = low-MPI
          // edge, vmtMax = high-MPI edge) so the full widened bell draws without
          // clipping.
          densityFn: makeMixtureMarginalMpiDensity(est.comps, metricVmtMin, metricVmtBest, metricVmtMax),
          xMin: 1 / gammaquant(est.comps[est.comps.length - 1].a, metricVmtMin, 0.999),
          xMax: 1 / gammaquant(est.comps[0].a, metricVmtMax, 0.001),
          // Posterior median: finite even at k=0 and inside the bell's mass, unlike the
          // MLE (est.median = vmtBest/k, which is ∞ at k=0 and far out in the tail for
          // small k). The distribution chart marks this so the dot sits on the bell —
          // it is the marginal posterior's own median, consistent with the CI.
          postMedian: est.quant(0.5),
        }];
      }
      if (vmtBest > 0) return [m.key, null];
      const h = m.humanMPI && m.humanMPI[helmer];
      if (!h) return [m.key, null];
      const geo = Math.sqrt(h.lo * h.hi);
      const mu = (Math.log(h.lo) + Math.log(h.hi)) / 2;
      const sigma = (Math.log(h.hi) - Math.log(h.lo)) / (2 * 1.96);
      return [m.key, {
        median: geo, lo: h.lo, hi: h.hi, k: null,
        postMedian: geo, // log-normal median (= geo); the curve's peak
        densityFn: x => logNormalLogDensity(x, mu, sigma),
        xMin: Math.exp(mu - 3.09 * sigma),
        xMax: Math.exp(mu + 3.09 * sigma),
      }];
    }));
    return {
      helmer,
      vmtMin, vmtBest, vmtMax, vmtRawBest,
      vmtRationales,
      ...incFields,
      mpiEstimates,
    };
  });
}

// A window's summary rows (monthlySummaryRows), computed once per month
// series and shared by every view that reads them: the summary cards, the
// distribution chart, the VMT-uncertainty table and the stress table. Until
// 2026-10-05 each computed its own, six times per slider step (audit #23). A
// series is not changed after monthSeriesData or sliceSeries builds it, and
// monthlySummaryRows reads nothing else but vmtRows, which init sets once;
// the assert catches rows kept past a change of vmtRows.
const SUMMARY_ROWS = new WeakMap();
function windowSummaryRows(series) {
  if (!SUMMARY_ROWS.has(series)) SUMMARY_ROWS.set(series, {rows: monthlySummaryRows(series), vmtRows});
  const kept = SUMMARY_ROWS.get(series);
  assert(kept.vmtRows === vmtRows, "window summary rows kept past a change of vmtRows");
  return kept.rows;
}

function estimateMpiWindow(k, fracs, vmtMin, vmtBest, vmtMax, massFrac = CI_MASS_DEFAULT_PCT / 100) {
  const comps = mixtureComponents(k, fracs);
  const quant = makeMarginalMpiQuant(comps, vmtMin, vmtBest, vmtMax);
  const tail = (1 - massFrac) / 2;
  return {
    k, comps, quant, vmtMin, vmtBest, vmtMax,
    median: vmtBest / k, // MLE point estimate (∞ at k=0); shown only in the distribution marker tooltip, never as the point estimate (that is postMedian)
    // Exact tail-mass quantiles of the marginal posterior (the drawn bell), so
    // "95% CI" means exactly 95% — under the two-piece VMT prior that puts
    // exactly 95% of prior mass between the authored band endpoints (S1
    // resolved 2026-08-21; see splitPriorSigmas). (Until 2026-08-21 these
    // were the conservative double-extreme envelope — coverage 97.9-99.4%.)
    lo: quant(tail),
    hi: quant(1 - tail),
  };
}

// The stress verdict of an AV CI [lo, hi] against a human band: robustly
// safer when the whole AV/human ratio range is above 1, robustly worse when
// it is below 1. One rule for the stress table, the cards and the fault-flip
// search.
function stressVerdictKey(lo, hi, human) {
  return lo / human.hi > 1 ? "safer" : hi / human.lo < 1 ? "worse" : "ambiguous";
}

// Verdicts in the order more at-fault mass moves them (MPI only falls as the
// mass grows), for the flip-direction check in faultFlipMultiplier.
const STRESS_VERDICT_ORDER = ["safer", "ambiguous", "worse"];

// How close, in ln(MPI), a band edge may sit to the displayed CI edge for
// the flip search's own s = 1 verdict to differ from the displayed one as
// numerics rather than as a genuine inconsistency. Both come from the same
// CDF; the displayed edges are its quantiles, solved to |F - p| < 1e-8. On
// 2026-10-03 every one of 7,760 displayed CI edges (all metrics; single
// months, 3-month windows, every window ending at the latest month) sat
// within 7.7e-7 of its exact quantile, so 1e-4 leaves 100x.
const FLIP_CDF_TOLERANCE = 1e-4;

// Faultfrac sensitivity: the faultfracs are Claude's judgments from
// company-written narratives, so ask how undercounted the true at-fault mass
// would have to be to change the stress verdict. Returns the verdict the
// search starts from (base, the displayed one), the smallest multiplier
// s > 1 on the judged mass at which the verdict (vs the AV-cities band)
// changes, to the precision the table prints it (narrowToPrinted: a value
// that prints as the flip point does and flips), and the verdict it changes
// to; null when k = 0 (scaling zero mass
// changes nothing); mult Infinity when no s <= 10^4 flips it.
// nIncidents: the metric universe's incident count (e.g. incTotal for
// at-fault). Fault fractions are probabilities, so the true at-fault mass
// can never exceed it: the search stops at s = nIncidents / k ("every
// incident at fault") and reports Infinity beyond that. Without the cap
// (until 2026-09-04) Tesla showed "5.85x -> robustly worse", which needed
// 39 at-fault incidents out of 24.
function faultFlipMultiplier(est, human, nIncidents) {
  if (est.k === 0) return null;
  assert(Number.isFinite(nIncidents) && nIncidents >= est.k,
    "faultFlipMultiplier: incident count must bound the judged at-fault mass",
    {nIncidents, k: est.k});
  const sMax = nIncidents / est.k;
  const tail = (1 - CI_MASS_DEFAULT_PCT / 100) / 2;
  const verdictAt = s => {
    // Scale the judged at-fault mass inside each mixture component (a_K =
    // K·s + 1/2). The verdict needs only two CDF evaluations, no quantile
    // search: lo > human.hi <=> F(human.hi) < tail, and hi < human.lo <=>
    // F(human.lo) > 1 - tail. The CDF is the displayed CI's own (every
    // component, the adaptive node count), so the search measures what the
    // CI shows. Until 2026-10-03 it ran a lighter CDF (components under 1e-4
    // dropped, 13 prior nodes) whose CI edges sat up to 0.7% from the
    // displayed ones, and asserted its s = 1 verdict equal to the displayed
    // one: a CI edge inside that gap threw, blanking the sanity section and
    // the incident browser for the window. The full CDF (scaled shapes are
    // not consecutive, so it loses its cheap recurrence) measured ~20 ms
    // more per sanity rebuild in Chromium, ~90 ms at 4x CPU throttling.
    const scaled = est.comps.map(c => ({a: (c.a - 0.5) * s + 0.5, w: c.w}));
    const cdf = makeMarginalMpiCdf(scaled, est.vmtMin, est.vmtBest, est.vmtMax);
    return cdf(human.hi) < tail ? "safer"
      : cdf(human.lo) > 1 - tail ? "worse" : "ambiguous";
  };
  // The search starts from the displayed verdict, read off the displayed CI.
  const base = stressVerdictKey(est.lo, est.hi, human);
  // Its own verdict at s = 1 may differ only where a band edge sits within
  // the quantile solver's precision of the CI edge between the two verdicts
  // (safer|worse borders no single edge); anywhere else the CI does not
  // belong to this estimate.
  const atOne = verdictAt(1);
  const edgeGap = {
    "ambiguous|safer": Math.abs(Math.log(est.lo / human.hi)),
    "ambiguous|worse": Math.abs(Math.log(est.hi / human.lo)),
  }[[base, atOne].sort().join("|")] ?? Infinity;
  assert(atOne === base || edgeGap < FLIP_CDF_TOLERANCE,
    "faultFlipMultiplier: CDF verdict at s = 1 disagrees with the displayed CI's away from any band edge",
    {base, atOne, edgeGap, lo: est.lo, hi: est.hi, human});
  let lo = 1;
  let hi = null;
  for (let e = 1; e <= 80; e++) {
    const s = Math.min(Math.pow(10, e / 20), sMax);
    if (verdictAt(s) !== base) { hi = s; break; }
    lo = s;
    if (s === sMax) break; // every incident at fault and still no flip
  }
  if (hi === null) return {base, mult: Infinity, flipped: null};
  const mult = narrowToPrinted(lo, hi, s => verdictAt(s) !== base);
  const flipped = verdictAt(mult);
  assert(STRESS_VERDICT_ORDER.indexOf(flipped) > STRESS_VERDICT_ORDER.indexOf(base),
    "faultFlipMultiplier: more at-fault mass flipped the verdict away from worse",
    {base, flipped, mult});
  return {base, mult, flipped};
}

// The bisection of the fault-flip search: a bracket [lo, hi] with no flip at
// lo and a flip at hi (flips(s): whether multiplier s flips the verdict),
// narrowed until every value in it prints alike (fmtRatio). fmtRatio rounds
// monotonically, so then the flip point, which lies in the bracket, prints as
// hi does, and narrowing further cannot change what the table prints. Until
// 2026-10-05 the search halved the bracket 40 times, past twelve significant
// figures, each halving a full marginal CDF: 61 ms of the sanity section's
// ~80 ms per slider step (audit #23). The stop follows fmtRatio, so a change
// of its precision carries over. A bracket whose ends still print apart once
// it is narrower than 1e-12 in ln holds a flip point on a print boundary
// (1.05 between "1.0" and "1.1"), which no narrowing separates; hi, which
// flips, then prints as the flip point does (as the distribution chart's peak
// search stops).
function narrowToPrinted(lo, hi, flips) {
  for (let step = 0; fmtRatio(lo) !== fmtRatio(hi) && Math.log(hi / lo) > 1e-12; step++) {
    assert(step < 200, "fault-flip search: the bracket did not narrow", {lo, hi});
    const mid = Math.sqrt(lo * hi);
    if (flips(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

// The one format of an AV-vs-human multiplier or ratio (the summary cards'
// multipliers and their All-incidents line, the stress tables' ratio ranges,
// the fault-flip multipliers): two significant figures below 10, a whole
// number from 10. ratioShown is the value printed (9.96 rounds to 10, so it
// prints "10"), and a multiplier's safer/worse colour is read off it. Until
// 2026-10-03 the cards printed toFixed(1) below 10 ("0.0x" for Tesla's 0.026
// fatality multiplier, "10.0x" for 9.96, and a 0.996 as "1.0x" in the worse
// red) and this function three tiers ("0.00x", "10.0x" .. "99.9x"; audit #55).
// The significant-figure formatter never writes an exponent (1e-7 prints
// "0.00000010").
const RATIO_TWO_SIG = new Intl.NumberFormat(NUMBER_LOCALE, {minimumSignificantDigits: 2, maximumSignificantDigits: 2});
function ratioShown(n) {
  assert(Number.isFinite(n) && n > 0, "ratioShown: invalid input", {n});
  const twoSig = Number(n.toPrecision(2));
  return twoSig >= 10 ? Math.round(n) : twoSig;
}
function fmtRatio(n) {
  const shown = ratioShown(n);
  return shown >= 10 ? fmtWhole(shown) : RATIO_TWO_SIG.format(shown);
}

function helmerHumanStress(row, metricKey) {
  const metric = METRIC_BY_KEY[metricKey];
  // Stress comparisons use the AV-cities cohort — humans in the same cities
  // the robotaxis operate in, so closer to apples-to-apples than a national
  // baseline. NOT fully exposure-matched, though: the band spans the per-city
  // extremes rather than weighting any one AV's city mix (Zoox's Las Vegas
  // isn't among the hub's five benchmark areas), and the severity benchmarks
  // are surface-street rates while AV miles now include some freeway driving
  // (immaterial today — see the METRIC_DEFS scope note).
  const human = metric && metric.humanMPI && metric.humanMPI.HumansAV;
  assert(metric !== undefined && human !== undefined, "Missing stress metric inputs", {metricKey});
  const av = row.mpiEstimates[metricKey];
  assert(av != null, "Missing AV stress estimate", {helmer: row.helmer, metricKey});
  const ratioLo = av.lo / human.hi;
  const ratioHi = av.hi / human.lo;
  const verdictKey = stressVerdictKey(av.lo, av.hi, human);
  return {
    metric,
    human,
    av,
    ratioLo,
    ratioHi,
    verdictKey,
    ...STRESS_VERDICT_META[verdictKey],
  };
}

// The month series every view indexes: each month with a VMT row, in order.
// The date slider holds indices into it; d= in the URL names its months.
function vmtMonthList() {
  return [...new Set(vmtRows.map(row => row.month))].sort();
}

function monthSeriesData() {
  assert(vmtRows.length > 0, "month series requires vmtRows");
  const months = vmtMonthList();
  const monthSet = new Set(months);
  const vmtByKey = {};
  for (const row of vmtRows) {
    const key = row.helmer + "|" + row.month;
    assert(vmtByKey[key] === undefined, "Duplicate VMT row for helmer-month", {key});
    vmtByKey[key] = row;
  }

  const incidentsByKey = {};
  for (const inc of incidents) {
    assert(ADS_HELMERS.includes(inc.helmer), "inline incident data has unknown ADS helmer", {helmer: inc.helmer});
    const month = monthKeyFromIncidentLabel(inc.date);
    assert(monthSet.has(month), "incident date outside VMT window",
      {reportId: inc.reportId, helmer: inc.helmer, date: inc.date, month});
    const key = inc.helmer + "|" + month;
    let rec = incidentsByKey[key];
    if (rec === undefined) {
      rec = {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0,
             atFaultFracs: [], atFaultInjury: 0, atFaultInjuryFracs: [],
             injury: 0, hospitalization: 0, airbag: 0,
             seriousInjury: 0, fatality: 0};
      incidentsByKey[key] = rec;
    }
    rec.total += 1;
    const bin = speedBinForIncident(inc.speed);
    rec.speeds[bin] += 1;
    assert(typeof inc.road === "string", "incident road must be string", {reportId: inc.reportId, road: inc.road});
    rec.roadwayNonstationary += Number(
      bin !== "0" && inc.road !== "Parking Lot",
    );
    let atFaultFrac = null;
    if (inc.fault !== null) {
      assert(typeof inc.fault === "object",
        "incident fault must be null or object", {reportId: inc.reportId});
      atFaultFrac = Number(inc.fault.faultfrac);
      assert(Number.isFinite(atFaultFrac) && atFaultFrac >= 0 && atFaultFrac <= 1,
        "monthly at-fault fraction out of range", {reportId: inc.reportId, atFaultFrac});
    }
    rec.faultKnown += Number(atFaultFrac !== null);
    // Keep the individual nonzero fractions: the at-fault posteriors mix over
    // the Poisson-binomial of the true count (mixtureComponents), and the
    // month's fault mass is their exact sum on the 0.05 grid (faultSum, after
    // this loop).
    if (atFaultFrac) {
      rec.atFaultFracs.push(atFaultFrac);
      if (INJURY_SEVERITIES.has(inc.severity)) rec.atFaultInjuryFracs.push(atFaultFrac);
    }
    rec.injury += Number(INJURY_SEVERITIES.has(inc.severity));
    rec.hospitalization += Number(HOSPITALIZATION_SEVERITIES.has(inc.severity));
    rec.airbag += Number(inc.airbagAny === true);
    rec.seriousInjury += Number(SERIOUS_INJURY_SEVERITIES.has(inc.severity));
    // Fractional-death attribution (Koopman's method, endorsed by Piper): a
    // fatal crash counts as 1/(vehicles involved) on the AV's account. Summed
    // over every vehicle on the road this counts each fatal CRASH exactly once
    // (SGO severity flags at-least-one-death, not a death count), so the
    // consistent human FLEET comparators are fatal crashes / total VMT and,
    // under deaths≈fatal-crashes, deaths / total VMT — the two numerators the
    // fatality humanMPI band below spans. Most fatal crashes are
    // multi-vehicle, so counting each fatal-crash involvement as a whole death
    // would overstate the AV against those fleet rates; the fraction makes
    // them comparable (a 2-vehicle fatal crash = 0.5, a 3-vehicle = 0.33). See
    // theargumentmag.com/p/we-absolutely-do-know-that-waymos.
    rec.fatality += Number(inc.severity === "Fatality") / inc.vehiclesInvolved;
  }
  for (const rec of Object.values(incidentsByKey)) {
    rec.atFault = faultSum(rec.atFaultFracs);
    rec.atFaultInjury = faultSum(rec.atFaultInjuryFracs);
  }

  // Shared human entries: same reference in every month (literature-based
  // MPI), one per benchmark cohort (see HUMAN_HELMERS).
  const humanEntryFor = cohort => ({
    month: null, coverage: 1,
    incCov: 1, incCovMin: 1, // literature-based: nothing is still being reported
    vmtMin: 0, vmtBest: 0, vmtMax: 0,
    vmtRawMin: 0, vmtRawBest: 0, vmtRawMax: 0,
    vmtMonthMin: 0, vmtMonthBest: 0, vmtMonthMax: 0,
    vmtCume: 0, rationale: null,
    incidents: {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0,
                atFaultFracs: [], atFaultInjury: 0, atFaultInjuryFracs: [],
                injury: 0, hospitalization: 0, airbag: 0,
                seriousInjury: 0, fatality: 0},
    mpiByMetric: Object.fromEntries(
      METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[cohort]).map(m => {
        const h = m.humanMPI[cohort];
        const geo = Math.sqrt(h.lo * h.hi);
        return [m.key, {
          mpiBest: geo, mpiMedian: geo, mpiMax: h.hi,
          incidentCount: null,
          bands: CI_FAN_LEVELS.map(() => ({lo: h.lo, hi: h.hi})),
        }];
      })),
  });
  const humanEntries = Object.fromEntries(
    HUMAN_HELMERS.map(hh => [hh, humanEntryFor(hh)]));

  assert(months.length > 0, "No months to render");
  // One month's posterior (median and fan bands), solved once per distinct
  // input: within a month, metrics with the same mixture and band share it
  // (k = 0 on every five-day metric, all = nonstationary when no crash was
  // stationary), which is half of the 1,050 per-month posteriors (2026-10-03).
  // Each costs seven quantile solves, and the quadrature behind them doubled
  // its nodes that day (vmtPriorNodes), which this offsets.
  const posteriors = new Map();
  const monthPosterior = (comps, vMin, vBest, vMax) => {
    const key = JSON.stringify([comps, vMin, vBest, vMax]);
    if (!posteriors.has(key)) {
      const quant = makeMarginalMpiQuant(comps, vMin, vBest, vMax);
      posteriors.set(key, {
        median: quant(0.5),
        bands: CI_FAN_LEVELS.map(level => {
          const t = (1 - level) / 2;
          return {lo: quant(t), hi: quant(1 - t)};
        }),
      });
    }
    return posteriors.get(key);
  };
  const points = [];
  // Each helmer's incidents through the month, all-time like vmtCume: the
  // count the VMT chart pairs with cumulative miles.
  const incidentsToDate = Object.fromEntries(ADS_HELMERS.map(helmer => [helmer, 0]));
  for (const month of months) {
    const helmers = {...humanEntries};
    for (const helmer of ADS_HELMERS) {
      const key = helmer + "|" + month;
      const vmt = vmtByKey[key];
      if (vmt === undefined) {
        // Anti-Postel: no VMT this month is fine ONLY if the helmer also had no
        // incidents. An incident with no denominator (e.g. an SGO incident in a
        // month before the helmer's VMT series begins) must fail loudly, not vanish
        // — that silent drop is exactly the Zoox-pre-2025-06 bug.
        assert(incidentsByKey[key] === undefined,
          "orphan incident(s): in-scope incident with no VMT denominator — add a VMT row for this helmer/month",
          {helmer, month, incidentTotal: incidentsByKey[key] && incidentsByKey[key].total});
        helmers[helmer] = null;
        continue;
      }
      assert(vmt.vmtMin > 0, "vmt_min must be positive", {helmer, month, vmtMin: vmt.vmtMin});
      assert(vmt.vmtBest > 0, "vmt must be positive", {helmer, month, vmtBest: vmt.vmtBest});
      assert(vmt.vmtMax > 0, "vmt_max must be positive", {helmer, month, vmtMax: vmt.vmtMax});
      const inc = incidentsByKey[key] || {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0, atFaultFracs: [], atFaultInjury: 0, atFaultInjuryFracs: [], injury: 0, hospitalization: 0, airbag: 0, seriousInjury: 0, fatality: 0};
      incidentsToDate[helmer] += inc.total;
      // Receipt coverage (vmt.coverage triple): the fraction of this month's
      // five-day-track incidents present in the NHTSA release — 1 except for
      // the release's data-through month, where slurp.py supplies the measured
      // (best, lo, hi). Partial coverage anywhere else means the reviewed
      // NHTSA_DATA_THROUGH_DATE and the data disagree (anti-Postel).
      assert(vmt.coverage === 1 || month === NHTSA_DATA_THROUGH_DATE.slice(0, 7),
        "partial receipt coverage outside the NHTSA data-through month",
        {month, coverage: vmt.coverage, NHTSA_DATA_THROUGH_DATE});
      // Incident coverage: for the data-through month the Monthly-track (SGO
      // Request No. 2) reports are structurally absent, and in the months
      // inside a helmer's extra Monthly-report lag (slurp.py
      // MONTHLY_ARRIVAL_LAG) its Monthly reports have not arrived yet (there
      // f is the helmer's 5-Day share and the receipt coverage is 1).
      // Scaling VMT by the coverage fraction f gives the posterior
      // Gamma(k+0.5, VMT*f). Since f
      // is itself uncertain, incCovMin (smallest f) widens the effective-VMT
      // band's low edge and incCovMax (= 1.0: all Monthly-track incidents may
      // already be in, i.e. as complete as the five-day track) its high edge.
      // slurp.py derives f CONDITIONAL on the receipt-coverage best (the
      // product coverage x f is invariant to the receipt choice), so the low
      // edge pairs vmt_min with the receipt BEST and incCovMin — pairing it
      // with the receipt lo re-applied the receipt uncertainty a second time
      // (0.78x too low, until 2026-09-04). The high edge pairs vmt_max with
      // the receipt hi and incCovMax = 1, which is not conditional. The
      // marginal posterior treats [vmtMin, vmtMax] as the VMT prior's 95%
      // interval, so ignorance about both fractions flows into the displayed
      // CI through the prior (not through worst-case endpoint pairing, as
      // before 2026-08-21). Five-day-track metrics (m.fiveDay, see
      // METRIC_DEFS) use the raw triple in mpiByMetric below: receipt-scaled
      // (lo/best/hi), but not thinned by the Monthly-track factor.
      const entry = {
        month,
        coverage: vmt.coverage, // receipt coverage best (< 1 only in the data-through month)
        // Effective VMT: used for MPI computation (Poisson rate estimation)
        vmtMin: vmt.vmtMin * vmt.coverage * vmt.incCovMin,
        vmtBest: vmt.vmtBest * vmt.coverage * vmt.incCov,
        vmtMax: vmt.vmtMax * vmt.coverageMax * vmt.incCovMax,
        // Monthly-track incident coverage (1 except in the data-through month,
        // where it is pooled, and in a helmer's Monthly-lag months) -- the MPI
        // chart's incomplete-reporting fade reads these
        incCov: vmt.incCov,
        incCovMin: vmt.incCovMin,
        // Raw VMT: receipt-coverage-scaled, no Monthly-track thinning — the
        // five-day-track metrics' denominator
        vmtRawMin: vmt.vmtMin * vmt.coverageMin,
        vmtRawBest: vmt.vmtBest * vmt.coverage,
        vmtRawMax: vmt.vmtMax * vmt.coverageMax,
        // Full-month VMT: the fleet trend charts, so the partial data-through
        // month doesn't draw a false cliff
        vmtMonthMin: vmt.vmtMin,
        vmtMonthBest: vmt.vmtBest,
        vmtMonthMax: vmt.vmtMax,
        vmtCume: vmt.vmtCume,
        kyoomMin: vmt.kyoomMin, // cumulative VMT band (the kyoom band)
        kyoomMax: vmt.kyoomMax,
        rationale: vmt.rationale,
        incidents: inc,
        incidentsCume: incidentsToDate[helmer],
      };
      // Pre-compute MPI estimates for each metric (consumed by MPI chart)
      entry.mpiByMetric = Object.fromEntries(METRIC_DEFS.map(m => {
        if (m.needsFault === true && entry.incidents.faultKnown !== entry.incidents.total) {
          return [m.key, null];
        }
        // Five-day-track metrics use the receipt-coverage-scaled raw VMT;
        // Monthly-track metrics keep the incCov-thinned triple. One branch,
        // selected by metric data. The month's band is the one-month window's
        // (windowVmtBand), so this posterior is that window's card.
        const {min: vMin, best: vBest, max: vMax} = windowVmtBand(helmer, [entry],
          r => m.fiveDay === true ? r.vmtRawMin : r.vmtMin,
          r => m.fiveDay === true ? r.vmtRawBest : r.vmtBest,
          r => m.fiveDay === true ? r.vmtRawMax : r.vmtMax);
        const k = m.countFn(entry);
        const comps = mixtureComponents(k, m.fracsFn ? m.fracsFn(entry) : null);
        // Point estimate = posterior median (finite even at k=0). mpiBest = MLE
        // (miles/incidents, ∞ at k=0) is kept only for the subset-chain invariant.
        // The bands and median are exact quantiles of the month's marginal
        // posterior (Jeffreys-Gamma mixed over the Poisson-binomial fault count
        // and the VMT prior), well-defined at k=0.
        const post = monthPosterior(comps, vMin, vBest, vMax);
        return [m.key, {
          mpiBest: vBest / k,
          mpiMedian: post.median,
          mpiMax:  vMax  / k,
          incidentCount: k,
          vmtMin: vMin, vmtBest: vBest, vmtMax: vMax, // the VMT band behind this posterior
          bands: post.bands.map(b => ({...b})),
        }];
      }));
      helmers[helmer] = entry;
    }
    points.push({month, helmers});
  }
  return {months, points};
}

function sliceSeries(series, startIdx, endIdx) {
  const months = series.months.slice(startIdx, endIdx + 1);
  const points = series.points.slice(startIdx, endIdx + 1).map(point => {
    const helmers = {};
    for (const helmer of ALL_HELMERS) {
      const orig = point.helmers[helmer];
      if (orig === null) { helmers[helmer] = null; continue; }
      helmers[helmer] = {...orig, incidents: {...orig.incidents, speeds: {...orig.incidents.speeds}},
        mpiByMetric: {...orig.mpiByMetric}};
    }
    return {month: point.month, helmers};
  });
  // vmtCume and the kyoom band stay all-time (not reset to the window start):
  // "cumulative VMT" means total miles, and the authored cumulative anchors
  // (e.g. Tesla Q1) are all-time, so the cumulative view shows them faithfully.
  return {months, points};
}

// Left margin of a chart whose y axis carries tick labels beside its rotated
// title: the title's band, the widest label, and the gap to the axis line. A
// literal margin fits the label column only by coincidence (the 2026-09-07
// face change widened "136.9K" into the title). Labels are digits in tabular
// figures (style.css .month-svg), so a per-glyph bound stands in for
// measuring text the browser has not laid out yet (tickLabelWidth).
const Y_TITLE_BAND = 24; // the title's baseline is x=18; its descenders reach ~21
const TICK_GLYPH = 8;
const TICK_GAP = 8;
// A tick label's width bound, in chart units: TICK_GLYPH per character, plus
// half a glyph per unit letter (K, M, B, T), which is wider than a digit. At
// 13px a tabular digit is ~7.8 units, "." ~3.6, K ~9.9, M ~12.1. Until
// 2026-10-03 every K/M label carried a "." that paid for its letter; whole
// values now drop their ".0" ("159M", audit #58), whose 35.6 units the plain
// glyph count put at 32, and their y labels reached into the title.
function tickLabelWidth(label) {
  return TICK_GLYPH * (label.length + 0.5 * label.replace(/[^KMBT]/g, "").length);
}
function axisLeftMargin(tickLabels) {
  assert(tickLabels.length > 0, "axisLeftMargin: no tick labels", {tickLabels});
  return Y_TITLE_BAND + Math.max(...tickLabels.map(tickLabelWidth)) + TICK_GAP;
}

// The 1-2-5 gridlines of a log x axis, and the labels that fit beneath them.
// The lines never collide; their labels do, since the 2026-09-07 face change
// widened "1,000,000" from 46 units to 64. So a label goes on every
// labelStep-th rung of the ladder, counting from the decades -- the stride
// idiom drawSingleMonthAxes uses for month labels, sized by the per-glyph
// bound axisLeftMargin uses for the label column. labelStep is the fewest
// rungs that span the widest label plus its gap, rounded up to whole decades
// because only a stride of one rung or of whole decades puts every label on
// the same mantissa: a stride of two rungs would read 200, 1,000, 5,000,
// 20,000, dropping the decade anchor from every other decade.
const LOG_LADDER = [1, 2, 5]; // one decade of gridlines; a "rung" is one of these
// The 1-2-5 rungs in [xMin, xMax]. n counts rungs from 10^0 upward, so
// n % LOG_LADDER.length === 0 is a decade and a stride anchored on it keeps
// every decade labelled.
function logLadderRungs(xMin, xMax) {
  assert(0 < xMin && xMin < xMax, "logLadderRungs: degenerate x range", {xMin, xMax});
  const rungs = [];
  for (let e = Math.floor(Math.log10(xMin)); e <= Math.ceil(Math.log10(xMax)); e++) {
    for (const [j, m] of LOG_LADDER.entries()) {
      const v = m * Math.pow(10, e);
      if (v >= xMin && v <= xMax) rungs.push({v, n: LOG_LADDER.length * e + j});
    }
  }
  return rungs;
}
// The first and last rung of the coarsest ladder with two rungs in
// [xMin, xMax]: values of one significant digit (1-9 per decade), then two,
// and so on. When the 1-2-5 ladder leaves an axis fewer than two labels, the
// axis labels these instead: a frame can hold one 1-2-5 rung or none
// (84M-91M, Humans (US average) alone on fatality, holds none), and such
// axes had no readable scale (audit #27: 92 of 770 chart states had fewer
// than two labels, 21 none).
function logTickExtremes(xMin, xMax) {
  for (let digits = 1; digits <= 15; digits++) {
    const step = x => Math.pow(10, Math.floor(Math.log10(x)) - digits + 1);
    const first = Math.ceil(xMin / step(xMin)) * step(xMin);
    const last = Math.floor(xMax / step(xMax)) * step(xMax);
    if (first < last) return [first, last];
  }
  return fail("logTickExtremes: frame narrower than 15 significant digits", {xMin, xMax});
}
function drawLogXTicks(xMin, xMax, mapX, fmt, yTop, yBase, yText) {
  const rungs = logLadderRungs(xMin, xMax);
  // 1->2 and 5->10 are the ladder's tightest rungs and mapX is linear in log x,
  // so one probe gives the pitch however many rungs there are.
  const pitch = mapX(2 * xMin) - mapX(xMin);
  assert(pitch > 0, "drawLogXTicks: mapX must grow with x", {pitch});
  const widest = rungs.reduce((w, r) => Math.max(w, tickLabelWidth(fmt(r.v))), 0) + TICK_GAP;
  const needed = Math.ceil(widest / pitch);
  const labelStep = needed <= 1 ? 1 : LOG_LADDER.length * Math.ceil(needed / LOG_LADDER.length);
  const strided = rungs.filter(r => r.n % labelStep === 0).map(r => r.v);
  // Fewer than two labels give no scale: label the frame's outermost rungs of
  // a finer ladder instead (each with its own gridline).
  const labelled = new Set(strided.length >= 2 ? strided : logTickExtremes(xMin, xMax));
  const lines = [...new Set([...rungs.map(r => r.v), ...labelled])].sort((a, b) => a - b);
  return lines.map(v => `
    <line x1="${mapX(v).toFixed(2)}" y1="${yTop}" x2="${mapX(v).toFixed(2)}" y2="${yBase}"
      class="month-grid"></line>
    ${labelled.has(v) ? `<text class="month-tick" x="${mapX(v).toFixed(2)}" y="${yText}" text-anchor="middle">${fmt(v)}</text>` : ""}
  `).join("");
}

// Right margin of a chart with a log x axis: the least that keeps every
// label the axis could draw (every rung, and logTickExtremes), centred on
// its rung, TICK_GAP inside the SVG's right edge -- the clearance labels keep
// from each other, which also covers faces wider than the glyph model
// (Firefox at phone size draws "200.0M" 61 units wide, 6.4 past the model on
// each side). A literal 16 fitted the distribution chart's "200.0M" only when
// no rung fell within half a label of the frame's edge; 104 of 770 states
// clipped one (audit #50). A rung at fraction g of the frame sits at
// mLeft + g (svgW - mLeft - mRight), so a label needing room h right of its
// rung fits iff mRight >= (h - (svgW - mLeft)(1 - g)) / g. The floor, 16, is
// the margin every chart had; most states keep it.
const AXIS_MIN_RIGHT = 16;
function axisRightMargin(xMin, xMax, fmt, mLeft, svgW) {
  const span = Math.log(xMax / xMin), room = svgW - mLeft;
  const candidates = [...logLadderRungs(xMin, xMax).map(r => r.v), ...logTickExtremes(xMin, xMax)];
  return Math.max(AXIS_MIN_RIGHT, ...candidates.map(v => {
    const g = Math.log(v / xMin) / span;
    const h = tickLabelWidth(fmt(v)) / 2 + TICK_GAP;
    return Math.ceil((h - room * (1 - g)) / g);
  }));
}

function drawSingleMonthAxes(
  months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, yFmt, yLabel,
) {
  const axisY = mTop + pH;
  // Label stride from the same per-glyph model as the log axes: a "YYYY-MM"
  // label is 7 glyphs wide and neighbours keep TICK_GAP clear. (A 1/2/3
  // ladder capped the stride at 3, so windows of 37+ months overlapped;
  // 2026-09-26.) A one-month series has pitch 0, so the stride is Infinity
  // and only the always-drawn last label appears. The stride counts back
  // from the last month, so every gap is one stride; counted from the first
  // month (until 2026-10-04), the labels within a stride of the last were
  // dropped and the final gap ran up to twice the others (a phone's VMT
  // charts read 2025-06, 2025-11, 2026-08; audit #37).
  const pitch = (mapX(months.length - 1) - mapX(0)) / Math.max(1, months.length - 1);
  const labelStep = Math.max(1, Math.ceil((TICK_GLYPH * 7 + TICK_GAP) / pitch));
  // Ticks, axes and the axis title are hidden from assistive technology: the
  // chart's own name says what it shows, and its marks carry the values.
  return `<g aria-hidden="true">
    ${months.map((month, i) => `
      ${(months.length - 1 - i) % labelStep === 0 ? `<text class="month-tick" x="${mapX(i)}" y="${svgH - 16}" text-anchor="middle">${month}</text>` : ""}
    `).join("")}
    ${yTicks.map(y => `
      <text class="month-tick" x="${mLeft - TICK_GAP}" y="${mapY(y) + 4}" text-anchor="end">${yFmt(y)}</text>
    `).join("")}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${axisY}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${axisY}" x2="${mLeft + pW}" y2="${axisY}"></line>
    <text class="month-label" x="18" y="${mTop + pH / 2}" transform="rotate(-90 18 ${mTop + pH / 2})" text-anchor="middle">${yLabel}</text>
  </g>`;
}

// Legend chips for the selected helmers. Helmers in <emptyHelmers> have no data
// in the current window; per the Anti-Magic Principle they stay visible but
// grayed out rather than being dropped from the legend.
function helmerChipLegend(helmers, emptyHelmers = new Set()) {
  return `
    <div class="month-legend">
      ${helmers.map(helmer => `
      <span class="month-legend-item${emptyHelmers.has(helmer) ? " month-legend-item-empty" : ""}">
        <span class="month-chip" style="background:${HELMER_COLORS[helmer]}"></span>${helmerLabel(helmer)}
      </span>`).join("")}
    </div>`;
}

// Chart width, in viewBox units: as many units as the charts' column has CSS
// pixels, up to CHART_MAX_W, so a chart unit is about a CSS pixel at every
// width and the charts' text and marks keep their declared sizes on a phone.
// Every chart laid out a 900-unit viewBox until 2026-10-03, and a phone drew
// it at 0.41-0.42 of that, putting 14-unit ticks at 5.7-5.9 CSS px and
// 12-unit axis titles at 4.9-5.0 (audit #28). Every layout length (margins,
// label strides, hit radii) is in these units, so a narrow viewBox only
// draws fewer labels. Init measures the column and re-measures on resize
// (outside the module the quals load, which keeps CHART_MAX_W).
const CHART_MAX_W = 900;
// The narrowest viewBox every chart lays out in: a narrower column draws the
// charts this wide, scaled down to fit. (A sweep of 1,800 chart states laid
// out from 125 units up; at 98-120 the forecast chart's log axis had no
// width, and a 130 CSS px window, a 98 px column, threw at init until
// 2026-10-04; audit #32.)
const CHART_MIN_W = 240;
let chartViewW = CHART_MAX_W;
// The charts' column, in CSS px, kept within [CHART_MIN_W, CHART_MAX_W]:
// #month-panel is a plain block in the body's content box, laid out even
// when its sections are collapsed. A page narrower than CHART_MIN_W may have
// no column at all (a hidden or zero-width iframe has a 0-wide viewport, and
// a 20 px one only the body's padding); its charts draw at CHART_MIN_W, and
// the resize that gives it width redraws them. Until 2026-10-04 init threw
// here and left such a page blank (audit #32). A column with no width in a
// viewport at least CHART_MIN_W wide is a layout bug.
function chartColumnWidth() {
  const w = byId("month-panel").clientWidth;
  const viewport = document.documentElement.clientWidth;
  assert(w > 0 || viewport < CHART_MIN_W, "the charts' column has no width", {w, viewport});
  return Math.min(CHART_MAX_W, Math.max(CHART_MIN_W, Math.round(w)));
}

// The accessible name of a mark on a chart several companies share (the MPI
// and distribution charts): its company's label, " · " and its tip, as the
// growth chart's tips read ("Tesla · 2025-06 ..."). The tip a sighted reader
// sees leaves the company out, the dot's colour and the legend saying it
// (2026-06-19); a screen reader has neither, and until 2026-10-04 heard 15
// identical names for the Humans (AV cities) marks (audit #15).
function seriesMarkName(helmer, tip) {
  return `${helmerLabel(helmer)} · ${tip}`;
}

// Every chart's tooltip targets: one invisible circle per mark, drawn after
// all of the chart's glyphs, so a glyph never covers a target. Its radius is
// half the distance to the nearest other target more than HIT_R_MIN away, at
// least HIT_R_MIN and at most HIT_R_MAX: a 24 CSS px target where there is
// room (a chart unit is about a CSS px; chartViewW), and never so large that
// it takes over a neighbour's centre. Until 2026-10-03 the MPI chart's fixed
// r=8 circles took the tooltip of dots 6.4 units away that they did not
// touch (audit #63), and the VMT, distribution and growth charts' marks were
// their own 3.3-5 unit targets, 1.4-2.1 CSS px across on a phone (audit
// #28). Only marks drawn within HIT_R_MIN of each other, which no radius can
// separate, share a centre (the later target wins there), so they do not
// shrink each other's targets: counted, they held the default view's six
// distribution markers on a phone (each Peak beside its Median) to 8 CSS px
// targets with no other mark near. Targets are given in Tab order; their
// centres are rounded before the radii are taken, so the radii follow from
// the drawn positions. Each target carries its accessible name (`name`): its
// tip, or on a chart several companies share its company's label, " · " and
// its tip (seriesMarkName).
const HIT_R_MIN = 4;
const HIT_R_MAX = 12;
function hitCircles(targets) {
  for (const t of targets) assert(typeof t.name === "string" && t.name.endsWith(t.tip), "a chart target's name must end with its tip", {name: t.name, tip: t.tip});
  const at = targets.map(t => ({x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), tip: t.tip, name: t.name}));
  // Each target's nearest neighbour more than HIT_R_MIN away, every pair
  // measured once.
  const near = at.map(() => Infinity);
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      const d = Math.hypot(at[j].x - at[i].x, at[j].y - at[i].y);
      if (d <= HIT_R_MIN) continue;
      near[i] = Math.min(near[i], d);
      near[j] = Math.min(near[j], d);
    }
  }
  return at.map((t, i) => {
    const r = Math.max(HIT_R_MIN, Math.min(HIT_R_MAX, near[i] / 2));
    return `<circle cx="${t.x}" cy="${t.y}" r="${r.toFixed(2)}" fill="none" data-tip="${escAttr(t.tip)}"${tipTargetAttrs(t.name)}></circle>`;
  }).join("");
}

function renderAllHelmersMpiChart(series) {
  const metric = selectedMonthMetric();
  const svgW = chartViewW;
  const svgH = 520;
  const mRight = 16;
  const mTop = 14;
  const mBot = 40;
  const pH = svgH - mTop - mBot;
  // hollow = k=0 month (prior-only median, no event data), matching the
  // distribution chart's hollow k=0 dots.
  const renderDot = (x, y, color, s, hollow) => {
    const r = 3.1 * s;
    return `<circle class="month-dot" cx="${x}" cy="${y}" r="${r}" style="fill:${hollow ? "none" : color};stroke:${color}"></circle>`;
  };

  const seriesRows = [];
  let yMax = 0; // stays 0 with no data, and the y axis is then labelled "0" alone (linearTicks)
  for (const helmer of includedHelmers()) {
    const rows = helmerMonthRows(series, helmer);
    const vals = rows.map(row => {
      if (row === null) return null;
      const mpi = row.mpiByMetric[metric.key];
      if (!mpi) return null;
      // covRatio: worst-case Monthly-track incident coverage for metrics
      // without a five-day guarantee (incident_coverage_min; 1 = fully
      // reported, <1 = NHTSA monthly reports still pending) and 1 for the
      // five-day-track metrics, whose denominator is the receipt-scaled raw
      // triple — the same metric-data selection mpiByMetric makes. Drives dot
      // opacity so incomplete months are visually demoted without a separate
      // code path. covBest is the best estimate (incident_coverage: pooled in
      // the data-through month, the helmer's 5-Day share in its Monthly-lag
      // months), shown in the tooltip to match the sanity table's "best"
      // column. Read
      // from the coverage columns directly: until 2026-09-26 it was the ratio
      // of two differently composed VMT edges, (receipt best / receipt min) x
      // incCovMin, i.e. 24% where the sanity table said 17.3%.
      const covRatio = metric.fiveDay === true ? 1 : row.incCovMin;
      const covBest = metric.fiveDay === true ? 1 : row.incCov;
      // Y-range: every point's median dot is on-scale; fully-reported k≥1 months
      // also contribute their finite VMT spread (mpiMax = ∞ at k=0, so excluded).
      yMax = Math.max(yMax, covRatio > 0.99 && Number.isFinite(mpi.mpiMax)
                           ? mpi.mpiMax : mpi.mpiMedian);
      return {...mpi, covRatio, covBest};
    });
    seriesRows.push({helmer, metric, vals});
  }

  // Subset metrics must have higher MPI (rarer events = more miles between).
  for (const cohort of HUMAN_HELMERS) {
    const humanMpi = helmerMonthRows(series, cohort)[0];
    if (!humanMpi) continue;
    const subsetChains = [
      ["all", "nonstationary", "roadwayNonstationary"],
      ["all", "atfault", "atfaultInjury"],
      ["all", "injury", "atfaultInjury"],
      ["injury", "hospitalization", "fatality"],
    ];
    for (const chain of subsetChains) {
      for (let i = 1; i < chain.length; i++) {
        const a = humanMpi.mpiByMetric[chain[i-1]];
        const b = humanMpi.mpiByMetric[chain[i]];
        if (!a || !b) continue;
        assert(a.mpiBest <= b.mpiBest,
          "human MPI ordering violated", {
            cohort,
            lesser: chain[i-1], lesserMpi: a.mpiBest,
            greater: chain[i], greaterMpi: b.mpiBest,
          });
      }
    }
  }

  const yTicks = linearTicks(0, yMax, 4);
  const mLeft = axisLeftMargin(yTicks.map(fmtMiles));
  const pW = svgW - mLeft - mRight;
  const xPad = 28;
  const mapX = monthColumnX(series.months.length, mLeft + xPad, mLeft + pW - xPad);
  // The axis tops out at its last tick (linearTicks), at or above yMax.
  const mapY = y => scaleLinear(y, 0, yTicks[yTicks.length - 1], mTop + pH, mTop);
  const clampY = v => Math.max(mTop, Math.min(mTop + pH, mapY(v)));

  const lines = seriesRows.map(row => {
    let d = "";
    let penDown = false;
    for (let i = 0; i < row.vals.length; i++) {
      const mpi = row.vals[i];
      // Break at no-VMT months AND k=0 months: a prior-only median isn't part of the
      // data trend (it still shows as a hollow dot), so no line is drawn through it.
      if (mpi === null || mpi.incidentCount === 0) { penDown = false; continue; }
      d += `${penDown ? " L " : "M "}${mapX(i).toFixed(2)} ${clampY(mpi.mpiMedian).toFixed(2)}`;
      penDown = true;
    }
    return `<path class="month-mpi-all-line" d="${d}" style="${metricLineStyle(row.helmer)}${derivedBandDash(row.metric, row.helmer)}"></path>`;
  }).join("");

  // Error bars: the 95% credible interval (same quantity as the widest fan
  // level and the tooltip's "Range" line), clamped to the plot like every
  // other layer. Capless: a cap at a clamped endpoint would assert a CI
  // boundary that isn't there. Bar opacity matches the dot's coverage fade.
  const errs = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi === null) return "";
      const x = mapX(i);
      const ci95 = mpi.bands[mpi.bands.length - 1];
      const barOpacity = (0.35 + 0.65 * mpi.covRatio).toFixed(3);
      return `
        <line class="month-err" x1="${x.toFixed(2)}" y1="${clampY(ci95.lo).toFixed(2)}" x2="${x.toFixed(2)}" y2="${clampY(ci95.hi).toFixed(2)}" style="${metricErrStyle(row.helmer)};opacity:${barOpacity}"></line>
      `;
    }).join("")
  ).join("");

  // Each month's dot, then (hitCircles) every dot's tooltip target over all
  // of them.
  const glyphs = [], targets = [];
  for (const row of seriesRows) {
    row.vals.forEach((mpi, i) => {
      if (mpi === null) return;
      const x = mapX(i);
      const color = metricMarkerColor(row.helmer);
      const k = mpi.incidentCount;
      const ci95 = mpi.bands[mpi.bands.length - 1];
      const kLine = k !== null ? ` (${splur(k, "incident")})` : "";
      const ciLabel = k !== null ? "95% CI" : "Range";
      const incompleteNote = mpi.covRatio < 0.999
        ? `\n~${(mpi.covBest * 100).toFixed(0)}% incident coverage (worst case ~${(mpi.covRatio * 100).toFixed(0)}%)`
        : "";
      const tip = `${series.months[i]}\nMPI: ${fmtMiles(mpi.mpiMedian)}${kLine}\n${ciLabel}: ${fmtMiles(ci95.lo)} – ${fmtMiles(ci95.hi)}${incompleteNote}`;
      // Dot at the posterior median (finite even at k=0); hollow for k=0 months
      // (prior-only, no event data) like the distribution chart.
      const yc = clampY(mpi.mpiMedian);
      const dotOpacity = (0.35 + 0.65 * mpi.covRatio).toFixed(3);
      glyphs.push(`<g opacity="${dotOpacity}">${renderDot(x, yc, color, 1, k === 0)}</g>`);
      targets.push({x, y: yc, tip, name: seriesMarkName(row.helmer, tip)});
    });
  }
  const marks = glyphs.join("") + hitCircles(targets);

  // One "?" per month at the top of its column, fading in as that month's
  // reporting completeness falls (opacity 0 when complete: grayed out, not
  // suppressed): the largest incompleteness among the shown helmers' dots
  // that month. The receipt and pooled Monthly-track factors are the same
  // for every helmer (a helmer's Monthly-lag months add its own), so until
  // 2026-09-26, when a "?" sat beside every helmer's dot, helmers whose dots
  // were close overprinted each other's glyph. A run of adjacent incomplete
  // months shares one "?", centred on the run at its largest incompleteness:
  // on a phone a month is ~4 units wide and the glyph ~7, so with Zoox shown
  // its lagged 2026-07 and the data-through 2026-08 read "??" until
  // 2026-10-04 (audit #36).
  const incomplete = series.months.map((_month, i) =>
    Math.max(0, ...seriesRows.map(r => r.vals[i]).filter(v => v !== null).map(v => 1 - v.covRatio)));
  const qmarkRuns = [];
  incomplete.forEach((share, i) => {
    if (share > 0 && i > 0 && incomplete[i - 1] > 0) qmarkRuns[qmarkRuns.length - 1].push(i);
    else qmarkRuns.push([i]);
  });
  const qmarks = qmarkRuns.map(run => {
    const x = (mapX(run[0]) + mapX(run[run.length - 1])) / 2;
    const opacity = Math.max(...run.map(i => incomplete[i]));
    return `<text class="month-tick" x="${x.toFixed(2)}" y="${(mTop + 12).toFixed(2)}" text-anchor="middle" style="opacity:${opacity.toFixed(3)};pointer-events:none">?</text>`;
  }).join("");

  // Fan chart: nested CI bands at 50%, 80%, 95% with decreasing opacity.
  // Bands are always continuous — even months with k=0 have a valid posterior
  // (Gamma(0.5, m)), just with very high MPI and wide uncertainty.
  // Clamp to plot range so SVG coordinates stay reasonable.
  const bands = seriesRows.map(row => {
    const color = metricMarkerColor(row.helmer);
    // Draw widest band first (95%), then 80%, then 50% on top
    return CI_FAN_LEVELS.slice().reverse().map((_level, li) => {
      const bandIdx = CI_FAN_LEVELS.length - 1 - li; // index into bands array
      const bandOpacity = (0.10 * (1 + li * 0.5)).toFixed(3);
      // Split into contiguous segments (skip null vals)
      const segments = [];
      let seg = [];
      for (let i = 0; i < row.vals.length; i++) {
        if (row.vals[i] !== null) { seg.push(i); }
        else { if (seg.length > 0) { segments.push(seg); seg = []; } }
      }
      if (seg.length > 0) segments.push(seg);
      return segments.map(indices => {
        let d = "";
        for (const i of indices) {
          d += `${d ? " L " : "M "}${mapX(i).toFixed(2)} ${clampY(row.vals[i].bands[bandIdx].hi).toFixed(2)}`;
        }
        for (let j = indices.length - 1; j >= 0; j--) {
          d += ` L ${mapX(indices[j]).toFixed(2)} ${clampY(row.vals[indices[j]].bands[bandIdx].lo).toFixed(2)}`;
        }
        d += " Z";
        return `<path d="${d}" style="fill:${color};opacity:${bandOpacity}"></path>`;
      }).join("");
    }).join("");
  }).join("");

  // Title lives in the collapsible section header (#mpi-heading), set by
  // renderWindowedViews, so it stays visible when the section is collapsed.
  return `
    ${helmerChipLegend(
      seriesRows.map(row => row.helmer),
      new Set(seriesRows.filter(row => !row.vals.some(v => v !== null)).map(row => row.helmer)),
    )}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}" role="figure" aria-labelledby="mpi-heading">
      ${drawSingleMonthAxes(
        series.months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, fmtMiles, "Miles Per Incident (MPI)",
      )}
      ${bands}
      ${lines}
      ${errs}
      ${marks}
      <g aria-hidden="true">${qmarks}</g>
    </svg>
  `;
}

// Draw each density curve only while it clears this fraction of the TALLEST curve's
// peak — a visibility floor. It's robust to heavy tails (a short,
// uncertain curve can't lower the tallest peak, so its thin tail gets cut where it's
// a sliver relative to the confident curves) where quantile/CI-based extents blow out
// to billions for the k<0.5 (alpha<1) at-fault posteriors.
const DIST_VIS_FLOOR = 0.05;
// X-range for the distribution chart: the window where some curve's density clears
// DIST_VIS_FLOOR of the tallest peak. Coarse probe over the curves' own density
// extents finds the tallest peak, then the visible band.
function distributionExtent(curves) {
  let pMin = Infinity, pMax = 0;
  for (const c of curves) { pMin = Math.min(pMin, c.xMin); pMax = Math.max(pMax, c.xMax); }
  if (!Number.isFinite(pMin)) return {xMin: 1e4, xMax: 1e8}; // no curves: default span
  const probe = 160, lo = Math.log(pMin), hi = Math.log(pMax);
  const at = i => Math.exp(lo + (hi - lo) * i / (probe - 1));
  let yMax = 0;
  const cols = curves.map(c => {
    const col = new Float64Array(probe);
    for (let i = 0; i < probe; i++) { col[i] = c.densityFn(at(i)); if (col[i] > yMax) yMax = col[i]; }
    return col;
  });
  const floor = DIST_VIS_FLOOR * yMax;
  let xMin = Infinity, xMax = 0;
  for (const col of cols) for (let i = 0; i < probe; i++) if (col[i] >= floor) {
    const x = at(i); if (x < xMin) xMin = x; if (x > xMax) xMax = x;
  }
  const band = xMin < xMax ? {xMin, xMax} : {xMin: pMin, xMax: pMax};
  // Every curve's two markers must be on-frame: a flat prior-only (k=0)
  // curve can sit entirely under the visibility floor when a confident band
  // sets a tall peak (fatality, since the 2026-08-28 IIHS re-vintage), so the
  // band is widened to cover each curve's posterior median AND its density
  // peak (the argmax over the probe columns). Until 2026-09-04 only the
  // medians were covered, so a k=0 curve's true peak (~2 x VMT) sat off-frame
  // on the fatality view and the "Peak" marker degenerated to the frame edge
  // (= the median). renderDistributionChart then refines the peak within the
  // frame, so covering the probe-grid argmax keeps the refined peak inside.
  const medians = curves.map(c => c.postMedian);
  // The probe grid is coarse (~7% steps for a k=0 curve), so cover the probe
  // NEIGHBOURS of each argmax: a unimodal curve's true mode lies between them.
  const peakLo = [], peakHi = [];
  for (const col of cols) {
    let best = 0;
    for (let i = 1; i < probe; i++) if (col[i] > col[best]) best = i;
    peakLo.push(at(Math.max(best - 1, 0)));
    peakHi.push(at(Math.min(best + 1, probe - 1)));
  }
  // Medians get the same one-probe margin as the peaks: covered with
  // equality, the curve with the largest median put its Median dot on the
  // frame's right edge, where the clip-path halved it (2026-09-26).
  const step = Math.exp((hi - lo) / (probe - 1));
  return {xMin: Math.min(band.xMin, ...medians.map(m => m / step), ...peakLo),
          xMax: Math.max(band.xMax, ...medians.map(m => m * step), ...peakHi)};
}

function renderDistributionChart(series) {
  const metric = selectedMonthMetric();
  const {start, end} = seriesMonthBounds(series);
  const summaryRows = windowSummaryRows(series);
  const curves = [];
  for (const row of summaryRows) {
    if (!monthHelmerEnabled[row.helmer]) continue;
    const est = row.mpiEstimates[metric.key];
    if (!est) continue;
    curves.push({
      helmer: row.helmer, metric, est,
      densityFn: est.densityFn,
      xMin: est.xMin, xMax: est.xMax,
      postMedian: est.postMedian,
    });
  }
  // X-axis range = the visible band (see distributionExtent): where some curve clears
  // DIST_VIS_FLOOR of the tallest peak. Frames where the curves are visibly present instead of
  // letting one heavy-tailed posterior stretch the axis to billions. With no curves it
  // falls back to a default span so the axes still draw (Anti-Magic Principle).
  const {xMin, xMax} = distributionExtent(curves);
  assert(xMin < xMax, "distribution chart: degenerate x range", {xMin, xMax});

  const svgW = chartViewW, svgH = 280;
  const mLeft = 68, mTop = 14, mBot = 40;
  const mRight = axisRightMargin(xMin, xMax, fmtMiles, mLeft, svgW);
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const baseline = mTop + pH;
  const logMin = Math.log(xMin);
  const logMax = Math.log(xMax);
  const mapX = x => mLeft + (Math.log(x) - logMin) / (logMax - logMin) * pW;

  // Each curve is drawn through the frame's log-uniform grid merged with a
  // dense grid of its own across its extent (clipped to the frame): on the
  // shared grid alone, a band as narrow as Humans (US average) on fatality
  // (sigma 0.020 in ln x) got 3-9 samples whenever ADS curves widened the
  // frame, and drew as a jagged spike (audit #26). The peak is the curve's
  // own maximum to the figures its tooltip prints: a golden-section search of
  // the curve's density between the grid neighbours of its largest sample (a
  // unimodal curve's maximum lies between them), run until both ends of the
  // bracket print alike. Until 2026-10-04 it was one parabola step through
  // the samples around the largest, off by up to 1.6e-3 (Tesla's at-fault
  // Peak read 323.0K for a maximum at 322,924) and dependent on the frame,
  // i.e. on which helmers were checked (Zoox 935.0K with four, 935.1K with
  // six; audit #50). The search finds a log-normal's mode, its median, as the
  // ln(density) parabola before it did (a parabola on the density itself read
  // a human band's Peak 87.5M against its Median 87.4M; audit #89).
  const GOLDEN = (Math.sqrt(5) - 1) / 2;
  const frameGrid = logUniformGrid(logMin, logMax, DIST_FRAME_POINTS);
  let yMax = 0;
  for (const c of curves) {
    const ownLo = Math.max(logMin, Math.log(c.xMin)), ownHi = Math.min(logMax, Math.log(c.xMax));
    const own = logUniformGrid(ownLo, ownHi, DIST_CURVE_POINTS);
    const ownYs = own.map(u => c.densityFn(Math.exp(u)));
    const i = ownYs.reduce((best, y, j) => y > ownYs[best] ? j : best, 0);
    const at = u => c.densityFn(Math.exp(u));
    let a = own[Math.max(i - 1, 0)], b = own[Math.min(i + 1, own.length - 1)];
    let u1 = b - GOLDEN * (b - a), u2 = a + GOLDEN * (b - a), f1 = at(u1), f2 = at(u2);
    // (A bracket narrower than 1e-12 in ln x whose ends still print apart
    // holds a peak on a rounding boundary; either print is then right.)
    for (let step = 0; fmtMiles(Math.exp(a)) !== fmtMiles(Math.exp(b)) && b - a > 1e-12; step++) {
      assert(step < 200, "distribution chart: the peak search did not converge", {helmer: c.helmer, a, b});
      if (f1 > f2) { b = u2; u2 = u1; f2 = f1; u1 = b - GOLDEN * (b - a); f1 = at(u1); }
      else { a = u1; u1 = u2; f1 = f2; u2 = a + GOLDEN * (b - a); f2 = at(u2); }
    }
    c.peakX = Math.exp((a + b) / 2);
    assert(Number.isFinite(c.peakX), "distribution chart: peak search failed", {helmer: c.helmer, i, a, b});
    c.points = [...frameGrid.map(u => [u, c.densityFn(Math.exp(u))]), ...own.map((u, j) => [u, ownYs[j]])]
      .sort((p, q) => p[0] - q[0]);
    // The y scale covers every drawn sample and both markers (the refined
    // peak's density tops the grid's samples).
    yMax = Math.max(yMax, ...c.points.map(p => p[1]), c.densityFn(c.peakX), c.densityFn(c.postMedian));
  }
  yMax = yMax || 1; // no curves to scale against: default so the axes still draw
  // DENSITY_HEADROOM above the tallest curve, so its markers draw whole (the
  // scale topped out at the tallest sample, which put the Peak marker of the
  // tallest curve half above the plot in every state; audit #25).
  const mapY = y => mTop + pH * (1 - y / (yMax * DENSITY_HEADROOM));

  const axes = `<g aria-hidden="true">
    ${drawLogXTicks(xMin, xMax, mapX, fmtMiles, mTop, baseline, svgH - 16)}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${baseline}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${baseline}" x2="${mLeft + pW}" y2="${baseline}"></line>
    <text class="month-label" x="18" y="${mTop + pH / 2}" transform="rotate(-90 18 ${mTop + pH / 2})" text-anchor="middle">Probability Density for True MPI</text>
  </g>`;

  // Curve fills (low opacity) and strokes — unified for all helmers
  const fills = curves.map(c => {
    const color = HELMER_COLORS[c.helmer];
    let d = `M ${mapX(Math.exp(c.points[0][0])).toFixed(2)} ${baseline.toFixed(2)}`;
    for (const [u, y] of c.points) {
      d += ` L ${mapX(Math.exp(u)).toFixed(2)} ${mapY(y).toFixed(2)}`;
    }
    d += ` L ${mapX(Math.exp(c.points[c.points.length - 1][0])).toFixed(2)} ${baseline.toFixed(2)} Z`;
    // k=0 curves carry no event data — they're just the Jeffreys prior shaped by VMT,
    // so two similar-mileage helmers coincide. Fade + dash them so they don't read as
    // a real overlap claim.
    return `<path d="${d}" style="fill:${color};opacity:${c.est.k === 0 ? 0.04 : 0.120}"></path>`;
  }).join("");

  const strokes = curves.map(c => {
    const d = c.points.map(([u, y], j) => `${j === 0 ? "M " : " L "}${mapX(Math.exp(u)).toFixed(2)} ${mapY(y).toFixed(2)}`).join("");
    // prior-only (k=0, no event data) and modeled-proxy human bands both dash
    const dash = c.est.k === 0 ? ";stroke-dasharray:6 4" : derivedBandDash(c.metric, c.helmer);
    return `<path d="${d}" style="${metricLineStyle(c.helmer)};fill:none${dash}"></path>`;
  }).join("");

  // Two markers per curve: the visual peak ("most likely") and the posterior median.
  // They coincide for well-determined curves and separate for skewed near-zero-data
  // ones (the gap = the skew). Tooltip says which point it is plus the other central
  // values (MLE is ∞ at k=0; the mean is the drawn curve's own, marginalMpiMean,
  // ∞ whenever a K=0 component carries weight — fractional fault mass or k=0 —
  // the very curves where they'd matter). No helmer name — the dot colour +
  // legend identify the curve. The markers draw after the clip-path group,
  // not inside it, so the frame never cuts one (a k=0 curve's markers sit on
  // the baseline); distributionExtent puts every peak and median inside the
  // frame, and that is asserted here.
  const infOr = v => Number.isFinite(v) ? fmtMiles(v) : "∞";
  // The markers, then (hitCircles) their tooltip targets over all of them.
  const glyphs = [], targets = [];
  for (const c of curves) {
    const color = HELMER_COLORS[c.helmer];
    const kLine = c.est.k !== null ? ` (${splur(c.est.k, "incident")})` : "";
    const ciLine = `${c.est.k !== null ? "95% CI" : "Range"}: ${fmtMiles(c.est.lo)} – ${fmtMiles(c.est.hi)}${kLine}`;
    const mle = c.est.k !== null ? c.est.median : NaN; // vmtBest/k, ∞ at k=0
    const mean = c.est.k !== null ? c.densityFn.mean : NaN;
    const tail = c.est.k !== null ? ` · mean ${infOr(mean)} · MLE ${infOr(mle)}` : "";
    const dots = [
      ["Peak", c.peakX, `median ${fmtMiles(c.est.postMedian)}`],
      ["Median", c.est.postMedian, `peak ${fmtMiles(c.peakX)}`],
    ];
    const dotStyle = c.est.k === 0 ? `fill:none;stroke:${color}` : `fill:${color}`; // k=0: hollow (prior only)
    for (const [label, mx, other] of dots) {
      assert(mx >= xMin && mx <= xMax, "distribution marker outside the frame", {helmer: c.helmer, label, mx, xMin, xMax});
      const tip = `${label}: ${fmtMiles(mx)}${c.est.k !== null ? `\n${other}${tail}` : ""}\n${ciLine}`;
      const x = mapX(mx), y = mapY(c.densityFn(mx));
      glyphs.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" class="month-dot" style="${dotStyle}"></circle>`);
      targets.push({x, y, tip, name: seriesMarkName(c.helmer, tip)});
    }
  }
  const markers = glyphs.join("") + hitCircles(targets);

  // Title lives in the collapsible section header (#dist-heading), set by
  // renderWindowedViews, so it stays visible when the section is collapsed.
  return `
    ${helmerChipLegend(
      summaryRows.filter(r => monthHelmerEnabled[r.helmer]).map(r => r.helmer),
      new Set(summaryRows
        .filter(r => monthHelmerEnabled[r.helmer] && !curves.some(c => c.helmer === r.helmer))
        .map(r => r.helmer)),
    )}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}" role="figure" aria-labelledby="dist-heading">
      <defs><clipPath id="dist-clip"><rect x="${mLeft}" y="${mTop}" width="${pW}" height="${pH}"></rect></clipPath></defs>
      ${axes}
      <g clip-path="url(#dist-clip)">
      ${fills}
      ${strokes}
      </g>
      ${markers}
    </svg>
  `;
}

// Density charts (the MPI distribution chart, the Jan-2027 forecast) scale y
// to this multiple of the tallest drawn density, so the tallest curve peaks
// 1/21 of the plot's height (~11 units) below its top and the r=3.5
// markers on it (plus their 0.75 halo) stay inside the plot.
const DENSITY_HEADROOM = 1.05;
const DIST_FRAME_POINTS = 250; // the distribution chart's shared log grid
const DIST_CURVE_POINTS = 121; // each curve's own grid across its extent

// n points uniform on [lo, hi] (in ln x).
function logUniformGrid(lo, hi, n) {
  assert(lo < hi && n >= 2, "logUniformGrid: empty range", {lo, hi, n});
  return Array.from({length: n}, (_, i) => lo + (hi - lo) * i / (n - 1));
}

// --- Fleet-size forecast (Jan 1, 2027) ---------------------------------------
// [AI TEXT] A forward-looking forecast of how many vehicles each helmer will have
// in the service whose crashes this page counts (the operator modes whose
// miles are in each helmer's VMT denominator: data/slurp.py
// PUBLIC_SERVICE_OPERATOR_TYPES) on Jan 1,
// 2027. This is an EXTERNAL judgment forecast — NOT derived from the NHTSA incident
// or VMT pipelines. It is anchored to mid-2026 fleet counts and announced expansion
// plans and is the author's own predictive distribution.
//
// Each helmer's distribution is a mixture of log-normals on the vehicle count.
// Tesla is the multimodal one (it has no vehicle-supply constraint — there are
// already millions of FSD-capable HW4/AI4 cars on the road), so its three modes
// are three different futures, not one smooth ramp:
//   A — the slow robotaxi ramp continues (low hundreds);
//   B — Tesla scales the dedicated robotaxi service aggressively (Cybercab +
//       Model-Y robotaxis: a few thousand to tens of thousands);
//   C — Tesla turns on eyes-off (operator-none) FSD across the HW4 fleet, so a
//       large fraction of privately-owned HW4 Teslas count as ADS (hundreds of
//       thousands to a few million). NOTE: mode C is a BROADER "fleet" than the
//       NHTSA robotaxi-service scope Waymo/Zoox are counted under — it counts
//       ADS-operating personal cars, not just robotaxis. So A+B (scope "robotaxi")
//       and C (scope "hw4") are drawn as two SEPARATE Tesla curves, not one.
//
// Tesla weights were fit on 2026-06-30 to the prediction markets already on the
// page rather than picked by hand: C = 0.05 matches the Manifold "Millions of
// Teslas at level 3 in 2026" market (~4-5%); B = 0.24 was then set so the
// model's implied P(Tesla fleet > Waymo fleet) landed near the Manifold "Will
// Tesla have more autonomous vehicles providing ridehailing than Waymo on Jan
// 2nd 2027" market, then ~23%. The weights are deliberately NOT re-fit on every
// refresh: that market traded at ~6% (0.0636) in the 2026-10-04 snapshot while
// the model still implies ~22% (0.219), so B no longer matches it (this
// parenthetical said "~10%" until 2026-10-04; audit #56); A = 0.71 is the
// remainder. That fit counts ALL of C's mass toward the
// market even though the market asks about vehicles "providing ridehailing" and
// C's personal HW4 cars are not robotaxis (see the scope note above) — the
// assumption is that any world where Tesla flips eyes-off across millions of HW4s
// is also a world where its ridehailing fleet alone exceeds Waymo's ~6k vehicles,
// so C implies the market resolves YES. If you instead treat C as silent on the
// market, B would need to be ~0.32 (and A ~0.63) to hit the same ~23%.
//
// Waymo also gets two modes (one curve, same robotaxi scope — no step CHANGE of
// scope, just of growth rate): a base "production pace" mode plus a "hockeystick".
// Anchored to FutureSearch's Waymo forecast: end-2026 fleet ~5,900-6,000 central at
// the current ~265-300 cars/month pace, with weekly-rides p90 of 1.15M (P(rides >=
// 1M) ~20%). Hitting the 1M-weekly-rides fleet needs ~7,200 vehicles via a faster
// Mesa/Magna + Ojai(Zeekr) + Ioniq-5 ramp — the hockeystick, weight ~0.18.
//
// Anchors (mid-2026): Waymo ~3,600 (Q1 2026) -> ~3,871 (Jun) -> "more than
// 4,000" (Sep 1), ~280 cars/mo, Mesa/
// Magna plant (tens of thousands/yr capacity) now building the Ojai (Zeekr 6th-gen,
// public rides from May 28 2026), Ioniq 5 next (50k by 2028, GA Metaplant); Tesla
// ~150 [90, 220] in service Aug 2026 (FLEET_HISTORY; 546 registered in TX by
// Sep 25 2026 = 420 Model Y + 126 Cybercab, and 589 = 420 + 169 Cybercab by
// Oct 3, TxDMV MCCS registry; public Cybercab rides in Austin
// from Sep 4), unsupervised FSD "probably Q4 2026" (Musk), ~2-4M HW4 cars in
// the US;
// Zoox ~50->100 vehicles, redesigned production robotaxi unveiled Jun 24 2026,
// ~105 deployed (Jul 10 recall; "about 100", Sep 17).
//
// median = exp(mu) of each component; sigma is the log-scale spread. The weights
// for each helmer must sum to 1 (asserted in forecastLanes). The `scope` tag
// splits a helmer into separate drawn curves (see forecastLanes); untagged
// components (Waymo's two modes) stay a single curve. A {median, sigma}
// log-normal is exactly the symmetric case of the {best, lo, hi} band
// component (lo/hi at ±1.6449 sigma), so fleetForecastCurves converts and
// shares the band-mixture machinery.
const FLEET_FORECAST = [
  { helmer: "Tesla", components: [
    // A re-based 2026-09-26 on FLEET_HISTORY's 2026-08 row (150 [90, 220]; the
    // June setting, median 180 / sigma 0.55, predated it and put the Jan-2027
    // 5th percentile at 79, below August's floor): August's ~150 plus the 126
    // Cybercabs already registered in Texas by Sep 25 and a flat Model Y count
    // (Tesla told JPMorgan ~Aug 19 it is holding Model Y adds for Cybercab) ->
    // ~240, sigma 0.45 (90% ~[114, 503]). Re-checked 2026-10-03 (audit #84):
    // it still meets the floor rule (5th percentile 122 >= 90, median 292 >=
    // 150), but its premise has moved: by Oct 3 the registry lists 169
    // Cybercabs (Model Y still 420). Whether the median should rise is a
    // forecast call left to the human.
    { weight: 0.71, median: 240,    sigma: 0.45, scope: "robotaxi" }, // A: slow robotaxi ramp continues
    { weight: 0.24, median: 9000,   sigma: 0.70, scope: "robotaxi" }, // B: aggressive robotaxi/Cybercab scale-up
    { weight: 0.05, median: 600000, sigma: 0.95, scope: "hw4" },      // C: eyes-off FSD across the HW4 fleet
  ] },
  { helmer: "Waymo", components: [
    { weight: 0.82, median: 5800, sigma: 0.16 }, // base: ~280 cars/mo pace (FutureSearch end-2026 ~5,900-6,000)
    { weight: 0.18, median: 7500, sigma: 0.25 }, // hockeystick: Mesa/Ojai/Ioniq ramp toward the 1M-weekly-rides fleet
  ] },
  { helmer: "Zoox", components: [
    // Re-based 2026-10-03 on FLEET_HISTORY's 2026-09 row (105 [95, 120]; the
    // June setting, median 150 / sigma 0.45, put the Jan-2027 5th percentile
    // at 72, a ~30% shrink from a fleet that has held near 100-105 since June;
    // audit #19). Zoox will "steadily increase the size of its robotaxi fleet
    // over the next several months" (TechCrunch, Sep 17), the NTA's 100-
    // vehicle Las Vegas cap ran out Sep 25, the NHTSA exemption allows 2,500
    // a year and Hayward builds 5-6 a day (CEO, Aug 10): median 150 is ~13
    // more a month, between the stalled summer and Q1's ~20; sigma 0.27
    // (90% ~[96, 234]) leaves a pause or recall holding the fleet near today's
    // as the low tail and a Hayward ramp (~35 a month) as the high one.
    { weight: 1, median: 150, sigma: 0.27 },
  ] },
];

// Quantiles from any density w.r.t. log(x): integrate it on a fine log grid
// [lo, hi] into a CDF, then invert at each probability. Reuses the numeric-
// density idiom of the marginal MPI bells rather than adding a normal-CDF
// primitive. The grid must cover essentially all the mass (asserted).
function quantilesFromLogDensity(densityFn, lo, hi, ps) {
  const n = 6000, step = (hi - lo) / (n - 1);
  const cum = new Float64Array(n);
  let mass = 0, prev = densityFn(Math.exp(lo));
  for (let i = 1; i < n; i++) {
    const dens = densityFn(Math.exp(lo + step * i));
    mass += (dens + prev) / 2 * step;
    cum[i] = mass;
    prev = dens;
  }
  assert(Math.abs(mass - 1) < 0.01, "quantilesFromLogDensity: density must normalize to 1", {mass});
  return ps.map(p => {
    const target = p * mass;
    let i = 1;
    while (i < n && cum[i] < target) i++;
    const frac = (target - cum[i - 1]) / (cum[i] - cum[i - 1]); // linear interp in log space
    return Math.exp(lo + step * (i - 1 + frac));
  });
}

// A helmer can be drawn as more than one curve ("lane"), split by its components'
// `scope` tag. Tesla splits into its two scopes (robotaxi vs the broader HW4-fleet
// scenario); Waymo/Zoox are a single untagged lane.
const HW4_COLOR = "#e08a2e"; // Tesla "all HW4 ADS" scope — distinct from robotaxi red
const FLEET_LANE_META = {
  robotaxi: {label: "Tesla robotaxi", color: HELMER_COLORS.Tesla},
  hw4:      {label: "Tesla all-HW4 ADS", color: HW4_COLOR, dashed: true, conditional: true},
};

function renormComponents(components) {
  const total = components.reduce((s, c) => s + c.weight, 0);
  assert(total > 0, "renormComponents: total weight must be positive", {total});
  return components.map(c => ({...c, weight: c.weight / total}));
}

// One lane per (helmer × scope), for any scenario-component forecast table
// (fleet, miles, rides). scenarioProb is the lane's share of its helmer's
// total mass, so Tesla's two lanes read ~95% / ~5%; each lane's components are
// renormalized to a proper density. `mainline` marks the apples-to-apples lane
// (Tesla's robotaxi lane, not the conditional HW4 one).
function forecastLanes(table) {
  const lanes = [];
  for (const entry of table) {
    const total = entry.components.reduce((s, c) => s + c.weight, 0);
    assert(Math.abs(total - 1) < 1e-9, "forecast weights must sum to 1",
      {helmer: entry.helmer, total});
    const byScope = new Map();
    for (const c of entry.components) {
      const scope = c.scope ?? entry.helmer;
      if (!byScope.has(scope)) byScope.set(scope, []);
      byScope.get(scope).push(c);
    }
    for (const [scope, comps] of byScope) {
      const meta = FLEET_LANE_META[scope] ?? {label: entry.helmer, color: HELMER_COLORS[entry.helmer]};
      lanes.push({
        key: scope, historyHelmer: entry.helmer, mainline: meta.conditional !== true,
        scenarioProb: comps.reduce((s, c) => s + c.weight, 0) / total,
        label: meta.label, color: meta.color, dashed: meta.dashed === true,
        components: renormComponents(comps),
      });
    }
  }
  return lanes;
}

// A scenario group's probability as the legend and the scenario note print it.
function scenarioPct(prob) {
  return Math.round(prob * 100);
}
// A lane's legend chip carries its scenario share when it isn't the whole helmer.
function laneLegendLabel(lane) {
  return lane.scenarioProb < 0.999
    ? `${lane.label} (~${scenarioPct(lane.scenarioProb)}%)`
    : lane.label;
}

// Fleet curves via the shared band machinery: each {median, sigma} component
// converts to its exactly-equivalent symmetric band. Converted per call (not
// hoisted) so a corrupted FLEET_FORECAST still fails loudly at build time.
function fleetForecastCurves() {
  return bandForecastCurves(FLEET_FORECAST.map(entry => ({
    helmer: entry.helmer,
    components: entry.components.map(c => ({
      weight: c.weight, scope: c.scope, best: c.median,
      lo: c.median * Math.exp(-1.6449 * c.sigma),
      hi: c.median * Math.exp(1.6449 * c.sigma),
    })),
  })));
}

// Two-piece log-normal (density w.r.t. log x): mode at `best`, with the lower/upper
// spread set so lo/hi sit at matching distances each side. Lets miles/rides — given
// only as {best, lo, hi} with an asymmetric (Tesla) band — render as an honest,
// normalized, single-peaked density without inventing mixture components.
function splitLogNormalSigmas(best, lo, hi) {
  assert(lo <= best && best <= hi && lo > 0, "splitLogNormal: need 0 < lo <= best <= hi", {best, lo, hi});
  const mu = Math.log(best);
  return [Math.max((mu - Math.log(lo)) / 1.6449, 1e-6),
          Math.max((Math.log(hi) - mu) / 1.6449, 1e-6)];
}
function splitLogNormalLogDensity(best, lo, hi, x) {
  const [sLo, sHi] = splitLogNormalSigmas(best, lo, hi);
  const mu = Math.log(best);
  const u = Math.log(x);
  const z = (u - mu) / (u < mu ? sLo : sHi);
  return 2 / (Math.sqrt(2 * Math.PI) * (sLo + sHi)) * Math.exp(-0.5 * z * z);
}

// Mixture of two-piece log-normals: the single density behind every forecast
// curve (fleet converts its {median, sigma} components to symmetric bands).
// Each scenario component is a {weight, best, lo, hi} band — the same banding
// idiom as every other miles/rides figure. `best` is each component's MODE, so
// displayed medians/CIs are always computed from the density
// (quantilesFromLogDensity), never read off the parameters.
function bandMixtureLogDensity(components, x) {
  let d = 0;
  for (const c of components) d += c.weight * splitLogNormalLogDensity(c.best, c.lo, c.hi, x);
  return d;
}
function bandMixtureQuantiles(components, ps) {
  let lo = Infinity, hi = -Infinity;
  for (const c of components) {
    const [sLo, sHi] = splitLogNormalSigmas(c.best, c.lo, c.hi);
    lo = Math.min(lo, Math.log(c.best) - 9 * sLo);
    hi = Math.max(hi, Math.log(c.best) + 9 * sHi);
  }
  return quantilesFromLogDensity(x => bandMixtureLogDensity(components, x), lo, hi, ps);
}

// Plottable curves for a band-component forecast table (miles/rides): same
// lane structure as the fleet metric (Tesla splits into robotaxi + HW4).
function bandForecastCurves(table) {
  return forecastLanes(table).map(lane => {
    let xMin = Infinity, xMax = 0;
    for (const c of lane.components) {
      xMin = Math.min(xMin, c.lo / 3);
      xMax = Math.max(xMax, c.hi * 3);
    }
    const [lo90, median, hi90] = bandMixtureQuantiles(lane.components, [0.05, 0.5, 0.95]);
    return {
      ...lane, legendLabel: laneLegendLabel(lane),
      densityFn: x => bandMixtureLogDensity(lane.components, x),
      xMin, xMax, lo90, median, hi90,
    };
  });
}

// The distribution ("final") chart follows the same toggle as the trajectory.
// All three metrics are scenario mixtures with the same Tesla scope split.
function fleetDistributionCurves(metricKey) {
  if (metricKey === "fleet") return fleetForecastCurves();
  return bandForecastCurves(metricKey === "miles" ? MILES_FORECAST : RIDES_FORECAST);
}

// Legend for the fleet charts: one chip per drawn curve (helmers + Tesla's two
// scopes), keyed on each curve's own colour + label. Can't reuse helmerChipLegend,
// which is keyed on the global helmer list.
function fleetCurveLegend(curves) {
  return `
    <div class="month-legend">
      ${curves.map(c => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${c.color}"></span>${c.legendLabel}
      </span>`).join("")}
    </div>`;
}

function renderFleetForecastChart() {
  const spec = growthMetricSpec(selectedGrowthMetric);
  const curves = fleetDistributionCurves(selectedGrowthMetric);
  // Frame the axis on the curves' own 90% intervals (a little margin past each
  // edge) rather than distributionExtent's visible-peak band: Tesla's broad
  // high-vehicle "HW4 fleet" mode carries real mass but little peak height, so a
  // peak-height floor would clip it off — we want it on screen.
  const xMin = Math.min(...curves.map(c => c.lo90)) / 1.6;
  const xMax = Math.max(...curves.map(c => c.hi90)) * 1.6;
  assert(xMin < xMax, "fleet forecast chart: degenerate x range", {xMin, xMax});

  const nPts = 250;
  const logMin = Math.log(xMin), logMax = Math.log(xMax);
  const logStep = (logMax - logMin) / (nPts - 1);
  const xs = [];
  for (let i = 0; i < nPts; i++) xs.push(Math.exp(logMin + logStep * i));

  // The y scale covers every sample and every median marker (a marker near
  // its curve's peak can sit above the grid's samples), with DENSITY_HEADROOM.
  let yMax = 0;
  for (const c of curves) {
    c.ys = xs.map(x => c.densityFn(x));
    yMax = Math.max(yMax, ...c.ys, c.densityFn(c.median));
  }
  assert(yMax > 0, "fleet forecast chart: all densities zero", {yMax});

  const svgW = chartViewW, svgH = 280;
  const mLeft = 68, mTop = 14, mBot = 48;
  const mRight = axisRightMargin(xMin, xMax, spec.fmt, mLeft, svgW);
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const baseline = mTop + pH;
  const mapX = x => mLeft + (Math.log(x) - logMin) / (logMax - logMin) * pW;
  const mapY = y => mTop + pH * (1 - y / (yMax * DENSITY_HEADROOM));

  const yTitle = "Probability density for 2027 Jan 1";
  const axes = `<g aria-hidden="true">
    ${drawLogXTicks(xMin, xMax, mapX, spec.fmt, mTop, baseline, baseline + 16)}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${baseline}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${baseline}" x2="${mLeft + pW}" y2="${baseline}"></line>
    <text class="month-label" x="18" y="${mTop + pH / 2}" transform="rotate(-90 18 ${mTop + pH / 2})" text-anchor="middle">${yTitle}</text>
    <text class="month-tick" x="${mLeft + pW / 2}" y="${svgH - 9}" text-anchor="middle">${spec.yLabel}</text>
  </g>`;

  const fills = curves.map(c => {
    let d = `M ${mapX(xs[0]).toFixed(2)} ${baseline.toFixed(2)}`;
    for (let i = 0; i < nPts; i++) d += ` L ${mapX(xs[i]).toFixed(2)} ${mapY(c.ys[i]).toFixed(2)}`;
    d += ` L ${mapX(xs[nPts - 1]).toFixed(2)} ${baseline.toFixed(2)} Z`;
    return `<path d="${d}" style="fill:${c.color};opacity:${c.dashed ? 0.06 : 0.120}"></path>`;
  }).join("");

  const strokes = curves.map(c => {
    let d = "";
    for (let i = 0; i < nPts; i++) d += `${i === 0 ? "M " : " L "}${mapX(xs[i]).toFixed(2)} ${mapY(c.ys[i]).toFixed(2)}`;
    return `<path d="${d}" style="stroke:${c.color};stroke-width:2;fill:none${c.dashed ? ";stroke-dasharray:6 4" : ""}"></path>`;
  }).join("");

  // Markers draw after the clip-path group, so the frame never cuts one
  // (the tallest curve's median marker lost its top until 2026-10-03; audit
  // #25). Each median lies inside the frame, which spans every curve's 90%
  // interval.
  // The markers, then (hitCircles) their tooltip targets over them.
  const marks = curves.map(c => {
    assert(c.median >= xMin && c.median <= xMax, "fleet forecast marker outside the frame", {label: c.legendLabel, median: c.median, xMin, xMax});
    const tip = `${c.legendLabel}\n${forecastQuantilesText(spec, c.median, c.lo90, c.hi90)}`;
    return {x: mapX(c.median), y: mapY(c.densityFn(c.median)), color: c.color, tip, name: tip};
  });
  const markers = marks.map(m => `<circle cx="${m.x.toFixed(2)}" cy="${m.y.toFixed(2)}" r="3.5" class="month-dot" style="fill:${m.color}"></circle>`).join("")
    + hitCircles(marks);

  return `
    ${fleetCurveLegend(curves)}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}" role="figure" aria-label="${escAttr(`${yTitle} ${spec.yLabel}`)}">
      <defs><clipPath id="fleet-clip"><rect x="${mLeft}" y="${mTop}" width="${pW}" height="${pH}"></rect></clipPath></defs>
      ${axes}
      <g clip-path="url(#fleet-clip)">
      ${fills}
      ${strokes}
      </g>
      ${markers}
    </svg>
  `;
}

// --- Fleet-size trajectory (history + extrapolation) -------------------------
// [AI TEXT] Monthly fleet-size anchors per helmer (vehicles in driverless / ADS
// robotaxi service), each with a lo/hi uncertainty range. The trajectory is then
// extrapolated to the Jan 1, 2027 forecast (its median + 90% interval, taken from
// the same FLEET_FORECAST mixture the distribution chart draws), so the two charts
// share the endpoint by construction. These counts are NOT from the NHTSA/VMT
// pipeline — fleet headcounts are noisier than the cumulative-mileage milestones
// the VMT series anchors to, hence the wide lo/hi ranges.
//
// Anchors (rounded, sourced from mid-2026 reporting): Waymo 1,500 (May 2025) ->
// 2,500 (Nov) -> 3,067 5th-gen (Dec) -> 3,300 (Feb 2026, from the "over 3,000"
// report plus the ~280 cars/mo pace) -> 3,750 (May, consistent with the ~3,871
// Jun report the forecast anchors below cite); Tesla driverless-service
// vehicles ~12 at launch (Jun 2025) -> ~20 (Dec) -> ~25 (Apr 2026) -> ~28
// active (Jun 2026; 42 registered, ~58 incl. driver-monitor mode — the
// registry count was carried as "best" until 2026-09-04, a change of basis)
// -> ~150 (Aug 2026: 173 distinct vehicles sighted ex-Bay-Area on
// robotaxitracker, AP Sep 3 "more than 200 unsupervised robotaxis", 420
// registered VINs; the Sep-3 "1 million unsupervised miles" implies ~100+
// cars averaging ~100-150 mi/day); Zoox ~50 (Jan 2026) -> ~90 (Mar) -> ~100
// (Jun). Added 2026-10-03 (audit #87, #19), each a stock at the step of the
// day it was counted, as the Jan-1 forecast sits at 2027-01: Waymo 2026-09
// = "more than 4,000 vehicles" (TechCrunch, Sep 1) as the floor: the Jun-13
// recall's 3,871 5th-gen vehicles plus the ~300 6th-gen Ojai in service by
// Sep 1 make ~4,200, later 5th-gen additions a little more, so ~4,300; the
// ceiling is the ~280 cars/month pace the forecast assumes, run from Waymo's
// "around 4,000" of Jun 29 (~4,600, rounded up);
// Zoox 2026-09 = "about 100 custom-built robotaxis ... spread across four
// U.S. cities" (TechCrunch, Sep 17), after recall 26E044000 covered 105
// units, its whole deployed driverless fleet, on Jul 10, so ~105 [95, 120].
// Tesla has no 2026-09 row: August's 150 rests on robotaxitracker's monthly
// distinct-vehicle count, whose data paths the site does not allow automated
// clients to read, and the rows before it use other definitions (audit #20,
// a human call).
const FLEET_HISTORY = {
  Tesla: [
    {month: "2025-06", best: 12, lo: 8,  hi: 20},
    {month: "2025-12", best: 20, lo: 12, hi: 32},
    {month: "2026-04", best: 25, lo: 18, hi: 35},
    {month: "2026-06", best: 28, lo: 20, hi: 58},
    {month: "2026-08", best: 150, lo: 90, hi: 220},
  ],
  Waymo: [
    {month: "2025-05", best: 1500, lo: 1300, hi: 1700},
    {month: "2025-11", best: 2500, lo: 2200, hi: 2800},
    {month: "2025-12", best: 3067, lo: 2850, hi: 3300},
    {month: "2026-02", best: 3300, lo: 3000, hi: 3700},
    {month: "2026-05", best: 3750, lo: 3400, hi: 4200},
    {month: "2026-09", best: 4300, lo: 4000, hi: 4700},
  ],
  Zoox: [
    {month: "2026-01", best: 50,  lo: 35, hi: 70},
    {month: "2026-03", best: 90,  lo: 70, hi: 115},
    {month: "2026-06", best: 100, lo: 80, hi: 130},
    {month: "2026-09", best: 105, lo: 95, hi: 120},
  ],
};
const FLEET_TS_END_MONTH = "2027-01"; // the Jan-1-2027 forecast cross-section

// Month <-> integer index, with index 0 == 2025-05 (the earliest anchor).
function fleetMonthIndex(monthIso) {
  const [y, m] = monthIso.split("-").map(Number);
  assert(Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12,
    "fleet month must be YYYY-MM", {monthIso});
  return (y - 2025) * 12 + (m - 5);
}
function fleetMonthIso(index) {
  const abs = 2025 * 12 + 4 + index;
  return `${Math.floor(abs / 12)}-${String(abs % 12 + 1).padStart(2, "0")}`;
}

// [AI TEXT] The growth extrapolator toggles between three metrics: the fleet count
// (a stock), cumulative miles (from the repo VMT master — matches the top section
// up to today, then extrapolates), and cumulative rides (rough — see below). Each
// metric's Jan-1-2027 forecast endpoint mirrors the fleet bimodality: Tesla's upper
// bound balloons because the "HW4 fleet goes ADS" scenario would explode its miles
// and rides too.
// CUMULATIVE rides (rough, monotonic). Waymo's is pinned to published trip
// milestones, Tesla's derives from the deck-anchored cumulative miles, Zoox's
// from published rider milestones (see each block).
const RIDES_HISTORY = {
  // Tesla rides derive from the repo's (deck-anchored) cumulative VMT at a
  // total-scope miles-per-ride corridor of [4.7, 6.2, 8.3]: an author-set
  // ~4-5 mi average paid ride (corroborated by robotaxitracker's
  // receipt-synced trips, Nov 2025 - Jul 2026, n~2,400 ex sub-0.5-mi hops:
  // mean 3.81 mi, contributor-skewed low; the once-cited Electrek 2026-04-30
  // article is fleet-counts-only and never carried ride lengths) divided by a
  // 0.6-0.85 passenger-on-board share of fleet service miles (deadhead
  // 15-40%). Pinned by
  // rides-provenance.qual against the VMT master. (The old [7.6, 10, 13]
  // corridor reconciled the miles with a "~700k paid miles by late Apr 2026"
  // figure that was actually mid-February vintage; Tesla's Q1-2026 deck puts
  // end-Mar cumulative paid miles at ~1.717M, so these rows are ~2x the old.)
  // The rows sit at quarter ends. Through 2026-06 they are deck-chart months,
  // whose miles are near-exact, so each band is the corridor's alone (cume /
  // 8.3 .. cume / 4.7); 2026-09 (added 2026-10-03, audit #87) is an estimate
  // month of data/vmt.csv, so its band divides the kyoom band by the
  // corridor's far ends, as RIDES_FORECAST does: 3,630,000 / 6.2, 3,194,800 /
  // 8.3, 4,506,000 / 4.7. Re-derive it when the Q3 deck re-pins September.
  Tesla: [
    {month: "2025-09", best: 19500,  lo: 14500,  hi: 26000},
    {month: "2025-12", best: 106000, lo: 79000,  hi: 140000},
    {month: "2026-03", best: 277000, lo: 207000, hi: 365000},
    {month: "2026-06", best: 394000, lo: 294000, hi: 519000},
    {month: "2026-09", best: 585000, lo: 385000, hi: 959000},
  ],
  // Waymo pinned to published cumulative milestones (rides-provenance.qual):
  // 10M paid trips May 20 2025 (CNBC/Google I/O), ~20M lifetime end-2025
  // (Waymo 2025 year-in-review); interpolated with the published weekly rates
  // (250k/wk May 2025 -> 450k/wk Dec 2025 -> 500k/wk Mar 2026, CNBC/TechCrunch).
  // 2026-09 (added 2026-10-03, audit #87) extends 2026-05 by the 17.4 weeks to
  // Sep 30 on Waymo's "over half a million trips each week" (Sep 14; the floor
  // it has stated since late March, so no newer level): lo = May's lo + 500k a
  // week (rounded up), best = May's best + ~575k a week (the 2026-03 ->
  // 2026-05 rows' pace), hi = May's hi + 700k a week.
  Waymo: [
    {month: "2025-06", best: 11500000, lo: 10500000, hi: 12800000},
    {month: "2025-09", best: 16000000, lo: 14500000, hi: 17800000},
    {month: "2025-12", best: 20000000, lo: 19000000, hi: 21500000},
    {month: "2026-03", best: 26000000, lo: 24000000, hi: 28500000},
    {month: "2026-05", best: 31000000, lo: 28000000, hi: 34500000},
    {month: "2026-09", best: 41000000, lo: 36800000, hi: 46700000},
  ],
  // Zoox rides anchor to its published cumulative RIDER counts — >300k riders
  // by late 2025, >350k by late Mar 2026 (CleanTechnica 2026-03-24, The
  // Robot Report; the same milestones the VMT series cites), and >500k by
  // late Jun 2026 (robotaxi-redesign announcement, 2026-06-25: "feedback from
  // more than half a million riders") — divided by an occupancy band of
  // 1.2-2.0 riders per ride (central 1.5; the vehicle seats four and Vegas
  // groups are common). Pinned by rides-provenance.qual. (The 500k milestone
  // implies Q2 ridership ~3x Q1's pace; the pre-milestone 2026-06 row here,
  // 265k, had extrapolated ~12k riders/month and ran ~25% low.)
  Zoox: [
    {month: "2025-12", best: 200000, lo: 150000, hi: 265000},
    {month: "2026-03", best: 235000, lo: 175000, hi: 300000},
    {month: "2026-06", best: 333000, lo: 250000, hi: 417000},
  ],
};
// Cumulative-miles forecast through Jan 1, 2027, extending each helmer's
// cumulative VMT from the last month drawn (data/vmt.js stops at the NHTSA
// data-through month; each component below names its own base). Tesla
// mirrors FLEET_FORECAST's scenario mixture
// (same A/B/C weights and robotaxi/HW4 scope split). Recalibrated 2026-07-22
// post-Q2-deck: end-Jun actual is 2.44M cumulative after a utilization-led Q2
// slowdown (monthly 437k Mar -> 374k/192k/157k on ~45 -> ~30 active vehicles,
// ~5-6k mi/vehicle-month blended — fleet-count activity ratios ran ~2x hot).
// A ("slow ramp continues"): the Jul-2026 three-metro expansion (Miami/
// Orlando/Tampa unsupervised) + ~175 registered TX vehicles pull monthly
// miles back toward ~400-700k by Dec. Re-based 2026-09-04 on the Sep-3
// "1 million unsupervised miles" statement (end-Aug cume ~3.15M
// [2.89M, 3.79M], August ~470k/mo): floor 4.5M = 3.15M + 4 x ~340k (below
// August's rate), central 5.5M = + 4 x ~590k, ceiling 7.8M = + 4 x ~1.16M
// (the rate doubles again by Dec). B's Cybercab ramp to ~9k arrives
// mostly in Q4 at ramping utilization (production started Jun 2026; the
// earlier same-day x1.25 per-vehicle rescale is reverted — it didn't survive
// the Q2 utilization data). C's miles are ADS miles on eyes-off personal
// HW4 cars (~600k x ~1k mi/mo x the post-flip months, timing very uncertain).
const MILES_FORECAST = [
  { helmer: "Tesla", components: [
    { weight: 0.71, best: 5500000,   lo: 4500000,   hi: 7800000, scope: "robotaxi" },   // A: slow ramp continues (re-based 2026-09-04)
    { weight: 0.24, best: 40000000,  lo: 15000000,  hi: 120000000, scope: "robotaxi" }, // B: aggressive scale-up
    { weight: 0.05, best: 400000000, lo: 100000000, hi: 1500000000, scope: "hw4" },     // C: HW4 fleet goes ADS
  ] },
  // Waymo/Zoox re-derived 2026-09-04 from the rebuilt master (the 06-30
  // values predated the 2026-08-28 Waymo hub+E rebuild, which lowered
  // Apr-Aug 2026 by ~2-3M/mo): Waymo end-Aug 318.1M [307.4M, 330.8M] (after
  // the 2026-09-25 hub thru-Jun re-chain, Atlanta D withdrawn 2026-09-29)
  // plus Sep-Dec at Aug's 20.8M/mo growing ~3%/mo (Denver/San Diego/Tampa
  // opened Sep 1, Ojai ramp) -> ~407M; lo = kyoom lo + 4 x 18M ~379M; hi =
  // kyoom hi + 4 x 26M ~435M (authored 405M / 380M / 440M, rounded).
  // Zoox end-Aug 3.27M [2.59M, 3.93M] (after the 2026-10-03 CA DMV rebuild
  // and Dec-2025 knot) plus Sep-Dec at ~0.27-0.30M/mo (LAS
  // airport trips from Sep 3, fleet toward the 100-car NTA cap) -> ~4.5M.
  { helmer: "Waymo", components: [
    { weight: 1, best: 405000000, lo: 380000000, hi: 440000000 },
  ] },
  { helmer: "Zoox", components: [
    { weight: 1, best: 4500000, lo: 3500000, hi: 6000000 },
  ] },
];

// Tesla miles per paid ride (RIDES_HISTORY's corridor: 4-5 loaded miles over a
// 0.6-0.85 on-trip share; rides-provenance.qual pins the implied ratio to
// [4.5, 8.5]). Divides the miles scenarios into the rides scenarios.
const TESLA_MILES_PER_RIDE = { lo: 4.7, best: 6.2, hi: 8.3 };
// Cumulative-rides forecast through Jan 1, 2027. Tesla mirrors FLEET_FORECAST's
// scenario mixture (same A/B/C weights and robotaxi/HW4 scope split), because
// cumulative rides are the push-forward of the fleet scenarios and a
// one-humped band can't represent "71% boring / 24% aggressive / 5% HW4" —
// its computed median lands between the scenarios instead of inside one.
// Tesla's A/B bands are the miles scenarios divided by the same
// [4.7, 6.2, 8.3] miles-per-ride corridor as RIDES_HISTORY (a low corridor
// value gives the HIGH rides edge, so lo/hi swap); C's rides are
// Tesla-Network rides from eyes-off personal cars (participation deeply
// uncertain, hence the width). Zoox extends its rider-milestone trajectory
// with expansion upside (Miami/Austin launches, 4x SF geofence, paid rides
// from 2026 per Fortune 2025-12-08).
const RIDES_FORECAST = [
  { helmer: "Tesla", components: [
    // A and B are the miles scenarios over the ride corridor, tied in code
    // (2026-09-26: A had stayed on the 2026-07-22 miles figures when
    // MILES_FORECAST A was re-based on 2026-09-04). C is authored: Tesla-
    // Network rides from eyes-off personal cars have their own miles per ride.
    ...MILES_FORECAST.find(f => f.helmer === "Tesla").components.filter(c => c.scope === "robotaxi")
      .map(c => ({ weight: c.weight, best: c.best / TESLA_MILES_PER_RIDE.best, lo: c.lo / TESLA_MILES_PER_RIDE.hi, hi: c.hi / TESLA_MILES_PER_RIDE.lo, scope: "robotaxi" })),
    { weight: 0.05, best: 15000000, lo: 2000000, hi: 120000000, scope: "hw4" },      // C: Tesla Network on eyes-off HW4
  ] },
  { helmer: "Waymo", components: [
    { weight: 1, best: 50000000, lo: 43000000, hi: 60000000 }, // ~31M May 2026 + ~31 weeks at 600-750k/wk
  ] },
  { helmer: "Zoox", components: [
    { weight: 1, best: 550000, lo: 350000, hi: 1100000 }, // >500k riders late Jun 2026 + ~50k riders/mo run-rate + LV Uber-app launch upside, / 1.2-2.0 occupancy
  ] },
];

// Cumulative miles = the repo's own cumulative VMT (vmtCume) with its kyoom band,
// straight from data/vmt.csv — so this line matches the top VMT section through
// the last NHTSA data month (data/vmt.js stops there; later master rows are not drawn)
// by construction, and only the dashed tail is new.
function milesHistory(helmer) {
  return vmtRows
    .filter(r => r.helmer === helmer && fleetMonthIndex(r.month) >= 0)
    .map(r => ({month: r.month, best: r.vmtCume, lo: r.kyoomMin, hi: r.kyoomMax}));
}

// The toggle-able metrics. Each provides a `lanes()` list of drawable series plus
// its own y-axis framing and number formats: `fmt` for its axis ticks, and
// `tipFmt` for the values in its tooltips (history points, and forecasts
// once forecastQuantilesText has rounded them): the fleet, an observed
// count, exactly; rides and miles at FORECAST_SIG_FIGS significant figures,
// miles before their unit suffix (MILES_AT_SIG_FIGS). Every metric forks
// Tesla into its two scopes (robotaxi mainline + conditional HW4 branch).
function growthMetricSpec(key) {
  const specs = {
    fleet: {label: "Fleet size", yLabel: "Fleet size", valueLabel: "Fleet size", fmt: fmtWhole, tipFmt: fmtWhole,
      yMin: 6, yMax: 4000000, yTicks: [10, 100, 1000, 10000, 100000, 1000000],
      note: "",
      lanes: () => trajectoryLanes(fleetForecastCurves(), h => FLEET_HISTORY[h], FLEET_TS_END_MONTH)},
    rides: {label: "Rides (cumulative)", yLabel: "Cumulative rides", valueLabel: "Rides", fmt: fmtWhole,
      tipFmt: v => fmtWhole(Number(v.toPrecision(FORECAST_SIG_FIGS))),
      yMin: 3000, yMax: 400000000, yTicks: [10000, 100000, 1000000, 10000000, 100000000],
      note: "Waymo's estimates based on published ride milestones; Zoox's on published rider counts; Tesla's on published miles with assumed ride length",
      lanes: () => trajectoryLanes(bandForecastCurves(RIDES_FORECAST), h => RIDES_HISTORY[h], CUMULATIVE_END_MONTH)},
    miles: {label: "Miles (cumulative)", yLabel: "Cumulative miles", valueLabel: "Miles", fmt: fmtMiles,
      tipFmt: v => MILES_AT_SIG_FIGS.format(v),
      // yMin 500 keeps Tesla's first cumulative points (683 / 7k / 20k mi) and
      // Zoox's early lower band on-plot (yMin 100000 clipped them until 2026-09-04)
      yMin: 500, yMax: 4000000000, yTicks: [1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000],
      note: "Cumulative miles = the top section's VMT, carried through the last NHTSA data month and then extrapolated (dashed); the solid part should match the VMT charts above.",
      lanes: () => trajectoryLanes(bandForecastCurves(MILES_FORECAST), milesHistory, CUMULATIVE_END_MONTH)},
  };
  assert(specs[key] !== undefined, "unknown growth metric", {key});
  return specs[key];
}

// The Jan-1-2027 forecast's step on the trajectory's month axis, by each
// metric's own time convention. The fleet is a stock, counted at Jan 1: the
// 2027-01 step (FLEET_TS_END_MONTH). Cumulative rides and miles are month-end
// totals (the 2026-08 point is the total through Aug 31), so the total
// through Dec 31, 2026 is the 2026-12 step. Until 2026-10-03 every metric put
// it at 2027-01, five steps after August for four months of driving, so the
// dashed leg showed 4/5 of its slope (audit #86). Either way its tooltip
// names the date it stands for, GROWTH_FORECAST_DATE.
const CUMULATIVE_END_MONTH = "2026-12";
const GROWTH_FORECAST_DATE = "2027-01-01";

// A forecast's median and 90% interval as both growth charts print them: in
// the metric's own format, at FORECAST_SIG_FIGS significant figures, all that
// an authored judgment forecast carries (until 2026-10-03 the forecast chart
// printed "407,979,419" where the trajectory printed "408.0M", and rides to
// eight digits in both; audit #57).
const FORECAST_SIG_FIGS = 3;
function forecastQuantilesText(spec, median, lo, hi) {
  const f = v => spec.tipFmt(Number(v.toPrecision(FORECAST_SIG_FIGS)));
  return `Median: ${f(median)}\n90% CI: ${f(lo)} – ${f(hi)}`;
}
// Miles at FORECAST_SIG_FIGS significant figures before the unit suffix
// ("6.27M", "99.0M", "1.50B"), the growth charts' tooltip figures. Until
// 2026-10-04 a forecast rounded to three figures was then printed by
// fmtMiles, which keeps one decimal of the unit (6.3M, 99M, 1.5B), and a
// history point by fmtMiles alone, so Tesla's 2026-03 read "1.7M / Range:
// 1.7M – 2.0M" (audit #51).
const MILES_AT_SIG_FIGS = new Intl.NumberFormat(NUMBER_LOCALE,
  {notation: "compact", minimumSignificantDigits: FORECAST_SIG_FIGS, maximumSignificantDigits: FORECAST_SIG_FIGS});

// A lane's point list: history + the Jan-1-2027 forecast endpoint at
// endMonth, asserting lo <= best <= hi on every point.
function growthLanePoints(history, forecast, endMonth) {
  const points = [...history, {month: endMonth, ...forecast, forecast: true}];
  for (const p of points) {
    assert(p.lo <= p.best && p.best <= p.hi,
      "growth point must satisfy lo <= best <= hi", {point: p});
  }
  return points;
}

// Trajectory lanes for any metric, one per forecast curve and in the curves'
// order (forecastLanes: Tesla's robotaxi and all-HW4 scopes, Waymo, Zoox), so
// the two growth charts' legends agree (until 2026-10-03 the trajectory
// listed Waymo and Zoox first; audit #65). A conditional curve (Tesla's
// all-HW4 scenario) is a faded dashed FORK off its helmer's last history
// point. Forecast endpoints carry the curves' computed quantiles (median +
// 90% CI), so the two charts agree by construction.
function trajectoryLanes(curves, historyFn, endMonth) {
  return curves.map(c => {
    const history = historyFn(c.historyHelmer);
    assert(history.length > 0, "trajectoryLanes: empty history (vmtRows not initialized?)", {helmer: c.historyHelmer});
    return {label: c.legendLabel, helmer: c.historyHelmer, key: c.key, share: c.scenarioProb,
      color: c.color, branchOnly: !c.mainline,
      points: growthLanePoints(c.mainline ? history : history.slice(-1),
        {best: c.median, lo: c.lo90, hi: c.hi90}, endMonth)};
  });
}

// Note under the growth charts' legend. It must convey
// that Tesla's forecast splits into its robotaxi scenarios (the "(~95%)" on
// the "Tesla robotaxi" chip) and the scenario in which eyes-off FSD runs on
// every HW4 car (the "(~5%)" on "Tesla all-HW4 ADS"), and that those
// percentages are the scenarios' probabilities, not shares of a fleet. Until
// 2026-10-03 the page explained neither (audit #83).
function growthScenarioNote(lanes) {
  const pct = key => {
    const lane = lanes.find(l => l.key === key);
    assert(lane !== undefined, "growthScenarioNote: no lane for the scenario", {key});
    return scenarioPct(lane.share);
  };
  // Notes on "splits into two scenarios" below: the
  // model has three (A slow robotaxi ramp 0.71, B aggressive scale-up 0.24,
  // C eyes-off FSD on all HW4 cars 0.05). The robotaxi curve mixes A and B,
  // and B is its unexplained second hump near 9,000 vehicles.
  return `Tesla forecast splits into two scenarios: the robotaxi (~${pct("robotaxi")}%) ` +
    `and unsupervised FSD in all HW4 cars (~${pct("hw4")}%). ` +
    "These numbers are the scenarios' probabilities.";
}

function renderFleetTimeSeriesChart() {
  const spec = growthMetricSpec(selectedGrowthMetric);
  const lanes = spec.lanes();

  const months = [];
  for (let i = 0; i <= fleetMonthIndex(FLEET_TS_END_MONTH); i++) months.push(fleetMonthIso(i));

  const yTicks = growthYTicks(spec);
  const svgW = chartViewW, svgH = 280, mRight = 24, mTop = 14, mBot = 48;
  const mLeft = axisLeftMargin(yTicks.map(v => spec.fmt(v)));
  const pW = svgW - mLeft - mRight, pH = svgH - mTop - mBot;
  const xPad = 28;
  const {yMin, yMax} = spec; // log scale framed per metric (vehicles / miles / rides)
  const mapX = monthColumnX(months.length, mLeft + xPad, mLeft + pW - xPad);
  const mapY = v => mTop + pH * (1 - (Math.log(v) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin)));

  // The marks, then (hitCircles) every mark's tooltip target over them, in
  // lane order (history points, then the forecast endpoint). The targets draw
  // last, outside the plot's clip-path group, which clips only the visible
  // marks: inside it, Tesla's 2025-06 Miles target, whose circle reaches below
  // the x axis, had its focus ring cut flat and missed a pointer under the
  // dot (until 2026-10-04, audit #64).
  const bands = [], lines = [], marks = [], targets = [];
  for (const lane of lanes) {
    const color = lane.color;
    const pts = lane.points;
    const X = p => mapX(fleetMonthIndex(p.month));
    const solid = `stroke:${color};stroke-width:2;fill:none`;
    const dashedStroke = `${solid};stroke-dasharray:6 4`;

    // Uncertainty band (lo..hi) spanning the lane's points; fainter for the fork.
    const up = pts.map((p, i) => `${i ? "L" : "M"} ${X(p).toFixed(2)} ${mapY(p.hi).toFixed(2)}`).join(" ");
    const down = [...pts].reverse().map(p => `L ${X(p).toFixed(2)} ${mapY(p.lo).toFixed(2)}`).join(" ");
    bands.push(`<path d="${up} ${down} Z" style="fill:${color};opacity:${lane.branchOnly ? 0.06 : 0.10}"></path>`);

    const hist = pts.filter(p => !p.forecast);
    const last = hist[hist.length - 1], fc = pts[pts.length - 1];
    // Full lanes draw a solid history line + markers; a fork lane (branchOnly) draws
    // only the dashed leg from its single anchor point to the scenario endpoint.
    if (!lane.branchOnly) {
      const histLine = hist.map((p, i) => `${i ? "L" : "M"} ${X(p).toFixed(2)} ${mapY(p.best).toFixed(2)}`).join(" ");
      lines.push(`<path d="${histLine}" style="${solid}"></path>`);
      for (const p of hist) {
        // History points carry the master's authored ranges (kyoom bands,
        // fleet/rides corridors), not a computed 90% interval — that label
        // belongs to the forecast marker only. They are labelled by their
        // helmer: a scenario share is a forecast's (until 2026-10-03 every
        // Tesla point read "Tesla robotaxi (~95%) · ..."; audit #83).
        const tip = `${lane.helmer} · ${p.month}\n${spec.valueLabel}: ${spec.tipFmt(p.best)}\nRange: ${spec.tipFmt(p.lo)} – ${spec.tipFmt(p.hi)}`;
        marks.push(`<circle cx="${X(p).toFixed(2)}" cy="${mapY(p.best).toFixed(2)}" r="3.3" style="fill:${color}"></circle>`);
        targets.push({x: X(p), y: mapY(p.best), tip, name: tip});
      }
    }
    lines.push(`<path d="M ${X(last).toFixed(2)} ${mapY(last.best).toFixed(2)} L ${X(fc).toFixed(2)} ${mapY(fc.best).toFixed(2)}" style="${dashedStroke}"></path>`);
    const fx = X(fc);
    marks.push(`
      <line class="month-err" x1="${fx.toFixed(2)}" y1="${mapY(fc.lo).toFixed(2)}" x2="${fx.toFixed(2)}" y2="${mapY(fc.hi).toFixed(2)}" style="stroke:${color}"></line>
      <circle cx="${fx.toFixed(2)}" cy="${mapY(fc.best).toFixed(2)}" r="4" class="month-dot" style="fill:var(--card);stroke:${color}"></circle>`);
    const forecastTip = `${lane.label} · ${GROWTH_FORECAST_DATE} (forecast)\n${forecastQuantilesText(spec, fc.best, fc.lo, fc.hi)}`;
    targets.push({x: fx, y: mapY(fc.best), tip: forecastTip, name: forecastTip});
  }

  return `
    ${renderGrowthMetricToggle()}
    ${fleetCurveLegend(lanes.map(l => ({color: l.color, legendLabel: l.label})))}
    <p class="month-note">${growthScenarioNote(lanes)}</p>
    ${spec.note ? `<p class="month-note">${spec.note}</p>` : ""}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}" role="figure" aria-label="${escAttr(spec.yLabel)}">
      <defs><clipPath id="fleet-ts-clip"><rect x="${mLeft}" y="${mTop}" width="${pW}" height="${pH}"></rect></clipPath></defs>
      <g clip-path="url(#fleet-ts-clip)">
      ${bands.join("")}
      ${lines.join("")}
      ${marks.join("")}
      </g>
      ${drawSingleMonthAxes(months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, spec.fmt, spec.yLabel)}
      ${hitCircles(targets)}
    </svg>
  `;
}

// The metric's y-ticks, clipped to its [yMin, yMax] so none draw off-axis.
function growthYTicks(spec) {
  return spec.yTicks.filter(t => t >= spec.yMin && t <= spec.yMax);
}

const GROWTH_METRIC_KEYS = ["fleet", "rides", "miles"];
// Radio toggle for the growth extrapolator's metric. Re-renders only the chart on
// change (the toggle markup itself is re-emitted by renderFleetTimeSeriesChart, so
// the handlers are rebound each render — same lightweight pattern as the chart's
// own dots).
function renderGrowthMetricToggle() {
  return `<div class="month-legend" id="growth-metric-toggle">${
    GROWTH_METRIC_KEYS.map(key => `
      <label class="month-legend-item">
        <input type="radio" name="growth-metric" data-focus-key="growth-${key}" value="${key}" ${key === selectedGrowthMetric ? "checked" : ""}>
        ${growthMetricSpec(key).label}
      </label>`).join("")
  }</div>`;
}

// Bind the (re-emitted) growth-metric radios via event delegation on the chart
// container, so a re-render doesn't strand the listener. The toggle drives BOTH the
// trajectory and the distribution below it. One listener, set once.
function initGrowthMetricToggle() {
  byId("chart-fleet-timeseries").addEventListener("change", e => {
    const value = e.target.value;
    assert(GROWTH_METRIC_KEYS.includes(value), "unknown growth metric toggle", {value});
    selectedGrowthMetric = value;
    rerenderKeepingFocus(() => {
      byId("chart-fleet-timeseries").innerHTML = renderFleetTimeSeriesChart();
      byId("chart-fleet-forecast").innerHTML = renderFleetForecastChart();
    });
    syncUrlState();
  });
}

function renderHelmerMonthlyChart(globalSeries, helmer) {
  // Filter to months where this helmer has VMT data
  const presentIndices = [];
  for (let i = 0; i < globalSeries.points.length; i++) {
    if (globalSeries.points[i].helmers[helmer] !== null) presentIndices.push(i);
  }
  // No months with data in range: fall back to the full window so the chart
  // still renders as empty axes instead of vanishing (Anti-Magic Principle).
  // The line/mark loops skip the resulting null rows, so it stays one path.
  const indices = presentIndices.length > 0
    ? presentIndices
    : globalSeries.points.map((_, i) => i);
  const series = {
    months: indices.map(i => globalSeries.months[i]),
    points: indices.map(i => globalSeries.points[i]),
  };
  const svgW = chartViewW;
  const svgH = 250;
  const mRight = 24;
  const mTop = 14;
  const mBot = 48;
  const pH = svgH - mTop - mBot;
  const rows = helmerMonthRows(series, helmer);
  // Monthly vs cumulative VMT view (global toggle). Cumulative plots the kyoom
  // band, which is monotone, so its floors don't wiggle like the monthly bars.
  const best = row => vmtCumulative ? row.vmtCume : row.vmtMonthBest;
  const lo = row => vmtCumulative ? row.kyoomMin : row.vmtMonthMin;
  const hi = row => vmtCumulative ? row.kyoomMax : row.vmtMonthMax;
  const yLabel = vmtCumulative ? "Cumulative VMT" : "Vehicle Miles Traveled (VMT)";
  // 0 with no rows in the window: the empty axes are labelled "0" alone (linearTicks).
  const vmtMax = Math.max(0, ...rows.map(row => row ? hi(row) : 0));
  const yTicks = linearTicks(0, vmtMax, 4);
  const mLeft = axisLeftMargin(yTicks.map(fmtMiles));
  const pW = svgW - mLeft - mRight;
  const xPad = 28; // match the cross-helmer MPI chart's edge inset
  const mapX = monthColumnX(series.months.length, mLeft + xPad, mLeft + pW - xPad);
  // The axis tops out at its last tick (linearTicks), at or above vmtMax.
  const mapVmtY = y => scaleLinear(y, 0, yTicks[yTicks.length - 1], mTop + pH, mTop);
  const vmtColor = HELMER_COLORS[helmer];

  const errs = [];
  for (let i = 0; i < series.points.length; i++) {
    const row = rows[i];
    if (!row) continue; // no data for this helmer this month (empty-range fallback)
    const cx = mapX(i);
    const yLo = mapVmtY(lo(row));
    const yHi = mapVmtY(hi(row));
    errs.push(`
      <line class="month-err" x1="${cx.toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}"></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yLo.toFixed(2)}" style="stroke:${vmtColor}"></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yHi.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}"></line>
    `);
  }

  let vmtPath = "";
  for (let i = 0; i < series.points.length; i++) {
    if (!rows[i]) continue;
    const y = mapVmtY(best(rows[i]));
    vmtPath += `${vmtPath ? " L " : "M "}${mapX(i).toFixed(2)} ${y.toFixed(2)}`;
  }

  // The incident count on the miles' basis: the month's, or (cumulative
  // view) all through it, as vmtCume is.
  const incidentsOf = row => vmtCumulative ? row.incidentsCume : row.incidents.total;
  // The dots, then (hitCircles) each month's targets over them: its range's
  // low and high ends, then its dot, so the Tab order walks month by month
  // and the dot wins where its ends lie under it.
  const dots = [], targets = [];
  rows.forEach((row, i) => {
    if (!row) return;
    const x = mapX(i);
    const y = mapVmtY(best(row));
    dots.push(`<circle class="month-dot" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.3" style="fill:${vmtColor}"></circle>`);
    const month = series.months[i];
    // Only the data-through month's count, and a helmer's Monthly-lag
    // months', are partial (both factors are 1 elsewhere).
    const worst = row.coverage * row.incCovMin;
    const note = worst < 0.999 ? `\n${vmtPartialNote(row.coverage * row.incCov, worst)}` : "";
    // One company's chart (its figure says whose), so a mark's name is its tip.
    const low = vmtEndTooltip(month, lo(row), VMT_RANGE_EDGE.lo);
    const high = vmtEndTooltip(month, hi(row), VMT_RANGE_EDGE.hi);
    const dot = vmtDotTooltip(month, best(row), lo(row), hi(row), incidentsOf(row)) + note;
    targets.push(
      {x, y: mapVmtY(lo(row)), tip: low, name: low},
      {x, y: mapVmtY(hi(row)), tip: high, name: high},
      {x, y, tip: dot, name: dot},
    );
  });
  const vmtMarks = dots.join("") + hitCircles(targets);

  return `
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}" role="figure" aria-label="${escAttr(`${helmer} ${yLabel}`)}">
      ${errs.join("")}
      <path class="month-vmt-line" d="${vmtPath}" style="stroke:${vmtColor}"></path>
      ${vmtMarks}
      ${drawSingleMonthAxes(
        series.months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapVmtY, fmtMiles,
        yLabel,
      )}
    </svg>
  `;
}

// A summary card's multiplier against the human benchmark: "2.4x" in the
// one ratio format (fmtRatio), coloured by the value printed (ratioShown), or
// at k = 0 given the prior-only marking instead of a colour.
function cardMultSpan(mult, k) {
  const text = `${fmtRatio(mult)}x`;
  const marks = priorOnlyMarks(k, text);
  return `<span class="mpi-card-mult${marks.cls || (ratioShown(mult) >= 1 ? " safer" : " worse")}"${marks.attrs}>${text}</span>`;
}

function renderMpiSummaryCards(series) {
  const rows = windowSummaryRows(series);
  return rows.map(row => {
    const fiveDayLabels = METRIC_DEFS.filter(m => m.fiveDay).map(m => m.cardLabel.toLowerCase()).join(", ");
    const fiveDayLine = est => `Claude: Five-day-tracked VMT denominator (${fiveDayLabels}: raw VMT times the data-through month's receipt coverage): ${fmtWhole(est.vmtBest)} (${fmtWhole(est.vmtMin)} \u2013 ${fmtWhole(est.vmtMax)}).`;
    // The tooltip states the denominators only; the per-month VMT rationales
    // are in the sanity section's VMT-sources table (embedded here they made
    // the tooltip 7,000-8,700px tall).
    const effectiveVmtLine = () => {
      const tip = `Effective VMT = estimated miles times estimated reporting completeness for months whose incident reports are still arriving; raw window VMT for comparison: ${fmtWhole(row.vmtRawBest)}. ${fiveDayLine(row.mpiEstimates.fatality)}`;
      const shown = `Effective VMT: ${fmtWhole(row.vmtBest)}${row.vmtMin !== row.vmtBest || row.vmtMax !== row.vmtBest ? ` (${fmtWhole(row.vmtMin)} \u2013 ${fmtWhole(row.vmtMax)})` : ""}`;
      return `<div class="mpi-card-vmt"${htmlTipAttrs(`${shown} ${tip}`, tip)}>${shown}</div>`;
    };
    const noMilesLine = `<div class="mpi-card-vmt">No miles in this window</div>`;
    // Each source once, by URL (one label per URL: BENCHMARK_SOURCES).
    const benchmarksLine = `<div class="mpi-card-vmt">Benchmarks: ${[...new Set(METRIC_DEFS.map(m => m.humanMPI && m.humanMPI[row.helmer]).filter(Boolean).flatMap(h => h.srcLinks))].map(sourceLink).join(SOURCE_LIST_SEP)}</div>`;
    // Branch on the cohort, not on vmtBest > 0: an ADS helmer with no VMT in
    // the window used to fall into the human-cohort template and render a
    // dangling "Benchmarks:" with an empty list (2026-09-26).
    const vmtLine = HUMAN_HELMERS.includes(row.helmer) ? benchmarksLine
      : row.vmtBest > 0 ? effectiveVmtLine() : noMilesLine;
    const stressLine = row.vmtBest > 0
      ? (() => { const stress = helmerHumanStress(row, "all"); return `<div class="mpi-card-stress">${CARD_STRESS_LABEL} ${stressBadge(stress, stress.av.k)} ${fmtRatio(stress.ratioLo)}x \u2013 ${fmtRatio(stress.ratioHi)}x</div>`; })()
      : "";
    // An unchecked helmer's card stays, grayed (class unchecked), as the
    // other views gray rather than drop; until 2026-10-03 every card rendered
    // ungrayed whatever was checked, even with nothing checked (audit #67).
    return `
      <div class="mpi-card${monthHelmerEnabled[row.helmer] ? "" : " unchecked"}" style="border-left-color:${HELMER_COLORS[row.helmer]}">
        <div class="mpi-card-helmer">${helmerLabel(row.helmer)}</div>
        ${vmtLine}
        ${stressLine}
        ${METRIC_DEFS.map(m => {
          const est = row.mpiEstimates[m.key];
          if (!est) return "";
          const hl = m.key === selectedMetricKey ? " highlighted" : "";
          const humanBench = m.humanMPI && m.humanMPI[row.helmer]; // this row's cohort (human cards)
          const humanRef = m.humanMPI && m.humanMPI.HumansAV; // ADS "Nx vs humans" baseline
          const humanGeo = humanRef ? Math.sqrt(humanRef.lo * humanRef.hi) : null;
          // Point estimate everywhere is the posterior median (finite even at k=0),
          // so the multiple is always a plain Nx. (est.k===null excludes humans.)
          // It prints in the one ratio format (fmtRatio) and its colour follows
          // the value printed (ratioShown), so "1.0x" is never the worse red;
          // a multiplier resting on zero incidents gets the prior-only marking
          // instead of a colour, like its stress badge (audit #16, #55).
          const mult = (humanGeo && est.k !== null) ? est.postMedian / humanGeo : null;
          const multStr = mult !== null ? ` ${cardMultSpan(mult, est.k)}` : "";
          const kLine = est.k !== null ? `${splur(est.k, "incident")} \u2192 ` : "";
          const ciLabel = est.k !== null ? "95% CI" : "Range";
          const srcLine = (est.k === null && humanBench)
            ? `<div class="mpi-card-sources">${humanBench.srcLinks.map(sourceLink).join(SOURCE_LIST_SEP)}</div>`
            : "";
          // The "[?]" only marks the hint, so the hint is named by its
          // derivation alone and the glyph is hidden from assistive technology
          // (until 2026-10-04 it read "[?]" glued to the derivation; audit #63).
          const srcHint = (est.k === null && humanBench && humanBench.src)
            ? ` <span class="mpi-card-src"${htmlTipAttrs(humanBench.src, humanBench.src)}><span aria-hidden="true">[?]</span></span>`
            : "";
          return `
          <div class="mpi-card-metric${m.primary ? " primary" : ""}${hl}" data-metric="${m.key}">
            <div>${m.cardLabel}: ${kLine}<span class="mpi-card-mpi">${fmtWhole(est.postMedian)} MPI</span>${multStr}</div>
            <div class="mpi-card-ci">${ciLabel}: ${fmtWhole(est.lo)} \u2013 ${fmtWhole(est.hi)}${srcHint}</div>
            ${srcLine}
          </div>`;
        }).join("")}
      </div>
    `;
  }).join("");
}

function renderStressTestTable(series) {
  const rows = windowSummaryRows(series).filter(r => r.vmtBest > 0);
  const body = rows.flatMap(row =>
    METRIC_KEYS.filter(metricKey => row.mpiEstimates[metricKey] !== null).map(metricKey => {
      const stress = helmerHumanStress(row, metricKey);
      return `<tr>
        <td>${escHtml(row.helmer)}</td>
        <td>${escHtml(stress.metric.cardLabel)}</td>
        <td class="num">${fmtCount(stress.av.k)}</td>
        <td class="num pair"><span>${fmtWhole(stress.av.postMedian)};</span> <span>${fmtWhole(stress.av.lo)} \u2013 ${fmtWhole(stress.av.hi)}</span></td>
        <td class="num">${fmtWhole(stress.human.lo)} \u2013 ${fmtWhole(stress.human.hi)}</td>
        <td class="num">${fmtRatio(stress.ratioLo)}x \u2013 ${fmtRatio(stress.ratioHi)}x</td>
        <td>${stressBadge(stress, stress.av.k)}</td>
      </tr>`;
    })
  ).join("");
  // Faultfrac sensitivity sub-table.
  const faultRows = rows
    .filter(row => row.mpiEstimates.atfault !== null)
    .map(row => {
      const stress = helmerHumanStress(row, "atfault");
      const flip = faultFlipMultiplier(stress.av, stress.human, row.incTotal);
      const multCell = flip === null ? "—"
        : flip.mult === Infinity ? "∞"
        : `${fmtRatio(flip.mult)}x`;
      const flippedCell = flip === null || flip.flipped === null ? "—"
        : `<span class="stress-badge ${STRESS_VERDICT_META[flip.flipped].className}">${STRESS_VERDICT_META[flip.flipped].label}</span>`;
      return `<tr>
        <td>${escHtml(row.helmer)}</td>
        <td class="num">${fmtCount(stress.av.k)}</td>
        <td>${stressBadge(stress, stress.av.k)}</td>
        <td class="num">${multCell}</td>
        <td>${flippedCell}</td>
      </tr>`;
    }).join("");
  const faultSensitivity = `
    <p>
How wrong Claude's fault judgments would have to be to change the verdicts.
The multiplier is the smallest factor that the true at-fault fraction would need to exceed the judged at-fault fraction before changing the at-fault verdict.
<span class="ai-text">"At-fault" here means, on the robotaxi side, the probability that an expert human driver would have avoided the collision (judged by Claude from the narratives); the human band bounds the same quantity using legal-fault shares (50% floor), since expert avoidability cannot be lower.</span>
    </p>
    <div class="table-wrap"><table class="source-table stress-table">
      <thead><tr><th>Company</th><th class="num">Judged fault</th><th>Current verdict</th><th class="num">Flip multiplier</th><th>Verdict after flip</th></tr></thead>
      <tbody>${faultRows}</tbody>
    </table></div>`;
  return `
    <h3>Sensitivity analysis</h3>
    <p>
The "AV/human ratio" column gives the possible range for that ratio based on the confidence intervals.
If the whole range is above 1, we call that "robustly safer".
    </p>
    <div class="table-wrap"><table class="source-table stress-table">
      <thead><tr><th>Company</th><th>Metric</th><th class="num">k</th><th class="num">MPI AV (median; 95%)</th><th class="num">Human MPI (AV cities)</th><th class="num">AV/human ratio</th><th>Verdict</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${faultSensitivity}`;
}

function renderHumanBenchmarkTable() {
  const rows = HUMAN_HELMERS.flatMap(hh => METRIC_DEFS
    .filter(m => m.humanMPI && m.humanMPI[hh])
    .map(m => {
      const h = m.humanMPI[hh];
      const derivation = `${escHtml(h.src)} (${h.srcLinks.map(sourceLink).join(SOURCE_LIST_SEP)})`;
      // srcNote: an AI-authored precision note on the derivation (green).
      const note = h.srcNote === undefined ? "" : ` <span class="ai-text">${escHtml(h.srcNote)}</span>`;
      return `<tr><td>${escHtml(helmerLabel(hh))}</td><td>${escHtml(m.cardLabel)}</td><td class="num">${fmtMiles(h.lo)}</td><td class="num">${fmtMiles(h.hi)}</td><td class="derivation">${derivation}${note}</td></tr>`;
    })).join("");
  return `
    <h3>Specific human benchmark derivations</h3>
    <p>
Sources: Kusano & Scanlon, Waymo's safety impact page, FARS.
This differs from Waymo's location-adjusted safety-impact methodology.
The all-incidents comparison is broader than Waymo's surface-street, injury-focused numbers.
    </p>
    <div class="table-wrap"><table class="source-table">
      <thead><tr><th>Cohort</th><th>Metric</th><th class="num">Low MPI</th><th class="num">High MPI</th><th>Derivation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// A re-render replaces the controls it draws, so the control a keyboard user
// had just operated was detached and focus fell to <body>: the next Tab
// started the group over, and a second Enter on a sort header or a second
// arrow key in a radio group did nothing (until 2026-10-03). A control a
// re-render replaces carries data-focus-key, a name unique on the page that
// the re-render gives its replacement too; this hands focus from the one to
// the other. Keyed are the helmer checkboxes, the metric select, the date
// sliders, the incident filters, sort headers and narrative toggles, the
// growth radios, and the market links, status and refresh button. Until
// 2026-10-04 the sliders, the narratives and the market links had no key, so
// focus on a market link fell to <body> whenever a market refresh landed
// (audit #17). Focus on an element with no key (a chart mark, a card's
// tooltip target) still falls to <body> when its re-render replaces it; focus
// on an element the render does not replace stays where it is.
//
// A helmer checkbox, a sort header's button or an incident filter that a
// click operates takes focus before the page redraws around it, as Chromium
// and Firefox give a clicked button or labelled checkbox focus themselves.
// WebKit gives a clicked control no focus and drops the focus it had to
// <body> on the mousedown, before any redraw, so in WebKit a click on a
// helmer label, a sort header or a filter lost the focus a slider or a
// narrative held (audit #17); and a filter that hid the focused narrative's
// row would leave nothing to hand focus to.
//
// The replacement shows a focus ring exactly when the reader's last input was
// a key press (lastInputWasKey), as :focus-visible does for focus a reader
// gives. Left to each engine's own guess for a script's focus(), WebKit drew a
// ring on a helmer checkbox whose label a mouse clicked or a finger tapped,
// and Chromium and Firefox drew none (found in review, 2026-10-05). Nor can
// the replaced control's own :focus-visible be passed on: WebKit does not set
// it on a radio an arrow key moves to, and the growth radios lost their ring.
function rerenderKeepingFocus(render) {
  const key = document.activeElement.getAttribute("data-focus-key");
  render();
  if (key === null) return;
  const matches = document.querySelectorAll(`[data-focus-key="${key}"]`);
  assert(matches.length === 1, "a re-render must leave exactly one control with the focused control's key", {key, found: matches.length});
  matches[0].focus({preventScroll: true, focusVisible: lastInputWasKey});
}

// Whether the reader's last input was a key press (true) or a pointer's
// press (false: a mouse button, a finger or a pen), recorded before the
// page's own handlers see it (capture phase). rerenderKeepingFocus gives a
// focus ring by it.
let lastInputWasKey = false;
function initInputModality() {
  document.addEventListener("keydown", () => { lastInputWasKey = true; }, true);
  document.addEventListener("pointerdown", () => { lastInputWasKey = false; }, true);
}

// What the checked helmers and the selected metric decide: the legends (the
// CI fan's stripes are the checked helmers'), the charts, the cards and the
// headings, and the URL. The month series, the date slider, the sanity
// section and the incident browser depend on neither (selection-redraw.qual
// rebuilds them under every helmer and metric), so a checkbox or the metric
// select leaves them as they are. Until 2026-10-05 either change rebuilt
// them all (buildMonthlyViews): 0.5-0.8 s a click, ~2.3 s on a phone-class
// CPU, and every expanded narrative collapsed (audit #24).
function redrawSelection() {
  renderMonthlyLegends();
  renderWindowedViews();
  syncUrlState();
}

function renderMonthlyLegends() {
  byId("month-legend-mpi-helmers").innerHTML = ALL_HELMERS.map(helmer => `
    <label class="month-legend-item month-helmer-toggle" for="${monthHelmerToggleId(helmer)}">
      <input type="checkbox" id="${monthHelmerToggleId(helmer)}" data-focus-key="helmer-${helmer}" ${monthHelmerEnabled[helmer] ? "checked" : ""}>
      <span class="month-chip" style="background:${HELMER_COLORS[helmer]}"></span>${helmerLabel(helmer)}
    </label>
  `).join("");
  for (const helmer of ALL_HELMERS) {
    const input = byId(monthHelmerToggleId(helmer));
    input.addEventListener("change", () => {
      input.focus({preventScroll: true}); // the operated control takes focus (see rerenderKeepingFocus)
      monthHelmerEnabled[helmer] = input.checked;
      rerenderKeepingFocus(redrawSelection);
    });
  }

  byId("month-legend-mpi-lines").innerHTML = `
    <label class="month-legend-item metric-select" for="month-metric-select">Miles per
      <select id="month-metric-select" data-focus-key="metric">${METRIC_DEFS.map(metric =>
        `<option value="${metric.key}"${metric.key === selectedMetricKey ? " selected" : ""}>${metric.blank}</option>`
      ).join("")}</select>
      incident</label>
  `;
  byId("month-metric-select").addEventListener("change", e => {
    selectedMetricKey = e.target.value;
    rerenderKeepingFocus(redrawSelection);
  });

  // CI fan legend: multi-stripe swatches showing each helmer's color at the
  // band's rendered opacity level for each CI width (50%, 80%, 95%).
  const fanHelmers = includedHelmers();
  const fanLevels = CI_FAN_LEVELS.map((level, i) => {
    // The bands draw widest-first at 0.10 * (1 + li * 0.5) (li = reversed
    // index: 0.10 / 0.15 / 0.20 for 95 / 80 / 50%) and NEST, so the region a
    // viewer sees for the 50% band is the composite of all three layers. The
    // swatch shows that composite alpha, 1 - prod(1 - o), not the single layer
    // (which read about half as dark as the chart until 2026-09-04).
    const li = CI_FAN_LEVELS.length - 1 - i;
    let unseen = 1;
    for (let j = 0; j <= li; j++) unseen *= 1 - 0.10 * (1 + j * 0.5);
    const opacity = (1 - unseen).toFixed(3);
    const pct = Math.round(level * 100);
    // Build vertical stripe gradient from helmer colors
    const stripeW = 100 / fanHelmers.length;
    const stops = fanHelmers.map((c, j) => {
      const color = HELMER_COLORS[c];
      return `${color} ${(j * stripeW).toFixed(1)}% ${((j + 1) * stripeW).toFixed(1)}%`;
    }).join(", ");
    const grad = `linear-gradient(to right, ${stops})`;
    // The error bars draw the widest CI level, so its legend item also gets
    // the bar glyph.
    const barKey = i === CI_FAN_LEVELS.length - 1 ? '<span class="errbar-key"></span>' : "";
    return `
      <span class="month-legend-item">
        <span class="ci-fan-swatch" style="background:${grad};opacity:${opacity}"></span>${barKey}${pct}% CI
      </span>`;
  });
  byId("month-legend-ci-fan").innerHTML = fanLevels.join("");

  // Per-helmer VMT view toggle: monthly vs cumulative VMT. (Rule-8 deviation:
  // "Monthly VMT"/"Cumulative VMT" are the user's terms, kept English to match
  // the other VMT labels.) Lives outside renderWindowedViews so toggling it
  // doesn't rebuild the radios.
  byId("vmt-mode-toggle").innerHTML = `
    <label class="month-legend-item month-helmer-toggle" for="vmt-mode-monthly">
      <input type="radio" name="vmt-mode" id="vmt-mode-monthly" ${!vmtCumulative ? "checked" : ""}>
      Monthly VMT
    </label>
    <label class="month-legend-item month-helmer-toggle" for="vmt-mode-cumulative">
      <input type="radio" name="vmt-mode" id="vmt-mode-cumulative" ${vmtCumulative ? "checked" : ""}>
      Cumulative VMT
    </label>
  `;
  byId("vmt-mode-monthly").addEventListener("change", () => { vmtCumulative = false; renderWindowedViews(); syncUrlState(); });
  byId("vmt-mode-cumulative").addEventListener("change", () => { vmtCumulative = true; renderWindowedViews(); syncUrlState(); });
}

// A range thumb is var(--thumb) wide (style.css: 18px, 26px under a coarse
// pointer), so its centre travels from half that to the slider's width less
// half that; sliderAt maps a fraction of the series into that inset span, and
// sliderSpan a fraction's length. The default-start tick and the fill share
// them, so the fill runs from thumb centre to thumb centre (until 2026-10-03
// the fill ran on raw percentages and stuck 4px out past the thumb in a
// one-month window at either end of the series; audit #66). The width is the
// stylesheet's, read by the browser, so a thumb resized there moves the fill
// with it (until 2026-10-05 this file held its own 18, audit #67).
function sliderAt(frac) {
  return `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${frac.toFixed(4)})`;
}
function sliderSpan(frac) {
  return `calc((100% - var(--thumb)) * ${frac.toFixed(4)})`;
}

function renderDateRangeControls() {
  const container = byId("date-range-controls");
  const months = fullMonthSeries.months;
  const maxIdx = months.length - 1;
  const endIdx = Math.min(
    monthRangeEnd === Infinity ? maxIdx : monthRangeEnd, maxIdx);
  const startIdx = Math.min(monthRangeStart, endIdx);
  // A month's place along the slider (a one-month series has one place).
  const frac = i => maxIdx > 0 ? i / maxIdx : 0;
  const rangeLabel = startIdx === endIdx
    ? months[startIdx]
    : `${months[startIdx]} \u2014 ${months[endIdx]}`;
  // Tick mark at DEFAULT_START_MONTH (the default analysis-window start —
  // Tesla's VMT series begins there; Zoox's runs from 2024-05)
  const defIdx = months.indexOf(DEFAULT_START_MONTH);
  const defFrac = defIdx >= 0 && maxIdx > 0 ? defIdx / maxIdx : -1;
  container.innerHTML = `
    <div class="date-range-header">
      <span class="date-range-label">${rangeLabel}</span>
    </div>
    <div class="date-range-slider">
      <div class="date-range-track"></div>
      <div class="date-range-fill" id="date-range-fill" style="left:${sliderAt(frac(startIdx))};width:${sliderSpan(frac(endIdx) - frac(startIdx))}"></div>
      ${defFrac >= 0 ? `<div class="date-range-tick" style="left:${sliderAt(defFrac)}">
        <div class="date-range-tick-line"></div>
        <div class="date-range-tick-label">${DEFAULT_START_MONTH}</div>
      </div>` : ""}
      <span class="date-range-end-label min">${months[0]}</span>
      <span class="date-range-end-label max">${months[maxIdx]}</span>
      <input type="range" class="date-range-input date-range-input-min" id="date-range-min" data-focus-key="range-min"
             min="0" max="${maxIdx}" value="${startIdx}" step="1"
             aria-label="Start month" aria-valuetext="${months[startIdx]}">
      <input type="range" class="date-range-input date-range-input-max" id="date-range-max" data-focus-key="range-max"
             min="0" max="${maxIdx}" value="${endIdx}" step="1"
             aria-label="End month" aria-valuetext="${months[endIdx]}">
    </div>
  `;
  const minInput = byId("date-range-min");
  const maxInput = byId("date-range-max");
  const fill = byId("date-range-fill");
  const label = container.querySelector(".date-range-label");
  // The window the two thumbs set: the start thumb's month to the end
  // thumb's, which the input handlers below keep in that order.
  function thumbWindow() {
    const a = Number(minInput.value), b = Number(maxInput.value);
    assert(a <= b, "date slider: the start thumb is past the end thumb", {a, b});
    return [a, b];
  }
  // While the two thumbs share a month, the one drawn on top is the one a
  // pointer grabs, and it must be one that can still move outward: the start
  // thumb in the slider's right half (it can move left), the end thumb in the
  // left half (style.css: start z-index 2, end 3). With crossing gone (below),
  // the end thumb on top of a window collapsed onto the last month could move
  // neither way, and nothing else on the slider reaches the start thumb.
  function stackThumbs() {
    minInput.style.zIndex = Number(minInput.value) > maxIdx / 2 ? "4" : "2";
  }
  stackThumbs();
  // The slider's views follow its thumbs in the next animation frame
  // (drawFrame): the charts and cards (renderWindowedViews) as the thumbs
  // move, and, on a release or a key press, the incident browser, the sanity
  // section and the URL (the commit), which a drag in progress must not
  // interrupt. A frame draws a window the charts do not already show and
  // commits one the commit's views do not, and however many input events
  // arrive between two frames, the next one does each at most once, for the
  // window the thumbs then hold. Until 2026-10-05 the input event drew on the
  // next frame and the change event committed at once, drawing again: a key
  // press drew the charts twice with identical markup and computed the
  // window's summary rows six times, a drag's release redrew the window its
  // last frame had drawn, and a held key's ~30 presses a second queued a
  // ~0.45 s commit each (~1.9 s at 4x CPU throttling), so the page went on
  // working ~13 s after the key came up (audit #23). Without
  // requestAnimationFrame (the quals' DOM stubs) a frame runs at once.
  // The address bar is written once per commit, after every view: WebKit
  // allows 100 history.replaceState calls in 10 s, and until 2026-10-04 a
  // commit wrote it twice, the first time before the sanity checks and the
  // incident browser were rebuilt, so on a held arrow key the 101st write
  // threw and left both on an older window (audit #10).
  let shownWindow = `${startIdx}.${endIdx}`;   // the charts' and cards' window
  let committedWindow = shownWindow;           // the incident browser's, the sanity section's and the URL's
  let commitWanted = false;
  let framePending = false;
  const nextFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : fn => fn();
  // A frame takes up both requests before its work, so a throw in that work
  // (WebKit's SecurityError past 100 history.replaceState calls in 10 s,
  // audit #10) leaves neither pending: until 2026-10-05 (review) a commit
  // asked for before such a throw stayed asked for, and in WebKit past the
  // limit every frame of a later drag rebuilt the incident browser and the
  // sanity section.
  function drawFrame() {
    framePending = false;
    const [a, b] = thumbWindow();
    const thumbs = `${a}.${b}`;
    const commit = commitWanted && thumbs !== committedWindow;
    commitWanted = false;
    if (thumbs !== shownWindow) {
      shownWindow = thumbs;
      [monthRangeStart, monthRangeEnd] = [a, b];
      renderWindowedViews();
    }
    if (commit) {
      committedWindow = thumbs;
      buildSanityChecks();
      buildBrowser();
      syncUrlState();
    }
  }
  function requestFrame() {
    if (framePending) return;
    framePending = true;
    nextFrame(drawFrame);
  }
  // A release or a key press: commit in the next frame.
  function requestCommit() {
    commitWanted = true;
    requestFrame();
  }
  // A thumb moved: the slider itself follows at once, its views in the next
  // frame. A slider's value is an index into the month series; screen readers
  // announce the month instead (they read "47" until 2026-10-03).
  function updateLive() {
    minInput.setAttribute("aria-valuetext", months[Number(minInput.value)]);
    maxInput.setAttribute("aria-valuetext", months[Number(maxInput.value)]);
    const [a, b] = thumbWindow();
    fill.style.left = sliderAt(frac(a));
    fill.style.width = sliderSpan(frac(b) - frac(a));
    label.textContent = a === b ? months[a] : `${months[a]} \u2014 ${months[b]}`;
    stackThumbs();
    requestFrame();
  }
  // The thumbs cannot cross (the WAI-ARIA multi-thumb slider): a moved thumb
  // stops at the other, so "Start month" always holds the window's first
  // month and "End month" its last. Until 2026-10-04 they crossed, and after
  // a crossing "End month" announced the window's start and its arrow keys
  // moved it (audit #14).
  minInput.addEventListener("input", () => {
    minInput.value = String(Math.min(Number(minInput.value), Number(maxInput.value)));
    updateLive();
  });
  maxInput.addEventListener("input", () => {
    maxInput.value = String(Math.max(Number(maxInput.value), Number(minInput.value)));
    updateLive();
  });
  // A release commits on its pointerup as well as on the change event:
  // WebKit fires no change event for a drag that ends where the clamp above
  // stopped the thumb (it measures a change from the value a script last
  // assigned, here the clamp's), and until 2026-10-04 (reviewer) such a
  // release left the incident browser, the sanity section and the URL on the
  // old window while the slider and the charts showed the new one. Chromium
  // and Firefox fire both events, so a frame commits only a window the
  // commit's views do not already show (committedWindow: this render's, or
  // the last commit's).
  for (const input of [minInput, maxInput]) {
    input.addEventListener("change", requestCommit);
    input.addEventListener("pointerup", requestCommit);
  }

  // Drag the filled middle to slide the whole window at fixed width. The
  // endpoint thumbs (above, z-index 2/3) still drag independently.
  fill.style.cursor = "grab";
  let dragX = null, dragA = 0, dragB = 0;
  fill.addEventListener("pointerdown", (e) => {
    if (maxIdx <= 0) return;
    dragX = e.clientX;
    [dragA, dragB] = thumbWindow();
    fill.setPointerCapture(e.pointerId);
    fill.style.cursor = "grabbing";
    e.preventDefault();
  });
  fill.addEventListener("pointermove", (e) => {
    if (dragX === null) return;
    const sliderW = fill.parentElement.getBoundingClientRect().width;
    const delta = Math.round(((e.clientX - dragX) / sliderW) * maxIdx);
    const width = dragB - dragA;
    const a = Math.max(0, Math.min(dragA + delta, maxIdx - width));
    minInput.value = String(a);
    maxInput.value = String(a + width);
    updateLive();
  });
  const endDrag = () => {
    if (dragX === null) return;
    dragX = null;
    fill.style.cursor = "grab";
    requestCommit();
  };
  fill.addEventListener("pointerup", endDrag);
  fill.addEventListener("pointercancel", endDrag);
}

// Renders only the views that depend on the selected date window. Used both by
// the full rebuild and by the live slider drag, which re-slices the
// already-computed fullMonthSeries without rebuilding the slider, incident
// table, or URL (so an in-progress drag isn't interrupted).
function renderWindowedViews() {
  setDateWindow();
  drawWindowedViews();
}

// The selected date window as state: activeSeries, and the section headings
// that name it. Nothing here needs the charts' column (chartViewW), so init
// and buildMonthlyViews set the window before building the views that are
// not charts, and draw the charts last (audit 2026-10-04 #32).
function setDateWindow() {
  if (monthRangeStart === -1) { // resolve default start month on first build
    const idx = fullMonthSeries.months.indexOf(DEFAULT_START_MONTH);
    assert(idx >= 0, "DEFAULT_START_MONTH is not in the VMT month series",
      {DEFAULT_START_MONTH, first: fullMonthSeries.months[0]});
    monthRangeStart = idx;
  }
  const maxIdx = fullMonthSeries.months.length - 1;
  // Anti-Postel: a window index past the series fails here instead of being
  // silently narrowed to a one-month window (which it was until 2026-09-04).
  // Since 2026-10-03 d= names months and the URL parser rejects any month
  // outside the series, so a link can no longer get here; only code that
  // sets the indices wrongly can.
  assert(monthRangeStart <= maxIdx && (monthRangeEnd === Infinity || monthRangeEnd <= maxIdx),
    "date range index past the VMT month series", {monthRangeStart, monthRangeEnd, maxIdx});
  const endIdx = monthRangeEnd === Infinity ? maxIdx : monthRangeEnd;
  const startIdx = Math.min(monthRangeStart, endIdx);
  const isFullRange = startIdx === 0 && endIdx === maxIdx;
  byId("month-panel").classList.toggle("date-filtered", !isFullRange);
  activeSeries = isFullRange
    ? fullMonthSeries
    : sliceSeries(fullMonthSeries, startIdx, endIdx);
  // Section headers carry the (dynamic) chart titles so they stay visible when
  // a section is collapsed. Exact strings preserved from the former chart h3s.
  const metric = selectedMonthMetric();
  const {start, end} = seriesMonthBounds(activeSeries);
  byId("mpi-heading").textContent = `${metric.label} over time`;
  byId("dist-heading").textContent = `${metric.label} probability distributions using data from ${start} to ${end}`;
}

// The window's charts (drawn at chartViewW) and summary cards.
function drawWindowedViews() {
  byId("chart-mpi-all").innerHTML = renderAllHelmersMpiChart(activeSeries);
  // Pools the slider-selected window; narrow the date range to weight recent
  // data. The monthly chart above shows how the rate moves over time.
  byId("chart-distributions").innerHTML = renderDistributionChart(activeSeries);
  byId("mpi-summary-cards").innerHTML = `<div class="mpi-cards">${renderMpiSummaryCards(activeSeries)}</div>`;
  byId("chart-helmer-series").innerHTML = ADS_HELMERS
    .filter(helmer => monthHelmerEnabled[helmer])
    .map(helmer => `
    <div class="month-chart">
      <h3>${helmer}</h3>
      ${renderHelmerMonthlyChart(activeSeries, helmer)}
    </div>
  `).join("");
}

function buildMonthlyViews() {
  fullMonthSeries = monthSeriesData();
  const fullSummary = windowSummaryRows(fullMonthSeries);
  for (const row of fullSummary) {
    if (row.vmtBest === 0) continue; // helmer has no data in incident window
    assert(row.incTotal > 0, "full-series total incidents must be positive", {helmer: row.helmer});
    assert(row.incNonstationary > 0, "full-series nonstationary incidents must be positive", {helmer: row.helmer});
    assert(row.incRoadwayNonstationary > 0, "full-series roadway nonstationary incidents must be positive", {helmer: row.helmer});
  }
  // Every view that is not a chart first, so a chart that cannot draw leaves
  // the rest of the page working (audit 2026-10-04 #32); the address bar
  // once, after every view (renderDateRangeControls' comment on drawFrame).
  setDateWindow();
  renderMonthlyLegends();
  renderDateRangeControls();
  buildBrowser();
  buildSanityChecks();
  drawWindowedViews();
  syncUrlState();
}

// --- Fault fraction data ---

function buildFaultDataFromIncidents(rows) {
  const data = {};
  for (const row of rows) {
    assert(typeof row.reportId === "string" && row.reportId !== "",
      "incident missing reportId for fault mapping");
    // fault === null never occurs in a passing build (fault-coverage.qual
    // requires a judgment row per incident); the skip only keeps this loader
    // from crashing before that qual can report the gap.
    if (row.fault === null) continue;
    assert(typeof row.fault === "object",
      "incident fault must be null or object", {reportId: row.reportId});
    const faultfrac = Number(row.fault.faultfrac);
    assert(Number.isFinite(faultfrac) && faultfrac >= 0 && faultfrac <= 1,
      "incident faultfrac out of range", {reportId: row.reportId, faultfrac});
    assert(typeof row.fault.reasoning === "string",
      "incident fault reasoning invalid", {reportId: row.reportId});
    assert(data[row.reportId] === undefined, "duplicate reportId in incidents", {reportId: row.reportId});
    data[row.reportId] = {faultfrac, reasoning: row.fault.reasoning};
  }
  return data;
}

function faultFrac(reportId) {
  const fd = faultData[reportId];
  return fd ? fd.faultfrac : null;
}

function faultColor(frac) {
  // Green (0) -> Yellow (0.5) -> Red (1)
  if (frac <= 0.5) {
    const r = Math.round(255 * (frac / 0.5));
    return `rgb(${r}, 180, 60)`;
  }
  const g = Math.round(180 * (1 - (frac - 0.5) / 0.5));
  return `rgb(220, ${g}, 50)`;
}

function faultTooltip(inc) {
  const fd = faultData[inc.reportId];
  if (!fd) return "";
  const lines = [`${fd.faultfrac.toFixed(2)} — ${fd.reasoning}`];
  if (inc.svHit || inc.cpHit) {
    lines.push(`${inc.svHit || "n/a"} \u{1F4A5} ${inc.cpHit || "n/a"}`);
  }
  return lines.join("\n");
}


// --- Incident Browser ---

let activeFilter = "All";
let sortCol = null;   // column key or null
let sortAsc = true;

// "City, ST", or "Unknown" for a filing with no city or state (data/slurp.py
// stops on one until LOCATION_OVERRIDE gives the narrative's place). One
// definition for the incident browser's cell, its Location sort and the
// Geography table, so a location-less filing never shows as a bare ", ".
function incidentLocation(r) {
  return r.city && r.state ? (r.city + ", " + r.state) : "Unknown";
}

const SORT_COLUMNS = [
  {key: "helmer",  val: r => r.helmer},
  {key: "date",     val: r => monthKeyFromIncidentLabel(r.date)},
  {key: "location", val: incidentLocation},
  {key: "crashWith",val: r => r.crashWith},
  {key: "speed",    val: r => r.speed !== null ? r.speed : -1},
  {key: "fault",    val: r => { const f = faultFrac(r.reportId); return f !== null ? f : -1; }},
  {key: "severity", val: r => SEVERITY_RANK[r.severity] ?? -1},
  {key: "narrative", val: r => r.narrative || ""},
];
const SORT_COLUMN_KEYS = SORT_COLUMNS.map(col => col.key);
const URL_STATE_KEYS = {
  filter: "f",
  sort: "s",
  asc: "a",
  helmers: "c",
  metrics: "m",
  dateRange: "d",
  collapsed: "x",
  cumulative: "v", // per-helmer VMT charts in cumulative mode (absent = monthly)
  growth: "g",     // growth-extrapolator metric when not the default "fleet"
};
const URL_STATE_REQUIRED = ["f", "s", "a", "c", "m"];
const URL_STATE_SORT_NONE = "-";

function enabledKeyString(enabledByKey, orderedKeys) {
  return orderedKeys.filter(key => enabledByKey[key]).join(".");
}

// A dotted key list (c=, x=) as an enabled-by-key map. `check` is told
// whether the list is readable (no key twice, every key in orderedKeys) and
// rejects it when it is not.
function parseEnabledKeyString(raw, orderedKeys, check) {
  const keys = raw === "" ? [] : raw.split(".");
  const unique = new Set(keys);
  check(unique.size === keys.length && keys.every(key => orderedKeys.includes(key)));
  return Object.fromEntries(orderedKeys.map(key => [key, unique.has(key)]));
}

// d= is the window's first and last month, dotted like the lists in c= and
// x= (d=2025-07.2025-12), and is omitted for the default window. Until
// 2026-10-03 it held indices into the month series, whose first month moved
// twice (2025-06 -> 2022-11 on 2026-03-16, -> 2021-07 on 2026-06-17), so an
// old link such as d=1-6 silently opened a different window. That index form
// is now rejected, like any other value this page cannot read.
const DATE_RANGE_URL_RE = /^(\d{4}-\d{2})\.(\d{4}-\d{2})$/;

function encodeUiStateQuery() {
  const params = new URLSearchParams();
  params.set(URL_STATE_KEYS.filter, activeFilter);
  params.set(URL_STATE_KEYS.sort, sortCol === null ? URL_STATE_SORT_NONE : sortCol);
  params.set(URL_STATE_KEYS.asc, sortAsc ? "1" : "0");
  params.set(URL_STATE_KEYS.helmers, enabledKeyString(monthHelmerEnabled, ALL_HELMERS));
  params.set(URL_STATE_KEYS.metrics, selectedMetricKey);
  const months = vmtMonthList();
  const latest = months[months.length - 1];
  const first = monthRangeStart === -1 ? DEFAULT_START_MONTH : months[monthRangeStart];
  const last = monthRangeEnd === Infinity ? latest : months[monthRangeEnd];
  assert(months.includes(first) && months.indexOf(first) <= months.indexOf(last),
    "date range outside the VMT month series", {monthRangeStart, monthRangeEnd, months: months.length});
  if (first !== DEFAULT_START_MONTH || last !== latest) {
    params.set(URL_STATE_KEYS.dateRange, `${first}.${last}`);
  }
  const collapsed = enabledKeyString(sectionCollapsed, SECTION_IDS);
  if (collapsed !== "") params.set(URL_STATE_KEYS.collapsed, collapsed);
  // Two render-affecting toggles that a shared link used to drop (2026-09-04):
  // encoded only when non-default, so default links keep their old shape.
  if (vmtCumulative) params.set(URL_STATE_KEYS.cumulative, "1");
  if (selectedGrowthMetric !== "fleet") params.set(URL_STATE_KEYS.growth, selectedGrowthMetric);
  return params.toString();
}

// A link whose own URL state this page cannot read. `rejected` lists the
// offending parameters, each as [key, value] as the link gave it, or [key]
// for a required key the link left out; `unknownKeys` lists the foreign keys
// stripped alongside. loadUiStateFromLocation names both in the banner.
class UrlStateError extends Error {
  constructor(msg, rejected, unknownKeys) {
    super(`${msg} ${JSON.stringify({rejected, unknownKeys})}`);
    this.rejected = rejected;
    this.unknownKeys = unknownKeys;
  }
}

function rejectUrlState(msg, rejected, unknownKeys) {
  throw new UrlStateError(msg, rejected, unknownKeys);
}

// Reads the page's own keys strictly. Keys the page does not own are not
// state (a Facebook fbclid took the whole page down on 2026-09-07): they are
// stripped here and returned so the caller can report them. All or nothing:
// every owned key is read before any state is assigned, so a rejected link
// (a UrlStateError) leaves the state as it was.
// The query goes to URLSearchParams as given: it drops one leading "?"
// itself, so a doubled "??f=..." keeps its stray "?" in the first key ("?f",
// a foreign key, leaving f missing). Until 2026-10-04 this function dropped a
// "?" first, and such a link silently opened as if it had one (audit #75).
function applyUiStateQuery(queryString) {
  const params = new URLSearchParams(queryString);
  const expectedKeys = Object.values(URL_STATE_KEYS);
  const expectedSet = new Set(expectedKeys);
  const unknownKeys = [...new Set(params.keys())].filter(key => !expectedSet.has(key));
  unknownKeys.forEach(key => params.delete(key));
  if ([...params.keys()].length === 0) return unknownKeys;
  // A rejection names the offending parameter(s) as the link gave them.
  const given = key => params.getAll(key).map(value => [key, value]);
  const check = (ok, msg, rejected) => ok || rejectUrlState(msg, rejected, unknownKeys);

  for (const key of new Set(params.keys())) {
    check(params.getAll(key).length === 1, "Duplicate URL state key", given(key));
  }
  const missing = URL_STATE_REQUIRED.filter(key => !params.has(key));
  check(missing.length === 0, "Missing URL state key", missing.map(key => [key]));

  const filterVal = params.get(URL_STATE_KEYS.filter);
  check(["All", ...ADS_HELMERS].includes(filterVal), "Invalid filter URL state",
    given(URL_STATE_KEYS.filter));

  const sortVal = params.get(URL_STATE_KEYS.sort);
  const nextSortCol = sortVal === URL_STATE_SORT_NONE ? null : sortVal;
  check(nextSortCol === null || SORT_COLUMN_KEYS.includes(nextSortCol), "Invalid sort URL state",
    given(URL_STATE_KEYS.sort));

  const ascVal = params.get(URL_STATE_KEYS.asc);
  check(ascVal === "0" || ascVal === "1", "Invalid sort direction URL state",
    given(URL_STATE_KEYS.asc));

  const nextHelmers = parseEnabledKeyString(params.get(URL_STATE_KEYS.helmers), ALL_HELMERS,
    ok => check(ok, "Invalid helmers URL state", given(URL_STATE_KEYS.helmers)));

  const metricsVal = params.get(URL_STATE_KEYS.metrics);
  // One metric key. The multi-metric "a.b" form was retired with the radio
  // buttons (54ebcb8); its fallback silently reduced such a URL to the first
  // key in METRIC_KEYS order and rewrote the address bar, the last DWIM path
  // in this parser (removed 2026-09-26).
  check(METRIC_KEYS.includes(metricsVal), "Invalid metrics URL state",
    given(URL_STATE_KEYS.metrics));

  // The optional keys: absent leaves the current value.
  let nextRange = [monthRangeStart, monthRangeEnd];
  if (params.has(URL_STATE_KEYS.dateRange)) {
    const hit = DATE_RANGE_URL_RE.exec(params.get(URL_STATE_KEYS.dateRange));
    check(hit !== null, "Invalid date range URL state format", given(URL_STATE_KEYS.dateRange));
    const months = vmtMonthList();
    nextRange = [months.indexOf(hit[1]), months.indexOf(hit[2])];
    check(nextRange[0] >= 0 && nextRange[1] >= nextRange[0],
      "Invalid date range URL state months (two months of the series, first <= last)",
      given(URL_STATE_KEYS.dateRange));
  }
  let nextCumulative = vmtCumulative;
  if (params.has(URL_STATE_KEYS.cumulative)) {
    check(params.get(URL_STATE_KEYS.cumulative) === "1", "Invalid cumulative-VMT URL state",
      given(URL_STATE_KEYS.cumulative));
    nextCumulative = true;
  }
  let nextGrowth = selectedGrowthMetric;
  if (params.has(URL_STATE_KEYS.growth)) {
    nextGrowth = params.get(URL_STATE_KEYS.growth);
    check(GROWTH_METRIC_KEYS.includes(nextGrowth), "Unknown growth-metric URL state",
      given(URL_STATE_KEYS.growth));
  }
  let nextCollapsed = sectionCollapsed;
  if (params.has(URL_STATE_KEYS.collapsed)) {
    nextCollapsed = {
      ...sectionCollapsed,
      ...parseEnabledKeyString(params.get(URL_STATE_KEYS.collapsed), SECTION_IDS,
        ok => check(ok, "Invalid collapsed-sections URL state", given(URL_STATE_KEYS.collapsed))),
    };
  }

  activeFilter = filterVal;
  sortCol = nextSortCol;
  sortAsc = ascVal === "1";
  monthHelmerEnabled = {...monthHelmerEnabled, ...nextHelmers};
  selectedMetricKey = metricsVal;
  [monthRangeStart, monthRangeEnd] = nextRange;
  vmtCumulative = nextCumulative;
  selectedGrowthMetric = nextGrowth;
  sectionCollapsed = nextCollapsed;
  return unknownKeys;
}

function canSyncUrlState() {
  return typeof window === "object" &&
    window !== null &&
    window.location !== undefined &&
    typeof window.location.search === "string" &&
    typeof window.location.pathname === "string" &&
    typeof window.location.hash === "string" &&
    window.history !== undefined &&
    typeof window.history.replaceState === "function" &&
    typeof URLSearchParams === "function";
}

// How a URL parameter's name or value reads in the banner: as given, except
// that the empty string shows as '' (a key-less "=x" used to leave a blank
// between the dashes).
function urlBannerToken(text) {
  return text === "" ? "''" : text;
}

function loadUiStateFromLocation() {
  if (!canSyncUrlState()) return;
  // A link whose own parameters this page cannot read (an old or hand-edited
  // one: c=Humans..., a partial ?m=injury, an index-form d=1-6) gets the
  // default view, the rejected parameters named in the banner, and the
  // address bar rewritten from state, the path foreign keys already take.
  // Until 2026-10-03 the parser's throw stopped init and left a half-drawn
  // page with no visible error. This runs once, at init, while the state
  // holds its defaults, and the parser assigns nothing when it rejects. Any
  // other exception is a bug and propagates.
  let unknownKeys = [];
  let rejected = [];
  try {
    unknownKeys = applyUiStateQuery(window.location.search);
  } catch (err) {
    if (!(err instanceof UrlStateError)) throw err;
    ({unknownKeys, rejected} = err);
  }
  const banner = byId("url-banner");
  // The banner tells the reader that the link carried URL parameters this
  // page does not recognize (listed by name), that they were ignored and removed
  // from the address bar, and that the page itself is unaffected.
  banner.querySelector(".banner-text").textContent =
    `Unknown URL parameter(s) -- ${unknownKeys.map(urlBannerToken).join(", ")} -- stripped.` + 
    (unknownKeys.includes('fbclid') ? " Facebook is the worst." : "");
  banner.querySelector(".banner-text").hidden = unknownKeys.length === 0;
  // Banner sentence must convey: some of
  // this page's own parameters in the link were missing or could not be read;
  // they are listed (a bare name is a required parameter the link left out,
  // name=value a value the page cannot read); the page is showing its default
  // view instead, and the address bar now carries that default view.
  banner.querySelector(".banner-rejected").textContent =
    `Some of this page's URL parameters are missing -- ${rejected.map(param => param.map(urlBannerToken).join("=")).join(", ")} -- so we're showing the default view.`;
  banner.querySelector(".banner-rejected").hidden = rejected.length === 0;
  banner.hidden = unknownKeys.length + rejected.length === 0;
  byId("url-banner-dismiss").addEventListener("click", () => { banner.hidden = true; });
  // The strip: the address bar is rewritten from state, which never carries
  // foreign keys.
  syncUrlState();
}

function syncUrlState() {
  if (!canSyncUrlState()) return;
  // The fragment rides along: a #sec-... link keeps naming its section, and
  // the browser's own scroll to it at load then lands there. Dropping it
  // (until 2026-10-03) left Chromium and WebKit at the top of the page.
  window.history.replaceState(null, "",
    `${window.location.pathname}?${encodeUiStateQuery()}${window.location.hash}`);
}

function applyCollapsedState() {
  for (const id of SECTION_IDS) {
    const sec = byId("sec-" + id);
    if (sec) {
      sec.classList.toggle("collapsed", sectionCollapsed[id]);
      sec.querySelector(".sec-toggle").setAttribute("aria-expanded", String(!sectionCollapsed[id]));
    }
  }
}

function initCollapsibles() {
  for (const id of SECTION_IDS) {
    const sec = byId("sec-" + id);
    if (sec === null) continue;
    const head = sec.querySelector(".sec-head");
    const toggle = () => {
      sectionCollapsed[id] = !sectionCollapsed[id];
      applyCollapsedState();
      syncUrlState();
    };
    head.addEventListener("click", toggle);
    // The heading's text span becomes a role="button" in the Tab order here,
    // where it is wired, so without JavaScript the headings are plain (until
    // 2026-10-04 index.html made the spans nine inert "buttons" there, two
    // of them empty; audit #66). Enter and Space toggle it as a click does.
    // Until 2026-10-03 a collapsed section could not be opened without a
    // pointer.
    const label = head.querySelector(".sec-toggle");
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    head.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    });
  }
  applyCollapsedState();
}

const HEADER_LABELS = ["Company", "Date", "Location", "Crash with", "Speed (mph)", "Fault", "Severity", "Narrative"];
// renderHeaders loops HEADER_LABELS and indexes SORT_COLUMNS[i] in lockstep, so a
// divergence must fail loud at load, not silently misalign a header with its sort.
assert(HEADER_LABELS.length === SORT_COLUMNS.length,
  "HEADER_LABELS and SORT_COLUMNS must stay parallel",
  {labels: HEADER_LABELS.length, columns: SORT_COLUMNS.length});
// Label: it introduces the row's fault
// judgment (the judged fault fraction, the reasoning behind it, and the
// contact areas) shown under an expanded incident narrative.
const NARRATIVE_FAULT_LABEL = "Fault fraction:";
function narrativeToggleName(reportId) {
  return `Narrative of report ${reportId}`;
}

function buildBrowser() {
  const {start, end} = seriesMonthBounds(activeSeries);
  const rows = activeIncidents();
  const counts = countByHelmer(rows);
  byId("incident-browser-heading").textContent =
    `Incident browser using data from ${start} to ${end}`;
  const filterDiv = byId("filters");
  filterDiv.replaceChildren();
  const allHelmers = ["All", ...ADS_HELMERS];
  for (const label of allHelmers) {
    const btn = document.createElement("button");
    const n = label === "All" ? rows.length : (counts[label] || 0);
    const isActive = label === activeFilter;
    btn.textContent = `${label} (${fmtCount(n)})`;
    btn.className = isActive ? "active" : "";
    // The active filter is announced, not only drawn inverted.
    btn.setAttribute("aria-pressed", String(isActive));
    btn.setAttribute("data-focus-key", "filter-" + label);
    // The filter a click operates takes focus first (see rerenderKeepingFocus):
    // a filter can hide the row whose narrative holds focus, which would leave
    // no replacement to hand that focus to.
    btn.addEventListener("click", () => {
      btn.focus({preventScroll: true});
      activeFilter = label;
      rerenderKeepingFocus(buildBrowser);
      syncUrlState();
    });
    filterDiv.appendChild(btn);
  }
  renderHeaders();
  renderTable();
}

// A sortable header's text is a <button type="button"> in its th (the ARIA
// sortable-table pattern): a screen reader says it is a button, and the
// button turns Enter and Space into a click by itself. Until 2026-10-04 the
// th was the Tab stop, a column header with no control role (audit #19).
// aria-sort stays on the th, and so does the click listener, so a click
// anywhere in the cell sorts, as before.
function renderHeaders() {
  const thead = byId("incidents-head");
  const tr = document.createElement("tr");
  for (let i = 0; i < HEADER_LABELS.length; i++) {
    const th = document.createElement("th");
    const col = SORT_COLUMNS[i];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = HEADER_LABELS[i];
    button.setAttribute("data-focus-key", "sort-" + col.key);
    th.appendChild(button);
    if (sortCol === col.key) {
      th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
    }
    const sortBy = () => {
      button.focus({preventScroll: true}); // the operated control takes focus (see rerenderKeepingFocus)
      if (sortCol === col.key) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col.key;
        sortAsc = true;
      }
      rerenderKeepingFocus(() => { renderHeaders(); renderTable(); });
      syncUrlState();
    };
    th.addEventListener("click", sortBy);
    tr.appendChild(th);
  }
  thead.replaceChildren(tr);
}

function renderTable() {
  const tbody = byId("incidents-body");
  const rows = activeIncidents();
  let filtered = activeFilter === "All"
    ? [...rows]
    : rows.filter(r => r.helmer === activeFilter);

  if (sortCol !== null) {
    const colDef = SORT_COLUMNS.find(c => c.key === sortCol);
    if (colDef) {
      filtered.sort((a, b) => {
        const va = colDef.val(a);
        const vb = colDef.val(b);
        let cmp = 0;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        return sortAsc ? cmp : -cmp;
      });
    }
  }

  byId("incident-count").textContent = splur(filtered.length, "incident");

  tbody.innerHTML = "";
  for (const r of filtered) {
    const tr = document.createElement("tr");
    const isCbi = r.narrativeCbi === "Y";
    const narrativeText = isCbi
      ? "[\"Confidential Business Information\"]"
      : (r.narrative || "");
    const narrativeClass = isCbi ? "narrative-cell cbi" : "narrative-cell";

    const fault = faultFrac(r.reportId);
    const faultHtml = fault !== null
      ? `<span class="fault-bar" style="width:${Math.round(fault * 40)}px;background:${faultColor(fault)}"></span>${fault.toFixed(2)}`
      : "—";
    const faultTip = faultTooltip(r);

    // The narrative is the row's disclosure button, inside its cell
    // (role="button" on the <td> itself would take the cell out of the table's
    // structure): opening it shows the whole narrative and, under it, the
    // fault reasoning, which until 2026-10-03 only a pointer could reach (the
    // cell's tooltip). The button has a short name of its own and the
    // narrative as its description; named by the whole narrative (median 948
    // characters), every Tab read one out as a label (until 2026-10-04,
    // audit #62). The fault cell, not a Tab stop, is described by the same
    // "Fault fraction:" line (hidden until the narrative opens; a description
    // may point at hidden text): until 2026-10-04 it held a visually hidden
    // second copy of its tip, which every rebuild of the table laid out
    // (14-27% of a sort's or a filter's time; audit #26). A row's ids and its
    // focus key come from its report id, unique among the incidents
    // (buildFaultDataFromIncidents asserts it).
    const rid = escAttr(r.reportId);
    tr.innerHTML = `
      <td>${escHtml(r.helmer)}</td>
      <td class="date-cell">${escHtml(r.date)}</td>
      <td>${escHtml(incidentLocation(r))}</td>
      <td>${escHtml(r.crashWith)}</td>
      <td>${escHtml(r.speed !== null ? String(r.speed) : "?")}</td>
      <td class="fault-cell" data-tip="${escAttr(faultTip)}" aria-describedby="narr-fault-${rid}">${faultHtml}</td>
      <td>${escHtml(shortenSeverity(r.severity))}</td>
      <td class="${narrativeClass}"><span class="narrative-toggle" role="button" tabindex="0" aria-expanded="false" aria-label="${escAttr(narrativeToggleName(r.reportId))}" aria-describedby="narr-text-${rid}" data-focus-key="narrative-${rid}"><span id="narr-text-${rid}">${escHtml(narrativeText)}</span></span><span class="narrative-fault" id="narr-fault-${rid}">${NARRATIVE_FAULT_LABEL} ${escHtml(faultTip)}</span></td>
    `;
    // Click, Enter or Space expands/collapses the narrative.
    const narrativeTd = tr.querySelector(".narrative-cell");
    assert(narrativeTd !== null, "Missing narrative cell");
    const narrativeToggle = tr.querySelector(".narrative-toggle");
    const flipNarrative = () => narrativeToggle.setAttribute("aria-expanded",
      String(narrativeTd.classList.toggle("expanded")));
    // A click that ends a text selection inside the narrative selects; it
    // does not toggle. A drag across an expanded narrative, to copy it, ends
    // in a click on the cell, and until 2026-10-04 that collapsed it (audit
    // #60). A plain click collapses the selection on its mousedown, so it
    // still toggles; Enter and Space always do.
    narrativeTd.addEventListener("click", () => {
      const selection = window.getSelection();
      if (!selection.isCollapsed && selection.containsNode(narrativeTd, true)) return;
      flipNarrative();
    });
    narrativeTd.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      flipNarrative();
    });
    tbody.appendChild(tr);
  }
}

function shortenSeverity(s) {
  const rules = [
    ["Property", "Property only"],
    ["No Injur", "No injury"],
    ["Minor W/O", "Minor injury"],
    ["Minor W/", "Minor injury (hosp.)"],
    ["Moderate W/O", "Moderate injury"],
    ["Moderate W/", "Moderate injury (hosp.)"],
    // Conveys: a serious (KABCO A) injury with hospital transport, 
    // distinguished from bare "Serious".
    // Keyed on the full string, not a "Serious W/" prefix, so the dictionary-
    // defined "Serious W/O Hospitalization" sibling can't inherit "(hosp.)".
    ["Serious W/ Hospitalization", "Serious injury (hosp.)"],
    ["Serious", "Serious"],
    ["Fatal", "Fatal"],
  ];
  const hit = (s || "") && rules.find(([needle]) => s.includes(needle));
  return hit ? hit[1] : (s || "?");
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}

// What a tooltip says must reach readers without a pointer (until 2026-10-03
// only hover and tap showed it). Every [data-tip] element is a Tab stop whose
// tooltip shows on focus as on hover (initTooltips), and gives its tip to
// assistive technology in its accessible name (tipTargetAttrs, written right
// after its data-tip): an SVG mark has no text of its own, so its name is its
// tip (on a chart several companies share, after its company's label:
// seriesMarkName); an HTML target is an image named by the text it shows and
// its tip (htmlTipAttrs), its decoration (the cards' "[?]") aria-hidden. The
// incident table's fault cells are not Tab stops: each is described by its
// row's "Fault fraction:" line, which the opened narrative shows. Until
// 2026-10-04 an HTML target held its tip as visually hidden text instead: a
// generic element with no name to a screen reader (audit #63), copied along
// with the text (#61), and in the 1,228 fault cells laid out on every rebuild
// of the table (#26).
function tipTargetAttrs(name) {
  return ` tabindex="0" aria-label="${escAttr(name)}"`;
}
// An HTML tooltip target's attributes: its tip, its Tab stop, and the image
// role, which lets it carry a name (a generic span or div may not). `name` is
// the text it shows followed by its tip, or the tip alone where all it shows
// is decoration.
function htmlTipAttrs(name, tip) {
  return ` data-tip="${escAttr(tip)}" role="img"${tipTargetAttrs(name)}`;
}

// --- Sanity Checks ---

// Waymo's own published per-million-mile incident rates (waymo.com/safety/impact,
// Sep 24 2026 update; 271.3M rider-only mi through Jun 2026), used only for the
// Waymo published-rate cross-check sanity diagnostic. These are WAYMO's rates,
// not the human benchmark (that lives in METRIC_DEFS' humanMPI). Unrounded,
// from the hub's CSV3 v1 All Locations rows (0.67446 / 0.29484 / 0.011057), to
// four significant figures; until 2026-10-03 they were the page's 2-dp 0.67 /
// 0.29 / 0.01, and dividing by the rounded 0.01 showed serious-injury+ at 3.6x
// where the unrounded rate gives 3.3x (audit #8). airbag is "any vehicle" —
// comparable to our airbagAny now that the archive SV|CP drop is fixed
// (_normalize_archive_row). Keep in sync.
const WAYMO_PUBLISHED_IPMM = { injury: 0.6745, airbag: 0.2948, ssi: 0.01106 };

// Passenger-presence inference from the SGO "Were All Passengers Belted?" field
// (stored as `belted`). TWO distinct encodings mean no passenger; PAX_PRESENT
// means a passenger was aboard. Classified EXPLICITLY so a new/variant value
// fails passenger-classification.qual instead of silently defaulting to "with
// passenger" — the bug that miscounted 485 no-passenger incidents ("No
// Passengers in Vehicle" vs "Subject Vehicle - No Passenger In Vehicle").
const PAX_NONE = new Set([
  "No Passengers in Vehicle",
  "Subject Vehicle - No Passenger In Vehicle",
]);
const PAX_PRESENT = new Set([
  "Subject Vehicle - All Belted",
  "Subject Vehicle - Not Belted - see Narrative",
  "Yes",
  "No, see Narrative",
  // Not an NHTSA value: data/slurp.py's PASSENGER_OVERRIDE stores it for a
  // report whose narrative states a passenger without saying whether they were
  // belted: two Tesla reports (Tesla files its in-car safety monitor as a
  // passenger, so its own "belted" value cannot tell a rider from the monitor)
  // and Zoox 30610-15826, filed with no passenger though its narrative says
  // "An occupied Zoox autonomous vehicle".
  "Subject Vehicle - Passenger In Vehicle, Belt Use Not Stated",
]);
const PAX_UNKNOWN = new Set(["Unknown", ""]);

// The SGO pre-crash movement codes of a stationary AV. "Parked" is a code only
// Waymo files (mostly curbside pickups and drop-offs); counting "Stopped"
// alone left Waymo's 120 default-window Parked incidents out of the
// Reporting threshold table's "AV stopped" column, which read 47% beside a
// 58% "Speed = 0 mph" share until 2026-10-03 (audit #90).
const SV_STATIONARY = new Set(["Stopped", "Parked"]);

// The grayed row a company with no incidents in the window keeps in the
// incident-count tables (Passenger presence, Severity breakdown, Reporting
// threshold, Geography), as Poisson dispersion keeps one for a company with
// too few months. Until 2026-10-04 such a company had no row (at 2026-08,
// Tesla and Zoox, though both have miles there), and a window with no
// incidents left four header-only tables (audit #48). <columns> is the
// table's column count; the reason spans all but the company's.
// The reason in such a grayed row: this company has no incidents in
// the selected date window, so this table has nothing to count for it.
const NO_INCIDENTS_NOTE = "No incidents in this window.";
function noIncidentsRow(helmer, columns) {
  return `<tr class="insufficient">
      <td>${escHtml(helmer)}</td>
      <td colspan="${columns - 1}">${escHtml(NO_INCIDENTS_NOTE)}</td>
    </tr>`;
}

// The dispersion test needs at least this many of a helmer's months.
const DISPERSION_MIN_MONTHS = 3;
// The reason in a grayed Poisson-dispersion row: the window
// holds only n of this company's months (n, shown, is 0, 1 or 2), and the
// dispersion test needs at least DISPERSION_MIN_MONTHS (three).
function dispersionFewMonthsNote(n) {
  return `Months in the window: ${n}. Dispersion test needs at least ${DISPERSION_MIN_MONTHS} months.`;
}

function buildSanityChecks() {
  const rows = activeIncidents();
  const vmt = activeVmt();
  const series = activeSeries || monthSeriesData();
  const sections = [];

  // --- 1. Passenger presence (existing) ---
  // [FIGURE VINTAGE] The "~56% of VMT is revenue (P3) miles" and "44.3%"
  // deadhead figures below are CPUC data through Sep 2025 (deadhead share
  // has been falling: 51.5% in Jan 2024 -> 44.3% in Sep 2025). Refresh from
  // the CPUC quarterly filings (or Driverless Digest's CPUC analyses) when
  // new quarters land.
  const paxTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) { paxTableRows.push(noIncidentsRow(helmer, 6)); continue; }
    const withPax = helmerRows.filter(r => PAX_PRESENT.has(r.belted)).length;
    const noPax = helmerRows.filter(r => PAX_NONE.has(r.belted)).length;
    const unk = n - withPax - noPax;
    // Range: low assumes all unknowns had no passenger, high assumes all did
    const pctLo = Math.round(100 * withPax / n);
    const pctHi = Math.round(100 * (withPax + unk) / n);
    const pctStr = pctLo === pctHi
      ? `${pctLo}%`
      : `${pctLo}\u2013${pctHi}%`;
    paxTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${fmtCount(withPax)}</td>
      <td>${fmtCount(noPax)}</td>
      <td>${fmtCount(unk)}</td>
      <td>${fmtCount(n)}</td>
      <td>${pctStr}</td>
    </tr>`);
  }
  sections.push(`
<h3>Passenger presence</h3>
<p>
Note that Waymo's advertised "rider-only miles" includes so-called deadhead miles, where the car is completely empty.
Per CPUC California data, ~56% of rider-only miles have a passenger, the other ~44% being deadhead.
For our purposes, we don't care about that breakdown.
All miles without a human driver count towards Vehicle Miles Traveled (VMT) and thus towards the Miles Per Incident (MPI) denominator.
</p>
<p>
Caveat:
If the passenger-seat safety monitor (present in almost all Tesla robotaxi rides so far) is able to intervene to prevent incidents, then the true unsupervised miles per incident (MPI) for Tesla would be lower (worse) than what these graphs and data show.
But I am now almost sure that the passenger-seat safety monitors have at least not had the ability to intervene in real time at normal driving speeds.
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>With passenger</th>
        <th>No passenger</th>
        <th>Unknown</th>
        <th>Total</th>
        <th>% with passenger</th>
      </tr></thead>
      <tbody>${paxTableRows.join("")}</tbody>
    </table></div>`);

  // --- 2. Narrative redaction (CBI) ---
/* 
No redactions currently, so don't need this section; leaving it here commented
out just in case.
  const cbiTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) continue;
    const cbiCount = helmerRows.filter(r => r.narrativeCbi === "Y").length;
    const pct = Math.round(100 * cbiCount / n);
    cbiTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${cbiCount}</td>
      <td>${n - cbiCount}</td>
      <td>${n}</td>
      <td>${pct}%</td>
    </tr>`);
  }

  sections.push(`
<h3>Narrative redaction</h3>
<p>
Companies are allowed to redact details of incidents by calling them 
Confidential Business Information (CBI).
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Redacted (CBI)</th>
        <th>Full narrative</th>
        <th>Total</th>
        <th>% redacted</th>
      </tr></thead>
      <tbody>${cbiTableRows.join("")}</tbody>
    </table>`);
*/

  // --- 3. Severity breakdown ---
  const sevTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) { sevTableRows.push(noIncidentsRow(helmer, 7)); continue; }
    const propDmg = helmerRows.filter(r =>
      !INJURY_SEVERITIES.has(r.severity) &&
      !UNKNOWN_SEVERITIES.has(r.severity)).length;
    const injOnly = helmerRows.filter(r =>
      INJURY_SEVERITIES.has(r.severity) &&
      !HOSPITALIZATION_SEVERITIES.has(r.severity)).length;
    const hospOnly = helmerRows.filter(r =>
      HOSPITALIZATION_SEVERITIES.has(r.severity) &&
      r.severity !== "Fatality").length;
    const fatal = helmerRows.filter(r => r.severity === "Fatality").length;
    const sevUnk = helmerRows.filter(r =>
      UNKNOWN_SEVERITIES.has(r.severity)).length;
    sevTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${fmtCount(propDmg)} (${escHtml(fmtShare(propDmg, n))})</td>
      <td>${fmtCount(injOnly)} (${escHtml(fmtShare(injOnly, n))})</td>
      <td>${fmtCount(hospOnly)} (${escHtml(fmtShare(hospOnly, n))})</td>
      <td>${fmtCount(fatal)} (${escHtml(fmtShare(fatal, n))})</td>
      <td>${fmtCount(sevUnk)} (${escHtml(fmtShare(sevUnk, n))})</td>
      <td>${fmtCount(n)}</td>
    </tr>`);
  }
  sections.push(`
<h3>Severity breakdown</h3>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>Property damage only</th>
        <th>Injury (no hosp.)</th>
        <th>Hospitalization</th>
        <th>Fatality</th>
        <th>Unknown</th>
        <th>Total</th>
      </tr></thead>
      <tbody>${sevTableRows.join("")}</tbody>
    </table></div>`);

  // --- 4. VMT uncertainty ---
  // The window band every card and CI uses (monthlySummaryRows: summed month
  // bands intersected with the kyoom difference, plus the data-through
  // month's thinned band). Until 2026-09-26 this table re-summed each month's
  // receipt-scaled 95% edges -- the perfectly-correlated band abandoned on
  // 2026-09-04 -- and so contradicted the cards beside it.
  const vmtUncRows = windowSummaryRows(series)
    .filter(r => ADS_HELMERS.includes(r.helmer) && r.vmtBest > 0)
    .map(r => `<tr>
      <td>${escHtml(r.helmer)}</td>
      <td>${fmtMiles(r.vmtMin)}</td>
      <td>${fmtMiles(r.vmtBest)}</td>
      <td>${fmtMiles(r.vmtMax)}</td>
      <td>${(r.vmtMax / r.vmtMin).toFixed(1)}x</td>
    </tr>`);
  sections.push(`
<h3>VMT uncertainty</h3>
<p>
Below is the total adjusted Vehicle Miles Traveled (VMT) for each company across the NHTSA window, showing low/central/high estimates.
The "range ratio" (max &divide; min) is a measure of uncertainty in the VMT numbers.
For example, if this ratio is 2, it means the Miles Per Incident (MPI) could be off by up to a factor of 2.
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>VMT low</th>
        <th>VMT central</th>
        <th>VMT high</th>
        <th>Range ratio</th>
      </tr></thead>
      <tbody>${vmtUncRows.join("")}</tbody>
    </table></div>`);

  // --- 5. Poisson dispersion (VMT-normalized) ---
  // Pearson chi-squared dispersion test: X² = Σ(k_i - λ̂·m_i)² / (λ̂·m_i)
  // where λ̂ = Σk_i / Σm_i is the MLE rate and m_i is monthly VMT.
  // Under the Poisson model, X²/(n-1) ≈ 1. A helmer's months are its own VMT
  // months in the window, the months its summary card pools
  // (per-helmer-summary.qual). Until 2026-10-03 only months in which all
  // three ADS helmers had VMT counted (2025-06 on, Tesla's first month), so a
  // long window showed the default window's result and an early or short one
  // an empty table (audit #9). A helmer with too few months keeps a grayed
  // row that says so.
  const dispRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer);
    const monthData = [];
    for (const vmtRow of helmerVmt) {
      const count = rows.filter(r =>
        r.helmer === helmer &&
        monthKeyFromIncidentLabel(r.date) === vmtRow.month).length;
      // Use effective VMT (calendar coverage * incident reporting completeness)
      // to match the MPI calculation's Poisson rate estimation
      monthData.push({count, vmt: vmtRow.vmtBest * vmtRow.coverage * vmtRow.incCov});
    }
    if (monthData.length < DISPERSION_MIN_MONTHS) {
      dispRows.push(`<tr class="insufficient">
      <td>${escHtml(helmer)}</td>
      <td colspan="4">${escHtml(dispersionFewMonthsNote(monthData.length))}</td>
    </tr>`);
      continue;
    }
    const totalK = monthData.reduce((s, d) => s + d.count, 0);
    const totalM = monthData.reduce((s, d) => s + d.vmt, 0);
    const lambdaHat = totalK / totalM;
    let chiSq = 0;
    for (const d of monthData) {
      const expected = lambdaHat * d.vmt;
      if (expected > 0) chiSq += (d.count - expected) ** 2 / expected;
    }
    const df = monthData.length - 1;
    const dispIdx = chiSq / df;
    const rates = monthData.map(r =>
      r.vmt > 0 ? (r.count / r.vmt * 1e6).toFixed(1) : "\u2014");
    // With few total incidents the test has no power; flag that
    const verdict = totalK < 20 ? "too few incidents to tell"
      : dispIdx < 0.5 ? "underdispersed"
      : dispIdx < 2 ? "consistent with Poisson"
      : dispIdx < 5 ? "mildly overdispersed"
      : "overdispersed";
    dispRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${rates.join(", ")}</td>
      <td>${(lambdaHat * 1e6).toFixed(1)}</td>
      <td>${dispIdx.toFixed(2)}</td>
      <td>${verdict}</td>
    </tr>`);
  }
  // PROPOSED (needs human's word, audit item 11): "confidence" here and in
  // the sensitivity-analysis intro should read "credible" — the intervals
  // are Bayesian credible intervals (Jeffreys prior + VMT prior), as the
  // green model-description sentence below already says. Left untouched:
  // existing human copy, and one-word AI-English swaps are barred by the
  // standing rule-7 directive.
  sections.push(`
<h3>Poisson dispersion</h3>
<p>
For confidence bands we use a statistical model that assumes a Poisson process where incidents occur at a constant rate per mile.
<span class="ai-text">Claude: every displayed credible interval
     is the exact quantile pair of the posterior for the true MPI,
     marginalized over the VMT uncertainty band — the same distribution the
     probability-distribution chart draws. For the at-fault metrics, whose
     incident counts are sums of fault <em>probabilities</em>, the posterior
     additionally mixes over the Poisson-binomial distribution of the true
     at-fault count rather than pretending the summed fractional mass was an
     exact count.</span>

(Also, apologies that this is all miles. That's the data we have and it would be messier to convert it all.)
Here we check that assumption using a Pearson chi-squared dispersion test normalized by monthly VMT.
A dispersion index near 1 supports the Poisson model; values much greater than 1 suggest that either something's awry or the robotaxis are getting better or worse.
<span class="ai-text">Claude: Where the dispersion index is much greater than 1 (today: Tesla), the pooled full-window estimates average over a fleet, geography, and software mix that changed rapidly; narrow the date-range slider to look at a recent, more homogeneous window.</span>
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>Monthly rate (per M mi)</th>
        <th>Overall rate</th>
        <th>Dispersion index</th>
        <th>Assessment</th>
      </tr></thead>
      <tbody>${dispRows.join("")}</tbody>
    </table></div>`);

  // --- 6. Reporting threshold asymmetry ---
  const rptRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) { rptRows.push(noIncidentsRow(helmer, 5)); continue; }
    const zeroMph = helmerRows.filter(r => r.speed === 0).length;
    const stopped = helmerRows.filter(r => SV_STATIONARY.has(r.svMovement)).length;
    const propDmgOnly = helmerRows.filter(r =>
      !INJURY_SEVERITIES.has(r.severity) &&
      !UNKNOWN_SEVERITIES.has(r.severity)).length;
    rptRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${fmtCount(zeroMph)} (${Math.round(100 * zeroMph / n)}%)</td>
      <td>${fmtCount(stopped)} (${Math.round(100 * stopped / n)}%)</td>
      <td>${fmtCount(propDmgOnly)} (${Math.round(100 * propDmgOnly / n)}%)</td>
      <td>${fmtCount(n)}</td>
    </tr>`);
  }
  sections.push(`
<h3>Reporting threshold disparities</h3>
<p>
It's possible that, as a totally arbitrary example, Waymo is more fastidious in what it reports to NHTSA.
Certainly all these companies are reporting more incidents than human drivers do.
A high fraction of 0-mph incidents suggests a company reports more minor events.
This inflates the company's raw incident count relative to others and relative to the human baseline.
The "nonstationary" MPI metric filters these out.
</p>
<p>
NHTSA's Third Amended SGO 
(effective June 16, 2025, which is the very start of our default date window) 
stopped requiring reports of minor crashes in which <em>another</em> vehicle 
struck the AV: under $1,000 damage, nobody transported to a hospital, no airbag
or other severity trigger.
Single-vehicle contacts and AV-AV incidents stay reportable at any damage 
amount.
</p>
<p class="ai-text">
Claude: 
So the carve-out is asymmetric and deflates post-June-2025 all-incident 
counts in the AV-favorable direction. 
Waymo's own pre/post discontinuity suggests roughly a quarter to a third of its
stopped-AV-struck property-damage reports stopped appearing, and Waymo now calls
the property-damage-vs-human benchmark comparison impossible.
Within-AV comparisons stay consistent (same rules for all three companies), and
the at-fault metrics are essentially immune (the exempted crashes are ~99% not 
the AV's fault).
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>Speed = 0 mph</th>
        <th>AV stopped</th>
        <th>Property damage only</th>
        <th>Total</th>
      </tr></thead>
      <tbody>${rptRows.join("")}</tbody>
    </table></div>`);

  // --- 7. Geographic scope ---
  const geoByHelmer = {};
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const cities = {};
    for (const r of helmerRows) {
      const loc = incidentLocation(r);
      cities[loc] = (cities[loc] || 0) + 1;
    }
    const sorted = Object.entries(cities).sort((a, b) => b[1] - a[1]);
    geoByHelmer[helmer] = sorted;
  }
  const geoRows = [];
  for (const helmer of ADS_HELMERS) {
    const locs = geoByHelmer[helmer];
    if (locs.length === 0) { geoRows.push(noIncidentsRow(helmer, 3)); continue; }
    const cityList = locs.map(([loc, cnt]) =>
      `${escHtml(loc)}\u00a0(${fmtCount(cnt)})`).join(", ");
    // "Unknown" stays in the list but not in the city COUNT (the copy says
    // we count cities, and a location-less filing isn't one).
    const cityCount = locs.filter(([loc]) => loc !== "Unknown").length;
    geoRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${fmtCount(cityCount)}</td>
      <td>${cityList}</td>
    </tr>`);
  }
  sections.push(`
<h3>Geography</h3>
<p>
Human crash rates vary by city, presumably.
Maybe that affects AVs too?
(So far we're only counting cities in which at least one incident has been reported.)
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th># cities</th>
        <th>Cities (incident count)</th>
      </tr></thead>
      <tbody>${geoRows.join("")}</tbody>
    </table></div>`);

  // --- 8. VMT sources ---
  const vmtSrcRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer).sort((a, b) => a.month.localeCompare(b.month));
    if (helmerVmt.length === 0) continue;
    // One entry per distinct rationale (the eras of a helmer's VMT series each
    // carry their own sourcing note), in month order, headed by the first and
    // last month it covers in the window (one month alone when they are the
    // same). Until 2026-10-03 no entry said which months it was for, so
    // Waymo's April, May and June notes, which differ only in their numbers,
    // read as three versions of one (audit #40). A rationale's months must be
    // one run, or its first-last heading would hide a gap.
    const rationales = [...new Set(helmerVmt.map(r => r.rationale))];
    const ratStr = rationales.map(rationale => {
      assert(rationale !== "", "VMT row without a rationale", {helmer});
      const at = helmerVmt.flatMap((r, i) => r.rationale === rationale ? [i] : []);
      assert(at[at.length - 1] - at[0] + 1 === at.length,
        "a VMT rationale covers two separate runs of months", {helmer, months: at.map(i => helmerVmt[i].month)});
      const span = [...new Set([helmerVmt[at[0]].month, helmerVmt[at[at.length - 1]].month])].join(" \u2013 ");
      return `${span}: ${escHtml(rationale)}`;
    }).join("<br>");
    vmtSrcRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td class="ai-text">${ratStr}</td>
    </tr>`);
  }
  // Tesla's Jul-Aug 2026 rows (710k of 3.15M raw
  // window miles), its Aug floor and the hidden Sep row rest on Elluswamy's
  // Sep 3 Cybercab keynote. The Q3 deck (Oct 21) should re-pin Jul-Sep.
  sections.push(`
<h3>VMT sources</h3>
<p>
Where the Vehicle Miles Traveled (VMT) estimates come from for each company.
These are the denominators in every miles per incident (MPI) calculation, so any errors here matter a lot.
In general we mistrust anything Tesla says except numbers in their official reports to investors which seem to be reliable and would be a big deal (e.g., securities fraud) if they weren't.
</p>
    <div class="table-wrap"><table class="vmt-sources">
      <thead><tr>
        <th>Company</th>
        <th>Source and methodology (<span class="ai-text">green text = AI-generated</span>)</th>
      </tr></thead>
      <tbody>${vmtSrcRows.join("")}</tbody>
    </table></div>`);

  // --- 9. Incident coverage for partial months ---
  const icRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer);
    // No months in the window, no coverage to report: an empty month list
    // passed the "no partial months" test below and claimed full coverage
    // (Tesla and Zoox in 2021) until 2026-10-03 (audit #53).
    if (helmerVmt.length === 0) continue;
    const partial = helmerVmt.filter(r => r.incCov < 1 || r.coverage < 1);
    if (partial.length === 0) {
      icRows.push(`<tr>
        <td>${escHtml(helmer)}</td>
        <td colspan="4">All months have full incident coverage</td>
      </tr>`);
      continue;
    }
    for (const row of partial) {
      icRows.push(`<tr>
        <td>${escHtml(helmer)}</td>
        <td>${escHtml(row.month)}</td>
        <td>${(row.incCov * 100).toFixed(1)}%</td>
        <td>${(row.incCovMin * 100).toFixed(1)}%\u2013${(row.incCovMax * 100).toFixed(1)}%</td>
        <td>${(row.coverage * 100).toFixed(1)}% (${(row.coverageMin * 100).toFixed(1)}%\u2013${(row.coverageMax * 100).toFixed(1)}%)</td>
      </tr>`);
    }
  }
  sections.push(`
<h3>Incident coverage for partial months</h3>
<p>
"Calendar coverage" is the fraction of the month in the window (e.g., 15/31 &approx; 48%).
"Incident coverage" estimates what fraction of incidents from that period have actually been reported.
NHTSA has two reporting tracks: 5-Day (must be reported within 5 days) and Monthly (must be reported by the following month).
Claude notes: 
<span class="ai-text">Monthly reports for the data-through month (${escHtml(NHTSA_DATA_THROUGH_DATE.slice(0, 7))}) are not in yet, so effective VMT is thinned by the incident-coverage factor for Monthly-track metrics only; 5-Day-track metrics (${METRIC_DEFS.filter(m => m.fiveDay).map(m => m.cardLabel.toLowerCase()).join(", ")}) use the raw VMT -- but reports received through the cutoff cover only part of the data-through month's crashes (the 5-day clock runs from the company's notice), so that month's "calendar coverage" is the measured fraction of a month's 5-Day-track incidents present in a first release (median of past releases, with its band), not a fraction of days.</span>
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Company</th>
        <th>Month</th>
        <th>Incident coverage (best)</th>
        <th>Range</th>
        <th>Calendar coverage</th>
      </tr></thead>
      <tbody>${icRows.join("")}</tbody>
    </table></div>`);

  // --- 9b. Waymo published-rate cross-check ---
  // Coarse cross-check: our full-history Waymo SGO rates vs Waymo's own
  // published rates (WAYMO_PUBLISHED_IPMM). Scopes differ (all-roads SGO
  // self-reported severity vs Waymo's surface-street, location-weighted), so
  // closeness — not equality — is the signal; gross drift flags a counting bug,
  // e.g. the 2026-06 Minor/Serious silent-drop where our injury rate sagged to
  // ~0.40 vs Waymo's 0.71. waymo-reconciliation.qual bounds the ratios.
  const wayAll = incidents.filter(r => r.helmer === "Waymo");
  const wayVmt = vmtRows.filter(r => r.helmer === "Waymo");
  // Receipt-coverage-scaled: the numerator holds only reports received
  // through the data-through cutoff, so that month counts at its coverage
  // fraction, not at full weight (until 2026-09-04 it did, ~4.5% low). Each
  // row then takes its metric's track, as the cards do: Monthly-track metrics
  // (injury) are further thinned by that month's incident coverage; until
  // 2026-10-03 every row used the five-day denominator (audit #48).
  const wayVmtM = {
    fiveDay: wayVmt.reduce((s, r) => s + r.vmtBest * r.coverage, 0) / 1e6,
    monthly: wayVmt.reduce((s, r) => s + r.vmtBest * r.coverage * r.incCov, 0) / 1e6,
  };
  const wayXChecks = [
    ["Any injury", "injury", wayAll.filter(r => INJURY_SEVERITIES.has(r.severity)).length, WAYMO_PUBLISHED_IPMM.injury],
    ["Airbag deployment", "airbag", wayAll.filter(r => r.airbagAny).length, WAYMO_PUBLISHED_IPMM.airbag],
    ["Serious injury+", "seriousInjury", wayAll.filter(r => SERIOUS_INJURY_SEVERITIES.has(r.severity)).length, WAYMO_PUBLISHED_IPMM.ssi],
  ];
  // Rates to 3 significant figures, enough to reproduce the ratio beside
  // them (at 2 dp the serious-injury+ row read 0.04 vs 0.01 beside 3.6x).
  const wayXRows = wayXChecks.map(([label, metricKey, k, pub]) => {
    const ours = k / wayVmtM[METRIC_BY_KEY[metricKey].fiveDay === true ? "fiveDay" : "monthly"];
    return `<tr><td>${label}</td><td>${ours.toPrecision(3)}</td><td>${pub.toPrecision(3)}</td><td>${(ours / pub).toFixed(1)}x</td></tr>`;
  });
  // The serious-injury+ ratio is
  // far from 1 because the page counts the severity alleged in the SGO
  // filing, while Waymo counts police-report KABCO A+K (from police crash
  // reports it obtains by public-records request); three SGO "Serious"
  // filings (30270-8968, 30270-10112, 30270-15547) are not serious by the
  // police reports, and one (30270-13817) still awaits a police crash report.
  // (Facts: hub CSV2 v1 "Is Suspected Serious Injury+"; Sep-24-2026 release
  // notes p. 2 on 30270-13817, p. 8 on relying on the police crash report.
  // The AV SSI+ numerator stays SGO-alleged: the human's open method call.)
  const waySsiNote = `The serious-injury+ ratio is far from 1 because, for one thing, the page counts the severity alleged in the SGO filing, while Waymo counts police reports; three SGO "Serious" filings (30270-8968, 30270-10112, 30270-15547) are not serious per the police reports, and one (30270-13817) still awaits a police crash report.`;
  sections.push(`
<h3>Waymo cross-check</h3>
<p>
Our full-history Waymo rates (${fmtCount(wayAll.length)} incidents over ${fmtMiles(wayVmtM.fiveDay * 1e6)} miles; SGO self-reported) vs Waymo's own published rates (surface-street only? location-weighted).
A ratio very different from 1 suggests a problem.
</p>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Metric</th>
        <th>Ours (per M mi)</th>
        <th>Waymo published</th>
        <th>Ratio</th>
      </tr></thead>
      <tbody>${wayXRows.join("")}</tbody>
    </table></div>
<p><span class="ai-text">${escHtml(waySsiNote)}</span></p>`);

  // --- 10. Human benchmark derivations ---
  sections.push(renderHumanBenchmarkTable());

  // --- 11. Skeptical stress test of conclusions ---
  sections.push(renderStressTestTable(series));

  byId("sanity-checks").innerHTML = sections.join("");
}

// --- Floating tooltip (works on mobile tap + desktop hover) ---

function initTooltips() {
  const tip = document.createElement("div");
  tip.id = "chart-tip";
  tip.className = "chart-tip";
  document.body.appendChild(tip);

  let pinned = false; // true when user tapped/clicked to pin the tooltip
  let pinnedTarget = null; // the element the pinned tooltip belongs to
  // The target whose tip keyboard focus showed (null once a pointer shows a
  // tip, or focus leaves it): while focus is still on it, that tip follows it
  // when the page or a box scrolls (below). A redraw that removes the focused
  // target (a chart mark a width change redraws) drops focus to <body> with
  // no focusout in Firefox and WebKit, so the follow checks the focus itself:
  // until 2026-10-05 (reviewer) the next scroll moved the tip to the removed
  // target's corner, which reads (0, 0), the viewport's top-left corner.
  let focusTipTarget = null;

  function show(el, evt) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    focusTipTarget = null;
    tip.textContent = text;
    tip.style.display = "block";
    position(evt);
  }

  function position(evt) {
    // Position near the pointer/touch, clamped to viewport
    const x = evt.clientX || (evt.touches && evt.touches[0].clientX) || 0;
    const y = evt.clientY || (evt.touches && evt.touches[0].clientY) || 0;
    const pad = 12;
    // The tip's size is measured at the viewport's corner: where it stood,
    // near the right edge, the room left narrowed it, and the flip below
    // used that narrower width, so a flipped tip widened over its own target
    // once moved (found 2026-10-04 with audit #18).
    tip.style.left = "0px";
    tip.style.top = "0px";
    const rect = tip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - pad) {
      left = x - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = y - rect.height - pad;
    }
    tip.style.left = Math.max(pad, left) + "px";
    tip.style.top = Math.max(pad, top) + "px";
  }

  function hide() {
    if (!pinned) {
      tip.style.display = "none";
    }
  }

  function findTipTarget(el) {
    // Walk up from event target to find nearest [data-tip]
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-tip")) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Desktop hover
  document.addEventListener("pointerenter", (evt) => {
    if (pinned) return;
    const target = findTipTarget(evt.target);
    if (target) show(target, evt);
  }, true);

  document.addEventListener("pointerleave", (evt) => {
    if (pinned) return;
    const target = findTipTarget(evt.target);
    if (target) hide();
  }, true);

  document.addEventListener("pointermove", (evt) => {
    if (pinned) return;
    if (tip.style.display === "block") position(evt);
  }, true);

  // Keyboard: a focused target shows its tip at its corner, as hover does,
  // and takes over from a pinned tip; leaving it hides the tip. Until
  // 2026-10-03 only pointer events opened a tooltip. Focus that a press of
  // the pointer gives a target (:focus-visible does not match it) is left to
  // the pointer's own handlers, or the tip would jump to the target's corner
  // between mousedown and click. The corner is read again in the next frame:
  // WebKit fires focusin before it scrolls the target into view (Chromium and
  // Firefox after), so the first tip shown in each region of the page sat
  // where its target had been before the scroll, off-screen (until
  // 2026-10-04, audit #18). And WebKit may scroll the target into view only
  // after that frame: the tip then stayed where the target had been, which
  // happened for 0-1 of 210 targets in about half the WebKit runs of
  // tooltip-focus-position.qual, and for 3-6 in every run once the incident
  // box was laid out only near the screen (style.css .table-scroll, 2026-10-05,
  // audit #25), which gives WebKit more frames to schedule around the scroll.
  // So the tip also follows its target on every scroll while focus keeps it.
  const corner = el => { const r = el.getBoundingClientRect(); return {clientX: r.right, clientY: r.bottom}; };
  document.addEventListener("focusin", (evt) => {
    const target = findTipTarget(evt.target);
    if (!target || !target.matches(":focus-visible")) return;
    pinned = false;
    pinnedTarget = null;
    show(target, corner(target));
    focusTipTarget = target;
    requestAnimationFrame(() => position(corner(target)));
  });
  document.addEventListener("scroll", () => {
    if (focusTipTarget === document.activeElement) position(corner(focusTipTarget));
  }, {capture: true, passive: true});

  document.addEventListener("focusout", (evt) => {
    if (findTipTarget(evt.target)) {
      focusTipTarget = null;
      hide();
    }
  });

  // Escape dismisses the tooltip, whether hovered, focused or pinned, without
  // moving the pointer (WCAG 1.4.13).
  document.addEventListener("keydown", (evt) => {
    if (evt.key !== "Escape") return;
    pinned = false;
    pinnedTarget = null;
    focusTipTarget = null;
    tip.style.display = "none";
  });

  // Click/tap to pin tooltip (mobile-friendly)
  document.addEventListener("click", (evt) => {
    const target = findTipTarget(evt.target);
    if (target) {
      if (pinned && tip.style.display === "block" && target === pinnedTarget) {
        // Tapping the pinned element again dismisses; tapping another
        // data-tip element re-pins on it (one tap per bar on mobile).
        pinned = false;
        pinnedTarget = null;
        focusTipTarget = null;
        tip.style.display = "none";
      } else {
        pinned = true;
        pinnedTarget = target;
        show(target, evt);
      }
    } else {
      // Clicked elsewhere — dismiss pinned tooltip
      pinned = false;
      focusTipTarget = null;
      tip.style.display = "none";
    }
  }, true);

  // WebKit (iPhone Safari) turns a tap into a click only on nodes it deems
  // clickable: ones with their own click/mouse listeners, links, controls.
  // The delegated listener above never saw a tap on a chart dot or a card's
  // "[?]" hint (and the hint's tap was retargeted to the neighbouring source
  // link), so every tooltip target carries a no-op click listener of its own.
  // Renders replace innerHTML, so a MutationObserver re-arms after each one;
  // addEventListener de-duplicates the same listener, so re-arming is a no-op.
  armTipTargets(document);
  new MutationObserver(() => armTipTargets(document)).observe(document.body, { childList: true, subtree: true });
  // The same heuristic swallowed a tap on a paragraph, a table cell or a
  // chart's empty plot, so a pinned tooltip could not be dismissed on an
  // iPhone and stayed on screen while scrolling (until 2026-10-03). A no-op
  // listener on body makes every tap a click the dismissal above sees.
  document.body.addEventListener("click", tipTapNoop);
}

function tipTapNoop() {}
function armTipTargets(root) {
  for (const el of root.querySelectorAll("[data-tip]")) el.addEventListener("click", tipTapNoop);
}

// --- Prediction markets (Polymarket + Manifold) ---

let predmarketsAgeTimer = null;
// What the market panel draws now: its Polymarket and Manifold entries (each
// marked live or not) and the time their odds date from, the age's origin.
// renderPredmarketsPanel records it; a refresh starts from it.
let predmarketsShown = null;
// A market fetch that has not answered in this long fails (AbortSignal.timeout).
const PREDMARKET_FETCH_TIMEOUT_MS = 10000;

function polymarketUrl(slug) {
  return "https://polymarket.com/event/" + slug;
}

function oddsClass(p) {
  return p >= 0.6 ? "high" : p >= 0.3 ? "mid" : "low";
}

function fmtPct(p) { return Math.round(p * 100) + "%"; }

// Tier chosen on the ROUNDED value so 999,500 prints "$1.0M", not "$1000K".
function fmtVol(v) {
  return v >= 999500 ? "$" + (v / 1e6).toFixed(1) + "M"
       : v >= 999.5  ? "$" + Math.round(v / 1e3) + "K"
       :               "$" + Math.round(v);
}

// Format elapsed time as compact string like "2d5h3m" or "<1m".
// cls: fresh (<1h), stale (1h-7d), rotten (>7d).
function fmtAge(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return {text: "<1m", cls: "fresh"};
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m || parts.length === 0) parts.push(m + "m"); // drop zero components ("1h", "2d5h"); nonzero minutes always shown
  const text = parts.join("");
  const cls = mins < 60 ? "fresh" : mins <= 7 * 1440 ? "stale" : "rotten";
  return {text, cls};
}

function yesProbability(market) {
  const prices = JSON.parse(market.outcomePrices || "[]");
  const outcomes = JSON.parse(market.outcomes || "[]");
  let idx = outcomes.indexOf("Yes");
  if (idx < 0) idx = 0;
  // Anti-Postel: a missing or malformed live price must fail the refresh
  // (fetchOrKeep then keeps the snapshot and the age dot stays honest), not
  // render as a confident "0%" (which `|| 0` did until 2026-09-04).
  const p = parseFloat(prices[idx]);
  assert(Number.isFinite(p) && p >= 0 && p <= 1, "Polymarket outcomePrices unparseable",
    {question: market.question, outcomePrices: market.outcomePrices});
  return p;
}

// Manifold volume is play-money mana (Ṁ), not USD
function fmtMana(v) {
  return "Ṁ" + (v >= 999500 ? (v / 1e6).toFixed(1) + "M"
       : v >= 999.5  ? Math.round(v / 1e3) + "K"
       :               String(Math.round(v)));
}

// --- Market state (2026-10-03, audit #21, #85) ---
// A card's odds are a live price only while its market trades and this page
// load has fetched them. A market that has resolved (Manifold's resolution; a
// Polymarket sub-market whose UMA status reads "resolved") or stopped trading
// (its close time has passed, or Polymarket has closed it) is grayed and
// labelled; so is every card still showing the snapshot's odds, because its
// fetch failed or has not finished. Until 2026-10-03 neither fetcher read any
// of that state, so a market that resolved YES on 2026-07-10 kept showing its
// last price, 94%, as live odds under a fresh green dot, and a failed fetch
// left snapshot odds looking live. The snapshot carries the same state fields
// as the live fetch (data/refresh-predmarkets.mjs writes them), so one render
// path serves both, and a snapshot painted after a market's close time already
// shows it closed. A Manifold market resolved as a whole (one winning answer
// of a sum-to-one market) leaves its answers' own resolutions empty, so its
// cards read closed rather than naming the winner.

// Label heads the outcome a market,
// or one answer of a multi-answer market, resolved to, as in "resolved: YES".
const RESOLVED_LABEL = "resolved:";
// Label marks a market whose trading has
// stopped (its close time has passed, or Polymarket closed it) but which has
// not resolved yet.
const CLOSED_LABEL = "closed";
// Label for this outcome name: "canceled" (Manifold shows this
// resolution as N/A). It names the outcome of a market resolved CANCEL, i.e.
// voided, after RESOLVED_LABEL.
const CANCELLED_LABEL = "canceled";

// How a card names a Manifold resolution (`text`) and the odds it shows
// (`settled`, from the probability it settled at and its last trade): YES
// and NO are the market's own outcome names and settle at 1 and 0; MKT
// settled at resolutionProbability (not the last price; asserted present,
// since fmtPct would print a missing one as "0%"); CANCEL voided the market,
// which settled at nothing, so it keeps its last trade. A resolved Polymarket
// sub-market prices its outcome at 1, so its card shows its settlement; until
// 2026-10-04 a resolved Manifold card kept its last trade instead ("resolved:
// YES" beside 94%, coloured by it; audit #52).
const MANIFOLD_RESOLUTIONS = {
  YES: {text: () => "YES", settled: () => 1},
  NO: {text: () => "NO", settled: () => 0},
  MKT: {
    text: settled => {
      assert(Number.isFinite(settled) && settled >= 0 && settled <= 1,
        "a Manifold MKT resolution needs the probability it settled at", {settled});
      return fmtPct(settled);
    },
    settled: settled => settled,
  },
  CANCEL: {text: () => CANCELLED_LABEL, settled: (_settled, last) => last},
};
// A Manifold market's or answer's state as its card shows it: the outcome
// it resolved to (null while open) and its odds (its last trade while open,
// what it settled at once resolved).
function manifoldResolution(o) {
  if (o.resolution === null) return {text: null, prob: o.prob};
  assert(o.resolution in MANIFOLD_RESOLUTIONS, "unknown Manifold resolution", {resolution: o.resolution});
  const r = MANIFOLD_RESOLUTIONS[o.resolution];
  return {text: r.text(o.resolutionProbability), prob: r.settled(o.resolutionProbability, o.prob)};
}
// The outcome a resolved Polymarket sub-market settled on, the one it prices
// at 1, or null until its UMA status reads "resolved".
function polymarketResolutionText(m) {
  if (m.umaResolutionStatus !== "resolved") return null;
  const prices = JSON.parse(m.outcomePrices).map(Number);
  assert(prices.filter(p => p === 1).length === 1, "a resolved Polymarket market prices exactly one outcome at 1",
    {question: m.question, outcomePrices: m.outcomePrices});
  const name = JSON.parse(m.outcomes)[prices.indexOf(1)];
  assert(typeof name === "string" && name !== "", "a resolved Polymarket market names the outcome it prices at 1",
    {question: m.question, outcomes: m.outcomes, outcomePrices: m.outcomePrices});
  return name;
}
// A row's state label: the resolved outcome after RESOLVED_LABEL, else
// CLOSED_LABEL once trading has stopped, else "" while it trades.
function marketStateLabel(resolution, closed) {
  return resolution !== null ? `${RESOLVED_LABEL} ${resolution}` : closed ? CLOSED_LABEL : "";
}
// A row is grayed when its odds are not a live price: not fetched this page
// load (`live` false: the snapshot's), or no longer trading (a state label).
function marketRowFaded(state, live) {
  assert(typeof state === "string" && typeof live === "boolean", "marketRowFaded: state must be a string, live a boolean", {state, live});
  return !live || state !== "";
}

// One market row: the question (or an outcome's label) linked to its market,
// its state label ("" while it trades; empty, the span takes no room), odds and
// volume. A state label holds API text (a Polymarket outcome name), so it is
// escaped like the question. The link carries `focusKey`, so keyboard focus on
// it survives the redraw each fetch's landing makes (rerenderKeepingFocus;
// until 2026-10-04 it fell to <body>, audit #17).
function renderMarketCard(question, url, prob, volText, state, faded, focusKey) {
  assert(typeof state === "string" && typeof faded === "boolean" && typeof focusKey === "string" && focusKey !== "",
    "renderMarketCard: state must be a string, faded a boolean, focusKey a name", {question, state, faded, focusKey});
  const card = document.createElement("div");
  card.className = "pm-card";
  card.classList.toggle("pm-faded", faded);
  card.innerHTML =
    `<span class="pm-card-question"><a href="${escAttr(url)}" data-focus-key="${escAttr(focusKey)}" ` +
    `target="_blank" rel="noopener">${escHtml(question)}</a><span class="pm-card-state">${escHtml(state)}</span></span>` +
    `<span class="pm-card-odds ${oddsClass(prob)}">${fmtPct(prob)}</span>` +
    `<span class="pm-card-vol">${volText}</span>`;
  return card;
}

// Append one market to the grid. A single-outcome market is one inline card; a
// multi-outcome market is a bold header card plus one subcard per outcome, in
// source order (chronological for the Manifold "what year" date markets). This
// is the one rendering path for every source — a Polymarket event's curated
// sub-markets and a Manifold market's binary/answers list both flow in as the
// `outcomes` list [{label, prob, volText?, resolution, closed}]; volText is the
// per-outcome volume (Polymarket sub-markets have their own; Manifold answers
// share the market's). The header carries the market's closed state (every
// outcome closed); each outcome row its own resolution. `key` names the
// market's links for rerenderKeepingFocus: the market's own link (its single
// row's or its header's) is `key`, outcome i's is `key-i`.
function appendMarketGroup(grid, title, url, volText, outcomes, live, key) {
  assert(outcomes.length > 0, "market group needs at least one outcome", {title});
  const row = (label, o, vol, focusKey) => {
    const state = marketStateLabel(o.resolution, o.closed);
    return renderMarketCard(label, url, o.prob, vol, state, marketRowFaded(state, live), focusKey);
  };
  if (outcomes.length === 1) {
    grid.appendChild(row(title, outcomes[0], volText, key));
    return;
  }
  const headerState = marketStateLabel(null, outcomes.every(o => o.closed));
  const header = document.createElement("div");
  header.className = "pm-card";
  header.classList.toggle("pm-faded", marketRowFaded(headerState, live));
  header.innerHTML =
    `<span class="pm-card-question"><a href="${escAttr(url)}" data-focus-key="${escAttr(key)}" ` +
    `target="_blank" rel="noopener"><b>${escHtml(title)}</b></a><span class="pm-card-state">${escHtml(headerState)}</span></span>` +
    `<span class="pm-card-vol">${volText}</span>`;
  grid.appendChild(header);
  outcomes.forEach((o, i) => {
    const card = row(o.label, o, o.volText || "", `${key}-${i}`);
    card.classList.add("pm-subcard");
    grid.appendChild(card);
  });
}

// A Polymarket sub-market has closed once Polymarket says so or its end date
// has passed.
function polymarketOutcomes(ev, now) {
  return ev.markets.map(m => {
    assert(typeof m.closed === "boolean" && !Number.isNaN(Date.parse(m.endDate)),
      "a Polymarket market needs closed and endDate", {question: m.question, closed: m.closed, endDate: m.endDate});
    return {
      label: m.question,
      prob: yesProbability(m),
      volText: fmtVol(parseFloat(m.volume) || 0),
      resolution: polymarketResolutionText(m),
      closed: m.closed || Date.parse(m.endDate) <= now,
    };
  });
}

// A Manifold market is either binary (one Yes probability) or multi-answer
// (an `answers` list of {label, prob, ...}, e.g. the "what year" DATE
// markets). Normalize both to the outcome list. The binary outcome's label is
// unused (the single-card path shows the question), so "Yes" is just
// self-documenting. A market (all its answers) has closed once its closeTime
// has passed; Manifold moves the closeTime of a market resolved early to the
// moment it resolved.
// Every outcome must carry its probability, a number in [0, 1]: a reply
// without one drew "NaN%" as a live price until 2026-10-04 (audit #30), and
// failing here fails that market's fetch (fetchManifoldMarket calls this).
function manifoldOutcomes(m, now) {
  assert(Number.isFinite(m.closeTime), "a Manifold market needs a closeTime", {slug: m.slug, closeTime: m.closeTime});
  const closed = m.closeTime <= now;
  return (m.answers || [{label: "Yes", prob: m.probability, resolution: m.resolution, resolutionProbability: m.resolutionProbability}])
    .map(o => {
      assert(Number.isFinite(o.prob) && o.prob >= 0 && o.prob <= 1,
        "a Manifold market or answer needs its probability, a number in [0, 1]", {slug: m.slug, label: o.label, prob: o.prob});
      const shown = manifoldResolution(o);
      return {label: o.label, prob: shown.prob, resolution: shown.text, closed};
    });
}

// Tooltip on the prediction markets' dot and age.
// The age is the time since these odds were fetched from the
// markets or, if any market's fetch failed, since the snapshot the page ships
// with (taken on the date shown); the dot is green while that is under an
// hour, amber under a week and red after; grayed odds are not live, they are
// the snapshot's because their fetch failed or has not finished; a grayed
// market marked closed or resolved no longer trades.
function predmarketStatusTip(snapshotDate) {
  assert(/^\d{4}-\d\d-\d\dT/.test(snapshotDate), "predmarketStatusTip: the snapshot date must be an ISO time", {snapshotDate});
  return `The age is the time since the market odds were fetched or, if fetching failed, since the last snapshot we have (${snapshotDate.slice(0, 10)}). `;
}

// Each entry carries `live`: whether this page load fetched it (true) or it is
// the snapshot's (false, grayed).
function renderPredmarketsPanel(config, manifold, isoDate) {
  const panel = byId("predmarket-panel");
  const grid = document.createElement("div");
  grid.className = "predmarket-grid";
  const now = Date.now();
  // Disabled entries never get here: snapshotMarkets drops them, and a
  // refresh fetches only what the panel drew (since 2026-10-04, audit #53;
  // until then this function skipped them itself).
  for (const e of [...config, ...manifold]) {
    assert(typeof e.live === "boolean", "a market entry must say whether it is live", {slug: e.slug, live: e.live});
    assert(e.enabled !== false, "a disabled market entry reached the market panel", {slug: e.slug});
  }

  for (const ev of config) {
    if (!(ev.markets || []).length) continue;
    appendMarketGroup(grid, ev.title, polymarketUrl(ev.slug),
      fmtVol(parseFloat(ev.volume) || 0), polymarketOutcomes(ev, now), ev.live, `pm-${ev.slug}`);
  }

  for (const m of manifold) {
    appendMarketGroup(grid, m.question, m.url, fmtMana(m.volume), manifoldOutcomes(m, now), m.live, `pm-${m.slug}`);
  }

  panel.textContent = "";
  panel.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "pm-footer";

  // The dot and the age are one tooltip target, a Tab stop named, as every
  // HTML target is (htmlTipAttrs), by what it shows (the age, kept current as
  // it ticks) and its tip; until 2026-10-03 nothing on the page said what they
  // meant. The refresh's re-render replaces it, so it carries a
  // data-focus-key, as the refresh button does (rerenderKeepingFocus).
  const tip = predmarketStatusTip(PREDMARKET_SNAPSHOT_DATE);
  const status = document.createElement("span");
  status.className = "pm-status";
  status.setAttribute("data-tip", tip);
  status.setAttribute("tabindex", "0");
  status.setAttribute("role", "img");
  status.setAttribute("data-focus-key", "pm-status");
  const dot = document.createElement("span");
  dot.className = "pm-dot";
  const ageSpan = document.createElement("span");
  ageSpan.className = "pm-age";
  status.append(dot, ageSpan);
  function tickAge() {
    const {text, cls} = fmtAge(isoDate);
    ageSpan.textContent = text;
    status.setAttribute("aria-label", `${text} ${tip}`);
    dot.className = "pm-dot " + cls;
  }
  tickAge();
  if (predmarketsAgeTimer) clearInterval(predmarketsAgeTimer);
  predmarketsAgeTimer = setInterval(tickAge, 60000);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "pm-refresh";
  refreshBtn.title = "Refetch prediction market data";
  // Named by its purpose: the glyph alone was the accessible name ("↻").
  refreshBtn.setAttribute("aria-label", refreshBtn.title);
  refreshBtn.setAttribute("data-focus-key", "pm-refresh");
  refreshBtn.innerHTML = '<span aria-hidden="true">\u21bb</span>';
  refreshBtn.addEventListener("click", refreshPredmarkets);

  footer.append(status, refreshBtn);
  panel.appendChild(footer);
  // Recorded once drawn, so a render that throws (an entry the cards
  // cannot draw) leaves what the panel still shows (reviewer, 2026-10-04).
  predmarketsShown = {poly: config, manifold, isoDate};
}

// Fetch fresh data for a single slug, returning the event object with the
// same shape as our snapshot entries, state included (closed, endDate,
// umaResolutionStatus on each curated sub-market). (gamma-api serves
// access-control-allow-origin: * as of 2026-06, so no CORS proxy is needed;
// the third-party proxy this used to go through is dead.)
async function fetchPolymarketEvent(slug, templateEntry) {
  const apiUrl = "https://gamma-api.polymarket.com/events?slug=" +
    encodeURIComponent(slug);
  const resp = await fetch(apiUrl, {signal: AbortSignal.timeout(PREDMARKET_FETCH_TIMEOUT_MS)});
  assert(resp.ok, "Polymarket API request failed", {status: resp.status, slug});
  const events = await resp.json();
  assert(events.length > 0, "No events returned for slug", {slug});
  const ev = events[0];
  // Only keep sub-markets that are in the curated snapshot.
  const kept = new Set(templateEntry.markets.map(m => m.question));
  const freshMarkets = (ev.markets || [])
    .filter(m => kept.has(m.question))
    .map(m => {
      // Polymarket leaves umaResolutionStatus off a market until a resolution
      // is proposed; it reads null here.
      const uma = m.umaResolutionStatus ?? null;
      assert(typeof m.closed === "boolean" && !Number.isNaN(Date.parse(m.endDate)) &&
        (uma === null || typeof uma === "string"),
        "a Polymarket market needs closed, endDate and umaResolutionStatus",
        {slug, question: m.question, closed: m.closed, endDate: m.endDate, umaResolutionStatus: uma});
      const fresh = {
        question: m.question,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        volume: m.volume || "0",
        closed: m.closed,
        endDate: m.endDate,
        umaResolutionStatus: uma,
      };
      // A resolution the cards cannot name (e.g. a 50-50 one, no outcome at
      // 1), or a price that is not one (audit #30: outcomePrices "[]" threw
      // at render until 2026-10-04, leaving every card grayed and the button
      // busy), fails this market's fetch here, so it stays grayed on the
      // odds the panel drew, rather than failing the panel's render.
      polymarketResolutionText(fresh);
      yesProbability(fresh);
      return fresh;
    });
  // A curated sub-market whose question text no longer matches (creators can
  // edit it) must count as a refresh failure, not vanish from the grid with a
  // fresh green dot (which it did until 2026-09-04).
  assert(freshMarkets.length === templateEntry.markets.length,
    "Polymarket sub-market questions no longer match the curated snapshot",
    {slug, kept: [...kept], got: (ev.markets || []).map(m => m.question)});
  return {
    title: ev.title,
    slug: ev.slug,
    enabled: templateEntry.enabled,
    volume: ev.volume || 0,
    markets: freshMarkets,
  };
}

// Fetch fresh data for a single Manifold market. Binary markets carry one Yes
// probability; multi-answer markets (e.g. the "what year" DATE markets) carry
// an answers list. The returned shape mirrors the snapshot entry, state
// included (closeTime, and resolution / resolutionProbability on a binary
// market and on each answer), so the render path (manifoldOutcomes) handles
// both without a special case. Manifold leaves the resolution fields off a
// market or answer until it resolves; they read null here.
async function fetchManifoldMarket(templateEntry) {
  const resp = await fetch("https://api.manifold.markets/v0/slug/" +
    encodeURIComponent(templateEntry.slug), {signal: AbortSignal.timeout(PREDMARKET_FETCH_TIMEOUT_MS)});
  assert(resp.ok, "Manifold API request failed",
    {status: resp.status, slug: templateEntry.slug});
  const m = await resp.json();
  const binary = m.outcomeType === "BINARY";
  assert(binary || Array.isArray(m.answers),
    "Manifold market must be binary or carry answers",
    {slug: templateEntry.slug, outcomeType: m.outcomeType});
  assert(Number.isFinite(m.closeTime), "a Manifold market needs a closeTime",
    {slug: templateEntry.slug, closeTime: m.closeTime});
  const answers = binary ? undefined : m.answers
    .slice().sort((a, b) => a.index - b.index)
    .map(a => ({label: a.text, prob: a.probability,
      resolution: a.resolution ?? null, resolutionProbability: a.resolutionProbability ?? null}));
  const fresh = {
    question: m.question,
    slug: templateEntry.slug,
    url: m.url,
    enabled: templateEntry.enabled,
    closeTime: m.closeTime,
    probability: m.probability,
    resolution: binary ? m.resolution ?? null : undefined,
    resolutionProbability: binary ? m.resolutionProbability ?? null : undefined,
    answers,
    volume: m.volume || 0,
  };
  // A resolution code the cards cannot name, or an outcome without its
  // probability (audit #30), fails this market's fetch here, so it stays
  // grayed on the odds the panel drew, rather than failing the panel's
  // render.
  manifoldOutcomes(fresh, Date.now());
  return fresh;
}

// The refresh button while a refresh runs: busy, but still focusable
// (disabling it dropped keyboard focus until 2026-10-03), and deaf to clicks
// until the panel's last redraw gives it a fresh button.
function markPredmarketsBusy() {
  const btn = byId("predmarket-panel").querySelector(".pm-refresh");
  assert(btn !== null, "refreshPredmarkets: the panel has no refresh button");
  btn.setAttribute("aria-disabled", "true");
  btn.removeEventListener("click", refreshPredmarkets);
  btn.firstElementChild.textContent = "\u231b";
}

// Every market is fetched at once (one after another, until 2026-10-03, the
// snapshot's odds stayed up ~1 s in Chromium and ~8.7 s in Firefox; audit
// #85), and the panel redraws as each fetch settles, the button busy until
// the last: until 2026-10-04 it drew once, after every fetch, and a fetch
// had no timeout, so one silent API kept every card grayed and the button
// busy until the browser gave up (audit #31). A fetched entry is live; a
// failed one, or one past PREDMARKET_FETCH_TIMEOUT_MS, keeps the entry the
// panel drew, grayed (its odds from this page load's last fetch, or the
// snapshot's), and the age stays theirs: until 2026-10-04 a failed fetch fell
// back to the snapshot's entry and the age to the snapshot's date, so odds
// fetched minutes earlier silently reverted (audit #53). The age advances
// only when every market refreshed, so the staleness dot stays honest.
async function refreshPredmarkets() {
  markPredmarketsBusy();
  const drawn = predmarketsShown;
  const poly = [...drawn.poly], manifold = [...drawn.manifold];
  let failures = 0;
  const draw = isoDate => rerenderKeepingFocus(() => renderPredmarketsPanel(poly, manifold, isoDate));
  const land = async (list, i, fetcher) => {
    try {
      list[i] = {...await fetcher(list[i]), live: true};
    } catch (err) {
      failures++;
      console.error("prediction market refresh failed", list[i].slug, err);
      list[i] = {...list[i], live: false};
    }
    draw(drawn.isoDate);
    markPredmarketsBusy();
  };
  await Promise.all([
    ...poly.map((_e, i) => land(poly, i, entry => fetchPolymarketEvent(entry.slug, entry))),
    ...manifold.map((_e, i) => land(manifold, i, fetchManifoldMarket)),
  ]);
  draw(failures === 0 ? new Date(Date.now()).toISOString() : drawn.isoDate);
}

// The checked-in snapshot's enabled entries as the panel draws them before
// (or without) a live fetch: not live, so grayed. Only these are drawn and
// fetched.
function snapshotMarkets(list) {
  return list.filter(e => e.enabled !== false).map(e => ({...e, live: false}));
}

function loadPredmarketData() {
  assert(Array.isArray(POLYMARKET_SNAPSHOT), "POLYMARKET_SNAPSHOT must be an array");
  assert(Array.isArray(MANIFOLD_SNAPSHOT), "MANIFOLD_SNAPSHOT must be an array");
  assert(typeof PREDMARKET_SNAPSHOT_DATE === "string",
    "PREDMARKET_SNAPSHOT_DATE must be a string");
  renderPredmarketsPanel(snapshotMarkets(POLYMARKET_SNAPSHOT), snapshotMarkets(MANIFOLD_SNAPSHOT), PREDMARKET_SNAPSHOT_DATE);
  // Snapshot renders instantly; live prices replace it without a click.
  void refreshPredmarkets();
}

// --- Init ---

{
  const incidentData = INCIDENT_DATA;
  assert(Array.isArray(incidentData), "INCIDENT_DATA must be an array");
  assert(incidentData.length > 0, "INCIDENT_DATA must not be empty");
  const DATE_RE = /^[A-Z]{3}-\d{4}$/;
  for (const inc of incidentData) {
    assert(inc !== null && typeof inc === "object", "incident must be an object");
    assert(typeof inc.helmer === "string", "incident missing helmer");
    assert(ADS_HELMERS.includes(inc.helmer),
      "inline incident data has unknown helmer", {helmer: inc.helmer});
    assert(typeof inc.reportId === "string" && inc.reportId.length > 0,
      "incident missing reportId", {helmer: inc.helmer});
    // The incident browser builds a row's ids, the IDREFs pointing at them and
    // its narrative's data-focus-key from the report id (renderTable), so it
    // can hold no whitespace (an IDREF separator) and no quote or backslash
    // (rerenderKeepingFocus's attribute selector).
    assert(/^[^\s"'\\]+$/.test(inc.reportId),
      "incident reportId must hold no whitespace, quote or backslash", {reportId: inc.reportId});
    assert(typeof inc.date === "string" && DATE_RE.test(inc.date),
      "incident date must match MMM-YYYY format", {reportId: inc.reportId, date: inc.date});
    assert(inc.speed === null || (typeof inc.speed === "number" && Number.isFinite(inc.speed) && inc.speed >= 0),
      "incident speed must be null or non-negative number", {reportId: inc.reportId, speed: inc.speed});
    assert(typeof inc.road === "string" && inc.road.length > 0,
      "incident missing road type", {reportId: inc.reportId});
    assert(typeof inc.severity === "string" && inc.severity.length > 0,
      "incident missing severity", {reportId: inc.reportId});
    assert(SEVERITY_INFO[inc.severity] !== undefined,
      "incident severity is not classified in SEVERITY_INFO — it would be " +
      "silently dropped from the injury/hospitalization/serious-injury metrics",
      {reportId: inc.reportId, severity: inc.severity});
    assert(inc.fault === null || typeof inc.fault === "object",
      "incident fault must be null or object", {reportId: inc.reportId});
    assert(typeof inc.vehiclesInvolved === "number" && inc.vehiclesInvolved >= 1,
      "incident vehiclesInvolved must be >= 1", {reportId: inc.reportId});
    assert(typeof inc.svHit === "string",
      "incident missing svHit", {reportId: inc.reportId});
    assert(typeof inc.cpHit === "string",
      "incident missing cpHit", {reportId: inc.reportId});
    if (inc.fault !== null) {
      const f = inc.fault.faultfrac;
      assert(typeof f === "number" && f >= 0 && f <= 1,
        "incident fault.faultfrac must be a number in [0, 1]",
        {reportId: inc.reportId, value: f});
      assert(typeof inc.fault.reasoning === "string",
        "incident fault.reasoning must be a string", {reportId: inc.reportId});
    }
  }
  incidents = incidentData;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(incidentData);
  // Everything that is not a chart first (the URL state, the colophon, the
  // listeners, the markets), then the charts' column, then the views, which
  // build their non-chart parts before their charts (buildMonthlyViews), and
  // last the growth charts: a chart that cannot draw leaves the rest of the
  // page working. Until 2026-10-04 init measured the column and drew the
  // charts first, so in a hidden iframe or a ~130 px window the page stayed
  // blank and dead (audit #32).
  loadUiStateFromLocation();
  const modifiedPart = NHTSA_MODIFIED_DATE
    ? ` NHTSA data last modified ${NHTSA_MODIFIED_DATE}.`
    : "";
  const throughPart = `<span class="ai-text">NHTSA report-receipt cutoff: ${NHTSA_DATA_THROUGH_DATE}.</span>`;
  byId("colophon").innerHTML =
    `Incident data fetched from NHTSA on ${NHTSA_FETCH_DATE}.${modifiedPart} ${throughPart} · ` +
    `<a href="https://github.com/dreeves/crashla">github.com/dreeves/crashla</a> · ` +
    `web design inspired by <a href="https://ncase.me">nicky case</a>`;
  initInputModality();
  initTooltips();
  initCollapsibles();
  initGrowthMetricToggle();
  loadPredmarketData();
  // A change of the column's width (a phone turned, a window resized or
  // zoomed, a hidden iframe shown) redraws the charts at the new width; a
  // resize that leaves it (a phone's toolbar hiding as the page scrolls)
  // redraws nothing. The redraw keeps focus on the growth radios it replaces
  // (until 2026-10-04 it dropped it to <body>; audit #65).
  window.addEventListener("resize", () => {
    const w = chartColumnWidth();
    if (w === chartViewW) return;
    chartViewW = w;
    rerenderKeepingFocus(() => {
      renderWindowedViews();
      byId("chart-fleet-timeseries").innerHTML = renderFleetTimeSeriesChart();
      byId("chart-fleet-forecast").innerHTML = renderFleetForecastChart();
    });
  });
  chartViewW = chartColumnWidth();
  // Every view is built in this task, on every load: the browser puts the
  // reader in place while the page loads (Firefox once the bare page is laid
  // out and again before DOMContentLoaded, WebKit at the load event) on a
  // #sec-... fragment's section, a text fragment's (#:~:text=) words, or, on
  // a reload or a return through the history, where the reader was, so the
  // page has to be whole by then (load-order.qual, fragment-landing.qual,
  // scroll-restore.qual). On 2026-10-05 init built the incident browser, the
  // sanity section and the growth charts in tasks after the first frame
  // (audit #25), which painted the first chart ~0.07 s sooner on a desktop
  // and ~0.2 s sooner at 4x CPU throttling; in Firefox and WebKit the page
  // then grew under the browser's scroll and the reader landed up to ~29,000
  // px off, and no script there can see a text fragment to build that load
  // at once. Until 2026-10-05 the views took ~0.3 s on a desktop and ~1.3 s at
  // 4x (audit #25; the slider's commits since share their summary rows and
  // stop the fault-flip search at printed precision, audit #23).
  buildMonthlyViews();
  byId("chart-fleet-timeseries").innerHTML = renderFleetTimeSeriesChart();
  byId("chart-fleet-forecast").innerHTML = renderFleetForecastChart();
}

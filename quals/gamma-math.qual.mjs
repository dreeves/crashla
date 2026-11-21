import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";
import { chiSquaredLower, chiSquaredUpper, checkChiSquaredReference } from "./chi-squared.mjs";

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const run = expr => vm.runInContext(expr, ctx);

// --- lgamma at known points ---

const lgammaTests = [
  ["lgamma(1)", 0],                          // ln(Γ(1)) = ln(1) = 0
  ["lgamma(0.5)", Math.log(Math.sqrt(Math.PI))], // ln(Γ(½)) = ln(√π)
  ["lgamma(6)", Math.log(120)],              // ln(Γ(6)) = ln(5!)
  ["lgamma(10)", Math.log(362880)],           // ln(Γ(10)) = ln(9!)
];

for (const [expr, expected] of lgammaTests) {
  const got = run(expr);
  assert.ok(
    Math.abs(got - expected) < 1e-10,
    `Replicata: evaluate ${expr}.
Expectata: ${expected}.
Resultata: ${got} (error ${Math.abs(got - expected)}).`);
}

// --- gammainc at known points ---

const gammaincTests = [
  ["gammainc(1, 1)", 1 - Math.exp(-1)],       // P(1,1) = 1 - 1/e
  ["gammainc(1, 0)", 0],                       // P(a,0) = 0
  ["gammainc(0.5, 1)", 0.8427007929497149],    // P(½,1) = erf(1)
  ["gammainc(5, 5)", 0.5595067149347691],      // scipy reference
];

for (const [expr, expected] of gammaincTests) {
  const got = run(expr);
  assert.ok(
    Math.abs(got - expected) < 1e-8,
    `Replicata: evaluate ${expr}.
Expectata: ${expected}.
Resultata: ${got} (error ${Math.abs(got - expected)}).`);
}

// --- gammainc at the chi-squared test's shapes and arguments ---
// The Poisson dispersion table's assessment (crashla.js dispersionVerdict,
// since 2026-11-21) reads the tails of a chi-squared statistic X² on df
// degrees of freedom as P(df/2, X²/2) and 1 less it: shapes of a half and
// whole numbers up to 31.5 (a line has at most 64 months, so df is at most
// 63), arguments from nearly 0 to thousands, on both sides of x = a + 1,
// where gammainc changes from its series to its continued fraction. The
// reference values above cover four points; here every such shape is held to
// the quals' own chi-squared tails (quals/chi-squared.mjs: Simpson's rule on
// the density, checked first against the standard table), within 1e-8.
{
  checkChiSquaredReference();
  const off = [];
  let read = 0;
  for (let df = 1; df <= 63; df++) {
    for (const x of [1e-9 * df, 0.01, 0.05 * df, 0.3 * df, 0.7 * df, df, df + 1.9, df + 2, df + 2.1, 1.5 * df, 3 * df, 5 * df, 10 * df, 500, 5000]) {
      const lower = run(`gammainc(${df / 2}, ${x / 2})`);
      read++;
      const errors = [Math.abs(lower - chiSquaredLower(x, df)), Math.abs(1 - lower - chiSquaredUpper(x, df))];
      if (!(Math.max(...errors) < 1e-8)) off.push({ df, x, lower, wantLower: chiSquaredLower(x, df), wantUpper: chiSquaredUpper(x, df) });
    }
  }
  assert.ok(read >= 900 && off.length === 0,
    `Replicata: evaluate gammainc(df/2, x/2) for every df from 1 to 63 at fifteen x each, from nearly 0 to 5,000 and on both sides of x = df + 2 (where gammainc changes method), ${read} points.
Expectata: the lower tail of a chi-squared with df degrees of freedom at x, and 1 less it the upper tail, each within 1e-8 of the quals' chi-squared reference (quals/chi-squared.mjs).
Resultata: ${off.length} points off, e.g. ${JSON.stringify(off.slice(0, 4))}.`);
}

// --- gammaquant inverts gammainc (roundtrip) ---

const quantTriples = [
  [1, 1, 0.5],
  [2, 1, 0.05],
  [5, 3, 0.95],
  [0.5, 10, 0.1],
  [10, 0.5, 0.9],
];

for (const [a, b, p] of quantTriples) {
  const x = run(`gammaquant(${a}, ${b}, ${p})`);
  const roundtrip = run(`gammainc(${a}, ${x} * ${b})`);
  assert.ok(
    Math.abs(roundtrip - p) < 1e-8,
    `Replicata: gammaquant(${a}, ${b}, ${p}) then roundtrip through gammainc.
Expectata: P(a, x·b) ≈ ${p}.
Resultata: ${roundtrip} (error ${Math.abs(roundtrip - p)}).`);
}

// --- estimateMpi ordering: lo < median < hi ---

for (const k of [0, 10, 100]) {
  const mpi = run(`estimateMpi(${k}, 1000000, 0.95)`);
  assert.ok(
    mpi.lo < mpi.median && mpi.median < mpi.hi,
    `Replicata: estimateMpi(${k}, 1M, 0.95).
Expectata: lo < median < hi.
Resultata: lo=${mpi.lo}, median=${mpi.median}, hi=${mpi.hi}.`);
}

// --- gammaquant rejects invalid params ---

for (const [label, expr] of [
  ["p=0", "gammaquant(1, 1, 0)"],
  ["p=1", "gammaquant(1, 1, 1)"],
  ["a=0", "gammaquant(0, 1, 0.5)"],
  ["b=0", "gammaquant(1, 0, 0.5)"],
]) {
  let threw = false;
  try { run(expr); } catch (_) { threw = true; }
  assert.ok(
    threw,
    `Replicata: call ${expr} (${label}).
Expectata: immediate throw for invalid parameters.
Resultata: no throw.`);
}

// --- lgamma of a fixed shape is computed once, not once a call -------------
// A marginal CDF closure (makeMarginalMpiCdf) evaluates gammainc(a0, w) at
// every node of the VMT prior on every evaluation, with a0 fixed for the
// closure; gammaquant evaluates gammainc(a, ·) and its log-density at every
// Newton step, with a fixed. Until 2026-10-31 (2026-10-30 audit, ui-render-5)
// gammainc recomputed lgamma(a) each time: one monthSeriesData() made 829,540
// lgamma calls for 966 distinct closures, and Firefox spent ~1.1-1.3 s
// building the views. Now a closure takes lgamma(a0) once at build (passing
// it to gammainc), and gammaquant once a call; the values are the same
// numbers either way (the reference values above, and fault-mixture.qual).
{
  const counted = vm.createContext({ console, Math, Number });
  vm.runInContext(appScript, counted, { filename: "crashla.js" });
  vm.runInContext(`var lgammaCalls = 0; const lgammaShipped = lgamma; lgamma = x => { lgammaCalls++; return lgammaShipped(x); };`, counted);
  const calls = expr => vm.runInContext(`(() => { lgammaCalls = 0; ${expr}; return lgammaCalls; })()`, counted);
  // A Waymo-like posterior: a two-component mixture on a wide VMT band.
  vm.runInContext(`var cdf = makeMarginalMpiCdf([{a: 12.5, w: 0.4}, {a: 13.5, w: 0.6}], 800000, 1900000, 13000000);`, counted);
  const perEval = calls(`for (let i = 0; i < 20; i++) cdf(100000 * (1 + i))`);
  const quant = calls(`gammaquant(7.5, 2000000, 0.025)`);
  assert.ok(perEval === 0 && quant === 1,
    `Replicata: count lgamma calls in 20 evaluations of a built marginal CDF closure (makeMarginalMpiCdf), and in one gammaquant(7.5, 2e6, 0.025).
Expectata: none in the evaluations (the closure computes lgamma(a0) at build) and one in gammaquant (once for its shape, not once a Newton step).
Resultata: ${perEval} calls in the evaluations, ${quant} in gammaquant.`);
}

console.log("qual pass: gamma distribution math matches reference values");

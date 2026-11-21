// The chi-squared distribution's two tails, computed apart from crashla.js
// (whose own come from its regularized incomplete gamma function, gammainc):
// the reference the quals hold the Poisson dispersion table's test to
// (quals/sanity-windows.qual.mjs) and gammainc itself at the shapes that test
// uses (quals/gamma-math.qual.mjs).
//
// A chi-squared variable with df degrees of freedom is the squared length of
// df standard normals, so with x = u² its density over u is
//   2 u^(df-1) e^(-u²/2) / (2^(df/2) Γ(df/2)),
// smooth from u = 0 for every df (over x itself, df = 1 has a singularity at
// 0). Each tail is that density integrated by Simpson's rule: the lower tail
// from 0 to √x, the upper from √x on, both cut where the density has died
// out (REACH past the larger of √x and √df: under e^-70 of its peak there).
// Γ(df/2) is exact: Γ(1) = 1 and Γ(1/2) = √π, times each z on the way up.
// With PANELS panels over at most √df + REACH the rule's error is under
// about 1e-9 for df up to 63 (the longest series the page tests: 64 months);
// checkChiSquaredReference() holds the tails to standard table values.
import assert from "node:assert/strict";

const PANELS = 4000;
const REACH = 12;

function logNorm(df) {
  assert.ok(Number.isInteger(df) && df >= 1, `chi-squared reference: df must be a whole number of 1 or more, not ${df}`);
  let logGamma = df % 2 === 0 ? 0 : Math.log(Math.sqrt(Math.PI));
  for (let z = df % 2 === 0 ? 1 : 0.5; z < df / 2 - 0.25; z += 1) logGamma += Math.log(z);
  return Math.log(2) - (df / 2) * Math.log(2) - logGamma;
}

function integrate(df, from, to) {
  const norm = logNorm(df);
  const f = u => u === 0 ? Number(df === 1) * Math.exp(norm) : Math.exp(norm + (df - 1) * Math.log(u) - u * u / 2);
  const h = (to - from) / PANELS;
  let sum = f(from) + f(to);
  for (let i = 1; i < PANELS; i++) sum += (i % 2 === 1 ? 4 : 2) * f(from + i * h);
  return sum * h / 3;
}

// P(X² <= x) and P(X² >= x) for a chi-squared X² with df degrees of freedom.
export function chiSquaredLower(x, df) {
  assert.ok(x >= 0, `chi-squared reference: x must be 0 or more, not ${x}`);
  return integrate(df, 0, Math.min(Math.sqrt(x), Math.sqrt(df) + REACH));
}
export function chiSquaredUpper(x, df) {
  assert.ok(x >= 0, `chi-squared reference: x must be 0 or more, not ${x}`);
  const from = Math.sqrt(x);
  return integrate(df, from, Math.max(from, Math.sqrt(df)) + REACH);
}

// The x at which a tail of df degrees of freedom holds p: side "lower" for
// P(X² <= x) = p, which rises with x, "upper" for P(X² >= x) = p, which
// falls; by bisection, to a relative 1e-13.
export function chiSquaredCritical(side, p, df) {
  assert.ok(side === "lower" || side === "upper", `chi-squared reference: the side is "lower" or "upper", not ${side}`);
  const below = side === "lower" ? x => chiSquaredLower(x, df) < p : x => chiSquaredUpper(x, df) > p;
  let lo = 1e-12, hi = 40 * df + 400;
  assert.ok(below(lo) && !below(hi), `chi-squared reference: no ${side} ${p} point of ${df} degrees of freedom between ${lo} and ${hi}`);
  for (let i = 0; i < 200 && hi / lo > 1 + 1e-13; i++) {
    const mid = Math.sqrt(lo * hi);
    if (below(mid)) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

// Standard table values: the upper 5% points of 1, 2, 5, 10, 20, 30 and 60
// degrees of freedom, and the lower 5% points of 2, 10 and 60 (the usual
// printed tables, e.g. NIST/SEMATECH e-Handbook of Statistical Methods,
// section 1.3.6.7.4; 3.841459 is 1.959964², and 5.991465 is -2 ln 0.05).
const TABLE = [
  ["upper", 1, 3.841459], ["upper", 2, 5.991465], ["upper", 5, 11.070498], ["upper", 10, 18.307038],
  ["upper", 20, 31.410433], ["upper", 30, 43.772972], ["upper", 60, 79.081944],
  ["lower", 2, 0.102587], ["lower", 10, 3.940299], ["lower", 60, 43.187958],
];
export function checkChiSquaredReference() {
  const off = TABLE.map(([side, df, x]) => ({ side, df, x, tail: (side === "upper" ? chiSquaredUpper : chiSquaredLower)(x, df) }))
    .filter(r => Math.abs(r.tail - 0.05) > 2e-7);
  // The two tails are complements, and the closed form for 2 degrees of
  // freedom, e^(-x/2), is met to the rule's precision.
  const sums = [[0.3, 1], [2.5, 3], [18, 10], [70, 63]].map(([x, df]) => ({ x, df, sum: chiSquaredLower(x, df) + chiSquaredUpper(x, df) }))
    .filter(r => Math.abs(r.sum - 1) > 1e-8);
  const closed = [0.01, 1, 6, 30].map(x => ({ x, got: chiSquaredUpper(x, 2), want: Math.exp(-x / 2) })).filter(r => Math.abs(r.got - r.want) > 1e-9);
  assert.ok(off.length === 0 && sums.length === 0 && closed.length === 0,
    `Replicata: evaluate the quals' chi-squared reference (quals/chi-squared.mjs) at the standard table's 5% points, sum its two tails at four points, and compare its upper tail for 2 degrees of freedom with e^(-x/2).
Expectata: each table point's tail within 2e-7 of 0.05 (the table prints six decimals), each pair of tails summing to 1 within 1e-8, the closed form met within 1e-9.
Resultata: off the table ${JSON.stringify(off)}; sums ${JSON.stringify(sums)}; closed form ${JSON.stringify(closed)}.`);
}

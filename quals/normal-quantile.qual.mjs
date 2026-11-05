// The standard normal quantile function, normalQuantile (crashla.js), that
// the growth forecasts' two-piece bands take their quantiles from (since
// 2026-11-04, when scenario C became the comonotonic sum of its parts: each
// C component's p-quantile is the sum of its parts' p-quantiles). It is
// algorithm AS 241 (Wichura 1988, PPND16), three rational functions: p within
// 0.425 of one half, and the tails with r = sqrt(-ln(min(p, 1 - p))) at most 5
// and beyond. Checked here against reference values from mpmath at 60 digits
// (each p the double written; each reference rounded to the nearest double),
// with points on both sides of each region's boundary (p = 0.075 and 0.925,
// where |p - 1/2| = 0.425; p = e^-25 = 1.3887943864964021e-11, where r = 5)
// and in both tails; for exact symmetry where 1 - p is exact; for strict
// increase over a dense grid of p; and for a loud failure outside (0, 1).
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console, Math, Number, Object, JSON,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
assert.equal(vm.runInContext("typeof normalQuantile", ctx), "function",
  `Replicata: load crashla.js and look up normalQuantile.
Expectata: a function (the standard normal quantile the growth forecasts' bands use).
Resultata: ${vm.runInContext("typeof normalQuantile", ctx)}.`);
const normalQuantile = p => vm.runInContext(`normalQuantile(${p})`, ctx);

// [p, the standard normal quantile at p] (mpmath, 60 digits).
const REFERENCES = [
  [1e-300, -37.0470962993612],
  [1e-100, -21.273453560965326],
  [1e-20, -9.262340089798407],
  [1.3889332659350517e-11, -6.657889942627787], // e^-25 x 1.0001: r just under 5
  [1.3886555209443076e-11, -6.6579193443432825], // e^-25 / 1.0001: r just over 5
  [1e-10, -6.361340902404057],
  [1e-5, -4.264890793922825],
  [0.001, -3.0902323061678136],
  [0.01, -2.326347874040841],
  [0.025, -1.9599639845400543],
  [0.05, -1.6448536269514726],
  [0.0749, -1.4402382675279637],
  [0.075, -1.439531470938456],
  [0.0751, -1.43882539275254],
  [0.1, -1.2815515655446004],
  [0.25, -0.6744897501960817],
  [0.4, -0.2533471031357997],
  [0.5, 0],
  [0.6, 0.2533471031357997],
  [0.75, 0.6744897501960817],
  [0.9, 1.2815515655446006],
  [0.9249, 1.4388253927525403],
  [0.925, 1.4395314709384561],
  [0.9251, 1.440238267527964],
  [0.95, 1.6448536269514722],
  [0.975, 1.9599639845400538],
  [0.99, 2.3263478740408408],
  [0.999, 3.090232306167813],
  [0.99999, 4.264890793923841],
  [0.9999999999, 6.361340889697422],
  [0.999999999999999, 7.941444487415978],
];
// AS 241 is accurate to about one part in 1e16; this allows a few units in
// the last place.
const TOLERANCE = 4e-15;
const off = REFERENCES.map(([p, want]) => ({p, want, got: normalQuantile(p)}))
  .filter(({want, got}) => !(Math.abs(got - want) <= TOLERANCE * Math.max(1, Math.abs(want))));
assert.ok(off.length === 0,
  `Replicata: evaluate normalQuantile (crashla.js) at ${REFERENCES.length} reference points from 1e-300 to 1 - 1e-15.
Expectata: each within ${TOLERANCE} (relative, or absolute under 1) of the standard normal quantile computed by mpmath at 60 digits.
Resultata: ${off.map(({p, want, got}) => `at ${p}: ${got} against ${want}`).join("; ")}.`);

// Exact symmetry where 1 - p is exact (p a multiple of 2^-10), and strict
// increase over a grid of distinct points dense in both tails.
const asymmetric = Array.from({length: 511}, (_, i) => (i + 1) / 1024)
  .filter(p => normalQuantile(1 - p) !== -normalQuantile(p));
assert.ok(asymmetric.length === 0,
  `Replicata: evaluate normalQuantile at p = k / 1024 and at 1 - p, for k = 1 to 511 (1 - p exact).
Expectata: normalQuantile(1 - p) = -normalQuantile(p) exactly.
Resultata: not so at p = ${asymmetric.slice(0, 10).join(", ")}${asymmetric.length > 10 ? ", ..." : ""}.`);
const grid = [...new Set([...Array.from({length: 300}, (_, i) => 10 ** (-300 + i)), ...Array.from({length: 9999}, (_, i) => (i + 1) / 10000),
  ...Array.from({length: 15}, (_, i) => 1 - 10 ** (-1 - i))])].sort((a, b) => a - b);
const zs = grid.map(normalQuantile);
const notIncreasing = grid.slice(1).map((p, i) => [grid[i], p]).filter((_, i) => !(zs[i + 1] > zs[i]));
assert.ok(notIncreasing.length === 0,
  `Replicata: evaluate normalQuantile on ${grid.length} points from 1e-300 to 1 - 1e-15, in increasing order.
Expectata: strictly increasing.
Resultata: not increasing from ${notIncreasing.slice(0, 5).map(([a, b]) => `${a} to ${b}`).join("; ")}.`);

// Outside (0, 1) it fails loudly (anti-Postel), as must NaN.
const quiet = [0, 1, -0.5, 1.5, NaN].filter(p => {
  try { normalQuantile(p); return true; } catch (_e) { return false; }
});
assert.ok(quiet.length === 0,
  `Replicata: evaluate normalQuantile at 0, 1, -0.5, 1.5 and NaN.
Expectata: a throw at each (the quantile is defined for 0 < p < 1).
Resultata: no throw at ${quiet.join(", ")}.`);

console.log(`qual pass: normalQuantile matches ${REFERENCES.length} mpmath references within ${TOLERANCE} from 1e-300 to 1 - 1e-15, is exactly antisymmetric about 1/2 and strictly increasing, and fails outside (0, 1)`);

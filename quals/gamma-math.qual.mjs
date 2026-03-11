import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

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

console.log("qual pass: gamma distribution math matches reference values");

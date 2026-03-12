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

// --- fmtMiles: boundary cases ---

const milesTests = [
  [0,           "0"],
  [500,         "500"],
  [999,         "999"],
  [1000,        "1.0K"],
  [1500,        "1.5K"],
  [10000,       "10.0K"],
  [100000,      "100.0K"],
  [999949,      "999.9K"],
  [999950,      "1.0M"],       // was "1000.0K" before fix
  [999999,      "1.0M"],
  [1000000,     "1.0M"],
  [1500000,     "1.5M"],
  [75000000,    "75.0M"],
  [130000000,   "130.0M"],
  [999949999,   "999.9M"],
  [999950000,   "1.0B"],       // was "1000.0M" before fix
  [1000000000,  "1.0B"],
];

for (const [input, expected] of milesTests) {
  const got = run(`fmtMiles(${input})`);
  assert.equal(got, expected,
    `Replicata: fmtMiles(${input}).
Expectata: ${JSON.stringify(expected)}.
Resultata: ${JSON.stringify(got)}.`);
}

// --- fmtMiles: no formatted string contains "1000." ---

for (const n of [999950, 999999, 999950000, 999999999, 1e12 - 1]) {
  const s = run(`fmtMiles(${n})`);
  assert.ok(
    !s.includes("1000."),
    `Replicata: fmtMiles(${n}).
Expectata: no "1000." in output.
Resultata: ${JSON.stringify(s)}.`);
}

// --- fmtMiles: monotonicity ---

const parseMiles = s => {
  const mult = {K: 1e3, M: 1e6, B: 1e9, T: 1e12};
  const m = s.match(/^([\d,.]+)([KMBT])?$/);
  if (!m) return NaN;
  const num = Number(m[1].replace(/,/g, ""));
  return m[2] ? num * mult[m[2]] : num;
};

const monoInputs = [
  0, 1, 500, 999, 1000, 5000, 50000, 500000, 999949, 999950, 1000000,
  5000000, 50000000, 999949999, 999950000, 1000000000,
];

let prev = -Infinity;
for (const n of monoInputs) {
  const s = run(`fmtMiles(${n})`);
  const parsed = parseMiles(s);
  assert.ok(
    parsed >= prev,
    `Replicata: fmtMiles monotonicity at ${n}.
Expectata: parsed value >= previous (${prev}).
Resultata: ${JSON.stringify(s)} parses to ${parsed}.`);
  prev = parsed;
}

// --- fmtCount ---

const countTests = [
  [0,     "0"],
  [0.5,   "0.5"],
  [1,     "1"],
  [9.94,  "9.9"],
  [9.95,  "10"],
  [100,   "100"],
];

for (const [input, expected] of countTests) {
  const got = run(`fmtCount(${input})`);
  assert.equal(got, expected,
    `Replicata: fmtCount(${input}).
Expectata: ${JSON.stringify(expected)}.
Resultata: ${JSON.stringify(got)}.`);
}

// --- fmtWhole ---

const wholeTests = [
  [0,       "0"],
  [0.4,     "0"],
  [0.5,     "1"],
  [999,     "999"],
  [1000,    "1,000"],
  [1000000, "1,000,000"],
];

for (const [input, expected] of wholeTests) {
  const got = run(`fmtWhole(${input})`);
  assert.equal(got, expected,
    `Replicata: fmtWhole(${input}).
Expectata: ${JSON.stringify(expected)}.
Resultata: ${JSON.stringify(got)}.`);
}

// --- fmtRatio ---

const ratioTests = [
  [0.004,  "0.00"],
  [0.005,  "0.01"],
  [0.5,    "0.50"],
  [9.99,   "9.99"],
  [9.995,  "10.0"],       // was "9.99" before fix (toFixed(2) tier)
  [9.999,  "10.0"],       // was "10.00" before fix
  [10,     "10.0"],
  [99.949, "99.9"],
  [99.95,  "100"],        // was "100.0" before fix
  [99.99,  "100"],        // was "100.0" before fix
  [100,    "100"],
  [150,    "150"],
];

for (const [input, expected] of ratioTests) {
  const got = run(`fmtRatio(${input})`);
  assert.equal(got, expected,
    `Replicata: fmtRatio(${input}).
Expectata: ${JSON.stringify(expected)}.
Resultata: ${JSON.stringify(got)}.`);
}

// --- fmtRatio: no rollover artifacts ---

for (const n of [9.996, 9.999, 99.95, 99.99]) {
  const s = run(`fmtRatio(${n})`);
  assert.ok(
    !/^10\.00$/.test(s) && !/^100\.0$/.test(s),
    `Replicata: fmtRatio(${n}).
Expectata: no rollover artifact ("10.00" or "100.0").
Resultata: ${JSON.stringify(s)}.`);
}

console.log("qual pass: formatting functions handle boundaries correctly");

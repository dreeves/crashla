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

// A value that is a whole number of its unit drops the ".0" (audit #58:
// tick labels and authored band edges read "200.0K", "1.0M", "103.0K" until
// 2026-10-03); a value that only rounds to one keeps it, since there the 0
// is a digit of precision ("1.954M" shows "2.0M", not "2M").
const milesTests = [
  [0,           "0"],
  [500,         "500"],
  [999,         "999"],
  [1000,        "1K"],
  [1500,        "1.5K"],
  [10000,       "10K"],
  [100000,      "100K"],
  [103000,      "103K"],
  [527000,      "527K"],
  [999949,      "999.9K"],
  [999950,      "1.0M"],       // was "1000.0K" before fix; 999,950 is not 1M, so the ".0" stays
  [999999,      "1.0M"],
  [1000000,     "1M"],
  [1500000,     "1.5M"],
  [1954000,     "2.0M"],
  [75000000,    "75M"],
  [130000000,   "130M"],
  [999949999,   "999.9M"],
  [999950000,   "1.0B"],       // was "1000.0M" before fix
  [1000000000,  "1B"],
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

// A fractional count is grouped like a whole one (audit #54's one format for
// counts): a fault mass of 1,234.5 must not read "1234.5" beside "1,234".
const countTests = [
  [0,     "0"],
  [0.5,   "0.5"],
  [1,     "1"],
  [9.94,  "9.9"],
  [9.95,  "10"],
  [100,   "100"],
  [1234,   "1,234"],
  [1234.5, "1,234.5"],
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

// --- fmtRatio: the one multiplier format ---
// Every AV-vs-human multiplier (summary cards, their All-incidents line, the
// stress tables, the fault-flip multipliers) reads two significant figures
// below 10 and a whole number from 10 (audit #55). Until 2026-10-03 the cards
// printed toFixed(1) below 10 ("0.0x" for Tesla's 0.026 fatality multiplier,
// "10.0x" for 9.96) and fmtRatio three tiers ("0.00x", "10.0x" .. "99.9x").
// ratioShown is the value printed, from which the safer/worse colour is read
// (a 0.996 printed "1.0x" in the worse red).
const ratioTests = [
  [1e-7,    "0.00000010"],  // no exponent, however small
  [0.0021,  "0.0021"],
  [0.004,   "0.0040"],      // was "0.00"
  [0.005,   "0.0050"],      // was "0.01"
  [0.026,   "0.026"],
  [0.5,     "0.50"],
  [0.959,   "0.96"],
  [0.996,   "1.0"],
  [1.043,   "1.0"],
  [9.94,    "9.9"],
  [9.96,    "10"],          // two significant figures round to 10: a whole number
  [9.99,    "10"],          // was "9.99"
  [9.995,   "10"],          // was "10.0"
  [9.996,   "10"],          // the old rollover cases: never "10.00"
  [9.999,   "10"],          // was "10.0"
  [10,      "10"],          // was "10.0"
  [13.8,    "14"],          // was "13.8"
  [99.949,  "100"],         // was "99.9"
  [99.95,   "100"],
  [99.99,   "100"],         // never "100.0"
  [100,     "100"],
  [150,     "150"],
  [37125.4, "37,125"],
];

for (const [input, expected] of ratioTests) {
  let got;
  try { got = run(`fmtRatio(${input})`); } catch (e) { got = `throws ${e.message}`; }
  assert.equal(got, expected,
    `Replicata: fmtRatio(${input}).
Expectata: ${JSON.stringify(expected)} (two significant figures below 10, a whole number from 10).
Resultata: ${JSON.stringify(got)}.`);
}

for (const [input, expected] of [[0.996, 1], [0.959, 0.96], [9.96, 10], [13.8, 14], [0.0021, 0.0021]]) {
  let got;
  try { got = run(`ratioShown(${input})`); } catch (e) { got = `throws ${e.message}`; }
  assert.equal(got, expected,
    `Replicata: ratioShown(${input}), the value fmtRatio prints.
Expectata: ${expected}.
Resultata: ${JSON.stringify(got)}.`);
}

// --- Numbers print in en-US whatever the browser's language (audit #37) ---
// In a de-DE browser the locale-less toLocaleString() grouped with "." while
// decimals stayed ".": "1.164 incidents" (1,164) beside "93.2 incidents", and
// "37.125x" (37,125x) beside "11x". A context whose locale-less number
// formatting defaults to de-DE (or ar-EG, which also changes the digits) must
// print what en-US prints.
for (const fallback of ["de-DE", "ar-EG"]) {
  const loc = vm.createContext({
    console,
    document: {
      getElementById() { return null; },
      createElement() { return { textContent: "", innerHTML: "" }; },
    },
  });
  vm.runInContext(`(() => {
    const proto = Object.getPrototypeOf(0);
    const toLocale = proto.toLocaleString;
    proto.toLocaleString = function (locales, options) { return toLocale.call(this, locales === undefined ? ${JSON.stringify(fallback)} : locales, options); };
    const NF = Intl.NumberFormat;
    Intl.NumberFormat = function (locales, options) { return new NF(locales === undefined ? ${JSON.stringify(fallback)} : locales, options); };
  })();`, loc);
  vm.runInContext(appScript, loc, { filename: "crashla.js" });
  for (const [expr, expected] of [
    ["fmtWhole(1164)", "1,164"], ["fmtWhole(2306848)", "2,306,848"], ["fmtCount(1164)", "1,164"],
    ["fmtCount(93.25)", "93.3"], ["fmtMiles(500)", "500"], ["fmtMiles(184535)", "184.5K"],
    ["fmtRatio(37125.4)", "37,125"], ["fmtRatio(0.026)", "0.026"],
  ]) {
    let got;
    try { got = vm.runInContext(expr, loc); } catch (e) { got = `throws ${e.message}`; }
    assert.equal(got, expected,
      `Replicata: ${expr} in a page whose browser language is ${fallback}.
Expectata: ${JSON.stringify(expected)}, as in en-US.
Resultata: ${JSON.stringify(got)}.`);
  }
}
// Every number formatter in crashla.js names its locale.
{
  const app = appScript.replace(/\/\/[^\n]*/g, "");
  const bare = [...app.matchAll(/\.toLocaleString\(\s*\)|new Intl\.NumberFormat\(\s*(?:\)|\{|undefined)/g)].map(m => m[0]);
  assert.deepEqual(bare, [],
    `Replicata: find toLocaleString() and new Intl.NumberFormat(...) calls in crashla.js without a locale.
Expectata: none (each names NUMBER_LOCALE).
Resultata: ${JSON.stringify(bare)}.`);
}

// --- faultSum: fault mass is summed on its 0.05 grid (audit #56) ---
// Fault values are multiples of 0.05, but their float sum drifts off the grid
// (Waymo's default-window at-fault mass summed to 93.24999999999997 and
// printed 93.2, while 8.55 printed 8.6). Summed in whole twentieths it is
// exact, and an off-grid value is an error, not a rounding.
{
  let got;
  try { got = run(`[faultSum([0.05, 0.1, 0.15]), faultSum([]), faultSum(Array(1865).fill(0.05)), fmtCount(faultSum(Array(1865).fill(0.05)))]`); } catch (e) { got = `throws ${e.message}`; }
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [0.3, 0, 93.25, "93.3"],
    `Replicata: faultSum([0.05, 0.1, 0.15]), faultSum([]), and 1,865 values of 0.05 (93.25) through fmtCount.
Expectata: [0.3, 0, 93.25, "93.3"] (exact, where the float sums give 0.30000000000000004 and 93.24999999999997).
Resultata: ${JSON.stringify(got)}.`);
  let threw = null;
  try { run("faultSum([0.05, 0.33])"); } catch (e) { threw = e.message; }
  assert.ok(threw !== null && /0\.05 grid/.test(threw),
    `Replicata: faultSum([0.05, 0.33]).
Expectata: it throws, naming the 0.05 grid (0.33 is not a fault value).
Resultata: ${JSON.stringify(threw)}.`);
}

// --- fmtShare: a nonzero count never reads as 0% -----------------------------
// The sanity section's Severity breakdown printed "2 (0%)" for Waymo's 2
// fatalities in 1,164 incidents (0.17%; audit #58). A share that rounds to
// 0% while its count is not 0 reads "<1%".
const shareTests = [
  [0, 10, "0%"], [5, 10, "50%"], [2, 1164, "<1%"], [6, 1164, "1%"], [1, 3, "33%"], [10, 10, "100%"],
];
for (const [k, n, expected] of shareTests) {
  const got = run(`fmtShare(${k}, ${n})`);
  assert.equal(got, expected,
    `Replicata: fmtShare(${k}, ${n}).
Expectata: ${JSON.stringify(expected)}.
Resultata: ${JSON.stringify(got)}.`);
}

console.log("qual pass: formatting functions handle boundaries correctly");

// --- splur: the plural follows the DISPLAYED count, not the raw number ------
// fmtCount rounds to one decimal, so a fault mass of 0.96 shows as "1"; the
// word must agree with what the reader sees ("1 incident"), not with the
// unrounded value (until 2026-09-26: "1 incidents" on the cards and dot
// tooltips whenever the at-fault mass fell in [0.95, 1.05) but was not 1).
for (const [n, expected] of [
  [1, "1 incident"], [0.96, "1 incident"], [1.04, "1 incident"],
  [1.06, "1.1 incidents"], [0.5, "0.5 incidents"], [2, "2 incidents"], [0, "0 incidents"],
]) {
  assert.equal(run(`splur(${n}, "incident")`), expected,
    `Replicata: splur(${n}, "incident").
Expectata: ${JSON.stringify(expected)} (singular iff the displayed count is "1").
Resultata: ${JSON.stringify(run(`splur(${n}, "incident")`))}.`);
}

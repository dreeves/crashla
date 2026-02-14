import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("index.html", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(
  scriptMatch,
  "Replicata: parse index.html. Expectata: inline app script exists. Resultata: script tag missing.",
);
const appScript = scriptMatch[1].split("// --- Init ---")[0];

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "index.html" });

const defaults = vm.runInContext(`
(() => {
  const byId = sliders => Object.fromEntries(sliders.map(s => [s.id, s.value]));
  return {
    Tesla: byId(COMPANIES.Tesla.sliders),
    Waymo: byId(COMPANIES.Waymo.sliders),
    Zoox: byId(COMPANIES.Zoox.sliders),
    Humans: byId(COMPANIES.Humans.sliders),
  };
})()
`, ctx);

const plainDefaults = JSON.parse(JSON.stringify(defaults));
const keyRanges = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const pick = (company, id) => {
    const s = COMPANIES[company].sliders.find(x => x.id === id);
    return {min: s.min, max: s.max, step: s.step, value: s.value};
  };
  return {
    teslaMiles: pick("Tesla", "tesla-miles"),
    teslaDeadhead: pick("Tesla", "tesla-deadhead"),
    waymoMiles: pick("Waymo", "waymo-miles"),
    waymoDeadhead: pick("Waymo", "waymo-deadhead"),
    zooxMiles: pick("Zoox", "zoox-miles"),
    zooxDeadhead: pick("Zoox", "zoox-deadhead"),
    humansWaymoDivisor: pick("Humans", "humans-waymo-divisor"),
  };
})()
`, ctx)));

assert.deepEqual(
  plainDefaults,
  {
    Tesla: {
      "tesla-miles": 450000,
      "tesla-frac": 70,
      "tesla-deadhead": 20,
    },
    Waymo: {
      "waymo-miles": 61000000,
      "waymo-deadhead": 0,
    },
    Zoox: {
      "zoox-miles": 300000,
      "zoox-deadhead": 20,
    },
    Humans: {
      "humans-waymo-divisor": 5,
    },
  },
  `Replicata: read slider default values from COMPANIES.
Expectata: defaults match the README-derived settings for denominator estimates.
  Resultata: defaults were ${JSON.stringify(plainDefaults)}.`,
);

assert.deepEqual(
  keyRanges,
  {
    teslaMiles: {min: 94000, max: 600000, step: 1000, value: 450000},
    teslaDeadhead: {min: 0, max: 40, step: 1, value: 20},
    waymoMiles: {min: 57000000, max: 66000000, step: 1000000, value: 61000000},
    waymoDeadhead: {min: 0, max: 50, step: 1, value: 0},
    zooxMiles: {min: 50000, max: 1000000, step: 25000, value: 300000},
    zooxDeadhead: {min: 0, max: 40, step: 1, value: 20},
    humansWaymoDivisor: {min: 2, max: 10, step: 0.1, value: 5},
  },
  `Replicata: inspect tightened slider ranges in COMPANIES.
Expectata: ranges and defaults match source-backed denominator assumptions.
Resultata: got ${JSON.stringify(keyRanges)}.`,
);

console.log("qual pass: slider defaults match README-derived settings");

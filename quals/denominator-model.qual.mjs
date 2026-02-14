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

const tesla = vm.runInContext(`
COMPANIES.Tesla.getParts({
  "tesla-miles": 456000,
  "tesla-frac": 50,
  "tesla-deadhead": 20
})
`, ctx);
const teslaExpectedBaseNone = 93849 + 0.5 * (456000 - 93849);
const teslaExpectedMiles = teslaExpectedBaseNone * (1 / (1 - 0.2));
assert.ok(
  Math.abs(tesla.baseNoneMiles - teslaExpectedBaseNone) < 1e-9 &&
  Math.abs(tesla.miles - teslaExpectedMiles) < 1e-9,
  `Replicata: compute Tesla denominator parts from configured sliders.
Expectata: pre-Sep miles always count as none, then apply deadhead multiplier with scope fixed to 100%.
Resultata: baseNone=${tesla.baseNoneMiles}, expectedBaseNone=${teslaExpectedBaseNone}, miles=${tesla.miles}, expectedMiles=${teslaExpectedMiles}.`,
);

const waymo = vm.runInContext(`
COMPANIES.Waymo.getParts({
  "waymo-miles": 50000000,
  "waymo-deadhead": 0
})
`, ctx);
assert.equal(
  waymo.miles,
  50000000,
  `Replicata: compute Waymo denominator with locked 100% factors and 0% deadhead.
Expectata: denominator equals base miles.
Resultata: denominator was ${waymo.miles}.`,
);

const zoox = vm.runInContext(`
COMPANIES.Zoox.getParts({
  "zoox-miles": 500000,
  "zoox-deadhead": 20
})
`, ctx);
const zooxExpected = 500000 * (1 / (1 - 0.2));
assert.ok(
  Math.abs(zoox.miles - zooxExpected) < 1e-9,
  `Replicata: compute Zoox denominator parts from configured sliders.
Expectata: denominator equals B * m_deadhead with operator=none and scope fixed to 100%.
Resultata: denominator was ${zoox.miles}, expected ${zooxExpected}.`,
);

console.log("qual pass: denominator slider model computes expected miles");

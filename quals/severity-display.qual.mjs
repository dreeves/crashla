import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Extract every unique severity string from the incident data
const severities = vm.runInContext(
  `[...new Set(INCIDENT_DATA.map(r => r.severity))]`, ctx);

assert.ok(
  severities.length >= 5,
  `Replicata: collect unique severity strings from INCIDENT_DATA.
Expectata: at least 5 distinct severity values.
Resultata: found ${severities.length}.`);

// Every severity in the data must produce a non-"?" display string
for (const sev of severities) {
  const short = vm.runInContext(
    `shortenSeverity(${JSON.stringify(sev)})`, ctx);
  assert.notStrictEqual(
    short, "?",
    `Replicata: call shortenSeverity(${JSON.stringify(sev)}).
Expectata: a recognized short label (not "?").
Resultata: got "?".`);
}

// "Property Damage. No Injured Reported" must map to "Property only",
// not "No injury" (regression: "No Injur" must not match before "Property")
const propDmg = vm.runInContext(
  `shortenSeverity("Property Damage. No Injured Reported")`, ctx);
assert.strictEqual(
  propDmg, "Property only",
  `Replicata: call shortenSeverity("Property Damage. No Injured Reported").
Expectata: "Property only".
Resultata: ${JSON.stringify(propDmg)}.`);

// "No Injured Reported" and "No Injuries Reported" must both map to "No injury"
for (const variant of ["No Injured Reported", "No Injuries Reported"]) {
  const short = vm.runInContext(
    `shortenSeverity(${JSON.stringify(variant)})`, ctx);
  assert.strictEqual(
    short, "No injury",
    `Replicata: call shortenSeverity(${JSON.stringify(variant)}).
Expectata: "No injury".
Resultata: ${JSON.stringify(short)}.`);
}

console.log("qual pass: shortenSeverity handles all severity strings in the data");

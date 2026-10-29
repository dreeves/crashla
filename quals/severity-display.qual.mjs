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

// The display labels' words are the human's ("Serious injury (hosp.)" since
// 2026-08-17) and are not pinned (2026-10-28, human-approved: a qual pinning
// the human's own wording went red on each of the human's edits and caught no
// agent's; the human reviews every diff). What is checked is which of
// shortenSeverity's rules an NHTSA string reaches, by comparing labels.
const short = s => vm.runInContext(`shortenSeverity(${JSON.stringify(s)})`, ctx);

// "Property Damage. No Injured Reported" takes the property-damage label, not
// the no-injury one (regression: "No Injur" must not match before "Property").
assert.ok(
  short("Property Damage. No Injured Reported") === short("Property Damage")
    && short("Property Damage") !== short("No Injuries Reported"),
  `Replicata: call shortenSeverity on "Property Damage. No Injured Reported", "Property Damage" and "No Injuries Reported".
Expectata: the first two share the property-damage label, which differs from the no-injury label.
Resultata: ${JSON.stringify(["Property Damage. No Injured Reported", "Property Damage", "No Injuries Reported"].map(short))}.`);

// "No Injured Reported" and "No Injuries Reported" share the no-injury label
// (a rule's, not either string falling through).
assert.ok(
  short("No Injured Reported") === short("No Injuries Reported")
    && !["No Injured Reported", "No Injuries Reported"].includes(short("No Injuries Reported")),
  `Replicata: call shortenSeverity on "No Injured Reported" and "No Injuries Reported".
Expectata: one label for both, from a rule.
Resultata: ${JSON.stringify(["No Injured Reported", "No Injuries Reported"].map(short))}.`);

// "Serious W/ Hospitalization" (first seen in NHTSA's Aug-2026 data) gets its
// own hosp-qualified label like the Minor/Moderate "(hosp.)" rows, keyed on
// the FULL string: the SGO data dictionary also defines a "Serious Without
// Hospitalization" sibling, and a "Serious W/" prefix needle would label that
// "(hosp.)" too. The sibling must keep falling through to the bare label.
assert.ok(
  short("Serious W/ Hospitalization") !== short("Serious")
    && short("Serious W/O Hospitalization") === short("Serious"),
  `Replicata: call shortenSeverity on "Serious W/ Hospitalization", "Serious" and "Serious W/O Hospitalization" (dictionary-defined, not yet in the data).
Expectata: the first its own label; the third bare "Serious"'s label, not the hosp-qualified one via a prefix match.
Resultata: ${JSON.stringify(["Serious W/ Hospitalization", "Serious", "Serious W/O Hospitalization"].map(short))}.`);

// Every known (non-Unknown) severity in the data must have a SEVERITY_RANK entry
const rankKeys = vm.runInContext(`Object.keys(SEVERITY_RANK)`, ctx);
for (const sev of severities) {
  if (sev === "Unknown") continue;
  assert.ok(
    rankKeys.includes(sev),
    `Replicata: check SEVERITY_RANK for ${JSON.stringify(sev)}.
Expectata: severity string has an explicit rank entry.
Resultata: missing from SEVERITY_RANK.`);
}

// Relative ordering: Serious < Fatality, Minor < Moderate, no-injury < Minor
const rank = vm.runInContext(`(s) => SEVERITY_RANK[s]`, ctx);
assert.ok(rank("Serious") < rank("Fatality"),
  "Expectata: Serious ranks below Fatality.");
assert.ok(rank("Minor") < rank("Moderate"),
  "Expectata: Minor ranks below Moderate.");
assert.ok(rank("No Injuries Reported") < rank("Minor"),
  "Expectata: No Injuries Reported ranks below Minor.");

console.log("qual pass: shortenSeverity handles all severity strings in the data");

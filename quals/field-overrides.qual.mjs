// Narrative-vs-field override pins (2026-08-22 audit): eight rows whose
// structured severity flatly contradicts the filing's own narrative (injury
// claims, stated hospital transports, and archive-era bare tiers that predate
// the W/-Hospitalization split), and five rows whose narratives assert airbag
// deployment the SGO SV/CP columns structurally cannot record (third-vehicle
// deployments and Waymo's own reporting-trigger sentences). The overrides
// live in data/slurp.py (SEVERITY_OVERRIDE / AIRBAG_OVERRIDE); these pins
// prove they flow into data/incidents.js and guard against a regen silently
// dropping them.
import assert from "node:assert/strict";
import vm from "node:vm";
import { dataScript } from "./load-app.mjs";

const ctx = vm.createContext({});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
const incidents = vm.runInContext("INCIDENT_DATA", ctx);
const byId = new Map(incidents.map(r => [r.reportId, r]));

const SEVERITY_PINS = {
  "30270-11565": "Minor W/O Hospitalization",  // passenger injury claim; field said Property Damage
  "30270-9789":  "Minor W/ Hospitalization",   // "transported ... to a hospital"; archive bare Minor
  "30270-10892": "Minor W/ Hospitalization",   // same transport sentence; archive bare Minor
  "30270-9987":  "Moderate W/ Hospitalization", // doored cyclist ambulance transport; bare Moderate
  "30270-9992":  "Moderate W/ Hospitalization", // two transported; bare Moderate
  "30270-9860":  "Moderate W/ Hospitalization", // three transported; bare Moderate
  "30270-11450": "Moderate W/ Hospitalization", // transport stated as SGO trigger; field said W/O
  "30610-10473": "Minor W/O Hospitalization",  // v2 filed to add injury claim; field never updated
  // Field "Unknown"; narrative says transported with unknown injuries; Waymo's
  // Sep-24-2026 hub release notes quote a police General Offense Report:
  // "treated at a hospital for injuries described as life threatening"
  "30270-13817": "Serious W/ Hospitalization",
  // Field "Property Damage. No Injured Reported"; narrative: the passenger
  // "reported feeling \"dazed\" and \"kind of woozy\" and requested emergency
  // services", no transport stated (2026-10-03, audit finding #44; Zoox coded
  // the comparable 30610-15062 "whiplash", treatment declined, Minor W/O)
  "30610-15722": "Minor W/O Hospitalization",
};
for (const [rid, want] of Object.entries(SEVERITY_PINS)) {
  const rec = byId.get(rid);
  assert.ok(rec !== undefined && rec.severity === want,
    `Replicata: read ${rid} from data/incidents.js.
Expectata: severity "${want}" (narrative-contradiction override in slurp.py).
Resultata: ${rec === undefined ? "row missing" : JSON.stringify(rec.severity)}.`);
}

const AIRBAG_PINS = ["30270-9767", "30270-10174", "30270-10573", "30270-13877", "30270-6542"];
for (const rid of AIRBAG_PINS) {
  const rec = byId.get(rid);
  assert.ok(rec !== undefined && rec.airbagAny === true,
    `Replicata: read ${rid} from data/incidents.js.
Expectata: airbagAny true (narrative asserts deployment; SGO SV/CP columns
cannot record it — AIRBAG_OVERRIDE in slurp.py).
Resultata: ${rec === undefined ? "row missing" : JSON.stringify(rec.airbagAny)}.`);
}

// Location patches (LOCATION_OVERRIDE in slurp.py): NHTSA's row for 30270-7054
// says Phoenix, CA while the narrative says Phoenix, Arizona (kills a phantom
// city); 30270-11302 (Waymo, JUL-2025) arrived with blank city, state and
// address, and its narrative says "operating in Los Angeles, California"
// (2026-10-03, audit finding #52; it rendered as a bare ", ").
for (const [rid, city, state] of [["30270-7054", "Phoenix", "AZ"], ["30270-11302", "Los Angeles", "CA"]]) {
  const rec = byId.get(rid);
  assert.ok(rec !== undefined && rec.state === state && rec.city === city,
    `Replicata: read ${rid}'s location from data/incidents.js.
Expectata: ${city}, ${state} (the narrative's location, applied via LOCATION_OVERRIDE).
Resultata: ${rec === undefined ? "row missing" : JSON.stringify(rec.city + ", " + rec.state)}.`);
}
// JSON round-trip: arrays built in the vm realm fail deepStrictEqual against [].
const blankLocation = JSON.parse(JSON.stringify(incidents.filter(r => !r.city || !r.state).map(r => r.reportId)));
assert.deepEqual(blankLocation, [],
  `Replicata: list data/incidents.js records with an empty city or state.
Expectata: none (slurp.py stops on a blank location until a LOCATION_OVERRIDE entry gives the narrative's place).
Resultata: ${JSON.stringify(blankLocation)}.`);

// Scope patch: 30270-14625 (Waymo, Washington DC, MAR-2026) is coded Driver /
// Operator Type "None", but its narrative says "a test driver was present (in
// the driver's seating position)". DC is a Waymo testing market whose miles
// are not in the rider-only VMT denominator, and Waymo's own hub excludes the
// crash; OPERATOR_TYPE_OVERRIDE in slurp.py applies the narrative's operator
// type, as 30270-8403's v2 filing did for the same situation.
assert.ok(!byId.has("30270-14625"),
  `Replicata: look up 30270-14625 in data/incidents.js.
Expectata: absent (test driver present per the narrative; OPERATOR_TYPE_OVERRIDE in slurp.py).
Resultata: present.`);

console.log("qual pass: narrative-contradiction severity, airbag, location, and operator-scope overrides flow into incidents.js; no record lacks a location");

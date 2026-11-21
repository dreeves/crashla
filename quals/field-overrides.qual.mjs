// Narrative-vs-field override pins (2026-08-22 audit): eight rows whose
// structured severity flatly contradicts the filing's own narrative (injury
// claims, stated hospital transports, and archive-era bare tiers that predate
// the W/-Hospitalization split), and five rows whose narratives assert airbag
// deployment the SGO SV/CP columns structurally cannot record (third-vehicle
// deployments and Waymo's own reporting-trigger sentences). The overrides
// live in data/slurp.py (SEVERITY_OVERRIDE / AIRBAG_OVERRIDE); these pins
// prove they flow into data/incidents.js and guard against a regen silently
// dropping them. A sixth airbag row, 30270-17130, since 2026-11-21. The
// records read are the counted and the pending ones (INCIDENT_DATA and
// PENDING_INCIDENT_DATA; since 2026-11-21: an override applies to a pending
// month's record as to any other, and 30270-17130's is one).
import assert from "node:assert/strict";
import vm from "node:vm";
import { dataScript } from "./load-app.mjs";

const ctx = vm.createContext({});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
const incidents = vm.runInContext("[...INCIDENT_DATA, ...PENDING_INCIDENT_DATA]", ctx);
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
  // Field "No Injuries Reported" (Waymo, OCT-2024, San Francisco: stopped at
  // a red light, crept into from behind); narrative: "the driver of the
  // passenger car was experiencing a medical emergency and was transported
  // from the scene in an ambulance". A transport the narrative states counts,
  // whatever its cause, as the human benchmark counts anyone transported
  // (the human, 2026-11-21, on audit finding A38 of 2026-11-20: counting it
  // applies the page's one rule again, where leaving it out would add a
  // second, about why a person was taken)
  "30270-8940": "Minor W/ Hospitalization",
};
for (const [rid, want] of Object.entries(SEVERITY_PINS)) {
  const rec = byId.get(rid);
  assert.ok(rec !== undefined && rec.severity === want,
    `Replicata: read ${rid} from data/incidents.js.
Expectata: severity "${want}" (narrative-contradiction override in slurp.py).
Resultata: ${rec === undefined ? "row missing" : JSON.stringify(rec.severity)}.`);
}

// 30270-17130 (OCT-2026, Austin; 2026-11-21, audit finding A7 of 2026-11-20):
// "Waymo is reporting this crash under Request No. 1 of Standing General
// Order 2021-01 because a vehicle involved was towed away and because of
// airbag deployment", filed "No Subject Vehicle, No Crash Partner": the
// sentence of 30270-9767. quals/airbag-tripwire.qual.mjs holds the stop that
// now brings such a narrative to a reader.
const AIRBAG_PINS = ["30270-9767", "30270-10174", "30270-10573", "30270-13877", "30270-6542", "30270-17130"];
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
// (2026-10-03, audit finding #52; it rendered as a bare ", "). Five more
// (second audit, 2026-10-04, #46) carried a neighbouring city's name in the
// SGO City field where the narrative and Waymo's hub CSV2 crash address both
// name another: 30270-13811 filed San Francisco, narrative "operating in Daly
// City", hub "John Daly Boulevard near Lake Merced Boulevard", San Mateo
// County; 30270-15662 filed Miami, narrative "North Miami", hub "NE 123rd
// Street at Sans Souci Boulevard", 33181; 30270-10112 filed Phoenix,
// narrative "Chandler", hub "N Dobson Rd and W Flint Street", 85224;
// 30270-10141 filed Phoenix, narrative "Tempe", hub "Parking lot near 1810 E
// Apache Boulevard", 85281; 30270-9763 filed Los Angeles, narrative "West
// Hollywood", hub "Parking lot near 8280 Santa Monica Boulevard", 90046.
// Five more filed Los Angeles whose narratives open "operating in West
// Hollywood, California" (2026-11-21, audit finding A39 of 2026-11-20, which
// read a West Hollywood hub address, zip 90046, for each): 30270-13369
// (DEC-2025), -13556 and -13550 (JAN-2026), -14586 (APR-2026) and -15285
// (MAY-2026).
for (const [rid, city, state] of [["30270-7054", "Phoenix", "AZ"], ["30270-11302", "Los Angeles", "CA"],
  ["30270-13811", "Daly City", "CA"], ["30270-15662", "North Miami", "FL"], ["30270-10112", "Chandler", "AZ"],
  ["30270-10141", "Tempe", "AZ"], ["30270-9763", "West Hollywood", "CA"],
  ["30270-13369", "West Hollywood", "CA"], ["30270-13556", "West Hollywood", "CA"], ["30270-13550", "West Hollywood", "CA"],
  ["30270-14586", "West Hollywood", "CA"], ["30270-15285", "West Hollywood", "CA"]]) {
  const rec = byId.get(rid);
  assert.ok(rec !== undefined && rec.state === state && rec.city === city,
    `Replicata: read ${rid}'s location from data/incidents.js.
Expectata: ${city}, ${state} (the narrative's location, applied via LOCATION_OVERRIDE).
Resultata: ${rec === undefined ? "row missing" : JSON.stringify(rec.city + ", " + rec.state)}.`);
  // The stored city is the one the record's own narrative names (the rule
  // every location entry rests on; checked since 2026-11-21).
  assert.ok(rec.narrative.includes(`operating in ${city}, `),
    `Replicata: read ${rid}'s narrative in data/incidents.js for the place it names.
Expectata: "operating in ${city}, ...", the place its LOCATION_OVERRIDE entry stores.
Resultata: ${JSON.stringify(rec.narrative.slice(0, 200))}.`);
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

console.log("qual pass: narrative-contradiction severity, airbag, location, and operator-scope overrides flow into incidents.js (counted and pending records); each location entry stores the city its narrative names; no record lacks a location");

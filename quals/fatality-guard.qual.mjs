// A new Fatality incident must stop the run so a human looks at it before the
// numbers move on their own. The reason is the fatality METRIC, not any copy:
// it divides each death by vehiclesInvolved (Koopman/Piper fractional-death
// attribution) and data/slurp.py DEFAULTS that field to 2, so a fatality whose
// narrative reveals a pileup silently attributes the wrong share unless a human
// reads the narrative and records a VEHICLES_INVOLVED override. Nothing else in
// the pipeline asks for that read. This guard forces it, and while it is here it
// also pins the two facts a reader would be most misled by if they changed
// quietly: whose fatalities these are, and that none is judged at fault.
//
// Historical note: until 2026-09-15 this qual also guarded a hard-coded
// parenthetical in the "Severity breakdown" section that described each
// fatality's speed. That sentence was removed — it restated, less reliably, what
// the incident browser already shows per row (fault value plus the full
// narrative), and it described the whole dataset while sitting above a windowed
// table, so it read as wrong whenever a fatality fell outside the selected
// range. The speed assertion went with it; speeds were only ever pinned to keep
// that sentence honest.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const fatalities = vm.runInContext(
  `INCIDENT_DATA.filter(r => r.severity === "Fatality")
     .map(r => ({reportId: r.reportId, helmer: r.helmer, city: r.city, date: r.date, speed: r.speed, fault: Number(r.fault.faultfrac), vehiclesInvolved: r.vehiclesInvolved}))`,
  ctx);

const SEEN = JSON.stringify(fatalities);
const FIX = `=> A Fatality incident was added or changed. Read its narrative and count the vehicles involved, then record that count in VEHICLES_INVOLVED in data/slurp.py (it defaults to 2) and add it to EXPECTED_VEHICLES below. Assess its faultfrac under the criterion at the same time.`;

assert.equal(fatalities.length, 3,
  `Replicata: count Fatality incidents in INCIDENT_DATA.\nExpectata: exactly 3.\nResultata: ${fatalities.length} — ${SEEN}.\n${FIX}`);

assert.ok(fatalities.every(f => f.helmer === "Waymo"),
  `Replicata: which helmers the fatalities belong to.\nExpectata: all three Waymo — a first Tesla or Zoox fatality is a headline-level change and must not land silently.\nResultata: ${SEEN}.\n${FIX}`);

assert.ok(fatalities.every(f => f.fault <= 0.05),
  `Replicata: AI fault estimates for the fatalities.\nExpectata: each faultfrac <= 0.05 — no fatality in this dataset is judged avoidable by the AV, and the first one that is deserves a human read before it moves the at-fault metric.\nResultata: ${JSON.stringify(fatalities.map(f => f.fault))} — ${SEEN}.\n${FIX}`);

// Pin each known fatality's divisor to the count its own narrative supports:
//   30270-9724 (JAN-2025 SF): AV + car behind + SUV + a fourth car + "at
//     least two other vehicles" per SFPD ("the other three vehicles") = 6.
//   30270-11713 (SEP-2025 Tempe): AV + motorcycle + hit-and-run car = 3.
//   30270-16196 (AUG-2026 Dallas): AV + the SUV that struck the pedestrian = 2,
//     which is the default — pinned anyway so the divisor is asserted, not
//     merely inherited. The pedestrian is the decedent, not a third vehicle.
// A new fatality already trips the count assertion above, forcing a human to
// assess its vehicle count before it silently divides by the default 2.
const EXPECTED_VEHICLES = { "30270-9724": 6, "30270-11713": 3, "30270-16196": 2 };
for (const f of fatalities) {
  assert.equal(f.vehiclesInvolved, EXPECTED_VEHICLES[f.reportId],
    `Replicata: read vehiclesInvolved for fatality ${f.reportId} and compare to its narrative's vehicle count.\nExpectata: ${EXPECTED_VEHICLES[f.reportId]} (from the narrative; see VEHICLES_INVOLVED in data/slurp.py).\nResultata: ${f.vehiclesInvolved}.\n${FIX}`);
}

console.log(`qual pass: exactly 3 fatalities, all Waymo, none judged at fault, each death divided by its narrative's vehicle count (${SEEN})`);

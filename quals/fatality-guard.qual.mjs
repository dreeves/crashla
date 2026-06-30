// The "Severity breakdown" sanity section prints a hard-coded parenthetical
// (crashla.js): "in one fatality the AV was stationary and in the other the AV
// was turning at 8 mph; in both cases the AI fault estimates are near zero."
// That sentence is true only for the EXACT current fatality set. A code comment
// just above it ("[COPY CURRENT AS OF 2026-06-11]") warns the sentence "must be
// rewritten before it silently becomes wrong" if a new Fatality incident
// appears — but nothing enforced that. This qual does: it fails loudly the
// moment the fatality set changes (a new Waymo fatality, an at-fault one, a
// different speed, a Tesla/Zoox fatality), forcing a human to re-check and
// rewrite that on-page sentence. This is life-and-death microcopy, so the guard
// is worth more than its weight.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const fatalities = vm.runInContext(
  `INCIDENT_DATA.filter(r => r.severity === "Fatality")
     .map(r => ({helmer: r.helmer, city: r.city, date: r.date, speed: r.speed, fault: Number(r.fault.faultfrac)}))`,
  ctx);

const SEEN = JSON.stringify(fatalities);
const FIX = `=> If a Fatality incident was added/changed, the on-page "Severity breakdown" parenthetical ("in one fatality the AV was stationary and in the other ... 8 mph; ... fault estimates are near zero") and the "[COPY CURRENT AS OF ...]" comment above it may now be WRONG. Re-read and rewrite both, then update this qual's expectations.`;

assert.equal(fatalities.length, 2,
  `Replicata: count Fatality incidents in INCIDENT_DATA.\nExpectata: exactly 2.\nResultata: ${fatalities.length} — ${SEEN}.\n${FIX}`);

assert.ok(fatalities.every(f => f.helmer === "Waymo"),
  `Replicata: which helmers the fatalities belong to.\nExpectata: both Waymo.\nResultata: ${SEEN}.\n${FIX}`);

// Join to a primitive string: `fatalities` lives in the vm realm, so an array
// deepEqual against a host-realm literal would fail the cross-realm prototype
// check even with identical contents.
const speedKey = fatalities.map(f => f.speed).sort((a, b) => a - b).join(",");
assert.equal(speedKey, "0,8",
  `Replicata: fatality speeds (parenthetical: one stationary, one at 8 mph).\nExpectata: "0,8".\nResultata: "${speedKey}" — ${SEEN}.\n${FIX}`);

assert.ok(fatalities.every(f => f.fault <= 0.05),
  `Replicata: AI fault estimates for the fatalities (parenthetical: "near zero").\nExpectata: each faultfrac <= 0.05.\nResultata: ${JSON.stringify(fatalities.map(f => f.fault))} — ${SEEN}.\n${FIX}`);

console.log(`qual pass: exactly 2 fatalities, both Waymo, speeds {0, 8} mph, fault near zero — the on-page severity-breakdown parenthetical still holds (${SEEN})`);

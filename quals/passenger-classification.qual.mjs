// Guards the passenger-presence silent-misclassification class. The SGO "Were
// All Passengers Belted?" field (stored as `belted`) has two distinct
// no-passenger encodings — "No Passengers in Vehicle" and "Subject Vehicle - No
// Passenger In Vehicle". The old classifier recognized only the second, so 485
// no-passenger incidents were silently counted as "with passenger". The fields
// are now explicit sets (PAX_NONE / PAX_PRESENT / PAX_UNKNOWN); this qual asserts
// every `belted` value in the data is classified, and pins the regression.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class Stub {
  constructor() { this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this.textContent = ""; this._innerHTML = ""; this.value = "0"; }
  appendChild(c) { return c; }
  replaceChildren() {} append() {} addEventListener() {} setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return new Stub(); }
  querySelectorAll() { return []; }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
}
const ctx = vm.createContext({
  console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date,
  document: { getElementById: () => new Stub(), createElement: () => new Stub(), body: new Stub(), addEventListener() {}, querySelector: () => new Stub() },
  window: { innerWidth: 1024, innerHeight: 768, addEventListener() {}, location: { search: "", href: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const none = new Set(vm.runInContext("[...PAX_NONE]", ctx));
const present = new Set(vm.runInContext("[...PAX_PRESENT]", ctx));
const unknown = new Set(vm.runInContext("[...PAX_UNKNOWN]", ctx));
const dataVals = vm.runInContext("[...new Set(INCIDENT_DATA.map(r => r.belted))]", ctx);

// --- COVERAGE: every belted value in the data is classified ----------------
for (const v of dataVals) {
  assert.ok(
    none.has(v) || present.has(v) || unknown.has(v),
    `Replicata: scan distinct INCIDENT_DATA \`belted\` values against PAX_NONE/PAX_PRESENT/PAX_UNKNOWN.
Expectata: every value is classified (else it silently falls into the "unknown" remainder, or — pre-fix — "with passenger").
Resultata: unclassified belted value ${JSON.stringify(v)}.`);
}

// --- DISJOINT: the three sets must not overlap -----------------------------
for (const v of none) assert.ok(!present.has(v) && !unknown.has(v), `Replicata: PAX_NONE ∩ others.\nExpectata: disjoint.\nResultata: ${JSON.stringify(v)} double-classified.`);
for (const v of present) assert.ok(!unknown.has(v), `Replicata: PAX_PRESENT ∩ PAX_UNKNOWN.\nExpectata: disjoint.\nResultata: ${JSON.stringify(v)} double-classified.`);

// --- REGRESSION: both no-passenger encodings must be no-passenger ----------
assert.ok(none.has("No Passengers in Vehicle"),
  `Replicata: check "No Passengers in Vehicle" classification.
Expectata: in PAX_NONE (it means no passenger — the 485-incident bug).
Resultata: not in PAX_NONE.`);
assert.ok(none.has("Subject Vehicle - No Passenger In Vehicle"),
  `Replicata: check "Subject Vehicle - No Passenger In Vehicle" classification.
Expectata: in PAX_NONE.
Resultata: not in PAX_NONE.`);

console.log(`qual pass: all ${dataVals.length} distinct belted values are classified (PAX_NONE/PAX_PRESENT/PAX_UNKNOWN), disjoint, with both no-passenger encodings counted as no-passenger`);

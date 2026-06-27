// Guards the silent-drop bug class: a severity string present in the data but
// missing from an injury-classification set, so its crashes vanish from a
// metric. The original bug omitted bare "Minor" (55) and "Serious" (3) from
// INJURY_SEVERITIES and "Serious" from SERIOUS_INJURY_SEVERITIES, hiding 58
// real injuries — undetected until a Waymo serious-injury MPI discrepancy
// surfaced it. SEVERITY_INFO is now the single source of truth; this qual
// asserts (a) every data severity is classified, (b) the derived sets nest
// and are rank-consistent, and (c) the specific regressions stay fixed.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Minimal host stub — the pre-init app script is constant + function
// declarations, so we only need the data and crashla scripts to evaluate.
class Stub {
  constructor() { this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this.textContent = ""; this._innerHTML = ""; this.value = "0"; }
  appendChild(c) { return c; }
  replaceChildren() {}
  append() {}
  addEventListener() {}
  setAttribute() {}
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

const get = expr => vm.runInContext(expr, ctx);
const info = get("SEVERITY_INFO");
const ranks = get("SEVERITY_RANK");
const injury = new Set(get("[...INJURY_SEVERITIES]"));
const hosp = new Set(get("[...HOSPITALIZATION_SEVERITIES]"));
const ssi = new Set(get("[...SERIOUS_INJURY_SEVERITIES]"));
const dataSeverities = get("[...new Set(INCIDENT_DATA.map(r => r.severity))]");

// --- (a) COVERAGE: every severity in the data is classified ---------------
// This is the core guard: an unclassified value silently counts as no-injury
// in every metric. The runtime per-incident assert enforces this in the app;
// the qual enforces it against the checked-in data.
for (const sev of dataSeverities) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(info, sev),
    `Replicata: scan distinct INCIDENT_DATA severities against SEVERITY_INFO.
Expectata: every severity string has a SEVERITY_INFO row (else it is silently dropped from injury/hospitalization/serious-injury counts).
Resultata: unclassified severity ${JSON.stringify(sev)}.`);
}

// --- SEVERITY_RANK covers every classified severity (no "?? -1" fallback) --
for (const sev of Object.keys(info)) {
  assert.ok(
    typeof ranks[sev] === "number",
    `Replicata: read SEVERITY_RANK[${JSON.stringify(sev)}].
Expectata: every SEVERITY_INFO key has a numeric rank.
Resultata: ${ranks[sev]}.`);
}

// --- (b) NESTING: fatal ⊆ ssi ⊆ hosp ⊆ injury -----------------------------
// Each more-severe set must be a subset of the less-severe one, or the
// injury≥hospitalization≥serious≥fatal MPI subset chain (subset-chain.qual)
// breaks. "Serious" landing in ssi but not hosp/injury would fail here.
const fatal = new Set(Object.keys(info).filter(s => info[s].fatal));
const chain = [["fatal", fatal, "ssi", ssi], ["ssi", ssi, "hosp", hosp], ["hosp", hosp, "injury", injury]];
for (const [subName, sub, supName, sup] of chain) {
  for (const sev of sub) {
    assert.ok(
      sup.has(sev),
      `Replicata: check ${subName} ⊆ ${supName}.
Expectata: every ${subName} severity is also ${supName}.
Resultata: ${JSON.stringify(sev)} is ${subName} but not ${supName}.`);
  }
}

// --- (c) RANK-MONOTONICITY: injury ⟺ rank≥1, ssi ⟺ rank≥5 -----------------
// The original bug was exactly a monotonicity break: "Serious" (rank 5) was
// not in ssi even though "Moderate W/ Hospitalization" (rank 4) was. Tying
// the injury/ssi flags to rank thresholds makes that impossible to reintroduce.
for (const [sev, rec] of Object.entries(info)) {
  assert.strictEqual(
    !!rec.injury, rec.rank >= 1,
    `Replicata: SEVERITY_INFO[${JSON.stringify(sev)}] = ${JSON.stringify(rec)}.
Expectata: injury flag ⟺ rank ≥ 1 (anything ranked an injury severity must count as an injury).
Resultata: injury=${!!rec.injury}, rank=${rec.rank}.`);
  assert.strictEqual(
    !!rec.ssi, rec.rank >= 5,
    `Replicata: SEVERITY_INFO[${JSON.stringify(sev)}] = ${JSON.stringify(rec)}.
Expectata: ssi (KABCO A+K) flag ⟺ rank ≥ 5 ("Serious"/"Fatality").
Resultata: ssi=${!!rec.ssi}, rank=${rec.rank}.`);
}

// --- (d) REGRESSIONS: the specific values that were mishandled -------------
const expect = (cond, msg) => assert.ok(cond, `Replicata: regression check.\nExpectata: ${msg}.\nResultata: failed.`);
expect(injury.has("Minor"), 'bare "Minor" (older NHTSA encoding) counts as an injury');
expect(injury.has("Serious"), '"Serious" counts as an injury');
expect(ssi.has("Serious"), '"Serious" counts as a serious injury (SSI+)');
expect(!ssi.has("Moderate W/ Hospitalization"), '"Moderate W/ Hospitalization" is NOT SSI+ (it is KABCO B/C, not A)');
expect(injury.has("Moderate") && !hosp.has("Moderate") && !ssi.has("Moderate"), 'bare "Moderate" is injury-only');
expect(Object.prototype.hasOwnProperty.call(ranks, "Unknown") && !injury.has("Unknown"), '"Unknown" is ranked but not counted as an injury');

console.log("qual pass: every data severity is classified; injury/hospitalization/serious-injury sets nest, are rank-consistent, and the Minor/Serious silent-drop regressions stay fixed");

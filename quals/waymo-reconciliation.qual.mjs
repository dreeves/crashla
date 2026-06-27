// Sanity backstop: our full-history Waymo incident rates vs Waymo's OWN
// published rates (WAYMO_PUBLISHED_IPMM). Different scopes (we use all-roads SGO
// self-reported severity; Waymo publishes surface-street, location-weighted), so
// the bounds are deliberately loose — this catches gross miscounts, not subtle
// methodology gaps. The injury bound is tighter because all-injury rates should
// track closely: it would have caught the 2026-06 silent-drop bug, where our
// Waymo injury rate sagged to ~0.40 vs Waymo's 0.71 (ratio 0.56, below 0.6).
// Airbag ("any vehicle") is comparable since the archive SV|CP fix
// (_normalize_archive_row). The precise guard against the silent-drop class is
// severity-classification.qual.
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
vm.runInContext("incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

const pub = vm.runInContext("WAYMO_PUBLISHED_IPMM", ctx);
const stats = vm.runInContext(`(() => {
  const way = INCIDENT_DATA.filter(r => r.helmer === "Waymo");
  const vmtM = vmtRows.filter(r => r.helmer === "Waymo").reduce((s, r) => s + r.vmtBest, 0) / 1e6;
  return {
    vmtM,
    injury: way.filter(r => INJURY_SEVERITIES.has(r.severity)).length / vmtM,
    airbag: way.filter(r => r.airbagAny).length / vmtM,
    ssi: way.filter(r => SERIOUS_INJURY_SEVERITIES.has(r.severity)).length / vmtM,
  };
})()`, ctx);

assert.ok(stats.vmtM > 100,
  `Replicata: sum full-history Waymo VMT.\nExpectata: > 100M mi.\nResultata: ${stats.vmtM.toFixed(1)}M.`);

// [metric, published key, lo ratio, hi ratio]
const checks = [
  ["injury", "injury", 0.6, 1.6],
  ["airbag", "airbag", 0.5, 1.8],  // any-vehicle; some scope slack (all-severity SGO vs Waymo's)
  ["ssi", "ssi", 0.3, 4.5],
];
for (const [metric, key, lo, hi] of checks) {
  const ratio = stats[metric] / pub[key];
  assert.ok(
    ratio >= lo && ratio <= hi,
    `Replicata: our full-history Waymo ${metric} rate = ${stats[metric].toFixed(3)} IPMM vs Waymo published ${pub[key]}.
Expectata: ratio in [${lo}, ${hi}] (loose cross-check; a breach means a real divergence — fix the counting or, if the methodology gap genuinely widened, widen the bound).
Resultata: ratio ${ratio.toFixed(2)}x.`);
}

console.log(`qual pass: full-history Waymo rates within bounds of Waymo's published figures (injury ${(stats.injury / pub.injury).toFixed(2)}x, airbag ${(stats.airbag / pub.airbag).toFixed(2)}x, serious+ ${(stats.ssi / pub.ssi).toFixed(2)}x)`);

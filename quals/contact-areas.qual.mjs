import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, {
    tagName: "div", id, children: [], className: "", dataset: {},
    textContent: "", _innerHTML: "",
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...n) { this.children = [...n]; },
    addEventListener() {},
    set innerHTML(v) { this._innerHTML = v; this.children = []; },
    get innerHTML() { return this._innerHTML; },
  });
  return nodeById.get(id);
};

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement: tag => ({
      tagName: tag, children: [], className: "", dataset: {},
      textContent: "", _innerHTML: "",
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren(...n) { this.children = [...n]; },
      addEventListener() {},
      set innerHTML(v) { this._innerHTML = v; this.children = []; },
      get innerHTML() { return this._innerHTML; },
      classList: { toggle() {} },
      querySelector() { return { addEventListener() {}, classList: { toggle() {} } }; },
      getAttribute() { return null; },
    }),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Verify inline incident data includes svHit and cpHit string fields
const hitFieldCheck = vm.runInContext(`
  INCIDENT_DATA.every(inc =>
    typeof inc.svHit === "string" && typeof inc.cpHit === "string")
`, ctx);
assert.ok(
  hitFieldCheck,
  `Replicata: check svHit/cpHit field types in all incident records.
Expectata: every incident has string svHit and cpHit fields.
Resultata: some incidents are missing or have non-string svHit/cpHit.`,
);

// Verify at least some incidents have non-empty svHit
const nonEmptySvHit = vm.runInContext(`
  INCIDENT_DATA.filter(inc => inc.svHit.length > 0).length
`, ctx);
assert.ok(
  nonEmptySvHit > 400,
  `Replicata: count incidents with non-empty svHit.
Expectata: most incidents (>400) have contact area data.
Resultata: only ${nonEmptySvHit} had non-empty svHit.`,
);

// Verify faultTooltip includes contact areas when present
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
`, ctx);

const tipWithAreas = vm.runInContext(`
  const inc = INCIDENT_DATA.find(i => i.svHit && i.cpHit);
  faultTooltip(inc);
`, ctx);
assert.ok(
  tipWithAreas.includes("\u{1F4A5}"),
  `Replicata: render fault tooltip for incident with both svHit and cpHit.
Expectata: tooltip includes collision emoji separating SV and CP contact areas.
Resultata: tooltip was ${JSON.stringify(tipWithAreas.slice(-80))}.`,
);

// Verify tooltip still works for incidents with empty cpHit (fixed-object crashes)
const tipFixedObj = vm.runInContext(`
  const incFO = INCIDENT_DATA.find(i => i.svHit && !i.cpHit);
  incFO ? faultTooltip(incFO) : null;
`, ctx);
if (tipFixedObj !== null) {
  assert.ok(
    tipFixedObj.includes("\u{1F4A5}") && tipFixedObj.includes("n/a"),
    `Replicata: render fault tooltip for fixed-object crash (empty cpHit).
Expectata: tooltip shows "svHit 💥 n/a" for missing crash partner area.
Resultata: tooltip was ${JSON.stringify(tipFixedObj.slice(-80))}.`,
  );
}

// Verify vmtTooltip helper produces expected format
const vmtTip = vm.runInContext(`
  vmtTooltip("TestCo", "2025-07", {
    vmtRawBest: 12345, vmtRawMin: 10000, vmtRawMax: 15000,
    vmtBest: 11000, vmtCume: 50000,
  }, {total: 3});
`, ctx);
assert.ok(
  vmtTip.includes("TestCo 2025-07 (VMT)") &&
    vmtTip.includes("Monthly VMT (central estimate):") &&
    vmtTip.includes("Monthly VMT range:") &&
    vmtTip.includes("Coverage-adjusted VMT for MPI:") &&
    vmtTip.includes("Cumulative VMT:") &&
    vmtTip.includes("Total incidents:"),
  `Replicata: call vmtTooltip with sample data.
Expectata: tooltip includes all expected labels (monthly, range, effective, cumulative, incidents).
Resultata: tooltip was ${JSON.stringify(vmtTip)}.`,
);

console.log("qual pass: contact areas in fault tooltip and vmtTooltip helper");

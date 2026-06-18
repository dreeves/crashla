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
  ({ dot: vmtTooltip("2026-05", 1234567, 1),
     dot2: vmtTooltip("2026-05", 1234567, 2),
     cap: vmtTooltip("2026-05", 1000000) })
`, ctx);
assert.equal(vmtTip.dot, "2026-05\n1,234,567 miles\n1 incident",
  `Replicata: call vmtTooltip for a dot (value + incident count).
Expectata: "<month>\\n<miles> miles\\n1 incident" (splur singular).
Resultata: ${JSON.stringify(vmtTip.dot)}.`,
);
assert.equal(vmtTip.cap, "2026-05\n1,000,000 miles",
  `Replicata: call vmtTooltip for an error-bar end (no count).
Expectata: just "<month>\\n<miles> miles", no incident line.
Resultata: ${JSON.stringify(vmtTip.cap)}.`,
);
assert.ok(vmtTip.dot2.endsWith("2 incidents"),
  `Replicata: call vmtTooltip with 2 incidents.
Expectata: splur pluralizes to "2 incidents".
Resultata: ${JSON.stringify(vmtTip.dot2)}.`,
);

console.log("qual pass: contact areas in fault tooltip and vmtTooltip helper");

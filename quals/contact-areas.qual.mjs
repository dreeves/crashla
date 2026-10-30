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

// The fault tooltip's last line names the incident's contact areas, its own
// (svHit) first and its crash partner's (cpHit) last, a separator between
// them; a missing partner area shows a placeholder, not nothing. Until
// 2026-10-29 this checked the separator's glyph (a collision emoji) and the
// placeholder's word ("n/a"), the human's to change; now it checks the areas
// from the data and their order.
const areaTips = vm.runInContext(`
  (() => {
    const inc = INCIDENT_DATA.find(i => i.svHit && i.cpHit);
    const incFO = INCIDENT_DATA.find(i => i.svHit && !i.cpHit);
    return {
      both: { svHit: inc.svHit, cpHit: inc.cpHit, tip: faultTooltip(inc) },
      fixedObject: incFO ? { svHit: incFO.svHit, tip: faultTooltip(incFO) } : null,
    };
  })()
`, ctx);
{
  const { svHit, cpHit, tip } = areaTips.both;
  const line = tip.split("\n").pop();
  const between = line.startsWith(svHit + " ") && line.endsWith(" " + cpHit)
    ? line.slice(svHit.length, line.length - cpHit.length).trim() : "";
  assert.ok(
    between !== "",
    `Replicata: render fault tooltip for incident with both svHit and cpHit (${JSON.stringify(svHit)}, ${JSON.stringify(cpHit)}).
Expectata: its last line names the SV contact area, then a separator, then the CP contact area.
Resultata: tooltip was ${JSON.stringify(tip.slice(-80))}.`,
  );
}

// Verify tooltip still works for incidents with empty cpHit (fixed-object crashes)
if (areaTips.fixedObject !== null) {
  const { svHit, tip } = areaTips.fixedObject;
  const line = tip.split("\n").pop();
  const rest = line.startsWith(svHit + " ") ? line.slice(svHit.length).trim().split(/\s+/) : [];
  assert.ok(
    rest.length >= 2 && rest.every(t => t !== ""),
    `Replicata: render fault tooltip for fixed-object crash (empty cpHit; SV area ${JSON.stringify(svHit)}).
Expectata: its last line names the SV contact area, then the separator and a placeholder for the missing crash partner area.
Resultata: tooltip was ${JSON.stringify(tip.slice(-80))}.`,
  );
}

// Verify the VMT tooltip helpers produce the expected format. Since
// 2026-10-03 a dot's tooltip also gives its range (audit #28: an end hidden
// under its dot was unreadable) and an error-bar end says which end it is
// (audit #59); the two were one helper, vmtTooltip, until then. The tooltips'
// words around the figures are the human's to change, so this checks the
// figures line by line (until 2026-10-29 it pinned the whole text, "miles",
// "Range:" and "incident(s)" with it): a dot's tooltip is its month, its
// miles, its range (low then high) and its incident count; an end's, its
// month, its miles and its end's label (VMT_RANGE_EDGE).
const vmtTip = vm.runInContext(`
  ({ dot: vmtDotTooltip("2026-05", 1234567, 1000000, 1500000, 1),
     dot2: vmtDotTooltip("2026-05", 1234567, 1000000, 1500000, 2),
     cap: vmtEndTooltip("2026-05", 1000000, VMT_RANGE_EDGE.lo),
     edge: VMT_RANGE_EDGE })
`, ctx);
const figures = line => line.match(/\d[\d,]*(?:\.\d+)?/g) || [];
const lineFigures = tip => tip.split("\n").map(figures);
assert.deepEqual(
  [vmtTip.dot.split("\n")[0], ...lineFigures(vmtTip.dot).slice(1)],
  ["2026-05", ["1,234,567"], ["1,000,000", "1,500,000"], ["1"]],
  `Replicata: call vmtDotTooltip for a dot (value, range, incident count).
Expectata: four lines: the month, then the figures "1,234,567" (miles), "1,000,000" and "1,500,000" (the range, low then high) and "1" (the count).
Resultata: ${JSON.stringify(vmtTip.dot)}.`,
);
assert.ok(
  vmtTip.cap.split("\n").length === 3 && vmtTip.cap.split("\n")[0] === "2026-05" &&
    JSON.stringify(figures(vmtTip.cap.split("\n")[1])) === JSON.stringify(["1,000,000"]) &&
    vmtTip.cap.split("\n")[2] === vmtTip.edge.lo,
  `Replicata: call vmtEndTooltip for an error-bar's low end (no count).
Expectata: three lines: the month, the figure "1,000,000" (miles) and the low end's label (VMT_RANGE_EDGE.lo); no incident line.
Resultata: ${JSON.stringify(vmtTip.cap)}.`,
);
// (Until 2026-10-29 this also checked that the count's word is plural,
// "2 incidents"; formatting.qual checks splur.)
assert.deepEqual(
  lineFigures(vmtTip.dot2).at(-1),
  ["2"],
  `Replicata: call vmtDotTooltip with 2 incidents.
Expectata: the count line gives the count, "2".
Resultata: ${JSON.stringify(vmtTip.dot2)}.`,
);

console.log("qual pass: contact areas in fault tooltip and the VMT tooltip helpers");

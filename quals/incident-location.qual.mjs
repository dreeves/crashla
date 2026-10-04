// The incident browser's Location cell (2026-10-03, audit finding #52). A
// filing with no city or state rendered as a bare ", " and sorted first,
// while the Geography table listed the same record as "Unknown". slurp.py now
// stops on a blank location until a LOCATION_OVERRIDE entry supplies the
// narrative's place (30270-11302 was the one such record), so this qual feeds
// the browser a synthetic blank-location incident: its Location cell and its
// Location sort key must read "Unknown", as the Geography table does, and no
// row may show a bare comma.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName; this.id = id; this.children = []; this.parentNode = null;
    this.className = ""; this.dataset = {}; this._textContent = ""; this.listeners = {};
    this._innerHTML = ""; this._attributes = {}; this.style = {}; this.value = "0";
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  // Mirror the browser: setting textContent escapes into innerHTML (escHtml in
  // crashla.js round-trips through it; a non-escaping stub returns "").
  set textContent(v) {
    this._textContent = String(v);
    this._innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  get textContent() { return this._textContent; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { for (const n of nodes) n.parentNode = this; this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(name, value) { this._attributes[name] = value; }
  getAttribute(name) { return this._attributes[name] ?? null; }
  querySelector() { return { addEventListener() {}, classList: { toggle() {} } }; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};
const ctx = vm.createContext({
  console, Math, Number, URLSearchParams,
  document: { getElementById: getNode, createElement: tag => new ElementStub(tag), body: new ElementStub("body"), addEventListener() {} },
  window: { innerWidth: 1024, innerHeight: 768, location: { search: "", pathname: "/crashla", hash: "" }, history: { replaceState() {} } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const MARK = "SYNTHETIC-BLANK-LOCATION";
const out = JSON.parse(vm.runInContext(`
(() => {
  const template = INCIDENT_DATA.find(r => r.helmer === "Waymo" && r.date === "JUL-2025");
  const blank = {...template, reportId: "synthetic-blank-location", incidentId: "synthetic-blank-location",
    city: "", state: "", narrative: "${MARK}"};
  incidents = [...INCIDENT_DATA, blank];
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(incidents);
  buildMonthlyViews();
  sortCol = "location"; sortAsc = true;
  renderTable();
  const cells = html => [...html.matchAll(/<td[^>]*>([\\s\\S]*?)<\\/td>/g)].map(m => m[1].trim());
  const rows = document.getElementById("incidents-body").children.map(tr => cells(tr.innerHTML));
  const locKey = SORT_COLUMNS.find(c => c.key === "location").val;
  return JSON.stringify({
    blankCell: rows.find(c => c.at(-1).includes("${MARK}"))?.[2],
    bareCommaRows: rows.filter(c => /^\\s*,|,\\s*$/.test(c[2])).length,
    firstSorted: rows[0]?.[2],
    sortKey: locKey(blank),
    geographyLabel: typeof incidentLocation === "function" ? incidentLocation(blank) : "(no shared incidentLocation helper)",
  });
})()`, ctx));

assert.deepEqual(out, { blankCell: "Unknown", bareCommaRows: 0, firstSorted: out.firstSorted, sortKey: "Unknown", geographyLabel: "Unknown" },
  `Replicata: add a Waymo JUL-2025 incident with empty city and state, sort the incident browser by Location ascending, and read its Location cell.
Expectata: the cell and the Location sort key read "Unknown" (the Geography table's label for a location-less filing), and no row shows a bare comma.
Resultata: ${JSON.stringify(out)}.`);
assert.notEqual(out.firstSorted, "Unknown",
  `Replicata: sort the incident browser by Location ascending with one location-less incident.
Expectata: it sorts as "Unknown", among the U's, not first.
Resultata: first row's Location is ${JSON.stringify(out.firstSorted)}.`);

console.log(`qual pass: a location-less incident reads "Unknown" in the browser cell, its sort key and the Geography table`);

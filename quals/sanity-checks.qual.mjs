import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this._textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this._attributes = {};
  }

  // escHtml sets textContent then reads innerHTML, so we need textContent
  // to flow through to innerHTML with basic HTML escaping
  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const node of nodes) node.parentNode = this;
    this.children = [...nodes];
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] || []), fn];
  }

  setAttribute(name, value) {
    this._attributes[name] = value;
  }

  getAttribute(name) {
    return this._attributes[name] ?? null;
  }

  querySelector() { return null; }

  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
    body: new ElementStub("body"),
    addEventListener() {},
  },
  window: { innerWidth: 1024, innerHeight: 768 },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Initialize state the same way the init block does (minus tooltip init)
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();
  activeSeries = fullMonthSeries;
  buildSanityChecks();
`, ctx);

const html = getNode("sanity-checks").innerHTML;

// --- All expected subsection headings are present ---
const expectedHeadings = [
  "Passenger presence",
  // "Narrative redaction" removed from expected headings 2026-06-11:
  // table commented out in the app (0% CBI everywhere); see cbi-watch qual.
  "Severity breakdown",
  "VMT uncertainty",
  "Poisson dispersion",
  "Reporting threshold disparities",
  "Geography",
  "VMT sources",
  "Incident coverage for partial months",
  "Waymo cross-check",
  "human benchmark derivations",
  "Sensitivity analysis",
];

for (const heading of expectedHeadings) {
  assert.ok(
    html.includes(heading),
    `Replicata: render sanity checks section.
Expectata: section includes "${heading}" subsection.
Resultata: heading not found in sanity checks HTML.`);
}

// --- Passenger presence has expected columns ---
assert.ok(
  html.includes("With passenger") && html.includes("No passenger"),
  `Replicata: check passenger presence table structure.
Expectata: table has "With passenger" and "No passenger" columns.
Resultata: columns not found.`);

// Commented out 2026-06-11 with the app's redaction table (and its stale
// Expectata: Tesla is no longer 100% redacted; everyone is at 0%).
/*
// --- Narrative redaction: Tesla should show 100% redacted ---
assert.ok(
  html.includes("Redacted (CBI)") && html.includes("100%"),
  `Replicata: check narrative redaction content.
Expectata: Tesla redacts all narratives, so table includes "100%".
Resultata: expected content not found.`);
*/

// --- Severity breakdown has all categories ---
assert.ok(
  html.includes("Property damage only") &&
    html.includes("Injury (no hosp.)") &&
    html.includes("Hospitalization") &&
    html.includes("Fatality"),
  `Replicata: check severity breakdown categories.
Expectata: all four severity categories present.
Resultata: some categories missing.`);

// --- VMT uncertainty has range ratio ---
assert.ok(
  html.includes("VMT low") &&
    html.includes("VMT high") &&
    html.includes("Range ratio"),
  `Replicata: check VMT uncertainty table structure.
Expectata: table has low/high VMT and range ratio columns.
Resultata: expected columns not found.`);

// --- Poisson dispersion: small-sample helmers get "too few" ---
const dispBlock = (html.match(/<h3>Poisson dispersion<\/h3>[\s\S]*?<\/table>/) || [""])[0];
const teslaDispRow = dispBlock.split("</tr>").find(s => s.includes("<td>Tesla</td>")) || "";
assert.ok(
  teslaDispRow.includes("too few incidents to tell"),
  `Replicata: check Poisson dispersion verdict for Tesla.
Expectata: Tesla (small-sample helmer) shows "too few incidents to tell".
Resultata: Tesla dispersion row was ${JSON.stringify(teslaDispRow)}.`);

// --- Reporting threshold: speed=0 data present ---
assert.ok(
  html.includes("Speed = 0 mph") && html.includes("AV stopped"),
  `Replicata: check reporting threshold table structure.
Expectata: table has speed=0 and AV stopped columns.
Resultata: expected columns not found.`);

// --- Geography: Waymo spans multiple cities ---
assert.ok(
  html.includes("San Francisco, CA") &&
    html.includes("Los Angeles, CA") &&
    html.includes("Phoenix, AZ") &&
    html.includes("Austin, TX"),
  `Replicata: check geographic spread.
Expectata: geography section includes SF, LA, Phoenix, Austin.
Resultata: some expected cities missing.`);

// --- VMT sources: rationale text is present ---
assert.ok(
  html.includes("Source and methodology") &&
    html.includes("robotaxitracker"),
  `Replicata: check VMT sources content.
Expectata: VMT sources table includes methodology descriptions.
Resultata: expected content not found.`);

// --- Incident coverage section ---
assert.ok(
  html.includes("Incident coverage") &&
    html.includes("Calendar coverage"),
  `Replicata: check incident coverage content.
Expectata: Incident coverage section with calendar coverage explanation appears.
Resultata: expected content not found.`);

// --- Human benchmarks: derivation table ---
assert.ok(
  html.includes("Derivation") &&
    html.includes("Low MPI") &&
    html.includes("High MPI"),
  `Replicata: check human benchmark derivations table.
Expectata: table has Low MPI, High MPI, and Derivation columns.
Resultata: expected columns not found.`);

// --- All three helmers appear across tables ---
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  const count = (html.match(new RegExp(`>${helmer}<`, "g")) || []).length;
  assert.ok(
    count >= 8,
    `Replicata: check ${helmer} presence across sanity check tables.
Expectata: ${helmer} appears in at least 8 table cells (one per section with helmer rows).
Resultata: ${helmer} appeared ${count} times.`);
}

// --- Verify subsection count ---
const h3Count = (html.match(/<h3>/g) || []).length;
// 10 since 2026-06-11: the Narrative redaction table is commented out
// (0% CBI everywhere; see quals/cbi-watch.qual.mjs).
assert.ok(
  h3Count >= 10,
  `Replicata: count sanity check subsections.
Expectata: at least 10 subsections (h3 headings).
Resultata: found ${h3Count} h3 tags.`);

console.log("qual pass: sanity checks section renders all subsections with expected content");

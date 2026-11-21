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
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const label = helmer => vm.runInContext(`helmerLabel(${JSON.stringify(helmer)})`, ctx);

// --- Every subsection renders its table ---
// Each sanity section's table has an id (sanity-*, since 2026-10-29). Until
// then this qual found the sections by their headings' words and checked
// their tables by their column headers' words, which are the human's to
// change; now each table must render, with at least one row, and a header
// column for each cell of a full row (one without a colspan cell giving a
// reason). What the cells hold is checked against the data by
// sanity-values, sanity-windows, waymo-reconciliation and stress-test.
const SECTION_TABLES = [
  "sanity-passengers",
  // The Narrative redaction table was commented out 2026-06-11 (0% CBI
  // everywhere; see cbi-watch qual); re-enabled, its table takes the id
  // sanity-cbi and joins this list.
  "sanity-severity",
  "sanity-vmt-uncertainty",
  "sanity-dispersion",
  "sanity-threshold",
  "sanity-geography",
  "sanity-vmt-sources",
  "sanity-coverage",
  "sanity-waymo-check",
  "sanity-benchmarks",
  "sanity-stress",
  "sanity-fault-flip",
];
const tableOf = id => (new RegExp(`<table[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(html) || [])[1] ?? null;
const rowsOf = table => [...((/<tbody>([\s\S]*?)<\/tbody>/.exec(table) || [])[1] || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]);

for (const id of SECTION_TABLES) {
  const table = tableOf(id);
  const headers = table === null ? 0 : [...table.matchAll(/<th[\s>]/g)].length;
  const rows = table === null ? [] : rowsOf(table);
  const full = rows.filter(r => !/colspan=/.test(r)).map(r => [...r.matchAll(/<td[\s>]/g)].length);
  assert.ok(
    table !== null && rows.length >= 1 && full.length >= 1 && full.every(n => n === headers),
    `Replicata: render the sanity checks section (full history) and find the table with id "${id}".
Expectata: it renders once, with at least one full row, and its header has one column per cell of each full row.
Resultata: ${table === null ? "no such table" : `${headers} header columns; ${rows.length} rows, full ones of ${JSON.stringify(full)} cells`}.`);
}

// Commented out 2026-06-11 with the app's redaction table (and its stale
// Expectata: Tesla is no longer 100% redacted; everyone is at 0%).
/*
// --- Narrative redaction: Tesla should show 100% redacted ---
assert.ok(
  (tableOf("sanity-cbi") || "").includes("<td>100%</td>"),
  `Replicata: check narrative redaction content.
Expectata: Tesla redacts all narratives, so table includes "100%".
Resultata: expected content not found.`);
*/

// --- Poisson dispersion: a row per plotted line, assessed in the app's words ---
// Until 2026-11-21 this pinned Tesla's assessment ("mildly overdispersed", at
// an index its message gave as ~4.4 and that had become 4.58): a figure
// copied from the page's own output, which a correct release would have
// turned red (a release publishing Tesla's eight preprints puts the index
// near 6: audit A18 of 2026-11-20; the no-outcome-pins rule of 2026-11-17).
// What a row's assessment must be, given its months, is held where the
// months are recounted: quals/sanity-windows.qual.mjs applies the chi-squared
// test to every drawn row of its windows, and holds the app's rule to it on
// every slider window and at each threshold. Here, the structure only: a row
// for every plotted line, in order, each either one cell giving a reason (a
// line with too few months) or five cells ending in one of the app's
// assessments, DISPERSION_VERDICT (until 2026-10-29 this qual spelled them
// out).
{
  const verdicts = Object.values(JSON.parse(vm.runInContext("JSON.stringify(DISPERSION_VERDICT)", ctx)));
  const want = JSON.parse(vm.runInContext("JSON.stringify(ADS_SERIES.map(h => helmerLabel(h)))", ctx)).map(escHtml);
  const rows = rowsOf(tableOf("sanity-dispersion") || "").map(r => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]));
  const wrong = rows.filter((cells, i) => cells[0] !== want[i] ||
    !(cells.length === 2 ? cells[1].trim() !== "" : cells.length === 5 && verdicts.includes(cells[4])));
  assert.ok(
    rows.length === want.length && wrong.length === 0 && rows.some(cells => cells.length === 5),
    `Replicata: read the Poisson dispersion table's rows (full history).
Expectata: one row per plotted line (${JSON.stringify(want)}), in that order, each either two cells (the line and a reason) or five ending in one of DISPERSION_VERDICT's assessments ${JSON.stringify(verdicts)}; at least one of the second kind.
Resultata: ${rows.length} rows; not so: ${JSON.stringify(wrong.map(cells => cells.map(c => c.slice(0, 40))))}.`);
}

// --- Geography: Waymo spans multiple cities ---
// (The cities are the incidents' locations, from the data.)
const geoTable = tableOf("sanity-geography") || "";
assert.ok(
  geoTable.includes("San Francisco, CA") &&
    geoTable.includes("Los Angeles, CA") &&
    geoTable.includes("Phoenix, AZ") &&
    geoTable.includes("Austin, TX"),
  `Replicata: check geographic spread.
Expectata: geography table includes SF, LA, Phoenix, Austin.
Resultata: some expected cities missing.`);

// --- VMT sources: each line's rationale text is present ---
// One row per ADS line, its source-and-methodology cell (styled as AI text)
// not empty. Until 2026-10-29 this checked the column header's words and one
// word of a rationale; sanity-windows checks each cell against the VMT rows.
{
  const want = JSON.parse(vm.runInContext("JSON.stringify(ADS_SERIES.map(h => helmerLabel(h)))", ctx)).map(escHtml);
  const got = rowsOf(tableOf("sanity-vmt-sources") || "").map(r => /^\s*<td>([^<]*)<\/td>\s*<td class="ai-text">([\s\S]*?)<\/td>\s*$/.exec(r))
    .map(m => m === null ? null : { name: m[1], cell: m[2] });
  assert.ok(
    got.length === want.length && got.every((r, i) => r !== null && r.name === want[i] && r.cell.trim() !== ""),
    `Replicata: check VMT sources content.
Expectata: one row per ADS line (${JSON.stringify(want)}), each with a non-empty ai-text methodology cell.
Resultata: ${JSON.stringify(got.map(r => r && { name: r.name, cell: r.cell.slice(0, 40) }))}.`);
}

// --- All three helmers appear across tables ---
// (Each helmer's label, read from the app.)
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  const count = (html.match(new RegExp(`>${escHtml(label(helmer)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`, "g")) || []).length;
  assert.ok(
    count >= 8,
    `Replicata: check ${helmer} presence across sanity check tables.
Expectata: ${helmer} appears in at least 8 table cells (one per section with helmer rows).
Resultata: ${helmer} appeared ${count} times.`);
}

// --- Verify subsection count ---
const h3Count = (html.match(/<h3[\s>]/g) || []).length;
// 10 since 2026-06-11: the Narrative redaction table is commented out
// (0% CBI everywhere; see quals/cbi-watch.qual.mjs).
assert.ok(
  h3Count >= 10,
  `Replicata: count sanity check subsections.
Expectata: at least 10 subsections (h3 headings).
Resultata: found ${h3Count} h3 tags.`);

console.log("qual pass: sanity checks section renders all subsections with expected content");

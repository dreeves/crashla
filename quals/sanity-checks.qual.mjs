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

// --- Poisson dispersion: Tesla verdict tracks its sample size ---
// Tesla crossed the 20-incident threshold in the Jul-2026 NHTSA drop (24
// incidents after Houston inclusion), so the small-sample "too few incidents
// to tell" branch no longer fires for any live helmer. Tesla's monthly rates
// swing wildly (its launch month Jul 2025 at 232/M mi vs ~3-40 later), so the
// test reads overdispersed. Re-pin if the data moves a verdict tier. History:
// X²/dof ≈ 12.3 when this was written, 5.63 ("overdispersed") until
// 2026-10-31, when July 2025's miles were re-read from Tesla's decks and its
// Jul 23 call (audit 2026-10-30, VMT-1: 6,317 -> 8,619, July's rate 316.6 ->
// 232.0 per M mi), 4.43 ("mildly overdispersed") since. The assessment's
// words are the app's, DISPERSION_VERDICT (until 2026-10-29 this qual
// spelled them out).
const DV = JSON.parse(vm.runInContext("JSON.stringify(DISPERSION_VERDICT)", ctx));
const teslaDispRow = rowsOf(tableOf("sanity-dispersion") || "").find(r => r.includes(`<td>${escHtml(label("Tesla"))}</td>`)) || "";
assert.ok(
  teslaDispRow.includes(`<td>${DV.mild}</td>`),
  `Replicata: check Poisson dispersion verdict for Tesla.
Expectata: Tesla (dispersion index ~4.4 in the default window) shows the mildly overdispersed assessment, DISPERSION_VERDICT.mild (${JSON.stringify(DV.mild)}).
Resultata: Tesla dispersion row was ${JSON.stringify(teslaDispRow)}.`);

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

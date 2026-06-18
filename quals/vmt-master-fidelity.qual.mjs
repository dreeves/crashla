import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Master-to-app fidelity: every row of data/vmt.csv (the editable VMT master)
// must flow through data/slurp.py into data/vmt.js and from there into the
// rendered per-helmer charts unchanged — same central VMT, same min/max
// range, same cumulative, same rationale. The only master rows allowed to be
// absent from the app are future months awaiting NHTSA incident data.

// --- Minimal CSV parser (handles quoted fields with commas) ---
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

const num = s => Number(String(s).replace(/,/g, ""));

const masterRows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
assert.deepEqual(
  masterRows[0],
  ["helmer", "month", "vmt", "helmer_cumulative_vmt", "kyoom_min", "kyoom_max", "vmt_min", "vmt_max", "rationale"],
  `Replicata: read the header of data/vmt.csv.
Expectata: canonical master header.
Resultata: ${JSON.stringify(masterRows[0])}.`);
const master = masterRows.slice(1).map(r => ({
  helmer: r[0], month: r[1], vmt: num(r[2]), cume: num(r[3]),
  kmin: num(r[4]), kmax: num(r[5]), lo: num(r[6]), hi: num(r[7]), rationale: r[8],
}));

// --- Load the app with DOM stubs and render the full date range ---
class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.listeners = {};
    this._innerHTML = "";
    this._textContent = "";
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }
  // escHtml() relies on textContent assignment escaping into innerHTML
  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  get textContent() { return this._textContent; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { for (const n of nodes) n.parentNode = this; this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(k, v) { this[k] = v; }
  querySelector() { return new ElementStub("queried"); }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};
const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const rendered = JSON.parse(JSON.stringify(vm.runInContext(`
incidents = INCIDENT_DATA;
vmtRows = parseVmtCsv(VMT_CSV_TEXT);
monthRangeStart = 0;
monthRangeEnd = Infinity;
// The per-helmer VMT grid respects the checkboxes (Zoox is off by default);
// enable all ADS helmers so every master row is rendered for this fidelity check.
for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
vmtCumulative = false; buildMonthlyViews();
const monthlyCharts = document.getElementById("chart-helmer-series").innerHTML;
vmtCumulative = true; renderWindowedViews();
const cumulativeCharts = document.getElementById("chart-helmer-series").innerHTML;
vmtCumulative = false;
({
  months: fullMonthSeries.months,
  helmerCharts: monthlyCharts,
  helmerChartsCumulative: cumulativeCharts,
  vmtJsRows: vmtRows.map(r => ({
    helmer: r.helmer, month: r.month, vmt: r.vmtBest, cume: r.vmtCume,
    lo: r.vmtMin, hi: r.vmtMax, coverage: r.coverage, rationale: r.rationale,
  })),
})
`, ctx)));

const cutoff = rendered.months[rendered.months.length - 1];

// --- 1. vmt.js rows match the master row-for-row on shared months ---
const masterByKey = Object.fromEntries(master.map(r => [`${r.helmer}|${r.month}`, r]));
for (const r of rendered.vmtJsRows) {
  const key = `${r.helmer.toLowerCase()}|${r.month}`;
  const m = masterByKey[key];
  assert.ok(m !== undefined,
    `Replicata: look up vmt.js row ${key} in data/vmt.csv.
Expectata: every generated VMT row originates from a master row.
Resultata: ${key} is missing from the master.`);
  assert.ok(
    m.vmt === r.vmt && m.cume === r.cume && m.lo === r.lo && m.hi === r.hi &&
      m.rationale === r.rationale,
    `Replicata: compare vmt.js row ${key} against data/vmt.csv.
Expectata: vmt/cumulative/min/max/rationale identical after slurp.
Resultata: master ${JSON.stringify(m)} vs generated ${JSON.stringify(r)}.`);
}

// --- 2. Master rows absent from vmt.js are strictly-future months ---
const generatedKeys = new Set(
  rendered.vmtJsRows.map(r => `${r.helmer.toLowerCase()}|${r.month}`));
for (const m of master) {
  if (generatedKeys.has(`${m.helmer}|${m.month}`)) continue;
  assert.ok(m.month > cutoff,
    `Replicata: find master row ${m.helmer} ${m.month} in vmt.js.
Expectata: only months after the last incident month (${cutoff}) may be absent.
Resultata: ${m.helmer} ${m.month} is missing despite being in range.`);
}

// --- 3. Rendered charts show master values verbatim, in BOTH view modes ---
// Monthly tooltip:    "<Helmer> <month>\nMonthly VMT: <vmt> (<lo> – <hi>)\n..."
// Cumulative tooltip: "<Helmer> <month>\nCumulative VMT: <cume> (<kmin> – <kmax>)\n..."
const grab = (html, label) => {
  const re = new RegExp(
    `data-tip="(Tesla|Waymo|Zoox) (\\d{4}-\\d{2})\\n${label}: ([\\d,]+) \\(([\\d,]+)[^\\d,]+([\\d,]+)\\)`, "g");
  const out = {};
  for (const h of html.matchAll(re)) out[`${h[1].toLowerCase()}|${h[2]}`] = [num(h[3]), num(h[4]), num(h[5])];
  return out;
};
const monthly = grab(rendered.helmerCharts, "Monthly VMT");
const cumulative = grab(rendered.helmerChartsCumulative, "Cumulative VMT");
const inRange = master.filter(m => m.month <= cutoff);
for (const [name, got] of [["monthly", monthly], ["cumulative", cumulative]]) {
  assert.equal(Object.keys(got).length, inRange.length,
    `Replicata: extract ${name} VMT tooltips from the rendered charts.
Expectata: one tooltip per master row up to ${cutoff} (${inRange.length}).
Resultata: found ${Object.keys(got).length}.`);
}
for (const m of inRange) {
  const key = `${m.helmer}|${m.month}`;
  assert.deepEqual(monthly[key], [m.vmt, m.lo, m.hi],
    `Replicata: read the monthly VMT tooltip for ${m.helmer} ${m.month}.
Expectata: master monthly values [${m.vmt}, ${m.lo}, ${m.hi}].
Resultata: ${JSON.stringify(monthly[key])}.`);
  assert.deepEqual(cumulative[key], [m.cume, m.kmin, m.kmax],
    `Replicata: read the cumulative VMT tooltip for ${m.helmer} ${m.month} (cumulative mode).
Expectata: master cumulative band [${m.cume}, ${m.kmin}, ${m.kmax}].
Resultata: ${JSON.stringify(cumulative[key])}.`);
}

console.log("qual pass: data/vmt.csv flows unchanged into vmt.js and the rendered VMT charts");

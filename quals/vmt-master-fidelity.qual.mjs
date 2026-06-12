import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Master-to-app fidelity: every row of data/vmt.csv (the editable VMT master)
// must flow through data/slurp.py into data/vmt.js and from there into the
// rendered per-driver charts unchanged — same central VMT, same min/max
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
  ["driver", "month", "vmt", "driver_cumulative_vmt", "vmt_min", "vmt_max", "rationale"],
  `Replicata: read the header of data/vmt.csv.
Expectata: canonical master header.
Resultata: ${JSON.stringify(masterRows[0])}.`);
const master = masterRows.slice(1).map(r => ({
  driver: r[0], month: r[1], vmt: num(r[2]), cume: num(r[3]),
  lo: num(r[4]), hi: num(r[5]), rationale: r[6],
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
buildMonthlyViews();
({
  months: fullMonthSeries.months,
  driverCharts: document.getElementById("chart-driver-series").innerHTML,
  vmtJsRows: vmtRows.map(r => ({
    driver: r.driver, month: r.month, vmt: r.vmtBest, cume: r.vmtCume,
    lo: r.vmtMin, hi: r.vmtMax, coverage: r.coverage, rationale: r.rationale,
  })),
})
`, ctx)));

const cutoff = rendered.months[rendered.months.length - 1];

// --- 1. vmt.js rows match the master row-for-row on shared months ---
const masterByKey = Object.fromEntries(master.map(r => [`${r.driver}|${r.month}`, r]));
for (const r of rendered.vmtJsRows) {
  const key = `${r.driver.toLowerCase()}|${r.month}`;
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
  rendered.vmtJsRows.map(r => `${r.driver.toLowerCase()}|${r.month}`));
for (const m of master) {
  if (generatedKeys.has(`${m.driver}|${m.month}`)) continue;
  assert.ok(m.month > cutoff,
    `Replicata: find master row ${m.driver} ${m.month} in vmt.js.
Expectata: only months after the last incident month (${cutoff}) may be absent.
Resultata: ${m.driver} ${m.month} is missing despite being in range.`);
}

// --- 3. Rendered driver charts show the master values verbatim ---
// Each driver-month renders a VMT tooltip:
//   "<Driver> <month> (VMT)\nMonthly VMT (central estimate): <vmt*coverage>\n
//    Monthly VMT range: <lo> – <hi>\n...\nCumulative VMT: <cume>..."
const tipRe = /data-tip="(Tesla|Waymo|Zoox) (\d{4}-\d{2}) \(VMT\)\nMonthly VMT \(central estimate\): ([\d,]+)\nMonthly VMT range: ([\d,]+) – ([\d,]+)\n[^"]*\nCumulative VMT: ([\d,]+)/g;
const seen = {};
for (const hit of rendered.driverCharts.matchAll(tipRe)) {
  seen[`${hit[1].toLowerCase()}|${hit[2]}`] =
    { vmt: num(hit[3]), lo: num(hit[4]), hi: num(hit[5]), cume: num(hit[6]) };
}
const inRange = master.filter(m => m.month <= cutoff);
assert.equal(Object.keys(seen).length, inRange.length,
  `Replicata: extract VMT tooltips from the rendered per-driver charts.
Expectata: one tooltip per master row up to ${cutoff} (${inRange.length}).
Resultata: found ${Object.keys(seen).length}.`);
for (const m of inRange) {
  const got = seen[`${m.driver}|${m.month}`];
  const cov = rendered.vmtJsRows.find(r =>
    r.driver.toLowerCase() === m.driver && r.month === m.month).coverage;
  const expected = {
    vmt: Math.round(m.vmt * cov), lo: Math.round(m.lo * cov),
    hi: Math.round(m.hi * cov), cume: m.cume,
  };
  assert.deepEqual(got, expected,
    `Replicata: read the rendered VMT tooltip for ${m.driver} ${m.month} (full date range).
Expectata: chart shows the master values ${JSON.stringify(expected)}.
Resultata: chart shows ${JSON.stringify(got)}.`);
}

console.log("qual pass: data/vmt.csv flows unchanged into vmt.js and the rendered VMT charts");

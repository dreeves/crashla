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
// Enable all ADS helmers so every master row is rendered for this fidelity check.
for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
buildMonthlyViews();
// Tooltips no longer carry the helmer name, so render each helmer's chart
// separately, in each view mode, to verify master values flow through.
const perHelmer = {};
for (const h of ADS_HELMERS) {
  vmtCumulative = false;
  const monthly = renderHelmerMonthlyChart(fullMonthSeries, h);
  vmtCumulative = true;
  const cumulative = renderHelmerMonthlyChart(fullMonthSeries, h);
  perHelmer[h] = { monthly, cumulative };
}
vmtCumulative = false;
({
  months: fullMonthSeries.months,
  perHelmer,
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
// Each datapoint renders minimal "<month>\n<value> miles" tooltips: the dot
// carries the central value, the two error-bar ends carry lo/hi. So each
// helmer-month should expose its {central, lo, hi} as "<n> miles" tooltips.
const adsName = lc => Object.keys(rendered.perHelmer).find(h => h.toLowerCase() === lc);
const milesByMonth = html => {
  const out = {};
  for (const h of html.matchAll(/data-tip="(\d{4}-\d{2})\n([\d,]+) miles/g)) {
    (out[h[1]] ??= new Set()).add(num(h[2]));
  }
  return out;
};
const parsed = {};
for (const h of Object.keys(rendered.perHelmer)) parsed[h] = {
  monthly: milesByMonth(rendered.perHelmer[h].monthly),
  cumulative: milesByMonth(rendered.perHelmer[h].cumulative),
};
const inRange = master.filter(m => m.month <= cutoff);
for (const m of inRange) {
  const p = parsed[adsName(m.helmer)];
  const monthlySet = p.monthly[m.month] || new Set();
  const cumSet = p.cumulative[m.month] || new Set();
  for (const v of [m.vmt, m.lo, m.hi]) {
    assert.ok(monthlySet.has(v),
      `Replicata: read ${m.helmer} ${m.month} monthly VMT tooltips.
Expectata: a "${v.toLocaleString()} miles" tooltip (master monthly value) is present.
Resultata: tooltips had ${JSON.stringify([...monthlySet])}.`);
  }
  for (const v of [m.cume, m.kmin, m.kmax]) {
    assert.ok(cumSet.has(v),
      `Replicata: read ${m.helmer} ${m.month} cumulative VMT tooltips.
Expectata: a "${v.toLocaleString()} miles" tooltip (master cumulative value) is present.
Resultata: tooltips had ${JSON.stringify([...cumSet])}.`);
  }
}

// --- 4. No orphan incidents: every in-scope incident has a VMT denominator ---
// An SGO incident in a (helmer, month) with no VMT row gets silently dropped from
// every rate (the pre-2025-06 Zoox bug). Pin it on the data directly, and verify
// monthSeriesData() now fails loudly rather than vanishing the incident.
const orphans = vm.runInContext(`
(() => {
  const keys = new Set(parseVmtCsv(VMT_CSV_TEXT).map(r => r.helmer.toLowerCase() + "|" + r.month));
  return INCIDENT_DATA
    .filter(i => !keys.has(i.helmer.toLowerCase() + "|" + monthKeyFromIncidentLabel(i.date)))
    .map(i => i.reportId + " (" + i.helmer + " " + i.date + ")");
})()
`, ctx);
assert.equal(
  orphans.length, 0,
  `Replicata: map every in-scope incident to its (helmer, month) and look it up in the VMT data.
Expectata: every incident has a VMT row for its helmer-month (no orphan numerators).
Resultata: ${orphans.length} orphan(s): ${orphans.slice(0, 8).join(", ")}.`);

// The runtime guard must actually fire: inject a Zoox incident in a Waymo-only
// month (2021-09, in the VMT month set but with no Zoox VMT) and expect a throw.
const guardThrows = vm.runInContext(`
(() => {
  const saved = incidents;
  incidents = [{ ...saved[0], helmer: "Zoox", date: "SEP-2021", reportId: "synthetic-orphan", fault: null }];
  try { monthSeriesData(); return "no throw"; }
  catch (e) { return /orphan/.test(e.message) ? "orphan-throw" : "other: " + e.message; }
  finally { incidents = saved; }
})()
`, ctx);
assert.equal(
  guardThrows, "orphan-throw",
  `Replicata: inject a Zoox incident in 2021-09 (no Zoox VMT) and call monthSeriesData().
Expectata: a loud "orphan" assertion failure, not a silent drop.
Resultata: ${guardThrows}.`);

console.log("qual pass: data/vmt.csv flows unchanged into vmt.js and the rendered VMT charts; no orphan incidents");

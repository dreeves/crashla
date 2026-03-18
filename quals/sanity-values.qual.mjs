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

// Initialize state
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();
  activeSeries = fullMonthSeries;
  buildSanityChecks();
`, ctx);

const html = getNode("sanity-checks").innerHTML;

// --- Passenger counts must add up ---
// Extract rows from the passenger presence table: each <tr> has
// company, withPax, noPax, unk, total, %
// The total column must equal withPax + noPax + unk
const paxSection = html.split("<h3>Passenger presence</h3>")[1]
  .split("<h3>")[0];
const paxTrMatches = [...paxSection.matchAll(/<tr>\s*<td>[^<]+<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>/g)];
assert.ok(
  paxTrMatches.length >= 3,
  `Replicata: passenger presence table has driver rows.
Expectata: at least 3 driver rows (Tesla, Waymo, Zoox).
Resultata: found ${paxTrMatches.length} rows.`);

for (const m of paxTrMatches) {
  const [withPax, noPax, unk, total] = [m[1], m[2], m[3], m[4]].map(Number);
  assert.strictEqual(
    withPax + noPax + unk, total,
    `Replicata: passenger count arithmetic.
Expectata: withPax(${withPax}) + noPax(${noPax}) + unk(${unk}) = total(${total}).
Resultata: sum is ${withPax + noPax + unk}.`);
}

// --- Severity counts add up per company ---
const sevSection = html.split("<h3>Severity breakdown</h3>")[1]
  .split("<h3>")[0];
// Each row: company, propDmg (%), injOnly (%), hosp (%), fatal (%), total
const sevPattern = /<tr>\s*<td>[^<]+<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)<\/td>/g;
const sevMatches = [...sevSection.matchAll(sevPattern)];
assert.ok(
  sevMatches.length >= 3,
  `Replicata: severity table has driver rows.
Expectata: at least 3 rows.
Resultata: found ${sevMatches.length}.`);

for (const m of sevMatches) {
  const [propDmg, injOnly, hosp, fatal, total] =
    [m[1], m[2], m[3], m[4], m[5]].map(Number);
  assert.strictEqual(
    propDmg + injOnly + hosp + fatal, total,
    `Replicata: severity count arithmetic.
Expectata: ${propDmg}+${injOnly}+${hosp}+${fatal} = ${total}.
Resultata: sum is ${propDmg + injOnly + hosp + fatal}.`);
}

// --- Narrative redaction counts add up ---
const cbiSection = html.split("<h3>Narrative redaction</h3>")[1]
  .split("<h3>")[0];
const cbiPattern = /<tr>\s*<td>[^<]+<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>\s*<td>(\d+)<\/td>/g;
const cbiMatches = [...cbiSection.matchAll(cbiPattern)];
assert.ok(cbiMatches.length >= 3,
  `Replicata: CBI table has driver rows.
Expectata: at least 3.
Resultata: found ${cbiMatches.length}.`);

for (const m of cbiMatches) {
  const [redacted, full, total] = [m[1], m[2], m[3]].map(Number);
  assert.strictEqual(
    redacted + full, total,
    `Replicata: CBI count arithmetic.
Expectata: redacted(${redacted}) + full(${full}) = total(${total}).
Resultata: sum is ${redacted + full}.`);
}

// --- VMT range ratio is always >= 1 ---
const vmtSection = html.split("<h3>VMT uncertainty</h3>")[1]
  .split("<h3>")[0];
const ratioMatches = [...vmtSection.matchAll(/([\d.]+)x/g)];
assert.ok(ratioMatches.length >= 3,
  `Replicata: VMT uncertainty table has range ratios.
Expectata: at least 3.
Resultata: found ${ratioMatches.length}.`);

for (const m of ratioMatches) {
  const ratio = parseFloat(m[1]);
  assert.ok(
    ratio >= 1.0,
    `Replicata: VMT range ratio >= 1.
Expectata: ratio >= 1 (max/min always >= 1).
Resultata: got ${ratio}.`);
}

// --- Poisson dispersion index is non-negative ---
const dispSection = html.split("<h3>Poisson dispersion</h3>")[1]
  .split("<h3>")[0];
// Dispersion index column: look for decimal numbers in the 4th td
const dispPattern = /<td>([\d.]+)<\/td>\s*<td>(too few|underdispersed|consistent|mildly|overdispersed)/g;
const dispMatches = [...dispSection.matchAll(dispPattern)];
assert.ok(dispMatches.length >= 3,
  `Replicata: Poisson dispersion table has driver rows.
Expectata: at least 3.
Resultata: found ${dispMatches.length}.`);

for (const m of dispMatches) {
  const idx = parseFloat(m[1]);
  assert.ok(
    idx >= 0,
    `Replicata: dispersion index non-negative.
Expectata: chi-squared / df >= 0.
Resultata: got ${idx}.`);
}

// --- Reporting threshold: speed=0 count <= total for each company ---
const rptSection = html.split("<h3>Reporting threshold disparities</h3>")[1]
  .split("<h3>")[0];
const rptPattern = /<tr>\s*<td>[^<]+<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)[^<]*<\/td>\s*<td>(\d+)<\/td>/g;
const rptMatches = [...rptSection.matchAll(rptPattern)];
assert.ok(rptMatches.length >= 3,
  `Replicata: reporting threshold table has driver rows.
Expectata: at least 3.
Resultata: found ${rptMatches.length}.`);

for (const m of rptMatches) {
  const [zero, stopped, propDmg, total] = [m[1], m[2], m[3], m[4]].map(Number);
  assert.ok(zero <= total && stopped <= total && propDmg <= total,
    `Replicata: reporting threshold subcounts <= total.
Expectata: each metric <= ${total}.
Resultata: zero=${zero}, stopped=${stopped}, propDmg=${propDmg}.`);
}

// --- Incident totals consistent across passenger, severity, CBI tables ---
// Each table should have the same total per company
const extractTotals = (section, colIndex) => {
  // Get all <tr> rows and extract the company name + specified column
  const rows = [...section.matchAll(/<tr>\s*<td>([^<]+)<\/td>/g)];
  const totals = {};
  const trBlocks = section.split("<tr>").slice(1); // skip pre-first
  for (const block of trBlocks) {
    const tds = [...block.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1]);
    if (tds.length >= colIndex + 1) {
      const driver = tds[0].trim();
      const val = parseInt(tds[colIndex], 10);
      if (!isNaN(val)) totals[driver] = val;
    }
  }
  return totals;
};

const paxTotals = extractTotals(paxSection, 4);   // Total is 5th column (idx 4)
const sevTotals = extractTotals(sevSection, 5);    // Total is 6th column (idx 5)
const cbiTotals = extractTotals(cbiSection, 3);    // Total is 4th column (idx 3)

for (const co of Object.keys(paxTotals)) {
  if (sevTotals[co] !== undefined) {
    assert.strictEqual(
      paxTotals[co], sevTotals[co],
      `Replicata: ${co} incident total consistent across tables.
Expectata: passenger total (${paxTotals[co]}) = severity total (${sevTotals[co]}).
Resultata: they differ.`);
  }
  if (cbiTotals[co] !== undefined) {
    assert.strictEqual(
      paxTotals[co], cbiTotals[co],
      `Replicata: ${co} incident total consistent across tables.
Expectata: passenger total (${paxTotals[co]}) = CBI total (${cbiTotals[co]}).
Resultata: they differ.`);
  }
}

console.log("qual pass: sanity check computed values are arithmetically consistent");

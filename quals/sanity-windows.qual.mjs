// The sanity section's tables over windows other than the default one, each
// checked against a recompute from the data. Added 2026-10-03 for the
// 2026-10-02 audit findings:
//   #9  the Poisson dispersion test runs over each helmer's own VMT months in
//       the window (it counted only months where all three ADS helmers had
//       VMT, 2025-06 on, so full history showed the default window's result
//       and early or short windows an empty table); a helmer with fewer than 3
//       months gets a grayed row that says why;
//   #40 each VMT-sources rationale is prefixed with the months it covers;
//   #53 the incident-coverage table has no row for a helmer with no months in
//       the window (it claimed "All months have full incident coverage");
//   #54 counts carry thousands separators ("2066 incidents", "1164");
//   #61 the coverage note gives the data-through MONTH, not the cutoff date;
//   #90 "AV stopped" counts both stationary SGO codes, Stopped and Parked
//       (Parked is a code only Waymo files).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

class ElementStub {
  constructor(tagName) { this.tagName = tagName; this._text = ""; this._html = ""; }
  set textContent(v) {
    this._text = v;
    this._html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
}
const nodes = new Map();
const getNode = id => (nodes.has(id) || nodes.set(id, new ElementStub("div")), nodes.get(id));
const ctx = vm.createContext({
  console,
  document: { getElementById: getNode, createElement: tag => new ElementStub(tag) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();
`, ctx);
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));

const months = run("fullMonthSeries.months");
const ADS = run("ADS_HELMERS");
const last = months[months.length - 1];
const WINDOWS = {
  default: [run("DEFAULT_START_MONTH"), last],
  full: [months[0], last],
  "2021-07..2025-05": ["2021-07", "2025-05"],
  "2024-01..2025-12": ["2024-01", "2025-12"],
  "2025-01..2025-07": ["2025-01", "2025-07"],
  last3: [months[months.length - 3], last],
  last1: [last, last],
  "2021-07..2021-12": ["2021-07", "2021-12"],
  "2024-04": ["2024-04", "2024-04"],
};
const sanityHtml = ([a, b]) => vm.runInContext(`
  activeSeries = sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)});
  buildSanityChecks();
  document.getElementById("sanity-checks").innerHTML;`, ctx);
const section = (html, h) => (html.split(`<h3>${h}</h3>`)[1] || "").split("<h3>")[0];
const bodyRows = sec => [...((/<tbody>([\s\S]*?)<\/tbody>/.exec(sec) || [])[1] || "").matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
  .map(m => ({ attrs: m[1], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(c => ({ attrs: c[1], html: c[2], text: c[2].replace(/<[^>]*>/g, "") })) }));
const num = s => Number(s.replace(/,/g, ""));
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The data, read independently of the app's aggregation.
const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const inc = run("INCIDENT_DATA.map(r => ({helmer: r.helmer, date: r.date, svMovement: r.svMovement}))")
  .map(r => ({ ...r, month: `${r.date.slice(4)}-${MON[r.date.slice(0, 3)]}` }));
const vmt = run("vmtRows.map(r => ({helmer: r.helmer, month: r.month, eff: r.vmtBest * r.coverage * r.incCov, rationale: r.rationale}))");
const inWin = ([a, b]) => m => m >= a && m <= b;
const VERDICT = (k, idx) => k < 20 ? "too few incidents to tell" : idx < 0.5 ? "underdispersed"
  : idx < 2 ? "consistent with Poisson" : idx < 5 ? "mildly overdispersed" : "overdispersed";
const fewNote = n => vm.runInContext(`dispersionFewMonthsNote(${n})`, ctx);

const problems = { dispersion: [], vmtSources: [], coverageRows: [], coverageNote: [], separators: [], avStopped: [] };
const dataThroughMonth = run("NHTSA_DATA_THROUGH_DATE.slice(0, 7)");
const dataThroughDate = run("NHTSA_DATA_THROUGH_DATE");
let dispersionChecked = 0;
for (const [wname, win] of Object.entries(WINDOWS)) {
  const html = sanityHtml(win);
  const w = inWin(win);

  // #9: one row per ADS helmer, over its own months.
  const disp = bodyRows(section(html, "Poisson dispersion"));
  const dispHelmers = disp.map(r => r.cells[0] && r.cells[0].text);
  if (JSON.stringify(dispHelmers) !== JSON.stringify(ADS)) problems.dispersion.push(`${wname}: rows ${JSON.stringify(dispHelmers)}, want one per ADS helmer ${JSON.stringify(ADS)}`);
  for (const helmer of ADS) {
    const row = disp.find(r => r.cells[0] && r.cells[0].text === helmer);
    if (!row) continue;
    const data = vmt.filter(r => r.helmer === helmer && w(r.month)).sort((x, y) => x.month < y.month ? -1 : 1)
      .map(r => ({ count: inc.filter(i => i.helmer === helmer && i.month === r.month).length, vmt: r.eff }));
    const grayed = /class="[^"]*\binsufficient\b/.test(row.attrs);
    if (data.length < 3) {
      let note = null;
      try { note = fewNote(data.length); } catch (e) { note = `(dispersionFewMonthsNote: ${e.message})`; }
      if (!grayed || row.cells.length !== 2 || !/colspan="4"/.test(row.cells[1].attrs) || row.cells[1].text !== escHtml(note) || !note.includes(String(data.length))) {
        problems.dispersion.push(`${wname} ${helmer}: ${data.length} months, want a grayed row (class insufficient) with one colspan-4 cell giving the reason (${JSON.stringify(note)}); got ${JSON.stringify({ attrs: row.attrs, cells: row.cells.map(c => c.text) })}`);
      }
      continue;
    }
    const K = data.reduce((s, d) => s + d.count, 0), M = data.reduce((s, d) => s + d.vmt, 0), lam = K / M;
    const chi = data.reduce((s, d) => s + (lam * d.vmt > 0 ? (d.count - lam * d.vmt) ** 2 / (lam * d.vmt) : 0), 0);
    const idx = chi / (data.length - 1);
    const want = [helmer, data.map(d => (d.count / d.vmt * 1e6).toFixed(1)).join(", "), (lam * 1e6).toFixed(1), idx.toFixed(2), VERDICT(K, idx)];
    const got = row.cells.map(c => c.text);
    dispersionChecked++;
    if (grayed || JSON.stringify(got) !== JSON.stringify(want)) problems.dispersion.push(`${wname} ${helmer} (${data.length} months, ${K} incidents): got ${JSON.stringify(got).slice(0, 160)}${grayed ? " grayed" : ""}, want ${JSON.stringify(want).slice(0, 160)}`);
  }

  // #40: each rationale with the months it covers, in order.
  const src = bodyRows(section(html, "VMT sources"));
  for (const helmer of ADS) {
    const rows = vmt.filter(r => r.helmer === helmer && w(r.month)).sort((x, y) => x.month < y.month ? -1 : 1);
    const runs = [];
    for (const r of rows) {
      if (runs.length && runs[runs.length - 1].rationale === r.rationale) runs[runs.length - 1].last = r.month;
      else runs.push({ rationale: r.rationale, first: r.month, last: r.month });
    }
    const want = runs.map(s => `${s.first === s.last ? s.first : `${s.first} – ${s.last}`}: ${escHtml(s.rationale)}`);
    const row = src.find(r => r.cells[0] && r.cells[0].text === helmer);
    const got = row ? row.cells[1].html.split("<br>") : [];
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.vmtSources.push(`${wname} ${helmer}: got ${JSON.stringify(got.map(g => g.slice(0, 40)))}, want ${JSON.stringify(want.map(g => g.slice(0, 40)))}`);
  }

  // #53: a coverage row only for helmers with months in the window.
  const cov = bodyRows(section(html, "Incident coverage for partial months"));
  const covHelmers = [...new Set(cov.map(r => r.cells[0].text))];
  const withMonths = ADS.filter(h => vmt.some(r => r.helmer === h && w(r.month)));
  if (JSON.stringify(covHelmers) !== JSON.stringify(withMonths)) problems.coverageRows.push(`${wname}: coverage rows for ${JSON.stringify(covHelmers)}, want ${JSON.stringify(withMonths)} (the helmers with VMT months in the window)`);
  // #61
  const covSec = section(html, "Incident coverage for partial months");
  if (!covSec.includes(`data-through month (${dataThroughMonth})`) || covSec.includes(`(${dataThroughDate})`)) {
    problems.coverageNote.push(`${wname}: ${JSON.stringify((/data-through month \([^)]*\)/.exec(covSec) || ["(missing)"])[0])}, want "data-through month (${dataThroughMonth})"`);
  }

  // #90: stationary = Stopped or Parked.
  for (const row of bodyRows(section(html, "Reporting threshold disparities"))) {
    const helmer = row.cells[0].text;
    const want = inc.filter(i => i.helmer === helmer && w(i.month) && ["Stopped", "Parked"].includes(i.svMovement)).length;
    const got = num(row.cells[2].text.split(" ")[0]);
    if (got !== want) problems.avStopped.push(`${wname} ${helmer}: AV stopped ${row.cells[2].text}, want ${want.toLocaleString("en-US")} (Stopped + Parked)`);
  }

  // #54: counts of 1,000 or more carry the en-US separator.
  for (const h of ["Passenger presence", "Severity breakdown", "Reporting threshold disparities", "Geography"]) {
    for (const row of bodyRows(section(html, h))) {
      for (const c of row.cells.slice(1)) {
        const bare = c.text.match(/(?<![\d,.])\d{4,}(?![\d,.])/g);
        if (bare) problems.separators.push(`${wname} ${h} ${row.cells[0].text}: ${JSON.stringify(c.text.slice(0, 60))}`);
      }
    }
  }
  const xcheck = section(html, "Waymo cross-check");
  const waymoAll = inc.filter(i => i.helmer === "Waymo").length;
  if (!xcheck.includes(`(${waymoAll.toLocaleString("en-US")} incidents over `)) problems.separators.push(`${wname} Waymo cross-check: ${JSON.stringify((/\(([^)]*) incidents over /.exec(xcheck) || ["(missing)"])[0])}, want "(${waymoAll.toLocaleString("en-US")} incidents over "`);
}
assert.ok(dispersionChecked >= 12, `the sweep recomputed ${dispersionChecked} dispersion rows (expected at least 12)`);

// #9: the grayed row is styled, and its reason is the human's English, pinned
// to the character for every count a grayed row can show, 0, 1 or 2 months
// (committed 2026-10-04 in b068a10; until then it was agent Latin and this
// block checked for the TODO recap above dispersionFewMonthsNote). The rows
// checked above carry exactly this text.
const css = fs.readFileSync("style.css", "utf8");
if (!/tr\.insufficient\s*\{[^}]*opacity:\s*0?\.\d+/.test(css)) problems.dispersion.push("style.css: no tr.insufficient rule with an opacity below 1");
for (const n of [0, 1, 2]) {
  const want = `Months in the window: ${n}. Dispersion test needs at least 3 months.`, got = fewNote(n);
  if (got !== want) problems.dispersion.push(`dispersionFewMonthsNote(${n}) reads ${JSON.stringify(got)}; want the human's English ${JSON.stringify(want)}`);
}

// #40: each rationale's months are contiguous across all of data/vmt.csv
// (the rows the page shows at later releases too), so a first-last prefix
// cannot hide a gap.
const csv = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1).map(p => ({ helmer: p[0], month: p[1], rationale: p[8] }));
for (const helmer of [...new Set(csv.map(r => r.helmer))]) {
  const rows = csv.filter(r => r.helmer === helmer).sort((x, y) => x.month < y.month ? -1 : 1);
  const seen = new Set();
  rows.forEach((r, i) => {
    if (i > 0 && rows[i - 1].rationale === r.rationale) return;
    if (seen.has(r.rationale)) problems.vmtSources.push(`data/vmt.csv ${helmer}: the rationale of ${r.month} recurs after a different one (${JSON.stringify(r.rationale.slice(0, 50))})`);
    seen.add(r.rationale);
  });
}

const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v.slice(0, 12).concat(v.length > 12 ? [`... ${v.length - 12} more`] : [])]));
assert.deepEqual(failing, {},
  `Replicata: build the sanity section for ${Object.keys(WINDOWS).join(", ")} and compare its Poisson dispersion, VMT sources, Incident coverage, Reporting threshold and count cells with a recompute from INCIDENT_DATA and the VMT rows.
Expectata: (dispersion) one row per ADS helmer: over its own VMT months in the window when it has 3 or more (rates, overall rate, index and verdict as recomputed), else a grayed row (class insufficient) whose one cell gives the reason with the month count, in the human's English exactly ("Months in the window: <n>. Dispersion test needs at least 3 months."); (vmtSources) each rationale prefixed "first – last: " (or "month: "), in month order, each rationale's months contiguous in data/vmt.csv; (coverageRows) rows only for helmers with VMT months in the window; (coverageNote) "data-through month (${dataThroughMonth})", not the cutoff date; (avStopped) Stopped + Parked; (separators) counts of 1,000 or more grouped "1,164", and the cross-check reads "(${inc.filter(i => i.helmer === "Waymo").length.toLocaleString("en-US")} incidents over".
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: sanity tables over ${Object.keys(WINDOWS).length} windows (${dispersionChecked} dispersion rows recomputed) use each helmer's own months, label rationale spans, list coverage only for helmers with months, count Stopped + Parked, and group thousands`);

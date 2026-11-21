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
// Since 2026-11-21 (audit A10 of 2026-11-20, the human's "ok") the dispersion
// table's assessment follows the test its section names, Pearson's
// chi-squared with months - 1 degrees of freedom: overdispersed when the
// statistic's upper tail is under 5% ("mildly" while the index, the statistic
// over its degrees of freedom, is under 5), underdispersed when its lower
// tail is, consistent with Poisson otherwise; fewer than 20 incidents stay
// too few to tell. Until then it went by the index alone (under 0.5, under 2,
// under 5, 5 or more) whatever the number of months, which contradicted the
// test in 111 of the 2,684 window-lines with 3 months and 20 incidents or
// more on the data of 2026-11-21 (the audit, on the data before the
// pending-month rule, counted 113 of 2,686; Waymo over the 22 months of
// 2023-10..2025-07 read "consistent with Poisson" at an upper tail of
// 0.0068). This qual restated those cutoffs
// until then; it holds every drawn row, and the app's rule on every slider
// window and at each threshold, to the tails of quals/chi-squared.mjs,
// computed apart from the app.
// Since 2026-11-21 (audit A6 of 2026-11-20; the human chose a separate count)
// the Reporting threshold table has a column right after "AV stopped" for the
// records with no stated pre-crash movement: a blank one (Tesla's list gives
// none, so its preprints have none) or NHTSA's "Unknown". Until then they
// counted as not stopped without a word: Tesla's row read "AV stopped 17
// (37%)" beside eight preprints, three of whose narratives say the car was
// stopped.
// Since 2026-10-24 the dispersion test has a row for every line with a
// summary card (ADS_SERIES: Tesla's no-monitor line too, under its label),
// each counting the incidents whose series lists it.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";
import { rationaleMarkup } from "./rationale-links.mjs";
import { chiSquaredLower, chiSquaredUpper, chiSquaredCritical, checkChiSquaredReference } from "./chi-squared.mjs";

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
const LINES = run("ADS_SERIES");
const LABEL = run("Object.fromEntries(ADS_SERIES.map(h => [h, helmerLabel(h)]))");
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
  "2021-07": ["2021-07", "2021-07"], // no incidents at all
  // Three windows whose rows read against the chi-squared test under the
  // index cutoffs the table used until 2026-11-21 (audit A10): Waymo over 22
  // months "consistent" at an upper tail of 0.0068, Zoox over 16 months
  // "consistent" at 0.04, Waymo over 5 months "underdispersed" at a lower
  // tail of 0.1.
  "2023-10..2025-07": ["2023-10", "2025-07"],
  "2025-06..2026-09": ["2025-06", "2026-09"],
  "2023-03..2023-07": ["2023-03", "2023-07"],
};
// The app's assessment rule, dispersionVerdict (since 2026-11-21), is wrapped
// to record what each drawn row asks of it: its incidents, Pearson's
// statistic and degrees of freedom, which the sweep below holds to its
// recount (a table passing the months for the degrees of freedom would
// change a label only near a threshold).
vm.runInContext(`var dispersionCalls = [];
  if (typeof dispersionVerdict === "function") {
    const shipped = dispersionVerdict;
    dispersionVerdict = (k, chi, df) => { dispersionCalls.push([k, chi, df]); return shipped(k, chi, df); };
  }`, ctx);
const sanityHtml = ([a, b]) => vm.runInContext(`
  dispersionCalls.length = 0;
  activeSeries = sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)});
  buildSanityChecks();
  document.getElementById("sanity-checks").innerHTML;`, ctx);
// A sanity section: from the heading before the table with this id up to the
// next heading ("" when there is no such table). The tables carry ids since
// 2026-10-29; until then this qual found each section by its heading's words,
// which are the human's to change.
const section = (html, id) => {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<h3", at), end = html.indexOf("<h3", at);
  return html.slice(start, end < 0 ? html.length : end);
};
const bodyRows = sec => [...((/<tbody>([\s\S]*?)<\/tbody>/.exec(sec) || [])[1] || "").matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
  .map(m => ({ attrs: m[1], cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(c => ({ attrs: c[1], html: c[2], text: c[2].replace(/<[^>]*>/g, "") })) }));
const num = s => Number(s.replace(/,/g, ""));
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The data, read independently of the app's aggregation.
const MON = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const inc = run("INCIDENT_DATA.map(r => ({helmer: r.helmer, series: r.series, date: r.date, svMovement: r.svMovement}))")
  .map(r => ({ ...r, month: `${r.date.slice(4)}-${MON[r.date.slice(0, 3)]}` }));
const vmt = run("vmtRows.map(r => ({helmer: r.helmer, month: r.month, eff: r.vmtBest * r.coverage * r.incCov, rationale: r.rationale}))");
const inWin = ([a, b]) => m => m >= a && m <= b;
// The assessment's words are the app's (DISPERSION_VERDICT; until 2026-10-29
// this qual spelled them out); its tiers are recomputed here, so the five must
// be five different assessments.
const DV = run("DISPERSION_VERDICT");
assert.equal(new Set(Object.values(DV)).size, 5,
  `Replicata: read crashla.js DISPERSION_VERDICT. Expectata: five different assessments, one per tier. Resultata: ${JSON.stringify(DV)}.`);
// The rule (the human's decision of 2026-11-21 on audit A10), restated here
// on tails computed apart from the app (quals/chi-squared.mjs, checked first
// against the standard table): k incidents, Pearson's statistic chi, df =
// months - 1.
checkChiSquaredReference();
const VERDICT = (k, chi, df) => k < 20 ? DV.fewIncidents
  : chiSquaredUpper(chi, df) < 0.05 ? (chi / df < 5 ? DV.mild : DV.over)
  : chiSquaredLower(chi, df) < 0.05 ? DV.under : DV.poisson;
// A line's months in a window, recounted: each month's incidents and
// effective miles, and from them the incidents, Pearson's statistic and its
// degrees of freedom.
const monthsOf = (helmer, w) => vmt.filter(r => r.helmer === helmer && w(r.month)).sort((x, y) => x.month < y.month ? -1 : 1)
  .map(r => ({ count: inc.filter(i => i.series.includes(helmer) && i.month === r.month).length, vmt: r.eff }));
const pearson = data => {
  const K = data.reduce((s, d) => s + d.count, 0), M = data.reduce((s, d) => s + d.vmt, 0), lam = K / M;
  return { K, lam, chi: data.reduce((s, d) => s + (lam * d.vmt > 0 ? (d.count - lam * d.vmt) ** 2 / (lam * d.vmt) : 0), 0), df: data.length - 1 };
};
const fewNote = n => vm.runInContext(`dispersionFewMonthsNote(${n})`, ctx);

const problems = { dispersion: [], vmtSources: [], coverageRows: [], coverageNote: [], separators: [], avStopped: [], noIncidents: [] };
// The pre-crash movement codes as this qual reads them, apart from the app's
// sets: a stationary AV, and no stated movement.
const STATIONARY = ["Stopped", "Parked"], NO_MOVEMENT = ["", "Unknown"];
// A count's share of a total as the app prints one (fmtShare: a whole
// percent, and a nonzero count that rounds to 0 never reads "0%"), read from
// the app so that no layout of the cell is pinned here; whether a cell's text
// holds that share (not as the tail of a longer number: "1%" is not in "11%").
const shareOf = (count, total) => escHtml(run(`fmtShare(${count}, ${total})`));
const holdsShare = (text, share) => new RegExp(`(^|[^0-9])${share.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
assert.ok(holdsShare("8 (17%)", "17%") && !holdsShare("1 (11%)", "1%") && holdsShare("1 (&lt;1%)", "&lt;1%") && !holdsShare("1 (0%)", "&lt;1%"),
  "this qual's own reading of a share in a cell is wrong");
let thresholdRows = 0, thresholdUnknown = 0;
// #48: the reason a grayed incident-count row gives, read from the app. Its
// words are the human's (committed 2026-10-05 in a3c39bb) and were pinned to
// the character until 2026-10-28, when the human dropped such pins (one went
// red on each of the human's edits and caught no agent's; the human reviews
// every diff).
let noIncidentsNote = "(NO_INCIDENTS_NOTE missing)";
try { noIncidentsNote = run("NO_INCIDENTS_NOTE"); } catch (e) { problems.noIncidents.push(`crashla.js defines no NO_INCIDENTS_NOTE (${e.message})`); }
const dataThroughMonth = run("NHTSA_DATA_THROUGH_DATE.slice(0, 7)");
const dataThroughDate = run("NHTSA_DATA_THROUGH_DATE");
let dispersionChecked = 0;
for (const [wname, win] of Object.entries(WINDOWS)) {
  const html = sanityHtml(win);
  const w = inWin(win);

  // #9: one row per ADS line (each company, and Tesla's no-monitor line),
  // over its own months.
  const disp = bodyRows(section(html, "sanity-dispersion"));
  const dispHelmers = disp.map(r => r.cells[0] && r.cells[0].text);
  const wantLabels = LINES.map(h => escHtml(LABEL[h]));
  if (JSON.stringify(dispHelmers) !== JSON.stringify(wantLabels)) problems.dispersion.push(`${wname}: rows ${JSON.stringify(dispHelmers)}, want one per ADS line ${JSON.stringify(wantLabels)}`);
  // What the table asked the rule, row by row: each line of 3 months or
  // more, in order, its recounted incidents, statistic and degrees of freedom.
  {
    const asked = run("dispersionCalls");
    const want = LINES.map(h => monthsOf(h, w)).filter(d => d.length >= 3).map(pearson);
    const same = asked.length === want.length && want.every((r, i) => asked[i][0] === r.K && asked[i][2] === r.df && Math.abs(asked[i][1] - r.chi) <= 1e-9 * Math.max(1, r.chi));
    if (!same) problems.dispersion.push(`${wname}: the table asked dispersionVerdict of ${JSON.stringify(asked)}, want [incidents, Pearson's statistic, months - 1] of each line with 3 months or more: ${JSON.stringify(want.map(r => [r.K, r.chi, r.df]))}`);
  }
  for (const helmer of LINES) {
    const row = disp.find(r => r.cells[0] && r.cells[0].text === escHtml(LABEL[helmer]));
    if (!row) continue;
    const data = monthsOf(helmer, w);
    const grayed = /class="[^"]*\binsufficient\b/.test(row.attrs);
    if (data.length < 3) {
      let note = null;
      try { note = fewNote(data.length); } catch (e) { note = `(dispersionFewMonthsNote: ${e.message})`; }
      if (!grayed || row.cells.length !== 2 || !/colspan="4"/.test(row.cells[1].attrs) || row.cells[1].text !== escHtml(note) || !note.includes(String(data.length))) {
        problems.dispersion.push(`${wname} ${helmer}: ${data.length} months, want a grayed row (class insufficient) with one colspan-4 cell giving the reason (${JSON.stringify(note)}); got ${JSON.stringify({ attrs: row.attrs, cells: row.cells.map(c => c.text) })}`);
      }
      continue;
    }
    const { K, lam, chi, df } = pearson(data);
    const idx = chi / df;
    const want = [escHtml(LABEL[helmer]), data.map(d => (d.count / d.vmt * 1e6).toFixed(1)).join(", "), (lam * 1e6).toFixed(1), idx.toFixed(2), VERDICT(K, chi, df)];
    const got = row.cells.map(c => c.text);
    dispersionChecked++;
    if (grayed || JSON.stringify(got) !== JSON.stringify(want)) problems.dispersion.push(`${wname} ${helmer} (${data.length} months, ${K} incidents): got ${JSON.stringify(got).slice(0, 160)}${grayed ? " grayed" : ""}, want ${JSON.stringify(want).slice(0, 160)}`);
  }

  // #40: each rationale with the months it covers, in order, for every ADS
  // line with a row (each company, and Tesla's no-monitor line under its
  // label; until 2026-10-31 the companies only, found by their keys, so the
  // no-monitor line's row went unread: audit 2026-10-30, QT-04). Since
  // 2026-11-05 a rationale's links to data/README.md's sections are a
  // elements (quals/rationale-links.mjs, rationaleMarkup; the human's "ok, go
  // with links", 2026-11-04); until then the whole rationale was escaped text.
  const src = bodyRows(section(html, "sanity-vmt-sources"));
  for (const helmer of LINES) {
    const rows = vmt.filter(r => r.helmer === helmer && w(r.month)).sort((x, y) => x.month < y.month ? -1 : 1);
    const runs = [];
    for (const r of rows) {
      if (runs.length && runs[runs.length - 1].rationale === r.rationale) runs[runs.length - 1].last = r.month;
      else runs.push({ rationale: r.rationale, first: r.month, last: r.month });
    }
    const want = runs.map(s => `${s.first === s.last ? s.first : `${s.first} – ${s.last}`}: ${rationaleMarkup(s.rationale)}`);
    const row = src.find(r => r.cells[0] && r.cells[0].text === escHtml(LABEL[helmer]));
    const got = row ? row.cells[1].html.split("<br>") : [];
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.vmtSources.push(`${wname} ${helmer}: got ${JSON.stringify(got.map(g => g.slice(0, 40)))}, want ${JSON.stringify(want.map(g => g.slice(0, 40)))}`);
  }

  // #53: a coverage row only for helmers with months in the window.
  const cov = bodyRows(section(html, "sanity-coverage"));
  const covHelmers = [...new Set(cov.map(r => r.cells[0].text))];
  const withMonths = ADS.filter(h => vmt.some(r => r.helmer === h && w(r.month)));
  if (JSON.stringify(covHelmers) !== JSON.stringify(withMonths)) problems.coverageRows.push(`${wname}: coverage rows for ${JSON.stringify(covHelmers)}, want ${JSON.stringify(withMonths)} (the helmers with VMT months in the window)`);
  // #61: the note names the data-through month in parentheses, not the
  // cutoff date (until 2026-10-29 found by its words "data-through month (").
  const covSec = section(html, "sanity-coverage");
  if (!covSec.includes(`(${dataThroughMonth})`) || covSec.includes(`(${dataThroughDate})`)) {
    problems.coverageNote.push(`${wname}: parenthesized ${JSON.stringify(covSec.match(/\(\d{4}-\d{2}[^)]*\)/g) || [])}, want "(${dataThroughMonth})" and not "(${dataThroughDate})"`);
  }

  // #48 (audit 2026-10-04): the four incident-count tables keep a row for
  // every ADS helmer, as Poisson dispersion does: one with no incidents in
  // the window is grayed (class insufficient) with one cell giving the
  // reason across the rest of the row. Until 2026-10-04 such a helmer had no
  // row at all (at 2026-08, Tesla and Zoox, though both have miles there),
  // and a window with no incidents (2021-07) left four header-only tables.
  for (const [h, columns] of [["sanity-passengers", 6], ["sanity-severity", 7], ["sanity-threshold", 6], ["sanity-geography", 3]]) {
    const rows = bodyRows(section(html, h));
    const names = rows.map(r => r.cells[0] && r.cells[0].text);
    if (JSON.stringify(names) !== JSON.stringify(ADS)) problems.noIncidents.push(`${wname} ${h}: rows ${JSON.stringify(names)}, want one per ADS helmer ${JSON.stringify(ADS)}`);
    // A header cell for each column (since 2026-11-21: a column added to the
    // body alone would shift every later figure under its neighbor's header).
    const heads = ((/<thead>([\s\S]*?)<\/thead>/.exec(section(html, h)) || [])[1] || "").match(/<th[\s>]/g) || [];
    if (heads.length !== columns) problems.noIncidents.push(`${wname} ${h}: ${heads.length} header cells, want ${columns}, one per column`);
    for (const row of rows) {
      const helmer = row.cells[0] && row.cells[0].text;
      const n = inc.filter(i => i.helmer === helmer && w(i.month)).length;
      const grayed = /class="[^"]*\binsufficient\b/.test(row.attrs);
      const reasonCell = row.cells.length === 2 && new RegExp(`colspan="${columns - 1}"`).test(row.cells[1].attrs) && row.cells[1].text === escHtml(noIncidentsNote);
      if (n === 0 ? !(grayed && reasonCell) : grayed || row.cells.length !== columns)
        problems.noIncidents.push(`${wname} ${h} ${helmer} (${n} incidents in the window): ${JSON.stringify({ attrs: row.attrs, cells: row.cells.map(c => c.text.slice(0, 40)) })}; want ${n === 0 ? `a grayed row whose one colspan-${columns - 1} cell reads the note ${JSON.stringify(noIncidentsNote)}` : `a plain row of ${columns} cells`}`);
    }
  }

  // #90: stationary = Stopped or Parked. A6: the cell after it counts the
  // records with no stated movement, with its share of the row's total, and
  // the two with the records of a stated other movement make up the total
  // (the row's last cell).
  for (const row of bodyRows(section(html, "sanity-threshold")).filter(r => !/\binsufficient\b/.test(r.attrs))) {
    const helmer = row.cells[0].text;
    const own = inc.filter(i => i.helmer === helmer && w(i.month));
    const want = own.filter(i => STATIONARY.includes(i.svMovement)).length;
    const got = num(row.cells[2].text.split(" ")[0]);
    if (got !== want) problems.avStopped.push(`${wname} ${helmer}: AV stopped ${row.cells[2].text}, want ${want.toLocaleString("en-US")} (Stopped + Parked)`);
    const unknown = own.filter(i => NO_MOVEMENT.includes(i.svMovement)).length;
    const moving = own.filter(i => !STATIONARY.includes(i.svMovement) && !NO_MOVEMENT.includes(i.svMovement)).length;
    // The cell's count is read as AV stopped's is (its first figure); its
    // share is the app's own print of the recount's share of the row's
    // records.
    const unknownCell = row.cells[3] === undefined ? "(no fourth cell)" : row.cells[3].text, total = num(row.cells[row.cells.length - 1].text);
    thresholdRows++;
    thresholdUnknown += unknown;
    if (num(unknownCell.split(" ")[0]) !== unknown || !holdsShare(unknownCell, shareOf(unknown, own.length)))
      problems.avStopped.push(`${wname} ${helmer}: the cell after AV stopped reads ${JSON.stringify(unknownCell)}, want the ${unknown} records with no stated movement and their share of the ${own.length}, ${JSON.stringify(shareOf(unknown, own.length))}`);
    if (got + unknown + moving !== total || total !== own.length) problems.avStopped.push(`${wname} ${helmer}: AV stopped ${got} + no stated movement ${unknown} + a stated other movement ${moving} = ${got + unknown + moving}, the row's total ${total} (${own.length} incidents)`);
  }

  // #54: counts of 1,000 or more carry the en-US separator.
  for (const h of ["sanity-passengers", "sanity-severity", "sanity-threshold", "sanity-geography"]) {
    for (const row of bodyRows(section(html, h))) {
      for (const c of row.cells.slice(1)) {
        const bare = c.text.match(/(?<![\d,.])\d{4,}(?![\d,.])/g);
        if (bare) problems.separators.push(`${wname} ${h} ${row.cells[0].text}: ${JSON.stringify(c.text.slice(0, 60))}`);
      }
    }
  }
  // The cross-check's opening paragraph gives the full-history Waymo incident
  // count as a figure, grouped. Until 2026-10-29 this found the count by the
  // words around it ("incidents over").
  const xIntro = (/<p>([\s\S]*?)<\/p>/.exec(section(html, "sanity-waymo-check")) || [])[1] || "";
  const xFigures = xIntro.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  const waymoAll = inc.filter(i => i.helmer === "Waymo").length;
  if (!xFigures.includes(waymoAll.toLocaleString("en-US"))) problems.separators.push(`${wname} Waymo cross-check: the opening paragraph's figures are ${JSON.stringify(xFigures)}, want the count ${waymoAll.toLocaleString("en-US")} among them`);
}
assert.ok(dispersionChecked >= 12, `the sweep recomputed ${dispersionChecked} dispersion rows (expected at least 12)`);

// A10: the app's rule, dispersionVerdict(incidents, Pearson's statistic,
// degrees of freedom), against the rule above:
//  - on every slider window's recount, for every line with 3 months or more
//    (the rows the table draws ungrayed; the sweep above reads only a few
//    windows' drawn rows);
//  - at each threshold, on synthetic statistics: just under and just over the
//    upper and the lower 5% points of several degrees of freedom (the points
//    found on the reference tails), the index just under 5 and at 5, and 19
//    and 20 incidents.
let ruleWindows = 0, ruleTested = 0;
{
  const defined = vm.runInContext(`typeof dispersionVerdict`, ctx) === "function";
  if (!defined) problems.dispersion.push("crashla.js defines no dispersionVerdict(incidents, Pearson's statistic, degrees of freedom), the one function the table's assessment comes from");
  const appVerdict = (k, chi, df) => vm.runInContext(`dispersionVerdict(${k}, ${chi}, ${df})`, ctx);
  const disagree = [];
  for (let a = 0; defined && a < months.length; a++) for (let b = a; b < months.length; b++) {
    const w = inWin([months[a], months[b]]);
    for (const helmer of LINES) {
      const data = monthsOf(helmer, w);
      if (data.length < 3) continue;
      const { K, chi, df } = pearson(data);
      ruleWindows++;
      ruleTested += Number(K >= 20);
      const got = appVerdict(K, chi, df), want = VERDICT(K, chi, df);
      if (got !== want) disagree.push(`${months[a]}..${months[b]} ${helmer} (${K} incidents, statistic ${chi.toFixed(3)} on ${df} degrees of freedom, upper tail ${chiSquaredUpper(chi, df).toPrecision(3)}, lower ${chiSquaredLower(chi, df).toPrecision(3)}): ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  if (disagree.length > 0) problems.dispersion.push(`dispersionVerdict differs from the rule on ${disagree.length} window-lines, e.g. ${disagree.slice(0, 3).join("; ")}`);
  const cases = [];
  for (const df of [2, 3, 5, 10, 15, 21, 30, 62]) {
    const up = chiSquaredCritical("upper", 0.05, df), low = chiSquaredCritical("lower", 0.05, df);
    cases.push([`just under the upper 5% point of ${df} degrees of freedom`, 1000, up * (1 - 1e-6), df, DV.poisson],
      [`just over the upper 5% point of ${df} degrees of freedom`, 1000, up * (1 + 1e-6), df, DV.mild],
      [`just over the lower 5% point of ${df} degrees of freedom`, 1000, low * (1 + 1e-6), df, DV.poisson],
      [`just under the lower 5% point of ${df} degrees of freedom`, 1000, low * (1 - 1e-6), df, DV.under],
      [`an index just under 5 on ${df} degrees of freedom`, 1000, 5 * df * (1 - 1e-9), df, DV.mild],
      [`an index of 5 on ${df} degrees of freedom`, 1000, 5 * df, df, DV.over],
      [`19 incidents at an index of 9 on ${df} degrees of freedom`, 19, 9 * df, df, DV.fewIncidents],
      [`20 incidents at an index of 9 on ${df} degrees of freedom`, 20, 9 * df, df, DV.over],
      [`19 incidents at the middle of ${df} degrees of freedom`, 19, df, df, DV.fewIncidents],
      [`20 incidents at the middle of ${df} degrees of freedom`, 20, df, df, DV.poisson]);
  }
  for (const [what, k, chi, df, want] of defined ? cases : []) {
    // Each synthetic case is first what the rule above gives (so a case that
    // names the wrong assessment stops here, not as the app's fault).
    assert.equal(VERDICT(k, chi, df), want, `this qual's own rule gives ${JSON.stringify(VERDICT(k, chi, df))} for ${what}, the case expects ${JSON.stringify(want)}`);
    const got = appVerdict(k, chi, df);
    if (got !== want) problems.dispersion.push(`dispersionVerdict(${k}, ${chi}, ${df}), ${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  assert.ok(!defined || (ruleTested >= 1000 && cases.length >= 60), `the rule was read on ${ruleTested} window-lines of 20 incidents or more and ${cases.length} synthetic cases (expected at least 1,000 and 60)`);
}
assert.ok(thresholdRows >= 12 && thresholdUnknown >= 1,
  `the sweep read ${thresholdRows} Reporting threshold rows holding ${thresholdUnknown} records with no stated movement (expected at least 12 rows and one such record)`);

// A6: a record whose movement goes unstated moves to the cell after "AV
// stopped" and no further. For each code that states no movement (a blank,
// and NHTSA's "Unknown") one record of the first company with both kinds has
// its movement set to it, a moving one and then a stopped one, and the full
// history's table is drawn again: from a moving record the no-movement cell
// rises by one and AV stopped stays; from a stopped one the no-movement cell
// rises by one and AV stopped falls by one; the total stays.
{
  const cellsOf = (html, helmer) => {
    const row = bodyRows(section(html, "sanity-threshold")).find(r => r.cells[0] && r.cells[0].text === helmer);
    return row === undefined || row.cells.length < 4 ? null : { stopped: num(row.cells[2].text.split(" ")[0]), unknown: num(row.cells[3].text.split(" ")[0]), total: num(row.cells[row.cells.length - 1].text) };
  };
  const fullHtml = edit => vm.runInContext(`(() => {
    incidents = ${edit};
    activeSeries = fullMonthSeries;
    buildSanityChecks();
    const out = document.getElementById("sanity-checks").innerHTML;
    incidents = INCIDENT_DATA;
    return out;
  })()`, ctx);
  const helmer = ADS.find(h => inc.some(i => i.helmer === h && STATIONARY.includes(i.svMovement)) && inc.some(i => i.helmer === h && !STATIONARY.includes(i.svMovement) && !NO_MOVEMENT.includes(i.svMovement)));
  assert.ok(helmer !== undefined, "no company has both a stopped and a moving record to test the Reporting threshold table's no-movement cell on");
  const before = cellsOf(fullHtml("INCIDENT_DATA"), helmer);
  for (const code of NO_MOVEMENT) for (const [from, pick, stoppedBy] of [["moving", `!SV_STATIONARY.has(r.svMovement) && r.svMovement !== "" && r.svMovement !== "Unknown"`, 0], ["stopped", "SV_STATIONARY.has(r.svMovement)", -1]]) {
    const after = cellsOf(fullHtml(`(() => { const at = INCIDENT_DATA.findIndex(r => r.helmer === ${JSON.stringify(helmer)} && ${pick}); return INCIDENT_DATA.map((r, j) => j === at ? {...r, svMovement: ${JSON.stringify(code)}} : r); })()`), helmer);
    if (before === null || after === null || after.unknown !== before.unknown + 1 || after.stopped !== before.stopped + stoppedBy || after.total !== before.total)
      problems.avStopped.push(`full history, one ${from} ${helmer} record's movement set to ${JSON.stringify(code)}: [AV stopped, no stated movement, total] ${JSON.stringify(before && [before.stopped, before.unknown, before.total])} -> ${JSON.stringify(after && [after.stopped, after.unknown, after.total])}, want the no-movement cell up by one, AV stopped ${stoppedBy === 0 ? "unchanged" : "down by one"} and the total unchanged`);
  }
}

// #9: the grayed row is styled. Its reason (dispersionFewMonthsNote, which
// the rows checked above carry) is the human's English, committed 2026-10-04
// in b068a10 and pinned to the character until 2026-10-28, when the human
// dropped such pins.
const css = fs.readFileSync("style.css", "utf8");
if (!/tr\.insufficient\s*\{[^}]*opacity:\s*0?\.\d+/.test(css)) problems.dispersion.push("style.css: no tr.insufficient rule with an opacity below 1");

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
  `Replicata: build the sanity section for ${Object.keys(WINDOWS).join(", ")} and compare its Poisson dispersion, VMT sources, Incident coverage, Reporting threshold and count cells with a recompute from INCIDENT_DATA and the VMT rows (each section found by its table's id).
Expectata: (noIncidents) the Passenger presence, Severity breakdown, Reporting threshold and Geography tables carry a header cell per column and one row per ADS helmer, grayed (class insufficient) with one cell giving the reason (NO_INCIDENTS_NOTE) for a helmer with no incidents in the window; (dispersion) one row per ADS helmer: over its own VMT months in the window when it has 3 or more (rates, overall rate, index and the DISPERSION_VERDICT assessment the chi-squared test gives its recount: too few to tell under 20 incidents, else overdispersed when the statistic's upper tail on months - 1 degrees of freedom is under 5%, mildly while its index is under 5, underdispersed when its lower tail is under 5%, else consistent with Poisson), else a grayed row (class insufficient) whose one cell gives the reason (dispersionFewMonthsNote with the month count); crashla.js dispersionVerdict gives that assessment on every slider window's recount and at each threshold; (vmtSources) each rationale prefixed "first – last: " (or "month: "), in month order, its text escaped and each of its links an a element (rationaleMarkup), each rationale's months contiguous in data/vmt.csv; (coverageRows) rows only for helmers with VMT months in the window; (coverageNote) the data-through month in parentheses, "(${dataThroughMonth})", not the cutoff date; (avStopped) Stopped + Parked, the cell after it the count of the records with no stated movement (a blank or "Unknown") and their share of the row's total as the app prints a share (fmtShare), the two and the records of a stated other movement adding up to the total, and a record whose movement goes unstated moving to that cell alone; (separators) counts of 1,000 or more grouped "1,164", and the Waymo cross-check's opening paragraph gives the full-history count, ${inc.filter(i => i.helmer === "Waymo").length.toLocaleString("en-US")}.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: sanity tables over ${Object.keys(WINDOWS).length} windows (${dispersionChecked} dispersion rows recomputed, each assessed by the chi-squared test, as the app's rule is on ${ruleWindows} window-lines of every slider window, ${ruleTested} of them with 20 incidents or more, and at its thresholds) use each helmer's own months, label rationale spans, list coverage only for helmers with months, count Stopped + Parked and, beside them, the ${thresholdUnknown} records with no stated movement in ${thresholdRows} rows, and group thousands`);

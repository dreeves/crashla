// The fatality metric's count is fractional: each fatal crash counts
// 1/(vehicles involved) on the AV's account (Koopman's fractional-death
// method, crashla.js monthSeriesData), so Waymo's card read "Fatality: 0.8
// incidents" beside a severity table counting 2 fatal crashes, with nothing
// on the page saying why (audit 2026-10-04 #1; the human's answer: "Add a
// note"). Spec (decision #1, implemented 2026-10-31):
//  - one note, a single constant in crashla.js, keyed on the metric's own
//    definition: METRIC_DEFS' fatality entry carries it as countNote, and no
//    other metric carries one;
//  - wherever the fatality metric's count prints, the note goes with it: the
//    summary cards' fatality line (its count's tooltip), the MPI-over-time
//    and distribution charts' tooltips when the fatality metric is selected
//    (every ADS mark; a human band prints no count and carries none), and the
//    Sensitivity table's fatality rows (their count's tooltip);
//  - nowhere else: no other metric's count, tooltip or row carries it.
// The note's words are new reader-facing copy, so they start in Latin with a
// to-do recap above them (rule 7) and are the human's to change; they are read
// from the app, not pinned here.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName) { this.tagName = tagName; this._html = ""; this.style = {}; this.children = []; this._attributes = {}; }
  set textContent(v) { this._html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  get textContent() { return this._html; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  setAttribute(n, v) { this._attributes[n] = v; }
  getAttribute(n) { return this._attributes[n] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
}
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map, Set, JSON,
  document: { getElementById: () => new ElementStub("div"), createElement: tag => new ElementStub(tag) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
`, ctx);
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const tipsOf = html => [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => decode(m[1]));
const problems = [];

// --- 1. One note, on the metric's definition ------------------------------
const notes = run("Object.fromEntries(METRIC_DEFS.filter(m => m.countNote !== undefined).map(m => [m.key, m.countNote]))");
const NOTE = notes.fatality;
if (typeof NOTE !== "string" || NOTE.trim() === "") problems.push(`METRIC_DEFS' fatality entry carries no countNote (the metrics with one: ${JSON.stringify(Object.keys(notes))})`);
if (Object.keys(notes).some(k => k !== "fatality")) problems.push(`metrics other than fatality carry a countNote: ${JSON.stringify(notes)}`);
const source = fs.readFileSync("crashla.js", "utf8");
if (typeof NOTE === "string" && NOTE !== "") {
  const copies = source.split(NOTE).length - 1;
  if (copies !== 1) problems.push(`crashla.js holds the note's text ${copies} times; want one constant (no copies)`);
}

if (typeof NOTE === "string" && NOTE.trim() !== "") {
  // The default window, every helmer checked, and a window that ends earlier.
  const months = run("fullMonthSeries.months");
  const windows = [[run("DEFAULT_START_MONTH"), months[months.length - 1]], [months[0], months[months.length - 1]], ["2025-06", "2025-12"]];
  const ADS = run("ADS_SERIES");
  const HUMAN = run("HUMAN_HELMERS");
  const labels = run("Object.fromEntries(ALL_HELMERS.map(h => [h, helmerLabel(h)]))");
  for (const [a, b] of windows) {
    const win = `${a}..${b}`;
    const slice = `sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)})`;
    const rows = run(`windowSummaryRows(${slice}).map(r => ({helmer: r.helmer, has: Object.fromEntries(METRIC_KEYS.map(k => [k, r.mpiEstimates[k] !== null && r.mpiEstimates[k].k !== null])), miles: r.vmtBest > 0}))`);

    // --- 2. The summary cards: the fatality line's count carries it --------
    const cards = vm.runInContext(`renderMpiSummaryCards(${slice})`, ctx);
    for (const piece of cards.split(/(?=<div class="mpi-card(?: [^"]*)?" style=)/).filter(p => p.startsWith('<div class="mpi-card'))) {
      // The card's company and its summary row are read, never assumed
      // (until 2026-11-06 a card without its name, or one naming no company
      // with a row, stopped here on a TypeError naming nothing).
      const nameMatch = /<div class="mpi-card-helmer">([^<]*)<\/div>/.exec(piece);
      assert.ok(nameMatch !== null,
        `Replicata: render the summary cards (renderMpiSummaryCards) for the ${win} window and read each card's company name (its mpi-card-helmer div).
Expectata: one on every card.
Resultata: none on ${JSON.stringify(piece.slice(0, 300))}.`);
      const name = decode(nameMatch[1]);
      const helmer = Object.keys(labels).find(h => labels[h] === name);
      const row = rows.find(r => r.helmer === helmer);
      assert.ok(row !== undefined,
        `Replicata: render the summary cards for the ${win} window and find the summary row (windowSummaryRows) of the company each card names.
Expectata: a row for ${JSON.stringify(name)}, a company label (helmerLabel).
Resultata: none; the labels ${JSON.stringify(labels)}, the rows' companies ${JSON.stringify(rows.map(r => r.helmer))}.`);
      for (const m of piece.matchAll(/<div class="mpi-card-metric[^"]*" data-metric="([^"]+)">\s*<div>([\s\S]*?)<\/div>/g)) {
        const [, key, line] = m;
        const carries = tipsOf(line).includes(NOTE);
        const want = key === "fatality" && row.has.fatality; // an ADS line's count (a human card prints none)
        if (carries !== want) problems.push(`${win} ${helmer} card, ${key} line: ${carries ? "carries" : "lacks"} the note (${JSON.stringify(line.slice(0, 160))})`);
        // The count is what carries it: the tooltip target holds the count's text.
        if (want) {
          const target = /<span([^>]*)>([^<]*)<\/span>/.exec(line);
          if (!target || !decode(target[1]).includes(`data-tip="${NOTE}"`) || !/\d/.test(target[2]) || !/tabindex="0"/.test(target[1]))
            problems.push(`${win} ${helmer} card: the fatality count is not a Tab stop whose tooltip is the note (${JSON.stringify(line.slice(0, 200))})`);
        }
      }
    }

    // --- 3. The MPI-over-time and distribution charts ----------------------
    for (const metric of ["fatality", "all", "atfault", "seriousInjury"]) {
      const charts = run(`(() => { selectedMetricKey = ${JSON.stringify(metric)}; const s = ${slice};
        return {mpi: renderAllHelmersMpiChart(s), dist: renderDistributionChart(s)}; })()`);
      for (const [chart, html] of Object.entries(charts)) {
        const tips = tipsOf(html);
        const named = [...html.matchAll(/data-tip="([^"]*)"[^>]*aria-label="([^"]*)"/g)].map(x => [decode(x[1]), decode(x[2])]);
        for (const [tip, name] of named) {
          const human = HUMAN.some(h => name.startsWith(labels[h] + " · "));
          const want = metric === "fatality" && !human;
          if (tip.includes(NOTE) !== want) problems.push(`${win} ${chart} chart, metric ${metric}: ${tip.includes(NOTE) ? "carries" : "lacks"} the note in ${JSON.stringify(name.slice(0, 80))}`);
        }
        if (metric === "fatality" && !tips.some(t => t.includes(NOTE))) problems.push(`${win} ${chart} chart, fatality: no tooltip carries the note`);
      }
    }

    // --- 4. The Sensitivity table: the fatality rows' counts ---------------
    const stress = vm.runInContext(`renderStressTestTable(${slice})`, ctx);
    // The table, its body and each row's count cell are read, never assumed
    // (until 2026-11-04 a missing table or body read as no rows, which the
    // row count below reported as "0 fatality rows", and a row short of its
    // count cell read as a count without the note).
    const table = /<table[^>]*\bid="sanity-stress"[^>]*>([\s\S]*?)<\/table>/.exec(stress);
    assert.ok(table !== null,
      `Replicata: render the Sensitivity table (renderStressTestTable) for the ${win} window.
Expectata: a table with id sanity-stress, the rows whose count cells this check reads.
Resultata: none in ${JSON.stringify(stress.slice(0, 300))}.`);
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table[1]);
    assert.ok(body !== null,
      `Replicata: render the Sensitivity table (renderStressTestTable) for the ${win} window and read its body.
Expectata: a tbody holding its rows.
Resultata: none in ${JSON.stringify(table[1].slice(0, 300))}.`);
    const bodyRows = [...body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map(x => [...x[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]));
    const fatalityLabel = run("METRIC_BY_KEY.fatality.cardLabel");
    let fatalityRows = 0;
    for (const cells of bodyRows) {
      assert.ok(cells.length >= 3,
        `Replicata: render the Sensitivity table (renderStressTestTable) for the ${win} window and read each row's company, metric and count cells.
Expectata: each row has them, its count the third cell.
Resultata: a row of ${cells.length} cells: ${JSON.stringify(cells)}.`);
      const isFatality = decode(cells[1]) === fatalityLabel;
      fatalityRows += Number(isFatality);
      const carries = tipsOf(cells[2]).includes(NOTE);
      if (carries !== isFatality) problems.push(`${win} Sensitivity table, ${decode(cells[0])} ${decode(cells[1])}: the count cell ${carries ? "carries" : "lacks"} the note (${JSON.stringify(cells[2])})`);
      if (cells.slice(3).some(c => tipsOf(c).includes(NOTE))) problems.push(`${win} Sensitivity table, ${decode(cells[0])} ${decode(cells[1])}: the note sits outside the count cell`);
    }
    const wantRows = rows.filter(r => r.miles && r.has.fatality && ADS.includes(r.helmer)).length;
    if (fatalityRows !== wantRows) problems.push(`${win} Sensitivity table: ${fatalityRows} fatality rows, want ${wantRows}`);
  }
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render the summary cards, the MPI-over-time and distribution charts (fatality, all incidents, at-fault, serious injury+) and the Sensitivity table for the default window, the full history and 2025-06..2025-12, every helmer checked, and read every tooltip.
Expectata: METRIC_DEFS' fatality entry carries a countNote that crashla.js holds once and no other metric carries one; it is the tooltip of every ADS card's fatality count, part of every ADS mark's tooltip on both charts when the fatality metric is selected (and of no human band's, which print no count), and the tooltip of the count in every fatality row of the Sensitivity table; no other line, metric, tooltip or row carries it.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 12).join("\n")}`);
console.log("qual pass: the fatality metric's fractional count carries its one note wherever it prints (cards, both charts' tooltips, the Sensitivity table) and nowhere else");

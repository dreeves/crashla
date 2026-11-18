// The summary cards ("Sources and raw numbers"): what each card line says
// and how it is marked. Added 2026-10-03 for the 2026-10-02 audit findings:
//   #6  the line under Effective VMT was the All-incidents stress verdict,
//       headed by CARD_STRESS_LABEL (it read "Overall:", beside a Waymo card
//       that is robustly safer on 7 of 10 metrics). Since 2026-11-17 a card
//       has no stress line (below);
//   #16 a multiplier resting on zero incidents (k = 0) carries the prior-only
//       marking its stress badge carries (faded, the prior-only tip), not a
//       safer/worse color (Tesla's fatality "0.1x" was solid red);
//   #55 one multiplier format, its color read off the figures shown ("0.0x",
//       "10.0x", and a 0.996 printed "1.0x" in the worse red): since
//       2026-10-31 exactly three significant figures, en-US grouping (decision
//       #2 of the 2026-10-04 audit; two below 10 and whole numbers from 10
//       until then, which printed any deciding edge in [0.995, 1.05) "1.0x");
//   #56 a fault-mass count is the exact sum of its 0.05-grid fault values
//       (Waymo's 93.25 displayed as 93.2, from a float sum of 93.24999...);
//   #67 the cards of unchecked helmers stay rendered but grayed.
// Since 2026-11-17, the human's layout ("Injury: 155 incidents → 1,660,192 MPI
// (6.00x)" over "95% CI: 1,387,848 – 2,010,475 (3.15x – 11.5x)", the
// comparison line "Multipliers are vs. Humans (AV cities)", then "ok, build
// it"): a metric line prints its multiplier in parentheses after the MPI and
// the multiplier's 95% interval in parentheses after the MPI's 95% CI, both
// multiplierInterval's (its median, and its 2.5% and 97.5% quantiles; their
// numbers are multiplier-interval.qual's); the multiplier is colored by that
// interval as printed: safer when its low end is above 1x, worse when its
// high end is below 1x, else uncolored (until then by its value alone, safer
// from 1x up); the card has no stress line (the line's 95% CI over the human
// band's ends, which stays in the sensitivity table, stress-test.qual); the
// Effective VMT's range is a line of its own under it (it sat in parentheses
// beside it); and the section names, before the cards, the human line the
// multipliers divide by.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

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
const ctx = vm.createContext({
  console,
  document: { getElementById: () => new ElementStub("div"), createElement: tag => new ElementStub(tag) },
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
const DEFAULT_START = run("DEFAULT_START_MONTH");
const last = months[months.length - 1];
// [first, last] month of each window the checks sweep: the default window,
// full history, and the audit's Replicata windows.
const WINDOWS = {
  default: [DEFAULT_START, last],
  full: [months[0], last],
  last3: [months[months.length - 3], last],
  last1: [last, last],
  "2025-06..2025-11": ["2025-06", "2025-11"],
  "2024-01..2025-12": ["2024-01", "2025-12"],
  "2021-07..2025-05": ["2021-07", "2025-05"],
};
const cardsHtml = ([a, b]) => vm.runInContext(
  `renderMpiSummaryCards(sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)}))`, ctx);
// Every ADS line's card (ADS_SERIES: each company, and Tesla's no-monitor
// line, since 2026-10-31; until then ADS_HELMERS, so the no-monitor card's
// multipliers and counts went unchecked: audit 2026-10-30, QT-03).
const estimates = ([a, b]) => run(`(() => {
  const rows = monthlySummaryRows(sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)}));
  const out = {};
  for (const row of rows.filter(r => ADS_SERIES.includes(r.helmer) && r.vmtBest > 0)) {
    out[row.helmer] = {};
    for (const m of METRIC_DEFS) {
      const est = row.mpiEstimates[m.key];
      const ref = m.humanMPI && m.humanMPI.HumansAV;
      // null until the app defines multiplierInterval, so the red run reports every check
      out[row.helmer][m.key] = est && ref ? {k: est.k, mult: typeof multiplierInterval === "function" ? multiplierInterval(est, ref) : null} : null;
    }
    out[row.helmer].vmt = {min: fmtWhole(row.vmtMin), best: fmtWhole(row.vmtBest), max: fmtWhole(row.vmtMax)};
  }
  return out;
})()`);

// One card per helmer: its container class, whether it has a stress line, its
// Effective VMT element's lines, and per metric line its incident count text,
// its multiplier span (the one in parentheses after the MPI) and the text of
// its 95% CI line. A count that carries its metric's note (the fatality count,
// since 2026-10-31: fatality-count-note.qual) is its tooltip's span, whose
// text is the count.
function parseCards(html) {
  const cards = {};
  for (const piece of html.split(/(?=<div class="mpi-card(?: [^"]*)?" style=)/).filter(p => p.startsWith('<div class="mpi-card'))) {
    const cls = /^<div class="([^"]*)"/.exec(piece)[1];
    // The card's company name is read, never assumed (until 2026-11-06 a card
    // without one stopped here on a TypeError naming nothing).
    const nameMatch = /<div class="mpi-card-helmer">([^<]*)<\/div>/.exec(piece);
    assert.ok(nameMatch !== null,
      `Replicata: render the summary cards and read each card's company name (its mpi-card-helmer div).
Expectata: one on every card.
Resultata: none on ${JSON.stringify(piece.slice(0, 300))}.`);
    const name = nameMatch[1];
    const stress = piece.includes("mpi-card-stress");
    const vmtBody = (/<div class="mpi-card-vmt"[^>]*>([\s\S]*?)<\/div>/.exec(piece) || [])[1] ?? null;
    const vmtLines = vmtBody === null ? null : vmtBody.split(/<br\s*\/?>/);
    // A metric's two lines (neither holds a div): the first's text before its
    // MPI span, after the label, is the count; the multiplier is the span in
    // parentheses; the second's text, its tags dropped, is the CI line.
    const lines = {};
    const text = html => html.replace(/<[^>]*>/g, "");
    for (const m of piece.matchAll(/<div class="mpi-card-metric[^"]*" data-metric="([^"]+)">\s*<div>([\s\S]*?)<\/div>\s*<div class="mpi-card-ci">([\s\S]*?)<\/div>/g)) {
      const [, key, first, ci] = m;
      const mult = /\(<span class="mpi-card-mult([^"]*)"([^>]*)>([^<]*)((?:<span class="visually-hidden">[^<]*<\/span>)?)<\/span>\)/.exec(first);
      lines[key] = { kText: text(first.split('<span class="mpi-card-mpi">')[0]).replace(/^[^:]*: /, ""),
        multClass: mult ? mult[1] : null, multAttrs: mult ? mult[2] : null, multText: mult ? mult[3] : null, multHidden: mult ? mult[4] : "", ciText: text(ci) };
    }
    cards[name] = { cls, stress, vmtLines, lines };
  }
  return cards;
}

const labels = run("Object.fromEntries(ALL_HELMERS.map(h => [h, helmerLabel(h)]))");
const PRIOR_ONLY_TIP = run("PRIOR_ONLY_TIP");
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => escHtml(s).replace(/"/g, "&quot;");

// The multiplier format (#55, decision #2), spelled out: exactly three
// significant figures (no exponent however small), with thousands
// separators (37,125.4 reads "37,100", 9.996 "10.0").
const shownMult = n => Number(n.toPrecision(3));
const expectMultText = n => shownMult(n).toLocaleString("en-US", { minimumSignificantDigits: 3, maximumSignificantDigits: 3 });

// The exact fault mass of a line's window (#56): fault values sit on the
// 0.05 grid, so their sum is a whole number of twentieths; one decimal, half up.
// A line's incidents are those whose series lists it (a no-monitor incident
// is also Tesla's).
const faultInc = run(`INCIDENT_DATA.map(r => ({series: r.series, month: monthKeyFromIncidentLabel(r.date), frac: r.fault.faultfrac, injury: INJURY_SEVERITIES.has(r.severity)}))`);
function exactFaultText(helmer, [a, b], injuryOnly) {
  let twentieths = 0;
  for (const r of faultInc) {
    if (!r.series.includes(helmer) || r.month < a || r.month > b || (injuryOnly && !r.injury)) continue;
    const t = Math.round(r.frac * 20);
    assert.ok(Math.abs(r.frac * 20 - t) < 1e-9, `fault value ${r.frac} off the 0.05 grid`);
    twentieths += t;
  }
  const tenths = Math.floor((twentieths + 1) / 2); // half up: t/20 to one decimal
  return tenths % 10 === 0 ? (tenths / 10).toLocaleString("en-US") : `${Math.floor(tenths / 10).toLocaleString("en-US")}.${tenths % 10}`;
}

const problems = { stress: [], vmt: [], priorOnly: [], format: [], color: [], faultCount: [], note: [], unchecked: [] };
// The figures of a piece of card markup, as printed (en-US grouping).
const figures = s => s.replace(/<[^>]*>/g, "").match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
for (const [wname, win] of Object.entries(WINDOWS)) {
  const cards = parseCards(cardsHtml(win));
  const ests = estimates(win);
  assert.deepEqual(Object.keys(cards), Object.values(labels), `${wname}: every helmer has a card`);
  // #6, since 2026-11-17: no card has a stress line.
  for (const [name, card] of Object.entries(cards)) if (card.stress) problems.stress.push(`${wname} ${name}: a stress line (mpi-card-stress)`);
  for (const [helmer, byMetric] of Object.entries(ests)) {
    const card = cards[labels[helmer]];
    // The Effective VMT element: its value alone on its first line, and its
    // range (when the band has width) alone on a second.
    const v = byMetric.vmt;
    const wantVmt = v.min === v.best && v.max === v.best ? [[v.best]] : [[v.best], [v.min, v.max]];
    const gotVmt = card.vmtLines === null ? null : card.vmtLines.map(figures);
    if (JSON.stringify(gotVmt) !== JSON.stringify(wantVmt)) problems.vmt.push(`${wname} ${helmer}: lines' figures ${JSON.stringify(gotVmt)}, want ${JSON.stringify(wantVmt)}`);
    for (const [key, e] of Object.entries(byMetric)) {
      if (key === "vmt" || e === null) continue;
      const line = card.lines[key];
      const where = `${wname} ${helmer} ${key}`;
      assert.ok(line && line.multText !== null, `${where}: the card line and its multiplier (in parentheses after the MPI) render`);
      if (e.mult === null) { problems.format.push(`${where}: no multiplierInterval in crashla.js`); continue; }
      if (line.multText !== expectMultText(e.mult.median) + "x") problems.format.push(`${where}: ${JSON.stringify(line.multText)} for a median of ${e.mult.median} (want ${JSON.stringify(expectMultText(e.mult.median) + "x")})`);
      // The 95% CI line ends with the multiplier's interval in parentheses: its two figures.
      const range = /\(([^()]*)\)\s*$/.exec(line.ciText);
      const wantRange = [expectMultText(e.mult.lo), expectMultText(e.mult.hi)];
      if (range === null || JSON.stringify(figures(range[1])) !== JSON.stringify(wantRange)) problems.format.push(`${where}: CI line ${JSON.stringify(line.ciText)}, want the multiplier's interval ${JSON.stringify(wantRange)} in parentheses at its end`);
      if (e.k === 0) {
        // #16
        // Since 2026-10-04 (audit #63) the multiplier is an image named by
        // what it shows and the prior-only tip; it holds no hidden copy.
        if (line.multClass.trim() !== "prior-only" || !line.multAttrs.includes(`data-tip="${escAttr(PRIOR_ONLY_TIP)}"`) ||
            !line.multAttrs.includes('tabindex="0"') || !line.multAttrs.includes('role="img"') ||
            !line.multAttrs.includes(`aria-label="${escAttr(`${line.multText} ${PRIOR_ONLY_TIP}`)}"`) || line.multHidden !== "") {
          problems.priorOnly.push(`${where} (k = 0): class ${JSON.stringify(line.multClass)}, attrs ${JSON.stringify(line.multAttrs.slice(0, 90))}, hidden ${JSON.stringify(line.multHidden.slice(0, 40))}`);
        }
      } else {
        const want = shownMult(e.mult.lo) > 1 ? "safer" : shownMult(e.mult.hi) < 1 ? "worse" : "";
        if (line.multClass.trim() !== want || line.multAttrs.includes("data-tip")) problems.color.push(`${where}: ${JSON.stringify(line.multText)} (interval ${expectMultText(e.mult.lo)}x to ${expectMultText(e.mult.hi)}x) has class ${JSON.stringify(line.multClass.trim())}, want ${JSON.stringify(want)}`);
      }
    }
    // #56: fault-mass counts, the figure that opens the line's count text
    // (until 2026-10-29 read by stripping the words after it).
    for (const [key, injuryOnly] of [["atfault", false], ["atfaultInjury", true]]) {
      if (byMetric[key] === null) continue;
      const want = exactFaultText(helmer, win, injuryOnly);
      const got = card.lines[key].kText.split(" ")[0];
      if (got !== want) problems.faultCount.push(`${wname} ${helmer} ${key}: shows ${JSON.stringify(got)}, exact sum rounds to ${JSON.stringify(want)}`);
    }
  }
}

// #67: unchecked helmers' cards are grayed, not dropped.
const togglesDefault = run("monthHelmerEnabled");
for (const [state, toggles] of [["default", togglesDefault], ["none", Object.fromEntries(Object.keys(togglesDefault).map(h => [h, false]))],
  ["all", Object.fromEntries(Object.keys(togglesDefault).map(h => [h, true]))]]) {
  vm.runInContext(`monthHelmerEnabled = ${JSON.stringify(toggles)};`, ctx);
  const cards = parseCards(cardsHtml(WINDOWS.default));
  for (const [helmer, on] of Object.entries(toggles)) {
    const card = cards[labels[helmer]];
    const grayed = card !== undefined && card.cls.split(" ").includes("unchecked");
    if (card === undefined || grayed === on) problems.unchecked.push(`${state}: ${helmer} (${on ? "checked" : "unchecked"}) card ${card === undefined ? "missing" : `class ${JSON.stringify(card.cls)}`}`);
  }
}
vm.runInContext(`monthHelmerEnabled = ${JSON.stringify(togglesDefault)};`, ctx);
const css = fs.readFileSync("style.css", "utf8");
const graying = /\.mpi-card\.unchecked\s*\{[^}]*opacity:\s*0?\.\d+/.test(css);
if (!graying) problems.unchecked.push("style.css: no .mpi-card.unchecked rule with an opacity below 1");

// The comparison the multipliers make, stated once before the cards: a
// paragraph of the "Sources and raw numbers" section (sec-summary), ahead of
// the cards' container, names the human line they divide by (its label,
// helmerLabel, read from the app). The sentence itself is the human's.
const indexHtml = fs.readFileSync("index.html", "utf8");
const summarySection = /<section[^>]*\bid="sec-summary"[^>]*>([\s\S]*?)<\/section>/.exec(indexHtml);
assert.ok(summarySection !== null && summarySection[1].includes('<div id="mpi-summary-cards"'),
  `Replicata: find index.html's sec-summary section and the cards' container in it.
Expectata: both.
Resultata: section ${summarySection === null ? "missing" : "found, without the cards' container"}.`);
const notesBefore = [...summarySection[1].split('<div id="mpi-summary-cards"')[0].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1].replace(/<[^>]*>/g, ""));
if (!notesBefore.some(t => t.includes(labels.HumansAV))) problems.note.push(`paragraphs before the cards: ${JSON.stringify(notesBefore)}; none names ${JSON.stringify(labels.HumansAV)}`);

const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v.slice(0, 12).concat(v.length > 12 ? [`... ${v.length - 12} more`] : [])]));
assert.deepEqual(failing, {},
  `Replicata: render the summary cards for the default window, full history, the last 3 months, the last month, 2025-06..2025-11, 2024-01..2025-12 and 2021-07..2025-05 (and the default window with the default, no and all helmers checked), and read each card's lines, each metric line's incident count, multiplier and 95% CI line, each card's class, and index.html's sec-summary section.
Expectata: (stress) no card has a stress line; (vmt) the Effective VMT element shows its value alone on one line and its range alone on the next; (priorOnly) a k = 0 multiplier has class prior-only, no safer/worse color, the prior-only tip as data-tip, is a Tab stop, and is an image (role img) named by its text and the tip, with no hidden copy of the tip; (format) every multiplier is multiplierInterval's median and its 95% CI line ends with that interval's two ends in parentheses, each figure exactly three significant figures with en-US grouping; (color) a k > 0 multiplier is "safer" when its interval's low end as printed is above 1, "worse" when its high end as printed is below 1, and uncolored otherwise; (faultCount) the at-fault and at-fault-injury counts are the exact 0.05-grid sums rounded half up to one decimal; (note) a paragraph before the cards names ${JSON.stringify(labels.HumansAV)}, the line the multipliers divide by; (unchecked) every card renders, and exactly the unchecked helmers' cards carry the class unchecked, which style.css grays.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: summary cards over ${Object.keys(WINDOWS).length} windows carry no stress line, show Effective VMT over its range, mark k = 0 multipliers prior-only, print each multiplier and its 95% interval to three significant figures and color it by that interval, show exact fault-mass counts, gray unchecked helmers, and the section names the multipliers' human line`);

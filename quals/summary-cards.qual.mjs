// The summary cards ("Sources and raw numbers"): what each card line says
// and how it is marked. Added 2026-10-03 for the 2026-10-02 audit findings:
//   #6  the line under Effective VMT is the All-incidents stress verdict,
//       headed by CARD_STRESS_LABEL (it read "Overall:", beside a Waymo card
//       that is robustly safer on 7 of 10 metrics; until 2026-10-29 this qual
//       also banned that word);
//   #16 a multiplier resting on zero incidents (k = 0) carries the prior-only
//       marking its stress badge carries (faded, the prior-only tip), not a
//       safer/worse colour (Tesla's fatality "0.1x" was solid red);
//   #55 one multiplier format, its colour read off the value shown ("0.0x",
//       "10.0x", and a 0.996 printed "1.0x" in the worse red): since
//       2026-10-31 exactly three significant figures, en-US grouping (decision
//       #2 of the 2026-10-04 audit; two below 10 and whole numbers from 10
//       until then, which printed any deciding edge in [0.995, 1.05) "1.0x");
//   #56 a fault-mass count is the exact sum of its 0.05-grid fault values
//       (Waymo's 93.25 displayed as 93.2, from a float sum of 93.24999...);
//   #67 the cards of unchecked helmers stay rendered but grayed.
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
      out[row.helmer][m.key] = est && ref ? {k: est.k, mult: est.postMedian / Math.sqrt(ref.lo * ref.hi)} : null;
    }
    const stress = helmerHumanStress(row, "all");
    out[row.helmer].stressAll = {ratioLo: stress.ratioLo, ratioHi: stress.ratioHi};
  }
  return out;
})()`);

// One card per helmer: its container class, the stress line, and per metric
// line its incident count text and multiplier span. A count that carries its
// metric's note (the fatality count, since 2026-10-31: fatality-count-note
// .qual) is its tooltip's span, whose text is the count.
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
    const stress = (/<div class="mpi-card-stress">([\s\S]*?)<\/div>/.exec(piece) || [])[1] ?? null;
    const lines = {};
    for (const m of piece.matchAll(/<div class="mpi-card-metric[^"]*" data-metric="([^"]+)">\s*<div>[^:]*: (?:<span [^>]*>([^<]*)<\/span>)?([^<]*?)<span class="mpi-card-mpi">[^<]*<\/span>(?:\s*<span class="mpi-card-mult([^"]*)"([^>]*)>([^<]*)((?:<span class="visually-hidden">[^<]*<\/span>)?)<\/span>)?/g)) {
      lines[m[1]] = { kText: (m[2] ?? "") + m[3], multClass: m[4] ?? null, multAttrs: m[5] ?? null, multText: m[6] ?? null, multHidden: m[7] ?? "" };
    }
    cards[name] = { cls, stress, lines };
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

const problems = { label: [], priorOnly: [], format: [], colour: [], faultCount: [], unchecked: [] };
// null until the app defines the label (so the red run reports every check).
const CARD_STRESS_LABEL = run("typeof CARD_STRESS_LABEL === 'undefined' ? null : CARD_STRESS_LABEL");
for (const [wname, win] of Object.entries(WINDOWS)) {
  const cards = parseCards(cardsHtml(win));
  const ests = estimates(win);
  assert.deepEqual(Object.keys(cards), Object.values(labels), `${wname}: every helmer has a card`);
  for (const [helmer, byMetric] of Object.entries(ests)) {
    const card = cards[labels[helmer]];
    // #6: the line is headed CARD_STRESS_LABEL and gives the All-incidents
    // range.
    const r = byMetric.stressAll;
    if (card.stress === null || CARD_STRESS_LABEL === null ||
        !card.stress.startsWith(CARD_STRESS_LABEL + " ") ||
        !card.stress.endsWith(`${expectMultText(r.ratioLo)}x – ${expectMultText(r.ratioHi)}x`)) {
      const shown = card.stress && card.stress.replace(/<span class="visually-hidden">[^<]*<\/span>/g, "").replace(/<[^>]*>/g, "");
      problems.label.push(`${wname} ${helmer}: ${JSON.stringify(shown)} (CARD_STRESS_LABEL ${JSON.stringify(CARD_STRESS_LABEL)}; want the All-incidents range ${expectMultText(r.ratioLo)}x – ${expectMultText(r.ratioHi)}x)`);
    }
    for (const [key, e] of Object.entries(byMetric)) {
      if (key === "stressAll" || e === null) continue;
      const line = card.lines[key];
      const where = `${wname} ${helmer} ${key}`;
      assert.ok(line && line.multText !== null, `${where}: the card line and its multiplier render`);
      if (line.multText !== expectMultText(e.mult) + "x") problems.format.push(`${where}: ${JSON.stringify(line.multText)} for ${e.mult} (want ${JSON.stringify(expectMultText(e.mult) + "x")})`);
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
        const want = shownMult(e.mult) >= 1 ? "safer" : "worse";
        if (line.multClass.trim() !== want || line.multAttrs.includes("data-tip")) problems.colour.push(`${where}: ${JSON.stringify(line.multText)} has class ${JSON.stringify(line.multClass.trim())}, want ${want}`);
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

// The label's words are the human's (CARD_STRESS_LABEL, committed 2026-10-04
// in b068a10) and were pinned to the character here until 2026-10-28, when
// the human dropped such pins (one went red on each of the human's edits and
// caught no agent's; the human reviews every diff). The stress lines above
// must start with CARD_STRESS_LABEL, whatever it reads; its ban on the word
// "Overall:" (audit 2026-10-02: the line is the All-incidents verdict, not an
// overall one) was dropped on 2026-10-29, the line's All-incidents range
// still checked.

const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v.slice(0, 12).concat(v.length > 12 ? [`... ${v.length - 12} more`] : [])]));
assert.deepEqual(failing, {},
  `Replicata: render the summary cards for the default window, full history, the last 3 months, the last month, 2025-06..2025-11, 2024-01..2025-12 and 2021-07..2025-05 (and the default window with the default, no and all helmers checked), and read each card's stress line, each metric line's incident count and multiplier, and each card's class.
Expectata: (label) the stress line is headed CARD_STRESS_LABEL, and shows the All-incidents AV/human ratio range; (priorOnly) a k = 0 multiplier has class prior-only, no safer/worse colour, the prior-only tip as data-tip, is a Tab stop, and is an image (role img) named by its text and the tip, with no hidden copy of the tip; (format) every multiplier reads exactly three significant figures with en-US grouping; (colour) a k > 0 multiplier is "safer" exactly when the value shown is at least 1; (faultCount) the at-fault and at-fault-injury counts are the exact 0.05-grid sums rounded half up to one decimal; (unchecked) every card renders, and exactly the unchecked helmers' cards carry the class unchecked, which style.css grays.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: summary cards over ${Object.keys(WINDOWS).length} windows name the All-incidents verdict, mark k = 0 multipliers prior-only, format multipliers to three significant figures and colour them by the value shown, show exact fault-mass counts, and gray unchecked helmers`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// The combined VMT chart (2026-10-24; human: "can we add a VMT graph that has
// all the selected helmers combined on a single graph?", then "no log scale
// for now. put the combined chart last."). The Vehicle Miles Traveled section
// ends, after the per-company charts, with one chart of every checked line
// (ADS_SERIES: each company, and Tesla's no-monitor line) on one linear axis
// from 0. It follows the date window and the Monthly/Cumulative toggle. Each
// line carries exactly the marks and tips its own chart does; as on the MPI
// and distribution charts, a mark is named by its line's label, " · " and its
// tip, and the figure names no one line. A checked line with no months in
// the window keeps a grayed legend chip; with no line checked the chart still
// draws its empty axes.

// --- Placement -------------------------------------------------------------
const html = fs.readFileSync("index.html", "utf8");
assert.match(html,
  /<section class="collapsible" id="sec-vmt">[\s\S]*?<div id="chart-helmer-series" class="month-helmer-grid"><\/div>\s*<div id="chart-vmt-combined" class="month-chart"><\/div>\s*<\/div>\s*<\/section>/,
  `Replicata: read the Vehicle Miles Traveled section (#sec-vmt) in index.html.
Expectata: its body ends with <div id="chart-vmt-combined" class="month-chart">, right after the per-company charts' box.
Resultata: no such element there.`);

// --- Rendering --------------------------------------------------------------
class ElementStub {
  constructor(tagName) {
    this.tagName = tagName; this.children = []; this.className = ""; this.dataset = {}; this.listeners = {};
    this._innerHTML = ""; this._textContent = ""; this.style = {}; this.value = "0"; this.classList = { toggle() {} };
  }
  // escHtml() relies on textContent assignment escaping into innerHTML
  set textContent(v) { this._textContent = v; this._innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  get textContent() { return this._textContent; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(k, v) { this[k] = v; }
  querySelector() { return new ElementStub("queried"); }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodes = new Map();
const ctx = vm.createContext({
  console, Math, Number, Set, JSON,
  document: {
    getElementById: id => (nodes.has(id) || nodes.set(id, new ElementStub("div")), nodes.get(id)),
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();`, ctx);
const app = JSON.parse(vm.runInContext(`JSON.stringify({
  lines: ADS_SERIES, all: ALL_HELMERS, colors: HELMER_COLORS,
  labels: Object.fromEntries(ALL_HELMERS.map(h => [h, helmerLabel(h)])),
  months: fullMonthSeries.months, defaultStart: DEFAULT_START_MONTH,
})`, ctx));
const last = app.months[app.months.length - 1];

// The combined chart's markup and each line's own chart, in one state.
const render = (checked, cumulative, [first, final]) => JSON.parse(vm.runInContext(`(() => {
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = ${JSON.stringify(checked)}.includes(h);
  vmtCumulative = ${cumulative};
  monthRangeStart = fullMonthSeries.months.indexOf(${JSON.stringify(first)});
  monthRangeEnd = fullMonthSeries.months.indexOf(${JSON.stringify(final)});
  renderWindowedViews();
  return JSON.stringify({
    combined: document.getElementById("chart-vmt-combined").innerHTML,
    own: Object.fromEntries(ADS_SERIES.map(h => [h, renderHelmerMonthlyChart(activeSeries, h)])),
  });
})()`, ctx));

const legend = markup => [...markup.matchAll(/<span class="month-legend-item( month-legend-item-empty)?">\s*<span class="month-chip" style="background:(#[0-9a-f]{6})"><\/span>([^<]*?)\s*<\/span>/gi)]
  .map(m => ({ label: m[3], color: m[2].toLowerCase(), empty: m[1] !== undefined }));
const paths = markup => [...markup.matchAll(/<path class="month-vmt-line" d="([^"]*)" style="stroke:(#[0-9a-f]{6})"><\/path>/gi)]
  .map(m => ({ d: m[1], color: m[2].toLowerCase() }));
const targets = markup => [...markup.matchAll(/<circle [^>]*data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"><\/circle>/g)]
  .map(m => ({ tip: m[1], name: m[2] }));
const figureName = markup => (/<svg class="month-svg"[^>]*aria-label="([^"]*)"/.exec(markup) || [])[1];
const escAttr = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sorted = xs => [...xs].sort();

const DEFAULT_WINDOW = [app.defaultStart, last];
const STATES = [
  ["the default view", ["HumansAV", "Tesla", "Waymo"], false, DEFAULT_WINDOW],
  ["the default view, cumulative", ["HumansAV", "Tesla", "Waymo"], true, DEFAULT_WINDOW],
  ["every line checked", app.all, false, DEFAULT_WINDOW],
  ["every line checked, full history, cumulative", app.all, true, [app.months[0], last]],
  ["Tesla checked in a window before its first month", ["Tesla", "Waymo"], false, ["2021-07", "2021-12"]],
  ["no company checked", ["HumansAV"], false, DEFAULT_WINDOW],
];
const problems = [];
for (const [what, checked, cumulative, window] of STATES) {
  const { combined, own } = render(checked, cumulative, window);
  const lines = app.lines.filter(h => checked.includes(h));
  const label = h => app.labels[h];
  // Lines with no months in the window: their own chart has no marks.
  const emptyLines = lines.filter(h => targets(own[h]).length === 0);

  const gotLegend = legend(combined);
  const wantLegend = lines.map(h => ({ label: label(h), color: app.colors[h].toLowerCase(), empty: emptyLines.includes(h) }));
  if (JSON.stringify(gotLegend) !== JSON.stringify(wantLegend))
    problems.push(`${what}: legend ${JSON.stringify(gotLegend)}, want ${JSON.stringify(wantLegend)}`);

  const gotPaths = paths(combined);
  if (JSON.stringify(gotPaths.map(p => p.color)) !== JSON.stringify(lines.map(h => app.colors[h].toLowerCase())))
    problems.push(`${what}: line colours ${JSON.stringify(gotPaths.map(p => p.color))}, want ${JSON.stringify(lines.map(h => app.colors[h].toLowerCase()))} (one line per checked line, in ADS_SERIES order)`);
  gotPaths.forEach((p, i) => {
    if ((p.d === "") !== emptyLines.includes(lines[i])) problems.push(`${what}: ${lines[i]}'s line has ${p.d === "" ? "no" : "some"} points, its own chart ${emptyLines.includes(lines[i]) ? "none" : "some"}`);
  });

  if (!/<svg class="month-svg"/.test(combined) || !/class="month-axis"/.test(combined))
    problems.push(`${what}: no chart with axes drawn`);
  const wantFigure = cumulative ? "Cumulative VMT" : "Vehicle Miles Traveled (VMT)";
  if (figureName(combined) !== wantFigure) problems.push(`${what}: figure named ${JSON.stringify(figureName(combined))}, want ${JSON.stringify(wantFigure)}`);
  // Linear from 0: the lowest y tick label is "0".
  const yTicks = [...combined.matchAll(/<text class="month-tick" x="[^"]*" y="([^"]*)" text-anchor="end">([^<]*)<\/text>/g)]
    .map(m => ({ y: Number(m[1]), label: m[2] })).sort((a, b) => b.y - a.y);
  if (yTicks.length === 0 || yTicks[0].label !== "0") problems.push(`${what}: lowest y tick ${JSON.stringify(yTicks[0])}, want "0"`);

  // Each mark named "<its line's label> · <its tip>", and each line's tips
  // exactly its own chart's.
  const marks = targets(combined);
  const byLine = Object.fromEntries(lines.map(h => [h, []]));
  for (const t of marks) {
    const owner = lines.find(h => t.name === `${escAttr(label(h))} · ${t.tip}`);
    if (owner === undefined) problems.push(`${what}: a mark named ${JSON.stringify(t.name.slice(0, 60))} for tip ${JSON.stringify(t.tip.slice(0, 40))}, not "<checked line's label> · <tip>"`);
    else byLine[owner].push(t.tip);
  }
  for (const h of lines) {
    const want = sorted(targets(own[h]).map(t => t.tip));
    if (JSON.stringify(sorted(byLine[h])) !== JSON.stringify(want))
      problems.push(`${what}: ${h} has ${byLine[h].length} marks on the combined chart, its own chart ${want.length}, or their tips differ (first combined ${JSON.stringify(sorted(byLine[h])[0])}, first own ${JSON.stringify(want[0])})`);
  }
}
assert.deepEqual(problems, [],
  `Replicata: for each state (${STATES.map(s => s[0]).join("; ")}), set the checkboxes, the Monthly/Cumulative toggle and the window, run renderWindowedViews() and read #chart-vmt-combined, beside each line's own chart (renderHelmerMonthlyChart).
Expectata: a legend chip per checked line in ADS_SERIES order (grayed for a line with no months in the window), one VMT line per checked line in its colour, axes even with no line checked, the figure named by its axis title, a linear axis from 0, and each line's marks exactly its own chart's, each named "<line label> · <tip>".
Resultata: ${problems.length} problems:
${problems.slice(0, 12).join("\n")}`);

console.log(`qual pass: the combined VMT chart closes the VMT section with every checked line on one linear axis, each with its own chart's marks, in ${STATES.length} states`);

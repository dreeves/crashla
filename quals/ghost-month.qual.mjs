import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

// Ghost months (2026-10-26; human: "could we get ghosty estimates of October
// (in general, whatever the current month is) VMT on the VMT graphs?
// carefully research what the error bars should be"). A ghost month is a
// month after NHTSA's data-through month for which data/vmt.csv holds rows:
// the month in progress, or a finished month no NHTSA release has reached.
// slurp.py writes those rows verbatim to a second segment of data/vmt.js
// (GHOST_VMT_CSV_TEXT), which only the VMT charts and the VMT sources table
// read (the table since 2026-10-27). When the date window
// ends at the newest NHTSA month, each VMT chart (a company's own and the
// combined one) continues into the ghost months, drawn faded (class
// month-ghost on the dot, the error bar and a dashed stretch of the line), in
// both the Monthly and Cumulative views, each ghost dot's tooltip giving the
// month's miles, its range and a note in place of an incident count. No rate,
// card, slider month or other chart sees a ghost month. slurp.py stops when
// the month after the data-through month has no rows (so every release
// brings the next month's estimate), when a ghost month lacks a line's row,
// and on a row for a month that has not begun (a forecast, not miles driven).
// In the same windows the sanity section's VMT sources table lists each ghost
// row's rationale after its line's analysis months, headed by its month and
// the ghost tooltip's note (rule 9: shown and marked, not left out); the note
// is the human's English, so it sits outside the table's AI-text colour.

const problems = [];

// --- 1. The data: the master's ghost-month rows, verbatim, and only there --
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const vmtJs = fs.readFileSync("data/vmt.js", "utf8");
const incJs = fs.readFileSync("data/incidents.js", "utf8");
const segment = (start, end) => {
  const a = vmtJs.indexOf(start), b = vmtJs.indexOf(end);
  assert.ok(a >= 0 && b > a,
    `Replicata: find the ${start} ... ${end} segment in data/vmt.js.
Expectata: present, as slurp.py writes it.
Resultata: ${a < 0 ? "no start marker" : "no end marker after it"}.`);
  return vmtJs.slice(a + start.length, b).trim().replace(/^`/, "").replace(/`$/, "").trim();
};
const ghostCsv = parseCsv(segment("/* GHOST_VMT_CSV_START */", "/* GHOST_VMT_CSV_END */"));
const analysisCsv = parseCsv(segment("/* VMT_CSV_START */", "/* VMT_CSV_END */"));
const dataThrough = /NHTSA_DATA_THROUGH_DATE_START \*\/\s*"(\d{4}-\d{2})-\d{2}"/.exec(incJs)[1];
const nextMonth = m => {
  const [y, mo] = m.split("-").map(Number);
  return `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}`;
};
// The master's numbers may carry thousands separators; slurp writes plain integers.
const norm = r => [r[0], r[1], ...r.slice(2, 8).map(c => String(Number(c.replace(/,/g, "")))), r[8]];
const wantGhost = master.slice(1).filter(r => r[1] > dataThrough).map(norm);
assert.deepEqual(ghostCsv[0], master[0],
  `Replicata: read the header of data/vmt.js's ghost segment.
Expectata: data/vmt.csv's header (${master[0].join(",")}): the ghost rows are master rows.
Resultata: ${JSON.stringify(ghostCsv[0])}.`);
assert.deepEqual(ghostCsv.slice(1), wantGhost,
  `Replicata: compare data/vmt.js's ghost segment with data/vmt.csv's rows for months after the data-through month ${dataThrough}.
Expectata: the same rows, in the master's order, numbers as plain integers.
Resultata: ${ghostCsv.length - 1} rows, want ${wantGhost.length}; first ${JSON.stringify(ghostCsv[1]?.slice(0, 8))}.`);
const ghostMonths = [...new Set(wantGhost.map(r => r[1]))].sort();
const lines = [...new Set(master.slice(1).map(r => r[0]))].sort();
assert.ok(ghostMonths.length >= 1 && ghostMonths[0] === nextMonth(dataThrough),
  `Replicata: list data/vmt.csv's months after NHTSA's data-through month ${dataThrough}.
Expectata: at least ${nextMonth(dataThrough)}, the month after it (each release brings the next month's estimate).
Resultata: ${JSON.stringify(ghostMonths)}.`);
ghostMonths.forEach((m, i) => {
  if (i > 0 && m !== nextMonth(ghostMonths[i - 1])) problems.push(`ghost months skip from ${ghostMonths[i - 1]} to ${m}`);
  const have = wantGhost.filter(r => r[1] === m).map(r => r[0]).sort();
  if (JSON.stringify(have) !== JSON.stringify(lines)) problems.push(`ghost month ${m} has rows for ${have.join("/")}, want ${lines.join("/")}`);
});
const leaked = analysisCsv.slice(1).filter(r => r[1] > dataThrough).map(r => `${r[0]} ${r[1]}`);
if (leaked.length) problems.push(`data/vmt.js's analysis segment holds ghost-month rows: ${leaked.join(", ")}`);

// --- 2. slurp.py's guards, on synthetic masters -----------------------------
const py = String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('slurp_ghost', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slurp)
master = open('data/vmt.csv').read()
H = 'helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale'
def row(h, m, v): return f'{h},{m},{v},{v},{v},{v},{v},{v},r'
def text(*rows): return '\n'.join([H, *rows]) + '\n'
def stop(raw, last, run):
    try:
        slurp.ghost_vmt_csv(raw, last, run)
    except AssertionError as e:
        return str(e)
    return ''
out = {
    'real': slurp.ghost_vmt_csv(master, slurp.NHTSA_DATA_THROUGH_DATE[:7], '2026-10'),
    'none': stop(text(row('waymo', '2031-01', 5), row('zoox', '2031-01', 5)), '2031-01', '2031-02'),
    'partial': stop(text(row('waymo', '2031-01', 5), row('zoox', '2031-01', 5), row('waymo', '2031-02', 5)), '2031-01', '2031-02'),
    'future': stop(text(row('waymo', '2031-01', 5), row('waymo', '2031-02', 5), row('waymo', '2031-03', 5)), '2031-01', '2031-02'),
    'fine': stop(text(row('waymo', '2031-01', 5), row('zoox', '2031-01', 5), row('waymo', '2031-02', 5), row('zoox', '2031-02', 5)), '2031-01', '2031-02'),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: call slurp.ghost_vmt_csv on the real master and on synthetic ones.
Expectata: it exists and runs.
Resultata: exit ${run.status}; stderr ${run.stderr.slice(-1500)}.`);
const guards = JSON.parse(run.stdout);
if (guards.real !== segment("/* GHOST_VMT_CSV_START */", "/* GHOST_VMT_CSV_END */"))
  problems.push("slurp.ghost_vmt_csv on the real master differs from data/vmt.js's ghost segment");
if (!/2031-02/.test(guards.none)) problems.push(`no rows after the data-through month: slurp ${guards.none ? `stopped with ${JSON.stringify(guards.none.slice(0, 120))}` : "passed"}, want a stop naming 2031-02`);
if (!/zoox/.test(guards.partial)) problems.push(`a ghost month without zoox's row: slurp ${guards.partial ? `stopped with ${JSON.stringify(guards.partial.slice(0, 120))}` : "passed"}, want a stop naming zoox`);
if (!/2031-03/.test(guards.future)) problems.push(`a row for 2031-03 in a 2031-02 run: slurp ${guards.future ? `stopped with ${JSON.stringify(guards.future.slice(0, 120))}` : "passed"}, want a stop naming 2031-03`);
if (guards.fine !== "") problems.push(`a complete ghost month: slurp stopped with ${JSON.stringify(guards.fine.slice(0, 120))}`);

// --- 3. The charts ----------------------------------------------------------
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
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();`, ctx);
const app = JSON.parse(vm.runInContext(`JSON.stringify({
  lines: ADS_SERIES, all: ALL_HELMERS, months: fullMonthSeries.months, defaultStart: DEFAULT_START_MONTH,
  labels: Object.fromEntries(ADS_SERIES.map(h => [h, helmerLabel(h)])),
  note: VMT_GHOST_NOTE, edge: VMT_RANGE_EDGE,
  ghost: ghostVmtRows.map(r => ({helmer: r.helmer, month: r.month, best: r.vmtBest, lo: r.vmtMin, hi: r.vmtMax, cume: r.vmtCume, kmin: r.kyoomMin, kmax: r.kyoomMax, rationale: r.rationale})),
})`, ctx));
const frontier = app.months[app.months.length - 1];
if (frontier !== dataThrough) problems.push(`the slider's months end at ${frontier}, want the data-through month ${dataThrough}`);
if (app.months.some(m => ghostMonths.includes(m))) problems.push(`the slider's months include a ghost month: ${app.months.filter(m => ghostMonths.includes(m))}`);
const wantRows = wantGhost.map(r => `${r[0]}|${r[1]}|${r[2]}|${r[6]}|${r[7]}|${r[3]}|${r[4]}|${r[5]}`).sort();
const gotRows = app.ghost.map(g => `${g.helmer.toLowerCase()}|${g.month}|${g.best}|${g.lo}|${g.hi}|${g.cume}|${g.kmin}|${g.kmax}`).sort();
if (JSON.stringify(gotRows) !== JSON.stringify(wantRows)) problems.push(`parseGhostVmtCsv gives ${gotRows.length} rows that differ from the master's ${wantRows.length} (first ${gotRows[0]} vs ${wantRows[0]})`);

const render = (cumulative, [first, final]) => JSON.parse(vm.runInContext(`(() => {
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
  vmtCumulative = ${cumulative};
  monthRangeStart = fullMonthSeries.months.indexOf(${JSON.stringify(first)});
  monthRangeEnd = fullMonthSeries.months.indexOf(${JSON.stringify(final)});
  renderWindowedViews();
  return JSON.stringify({
    own: Object.fromEntries(ADS_SERIES.map(h => [h, renderHelmerMonthlyChart(activeSeries, h)])),
    combined: document.getElementById("chart-vmt-combined").innerHTML,
    mpi: document.getElementById("chart-mpi-all").innerHTML,
    dist: document.getElementById("chart-distributions").innerHTML,
    cards: document.getElementById("mpi-summary-cards").innerHTML,
  });
})()`, ctx));

const fmt = n => Math.round(n).toLocaleString("en-US");
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const ghostDots = markup => [...markup.matchAll(/<circle class="month-dot month-ghost" cx="([^"]*)" cy="([^"]*)"/g)].map(m => [+m[1], +m[2]]);
const ghostErrs = markup => (markup.match(/<line class="month-err month-ghost"/g) || []).length;
const solidPaths = markup => [...markup.matchAll(/<path class="month-vmt-line" d="([^"]*)"/g)].map(m => m[1]);
const ghostPaths = markup => [...markup.matchAll(/<path class="month-vmt-line month-ghost" d="([^"]*)"/g)].map(m => m[1]);
const points = d => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => [+m[1], +m[2]]);
const tips = markup => [...markup.matchAll(/data-tip="([^"]*)"/g)].map(m => m[1]);
const monthLabels = markup => [...markup.matchAll(/<text class="month-tick" x="[^"]*" y="[^"]*" text-anchor="middle">(\d{4}-\d{2})<\/text>/g)].map(m => m[1]);
const yTop = markup => Math.max(...[...markup.matchAll(/<text class="month-tick" x="[^"]*" y="[^"]*" text-anchor="end">([^<]*)<\/text>/g)]
  .map(m => { const s = m[1]; const k = s.endsWith("M") ? 1e6 : s.endsWith("K") ? 1e3 : 1; return parseFloat(s.replace(/,/g, "")) * k; }));
const DEFAULT_WINDOW = [app.defaultStart, frontier];
const BEFORE = [app.defaultStart, app.months[app.months.length - 2]];
// A tooltip line's figures (numbers, with their thousands separators). The
// tooltips' words around the figures are the human's to change, so a ghost
// month's targets are checked by their lines' figures and the app's labels:
// a range end's tooltip is its month, its miles and its end's label
// (VMT_RANGE_EDGE); the dot's, its month, its miles, its range (low then high)
// and the ghost note (VMT_GHOST_NOTE). Until 2026-10-29 they were pinned
// whole, with the words "miles" and "Range:".
const figures = line => line.match(/\d[\d,]*(?:\.\d+)?/g) || [];
const tipIs = (tip, month, figs, last) => {
  const l = tip.split("\n");
  return l.length === figs.length + 2 && l[0] === month && l[l.length - 1] === last &&
    figs.every((f, i) => JSON.stringify(figures(l[i + 1])) === JSON.stringify(f));
};

for (const cumulative of [false, true]) {
  const view = cumulative ? "Cumulative" : "Monthly";
  const at = render(cumulative, DEFAULT_WINDOW);
  for (const h of app.lines) {
    const rows = app.ghost.filter(g => g.helmer === h).sort((a, b) => (a.month < b.month ? -1 : 1));
    for (const [where, markup] of [[`${h}'s own chart`, at.own[h]], ["the combined chart", at.combined]]) {
      const name = tip => where === "the combined chart" ? `${esc(app.labels[h])} · ${tip}` : tip;
      // Each target: its tip (unescaped) and whether its accessible name is
      // the one this chart gives it.
      const targets = [...markup.matchAll(/data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"/g)]
        .map(m => ({ tip: unesc(m[1]), named: m[2] === name(m[1]) }));
      for (const g of rows) {
        const [best, lo, hi] = cumulative ? [g.cume, g.kmin, g.kmax] : [g.best, g.lo, g.hi];
        const want = [
          [`its low end (${fmt(lo)}, ${app.edge.lo})`, t => tipIs(t, g.month, [[fmt(lo)]], app.edge.lo)],
          [`its high end (${fmt(hi)}, ${app.edge.hi})`, t => tipIs(t, g.month, [[fmt(hi)]], app.edge.hi)],
          [`its dot (${fmt(best)}, range ${fmt(lo)} – ${fmt(hi)}, the ghost note)`, t => tipIs(t, g.month, [[fmt(best)], [fmt(lo), fmt(hi)]], app.note)],
        ];
        for (const [what, is] of want) if (!targets.some(t => t.named && is(t.tip))) problems.push(`${view}, ${where}: no target for ${h} ${g.month}'s ${what}`);
        if (yTop(markup) < hi) problems.push(`${view}, ${where}: y axis tops out at ${yTop(markup)}, under ${h} ${g.month}'s high end ${hi}`);
      }
    }
    const own = at.own[h];
    if (ghostDots(own).length !== rows.length) problems.push(`${view}, ${h}'s own chart: ${ghostDots(own).length} faded dots, want ${rows.length} (one per ghost month)`);
    if (ghostErrs(own) !== 3 * rows.length) problems.push(`${view}, ${h}'s own chart: ${ghostErrs(own)} faded error-bar lines, want ${3 * rows.length}`);
    const solid = solidPaths(own), dashed = ghostPaths(own);
    if (solid.length !== 1 || dashed.length !== 1) problems.push(`${view}, ${h}'s own chart: ${solid.length} solid and ${dashed.length} dashed lines, want one each`);
    else {
      const s = points(solid[0]), d = points(dashed[0]), dots = ghostDots(own);
      if (d.length !== rows.length + 1) problems.push(`${view}, ${h}'s own chart: the dashed stretch has ${d.length} points, want ${rows.length + 1} (the newest NHTSA month's point, then each ghost month's)`);
      else if (JSON.stringify(d[0]) !== JSON.stringify(s[s.length - 1])) problems.push(`${view}, ${h}'s own chart: the dashed stretch starts at ${d[0]}, not at the solid line's last point ${s[s.length - 1]}`);
      else if (JSON.stringify(d.slice(1)) !== JSON.stringify(dots)) problems.push(`${view}, ${h}'s own chart: the dashed stretch runs through ${JSON.stringify(d.slice(1))}, the faded dots sit at ${JSON.stringify(dots)}`);
    }
    const labels = monthLabels(own);
    if (labels[labels.length - 1] !== ghostMonths[ghostMonths.length - 1]) problems.push(`${view}, ${h}'s own chart: last month label ${labels[labels.length - 1]}, want ${ghostMonths[ghostMonths.length - 1]}`);
    if (!own.includes(esc(app.note))) problems.push(`${view}, ${h}'s own chart: no ghost note`);
  }
  if (ghostDots(at.combined).length !== app.ghost.length) problems.push(`${view}, the combined chart: ${ghostDots(at.combined).length} faded dots, want ${app.ghost.length}`);
  for (const [what, markup] of [["the MPI chart", at.mpi], ["the distribution chart", at.dist], ["the summary cards", at.cards]]) {
    const hit = ghostMonths.filter(m => markup.includes(m));
    if (hit.length || markup.includes("month-ghost")) problems.push(`${view}: ${what} mentions ghost month ${hit.join(", ") || "(class month-ghost)"}`);
  }
  // A window that ends before the newest NHTSA month: no ghost month.
  const before = render(cumulative, BEFORE);
  for (const [where, markup] of [...app.lines.map(h => [`${h}'s own chart`, before.own[h]]), ["the combined chart", before.combined]]) {
    if (markup.includes("month-ghost") || markup.includes(esc(app.note)) || ghostMonths.some(m => monthLabels(markup).includes(m)))
      problems.push(`${view}, window ${BEFORE.join("..")}, ${where}: draws a ghost month`);
  }
}

// --- 3b. The VMT sources table ---------------------------------------------
// The window's rows' rationales, per line, in month order; when the window
// ends at the newest NHTSA month, the line's ghost rows follow, each as
// "<month> (<note>): <rationale>" with the note in a vmt-ghost-note span.
// The table is found by its id, sanity-vmt-sources (by its heading's words
// until 2026-10-29).
const sources = window => {
  const html = JSON.parse(vm.runInContext(`(() => {
  monthRangeStart = fullMonthSeries.months.indexOf(${JSON.stringify(window[0])});
  monthRangeEnd = fullMonthSeries.months.indexOf(${JSON.stringify(window[1])});
  renderWindowedViews();
  buildSanityChecks();
  return JSON.stringify(document.getElementById("sanity-checks").innerHTML);
})()`, ctx));
  const table = /<table[^>]*\bid="sanity-vmt-sources"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  assert.ok(table !== null,
    `Replicata: build the sanity section for ${window.join("..")} and find the VMT sources table (id sanity-vmt-sources).
Expectata: present.
Resultata: none.`);
  return table[1];
};
// Table text is escaped as textContent is (crashla.js escHtml): &, < and >,
// not quotes.
const escText = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cellOf = (section, label) => {
  const m = new RegExp(`<tr>\\s*<td>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</td>\\s*<td class="ai-text">([\\s\\S]*?)</td>\\s*</tr>`).exec(section);
  return m ? m[1] : null;
};
{
  const at = sources(DEFAULT_WINDOW);
  for (const h of app.lines) {
    const cell = cellOf(at, escText(app.labels[h]));
    const want = app.ghost.filter(g => g.helmer === h).sort((a, b) => (a.month < b.month ? -1 : 1))
      .map(g => `${g.month} (<span class="vmt-ghost-note">${escText(app.note)}</span>): ${escText(g.rationale)}`);
    if (cell === null) problems.push(`VMT sources, window ${DEFAULT_WINDOW.join("..")}: no row for ${h}`);
    else if (!cell.endsWith(want.join("<br>")) || !cell.slice(0, cell.length - want.join("<br>").length).endsWith("<br>"))
      problems.push(`VMT sources, window ${DEFAULT_WINDOW.join("..")}, ${h}: the cell does not end with its ghost rows' entries after its analysis months' (want ${JSON.stringify(want.join("<br>").slice(0, 120))}...)`);
  }
  const before = sources(BEFORE);
  if (before.includes("vmt-ghost-note") || ghostMonths.some(m => before.includes(`${m} (`) || before.includes(`${m}:`)))
    problems.push(`VMT sources, window ${BEFORE.join("..")}: lists a ghost month`);
}

// --- 4. The faded look ------------------------------------------------------
const css = fs.readFileSync("style.css", "utf8");
const rule = sel => (new RegExp(`(^|\\n)${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css) || [])[2] || "";
const ghostOpacity = /opacity:\s*([\d.]+)/.exec(rule(".month-ghost"));
if (!ghostOpacity || !(+ghostOpacity[1] > 0 && +ghostOpacity[1] < 1)) problems.push(`style.css: .month-ghost sets no opacity between 0 and 1 (${JSON.stringify(rule(".month-ghost"))})`);
if (!/color:\s*var\(--ink\)/.test(rule(".ai-text .vmt-ghost-note"))) problems.push(`style.css: .ai-text .vmt-ghost-note does not set color: var(--ink) (the ghost note is the human's English, not AI text): ${JSON.stringify(rule(".ai-text .vmt-ghost-note"))}`);
if (!/stroke-dasharray:\s*\d/.test(rule(".month-vmt-line.month-ghost"))) problems.push(`style.css: .month-vmt-line.month-ghost sets no stroke-dasharray (${JSON.stringify(rule(".month-vmt-line.month-ghost"))})`);

// --- 5. The page itself loads the ghost months ------------------------------
const server = await serveRepo();
const browser = await ENGINES.chromium.launch();
const page = await openPage(browser, server.url + "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault", { viewport: { width: 1200, height: 900 } });
const live = await page.evaluate(() => ({
  own: document.querySelectorAll("#chart-helmer-series .month-dot.month-ghost").length,
  combined: document.querySelectorAll("#chart-vmt-combined .month-dot.month-ghost").length,
}));
const shownLines = 2; // Tesla and Waymo in this view
if (live.own !== shownLines * ghostMonths.length || live.combined !== shownLines * ghostMonths.length)
  problems.push(`the page (default view, Tesla and Waymo): ${live.own} faded dots in the companies' charts and ${live.combined} in the combined chart, want ${shownLines * ghostMonths.length} each`);
if (page.errors.length) problems.push(`the page threw: ${page.errors.join("; ")}`);
await browser.close();
await server.close();

assert.deepEqual(problems, [],
  `Replicata: compare data/vmt.js's ghost segment with data/vmt.csv; call slurp.ghost_vmt_csv on synthetic masters; render the VMT charts (every line checked, Monthly and Cumulative) for the default window and for one ending a month earlier; read style.css; load the page.
Expectata: the ghost segment holds exactly the master's rows past the data-through month ${dataThrough}, a full set of lines from the month after it, none in the analysis segment; slurp stops on a missing next month, a missing line and a not-yet-begun month; in a window ending at ${dataThrough} each VMT chart continues into ${ghostMonths.join(", ")} with a faded dot, a faded error bar and a dashed stretch of its line, its targets carrying the month's miles, range and note, and the VMT sources table lists each ghost row's rationale after its line's analysis months, headed by its month and the note (styled as the human's text); no ghost month in a window ending earlier or in any other view; .month-ghost faded and its line dashed; the page draws them at load.
Resultata: ${problems.length} problems:
${problems.slice(0, 15).join("\n")}`);

console.log(`qual pass: ghost months ${ghostMonths.join(", ")} (after NHTSA's ${dataThrough}) are drawn faded on every VMT chart and listed in the VMT sources table from data/vmt.js's ghost segment, and nowhere else`);

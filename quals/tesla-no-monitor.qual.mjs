import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

// Tesla's no-monitor line (2026-10-23): beside "Tesla" (every operator mode),
// the page plots Tesla's driving with no safety monitor in the vehicle, so a
// software-only number stands next to the all-modes one. Its crashes are the
// in-scope Tesla reports on Tesla's own list of SGO reports "while Robotaxi is
// driving autonomously with no safety monitor in the vehicle"
// (tesla.com/robotaxi/safety, Robotaxi-SGO-Report_10_18_2026.xlsx); its miles
// are Tesla's own no-monitor miles (data/vmt.csv "teslanomonitor" rows, the
// safety page's weekly series by month, the Q3-2026 deck chart the second
// reading). Each incident lists every line it counts toward (`series`).

// Tesla's spreadsheet, as published Oct 20, 2026 (32 reports, May 23 to Oct 18).
const SHEET = ["13781-15399", "13781-15400", "13781-15395", "13781-15342", "13781-15809", "13781-15808",
  "13781-16255", "13781-16294", "13781-16256", "13781-16679", "13781-16678", "13781-16677", "13781-16676",
  "13781-16675", "13781-16674", "13781-16673", "13781-17193", "13781-16671", "13781-17191", "13781-17179",
  "13781-17178", "13781-16941", "13781-16733", "13781-17015", "13781-17300", "13781-17301", "13781-17302",
  "13781-17203", "13781-17303", "13781-17299", "13781-17304", "13781-17305"];
// In-scope Tesla reports of 2026 with a monitor aboard: each narrative says so,
// and none is on Tesla's list.
const ABOARD = ["13781-13644", "13781-13645", "13781-13646", "13781-13648", "13781-14630", "13781-14631",
  "13781-15017", "13781-16672"];
// The no-monitor miles by month, safety page then deck (tesla-unsupervised-floor.qual).
const MILES = { "2026-01": [547, 1077], "2026-02": [791, 0], "2026-03": [2966, 3525], "2026-04": [29638, 28202],
  "2026-05": [73616, 75206], "2026-06": [123823, 123384], "2026-07": [246410, 251469],
  "2026-08": [483680, 467685], "2026-09": [971738, 925284] };
// The line's in-scope crashes by month in NHTSA's Oct-15-2026 file.
const MONTHLY = { "2026-05": 2, "2026-06": 3, "2026-07": 3, "2026-08": 6 };

// (1) The pipeline: the reviewed lists, the series table, and the guard.
const py = String.raw`
import sys, json
sys.path.insert(0, 'data')
import slurp
out = {'noMonitor': sorted(slurp.TESLA_NO_MONITOR_REPORTS), 'aboard': sorted(slurp.TESLA_MONITOR_ABOARD_REPORTS),
       'from': slurp.TESLA_NO_MONITOR_FROM, 'company': slurp.SERIES_COMPANY}
out['seriesNoMonitor'] = slurp.incident_series('Tesla', '13781-16671', '2026-08')
out['seriesAboard'] = slurp.incident_series('Tesla', '13781-16672', '2026-08')
out['seriesOld'] = slurp.incident_series('Tesla', '13781-11507', '2025-07')
out['seriesWaymo'] = slurp.incident_series('Waymo', '30270-16196', '2026-08')
def stops(*args):
    try:
        slurp.incident_series(*args)
        return ''
    except AssertionError as e:
        return str(e)
out['unclassified'] = stops('Tesla', '13781-99999', '2026-09')
out['listedTooEarly'] = stops('Tesla', '13781-15399', '2025-12')
# Every line's incident months need that line's VMT row (else the page refuses them).
def raises(fn):
    try:
        fn()
        return ''
    except AssertionError as e:
        return str(e)
out['vmtGap'] = raises(lambda: slurp.check_series_have_vmt(
    [{'series': ['Tesla', 'TeslaNoMonitor'], 'date': 'OCT-2026'}], {('Tesla', '2026-10'): 1.0}))
out['vmtOk'] = raises(lambda: slurp.check_series_have_vmt(
    [{'series': ['Tesla', 'TeslaNoMonitor'], 'date': 'OCT-2026'}], {('Tesla', '2026-10'): 1.0, ('TeslaNoMonitor', '2026-10'): 1.0}))
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0, `Replicata: import data/slurp.py and query its no-monitor tables.
Expectata: python exits 0.
Resultata: ${run.stderr.slice(-1200)}`);
const out = JSON.parse(run.stdout);
assert.deepEqual(out.noMonitor, [...SHEET].sort(),
  `Replicata: read slurp.TESLA_NO_MONITOR_REPORTS.\nExpectata: Tesla's spreadsheet's 32 reports.\nResultata: ${JSON.stringify(out.noMonitor)}.`);
assert.deepEqual(out.aboard, [...ABOARD].sort(),
  `Replicata: read slurp.TESLA_MONITOR_ABOARD_REPORTS.\nExpectata: the 8 in-scope 2026 Tesla reports whose narratives put a monitor aboard.\nResultata: ${JSON.stringify(out.aboard)}.`);
assert.equal(out.from, "2026-01", `Replicata: read slurp.TESLA_NO_MONITOR_FROM.\nExpectata: "2026-01" (no-monitor service began Jan 22, 2026).\nResultata: ${out.from}.`);
assert.deepEqual(out.company, { Waymo: "Waymo", Tesla: "Tesla", Zoox: "Zoox", TeslaNoMonitor: "Tesla" },
  `Replicata: read slurp.SERIES_COMPANY.\nExpectata: each company its own, and TeslaNoMonitor Tesla's.\nResultata: ${JSON.stringify(out.company)}.`);
assert.deepEqual([out.seriesNoMonitor, out.seriesAboard, out.seriesOld, out.seriesWaymo],
  [["Tesla", "TeslaNoMonitor"], ["Tesla"], ["Tesla"], ["Waymo"]],
  `Replicata: call slurp.incident_series for a listed no-monitor Tesla report, a monitor-aboard one, a 2025 one and a Waymo one.
Expectata: [Tesla, TeslaNoMonitor], [Tesla], [Tesla], [Waymo].
Resultata: ${JSON.stringify([out.seriesNoMonitor, out.seriesAboard, out.seriesOld, out.seriesWaymo])}.`);
assert.ok(/TESLA_NO_MONITOR_REPORTS/.test(out.unclassified) && /TESLA_NO_MONITOR_FROM/.test(out.listedTooEarly),
  `Replicata: call slurp.incident_series for an unclassified Tesla report of 2026-09, and for a listed report dated before 2026-01.
Expectata: both stop the run, naming the table to update.
Resultata: ${JSON.stringify([out.unclassified, out.listedTooEarly])}.`);

assert.ok(/TeslaNoMonitor/.test(out.vmtGap) && /2026-10/.test(out.vmtGap) && out.vmtOk === "",
  `Replicata: call slurp.check_series_have_vmt with a TeslaNoMonitor incident of 2026-10 and only Tesla's 2026-10 row, then with both rows.
Expectata: the first stops the run naming ("TeslaNoMonitor", "2026-10"); the second passes.
Resultata: ${JSON.stringify([out.vmtGap, out.vmtOk])}.`);

// (2) incidents.js: every record's lines; the no-monitor line holds exactly the
// listed in-scope Tesla reports.
const text = fs.readFileSync("data/incidents.js", "utf8");
const data = JSON.parse(text.slice(text.indexOf("/* INCIDENT_DATA_START */") + 25,
  text.indexOf("/* INCIDENT_DATA_END */")).trim().replace(/;$/, ""));
const badSeries = data.filter(r => !Array.isArray(r.series) || r.series[0] !== r.helmer
  || JSON.stringify(r.series) !== JSON.stringify(r.helmer === "Tesla" && SHEET.includes(r.reportId) ? ["Tesla", "TeslaNoMonitor"] : [r.helmer]));
assert.deepEqual(badSeries.map(r => [r.reportId, r.series]), [],
  `Replicata: read every data/incidents.js record's series.
Expectata: [helmer], plus TeslaNoMonitor for in-scope Tesla reports on Tesla's spreadsheet.
Resultata: ${JSON.stringify(badSeries.slice(0, 5).map(r => [r.reportId, r.series]))}.`);
const tesla2026 = data.filter(r => r.helmer === "Tesla" && r.date.endsWith("2026")).map(r => r.reportId);
const unclassified = tesla2026.filter(rid => !SHEET.includes(rid) && !ABOARD.includes(rid));
assert.deepEqual(unclassified, [], `Replicata: classify every in-scope 2026 Tesla report.\nExpectata: each on Tesla's list or among the monitor-aboard reports.\nResultata: unclassified ${JSON.stringify(unclassified)}.`);

// (3) The line's miles: the safety page's figure, inside a band holding both readings; and Tesla's coverage.
// The rows through NHTSA's data-through month: a later row is a ghost month's
// estimate, which has no complete reading yet (quals/ghost-month.qual.mjs;
// its floor, the partial reading, in quals/tesla-unsupervised-floor.qual.mjs).
// Until 2026-10-26 every teslanomonitor row was checked here.
const dataThrough = /NHTSA_DATA_THROUGH_DATE_START \*\/\s*"(\d{4}-\d{2})/.exec(text)[1];
const vmtCsv = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const rows = vmtCsv.slice(1).filter(p => p[0] === "teslanomonitor" && p[1] <= dataThrough);
const months = rows.map(p => p[1]);
assert.deepEqual(months, Object.keys(MILES), `Replicata: list data/vmt.csv's teslanomonitor months.\nExpectata: ${Object.keys(MILES).join(", ")}.\nResultata: ${months.join(", ")}.`);
// A deck reading under the chart's ~100-mile resolution (February's 0: its
// January and February points sit at one height) says nothing about the month;
// there the lower edge is at most half the page's figure.
const badMiles = rows.filter(p => {
  const [page, deck] = MILES[p[1]];
  const lower = deck >= 100 ? Math.min(page, deck) : page / 2;
  return +p[2] !== page || +p[6] > lower || +p[7] < Math.max(page, deck) || +p[6] <= 0;
});
assert.deepEqual(badMiles.map(p => p.slice(0, 8)), [],
  `Replicata: compare data/vmt.csv's teslanomonitor rows with Tesla's two no-monitor readings.
Expectata: vmt = the safety page's figure; a positive lower edge at or below the lower reading (half the page's figure where the deck reads under its resolution); an upper edge at or above the higher.
Resultata: ${JSON.stringify(badMiles.map(p => p.slice(0, 8)))}.`);
const vmtJs = fs.readFileSync("data/vmt.js", "utf8");
const jsRows = parseCsv(vmtJs.slice(vmtJs.indexOf("/* VMT_CSV_START */") + 19, vmtJs.indexOf("/* VMT_CSV_END */")).replace(/^`|`$/g, "").trim());
const cov = (h, m) => jsRows.find(p => p[0] === h && p[1] === m)?.slice(8, 14).join(",");
const covDiff = Object.keys(MILES).filter(m => cov("teslanomonitor", m) !== cov("tesla", m));
assert.deepEqual(covDiff, [], `Replicata: compare data/vmt.js coverage columns of teslanomonitor and tesla month by month.
Expectata: identical (the line inherits Tesla's receipt and incident coverage).
Resultata: differing months ${JSON.stringify(covDiff)}.`);

// (4) The app: the line beside Tesla, off by default, with the listed crashes and Tesla's no-monitor miles.
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const app = JSON.parse(vm.runInContext(`
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  incidents = INCIDENT_DATA;
  const s = monthSeriesData();
  JSON.stringify({
    all: ALL_HELMERS, enabled: monthHelmerEnabled.TeslaNoMonitor,
    months: s.points.filter(p => p.helmers.TeslaNoMonitor).map(p => [p.month, p.helmers.TeslaNoMonitor.incidents.total, p.helmers.TeslaNoMonitor.vmtMonthBest]),
  });`, ctx));
assert.ok(app.all.indexOf("TeslaNoMonitor") === app.all.indexOf("Tesla") + 1 && app.enabled === false,
  `Replicata: read ALL_HELMERS and the default toggles.\nExpectata: TeslaNoMonitor right after Tesla, off by default.\nResultata: ${JSON.stringify(app.all)}, enabled=${app.enabled}.`);
const wantMonths = Object.keys(MILES).map(m => [m, MONTHLY[m] ?? 0, MILES[m][0]]);
assert.deepEqual(app.months, wantMonths,
  `Replicata: build monthSeriesData() and read the TeslaNoMonitor line month by month.
Expectata: ${JSON.stringify(wantMonths)} ([month, crashes, miles]).
Resultata: ${JSON.stringify(app.months)}.`);

// (5) Readers see the line's label, never its internal key: every chart,
// card, legend and sanity table, with every line checked, shows no
// "TeslaNoMonitor" in its text or in a mark's tip or accessible name. (The
// sensitivity tables and the VMT chart's figure name printed the key, which
// equals the label for each company, until 2026-10-24.)
class ElementStub {
  constructor(tagName) {
    this.tagName = tagName; this.children = []; this.className = ""; this.dataset = {}; this.listeners = {};
    this._innerHTML = ""; this._textContent = ""; this.style = {}; this.value = "0"; this.classList = { toggle() {} };
  }
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
const viewCtx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object,
  document: {
    getElementById: id => (nodes.has(id) || nodes.set(id, new ElementStub("div")), nodes.get(id)),
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, viewCtx, { filename: "data.js" });
vm.runInContext(appScript, viewCtx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
  buildMonthlyViews();
  buildSanityChecks();`, viewCtx);
const leaks = [];
for (const [id, node] of nodes) {
  const html = node.innerHTML;
  const text = html.replace(/<[^>]*>/g, " ");
  const named = [...html.matchAll(/(?:aria-label|data-tip|title)="([^"]*)"/g)].map(m => m[1]);
  for (const t of [text, ...named]) {
    const at = t.indexOf("TeslaNoMonitor");
    if (at >= 0) leaks.push(`#${id}: ...${t.slice(Math.max(0, at - 40), at + 30).replace(/\s+/g, " ")}...`);
  }
}
assert.deepEqual(leaks.slice(0, 6), [],
  `Replicata: check every line, build the monthly views and the sanity section, and search each rendered container's text, tips and accessible names.
Expectata: no "TeslaNoMonitor" (the line reads as its label, ${JSON.stringify(vm.runInContext("helmerLabel('TeslaNoMonitor')", viewCtx))}).
Resultata: ${leaks.length} occurrences, e.g. ${JSON.stringify(leaks.slice(0, 6))}.`);

console.log(`qual pass: Tesla's no-monitor line holds Tesla's ${Object.values(MONTHLY).reduce((a, b) => a + b, 0)} listed in-scope crashes over its own no-monitor miles, inherits Tesla's coverage, and sits off by default beside Tesla`);

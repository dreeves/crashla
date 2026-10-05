// What a helmer checkbox or the metric select redraws (audit 2026-10-04 #24).
// Until 2026-10-05 either change ran the whole build (buildMonthlyViews): the
// month series, the date slider, the sanity section and the incident browser,
// none of which depends on the checked helmers or the metric. A click took
// 0.5-0.8 s (2.3 s on a phone-class CPU) and collapsed every expanded
// narrative. Spec, in a DOM stub:
//  - the sanity section, the incident browser, the date slider and the month
//    series are independent of the selection: a full rebuild after any helmer
//    change or any metric draws them identically;
//  - a checkbox change or a metric change redraws the legends, the charts,
//    the cards and the headings, and writes the URL once, building none of
//    the month series, the slider, the sanity section or the incident browser;
//  - what it draws is what a full rebuild draws for the new selection.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    Object.assign(this, { tagName, id, children: [], parentNode: null, className: "", dataset: {}, listeners: {}, style: {},
      value: "0", checked: false, _textContent: "", _innerHTML: "", _attributes: {}, classList: { toggle() {} } });
  }
  set textContent(v) { this._textContent = String(v); }
  get textContent() { return this._textContent; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  replaceChildren(...n) { for (const c of n) c.parentNode = this; this.children = [...n]; }
  addEventListener(t, fn) { this.listeners[t] = [...(this.listeners[t] || []), fn]; }
  setAttribute(n, v) { this._attributes[n] = v; }
  getAttribute(n) { return this._attributes[n] ?? null; }
  focus() {}
  querySelector() { return { addEventListener() {}, classList: { toggle() {} } }; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodeById = new Map();
const ctx = vm.createContext({
  console, Math, Number, URLSearchParams,
  __writes: [],
  document: {
    getElementById: id => { if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id)); return nodeById.get(id); },
    createElement: tag => new ElementStub(tag), body: new ElementStub("body"),
    activeElement: new ElementStub("body"), addEventListener() {},
  },
  window: { innerWidth: 1024, innerHeight: 768, location: { search: "", pathname: "/crashla", hash: "" },
    history: { replaceState: (s, t, url) => ctx.__writes.push(url) } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = src => JSON.parse(JSON.stringify(vm.runInContext(src, ctx)));

vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  // The stub's elements outlive a render, so a rebuild drops the listeners
  // the last one attached (a browser's re-render makes new elements).
  var rebuild = () => {
    for (const id of [...ALL_HELMERS.map(monthHelmerToggleId), "month-metric-select", "date-range-min", "date-range-max", "date-range-fill"])
      document.getElementById(id).listeners = {};
    buildMonthlyViews();
  };
  var el = id => document.getElementById(id);
  // The views that do not depend on the selection, and those that do.
  var fixedViews = () => ({
    sanity: el("sanity-checks").innerHTML,
    heading: el("incident-browser-heading").textContent,
    filters: el("filters").children.map(b => b.textContent),
    head: el("incidents-head").children.map(tr => tr.children.map(th => th.children.map(b => b.textContent).join(""))),
    rows: el("incidents-body").children.map(tr => tr.innerHTML),
    slider: el("date-range-controls").innerHTML,
  });
  var selectionViews = () => ({
    helmerLegend: el("month-legend-mpi-helmers").innerHTML,
    metricLegend: el("month-legend-mpi-lines").innerHTML,
    fanLegend: el("month-legend-ci-fan").innerHTML,
    mpi: el("chart-mpi-all").innerHTML,
    dist: el("chart-distributions").innerHTML,
    cards: el("mpi-summary-cards").innerHTML,
    vmt: el("chart-helmer-series").innerHTML,
    headings: [el("mpi-heading").textContent, el("dist-heading").textContent],
  });
  rebuild();
`, ctx);

// --- Independence: whatever is selected, a full rebuild draws the same
// sanity section, incident browser and slider from the same month series ---
const independence = run(`(() => {
  const base = JSON.stringify(fixedViews());
  const baseSeries = JSON.stringify(fullMonthSeries);
  const savedEnabled = {...monthHelmerEnabled}, savedMetric = selectedMetricKey;
  const changed = [];
  for (const helmer of ALL_HELMERS) {
    monthHelmerEnabled[helmer] = !monthHelmerEnabled[helmer];
    rebuild();
    if (JSON.stringify(fixedViews()) !== base) changed.push("helmer " + helmer);
    if (JSON.stringify(fullMonthSeries) !== baseSeries) changed.push("series after helmer " + helmer);
    monthHelmerEnabled[helmer] = !monthHelmerEnabled[helmer];
  }
  for (const m of METRIC_KEYS) {
    selectedMetricKey = m;
    rebuild();
    if (JSON.stringify(fixedViews()) !== base) changed.push("metric " + m);
    if (JSON.stringify(fullMonthSeries) !== baseSeries) changed.push("series after metric " + m);
  }
  monthHelmerEnabled = savedEnabled; selectedMetricKey = savedMetric;
  rebuild();
  return {helmers: ALL_HELMERS.length, metrics: METRIC_KEYS.length, changed};
})()`);
assert.ok(independence.changed.length === 0,
  `Replicata: for each of the ${independence.helmers} helmers (its checkbox flipped) and each of the ${independence.metrics} metrics, rebuild every view and compare the sanity section, the incident browser (heading, filters, sort headers, rows), the date slider and the month series with the default view's.
Expectata: none of them changes: they do not depend on the selection.
Resultata: changed after ${JSON.stringify(independence.changed)}.`);

// --- The checkbox and the select redraw only what depends on them ----------
const NAMES = { monthSeriesData: "series", renderDateRangeControls: "slider", buildSanityChecks: "sanity",
  buildBrowser: "browser", renderWindowedViews: "draw", renderMonthlyLegends: "legends" };
const steps = run(`(() => {
  const counts = {};
  const orig = {};
  const wrapAll = () => {
    for (const [name, key] of Object.entries(${JSON.stringify(NAMES)})) {
      orig[name] = globalThis[name];
      globalThis[name] = function () { counts[key]++; return orig[name].apply(this, arguments); };
    }
  };
  const unwrapAll = () => { for (const [name, f] of Object.entries(orig)) globalThis[name] = f; };
  const fire = (id, type) => { for (const fn of el(id).listeners[type] || []) fn({target: el(id)}); };
  const out = [];
  const step = (what, act) => {
    for (const key of Object.values(${JSON.stringify(NAMES)})) counts[key] = 0;
    const writesBefore = __writes.length;
    wrapAll();
    act();
    unwrapAll();
    const got = {fixed: fixedViews(), selection: selectionViews(), url: __writes[__writes.length - 1]};
    const writes = __writes.length - writesBefore;
    const made = {...counts};
    rebuild(); // the same state, from scratch
    const want = {fixed: fixedViews(), selection: selectionViews(), url: __writes[__writes.length - 1]};
    out.push({what, counts: made, writes,
      differ: [...Object.keys(want.selection).filter(k => JSON.stringify(got.selection[k]) !== JSON.stringify(want.selection[k])),
        ...Object.keys(want.fixed).filter(k => JSON.stringify(got.fixed[k]) !== JSON.stringify(want.fixed[k])),
        ...(got.url === want.url ? [] : ["url"])]});
  };
  for (const helmer of ["Zoox", "HumansUS", "Waymo"]) {
    step("checkbox " + helmer, () => {
      el(monthHelmerToggleId(helmer)).checked = !monthHelmerEnabled[helmer];
      fire(monthHelmerToggleId(helmer), "change");
    });
  }
  for (const m of ["injury", "fatality", "all"]) {
    step("metric " + m, () => {
      el("month-metric-select").value = m;
      fire("month-metric-select", "change");
    });
  }
  return out;
})()`);
const want = { series: 0, slider: 0, sanity: 0, browser: 0, draw: 1, legends: 1 };
const bad = steps.filter(s => JSON.stringify(s.counts) !== JSON.stringify(want) || s.writes !== 1 || s.differ.length > 0);
assert.ok(bad.length === 0,
  `Replicata: on the default view, check and uncheck Zoox, Humans (US average) and Waymo by their checkboxes, then pick the injury, fatality and all-incidents metrics in the select; after each, rebuild every view from scratch and compare.
Expectata: each change redraws the legends once and the charts, cards and headings once (renderWindowedViews), writes the URL once, and builds none of the month series, the date slider, the sanity section or the incident browser (${JSON.stringify(want)}); what it leaves is what the full rebuild draws.
Resultata: ${JSON.stringify(bad.length > 0 ? bad : steps)}.`);

console.log("qual pass: a helmer or metric change redraws the legends, charts and cards only, and leaves what a full rebuild draws");

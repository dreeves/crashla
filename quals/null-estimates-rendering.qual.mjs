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
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }

  set textContent(v) {
    this._textContent = String(v);
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

  querySelector() {
    return new ElementStub("queried");
  }

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
  URLSearchParams,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
    body: new ElementStub("body"),
    addEventListener() {},
  },
  window: {
    innerWidth: 1024,
    innerHeight: 768,
    location: {search: "", pathname: "/crashla"},
    history: {replaceState() {}},
  },
});

vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// When fault data is incomplete for some months, needsFault metrics produce
// null mpiEstimates.  All rendering functions must handle this gracefully:
// stress test table skips null rows, distribution chart skips null curves,
// per-driver chart omits null metrics from hover text.
const checks = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const series = monthSeriesData();

  const needsFaultKeys = METRIC_DEFS.filter(m => m.needsFault).map(m => m.key);

  // Verify mpiEstimates: every metric key must be present (null or object, never undefined)
  const summary = monthlySummaryRows(series);
  const allKeysPresent = summary.every(row =>
    METRIC_DEFS.every(m => m.key in row.mpiEstimates));
  const noUndefinedValues = summary.every(row =>
    METRIC_DEFS.every(m => row.mpiEstimates[m.key] !== undefined));

  // Slice to a Waymo month with incomplete fault judgments to force null mpiEstimates
  const incompletePoint = series.points.find(p => {
    const row = p.drivers.Waymo;
    return row !== null && row.vmtBest > 0 &&
      needsFaultKeys.some(k => row.mpiByMetric[k] === null);
  });
  const incompleteMonth = incompletePoint.month;
  const faultIdx = series.months.indexOf(incompleteMonth);
  const faultSlice = sliceSeries(series, faultIdx, faultIdx);
  const sliceSummary = monthlySummaryRows(faultSlice);
  const waymoSlice = sliceSummary.find(r => r.driver === "Waymo");
  const sliceNullCount = needsFaultKeys.filter(k => waymoSlice.mpiEstimates[k] === null).length;

  // Render all views on the fault-incomplete slice — must not crash
  const stressHtml = renderStressTestTable(faultSlice);
  const stressDataRows = (stressHtml.match(/<tr>/g) || []).length - 1; // minus header
  const distHtml = renderDistributionChart(faultSlice);
  const distHasSvg = distHtml.includes("<svg");
  const cardsHtml = renderMpiSummaryCards(faultSlice);
  const cardsHasContent = cardsHtml.includes("mpi-card");

  // Count theoretical max stress rows for this slice
  const adsRows = sliceSummary.filter(r => r.vmtBest > 0);
  const maxStressRows = adsRows.length * METRIC_DEFS.filter(m => m.humanMPI).length;

  return {
    needsFaultKeys,
    allKeysPresent,
    noUndefinedValues,
    incompleteMonth,
    sliceNullCount,
    waymoVmt: waymoSlice.vmtBest,
    stressDataRows,
    maxStressRows,
    distHasSvg,
    cardsHasContent,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(checks));

assert.ok(
  plain.allKeysPresent && plain.noUndefinedValues,
  `Replicata: inspect mpiEstimates for every driver and metric in the full-series summary.
Expectata: every metric key is present (null or object, never undefined).
Resultata: allKeysPresent=${plain.allKeysPresent}, noUndefinedValues=${plain.noUndefinedValues}.`,
);

assert.ok(
  plain.waymoVmt > 0 && plain.sliceNullCount === plain.needsFaultKeys.length,
  `Replicata: slice to the Waymo fault-incomplete month ${plain.incompleteMonth} and compute the Waymo summary.
Expectata: Waymo has VMT but all needsFault metrics have null mpiEstimates.
Resultata: vmtBest=${plain.waymoVmt}, nullFaultMetrics=${plain.sliceNullCount}/${plain.needsFaultKeys.length}.`,
);

assert.ok(
  plain.stressDataRows < plain.maxStressRows,
  `Replicata: render the stress test table from a fault-incomplete slice.
Expectata: null mpiEstimates produce fewer rows than the theoretical max (${plain.maxStressRows}).
Resultata: dataRows=${plain.stressDataRows}, max=${plain.maxStressRows}.`,
);

assert.ok(
  plain.distHasSvg,
  `Replicata: render the distribution chart from a fault-incomplete slice.
Expectata: chart renders an SVG without crashing on null mpiEstimates.
Resultata: SVG present=${plain.distHasSvg}.`,
);

assert.ok(
  plain.cardsHasContent,
  `Replicata: render summary cards from a fault-incomplete slice.
Expectata: cards render without crashing on null mpiEstimates.
Resultata: cards present=${plain.cardsHasContent}.`,
);

console.log("qual pass: null mpiEstimates from incomplete fault data render safely");

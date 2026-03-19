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

// monthlySummaryRows uses per-driver filtering (drivers[driver] !== null),
// NOT the cross-driver incidentObservable flag.  This means Waymo's summary
// includes pre-window months where only Waymo has VMT, while Tesla/Zoox
// correctly show zero for those months.
const checks = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const series = monthSeriesData();

  // Find a pre-window month where Waymo has data but Tesla/Zoox don't
  const preWindowMonth = series.points.find(p =>
    p.drivers.Waymo !== null && p.drivers.Tesla === null);

  // Compute summary from the full series
  const summary = Object.fromEntries(
    monthlySummaryRows(series).map(r => [r.driver, r]));

  // Compute summary from a Waymo-only slice (pre-window months)
  const startIdx = 0;
  const defIdx = series.months.indexOf(DEFAULT_START_MONTH);
  const preSlice = sliceSeries(series, startIdx, defIdx - 1);
  const preSummary = Object.fromEntries(
    monthlySummaryRows(preSlice).map(r => [r.driver, r]));

  // Count months where each driver has data in the full series
  const waymoMonths = series.points.filter(p => p.drivers.Waymo !== null).length;
  const teslaMonths = series.points.filter(p => p.drivers.Tesla !== null).length;
  const obsMonths = series.points.filter(p => p.incidentObservable).length;

  return {
    hasPreWindowMonth: preWindowMonth !== undefined,
    waymoMonths, teslaMonths, obsMonths,
    fullWaymoVmt: summary.Waymo.vmtBest,
    fullTeslaVmt: summary.Tesla.vmtBest,
    preWaymoVmt: preSummary.Waymo.vmtBest,
    preTeslaVmt: preSummary.Tesla.vmtBest,
    preWaymoInc: preSummary.Waymo.incTotal,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(checks));

assert.ok(
  plain.hasPreWindowMonth,
  `Replicata: inspect the full month series for pre-window Waymo-only months.
Expectata: at least one month exists where Waymo has data but Tesla does not.
Resultata: no such month found.`,
);

assert.ok(
  plain.waymoMonths > plain.obsMonths,
  `Replicata: compare Waymo's month count against the incidentObservable month count.
Expectata: Waymo has data in more months than the cross-driver observable window (${plain.obsMonths}).
Resultata: Waymo months=${plain.waymoMonths}, observable months=${plain.obsMonths}.`,
);

assert.ok(
  plain.preWaymoVmt > 0 && plain.preWaymoInc > 0,
  `Replicata: compute Waymo's summary for a pre-window slice (before DEFAULT_START_MONTH).
Expectata: Waymo has positive VMT and incidents because monthlySummaryRows uses per-driver filtering.
Resultata: vmtBest=${plain.preWaymoVmt}, incTotal=${plain.preWaymoInc}.`,
);

assert.ok(
  plain.preTeslaVmt === 0,
  `Replicata: compute Tesla's summary for a pre-window slice (before DEFAULT_START_MONTH).
Expectata: Tesla has zero VMT because it has no data in those months.
Resultata: vmtBest=${plain.preTeslaVmt}.`,
);

console.log("qual pass: monthlySummaryRows uses per-driver filtering not incidentObservable");

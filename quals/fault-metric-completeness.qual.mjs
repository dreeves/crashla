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

const checks = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  buildMonthlyViews();
  const janWaymo = activeSeries.points.find(p => p.month === "2026-01").drivers.Waymo;
  const febWaymo = activeSeries.points.find(p => p.month === "2026-02").drivers.Waymo;
  const fullWaymo = monthlySummaryRows(activeSeries).find(r => r.driver === "Waymo");
  const startIdx = defaultStartMonthIndex(fullMonthSeries.months);
  const decIdx = fullMonthSeries.months.indexOf("2025-12");
  const trimmedWaymo = monthlySummaryRows(
    sliceSeries(fullMonthSeries, startIdx, decIdx),
  ).find(r => r.driver === "Waymo");
  return {
    janAtfaultNull: janWaymo.mpiByMetric.atfault === null,
    janAllPresent: janWaymo.mpiByMetric.all !== null,
    febAtfaultNull: febWaymo.mpiByMetric.atfault === null,
    fullIncTotal: fullWaymo.incTotal,
    trimmedIncTotal: trimmedWaymo.incTotal,
    fullIncAtFault: fullWaymo.incAtFault,
    trimmedIncAtFault: trimmedWaymo.incAtFault,
    fullMedian: fullWaymo.mpiEstimates.atfault.median,
    trimmedMedian: trimmedWaymo.mpiEstimates.atfault.median,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(checks));

assert.ok(
  plain.janAtfaultNull && plain.febAtfaultNull && plain.janAllPresent,
  `Replicata: inspect Waymo monthly metric availability in Jan/Feb 2026.
Expectata: raw all-incident MPI remains available, but at-fault MPI is unavailable for months with incomplete fault judgments.
Resultata: ${JSON.stringify(plain)}.`,
);

assert.ok(
  plain.fullIncTotal > plain.trimmedIncTotal,
  `Replicata: compare Waymo all-incident summary counts for the default active range vs the same range truncated at 2025-12.
Expectata: total incidents increase when Jan/Feb 2026 are included.
Resultata: full=${plain.fullIncTotal}, trimmed=${plain.trimmedIncTotal}.`,
);

assert.ok(
  Math.abs(plain.fullIncAtFault - plain.trimmedIncAtFault) < 1e-9 &&
    Math.abs(plain.fullMedian - plain.trimmedMedian) < 1e-9,
  `Replicata: compare Waymo at-fault summary metrics for the default active range vs the same range truncated at 2025-12.
Expectata: incomplete Jan/Feb 2026 months do not change the at-fault totals or MPI estimate.
Resultata: fullAtFault=${plain.fullIncAtFault}, trimmedAtFault=${plain.trimmedIncAtFault}, fullMedian=${plain.fullMedian}, trimmedMedian=${plain.trimmedMedian}.`,
);

console.log("qual pass: fault-weighted metrics exclude months with incomplete fault judgments");

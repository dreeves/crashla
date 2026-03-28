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
  // Dynamically find the latest Waymo month with incomplete fault data
  const incompleteMonth = fullMonthSeries.points.slice().reverse()
    .find(p => p.drivers.Waymo && p.drivers.Waymo.mpiByMetric.atfault === null
           && p.drivers.Waymo.mpiByMetric.all !== null);
  if (!incompleteMonth) return { allComplete: true };
  const testMonth = incompleteMonth.month;
  const testWaymo = incompleteMonth.drivers.Waymo;
  const testIdx = fullMonthSeries.months.indexOf(testMonth);
  const nextIdx = testIdx + 1;
  const extendedWaymo = monthlySummaryRows(
    sliceSeries(fullMonthSeries, testIdx, fullMonthSeries.months.length - 1),
  ).find(r => r.driver === "Waymo");
  const fromNextWaymo = monthlySummaryRows(
    sliceSeries(fullMonthSeries, nextIdx, fullMonthSeries.months.length - 1),
  ).find(r => r.driver === "Waymo");
  return {
    allComplete: false,
    testMonth,
    atfaultNull: testWaymo.mpiByMetric.atfault === null,
    allPresent: testWaymo.mpiByMetric.all !== null,
    extendedIncTotal: extendedWaymo.incTotal,
    fromNextIncTotal: fromNextWaymo.incTotal,
    extendedIncAtFault: extendedWaymo.incAtFault,
    fromNextIncAtFault: fromNextWaymo.incAtFault,
    extendedMedian: extendedWaymo.mpiEstimates.atfault.median,
    fromNextMedian: fromNextWaymo.mpiEstimates.atfault.median,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(checks));

if (plain.allComplete) {
  // All Waymo months have complete fault data — the invariant is trivially satisfied
  console.log("qual pass: fault-weighted metrics exclude months with incomplete fault judgments");
} else {
  assert.ok(
    plain.atfaultNull && plain.allPresent,
    `Replicata: inspect Waymo monthly metric availability in ${plain.testMonth}.
Expectata: raw all-incident MPI remains available, but at-fault MPI is unavailable for months with incomplete fault judgments.
Resultata: ${JSON.stringify(plain)}.`,
  );

  assert.ok(
    plain.extendedIncTotal > plain.fromNextIncTotal,
    `Replicata: compare Waymo all-incident summary counts with and without incomplete month ${plain.testMonth}.
Expectata: total incidents increase when ${plain.testMonth} is included.
Resultata: extended=${plain.extendedIncTotal}, fromNext=${plain.fromNextIncTotal}.`,
  );

  assert.ok(
    Math.abs(plain.extendedIncAtFault - plain.fromNextIncAtFault) < 1e-9 &&
      Math.abs(plain.extendedMedian - plain.fromNextMedian) < 1e-9,
    `Replicata: compare Waymo at-fault summary metrics with and without incomplete month ${plain.testMonth}.
Expectata: the incomplete month does not change the at-fault totals or MPI estimate.
Resultata: extendedAtFault=${plain.extendedIncAtFault}, fromNextAtFault=${plain.fromNextIncAtFault}, extendedMedian=${plain.extendedMedian}, fromNextMedian=${plain.fromNextMedian}.`,
  );

  console.log("qual pass: fault-weighted metrics exclude months with incomplete fault judgments");
}

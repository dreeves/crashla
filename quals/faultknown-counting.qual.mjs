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

// faultKnown tracks how many incidents in a month have non-null atFaultFrac.
// Months where faultKnown === total have complete fault data; needsFault
// metrics are available.  Months where faultKnown < total have incomplete
// data; needsFault metrics are null.
const checks = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const series = monthSeriesData();

  // For each Waymo month, check faultKnown vs total
  const waymoMonths = series.points
    .filter(p => p.drivers.Waymo !== null)
    .map(p => ({
      month: p.month,
      total: p.drivers.Waymo.incidents.total,
      faultKnown: p.drivers.Waymo.incidents.faultKnown,
      atfaultMpi: p.drivers.Waymo.mpiByMetric.atfault,
      allMpi: p.drivers.Waymo.mpiByMetric.all,
    }));

  // Separate into complete and incomplete months
  const complete = waymoMonths.filter(m => m.total > 0 && m.faultKnown === m.total);
  const incomplete = waymoMonths.filter(m => m.total > 0 && m.faultKnown < m.total);

  // Verify invariant: faultKnown <= total always
  const faultKnownValid = waymoMonths.every(m => m.faultKnown <= m.total);
  // Verify invariant: faultKnown >= 0 always
  const faultKnownNonNeg = waymoMonths.every(m => m.faultKnown >= 0);

  // Cross-check: count incidents with non-null fault in the raw data
  const waymoIncidents = INCIDENT_DATA.filter(inc => inc.driver === "Waymo");
  const rawFaultKnown = waymoIncidents.filter(inc => inc.fault !== null).length;
  const rawFaultNull = waymoIncidents.filter(inc => inc.fault === null).length;
  const seriesFaultKnown = waymoMonths.reduce((s, m) => s + m.faultKnown, 0);
  const seriesTotalInc = waymoMonths.reduce((s, m) => s + m.total, 0);

  return {
    completeCount: complete.length,
    incompleteCount: incomplete.length,
    incompleteMonths: incomplete.map(m => m.month),
    faultKnownValid,
    faultKnownNonNeg,
    // Complete months: atfault MPI is non-null
    completeHaveAtfault: complete.every(m => m.atfaultMpi !== null),
    // Incomplete months: atfault MPI is null
    incompleteNullAtfault: incomplete.every(m => m.atfaultMpi === null),
    // All months: "all" MPI (no needsFault) is always non-null
    allAlwaysPresent: waymoMonths.filter(m => m.total > 0 || m.allMpi !== null).length === waymoMonths.length,
    // Cross-check: series faultKnown matches raw data
    rawFaultKnown,
    rawFaultNull,
    seriesFaultKnown,
    seriesTotalInc,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(checks));

assert.ok(
  plain.faultKnownValid && plain.faultKnownNonNeg,
  `Replicata: inspect faultKnown field across all Waymo months.
Expectata: 0 <= faultKnown <= total for every month.
Resultata: valid=${plain.faultKnownValid}, nonNeg=${plain.faultKnownNonNeg}.`,
);

assert.ok(
  plain.completeCount > 0 && plain.incompleteCount > 0,
  `Replicata: classify Waymo months by fault data completeness.
Expectata: both complete and incomplete months exist in the data.
Resultata: complete=${plain.completeCount}, incomplete=${plain.incompleteCount} (${plain.incompleteMonths.join(", ")}).`,
);

assert.ok(
  plain.completeHaveAtfault,
  `Replicata: check atfault mpiByMetric for months with complete fault data.
Expectata: atfault MPI is computed (non-null) when faultKnown === total.
Resultata: completeHaveAtfault=${plain.completeHaveAtfault}.`,
);

assert.ok(
  plain.incompleteNullAtfault,
  `Replicata: check atfault mpiByMetric for months with incomplete fault data.
Expectata: atfault MPI is null when faultKnown < total (needsFault gate).
Resultata: incompleteNullAtfault=${plain.incompleteNullAtfault}.`,
);

assert.ok(
  plain.seriesFaultKnown === plain.rawFaultKnown,
  `Replicata: cross-check faultKnown totals between series and raw incident data.
Expectata: sum of per-month faultKnown equals count of raw incidents with non-null fault.
Resultata: series=${plain.seriesFaultKnown}, raw=${plain.rawFaultKnown}.`,
);

console.log("qual pass: faultKnown counting drives needsFault metric availability");

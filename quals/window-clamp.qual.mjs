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

const preWindow = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  buildMonthlyViews();
  const requestedMonths = fullMonthSeries.months.slice(0, 6);
  monthRangeStart = 0;
  monthRangeEnd = 5;
  buildMonthlyViews();
  const summaryByDriver = Object.fromEntries(
    monthlySummaryRows(activeSeries).map(row => [row.driver, row]),
  );
  return {
    requestedMonths,
    activeMonths: [...activeSeries.months],
    sliderHtml: document.getElementById("date-range-controls").innerHTML,
    query: encodeUiStateQuery(),
    waymoVmt: summaryByDriver.Waymo.vmtBest,
    waymoInc: summaryByDriver.Waymo.incTotal,
    teslaVmt: summaryByDriver.Tesla.vmtBest,
    teslaInc: summaryByDriver.Tesla.incTotal,
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(preWindow));

assert.deepEqual(
  plain.activeMonths,
  plain.requestedMonths,
  `Replicata: set monthRangeStart=0 and monthRangeEnd=5, then rebuild monthly views.
Expectata: the selected slice stays on the first six months of the series (${JSON.stringify(plain.requestedMonths)}).
Resultata: active months were ${JSON.stringify(plain.activeMonths)}.`,
);

assert.ok(
  plain.sliderHtml.includes('min="0"'),
  `Replicata: render the date-range controls after selecting months 0 through 5.
Expectata: the slider still exposes month index 0 so earlier Waymo months remain reachable.
Resultata: control HTML was ${JSON.stringify(plain.sliderHtml)}.`,
);

assert.ok(
  plain.waymoVmt > 0 && plain.waymoInc > 0,
  `Replicata: summarize the first six months of the series after selecting monthRangeStart=0 and monthRangeEnd=5.
Expectata: Waymo's summary row still shows positive VMT and incident counts for that earlier slice.
Resultata: Waymo summary was vmtBest=${plain.waymoVmt}, incTotal=${plain.waymoInc}.`,
);

assert.ok(
  plain.teslaVmt === 0 && plain.teslaInc === 0,
  `Replicata: summarize the first six months of the series after selecting monthRangeStart=0 and monthRangeEnd=5.
Expectata: Tesla stays at zero there because it has no VMT or incidents in that slice.
Resultata: Tesla summary was vmtBest=${plain.teslaVmt}, incTotal=${plain.teslaInc}.`,
);

assert.ok(
  plain.query.includes("d=0-5"),
  `Replicata: sync URL state after selecting the first six months of the series.
Expectata: encoded query preserves the explicit pre-window date range as d=0-5.
Resultata: query was ${plain.query}.`,
);

console.log("qual pass: pre-window date ranges stay reachable and summarize consistently");

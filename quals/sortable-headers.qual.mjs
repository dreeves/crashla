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

  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn(event);
  }

  click() {
    this.dispatch("click");
  }

  setAttribute(name, value) {
    this._attributes[name] = value;
  }

  getAttribute(name) {
    return this._attributes[name] ?? null;
  }

  querySelector() {
    return {
      addEventListener() {},
      classList: { toggle() {} },
    };
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

vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  buildMonthlyViews();
`, ctx);

const headerRow = () => getNode("incidents-head").children[0].children;

const before = headerRow();
assert.ok(
  before.length > 0 && before.every(th => th.tabIndex === 0),
  `Replicata: build the incident browser and inspect the column header cells.
Expectata: every header cell is keyboard-focusable (tabIndex 0).
Resultata: tabIndex values were ${JSON.stringify(before.map(th => th.tabIndex))}.`,
);

// Keydown with a non-activation key must not sort
let prevented = false;
before[0].dispatch("keydown", { key: "x", preventDefault: () => { prevented = true; } });
assert.equal(
  vm.runInContext("sortCol", ctx),
  null,
  `Replicata: press a non-activation key ("x") on the first column header.
Expectata: the sort state stays untouched (sortCol null).
Resultata: sortCol became "${vm.runInContext("sortCol", ctx)}".`,
);
assert.equal(
  prevented,
  false,
  `Replicata: press a non-activation key ("x") on the first column header.
Expectata: the keydown handler does not call preventDefault for keys it ignores.
Resultata: preventDefault was called.`,
);

// Enter sorts ascending, marks the header, and matches click behavior
before[0].dispatch("keydown", { key: "Enter", preventDefault() {} });
assert.equal(
  vm.runInContext("sortCol", ctx),
  "helmer",
  `Replicata: press Enter on the first column header.
Expectata: the table sorts by that column (sortCol "helmer"), same as clicking it.
Resultata: sortCol was "${vm.runInContext("sortCol", ctx)}".`,
);
assert.equal(
  headerRow()[0].getAttribute("aria-sort"),
  "ascending",
  `Replicata: press Enter on the first column header.
Expectata: the rebuilt header announces aria-sort="ascending".
Resultata: aria-sort was ${JSON.stringify(headerRow()[0].getAttribute("aria-sort"))}.`,
);

// Space on the already-sorted column flips the direction
headerRow()[0].dispatch("keydown", { key: " ", preventDefault() {} });
assert.equal(
  headerRow()[0].getAttribute("aria-sort"),
  "descending",
  `Replicata: press Space on the column already sorted ascending.
Expectata: the sort direction flips and the header announces aria-sort="descending".
Resultata: aria-sort was ${JSON.stringify(headerRow()[0].getAttribute("aria-sort"))}.`,
);

// Unsorted columns carry no aria-sort
assert.equal(
  headerRow()[1].getAttribute("aria-sort"),
  null,
  `Replicata: sort by the first column and inspect the second column header.
Expectata: columns that are not the active sort carry no aria-sort attribute.
Resultata: aria-sort was ${JSON.stringify(headerRow()[1].getAttribute("aria-sort"))}.`,
);

console.log("qual pass: incident table headers sort via keyboard and expose aria-sort");

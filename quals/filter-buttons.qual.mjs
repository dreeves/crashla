import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.classList = { toggle() {} };
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

  click() {
    for (const fn of this.listeners.click || []) fn();
  }

  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector() {
    return new ElementStub("td");
  }

  setAttribute(name, value) {
    this._attributes = { ...this._attributes, [name]: String(value) };
  }

  getAttribute(name) {
    return (this._attributes || {})[name] ?? null;
  }
}

const nodeById = new Map();
const getNode = id => nodeById.get(id) || (nodeById.set(id, new ElementStub("div", id)), nodeById.get(id));
const documentStub = {
  getElementById: getNode,
  createElement: tag => new ElementStub(tag),
  // Nothing is focused in this harness: the page's focus hand-off after a
  // re-render (rerenderKeepingFocus) finds no control to restore.
  activeElement: new ElementStub("body"),
};


const ctx = vm.createContext({
  console,
  Math,
  document: documentStub,
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

vm.runInContext(`
incidents = [
  { helmer: "Tesla", date: "JUN-2025", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { helmer: "Waymo", date: "JUN-2025", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { helmer: "Zoox", date: "JUN-2025", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
vmtRows = [
  {helmer: "Tesla", month: "2025-06", vmtMin: 1, vmtBest: 1, vmtMax: 1},
  {helmer: "Waymo", month: "2025-06", vmtMin: 1, vmtBest: 1, vmtMax: 1},
  {helmer: "Zoox", month: "2025-06", vmtMin: 1, vmtBest: 1, vmtMax: 1},
];
activeSeries = { months: ["2025-06"] };
buildBrowser();
`, ctx);

const expectedCount = vm.runInContext("ADS_HELMERS.length + 1", ctx);
const filterRoot = getNode("filters");
const before = filterRoot.children.length;
filterRoot.children[1].click();
const afterOneClick = getNode("filters").children.length;
getNode("filters").children[2].click();
const afterTwoClicks = getNode("filters").children.length;

assert.deepEqual(
  [before, afterOneClick, afterTwoClicks],
  [expectedCount, expectedCount, expectedCount],
  `Replicata: click filter buttons repeatedly.
Expectata: button count remains ${expectedCount}.
Resultata: counts were ${before}, ${afterOneClick}, ${afterTwoClicks}.`,
);

// The active filter is announced, not only drawn inverted (audit #92): each
// button's aria-pressed comes from the same comparison as its class.
const pressed = getNode("filters").children.map(b => [b.textContent.split(" (")[0], b.getAttribute("aria-pressed"), b.className]);
assert.deepEqual(
  pressed,
  [["All", "false", ""], ["Tesla", "false", ""], ["Waymo", "true", "active"], ["Zoox", "false", ""]],
  `Replicata: click the Tesla filter button, then the Waymo one, and read every button's aria-pressed and class.
Expectata: Waymo alone is pressed ("true", class active); the others read "false".
Resultata: ${JSON.stringify(pressed)}.`,
);

// A button's count is formatted like every other count on the page (audit
// #54: the buttons read "All (1228) | Waymo (1164)" directly above the count
// line's "1,228 incidents").
vm.runInContext(`
incidents = Array.from({length: 1234}, () => ({ helmer: "Waymo", date: "JUN-2025", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }))
  .concat([{ helmer: "Tesla", date: "JUN-2025", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }]);
activeFilter = "All";
buildBrowser();
`, ctx);
const thousandLabels = getNode("filters").children.map(b => b.textContent);
assert.deepEqual(
  thousandLabels,
  ["All (1,235)", "Tesla (1)", "Waymo (1,234)", "Zoox (0)"],
  `Replicata: build the incident browser over 1,234 Waymo incidents and 1 Tesla incident and read the filter buttons.
Expectata: counts grouped as on the count line ("All (1,235)", "Waymo (1,234)").
Resultata: ${JSON.stringify(thousandLabels)}.`,
);

console.log("qual pass: filter buttons stay non-duplicated across clicks, announce which one is active, and group their counts");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

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
    this.value = "";
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
}

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};

const html = fs.readFileSync("index.html", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(
  scriptMatch,
  "Replicata: parse index.html. Expectata: inline app script exists. Resultata: script tag missing.",
);
const appScript = scriptMatch[1].split("// --- Init ---")[0];

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(appScript, ctx, { filename: "index.html" });

vm.runInContext(`
incidents = [
  { company: "Tesla", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { company: "Waymo", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { company: "Zoox", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
document.getElementById("tesla-miles").value = "456000";
document.getElementById("tesla-frac").value = "50";
document.getElementById("waymo-miles").value = "50000000";
document.getElementById("zoox-miles").value = "500000";
buildEstimator();
buildEstimator();
`, ctx);

const expectedPanels = vm.runInContext("Object.keys(COMPANIES).length", ctx);
const estimatorChildren = getNode("estimator").children.length;
assert.equal(
  estimatorChildren,
  expectedPanels,
  `Replicata: call buildEstimator() twice.
Expectata: estimator panel count remains ${expectedPanels}.
Resultata: panel count was ${estimatorChildren}.`,
);

let threw = false;
try {
  vm.runInContext("gammaquant(1, 1, 1)", ctx);
} catch (err) {
  threw = true;
}
assert.ok(
  threw,
  `Replicata: call gammaquant with p=1.
Expectata: immediate throw for invalid parameters.
Resultata: no throw.`,
);

console.log("qual pass: fail-loud invariants and idempotent estimator rendering");

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
const getNode = id => nodeById.get(id) || (nodeById.set(id, new ElementStub("div", id)), nodeById.get(id));
const documentStub = {
  getElementById: getNode,
  createElement: tag => new ElementStub(tag),
};

const html = fs.readFileSync("index.html", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "Expected inline JavaScript in index.html");
const appScript = scriptMatch[1].split("// --- Init ---")[0];

const ctx = vm.createContext({
  console,
  Math,
  document: documentStub,
});
vm.runInContext(appScript, ctx, { filename: "index.html" });

vm.runInContext(`
incidents = [
  { company: "Tesla", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { company: "Waymo", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" },
  { company: "Zoox", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
buildBrowser();
`, ctx);

const expectedCount = vm.runInContext("Object.keys(COMPANIES).length + 1", ctx);
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

console.log("qual pass: filter buttons stay non-duplicated across clicks");

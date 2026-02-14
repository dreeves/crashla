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
document.getElementById("tesla-frac").value = "60";
document.getElementById("tesla-deadhead").value = "20";
document.getElementById("waymo-miles").value = "57000000";
document.getElementById("waymo-deadhead").value = "0";
document.getElementById("zoox-miles").value = "300000";
document.getElementById("zoox-deadhead").value = "20";
document.getElementById("humans-waymo-divisor").value = "5";
document.getElementById("result-Tesla");
`, ctx);

vm.runInContext(`updateEstimate("Tesla")`, ctx);
const rendered = getNode("result-Tesla").innerHTML;

const refLineCount = (rendered.match(/class="graph-refline"/g) || []).length;
assert.equal(
  refLineCount,
  3,
  `Replicata: render Tesla graph with all company sliders set.
Expectata: three horizontal peer reference lines appear (Waymo, Zoox, and Humans).
Resultata: found ${refLineCount} reference lines in rendered HTML ${JSON.stringify(rendered)}.`,
);

assert.ok(
  rendered.includes("Waymo:") && rendered.includes("Zoox:") && rendered.includes("Humans:"),
  `Replicata: render Tesla graph with all company sliders set.
Expectata: peer line labels include Waymo, Zoox, and Humans.
Resultata: rendered HTML was ${JSON.stringify(rendered)}.`,
);

console.log("qual pass: graphs include three color-coded peer reference lines");

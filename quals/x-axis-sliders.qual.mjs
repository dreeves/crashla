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
document.getElementById("tesla-miles").value = "500000";
document.getElementById("tesla-frac").value = "70";
document.getElementById("tesla-deadhead").value = "20";
document.getElementById("waymo-miles").value = "43000000";
document.getElementById("waymo-deadhead").value = "0";
document.getElementById("zoox-miles").value = "300000";
document.getElementById("zoox-deadhead").value = "20";
document.getElementById("humans-waymo-divisor").value = "5";
document.getElementById("x-min-Tesla").value = "10";
document.getElementById("x-max-Tesla").value = "60";
document.getElementById("result-Tesla");
document.getElementById("x-min-Tesla-val");
document.getElementById("x-max-Tesla-val");
`, ctx);

vm.runInContext(`updateEstimate("Tesla")`, ctx);
const rendered = getNode("result-Tesla").innerHTML;
const minLabel = getNode("x-min-Tesla-val").textContent;
const maxLabel = getNode("x-max-Tesla-val").textContent;
const expected = vm.runInContext(`
(() => {
  const s = companySummaries(countByCompany()).Tesla;
  const span = s.bounds.max - s.bounds.min;
  const xMin = s.bounds.min + span * 0.10;
  const xMax = s.bounds.min + span * 0.60;
  const xMid = (xMin + xMax) / 2;
  return {
    xMinTick: Math.round(xMin).toLocaleString(),
    xMidTick: Math.round(xMid).toLocaleString(),
    xMaxTick: Math.round(xMax).toLocaleString(),
  };
})()
`, ctx);

assert.ok(
  rendered.includes(expected.xMinTick) &&
    rendered.includes(expected.xMidTick) &&
    rendered.includes(expected.xMaxTick) &&
    minLabel === expected.xMinTick &&
    maxLabel === expected.xMaxTick,
  `Replicata: set Tesla x-axis sliders to 10% and 60%, then render estimate graph.
Expectata: x-axis ticks and slider value labels reflect the selected x-axis window.
Resultata: expected=${JSON.stringify(expected)} minLabel=${JSON.stringify(minLabel)} maxLabel=${JSON.stringify(maxLabel)} rendered=${JSON.stringify(rendered)}.`,
);

console.log("qual pass: per-panel x-axis sliders drive tick window and displayed bounds");

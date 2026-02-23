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


const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

vm.runInContext(`
incidents = [
  { company: "Tesla", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
document.getElementById("tesla-miles").value = "456000";
document.getElementById("tesla-frac").value = "50";
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
const headerText = getNode("header-stats-Tesla").textContent;
const expectedDenom = vm.runInContext(`
Math.round(COMPANIES.Tesla.getParts({
  "tesla-miles": 456000,
  "tesla-frac": 50,
  "tesla-deadhead": 20
}).miles).toLocaleString()
`, ctx);
const expectedHeader = vm.runInContext(`
(() => {
  const miles = COMPANIES.Tesla.getParts({
    "tesla-miles": 456000,
    "tesla-frac": 50,
    "tesla-deadhead": 20
  }).miles;
  const mpi = fmtMiles(estimateRate(1, miles).median);
  return "Tesla: 1 incidents in " + Math.round(miles).toLocaleString() + " miles \u21D2 " + mpi + " miles per incident";
})()
`, ctx);

assert.ok(
  !rendered.includes("D = B_none × m_nonservice × f_scope") &&
  !rendered.includes("B_none = B × f_none") &&
  rendered.includes("<svg") &&
  rendered.includes("Total Autonomous Miles") &&
  rendered.includes("Waymo:") &&
  rendered.includes("Zoox:") &&
  rendered.includes("Humans:") &&
  headerText === expectedHeader &&
  headerText.includes(expectedDenom),
  `Replicata: render Tesla estimate after setting denominator sliders.
Expectata: denominator detail block and graph title are removed, x-axis label is updated, and live header miles plus miles-per-incident are correct.
Resultata: rendered HTML was ${JSON.stringify(rendered)} and header text was ${JSON.stringify(headerText)}.`,
);

console.log("qual pass: denominator details removed while live header denominator remains");

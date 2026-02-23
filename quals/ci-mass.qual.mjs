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
document.getElementById("ci-mass").value = "95";
document.getElementById("tesla-miles").value = "456000";
document.getElementById("tesla-frac").value = "50";
document.getElementById("tesla-deadhead").value = "0";
document.getElementById("waymo-miles").value = "57000000";
document.getElementById("waymo-deadhead").value = "0";
document.getElementById("zoox-miles").value = "300000";
document.getElementById("zoox-deadhead").value = "20";
document.getElementById("humans-waymo-divisor").value = "5";
document.getElementById("result-Tesla");
`, ctx);

const metrics = vm.runInContext(`
(() => {
  const est95 = estimateRate(9, 456000);
  document.getElementById("ci-mass").value = "80";
  const est80 = estimateRate(9, 456000);
  const lo95 = 1 / gammaquant(9.5, 456000, 0.975);
  const hi95 = 1 / gammaquant(9.5, 456000, 0.025);
  const lo80 = 1 / gammaquant(9.5, 456000, 0.9);
  const hi80 = 1 / gammaquant(9.5, 456000, 0.1);
  return { est95, est80, lo95, hi95, lo80, hi80 };
})()
`, ctx);

const relErr = (a, b) => Math.abs(a - b) / b;
assert.ok(
  relErr(metrics.est95.lo, metrics.lo95) < 1e-12 &&
    relErr(metrics.est95.hi, metrics.hi95) < 1e-12 &&
    relErr(metrics.est80.lo, metrics.lo80) < 1e-12 &&
    relErr(metrics.est80.hi, metrics.hi80) < 1e-12 &&
    relErr(metrics.est95.median, metrics.est80.median) < 1e-12,
  `Replicata: compute estimateRate(9, 456000).
Expectata: changing CI mass changes only bounds (95% uses 2.5th/97.5th; 80% uses 10th/90th) while median stays fixed.
Resultata: metrics=${JSON.stringify(metrics)}.`,
);

vm.runInContext(`updateEstimate("Tesla")`, ctx);
const rendered = getNode("result-Tesla").innerHTML;
assert.ok(
  rendered.includes("<svg") && rendered.includes("graph-band") && rendered.includes("Total Autonomous Miles") &&
    rendered.includes("Waymo:") && rendered.includes("Zoox:") && rendered.includes("Humans:"),
  `Replicata: render company estimate.
Expectata: rendered estimate uses graph output with CI band, updated x-axis label, and peer reference lines for all non-selected entities.
Resultata: rendered HTML was ${JSON.stringify(rendered)}.`,
);

console.log("qual pass: estimator uses CI-mass quantile math and graph rendering");

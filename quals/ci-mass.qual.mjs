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
assert.ok(scriptMatch, "Replicata: load index.html script. Expectata: script exists. Resultata: inline script missing.");
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
  { company: "Tesla", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
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
  const est = estimateRate(9, 456000);
  // TODO: don't hardcode this; it's a parameter now
  const lo95 = 1 / gammaquant(9.5, 456000, 0.975);
  const hi95 = 1 / gammaquant(9.5, 456000, 0.025);
  return { est, lo95, hi95 };
})()
`, ctx);

const relErr = (a, b) => Math.abs(a - b) / b;
assert.ok(
  relErr(metrics.est.lo, metrics.lo95) < 1e-12 && relErr(metrics.est.hi, metrics.hi95) < 1e-12,
  `Replicata: compute estimateRate(9, 456000).
Expectata: CI bounds use 95% tails (2.5th/97.5th posterior percentiles).
Resultata: lo=${metrics.est.lo}, expected_lo=${metrics.lo95}, hi=${metrics.est.hi}, expected_hi=${metrics.hi95}.`,
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

console.log("qual pass: estimator uses 95% CI math and graph rendering");

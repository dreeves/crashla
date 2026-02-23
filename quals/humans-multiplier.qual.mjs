import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const nodes = new Map();
const getNode = id => {
  if (!nodes.has(id)) nodes.set(id, { value: "" });
  return nodes.get(id);
};

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const set = (id, v) => { getNode(id).value = String(v); };
set("tesla-miles", 500000);
set("tesla-frac", 70);
set("tesla-deadhead", 20);
set("waymo-miles", 43000000);
set("waymo-deadhead", 0);
set("zoox-miles", 300000);
set("zoox-deadhead", 20);
set("humans-waymo-divisor", 4);

vm.runInContext(`
incidents = [
  { company: "Waymo", date: "2025-01-01", city: "X", state: "CA", crashWith: "Car", speed: null, severity: "", narrativeCbi: "N", narrative: "" }
];
`, ctx);

const metrics = vm.runInContext(`
(() => {
  const s = companySummaries(countByCompany());
  return {
    waymoMedian: s.Waymo.est.median,
    humansMedian: s.Humans.est.median,
    waymoLo: s.Waymo.est.lo,
    humansLo: s.Humans.est.lo,
    waymoHi: s.Waymo.est.hi,
    humansHi: s.Humans.est.hi,
    waymoMiles: s.Waymo.miles,
    humansMiles: s.Humans.miles,
    waymoBounds: s.Waymo.bounds,
    humansBounds: s.Humans.bounds,
  };
})()
`, ctx);

const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
assert.ok(
  relErr(metrics.humansMedian, metrics.waymoMedian / 4) < 1e-12 &&
    relErr(metrics.humansLo, metrics.waymoLo / 4) < 1e-12 &&
    relErr(metrics.humansHi, metrics.waymoHi / 4) < 1e-12,
  `Replicata: set humans-waymo-divisor to 4 and compute summaries.
Expectata: humans miles-per-incident distribution is exactly one quarter of Waymo's.
Resultata: metrics were ${JSON.stringify(metrics)}.`,
);

assert.deepEqual(
  JSON.parse(JSON.stringify(metrics.humansBounds)),
  JSON.parse(JSON.stringify(metrics.waymoBounds)),
  `Replicata: inspect Humans and Waymo graph bounds from computed summaries.
Expectata: Humans graph uses the same x-axis denominator bounds as Waymo.
Resultata: humansBounds=${JSON.stringify(metrics.humansBounds)} waymoBounds=${JSON.stringify(metrics.waymoBounds)}.`,
);

assert.equal(
  metrics.humansMiles,
  metrics.waymoMiles,
  `Replicata: inspect Humans and Waymo point x-location from computed summaries.
Expectata: Humans highlighted point uses Waymo's current denominator miles.
Resultata: humansMiles=${metrics.humansMiles} waymoMiles=${metrics.waymoMiles}.`,
);

console.log("qual pass: humans multiplier tracks Waymo estimates and bounds");

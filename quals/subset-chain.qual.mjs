import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const mpi = vm.runInContext(
  "Object.fromEntries(METRIC_DEFS.filter(m => m.humanMPI).map(m => [m.key, m.humanMPI]))", ctx);

// Every metric must have 0 < lo < hi
for (const [key, val] of Object.entries(mpi)) {
  assert.ok(
    val.lo > 0 && val.hi > val.lo,
    `Replicata: inspect humanMPI for metric ${key}.
Expectata: 0 < lo < hi.
Resultata: lo=${val.lo}, hi=${val.hi}.`);
}

// Subset ordering: if B ⊂ A (fewer incidents), then MPI-B ≥ MPI-A.
// Each pair is [parent, subset] where subset.lo ≥ parent.lo and
// subset.hi ≥ parent.hi.
const subsetPairs = [
  ["all", "nonstationary"],
  ["nonstationary", "roadwayNonstationary"],
  ["all", "atfault"],
  ["atfault", "atfaultInjury"],
  ["all", "injury"],
  ["injury", "atfaultInjury"],
  ["injury", "hospitalization"],
  ["hospitalization", "seriousInjury"],
  ["seriousInjury", "fatality"],
];

for (const [parent, subset] of subsetPairs) {
  assert.ok(
    mpi[subset].lo >= mpi[parent].lo && mpi[subset].hi >= mpi[parent].hi,
    `Replicata: compare humanMPI.${subset} (subset) to humanMPI.${parent} (superset).
Expectata: ${subset}.lo (${mpi[subset].lo}) ≥ ${parent}.lo (${mpi[parent].lo}) and ${subset}.hi (${mpi[subset].hi}) ≥ ${parent}.hi (${mpi[parent].hi}).
Resultata: lo ok=${mpi[subset].lo >= mpi[parent].lo}, hi ok=${mpi[subset].hi >= mpi[parent].hi}.`);
}

console.log("qual pass: humanMPI subset chain ordering is consistent");

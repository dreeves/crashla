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

const mpiByCohort = vm.runInContext(`
  Object.fromEntries(HUMAN_HELMERS.map(hh => [hh,
    Object.fromEntries(METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[hh])
      .map(m => [m.key, m.humanMPI[hh]]))]))`, ctx);

// Both cohorts must exist and HumansAV must cover every metric with bands
assert.ok(
  Object.keys(mpiByCohort).length === 2 && Object.keys(mpiByCohort.HumansAV).length >= 10,
  `Replicata: collect humanMPI bands per cohort from METRIC_DEFS.
Expectata: two cohorts, with HumansAV covering all metrics.
Resultata: cohorts ${JSON.stringify(Object.keys(mpiByCohort))}, HumansAV metrics ${Object.keys(mpiByCohort.HumansAV || {}).length}.`);

// Subset ordering: if B ⊂ A (fewer incidents), then MPI-B ≥ MPI-A.
// Each pair is [parent, subset] where subset.lo ≥ parent.lo and
// subset.hi ≥ parent.hi. Pairs skip when a cohort lacks a metric
// (HumansUS has no hospitalization/airbag/seriousInjury bands).
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

for (const [cohort, mpi] of Object.entries(mpiByCohort)) {
  // Every metric must have 0 < lo < hi
  for (const [key, val] of Object.entries(mpi)) {
    assert.ok(
      val.lo > 0 && val.hi > val.lo,
      `Replicata: inspect ${cohort} humanMPI for metric ${key}.
Expectata: 0 < lo < hi.
Resultata: lo=${val.lo}, hi=${val.hi}.`);
  }
  for (const [parent, subset] of subsetPairs) {
    if (!mpi[parent] || !mpi[subset]) continue;
    assert.ok(
      mpi[subset].lo >= mpi[parent].lo && mpi[subset].hi >= mpi[parent].hi,
      `Replicata: compare ${cohort} humanMPI.${subset} (subset) to humanMPI.${parent} (superset).
Expectata: ${subset}.lo (${mpi[subset].lo}) ≥ ${parent}.lo (${mpi[parent].lo}) and ${subset}.hi (${mpi[subset].hi}) ≥ ${parent}.hi (${mpi[parent].hi}).
Resultata: lo ok=${mpi[subset].lo >= mpi[parent].lo}, hi ok=${mpi[subset].hi >= mpi[parent].hi}.`);
  }
}

// At-fault band universe-matching: the lo anchor uses the any-property-damage
// universe where the at-fault share → ~1, so it collapses to the all-crash lo.
// The hi anchor stays in the police-reported universe with a 50% share, so it
// must exceed the all-crash hi. Guards against regressing to a single share
// applied across mismatched universes (the pre-2026-06-12 derivation).
for (const [cohort, mpi] of Object.entries(mpiByCohort)) {
  assert.equal(
    mpi.atfault.lo,
    mpi.all.lo,
    `Replicata: compare ${cohort} at-fault band lo to the all-crash band lo.
Expectata: equal (at-fault share → ~1 in the any-property-damage universe).
Resultata: atfault.lo=${mpi.atfault.lo}, all.lo=${mpi.all.lo}.`);
  assert.ok(
    mpi.atfault.hi > mpi.all.hi,
    `Replicata: compare ${cohort} at-fault band hi to the all-crash band hi.
Expectata: strictly greater (50% at-fault share in the police-reported universe).
Resultata: atfault.hi=${mpi.atfault.hi}, all.hi=${mpi.all.hi}.`);
}

// Display order: METRIC_DEFS lists each superset before its subsets, so the
// metric radios / cards / tables read in increasing-severity (rarity) order
// (e.g. at-fault injury after injury, not before).
const metricOrder = vm.runInContext(`METRIC_DEFS.map(m => m.key)`, ctx);
for (const [parent, subset] of subsetPairs) {
  assert.ok(
    metricOrder.indexOf(parent) < metricOrder.indexOf(subset),
    `Replicata: compare METRIC_DEFS positions of ${parent} (superset) and ${subset} (subset).
Expectata: ${parent} listed before ${subset} (severity order).
Resultata: order is ${JSON.stringify(metricOrder)}.`);
}

console.log("qual pass: humanMPI subset chain ordering is consistent");

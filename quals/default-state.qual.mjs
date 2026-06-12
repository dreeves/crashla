import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});

vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const defaults = JSON.parse(JSON.stringify(vm.runInContext(
  `({monthHelmerEnabled, selectedMetricKey})`, ctx)));

assert.deepEqual(
  defaults.monthHelmerEnabled,
  {HumansAV: true, HumansUS: false, Tesla: true, Waymo: true, Zoox: false},
  `Replicata: load crashla.js fresh (no URL state) and read monthHelmerEnabled.
Expectata: HumansAV, Tesla, and Waymo checked by default; HumansUS and Zoox unchecked.
Resultata: helmer toggles were ${JSON.stringify(defaults.monthHelmerEnabled)}.`,
);

assert.equal(
  defaults.selectedMetricKey,
  "atfault",
  `Replicata: load crashla.js fresh (no URL state) and read selectedMetricKey.
Expectata: the at-fault MPI metric is selected by default.
Resultata: selectedMetricKey was ${defaults.selectedMetricKey}.`,
);

const defaultEnabledKeys = JSON.parse(JSON.stringify(vm.runInContext(
  `METRIC_DEFS.filter(m => m.defaultEnabled).map(m => m.key)`, ctx)));

assert.deepEqual(
  defaultEnabledKeys,
  ["atfault"],
  `Replicata: collect METRIC_DEFS entries with defaultEnabled set.
Expectata: exactly one metric (atfault) is the default; selectedMetricKey derives from it.
Resultata: defaultEnabled keys were ${JSON.stringify(defaultEnabledKeys)}.`,
);

console.log("qual pass: default UI state is HumansAV+Tesla+Waymo with the at-fault metric");

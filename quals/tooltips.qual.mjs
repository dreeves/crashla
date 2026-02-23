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

const missing = vm.runInContext(`
Object.entries(COMPANIES).flatMap(([company, cfg]) =>
  cfg.sliders
    .filter(s => !(typeof s.tip === "string" && s.tip.length > 0))
    .map(s => ({company, id: s.id})),
)
`, ctx);

assert.deepEqual(
  JSON.parse(JSON.stringify(missing)),
  [],
  `Replicata: inspect slider config for tooltip text.
Expectata: every slider has non-empty tip text.
Resultata: missing tooltips for ${JSON.stringify(missing)}.`,
);

const sourceHasTitleBinding =
  appScript.includes('title="${tip}"') &&
  appScript.includes("slider missing tooltip");

assert.ok(
  sourceHasTitleBinding,
  `Replicata: inspect estimator template source.
Expectata: tooltip text is wired to UI title attributes with fail-loud guard.
Resultata: binding marker missing in source.`,
);

console.log("qual pass: slider tooltips are defined and bound in UI template");

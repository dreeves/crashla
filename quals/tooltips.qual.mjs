import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

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
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "index.html" });

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
  html.includes('title="${tip}"') &&
  html.includes("slider missing tooltip");

assert.ok(
  sourceHasTitleBinding,
  `Replicata: inspect estimator template source.
Expectata: tooltip text is wired to UI title attributes with fail-loud guard.
Resultata: binding marker missing in source.`,
);

console.log("qual pass: slider tooltips are defined and bound in UI template");

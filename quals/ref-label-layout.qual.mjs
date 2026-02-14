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

const out = vm.runInContext(`
(() => {
  const peers = [
    {company: "Waymo", est: {median: 10}},
    {company: "Zoox", est: {median: 10.00001}},
    {company: "Humans", est: {median: 10.00002}},
  ];
  const laid = layoutRefLabels(peers, () => 100, 10, 170);
  const ys = laid.map(x => x.labelY).sort((a, b) => a - b);
  return {
    ys,
    gaps: [ys[1] - ys[0], ys[2] - ys[1]],
    minGap: Math.min(ys[1] - ys[0], ys[2] - ys[1]),
  };
})()
`, ctx);

assert.ok(
  out.minGap >= 12,
  `Replicata: lay out three peer labels with nearly identical y targets.
Expectata: label y values are separated by at least 12px to avoid overlap.
Resultata: layout metrics were ${JSON.stringify(out)}.`,
);

console.log("qual pass: peer label layout enforces non-overlapping y positions");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// A chart's left margin is derived from its y tick labels: the rotated title's
// band, the widest label, and the gap to the axis line. It used to be a
// literal (68) copied into every chart, which fit the label column only by
// coincidence -- the 2026-09-07 face change widened "136.9K" into the title.
// Tick labels are digits in tabular figures (style.css .month-svg), so one
// per-glyph bound stands in for measuring text the browser has not laid out.

const js = fs.readFileSync("crashla.js", "utf8");

const escapingEl = () => {
  let html = "";
  return {
    set textContent(v) {
      html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    get innerHTML() { return html; },
  };
};
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map, JSON,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return escapingEl(); },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

// --- 1. The helper: title band + widest label + gap ----------------------

// JSON round-trip: the object is born in the VM realm, whose Object prototype
// strict deepEqual would otherwise reject.
const margins = JSON.parse(vm.runInContext(`JSON.stringify({
  vmt: axisLeftMargin(["0", "136.9K"]),
  mpi: axisLeftMargin(["0", "1.7M"]),
})`, ctx));
assert.deepEqual(
  margins,
  { vmt: 80, mpi: 64 },
  `Replicata: call axisLeftMargin with a VMT chart's labels and an MPI chart's.
Expectata: 24 (title band) + 8 per glyph of the widest label + 8 (gap): 80 and 64.
Resultata: ${JSON.stringify(margins)}.`,
);

// --- 2. Every chart with a tick column derives its margin ----------------

const derived = (js.match(/mLeft = axisLeftMargin\(/g) || []).length;
const literal = (js.match(/mLeft = 68\b/g) || []).length;
assert.deepEqual(
  { derived, literal },
  { derived: 3, literal: 2 },
  `Replicata: grep crashla.js for "mLeft = ".
Expectata: the three charts that draw y tick labels (MPI over time, VMT series,
growth trajectory) derive mLeft from their labels; the two density charts draw
no y ticks and keep the literal, since the distribution quals pin their frame.
Resultata: ${derived} derived, ${literal} literal.`,
);

// --- 3. Rendered: no tick label reaches the title band --------------------

const html = vm.runInContext("renderFleetTimeSeriesChart()", ctx);
const ticks = [...html.matchAll(
  /<text class="month-tick" x="([\d.]+)"[^>]*text-anchor="end">([^<]+)<\/text>/g,
)].map(m => ({ x: Number(m[1]), label: m[2] }));
assert.ok(ticks.length > 0, "the growth trajectory chart draws y tick labels");
const axisX = Number((html.match(/<line class="month-axis" x1="([\d.]+)" y1="[\d.]+" x2="\1"/) || [])[1]);
for (const tick of ticks) {
  assert.equal(tick.x, axisX - 8, `tick ${JSON.stringify(tick.label)} sits one gap left of the axis line at ${axisX}`);
  const leftEdge = tick.x - 8 * tick.label.length;
  assert.ok(
    leftEdge >= 24,
    `Replicata: render the growth trajectory chart and read its y tick labels.
Expectata: each label's modelled left edge (x minus 8 units per glyph) stays
right of the rotated title's band, which ends at x = 24.
Resultata: ${JSON.stringify(tick.label)} at x=${tick.x} reaches ${leftEdge}.`,
  );
}

console.log(`qual pass: chart margins derive from their tick labels (widest here: ${JSON.stringify(ticks.reduce((a, b) => b.label.length > a.label.length ? b : a).label)})`);

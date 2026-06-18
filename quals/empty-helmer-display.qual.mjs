import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Anti-Magic Principle: a helmer that is selected but has no data in the chosen
// date range must stay VISIBLE (legend chip grayed out, VMT chart empty) rather
// than being silently dropped. This qual pins that behavior.

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(k, v) { this[k] = v; }
  querySelector() { return new ElementStub("queried"); }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};

const ctx = vm.createContext({
  console, Math, Number, Set, JSON,
  document: { getElementById: getNode, createElement: tag => new ElementStub(tag) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Select Tesla + Waymo only, then window to the earliest months. Tesla has no
// VMT/incident data before 2025-06, while Waymo does (extended back to 2021-07),
// so Tesla is the "selected but empty in range" case and Waymo is the control.
const out = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  selectedMetricKey = "all";
  for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
  monthHelmerEnabled.Tesla = true;
  monthHelmerEnabled.Waymo = true;
  fullMonthSeries = monthSeriesData();
  monthRangeStart = 0; monthRangeEnd = 5; // first 6 months (2021 H2): no Tesla data
  renderWindowedViews();
  return {
    months: activeSeries.months,
    mpiLegend: /<div class="month-legend">[\\s\\S]*?<\\/div>/.exec(renderAllHelmersMpiChart(activeSeries))[0],
    distLegend: /<div class="month-legend">[\\s\\S]*?<\\/div>/.exec(renderDistributionChart(activeSeries))[0],
    teslaChart: renderHelmerMonthlyChart(activeSeries, "Tesla"),
    waymoChart: renderHelmerMonthlyChart(activeSeries, "Waymo"),
  };
})()
`, ctx);

// Sanity: the chosen window really is a no-Tesla-data range.
assert.ok(
  out.months.length > 0 && out.months[0] < "2025-06",
  `Replicata: window fullMonthSeries to indices 0..5 and read activeSeries.months.
Expectata: an early window (before Tesla's 2025-06 data) so Tesla is empty in range.
Resultata: months were ${JSON.stringify(out.months)}.`,
);

// Per-helmer legend item: capture the class string on each chip's <span>.
const itemClass = (legend, color) => {
  const hit = new RegExp(
    `<span class="(month-legend-item[^"]*)">\\s*<span class="month-chip" style="background:${color}">`,
  ).exec(legend);
  return hit === null ? null : hit[1];
};
const TESLA = "#d13b2d", WAYMO = "#2060c0";

for (const [name, legend] of [["MPI", out.mpiLegend], ["distribution", out.distLegend]]) {
  assert.equal(
    itemClass(legend, TESLA), "month-legend-item month-legend-item-empty",
    `Replicata: render the ${name} chart legend with Tesla selected but no data in range.
Expectata: Tesla's legend chip is present and carries month-legend-item-empty (grayed, not dropped).
Resultata: Tesla legend item class was ${JSON.stringify(itemClass(legend, TESLA))}.`,
  );
  assert.equal(
    itemClass(legend, WAYMO), "month-legend-item",
    `Replicata: render the ${name} chart legend with Waymo selected and data in range.
Expectata: Waymo's legend chip is present and NOT grayed.
Resultata: Waymo legend item class was ${JSON.stringify(itemClass(legend, WAYMO))}.`,
  );
}

// VMT per-helmer chart: empty graph (axes), not an elided "".
assert.ok(
  out.teslaChart.includes("<svg") && out.teslaChart.includes("Vehicle Miles Traveled"),
  `Replicata: call renderHelmerMonthlyChart for Tesla in a window with no Tesla data.
Expectata: a non-empty SVG (empty axes) renders instead of vanishing.
Resultata: output was ${JSON.stringify(out.teslaChart.slice(0, 80))}.`,
);
assert.ok(
  !out.teslaChart.includes("month-inc-bar"),
  `Replicata: inspect the empty Tesla VMT chart for incident bars.
Expectata: no incident bars, since Tesla has no data in this window.
Resultata: found a month-inc-bar in the empty chart.`,
);
assert.ok(
  out.waymoChart.includes("month-inc-bar"),
  `Replicata: call renderHelmerMonthlyChart for Waymo (has data in this window).
Expectata: the control chart still renders incident bars normally.
Resultata: no month-inc-bar found in the Waymo chart.`,
);

// Consistency: when the ONLY selected helmer is empty in range, the distribution
// chart must still render (empty axes + grayed legend) like the MPI chart, rather
// than collapsing to "".
const distOnly = vm.runInContext(`
(() => {
  for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
  monthHelmerEnabled.Tesla = true;
  monthRangeStart = 0; monthRangeEnd = 5;
  renderWindowedViews();
  const dist = renderDistributionChart(activeSeries);
  return {
    isSvg: dist.includes("<svg"),
    teslaGrayed: /month-legend-item month-legend-item-empty"[\\s\\S]*?#d13b2d/.test(dist),
    hasCurve: dist.includes("<circle"),
  };
})()
`, ctx);

assert.ok(
  distOnly.isSvg && distOnly.teslaGrayed && !distOnly.hasCurve,
  `Replicata: select only Tesla, window to a range with no Tesla data, render the distribution chart.
Expectata: a non-empty SVG with Tesla's legend chip grayed and no density curves (empty chart, not elided).
Resultata: isSvg=${distOnly.isSvg}, teslaGrayed=${distOnly.teslaGrayed}, hasCurve=${distOnly.hasCurve}.`,
);

console.log("qual pass: selected-but-empty helmers stay visible (grayed legend chip, empty VMT chart)");

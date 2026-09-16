import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// A log x axis draws a gridline on every 1-2-5 rung in range but NOT a label
// on every gridline: the lines never collide, the labels do. The 2026-09-07
// face change widened "1,000,000" from 46 units to 64, which shoved three
// pairs of forecast labels into each other; the density chart overlaps by as
// much as 16 units on reachable helmer toggles. So one helper draws both, and
// labels every labelStep-th rung COUNTING FROM THE DECADES: a stride of two
// rungs would alternate mantissas and strip the decade anchor off half the
// axis, so labelStep is rounded up to whole decades above 1. Tick labels are
// digits in tabular figures (style.css .month-svg), so the per-glyph bound
// axisLeftMargin stands on also models text no qual can lay out: a label
// centred on its rung is TICK_GLYPH units per glyph, and neighbours owe each
// other TICK_GAP.

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
const run = expr => vm.runInContext(expr, ctx);

// Read the width model out of the app rather than copying it: a qual that
// carried its own 8 would keep passing after someone retuned the constant.
const GLYPH = run("TICK_GLYPH");
const GAP = run("TICK_GAP");

const gridlines = svg =>
  [...svg.matchAll(/<line x1="(-?[\d.]+)"[^>]*class="month-grid"><\/line>/g)].map(m => m[1]);
const centredTicks = svg =>
  [...svg.matchAll(/<text class="month-tick" x="(-?[\d.]+)" y="[\d.]+" text-anchor="middle">([^<]+)<\/text>/g)]
    .map(m => ({ x: Number(m[1]), xText: m[1], label: m[2] }));

// --- 1. The helper: every rung gets a line, the decades keep the labels -----
// One decade of [1, 1000] holds three rungs (1, 2, 5), so ten gridlines all
// told, whatever the scale. Only the label stride changes with the scale.

const draw = unitsPerDecade =>
  run(`drawLogXTicks(1, 1000, x => ${unitsPerDecade} * Math.log10(x), fmtWhole, 14, 240, 264)`);

for (const [unitsPerDecade, expected, why] of [
  [200, ["1", "2", "5", "10", "20", "50", "100", "200", "500", "1,000"],
    `a decade is 200 units, so the tightest rung (a factor of 2) is 60.2 apart and
"1,000" needs only ${GLYPH} * 5 + ${GAP} = 48: nothing collides, so nothing is thinned`],
  [100, ["1", "10", "100", "1,000"],
    `a decade is 100 units, so the tightest rung is 30.1 apart and "1,000" needs 48:
two rungs would do, rounded up to a whole decade so every label is a decade`],
  [25, ["1", "1,000"],
    `a decade is 25 units, so the tightest rung is 7.5 apart and "1,000" needs 48:
seven rungs, rounded up to three whole decades`],
]) {
  const svg = draw(unitsPerDecade);
  const drawn = { gridlines: gridlines(svg).length, labels: centredTicks(svg).map(t => t.label) };
  assert.deepEqual(
    drawn,
    { gridlines: 10, labels: expected },
    `Replicata: call drawLogXTicks over [1, 1000] with ${unitsPerDecade} units per decade
and fmtWhole.
Expectata: all ten 1-2-5 rungs keep a gridline -- thinning takes labels, never
geometry -- and the labels are ${JSON.stringify(expected)}, because ${why}.
Resultata: ${JSON.stringify(drawn)}.`,
  );
}

// --- 2. Anti-Postel: a degenerate axis is a crash, not a bare frame ---------

for (const [what, call] of [
  ["a zero lower bound", "drawLogXTicks(0, 10, x => x, fmtWhole, 0, 1, 2)"],
  ["a negative lower bound", "drawLogXTicks(-1, 10, x => x, fmtWhole, 0, 1, 2)"],
  ["an empty range", "drawLogXTicks(10, 10, x => x, fmtWhole, 0, 1, 2)"],
  ["an inverted range", "drawLogXTicks(10, 1, x => x, fmtWhole, 0, 1, 2)"],
  ["a mapX that shrinks with x", "drawLogXTicks(1, 1000, x => -Math.log10(x), fmtWhole, 0, 1, 2)"],
]) {
  assert.throws(
    () => run(call),
    `Replicata: call drawLogXTicks with ${what}.
Expectata: an immediate throw -- a log axis needs 0 < xMin < xMax and a mapX
that grows with x, and the pitch is a divisor.
Resultata: it returned markup.`,
  );
}

// --- 3. One ladder, one thinner: both log charts draw through the helper ----

const callers = (js.match(/drawLogXTicks\(/g) || []).length;
const ladders = (js.match(/\[1, 2, 5\]/g) || []).length;
assert.deepEqual(
  { callers, ladders },
  { callers: 3, ladders: 1 },
  `Replicata: grep crashla.js for "drawLogXTicks(" and for the 1-2-5 ladder.
Expectata: the helper is defined once and called by both charts with a log x
axis (3 occurrences), and the ladder lives only in LOG_LADDER (1).
Resultata: ${callers} occurrences of the call, ${ladders} ladders.`,
);

// --- 4. Rendered: no crowded labels, and a thinned axis keeps its rhythm ----

run(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  activeSeries = monthSeriesData();
`);
const months = run("activeSeries.months.length");
assert.ok(months >= 12, `the series carries at least a year to slice; it has ${months} months`);

const charts = [];
for (const key of ["fleet", "rides", "miles"]) {
  charts.push({
    what: `fleet forecast chart, metric ${JSON.stringify(key)}`,
    svg: run(`selectedGrowthMetric = ${JSON.stringify(key)}; renderFleetForecastChart()`),
  });
}
// A single month gives the widest posteriors, hence the most decades on the
// axis; a lone ADS helmer beside a human benchmark widens it further. Those
// are the states that crowd -- "HumansUS+Tesla+Zoox" on fatality is the worst
// reachable one (23 rungs, overlapping by 16 units before this helper).
const subsets = [["HumansUS", "Tesla", "Zoox"], ["Waymo"], JSON.parse(run("JSON.stringify(ALL_HELMERS)"))];
for (const helmers of subsets) {
  run(`for (const h of ALL_HELMERS) monthHelmerEnabled[h] = ${JSON.stringify(helmers)}.includes(h);`);
  for (const key of JSON.parse(run("JSON.stringify(METRIC_KEYS)"))) {
    for (const [from, to] of [[0, months - 1], [months - 1, months - 1]]) {
      charts.push({
        what: `MPI density chart, ${helmers.join("+")}, metric ${JSON.stringify(key)}, months ${from}-${to}`,
        svg: run(`selectedMetricKey = ${JSON.stringify(key)}; renderDistributionChart(sliceSeries(activeSeries, ${from}, ${to}))`),
      });
    }
  }
}

let tightest = { gap: Infinity, what: "", pair: "" };
for (const chart of charts) {
  const onGrid = new Set(gridlines(chart.svg));
  // A tick label sits on a gridline; that is what tells the tick row apart
  // from the forecast chart's centred axis title, the only other centred
  // .month-tick in these SVGs (and the only one that is not a number).
  const ticks = centredTicks(chart.svg).filter(t => onGrid.has(t.xText));
  for (const stray of centredTicks(chart.svg).filter(t => !onGrid.has(t.xText))) {
    assert.ok(
      !/^[\d]/.test(stray.label),
      `Replicata: render the ${chart.what} and match its centred .month-tick texts
against its gridline x values.
Expectata: every numeric one sits on a gridline -- thinning drops labels, it
never nudges one off its rung.
Resultata: ${JSON.stringify(stray.label)} floats at x=${stray.x}.`,
    );
  }
  assert.ok(
    ticks.length >= Math.min(2, onGrid.size),
    `Replicata: render the ${chart.what} and count gridlines and labels.
Expectata: at least ${Math.min(2, onGrid.size)} of its ${onGrid.size} gridlines carry a
label -- thinning may not empty the axis. (A range can hold no 1-2-5 rung at
all, e.g. 101M-169M, which draws neither line nor label; hence the min.)
Resultata: ${ticks.length} labels on ${onGrid.size} gridlines.`,
  );
  for (let i = 1; i < ticks.length; i++) {
    const left = ticks[i - 1], right = ticks[i];
    const gap = (right.x - GLYPH * right.label.length / 2) - (left.x + GLYPH * left.label.length / 2);
    if (gap < tightest.gap) tightest = { gap, what: chart.what, pair: `${left.label} | ${right.label}` };
    assert.ok(
      gap >= GAP,
      `Replicata: render the ${chart.what}, model each x tick label as ${GLYPH} units
per glyph centred on its gridline, and measure the gaps between neighbours.
Expectata: every neighbouring pair clears ${GAP} units.
Resultata: ${JSON.stringify(left.label)} at x=${left.x} and ${JSON.stringify(right.label)}
at x=${right.x} leave ${gap.toFixed(1)}.`,
    );
  }
  // Rhythm: either every rung is labelled (the 1-2-5 steps are uneven by
  // nature) or the labels are whole decades apart, hence evenly spaced. An
  // every-other-rung stride would land here, alternating 200, 1,000, 5,000.
  const steps = ticks.slice(1).map((t, i) => Number((t.x - ticks[i].x).toFixed(2)));
  const spread = steps.length === 0 ? 0 : Math.max(...steps) - Math.min(...steps);
  assert.ok(
    ticks.length === onGrid.size || spread <= 0.05,
    `Replicata: render the ${chart.what} and measure the distance between
consecutive x tick labels.
Expectata: a thinned axis labels whole decades, so its labels are evenly
spaced; only an unthinned axis (every rung labelled) may be uneven.
Resultata: ${ticks.length} labels on ${onGrid.size} gridlines, steps spanning ${spread.toFixed(2)} units.`,
  );
}

console.log(`qual pass: log x axes label the decades they have room for `
  + `(${charts.length} chart states, tightest ${tightest.gap.toFixed(1)} units: ${tightest.pair}, ${tightest.what})`);

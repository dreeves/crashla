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
// centred on its rung is tickLabelWidth wide (TICK_GLYPH units per glyph,
// half a glyph more per unit letter), and neighbours owe each other TICK_GAP.

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
// A label's modelled width: the app's own bound (TICK_GLYPH per character,
// plus half a glyph per unit letter since whole values dropped their ".0" on
// 2026-10-03, audit #58), so the qual cannot drift from the constants.
const width = label => run(`tickLabelWidth(${JSON.stringify(label)})`);

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

// --- 1b. Fewer than two labels: the frame's outermost finer rungs -----------
// A narrow frame can hold one 1-2-5 rung or none (84M-91M, the Humans (US
// average) fatality band alone, holds none), and then the axis had no scale
// at all (audit #27: 92 of 770 chart states had fewer than two labels, 21 had
// none). When the 1-2-5 ladder leaves fewer than two labels, the axis labels
// instead the first and last rung of the coarsest ladder with two rungs in
// the frame: the 1-2-5 ladder itself, then one significant digit (1-9 per
// decade), then two, and so on. Each gets a gridline; the 1-2-5 gridlines stay.
// (The labels drop fmtMiles' ".0" on whole values since 2026-10-03, audit #58:
// "84M" was "84.0M".)
const drawNarrow = (lo, hi) =>
  run(`drawLogXTicks(${lo}, ${hi}, x => 68 + 816 * Math.log(x / ${lo}) / Math.log(${hi / lo}), fmtMiles, 14, 240, 264)`);
for (const [lo, hi, expected, why] of [
  [83.2e6, 91.9e6, ["84M", "91M"], "no 1-2-5 rung and one one-digit rung (90M) fall in it, so two significant digits"],
  [1.3e6, 4.4e6, ["2M", "4M"], "only 2M is a 1-2-5 rung, so one significant digit: 2M, 3M, 4M"],
  [137e3, 160.3e3, ["140K", "160K"], "no rung of one significant digit falls in it, so two"],
  [60e3, 190e3, ["60K", "100K"], "only 100K is a 1-2-5 rung; one significant digit gives 60K to 100K"],
]) {
  const svg = drawNarrow(lo, hi);
  const drawn = centredTicks(svg);
  const onGrid = new Set(gridlines(svg));
  assert.ok(
    JSON.stringify(drawn.map(t => t.label)) === JSON.stringify(expected) && drawn.every(t => onGrid.has(t.xText)),
    `Replicata: call drawLogXTicks over [${lo}, ${hi}] with 816 units across the frame and fmtMiles.
Expectata: the labels ${JSON.stringify(expected)}, each on a gridline: ${why}.
Resultata: labels ${JSON.stringify(drawn.map(t => t.label))} on gridlines ${JSON.stringify([...onGrid])}.`,
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
// reachable one (23 rungs, overlapping by 16 units before this helper). A lone
// narrow curve gives the fewest rungs (Waymo alone on the full history,
// Humans (US average) alone on fatality), and the default helmers, the
// default window and no helmer at all put rungs on the frame's right edge
// (audit #27 and #50).
const subsets = [["HumansUS", "Tesla", "Zoox"], ["Waymo"], JSON.parse(run("JSON.stringify(ALL_HELMERS)")),
  ["HumansUS"], ["HumansAV", "Tesla", "Waymo"], []];
const defaultStart = run("activeSeries.months.indexOf(DEFAULT_START_MONTH)");
for (const helmers of subsets) {
  run(`for (const h of ALL_HELMERS) monthHelmerEnabled[h] = ${JSON.stringify(helmers)}.includes(h);`);
  for (const key of JSON.parse(run("JSON.stringify(METRIC_KEYS)"))) {
    for (const [from, to] of [[0, months - 1], [months - 1, months - 1], [defaultStart, months - 1]]) {
      charts.push({
        what: `MPI density chart, ${helmers.join("+") || "no helmer"}, metric ${JSON.stringify(key)}, months ${from}-${to}`,
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
  // At least two labels, whatever the frame (tightened 2026-10-03, audit
  // #27): the old floor of min(2, gridlines) let a frame holding one 1-2-5
  // rung or none (101M-169M, or 84M-91M) draw a single label or a bare axis.
  assert.ok(
    ticks.length >= 2,
    `Replicata: render the ${chart.what} and count gridlines and labels.
Expectata: at least two labelled gridlines, so the axis has a readable scale
-- a frame with fewer than two 1-2-5 rungs labels the outermost rungs of a
finer ladder instead.
Resultata: ${ticks.length} labels on ${onGrid.size} gridlines.`,
  );
  // Labels stay inside the SVG, keeping TICK_GAP from its edges as they do
  // from each other (audit #50: "200.0M" centred within half a label of the
  // frame's right edge ran up to 8 units past the 900-unit SVG, which clips).
  // The gap is also the slack for faces wider than the glyph model: Firefox at
  // phone size draws "200.0M" 61 units wide, 6.4 past the model on each side.
  const svgW = Number(chart.svg.match(/viewBox="0 0 ([\d.]+) /)[1]);
  for (const t of ticks) {
    const half = width(t.label) / 2;
    assert.ok(
      t.x - half >= GAP && t.x + half <= svgW - GAP,
      `Replicata: render the ${chart.what} and model each x tick label (tickLabelWidth: ${GLYPH} units per glyph, half a glyph more per unit letter) centred on its gridline.
Expectata: every label lies inside the ${svgW}-unit SVG with ${GAP} units to spare on each side.
Resultata: ${JSON.stringify(t.label)} spans ${(t.x - half).toFixed(1)}-${(t.x + half).toFixed(1)}.`,
    );
  }
  for (let i = 1; i < ticks.length; i++) {
    const left = ticks[i - 1], right = ticks[i];
    const gap = (right.x - width(right.label) / 2) - (left.x + width(left.label) / 2);
    if (gap < tightest.gap) tightest = { gap, what: chart.what, pair: `${left.label} | ${right.label}` };
    assert.ok(
      gap >= GAP,
      `Replicata: render the ${chart.what}, model each x tick label (tickLabelWidth:
${GLYPH} units per glyph, half a glyph more per unit letter) centred on its gridline, and measure the gaps between neighbours.
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

// --- 5. Monthly axes: the label stride follows the label width -------------
// drawSingleMonthAxes used a 1/2/3 stride ladder, so any window of 43+ months
// (the full history is 62) drew "YYYY-MM" labels ~38 units apart under
// 56-unit glyph runs on the cross-helmer MPI chart and the Waymo VMT chart
// (found 2026-09-26). The stride now comes from the same per-glyph model as
// the log axes: TICK_GLYPH per glyph, TICK_GAP clear between neighbours. The
// last month is always labelled.
const monthTicks = svg =>
  [...svg.matchAll(/<text class="month-tick" x="(-?[\d.]+)" y="[\d.]+" text-anchor="middle">(\d{4}-\d{2})<\/text>/g)]
    .map(m => ({ x: Number(m[1]), label: m[2] }));
run(`selectedMetricKey = "all"; for (const h of ALL_HELMERS) monthHelmerEnabled[h] = ["HumansAV", "Tesla", "Waymo"].includes(h);`);
const lastMonth = run(`activeSeries.months[${months - 1}]`);
let widest = { clear: Infinity, len: 0 };
for (let len = 1; len <= months; len++) {
  const svg = run(`renderAllHelmersMpiChart(sliceSeries(activeSeries, ${months - len}, ${months - 1}))`);
  const ticks = monthTicks(svg);
  assert.ok(ticks.length >= 1 && ticks.at(-1).label === lastMonth,
    `Replicata: render the cross-helmer MPI chart on a ${len}-month window ending ${lastMonth}.
Expectata: the last month is labelled.
Resultata: labels ${JSON.stringify(ticks.map(t => t.label))}.`);
  for (let i = 1; i < ticks.length; i++) {
    const clear = ticks[i].x - ticks[i - 1].x - GLYPH * ticks[i - 1].label.length;
    if (clear < widest.clear) widest = { clear, len };
    assert.ok(clear >= GAP - 1e-6,
      `Replicata: render the cross-helmer MPI chart on a ${len}-month window and measure neighbouring month labels under the per-glyph model (${GLYPH}/glyph, ${GAP} clear).
Expectata: ${ticks[i - 1].label} and ${ticks[i].label} keep at least ${GAP} units clear.
Resultata: ${clear.toFixed(1)} units (labels ${(ticks[i].x - ticks[i - 1].x).toFixed(1)} apart).`);
  }
}
console.log(`qual pass: monthly axes keep >= ${GAP} units between month labels on every window length 1..${months} (tightest ${widest.clear.toFixed(1)} at ${widest.len} months)`);

// --- 5b. ... evenly spaced, counted back from the always-drawn last label ----
// The stride used to count from the first month and drop any stepped label
// within a stride of the last one, so the gap before the last label ran
// longer than the rest: on a phone the default window's VMT charts read
// 2025-06, 2025-11, 2026-08 (5 months, then 9; audit 2026-10-04 #37), the
// MPI chart 4, 4, 6. Counted back from the last month, every gap is one
// stride. Checked on the MPI, VMT and growth charts at the desktop width and
// at a phone's (a 390 px viewport leaves the charts 366 units).
const monthIndex = (labels, order) => labels.map(l => order.indexOf(l));
const uneven = [];
for (const viewW of [900, 366]) {
  run(`chartViewW = ${viewW}`);
  for (let len = 1; len <= months; len++) {
    const sliced = `sliceSeries(activeSeries, ${months - len}, ${months - 1})`;
    const order = JSON.parse(run(`JSON.stringify(${sliced}.months)`));
    for (const [what, svg] of [
      ["MPI chart", run(`renderAllHelmersMpiChart(${sliced})`)],
      ["Waymo VMT chart", run(`renderHelmerMonthlyChart(${sliced}, "Waymo")`)],
    ]) {
      const idx = monthIndex(monthTicks(svg).map(t => t.label), order);
      const steps = idx.slice(1).map((v, i) => v - idx[i]);
      if (idx.at(-1) !== order.length - 1 || new Set(steps).size > 1) uneven.push(`${viewW} units, ${len}-month window, ${what}: labels ${JSON.stringify(monthTicks(svg).map(t => t.label))}`);
    }
  }
  const growthMonths = JSON.parse(run(`JSON.stringify(Array.from({length: fleetMonthIndex(FLEET_TS_END_MONTH) + 1}, (_, i) => fleetMonthIso(i)))`));
  for (const key of ["fleet", "rides", "miles"]) {
    const svg = run(`selectedGrowthMetric = ${JSON.stringify(key)}; renderFleetTimeSeriesChart()`);
    const idx = monthIndex(monthTicks(svg).map(t => t.label), growthMonths);
    const steps = idx.slice(1).map((v, i) => v - idx[i]);
    if (idx.at(-1) !== growthMonths.length - 1 || new Set(steps).size > 1) uneven.push(`${viewW} units, growth chart (${key}): labels ${JSON.stringify(monthTicks(svg).map(t => t.label))}`);
  }
}
run(`chartViewW = CHART_MAX_W; selectedGrowthMetric = "fleet"`);
assert.deepEqual(uneven, [],
  `Replicata: render the MPI-over-time chart and the Waymo VMT chart on every window length 1..${months} ending at the last month, and the growth chart for each metric, at ${900} and 366 chart units (desktop; a 390 px phone), and read their month labels.
Expectata: the last month labelled, and every gap between neighbouring labels the same number of months.
Resultata: ${uneven.length} uneven axes, e.g.:
${uneven.slice(0, 8).join("\n")}`);
console.log(`qual pass: monthly axes label evenly, counting back from the last month, on the MPI, VMT and growth charts at 900 and 366 units`);

// --- 5c. A one-month window's single column sits at the plot's midpoint -----
// scaleLinear mapped the zero span of a one-month series to its range's
// start, so every dot and bar drew at the left inset with ~90% of the plot
// empty to its right (audit 2026-10-04 #70). The month columns span the
// horizontal axis less an inset at each end, so the midpoint of the columns
// is the axis line's.
const offCentre = [];
run(`for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true; selectedMetricKey = "all";`);
for (const viewW of [900, 366]) {
  run(`chartViewW = ${viewW}`);
  for (const [what, svg] of [
    ["MPI chart", run(`renderAllHelmersMpiChart(sliceSeries(activeSeries, ${months - 1}, ${months - 1}))`)],
    ...["Tesla", "Waymo", "Zoox"].map(h => [`${h} VMT chart`, run(`renderHelmerMonthlyChart(sliceSeries(activeSeries, ${months - 1}, ${months - 1}), ${JSON.stringify(h)})`)]),
  ]) {
    const axis = [...svg.matchAll(/<line class="month-axis" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)">/g)]
      .map(m => m.slice(1).map(Number)).find(([, y1, , y2]) => y1 === y2);
    const mid = (axis[0] + axis[2]) / 2;
    const dots = [...svg.matchAll(/<circle class="month-dot" cx="([\d.]+)"/g)].map(m => Number(m[1]));
    const labels = monthTicks(svg).map(t => t.x);
    if (dots.length === 0 || [...dots, ...labels].some(x => Math.abs(x - mid) > 0.01)) offCentre.push(`${viewW} units, ${what}: axis ${axis[0]}-${axis[2]} (midpoint ${mid}), dots at ${JSON.stringify([...new Set(dots)])}, month label at ${JSON.stringify(labels)}`);
  }
}
run(`chartViewW = CHART_MAX_W; for (const h of ALL_HELMERS) monthHelmerEnabled[h] = ["HumansAV", "Tesla", "Waymo"].includes(h);`);
assert.deepEqual(offCentre, [],
  `Replicata: render the MPI-over-time chart (all six helmers, All incidents) and the three VMT charts on the one-month window ${run("activeSeries.months.at(-1)")}, at 900 and 366 units.
Expectata: every dot and the month label at the horizontal axis's midpoint.
Resultata: ${offCentre.join("\n")}`);
console.log("qual pass: a one-month window's column sits at the middle of the MPI and VMT charts");

// --- 6. Linear y axes tick on the 1-2-5 ladder ------------------------------
// linearTicks put five ticks at quarters of the window maximum, so the labels
// were unround and mixed: Tesla's cumulative VMT read 0 / 946.5K / 1.9M /
// 2.8M / 3.8M, Waymo's monthly 0 / 6.4M / 12.8M / 19.2M / 25.7M (audit
// 2026-10-04 #71). The ticks are now the multiples of the 1-2-5 step nearest
// a quarter of the maximum in log terms (rung 1, 2 or 5 below the geometric
// means sqrt 2, sqrt 10, sqrt 50 of neighbouring rungs, as d3's tick
// increment chooses), up to the first one at or above the maximum, and the
// axis tops out at that tick.
const ticksOf = (max, count) => JSON.parse(run(`JSON.stringify(linearTicks(0, ${max}, ${count}))`));
const tickTable = [
  [3786000, [0, 1e6, 2e6, 3e6, 4e6]],                  // Tesla cumulative VMT (1M step)
  [25.7e6, [0, 5e6, 10e6, 15e6, 20e6, 25e6, 30e6]],     // Waymo monthly VMT (5M step)
  [4e6, [0, 1e6, 2e6, 3e6, 4e6]],                       // a maximum on a rung tops out there
  [1.3e6, [0, 500e3, 1e6, 1.5e6]],                     // a quarter (325K) is nearer 500K than 200K in log terms
  [1e6, [0, 200e3, 400e3, 600e3, 800e3, 1e6]],          // a quarter (250K) is nearest the 2 rung
  [0, [0]],                                             // no data: the floor alone
];
for (const [max, want] of tickTable) {
  const got = ticksOf(max, 4);
  assert.deepEqual(got, want,
    `Replicata: linearTicks(0, ${max}, 4).
Expectata: ${JSON.stringify(want)} (multiples of the 1-2-5 step nearest ${max / 4} in log terms, up to the first at or above ${max}).
Resultata: ${JSON.stringify(got)}.`);
}
const UNIT = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const valueOf = label => { const m = /^([\d,.]+)([KMBT]?)$/.exec(label); return m ? Number(m[1].replace(/,/g, "")) * UNIT[m[2]] : NaN; };
const yLabels = svg => [...svg.matchAll(/<text class="month-tick" x="[\d.]+" y="([\d.]+)" text-anchor="end">([^<]+)<\/text>/g)]
  .map(m => ({ y: Number(m[1]), value: valueOf(m[2]), label: m[2] }));
const unround = [];
for (const [what, setup, render] of [
  ["Tesla cumulative VMT, full history", "vmtCumulative = true", `renderHelmerMonthlyChart(activeSeries, "Tesla")`],
  ["Waymo monthly VMT, full history", "vmtCumulative = false", `renderHelmerMonthlyChart(activeSeries, "Waymo")`],
  ["Waymo cumulative VMT, full history", "vmtCumulative = true", `renderHelmerMonthlyChart(activeSeries, "Waymo")`],
  ["Zoox monthly VMT, default window", "vmtCumulative = false", `renderHelmerMonthlyChart(sliceSeries(activeSeries, ${defaultStart}, ${months - 1}), "Zoox")`],
  ["MPI chart, default window", `vmtCumulative = false; selectedMetricKey = "atfault"`, `renderAllHelmersMpiChart(sliceSeries(activeSeries, ${defaultStart}, ${months - 1}))`],
  ["MPI chart, full history", `selectedMetricKey = "all"`, `renderAllHelmersMpiChart(activeSeries)`],
]) {
  run(setup);
  const ys = yLabels(run(render));
  const step = ys[1].value - ys[0].value;
  const rung = step / Math.pow(10, Math.floor(Math.log10(step)));
  const evenly = ys.every((t, i) => Math.abs(t.value - i * step) <= 1e-9 * step);
  const top = ys.at(-1);
  if (ys[0].value !== 0 || ![1, 2, 5].some(r => Math.abs(rung - r) < 1e-9) || !evenly || top.y !== 14 + 4)
    unround.push(`${what}: y labels ${JSON.stringify(ys.map(t => t.label))}, top label at y=${top.y} (the plot's top edge is 14, a label sits 4 below its tick)`);
}
run(`vmtCumulative = false; selectedMetricKey = "all"`);
assert.deepEqual(unround, [],
  `Replicata: render the VMT charts (monthly and cumulative) and the MPI-over-time chart and read their y labels.
Expectata: 0 and evenly spaced multiples of a 1-2-5 step (1, 2 or 5 times a power of ten), the last at the plot's top edge.
Resultata: ${unround.join("\n")}`);
console.log(`qual pass: linear y axes tick on the 1-2-5 ladder up to the first rung at or above their maximum (${tickTable.length} cases, ${6} charts)`);

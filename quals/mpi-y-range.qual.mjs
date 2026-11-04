import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// The MPI-over-time chart's y range (2026-11-03). The axis tops out at the
// first rung of its tick ladder at or above the largest posterior median
// among the chart's dots, every month's median counting alike whatever the
// month's completeness: every dot sits on-scale at its median, and an error
// bar or fan band that runs past the top is cut at the plot's edge. That is
// the human's choice of 2026-11-03 ("Medians only"; the ask was good ranges
// without a new if-statement).
// Replicata: show the default view (Humans (AV cities), Tesla and Waymo,
// 2025-06 to the data-through month 2026-09) on At-fault injury.
// Expectata: an axis scaled to the dots, the largest median (Waymo 2026-05's
// 74.1M) in its top rung (80M).
// Resultata, until 2026-11-03: the axis topped out at 500M, all 48 dots in
// the bottom 15% of the plot. A fully received month lifted the axis to its
// top effective miles over its incident count wherever that was finite, and
// Waymo 2026-05's at-fault injury count is a fault mass of 0.05, so its 20x
// the month's miles set the top. Only quals/monthly-arrival-lag.qual.mjs
// section 6 checked the rule (40 charts, restated the same day); this qual
// checks it, and where each mark is drawn against it, in every slider window.
//
// On every metric, in every slider window (start <= end, 2,016 windows) with
// the default lines, and with every line shown in every window ending at the
// data-through month and every one-month window (a chart with no line shown,
// checked in two windows, has its axis labelled 0 alone and no marks):
//   1. the y ticks are 0 and evenly spaced rungs, the top one the first at or
//      above the largest posterior median among the chart's dots;
//   2. every shown line-month with a posterior has one tooltip target, one
//      dot and one error bar, and every dot sits at its median's position on
//      the rendered axis, unclamped (cy), its target at the same position;
//   3. every error bar runs from its 95% credible interval's low edge to its
//      high edge, each cut at the plot's edges (clamped);
//   4. every fan band's top runs along one credible level's high edges and
//      its bottom back along that level's low edges, each clamped, and each
//      of a line's levels is drawn once over each of its runs of consecutive
//      months with a posterior;
//   5. every line's path runs through its dots of the months with an
//      incident count other than 0 (a human cohort's count is null), in
//      month order, and starts a new stroke after a month without one.
// The medians, credible intervals and incident counts are the series' own
// (monthSeriesData, sliced to the window as the page slices it): this qual
// checks how the chart draws them, not the posteriors themselves. Positions
// are read against the rendered axis: the y-axis line's ends are the plot's
// top and bottom, its top the top tick's value and its bottom 0.

const ctx = vm.createContext({ console, Math, Number,
  document: { getElementById() { return null; },
    createElement() { return { set textContent(v) { this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }; } } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = expr => vm.runInContext(expr, ctx);
run(`incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  var yRangeSeries = monthSeriesData();`);
const app = JSON.parse(run(`JSON.stringify({
  months: yRangeSeries.months, metrics: METRIC_DEFS.map(m => m.key), levels: CI_FAN_LEVELS.length,
  lines: ALL_HELMERS, defaultLines: ALL_HELMERS.filter(h => monthHelmerEnabled[h]), defaultStart: DEFAULT_START_MONTH,
  colors: HELMER_COLORS, prefix: Object.fromEntries(ALL_HELMERS.map(h => [h, seriesMarkName(h, "")])) })`));
// One chart: its markup and, for each shown line, each month of the window
// with a posterior for the metric (its index in the window, median, count and
// credible intervals, narrowest first, as CI_FAN_LEVELS orders them).
const chartOf = run(`(key, a, b, lines) => {
  const saved = [selectedMetricKey, monthHelmerEnabled];
  selectedMetricKey = key;
  monthHelmerEnabled = Object.fromEntries(ALL_HELMERS.map(h => [h, lines.includes(h)]));
  const sl = sliceSeries(yRangeSeries, a, b);
  const html = renderAllHelmersMpiChart(sl);
  const shown = includedHelmers();
  const pts = [];
  for (const h of shown) helmerMonthRows(sl, h).forEach((row, j) => {
    const mpi = row && row.mpiByMetric[key];
    if (mpi) pts.push({ line: h, month: sl.months[j], j, median: mpi.mpiMedian, k: mpi.incidentCount,
      bands: mpi.bands.map(band => [band.lo, band.hi]) });
  });
  [selectedMetricKey, monthHelmerEnabled] = saved;
  return { html, pts, shown };
}`);
assert.ok(new Set(Object.values(app.colors)).size === app.lines.length && app.levels >= 1,
  `Replicata: read HELMER_COLORS and CI_FAN_LEVELS. Expectata: one colour per line (${app.lines.length}) and at least one credible level. Resultata: ${JSON.stringify(app.colors)}, ${app.levels} levels.`);

const UNIT = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const tickValue = label => { const m = /^([\d,.]+)([KMBT]?)$/.exec(label); return m ? Number(m[1].replace(/,/g, "")) * UNIT[m[2]] : NaN; };
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const styleOf = (style, prop) => ((new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(style) || [])[1] || "").trim();
const lineOfColor = Object.fromEntries(Object.entries(app.colors).map(([line, color]) => [color, line]));
const vertices = d => [...d.matchAll(/([ML]) (-?[\d.]+) (-?[\d.]+)/g)].map(m => ({ cmd: m[1], x: Number(m[2]), y: Number(m[3]) }));
const miles = v => Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : String(v);
const NEAR = 0.006; // a mark's coordinates are printed to 2 decimals (dots' cy in full)

const problems = { frame: [], top: [], dots: [], bars: [], bands: [], paths: [] };
const counts = Object.fromEntries(Object.keys(problems).map(kind => [kind, 0]));
const note = (kind, at, text) => { counts[kind]++; if (problems[kind].length < 50) problems[kind].push(`${at}: ${text}`); };
let charts = 0, marks = 0, cutBars = 0, bars = 0;

function check(key, a, b, lines, view) {
  const c = chartOf(key, a, b, lines);
  const at = `${key}, ${app.months[a]}..${app.months[b]}, ${view}`;
  charts++;
  const axis = [...c.html.matchAll(/<line class="month-axis" x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)">/g)]
    .map(m => m.slice(1).map(Number)).filter(([x1, , x2]) => x1 === x2);
  const ticks = [...c.html.matchAll(/<text class="month-tick" x="[^"]*" y="[^"]*" text-anchor="end">([^<]*)<\/text>/g)]
    .map(m => tickValue(m[1])).sort((p, q) => p - q);
  // A chart with no posterior (no line shown, or none with a posterior in
  // the window) has no median to scale to: its axis is labelled 0 alone and
  // it draws no marks.
  if (c.pts.length === 0) {
    if (JSON.stringify(ticks) !== "[0]" || /class="month-(?:dot|err)"/.test(c.html))
      note("frame", at, `no line-month with a posterior, y ticks ${JSON.stringify(ticks)} and ${(c.html.match(/class="month-(?:dot|err)"/g) || []).length} dots and error bars, where 0 alone and none are due`);
    return;
  }
  if (axis.length !== 1 || !(axis[0][1] < axis[0][3]) || ticks.length < 2 || ticks.some(t => !Number.isFinite(t))) {
    note("frame", at, `${axis.length} vertical axis lines (${JSON.stringify(axis)}), y ticks ${JSON.stringify(ticks)}, ${c.pts.length} line-months with a posterior`);
    return;
  }
  const [plotTop, plotBottom] = [axis[0][1], axis[0][3]];
  const topValue = ticks.at(-1);
  const pos = v => plotBottom + (plotTop - plotBottom) * v / topValue;
  const clamped = v => Math.max(plotTop, Math.min(plotBottom, pos(v)));

  // 1. The top: the first rung at or above the largest median.
  const largest = c.pts.reduce((best, p) => (p.median > best.median ? p : best));
  const step = ticks[1] - ticks[0];
  const ladder = ticks[0] === 0 && step > 0 && ticks.every((t, i) => Math.abs(t - i * step) <= 1e-9 * step);
  const due = Math.ceil(largest.median / step - 1e-9) * step;
  if (!(ladder && Math.abs(topValue - due) <= 1e-9 * step))
    note("top", at, `y ticks ${ticks.map(miles).join(", ")}, where ${ladder ? `the ${miles(step)} ladder's first rung at or above the largest median, ${largest.line} ${largest.month}'s ${miles(largest.median)}, is ${miles(due)}` : "0 and evenly spaced rungs are due"}`);

  // The marks, each matched to its line by colour and to its month by x (the
  // line's tooltip targets give each month's x).
  const targets = [...c.html.matchAll(/<circle cx="([^"]*)" cy="([^"]*)" r="[^"]*" fill="none" data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"><\/circle>/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), tip: decode(m[3]), name: decode(m[4]) }))
    .map(t => ({ ...t, line: c.shown.find(h => t.name === app.prefix[h] + t.tip), month: t.tip.split("\n")[0] }));
  const want = new Map(c.pts.map(p => [`${p.line} ${p.month}`, p]));
  const xOf = new Map(), atX = new Map();
  for (const t of targets) {
    const id = `${t.line} ${t.month}`;
    if (t.line === undefined || !want.has(id) || xOf.has(id) || atX.has(`${t.line}|${t.x.toFixed(2)}`)) { note("dots", at, `a tooltip target (${JSON.stringify(t.name.slice(0, 60))}) for no shown line-month with a posterior, for one twice, or in another month's column`); continue; }
    xOf.set(id, t.x);
    atX.set(`${t.line}|${t.x.toFixed(2)}`, want.get(id));
    if (Math.abs(t.y - pos(want.get(id).median)) > NEAR) note("dots", at, `${id}'s tooltip target at y ${t.y}, where its median ${miles(want.get(id).median)} is at ${pos(want.get(id).median).toFixed(3)}`);
  }
  for (const id of want.keys()) if (!xOf.has(id)) note("dots", at, `${id} has no tooltip target`);
  // A mark's line-month: its line's target in the same column (marks print x
  // to 2 decimals or in full, targets to 2 decimals).
  const monthAt = (line, x) => atX.get(`${line}|${x.toFixed(2)}`) ?? null;

  // 2. Dots: at their medians, unclamped.
  const dots = [...c.html.matchAll(/<circle class="month-dot" cx="([^"]*)" cy="([^"]*)" r="[^"]*" style="([^"]*)"><\/circle>/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), line: lineOfColor[styleOf(m[3], "stroke")] }));
  const dotSeen = new Set();
  for (const d of dots) {
    const p = monthAt(d.line, d.x);
    if (p === null || dotSeen.has(`${p.line} ${p.month}`)) { note("dots", at, `a dot (line ${d.line}, x ${d.x}) on no shown line-month with a posterior, or on one twice`); continue; }
    dotSeen.add(`${p.line} ${p.month}`); marks++;
    if (Math.abs(d.y - pos(p.median)) > 1e-6) note("dots", at, `${p.line} ${p.month}'s dot at y ${d.y}, where its median ${miles(p.median)} is at ${pos(p.median).toFixed(6)} on the axis (0 at ${plotBottom}, ${miles(topValue)} at ${plotTop})`);
  }
  if (dotSeen.size !== want.size) note("dots", at, `${dotSeen.size} line-months with a dot of ${want.size} with a posterior`);

  // 3. Error bars: the 95% credible interval (the widest level), clamped.
  const errs = [...c.html.matchAll(/<line class="month-err" x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)" style="([^"]*)"><\/line>/g)]
    .map(m => ({ x: Number(m[1]), x2: Number(m[3]), y1: Number(m[2]), y2: Number(m[4]), line: lineOfColor[styleOf(m[5], "stroke")] }));
  const barSeen = new Set();
  for (const e of errs) {
    const p = monthAt(e.line, e.x);
    if (p === null || e.x2 !== e.x || barSeen.has(`${p.line} ${p.month}`)) { note("bars", at, `an error bar (line ${e.line}, x ${e.x}-${e.x2}) on no shown line-month with a posterior, or on one twice`); continue; }
    barSeen.add(`${p.line} ${p.month}`); marks++; bars++;
    const [lo, hi] = p.bands.at(-1);
    if (Math.abs(e.y2 - plotTop) <= NEAR) cutBars++;
    if (Math.abs(e.y1 - clamped(lo)) > NEAR || Math.abs(e.y2 - clamped(hi)) > NEAR)
      note("bars", at, `${p.line} ${p.month}'s error bar from y ${e.y1} to ${e.y2}, where its 95% interval ${miles(lo)}-${miles(hi)} is due from ${clamped(lo).toFixed(2)} to ${clamped(hi).toFixed(2)} (the plot runs from ${plotTop} to ${plotBottom})`);
  }
  if (barSeen.size !== want.size) note("bars", at, `${barSeen.size} line-months with an error bar of ${want.size} with a posterior`);

  // 4. Fan bands: each path one level's high edges left to right, then its
  // low edges back; one opacity per level, so a line's paths of one opacity
  // are one level's segments.
  const fans = [...c.html.matchAll(/<path d="([^"]*)" style="([^"]*)"><\/path>/g)]
    .map(m => ({ v: vertices(m[1]), closed: m[1].trim().endsWith("Z"), line: lineOfColor[styleOf(m[2], "fill")], group: `${styleOf(m[2], "fill")} ${styleOf(m[2], "opacity")}` }));
  const groups = new Map();
  for (const f of fans) {
    const n = f.v.length / 2;
    const months = Number.isInteger(n) && n >= 1 ? f.v.slice(0, n).map(q => monthAt(f.line, q.x)) : [null];
    // One run of consecutive months, left to right, then back.
    const shape = f.closed && months.every((p, i) => p !== null && (i === 0 || p.j === months[i - 1].j + 1))
      && f.v.slice(n).every((q, i) => Math.abs(q.x - f.v[n - 1 - i].x) <= NEAR);
    const levels = !shape ? [] : [...Array(app.levels).keys()].filter(L =>
      months.every((p, i) => Math.abs(f.v[i].y - clamped(p.bands[L][1])) <= NEAR && Math.abs(f.v[2 * n - 1 - i].y - clamped(p.bands[L][0])) <= NEAR));
    if (levels.length === 0) { note("bands", at, `a fan band of ${f.line} (${f.group}) whose ${f.v.length} vertices are not one run of months whose top follows one credible level's clamped high edges and whose bottom follows its low edges`); continue; }
    const g = groups.get(f.group) || { line: f.line, levels: new Set(levels), runs: [] };
    g.levels = new Set([...g.levels].filter(L => levels.includes(L)));
    g.runs.push(months.map(p => p.j).join(","));
    groups.set(f.group, g);
  }
  for (const line of c.shown) {
    const own = [...groups.values()].filter(g => g.line === line);
    // The line's months with a posterior, as maximal runs of consecutive
    // months: each level is drawn as those runs, once each.
    const runs = [];
    for (const p of c.pts.filter(q => q.line === line)) {
      if (runs.length > 0 && runs.at(-1).at(-1) === p.j - 1) runs.at(-1).push(p.j); else runs.push([p.j]);
    }
    const due = runs.map(r => r.join(",")).sort().join(" ");
    // A perfect matching of the line's groups to the levels (a human cohort's
    // levels coincide, so any one does there).
    const assign = (i, used) => i === own.length || [...own[i].levels].some(L => !used.has(L) && assign(i + 1, new Set([...used, L])));
    if (own.length !== (runs.length === 0 ? 0 : app.levels) || !assign(0, new Set()) || own.some(g => [...g.runs].sort().join(" ") !== due))
      note("bands", at, `${line}'s fan bands: ${own.length} levels drawn (${runs.length === 0 ? 0 : app.levels} due), as runs ${JSON.stringify(own.map(g => g.runs))}, where each level's runs are its months with a posterior, ${JSON.stringify(due)}`);
  }

  // 5. Line paths: through the dots of the months with a count other than 0.
  const paths = [...c.html.matchAll(/<path class="month-mpi-all-line" d="([^"]*)" style="([^"]*)"><\/path>/g)]
    .map(m => ({ v: vertices(m[1]), line: lineOfColor[styleOf(m[2], "stroke")] }));
  for (const line of c.shown) {
    const own = paths.filter(q => q.line === line);
    const drawn = c.pts.filter(p => p.line === line && p.k !== 0);
    const js = new Set(drawn.map(p => p.j));
    const v = own.length === 1 ? own[0].v : [];
    const ok = own.length === 1 && v.length === drawn.length && v.every((q, i) =>
      Math.abs(q.x - xOf.get(`${line} ${drawn[i].month}`)) <= NEAR && Math.abs(q.y - clamped(drawn[i].median)) <= NEAR
      && q.cmd === (js.has(drawn[i].j - 1) ? "L" : "M"));
    if (!ok) note("paths", at, `${line}: ${own.length} line paths with ${v.length} vertices (${v.map(q => q.cmd).join("")}), where one through its ${drawn.length} dots of months with a count other than 0 is due, a new stroke after each month without one`);
  }
}

const last = app.months.length - 1;
for (const key of app.metrics) for (let a = 0; a <= last; a++) for (let b = a; b <= last; b++)
  check(key, a, b, app.defaultLines, "the default lines");
const everyLineWindows = [...Array(last + 1).keys()].flatMap(a => (a === last ? [[a, a]] : [[a, last], [a, a]]));
for (const key of app.metrics) for (const [a, b] of everyLineWindows) check(key, a, b, app.lines, "every line");
// No line shown: the default window and the data-through month alone.
const defaultStart = app.months.indexOf(app.defaultStart);
assert.ok(defaultStart >= 0, `Replicata: find DEFAULT_START_MONTH among the series' months. Expectata: present. Resultata: ${app.defaultStart} not in ${app.months[0]}..${app.months[last]}.`);
for (const key of app.metrics) for (const [a, b] of [[defaultStart, last], [last, last]]) check(key, a, b, [], "no line");

const windowCount = (last + 1) * (last + 2) / 2;
const replicata = `Replicata: render the MPI-over-time chart on each of the ${app.metrics.length} metrics in every slider window (${windowCount}) with the default lines (${app.defaultLines.join(", ")}), with every line in the ${everyLineWindows.length} windows ending at ${app.months[last]} or one month long, and with no line in the default window and in ${app.months[last]} alone: ${charts} charts.`;
assert.ok(counts.frame === 0, `${replicata}
Expectata: in each chart with a line-month with a posterior, one vertical y-axis line and at least two y ticks; in each without one, the y axis labelled 0 alone and no dot or error bar.
Resultata: ${counts.frame} charts wrong: ${problems.frame.slice(0, 6).join("; ")}.`);
assert.ok(counts.top === 0, `${replicata}
Expectata: in each, y ticks of 0 and evenly spaced rungs, the top one the first at or above the largest posterior median among the chart's dots, whatever each month's completeness (an error bar or fan band running past it is cut at the plot's edge).
Resultata: ${counts.top} of ${charts} charts wrong: ${problems.top.slice(0, 6).join("; ")}.`);
assert.ok(counts.dots === 0, `${replicata}
Expectata: one tooltip target and one dot per shown line-month with a posterior, each dot (and its target) at its median's position on the rendered axis, none clamped at the plot's edge.
Resultata: ${counts.dots} problems: ${problems.dots.slice(0, 6).join("; ")}.`);
assert.ok(counts.bars === 0, `${replicata}
Expectata: one error bar per shown line-month with a posterior, from its 95% credible interval's low edge to its high edge, each at its position on the rendered axis, cut at the plot's top and bottom.
Resultata: ${counts.bars} problems: ${problems.bars.slice(0, 6).join("; ")}.`);
assert.ok(counts.bands === 0, `${replicata}
Expectata: each shown line's fan bands, one per credible level, each level drawn as the line's runs of consecutive months with a posterior, its top along the level's high edges and its bottom back along its low edges, clamped to the plot.
Resultata: ${counts.bands} problems: ${problems.bands.slice(0, 6).join("; ")}.`);
assert.ok(counts.paths === 0, `${replicata}
Expectata: one line path per shown line, through its dots of the months with an incident count other than 0 in month order, a new stroke after each month without one.
Resultata: ${counts.paths} problems: ${problems.paths.slice(0, 6).join("; ")}.`);
console.log(`qual pass: on ${charts} MPI charts (every metric, every slider window with the default lines, every line in ${everyLineWindows.length} windows, no line in 2) the y axis tops out at the first rung at or above the largest median; ${marks} dots and error bars sit at their medians and clamped 95% intervals (${cutBars} of ${bars} error bars cut at the top), and every fan band and line path follows its posteriors`);

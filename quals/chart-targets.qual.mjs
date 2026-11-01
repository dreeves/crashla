// Chart tooltip targets and what their tooltips say (2026-10-03, audit #28,
// #51, #59, #60, #63). In every chart:
//  - Each mark's tooltip target is an invisible hit circle (fill="none"),
//    drawn after every visible glyph, so a glyph never covers a target (#28:
//    VMT dots, distribution markers and fleet points were their own 2.7-3.3
//    CSS px targets on a phone; the VMT chart had no hit circle for its dots).
//  - A hit circle's radius is half the distance to the nearest other target
//    more than 4 units away, at most 12 units, and at least 4 units unless
//    that would bring its edge within 2 units of that neighbour's centre
//    (then nearest - 2): big enough for a finger where there is room (12
//    units is a 24 CSS px target at the charts' phone scale), and never so
//    big that it takes over a neighbour's centre (#63: an r=8 circle drawn
//    later stole the tooltip of a dot 6.4 units away that it did not touch;
//    the 2026-10-23 (later 4) radius fix: WebKit's SVG hit area runs
//    ~0.15-0.2 CSS px past a circle's drawn edge, so a 4-unit circle 4.15
//    units from a neighbour took the neighbour's centre). So a pointer at a
//    target's centre lands on that target, unless another target's centre
//    lies within 4 units of it (marks drawn on top of each other, which no
//    radius can separate). Such marks do not shrink each other's targets:
//    counted, they held the default view's six distribution markers on a
//    phone (each Peak beside its Median) to 8 CSS px targets with no other
//    mark near (review, 2026-10-03).
// The charts are drawn as the page draws them, the VMT charts continuing into
// the ghost months (ghostVmtRows, loaded as init loads it), each ADS line's
// own chart (ADS_SERIES: Tesla's no-monitor line too) and the combined VMT
// chart among them. Until 2026-10-31 this drew no ghost month, no combined
// chart and no no-monitor chart, so ghost dots drawn over the targets passed
// it (audit 2026-10-30, QT-11).
// In the VMT charts:
//  - a dot's tooltip gives its range, so a range end hidden under its dot
//    (Tesla's sub-pixel 2025 bands) is still readable (#28);
//  - the two range ends say which end they are (#59);
//  - in the cumulative view the dot's incident count is the running total
//    through that month, on the basis of the cumulative miles beside it (#59:
//    "318,066,136 miles / 10 incidents" paired all-time miles with August's
//    10);
//  - a partially received month's count says it is partial: reports
//    received through the cutoff, and roughly what share of the month's
//    incidents they hold (#60: "20,759,027 miles / 10 incidents" read as a
//    month with a tenth of the usual crash rate). That is the data-through
//    month and, since 2026-10-04, each month inside a helmer's extra
//    Monthly-report lag (data/slurp.py MONTHLY_ARRIVAL_LAG: Zoox's 2026-07 on
//    the Sep-15-2026 release), read from slurp.py by quals/monthly-lag.mjs.
//    Since 2026-10-31 only in the monthly view (decision #35 of the
//    2026-10-04 audit, the human's "Monthly view only"): the cumulative
//    view's count is the running total through the month, which the note
//    (the human's English, "~8% of the month's eventual incidents") does not
//    describe, so there no tooltip carries it.
//    Since the Oct-15-2026 release every lag is 0, so only the data-through
//    month is partial in the data; Zoox's month before it gets a synthetic
//    lag triple (0.6, 0.25, 1.0), as quals/monthly-arrival-lag.qual.mjs gives
//    it, so a lagged month's note is checked whatever the live lags are
//    (until 2026-10-31 that branch tested nothing: audit 2026-10-30, QT-05).
// Empty charts draw their y axis with the single label "0" (#51: a 0..1
// placeholder scale read "0, 0, 1, 1, 1").
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { monthlyLagKeys } from "./monthly-lag.mjs";

class ElementStub {
  constructor() { this._html = ""; this._attributes = {}; this.style = {}; this.children = []; }
  set textContent(v) { this._html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  get textContent() { return this._html; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  setAttribute(n, v) { this._attributes[n] = v; }
  getAttribute(n) { return this._attributes[n] ?? null; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  classList = { toggle() {} };
}
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map, Set, JSON,
  document: { getElementById() { return new ElementStub(); }, createElement() { return new ElementStub(); } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));

const HIT_R_MIN = 4, HIT_R_MAX = 12;
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const circlesOf = svg => [...svg.matchAll(/<circle\b([^>]*)>/g)].map(m => {
  const a = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
  return { at: m.index, cx: Number(a.cx), cy: Number(a.cy), r: Number(a.r), fill: a.fill,
    tip: a["data-tip"] === undefined ? null : decode(a["data-tip"]) };
});
const problems = [];
const fail = msg => problems.push(msg);

// --- 1. Hit targets in every chart -----------------------------------------

const charts = run(`(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT); checkGhostVmtRows();
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const N = full.months.length, def = full.months.indexOf(DEFAULT_START_MONTH);
  const win = (a, b) => sliceSeries(full, a, b);
  const set = hs => { for (const h of ALL_HELMERS) monthHelmerEnabled[h] = hs.includes(h); };
  const out = [];
  const DEFAULT = ["HumansAV", "Tesla", "Waymo"];
  for (const [what, hs, mk, a, b] of [
    ["default view", DEFAULT, "atfault", def, N - 1],
    ["all six, all incidents, full history", ALL_HELMERS, "all", 0, N - 1],
    ["all six, fatality, default window", ALL_HELMERS, "fatality", def, N - 1],
  ]) {
    set(hs); selectedMetricKey = mk;
    const s = win(a, b);
    out.push({what: "MPI chart, " + what, svg: renderAllHelmersMpiChart(s)});
    out.push({what: "distribution chart, " + what, svg: renderDistributionChart(s)});
  }
  set(DEFAULT); selectedMetricKey = "atfault";
  for (const cumulative of [false, true]) {
    vmtCumulative = cumulative;
    for (const h of ADS_SERIES) for (const [a, b] of [[def, N - 1], [0, N - 1]])
      out.push({what: "VMT chart " + h + (cumulative ? " (cumulative)" : "") + ", " + full.months[a] + ".." + full.months[b],
        svg: renderHelmerMonthlyChart(win(a, b), h)});
    // The combined chart: the default view's lines, and every line.
    for (const [who, hs] of [["default lines", DEFAULT], ["every line", ALL_HELMERS]]) {
      set(hs);
      for (const [a, b] of [[def, N - 1], [0, N - 1]])
        out.push({what: "combined VMT chart, " + who + (cumulative ? " (cumulative)" : "") + ", " + full.months[a] + ".." + full.months[b],
          svg: renderCombinedVmtChart(win(a, b))});
    }
    set(DEFAULT);
  }
  vmtCumulative = false;
  for (const g of GROWTH_METRIC_KEYS) {
    selectedGrowthMetric = g;
    out.push({what: "growth trajectory, " + g, svg: renderFleetTimeSeriesChart()});
    out.push({what: "growth forecast, " + g, svg: renderFleetForecastChart()});
  }
  selectedGrowthMetric = "fleet";
  return out;
})()`);

// Every VMT chart drawn above ends at the newest NHTSA month, so each must
// continue into the ghost months (data/slurp.py writes rows for the month
// after the data-through month at every release; ghost-month.qual).
const vmtCharts = charts.filter(c => /^(?:combined )?VMT chart/.test(c.what));
const unghosted = vmtCharts.filter(c => !c.svg.includes("month-ghost"));
if (vmtCharts.length === 0 || unghosted.length > 0)
  fail(`${unghosted.length} of ${vmtCharts.length} VMT charts drawn here continue into no ghost month, e.g. ${JSON.stringify(unghosted.length ? unghosted[0].what : null)}: the targets of the page's ghost months go unchecked`);

let targetsSeen = 0;
for (const { what, svg } of charts) {
  const cs = circlesOf(svg);
  const hits = cs.filter(c => c.tip !== null), glyphs = cs.filter(c => c.tip === null);
  targetsSeen += hits.length;
  if (hits.length === 0) { fail(`${what}: no tooltip targets`); continue; }
  const visible = hits.filter(c => c.fill !== "none");
  if (visible.length > 0) fail(`${what}: ${visible.length} of ${hits.length} tooltip targets are visible glyphs rather than invisible hit circles, e.g. ${JSON.stringify(visible[0].tip.split("\n")[0])}`);
  const lastGlyph = Math.max(-1, ...glyphs.map(c => c.at));
  const early = hits.filter(c => c.at < lastGlyph);
  if (early.length > 0) fail(`${what}: ${early.length} hit circles are drawn before a glyph that can cover them, e.g. ${JSON.stringify(early[0].tip.split("\n")[0])}`);
  const badR = [], stolen = [];
  hits.forEach((c, i) => {
    // The nearest target a radius can tell apart from this one (more than
    // HIT_R_MIN away): marks on top of each other share a centre whatever
    // their radii, so they do not shrink each other's targets.
    const near = Math.min(Infinity, ...hits.filter((_, j) => j !== i).map(d => Math.hypot(d.cx - c.cx, d.cy - c.cy)).filter(d => d > HIT_R_MIN));
    const want = Math.min(HIT_R_MAX, Math.max(near / 2, Math.min(HIT_R_MIN, near - HIT_R_MIN / 2)));
    if (Math.abs(c.r - want) > 0.011) badR.push(`${JSON.stringify(c.tip.split("\n")[0])} r=${c.r}, want ${want.toFixed(2)} (nearest ${near.toFixed(2)})`);
    let top = -1;
    hits.forEach((d, j) => { if (Math.hypot(d.cx - c.cx, d.cy - c.cy) <= d.r) top = j; });
    const t = hits[top];
    if (top !== i && Math.hypot(t.cx - c.cx, t.cy - c.cy) > HIT_R_MIN)
      stolen.push(`centre of ${JSON.stringify(c.tip.replace(/\n/g, " / "))} lands on ${JSON.stringify(t.tip.replace(/\n/g, " / "))} (${Math.hypot(t.cx - c.cx, t.cy - c.cy).toFixed(2)} away)`);
  });
  if (badR.length > 0) fail(`${what}: ${badR.length} of ${hits.length} hit radii are not min(${HIT_R_MAX}, max(nearest/2, min(${HIT_R_MIN}, nearest - ${HIT_R_MIN / 2}))) over the targets more than ${HIT_R_MIN} away, e.g. ${badR.slice(0, 2).join("; ")}`);
  if (stolen.length > 0) fail(`${what}: ${stolen.length} targets' centres land on another target, e.g. ${stolen.slice(0, 2).join("; ")}`);
  // A hit circle is never inside a clip-path group: the clip cut the growth
  // chart's Tesla 2025-06 Miles target flat at the x axis, its focus ring
  // with it, and a pointer below the dot's centre missed it (audit
  // 2026-10-04 #64). The visible marks stay clipped.
  const clipped = [];
  const stack = [];
  for (const m of svg.matchAll(/<g\b([^>]*)>|<\/g>|<circle\b([^>]*)>/g)) {
    if (m[0].startsWith("</g")) stack.pop();
    else if (m[0].startsWith("<g")) stack.push(/clip-path=/.test(m[1]));
    else if (/data-tip=/.test(m[2]) && stack.includes(true)) clipped.push(m.index);
  }
  if (clipped.length > 0) fail(`${what}: ${clipped.length} hit circles sit inside a clip-path group`);
}

// --- 2. VMT chart tooltips --------------------------------------------------

// The synthetic lagged month: Zoox's month before the data-through month.
const monthBefore = month => {
  const n = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 2;
  return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
};
const LAG_HELMER = "Zoox", LAG_MONTH = monthBefore(run("NHTSA_DATA_THROUGH_DATE").slice(0, 7));
const vmt = run(`(() => {
  const live = vmtRows;
  const lagged = live.filter(r => r.helmer === ${JSON.stringify(LAG_HELMER)} && r.month === ${JSON.stringify(LAG_MONTH)});
  vmtRows = live.map(r => lagged.includes(r) ? {...r, incCov: 0.6, incCovMin: 0.25, incCovMax: 1} : r);
  const full = monthSeriesData();
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
  const out = {};
  for (const cumulative of [false, true]) {
    vmtCumulative = cumulative;
    for (const h of ADS_SERIES) out[h + (cumulative ? "|cume" : "|month")] = renderHelmerMonthlyChart(full, h);
    out[cumulative ? "combined|cume" : "combined|month"] = renderCombinedVmtChart(full);
  }
  vmtCumulative = false;
  // A line's incidents are those whose series lists it.
  const counts = {};
  for (const inc of INCIDENT_DATA) for (const s of inc.series) {
    const k = s + "|" + monthKeyFromIncidentLabel(inc.date);
    counts[k] = (counts[k] || 0) + 1;
  }
  const rows = vmtRows.map(r => ({helmer: r.helmer, month: r.month, best: r.vmtBest, lo: r.vmtMin, hi: r.vmtMax,
      cume: r.vmtCume, kmin: r.kyoomMin, kmax: r.kyoomMax, coverage: r.coverage, incCov: r.incCov, incCovMin: r.incCovMin}));
  vmtRows = live;
  return {svgs: out, counts, rows, lines: ADS_SERIES, laggedRows: lagged.length,
    throughDate: NHTSA_DATA_THROUGH_DATE,
    edge: typeof VMT_RANGE_EDGE === "undefined" ? null : VMT_RANGE_EDGE};
})()`);
if (vmt.laggedRows !== 1) fail(`${LAG_HELMER} has ${vmt.laggedRows} VMT rows for ${LAG_MONTH}, the synthetic lagged month; want 1`);
const fmtWhole = n => Math.round(n).toLocaleString("en-US");
// A tooltip line's figures (numbers, with their thousands separators). The
// tooltips' words around the figures are the human's to change, so this
// checks the figures line by line: a dot's tooltip is its month, its miles,
// its range (low then high), its incident count and, for a partially
// received month, the partial-reporting note; a range end's is its month, its
// miles and its end's label (VMT_RANGE_EDGE). Until 2026-10-29 it pinned the
// words around the figures ("miles", "Range:", "incident(s)").
const figures = line => line.match(/\d[\d,]*(?:\.\d+)?/g) || [];
const sameFigures = (line, want) => JSON.stringify(figures(line)) === JSON.stringify(want);
const throughMonth = vmt.throughDate.slice(0, 7);
// The live lags' months (none since the Oct-15-2026 release) and the
// synthetic one.
const lagged = new Set([...monthlyLagKeys(throughMonth), `${LAG_HELMER}|${LAG_MONTH}`]);
if (vmt.edge === null || typeof vmt.edge.lo !== "string" || typeof vmt.edge.hi !== "string"
    || vmt.edge.lo.trim() === "" || vmt.edge.hi.trim() === "" || vmt.edge.lo === vmt.edge.hi)
  fail(`VMT_RANGE_EDGE must name the two range ends with two distinct labels; got ${JSON.stringify(vmt.edge)}`);
let lagMonthsChecked = 0;
for (const helmer of vmt.lines) {
  const rows = vmt.rows.filter(r => r.helmer === helmer);
  let running = 0;
  for (const mode of ["month", "cume"]) {
    const tips = circlesOf(vmt.svgs[`${helmer}|${mode}`]).filter(c => c.tip !== null).map(c => c.tip);
    running = 0;
    for (const r of rows) {
      const n = vmt.counts[`${helmer}|${r.month}`] || 0;
      running += n;
      const [best, lo, hi] = mode === "month" ? [r.best, r.lo, r.hi] : [r.cume, r.kmin, r.kmax];
      const mine = tips.filter(t => t.startsWith(r.month + "\n"));
      const where = `${helmer} ${r.month} (${mode === "month" ? "monthly" : "cumulative"} view)`;
      const edges = vmt.edge === null ? [] : [vmt.edge.lo, vmt.edge.hi];
      const isEnd = t => { const l = t.split("\n"); return l.length === 3 && edges.includes(l[2]); };
      const dot = mine.filter(t => !isEnd(t));
      if (dot.length !== 1) { fail(`${where}: expected one dot tooltip (the month's one target that is not a range end); found ${JSON.stringify(mine)}`); continue; }
      const count = mode === "month" ? n : running;
      const lines = dot[0].split("\n");
      const wantFigures = [[fmtWhole(best)], [fmtWhole(lo), fmtWhole(hi)], [count.toLocaleString("en-US")]];
      wantFigures.forEach((want, i) => {
        if (!sameFigures(lines[i + 1] || "", want))
          fail(`${where}: the dot tooltip ${JSON.stringify(dot[0])} has the figures ${JSON.stringify(figures(lines[i + 1] || ""))} on its line ${i + 2}, want ${JSON.stringify(want)} (${["its miles", "its range", "its incident count"][i]})`);
      });
      const partial = r.coverage * r.incCovMin < 0.999;
      const best100 = Math.round(100 * r.coverage * r.incCov), worst100 = Math.round(100 * r.coverage * r.incCovMin);
      const carries = dot[0].includes(vmt.throughDate) && dot[0].includes(`~${best100}%`) && dot[0].includes(`~${worst100}%`);
      // In the cumulative view no tooltip may carry the note: there the date
      // alone gives it away.
      const noted = mode === "month" ? carries : dot[0].includes(vmt.throughDate);
      const wantNote = partial && mode === "month";
      if (mode === "month" && lagged.has(`${helmer}|${r.month}`)) lagMonthsChecked++;
      if (noted !== wantNote || partial !== (r.month === throughMonth || lagged.has(`${helmer}|${r.month}`)))
        fail(`${where}: ${wantNote ? `a partially received month's count (the data-through month, or a month inside the helmer's Monthly-report lag) must say it holds the reports received through ${vmt.throughDate}, ~${best100}% of the month's incidents (worst case ~${worst100}%)` : partial ? "a running total through a partially received month must carry no partial-reporting note (the note describes the month's own count)" : "a fully reported month must carry no partial-reporting note"}; tooltip ${JSON.stringify(dot[0])}`);
      if (vmt.edge !== null) for (const [edge, v] of [[vmt.edge.lo, lo], [vmt.edge.hi, hi]]) {
        const end = mine.filter(t => { const l = t.split("\n"); return l.length === 3 && l[2] === edge && sameFigures(l[1], [fmtWhole(v)]); });
        if (end.length !== 1) fail(`${where}: expected one range-end tooltip giving ${fmtWhole(v)} and the end's label ${JSON.stringify(edge)}; found ${JSON.stringify(mine)}`);
      }
    }
  }
}
if (lagMonthsChecked === 0) fail(`no month inside a Monthly-report lag was checked in the monthly view (the synthetic ${LAG_HELMER} ${LAG_MONTH} among them)`);
// The combined chart (every line checked) carries exactly its lines' own
// charts' tooltips, the ghost months' included.
for (const mode of ["month", "cume"]) {
  const tipsOf = svg => circlesOf(svg).filter(c => c.tip !== null).map(c => c.tip).sort();
  const combined = tipsOf(vmt.svgs[`combined|${mode}`]);
  const own = vmt.lines.flatMap(h => tipsOf(vmt.svgs[`${h}|${mode}`])).sort();
  if (JSON.stringify(combined) !== JSON.stringify(own))
    fail(`the combined VMT chart (${mode === "month" ? "monthly" : "cumulative"} view, every line checked) has ${combined.length} tooltips, its lines' own charts ${own.length}, or they differ (first combined ${JSON.stringify(combined[0])}, first own ${JSON.stringify(own[0])})`);
}

// --- 3. Empty charts --------------------------------------------------------

const empty = run(`(() => {
  const full = monthSeriesData();
  const yLabels = svg => [...svg.matchAll(/<text class="month-tick" x="[\\d.]+" y="[\\d.-]+" text-anchor="end">([^<]*)<\\/text>/g)].map(m => m[1]);
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = false;
  selectedMetricKey = "atfault";
  const mpi = yLabels(renderAllHelmersMpiChart(sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH), full.months.length - 1)));
  for (const h of ["HumansAV", "Tesla", "Waymo"]) monthHelmerEnabled[h] = true;
  const preTesla = sliceSeries(full, 0, full.months.indexOf("2025-05"));
  return {mpi, teslaVmt: yLabels(renderHelmerMonthlyChart(preTesla, "Tesla"))};
})()`);
for (const [what, labels] of [["the MPI chart with no helmer checked", empty.mpi],
  ["Tesla's VMT chart in 2021-07..2025-05, before its series starts", empty.teslaVmt]]) {
  if (JSON.stringify(labels) !== JSON.stringify(["0"]))
    fail(`${what}: y labels ${JSON.stringify(labels)}, want ["0"]`);
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render the MPI, distribution, VMT (each ADS line's own and the combined chart, continuing into the ghost months) and growth charts in vm (${charts.length} charts, ${targetsSeen} tooltip targets) and read their hit circles and tooltips, with ${LAG_HELMER}'s ${LAG_MONTH} given a synthetic Monthly-report lag; render the MPI chart with no helmer and Tesla's VMT chart before its series.
Expectata: every target an invisible hit circle drawn after the glyphs and outside any clip-path group, its radius min(${HIT_R_MAX}, max(nearest/2, min(${HIT_R_MIN}, nearest - ${HIT_R_MIN / 2}))) over the targets more than ${HIT_R_MIN} away and its centre its own; VMT dots giving their range and (cumulative view) the running incident count; range ends naming their end; the partially received months' counts (the data-through month, and the months inside a helmer's Monthly-report lag, the synthetic one included) marked partial in the monthly view, and no tooltip of the cumulative view marked; the combined chart carrying exactly its lines' own tooltips; empty charts labelled "0" only.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 10).join("\n")}`);
console.log(`qual pass: ${targetsSeen} chart tooltip targets are capped invisible hit circles over the glyphs; VMT tooltips give ranges, edges, running counts and the partial-month note; empty axes read "0"`);

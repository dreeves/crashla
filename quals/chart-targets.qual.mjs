// Chart tooltip targets and what their tooltips say (2026-10-03, audit #28,
// #51, #59, #60, #63). In every chart:
//  - Each mark's tooltip target is an invisible hit circle (fill="none"),
//    drawn after every visible glyph, so a glyph never covers a target (#28:
//    VMT dots, distribution markers and fleet points were their own 2.7-3.3
//    CSS px targets on a phone; the VMT chart had no hit circle for its dots).
//  - A hit circle's radius is half the distance to the nearest other target
//    more than 4 units away, at least 4 and at most 12 units: big enough for
//    a finger where there is room (12 units is a 24 CSS px target at the
//    charts' phone scale), and never so big that it takes over a neighbour's
//    centre (#63: an r=8 circle drawn later stole the tooltip of a dot 6.4
//    units away that it did not touch). So a pointer at a target's centre
//    lands on that target, unless another target's centre lies within 4
//    units of it (marks drawn on top of each other, which no radius can
//    separate). Such marks do not shrink each other's targets: counted, they
//    held the default view's six distribution markers on a phone (each Peak
//    beside its Median) to 8 CSS px targets with no other mark near (review,
//    2026-10-03).
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
    for (const h of ADS_HELMERS) for (const [a, b] of [[def, N - 1], [0, N - 1]])
      out.push({what: "VMT chart " + h + (cumulative ? " (cumulative)" : "") + ", " + full.months[a] + ".." + full.months[b],
        svg: renderHelmerMonthlyChart(win(a, b), h)});
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
    const want = Math.max(HIT_R_MIN, Math.min(HIT_R_MAX, near / 2));
    if (Math.abs(c.r - want) > 0.011) badR.push(`${JSON.stringify(c.tip.split("\n")[0])} r=${c.r}, want ${want.toFixed(2)} (nearest ${near.toFixed(2)})`);
    let top = -1;
    hits.forEach((d, j) => { if (Math.hypot(d.cx - c.cx, d.cy - c.cy) <= d.r) top = j; });
    const t = hits[top];
    if (top !== i && Math.hypot(t.cx - c.cx, t.cy - c.cy) > HIT_R_MIN)
      stolen.push(`centre of ${JSON.stringify(c.tip.replace(/\n/g, " / "))} lands on ${JSON.stringify(t.tip.replace(/\n/g, " / "))} (${Math.hypot(t.cx - c.cx, t.cy - c.cy).toFixed(2)} away)`);
  });
  if (badR.length > 0) fail(`${what}: ${badR.length} of ${hits.length} hit radii are not clamp(nearest/2, ${HIT_R_MIN}, ${HIT_R_MAX}) over the targets more than ${HIT_R_MIN} away, e.g. ${badR.slice(0, 2).join("; ")}`);
  if (stolen.length > 0) fail(`${what}: ${stolen.length} targets' centres land on another target, e.g. ${stolen.slice(0, 2).join("; ")}`);
}

// --- 2. VMT chart tooltips --------------------------------------------------

const vmt = run(`(() => {
  const full = monthSeriesData();
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
  const out = {};
  for (const cumulative of [false, true]) {
    vmtCumulative = cumulative;
    for (const h of ADS_HELMERS) out[h + (cumulative ? "|cume" : "|month")] = renderHelmerMonthlyChart(full, h);
  }
  vmtCumulative = false;
  const counts = {};
  for (const inc of INCIDENT_DATA) {
    const k = inc.helmer + "|" + monthKeyFromIncidentLabel(inc.date);
    counts[k] = (counts[k] || 0) + 1;
  }
  return {svgs: out, counts, rows: vmtRows.map(r => ({helmer: r.helmer, month: r.month, best: r.vmtBest, lo: r.vmtMin, hi: r.vmtMax,
      cume: r.vmtCume, kmin: r.kyoomMin, kmax: r.kyoomMax, coverage: r.coverage, incCov: r.incCov, incCovMin: r.incCovMin})),
    throughDate: NHTSA_DATA_THROUGH_DATE,
    edge: typeof VMT_RANGE_EDGE === "undefined" ? null : VMT_RANGE_EDGE};
})()`);
const fmtWhole = n => Math.round(n).toLocaleString("en-US");
const plural = n => `${n.toLocaleString("en-US")} ${n === 1 ? "incident" : "incidents"}`;
const throughMonth = vmt.throughDate.slice(0, 7);
const lagged = monthlyLagKeys(throughMonth);
if (vmt.edge === null || typeof vmt.edge.lo !== "string" || typeof vmt.edge.hi !== "string"
    || vmt.edge.lo.trim() === "" || vmt.edge.hi.trim() === "" || vmt.edge.lo === vmt.edge.hi)
  fail(`VMT_RANGE_EDGE must name the two range ends with two distinct labels; got ${JSON.stringify(vmt.edge)}`);
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
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
      const dot = mine.filter(t => t.startsWith(`${r.month}\n${fmtWhole(best)} miles\n`) && /\bincidents?\b/.test(t));
      if (dot.length !== 1) { fail(`${where}: expected one dot tooltip opening "${r.month} / ${fmtWhole(best)} miles"; found ${JSON.stringify(mine)}`); continue; }
      const count = mode === "month" ? n : running;
      const wantLines = [`Range: ${fmtWhole(lo)} – ${fmtWhole(hi)}`, plural(count)];
      for (const line of wantLines) if (!dot[0].split("\n").includes(line))
        fail(`${where}: the dot tooltip ${JSON.stringify(dot[0])} lacks the line ${JSON.stringify(line)}`);
      const partial = r.coverage * r.incCovMin < 0.999;
      const best100 = Math.round(100 * r.coverage * r.incCov), worst100 = Math.round(100 * r.coverage * r.incCovMin);
      const carries = dot[0].includes(vmt.throughDate) && dot[0].includes(`~${best100}%`) && dot[0].includes(`~${worst100}%`);
      if (partial !== carries || partial !== (r.month === throughMonth || lagged.has(`${helmer}|${r.month}`)))
        fail(`${where}: ${partial ? `a partially received month's count (the data-through month, or a month inside the helmer's Monthly-report lag) must say it holds the reports received through ${vmt.throughDate}, ~${best100}% of the month's incidents (worst case ~${worst100}%)` : "a fully reported month must carry no partial-reporting note"}; tooltip ${JSON.stringify(dot[0])}`);
      if (vmt.edge !== null) for (const [edge, v] of [[vmt.edge.lo, lo], [vmt.edge.hi, hi]]) {
        const end = mine.filter(t => t === `${r.month}\n${fmtWhole(v)} miles\n${edge}`);
        if (end.length !== 1) fail(`${where}: expected one range-end tooltip "${r.month} / ${fmtWhole(v)} miles / ${edge}"; found ${JSON.stringify(mine)}`);
      }
    }
  }
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
  `Replicata: render the MPI, distribution, VMT and growth charts in vm (${charts.length} charts, ${targetsSeen} tooltip targets) and read their hit circles and tooltips; render the MPI chart with no helmer and Tesla's VMT chart before its series.
Expectata: every target an invisible hit circle drawn after the glyphs, its radius clamp(nearest/2, ${HIT_R_MIN}, ${HIT_R_MAX}) over the targets more than ${HIT_R_MIN} away and its centre its own; VMT dots giving their range and (cumulative view) the running incident count; range ends naming their end; the partially received months' counts (the data-through month, and the months inside a helmer's Monthly-report lag) marked partial; empty charts labelled "0" only.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 10).join("\n")}`);
console.log(`qual pass: ${targetsSeen} chart tooltip targets are capped invisible hit circles over the glyphs; VMT tooltips give ranges, edges, running counts and the partial-month note; empty axes read "0"`);

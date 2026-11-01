import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

// The growth charts (Fleet size, Rides, Miles) carry the ghost months the VMT
// charts carry (data/README.md, Ghost months), drawn the same way: every
// line's history has a point at each ghost month and none later, the point
// faded (class month-ghost) on the dashed stretch that runs on to the Jan-1
// forecast, its tooltip ending with the VMT charts' ghost note. Until
// 2026-10-28 the Miles lines stopped at the newest NHTSA month (milesHistory
// read the analysis rows only) and the Fleet and Rides tables at rows written
// by hand on Oct 3 (Waymo and Tesla rides and Waymo and Zoox fleet at
// 2026-09, Tesla's fleet at 2026-08, Zoox's rides at 2026-06), while the VMT
// charts above showed October.
//
// Tesla's growth points derive from data/vmt.csv's miles for the month, so
// they are re-derived here, and go red when that row changes:
//  - Fleet: cars driving on a typical day of the month (the human's choice:
//    2026-10-28 for October's point, 2026-10-29 for the whole line from
//    September 2025 on; June 2025's launch count of ~12 stays, since miles
//    then give 0.4): the month's miles over its days at ~180 miles per car per
//    day, Tesla's Q2 2026 utilization; its range covers at least the month's
//    miles band at that rate. There is a point for every month from 2025-09
//    to the newest ghost month, each checked, not only ghost months, so a
//    month's revised miles row still flags its point after its NHTSA release
//    (until 2026-10-29 only ghost months were checked, and the line mixed
//    definitions).
//  - Rides: for every month after the deck-chart months (2026-06 and
//    earlier, whose near-exact miles rides-provenance.qual.mjs checks),
//    cumulative miles over the [4.7, 6.2, 8.3] miles-per-ride corridor, the
//    cumulative band over its far ends. The 2026-09 row sat on September's
//    cumulative of before the 2026-10-23 re-pin (3,630,000; now 4,241,000)
//    until 2026-10-28.

const escapingEl = () => {
  let html = "";
  return {
    set textContent(v) { html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    get innerHTML() { return html; },
  };
};
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map, Set, JSON, Array,
  document: { getElementById() { return { textContent: "", innerHTML: "" }; }, createElement() { return escapingEl(); } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// As init does: the analysis rows, then the ghost rows.
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT); ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT); checkGhostVmtRows();", ctx);

const plain = v => JSON.parse(JSON.stringify(v));
const ghostRows = plain(vm.runInContext("ghostVmtRows", ctx));
const ghostMonths = [...new Set(ghostRows.map(r => r.month))].sort();
const newestGhost = ghostMonths.at(-1);
const GHOST_NOTE = vm.runInContext("VMT_GHOST_NOTE", ctx);
const METRICS = plain(vm.runInContext("GROWTH_METRIC_KEYS", ctx));
const problems = [];

// --- 1. Every line's history reaches the ghost months, flagged ghost ---
const lanesOf = key => plain(vm.runInContext(`growthMetricSpec(${JSON.stringify(key)}).lanes()`, ctx));
for (const key of METRICS) {
  for (const lane of lanesOf(key)) {
    const hist = lane.points.filter(p => !p.forecast);
    const months = hist.map(p => p.month);
    if (!months.every((m, i) => i === 0 || m > months[i - 1]))
      problems.push(`${key} · ${lane.label}: history months out of order: ${months.join(", ")}`);
    if (lane.branchOnly) {
      // A fork leaves from its helmer's newest point, the newest ghost month.
      if (!(months.length === 1 && months[0] === newestGhost && hist[0].ghost === true))
        problems.push(`${key} · ${lane.label}: the fork leaves from ${JSON.stringify(hist)}; want one ghost point at ${newestGhost}`);
      continue;
    }
    for (const month of ghostMonths) {
      if (!months.includes(month)) problems.push(`${key} · ${lane.label}: no history point at the ghost month ${month} (history ends at ${months.at(-1)})`);
    }
    if (months.at(-1) > newestGhost) problems.push(`${key} · ${lane.label}: a history point at ${months.at(-1)}, after the newest ghost month ${newestGhost}`);
    for (const p of hist) {
      if (p.ghost !== ghostMonths.includes(p.month))
        problems.push(`${key} · ${lane.label} ${p.month}: ghost is ${JSON.stringify(p.ghost)}; want ${ghostMonths.includes(p.month)}`);
    }
  }
}

// --- 2. The Miles lines' ghost points are the VMT charts' ghost rows ---
for (const lane of lanesOf("miles").filter(l => !l.branchOnly)) {
  for (const month of ghostMonths) {
    const row = ghostRows.find(r => r.helmer === lane.helmer && r.month === month);
    const p = lane.points.find(q => q.month === month);
    if (!row || !p || p.best !== row.vmtCume || p.lo !== row.kyoomMin || p.hi !== row.kyoomMax)
      problems.push(`miles · ${lane.label} ${month}: point ${JSON.stringify(p)}; want the ghost row's cumulative ${row && row.vmtCume} [${row && row.kyoomMin}, ${row && row.kyoomMax}]`);
  }
}

// --- 3. Tesla's fleet from 2026-10: cars driving on a typical day ---
const MILES_PER_CAR_DAY = 180;
const PER_DAY_FROM = "2025-09"; // Tesla's first fleet point on this basis
const daysIn = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
const fleetHistory = plain(vm.runInContext("FLEET_HISTORY", ctx));
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(r => r[0] === "tesla")
  .map(r => ({ month: r[1], vmt: Number(r[2]), cume: Number(r[3]), kyoomMin: Number(r[4]), kyoomMax: Number(r[5]),
    vmtMin: Number(r[6]), vmtMax: Number(r[7]) }));
const monthsFrom = (from, to) => {
  const out = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y++, m = 1) : m++)
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};
const perDayMonths = fleetHistory.Tesla.filter(q => q.month >= PER_DAY_FROM).map(q => q.month);
if (JSON.stringify(perDayMonths) !== JSON.stringify(monthsFrom(PER_DAY_FROM, newestGhost)))
  problems.push(`fleet · Tesla: points at ${perDayMonths.join(", ")}; want every month from ${PER_DAY_FROM} to ${newestGhost}`);
for (const p of fleetHistory.Tesla.filter(q => q.month >= PER_DAY_FROM)) {
  const m = master.find(r => r.month === p.month);
  const perDay = miles => miles / daysIn(p.month) / MILES_PER_CAR_DAY;
  if (!m || Math.abs(p.best - perDay(m.vmt)) > 1 || p.lo > perDay(m.vmtMin) || p.hi < perDay(m.vmtMax))
    problems.push(`fleet · Tesla ${p.month}: ${JSON.stringify(p)}; want best ${m ? Math.round(perDay(m.vmt)) : "(no data/vmt.csv row)"} (${m && m.vmt} miles over ${daysIn(p.month)} days at ${MILES_PER_CAR_DAY} a car), lo <= ${m && Math.round(perDay(m.vmtMin))}, hi >= ${m && Math.round(perDay(m.vmtMax))}`);
}

// --- 3b. Tesla's forecast path starts at its newest month's exit rate ---
// Tesla's robotaxi miles forecast runs a path whose daily miles grow at a
// constant rate from the day after data/vmt.csv's newest Tesla month
// (crashla.js TESLA_PATH_START) to each scenario's daily miles on the
// forecast date (TESLA_ROBOTAXI_SCENARIOS), on top of that month's
// cumulative. Since 2026-10-31 (the human's choice of 2026-10-30, "start at
// Oct's exit rate") the start is the month's late-month rate: the no-monitor
// line's projection of the days after Tesla's page was last measured, plus the
// monitor-aboard remainder (the all-modes row less the no-monitor row) at its
// average for the month. From 2026-10-29 to 2026-10-31 the path started at
// October's typical day (mid-October, 83,677 a day against late October's
// 107,347), so every scenario's cumulative stepped down at the month
// boundary. A revised or newer row flags the forecast, and each
// MILES_FORECAST robotaxi edge must equal the path integrated here day by day.
{
  // Tesla's page as the teslanomonitor row's rationale cites it: no-monitor
  // miles measured from the 1st of the month through day `through`
  // (tesla.com/robotaxi/safety as of Oct 18, 2026). A newer month, or a
  // re-derived October, needs its own entry here.
  const PAGE_MEASURED = {"2026-10": {through: 18, miles: 1179333}};
  const start = plain(vm.runInContext("TESLA_PATH_START", ctx));
  const month = master.map(r => r.month).sort().at(-1);
  const t = master.find(r => r.month === month);
  const nm = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
    .find(r => r[0] === "teslanomonitor" && r[1] === month);
  const page = PAGE_MEASURED[month];
  const [y, mo] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10); // the day after the month
  assert.ok(nm !== undefined && page !== undefined,
    `Replicata: read Tesla's newest month in data/vmt.csv (${month}), its teslanomonitor row and this qual's PAGE_MEASURED entry for it.
Expectata: both, the inputs of TESLA_PATH_START's rate (re-derive the path's start from that month's rows and record Tesla's page figure here).
Resultata: [teslanomonitor row, PAGE_MEASURED entry] = ${JSON.stringify([nm, page])}.`);
  {
    const exitRate = (Number(nm[2]) - page.miles) / (daysIn(month) - page.through) + (t.vmt - Number(nm[2])) / daysIn(month);
    if (start.day !== firstDay || start.cumulative !== t.cume || !(Math.abs(start.milesPerDay - exitRate) <= 1))
      problems.push(`TESLA_PATH_START ${JSON.stringify(start)}; want day ${firstDay}, cumulative ${t.cume} (the tesla ${month} row) and ${exitRate.toFixed(1)} miles a day: the teslanomonitor row's ${nm[2]} less Tesla's page's ${page.miles} through day ${page.through}, over the month's other ${daysIn(month) - page.through} days, plus the tesla row's ${t.vmt} less the teslanomonitor row's over ${daysIn(month)} days`);
    // The path, summed day by day (midpoint of each day; the closed form is
    // the app's), from the start's rate to each scenario edge's daily miles
    // on the forecast date.
    const forecastDate = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
    const days = (Date.parse(forecastDate) - Date.parse(firstDay)) / 86400000;
    const scenarios = plain(vm.runInContext("TESLA_ROBOTAXI_SCENARIOS", ctx));
    const milesComps = plain(vm.runInContext(`MILES_FORECAST.find(f => f.helmer === "Tesla").components.filter(c => c.scope === "robotaxi")`, ctx));
    const path = target => {
      let sum = t.cume;
      for (let i = 0; i < days; i++) sum += exitRate * (target / exitRate) ** ((i + 0.5) / days);
      return sum;
    };
    scenarios.forEach((s, i) => {
      for (const k of ["best", "lo", "hi"]) {
        const want = path(s[k]), got = milesComps[i] && milesComps[i][k];
        if (!(Math.abs(got - want) <= 1e-4 * want))
          problems.push(`MILES_FORECAST Tesla robotaxi component ${i} ${k}: ${got}; want ${Math.round(want)}, the cumulative through the day before ${forecastDate} on the path from ${exitRate.toFixed(1)} miles a day on ${firstDay} to ${s[k]} on ${forecastDate}`);
      }
    });
  }
}

// --- 4. Tesla's rides after the deck-chart months, from data/vmt.csv ---
const corridor = plain(vm.runInContext("TESLA_MILES_PER_RIDE", ctx));
const rides = plain(vm.runInContext("RIDES_HISTORY", ctx)).Tesla;
for (const row of rides.filter(r => r.month > "2026-06")) {
  const m = master.find(r => r.month === row.month);
  const want = m && { best: m.cume / corridor.best, lo: m.kyoomMin / corridor.hi, hi: m.kyoomMax / corridor.lo };
  if (!want || ["best", "lo", "hi"].some(f => Math.abs(row[f] - want[f]) > 500))
    problems.push(`rides · Tesla ${row.month}: ${JSON.stringify(row)}; want ${want ? JSON.stringify(Object.fromEntries(Object.entries(want).map(([f, v]) => [f, Math.round(v)]))) : "a data/vmt.csv row"} (cumulative miles ${m && m.cume} [${m && m.kyoomMin}, ${m && m.kyoomMax}] over ${corridor.best}, ${corridor.hi}, ${corridor.lo} miles a ride), each within 500`);
}

// --- 5. Drawn as the VMT charts draw a ghost month ---
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const vertices = d => [...d.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(m => `${m[1]} ${m[2]}`);
for (const key of METRICS) {
  vm.runInContext(`selectedGrowthMetric = ${JSON.stringify(key)}`, ctx);
  const html = vm.runInContext("renderFleetTimeSeriesChart()", ctx);
  // A history point's figures as the page prints them (historyTipFigures: the
  // fewest figures, at least three, that keep its edges apart; growth-charts
  // .qual checks that rule itself; until 2026-10-31 this read the metric's
  // tipFmt, three figures or the fleet's exact count).
  const figuresOf = p => vm.runInContext(`historyTipFigures(growthMetricSpec(selectedGrowthMetric), ${JSON.stringify(p)})`, ctx);
  const circles = [...html.matchAll(/<circle([^>]*)><\/circle>/g)].map(m => m[1]);
  const marks = circles.filter(a => / r="3\.3"/.test(a)).map(a => ({
    ghost: / class="month-ghost"/.test(a), x: /cx="([\d.]+)"/.exec(a)[1], y: /cy="([\d.]+)"/.exec(a)[1],
    color: /fill:(#[0-9a-f]{6})/.exec(a)[1] }));
  const tips = circles.filter(a => /data-tip="/.test(a)).map(a => decode(/data-tip="([^"]*)"/.exec(a)[1]));
  const paths = [...html.matchAll(/<path d="([^"]*)" style="stroke:(#[0-9a-f]{6});stroke-width:2;fill:none(;stroke-dasharray:6 4)?"><\/path>/g)]
    .map(m => ({ d: m[1], color: m[2], dashed: m[3] !== undefined }));
  const lanes = lanesOf(key);
  const mainline = lanes.filter(l => !l.branchOnly);
  const noted = tips.filter(t => t.endsWith(`\n${GHOST_NOTE}`));
  if (noted.length !== mainline.length * ghostMonths.length)
    problems.push(`${key}: ${noted.length} tooltips end with the ghost note; want ${mainline.length * ghostMonths.length} (one per line and ghost month)`);
  for (const lane of mainline) {
    const ghosts = marks.filter(c => c.color === lane.color && c.ghost);
    const solid = paths.filter(p => p.color === lane.color && !p.dashed);
    const dashed = paths.filter(p => p.color === lane.color && p.dashed);
    if (ghosts.length !== ghostMonths.length || solid.length !== 1 || dashed.length !== 1) {
      problems.push(`${key} · ${lane.label}: ${ghosts.length} faded dots, ${solid.length} solid and ${dashed.length} dashed lines; want ${ghostMonths.length}, 1 and 1`);
      continue;
    }
    const solidV = vertices(solid[0].d), dashedV = vertices(dashed[0].d);
    if (dashedV[0] !== solidV.at(-1))
      problems.push(`${key} · ${lane.label}: the dashed line starts at ${dashedV[0]}, not where the solid line ends (${solidV.at(-1)})`);
    for (const g of ghosts) {
      const at = `${g.x} ${g.y}`;
      if (!dashedV.slice(1, -1).includes(at)) problems.push(`${key} · ${lane.label}: the dashed line ${JSON.stringify(dashedV)} does not pass through the faded dot at ${at}`);
      if (solidV.some(v => v.split(" ")[0] === g.x)) problems.push(`${key} · ${lane.label}: the solid line reaches the faded dot's month (x ${g.x})`);
    }
    // The tooltip gives the point's values and ends with the ghost note; its
    // other words are the page's and not checked (no wording pins, 2026-10-28).
    for (const month of ghostMonths) {
      const p = lane.points.find(q => q.month === month);
      if (!p) continue; // reported in section 1
      const values = figuresOf(p);
      const tip = tips.find(t => t.startsWith(`${lane.helmer} · ${month}\n`));
      if (!tip || !tip.endsWith(`\n${GHOST_NOTE}`) || !values.every(v => tip.includes(v)))
        problems.push(`${key} · ${lane.label}: the ${month} tooltip ${JSON.stringify(tip)} should give ${values.join(", ")} and end with the ghost note`);
    }
  }
  // A fork's dashed line leaves from its helmer's faded dot.
  for (const lane of lanes.filter(l => l.branchOnly)) {
    const parent = mainline.find(l => l.helmer === lane.helmer);
    const from = marks.find(c => c.color === parent.color && c.ghost);
    const fork = paths.filter(p => p.color === lane.color && p.dashed);
    if (!from || fork.length !== 1 || vertices(fork[0].d)[0] !== `${from.x} ${from.y}`)
      problems.push(`${key} · ${lane.label}: the fork's dashed line ${JSON.stringify(fork.map(p => p.d))} does not leave from ${lane.helmer}'s faded dot ${from ? `${from.x} ${from.y}` : "(none)"}`);
  }
}
vm.runInContext(`selectedGrowthMetric = "fleet"`, ctx);

// --- 6. The forecast stays ahead of the ghost months ---
// A ghost month at the cumulative forecasts' step (CUMULATIVE_END_MONTH, the
// month before the forecast date) stops the Rides and Miles lines (the month
// order asserted in growthLanePoints); each NHTSA release adds a month. So the
// step must lie at least three months past the newest ghost month: this goes
// red about two releases before the break, time to move the forecast date
// (AGENTS.md ledger, 2026-10-29; added then, when the Jan 1, 2027 forecast
// sat two months past October's ghost month).
{
  const step = vm.runInContext("CUMULATIVE_END_MONTH", ctx);
  const monthsApart = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
  if (monthsApart(newestGhost, step) < 3)
    problems.push(`the cumulative forecasts' step ${step} is ${monthsApart(newestGhost, step)} months past the newest ghost month ${newestGhost}; want at least 3: move the forecast date (GROWTH_FORECAST_DATE)`);
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load the app in vm with the analysis rows and the ghost rows (data/vmt.js) as init does, build and render the growth chart's Fleet size, Rides and Miles lines, and read FLEET_HISTORY, RIDES_HISTORY and data/vmt.csv.
Expectata: every line's history in month order, with a point at each ghost month (${ghostMonths.join(", ")}), flagged ghost, and none later; each fork leaving from its helmer's newest point; the Miles points at the ghost months equal to the ghost rows' cumulative miles and bands; Tesla's fleet a point for every month from ${PER_DAY_FROM}, each its month's miles in data/vmt.csv over the month's days at ${MILES_PER_CAR_DAY} miles a car, its range covering that miles band; TESLA_PATH_START on the day after Tesla's newest month in data/vmt.csv, at that month's cumulative and its late-month rate, and each MILES_FORECAST robotaxi edge the cumulative along the path from it to the scenario's daily miles on the forecast date; Tesla's rides after 2026-06 the cumulative miles over the miles-per-ride corridor, within 500; and on the chart each ghost point a faded dot (class month-ghost) that the dashed line passes through from where the solid line ends, the solid line never reaching it, its tooltip giving the point's values and ending with the VMT charts' ghost note; and the cumulative forecasts' step at least three months past the newest ghost month.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 12).join("\n")}`);
console.log(`qual pass: every growth line carries the ghost months (${ghostMonths.join(", ")}) as the VMT charts do, faded on the dashed stretch with the ghost note; Tesla's fleet and rides there follow data/vmt.csv`);

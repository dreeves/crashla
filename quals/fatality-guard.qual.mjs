// A new Fatality incident must stop the run once, so that a person reads its
// narrative before the fatality metric moves. The reason is the metric, not
// any copy: it divides each death by vehiclesInvolved (Koopman/Piper
// fractional-death attribution), and data/slurp.py DEFAULTS that field to 2,
// so a fatality whose narrative reveals a pileup would take the wrong share
// unless someone counts the vehicles and records the count in
// VEHICLES_INVOLVED. Nothing else in the pipeline asks for that read. So:
// every fatality's crash has a VEHICLES_INVOLVED entry (the count and the
// narrative's words that give it, the default 2 included), and the page's
// data carries that count.
//
// And the metric itself uses it (since 2026-11-21; audit 2026-11-20, A21):
// each ADS line's fatality count, in the default window and over the full
// history, is the sum of 1/vehiclesInvolved over the line's Fatality
// incidents of the window, recounted here from INCIDENT_DATA. Until then no
// qual recomputed the count: a metric that counted each fatal crash whole
// (rounding each month's sum up) passed them all, though the share is what
// makes a line's count comparable with deaths per fleet mile, each death
// counted once (IGNOREME.md, Human Comparison Methodology; vehicles-involved.qual
// pins only the text of the line that accumulates it).
//
// Until 2026-11-17 this qual also pinned outcomes copied from the data:
// exactly 3 fatalities, all of them Waymo's, each fault value at most 0.05,
// and its own copy of the three vehicle counts (EXPECTED_VEHICLES). A fourth
// fatality, a first Tesla or Zoox one, or a blind rater's 0.1 would each
// have turned it red after the entry above was written, with nothing left to
// do but re-pin. The human, 2026-11-17: "maybe they should be sanity checks,
// like only failing on insane numbers, not merely mildly surprising
// numbers?", then "sure, convert outcome pins to sanity check ranges". What
// is left of them is sanity: a vehicle count is a whole number from 1 to
// MOST_VEHICLES, and each fatality's fault value is rated and lies in [0, 1].
// The pass line reports how many fatalities there are and whose.
//
// Historical note: until 2026-09-15 this qual also guarded a hard-coded
// parenthetical in the "Severity breakdown" section that described each
// fatality's speed. That sentence was removed — it restated, less reliably, what
// the incident browser already shows per row (fault value plus the full
// narrative), and it described the whole dataset while sitting above a windowed
// table, so it read as wrong whenever a fatality fell outside the selected
// range. The speed assertion went with it; speeds were only ever pinned to keep
// that sentence honest.
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";

const MOST_VEHICLES = 50;

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Each fatality with its crash: a second AV's record (secondOf) shares the
// crash, and the count, of the report it rides on.
const fatalities = JSON.parse(JSON.stringify(vm.runInContext(
  `INCIDENT_DATA.filter(r => r.severity === "Fatality")
     .map(r => ({reportId: r.reportId, crash: r.secondOf ?? r.reportId, helmer: r.helmer, city: r.city, date: r.date,
       fault: r.fault === null ? null : Number(r.fault.faultfrac), vehiclesInvolved: r.vehiclesInvolved, series: r.series}))`,
  ctx)));

const SEEN = JSON.stringify(fatalities);
const FIX = `=> A Fatality incident was added or changed. Read its narrative, count the vehicles involved, and record the count in VEHICLES_INVOLVED in data/slurp.py as (count, the narrative's words that give it), the default 2 included; then run slurp.`;

// The reviewed counts: {report: count}.
const reviewed = JSON.parse(execFileSync("python3", ["-c",
  `import json, sys\nsys.path.insert(0, "data")\nimport slurp\nprint(json.dumps({rid: count for rid, (count, _words) in slurp.VEHICLES_INVOLVED.items()}))`],
  { encoding: "utf8" }).trim().split("\n").at(-1));

const unreviewed = fatalities.filter(f => reviewed[f.crash] === undefined).map(f => f.crash);
assert.deepEqual(unreviewed, [],
  `Replicata: list each fatality's report and look it up in VEHICLES_INVOLVED in data/slurp.py.\nExpectata: every fatality has an entry (count, the narrative's words that give it), even when the count is the default 2.\nResultata: no entry for ${JSON.stringify(unreviewed)} — ${SEEN}.\n${FIX}`);

const miscounted = fatalities.filter(f => f.vehiclesInvolved !== reviewed[f.crash]);
assert.deepEqual(miscounted, [],
  `Replicata: compare each fatality's vehiclesInvolved in data/incidents.js with its VEHICLES_INVOLVED entry in data/slurp.py (${JSON.stringify(reviewed)}).\nExpectata: the same count: each death is divided by the count a person read from its narrative.\nResultata: ${JSON.stringify(miscounted)}.\n${FIX}`);

const insane = fatalities.filter(f => !(Number.isInteger(f.vehiclesInvolved) && f.vehiclesInvolved >= 1 && f.vehiclesInvolved <= MOST_VEHICLES));
assert.deepEqual(insane, [],
  `Replicata: read each fatality's vehicle count.\nExpectata: a whole number from 1 to ${MOST_VEHICLES} (a sanity range).\nResultata: ${JSON.stringify(insane)}.`);

// A fatality with no fault value yet (fault null: its rating has not run) must
// fail HERE with a message, not crash the map above with a TypeError before
// any message prints (as it did until 2026-09-26).
const unrated = fatalities.filter(f => !(f.fault !== null && Number.isFinite(f.fault) && f.fault >= 0 && f.fault <= 1));
assert.deepEqual(unrated, [],
  `Replicata: read each fatality's fault value.\nExpectata: rated, a number in [0, 1] (python3 data/faultrate.py rates an unrated incident).\nResultata: ${JSON.stringify(unrated)}.`);

// The fatality metric's count for each ADS line, in the default window and
// over the full history, against a recount from the records above: the sum of
// 1/vehiclesInvolved over the Fatality incidents on the line (its series)
// whose month is in the window.
const metric = JSON.parse(vm.runInContext(`(() => {
  loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  const full = monthSeriesData();
  const first = {default: full.months.indexOf(DEFAULT_START_MONTH), full: 0};
  return JSON.stringify({ lines: ADS_SERIES, start: {default: DEFAULT_START_MONTH, full: full.months[0]}, end: full.months.at(-1),
    k: Object.fromEntries(Object.entries(first).map(([name, i]) => [name, Object.fromEntries(
      monthlySummaryRows(sliceSeries(full, i, full.months.length - 1)).filter(row => ADS_SERIES.includes(row.helmer))
        .map(row => [row.helmer, row.mpiEstimates.fatality === null ? null : row.mpiEstimates.fatality.k]))])) });
})()`, ctx));
const MONTH_NUMBER = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const monthOf = date => { const [mon, year] = date.split("-"); assert.ok(mon in MONTH_NUMBER && /^\d{4}$/.test(year), `a fatality dated ${JSON.stringify(date)}, not MMM-YYYY`); return `${year}-${MONTH_NUMBER[mon]}`; };
const miscountedMetric = Object.keys(metric.k).flatMap(name => metric.lines.map(line => {
  const mine = fatalities.filter(f => f.series.includes(line) && monthOf(f.date) >= metric.start[name] && monthOf(f.date) <= metric.end);
  const want = mine.reduce((sum, f) => sum + 1 / f.vehiclesInvolved, 0), got = metric.k[name][line];
  return { window: name, line, got, want, fatalities: mine.map(f => `${f.reportId} (${f.vehiclesInvolved} vehicles)`) };
})).filter(c => !(typeof c.got === "number" && Math.abs(c.got - c.want) < 1e-9));
assert.deepEqual(miscountedMetric, [],
  `Replicata: read each ADS line's fatality count (mpiEstimates.fatality.k of monthlySummaryRows) in the default window (${metric.start.default} to ${metric.end}) and over the full history (${metric.start.full} to ${metric.end}), and recount it from INCIDENT_DATA.
Expectata: for each of ${metric.lines.join(", ")} the sum of 1/vehiclesInvolved over its Fatality incidents of the window (each death divided among the vehicles of its crash, the page's fatality convention; 0 for a line with none).
Resultata: ${JSON.stringify(miscountedMetric)}.`);

const byHelmer = Object.entries(fatalities.reduce((n, f) => ({ ...n, [f.helmer]: (n[f.helmer] ?? 0) + 1 }), {})).map(([h, n]) => `${h} ${n}`).join(", ");
console.log(`qual pass: ${fatalities.length} fatalities (${byHelmer}), each death divided by a vehicle count a person read from its narrative (VEHICLES_INVOLVED), each fault value rated, each line's fatality count in the default window and over the full history the sum of those shares (${SEEN})`);

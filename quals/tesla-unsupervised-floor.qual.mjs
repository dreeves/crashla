import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";
import { TESLA_PAGE_PART } from "./tesla-page-part.mjs";
import { everyMode } from "./tesla-every-mode.mjs";

// Since its Q3-2026 update (Oct 21, 2026) Tesla publishes robotaxi miles only
// for driving with no safety monitor in the vehicle; the "Cumulative Paid
// Robotaxi Miles" chart, which counted every mode and anchors the Tesla rows
// through Jun-2026, is gone. The repo's Tesla scope counts every operator mode
// (decision of 2026-10-23: keep the monitor-aboard miles), a superset of
// Tesla's no-monitor miles, so those miles bound each month from below: each
// row's floor is at least the no-monitor line's floor for the month, the
// lower of the two readings below less 3% (the line's band, the readings
// widened 3% each way for interpolation; data/vmt.csv's teslanomonitor
// 2026-01 row), and its central at least the higher reading. The months after
// the deck's chart ended (DECK_LAST) are built from the no-monitor line by
// quals/tesla-every-mode.mjs, both edges in quadrature, as the camera months
// of quals/tesla-camera-miles.qual.mjs are; their rows equal that rule, the
// cumulatives chained on DECK_LAST's row. Until 2026-11-23 each floor had to
// be at least the lower reading itself, and July-September's floors were that
// reading, 3% above the no-monitor line's floors (2026-11-20 spec finding (c);
// restated with the human's "ok fine").
//
// Two Tesla publications give the no-monitor miles per month (the first value
// of each pair, then the second):
// (1) tesla.com/robotaxi/safety, live 2026-10-21, embeds weekly cumulative
//     miles per city in <script data-info="react-data-tesla_robotaxi_graph_1">
//     (week-start Mondays, each value cumulative through that Sunday; read
//     from Wayback captures 2026-10-21 18:51 and 2026-10-23 13:24 UTC, which
//     hold identical data). A month's miles take the city sums at its month
//     end, interpolated linearly within the week that holds it.
// (2) the Q3-2026 update deck, page 8, "Cumulative Unsupervised Robotaxi
//     Miles": month-end points read from the PDF's vector paths (0 at
//     y=156.37, 2,000,000 at y=360.61), differenced by month.
// Through Jun-2026 the two agree to 1,600 mi; for Jul-Sep they differ by
// 2-5%, a difference between the publications, not interpolation.
const NO_MONITOR = {
  "2026-01": [547, 1077],
  "2026-02": [791, 0],
  "2026-03": [2966, 3525],
  "2026-04": [29638, 28202],
  "2026-05": [73616, 75206],
  "2026-06": [123823, 123384],
  "2026-07": [246410, 251469],
  "2026-08": [483680, 467685],
  "2026-09": [971738, 925284],
};
// A month the safety page covers only in part (the month in progress: a ghost
// month, quals/ghost-month.qual.mjs) is bounded below by the miles the page
// shows for it so far, its city sums through the last complete week, the week
// that starts in the month before interpolated linearly. Oct 1-18, 2026:
// 1,179,333 (the page as of Oct 18, read from the Wayback captures of Oct 21
// to Oct 26, which hold identical data). Both Tesla lines' rows for the month
// sit at or above it (added 2026-10-26, with the ghost months). The figure is
// read from the one place that holds it (quals/tesla-page-part.mjs; until
// 2026-11-21 a literal here).
const PARTIAL = Object.fromEntries(Object.entries(TESLA_PAGE_PART).map(([month, part]) => [month, part.miles]));
// Figures are written rounded to the thousand.
const ROUNDING = 1000;
// The no-monitor line's band: the two readings widened 3% each way, the lower
// edge at least half the page's figure (a deck reading under the chart's
// ~100-mile resolution, February's 0, says nothing about the month).
const NO_MONITOR_WIDEN = 1.03;
const noMonitorBand = ([page, deck]) => ({
  c: page,
  lo: Math.max(Math.min(page, deck) / NO_MONITOR_WIDEN, page / 2),
  hi: Math.max(page, deck) * NO_MONITOR_WIDEN,
});
// The last month of Tesla's chart of miles from every mode (the Q2-2026 deck).
const DECK_LAST = "2026-06";

const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const header = raw[0];
const col = name => header.indexOf(name);
const tesla = new Map(raw.slice(1).filter(p => p[col("helmer")] === "tesla")
  .map(p => [p[col("month")], { vmt: +p[col("vmt")], min: +p[col("vmt_min")], max: +p[col("vmt_max")],
    cume: +p[col("helmer_cumulative_vmt")], cumeMin: +p[col("kyoom_min")], cumeMax: +p[col("kyoom_max")] }]));
const fmt = n => n.toLocaleString("en-US");
const round = x => Math.round(x / ROUNDING) * ROUNDING;

const problems = [];
const chained = tesla.get(DECK_LAST);
assert.ok(chained !== undefined, `data/vmt.csv has no tesla row for ${DECK_LAST}`);
let [cume, cumeMin, cumeMax] = [chained.cume, chained.cumeMin, chained.cumeMax];
for (const [month, [page, deck]] of Object.entries(NO_MONITOR)) {
  const row = tesla.get(month);
  if (row === undefined) { problems.push(`${month}: no Tesla row`); continue; }
  const band = noMonitorBand([page, deck]);
  const high = Math.max(page, deck);
  if (row.min < band.lo - ROUNDING) {
    problems.push(`${month}: lower edge ${fmt(row.min)} sits below the no-monitor line's floor ${fmt(Math.round(band.lo))}`);
  }
  if (row.vmt < high) {
    problems.push(`${month}: central ${fmt(row.vmt)} sits below Tesla's higher no-monitor reading ${fmt(high)}`);
  }
  if (month > DECK_LAST) {
    const e = everyMode(band);
    const want = { vmt: round(e.c), min: round(e.lo), max: round(e.hi) };
    [cume, cumeMin, cumeMax] = [cume + want.vmt, cumeMin + want.min, cumeMax + want.max];
    Object.assign(want, { cume, cumeMin, cumeMax });
    const off = Object.keys(want).filter(k => row[k] !== want[k]);
    if (off.length > 0) {
      problems.push(`${month}: the every-mode rule gives ${off.map(k => `${k} ${fmt(want[k])}`).join(", ")}; the row has ${off.map(k => `${k} ${fmt(row[k])}`).join(", ")}`);
    }
  }
  // The two readings are transcribed by hand; months of 10,000+ mi must agree
  // within 5% (they do; a typo would not).
  if (high >= 10000 && (high - Math.min(page, deck)) / high > 0.05) {
    problems.push(`${month}: page ${fmt(page)} and deck ${fmt(deck)} differ by more than 5%`);
  }
}
const lineRows = line => new Map(raw.slice(1).filter(p => p[col("helmer")] === line)
  .map(p => [p[col("month")], { min: +p[col("vmt_min")] }]));
for (const line of ["tesla", "teslanomonitor"]) {
  const rows = lineRows(line);
  for (const [month, shown] of Object.entries(PARTIAL)) {
    const row = rows.get(month);
    if (row === undefined) problems.push(`${line} ${month}: no row`);
    else if (row.min < shown - ROUNDING) problems.push(`${line} ${month}: lower edge ${fmt(row.min)} sits below the ${fmt(shown)} miles Tesla's page already shows for the month`);
  }
}
assert.deepEqual(problems, [],
  `Replicata: compare each Tesla data/vmt.csv row for 2026-01..2026-09 with Tesla's published no-safety-monitor miles (safety page and Q3-2026 deck), and both Tesla lines' rows for ${Object.keys(PARTIAL).join(", ")} with the miles the safety page shows for that month so far.
Expectata: every row's lower edge is at least the no-monitor line's floor (the lower of Tesla's two readings less 3%, less rounding), its central at least the higher reading, and the two readings agree within 5%; each row after ${DECK_LAST} equals the every-mode rule on the no-monitor line's band (quals/tesla-every-mode.mjs), its cumulatives chained on ${DECK_LAST}'s row; a partly covered month's lower edges at least the page's miles for it so far (less rounding).
Resultata: ${JSON.stringify(problems, null, 1)}.`);

console.log(`qual pass: Tesla rows for ${Object.keys(NO_MONITOR).length} months sit on or above the no-monitor line's floors, and those after ${DECK_LAST} equal the every-mode rule`);

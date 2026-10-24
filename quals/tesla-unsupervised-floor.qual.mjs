import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// Since its Q3-2026 update (Oct 21, 2026) Tesla publishes robotaxi miles only
// for driving with no safety monitor in the vehicle; the "Cumulative Paid
// Robotaxi Miles" chart, which counted every mode and anchors the Tesla rows
// through Jun-2026, is gone. The repo's Tesla scope counts every operator mode
// (decision of 2026-10-23: keep the monitor-aboard miles), a superset of
// Tesla's no-monitor miles, so those miles bound each month from below.
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
// Floors are written rounded down to the thousand.
const ROUNDING = 1000;

const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const header = raw[0];
const col = name => header.indexOf(name);
const tesla = new Map(raw.slice(1).filter(p => p[col("helmer")] === "tesla")
  .map(p => [p[col("month")], { vmt: +p[col("vmt")], min: +p[col("vmt_min")], max: +p[col("vmt_max")] }]));
const fmt = n => n.toLocaleString("en-US");

const problems = [];
for (const [month, [page, deck]] of Object.entries(NO_MONITOR)) {
  const row = tesla.get(month);
  if (row === undefined) { problems.push(`${month}: no Tesla row`); continue; }
  const floor = Math.min(page, deck);
  const high = Math.max(page, deck);
  if (row.min < floor - ROUNDING) {
    problems.push(`${month}: lower edge ${fmt(row.min)} sits below Tesla's no-monitor miles ${fmt(floor)}`);
  }
  if (row.vmt < high) {
    problems.push(`${month}: central ${fmt(row.vmt)} sits below Tesla's higher no-monitor reading ${fmt(high)}`);
  }
  // The two readings are transcribed by hand; months of 10,000+ mi must agree
  // within 5% (they do; a typo would not).
  if (high >= 10000 && (high - floor) / high > 0.05) {
    problems.push(`${month}: page ${fmt(page)} and deck ${fmt(deck)} differ by more than 5%`);
  }
}
assert.deepEqual(problems, [],
  `Replicata: compare each Tesla data/vmt.csv row for 2026-01..2026-09 with Tesla's published no-safety-monitor miles (safety page and Q3-2026 deck).
Expectata: every row's lower edge is at least the lower of Tesla's two readings (less rounding), its central at least the higher one, and the two readings agree within 5%.
Resultata: ${JSON.stringify(problems, null, 1)}.`);

console.log(`qual pass: Tesla rows for ${Object.keys(NO_MONITOR).length} months sit on or above Tesla's own no-safety-monitor miles`);

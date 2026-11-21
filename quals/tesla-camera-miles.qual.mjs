// Tesla's miles for the days its own page has not measured come from the
// data in hand, with no growth assumed (the human, 2026-11-16: "i don't like
// the idea of assuming continued growth. we should just make the best
// estimates we can based on the data we have. assume as little as possible.
// maybe we have to assume that robotaxitracker is consistent? whatever the
// uncertainty is, the confidence bands should reflect that").
//
// The data: Robotaxi Tracker's Camera watch (https://robotaxitracker.com/cameras,
// credit Robotaxi Tracker, https://robotaxitracker.com) counts Cybercabs per
// 1,000 vehicles on Austin's public traffic cameras each UTC day. A person
// copies the page's "Show data" table from a browser, and data/slurp.py's
// camera step saves the copy in data/snapshots
// (robotaxitracker-cameras-YYYYMMDD.tsv; no script fetches the site).
// CAMERA_WEEKS below is the mean of the newest saved table's daily Cybercab
// rate over each whole Monday-Sunday week, rounded to four decimals, read
// through quals/camera-table.mjs (data/slurp.py's own reader, which stops on
// a file that is not such a table). Until 2026-11-20, when the tables
// entered data/snapshots, it held those means copied by hand, the eight of
// Sep 21-Nov 15, 2026, as the page's table read on 2026-11-16 (the table the
// human saved on 2026-11-20, the first in data/snapshots, gives the same
// eight to four decimals). TESLA_WEEKS holds
// Tesla's own no-monitor miles for the weeks both series cover (Tesla's
// safety page, all cities, as of Oct 18, 2026), entered by hand.
//
// So a newer table whose whole weeks differ from the last one's in a week this
// qual reads, a calibration week (TESLA_WEEKS) or one holding a day of MONTHS
// (a week it completes, or one it changes: the site can reprocess its days),
// changes the rows this qual recomputes: it then fails until data/vmt.csv's
// Tesla rows are redone from that table (data/README.md, Ghost months; the
// camera step names such weeks when it saves a table). A week wholly after
// MONTHS moves no row here. MONTHS must name every Tesla month of
// data/vmt.csv from its first on (asserted below: each such month rests on
// the camera, Tesla's page having measured none of them whole), so a new
// month's Tesla rows fail here until MONTHS names the month and they follow
// the rule.
//
// The rule this qual recomputes (data/README.md, Ghost months):
//   1. K, the miles per unit of camera rate, is the geometric mean over the
//      weeks both series cover of (Tesla's weekly miles / the week's mean
//      camera rate). The one assumption is that this ratio holds.
//   2. A day Tesla has not measured gets K x its week's mean camera rate / 7
//      (linear within the week, as Tesla's page series is read). A day past
//      the camera's last week gets the last week's rate: no growth, no fall.
//   3. Range of each camera-covered day: x e^(-w) to x e^(w), with
//      w = sqrt((t x s x sqrt(1 + 1/n))^2 + (1.96 x 0.07)^2 x h).
//      The first term is the calibration's: n the number of weeks both series
//      cover, s the sample standard deviation of ln(weekly miles / camera
//      rate) over them, t Student's 97.5% point at n - 1 degrees of freedom,
//      the 95% prediction interval for one new week (x0.78 to x1.29 at four
//      weeks). The second is drift since the calibration, in the site's
//      Cybercab detector or cameras or in the ratio itself, which nothing
//      measures (the human, 2026-11-20: "yes please to accounting for the
//      detector uncertainty/drift"): 0.07 is the repo's drift prior, ln per
//      square root of a month, from Zoox's band formula (data/README.md,
//      Ghost months), an assumed number with no data behind it; h is the
//      day's distance in months (days / 30.44) from the middle of the
//      calibration weeks (the mean of their days: Oct 5, 00:00 UTC, between
//      Oct 4 and Oct 5, for Sep 21-Oct 18, 2026), measured to the day's own
//      middle. The days' edges are summed (their errors taken as moving
//      together). Until 2026-11-20 every camera-covered day took the first
//      term alone.
//   4. Range of the days past the camera's last week: x0.5 to x2, the
//      README's rule for days with no data. Only whole Monday-Sunday weeks
//      enter CAMERA_WEEKS, each mean taken over seven days (asserted below;
//      the week of Nov 16, 2026 had four days in the table saved on Nov 20,
//      so its days are past the last week).
//   5. The month's range is the sum of the parts' edges (plus the measured
//      part, as is), widened on a log scale by 0.066 in quadrature for the
//      gap between Tesla's page and its deck.
//   6. The every-mode line: floor = the no-monitor floor; central = the
//      no-monitor central + 33,000 (June 2026's monitor-aboard remainder);
//      top = central x e^sqrt(ln(no-monitor top / no-monitor central)^2 +
//      ln(1.27 x no-monitor central / central)^2).
//   7. Figures are rounded to 1,000; cumulatives and their bands chain on the
//      month before.
//
// Replicata/Expectata/Resultata are in each assertion's message.
import assert from "node:assert/strict";
import fs from "node:fs";
import { NEWEST_CAMERA_TABLE } from "./camera-table.mjs";

const TESLA_WEEKS = { "2026-09-21": 258043, "2026-09-28": 334281, "2026-10-05": 430621, "2026-10-12": 557694 };
// The newest saved table's whole weeks (rule 4): each mean of seven days.
const shortWeeks = Object.entries(NEWEST_CAMERA_TABLE.weeks).filter(([, w]) => w.days !== 7);
assert.deepEqual(shortWeeks, [],
  `Replicata: read the whole Monday-Sunday weeks of the newest saved camera table (${NEWEST_CAMERA_TABLE.path}) through quals/camera-table.mjs.
Expectata: each week's Cybercab mean taken over its seven days.
Resultata: ${JSON.stringify(shortWeeks)}.`);
const CAMERA_WEEKS = Object.fromEntries(Object.entries(NEWEST_CAMERA_TABLE.weeks).map(([monday, w]) => [monday, w.mean]));
// Tesla's page, Oct 1-18, 2026 (4 days of the week of Sep 28, then two weeks).
const MEASURED = { "2026-10": { miles: 1179333, through: "2026-10-18" } };
const MONTHS = ["2026-10", "2026-11"];
const MONITOR_ABOARD = 33000, PAGE_DECK_GAP = 0.066, NO_DATA = [0.5, 2];
// The drift term (rule 3): ln per square root of a month, at 1.96 for 95%,
// over months of 30.44 days, as Zoox's band formula has them.
const DRIFT = 0.07, Z975 = 1.96, MONTH_DAYS = 30.44;
// Student's t, 97.5% point, by degrees of freedom.
const T975 = { 1: 12.7062047, 2: 4.30265273, 3: 3.18244631, 4: 2.77644511, 5: 2.57058184, 6: 2.44691185,
               7: 2.36462425, 8: 2.30600414, 9: 2.26215716, 10: 2.22813885, 11: 2.20098516, 12: 2.17881283 };

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const weekOf = day => {                       // the Monday on or before an ISO day
  const ms = Date.parse(day), dow = (new Date(ms).getUTCDay() + 6) % 7;
  return iso(ms - dow * DAY);
};
const calWeeks = Object.keys(TESLA_WEEKS);
calWeeks.forEach(w => assert.ok(w in CAMERA_WEEKS, `no camera rate for Tesla's measured week ${w}`));
const n = calWeeks.length;
assert.ok(n - 1 in T975, `no t value for ${n - 1} degrees of freedom`);
const logs = calWeeks.map(w => Math.log(TESLA_WEEKS[w] / CAMERA_WEEKS[w]));
const mean = logs.reduce((a, b) => a + b, 0) / n;
const s = Math.sqrt(logs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
const K = Math.exp(mean), cal = T975[n - 1] * s * Math.sqrt(1 + 1 / n);
const CAMERA = [Math.exp(-cal), Math.exp(cal)];
const lastCameraWeek = Object.keys(CAMERA_WEEKS).sort().at(-1);
// The middle of the calibration weeks: the mean of their days' middles.
const middle = calWeeks.flatMap(w => [0, 1, 2, 3, 4, 5, 6].map(i => Date.parse(w) + (i + 0.5) * DAY))
  .reduce((a, b) => a + b, 0) / (7 * n);
// A camera-covered day's half-width in ln miles (rule 3), d the day's start
// in ms (so d + DAY / 2 its middle).
const halfWidth = d => Math.hypot(cal, Z975 * DRIFT * Math.sqrt(Math.abs(d + DAY / 2 - middle) / DAY / MONTH_DAYS));
// For the messages: the first day after the calibration weeks and the last
// day of the camera's last week, the ends of the estimated camera-covered days.
const firstEstimated = Date.parse(calWeeks.slice().sort().at(-1)) + 7 * DAY;
const lastCovered = Date.parse(lastCameraWeek) + 6 * DAY;
const factorsAt = d => `x${Math.exp(-halfWidth(d)).toFixed(3)} to x${Math.exp(halfWidth(d)).toFixed(3)} on ${iso(d)}`;

// A month's parts, one per day after the measured part: [miles, low factor, high factor].
const monthParts = month => {
  const first = Date.parse(month + "-01"), [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const measured = MEASURED[month] ?? { miles: 0, through: iso(first - DAY) };
  const parts = [[measured.miles, 1, 1]];
  for (let d = Date.parse(measured.through) + DAY; d < first + days * DAY; d += DAY) {
    const w = weekOf(iso(d)), covered = w in CAMERA_WEEKS;
    assert.ok(covered || w > lastCameraWeek, `day ${iso(d)} falls in a week before the camera series with no rate`);
    const miles = K * CAMERA_WEEKS[covered ? w : lastCameraWeek] / 7;
    parts.push(covered ? [miles, Math.exp(-halfWidth(d)), Math.exp(halfWidth(d))] : [miles, ...NO_DATA]);
  }
  return parts;
};
const round = x => Math.round(x / 1000) * 1000;
const noMonitor = month => {
  const parts = monthParts(month);
  const c = parts.reduce((a, p) => a + p[0], 0);
  const lo = parts.reduce((a, p) => a + p[0] * p[1], 0), hi = parts.reduce((a, p) => a + p[0] * p[2], 0);
  return { c, lo: c * Math.exp(-Math.hypot(Math.log(c / lo), PAGE_DECK_GAP)), hi: c * Math.exp(Math.hypot(Math.log(hi / c), PAGE_DECK_GAP)) };
};
const everyMode = ({ c, lo, hi }) => {
  const C = c + MONITOR_ABOARD;
  return { c: C, lo, hi: C * Math.exp(Math.hypot(Math.log(hi / c), Math.log(1.27 * c / C))) };
};

// data/vmt.csv: helmer, month, vmt, cumulative, cumulative low, cumulative high, vmt low, vmt high, rationale
const rows = {};
for (const line of fs.readFileSync(new URL("../data/vmt.csv", import.meta.url), "utf8").split("\n")) {
  const f = line.split(",");
  if (f[0] === "tesla" || f[0] === "teslanomonitor") rows[`${f[0]}|${f[1]}`] = f.slice(2, 8).map(Number);
}
// Every Tesla month from MONTHS' first on, on both lines, is one this qual
// recomputes.
for (const line of ["teslanomonitor", "tesla"]) {
  const months = Object.keys(rows).map(k => k.split("|")).filter(([l, m]) => l === line && m >= MONTHS[0]).map(([, m]) => m).sort();
  assert.deepEqual(months, MONTHS,
    `Replicata: list data/vmt.csv's ${line} months from ${MONTHS[0]} on, and this qual's MONTHS.
Expectata: the same months: each rests on the camera rule (data/README.md, Ghost months), so MONTHS names each, and this qual recomputes its row (add a new month to MONTHS with its rows).
Resultata: data/vmt.csv ${JSON.stringify(months)}; MONTHS ${JSON.stringify(MONTHS)}.`);
}
const problems = [];
for (const [line, est] of [["teslanomonitor", noMonitor], ["tesla", m => everyMode(noMonitor(m))]]) {
  const before = rows[`${line}|2026-09`];
  assert.ok(before, `data/vmt.csv has no ${line} row for 2026-09`);
  let [, cume, cumeLo, cumeHi] = before;
  for (const month of MONTHS) {
    const e = est(month), want = [round(e.c), 0, 0, 0, round(e.lo), round(e.hi)];
    cume += want[0]; cumeLo += want[4]; cumeHi += want[5];
    [want[1], want[2], want[3]] = [cume, cumeLo, cumeHi];
    const got = rows[`${line}|${month}`];
    if (!got || got.some((x, i) => x !== want[i]))
      problems.push(`${line} ${month}: expected ${want.join(", ")}; the row has ${got ? got.join(", ") : "nothing (no row)"}`);
  }
}
assert.deepEqual(problems, [],
  `Replicata: recompute Tesla's rows of ${MONTHS.join(" and ")} (both lines) from Tesla's four measured weeks, the weekly camera rates of Robotaxi Tracker's newest saved table (${NEWEST_CAMERA_TABLE.path}: ${Object.keys(CAMERA_WEEKS).length} whole weeks, through ${iso(lastCovered)}) and the rule in this qual's header, and compare with data/vmt.csv (miles, cumulative, cumulative low, cumulative high, miles low, miles high).
Expectata: the rows equal the recomputation (K = ${Math.round(K).toLocaleString("en-US")} miles per unit of camera rate over ${n} weeks; the calibration term alone x${CAMERA[0].toFixed(3)} to x${CAMERA[1].toFixed(3)}; with the drift term, camera-covered days ${factorsAt(firstEstimated)} to ${factorsAt(lastCovered)}).
Resultata:\n  ${problems.join("\n  ")}`);
console.log(`qual pass: Tesla's rows of ${MONTHS.join(" and ")} equal the camera-rate estimate from ${NEWEST_CAMERA_TABLE.path}'s ${Object.keys(CAMERA_WEEKS).length} whole weeks (K = ${Math.round(K).toLocaleString("en-US")}; camera-covered days ${factorsAt(firstEstimated)} to ${factorsAt(lastCovered)}, the calibration term x${CAMERA[0].toFixed(3)} to x${CAMERA[1].toFixed(3)} widened by drift; x${NO_DATA[0]} to x${NO_DATA[1]} past them)`);

// Tesla's miles for the days its own page has not measured come from the
// data in hand, with no growth assumed (the human, 2026-11-16: "i don't like
// the idea of assuming continued growth. we should just make the best
// estimates we can based on the data we have. assume as little as possible.
// maybe we have to assume that robotaxitracker is consistent? whatever the
// uncertainty is, the confidence bands should reflect that").
//
// The data: Robotaxi Tracker's Camera watch (https://robotaxitracker.com/cameras,
// credit Robotaxi Tracker, https://robotaxitracker.com) counts Cybercabs per
// 1,000 vehicles on Austin's public traffic cameras each UTC day. CAMERA_WEEKS
// below holds the mean of its daily rate over each Monday-Sunday week, as the
// page's "Show data" table read on 2026-11-16. TESLA_WEEKS holds Tesla's own
// no-monitor miles for the weeks both series cover (Tesla's safety page, all
// cities, as of Oct 18, 2026).
//
// The rule this qual recomputes (data/README.md, Ghost months):
//   1. K, the miles per unit of camera rate, is the geometric mean over the
//      weeks both series cover of (Tesla's weekly miles / the week's mean
//      camera rate). The one assumption is that this ratio holds.
//   2. A day Tesla has not measured gets K x its week's mean camera rate / 7
//      (linear within the week, as Tesla's page series is read). A day past
//      the camera's last week gets the last week's rate: no growth, no fall.
//   3. Range of the camera-covered days: x e^(-h) to x e^(h), with
//      h = t x s x sqrt(1 + 1/n): n the number of weeks both series cover, s
//      the sample standard deviation of ln(weekly miles / camera rate) over
//      them, t Student's 97.5% point at n - 1 degrees of freedom. That is the
//      95% prediction interval for one new week, applied to all such days at
//      once (their errors taken as moving together).
//   4. Range of the days past the camera's last week: x0.5 to x2, the
//      README's rule for days with no data.
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

const TESLA_WEEKS = { "2026-09-21": 258043, "2026-09-28": 334281, "2026-10-05": 430621, "2026-10-12": 557694 };
const CAMERA_WEEKS = { "2026-09-21": 0.9747, "2026-09-28": 1.3873, "2026-10-05": 1.7286, "2026-10-12": 1.9714,
                       "2026-10-19": 2.0757, "2026-10-26": 2.2286, "2026-11-02": 2.4129, "2026-11-09": 3.1343 };
// Tesla's page, Oct 1-18, 2026 (4 days of the week of Sep 28, then two weeks).
const MEASURED = { "2026-10": { miles: 1179333, through: "2026-10-18" } };
const MONTHS = ["2026-10", "2026-11"];
const MONITOR_ABOARD = 33000, PAGE_DECK_GAP = 0.066, NO_DATA = [0.5, 2];
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
const K = Math.exp(mean), h = T975[n - 1] * s * Math.sqrt(1 + 1 / n);
const CAMERA = [Math.exp(-h), Math.exp(h)];
const lastCameraWeek = Object.keys(CAMERA_WEEKS).sort().at(-1);

// A month's parts: [miles, low factor, high factor].
const monthParts = month => {
  const first = Date.parse(month + "-01"), [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const measured = MEASURED[month] ?? { miles: 0, through: iso(first - DAY) };
  const parts = [[measured.miles, 1, 1], [0, ...CAMERA], [0, ...NO_DATA]];
  for (let d = Date.parse(measured.through) + DAY; d < first + days * DAY; d += DAY) {
    const w = weekOf(iso(d)), covered = w in CAMERA_WEEKS;
    assert.ok(covered || w > lastCameraWeek, `day ${iso(d)} falls in a week before the camera series with no rate`);
    parts[covered ? 1 : 2][0] += K * CAMERA_WEEKS[covered ? w : lastCameraWeek] / 7;
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
  `Replicata: recompute Tesla's October and November 2026 rows (both lines) from Tesla's four measured weeks, Robotaxi Tracker's weekly camera rates and the rule in this qual's header, and compare with data/vmt.csv (miles, cumulative, cumulative low, cumulative high, miles low, miles high).
Expectata: the rows equal the recomputation (K = ${Math.round(K).toLocaleString("en-US")} miles per unit of camera rate over ${n} weeks; camera-covered days x${CAMERA[0].toFixed(3)} to x${CAMERA[1].toFixed(3)}).
Resultata:\n  ${problems.join("\n  ")}`);
console.log(`qual pass: Tesla's October and November 2026 rows equal the camera-rate estimate (K = ${Math.round(K).toLocaleString("en-US")}, range x${CAMERA[0].toFixed(3)} to x${CAMERA[1].toFixed(3)} on camera-covered days, x${NO_DATA[0]} to x${NO_DATA[1]} past them)`);

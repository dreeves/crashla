import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";

// Tesla's growth forecasts (for GROWTH_FORECAST_DATE; Jan 1, 2027 until
// 2026-10-29, Jan 1, 2028 since) may not sit below what Tesla's own October
// 2026 measurements already imply (2026-10-23: the forecasts of 2026-09-04/26
// had scenario A reach 5.5M cumulative miles and 240 vehicles by Jan 1, both
// overtaken by mid-October once tesla.com/robotaxi/safety published weekly
// miles).
// - Miles: the robotaxi lane's median is at least the cumulative through Oct
//   18 (data/vmt.csv's end-September cumulative plus Tesla's 1,179,333
//   no-monitor miles for Oct 1-18) plus the week to Oct 18 (557,694 miles)
//   held flat through the day before the forecast date. A median below that
//   assumes a decline no data show (weekly miles grew 12-30% every week from
//   June to October).
// - Fleet: the robotaxi lane's median is at least the week to Oct 18's
//   79,669 miles a day over the ~180 miles per vehicle-day Tesla's fleet ran
//   in Q2 2026 (5-6k miles per vehicle-month), ~442 vehicles in service.
const OCT_1_18 = 1179333, WEEK_TO_OCT_18 = 557694, MILES_PER_VEHICLE_DAY = 180;

const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const sepRow = raw.find(p => p[0] === "tesla" && p[1] === "2026-09");
assert.ok(sepRow, "data/vmt.csv has a tesla 2026-09 row");
const fleetFloor = WEEK_TO_OCT_18 / 7 / MILES_PER_VEHICLE_DAY;

const ctx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);
// The driving days after Oct 18, 2026 (the last day the page had measured)
// that the forecast's cumulative covers: Oct 19 through the day before the
// forecast date, read from the app (74 for Jan 1, 2027, the forecast date
// until 2026-10-29; 439 for Jan 1, 2028). From 2026-10-29 to 2026-10-31 this
// counted from Oct 18 and so took in one day too many (75, then 440).
const FORECAST_DATE = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
const DAYS_TO_FORECAST = (Date.parse(FORECAST_DATE) - Date.parse("2026-10-19")) / 86400000;
const milesFloor = +sepRow[3] + OCT_1_18 + WEEK_TO_OCT_18 / 7 * DAYS_TO_FORECAST;
// The robotaxi lane is read, never assumed (until 2026-11-06 a metric
// without one stopped this qual on a TypeError naming nothing). assert is
// crashla.js's, which throws its message with the details appended.
const med = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(["miles", "fleet"].map(m => {
  const curves = fleetDistributionCurves(m);
  const lane = curves.find(c => c.key === "robotaxi");
  assert(lane !== undefined, "Replicata: draw the growth forecast's lanes on " + m + " (fleetDistributionCurves) and find Tesla's robotaxi lane (key \\"robotaxi\\").\\nExpectata: one, its median the forecast this check floors.\\nResultata: none; the lanes' keys are", curves.map(c => c.key));
  return [m, lane.median];
})))`, ctx));

const fmt = n => Math.round(n).toLocaleString("en-US");
assert.ok(med.miles >= milesFloor && med.fleet >= fleetFloor,
  `Replicata: read Tesla's robotaxi-lane medians for cumulative miles and fleet size on the forecast date (${FORECAST_DATE}).
Expectata: miles median >= ${fmt(milesFloor)} (cumulative through Oct 18 plus the week to Oct 18 held flat for the ${DAYS_TO_FORECAST} days from Oct 19 through the day before the forecast date); fleet median >= ${fmt(fleetFloor)} (the week to Oct 18's daily miles at ${MILES_PER_VEHICLE_DAY} miles per vehicle-day).
Resultata: miles median ${fmt(med.miles)}, fleet median ${fmt(med.fleet)}.`);

console.log(`qual pass: Tesla's ${FORECAST_DATE} medians (${fmt(med.miles)} miles, ${fmt(med.fleet)} vehicles) sit at or above what its October 2026 mileage implies (miles floor ${fmt(milesFloor)} over ${DAYS_TO_FORECAST} days; fleet floor ${fmt(fleetFloor)})`);

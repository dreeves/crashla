// Monitors the two independent stationarity signals — instantaneous `speed` and
// the categorical `svMovement` — for the nonstationary metric. They legitimately
// measure different things (speed at impact vs the pre-crash maneuver category),
// so they need not agree on every row; `speed == 0` is authoritative for "was
// the AV moving at impact". This is a DRIFT monitor: it fails loud if the
// disagreement rate blows past a small bound, which would signal a data/schema
// regression (e.g. speed parsing breaking and mass-defaulting to 0), and,
// since 2026-11-04 and 2026-11-06, if a record does not hold both signals or
// more than 1% of the records hold a null speed (either would leave the bound
// counting nothing). It does not change the metric — see crashla.js
// nonstationaryIncidentCount.
import assert from "node:assert/strict";
import vm from "node:vm";
import { dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ Math, Number, Object, JSON, Array, Set });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
const data = vm.runInContext("INCIDENT_DATA", ctx);

// Obviously-in-motion pre-crash maneuvers (an allowlist; an unrecognized value
// is simply not flagged, so this can't false-alarm — it only catches a MASS
// speed-vs-movement divergence).
const MOVING = /Proceeding|Making|Turn|Changing|Merging|Passing|Backing|Entering|Leaving|Negotiating|Accelerat|Decelerat|Traveling/;

// Both signals are read on every record: data/slurp.py writes svMovement
// ("SV Pre-Crash Movement") as a string and speed ("SV Precrash Speed (MPH)")
// as a whole number, or null where the filed value is not one. A record
// lacking either counts as agreeing, so until 2026-11-04 (svMovement then read
// as "" when absent) a renamed or dropped field left this monitor counting
// nothing and passing at 0 disagreements.
const unread = data.filter(r => typeof r.svMovement !== "string" || !(typeof r.speed === "number" || r.speed === null));
// What a record holds under a field: "absent", or the value's type and the
// value (until 2026-11-06 the message said every such record lacked a field,
// also when it held one of the wrong type).
const held = (r, field) => field in r ? `${typeof r[field]} ${JSON.stringify(r[field])}` : "absent";
assert.equal(unread.length, 0,
  `Replicata: read svMovement (data/slurp.py's "SV Pre-Crash Movement") and speed ("SV Precrash Speed (MPH)") on every INCIDENT_DATA record.
Expectata: on each, svMovement a string and speed a number or null (a filed speed that is not a whole number).
Resultata: ${unread.length} of ${data.length} records lack one or hold it with another type; the first: ${unread.slice(0, 5).map(r => `${r.reportId} (svMovement: ${held(r, "svMovement")}; speed: ${held(r, "speed")})`).join("; ")}.`);

// Few speeds are null: data/slurp.py stores null where the filed speed is not
// a whole number (3 of 2,221 records on 2026-11-06), and a null speed counts
// as agreeing with any movement, so a parse that nulled every speed would
// leave the drift monitor below counting nothing and passing at 0
// disagreements. Bound: 1% of the records.
const NULL_SPEED_SHARE = 0.01;
const nullSpeed = data.filter(r => r.speed === null);
assert.ok(nullSpeed.length <= NULL_SPEED_SHARE * data.length,
  `Replicata: count the INCIDENT_DATA records whose speed (data/slurp.py's "SV Precrash Speed (MPH)") is null.
Expectata: at most ${NULL_SPEED_SHARE * 100}% of the ${data.length} records (${Math.floor(NULL_SPEED_SHARE * data.length)}); a filed speed is a whole number but for a few.
Resultata: ${nullSpeed.length}; the first: ${nullSpeed.slice(0, 5).map(r => r.reportId).join(", ")}.`);

let spd0Moving = 0, stoppedSpdPos = 0;
for (const r of data) {
  if (r.speed === 0 && MOVING.test(r.svMovement)) spd0Moving++;
  if (r.svMovement === "Stopped" && typeof r.speed === "number" && r.speed > 0) stoppedSpdPos++;
}
const n = data.length;
const disagree = spd0Moving + stoppedSpdPos;
const BOUND = 0.03; // current ≈ 1.3%; alert if it doubles+

assert.ok(
  disagree / n < BOUND,
  `Replicata: count speed-vs-svMovement stationarity disagreements across INCIDENT_DATA.
Expectata: < ${(BOUND * 100).toFixed(0)}% (speed is authoritative for stationarity; a spike means a data/schema regression — investigate, don't just raise the bound).
Resultata: ${disagree}/${n} = ${(100 * disagree / n).toFixed(1)}% (speed0-but-moving=${spd0Moving}, stopped-but-speed>0=${stoppedSpdPos}).`);

console.log(`qual pass: speed/svMovement stationarity disagreement ${disagree}/${n} = ${(100 * disagree / n).toFixed(1)}% (under ${(BOUND * 100).toFixed(0)}% bound)`);

// Monitors the two independent stationarity signals — instantaneous `speed` and
// the categorical `svMovement` — for the nonstationary metric. They legitimately
// measure different things (speed at impact vs the pre-crash maneuver category),
// so they need not agree on every row; `speed == 0` is authoritative for "was
// the AV moving at impact". This is a DRIFT monitor: it fails loud only if the
// disagreement rate blows past a small bound, which would signal a data/schema
// regression (e.g. speed parsing breaking and mass-defaulting to 0). It does not
// change the metric — see crashla.js nonstationaryIncidentCount.
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

let spd0Moving = 0, stoppedSpdPos = 0;
for (const r of data) {
  if (r.speed === 0 && MOVING.test(r.svMovement || "")) spd0Moving++;
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

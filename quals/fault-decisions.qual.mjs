// Fault values decided on 2026-10-31 (data/faultfrac.csv; the criterion is
// the probability an expert human driver would have avoided the crash).
//
// 1. The family "AV maneuvers past a stationary vehicle and strikes its body,
// bed, protruding part or open door" under one rule (re-adjudicated after the
// 2026-10-30 audit found the same squeeze-past-a-parked-truck crash at 0.4 for
// a Waymo, 30270-11836, and 1.0 for a Tesla, 13781-13644). A moving AV in its
// own low-speed maneuver strikes a stationary vehicle or a part of one, and no
// other road user moves into it; the struck element is scored by its state
// when the AV committed:
//   the body (a bed, flatbed or trailer deck, a bumper corner)       1.0
//   a static projection met at walking pace (a ramp or lift gate
//     lowered to the ground, a hitch, a door already standing open)   0.9
//   a static projection met at road speed                            0.8
//   a part moving under its own mechanism that the AV moves into     0.6
//   the AV's own rider's door, opened mid-pass after a prior cue      0.2
//   an evasive swerve into a parked vehicle (outside the family)     0.5
// 2. The human's answers: 30270-8833 0.15 (decision #44b of 2026-10-04: the
// forklift was stopped when the AV committed and began reversing only after),
// and 30610-16275 0.4 (open question 9, 2026-10-31: the Zoox struck a dog, then
// resumed motion and its rear wheel apparently struck the dog again).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseCsv } from "./csv-parse.mjs";

const WANT = {
  "30270-11836": [1, "body: a flatbed corner, squeezing past a truck parked partly in the lane"],
  "13781-13644": [1, "body: a parked tow truck's bed, squeezing down a narrowed street"],
  "30270-16038": [1, "body: a parked car, threading a self-chosen gap"],
  "30270-11608": [1, "body: the flatbed of the pickup parked ahead, leaving a curb spot"],
  "30270-11671": [1, "body: the flatbed trailer parked ahead, leaving a curb spot"],
  "30270-8156": [1, "body: the SUV parked ahead, leaving a curb spot"],
  "30270-5758": [1, "body: a parked car's bumper, pulling over"],
  "30270-6133": [1, "body: a stopped SUV, reversing to reroute"],
  "30270-10274": [0.9, "static projection: a lift gate lowered to the ground, passing at 4 mph"],
  "30270-11771": [0.9, "static projection: a loading ramp lowered to the ground, passing at 2 mph"],
  "30270-11161": [0.9, "static projection: a parked trailer's hitch, reversing at 2 mph"],
  "30270-11664": [0.9, "static projection: a door left open, pulling away at 2 mph"],
  "13781-11986": [0.8, "static projection at road speed: a gooseneck hitch jutting into the street, 18 mph after dark"],
  "30270-14426": [0.6, "moving part: a liftgate rising when the AV pulled forward"],
  "30270-9606": [0.6, "moving part: a loading ramp lowering when the AV nudged past"],
  "30270-11224": [0.2, "own rider's door, opened mid-pass after the rider had opened it once as the AV started"],
  "30270-10912": [0.5, "evasive swerve from a pickup crossing the centerline into a parked truck"],
  "30270-8833": [0.15, "decision #44b: the forklift began reversing after the AV committed"],
  "30610-16275": [0.4, "open question 9: the Zoox resumed motion after striking the dog"],
};
const [header, ...rows] = parseCsv(fs.readFileSync("data/faultfrac.csv", "utf8"));
const iId = header.indexOf("reportID"), iFrac = header.indexOf("faultfrac");
const csv = new Map(rows.map(r => [r[iId], Number(r[iFrac])]));
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx);
const page = new Map(vm.runInContext("INCIDENT_DATA", ctx).map(r => [r.reportId, r.fault?.faultfrac]));
const off = Object.entries(WANT).filter(([rid, [v]]) => csv.get(rid) !== v || page.get(rid) !== v)
  .map(([rid, [v, why]]) => `${rid}: data/faultfrac.csv ${csv.get(rid)}, data/incidents.js ${page.get(rid)}, want ${v} (${why})`);
assert.deepEqual(off, [],
  `Replicata: read the fault values of the 2026-10-31 decisions in data/faultfrac.csv and data/incidents.js.
Expectata: each as decided (the vehicle-body family's tiers, 30270-8833 0.15, 30610-16275 0.4).
Resultata: ${JSON.stringify(off, null, 1)}.`);
console.log(`qual pass: the ${Object.keys(WANT).length} fault values decided on 2026-10-31 stand in data/faultfrac.csv and data/incidents.js`);

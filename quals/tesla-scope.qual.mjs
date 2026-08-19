// Tesla public-service scope: all three Driver/Operator Types Tesla files in
// the NHTSA ADS data count as its public robotaxi service — "None"
// (driverless), "In-Vehicle (Commercial / Test)" (safety monitor aboard), and
// "Remote (Commercial / Test)" (remote-assistance operator maneuvering the
// car). The Remote inclusion was a human decision (2026-08-19): the vehicle's
// miles are in the VMT denominator, so its crashes belong in the numerator;
// fault is judged 0 when a remote human, not the ADS, was driving (mirrors the
// passenger-caused-incident convention). Before this, report 13781-15395 (the
// Houston tree-stump recovery crash, MAY-2026) sat in the CSV for a month,
// silently excluded — EXPECTED_DRIVER_TYPES whitelists operator types
// globally, so a per-entity scope surprise never tripped anti-Postel. slurp.py
// now must()s that every Tesla row's operator type is in the configured set,
// so the next novel Tesla mode crashes the run for a human to classify.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const py = `
import json, sys
sys.path.insert(0, "data")
import slurp
print(json.dumps(sorted(slurp.PUBLIC_SERVICE_OPERATOR_TYPES["Tesla, Inc."])))
`;
const teslaTypes = JSON.parse(
  execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").at(-1));

assert.deepEqual(
  teslaTypes,
  ["In-Vehicle (Commercial / Test)", "None", "Remote (Commercial / Test)"],
  `Replicata: import data/slurp.py and read PUBLIC_SERVICE_OPERATOR_TYPES["Tesla, Inc."].
Expectata: exactly {None, In-Vehicle (Commercial / Test), Remote (Commercial / Test)} — every operator type Tesla has filed in the ADS data.
Resultata: ${JSON.stringify(teslaTypes)}.`);

// The guard: a Tesla ADS row in an operator mode outside the configured set
// must crash slurp (loudly forcing a human scope call), not silently filter.
const slurpSrc = fs.readFileSync("data/slurp.py", "utf8");
assert.ok(
  slurpSrc.includes("operator type outside the configured public-service set"),
  `Replicata: inspect data/slurp.py's validation loop.
Expectata: a must() that fires when a configured entity files an operator type outside its PUBLIC_SERVICE_OPERATOR_TYPES set.
Resultata: no such guard found in slurp.py.`);

// The formerly-excluded incident is present, in Houston, with fault 0.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx, { filename: "incidents.js" });
const incidents = vm.runInContext("INCIDENT_DATA", ctx);
const stump = incidents.find(r => r.reportId === "13781-15395");
assert.ok(
  stump !== undefined,
  `Replicata: look up report 13781-15395 in data/incidents.js.
Expectata: present (Houston remote-recovery tree-stump crash, MAY-2026, Remote (Commercial / Test)).
Resultata: absent.`);
assert.ok(
  stump.helmer === "Tesla" && stump.city === "Houston" && stump.date === "MAY-2026",
  `Replicata: read 13781-15395's helmer/city/date.
Expectata: Tesla / Houston / MAY-2026.
Resultata: ${JSON.stringify({helmer: stump.helmer, city: stump.city, date: stump.date})}.`);
assert.ok(
  stump.fault !== null && stump.fault.faultfrac === 0,
  `Replicata: read 13781-15395's fault assessment.
Expectata: faultfrac 0 — a remote human operator, not the ADS, was maneuvering the vehicle.
Resultata: ${JSON.stringify(stump.fault)}.`);

console.log("qual pass: Tesla scope counts all three filed operator types; the Houston remote-recovery crash is in with fault 0; novel Tesla modes crash slurp");

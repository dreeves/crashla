import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";

// The reviewed authoring model must actually reach the master, rather than
// leaving an old monthly profile beneath new provenance prose. California
// source/calibration checks live separately in waymo-allocation.qual; published
// anchor checks remain in waymo-vmt-provenance.qual.
const expected = JSON.parse(execFileSync("python3", ["data/waymo_vmt.py"], {encoding: "utf8"}));
const names = ["helmer", "month", "vmt", "helmer_cumulative_vmt", "kyoom_min", "kyoom_max", "vmt_min", "vmt_max", "rationale"];
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(r => r[0] === "waymo")
  .map(r => Object.fromEntries(names.map((k, i) => [k, i >= 2 && i <= 7 ? +r[i] : r[i]])));
assert.equal(expected.length, 21);
const fields = names.slice(2);
const mismatches = expected.flatMap(r => {
  const actual = master.find(m => m.month === r.month);
  assert.ok(actual, `Replicata: find Waymo ${r.month}. Expectata: model month exists. Resultata: missing.`);
  return fields.filter(k => actual[k] !== r[k]).map(k => `${r.month} ${k}: master ${actual[k]}, model ${r[k]}`);
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute July 2024–March 2026 from measured California miles plus anchor-conserving residual allocation.
Expectata: every monthly central, cumulative, band and rationale in the master matches the documented authoring model.
Resultata: ${mismatches.join("; ")}.`);

// Independently derive the historical anchor envelopes from published
// precision and explicit missing-city caps. Four retain their reviewed
// centrals; September 2024 adds a previously unused measured anchor.
const PRE = 150000;
for (const [month, central, published, rounding, missing] of [
  ["2024-06", 21850000, 22199000, 2000, 5500],
  ["2024-07", 24850000, 25308000, 2000, 5500],
  ["2024-09", 32953000, 33103000, 2000, 5500],
  ["2024-12", 49850001, 50083000, 2000, 5500],
  ["2025-01", 56550001, 56700000, 500, 9250],
]) {
  const row = master.find(r => r.month === month);
  // The original milestone's integer-thousand value also remains included;
  // December's central has a one-mile running-sum rounding residue.
  const bounds = [Math.min(Math.floor(central / 1000) * 1000, published - rounding - PRE), Math.max(central, published + rounding + missing - PRE)];
  assert.deepEqual([row.helmer_cumulative_vmt, row.kyoom_min, row.kyoom_max], [central, ...bounds],
    `Replicata: derive ${month}'s cumulative envelope from published miles, rounding and explicitly excluded cities.
Expectata: central ${central}, bounds ${bounds}.
Resultata: ${JSON.stringify(row)}.`);
}
// June precedes the new allocation. Only reconcile its original monthly
// allowance with the refined boundary; keep its central and May's history.
const may = master.find(r => r.month === "2024-05");
const june = master.find(r => r.month === "2024-06");
const juneBounds = [Math.max(1626155, june.kyoom_min - may.kyoom_max), Math.min(3377399, june.kyoom_max - may.kyoom_min)];
assert.deepEqual([june.vmt, june.vmt_min, june.vmt_max], [2501777, ...juneBounds],
  `Replicata: constrain June 2024's original monthly allowance using its refined cumulative boundary and the retained May row.
Expectata: central 2501777 and bounds ${juneBounds}.
Resultata: ${june.vmt}, ${june.vmt_min}, ${june.vmt_max}.`);
console.log("qual pass: Waymo historical rows reproduce the measured-California/residual model and source-precision knots");

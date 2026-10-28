import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// A historical month's displayed uncertainty must already incorporate the
// cumulative constraints used by that month's rate estimate. The raw master
// still flows verbatim to the chart (vmt-master-fidelity.qual); this qual
// requires the authoring model to reconcile those two views of the same miles.
// Replicata: December 2025 originally plotted 11.805M–21.924M although the
// rate calculation's cumulative constraints narrowed it to 14.905M–19.024M.
// Expectata: the monthly master itself respects those constraints.

const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(r => r[0] === "waymo")
  .map(r => ({month: r[1], best: +r[2], cume: +r[3], clo: +r[4], chi: +r[5], lo: +r[6], hi: +r[7]}));
const mismatches = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i], p = rows[i - 1];
  if (r.month < "2023-02" || r.month > "2026-03") continue;
  const lo = Math.max(r.lo, r.clo - p.chi);
  const hi = Math.min(r.hi, r.chi - p.clo);
  if (r.lo !== lo || r.hi !== hi) mismatches.push({month: r.month, plotted: [r.lo, r.hi], constrained: [lo, hi]});
}
assert.deepEqual(mismatches, [],
  `Replicata: compare each rebuilt historical Waymo month's authored band with the cumulative-endpoint intersection already used in its crash-rate calculation.
Expectata: identical bands; all known cumulative constraints are in the authored monthly range.
Resultata: ${JSON.stringify(mismatches)}.`);

console.log("qual pass: historical Waymo monthly VMT bars include their cumulative constraints");

import assert from "node:assert/strict";
import fs from "node:fs";

// Zoox cumulative VMT tracks the published mileage milestones its
// rationales cite as anchors (the third helmer gets the same provenance
// treatment as waymo-vmt-provenance and tesla-vmt-provenance):
//   1.3M driverless public-road miles as of Dec 31, 2025 (Zoox letter to
//     NHTSA Jan 28, 2026, docket NHTSA-2025-0523-0004 p.22 Q21a — an official
//     company disclosure, superseding the earlier ~1M-late-2025 press floor)
//   ~2M cumulative autonomous miles late Mar 2026 (CleanTechnica 2026-03-24 /
//     Robot Report)
//   >3M miles on public roads, announced Aug 6, 2026 (Bloomberg/Claims
//     Journal; scope caveat: "miles on public roads" vs the earlier
//     "autonomous miles" wording)
// The milestones carry real slack ("~"/">"/"approximately"), so centrals are
// pinned within 15% and the kyoom band must contain the round published number.

const MILESTONES = [
  { month: "2025-12", published: 1300000 },
  { month: "2026-03", published: 2000000 },
  { month: "2026-07", published: 3000000 },
];

const lines = fs.readFileSync("data/vmt.csv", "utf8").trim().split("\n");
const rows = lines.slice(1).filter(l => l.trim() !== "").map(l => {
  const p = l.split(",", 8);
  return { helmer: p[0], month: p[1], cume: +p[3], kmin: +p[4], kmax: +p[5] };
}).filter(r => r.helmer === "zoox");

assert.ok(rows.length > 0,
  "Replicata: filter data/vmt.csv to zoox rows. Expectata: present. Resultata: none.");

for (const { month, published } of MILESTONES) {
  const r = rows.find(x => x.month === month);
  assert.ok(r !== undefined,
    `Replicata: find the zoox ${month} row.
Expectata: present (a published milestone month can't be dropped).
Resultata: missing.`);
  assert.ok(r.kmin <= published && published <= r.kmax,
    `Replicata: compare the published ~${published / 1e6}M milestone against zoox ${month}'s kyoom band.
Expectata: the band [kyoom_min, kyoom_max] contains the published number.
Resultata: [${r.kmin}, ${r.kmax}].`);
  const ratio = r.cume / published;
  assert.ok(ratio >= 0.85 && ratio <= 1.15,
    `Replicata: compare zoox ${month}'s central cumulative (${r.cume}) against the published ~${published / 1e6}M.
Expectata: within 15% (the milestones are "~" figures and the series is anchored to them).
Resultata: ratio ${ratio.toFixed(3)}.`);
}

console.log(`qual pass: zoox cumulative VMT tracks all three published mileage milestones (1.3M Dec 2025, ~2M late Mar 2026, >3M Aug 2026)`);

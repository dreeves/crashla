import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Waymo's cumulative-rides history must respect Waymo's published ride-count
// milestones (the only well-sourced lane; Tesla/Zoox are labeled low-confidence
// guesses on the page and are only sanity-bounded here):
//   10M cumulative paid trips announced May 20 2025 (CNBC / Google I/O), so
//     every later month's cumulative -- even its LOW bound -- must clear 10M.
//   ~20M lifetime trips by end of 2025 (Waymo 2025 year-in-review blog:
//     ">14M trips in 2025 alone ... set to exceed 20 million lifetime").
// This qual exists because the history was once derived from weekly rates
// alone and sat ~30% below the published cumulative milestones.

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const hist = vm.runInContext("JSON.stringify(RIDES_HISTORY)", ctx);
const fc = vm.runInContext("JSON.stringify(RIDES_FORECAST)", ctx);
const waymo = JSON.parse(hist).Waymo;
const waymoFc = JSON.parse(fc).Waymo;
const byMonth = Object.fromEntries(waymo.map(r => [r.month, r]));

const juneRow = byMonth["2025-06"];
assert.ok(juneRow !== undefined && juneRow.lo >= 10000000 && juneRow.best >= 10500000 && juneRow.best <= 13000000,
  `Replicata: read RIDES_HISTORY.Waymo's 2025-06 row against the 10M-trips milestone (May 20 2025).
Expectata: lo >= 10,000,000 (the milestone predates end-June) and best in [10.5M, 13M].
Resultata: ${JSON.stringify(juneRow)}.`);

const decRow = byMonth["2025-12"];
assert.ok(decRow !== undefined && decRow.lo <= 20000000 && 20000000 <= decRow.hi
    && decRow.best >= 18500000 && decRow.best <= 22000000,
  `Replicata: read RIDES_HISTORY.Waymo's 2025-12 row against the ~20M-lifetime-by-end-2025 milestone.
Expectata: band contains 20M and best in [18.5M, 22M].
Resultata: ${JSON.stringify(decRow)}.`);

// Cumulative rides can't decrease: best/lo/hi monotone across history + forecast.
for (const [helmer, rows] of Object.entries(JSON.parse(hist))) {
  const chain = [...rows, JSON.parse(fc)[helmer]];
  for (let i = 1; i < chain.length; i++) {
    assert.ok(chain[i].best >= chain[i-1].best && chain[i].lo >= chain[i-1].lo && chain[i].hi >= chain[i-1].hi,
      `Replicata: scan ${helmer}'s cumulative rides rows in order.
Expectata: best/lo/hi all non-decreasing (cumulative counts).
Resultata: ${JSON.stringify(chain[i-1])} then ${JSON.stringify(chain[i])}.`);
  }
}

// The forecast endpoint stays consistent with the sourced trajectory: 500k
// paid rides/week as of Mar 2026 (TechCrunch 2026-03-27) makes anything under
// ~40M by Jan 2027 arithmetically impossible without ridership SHRINKING.
assert.ok(waymoFc.best >= 40000000,
  `Replicata: check RIDES_FORECAST.Waymo against the 500k/week Mar-2026 run rate.
Expectata: best >= 40,000,000.
Resultata: ${JSON.stringify(waymoFc)}.`);

console.log("qual pass: Waymo cumulative rides track the published 10M/20M milestones; all rides lanes monotone");

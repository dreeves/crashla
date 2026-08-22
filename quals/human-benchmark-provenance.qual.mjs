// Pins the AV-cities human benchmark bands for injury / airbag / serious-injury+
// to Waymo's LIVE Safety Impact hub per-city benchmark rates (data through
// Mar 2026, six cities incl. LA/Austin/Atlanta; retrieved 2026-08-22 —
// supersedes the Kusano & Scanlon 56.7M paper pin: same methodology family,
// updated denominators and city set), so a band edge can't silently drift
// from its source. Each band edge = 1e6 / per-city IPMM: the lo (fewest miles
// between crashes) = the highest-rate city, the hi = the lowest-rate city.
// The geometric-mean central the cards use must sit near the hub's
// All-Locations blended value. When the hub next updates, re-pin here FIRST
// (red), then the bands.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Waymo Safety Impact hub, per-city human benchmark IPMM (thru Mar 2026):
// hiRate = the highest-rate city (SF for injury/SSI+, Atlanta for airbag),
// loRate = the lowest-rate city (Phoenix for injury/SSI+, LA for airbag).
const SRC = {
  injury:        { hiRate: 7.25, loRate: 2.03, blended: 3.91 },
  airbag:        { hiRate: 2.99, loRate: 1.19, blended: 1.68 },
  seriousInjury: { hiRate: 0.44, loRate: 0.12, blended: 0.23 },
};
const REL_TOL = 0.01; // 1% — allows rounding of the edges to clean integers

for (const [key, r] of Object.entries(SRC)) {
  const band = vm.runInContext(`METRIC_DEFS.find(m => m.key === ${JSON.stringify(key)}).humanMPI.HumansAV`, ctx);
  const expLo = 1e6 / r.hiRate; // highest-rate city = lowest MPI
  const expHi = 1e6 / r.loRate; // lowest-rate city = highest MPI
  const okLo = Math.abs(band.lo - expLo) / expLo <= REL_TOL;
  const okHi = Math.abs(band.hi - expHi) / expHi <= REL_TOL;
  assert.ok(
    okLo && okHi,
    `Replicata: check the AV-cities ${key} band against the Waymo hub per-city rates (${r.hiRate} to ${r.loRate} IPMM).
Expectata: lo = 1e6/${r.hiRate} ≈ ${Math.round(expLo)} and hi = 1e6/${r.loRate} ≈ ${Math.round(expHi)} (within ${REL_TOL * 100}%).
Resultata: lo=${band.lo} (off ${(100 * (band.lo - expLo) / expLo).toFixed(1)}%), hi=${band.hi} (off ${(100 * (band.hi - expHi) / expHi).toFixed(1)}%).`);

  // The geometric-mean central (used by the "Nx safer" cards) must sit near
  // Kusano's mileage-blended value — sanity that the band brackets the right point.
  const geo = Math.sqrt(band.lo * band.hi);
  const geoIpmm = 1e6 / geo;
  assert.ok(
    Math.abs(geoIpmm - r.blended) / r.blended <= 0.15,
    `Replicata: geometric-mean central of the ${key} band.
Expectata: within 15% of the hub's All-Locations blended ${r.blended} IPMM.
Resultata: ${geoIpmm.toFixed(2)} IPMM.`);
}

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to the Waymo hub per-city rates (thru Mar 2026); geomean centrals ~match the blended benchmark");

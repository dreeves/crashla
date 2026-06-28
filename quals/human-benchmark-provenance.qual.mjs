// Pins the AV-cities human benchmark bands for injury / airbag / serious-injury+
// to the PUBLISHED Kusano & Scanlon (56.7M, arxiv 2505.01515) per-city benchmark
// rates, so a band edge can't silently drift from its source (the "defensibly
// sourced, not hand-set" requirement). Each band edge = 1e6 / per-city IPMM:
// the lo (fewest miles between crashes) = the highest-rate city (San Francisco),
// the hi = the lowest-rate city (Phoenix). The mileage-blended central the cards
// use is the geometric mean, which ~equals Kusano's blended value.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Kusano & Scanlon 56.7M, per-city human benchmark IPMM (All-Locations table).
const SRC = {
  injury:        { sf: 8.02, phx: 2.09, blended: 4.04 },
  airbag:        { sf: 2.31, phx: 1.42, blended: 1.69 },
  seriousInjury: { sf: 0.46, phx: 0.12, blended: 0.24 },
};
const REL_TOL = 0.01; // 1% — allows rounding of the edges to clean integers

for (const [key, r] of Object.entries(SRC)) {
  const band = vm.runInContext(`METRIC_DEFS.find(m => m.key === ${JSON.stringify(key)}).humanMPI.HumansAV`, ctx);
  const expLo = 1e6 / r.sf;   // SF = highest rate = lowest MPI
  const expHi = 1e6 / r.phx;  // Phoenix = lowest rate = highest MPI
  const okLo = Math.abs(band.lo - expLo) / expLo <= REL_TOL;
  const okHi = Math.abs(band.hi - expHi) / expHi <= REL_TOL;
  assert.ok(
    okLo && okHi,
    `Replicata: check the AV-cities ${key} band against Kusano 56.7M per-city rates (SF ${r.sf}, Phoenix ${r.phx} IPMM).
Expectata: lo = 1e6/${r.sf} ≈ ${Math.round(expLo)} and hi = 1e6/${r.phx} ≈ ${Math.round(expHi)} (within ${REL_TOL * 100}%).
Resultata: lo=${band.lo} (off ${(100 * (band.lo - expLo) / expLo).toFixed(1)}%), hi=${band.hi} (off ${(100 * (band.hi - expHi) / expHi).toFixed(1)}%).`);

  // The geometric-mean central (used by the "Nx safer" cards) must sit near
  // Kusano's mileage-blended value — sanity that the band brackets the right point.
  const geo = Math.sqrt(band.lo * band.hi);
  const geoIpmm = 1e6 / geo;
  assert.ok(
    Math.abs(geoIpmm - r.blended) / r.blended <= 0.15,
    `Replicata: geometric-mean central of the ${key} band.
Expectata: within 15% of Kusano's mileage-blended ${r.blended} IPMM.
Resultata: ${geoIpmm.toFixed(2)} IPMM.`);
}

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to Kusano 56.7M per-city rates; geomean centrals ~match the mileage-blended benchmark");

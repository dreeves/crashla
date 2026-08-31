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

// --- HumansRideshare fatality band: the sourced Uber/Lyft rates ---
// 0.62 (Uber 2019-2020) to 0.94 (Lyft) fatalities per 100M VMT -> 106M/161M
// MPI. The only rideshare-specific published per-mile rate; every nonfatal
// rideshare band is a computed proxy (derived: true). Pinned so a regen or
// loop change can't silently overwrite the one sourced band. Sits entirely
// above the IIHS urban band (83M-105M) — rideshare ran ~30-50% safer than
// the urban average in the same years (subset-chain.qual's 2x sanity bound).
{
  const rs = vm.runInContext(
    `METRIC_DEFS.find(m => m.key === "fatality").humanMPI.HumansRideshare`, ctx);
  assert.ok(rs && rs.lo === 106000000 && rs.hi === 161000000 && rs.derived !== true,
    `Replicata: check the HumansRideshare fatality band.
Expectata: the sourced Uber/Lyft 0.62-0.94/100M rates -> lo 106M, hi 161M, not a derived proxy.
Resultata: ${JSON.stringify(rs)}.`);
  assert.match(rs.src, /0\.62.*0\.94/,
    `Replicata: inspect the rideshare fatality provenance.
Expectata: it states the 0.62-0.94 per-100M source rates.
Resultata: ${rs.src}.`);
}

// --- HumansUS fatality band: numerator-consistent with the AV side ---
// The AV fatality count is Koopman/Piper fractional attribution: each fatal
// crash adds 1/vehiclesInvolved, so the fleet-universe sum equals FATAL
// CRASHES (SGO severity flags at-least-one-death, not a death count), and
// under the deaths≈fatal-crashes approximation it proxies DEATHS. The human
// comparator band must therefore span exactly those two numerators — FARS
// 2024: 39,254 deaths and 36,297 fatal crashes over 3,294.031B VMT — and
// NOT the per-crashed-vehicle involvement rate (1.70/100M -> 59M), whose
// whole-count-per-vehicle basis contradicts the 1/N division the AV side
// performs. Re-pin here FIRST (red) when FARS updates.
{
  const FARS2024 = { deaths: 39254, fatalCrashes: 36297, vmt100M: 32940.31 };
  const band = vm.runInContext(
    `METRIC_DEFS.find(m => m.key === "fatality").humanMPI.HumansUS`, ctx);
  const expLo = 1e8 / (FARS2024.deaths / FARS2024.vmt100M);       // deaths basis ≈ 83.9M
  const expHi = 1e8 / (FARS2024.fatalCrashes / FARS2024.vmt100M); // fatal-crash basis ≈ 90.7M
  const relTol = 0.01;
  assert.ok(
    Math.abs(band.lo - expLo) / expLo <= relTol &&
    Math.abs(band.hi - expHi) / expHi <= relTol,
    `Replicata: check the HumansUS fatality band against FARS 2024 on the
numerators consistent with the AV side's fractional-death count.
Expectata: lo = deaths basis ≈ ${Math.round(expLo / 1e6)}M miles/death, hi =
fatal-crash basis ≈ ${Math.round(expHi / 1e6)}M miles/fatal-crash (within 1%).
Resultata: lo=${band.lo}, hi=${band.hi}.`);
}

// --- HumansAV fatality band: current IIHS urban vintage ---
// IIHS urban all-road deaths per 100M VMT: 1.17 (2022), 1.07 (2023), 1.01
// (2024); 2021 urban peak 1.20. The band spans 0.95-1.20 deaths/100M (the
// 2021 peak as the high-rate edge, a continued-improvement floor below the
// 2024 value). Re-pin here FIRST (red) when IIHS posts a new year.
{
  const band = vm.runInContext(
    `METRIC_DEFS.find(m => m.key === "fatality").humanMPI.HumansAV`, ctx);
  const expLo = 1e8 / 1.20, expHi = 1e8 / 0.95, current2024 = 1e8 / 1.01;
  const relTol = 0.01;
  assert.ok(
    Math.abs(band.lo - expLo) / expLo <= relTol &&
    Math.abs(band.hi - expHi) / expHi <= relTol,
    `Replicata: check the HumansAV fatality band against the IIHS urban 2022-2024 vintage.
Expectata: lo ≈ ${Math.round(expLo / 1e6)}M (1.20 deaths/100M), hi ≈ ${Math.round(expHi / 1e6)}M (0.95), within 1%.
Resultata: lo=${band.lo}, hi=${band.hi}.`);
  assert.ok(band.lo <= current2024 && current2024 <= band.hi,
    `Replicata: compare the HumansAV fatality band with IIHS's 2024 urban rate (1.01).
Expectata: the current anchor (~99M MPI) lies inside the band.
Resultata: band [${band.lo}, ${band.hi}].`);
  assert.match(band.src, /2022.{0,3}2024/,
    `Replicata: inspect the user-visible HumansAV fatality provenance.
Expectata: it names the 2022-2024 IIHS vintage.
Resultata: ${band.src}.`);
  assert.match(band.src, /1\.17.*1\.07.*1\.01/,
    `Replicata: inspect the HumansAV fatality provenance figures.
Expectata: the three annual rates 1.17 / 1.07 / 1.01 are stated.
Resultata: ${band.src}.`);
  assert.doesNotMatch(band.src, /0\.77/,
    `Replicata: inspect the HumansAV fatality provenance for the retired 2012-era floor.
Expectata: 0.77 no longer appears.
Resultata: ${band.src}.`);
}

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to the Waymo hub per-city rates (thru Mar 2026); geomean centrals ~match the blended benchmark; HumansUS fatality band pinned to the FARS 2024 deaths/fatal-crash numerators");

// Pins the AV-cities human benchmark bands for injury / airbag / serious-injury+
// to Waymo's LIVE Safety Impact hub per-city benchmark rates (data through
// Jun 2026, five areas: Phoenix, SF Bay Area, LA, Austin, Atlanta; retrieved 2026-09-25,
// previously the thru-Mar-2026 values of 2026-08-22 — supersedes the Kusano &
// Scanlon 56.7M paper pin: same methodology family, updated denominators and
// city set). The rates are Waymo's DYNAMIC benchmarks (CSV3 rows without the
// "(non-Dynamic)" suffix), re-weighted to where Waymo drove, so they shift
// every release. Three significant figures (the page rounds to 2 dp, which
// would move the SSI+ hi edge 3.5%: Phoenix 0.1035 shows as "0.10"). So a band edge can't silently drift
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

// Waymo Safety Impact hub, per-city human benchmark IPMM (thru Jun 2026):
// hiRate = the highest-rate city (SF Bay Area for injury/SSI+, Atlanta for airbag),
// loRate = the lowest-rate city (Phoenix for injury/SSI+, LA for airbag).
const SRC = {
  injury:        { hiRate: 6.64, loRate: 1.95, blended: 3.77 },
  airbag:        { hiRate: 2.83, loRate: 1.27, blended: 1.62 },
  seriousInjury: { hiRate: 0.391, loRate: 0.104, blended: 0.213 },
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
  // the hub's mileage-blended value — sanity that the band brackets the right
  // point. 20% (was 15% until 2026-09-25, human-approved): the thru-Jun-2026
  // airbag span is lopsided around its blend (geomean 17% off), because the
  // high-rate edge is Atlanta, whose hub mileage is itself in question
  // (CSV4 lists ~85 Fulton/DeKalb S2 cells twice).
  const geo = Math.sqrt(band.lo * band.hi);
  const geoIpmm = 1e6 / geo;
  assert.ok(
    Math.abs(geoIpmm - r.blended) / r.blended <= 0.20,
    `Replicata: geometric-mean central of the ${key} band.
Expectata: within 20% of the hub's All-Locations blended ${r.blended} IPMM.
Resultata: ${geoIpmm.toFixed(2)} IPMM.`);
}

// --- Derived HumansAV bands and Waymo's own published rates (2026-09-26) ---
// hospitalization is bracketed by its severity neighbours (1M/airbag blended
// .. 1M/SSI+ blended); at-fault injury = injury lo/0.94 .. injury hi/0.5
// (documented at the METRIC_DEFS entries). Both went stale silently once
// before (2026-07-24), so they are pinned to the SRC constants here.
// WAYMO_PUBLISHED_IPMM is the hub's All-Locations Waymo rates (CSV3 thru Jun
// 2026: 0.6745 / 0.2948 / 0.0111), at the page's 2 dp.
{
  const band = k => vm.runInContext(`METRIC_DEFS.find(m => m.key === ${JSON.stringify(k)}).humanMPI.HumansAV`, ctx);
  const near = (x, y) => Math.abs(x - y) / y <= 0.01;
  const hosp = band("hospitalization"), inj = band("injury"), afi = band("atfaultInjury");
  assert.ok(near(hosp.lo, 1e6 / SRC.airbag.blended) && near(hosp.hi, 1e6 / SRC.seriousInjury.blended),
    `Replicata: derive the HumansAV hospitalization band from the hub blended rates.
Expectata: lo = 1e6/${SRC.airbag.blended} ≈ ${Math.round(1e6 / SRC.airbag.blended)}, hi = 1e6/${SRC.seriousInjury.blended} ≈ ${Math.round(1e6 / SRC.seriousInjury.blended)} (within 1%).
Resultata: [${hosp.lo}, ${hosp.hi}].`);
  assert.ok(near(afi.lo, inj.lo / 0.94) && near(afi.hi, inj.hi / 0.5),
    `Replicata: derive the HumansAV at-fault injury band from the injury band.
Expectata: lo = injury lo/0.94 ≈ ${Math.round(inj.lo / 0.94)}, hi = injury hi/0.5 = ${inj.hi / 0.5} (within 1%).
Resultata: [${afi.lo}, ${afi.hi}].`);
  const pub = vm.runInContext("WAYMO_PUBLISHED_IPMM", ctx);
  assert.equal(JSON.stringify(pub), JSON.stringify({ injury: 0.67, airbag: 0.29, ssi: 0.01 }),
    `Replicata: read WAYMO_PUBLISHED_IPMM.
Expectata: the hub's All-Locations Waymo rates thru Jun 2026, {injury 0.67, airbag 0.29, ssi 0.01}.
Resultata: ${JSON.stringify(pub)}.`);
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

// --- HumansUS hospitalization / airbag / serious-injury+ bands (2026-09-04) ---
// These three have no published national per-mile rate; they are placed by
// log-interpolation between the national injury and fatality anchors at the
// severity position each metric holds on the AV-cities ladder. Re-derive
// that position from the CURRENT bands so an AV-cities or fatality repin
// re-flags them (the 06-18 values silently went 13-23% stale after the
// 06-28/08-22 repins).
{
  const bands = vm.runInContext(`Object.fromEntries(METRIC_DEFS.map(m => [m.key, m.humanMPI]))`, ctx);
  const geo = b => Math.sqrt(b.lo * b.hi);
  const av = k => geo(bands[k].HumansAV), us = k => geo(bands[k].HumansUS);
  for (const key of ["airbag", "hospitalization", "seriousInjury"]) {
    const t = Math.log(av(key) / av("injury")) / Math.log(av("fatality") / av("injury"));
    const center = us("injury") * Math.pow(us("fatality") / us("injury"), t);
    const ratio = us(key) / center;
    // 2% (was 6% until 2026-09-26): the 09-25 repin moved these centers by
    // 1.5-4.8%, inside the old tolerance, so a stale band could not fail.
    // Edges are authored to 2 significant figures, which costs <= ~1%.
    assert.ok(Math.abs(Math.log(ratio)) < Math.log(1.02),
      `Replicata: log-interpolate the national ${key} center from the AV-cities severity ladder (t = ${t.toFixed(3)}) between the national injury and fatality centers.
Expectata: the HumansUS ${key} band's geometric center within 2% of ${Math.round(center)}.
Resultata: band [${bands[key].HumansUS.lo}, ${bands[key].HumansUS.hi}], center ${Math.round(us(key))} (${ratio.toFixed(3)}x).`);
  }
}

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to the Waymo hub per-city rates (thru Jun 2026); geomean centrals ~match the blended benchmark; HumansUS fatality band pinned to the FARS 2024 deaths/fatal-crash numerators");

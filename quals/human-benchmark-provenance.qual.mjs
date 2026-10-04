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
// (red), then the bands. Since 2026-10-03 this qual also pins the
// Hospitalization+ and nonstationary bands to their CRSS 2024 derivations
// (blocks below), beside its older pins of WAYMO_PUBLISHED_IPMM and the
// Uber/Lyft fatality band.
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
  // high-rate edge is Atlanta. Waymo's unlinked CSV3 v2 (Sep 28) narrows it to
  // +14.9%; whether to return to 15% is open until the hub links v2.
  const geo = Math.sqrt(band.lo * band.hi);
  const geoIpmm = 1e6 / geo;
  assert.ok(
    Math.abs(geoIpmm - r.blended) / r.blended <= 0.20,
    `Replicata: geometric-mean central of the ${key} band.
Expectata: within 20% of the hub's All-Locations blended ${r.blended} IPMM.
Resultata: ${geoIpmm.toFixed(2)} IPMM.`);
}

// --- Derived HumansAV bands and Waymo's own published rates (2026-09-26) ---
// at-fault injury = injury lo/0.94 .. injury hi/0.5 (documented at the
// METRIC_DEFS entry). It went stale silently once before (2026-07-24), so it
// is pinned to the injury band here. (Hospitalization+ was pinned here too,
// bracketed by 1M/airbag blended .. 1M/SSI+ blended, until 2026-10-03; it is
// now CRSS-measured, see the next block.)
// WAYMO_PUBLISHED_IPMM is the hub's All-Locations Waymo rates (CSV3 v1 thru
// Jun 2026: 0.67446 / 0.29484 / 0.011057), to four significant figures. Until
// 2026-10-03 it held the page's 2-dp 0.67 / 0.29 / 0.01, and the cross-check's
// serious-injury+ ratio divided by that rounded 0.01: 3.6x where the unrounded
// rate gives 3.3x (audit #8).
{
  const band = k => vm.runInContext(`METRIC_DEFS.find(m => m.key === ${JSON.stringify(k)}).humanMPI.HumansAV`, ctx);
  const near = (x, y) => Math.abs(x - y) / y <= 0.01;
  const inj = band("injury"), afi = band("atfaultInjury");
  assert.ok(near(afi.lo, inj.lo / 0.94) && near(afi.hi, inj.hi / 0.5),
    `Replicata: derive the HumansAV at-fault injury band from the injury band.
Expectata: lo = injury lo/0.94 ≈ ${Math.round(inj.lo / 0.94)}, hi = injury hi/0.5 = ${inj.hi / 0.5} (within 1%).
Resultata: [${afi.lo}, ${afi.hi}].`);
  const pub = vm.runInContext("WAYMO_PUBLISHED_IPMM", ctx);
  assert.equal(JSON.stringify(pub), JSON.stringify({ injury: 0.6745, airbag: 0.2948, ssi: 0.01106 }),
    `Replicata: read WAYMO_PUBLISHED_IPMM.
Expectata: the hub's unrounded All-Locations Waymo rates thru Jun 2026 (CSV3 v1), {injury 0.6745, airbag 0.2948, ssi 0.01106}.
Resultata: ${JSON.stringify(pub)}.`);
}

// --- Hospitalization+ bands: CRSS-measured hospital transport (2026-10-03, audit #1) ---
// Until 2026-10-03 both bands claimed that no human hospital-transport rate
// exists: AV cities was bracketed between airbag and SSI+ (617k-4.695M) and
// US average log-interpolated (1.8M-7.9M), both centres ~2x too safe. CRSS
// records transport directly (person.csv HOSPITAL 1-6: EMS air/ground/unknown
// mode, law enforcement, unknown source, other; 0 = not transported).
// Hospitalization+ = a crash in which anyone was transported for treatment or
// had a suspected-serious (A) or fatal (K) injury (MAX_SEV 3-4), matching the
// page's hosp severities (SGO "W/ Hospitalization", "Serious", "Fatality").
// Weighted CRSS 2024 (static.nhtsa.gov/nhtsa/downloads/CRSS/2024/CRSS2024CSV.zip),
// crashed in-transport vehicles, VMT 3,294,031M (NHTSA 813791):
//   - AV cities: urban non-interstate passenger vehicles (BODY_TYP 1-49),
//     Hospitalization+ involvements / injury-crash involvements = 0.54291 and
//     / airbag-crash involvements = 0.65732 (a ratio of rates, not a share:
//     only 37% of airbag-crash involvements had a transport). Applied to the
//     hub's per-area OBSERVED any-injury rates (CSV3 "Any-injury-reported
//     (Observed, Dynamic)": no Blincoe correction, the CRSS ratio being
//     police-reported on both sides) and per-area airbag rates (CSV3 "Any
//     Airbag Deployment", Dynamic); band = the per-area extremes across both
//     routes.
//   - US average: hi = the police-reported national rate, 0.51169 per M mi
//     (all in-transport vehicles, all roads); lo = that rate raised for the
//     31.9% of injury-crash vehicles not reported to police (Blincoe et al.
//     2023, NHTSA 813403, Table 2-9) — an upper bound for transport crashes,
//     since unreported injury crashes "tend to involve only minor or moderate
//     injuries" (p. 3; MAIS1 33.9% vs MAIS3 6.3% unreported).
// Re-pin here FIRST (red) when the hub or CRSS updates.
const CRSS2024 = {
  hospPerInjury: 0.54291, hospPerAirbag: 0.65732, // AV cities (urban non-interstate passenger vehicles)
  usHospPerM: 0.51169,                             // US: police-reported Hospitalization+ involvements per M mi
  stoppedAV: 0.14587, stoppedUS: 0.12937,          // P_CRASH1 = 5 "Stopped in Roadway" share (next block)
};
const BLINCOE2023_INJURY_UNREPORTED = 0.319; // Table 2-9, injury vehicles
const HUB_AREAS = {
  // CSV3 v1, All Crashes, Benchmark IPMM: [observed any-injury (Dynamic), any-vehicle airbag (Dynamic)]
  "Phoenix (Maricopa)": [1.33875, 1.32269],
  "SF Bay Area":        [4.53868, 1.91889],
  "Los Angeles":        [1.74703, 1.26588],
  "Austin (Travis)":    [2.22565, 2.32333],
  "Atlanta Area":       [4.48736, 2.83121],
};
const HUB_BLENDED = [2.58069, 1.61538]; // All Locations (mileage blended), same two comparisons
{
  const bands = vm.runInContext(`Object.fromEntries(["hospitalization"].map(k => [k, METRIC_DEFS.find(m => m.key === k).humanMPI]))`, ctx);
  const near = (x, y) => Math.abs(x - y) / y <= 0.01;
  const routeRates = Object.values(HUB_AREAS)
    .flatMap(([inj, ab]) => [inj * CRSS2024.hospPerInjury, ab * CRSS2024.hospPerAirbag]);
  const expLo = 1e6 / Math.max(...routeRates), expHi = 1e6 / Math.min(...routeRates);
  const av = bands.hospitalization.HumansAV;
  assert.ok(near(av.lo, expLo) && near(av.hi, expHi),
    `Replicata: apply the CRSS 2024 Hospitalization+ ratios (${CRSS2024.hospPerInjury} per injury-crash, ${CRSS2024.hospPerAirbag} per airbag-crash involvement) to the hub's five per-area observed-injury and airbag rates.
Expectata: HumansAV hospitalization lo = 1e6/max ≈ ${Math.round(expLo)} (SF Bay Area, injury route), hi = 1e6/min ≈ ${Math.round(expHi)} (Phoenix, injury route), within 1%.
Resultata: [${av.lo}, ${av.hi}].`);
  const blendLo = 1e6 / (HUB_BLENDED[0] * CRSS2024.hospPerInjury), blendHi = 1e6 / (HUB_BLENDED[1] * CRSS2024.hospPerAirbag);
  const geo = Math.sqrt(av.lo * av.hi);
  assert.ok(geo >= blendLo && geo <= blendHi,
    `Replicata: compare the HumansAV hospitalization band's geometric centre with the two mileage-blended routes.
Expectata: between ${Math.round(blendLo)} (injury route) and ${Math.round(blendHi)} (airbag route).
Resultata: ${Math.round(geo)}.`);
  const us = bands.hospitalization.HumansUS;
  const usHi = 1e6 / CRSS2024.usHospPerM, usLo = usHi * (1 - BLINCOE2023_INJURY_UNREPORTED);
  assert.ok(near(us.hi, usHi) && near(us.lo, usLo),
    `Replicata: derive the HumansUS hospitalization band from the CRSS 2024 national rate (${CRSS2024.usHospPerM} per M mi) and Blincoe et al. 2023's ${(BLINCOE2023_INJURY_UNREPORTED * 100).toFixed(1)}% unreported injury-crash vehicles.
Expectata: hi ≈ ${Math.round(usHi)}, lo ≈ ${Math.round(usLo)} (within 1%).
Resultata: [${us.lo}, ${us.hi}].`);
  for (const [cohort, h] of [["HumansAV", av], ["HumansUS", us]]) {
    assert.ok(!/no direct|No national hospital-transport/.test(h.src) && /CRSS/.test(h.src),
      `Replicata: read the ${cohort} hospitalization provenance (src).
Expectata: it names CRSS, and no longer claims that no human hospital-transport rate exists.
Resultata: ${h.src}`);
  }
  assert.ok(/0\.543/.test(av.src) && /0\.657/.test(av.src) && /31\.9/.test(us.src),
    `Replicata: read the hospitalization provenance figures.
Expectata: AV cities states both CRSS ratios (0.543, 0.657); US average states the 31.9% Blincoe share.
Resultata: AV ${av.src} | US ${us.src}`);
}

// --- Nonstationary bands: remove the CRSS share stopped in the roadway (2026-10-03, audit #2) ---
// The AV side drops every 0-mph incident (nonstationaryIncidentCount). The
// human benchmarks count in-transport vehicles only (Kusano et al. 2024:
// "traveling (moving or stopped) in the roadway"; CRSS vehicle.csv), so
// parked cars were never in them; until 2026-10-03 the bands nonetheless
// divided the all-crash band by 0.95-0.97 for "hit-while-parked" and kept the
// vehicles stopped in traffic that the AV side removes. Now: all-crash band /
// (1 - the CRSS 2024 share of crashed in-transport vehicles whose pre-crash
// movement was "Stopped in Roadway", P_CRASH1 = 5): 14.587% for urban
// non-interstate passenger vehicles (AV cities), 12.937% for all vehicles on
// all roads (US average). The non-parking-lot band equals the nonstationary
// band: CRSS covers trafficway crashes only, the state police data behind
// Kusano's benchmark covers roadway crashes, and Blincoe et al. 2023's
// underreporting estimate "does not include off-road or parking lot crashes"
// (p. 1, note 1), so both human benchmarks already exclude parking lots.
{
  const defs = vm.runInContext(`Object.fromEntries(["all", "nonstationary", "roadwayNonstationary"].map(k => [k, METRIC_DEFS.find(m => m.key === k).humanMPI]))`, ctx);
  const near = (x, y) => Math.abs(x - y) / y <= 0.01;
  for (const [cohort, stopped] of [["HumansAV", CRSS2024.stoppedAV], ["HumansUS", CRSS2024.stoppedUS]]) {
    const all = defs.all[cohort], ns = defs.nonstationary[cohort], rw = defs.roadwayNonstationary[cohort];
    const expLo = all.lo / (1 - stopped), expHi = all.hi / (1 - stopped);
    assert.ok(near(ns.lo, expLo) && near(ns.hi, expHi),
      `Replicata: remove the CRSS 2024 stopped-in-roadway share (${(stopped * 100).toFixed(3)}%) from the ${cohort} all-crash band [${all.lo}, ${all.hi}].
Expectata: nonstationary lo ≈ ${Math.round(expLo)}, hi ≈ ${Math.round(expHi)} (within 1%).
Resultata: [${ns.lo}, ${ns.hi}].`);
    assert.ok(rw.lo === ns.lo && rw.hi === ns.hi,
      `Replicata: compare the ${cohort} non-parking-lot band with its nonstationary band.
Expectata: identical, since both human benchmarks already exclude parking-lot crashes.
Resultata: non-parking-lot [${rw.lo}, ${rw.hi}], nonstationary [${ns.lo}, ${ns.hi}].`);
    for (const [key, h] of [["nonstationary", ns], ["roadwayNonstationary", rw]]) {
      assert.ok(!/hit-while-parked|trafficway-only/.test(h.src) && /CRSS/.test(h.src),
        `Replicata: read the ${cohort} ${key} provenance (src).
Expectata: it names CRSS, with neither the parked-share step nor the claim that Kusano's base is "CRSS trafficway-only".
Resultata: ${h.src}`);
    }
  }
}

// --- HumansRideshare fatality band: the sourced Uber/Lyft rates ---
// 0.62 (Uber 2019-2020) to 0.95 (Lyft 2021-2022) fatalities per 100M VMT ->
// 106M/161M MPI. Lyft's report (2020-2022, p. 11) gives 2021 as 36 deaths at
// 0.86 and 2022 as 50 at 1.02 per 100M VMT, so its mile-weighted rate is
// 86 / (36/0.86 + 50/1.02) = 86 / 90.88 = 0.946; until 2026-10-03 the src
// said 0.94 (the plain mean of 0.86 and 1.02) while calling it mile-weighted
// (audit #71). The edge is 106M either way. The only rideshare-specific
// published per-mile rate; every nonfatal rideshare band is a computed proxy
// (derived: true). Pinned so a regen or loop change can't silently overwrite
// the one sourced band. Sits entirely above the IIHS urban band (83M-105M) —
// rideshare ran ~30-50% safer than the urban average in the same years
// (subset-chain.qual's 2x sanity bound).
{
  const rs = vm.runInContext(
    `METRIC_DEFS.find(m => m.key === "fatality").humanMPI.HumansRideshare`, ctx);
  const lyftMileWeighted = 86 / (36 / 0.86 + 50 / 1.02);
  assert.ok(rs && rs.lo === 106000000 && Math.abs(rs.lo - 1e8 / lyftMileWeighted) / (1e8 / lyftMileWeighted) <= 0.01 &&
    rs.hi === 161000000 && rs.derived !== true,
    `Replicata: check the HumansRideshare fatality band.
Expectata: the sourced Uber/Lyft rates -> lo 106M = 1e8/${lyftMileWeighted.toFixed(4)} ≈ ${Math.round(1e8 / lyftMileWeighted)} to 3 significant figures (within 1%), hi 161M, not a derived proxy.
Resultata: ${JSON.stringify(rs)}.`);
  assert.match(rs.src, /0\.62.*0\.95/,
    `Replicata: inspect the rideshare fatality provenance.
Expectata: it states the 0.62-0.95 per-100M source rates (0.95 = Lyft's mile-weighted 2021-2022 rate).
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

// --- HumansUS airbag / serious-injury+ bands (2026-09-04) ---
// These two are placed by log-interpolation between the national injury and
// fatality anchors at the severity position each metric holds on the
// AV-cities ladder. Re-derive that position from the CURRENT bands so an
// AV-cities or fatality repin re-flags them (the 06-18 values silently went
// 13-23% stale after the 06-28/08-22 repins). Hospitalization+ was the third
// until 2026-10-03, when it moved to the CRSS-measured transport rate (the
// block above), so it leaves this loop.
{
  const bands = vm.runInContext(`Object.fromEntries(METRIC_DEFS.map(m => [m.key, m.humanMPI]))`, ctx);
  const geo = b => Math.sqrt(b.lo * b.hi);
  const av = k => geo(bands[k].HumansAV), us = k => geo(bands[k].HumansUS);
  for (const key of ["airbag", "seriousInjury"]) {
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

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to the Waymo hub per-city rates (thru Jun 2026); geomean centrals ~match the blended benchmark; Hospitalization+ and nonstationary bands pinned to CRSS 2024; HumansUS fatality band pinned to the FARS 2024 deaths/fatal-crash numerators");

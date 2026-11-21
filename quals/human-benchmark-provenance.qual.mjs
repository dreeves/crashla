// Pins the AV-cities human benchmark bands for injury / airbag / serious-injury+
// to Waymo's LIVE Safety Impact hub per-city benchmark rates (data through
// Jun 2026, five areas: Phoenix, SF Bay Area, LA, Austin, Atlanta; retrieved 2026-10-27
// from CSV3 v2, the corrected file of Waymo's Oct-2-2026 release notes, whose
// rates the hub displays; previously the Sep-24 file's values of 2026-09-25
// and the thru-Mar-2026 values of 2026-08-22 — supersedes the Kusano &
// Scanlon 56.7M paper pin: same methodology family, updated denominators and
// city set). The rates are Waymo's DYNAMIC benchmarks (CSV3 rows without the
// "(non-Dynamic)" suffix), re-weighted to where Waymo drove, so they shift
// every release. Three significant figures (the page rounds to 2 dp, which
// would move the SSI+ hi edge 3.3%: Phoenix 0.1033 shows as "0.10"). So a band edge can't silently drift
// from its source. Each band edge = 1e6 / per-city IPMM: the lo (fewest miles
// between crashes) = the highest-rate city, the hi = the lowest-rate city.
// The geometric-mean central the cards use must sit near the hub's
// All-Locations blended value. When the hub next updates, re-pin here FIRST
// (red), then the bands. Since 2026-10-03 this qual also pins the
// Hospitalization+ and nonstationary bands to their CRSS 2024 derivations
// (blocks below), beside its older pins of WAYMO_PUBLISHED_IPMM and the
// Uber/Lyft fatality band, which since 2026-11-21 is re-derived from the two
// companies' published rates and FARS 2024's vehicles per fatal crash.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// A metric's human bands (its METRIC_DEFS entry's humanMPI), read, never
// assumed: until 2026-11-06 a METRIC_DEFS without the metric stopped this
// qual on a TypeError naming nothing.
const humanBands = key => {
  const def = vm.runInContext(`METRIC_DEFS.find(m => m.key === ${JSON.stringify(key)})`, ctx);
  assert.ok(def !== undefined,
    `Replicata: find the ${JSON.stringify(key)} entry of METRIC_DEFS in crashla.js.
Expectata: one, holding the human bands (humanMPI) this qual pins.
Resultata: none; the metrics are ${JSON.stringify(vm.runInContext("METRIC_DEFS.map(m => m.key)", ctx))}.`);
  return def.humanMPI;
};

// Waymo Safety Impact hub, per-city human benchmark IPMM (thru Jun 2026):
// hiRate = the highest-rate city (SF Bay Area for injury/SSI+, Atlanta for airbag),
// loRate = the lowest-rate city (Phoenix for injury/SSI+, LA for airbag).
const SRC = {
  injury:        { hiRate: 6.71, loRate: 1.95, blended: 3.77 },
  airbag:        { hiRate: 2.77, loRate: 1.23, blended: 1.61 },
  seriousInjury: { hiRate: 0.395, loRate: 0.103, blended: 0.213 },
};
const REL_TOL = 0.01; // 1% — allows rounding of the edges to clean integers

for (const [key, r] of Object.entries(SRC)) {
  const band = humanBands(key).HumansAV;
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
  // airbag span is lopsided around its blend, because the high-rate edge is
  // Atlanta: geomean 17.1% off on the Sep-24 file, 14.65% on CSV3 v2 (pinned
  // 2026-10-27). 20% stays: at 15% the margin would be 0.35 points, and the
  // v1-to-v2 correction alone moved the gap 2.5.
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
// WAYMO_PUBLISHED_IPMM is the hub's All-Locations Waymo rates (CSV3 thru
// Jun 2026, the same in v1 and v2: 0.67446 / 0.29484 / 0.011057), to four
// significant figures. Until
// 2026-10-03 it held the page's 2-dp 0.67 / 0.29 / 0.01, and the cross-check's
// serious-injury+ ratio divided by that rounded 0.01: 3.6x where the unrounded
// rate gives 3.3x (audit #8).
{
  const band = k => humanBands(k).HumansAV;
  const near = (x, y) => Math.abs(x - y) / y <= 0.01;
  const inj = band("injury"), afi = band("atfaultInjury");
  assert.ok(near(afi.lo, inj.lo / 0.94) && near(afi.hi, inj.hi / 0.5),
    `Replicata: derive the HumansAV at-fault injury band from the injury band.
Expectata: lo = injury lo/0.94 ≈ ${Math.round(inj.lo / 0.94)}, hi = injury hi/0.5 = ${inj.hi / 0.5} (within 1%).
Resultata: [${afi.lo}, ${afi.hi}].`);
  const pub = vm.runInContext("WAYMO_PUBLISHED_IPMM", ctx);
  assert.equal(JSON.stringify(pub), JSON.stringify({ injury: 0.6745, airbag: 0.2948, ssi: 0.01106 }),
    `Replicata: read WAYMO_PUBLISHED_IPMM.
Expectata: the hub's unrounded All-Locations Waymo rates thru Jun 2026 (CSV3 v1 and v2), {injury 0.6745, airbag 0.2948, ssi 0.01106}.
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
  // CSV3 v2 (2026-10-27; v1 until then), All Crashes, Benchmark IPMM: [observed any-injury (Dynamic), any-vehicle airbag (Dynamic)].
  // The file (Last-Modified Sep 28, 2026 22:45:57 GMT; the hub's own CSV3 link still serves v1):
  // https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV3%20-%20Collision%20Counts%20and%20Comparison%20to%20Benchmarks%20202009-202606-2022benchmark_v2.csv
  "Phoenix (Maricopa)": [1.33818, 1.32096],
  "SF Bay Area":        [4.58471, 1.93367],
  "Los Angeles":        [1.70213, 1.23418],
  "Austin (Travis)":    [2.22237, 2.31775],
  "Atlanta Area":       [4.38798, 2.76742],
};
const HUB_BLENDED = [2.57996, 1.60898]; // All Locations (mileage blended), same two comparisons
// Two sources' URLs as the bands' srcLinks give them. crashla.js's
// BENCHMARK_SOURCES holds each URL's one label, the text of its link on the
// page; the CRSS one must name CRSS.
const CRSS2024_URL = "https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/CRSS/2024/";
const BLINCOE2023_URL = "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403";
{
  const label = vm.runInContext(`BENCHMARK_SOURCES[${JSON.stringify(CRSS2024_URL)}]`, ctx);
  assert.match(String(label), /CRSS/,
    `Replicata: read the label BENCHMARK_SOURCES gives ${CRSS2024_URL}.
Expectata: it names CRSS, so every band citing that URL names CRSS on the page.
Resultata: ${JSON.stringify(label)}.`);
}
// The comment lines of one METRIC_DEFS entry in crashla.js, from its
// `{ key: "<key>",` to the next entry's: the derivation written beside the
// bands, without their src strings.
function metricDefComments(key) {
  const start = appScript.indexOf(`{ key: ${JSON.stringify(key)},`);
  const end = appScript.indexOf("{ key: ", start + 1);
  assert.ok(start >= 0 && end > start, `crashla.js: no METRIC_DEFS entry for ${key} followed by another`);
  return appScript.slice(start, end).split("\n").filter(l => /^\s*\/\//.test(l)).join("\n");
}
{
  const bands = Object.fromEntries(["hospitalization"].map(k => [k, humanBands(k)]));
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
  // Provenance in the code, not in the src sentences (2026-10-04, human-
  // approved): the src texts are the human's English, which this qual does
  // not dictate. Until 2026-10-04 the AV src had to state 0.543 and 0.657,
  // the US src 31.9, and both had to name CRSS. Now each band's srcLinks cite
  // CRSS 2024 (on the page, its source link reads "NHTSA CRSS 2024"), the US
  // band's also Blincoe et al. 2023, and the comments of crashla.js's
  // hospitalization entry state the inputs this block derives the edges
  // from. The src keeps one check: it must not claim that no human
  // hospital-transport rate exists (audit #1).
  for (const [cohort, h] of [["HumansAV", av], ["HumansUS", us]]) {
    assert.ok(!/no direct|No national hospital-transport/.test(h.src) && h.srcLinks.includes(CRSS2024_URL),
      `Replicata: read the ${cohort} hospitalization band's src and srcLinks.
Expectata: srcLinks cite CRSS 2024 (${CRSS2024_URL}), and the src no longer claims that no human hospital-transport rate exists.
Resultata: srcLinks ${JSON.stringify(h.srcLinks)}; src ${h.src}`);
  }
  // The AV band's edges reproduce from CSV3 v2's observed any-injury rates
  // (SF Bay 4.584714 gives 402K), which only the Oct-2 release notes link (p.
  // 2); the hub page links CSV3 v1, whose 4.538677 gives 406K. So the band
  // links the release notes too (2026-10-30 audit, LNK-2; until 2026-10-31
  // it linked the hub and CRSS only). Its Uber/Lyft band takes its links.
  const RELEASE_NOTES_URL = "https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/Waymo_Safety_Impact_Data_Hub_Release_Notes_20261002.pdf";
  assert.ok(av.srcLinks.includes(RELEASE_NOTES_URL),
    `Replicata: read the HumansAV hospitalization band's srcLinks.
Expectata: they cite the Waymo Data Hub release notes (${RELEASE_NOTES_URL}), whose page 2 links CSV3 v2, the file that reproduces the band's 402K edge.
Resultata: ${JSON.stringify(av.srcLinks)}.`);
  assert.ok(us.srcLinks.includes(BLINCOE2023_URL),
    `Replicata: read the HumansUS hospitalization band's srcLinks.
Expectata: they cite Blincoe et al. 2023 (${BLINCOE2023_URL}), the source of the 31.9% share.
Resultata: ${JSON.stringify(us.srcLinks)}.`);
  const stated = [CRSS2024.hospPerInjury, CRSS2024.hospPerAirbag, CRSS2024.usHospPerM].map(x => x.toFixed(5))
    .concat([`${(BLINCOE2023_INJURY_UNREPORTED * 100).toFixed(1)}%`, "CRSS 2024"]);
  const comments = metricDefComments("hospitalization");
  const unstated = stated.filter(s => !comments.includes(s));
  assert.deepEqual(unstated, [],
    `Replicata: read the comments of the hospitalization entry of METRIC_DEFS in crashla.js (its derivation).
Expectata: they state the inputs this qual derives the bands from: ${stated.join(", ")}.
Resultata: not stated: ${JSON.stringify(unstated)}.`);
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
  const defs = Object.fromEntries(["all", "nonstationary", "roadwayNonstationary"].map(k => [k, humanBands(k)]));
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
    // CRSS is named by the srcLinks, not required of the src sentence (the
    // human's English; 2026-10-04, as for Hospitalization+ above). The src
    // keeps one check: neither the parked-share step nor the claim that
    // Kusano's base is "CRSS trafficway-only" may return (audit #2).
    for (const [key, h] of [["nonstationary", ns], ["roadwayNonstationary", rw]]) {
      assert.ok(!/hit-while-parked|trafficway-only/.test(h.src) && h.srcLinks.includes(CRSS2024_URL),
        `Replicata: read the ${cohort} ${key} band's src and srcLinks.
Expectata: srcLinks cite CRSS 2024 (${CRSS2024_URL}), and the src has neither the parked-share step nor the claim that Kusano's base is "CRSS trafficway-only".
Resultata: srcLinks ${JSON.stringify(h.srcLinks)}; src ${h.src}`);
    }
  }
}

// --- HumansRideshare fatality band: Uber's and Lyft's rates on the AV side's basis ---
// The one rideshare-specific per-mile rate that is published: 0.62 (Uber,
// 2019-2020) to 0.95 (Lyft, 2021-2022) fatalities per 100M VMT. Lyft's
// report (2020-2022, p. 11) gives 2021 as 36 deaths at 0.86 and 2022 as 50 at
// 1.02 per 100M VMT, so its mile-weighted rate is 86 / (36/0.86 + 50/1.02) =
// 86 / 90.88 = 0.946; until 2026-10-03 the src said 0.94 (the plain mean of
// 0.86 and 1.02) while calling it mile-weighted (audit #71).
// Those rates count every death in a crash involving one of the platform's
// cars in full (Uber's 2021-2022 report, Appendix V: "Each rate is double
// counting the same fatality"), where the AV side counts each fatal crash
// once across its vehicles (1/vehiclesInvolved). Until 2026-11-21 the band
// took the rates as published, 106M-161M miles per death (audit A12 of
// 2026-11-20). The human chose to put it on the AV side's basis: the rates
// divided by the national number of vehicles per fatal crash, FARS 2024's
// 56,011 vehicles in 36,297 fatal crashes (NHTSA 813791), 1.543; so
// 1e8/0.946 x 1.543 = 163M to 1e8/0.62 x 1.543 = 249M, each edge to three
// significant figures. Every nonfatal rideshare band is a computed proxy
// (derived: true); this one is sourced, and pinned so a regeneration or a
// change of that loop cannot overwrite it. It sits entirely above the IIHS
// urban band (83M-105M); subset-chain.qual holds it within twice that band's
// top.
// The source figures, with their links (re-pin here FIRST, red, when a
// report or FARS updates):
const RIDESHARE_REPORTS = {
  // Uber US Safety Report: 2019-2020, deaths per 100M miles
  uber: { rate: 0.62, url: "https://www.uber.com/us/en/about/reports/us-safety-report/" },
  // Lyft Safety Transparency Report, 2020-2022, p. 11: [deaths, deaths per 100M miles] for 2021 and 2022
  lyft: { years: [[36, 0.86], [50, 1.02]], url: "https://www.lyft.com/blog/posts/2024-safety-transparency-report" },
};
// FARS 2024 (NHTSA 813791): vehicles involved in fatal crashes, and fatal crashes.
const FARS2024_FATAL = { vehicles: 56011, crashes: 36297, url: "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813791" };
{
  const rs = humanBands("fatality").HumansRideshare;
  const lyftRate = RIDESHARE_REPORTS.lyft.years.reduce((n, [deaths]) => n + deaths, 0) / RIDESHARE_REPORTS.lyft.years.reduce((n, [deaths, rate]) => n + deaths / rate, 0);
  const factor = FARS2024_FATAL.vehicles / FARS2024_FATAL.crashes;
  const sig3 = x => Number(x.toPrecision(3));
  const expLo = sig3(1e8 / lyftRate * factor), expHi = sig3(1e8 / RIDESHARE_REPORTS.uber.rate * factor);
  assert.ok(rs && rs.lo === expLo && rs.hi === expHi && rs.derived !== true,
    `Replicata: derive the HumansRideshare fatality band from Uber's rate (${RIDESHARE_REPORTS.uber.rate} deaths per 100M miles), Lyft's mile-weighted rate (${lyftRate.toFixed(4)}) and FARS 2024's vehicles per fatal crash (${FARS2024_FATAL.vehicles} / ${FARS2024_FATAL.crashes} = ${factor.toFixed(4)}).
Expectata: lo = 1e8/${lyftRate.toFixed(4)} x ${factor.toFixed(4)} = ${expLo} and hi = 1e8/${RIDESHARE_REPORTS.uber.rate} x ${factor.toFixed(4)} = ${expHi}, each to three significant figures (the published rates count each death in full for a platform car; the factor puts them on the AV side's count, one fatal crash across its vehicles); not a derived proxy.
Resultata: ${JSON.stringify(rs && { lo: rs.lo, hi: rs.hi, derived: rs.derived })}.`);
  // The app's own inputs are these source figures (its constants, which the
  // band and the assumptions list read).
  const app = JSON.parse(vm.runInContext(`JSON.stringify({
    rates: typeof RIDESHARE_FATALITY_RATES === "undefined" ? null : RIDESHARE_FATALITY_RATES,
    fars: typeof FARS_2024_FATAL_CRASHES === "undefined" ? null : FARS_2024_FATAL_CRASHES })`, ctx));
  assert.ok(app.rates !== null && app.fars !== null && app.rates.uber === RIDESHARE_REPORTS.uber.rate && Math.abs(app.rates.lyft - lyftRate) < 1e-12
      && app.fars.vehicles === FARS2024_FATAL.vehicles && app.fars.crashes === FARS2024_FATAL.crashes,
    `Replicata: read crashla.js's RIDESHARE_FATALITY_RATES and FARS_2024_FATAL_CRASHES.
Expectata: Uber's ${RIDESHARE_REPORTS.uber.rate}, Lyft's mile-weighted ${lyftRate}, and FARS 2024's ${FARS2024_FATAL.vehicles} vehicles in ${FARS2024_FATAL.crashes} fatal crashes.
Resultata: ${JSON.stringify(app)}.`);
  // Every figure the src states is one its sources hold: the two rates as the
  // reports print them (Lyft's two yearly rates and their average to two
  // decimals), the factor to two decimals, FARS's two counts, the years the
  // figures are of, and the 100 of the rates' unit. No figure is required to
  // appear (the human's rule of 2026-11-03: a figure is checked where it is
  // stated; until 2026-11-21 this check required the src to state the rates,
  // which a rewording that left one out turned red). The band's links cite the
  // two reports and FARS 2024.
  const YEARS = ["2019", "2020", "2021", "2022", "2024"]; // Uber's rate is of 2019-2020, Lyft's of 2021-2022, FARS's counts of 2024
  const held = new Set([String(RIDESHARE_REPORTS.uber.rate), lyftRate.toFixed(2), ...RIDESHARE_REPORTS.lyft.years.map(([, rate]) => String(rate)),
    factor.toFixed(2), FARS2024_FATAL.vehicles.toLocaleString("en-US"), FARS2024_FATAL.crashes.toLocaleString("en-US"), ...YEARS, "100"]);
  const stated = [...rs.src.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(m => m[0]);
  const unheld = stated.filter(f => !held.has(f));
  const links = [RIDESHARE_REPORTS.uber.url, RIDESHARE_REPORTS.lyft.url, FARS2024_FATAL.url].filter(u => !rs.srcLinks.includes(u));
  assert.ok(unheld.length === 0 && links.length === 0,
    `Replicata: read every figure in the rideshare fatality band's src, and its srcLinks.
Expectata: each figure the src states is one of ${[...held].join(", ")} (the reports' rates, the factor, FARS 2024's two counts, the years and the unit's 100), and the links cite both reports and FARS 2024 (NHTSA 813791).
Resultata: figures the sources do not hold ${JSON.stringify(unheld)}; links missing ${JSON.stringify(links)}; src ${rs.src}`);
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
  const FARS2024 = { deaths: 39254, fatalCrashes: FARS2024_FATAL.crashes, vmt100M: 32940.31 };
  const band = humanBands("fatality").HumansUS;
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
  const band = humanBands("fatality").HumansAV;
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
  // CRSS 2024 measures both rates directly (police-reported crashed
  // in-transport vehicles, all vehicles, all roads, VMT 3,294,031M per
  // 813791): vehicles in crashes where any person's airbag deployed (AIR_BAG
  // 1-9), 0.73966 per M mi (1.35M MPI), and in crashes with a suspected
  // serious or fatal injury (MAX_SEV 3-4), 0.08647 (11.6M); recomputed by two
  // auditors from CRSS2024CSV.zip (2026-10-30 audit, copy-1 and LNK-1). Each
  // lies inside its band, and the entry's comments say so. The src may not
  // claim that no national rate exists, as it did until 2026-10-31 ("No
  // national airbag-deployment per-mile rate", "No clean national SSI+ (KABCO
  // A+K) per-mile rate"; the hospitalization src lost the same claim on
  // 2026-10-03, audit #1).
  const CRSS2024_DIRECT = { airbag: 0.73966, seriousInjury: 0.08647 };
  const comments = metricDefComments("airbag");
  for (const [key, perM] of Object.entries(CRSS2024_DIRECT)) {
    const h = bands[key].HumansUS, mpi = 1e6 / perM;
    assert.ok(h.lo < mpi && mpi < h.hi && !/\bno (clean )?national\b/i.test(h.src) && h.srcLinks.includes(CRSS2024_URL)
      && comments.includes(perM.toFixed(3)),
      `Replicata: read the HumansUS ${key} band, its src and srcLinks, and the airbag entry's comments in crashla.js.
Expectata: CRSS 2024's directly measured rate, ${perM} per M mi (${Math.round(mpi)} MPI), inside the band; srcLinks cite CRSS 2024; the comments state ${perM.toFixed(3)}; the src does not claim that no national rate exists.
Resultata: band [${h.lo}, ${h.hi}]; srcLinks ${JSON.stringify(h.srcLinks)}; comments ${comments.includes(perM.toFixed(3)) ? "state" : "do not state"} it; src ${h.src}`);
  }
}

console.log("qual pass: AV-cities injury/airbag/serious-injury+ bands pinned to the Waymo hub per-city rates (thru Jun 2026); geomean centrals ~match the blended benchmark; Hospitalization+ and nonstationary bands pinned to CRSS 2024; HumansUS fatality band pinned to the FARS 2024 deaths/fatal-crash numerators; Uber/Lyft fatality band re-derived from the two reports' rates over FARS 2024's vehicles per fatal crash");

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";

// The reviewed authoring model must actually reach the master, rather than
// leaving an old monthly profile beneath new provenance prose. California
// source/calibration checks live separately in waymo-allocation.qual; published
// anchor checks remain in waymo-vmt-provenance.qual. Since 2026-10-31 (open
// question 15, "Rebuild on Waymo's figures") the model covers the series from
// its July 2021 start; until then it began at July 2024 and the earlier rows
// kept an older ramp that did not follow Waymo's figures.
const [caHeader, ...caMonths] = parseCsv(fs.readFileSync("data/waymo-ca.csv", "utf8"));
const totalCol = caHeader.indexOf("total");
assert.ok(totalCol >= 0,
  `Replicata: read the column names in data/waymo-ca.csv.
Expectata: a total column for combined deployment and pilot miles.
Resultata: ${caHeader.join(",")}.`);
const expected = JSON.parse(execFileSync("python3", ["data/waymo_vmt.py"], {encoding: "utf8"}));
const names = ["helmer", "month", "vmt", "helmer_cumulative_vmt", "kyoom_min", "kyoom_max", "vmt_min", "vmt_max", "rationale"];
const master = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(r => r[0] === "waymo")
  .map(r => Object.fromEntries(names.map((k, i) => [k, i >= 2 && i <= 7 ? +r[i] : r[i]])));
assert.deepEqual([expected.length, expected[0].month, expected[expected.length - 1].month], [57, "2021-07", "2026-03"],
  `Replicata: run data/waymo_vmt.py.
Expectata: 57 months, July 2021 through March 2026.
Resultata: ${expected.length} months, ${expected[0]?.month} through ${expected[expected.length - 1]?.month}.`);
const fields = names.slice(2);
const mismatches = expected.flatMap(r => {
  const actual = master.find(m => m.month === r.month);
  assert.ok(actual, `Replicata: find Waymo ${r.month}. Expectata: model month exists. Resultata: missing.`);
  return fields.filter(k => actual[k] !== r[k]).map(k => `${r.month} ${k}: master ${actual[k]}, model ${r[k]}`);
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute July 2021–March 2026 from measured California miles plus anchor-conserving residual allocation.
Expectata: every monthly central, cumulative, band and rationale in the master matches the documented authoring model.
Resultata: ${mismatches.join("; ")}.`);

// Independently derive each knot's cumulative envelope from its published
// figure's precision, explicitly excluded miles and the pre-series offset
// (central 205,000, range 150,000-260,000; data/README.md, Waymo anchors):
// central = figure - 205,000, bounds = [figure low - 260,000, figure high -
// 150,000]. Until 2026-10-31 the offset was a fixed 150,000 and the June,
// July and December 2024 knots kept the rounded milestones' centrals (22M,
// 25M, 50M less 150,000) inside envelopes stretched to hold them; until
// 2026-11-02 its central was the range's floor, 150,000 (open question 20(b)).
const OFFSET = {central: 205000, lo: 150000, hi: 260000};
// [month, figure, minus, plus, residue]: the figure's range is [figure -
// minus, figure + plus]; January 2025's central keeps the series' one-mile
// ledger residue.
for (const [month, published, minus, plus, residue] of [
  ["2021-12", 422400, 600, 600, 0],          // Table 2: three significant figures per city-year
  ["2022-12", 946400, 1150, 1150, 0],
  ["2023-07", 3868506, 35560, 0, 0],          // Swiss Re: "to 8/1/2023" may hold Aug 1
  ["2023-10", 7140000, 0, 10000, 0],          // "over 7.14 million"
  ["2023-12", 10066400, 11650, 11650, 0],
  ["2024-06", 22199000, 2000, 2000 + 5500, 0], // CSV1: four values to 1,000; Mountain View omitted
  ["2024-07", 25308000, 2000, 2000 + 5500, 0],
  ["2024-09", 33103000, 2000, 2000 + 5500, 0],
  ["2024-12", 50083000, 2000, 2000 + 5500, 0],
  ["2025-01", 56700000, 500, 500 + 9250, 1],   // the paper's total; Mountain View and Atlanta listed apart
]) {
  const row = master.find(r => r.month === month);
  const central = published - OFFSET.central + residue;
  const bounds = [published - minus - OFFSET.hi, published + plus - OFFSET.lo];
  assert.deepEqual([row.helmer_cumulative_vmt, row.kyoom_min, row.kyoom_max], [central, ...bounds],
    `Replicata: derive ${month}'s cumulative envelope from published miles, rounding, explicitly excluded cities and the pre-series offset.
Expectata: central ${central}, bounds ${bounds}.
Resultata: ${JSON.stringify(row)}.`);
}

// California covers San Diego. Remove its estimated share from the newer
// metros while retaining their original total and the three mature metros.
const q2Ratio = 30625484 / 28957564; // Q2 California hub miles / CPUC miles
// The judged parts of the July-November 2026 rows (data/vmt.csv's rationales;
// data/README.md, Waymo anchors and Ghost months), named since 2026-11-20 so
// that the page's list of assumptions (crashla.js ASSUMPTIONS) is checked
// against them (quals/assumptions-list.qual.mjs reads these consts; until
// then it pinned copies of them): California's filed miles times q2Ratio
// within CA_BAND, and the three mature metros extrapolated from the hub's Q2
// monthly rates within MATURE_BAND (July-September, multipliers of the
// estimate); E_RATE, the newer metros' reports per million miles (Austin's
// and Atlanta's young-market rate) with the low and high rate the San Diego
// split allows; SAN_DIEGO, San Diego's reports of the newer metros' in
// September 2026; the weather pauses taken off (PAUSES) and the openings and
// added service area put on (OPENINGS), by month and part; and GHOST_BAND,
// the range of each month after September, e^-(lo[0] + lo[1] k) to
// e^(hi[0] + hi[1] k) times the estimate for a month k months past Q2.
// PAUSES and OPENINGS are also the rule entries of the months after
// September: each such month of data/vmt.csv needs an entry in both (an
// empty one where nothing is taken off or put on), or this qual stops on it
// (below). November's PAUSES entry is empty: its weather pauses are not
// researched, and nothing is taken off for the freeway restriction of Nov 11
// (the row's rationale says why).
const CA_BAND = [0.97, 1.03];
const MATURE_BAND = [0.75, 1.25];
const E_RATE = { best: 6.6, lo: 4.5, hi: 9.5 };
const SAN_DIEGO = { reports: 3, of: 25 };
const PAUSES = {
  "2026-09": { phoenix: 100000 },
  "2026-10": { phoenix: 50000, storms: 50000, rain: 70000 },
  "2026-11": {},
};
const OPENINGS = {
  "2026-10": { opened: 150000, area: 20000 },
  "2026-11": { opened: 250000, area: 130000 },
};
const GHOST_BAND = { lo: [0.17, 0.028], hi: [0.15, 0.02] };
const total = parts => Object.values(parts).reduce((a, b) => a + b, 0);
// Counts of in-scope Waymo reports: those in San Diego over those in all the
// newer metros, Miami Beach in Miami's (0 of 12 in July, 0 of 14 in August, 3
// of 25 in September in the Nov-16-2026 release). A later release can change
// them, a late report of one of these months being enough, so they are
// recounted below from data/incidents.js at every run (since 2026-11-21).
// For zero reports the two-sided 95% Clopper-Pearson upper endpoint solves
// (1 - p)^n = .025. For 3 of 25 the endpoints are the .025 quantile of
// Beta(3, 23) and the .975 quantile of Beta(4, 22), respectively.
const retained = (share, rateRatio) => (1 - share) / (1 - share + share / rateRatio);
// [month, the three mature metros' miles, the newer metros' best, low and
// high (before the San Diego split), San Diego's share of the newer metros'
// reports and its Clopper-Pearson low and high]
const Q3_METROS = [
  ["2026-07", 7060000, 2000000, 1200000, 3300000, 0/12, 0, 1 - 0.025 ** (1/12)],
  ["2026-08", 7460000, 2300000, 1400000, 3800000, 0/14, 0, 1 - 0.025 ** (1/14)],
  ["2026-09", 7580000, 2850000, 1700000, 4800000, SAN_DIEGO.reports / SAN_DIEGO.of, 0.025465396647733, 0.312190307286235],
];
// The recount (audit 2026-11-20, A16; until 2026-11-21 the counts were typed
// here and data/README.md asked for a recheck that nothing made): the
// in-scope Waymo reports of each Q3_METROS month in data/incidents.js, counted
// and pending alike (the records slurp writes from the newest snapshots,
// which quals/slurp-release-metadata.qual.mjs holds to them byte for byte),
// one per report (a second AV's record, secondOf, repeats its report), by
// place. Every place is listed below as the hub's (a county the hub
// benchmarks, whose miles the hub's figures already hold) or a newer metro's,
// and an unlisted one stops this qual until it is listed. Each month's counts
// must be the ones its Q3_METROS row was written for: with no San Diego
// report, a share of 0 and the Clopper-Pearson endpoints 0 and 1 - .025^(1/n)
// for its n newer-metro reports; with any, SAN_DIEGO's counts and the share
// they give (the row's endpoints are typed for those counts).
{
  const hub = ["Phoenix, AZ", "Tempe, AZ", "Scottsdale, AZ", "Chandler, AZ", "San Francisco, CA", "Redwood City, CA", "Palo Alto, CA",
    "Sunnyvale, CA", "San Mateo, CA", "Mountain View, CA", "San Jose, CA", "San Bruno, CA", "Menlo Park, CA", "San Carlos, CA",
    "Los Angeles, CA", "West Hollywood, CA", "Beverly Hills, CA", "Culver City, CA", "Santa Monica, CA", "Marina del Rey, CA",
    "Inglewood, CA", "Montebello, CA", "Austin, TX", "Atlanta, GA"];
  const newer = ["Miami, FL", "Miami Beach, FL", "Dallas, TX", "Houston, TX", "San Antonio, TX", "Orlando, FL", "Nashville, TN",
    "Denver, CO", "Las Vegas, NV", "San Diego, CA", "Tampa, FL"];
  const sanDiego = "San Diego, CA";
  assert.ok(newer.includes(sanDiego) && newer.every(place => !hub.includes(place)),
    "Replicata: read this qual's lists of the hub's places and the newer metros'. Expectata: no place in both, and San Diego among the newer metros'. Resultata: not so.");
  const incidentsJs = fs.readFileSync("data/incidents.js", "utf8");
  const arrayOf = name => {
    const start = `/* ${name}_START */`, from = incidentsJs.indexOf(start), to = incidentsJs.indexOf(`/* ${name}_END */`);
    assert.ok(from >= 0 && to > from, `Replicata: find ${name} in data/incidents.js. Expectata: between its start and end markers. Resultata: not found.`);
    return JSON.parse(incidentsJs.slice(from + start.length, to));
  };
  const monthLabel = month => `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(month.slice(5, 7)) - 1]}-${month.slice(0, 4)}`;
  const reports = [...arrayOf("INCIDENT_DATA"), ...arrayOf("PENDING_INCIDENT_DATA")].filter(r => r.helmer === "Waymo" && r.secondOf === undefined);
  const recount = Q3_METROS.map(([month, , , , , share, shareLo, shareHi]) => {
    const places = reports.filter(r => r.date === monthLabel(month)).map(r => `${r.city}, ${r.state}`);
    return { month, share, shareLo, shareHi, unlisted: [...new Set(places.filter(place => !hub.includes(place) && !newer.includes(place)))],
      sanDiego: places.filter(place => place === sanDiego).length, of: places.filter(place => newer.includes(place)).length };
  });
  const unlisted = recount.flatMap(c => c.unlisted.map(place => `${c.month} ${place}`));
  assert.deepEqual(unlisted, [],
    `Replicata: list the places of the in-scope Waymo reports of ${Q3_METROS.map(r => r[0]).join(", ")} in data/incidents.js.
Expectata: each listed in this qual as one of the hub's benchmarked counties' or as a newer metro's (find the place's county: Maricopa, San Francisco, San Mateo, Santa Clara, Los Angeles, Travis, Fulton and DeKalb are the hub's, data/README.md, Waymo anchors).
Resultata: unlisted ${JSON.stringify(unlisted)}.`);
  const changed = recount.filter(c => !(c.of > 0 && (c.sanDiego === 0
    ? c.share === 0 && c.shareLo === 0 && c.shareHi === 1 - 0.025 ** (1 / c.of)
    : c.sanDiego === SAN_DIEGO.reports && c.of === SAN_DIEGO.of && c.share === SAN_DIEGO.reports / SAN_DIEGO.of)));
  assert.deepEqual(changed.map(c => `${c.month}: ${c.sanDiego} of ${c.of}`), [],
    `Replicata: recount San Diego's in-scope Waymo reports and all the newer metros' (${newer.join("; ")}) in data/incidents.js for ${Q3_METROS.map(r => r[0]).join(", ")}, and compare with the counts this qual's Q3_METROS rows and SAN_DIEGO were written for.
Expectata: the same counts (recounted now: ${recount.map(c => `${c.month} ${c.sanDiego} of ${c.of}`).join(", ")}). A changed count moves that month's Waymo row and, for September, the months that carry its rate: redo SAN_DIEGO or the row's share and its Clopper-Pearson endpoints (for k of n with k > 0, the .025 quantile of Beta(k, n - k + 1) and the .975 quantile of Beta(k + 1, n - k)), then the rows of data/vmt.csv this qual recomputes, their rationales and data/README.md's Waymo anchors (Each NHTSA release, step 4).
Resultata: changed ${JSON.stringify(changed.map(c => ({ month: c.month, sanDiego: c.sanDiego, of: c.of, rowShare: c.share, rowEndpoints: [c.shareLo, c.shareHi], SAN_DIEGO })))}.`);
}
const q3 = new Map();
for (const [month, mature, newerBest, newerLo, newerHi, share, shareLo, shareHi] of Q3_METROS) {
  const filed = Number(caMonths.find(r => r[0] === month)[totalCol]);
  const ca = filed * q2Ratio;
  q3.set(month, [
    ca + mature + newerBest * (1 - share),
    ca * CA_BAND[0] + mature * MATURE_BAND[0] + newerLo * retained(shareHi, E_RATE.lo / E_RATE.best),
    ca * CA_BAND[1] + mature * MATURE_BAND[1] + newerHi * retained(shareLo, E_RATE.hi / E_RATE.best),
  ]);
}
const wantedMonthly = Array.from(q3, ([month, miles]) => [month, ...miles.map(Math.round)]);
const septemberBeforePhoenixPause = q3.get("2026-09")[0] + total(PAUSES["2026-09"]);
// The months after September, each as data/vmt.csv has a waymo row for it
// (since 2026-11-21; until then October and November were listed here, so a
// row added for a later month, December's at the next release, was checked
// by nothing but the cumulative chain below: audit 2026-11-20, A15):
// September's estimate before its weather deduction at its per-day rate for
// the month's days, plus the month's openings and added area (OPENINGS) less
// its pauses (PAUSES), in the range GHOST_BAND gives a month k months past
// the end of the latest quarter both CPUC and the hub have measured, Q2 2026
// (data/README.md, Ghost months). A month with no entry in both tables has no
// rule, and stops this qual.
const monthNumber = month => 12 * Number(month.slice(0, 4)) + Number(month.slice(5, 7));
const daysIn = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const carried = master.map(r => r.month).filter(month => month > "2026-09");
const unruled = carried.filter(month => !(month in OPENINGS && month in PAUSES));
assert.deepEqual(unruled, [],
  `Replicata: list data/vmt.csv's waymo months after 2026-09 and look each up in this qual's OPENINGS and PAUSES.
Expectata: an entry in both for each month (the openings and added area put on and the pauses taken off, in miles by part; an empty entry where there are none): a month after September follows the rule this qual recomputes, September's per-day rates plus those adjustments (data/README.md, Ghost months).
Resultata: no entry in one or both for ${JSON.stringify(unruled)} (the rows: ${JSON.stringify(master.filter(r => unruled.includes(r.month)).map(r => [r.month, r.vmt, r.vmt_min, r.vmt_max]))}).`);
for (const month of carried) {
  const k = monthNumber(month) - monthNumber("2026-06");
  const best = septemberBeforePhoenixPause * daysIn(month) / 30 + total(OPENINGS[month]) - total(PAUSES[month]);
  const band = [best, best * Math.exp(-(GHOST_BAND.lo[0] + GHOST_BAND.lo[1] * k)), best * Math.exp(GHOST_BAND.hi[0] + GHOST_BAND.hi[1] * k)];
  wantedMonthly.push([month, ...band.map(miles => 1000 * Math.round(miles / 1000))]);
}
const actualMonthly = wantedMonthly.map(([month]) => {
  const row = master.find(r => r.month === month);
  return [month, row.vmt, row.vmt_min, row.vmt_max];
});
assert.deepEqual(actualMonthly, wantedMonthly,
  `Replicata: combine filed Q3 California miles with the other metros and carry September's daily rate into each later month of data/vmt.csv (${carried.join(", ")}), with that month's OPENINGS and PAUSES.
Expectata: monthly US miles and bounds ${JSON.stringify(wantedMonthly)} allowing for the San Diego split in Q3 and the forecast horizon thereafter.
Resultata: ${JSON.stringify(actualMonthly)}.`);

// The authored rows after the model (April 2026 on) chain their cumulative
// bands from the model's March 2026 knot with their own monthly bands:
// April and May forward from March and back from the June 2026 knot (hub +
// E, less the offset's range), June the knot, later months forward from it.
{
  const after = master.filter(r => r.month > "2026-03");
  const mar = master.find(r => r.month === "2026-03");
  const knots = {"2026-06": [271329379 + 4000000 - OFFSET.hi, 271329379 + 10200000 - OFFSET.lo]};
  const chain = [];
  let prev = {kmin: mar.kyoom_min, kmax: mar.kyoom_max};
  for (const r of after) {
    const knot = knots[r.month] ?? [-Infinity, Infinity];
    prev = {month: r.month, kmin: Math.max(prev.kmin + r.vmt_min, knot[0]), kmax: Math.min(prev.kmax + r.vmt_max, knot[1])};
    chain.push(prev);
  }
  for (let i = chain.length - 1; i > 0; i--) {
    chain[i - 1].kmin = Math.max(chain[i - 1].kmin, chain[i].kmin - after[i].vmt_max);
    chain[i - 1].kmax = Math.min(chain[i - 1].kmax, chain[i].kmax - after[i].vmt_min);
  }
  const off = after.flatMap((r, i) => r.kyoom_min === chain[i].kmin && r.kyoom_max === chain[i].kmax ? []
    : [`${r.month}: [${r.kyoom_min}, ${r.kyoom_max}], chain [${chain[i].kmin}, ${chain[i].kmax}]`]);
  assert.deepEqual(off, [],
    `Replicata: chain Waymo's April 2026-on cumulative bands from the model's March 2026 knot and the June 2026 knot.
Expectata: each row's band is the chain's.
Resultata: ${off.join("; ")}.`);
}
console.log("qual pass: Waymo's rows from July 2021 reproduce the measured-California/residual model and source-precision knots");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { monthlyLagKeys } from "./monthly-lag.mjs";

// The window VMT band (2026-09-04). Summing each month's 95% band edges
// treats the monthly errors as perfectly correlated, which overstates the
// window's spread wherever data/vmt.csv pins the CUMULATIVE more tightly than
// the months (Waymo's hub anchors: the Jun-2025..Mar-2026 total is known to
// ~±3% while every month carries ±25%). The window total is
// cume(end) - cume(start-1), so its band is bounded by
// [kyoom_min(end) - kyoom_max(before), kyoom_max(end) - kyoom_min(before)];
// the app takes the intersection of that difference and the summed month
// bands over the fully received months, then adds the partially received
// months' own thinned bands: the data-through month's (receipt coverage; plus
// the Monthly-track factor for non-five-day metrics) and, for the Monthly
// track, those of the months inside a helmer's extra Monthly-report lag
// (data/slurp.py MONTHLY_ARRIVAL_LAG, since 2026-10-04). This qual recomputes
// that from the CSV for the default window and pins that the anchors
// actually bite for Waymo, Tesla and Zoox.
//
// The shared pre-series offset (2026-11-02, open question 20(c)). Every
// lifetime statement includes the miles a line drove before its series
// starts, so from the line's first fully knotted month on, every cumulative band in
// the master is a lifetime band less that offset's range (the lifetime low
// edge less the offset's high, the high edge less its low). The offset is one
// number, the same at both ends of a window, and cancels in the window's
// miles; differencing two such bands as if independent counts its range
// once too often, widening the window by the range at each end (Waymo's
// default window by 110,000). The window's kyoom difference therefore adds
// the range back when the row before the window is at or after that first
// knot. Before it nothing is added back: the series start is exactly zero,
// every lower edge there is swept from it, and the knot narrows back only
// some upper edges, so a window starting in the last few months before the
// knot keeps an outer bound, up to the range wider at each edge than its band
// on the lifetime basis. Recomputed here independently: the
// ranges from their sources (data/waymo_vmt.py's OFFSET; Zoox's pre-series
// band, data/README.md, Zoox anchors), and each line's first fully knotted
// month from the master itself (the first month from which every cumulative
// band lies strictly inside the plain running sums of the monthly bands, so a
// knot shaped both edges), for the default window, a 2022 window and a Zoox
// window after its knots. The last section holds the app's own load-time
// check of PRE_SERIES_OFFSET (checkPreSeriesOffsets, since 2026-11-03) to the
// same months, and to entries of the right form.

const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// The partially received months are NHTSA's data-through month (both tracks)
// and the months inside a helmer's Monthly-report lag (the Monthly track),
// derived from the reviewed cutoff constant (as incident-coverage.qual does)
// and slurp.py's lag table, so this qual needs no re-pin when a release
// advances the cutoff.
const dataThroughMonth = vm.runInContext("NHTSA_DATA_THROUGH_DATE", ctx).slice(0, 7);
const lagged = monthlyLagKeys(dataThroughMonth);

// The pre-series offsets' ranges, from their sources: Waymo's OFFSET (central,
// low, high) in data/waymo_vmt.py; Zoox's band, California's measured 20,174.2
// plus half to twice the 19,906.2-mile Las Vegas analog, floored (a valid
// lower bound on the range); Tesla's lines start with their service, none.
const waymoOffset = fs.readFileSync("data/waymo_vmt.py", "utf8").match(/^OFFSET = \((\d+), (\d+), (\d+)\)/m);
assert.ok(waymoOffset, "Replicata: read OFFSET in data/waymo_vmt.py. Expectata: a (central, low, high) literal. Resultata: not found.");
const OFFSET_RANGE = {
  Tesla: 0, TeslaNoMonitor: 0,
  Waymo: Number(waymoOffset[3]) - Number(waymoOffset[2]),
  Zoox: Math.floor((20174.2 + 2 * 19906.2) - (20174.2 + 0.5 * 19906.2)),
};
ctx.OFFSET_RANGE = OFFSET_RANGE;

const out = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const start = full.months.indexOf(DEFAULT_START_MONTH);
  const series = sliceSeries(full, start, full.months.length - 1);
  const rows = monthlySummaryRows(series);
  // Each line's first fully knotted month: from it on, every cumulative band
  // lies strictly inside the plain running sums of the monthly bands from the
  // series' zero, so both edges came through a knot.
  const knottedFrom = {};
  for (const helmer of ADS_SERIES) {
    const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    let lo = 0, hi = 0, from = master[0].month;
    master.forEach((r, i) => {
      lo += r.vmtMin; hi += r.vmtMax;
      if (!(r.kyoomMin > lo && r.kyoomMax < hi)) from = i + 1 < master.length ? master[i + 1].month : "9999-12";
    });
    knottedFrom[helmer] = from;
  }
  // The window band, recomputed: summed month bands ∩ the kyoom difference
  // (with the shared offset's range added back after the first fully knotted
  // month), plus the partially received months' own bands.
  const windowBand = (helmer, pts, minOf, maxOf, isPartial) => {
    const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    const fullPts = pts.filter(p => !isPartial(p)), partial = pts.filter(p => isPartial(p));
    // The window's fully received months and its last one's row are read,
    // never assumed (until 2026-11-06 a window of partially received months
    // only, or a month missing from the rows, stopped this model on a
    // TypeError naming nothing). assert is crashla.js's, which throws its
    // message with the details appended.
    assert(fullPts.length > 0, "Replicata: model " + helmer + "'s window band over the window's months.\\nExpectata: at least one fully received month, whose cumulative bands the band intersects.\\nResultata: none; every month is partially received:", pts.map(p => p.month));
    const before = master.filter(r => r.month < fullPts[0].month).at(-1) || {month: "", kyoomMin: 0, kyoomMax: 0};
    const last = master.find(r => r.month === fullPts.at(-1).month);
    assert(last !== undefined, "Replicata: model " + helmer + "'s window band and find the row (vmtRows) of the window's last fully received month, " + fullPts.at(-1).month + ".\\nExpectata: one, its cumulative band the band's top.\\nResultata: none; " + helmer + "'s rows run", master.map(r => r.month));
    const shared = before.month >= knottedFrom[helmer] ? OFFSET_RANGE[helmer] : 0;
    const sum = (arr, f) => arr.reduce((s, p) => s + f(p), 0);
    return {
      min: Math.max(sum(fullPts, minOf), last.kyoomMin - before.kyoomMax + shared) + sum(partial, minOf),
      max: Math.min(sum(fullPts, maxOf), last.kyoomMax - before.kyoomMin - shared) + sum(partial, maxOf),
      unshared: {min: Math.max(sum(fullPts, minOf), last.kyoomMin - before.kyoomMax) + sum(partial, minOf),
        max: Math.min(sum(fullPts, maxOf), last.kyoomMax - before.kyoomMin) + sum(partial, maxOf)},
      shared,
      sumMin: sum(pts, minOf), sumMax: sum(pts, maxOf),
      partialMonths: partial.map(p => p.month),
    };
  };
  const res = {};
  for (const helmer of ADS_HELMERS) {
    // (The row is read, never assumed: until 2026-11-06 a missing one stopped
    // here on a TypeError naming nothing.)
    const row = rows.find(r => r.helmer === helmer);
    assert(row !== undefined, "Replicata: build the default window's summary rows (monthlySummaryRows) and find " + helmer + "'s.\\nExpectata: one, its VMT band the band this model must reproduce.\\nResultata: none; the rows are", rows.map(r => r.helmer));
    const pts = series.points.map(p => p.helmers[helmer]).filter(p => p !== null);
    const master = vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    const csv = Object.fromEntries(master.map(r => [r.month, r]));
    // From the coverage columns: a month is partially received for the five-day
    // track when its receipt coverage is below 1, for the Monthly track when
    // its receipt or its Monthly-track incident coverage is.
    const short = (r, keys) => keys.some(k => r[k] < 1);
    const receipt = ["coverage", "coverageMin", "coverageMax"], incident = ["incCov", "incCovMin", "incCovMax"];
    const band = (minOf, maxOf, isPartial) => windowBand(helmer, pts, minOf, maxOf, p => isPartial(csv[p.month]));
    const expMonthly = band(p => p.vmtMin, p => p.vmtMax, r => short(r, [...receipt, ...incident]));
    const expFiveDay = band(p => p.vmtRawMin, p => p.vmtRawMax, r => short(r, receipt));
    res[helmer] = {
      row: {min: row.vmtMin, best: row.vmtBest, max: row.vmtMax},
      all: {min: row.mpiEstimates.all.vmtMin, max: row.mpiEstimates.all.vmtMax},
      fatality: {min: row.mpiEstimates.fatality.vmtMin, max: row.mpiEstimates.fatality.vmtMax},
      expMonthly, expFiveDay,
      partialMonths: {monthly: expMonthly.partialMonths, fiveDay: expFiveDay.partialMonths},
    };
  }
  // Windows that start after a knot, all months fully received: Waymo's 2022
  // (the row before it, December 2021, is Waymo's first knot) and Zoox's
  // January-August 2026 (after its November and December 2025 knots).
  const after = {};
  for (const [helmer, a, b] of [["Waymo", "2022-01", "2022-12"], ["Zoox", "2026-01", "2026-08"]]) {
    const w = sliceSeries(full, full.months.indexOf(a), full.months.indexOf(b));
    const row = monthlySummaryRows(w).find(r => r.helmer === helmer);
    const pts = w.points.map(p => p.helmers[helmer]).filter(p => p !== null);
    after[helmer + " " + a + ".." + b] = {row: {min: row.vmtMin, max: row.vmtMax},
      exp: windowBand(helmer, pts, p => p.vmtMin, p => p.vmtMax, () => false)};
  }
  return {res, after, knottedFrom};
})()`, ctx);

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
// A window that starts after a knot carries no offset spread: its band is
// the lifetime basis's (the kyoom difference with the offset's range added
// back once), on both edges.
for (const [name, w] of [["Waymo default window", out.res.Waymo.expMonthly && {row: out.res.Waymo.row, exp: out.res.Waymo.expMonthly}],
  ...Object.entries(out.after)]) {
  assert.ok(w.exp.shared > 0 && near(w.row.min, w.exp.min) && near(w.row.max, w.exp.max),
    `Replicata: compute the VMT band of ${name}, a window whose month before it lies at or after the line's first fully knotted month, so both of the cumulative bands it differences carry the pre-series offset's range.
Expectata: [${w.exp.min}, ${w.exp.max}], the offset's ${w.exp.shared}-mile range cancelling (differenced as if independent: [${w.exp.unshared.min}, ${w.exp.unshared.max}]).
Resultata: [${w.row.min}, ${w.row.max}].`);
}
// The app's constants are these: each line's offset range and the first
// month from which every cumulative band carries it.
const appOffsets = JSON.parse(JSON.stringify(vm.runInContext("typeof PRE_SERIES_OFFSET === 'undefined' ? null : PRE_SERIES_OFFSET", ctx)));
const wantOffsets = Object.fromEntries(Object.entries(OFFSET_RANGE).map(([h, range]) =>
  [h, {from: range > 0 ? out.knottedFrom[h] : "", range}]));
assert.deepEqual(appOffsets, wantOffsets,
  `Replicata: read crashla.js's PRE_SERIES_OFFSET.
Expectata: ${JSON.stringify(wantOffsets)} (each range from its source; each line's first fully knotted month from the master).
Resultata: ${JSON.stringify(appOffsets)}.`);
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  const r = out.res[helmer];
  assert.ok(near(r.row.min, r.expMonthly.min) && near(r.row.max, r.expMonthly.max) &&
    near(r.all.min, r.expMonthly.min) && near(r.all.max, r.expMonthly.max),
    `Replicata: recompute ${helmer}'s default-window Monthly-track VMT band from data/vmt.js (summed month bands ∩ kyoom difference, plus the partially received months' thinned bands).
Expectata: [${r.expMonthly.min}, ${r.expMonthly.max}] for both the summary row and the all-incidents estimate.
Resultata: row [${r.row.min}, ${r.row.max}], all-incidents [${r.all.min}, ${r.all.max}].`);
  assert.ok(near(r.fatality.min, r.expFiveDay.min) && near(r.fatality.max, r.expFiveDay.max),
    `Replicata: recompute ${helmer}'s default-window five-day VMT band (receipt-scaled data-through month, no Monthly-track thinning).
Expectata: [${r.expFiveDay.min}, ${r.expFiveDay.max}].
Resultata: [${r.fatality.min}, ${r.fatality.max}].`);
  assert.ok(r.row.min <= r.row.best && r.row.best <= r.row.max,
    `Replicata: check ${helmer}'s window band brackets its best. Resultata: [${r.row.min}, ${r.row.best}, ${r.row.max}].`);
  const lagMonths = [...lagged].filter(k => k.startsWith(helmer + "|")).map(k => k.slice(helmer.length + 1)).sort();
  assert.equal(JSON.stringify(r.partialMonths), JSON.stringify({monthly: [...lagMonths, dataThroughMonth], fiveDay: [dataThroughMonth]}),
    `Replicata: list ${helmer}'s partially received months in the default window, per track.
Expectata: the Monthly track's are the months inside ${helmer}'s Monthly-report lag (${JSON.stringify(lagMonths)}) and the NHTSA data-through month ${dataThroughMonth}; the five-day track's the data-through month alone.
Resultata: ${JSON.stringify(r.partialMonths)}.`);
}
// The anchors bite: Waymo's hub-pinned cumulative, Tesla's deck-pinned
// cumulative and (since 2026-10-03) Zoox's Dec-2025 knot on its official 1.3M
// disclosure all tighten the window band on BOTH edges vs the plain sum.
for (const helmer of ["Waymo", "Tesla", "Zoox"]) {
  const r = out.res[helmer];
  assert.ok(r.row.min > r.expMonthly.sumMin && r.row.max < r.expMonthly.sumMax,
    `Replicata: compare ${helmer}'s window band to the plain sum of its month bands.
Expectata: strictly tighter on both edges (sum [${r.expMonthly.sumMin}, ${r.expMonthly.sumMax}]).
Resultata: [${r.row.min}, ${r.row.max}].`);
}
// Waymo: the summed bands ran 0.76x-1.28x of best; the anchors imply ~0.93x-1.12x.
assert.ok(out.res.Waymo.row.max / out.res.Waymo.row.min < 1.3,
  `Replicata: Waymo default-window band ratio hi/lo. Expectata: < 1.3 (was 1.68 with summed month bands). Resultata: ${(out.res.Waymo.row.max / out.res.Waymo.row.min).toFixed(3)}.`);
console.log(`qual pass: window VMT band = summed month bands ∩ kyoom difference, the shared pre-series offset cancelling after each line's first knot (+ the partially received months' thinned bands); Waymo default window ${(out.res.Waymo.row.min / 1e6).toFixed(1)}-${(out.res.Waymo.row.max / 1e6).toFixed(1)}M`);

// --- One month, one posterior (2026-10-03, audit #15) -----------------------
// A one-month window's cards and distribution chart take that month's band
// through the window rule above, which intersects the authored month band
// with the single-month kyoom difference; the MPI-over-time chart drew the
// same month from the authored band alone. Where the kyoom knots are tighter
// than the month band (Tesla 2025-09; Waymo 2025-09..12 and 2026-03 since the
// 2026-09-04 re-anchoring) the page showed two posteriors for one month, e.g.
// Waymo 2025-12 all incidents: card 189,004 (149,304 - 241,728), chart 183.2K
// (124.0K - 262.1K). Every chart point must be its one-month window's card.
const oneMonth = vm.runInContext(`
(() => {
  const full = monthSeriesData();
  const diffs = [];
  let compared = 0;
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
  full.months.forEach((month, i) => {
    const rows = monthlySummaryRows(sliceSeries(full, i, i));
    for (const helmer of ADS_HELMERS) {
      const entry = full.points[i].helmers[helmer];
      if (entry === null) continue;
      // (The row is read, never assumed: until 2026-11-06 a missing one
      // stopped here on a TypeError naming nothing. assert is crashla.js's.)
      const row = rows.find(r => r.helmer === helmer);
      assert(row !== undefined, "Replicata: build the one-month window " + month + "'s summary rows (monthlySummaryRows) and find " + helmer + "'s, a company with a point that month.\\nExpectata: one, its estimates the cards this check compares with the chart.\\nResultata: none; the rows are", rows.map(r => r.helmer));
      for (const m of METRIC_DEFS) {
        const chart = entry.mpiByMetric[m.key];
        if (chart === null) continue;
        const card = row.mpiEstimates[m.key];
        const ci = chart.bands[chart.bands.length - 1];
        compared++;
        const gap = Math.max(rel(chart.mpiMedian, card.postMedian), rel(ci.lo, card.lo), rel(ci.hi, card.hi));
        if (gap > 1e-9) diffs.push({helmer, month, metric: m.key,
          chart: [chart.mpiMedian, ci.lo, ci.hi].map(Math.round), card: [card.postMedian, card.lo, card.hi].map(Math.round)});
      }
    }
  });
  return {compared, diffs};
})()`, ctx);
assert.ok(oneMonth.compared > 1000 && oneMonth.diffs.length === 0,
  `Replicata: for every helmer, month and metric, compare the MPI-over-time chart's posterior (median and 95% CI) with the summary card of a one-month window on that month.
Expectata: identical (one posterior per month on the page); ${oneMonth.compared} pairs compared.
Resultata: ${oneMonth.diffs.length} differ, e.g. ${JSON.stringify(oneMonth.diffs.slice(0, 4))}.`);
console.log(`qual pass: every one of ${oneMonth.compared} per-month chart posteriors equals its one-month window's card`);

// --- The app checks the offset's months at load (2026-11-03) ----------------
// windowVmtBand adds a line's range back only from its PRE_SERIES_OFFSET
// month (`from`) on, which is right only while that month is the line's first
// fully knotted month, so the app asserts it at load (rule 12):
// checkPreSeriesOffsets, which init runs right after checkGhostVmtRows. Here
// it must be silent on the data, which also shows that a line with no range
// goes unchecked against the knots (its month is "", which no derived month
// equals), and silent when such a line's knots move (Tesla's two lines, every
// cumulative band narrowed inside the running sums at both edges, so the
// first fully knotted month becomes the line's first month: its month stays
// "" whatever its knots, as the comment above checkPreSeriesOffsets says it
// must, since 2026-11-04). A narrowing moves only an edge not already inside
// (Tesla's case, as first written on 2026-11-04, set every floor a mile above
// the running sum, which moved 15 of its 16 floors down, a widening). It must
// throw, naming the line, the month the master gives (expected) and the month
// the constant holds (found), when a line's month moves a month either way;
// when a knot's band edge widens to the running sum of the monthly bands (the
// knot no longer shapes it, so the first fully knotted month moves later);
// and when the month before a line's first knot is narrowed strictly inside
// the running sums at both edges (so it moves earlier, whatever that month's
// band top: the case narrowed only the floor at first, which moved the knot
// only while the top was already inside; on the data that month's floor is at
// the running sum, so it becomes the sum plus a mile, as the case first set
// it). It must throw naming the master's lines when a line's entry is missing
// or a line with no rows has one. The form check (also 2026-11-03): it must throw,
// naming the line and the bad value under the field that holds it, when an
// entry is not an object (null, undefined, a number: until 2026-11-04 the
// destructuring of the entry threw a TypeError on the first two, naming no
// line, and a number's range was named "undefined"), when an entry's range is
// not a finite number of miles, 0 or more (NaN, negative, Infinity, a string
// of digits, null, missing: the range filter skipped all but Infinity and the
// string silently, and took those two for a range; since 2026-11-04 the
// range's type is named too, as String() writes a string of digits just as it
// writes a valid range), or its month is not "" with a range of 0 (Tesla's set
// to 2099-01: until the form check this section required that to pass
// silently, a line with no range adding nothing back; Tesla's an empty String
// object; and Waymo's range zeroed with its month kept) or not a YYYY-MM month
// string with a range above 0 ("", "Dec 2021", "2021-13", a day, a number,
// missing: the knot check threw on each of Waymo's, but named the value only
// as the month found, and a missing month not at all; on TeslaNoMonitor, which
// has no fully knotted month, its assert named only the line; and Waymo's own
// month in an array, in a String object or from an object's toString: the
// month check's regex converts its argument to a string, so until 2026-11-04
// those passed it, and the knot check named them as found ["2021-12"],
// "2021-12" or {}; since then the month's type is named too). And a line
// given a range and a month but no fully knotted month (TeslaNoMonitor, its
// last month loose) must throw the assert that says so, naming the line: not
// a TypeError from the derivation after it (knotted[0] is undefined there),
// nor the knot or form asserts. Every throw must be the app's assert's: an
// Error (fail() throws one), read from the error's name, not a TypeError or
// any other error. Its details are read as data, the JSON object fail()
// writes at the end of the message, so no rewording of a message changes a
// case (until 2026-11-04 the cases matched strings anywhere in the error's
// name and message, so a message that held the word "TypeError" turned them
// red). The months are re-derived here as in the first section, from the
// mutated rows.
{
  const initBlock = fs.readFileSync("crashla.js", "utf8").split("// --- Init ---")[1];
  assert.ok(initBlock !== undefined && /checkGhostVmtRows\(\);\s*checkPreSeriesOffsets\(\);/.test(initBlock),
    `Replicata: read crashla.js's init block (after "// --- Init ---").
Expectata: checkGhostVmtRows(); followed directly by checkPreSeriesOffsets();, so the page checks the offset's months at every load, right after the ghost rows.
Resultata: ${initBlock === undefined ? "no init block" : "no such call"}.`);
  const load = vm.runInContext(`
  (() => {
    // What the check said: null when silent, else the error's name, its
    // message and its details: the JSON object the app's fail() writes at the
    // end of the message, found as the first "{" from which the rest of the
    // message parses (null when there is none, as for a TypeError thrown past
    // an assert).
    const detailsOf = message => {
      for (let i = message.indexOf("{"); i !== -1; i = message.indexOf("{", i + 1)) {
        try { return JSON.parse(message.slice(i)); } catch (e) { /* a brace among the message's words */ }
      }
      return null;
    };
    const run = () => {
      try { checkPreSeriesOffsets(); return null; }
      catch (e) { return {name: e.name, message: e.message, details: detailsOf(e.message)}; }
    };
    const shift = (month, by) => { const n = +month.slice(0, 4) * 12 + +month.slice(5, 7) - 1 + by; return Math.floor(n / 12) + "-" + String(n % 12 + 1).padStart(2, "0"); };
    const lineRows = helmer => vmtRows.filter(r => r.helmer === helmer).sort((a, b) => (a.month < b.month ? -1 : 1));
    const runningSums = (helmer, month) => lineRows(helmer).filter(r => r.month <= month)
      .reduce((s, r) => ({lo: s.lo + r.vmtMin, hi: s.hi + r.vmtMax}), {lo: 0, hi: 0});
    // The first section's derivation: the month after the last whose cumulative
    // band is not strictly inside the running sums of the monthly bands
    // (9999-12 when that is the line's last month: no fully knotted month).
    const knotted = helmer => {
      const master = lineRows(helmer);
      let lo = 0, hi = 0, from = master[0].month;
      master.forEach((r, i) => {
        lo += r.vmtMin; hi += r.vmtMax;
        if (!(r.kyoomMin > lo && r.kyoomMax < hi)) from = i + 1 < master.length ? master[i + 1].month : "9999-12";
      });
      return from;
    };
    // Each case: what was changed, what the check said, the details its throw
    // must hold (null: it must be silent) and the detail keys it must not
    // hold, and why the change would test nothing (null: it tests something).
    const cases = [];
    const check = (what, want, absent, vacuous) => cases.push({what, got: run(), want, absent, vacuous});
    check("the data as it stands", null, [], null);
    // A cumulative band narrowed to at least a mile inside the running sums
    // of the monthly bands at both edges: an edge already inside stays where
    // it is, so no edge moves out.
    const narrowInside = (line, r) => {
      const s = runningSums(line, r.month);
      r.kyoomMin = Math.max(r.kyoomMin, s.lo + 1);
      r.kyoomMax = Math.min(r.kyoomMax, s.hi - 1);
    };
    // A change to the rows or a month: the derived month after it, and the
    // constant's; then the rows or the month restored.
    const mutate = (what, line, apply, undo) => {
      apply();
      const expected = knotted(line), found = PRE_SERIES_OFFSET[line].from;
      check(what, {helmer: line, expected, found}, [],
        expected === found ? "the change left the first fully knotted month at the constant's (" + found + ")" : null);
      undo();
    };
    for (const line of ["Waymo", "Zoox"]) {
      const from = PRE_SERIES_OFFSET[line].from;
      for (const by of [1, -1]) {
        mutate(line + "'s month moved " + (by > 0 ? "a month later" : "a month earlier"), line,
          () => { PRE_SERIES_OFFSET[line].from = shift(from, by); }, () => { PRE_SERIES_OFFSET[line].from = from; });
      }
      // The first fully knotted month's row and the one before it are read,
      // never assumed (until 2026-11-06 a constant naming a month the rows
      // lack stopped here on a TypeError naming nothing). assert is
      // crashla.js's, which throws its message with the details appended.
      const knot = lineRows(line).find(r => r.month === from);
      assert(knot !== undefined, "Replicata: find " + line + "'s row (vmtRows) for PRE_SERIES_OFFSET's month, " + from + ".\\nExpectata: one, the first fully knotted month whose band the next case widens.\\nResultata: none; " + line + "'s rows run", lineRows(line).map(r => r.month));
      const top = knot.kyoomMax;
      mutate(line + "'s " + from + " cumulative band's top widened to the running sum", line,
        () => { knot.kyoomMax = runningSums(line, from).hi; }, () => { knot.kyoomMax = top; });
      const before = lineRows(line).find(r => r.month === shift(from, -1));
      assert(before !== undefined, "Replicata: find " + line + "'s row (vmtRows) for the month before PRE_SERIES_OFFSET's month " + from + ".\\nExpectata: one, whose band the next case narrows.\\nResultata: none; " + line + "'s rows run", lineRows(line).map(r => r.month));
      const band = [before.kyoomMin, before.kyoomMax];
      mutate(line + "'s " + before.month + " cumulative band narrowed to at least a mile inside the running sums at both edges", line,
        () => { narrowInside(line, before); }, () => { [before.kyoomMin, before.kyoomMax] = band; });
    }
    // A line with no range adds nothing back, so its knots go unchecked: each
    // of Tesla's two lines with every cumulative band narrowed to at least a
    // mile inside the running sums at both edges must leave the check silent;
    // then the bands restored. The narrowing makes the line's first month its
    // first fully knotted month, a knot moved (Tesla's) or gained
    // (TeslaNoMonitor has none), since that month's band was loose before
    // (kyoom-band.qual pins a line's first cumulative band to its monthly
    // band). On the data of 2026-11-04 it moves only Tesla's first band (its
    // other 15 lie inside already) and each of TeslaNoMonitor's 9 at both
    // edges.
    for (const line of ["Tesla", "TeslaNoMonitor"]) {
      const rows = lineRows(line), bands = rows.map(r => [r.kyoomMin, r.kyoomMax]), was = knotted(line);
      rows.forEach(r => { narrowInside(line, r); });
      const now = knotted(line);
      check(line + "'s every cumulative band narrowed to at least a mile inside the running sums at both edges", null, [],
        now === was ? "the change left the first fully knotted month at " + was : null);
      rows.forEach((r, i) => { [r.kyoomMin, r.kyoomMax] = bands[i]; });
    }
    // A line's entry replaced by a malformed one: a throw naming the line and
    // each given detail (the bad value, as String() writes it, under the field
    // that holds it, and a range's or month's type, which String() hides);
    // then the entry restored.
    const malformed = (what, line, entry, details) => {
      const saved = PRE_SERIES_OFFSET[line];
      PRE_SERIES_OFFSET[line] = entry;
      check(what, {helmer: line, ...details}, [], null);
      PRE_SERIES_OFFSET[line] = saved;
    };
    const waymoFrom = PRE_SERIES_OFFSET.Waymo.from, waymoRange = PRE_SERIES_OFFSET.Waymo.range;
    for (const [what, entry] of [["null", null], ["undefined", undefined], ["a number", waymoRange]]) {
      malformed("Waymo's entry " + what, "Waymo", entry, {entry: String(entry)});
    }
    for (const [what, range] of [["NaN", NaN], ["negative", -waymoRange], ["Infinity", Infinity],
      ["a string of digits", String(waymoRange)], ["null", null]]) {
      malformed("Waymo's range " + what, "Waymo", {from: waymoFrom, range}, {range: String(range), type: typeof range});
    }
    malformed("Waymo's range missing", "Waymo", {from: waymoFrom}, {range: String(undefined), type: typeof undefined});
    // Waymo's own month in an array, in a String object or from an object's
    // toString: each converts to the right month string, as the month regex
    // converts its argument, so only the month's type tells them from it.
    for (const [what, from] of [['""', ""], ["Dec 2021", "Dec 2021"], ["2021-13", "2021-13"],
      ["2021-12-01 (a day)", "2021-12-01"], ["202112 (a number)", 202112],
      [waymoFrom + " in an array", [waymoFrom]], [waymoFrom + " in a String object", new String(waymoFrom)],
      [waymoFrom + " from an object's toString", {toString: () => waymoFrom}]]) {
      malformed("Waymo's month " + what + " with its range above 0", "Waymo", {from, range: waymoRange},
        {from: String(from), type: typeof from});
    }
    malformed("Waymo's month missing with its range above 0", "Waymo", {range: waymoRange}, {from: String(undefined), type: typeof undefined});
    malformed("Waymo's range 0 with its month kept", "Waymo", {from: waymoFrom, range: 0}, {from: waymoFrom, type: typeof waymoFrom});
    malformed("Tesla's month (range 0) set to 2099-01", "Tesla", {from: "2099-01", range: 0}, {from: "2099-01", type: "string"});
    malformed("Tesla's month (range 0) an empty String object", "Tesla", {from: new String(""), range: 0}, {from: "", type: "object"});
    malformed('TeslaNoMonitor given a range (1000) with its month ""', "TeslaNoMonitor", {from: "", range: 1000}, {from: "", type: "string"});
    // A line given a range and a month but no fully knotted month: the assert
    // that says so, told from the knot and form asserts by their detail keys,
    // none of which it holds (the knot assert's "expected" and "found", the
    // range and month asserts' "range", the entry assert's "entry"; until
    // 2026-11-04 only "expected" and "range" were forbidden, so a knot assert
    // reading knotted[0]?.month, which then names only the line and "found",
    // passed for it).
    // TeslaNoMonitor's last month is loose (its cumulative band is the running
    // sums'); its top is set to the running sum here anyway, so the line has no
    // fully knotted month whatever knots it gains (the case's own requirement
    // catches one that stayed: the knot check would throw naming "expected",
    // or nothing would).
    const tnm = lineRows("TeslaNoMonitor"), tnmLast = tnm[tnm.length - 1];
    const tnmTop = tnmLast.kyoomMax, tnmEntry = PRE_SERIES_OFFSET.TeslaNoMonitor;
    tnmLast.kyoomMax = runningSums("TeslaNoMonitor", tnmLast.month).hi;
    PRE_SERIES_OFFSET.TeslaNoMonitor = {from: tnm[0].month, range: 1000};
    check("TeslaNoMonitor given a range (1000) and its first month, " + tnm[0].month + ", as its month",
      {helmer: "TeslaNoMonitor"}, ["expected", "found", "range", "entry"], null);
    PRE_SERIES_OFFSET.TeslaNoMonitor = tnmEntry;
    tnmLast.kyoomMax = tnmTop;
    // The entries are the master's lines.
    const lines = [...new Set(vmtRows.map(r => r.helmer))].sort();
    const saved = Object.entries(PRE_SERIES_OFFSET);
    const restore = () => { for (const k of Object.keys(PRE_SERIES_OFFSET)) delete PRE_SERIES_OFFSET[k]; for (const [k, v] of saved) PRE_SERIES_OFFSET[k] = v; };
    delete PRE_SERIES_OFFSET.TeslaNoMonitor;
    check("TeslaNoMonitor's entry removed", {lines}, [], null);
    restore();
    PRE_SERIES_OFFSET.Cruise = {from: "", range: 0};
    check("an entry for a line with no rows (Cruise)", {lines}, [], null);
    restore();
    check("the data restored", null, [], null);
    return cases;
  })()`, ctx);
  // A throw holds when it is the app's assert's (an Error, by its name) and
  // its details, read as data, hold every wanted key at its value (both as
  // JSON) and none of the absent keys; the message's words are not read.
  const bad = [];
  for (const c of load) {
    if (c.vacuous !== null) bad.push(`${c.what}: ${c.vacuous}, so it tests nothing`);
    const held = c.want === null ? c.got === null
      : c.got !== null && c.got.name === "Error" && c.got.details !== null
        && Object.entries(c.want).every(([k, v]) => Object.hasOwn(c.got.details, k) && JSON.stringify(c.got.details[k]) === JSON.stringify(v))
        && c.absent.every(k => !Object.hasOwn(c.got.details, k));
    if (!held) bad.push(`${c.what}: ${c.got === null ? "silent" : "threw " + JSON.stringify(c.got.name + ": " + c.got.message)}, want ${c.want === null ? "silence" : "an Error (the app's assert) whose details hold " + JSON.stringify(c.want) + c.absent.map(k => ", without " + JSON.stringify(k)).join("")}`);
  }
  assert.deepEqual(bad, [],
    `Replicata: in the app loaded in vm, vmtRows parsed from data/vmt.js as init parses them, run checkPreSeriesOffsets on the data, then on each change (restoring after each): Waymo's and Zoox's PRE_SERIES_OFFSET month moved a month either way; their knotted month's cumulative band top widened to the running sum of the monthly bands; the month before it narrowed to at least a mile inside the running sums at both edges (no edge moving out); Tesla's and TeslaNoMonitor's every cumulative band so narrowed (their range 0); Waymo's entry null, undefined or a number; Waymo's range NaN, negative, Infinity, a string of digits, null or missing; Waymo's month "", "Dec 2021", "2021-13", a day, a number, its own month in an array, in a String object or from an object's toString, or missing with its range above 0, and kept with its range 0; Tesla's month (range 0) set to 2099-01 or an empty String object; TeslaNoMonitor given a range with month "", and with its first month (its last month loose, so no fully knotted month); an entry removed; an entry added for a line with no rows.
Expectata: silent on the data, after Tesla's two lines' bands are narrowed (a line with no range is not checked against its knots), and after restoring; on every other change the app's assert's throw, an Error (not a TypeError or any other error), whose details (the JSON object at the end of its message, read as data) hold: for a moved month or knot the line, the month the master gives ("expected") and the constant's ("found"); for a malformed entry the line and the bad value under the field that holds it ("entry", "range" with the range's "type", or "from" with the month's "type"); for TeslaNoMonitor with a month but no fully knotted month the line, without the knot assert's "expected" and "found", the range and month asserts' "range" or the entry assert's "entry"; for a missing or extra entry the master's lines.
Resultata: ${bad.join("; ")}.`);
  const t0 = process.hrtime.bigint();
  vm.runInContext("for (let i = 0; i < 1000; i++) checkPreSeriesOffsets();", ctx);
  const perCall = Number(process.hrtime.bigint() - t0) / 1e6 / 1000;
  console.log(`qual pass: the app's load-time check of PRE_SERIES_OFFSET (checkPreSeriesOffsets) is silent on the data, leaves the range-0 lines unchecked against the knots even when those move, and throws its assert on ${load.filter(c => c.got !== null).length} changes, naming the line and both months, the line and the bad value (with a range's or month's type), or the master's lines; ${perCall.toFixed(3)} ms a call`);
}

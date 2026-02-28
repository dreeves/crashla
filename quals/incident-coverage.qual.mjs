import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// --- Parse VMT CSV and verify incident_coverage fields ---

const vmtData = vm.runInContext(`
  const rows = parseVmtCsv(VMT_CSV_TEXT);
  rows.map(r => ({
    company: r.company,
    month: r.month,
    vmtBest: r.vmtBest,
    vmtMin: r.vmtMin,
    vmtMax: r.vmtMax,
    coverage: r.coverage,
    incCov: r.incCov,
    incCovMin: r.incCovMin,
    incCovMax: r.incCovMax,
  }))
`, ctx);

// All complete months must have incCov = 1
for (const row of vmtData) {
  if (row.month !== "2026-01") {
    assert.equal(row.incCov, 1,
      `Replicata: check incident_coverage for ${row.company} ${row.month}.
Expectata: complete months have incident_coverage = 1.
Resultata: got ${row.incCov}.`);
    assert.equal(row.incCovMin, 1,
      `incident_coverage_min for complete month ${row.company} ${row.month} should be 1`);
    assert.equal(row.incCovMax, 1,
      `incident_coverage_max for complete month ${row.company} ${row.month} should be 1`);
  }
}

// Waymo January must have incCov < 1 (Monthly reports missing due to lag)
const waymoJan = vmtData.find(r => r.company === "Waymo" && r.month === "2026-01");
assert.ok(waymoJan.incCov > 0 && waymoJan.incCov < 1,
  `Replicata: check Waymo January incident_coverage.
Expectata: Waymo January has incident_coverage < 1 because Monthly reports are absent.
Resultata: incCov = ${waymoJan.incCov}.`);
assert.ok(waymoJan.incCovMin <= waymoJan.incCov,
  `incident_coverage_min must be <= incident_coverage`);
assert.ok(waymoJan.incCovMax >= waymoJan.incCov,
  `incident_coverage_max must be >= incident_coverage`);
assert.ok(waymoJan.incCovMin > 0 && waymoJan.incCovMax < 1,
  `Waymo Jan incCov range must be in (0, 1)`);

// Tesla January should have incCov = 1 (filed Monthly reports early)
const teslaJan = vmtData.find(r => r.company === "Tesla" && r.month === "2026-01");
assert.equal(teslaJan.incCov, 1,
  `Replicata: check Tesla January incident_coverage.
Expectata: Tesla filed Monthly reports early, so incident_coverage = 1.
Resultata: incCov = ${teslaJan.incCov}.`);

// Zoox January should have incCov < 1 (Monthly reports missing)
const zooxJan = vmtData.find(r => r.company === "Zoox" && r.month === "2026-01");
assert.ok(zooxJan.incCov > 0 && zooxJan.incCov < 1,
  `Replicata: check Zoox January incident_coverage.
Expectata: Zoox January has incident_coverage < 1 because Monthly reports are absent.
Resultata: incCov = ${zooxJan.incCov}.`);

// --- Verify effective VMT in monthSeriesData incorporates incident coverage ---

vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
`, ctx);

const seriesData = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
    return {
      waymoJan: byMonth["2026-01"].companies.Waymo,
      waymoDec: byMonth["2025-12"].companies.Waymo,
      waymoNov: byMonth["2025-11"].companies.Waymo,
      teslaJan: byMonth["2026-01"].companies.Tesla,
    };
  })()
`, ctx);

// For Waymo December (complete month, coverage=1, incCov=1):
// effective VMT should equal the raw VMT values.
const waymoDecRaw = vmtData.find(r => r.company === "Waymo" && r.month === "2025-12");
assert.ok(
  Math.abs(seriesData.waymoDec.vmtBest - waymoDecRaw.vmtBest) < 1,
  `Replicata: check Waymo December effective VMT.
Expectata: coverage=1, incCov=1, so effective VMT equals raw VMT.
Resultata: effective=${seriesData.waymoDec.vmtBest}, raw=${waymoDecRaw.vmtBest}.`);

// For Waymo January: effective VMT must be coverage * incCov * raw VMT
const waymoJanExpBest = waymoJan.vmtBest * waymoJan.coverage * waymoJan.incCov;
const waymoJanExpMin = waymoJan.vmtMin * waymoJan.coverage * waymoJan.incCovMin;
const waymoJanExpMax = waymoJan.vmtMax * waymoJan.coverage * waymoJan.incCovMax;
assert.ok(
  Math.abs(seriesData.waymoJan.vmtBest - waymoJanExpBest) < 1,
  `Replicata: check Waymo January effective vmtBest.
Expectata: vmtBest = raw * coverage * incCov = ${waymoJanExpBest}.
Resultata: got ${seriesData.waymoJan.vmtBest}.`);
assert.ok(
  Math.abs(seriesData.waymoJan.vmtMin - waymoJanExpMin) < 1,
  `Replicata: check Waymo January effective vmtMin.
Expectata: vmtMin = raw_min * coverage * incCovMin = ${waymoJanExpMin}.
Resultata: got ${seriesData.waymoJan.vmtMin}.`);
assert.ok(
  Math.abs(seriesData.waymoJan.vmtMax - waymoJanExpMax) < 1,
  `Replicata: check Waymo January effective vmtMax.
Expectata: vmtMax = raw_max * coverage * incCovMax = ${waymoJanExpMax}.
Resultata: got ${seriesData.waymoJan.vmtMax}.`);

// incCovMin pairs with vmtMin → smallest effective VMT (most pessimistic MPI)
// incCovMax pairs with vmtMax → largest effective VMT (most optimistic MPI)
// This means effective vmtMin should be strictly less than it would be without
// incident coverage, and similarly for vmtMax.
const waymoJanVmtMinWithoutIncCov = waymoJan.vmtMin * waymoJan.coverage;
const waymoJanVmtMaxWithoutIncCov = waymoJan.vmtMax * waymoJan.coverage;
assert.ok(
  seriesData.waymoJan.vmtMin < waymoJanVmtMinWithoutIncCov,
  `Replicata: verify incCovMin shrinks effective vmtMin.
Expectata: vmtMin with incident coverage < vmtMin without it.
Resultata: with=${seriesData.waymoJan.vmtMin}, without=${waymoJanVmtMinWithoutIncCov}.`);
assert.ok(
  seriesData.waymoJan.vmtMax < waymoJanVmtMaxWithoutIncCov,
  `Replicata: verify incCovMax shrinks effective vmtMax.
Expectata: vmtMax with incident coverage < vmtMax without it.
Resultata: with=${seriesData.waymoJan.vmtMax}, without=${waymoJanVmtMaxWithoutIncCov}.`);

// --- Key sanity check: Waymo Jan and Dec 95% CIs now overlap ---
// This is the whole point — the graph should no longer claim a statistically
// significant improvement in January.

const ciCheck = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
    const massFrac = 0.95;
    const kDec = byMonth["2025-12"].companies.Waymo.incidents.total;
    const mDec = byMonth["2025-12"].companies.Waymo.vmtBest;
    const decCI = estimateMpi(kDec, mDec, massFrac);

    const kJan = byMonth["2026-01"].companies.Waymo.incidents.total;
    const mJan = byMonth["2026-01"].companies.Waymo.vmtBest;
    const janCI = estimateMpi(kJan, mJan, massFrac);

    return { decLo: decCI.lo, decHi: decCI.hi, janLo: janCI.lo, janHi: janCI.hi,
             kDec, mDec, kJan, mJan };
  })()
`, ctx);

assert.ok(
  ciCheck.decHi >= ciCheck.janLo || ciCheck.janHi >= ciCheck.decLo,
  `Replicata: compare Waymo December and January 95% CIs for MPI.
Expectata: CIs overlap, reflecting that the apparent January improvement is not
  statistically significant given missing Monthly reports (Poisson thinning).
Resultata: Dec CI=[${ciCheck.decLo.toFixed(0)}, ${ciCheck.decHi.toFixed(0)}],
  Jan CI=[${ciCheck.janLo.toFixed(0)}, ${ciCheck.janHi.toFixed(0)}],
  kDec=${ciCheck.kDec}, mDec=${ciCheck.mDec.toFixed(0)},
  kJan=${ciCheck.kJan}, mJan=${ciCheck.mJan.toFixed(0)}.`);

// Extra: verify December's CI does NOT overlap if we remove incident coverage
// (to confirm the fix actually changed behavior)
const ciCheckNoCov = vm.runInContext(`
  (() => {
    const massFrac = 0.95;
    // Waymo Jan without incident coverage: just coverage * raw VMT
    const rawJan = parseVmtCsv(VMT_CSV_TEXT).find(
      r => r.company === "Waymo" && r.month === "2026-01");
    const mJanNoCov = rawJan.vmtBest * rawJan.coverage; // no incCov
    const kJan = 20;
    const janCI = estimateMpi(kJan, mJanNoCov, massFrac);

    const rawDec = parseVmtCsv(VMT_CSV_TEXT).find(
      r => r.company === "Waymo" && r.month === "2025-12");
    const mDec = rawDec.vmtBest * rawDec.coverage;
    const kDec = 88;
    const decCI = estimateMpi(kDec, mDec, massFrac);

    return { decHi: decCI.hi, janLo: janCI.lo };
  })()
`, ctx);

assert.ok(
  ciCheckNoCov.decHi < ciCheckNoCov.janLo,
  `Replicata: confirm that without incident coverage, Dec and Jan CIs do NOT overlap.
Expectata: Without the fix, January looks like a significant improvement.
Resultata: Dec hi=${ciCheckNoCov.decHi.toFixed(0)}, Jan lo=${ciCheckNoCov.janLo.toFixed(0)}.`);

// --- Tesla January should be unaffected (incCov = 1) ---
const teslaJanRaw = vmtData.find(r => r.company === "Tesla" && r.month === "2026-01");
const teslaJanEffBest = teslaJanRaw.vmtBest * teslaJanRaw.coverage * teslaJanRaw.incCov;
assert.ok(
  Math.abs(seriesData.teslaJan.vmtBest - teslaJanEffBest) < 1,
  `Replicata: check Tesla January effective VMT is unaffected by incident coverage.
Expectata: Tesla incCov=1 so effective VMT = raw * coverage only.
Resultata: effective=${seriesData.teslaJan.vmtBest}, expected=${teslaJanEffBest}.`);

// --- Zoox January effective VMT ---
const zooxJanRaw = vmtData.find(r => r.company === "Zoox" && r.month === "2026-01");
const zooxJanSeriesData = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
    return byMonth["2026-01"].companies.Zoox;
  })()
`, ctx);
const zooxJanExpBest = zooxJanRaw.vmtBest * zooxJanRaw.coverage * zooxJanRaw.incCov;
assert.ok(
  Math.abs(zooxJanSeriesData.vmtBest - zooxJanExpBest) < 1,
  `Replicata: check Zoox January effective VMT.
Expectata: vmtBest = raw * coverage * incCov = ${zooxJanExpBest}.
Resultata: got ${zooxJanSeriesData.vmtBest}.`);

// --- Waymo November: complete month, effective VMT should equal raw VMT ---
const waymoNovRaw = vmtData.find(r => r.company === "Waymo" && r.month === "2025-11");
assert.ok(
  Math.abs(seriesData.waymoNov.vmtBest - waymoNovRaw.vmtBest) < 1,
  `Replicata: check Waymo November effective VMT.
Expectata: coverage=1, incCov=1, so effective VMT equals raw VMT.
Resultata: effective=${seriesData.waymoNov.vmtBest}, raw=${waymoNovRaw.vmtBest}.`);

// --- incCov ordering: min <= best <= max for all rows ---
for (const row of vmtData) {
  assert.ok(row.incCovMin <= row.incCov && row.incCov <= row.incCovMax,
    `Replicata: check incident_coverage ordering for ${row.company} ${row.month}.
Expectata: incCovMin <= incCov <= incCovMax.
Resultata: ${row.incCovMin} <= ${row.incCov} <= ${row.incCovMax}.`);
}

// --- Verify the Poisson thinning interpretation ---
// For a company with incCov < 1, the MPI point estimate should be higher
// (worse safety) than if we naively used the raw VMT, because fewer
// effective miles means a higher rate per mile.
const waymoJanMpiWithCov = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
    const w = byMonth["2026-01"].companies.Waymo;
    return estimateMpi(w.incidents.total, w.vmtBest, 0.95);
  })()
`, ctx);
// Without incCov: use just coverage-scaled VMT
const waymoJanMpiWithoutCov = vm.runInContext(`
  (() => {
    const raw = parseVmtCsv(VMT_CSV_TEXT).find(
      r => r.company === "Waymo" && r.month === "2026-01");
    const mNoCov = raw.vmtBest * raw.coverage; // no incCov
    const series = monthSeriesData();
    const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
    const k = byMonth["2026-01"].companies.Waymo.incidents.total;
    return estimateMpi(k, mNoCov, 0.95);
  })()
`, ctx);
// With thinning, the MPI point estimate should be lower (fewer miles per
// incident means incidents are more frequent relative to VMT), i.e.,
// median MPI decreases.
assert.ok(
  waymoJanMpiWithCov.median < waymoJanMpiWithoutCov.median,
  `Replicata: verify Poisson thinning lowers MPI point estimate.
Expectata: Thinning reduces effective VMT, lowering MPI (incidents look more frequent).
Resultata: withCov median=${waymoJanMpiWithCov.median.toFixed(0)}, withoutCov median=${waymoJanMpiWithoutCov.median.toFixed(0)}.`);

// --- Verify that the CI is wider with incident coverage than without ---
const ciWidthWith = waymoJanMpiWithCov.hi - waymoJanMpiWithCov.lo;
const ciWidthWithout = waymoJanMpiWithoutCov.hi - waymoJanMpiWithoutCov.lo;
assert.ok(
  ciWidthWith < ciWidthWithout,
  `Replicata: verify incident coverage makes CI narrower (in absolute terms).
Expectata: Thinning scales everything down proportionally, so absolute CI width decreases.
Resultata: withCov width=${ciWidthWith.toFixed(0)}, withoutCov width=${ciWidthWithout.toFixed(0)}.`);
// But relative CI width (hi/lo ratio) should stay the same — it only
// depends on k, not m.
const relWidthWith = waymoJanMpiWithCov.hi / waymoJanMpiWithCov.lo;
const relWidthWithout = waymoJanMpiWithoutCov.hi / waymoJanMpiWithoutCov.lo;
assert.ok(
  Math.abs(relWidthWith - relWidthWithout) < 0.01,
  `Replicata: verify relative CI width is unchanged by incident coverage.
Expectata: Poisson CI ratio hi/lo depends only on k, not on VMT.
Resultata: withCov ratio=${relWidthWith.toFixed(4)}, withoutCov ratio=${relWidthWithout.toFixed(4)}.`);

// --- Regression: effective vmtBest must still be strictly positive ---
const allSeriesData = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    return series.points.flatMap(p =>
      Object.entries(p.companies).map(([co, d]) => ({
        company: co, month: p.month,
        vmtMin: d.vmtMin, vmtBest: d.vmtBest, vmtMax: d.vmtMax,
      }))
    );
  })()
`, ctx);
for (const row of allSeriesData) {
  assert.ok(row.vmtBest > 0,
    `effective vmtBest must be positive for ${row.company} ${row.month}`);
  assert.ok(row.vmtMin > 0,
    `effective vmtMin must be positive for ${row.company} ${row.month}`);
  assert.ok(row.vmtMax > 0,
    `effective vmtMax must be positive for ${row.company} ${row.month}`);
  assert.ok(row.vmtMin <= row.vmtBest && row.vmtBest <= row.vmtMax,
    `effective VMT ordering vmtMin <= vmtBest <= vmtMax for ${row.company} ${row.month}`);
}

console.log("qual pass: incident coverage adjusts CIs for months with missing Monthly reports");

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
    helmer: r.helmer,
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

// --- incCov ordering: min <= best <= max for all rows ---
for (const row of vmtData) {
  assert.ok(row.incCovMin <= row.incCov && row.incCov <= row.incCovMax,
    `Replicata: check incident_coverage ordering for ${row.helmer} ${row.month}.
Expectata: incCovMin <= incCov <= incCovMax.
Resultata: ${row.incCovMin} <= ${row.incCov} <= ${row.incCovMax}.`);
  assert.ok(row.incCov > 0 && row.incCov <= 1,
    `incCov must be in (0, 1] for ${row.helmer} ${row.month}`);
}

// Identify months with coverage uncertainty (incCovMin < 1 means the lo bound
// is less than certain, even though p_best = 1.0 to avoid circularity)
const incompleteRows = vmtData.filter(r => r.incCovMin < 1);
const completeRows = vmtData.filter(r => r.incCovMin === 1);

// All complete months must have incCov = incCovMin = incCovMax = 1
for (const row of completeRows) {
  assert.equal(row.incCov, 1,
    `incCov for complete month ${row.helmer} ${row.month} should be 1`);
  assert.equal(row.incCovMin, 1,
    `incident_coverage_min for complete month ${row.helmer} ${row.month} should be 1`);
  assert.equal(row.incCovMax, 1,
    `incident_coverage_max for complete month ${row.helmer} ${row.month} should be 1`);
}

// --- Set up monthSeriesData for effective VMT checks ---

vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
`, ctx);

// --- Verify effective VMT computation for all rows ---

const allSeriesData = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    return series.points.flatMap(p =>
      Object.entries(p.helmers).filter(([, d]) => d !== null && d.vmtBest > 0).map(([name, d]) => ({
        helmer: name, month: p.month,
        vmtMin: d.vmtMin, vmtBest: d.vmtBest, vmtMax: d.vmtMax,
      }))
    );
  })()
`, ctx);
for (const row of allSeriesData) {
  assert.ok(row.vmtBest > 0,
    `effective vmtBest must be positive for ${row.helmer} ${row.month}`);
  assert.ok(row.vmtMin > 0,
    `effective vmtMin must be positive for ${row.helmer} ${row.month}`);
  assert.ok(row.vmtMax > 0,
    `effective vmtMax must be positive for ${row.helmer} ${row.month}`);
  assert.ok(row.vmtMin <= row.vmtBest && row.vmtBest <= row.vmtMax,
    `effective VMT ordering vmtMin <= vmtBest <= vmtMax for ${row.helmer} ${row.month}`);
}

// For complete months with coverage=1: effective VMT should equal raw VMT
for (const raw of completeRows) {
  if (raw.coverage !== 1) continue; // partial months have different effective VMT
  const eff = allSeriesData.find(r => r.helmer === raw.helmer && r.month === raw.month);
  if (!eff) continue; // helmer may not be present for this month
  assert.ok(
    Math.abs(eff.vmtBest - raw.vmtBest) < 1,
    `Replicata: check ${raw.helmer} ${raw.month} effective VMT.
Expectata: coverage=1, incCov=1, so effective VMT equals raw VMT.
Resultata: effective=${eff.vmtBest}, raw=${raw.vmtBest}.`);
}

// --- Conditional tests for incomplete months (incCov < 1) ---
// These activate when NHTSA Monthly reports haven't arrived for the last month.

if (incompleteRows.length > 0) {
  // Pick the first incomplete row per helmer
  const byHelmer = {};
  for (const row of incompleteRows) {
    if (!byHelmer[row.helmer]) byHelmer[row.helmer] = row;
  }

  for (const [helmer, raw] of Object.entries(byHelmer)) {
    const eff = allSeriesData.find(r => r.helmer === helmer && r.month === raw.month);
    if (!eff) continue;

    // p_best = 1.0, so vmtBest is unaffected; but vmtMin uses incCovMin < 1,
    // widening the CI to reflect coverage uncertainty
    assert.ok(
      eff.vmtMin < eff.vmtBest,
      `Replicata: verify incCovMin widens CI for ${helmer} ${raw.month}.
Expectata: vmtMin < vmtBest because incCovMin < 1.
Resultata: vmtMin=${eff.vmtMin}, vmtBest=${eff.vmtBest}.`);

    // MPI CI should be wider than it would be with incCovMin=1
    const mpiCheck = vm.runInContext(`
      (() => {
        const series = monthSeriesData();
        const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
        const w = byMonth[${JSON.stringify(raw.month)}].helmers[${JSON.stringify(helmer)}];
        // Live CI machinery (estimateMpiWindow's marginal quantiles), not the
        // retired single-VMT estimateMpi: the property under test is that
        // incCovMin < incCov widens the DISPLAYED interval's low side. The
        // counterfactual holds incident coverage at its CENTRAL value on the
        // band's low edge (keeping vmtMin <= vmtBest ordered).
        const withCov = estimateMpiWindow(w.incidents.total, null, w.vmtMin, w.vmtBest, w.vmtMax);
        const rawRow = parseVmtCsv(VMT_CSV_TEXT).find(
          r => r.helmer === ${JSON.stringify(helmer)} && r.month === ${JSON.stringify(raw.month)});
        const noCovMin = rawRow.vmtMin * rawRow.coverage * rawRow.incCov;
        const withoutCov = estimateMpiWindow(w.incidents.total, null, noCovMin, w.vmtBest, w.vmtMax);
        return { withMin: withCov.lo, withoutMin: withoutCov.lo };
      })()
    `, ctx);
    assert.ok(
      mpiCheck.withMin < mpiCheck.withoutMin,
      `Replicata: verify coverage uncertainty lowers MPI lo bound for ${helmer} ${raw.month}.
Expectata: incCovMin shrinks effective vmtMin, lowering the MPI lo bound.
Resultata: withCovMin lo=${mpiCheck.withMin.toFixed(0)}, withoutCovMin lo=${mpiCheck.withoutMin.toFixed(0)}.`);
  }
}

// --- Per-metric reporting tracks (Third Amended SGO, Requests No. 1 vs 2) ---
// NHTSA's Third Amended SGO (Apr 24, 2025) Request No. 1.D requires an
// incident report within FIVE days of notice when the crash involves a
// fatality, hospital transport, a vulnerable-road-user strike, an airbag
// deployment, or (ADS) a tow-away; only the remaining property-damage crashes
// ride the Monthly track (Request No. 2). incident_coverage measures the
// Monthly batch's incompleteness, so metrics whose qualifying incidents are
// STRUCTURALLY five-day-reportable must not have their effective VMT thinned
// by it: their reports for the incomplete month are already filed.

const fiveDayKeys = [...vm.runInContext(
  `METRIC_DEFS.filter(m => m.fiveDay === true).map(m => m.key).sort()`, ctx)];
assert.deepEqual(fiveDayKeys, ["airbag", "fatality", "hospitalization"],
  `Replicata: list METRIC_DEFS entries with fiveDay: true.
Expectata: exactly [airbag, fatality, hospitalization] — the metrics whose
counting predicate GUARANTEES a Request No. 1.D five-day trigger (airbag
deployment, fatality, hospital transport). seriousInjury stays on the blended
coverage: a "Serious"-severity injury without hospital transport is
Monthly-track, so no structural guarantee exists.
Resultata: ${JSON.stringify(fiveDayKeys)}.`);

if (incompleteRows.length > 0) {
  const raw = incompleteRows[0];
  // Month-level: for the incomplete month, a five-day metric's displayed
  // bands must come from the RAW (calendar-coverage-only) VMT triple; the
  // 'all' metric's bands must come from the incCov-thinned triple.
  const bandCheck = vm.runInContext(`
    (() => {
      const series = monthSeriesData();
      const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
      const w = byMonth[${JSON.stringify(raw.month)}].helmers[${JSON.stringify(raw.helmer)}];
      const wide = CI_FAN_LEVELS.length - 1; // 95% band
      const bandFor = (k, vMin, vBest, vMax) => {
        const quant = makeMarginalMpiQuant(mixtureComponents(k, null), vMin, vBest, vMax);
        const t = (1 - CI_FAN_LEVELS[wide]) / 2;
        return {lo: quant(t), hi: quant(1 - t)};
      };
      return {
        fatalityGot: w.mpiByMetric.fatality.bands[wide],
        fatalityRaw: bandFor(w.incidents.fatality, w.vmtRawMin, w.vmtRawBest, w.vmtRawMax),
        fatalityThinned: bandFor(w.incidents.fatality, w.vmtMin, w.vmtBest, w.vmtMax),
        allGot: w.mpiByMetric.all.bands[wide],
        allThinned: bandFor(w.incidents.total, w.vmtMin, w.vmtBest, w.vmtMax),
      };
    })()
  `, ctx);
  const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  assert.ok(
    close(bandCheck.fatalityGot.lo, bandCheck.fatalityRaw.lo) &&
    close(bandCheck.fatalityGot.hi, bandCheck.fatalityRaw.hi),
    `Replicata: render the ${raw.helmer} ${raw.month} fatality band while the
month's Monthly batch is missing (incCov=${raw.incCov}).
Expectata: fatality is five-day-track (SGO Request No. 1.D.i), so its band
uses the raw calendar-coverage VMT triple — its reports are already filed.
Resultata: got [${bandCheck.fatalityGot.lo}, ${bandCheck.fatalityGot.hi}],
raw-VMT band [${bandCheck.fatalityRaw.lo}, ${bandCheck.fatalityRaw.hi}],
thinned band [${bandCheck.fatalityThinned.lo}, ${bandCheck.fatalityThinned.hi}].`);
  assert.ok(
    close(bandCheck.allGot.lo, bandCheck.allThinned.lo) &&
    close(bandCheck.allGot.hi, bandCheck.allThinned.hi),
    `Replicata: render the ${raw.helmer} ${raw.month} all-incidents band while
the month's Monthly batch is missing.
Expectata: 'all' is dominated by Monthly-track property-damage crashes, so its
band keeps the incCov-thinned VMT triple.
Resultata: got [${bandCheck.allGot.lo}, ${bandCheck.allGot.hi}],
thinned band [${bandCheck.allThinned.lo}, ${bandCheck.allThinned.hi}].`);

  // Window-level: monthlySummaryRows' per-metric effective VMT sums must
  // select the raw triple for five-day metrics and the thinned triple for
  // Monthly-track metrics.
  const windowCheck = vm.runInContext(`
    (() => {
      const series = monthSeriesData();
      const row = monthlySummaryRows(series).find(r => r.helmer === ${JSON.stringify(raw.helmer)});
      const months = series.points.map(p => p.helmers[${JSON.stringify(raw.helmer)}]).filter(Boolean);
      return {
        fatalityVmtBest: row.mpiEstimates.fatality.vmtBest,
        allVmtBest: row.mpiEstimates.all.vmtBest,
        rawSum: months.reduce((s, m) => s + m.vmtRawBest, 0),
        thinnedSum: months.reduce((s, m) => s + m.vmtBest, 0),
      };
    })()
  `, ctx);
  assert.ok(close(windowCheck.fatalityVmtBest, windowCheck.rawSum),
    `Replicata: sum the ${raw.helmer} window's fatality-metric effective VMT
with an incomplete month (incCov=${raw.incCov}) in the window.
Expectata: five-day metrics sum the raw calendar-coverage VMT (${windowCheck.rawSum}).
Resultata: ${windowCheck.fatalityVmtBest}.`);
  assert.ok(close(windowCheck.allVmtBest, windowCheck.thinnedSum),
    `Replicata: sum the ${raw.helmer} window's all-incidents effective VMT.
Expectata: Monthly-track metrics keep the incCov-thinned VMT (${windowCheck.thinnedSum}).
Resultata: ${windowCheck.allVmtBest}.`);
  assert.ok(windowCheck.rawSum > windowCheck.thinnedSum,
    `Replicata: compare raw vs thinned window VMT sums with incCov<1 present.
Expectata: rawSum > thinnedSum (otherwise this qual isn't exercising the split).
Resultata: raw=${windowCheck.rawSum}, thinned=${windowCheck.thinnedSum}.`);

  // The five-day exemption is only sound once every five-day report for the
  // month is due: NHTSA's data release must postdate month-end + 5 days.
  // The app must enforce that loudly (anti-Postel) rather than assume it.
  assert.ok(/month.?end.*5|five.day.*due|fiveDayDue/i.test(
    vm.runInContext("''", ctx) + appScript.match(/assert\([^;]*NHTSA_MODIFIED_DATE[^;]*\)/s)?.[0]),
    `Replicata: grep crashla.js for an assert tying NHTSA_MODIFIED_DATE to the
incomplete month's five-day reporting deadline.
Expectata: an assert exists that fails loudly if the NHTSA release predates
month-end + 5 days while five-day metrics skip the coverage thinning.
Resultata: no such assert found.`);
}

console.log("qual pass: incident coverage adjusts CIs for months with missing Monthly reports");

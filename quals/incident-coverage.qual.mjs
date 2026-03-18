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
    driver: r.driver,
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
    `Replicata: check incident_coverage ordering for ${row.driver} ${row.month}.
Expectata: incCovMin <= incCov <= incCovMax.
Resultata: ${row.incCovMin} <= ${row.incCov} <= ${row.incCovMax}.`);
  assert.ok(row.incCov > 0 && row.incCov <= 1,
    `incCov must be in (0, 1] for ${row.driver} ${row.month}`);
}

// Identify months with incomplete coverage (if any)
const incompleteRows = vmtData.filter(r => r.incCov < 1);
const completeRows = vmtData.filter(r => r.incCov === 1);

// All complete months must have incCov = incCovMin = incCovMax = 1
for (const row of completeRows) {
  assert.equal(row.incCovMin, 1,
    `incident_coverage_min for complete month ${row.driver} ${row.month} should be 1`);
  assert.equal(row.incCovMax, 1,
    `incident_coverage_max for complete month ${row.driver} ${row.month} should be 1`);
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
      Object.entries(p.drivers).filter(([, d]) => d !== null && d.vmtBest > 0).map(([co, d]) => ({
        driver: co, month: p.month,
        vmtMin: d.vmtMin, vmtBest: d.vmtBest, vmtMax: d.vmtMax,
      }))
    );
  })()
`, ctx);
for (const row of allSeriesData) {
  assert.ok(row.vmtBest > 0,
    `effective vmtBest must be positive for ${row.driver} ${row.month}`);
  assert.ok(row.vmtMin > 0,
    `effective vmtMin must be positive for ${row.driver} ${row.month}`);
  assert.ok(row.vmtMax > 0,
    `effective vmtMax must be positive for ${row.driver} ${row.month}`);
  assert.ok(row.vmtMin <= row.vmtBest && row.vmtBest <= row.vmtMax,
    `effective VMT ordering vmtMin <= vmtBest <= vmtMax for ${row.driver} ${row.month}`);
}

// For complete months with coverage=1: effective VMT should equal raw VMT
for (const raw of completeRows) {
  if (raw.coverage !== 1) continue; // partial months have different effective VMT
  const eff = allSeriesData.find(r => r.driver === raw.driver && r.month === raw.month);
  if (!eff) continue; // company may not be present for this month
  assert.ok(
    Math.abs(eff.vmtBest - raw.vmtBest) < 1,
    `Replicata: check ${raw.driver} ${raw.month} effective VMT.
Expectata: coverage=1, incCov=1, so effective VMT equals raw VMT.
Resultata: effective=${eff.vmtBest}, raw=${raw.vmtBest}.`);
}

// --- Conditional tests for incomplete months (incCov < 1) ---
// These activate when NHTSA Monthly reports haven't arrived for the last month.

if (incompleteRows.length > 0) {
  // Pick the first incomplete row per company
  const byDriver = {};
  for (const row of incompleteRows) {
    if (!byDriver[row.driver]) byDriver[row.driver] = row;
  }

  for (const [driver, raw] of Object.entries(byDriver)) {
    // Effective VMT must be less than coverage-only VMT
    const eff = allSeriesData.find(r => r.driver === driver && r.month === raw.month);
    if (!eff) continue;
    const vmtWithoutIncCov = raw.vmtBest * raw.coverage;
    assert.ok(
      eff.vmtBest < vmtWithoutIncCov,
      `Replicata: verify incCov shrinks effective vmtBest for ${driver} ${raw.month}.
Expectata: vmtBest with incident coverage < vmtBest without it.
Resultata: with=${eff.vmtBest}, without=${vmtWithoutIncCov}.`);

    // Effective VMT = raw * coverage * incCov
    const expected = raw.vmtBest * raw.coverage * raw.incCov;
    assert.ok(
      Math.abs(eff.vmtBest - expected) < 1,
      `Replicata: check ${driver} ${raw.month} effective vmtBest.
Expectata: vmtBest = raw * coverage * incCov = ${expected}.
Resultata: got ${eff.vmtBest}.`);

    // MPI with thinning should be lower than without
    const mpiCheck = vm.runInContext(`
      (() => {
        const series = monthSeriesData();
        const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
        const w = byMonth[${JSON.stringify(raw.month)}].drivers[${JSON.stringify(driver)}];
        const withCov = estimateMpi(w.incidents.total, w.vmtBest, 0.95);
        const rawRow = parseVmtCsv(VMT_CSV_TEXT).find(
          r => r.driver === ${JSON.stringify(driver)} && r.month === ${JSON.stringify(raw.month)});
        const mNoCov = rawRow.vmtBest * rawRow.coverage;
        const withoutCov = estimateMpi(w.incidents.total, mNoCov, 0.95);
        return { withMedian: withCov.median, withoutMedian: withoutCov.median };
      })()
    `, ctx);
    assert.ok(
      mpiCheck.withMedian < mpiCheck.withoutMedian,
      `Replicata: verify Poisson thinning lowers MPI for ${driver} ${raw.month}.
Expectata: Thinning reduces effective VMT, lowering MPI.
Resultata: withCov median=${mpiCheck.withMedian.toFixed(0)}, withoutCov median=${mpiCheck.withoutMedian.toFixed(0)}.`);
  }
}

console.log("qual pass: incident coverage adjusts CIs for months with missing Monthly reports");

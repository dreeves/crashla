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

// Identify months with coverage uncertainty (incCovMin < 1 means the lo bound
// is less than certain, even though p_best = 1.0 to avoid circularity)
const incompleteRows = vmtData.filter(r => r.incCovMin < 1);
const completeRows = vmtData.filter(r => r.incCovMin === 1);

// All complete months must have incCov = incCovMin = incCovMax = 1
for (const row of completeRows) {
  assert.equal(row.incCov, 1,
    `incCov for complete month ${row.driver} ${row.month} should be 1`);
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
      Object.entries(p.drivers).filter(([, d]) => d !== null && d.vmtBest > 0).map(([name, d]) => ({
        driver: name, month: p.month,
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
  if (!eff) continue; // driver may not be present for this month
  assert.ok(
    Math.abs(eff.vmtBest - raw.vmtBest) < 1,
    `Replicata: check ${raw.driver} ${raw.month} effective VMT.
Expectata: coverage=1, incCov=1, so effective VMT equals raw VMT.
Resultata: effective=${eff.vmtBest}, raw=${raw.vmtBest}.`);
}

// --- Conditional tests for incomplete months (incCov < 1) ---
// These activate when NHTSA Monthly reports haven't arrived for the last month.

if (incompleteRows.length > 0) {
  // Pick the first incomplete row per driver
  const byDriver = {};
  for (const row of incompleteRows) {
    if (!byDriver[row.driver]) byDriver[row.driver] = row;
  }

  for (const [driver, raw] of Object.entries(byDriver)) {
    const eff = allSeriesData.find(r => r.driver === driver && r.month === raw.month);
    if (!eff) continue;

    // p_best = 1.0, so vmtBest is unaffected; but vmtMin uses incCovMin < 1,
    // widening the CI to reflect coverage uncertainty
    assert.ok(
      eff.vmtMin < eff.vmtBest,
      `Replicata: verify incCovMin widens CI for ${driver} ${raw.month}.
Expectata: vmtMin < vmtBest because incCovMin < 1.
Resultata: vmtMin=${eff.vmtMin}, vmtBest=${eff.vmtBest}.`);

    // MPI CI should be wider than it would be with incCovMin=1
    const mpiCheck = vm.runInContext(`
      (() => {
        const series = monthSeriesData();
        const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
        const w = byMonth[${JSON.stringify(raw.month)}].drivers[${JSON.stringify(driver)}];
        const withCov = estimateMpi(w.incidents.total, w.vmtMin, 0.95);
        const rawRow = parseVmtCsv(VMT_CSV_TEXT).find(
          r => r.driver === ${JSON.stringify(driver)} && r.month === ${JSON.stringify(raw.month)});
        const noCovMin = rawRow.vmtMin * rawRow.coverage;
        const withoutCov = estimateMpi(w.incidents.total, noCovMin, 0.95);
        return { withMin: withCov.median, withoutMin: withoutCov.median };
      })()
    `, ctx);
    assert.ok(
      mpiCheck.withMin < mpiCheck.withoutMin,
      `Replicata: verify coverage uncertainty lowers MPI lo bound for ${driver} ${raw.month}.
Expectata: incCovMin shrinks effective vmtMin, lowering the MPI lo bound.
Resultata: withCovMin median=${mpiCheck.withMin.toFixed(0)}, withoutCovMin median=${mpiCheck.withoutMin.toFixed(0)}.`);
  }
}

console.log("qual pass: incident coverage adjusts CIs for months with missing Monthly reports");

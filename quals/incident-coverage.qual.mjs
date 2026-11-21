// Coverage of data/vmt.js's analysis rows and what the page makes of it.
// Since 2026-11-21 (the human, on NHTSA's partly reported newest month:
// "maximum conservativeness, don't show things when they involve arbitrary
// guesses"; "if we know when a helmer's crash reports end then we compute the
// exact VMT for the crashes. if not, we don't try to guess") an analysis row
// is of one of two kinds (data/slurp.py month_sources):
//   complete: a month NHTSA's file holds whole. Receipt and incident coverage
//     (1, 1, 1), its incidents through NHTSA's receipt cutoff, its month
//     before the data-through month; its effective miles are its raw miles.
//   list row: a month a company's own dated list covers. Its incidents run
//     through the list's date, in the row's own month; its receipt coverage
//     is one share three times over (the list's miles over the row's: no
//     range) and its incident coverage a share with a low edge and a high
//     edge of 1 (quals/preprints.qual.mjs recomputes both from the list).
// NHTSA's data-through month has no row for a line no list covers: it is
// pending (quals/pending-months.qual.mjs). Until 2026-11-21 that month had a
// row for every line, with a receipt-coverage triple estimated from the
// release (observed over expected five-day-track incidents, its high edge
// FIVE_DAY_RECEIPT_COVERAGE_MAX) and a pooled incident-coverage triple, and a
// helmer's Monthly-lag months a 5-Day-share triple; this qual required those
// (one receipt triple shared by the lines on NHTSA's cutoff, 0 < lo < best <
// hi < 1), and that every other row was (1, 1, 1).
//
// What still has a subject, and is checked on every list row and, so that it
// is checked at a release no list covers, on one synthetic list row (the
// newest row of a line that has none, given a list row's coverage):
//   - the two kinds, and the orderings of both triples;
//   - a row's effective miles: raw for a complete row; for a list row, on the
//     Monthly track, [vmt_min x coverage x incCovMin, vmt x coverage x incCov,
//     vmt_max x coverage_max x incCovMax], on the five-day track [vmt_min x
//     coverage_min, vmt x coverage, vmt_max x coverage_max], and the low
//     incident-coverage edge widens the displayed interval's low side (the
//     synthetic row's receipt coverage has a range, so that the three values
//     are told apart);
//   - the five-day-track metrics (METRIC_DEFS fiveDay) take the receipt
//     coverage alone, in a month's band and in a window's miles, and the
//     Monthly-track metrics both factors;
//   - the page refuses rows of any other kind (checkGhostVmtRows).
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

const pick = `r => ({
    helmer: r.helmer,
    month: r.month,
    vmtBest: r.vmtBest,
    vmtMin: r.vmtMin,
    vmtMax: r.vmtMax,
    coverage: r.coverage,
    coverageMin: r.coverageMin,
    coverageMax: r.coverageMax,
    incCov: r.incCov,
    incCovMin: r.incCovMin,
    incCovMax: r.incCovMax,
    through: r.through,
  })`;
// data/vmt.js's rows as the app parses them.
const fileRows = JSON.parse(vm.runInContext(`JSON.stringify(parseVmtCsv(VMT_CSV_TEXT).map(${pick}))`, ctx));
const nhtsaCutoff = vm.runInContext("NHTSA_DATA_THROUGH_DATE", ctx);
const dataThroughMonth = nhtsaCutoff.slice(0, 7);
const isComplete = r => [r.coverage, r.coverageMin, r.coverageMax, r.incCov, r.incCovMin, r.incCovMax].every(v => v === 1);

// --- The two kinds of row ---
const kindProblems = [];
for (const row of fileRows) {
  const at = `${row.helmer} ${row.month}`;
  if (isComplete(row)) {
    if (row.through !== nhtsaCutoff || !(row.month < dataThroughMonth))
      kindProblems.push(`${at}: complete, with incidents through ${row.through} (NHTSA's cutoff is ${nhtsaCutoff}; a complete month is before ${dataThroughMonth})`);
    continue;
  }
  const receipt = [row.coverage, row.coverageMin, row.coverageMax], incident = [row.incCov, row.incCovMin, row.incCovMax];
  if (!(/^\d{4}-\d{2}-\d{2}$/.test(row.through) && row.through.slice(0, 7) === row.month && row.month <= dataThroughMonth))
    kindProblems.push(`${at}: a list row's incidents run through a date in its own month, at or before ${dataThroughMonth}; it has ${row.through}`);
  if (!(receipt.every(v => v === receipt[0]) && receipt[0] > 0 && receipt[0] <= 1))
    kindProblems.push(`${at}: a list row's receipt coverage is one share in (0, 1] three times over; it has ${JSON.stringify(receipt)}`);
  if (!(row.incCovMin > 0 && row.incCovMin < 1 && row.incCovMin <= row.incCov && row.incCov <= 1 && row.incCovMax === 1))
    kindProblems.push(`${at}: a list row's incident coverage is 0 < low <= best <= 1 with a low edge below 1 and a high edge of 1; it has ${JSON.stringify(incident)}`);
}
const listRows = fileRows.filter(r => !isComplete(r));
for (const row of listRows) {
  const later = fileRows.filter(r => r.helmer === row.helmer && r.month > row.month);
  if (later.length > 0) kindProblems.push(`${row.helmer} ${row.month}: a list row is its line's newest analysis row; ${later.map(r => r.month).join(", ")} follow it`);
}
if (fileRows.some(r => r.month > dataThroughMonth)) kindProblems.push(`rows after the data-through month ${dataThroughMonth}: ${fileRows.filter(r => r.month > dataThroughMonth).map(r => `${r.helmer} ${r.month}`).join(", ")}`);
if (!fileRows.some(isComplete)) kindProblems.push("no complete row at all");
assert.deepEqual(kindProblems, [],
  `Replicata: read every analysis row of data/vmt.js (NHTSA's receipt cutoff ${nhtsaCutoff}, data-through month ${dataThroughMonth}).
Expectata: each is complete (receipt and incident coverage (1, 1, 1), incidents through the cutoff, a month before ${dataThroughMonth}) or a list row (incidents through a date in its own month; one receipt share three times over; incident coverage with a low edge below 1 and a high edge of 1; its line's newest row); none after ${dataThroughMonth}.
Resultata: ${kindProblems.length} problems: ${kindProblems.slice(0, 8).join("; ")}.`);

// --- The rows the checks below read: the file's, and one synthetic list row ---
// The newest row of the first line with no list row, given a list row's
// coverage (half its miles through the 15th; incident coverage 0.9, low edge
// 0.7), so the checks of a list row run at a release no list covers too. Its
// receipt coverage is given a range (0.45 to 0.55), which no list row of the
// file has (the check above): the page still reads the triple's three values
// (vmt.js's coverage, coverage_min, coverage_max), and only a row whose
// three differ tells them apart in the compositions checked below, as the
// data-through month's estimated triple did until 2026-11-21.
const synthetic = vm.runInContext(`(() => {
  loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  const line = ADS_SERIES.find(h => vmtRows.filter(r => r.helmer === h).every(isCompleteRow));
  assert(line !== undefined, "quals/incident-coverage.qual.mjs: no line without a list row to make a synthetic one from");
  const month = vmtRows.filter(r => r.helmer === line).map(r => r.month).sort().at(-1);
  vmtRows = vmtRows.map(r => r.helmer === line && r.month === month
    ? {...r, coverage: 0.5, coverageMin: 0.45, coverageMax: 0.55, incCov: 0.9, incCovMin: 0.7, incCovMax: 1, through: month + "-15"} : r);
  return line + " " + month;
})()`, ctx);
const vmtData = JSON.parse(vm.runInContext(`JSON.stringify(vmtRows.map(${pick}))`, ctx));

// --- incCov ordering: min <= best <= max for all rows ---
for (const row of vmtData) {
  assert.ok(row.incCovMin <= row.incCov && row.incCov <= row.incCovMax,
    `Replicata: check incident_coverage ordering for ${row.helmer} ${row.month}.
Expectata: incCovMin <= incCov <= incCovMax.
Resultata: ${row.incCovMin} <= ${row.incCov} <= ${row.incCovMax}.`);
  assert.ok(row.incCov > 0 && row.incCov <= 1,
    `incCov must be in (0, 1] for ${row.helmer} ${row.month}`);
}

for (const row of vmtData) {
  assert.ok(row.coverageMin > 0 && row.coverageMin <= row.coverage &&
      row.coverage <= row.coverageMax && row.coverageMax <= 1,
    `Replicata: check coverage ordering for ${row.helmer} ${row.month}.
Expectata: 0 < coverage_min <= coverage <= coverage_max <= 1.
Resultata: ${row.coverageMin} <= ${row.coverage} <= ${row.coverageMax}.`);
}

// The partially received rows: the list rows (incCovMin < 1: a list can lack
// a crash its company files late) and the synthetic one. Until 2026-11-21
// these were NHTSA's data-through month, on its pooled rate-ratio triple,
// and each month inside a helmer's Monthly-report lag, on its 5-Day share.
const incompleteRows = vmtData.filter(r => r.incCovMin < 1);
const completeRows = vmtData.filter(r => r.incCovMin === 1);
assert.ok(incompleteRows.length === listRows.length + 1 && incompleteRows.some(r => `${r.helmer} ${r.month}` === synthetic),
  `Replicata: list the partially received rows among the rows the app holds (data/vmt.js's, with ${synthetic} made a synthetic list row).
Expectata: the file's ${listRows.length} list rows and the synthetic one.
Resultata: ${JSON.stringify(incompleteRows.map(r => `${r.helmer} ${r.month}`))}.`);

// All complete months must have incCov = incCovMin = incCovMax = 1
for (const row of completeRows) {
  assert.equal(row.incCov, 1,
    `incCov for complete month ${row.helmer} ${row.month} should be 1`);
  assert.equal(row.incCovMin, 1,
    `incident_coverage_min for complete month ${row.helmer} ${row.month} should be 1`);
  assert.equal(row.incCovMax, 1,
    `incident_coverage_max for complete month ${row.helmer} ${row.month} should be 1`);
}

// --- Effective VMT (monthSeriesData, on the rows set up above) ---

// --- Verify effective VMT computation for all rows ---

const allSeriesData = vm.runInContext(`
  (() => {
    const series = monthSeriesData();
    return series.points.flatMap(p =>
      Object.entries(p.helmers).filter(([, d]) => d !== null && d.vmtBest > 0).map(([name, d]) => ({
        helmer: name, month: p.month,
        vmtMin: d.vmtMin, vmtBest: d.vmtBest, vmtMax: d.vmtMax,
        vmtRawMin: d.vmtRawMin, vmtRawBest: d.vmtRawBest, vmtRawMax: d.vmtRawMax,
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

// --- The partially received rows (incCov < 1): each line's ---

{
  // Pick the first incomplete row per helmer
  const byHelmer = {};
  for (const row of incompleteRows) {
    if (!byHelmer[row.helmer]) byHelmer[row.helmer] = row;
  }

  for (const [helmer, raw] of Object.entries(byHelmer)) {
    const eff = allSeriesData.find(r => r.helmer === helmer && r.month === raw.month);
    if (!eff) continue;

    // The Monthly-track effective triple composes the receipt coverage and
    // the incident coverage exactly: best x best x best; the low edge
    // pairs vmt_min with the receipt BEST and incCovMin (incCovMin is the
    // bound CONDITIONAL on the receipt best — pairing it with the
    // receipt lo double-counted the receipt uncertainty until 2026-09-04);
    // the high edge pairs vmt_max with the receipt hi and incCovMax (= 1).
    // On a list row the three receipt values are one share.
    const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    assert.ok(
      near(eff.vmtMin, raw.vmtMin * raw.coverage * raw.incCovMin) &&
        near(eff.vmtBest, raw.vmtBest * raw.coverage * raw.incCov) &&
        near(eff.vmtMax, raw.vmtMax * raw.coverageMax * raw.incCovMax),
      `Replicata: recompose the effective VMT triple for ${helmer} ${raw.month} from the CSV row.
Expectata: [${raw.vmtMin * raw.coverage * raw.incCovMin}, ${raw.vmtBest * raw.coverage * raw.incCov}, ${raw.vmtMax * raw.coverageMax * raw.incCovMax}] = vmt_min x coverage x incCovMin, vmt x coverage x incCov, vmt_max x coverage_max x incCovMax.
Resultata: [${eff.vmtMin}, ${eff.vmtBest}, ${eff.vmtMax}].`);
    // The five-day-track (raw) triple takes the receipt coverage alone, each
    // edge its own: low with low, best with best, high with high (no qual
    // held its edges until 2026-11-21: audit 2026-11-20, A22).
    assert.ok(
      near(eff.vmtRawMin, raw.vmtMin * raw.coverageMin) &&
        near(eff.vmtRawBest, raw.vmtBest * raw.coverage) &&
        near(eff.vmtRawMax, raw.vmtMax * raw.coverageMax),
      `Replicata: recompose the five-day-track (raw) VMT triple for ${helmer} ${raw.month} from the CSV row.
Expectata: [${raw.vmtMin * raw.coverageMin}, ${raw.vmtBest * raw.coverage}, ${raw.vmtMax * raw.coverageMax}] = vmt_min x coverage_min, vmt x coverage, vmt_max x coverage_max.
Resultata: [${eff.vmtRawMin}, ${eff.vmtRawBest}, ${eff.vmtRawMax}].`);

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
        const rawRow = vmtRows.find(
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
// ride the Monthly track (Request No. 2). incident_coverage measures how
// much of a month's Monthly-track crashes a list is taken to hold (a company
// can file one late), so metrics whose qualifying incidents are
// STRUCTURALLY five-day-reportable must not have their effective VMT thinned
// by it: a list holds those through its date.

const fiveDayKeys = [...vm.runInContext(
  `METRIC_DEFS.filter(m => m.fiveDay === true).map(m => m.key).sort()`, ctx)];
assert.deepEqual(fiveDayKeys, ["airbag", "fatality", "hospitalization", "seriousInjury"],
  `Replicata: list METRIC_DEFS entries with fiveDay: true.
Expectata: exactly [airbag, fatality, hospitalization, seriousInjury] — the
metrics whose counting predicate GUARANTEES a Request No. 1.D five-day
trigger (airbag deployment, fatality, hospital transport). seriousInjury
joined 2026-09-04: every SSI+ severity the whitelist admits ("Serious",
"Serious W/ Hospitalization", "Fatality") is hosp:true in SEVERITY_INFO, so
SSI+ is a strict subset of the five-day hospitalization metric and cannot
have a smaller denominator than its superset. (If NHTSA ever files the
dictionary's "Serious Without Hospitalization", the severity whitelist
crashes and this is a human decision again.)
Resultata: ${JSON.stringify(fiveDayKeys)}.`);

for (const raw of incompleteRows) {
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
    `Replicata: render the ${raw.helmer} ${raw.month} fatality band, the month a partially received (list) row (incCov=${raw.incCov}).
Expectata: fatality is five-day-track (SGO Request No. 1.D.i), so its band
uses the receipt-coverage-scaled raw VMT triple without Monthly-track thinning.
Resultata: got [${bandCheck.fatalityGot.lo}, ${bandCheck.fatalityGot.hi}],
raw-VMT band [${bandCheck.fatalityRaw.lo}, ${bandCheck.fatalityRaw.hi}],
thinned band [${bandCheck.fatalityThinned.lo}, ${bandCheck.fatalityThinned.hi}].`);
  assert.ok(
    close(bandCheck.allGot.lo, bandCheck.allThinned.lo) &&
    close(bandCheck.allGot.hi, bandCheck.allThinned.hi),
    `Replicata: render the ${raw.helmer} ${raw.month} all-incidents band, the month a partially received (list) row.
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
      // The row is read, never assumed (until 2026-11-06 a missing one
      // stopped this qual on a TypeError naming nothing). assert is
      // crashla.js's, which throws its message with the details appended.
      const rows = monthlySummaryRows(series);
      const row = rows.find(r => r.helmer === ${JSON.stringify(raw.helmer)});
      assert(row !== undefined, "Replicata: build the full history's summary rows (monthlySummaryRows) and find ${raw.helmer}'s, the company of the incomplete month ${raw.month}.\\nExpectata: one, holding the fatality and All-incidents estimates whose VMT this check compares.\\nResultata: none; the rows are", rows.map(r => r.helmer));
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
Expectata: five-day metrics sum the receipt-coverage-scaled raw VMT (${windowCheck.rawSum}).
Resultata: ${windowCheck.fatalityVmtBest}.`);
  assert.ok(close(windowCheck.allVmtBest, windowCheck.thinnedSum),
    `Replicata: sum the ${raw.helmer} window's all-incidents effective VMT.
Expectata: Monthly-track metrics keep the incCov-thinned VMT (${windowCheck.thinnedSum}).
Resultata: ${windowCheck.allVmtBest}.`);
  assert.ok(windowCheck.rawSum > windowCheck.thinnedSum,
    `Replicata: compare raw vs thinned window VMT sums with incCov<1 present.
Expectata: rawSum > thinnedSum (otherwise this qual isn't exercising the split).
Resultata: raw=${windowCheck.rawSum}, thinned=${windowCheck.thinnedSum}.`);

}

// The page refuses rows of any other kind, loudly (anti-Postel), rather than
// trust the file. Each case below differs in one thing from a set of rows the
// page accepts: data/vmt.js's rows with every list row made complete (a
// release no list covers), on which one line's rows are then changed.
// (Until 2026-11-21 an assert in monthSeriesData tied partial receipt
// coverage to the data-through month, and this qual looked for its text.)
const refusals = JSON.parse(vm.runInContext(`(() => {
  const file = parseVmtCsv(VMT_CSV_TEXT);
  const attempt = rows => { const kept = vmtRows; vmtRows = rows; try { checkGhostVmtRows(); return "accepted"; } catch (e) { return String(e.message).slice(0, 200); } finally { vmtRows = kept; } };
  const complete = {coverage: 1, coverageMin: 1, coverageMax: 1, incCov: 1, incCovMin: 1, incCovMax: 1, through: NHTSA_DATA_THROUGH_DATE};
  const partial = {coverage: 0.5, coverageMin: 0.5, coverageMax: 0.5, incCov: 0.9, incCovMin: 0.7, incCovMax: 1};
  const none = file.map(r => ({...r, ...complete}));
  const line = ADS_SERIES[0], other = ADS_SERIES.at(-1);
  const monthsOf = h => none.filter(r => r.helmer === h).map(r => r.month).sort();
  const months = monthsOf(line);
  const withRow = (rows, h, month, patch) => rows.map(r => r.helmer === h && r.month === month ? {...r, ...patch} : r);
  const listRow = month => ({...partial, through: month + "-15"});
  return JSON.stringify({
    line, other,
    file: attempt(file),
    noListRow: attempt(none),
    listRowNewest: attempt(withRow(none, line, months.at(-1), listRow(months.at(-1)))),
    partialAfterMonth: attempt(withRow(none, line, months.at(-1), listRow(monthAfter(months.at(-1))))),
    partialBeforeMonth: attempt(withRow(none, line, months.at(-1), listRow(months.at(-2)))),
    partialNotNewest: attempt(withRow(none, line, months.at(-3), listRow(months.at(-3)))),
    completeOffCutoff: attempt(withRow(none, line, months.at(-1), {through: months.at(-1) + "-14"})),
    twoListMonths: attempt(withRow(withRow(none, line, months.at(-1), listRow(months.at(-1))), other, monthsOf(other).at(-2), listRow(monthsOf(other).at(-2)))),
  });
})()`, ctx));
const refused = ["partialAfterMonth", "partialBeforeMonth", "partialNotNewest", "completeOffCutoff", "twoListMonths"];
assert.ok(refusals.file === "accepted" && refusals.noListRow === "accepted" && refusals.listRowNewest === "accepted" && refused.every(k => refusals[k] !== "accepted"),
  `Replicata: call the page's checkGhostVmtRows() on data/vmt.js's rows (file); on them with every list row made complete (noListRow); on those with ${refusals.line}'s newest row made a list row (listRowNewest); and on those with that row partial yet through a date in the month after its own, as NHTSA's cutoff is for the month before the data-through month, or in the month before (partialAfterMonth, partialBeforeMonth), with a partial row that is not ${refusals.line}'s newest (partialNotNewest), with its newest row complete yet through another date than NHTSA's cutoff (completeOffCutoff), and with list rows in two different months (twoListMonths: ${refusals.line}'s newest and ${refusals.other}'s second newest).
Expectata: the first three accepted, each of the other five refused.
Resultata: ${JSON.stringify(refusals)}.`);
// No release-date inference remains: the old NHTSA_MODIFIED_DATE >=
// month-end + 5 assert passed vacuously (the file's modification date is a
// month after its receipt cutoff) and was retired 2026-08-28.
assert.doesNotMatch(appScript, /fiveDayDue/,
  `Replicata: grep crashla.js for the retired five-day-due inference.
Expectata: absent.
Resultata: fiveDayDue remains.`);

console.log(`qual pass: every analysis row of data/vmt.js is complete or a list row (${listRows.map(r => `${r.helmer} ${r.month} through ${r.through}`).join(", ") || "no list row"}); a list row's receipt coverage and incident coverage select metric-specific effective VMT (checked on those and on a synthetic list row, ${synthetic}); the page refuses rows of any other kind`);

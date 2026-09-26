import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const node of nodes) node.parentNode = this;
    this.children = [...nodes];
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] || []), fn];
  }

  setAttribute(k, v) { this[k] = v; }

  querySelector() { return new ElementStub("queried"); }

  // Mirror the browser: after setting textContent, innerHTML reads back as
  // the &/</> -escaped text. escHtml round-trips through a div this way.
  set textContent(v) {
    this._textContent = String(v);
    this._innerHTML = this._textContent
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  get textContent() { return this._textContent; }

  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

const nodeById = new Map();
const getNode = id => {
  if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
  return nodeById.get(id);
};


const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

vm.runInContext(`
incidents = INCIDENT_DATA;
vmtRows = parseVmtCsv(VMT_CSV_TEXT);
`, ctx);

const metrics = vm.runInContext(`
(() => {
  const series = monthSeriesData();
  const byMonth = Object.fromEntries(series.points.map(p => [p.month, p]));
  const expectedTotalByHelmer = Object.fromEntries(
    ADS_HELMERS.map(helmer => [
      helmer,
      (() => {
        const helmerMonths = new Set(
          series.points
            .filter(p => p.helmers[helmer] !== null)
            .map(p => p.month),
        );
        return INCIDENT_DATA.filter(inc =>
          inc.helmer === helmer && helmerMonths.has(monthKeyFromIncidentLabel(inc.date))).length;
      })(),
    ]),
  );
  const totalByHelmer = Object.fromEntries(
    ADS_HELMERS.map(helmer => [
      helmer,
      series.points.reduce((sum, p) => sum + (p.helmers[helmer] ? p.helmers[helmer].incidents.total : 0), 0),
    ]),
  );
  selectedMetricKey = "all";
  buildMonthlyViews();
  return {
    months: series.months,
    expectedTotalByHelmer,
    totalByHelmer,
    janTeslaBins: byMonth["2026-01"].helmers.Tesla.incidents.speeds,
    janTeslaNonstationary: nonstationaryIncidentCount(byMonth["2026-01"].helmers.Tesla.incidents.speeds),
    janTeslaRoadwayNonstationary: byMonth["2026-01"].helmers.Tesla.incidents.roadwayNonstationary,
    summaryRows: monthlySummaryRows(series),
    airbagByHelmerMonth: Object.fromEntries(
      ADS_HELMERS.map(helmer => [
        helmer,
        series.points.filter(p => p.helmers[helmer] !== null).map(p => p.helmers[helmer].incidents.airbag),
      ]),
    ),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    mpiHeading: document.getElementById("mpi-heading").textContent,
    chartMpiAll: document.getElementById("chart-mpi-all").innerHTML,
    legendMpiHelmers: document.getElementById("month-legend-mpi-helmers").innerHTML,
    legendMpiLines: document.getElementById("month-legend-mpi-lines").innerHTML,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(metrics));

assert(
  plain.months.includes("2025-06") && plain.months.includes("2026-02"),
  `Replicata: aggregate month series from inline incident data + inline VMT sheet CSV.
Expectata: month axis includes the NHTSA window (2025-06 through at least 2026-02; it runs to the data-through month); may extend earlier with Waymo-only VMT.
Resultata: month axis was ${JSON.stringify(plain.months)}.`,
);

assert.deepEqual(
  plain.totalByHelmer,
  plain.expectedTotalByHelmer,
  `Replicata: sum monthly incident totals for each ADS helmer.
Expectata: month aggregation preserves totals from the raw incident data within the VMT window.
Resultata: expected=${JSON.stringify(plain.expectedTotalByHelmer)} actual=${JSON.stringify(plain.totalByHelmer)}.`,
);

// Re-pinned 2026-09-26: four 1-10 mph -> three, when the teleoperator-driven
// 13781-14043 (9 mph into a construction barricade) left scope
// (teleop-scope.qual).
assert.deepEqual(
  plain.janTeslaBins,
  { "0": 1, "31+": 0, "11-30": 0, "1-10": 3, unknown: 0 },
  `Replicata: inspect January 2026 Tesla speed bins.
Expectata: bins reflect one 0-mph incident and three 1-10 mph incidents.
Resultata: bins were ${JSON.stringify(plain.janTeslaBins)}.`,
);

assert.equal(
  plain.janTeslaNonstationary,
  3, // re-pinned 2026-09-26 (4 -> 3) with the bins above
  `Replicata: compute January 2026 Tesla nonstationary monthly incident count.
Expectata: only the three 1-10 mph incidents count toward the nonstationary series.
Resultata: nonstationary count was ${JSON.stringify(plain.janTeslaNonstationary)}.`,
);

assert.equal(
  plain.janTeslaRoadwayNonstationary,
  1, // re-pinned 2026-09-26 (2 -> 1): the removed 13781-14043 was on a street
  `Replicata: compute January 2026 Tesla nonstationary-roadway monthly incident count.
Expectata: one January Tesla incident is both nonstationary and not in a parking lot.
Resultata: nonstationary-roadway count was ${JSON.stringify(plain.janTeslaRoadwayNonstationary)}.`,
);

const summaryByHelmer = Object.fromEntries(
  plain.summaryRows.map(row => [row.helmer, row]),
);
assert.ok(
  summaryByHelmer.Tesla && summaryByHelmer.Waymo && summaryByHelmer.Zoox,
  `Replicata: compute monthly summary rows.
Expectata: summary rows include Tesla, Waymo, and Zoox.
Resultata: summary rows were ${JSON.stringify(plain.summaryRows)}.`,
);
// Tesla summary counts must equal the raw in-window incident counts —
// integers, with no coverage scaling — rather than a hardcoded snapshot that
// goes stale every NHTSA refresh. Recompute the expected counts by a flat
// filter over INCIDENT_DATA (independent of the summary's month-by-month
// aggregation path), so a scaling bug would surface as a mismatch or a
// non-integer.
const expTesla = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const series = monthSeriesData();
  const teslaMonths = new Set(
    series.points.filter(p => p.helmers.Tesla !== null).map(p => p.month));
  const inWin = INCIDENT_DATA.filter(i =>
    i.helmer === "Tesla" && teslaMonths.has(monthKeyFromIncidentLabel(i.date)));
  return {
    total: inWin.length,
    nonstationary: inWin.filter(i => speedBinForIncident(i.speed) !== "0").length,
    roadway: inWin.filter(i =>
      speedBinForIncident(i.speed) !== "0" && i.road !== "Parking Lot").length,
  };
})()
`, ctx)));
const teslaSummary = summaryByHelmer.Tesla;
assert.ok(
  Number.isInteger(teslaSummary.incTotal) &&
    Number.isInteger(teslaSummary.incNonstationary) &&
    Number.isInteger(teslaSummary.incRoadwayNonstationary) &&
    teslaSummary.incTotal === expTesla.total &&
    teslaSummary.incNonstationary === expTesla.nonstationary &&
    teslaSummary.incRoadwayNonstationary === expTesla.roadway &&
    teslaSummary.incRoadwayNonstationary <= teslaSummary.incNonstationary &&
    teslaSummary.incNonstationary <= teslaSummary.incTotal,
  `Replicata: compute Tesla summary incident totals and compare to a flat in-window count of INCIDENT_DATA.
Expectata: integer, unscaled counts matching the raw data (total=${expTesla.total}, nonstationary=${expTesla.nonstationary}, nonstationary-roadway=${expTesla.roadway}), with roadway <= nonstationary <= total.
Resultata: Tesla summary was ${JSON.stringify({incTotal: teslaSummary.incTotal, incNonstationary: teslaSummary.incNonstationary, incRoadwayNonstationary: teslaSummary.incRoadwayNonstationary})}.`,
);
// De-magicked: recompute the expected per-helmer airbag count from INCIDENT_DATA
// (airbagAny is any-vehicle since the archive SV|CP fix), so this self-updates
// instead of going stale on a hardcoded range.
const expAirbag = h => vm.runInContext(
  `INCIDENT_DATA.filter(r => r.helmer === ${JSON.stringify(h)} && r.airbagAny).length`, ctx);
assert.ok(
  summaryByHelmer.Waymo.incAirbag === expAirbag("Waymo") &&
    summaryByHelmer.Tesla.incAirbag === expAirbag("Tesla") &&
    summaryByHelmer.Zoox.incAirbag === expAirbag("Zoox"),
  `Replicata: compare per-helmer incAirbag to a flat airbagAny count of INCIDENT_DATA.
Expectata: integer, unscaled airbag counts matching the raw data (Waymo=${expAirbag("Waymo")}, Tesla=${expAirbag("Tesla")}, Zoox=${expAirbag("Zoox")}).
Resultata: Waymo=${summaryByHelmer.Waymo.incAirbag} Tesla=${summaryByHelmer.Tesla.incAirbag} Zoox=${summaryByHelmer.Zoox.incAirbag}.`,
);

// Verify airbag field exists in incident data and the monthly series correctly
// disaggregates it: Waymo's total airbag count across months should equal incAirbag.
const waymoAirbagMonthly = plain.airbagByHelmerMonth.Waymo;
const waymoAirbagSum = waymoAirbagMonthly.reduce((a, b) => a + b, 0);
assert.equal(
  waymoAirbagSum,
  summaryByHelmer.Waymo.incAirbag,
  `Replicata: sum per-month Waymo airbag counts.
Expectata: per-month sum equals summary incAirbag (${summaryByHelmer.Waymo.incAirbag}).
Resultata: monthly sum was ${waymoAirbagSum}, monthly breakdown was ${JSON.stringify(waymoAirbagMonthly)}.`,
);

// Verify incident data contains airbagAny field (boolean)
const airbagFieldCheck = vm.runInContext(`
  INCIDENT_DATA.every(inc => typeof inc.airbagAny === "boolean")
`, ctx);
assert.ok(
  airbagFieldCheck,
  `Replicata: check airbagAny field type in all incident records.
Expectata: every incident has a boolean airbagAny field.
Resultata: some incidents are missing or have non-boolean airbagAny.`,
);

// Verify airbag appears in summary cards when rendered (all metrics enabled)
assert.ok(
  plain.summaryCardHtml.includes("Airbag deployment") &&
    plain.summaryCardHtml.includes("incAirbag") === false,
  `Replicata: render summary cards with all metrics enabled.
Expectata: summary cards include "Airbag deployment" label (not raw field name).
Resultata: card HTML snippet: ${JSON.stringify(plain.summaryCardHtml.slice(0, 200))}.`,
);

// Verify human benchmark for airbag exists and has correct structure
const humanAirbag = vm.runInContext("METRIC_DEFS.find(m => m.key === 'airbag').humanMPI.HumansAV", ctx);
assert.ok(
  humanAirbag && humanAirbag.lo > 0 && humanAirbag.hi > humanAirbag.lo &&
    humanAirbag.lo >= 300000 && humanAirbag.hi <= 900000,
  `Replicata: inspect humanMPI for airbag metric.
Expectata: airbag human benchmark lo/hi within [300k, 900k] (hub per-city span
1.19\u20132.99 IPMM, repinned 2026-08-22; human-benchmark-provenance.qual pins
the exact edges).
Resultata: ${JSON.stringify(humanAirbag)}.`,
);

// Verify chart renders line data with standard stroke-width:2
assert.ok(
  plain.chartMpiAll.includes("stroke-width:2"),
  `Replicata: render all-helmer MPI chart with selected metric.
Expectata: chart includes stroke-width:2 (standard line width).
Resultata: stroke-width:2 not found in rendered chart.`,
);

// Serious injury (SSI+) assertions. De-magicked 2026-09-25 (human-approved):
// the old fixed "Waymo 1-10" ceiling sat at exactly 10 and broke on the next
// legitimate serious injury. The expected count is recomputed from
// INCIDENT_DATA with the SSI+ severity strings spelled out here, independent
// of the app's SEVERITY_INFO, so counting Moderate W/ Hosp (KABCO B/C) as
// SSI+ still fails, and a new severity string fails until a human classifies it.
const SSI_STRINGS = ["Serious", "Serious W/ Hospitalization", "Fatality"];
const expSsi = h => vm.runInContext(
  `INCIDENT_DATA.filter(r => r.helmer === ${JSON.stringify(h)} && ${JSON.stringify(SSI_STRINGS)}.includes(r.severity)).length`, ctx);
assert.ok(
  expSsi("Waymo") >= 1 &&
    summaryByHelmer.Waymo.incSeriousInjury === expSsi("Waymo") &&
    summaryByHelmer.Tesla.incSeriousInjury === expSsi("Tesla") &&
    summaryByHelmer.Zoox.incSeriousInjury === expSsi("Zoox"),
  `Replicata: compute serious injury (SSI+) incident counts per helmer and compare to a flat count of INCIDENT_DATA.
Expectata: counts of Serious / Serious W/ Hospitalization / Fatality incidents (Moderate W/ Hosp is KABCO B/C, not SSI+): Waymo=${expSsi("Waymo")} (at least 1), Tesla=${expSsi("Tesla")}, Zoox=${expSsi("Zoox")}.
Resultata: Waymo=${summaryByHelmer.Waymo.incSeriousInjury} Tesla=${summaryByHelmer.Tesla.incSeriousInjury} Zoox=${summaryByHelmer.Zoox.incSeriousInjury}.`,
);

const moderateSeverityCheck = vm.runInContext(`
  (() => {
    const inc = INCIDENT_DATA.find(r => r.reportId === "30270-11016");
    return {
      exists: inc !== undefined,
      severity: inc && inc.severity,
      injury: inc ? Number(INJURY_SEVERITIES.has(inc.severity)) : null,
      hospitalization: inc ? Number(HOSPITALIZATION_SEVERITIES.has(inc.severity)) : null,
      seriousInjury: inc ? Number(SERIOUS_INJURY_SEVERITIES.has(inc.severity)) : null,
    };
  })()
`, ctx);
assert.ok(
  moderateSeverityCheck.exists === true &&
    moderateSeverityCheck.severity === "Moderate" &&
    moderateSeverityCheck.injury === 1 &&
    moderateSeverityCheck.hospitalization === 0 &&
    moderateSeverityCheck.seriousInjury === 0,
  `Replicata: classify Waymo report 30270-11016 with severity "Moderate".
Expectata: bare "Moderate" counts as injury but not hospitalization or serious injury.
Resultata: classification was ${JSON.stringify(moderateSeverityCheck)}.`,
);

assert.ok(
  plain.summaryCardHtml.includes("Serious injury+"),
  `Replicata: render summary cards with all metrics enabled.
Expectata: summary cards include "Serious injury+" label.
Resultata: label not found in card HTML.`,
);

const humanSsi = vm.runInContext("METRIC_DEFS.find(m => m.key === 'seriousInjury').humanMPI.HumansAV", ctx);
assert.ok(
  humanSsi && humanSsi.lo >= 1800000 && humanSsi.hi <= 12000000 && humanSsi.lo < humanSsi.hi,
  `Replicata: inspect humanMPI for seriousInjury metric.
Expectata: SSI+ human benchmark within [1.8M, 12M], spanning the Waymo hub per-city range ~2.56M (SF 0.391 IPMM) to ~9.62M (Phoenix 0.104 IPMM), blended ~0.213 (repinned 2026-09-25, thru Jun 2026; human-benchmark-provenance.qual pins the exact edges).
Resultata: ${JSON.stringify(humanSsi)}.`,
);

// Verify METRIC_DEFS refactor: all metrics have required fields
const metricDefCheck = vm.runInContext(`
  METRIC_DEFS.every(m =>
    m.key && m.label && m.cardLabel && m.incField &&
    typeof m.defaultEnabled === "boolean" && typeof m.primary === "boolean" &&
    typeof m.countFn === "function")
`, ctx);
assert.ok(
  metricDefCheck,
  `Replicata: validate METRIC_DEFS structure.
Expectata: every metric def has key, label, cardLabel, incField, defaultEnabled, primary, countFn.
Resultata: some metric defs are missing required fields.`,
);

// Verify both human cohorts render in the chart (two golds, enabled by default)
assert.ok(
  plain.chartMpiAll.includes("#c9a800"),
  `Replicata: render chart with default settings (Humans enabled by default).
Expectata: chart includes gold (#c9a800) Humans helmer lines/bands.
Resultata: Humans color not found in default chart render.`,
);

const renderedAll = plain.chartMpiAll;
assert.ok(
  renderedAll.includes("<svg") &&
    !renderedAll.includes("<h3>") &&
    renderedAll.includes("month-mpi-all-line") &&
    renderedAll.includes("stroke-width:2") &&
    renderedAll.includes("Miles Per Incident (MPI)"),
  `Replicata: render cross-helmer miles-per-incident chart.
Expectata: chart body has all-helmer line traces, month labels, and the MPI axis, with the title in the section header (not an <h3> in the body).
Resultata: rendered snippets were ${JSON.stringify(renderedAll.slice(0, 400))}.`,
);

// The cross-helmer chart title lives in the section header (#mpi-heading), set
// by renderWindowedViews, so it stays visible when the section is collapsed.
assert.equal(
  plain.mpiHeading,
  "Miles per any incident over time",
  `Replicata: read the #mpi-heading section header after buildMonthlyViews with the all-incident metric.
Expectata: header reads "Miles per any incident over time".
Resultata: header was ${JSON.stringify(plain.mpiHeading)}.`,
);

const airbagHeading = vm.runInContext(`
  (() => {
    selectedMetricKey = "airbag";
    buildMonthlyViews();
    return document.getElementById("mpi-heading").textContent;
  })()
`, ctx);
assert.equal(
  airbagHeading,
  "Miles per airbag-deploying incident over time",
  `Replicata: select the airbag metric and rebuild; read the #mpi-heading header.
Expectata: header reuses the exact selected metric label.
Resultata: header was ${JSON.stringify(airbagHeading)}.`,
);

// k=0 months have no point estimate (MLE = miles/0 = ∞); they render a "≥ lo"
// up-arrow marker (with a "(0 incidents)" tooltip), not a finite dot, and are
// never skipped (e.g. a month whose incidents are all 0% at-fault).
const jeffreysZero = vm.runInContext(`
  (() => {
    const savedMetric = selectedMetricKey;
    const savedEnabled = {...monthHelmerEnabled};
    selectedMetricKey = "atfault";
    for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
    const series = monthSeriesData();
    let zeroMonths = 0;
    for (const p of series.points) {
      for (const h of ADS_HELMERS) {
        const e = p.helmers[h];
        if (e === null) continue;
        const mpi = e.mpiByMetric.atfault;
        if (mpi !== null && mpi.incidentCount === 0) zeroMonths++;
      }
    }
    const html = renderAllHelmersMpiChart(series);
    selectedMetricKey = savedMetric;
    monthHelmerEnabled = savedEnabled;
    return {zeroMonths, zeroDotTips: (html.match(/\\(0 incidents\\)/g) || []).length};
  })()
`, ctx);
assert.ok(
  jeffreysZero.zeroMonths > 0,
  `Replicata: count helmer-months whose at-fault incident count is exactly 0.
Expectata: at least one such month exists in the data (else this qual tests nothing).
Resultata: zeroMonths was ${jeffreysZero.zeroMonths}.`,
);
assert.equal(
  jeffreysZero.zeroDotTips,
  jeffreysZero.zeroMonths,
  `Replicata: render the cross-helmer at-fault MPI chart with all helmers enabled.
Expectata: every k=0 helmer-month renders a marker with a "(0 incidents)" tooltip (up-arrow, not skipped).
Resultata: ${jeffreysZero.zeroDotTips} zero-incident tooltips for ${jeffreysZero.zeroMonths} k=0 helmer-months.`,
);

// Error bars are clamped like every other layer, never clipped away.
// Replicates the bug where deselecting Waymo squished Tesla's k=0 at-fault
// dots against the top of the plot and their error bars vanished entirely
// (bars used raw mapY + clip-path while dots/lines/bands used clampY).
const clampedBars = vm.runInContext(`
  (() => {
    const savedMetric = selectedMetricKey;
    const savedEnabled = {...monthHelmerEnabled};
    selectedMetricKey = "atfault";
    monthHelmerEnabled = {HumansAV: true, HumansUS: false, Tesla: true, Waymo: false, Zoox: false};
    const html = renderAllHelmersMpiChart(monthSeriesData());
    selectedMetricKey = savedMetric;
    monthHelmerEnabled = savedEnabled;
    const svgH = Number(/viewBox="0 0 \\d+ (\\d+)"/.exec(html)[1]);
    const dotCount = (html.match(/class="month-dot"/g) || []).length;
    const barYs = [...html.matchAll(/class="month-err" x1="[\\d.]+" y1="(-?[\\d.]+)" x2="[\\d.]+" y2="(-?[\\d.]+)"/g)]
      .map(m => [Number(m[1]), Number(m[2])]);
    return {svgH, dotCount, barCount: barYs.length,
      outOfPlot: barYs.filter(([y1, y2]) => y1 < 0 || y1 > svgH || y2 < 0 || y2 > svgH).length};
  })()
`, ctx);
assert.ok(
  clampedBars.dotCount > 0 && clampedBars.barCount === clampedBars.dotCount,
  `Replicata: render the at-fault MPI chart with Waymo deselected (Tesla + HumansAV only).
Expectata: exactly one error bar per rendered dot, including Tesla's k=0 months above the y-range.
Resultata: ${clampedBars.barCount} bars for ${clampedBars.dotCount} dots.`,
);
assert.equal(
  clampedBars.outOfPlot,
  0,
  `Replicata: inspect error-bar y-coordinates in the Waymo-deselected at-fault chart.
Expectata: all bar endpoints clamped inside the SVG (no bars rendered off-plot where the clip would hide them).
Resultata: ${clampedBars.outOfPlot} of ${clampedBars.barCount} bars have endpoints outside [0, ${clampedBars.svgH}].`,
);

// When every month is k=0 (no events), each renders a finite HOLLOW median dot
// (prior-only), and the y-range scales to those medians. Replicates the bug where
// Tesla-only + fatality left yMax at its init value of 1 and every error bar
// collapsed — now the medians anchor the axis so the wide-CI whiskers stay visible.
const allZeroK = vm.runInContext(`
  (() => {
    const savedMetric = selectedMetricKey;
    const savedEnabled = {...monthHelmerEnabled};
    selectedMetricKey = "fatality";
    monthHelmerEnabled = {HumansAV: false, HumansUS: false, Tesla: true, Waymo: false, Zoox: false};
    const html = renderAllHelmersMpiChart(monthSeriesData());
    selectedMetricKey = savedMetric;
    monthHelmerEnabled = savedEnabled;
    const svgH = Number(/viewBox="0 0 \\d+ (\\d+)"/.exec(html)[1]);
    const hollowYs = [...html.matchAll(/class="month-dot" cx="[\\d.]+" cy="([\\d.]+)" r="[\\d.]+" style="fill:none;stroke:/g)]
      .map(m => Number(m[1]));
    const barLens = [...html.matchAll(/class="month-err" x1="[\\d.]+" y1="([\\d.]+)" x2="[\\d.]+" y2="([\\d.]+)"/g)]
      .map(m => Math.abs(Number(m[2]) - Number(m[1])));
    return {svgH, hollowYs, barLens};
  })()
`, ctx);
assert.ok(
  allZeroK.hollowYs.length > 0 && allZeroK.hollowYs.every(y => y > 0 && y < allZeroK.svgH),
  `Replicata: render the fatality MPI chart with only Tesla enabled (k=0 every month).
Expectata: every k=0 month is a finite hollow median dot, on-scale (not a ceiling-pinned arrow).
Resultata: hollow dot y values were ${JSON.stringify(allZeroK.hollowYs)} (svgH ${allZeroK.svgH}).`,
);
assert.ok(
  allZeroK.barLens.length === allZeroK.hollowYs.length && allZeroK.barLens.every(len => len > 5),
  `Replicata: inspect error bars in the Tesla-only fatality chart.
Expectata: one non-degenerate CI whisker per dot (k=0 CIs are wide, so whiskers span well over 5px).
Resultata: bar lengths were ${JSON.stringify(allZeroK.barLens.map(Math.round))}.`,
);

// A PARTIAL month that HAS incidents (k>0) is not a k=0 case: it keeps a finite
// MLE point — rendered as a dot, not a "≥ lo" up-arrow — pessimistically lowered
// by the incomplete reporting (incident_coverage shrinks the effective VMT).
// Guards the case that arrives the moment NHTSA partially reports a month that
// had crashes (which is when the partial-coverage path actually fires for k>0).
const partialK = vm.runInContext(`
  (() => {
    const savedMetric = selectedMetricKey;
    const savedEnabled = {...monthHelmerEnabled};
    const savedRows = vmtRows;
    selectedMetricKey = "all";
    monthHelmerEnabled = {HumansAV:false, HumansUS:false, HumansRideshare:false, Tesla:true, Waymo:false, Zoox:false};
    // First Tesla month with k>0 for "all" (derived, so it self-updates).
    const fullSeries = monthSeriesData();
    const tgt = fullSeries.points.find(p =>
      p.helmers.Tesla && p.helmers.Tesla.mpiByMetric.all.incidentCount > 0).month;
    const fullK = fullSeries.points.find(p => p.month === tgt).helmers.Tesla.mpiByMetric.all;
    const fullHtml = renderAllHelmersMpiChart(fullSeries);
    // Mark that month as only ~40% reported and re-render.
    vmtRows = parseVmtCsv(VMT_CSV_TEXT).map(r =>
      (r.helmer === "Tesla" && r.month === tgt)
        ? {...r, incCov: 0.4, incCovMin: 0.2, incCovMax: 1.0} : r);
    const partSeries = monthSeriesData();
    const partK = partSeries.points.find(p => p.month === tgt).helmers.Tesla.mpiByMetric.all;
    const partHtml = renderAllHelmersMpiChart(partSeries);
    vmtRows = savedRows; selectedMetricKey = savedMetric; monthHelmerEnabled = savedEnabled;
    const arrows = h => (h.match(/path class="month-dot"/g) || []).length;
    const dots = h => (h.match(/circle class="month-dot"/g) || []).length;
    return {
      tgt, k: partK.incidentCount, finite: Number.isFinite(partK.mpiBest),
      partMpi: partK.mpiBest, fullMpi: fullK.mpiBest,
      glyphsUnchanged: arrows(partHtml) === arrows(fullHtml) && dots(partHtml) === dots(fullHtml),
    };
  })()
`, ctx);
assert.ok(
  partialK.k > 0 && partialK.finite,
  `Replicata: mark the first k>0 Tesla month (${partialK.tgt}) as partially reported (incCov 0.4) and read its point.
Expectata: k>0 ⇒ a finite MLE point (an up-arrow is reserved for k=0, where there is no point).
Resultata: k=${partialK.k}, finite=${partialK.finite}.`,
);
assert.ok(
  partialK.glyphsUnchanged,
  `Replicata: compare up-arrow/dot glyph counts for ${partialK.tgt} partially-reported vs fully-reported.
Expectata: unchanged — a partially-reported k>0 month stays a dot, never flips to a k=0 up-arrow.
Resultata: glyphsUnchanged was ${partialK.glyphsUnchanged}.`,
);
assert.ok(
  partialK.partMpi < partialK.fullMpi,
  `Replicata: compare the partial-month MLE to the same month fully reported.
Expectata: incomplete reporting shrinks the effective VMT, so the partial-month MLE is lower (pessimistic).
Resultata: partial=${Math.round(partialK.partMpi)}, full=${Math.round(partialK.fullMpi)}.`,
);

assert.ok(
  appScript.includes("95% CI"),
  `Replicata: inspect the MPI / distribution datapoint tooltip source.
Expectata: credible intervals are labeled "95% CI".
Resultata: "95% CI" label missing from source.`,
);

assert.ok(
  appScript.includes("Monthly VMT") && appScript.includes("Cumulative VMT"),
  `Replicata: inspect source for the VMT view toggle labels.
Expectata: the per-helmer VMT charts offer Monthly VMT and Cumulative VMT views.
Resultata: expected labels missing from source.`,
);

// The grid now respects the helmer checkboxes (Zoox is off by default), so
// enable all ADS helmers to exercise every per-helmer chart.
const rendered = vm.runInContext(`
(() => {
  const saved = {...monthHelmerEnabled};
  for (const d of ADS_HELMERS) monthHelmerEnabled[d] = true;
  renderWindowedViews();
  const html = document.getElementById("chart-helmer-series").innerHTML;
  Object.assign(monthHelmerEnabled, saved);
  renderWindowedViews();
  return html;
})()
`, ctx);
assert.ok(
  rendered.includes("<svg") &&
    rendered.includes("Tesla") &&
    rendered.includes("Waymo") &&
    rendered.includes("Zoox") &&
    rendered.includes("data-tip=") &&
    rendered.includes("month-vmt-line") &&
    rendered.includes("month-dot") &&
    rendered.includes("Vehicle Miles Traveled (VMT)") &&
    rendered.includes("month-err") &&
    rendered.includes("month-axis") &&
    !rendered.includes("month-inc-bar"),
  `Replicata: render monthly charts per helmer.
Expectata: each helmer chart is VMT-only — a left VMT axis, a VMT line with dots and error bars, and no incident bars.
Resultata: rendered snippets were ${JSON.stringify(rendered.slice(0, 400))}.`,
);


// The metric selector is a dropdown: a "Miles per ___ incident" label wrapping
// one <option value="key">blank</option> per metric. Derived from METRIC_DEFS
// so this self-updates as metrics change.
const metricOptions = vm.runInContext(`METRIC_DEFS.map(m => ({key: m.key, blank: m.blank}))`, ctx);
const allMetricOptionsPresent = metricOptions.length === 10 && metricOptions.every(o =>
  plain.legendMpiLines.includes(`value="${o.key}"`) &&
  plain.legendMpiLines.includes(`>${o.blank}</option>`));

assert.ok(
  plain.legendMpiHelmers.includes("Tesla") &&
  plain.legendMpiHelmers.includes("Waymo") &&
    plain.legendMpiHelmers.includes("Zoox") &&
  plain.legendMpiHelmers.includes("Humans (AV cities)") &&
    plain.legendMpiHelmers.includes("Humans (US average)") &&
  plain.legendMpiHelmers.includes("type=\"checkbox\"") &&
  plain.legendMpiLines.includes("<select id=\"month-metric-select\"") &&
  plain.legendMpiLines.includes("Miles per") &&
  plain.legendMpiLines.includes("incident</label>") &&
  allMetricOptionsPresent,
  `Replicata: render monthly legends.
Expectata: helmer legend has colors+checkboxes; the metric selector is a "Miles per ___ incident" dropdown with one option per metric.
Resultata: mpi-helmers=${JSON.stringify(plain.legendMpiHelmers)}, mpi-lines=${JSON.stringify(plain.legendMpiLines)}.`,
);

// --- 2026-09-26 render pins ---
// (a) An ADS helmer with no VMT rows in the window (Tesla and Zoox on the
// first month, 2021-07) is not a human cohort: its card must not fall into
// the "Benchmarks:" template (it rendered a dangling label with an empty
// list), and must say it has no miles in the window instead.
const firstMonthCards = vm.runInContext(`renderMpiSummaryCards(sliceSeries(monthSeriesData(), 0, 0))`, ctx);
const cardOf = (html, helmer) => html.split('class="mpi-card-helmer">')
  .find(s => s.startsWith(helmer + "<")) || "";
for (const helmer of ["Tesla", "Zoox"]) {
  const card = cardOf(firstMonthCards, helmer);
  assert.ok(card.length > 0 && !card.includes("Benchmarks:") && card.includes("Nulla milia"),
    `Replicata: render the summary cards on the 2021-07 window (no ${helmer} VMT) and read the ${helmer} card.
Expectata: no "Benchmarks:" template (that is the human-cohort layout) and a no-miles line ("Nulla milia ...").
Resultata: ${JSON.stringify(card.slice(0, 200))}.`);
}
assert.ok(cardOf(firstMonthCards, "Humans (AV cities)").includes("Benchmarks:"),
  "the human card keeps its Benchmarks: line on the 2021-07 window");
// (b) The incomplete-reporting "?" marker is a property of the MONTH (the
// receipt and incident-coverage factors are pooled), so the MPI-over-time
// chart draws one per incomplete month, not one per helmer dot (per-helmer
// glyphs overprinted each other wherever two dots sat close).
const incompleteMonths = vm.runInContext(`
  new Set(parseVmtCsv(VMT_CSV_TEXT).filter(r => r.coverage < 1 || r.incCov < 1).map(r => r.month)).size`, ctx);
const qmarkOpacities = [...plain.chartMpiAll.matchAll(/<text class="month-tick"[^>]*style="opacity:([\d.]+);pointer-events:none">\?<\/text>/g)].map(m => Number(m[1]));
const visibleQmarks = qmarkOpacities.filter(o => o > 0).length;
const windowMonths = vm.runInContext(`(() => { const s = monthSeriesData(); return s.months.length - s.months.indexOf(DEFAULT_START_MONTH); })()`, ctx);
assert.ok(qmarkOpacities.every(o => o >= 0 && o <= 1) && qmarkOpacities.length === windowMonths && visibleQmarks === incompleteMonths,
  `Replicata: count "?" marker texts on the default-window MPI-over-time chart and how many are visible (opacity > 0).
Expectata: one per month in the window (${windowMonths}; complete months carry it at opacity 0, grayed out rather than suppressed), each with a finite opacity in [0, 1], of which ${incompleteMonths} visible.
Resultata: ${qmarkOpacities.length} markers, ${visibleQmarks} visible.`);
// (d) The MPI-over-time tooltip's "worst case" coverage IS incident_coverage_min.
// Until 2026-09-26 the chart derived it as vmtMin / vmtRawMin, i.e. (receipt
// best / receipt min) x incCovMin = 24% for 2026-08 while the sanity table
// said 17.3%; the same ratio set the dot and "?" opacity.
{
  const dt = vm.runInContext(`
    (() => { const rows = parseVmtCsv(VMT_CSV_TEXT); const m = NHTSA_DATA_THROUGH_DATE.slice(0, 7);
      return { month: m, incCovMin: rows.find(r => r.month === m).incCovMin }; })()`, ctx);
  const tips = [...plain.chartMpiAll.matchAll(/data-tip="([^"]*)"/g)].map(m => m[1]).filter(t => t.startsWith(dt.month));
  // ADS dots carry an incident count; the human dots carry no coverage note (their data is complete).
  const adsTips = tips.filter(t => /incident/.test(t));
  const worst = [...new Set(adsTips.map(t => (t.match(/worst case ~(\d+)%/) || [])[1]))];
  assert.ok(adsTips.length >= 1 && worst.length === 1 && Number(worst[0]) === Math.round(dt.incCovMin * 100),
    `Replicata: read the ${dt.month} ADS dot tooltips on the default (Monthly-track) MPI chart.
Expectata: every one says "worst case ~${Math.round(dt.incCovMin * 100)}%" = incident_coverage_min, the figure the sanity table shows.
Resultata: ${JSON.stringify(worst)} from ${adsTips.length} tooltips.`);
  const fiveDayTips = vm.runInContext(`
    (() => { const s = monthSeriesData(); const start = s.months.indexOf(DEFAULT_START_MONTH);
      const saved = selectedMetricKey; selectedMetricKey = "fatality";
      const html = renderAllHelmersMpiChart(sliceSeries(s, start, s.months.length - 1)); selectedMetricKey = saved;
      return [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => m[1]).filter(t => t.startsWith(${JSON.stringify(dt.month)})); })()`, ctx);
  assert.ok(fiveDayTips.length >= 1 && fiveDayTips.every(t => !/incident coverage/.test(t)),
    `Replicata: the same month's dot tooltips on a five-day-track metric (fatality).
Expectata: no incident-coverage note (five-day metrics carry no Monthly-track thinning).
Resultata: ${JSON.stringify(fiveDayTips.slice(0, 2))}.`);
}
// (c) The card's Effective-VMT tooltip states the numbers only; the per-month
// VMT rationales live in the sanity section's VMT-sources table (embedded
// here they made the tooltip 7,000-8,700px tall, unreadable and unpinnable).
const vmtTips = [...plain.summaryCardHtml.matchAll(/class="mpi-card-vmt" data-tip="([^"]*)"/g)].map(m => m[1]);
assert.ok(vmtTips.length === 3 && vmtTips.every(t => t.length < 700 && !/US (rough )?est\.|deck|CPUC/.test(t)),
  `Replicata: read the three ADS cards' Effective-VMT data-tips on the default window.
Expectata: each under 700 characters and free of rationale prose.
Resultata: lengths ${JSON.stringify(vmtTips.map(t => t.length))}.`);

console.log("qual pass: monthly charts render cross-helmer and per-helmer incident-rate views");

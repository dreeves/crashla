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
Expectata: month axis includes the NHTSA window (2025-06 through 2026-02); may extend earlier with Waymo-only VMT.
Resultata: month axis was ${JSON.stringify(plain.months)}.`,
);

assert.deepEqual(
  plain.totalByHelmer,
  plain.expectedTotalByHelmer,
  `Replicata: sum monthly incident totals for each ADS helmer.
Expectata: month aggregation preserves totals from the raw incident data within the VMT window.
Resultata: expected=${JSON.stringify(plain.expectedTotalByHelmer)} actual=${JSON.stringify(plain.totalByHelmer)}.`,
);

assert.deepEqual(
  plain.janTeslaBins,
  { "0": 1, "31+": 0, "11-30": 0, "1-10": 4, unknown: 0 },
  `Replicata: inspect January 2026 Tesla speed bins.
Expectata: bins reflect one 0-mph incident and four 1-10 mph incidents.
Resultata: bins were ${JSON.stringify(plain.janTeslaBins)}.`,
);

assert.equal(
  plain.janTeslaNonstationary,
  4,
  `Replicata: compute January 2026 Tesla nonstationary monthly incident count.
Expectata: only the four 1-10 mph incidents count toward the nonstationary series.
Resultata: nonstationary count was ${JSON.stringify(plain.janTeslaNonstationary)}.`,
);

assert.equal(
  plain.janTeslaRoadwayNonstationary,
  2,
  `Replicata: compute January 2026 Tesla nonstationary-roadway monthly incident count.
Expectata: two January Tesla incidents are both nonstationary and not in a parking lot.
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
assert.ok(
  summaryByHelmer.Waymo.incAirbag >= 30 &&
    summaryByHelmer.Waymo.incAirbag <= 45 &&
    summaryByHelmer.Tesla.incAirbag === 0 &&
    summaryByHelmer.Zoox.incAirbag === 0,
  `Replicata: compute airbag deployment incident counts per helmer.
Expectata: Waymo has 30\u201345 airbag incidents (all months with VMT); Tesla and Zoox have 0 (no airbag deployments in current data).
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
    humanAirbag.lo >= 400000 && humanAirbag.hi <= 800000,
  `Replicata: inspect humanMPI for airbag metric.
Expectata: airbag human benchmark has lo (400k\u2013600k) < hi (600k\u2013800k) based on ~1.66 IPMM.
Resultata: ${JSON.stringify(humanAirbag)}.`,
);

// Verify chart renders line data with standard stroke-width:2
assert.ok(
  plain.chartMpiAll.includes("stroke-width:2"),
  `Replicata: render all-helmer MPI chart with selected metric.
Expectata: chart includes stroke-width:2 (standard line width).
Resultata: stroke-width:2 not found in rendered chart.`,
);

// Serious injury (SSI+) assertions
assert.ok(
  summaryByHelmer.Waymo.incSeriousInjury >= 1 &&
    summaryByHelmer.Waymo.incSeriousInjury <= 10 &&
    summaryByHelmer.Tesla.incSeriousInjury === 0 &&
    summaryByHelmer.Zoox.incSeriousInjury === 0,
  `Replicata: compute serious injury (SSI+) incident counts per helmer.
Expectata: Waymo has 1\u201310 serious injury incidents (Moderate W/ Hosp + Fatality); Tesla and Zoox have 0.
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
  plain.summaryCardHtml.includes("Serious injury (SSI+)"),
  `Replicata: render summary cards with all metrics enabled.
Expectata: summary cards include "Serious injury (SSI+)" label.
Resultata: label not found in card HTML.`,
);

const humanSsi = vm.runInContext("METRIC_DEFS.find(m => m.key === 'seriousInjury').humanMPI.HumansAV", ctx);
assert.ok(
  humanSsi && humanSsi.lo >= 3000000 && humanSsi.hi <= 7000000 && humanSsi.lo < humanSsi.hi,
  `Replicata: inspect humanMPI for seriousInjury metric.
Expectata: SSI+ human benchmark lo (3M\u20134M) < hi (6M\u20137M) based on ~0.23 IPMM.
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
  "Miles per incident over time",
  `Replicata: read the #mpi-heading section header after buildMonthlyViews with the all-incident metric.
Expectata: header reads "Miles per incident over time".
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
  "Miles per airbag-deploying crash over time",
  `Replicata: select the airbag metric and rebuild; read the #mpi-heading header.
Expectata: header reuses the exact selected metric label.
Resultata: header was ${JSON.stringify(airbagHeading)}.`,
);

// k=0 months render a datapoint from the Jeffreys posterior (Gamma(0.5, m))
// instead of being skipped (e.g. a month whose incidents are all 0% at-fault).
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
Expectata: every k=0 helmer-month renders a dot with a "(0 incidents)" tooltip (Jeffreys posterior, not skipped).
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

// The y-range always fits the plotted medians, even when every month is k=0.
// Replicates the bug where Tesla-only + fatality (k=0 in all months) left
// yMax at its init value of 1: the axis read 0..1, every dot clamped to the
// top ("MPI=1"), and every error bar collapsed to zero length.
const allZeroK = vm.runInContext(`
  (() => {
    const savedMetric = selectedMetricKey;
    const savedEnabled = {...monthHelmerEnabled};
    selectedMetricKey = "fatality";
    monthHelmerEnabled = {HumansAV: false, HumansUS: false, Tesla: true, Waymo: false, Zoox: false};
    const html = renderAllHelmersMpiChart(monthSeriesData());
    selectedMetricKey = savedMetric;
    monthHelmerEnabled = savedEnabled;
    const dotYs = [...html.matchAll(/class="month-dot" cx="[\\d.]+" cy="([\\d.]+)"/g)]
      .map(m => Number(m[1]));
    const barLens = [...html.matchAll(/class="month-err" x1="[\\d.]+" y1="([\\d.]+)" x2="[\\d.]+" y2="([\\d.]+)"/g)]
      .map(m => Math.abs(Number(m[2]) - Number(m[1])));
    return {dotYs, barLens};
  })()
`, ctx);
assert.ok(
  allZeroK.dotYs.length > 0 && allZeroK.dotYs.some(y => y > 20),
  `Replicata: render the fatality MPI chart with only Tesla enabled (k=0 every month).
Expectata: the y-axis fits the plotted medians, so dots spread below the top edge.
Resultata: dot cy values were ${JSON.stringify(allZeroK.dotYs)}.`,
);
assert.ok(
  allZeroK.barLens.length === allZeroK.dotYs.length && allZeroK.barLens.every(len => len > 5),
  `Replicata: inspect error bars in the Tesla-only fatality chart.
Expectata: one non-degenerate bar per dot (k=0 CIs are wide, so bars span well over 5px).
Resultata: bar lengths were ${JSON.stringify(allZeroK.barLens.map(Math.round))}.`,
);

assert.ok(
  appScript.includes("Monthly VMT:") &&
    appScript.includes("Cumulative VMT:"),
  `Replicata: inspect cross-helmer MPI datapoint tooltip source.
Expectata: tooltip source includes monthly and cumulative mileage labels.
Resultata: labels missing from source.`,
);

assert.ok(
  appScript.includes("Monthly VMT range:"),
  `Replicata: inspect source for the per-helmer VMT chart tooltip labels.
Expectata: source includes the VMT range label.
Resultata: expected strings missing from source.`,
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


assert.ok(
  plain.legendMpiHelmers.includes("Tesla") &&
  plain.legendMpiHelmers.includes("Waymo") &&
    plain.legendMpiHelmers.includes("Zoox") &&
  plain.legendMpiHelmers.includes("Humans (AV cities)") &&
    plain.legendMpiHelmers.includes("Humans (US average)") &&
  plain.legendMpiHelmers.includes("type=\"checkbox\"") &&
  plain.legendMpiLines.includes("month-metric-toggle-all") &&
  plain.legendMpiLines.includes("month-metric-toggle-nonstationary") &&
  plain.legendMpiLines.includes("month-metric-toggle-roadwayNonstationary") &&
  plain.legendMpiLines.includes("month-metric-toggle-atfault") &&
  plain.legendMpiLines.includes("month-metric-toggle-airbag") &&
  plain.legendMpiLines.includes("month-metric-toggle-seriousInjury") &&
  plain.legendMpiLines.includes("Miles per incident") &&
    plain.legendMpiLines.includes("Miles per nonstationary incident") &&
  plain.legendMpiLines.includes("Miles per nonstationary non-parking-lot incident") &&
  plain.legendMpiLines.includes("Miles per at-fault incident") &&
  plain.legendMpiLines.includes("Miles per airbag-deploying crash") &&
  plain.legendMpiLines.includes("Miles per serious injury crash"),
  `Replicata: render monthly legends.
Expectata: legends include helmer colors and cross-helmer metric line styles.
Resultata: mpi-helmers=${JSON.stringify(plain.legendMpiHelmers)}, mpi-lines=${JSON.stringify(plain.legendMpiLines)}.`,
);

console.log("qual pass: monthly charts render cross-helmer and per-helmer incident-rate views");

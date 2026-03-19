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
  const totalByDriver = Object.fromEntries(
    ADS_DRIVERS.map(driver => [
      driver,
      series.points.reduce((sum, p) => sum + (p.drivers[driver] ? p.drivers[driver].incidents.total : 0), 0),
    ]),
  );
  selectedMetricKey = "all";
  buildMonthlyViews();
  return {
    months: series.months,
    totalByDriver,
    janTeslaBins: byMonth["2026-01"].drivers.Tesla.incidents.speeds,
    janTeslaNonstationary: nonstationaryIncidentCount(byMonth["2026-01"].drivers.Tesla.incidents.speeds),
    janTeslaRoadwayNonstationary: byMonth["2026-01"].drivers.Tesla.incidents.roadwayNonstationary,
    summaryRows: monthlySummaryRows(series),
    airbagByDriverMonth: Object.fromEntries(
      ADS_DRIVERS.map(driver => [
        driver,
        series.points.filter(p => p.drivers[driver] !== null).map(p => p.drivers[driver].incidents.airbag),
      ]),
    ),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    chartMpiAll: document.getElementById("chart-mpi-all").innerHTML,
    chartDriverSeries: document.getElementById("chart-driver-series").innerHTML,
    legendMpiDrivers: document.getElementById("month-legend-mpi-drivers").innerHTML,
    legendMpiLines: document.getElementById("month-legend-mpi-lines").innerHTML,
    legendLines: document.getElementById("month-legend-lines").innerHTML,
    legendSpeed: document.getElementById("month-legend-speed").innerHTML,
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
  plain.totalByDriver,
  { Tesla: 15, Waymo: 1498, Zoox: 15 },
  `Replicata: sum monthly incident totals for each ADS driver.
Expectata: month aggregation preserves totals within the VMT window (Tesla 15, Waymo 1498 incl pre-Jun, Zoox 15).
Resultata: totals were ${JSON.stringify(plain.totalByDriver)}.`,
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

const summaryByDriver = Object.fromEntries(
  plain.summaryRows.map(row => [row.driver, row]),
);
assert.ok(
  summaryByDriver.Tesla && summaryByDriver.Waymo && summaryByDriver.Zoox,
  `Replicata: compute monthly summary rows.
Expectata: summary rows include Tesla, Waymo, and Zoox.
Resultata: summary rows were ${JSON.stringify(plain.summaryRows)}.`,
);
assert.ok(
  Math.abs(summaryByDriver.Tesla.incTotal - 15) < 1e-6 &&
    Math.abs(summaryByDriver.Tesla.incNonstationary - 11) < 1e-6 &&
    Math.abs(summaryByDriver.Tesla.incRoadwayNonstationary - 8) < 1e-6,
  `Replicata: compute Tesla summary incident totals.
Expectata: summary totals report observed-window incidents (15 total, 11 nonstationary, 8 nonstationary-roadway) without incident scaling.
Resultata: Tesla summary was ${JSON.stringify(summaryByDriver.Tesla)}.`,
);
assert.ok(
  Math.abs(summaryByDriver.Tesla.milesPerIncident -
    (summaryByDriver.Tesla.vmtBest / summaryByDriver.Tesla.incTotal)) < 1e-6 &&
    Math.abs(summaryByDriver.Tesla.milesPerNonstationaryIncident -
      (summaryByDriver.Tesla.vmtBest / summaryByDriver.Tesla.incNonstationary)) < 1e-6 &&
    Math.abs(summaryByDriver.Tesla.milesPerRoadwayNonstationaryIncident -
      (summaryByDriver.Tesla.vmtBest / summaryByDriver.Tesla.incRoadwayNonstationary)) < 1e-6,
  `Replicata: compute Tesla summary miles-per-incident fields.
Expectata: summary rows include overall, nonstationary, and nonstationary-roadway miles-per-incident values derived from best-VMT totals and observed-window incident totals.
Resultata: Tesla summary was ${JSON.stringify(summaryByDriver.Tesla)}.`,
);
assert.ok(
  summaryByDriver.Waymo.incAirbag >= 30 &&
    summaryByDriver.Waymo.incAirbag <= 45 &&
    summaryByDriver.Tesla.incAirbag === 0 &&
    summaryByDriver.Zoox.incAirbag === 0,
  `Replicata: compute airbag deployment incident counts per driver.
Expectata: Waymo has 30\u201345 airbag incidents (all months with VMT); Tesla and Zoox have 0 (no airbag deployments in current data).
Resultata: Waymo=${summaryByDriver.Waymo.incAirbag} Tesla=${summaryByDriver.Tesla.incAirbag} Zoox=${summaryByDriver.Zoox.incAirbag}.`,
);

// Verify airbag field exists in incident data and the monthly series correctly
// disaggregates it: Waymo's total airbag count across months should equal incAirbag.
const waymoAirbagMonthly = plain.airbagByDriverMonth.Waymo;
const waymoAirbagSum = waymoAirbagMonthly.reduce((a, b) => a + b, 0);
assert.equal(
  waymoAirbagSum,
  summaryByDriver.Waymo.incAirbag,
  `Replicata: sum per-month Waymo airbag counts.
Expectata: per-month sum equals summary incAirbag (${summaryByDriver.Waymo.incAirbag}).
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
const humanAirbag = vm.runInContext("METRIC_DEFS.find(m => m.key === 'airbag').humanMPI", ctx);
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
  `Replicata: render all-driver MPI chart with selected metric.
Expectata: chart includes stroke-width:2 (standard line width).
Resultata: stroke-width:2 not found in rendered chart.`,
);

// Serious injury (SSI+) assertions
assert.ok(
  summaryByDriver.Waymo.incSeriousInjury >= 1 &&
    summaryByDriver.Waymo.incSeriousInjury <= 10 &&
    summaryByDriver.Tesla.incSeriousInjury === 0 &&
    summaryByDriver.Zoox.incSeriousInjury === 0,
  `Replicata: compute serious injury (SSI+) incident counts per driver.
Expectata: Waymo has 1\u201310 serious injury incidents (Moderate W/ Hosp + Fatality); Tesla and Zoox have 0.
Resultata: Waymo=${summaryByDriver.Waymo.incSeriousInjury} Tesla=${summaryByDriver.Tesla.incSeriousInjury} Zoox=${summaryByDriver.Zoox.incSeriousInjury}.`,
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

const humanSsi = vm.runInContext("METRIC_DEFS.find(m => m.key === 'seriousInjury').humanMPI", ctx);
assert.ok(
  humanSsi && humanSsi.lo >= 3000000 && humanSsi.hi <= 7000000 && humanSsi.lo < humanSsi.hi,
  `Replicata: inspect humanMPI for seriousInjury metric.
Expectata: SSI+ human benchmark lo (3M\u20134M) < hi (6M\u20137M) based on ~0.23 IPMM.
Resultata: ${JSON.stringify(humanSsi)}.`,
);

// Verify METRIC_DEFS refactor: all metrics have required fields
const metricDefCheck = vm.runInContext(`
  METRIC_DEFS.every(m =>
    m.key && m.label && m.cardLabel && m.incField && m.marker &&
    typeof m.defaultEnabled === "boolean" && typeof m.primary === "boolean" &&
    typeof m.countFn === "function")
`, ctx);
assert.ok(
  metricDefCheck,
  `Replicata: validate METRIC_DEFS structure.
Expectata: every metric def has key, label, cardLabel, incField, marker, defaultEnabled, primary, countFn.
Resultata: some metric defs are missing required fields.`,
);

// Verify Humans driver is rendered in the chart (gold color, enabled by default)
assert.ok(
  plain.chartMpiAll.includes("#c9a800"),
  `Replicata: render chart with default settings (Humans enabled by default).
Expectata: chart includes gold (#c9a800) Humans driver lines/bands.
Resultata: Humans color not found in default chart render.`,
);

const renderedAll = plain.chartMpiAll;
assert.ok(
  renderedAll.includes("<svg") &&
    renderedAll.includes("month-mpi-all-line") &&
    renderedAll.includes("stroke-width:2") &&
    renderedAll.includes("Miles Per Incident (MPI)"),
  `Replicata: render cross-driver miles-per-incident chart.
Expectata: chart includes all-driver line traces with standard stroke-width, month labels, and the miles-per-incident axis.
Resultata: rendered snippets were ${JSON.stringify(renderedAll.slice(0, 400))}.`,
);

assert.ok(
  appScript.includes("Monthly VMT:") &&
    appScript.includes("Cumulative VMT:"),
  `Replicata: inspect cross-driver MPI datapoint tooltip source.
Expectata: tooltip source includes monthly and cumulative mileage labels.
Resultata: labels missing from source.`,
);

assert.ok(
  appScript.includes("Monthly VMT range:") &&
    appScript.includes("Segment:"),
  `Replicata: inspect source for lower-chart tooltip labels.
Expectata: source includes lower-chart tooltip labels for VMT range and segment counts.
Resultata: expected strings missing from source.`,
);

const rendered = plain.chartDriverSeries;
assert.ok(
  rendered.includes("<svg") &&
    rendered.includes("Tesla") &&
    rendered.includes("Waymo") &&
    rendered.includes("Zoox") &&
    rendered.includes("data-tip=") &&
    rendered.includes("month-vmt-line") &&
    rendered.includes("month-inc-bar") &&
    rendered.includes("month-inc-count") &&
    rendered.includes("month-inc-total") &&
    rendered.includes("Vehicle Miles Traveled (VMT)") &&
    rendered.includes("month-err") &&
    rendered.includes("month-axis"),
  `Replicata: render monthly charts per driver.
Expectata: each driver chart renders a left VMT axis, a VMT line, stacked incident bars with count labels, and error bars.
Resultata: rendered snippets were ${JSON.stringify(rendered.slice(0, 400))}.`,
);


assert.ok(
  plain.legendMpiDrivers.includes("Tesla") &&
  plain.legendMpiDrivers.includes("Waymo") &&
    plain.legendMpiDrivers.includes("Zoox") &&
  plain.legendMpiDrivers.includes("Humans") &&
  plain.legendMpiDrivers.includes("type=\"checkbox\"") &&
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
  plain.legendMpiLines.includes("Miles per serious injury crash") &&
  plain.legendLines.includes("VMT (central estimate)") &&
  plain.legendSpeed.includes("Left bar (movement)") &&
  plain.legendSpeed.includes("month-legend-break") &&
  plain.legendSpeed.indexOf("month-legend-break") < plain.legendSpeed.indexOf("Right bar (severity)") &&
  plain.legendSpeed.includes("Right bar (severity)") &&
  plain.legendSpeed.includes("Non-parking-lot nonstationary") &&
  plain.legendSpeed.includes("Stationary") &&
  plain.legendSpeed.includes("Fatality") &&
    plain.legendSpeed.includes("No injury"),
  `Replicata: render monthly legends.
Expectata: legends include driver colors, cross-driver metric styles, per-driver line styles, and bar segment types.
Resultata: mpi-drivers=${JSON.stringify(plain.legendMpiDrivers)}, mpi-lines=${JSON.stringify(plain.legendMpiLines)}, line legend=${JSON.stringify(plain.legendLines)}, speed legend=${JSON.stringify(plain.legendSpeed)}.`,
);

console.log("qual pass: monthly charts render cross-driver and per-driver incident-rate views");

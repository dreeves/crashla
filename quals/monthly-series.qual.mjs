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
  const totalByCompany = Object.fromEntries(
    ADS_COMPANIES.map(company => [
      company,
      series.points.reduce((sum, p) => sum + p.companies[company].incidents.total, 0),
    ]),
  );
  // Enable all metrics so the chart renders all line variants
  for (const m of MONTH_METRIC_DEFS) monthMetricEnabled[m.key] = true;
  buildMonthlyViews();
  return {
    months: series.months,
    totalByCompany,
    janTeslaBins: byMonth["2026-01"].companies.Tesla.incidents.speeds,
    janTeslaNonstationary: nonstationaryIncidentCount(byMonth["2026-01"].companies.Tesla.incidents.speeds),
    janTeslaRoadwayNonstationary: byMonth["2026-01"].companies.Tesla.incidents.roadwayNonstationary,
    summaryRows: monthlySummaryRows(series),
    airbagByCompanyMonth: Object.fromEntries(
      ADS_COMPANIES.map(company => [
        company,
        series.points.map(p => p.companies[company].incidents.airbag),
      ]),
    ),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    chartMpiAll: document.getElementById("chart-mpi-all").innerHTML,
    chartCompanySeries: document.getElementById("chart-company-series").innerHTML,
    legendMpiCompanies: document.getElementById("month-legend-mpi-companies").innerHTML,
    legendMpiLines: document.getElementById("month-legend-mpi-lines").innerHTML,
    legendLines: document.getElementById("month-legend-lines").innerHTML,
    legendSpeed: document.getElementById("month-legend-speed").innerHTML,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(metrics));

assert.deepEqual(
  plain.months,
  [
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
  ],
  `Replicata: aggregate month series from inline incident data + inline VMT sheet CSV.
Expectata: month axis exactly spans 2025-06 through 2026-01.
Resultata: month axis was ${JSON.stringify(plain.months)}.`,
);

assert.deepEqual(
  plain.totalByCompany,
  { Tesla: 14, Waymo: 492, Zoox: 12 },
  `Replicata: sum monthly incident totals for each ADS company.
Expectata: month aggregation preserves totals within the VMT window (Tesla 14, Waymo 492, Zoox 12).
Resultata: totals were ${JSON.stringify(plain.totalByCompany)}.`,
);

assert.deepEqual(
  plain.janTeslaBins,
  { "31+": 0, "11-30": 0, "1-10": 3, unknown: 0, "0": 1 },
  `Replicata: inspect January 2026 Tesla speed bins.
Expectata: bins reflect one 0-mph incident and three 1-10 mph incidents.
Resultata: bins were ${JSON.stringify(plain.janTeslaBins)}.`,
);

assert.equal(
  plain.janTeslaNonstationary,
  3,
  `Replicata: compute January 2026 Tesla nonstationary monthly incident count.
Expectata: only the three 1-10 mph incidents count toward the nonstationary series.
Resultata: nonstationary count was ${JSON.stringify(plain.janTeslaNonstationary)}.`,
);

assert.equal(
  plain.janTeslaRoadwayNonstationary,
  1,
  `Replicata: compute January 2026 Tesla nonstationary-roadway monthly incident count.
Expectata: only one January Tesla incident is both nonstationary and not in a parking lot.
Resultata: nonstationary-roadway count was ${JSON.stringify(plain.janTeslaRoadwayNonstationary)}.`,
);

const summaryByCompany = Object.fromEntries(
  plain.summaryRows.map(row => [row.company, row]),
);
assert.ok(
  summaryByCompany.Tesla && summaryByCompany.Waymo && summaryByCompany.Zoox,
  `Replicata: compute monthly summary rows.
Expectata: summary rows include Tesla, Waymo, and Zoox.
Resultata: summary rows were ${JSON.stringify(plain.summaryRows)}.`,
);
assert.ok(
  Math.abs(summaryByCompany.Tesla.incTotal - 14) < 1e-6 &&
    Math.abs(summaryByCompany.Tesla.incNonstationary - 10) < 1e-6 &&
    Math.abs(summaryByCompany.Tesla.incRoadwayNonstationary - 7) < 1e-6,
  `Replicata: compute Tesla summary incident totals.
Expectata: summary totals report observed-window incidents (14 total, 10 nonstationary, 7 nonstationary-roadway) without incident scaling.
Resultata: Tesla summary was ${JSON.stringify(summaryByCompany.Tesla)}.`,
);
assert.ok(
  Math.abs(summaryByCompany.Tesla.milesPerIncident -
    (summaryByCompany.Tesla.vmtBest / summaryByCompany.Tesla.incTotal)) < 1e-6 &&
    Math.abs(summaryByCompany.Tesla.milesPerNonstationaryIncident -
      (summaryByCompany.Tesla.vmtBest / summaryByCompany.Tesla.incNonstationary)) < 1e-6 &&
    Math.abs(summaryByCompany.Tesla.milesPerRoadwayNonstationaryIncident -
      (summaryByCompany.Tesla.vmtBest / summaryByCompany.Tesla.incRoadwayNonstationary)) < 1e-6,
  `Replicata: compute Tesla summary miles-per-incident fields.
Expectata: summary rows include overall, nonstationary, and nonstationary-roadway miles-per-incident values derived from best-VMT totals and observed-window incident totals.
Resultata: Tesla summary was ${JSON.stringify(summaryByCompany.Tesla)}.`,
);
assert.ok(
  summaryByCompany.Waymo.incAirbag >= 15 &&
    summaryByCompany.Waymo.incAirbag <= 30 &&
    summaryByCompany.Tesla.incAirbag === 0 &&
    summaryByCompany.Zoox.incAirbag === 0,
  `Replicata: compute airbag deployment incident counts per company.
Expectata: Waymo has 15\u201330 airbag incidents; Tesla and Zoox have 0 (no airbag deployments in current data).
Resultata: Waymo=${summaryByCompany.Waymo.incAirbag} Tesla=${summaryByCompany.Tesla.incAirbag} Zoox=${summaryByCompany.Zoox.incAirbag}.`,
);

// Verify airbag field exists in incident data and the monthly series correctly
// disaggregates it: Waymo's total airbag count across months should equal incAirbag.
const waymoAirbagMonthly = plain.airbagByCompanyMonth.Waymo;
const waymoAirbagSum = waymoAirbagMonthly.reduce((a, b) => a + b, 0);
assert.equal(
  waymoAirbagSum,
  summaryByCompany.Waymo.incAirbag,
  `Replicata: sum per-month Waymo airbag counts.
Expectata: per-month sum equals summary incAirbag (${summaryByCompany.Waymo.incAirbag}).
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
const humanAirbag = vm.runInContext("KNOWN_HUMAN_MPI.airbag", ctx);
assert.ok(
  humanAirbag && humanAirbag.lo > 0 && humanAirbag.hi > humanAirbag.lo &&
    humanAirbag.lo >= 400000 && humanAirbag.hi <= 800000,
  `Replicata: inspect KNOWN_HUMAN_MPI.airbag.
Expectata: airbag human benchmark has lo (400k\u2013600k) < hi (600k\u2013800k) based on ~1.66 IPMM.
Resultata: ${JSON.stringify(humanAirbag)}.`,
);

// Verify chart renders airbag line data (stroke-width:1.2 from airbag LINE_STYLE)
assert.ok(
  plain.chartMpiAll.includes("stroke-width:1.2"),
  `Replicata: render all-company MPI chart with all metrics enabled.
Expectata: chart includes stroke-width:1.2 (used by airbag and fatality lines).
Resultata: stroke-width:1.2 not found in rendered chart.`,
);

const renderedAll = plain.chartMpiAll;
assert.ok(
  renderedAll.includes("<svg") &&
    renderedAll.includes("month-mpi-all-line") &&
    renderedAll.includes("stroke-width:2.5") &&
    renderedAll.includes("stroke-width:1.5") &&
    renderedAll.includes("stroke-width:1") &&
    renderedAll.includes("2025-06") &&
    renderedAll.includes("2026-01") &&
    renderedAll.includes("Miles Per Incident (MPI)"),
  `Replicata: render cross-company miles-per-incident chart.
Expectata: chart includes all-company line traces with thick/medium/thin stroke-width variants, month labels, and the miles-per-incident axis.
Resultata: rendered snippets were ${JSON.stringify(renderedAll.slice(0, 400))}.`,
);

assert.ok(
  appScript.includes("Monthly VMT:") &&
    appScript.includes("Cumulative VMT:"),
  `Replicata: inspect cross-company MPI datapoint tooltip source.
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

const rendered = plain.chartCompanySeries;
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
  `Replicata: render monthly charts per company.
Expectata: each company chart renders a left VMT axis, a VMT line, stacked incident bars with count labels, and error bars.
Resultata: rendered snippets were ${JSON.stringify(rendered.slice(0, 400))}.`,
);


assert.ok(
  plain.legendMpiCompanies.includes("Tesla") &&
  plain.legendMpiCompanies.includes("Waymo") &&
    plain.legendMpiCompanies.includes("Zoox") &&
  plain.legendMpiCompanies.includes("type=\"checkbox\"") &&
  plain.legendMpiLines.includes("month-metric-toggle-all") &&
  plain.legendMpiLines.includes("month-metric-toggle-nonstationary") &&
  plain.legendMpiLines.includes("month-metric-toggle-roadwayNonstationary") &&
  plain.legendMpiLines.includes("month-metric-toggle-atfault") &&
  plain.legendMpiLines.includes("month-metric-toggle-airbag") &&
  plain.legendMpiLines.includes("Miles per incident") &&
    plain.legendMpiLines.includes("Miles per nonstationary incident") &&
  plain.legendMpiLines.includes("Miles per nonstationary non-parking-lot incident") &&
  plain.legendMpiLines.includes("Miles per at-fault incident") &&
  plain.legendMpiLines.includes("Miles per airbag-deploying crash") &&
  plain.legendLines.includes("VMT (best)") &&
  plain.legendSpeed.includes("Left bar (movement)") &&
  plain.legendSpeed.includes("Right bar (severity)") &&
  plain.legendSpeed.includes("Non-parking-lot nonstationary") &&
  plain.legendSpeed.includes("Stationary") &&
  plain.legendSpeed.includes("Fatality") &&
    plain.legendSpeed.includes("No injury"),
  `Replicata: render monthly legends.
Expectata: legends include company colors, cross-company metric styles, per-company line styles, and bar segment types.
Resultata: mpi-companies=${JSON.stringify(plain.legendMpiCompanies)}, mpi-lines=${JSON.stringify(plain.legendMpiLines)}, line legend=${JSON.stringify(plain.legendLines)}, speed legend=${JSON.stringify(plain.legendSpeed)}.`,
);

console.log("qual pass: monthly charts render cross-company and per-company incident-rate views");

import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

// The two density charts (the MPI distribution chart and the Jan-2027
// forecast) as each engine draws them, at desktop and phone width
// (2026-10-03, audit #25, #26, #27, #50). The DOM-stub quals model text with
// a per-glyph bound and markers by their attributes; this one asks the
// browsers:
//  - every x tick label's box lies inside the SVG (#50: "200.0M" centred
//    near the frame's right edge ran 4.7-7.8 units past it and was clipped);
//  - the distribution axis carries at least two labels (#27);
//  - every marker's box lies inside the SVG and a pointer at its centre
//    lands on a marker, i.e. shows a tooltip (#25: the tallest curve's markers
//    were clipped in half and their centres hit the bare svg; #26: the narrow
//    Humans (US average) fatality curve's markers sat above the plot).
// States: the default view (all three forecast metrics), each finding's
// Replicata.

const STATES = [
  { what: "default view", helmers: null, metric: null, window: null },
  { what: "default helmers, serious injury+, full history", helmers: ["HumansAV", "Tesla", "Waymo"], metric: "seriousInjury", window: "full" },
  { what: "default helmers, airbag, last month", helmers: ["HumansAV", "Tesla", "Waymo"], metric: "airbag", window: "last" },
  { what: "no helmer, at-fault", helmers: [], metric: "atfault", window: null },
  { what: "all six, fatality, last month", helmers: ["HumansAV", "HumansUS", "HumansRideshare", "Tesla", "Waymo", "Zoox"], metric: "fatality", window: "last" },
  { what: "Humans (US average) alone, fatality", helmers: ["HumansUS"], metric: "fatality", window: null },
  { what: "Waymo alone, all incidents, full history", helmers: ["Waymo"], metric: "all", window: "full" },
  { what: "Waymo alone, at-fault", helmers: ["Waymo"], metric: "atfault", window: null },
];

const server = await serveRepo();
const failures = [];
let checked = 0;
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    for (const width of [1200, 400]) {
      const page = await openPage(browser, server.url, { viewport: { width, height: 900 } });
      for (const state of STATES) {
        for (const growth of state.helmers === null ? ["fleet", "rides", "miles"] : ["fleet"]) {
          const res = await page.evaluate(({ state, growth }) => {
            if (state.helmers !== null) {
              for (const h of ALL_HELMERS) monthHelmerEnabled[h] = state.helmers.includes(h);
              selectedMetricKey = state.metric;
              const last = fullMonthSeries.months.length - 1;
              [monthRangeStart, monthRangeEnd] = state.window === "full" ? [0, last]
                : state.window === "last" ? [last, last] : [fullMonthSeries.months.indexOf(DEFAULT_START_MONTH), Infinity];
              renderWindowedViews();
            }
            selectedGrowthMetric = growth;
            byId("chart-fleet-forecast").innerHTML = renderFleetForecastChart();
            const out = [];
            for (const id of ["chart-distributions", "chart-fleet-forecast"]) {
              const svg = document.querySelector(`#${id} svg`);
              const vbW = svg.viewBox.baseVal.width, vbH = svg.viewBox.baseVal.height;
              const ticks = [...svg.querySelectorAll("text.month-tick")].filter(t => /^[\d.,]+[KMB]?$/.test(t.textContent));
              const labels = ticks.map(t => { const b = t.getBBox(); return { label: t.textContent, x0: b.x, x1: b.x + b.width }; });
              svg.scrollIntoView({ block: "center" });
              const markers = [...svg.querySelectorAll("circle[data-tip]")].map(c => {
                const b = c.getBBox(), sw = 1.5 / 2;
                const r = c.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { tip: c.getAttribute("data-tip").split("\n")[0],
                  inside: b.x - sw >= 0 && b.y - sw >= 0 && b.x + b.width + sw <= vbW && b.y + b.height + sw <= vbH,
                  hit: hit !== null && hit.matches("circle[data-tip]") };
              });
              out.push({ id, vbW, labels, markers });
            }
            return out;
          }, { state, growth });
          for (const chart of res) {
            const where = `${engineName} ${width}px, ${state.what}${chart.id === "chart-fleet-forecast" ? `, forecast "${growth}"` : ""}, ${chart.id}`;
            checked++;
            for (const l of chart.labels) {
              if (l.x0 < 0 || l.x1 > chart.vbW) failures.push(`${where}: label ${JSON.stringify(l.label)} spans ${l.x0.toFixed(1)}-${l.x1.toFixed(1)} of ${chart.vbW}`);
            }
            if (chart.id === "chart-distributions" && chart.labels.length < 2)
              failures.push(`${where}: ${chart.labels.length} x labels`);
            for (const m of chart.markers) {
              if (!m.inside) failures.push(`${where}: marker ${JSON.stringify(m.tip)} not inside the SVG`);
              if (!m.hit) failures.push(`${where}: a pointer at marker ${JSON.stringify(m.tip)}'s centre hits no marker`);
            }
          }
        }
      }
      assert.deepEqual(page.errors, [], `${engineName} ${width}px: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();
    }
    await browser.close();
  }
} finally {
  await server.close();
}
for (const f of failures) console.error(f);
assert.ok(
  failures.length === 0,
  `Replicata: in Chromium, Firefox and WebKit at 1200 and 400 px, open the page, set each of ${STATES.length} chart states, and measure both density charts' tick labels and markers with getBBox and elementFromPoint.
Expectata: every label and marker drawn whole inside its SVG, at least two distribution x labels, and a pointer at each marker's centre landing on a marker.
Resultata: ${failures.length} problems, e.g.
${failures.slice(0, 12).join("\n")}`,
);
console.log(`qual pass: density charts draw every label and marker whole in three engines at two widths (${checked} charts)`);

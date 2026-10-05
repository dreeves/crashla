// The two growth charts (trajectory and Jan-1-2027 forecast) agree with each
// other (2026-10-03, audit #57, #65, #86):
//  - both legends list the same series in the same order (#65: the
//    trajectory read Waymo, Zoox, Tesla robotaxi, Tesla all-HW4; the forecast
//    Tesla robotaxi, Tesla all-HW4, Waymo, Zoox);
//  - both charts print a forecast with the metric's own formatter at three
//    significant figures, and the same figures in both (#57: the forecast
//    chart printed "407,979,419" where the trajectory printed "408.0M", and
//    rides to eight digits in both);
//  - the Jan-1 endpoint sits where its history's time convention puts it:
//    cumulative miles and rides are month-end totals, so a total through
//    Dec 31, 2026 belongs at the 2026-12 step (it sat at 2027-01, five steps
//    after August for four months of driving, so the dashed leg showed 4/5 of
//    its slope); the fleet is a stock, counted at Jan 1 = the 2027-01 step.
//    Either way the endpoint's tooltip names its date, 2027-01-01.
//  - scenario shares are forecast labels (#83): history points are labelled
//    by their helmer ("Tesla · 2026-08", not "Tesla robotaxi (~95%) ·
//    2026-08"), and a note explains the legend's "(~95%)" / "(~5%)".
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const escapingEl = () => {
  let html = "";
  return {
    set textContent(v) { html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
    get innerHTML() { return html; },
  };
};
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Object, String, Map, JSON,
  document: { getElementById() { return { textContent: "", innerHTML: "" }; }, createElement() { return escapingEl(); } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);

const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// The figures the tooltips print (audit 2026-10-04 #51): miles at three
// significant figures BEFORE their unit suffix ("6.27M", "99.0M", "1.50B";
// rounding to three figures and then printing one decimal of the unit read
// 6.3M, 99M, 1.5B, and Tesla's 2026-03 history point "1.7M / Range: 1.7M –
// 2.0M"); rides, which carry no suffix, at three significant figures in full
// digits; the fleet, an observed count, exactly in history and at three
// significant figures in the forecasts. Coded here, not read from the app.
const SUFFIXES = ["", "K", "M", "B", "T"];
const sig3 = v => Number(v.toPrecision(3));
const milesAt3 = v => {
  let m = sig3(v), t = 0;
  while (m >= 1000 && t < SUFFIXES.length - 1) { m /= 1000; t++; }
  return t === 0 ? sig3(v).toLocaleString("en-US") : m.toPrecision(3) + SUFFIXES[t];
};
// (Rides and vehicles are whole: three figures, then the nearest whole one.)
const whole = v => Math.round(v).toLocaleString("en-US");
const TIP_FMT = {
  fleet: { history: whole, forecast: v => whole(sig3(v)) },
  rides: { history: v => whole(sig3(v)), forecast: v => whole(sig3(v)) },
  miles: { history: milesAt3, forecast: milesAt3 },
};
const ENDPOINT = { fleet: "2027-01", rides: "2026-12", miles: "2026-12" };
const problems = [];
const charts = JSON.parse(JSON.stringify(vm.runInContext(`(() => {
  const out = {};
  for (const key of GROWTH_METRIC_KEYS) {
    selectedGrowthMetric = key;
    const spec = growthMetricSpec(key);
    out[key] = {
      trajectory: renderFleetTimeSeriesChart(), forecast: renderFleetForecastChart(),
      curves: fleetDistributionCurves(key).map(c => ({key: c.key, label: c.legendLabel, median: c.median, lo90: c.lo90, hi90: c.hi90})),
      history: spec.lanes().filter(l => !l.branchOnly).map(l => ({helmer: l.helmer, points: l.points.filter(p => !p.forecast)})),
      endMonths: spec.lanes().map(l => ({label: l.label, month: l.points[l.points.length - 1].month,
        forecast: l.points[l.points.length - 1].forecast === true})),
    };
  }
  selectedGrowthMetric = "fleet";
  return out;
})()`, ctx)));

const legendOf = html => [...html.matchAll(/<span class="month-legend-item">\s*<span class="month-chip"[^>]*><\/span>([^<]*)<\/span>/g)]
  .map(m => decode(m[1].trim()));
const tipsOf = html => [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => decode(m[1]));
for (const [key, c] of Object.entries(charts)) {
  const a = legendOf(c.trajectory), b = legendOf(c.forecast);
  if (a.length !== 4 || JSON.stringify(a) !== JSON.stringify(b))
    problems.push(`${key}: the trajectory legend reads ${JSON.stringify(a)} but the forecast legend ${JSON.stringify(b)}`);
  const ftips = tipsOf(c.forecast), ttips = tipsOf(c.trajectory);
  for (const curve of c.curves) {
    const want = [curve.median, curve.lo90, curve.hi90].map(TIP_FMT[key].forecast);
    const body = `Median: ${want[0]}\n90% CI: ${want[1]} – ${want[2]}`;
    if (!ftips.includes(`${curve.label}\n${body}`))
      problems.push(`${key}: the forecast chart's ${curve.label} tooltip should read "${body.replace("\n", " / ")}"; its tooltips are ${JSON.stringify(ftips.filter(t => t.startsWith(curve.label)))}`);
    const end = ttips.filter(t => t.startsWith(`${curve.label} · 2027-01-01 (forecast)\n`));
    if (end.length !== 1 || !end[0].endsWith(body))
      problems.push(`${key}: the trajectory's ${curve.label} endpoint tooltip should open "${curve.label} · 2027-01-01 (forecast)" and read "${body.replace("\n", " / ")}"; found ${JSON.stringify(ttips.filter(t => t.startsWith(curve.label) && /forecast/.test(t)))}`);
  }
  for (const e of c.endMonths) {
    if (e.month !== ENDPOINT[key] || !e.forecast)
      problems.push(`${key}: the ${e.label} lane's Jan-1 endpoint is at the ${e.month} step (forecast: ${e.forecast}); want ${ENDPOINT[key]}`);
  }
  // History points print the metric's figures (#51): miles and rides at
  // three significant figures, the fleet exactly.
  const VALUE = { fleet: "Fleet size", rides: "Rides", miles: "Miles" };
  for (const lane of c.history) {
    for (const p of lane.points) {
      const f = TIP_FMT[key].history;
      const want = `${lane.helmer} · ${p.month}\n${VALUE[key]}: ${f(p.best)}\nRange: ${f(p.lo)} – ${f(p.hi)}`;
      if (!ttips.includes(want)) problems.push(`${key}: no history tooltip reads ${JSON.stringify(want)}; found ${JSON.stringify(ttips.filter(t => t.startsWith(`${lane.helmer} · ${p.month}\n`)))}`);
    }
  }
  // Scenario shares belong to forecasts (audit #83): an observed history
  // point is labelled by its helmer alone. Until 2026-10-03 all 24 Tesla
  // history tooltips read "Tesla robotaxi (~95%) · 2026-08 ...".
  const history = ttips.filter(t => !/\(forecast\)/.test(t.split("\n")[0]));
  if (history.length === 0) problems.push(`${key}: no history-point tooltips found`);
  for (const t of history) {
    const head = t.split("\n")[0];
    if (!/^(Tesla|Waymo|Zoox) · \d{4}-\d\d$/.test(head)) problems.push(`${key}: a history point is labelled ${JSON.stringify(head)}; want "<helmer> · <month>"`);
  }
  // ...and the shares are explained: a note under the legend names both Tesla
  // scenario groups with the shares the legend chips carry, in the human's
  // English to the character (committed 2026-10-04 in b068a10; until then the
  // note was agent Latin and this qual checked for the to-do recap above
  // growthScenarioNote).
  const shares = c.curves.filter(curve => /\(~\d+%\)$/.test(curve.label)).map(curve => /\(~(\d+)%\)$/.exec(curve.label)[1]);
  const notes = [...c.trajectory.matchAll(/<p class="month-note">([^<]*)<\/p>/g)].map(m => decode(m[1]));
  if (shares.length !== 2) problems.push(`${key}: ${shares.length} legend chips carry a scenario share; want Tesla's two`);
  const chipShare = k => {
    const curve = c.curves.find(cv => cv.key === k);
    assert.ok(curve !== undefined && /\(~\d+%\)$/.test(curve.label),
      `${key}: the ${k} lane's legend chip carries no scenario share: ${JSON.stringify(curve && curve.label)}`);
    return /\(~(\d+)%\)$/.exec(curve.label)[1];
  };
  const note = `Tesla forecast splits into two scenarios: the robotaxi (~${chipShare("robotaxi")}%) ` +
    `and unsupervised FSD in all HW4 cars (~${chipShare("hw4")}%). These numbers are the scenarios' probabilities.`;
  if (!notes.includes(note)) problems.push(`${key}: no note reads the human's English ${JSON.stringify(note)}; the notes are ${JSON.stringify(notes)}`);
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render both growth charts for fleet, rides and miles in vm and read their legends, forecast tooltips and lane endpoints.
Expectata: one legend order in both charts; each forecast printed at three significant figures (miles before the unit suffix, "6.27M"; rides and the fleet in full digits), the same in both charts; each history point's value and range at three significant figures for miles and rides, exactly for the fleet; the endpoint at 2026-12 for the cumulative metrics and 2027-01 for the fleet, its tooltip dated 2027-01-01; every history point labelled "<helmer> · <month>", without a scenario share; a note giving Tesla's two scenario shares, as the legend chips carry them, in the human's English exactly: "Tesla forecast splits into two scenarios: the robotaxi (~<robotaxi share>%) and unsupervised FSD in all HW4 cars (~<HW4 share>%). These numbers are the scenarios' probabilities."
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log("qual pass: the growth charts share one legend order, print forecasts alike at three significant figures, date the Jan-1 endpoint by its own time convention, label history points by helmer and explain the scenario shares");

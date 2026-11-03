// The two growth charts (trajectory and forecast for GROWTH_FORECAST_DATE)
// agree with each other (2026-10-03, audit #57, #65, #86):
//  - both legends list the same series in the same order (#65: the
//    trajectory read Waymo, Zoox, Tesla robotaxi, Tesla all-HW4; the forecast
//    Tesla robotaxi, Tesla all-HW4, Waymo, Zoox);
//  - both charts print a forecast with the metric's own formatter at three
//    significant figures, and the same figures in both (#57: the forecast
//    chart printed "407,979,419" where the trajectory printed "408.0M", and
//    rides to eight digits in both);
//  - the endpoint sits where its history's time convention puts it:
//    cumulative miles and rides are month-end totals, so a total through the
//    day before the forecast date belongs at the month before (when the date
//    was Jan 1, 2027, the total through Dec 31, 2026 sat at 2027-01, five
//    steps after August for four months of driving, so the dashed leg showed
//    4/5 of its slope); the fleet is a stock, counted on the forecast date,
//    at its month. Either way the endpoint's tooltip names the date,
//    GROWTH_FORECAST_DATE.
//  - scenario shares are forecast labels (#83): history points are labelled
//    by their helmer ("Tesla · 2026-08", not "Tesla robotaxi (~<share>%) ·
//    2026-08"), and a note gives the two Tesla shares the legend chips carry.
//  - the section heading's date is GROWTH_FORECAST_DATE (2026-10-31; audit
//    growth-heading-date-guard, R9, CR-06): index.html's #sec-fleet heading
//    is the one displayed copy of the date the code does not derive, and it
//    was edited by hand when the date moved on 2026-10-29. Every date and
//    every year the heading gives must be the constant's; its other words are
//    the human's and not checked (no wording pins, 2026-10-28).
import assert from "node:assert/strict";
import fs from "node:fs";
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
// The figures the tooltips print (audit 2026-10-04 #51): miles BEFORE their
// unit suffix ("6.27M", "99.0M", "1.50B"; rounding to three figures and then
// printing one decimal of the unit read 6.3M, 99M, 1.5B, and Tesla's 2026-03
// history point "1.7M / Range: 1.7M – 2.0M"); rides and the fleet, which
// carry no suffix, in full digits. A forecast prints at three significant
// figures. A history point prints its value and its range's two edges at the
// fewest significant figures, at least three, at which every two of them that
// differ in whole units print apart; two equal in whole units print alike,
// the figures stopping at whole units (decision #51b, the human's "Enough
// digits for the range", 2026-10-05; implemented 2026-10-31). Until then a
// history point printed three figures for miles and rides and the fleet
// exactly, so Waymo's 2025-12 miles of 2026-10-05, 174,262,000 [173,562,000,
// 175,162,000], read "174M / Range: 174M – 175M" (the decision's example
// reads "174.3M / Range: 173.6M – 175.2M"), and on 2026-10-31's data Waymo's
// 2026-03 miles, 222,463,000 [221,553,000, 223,763,000], read "222M / Range:
// 222M – 224M" (then "222.5M / Range: 221.6M – 223.8M"; since 2026-11-02 the
// point is 222,408,000, "222.4M / Range: 221.6M – 223.8M"). Coded here, not
// read from the app.
const SUFFIXES = ["", "K", "M", "B", "T"];
const sigAt = (v, n) => Math.round(Number(v.toPrecision(n))); // n figures, not below whole units
const digitsOf = v => String(Math.round(v)).length;
const milesAt = (v, n) => {
  const k = Math.min(n, digitsOf(v));
  let m = sigAt(v, k), t = 0;
  while (m >= 1000 && t < SUFFIXES.length - 1) { m /= 1000; t++; }
  return t === 0 ? sigAt(v, k).toLocaleString("en-US") : m.toPrecision(k) + SUFFIXES[t];
};
const wholeAt = (v, n) => sigAt(v, n).toLocaleString("en-US");
const historyFigures = values => {
  let n = 3;
  while (values.some((v, i) => values.some((w, j) => Math.round(v) !== Math.round(w) && sigAt(v, n) === sigAt(w, n)))) n++;
  return n;
};
const TIP_AT = { fleet: wholeAt, rides: wholeAt, miles: milesAt };
const TIP_FMT = Object.fromEntries(Object.entries(TIP_AT).map(([key, at]) => [key, {
  history: values => { const n = historyFigures(values); return values.map(v => at(v, n)); },
  forecast: v => at(v, 3),
}]));
// The forecast's date, read from the app; the fleet (a stock) plots at its
// month, the cumulative metrics (month-end totals) at the month before.
const FORECAST_DATE = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
const monthBefore = month => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const ENDPOINT = { fleet: FORECAST_DATE.slice(0, 7), rides: monthBefore(FORECAST_DATE.slice(0, 7)), miles: monthBefore(FORECAST_DATE.slice(0, 7)) };
// A tooltip gives these figures, in this order (its words are the page's
// and not checked: no wording pins, 2026-10-28).
const givesInOrder = (tip, figures) => {
  let at = 0;
  for (const f of figures) { const i = tip.indexOf(f, at); if (i < 0) return false; at = i + f.length; }
  return true;
};
const bodyOf = tip => tip.split("\n").slice(1).join("\n");
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
    const ftip = ftips.filter(t => t.startsWith(`${curve.label}\n`));
    if (ftip.length !== 1 || !givesInOrder(bodyOf(ftip[0]), want))
      problems.push(`${key}: the forecast chart's ${curve.label} tooltip should give its median, 5th and 95th percentiles as ${want.join(", ")}; found ${JSON.stringify(ftip)}`);
    const end = ttips.filter(t => t.startsWith(`${curve.label} · ${FORECAST_DATE}`));
    if (end.length !== 1 || ftip.length !== 1 || bodyOf(end[0]) !== bodyOf(ftip[0]))
      problems.push(`${key}: the trajectory's ${curve.label} endpoint tooltip should open "${curve.label} · ${FORECAST_DATE}" and print what the forecast chart prints; found ${JSON.stringify(end)} against ${JSON.stringify(ftip)}`);
  }
  for (const e of c.endMonths) {
    if (e.month !== ENDPOINT[key] || !e.forecast)
      problems.push(`${key}: the ${e.label} lane's Jan-1 endpoint is at the ${e.month} step (forecast: ${e.forecast}); want ${ENDPOINT[key]}`);
  }
  // History points print the metric's figures (#51, #51b): value, low and
  // high, in order, at the fewest figures (at least three) that keep apart
  // the ones that differ in whole units.
  for (const lane of c.history) {
    for (const p of lane.points) {
      const want = TIP_FMT[key].history([p.best, p.lo, p.hi]);
      const tip = ttips.filter(t => t.startsWith(`${lane.helmer} · ${p.month}\n`));
      if (tip.length !== 1 || !givesInOrder(bodyOf(tip[0]), want)) problems.push(`${key}: the ${lane.helmer} ${p.month} history tooltip should give ${want.join(", ")}; found ${JSON.stringify(tip)}`);
    }
  }
  // Scenario shares belong to forecasts (audit #83): an observed history
  // point is labelled by its helmer alone. Until 2026-10-03 all 24 Tesla
  // history tooltips read "Tesla robotaxi (~95%) · 2026-08 ...".
  const history = ttips.filter(t => !t.split("\n")[0].includes(FORECAST_DATE));
  if (history.length === 0) problems.push(`${key}: no history-point tooltips found`);
  for (const t of history) {
    const head = t.split("\n")[0];
    if (!/^(Tesla|Waymo|Zoox) · \d{4}-\d\d$/.test(head)) problems.push(`${key}: a history point is labelled ${JSON.stringify(head)}; want "<helmer> · <month>"`);
  }
  // ...and the shares are explained: a note under the legend gives both Tesla
  // scenario shares the legend chips carry. Its words are the human's
  // (committed 2026-10-04 in b068a10) and were pinned to the character until
  // 2026-10-28, when the human dropped such pins (one went red on each of the
  // human's edits and caught no agent's; the human reviews every diff).
  const shares = c.curves.filter(curve => /\(~\d+%\)$/.test(curve.label)).map(curve => /\(~(\d+)%\)$/.exec(curve.label)[1]);
  const notes = [...c.trajectory.matchAll(/<p class="month-note">([^<]*)<\/p>/g)].map(m => decode(m[1]));
  if (shares.length !== 2) problems.push(`${key}: ${shares.length} legend chips carry a scenario share; want Tesla's two`);
  const chipShare = k => {
    const curve = c.curves.find(cv => cv.key === k);
    assert.ok(curve !== undefined && /\(~\d+%\)$/.test(curve.label),
      `${key}: the ${k} lane's legend chip carries no scenario share: ${JSON.stringify(curve && curve.label)}`);
    return /\(~(\d+)%\)$/.exec(curve.label)[1];
  };
  const wantShares = [`~${chipShare("robotaxi")}%`, `~${chipShare("hw4")}%`];
  if (!notes.some(n => wantShares.every(s => n.includes(s)))) problems.push(`${key}: no note gives both scenario shares ${JSON.stringify(wantShares)}; the notes are ${JSON.stringify(notes)}`);
}
// The section heading's dates and years (a date's month by name, full or
// abbreviated, in either order with its day, or ISO).
{
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const html = fs.readFileSync("index.html", "utf8");
  const section = html.indexOf('id="sec-fleet"');
  assert.ok(section >= 0, `Replicata: search index.html for the growth section. Expectata: an element with id="sec-fleet". Resultata: none.`);
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(html.slice(section));
  assert.ok(h2 !== null, `Replicata: read the heading of index.html's growth section (id="sec-fleet"). Expectata: an h2. Resultata: none.`);
  const heading = h2[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  {
    const month = name => String(MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1).padStart(2, "0");
    const iso = (y, m, d) => `${y}-${m}-${String(d).padStart(2, "0")}`;
    const MONTH = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
    const dates = [
      ...[...heading.matchAll(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))].map(m => iso(m[3], month(m[1]), m[2])),
      ...[...heading.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})\\b`, "gi"))].map(m => iso(m[3], month(m[2]), m[1])),
      ...[...heading.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map(m => m[0]),
    ];
    const years = [...heading.matchAll(/\b(?:19|20)\d{2}\b/g)].map(m => m[0]);
    const off = [...dates.filter(d => d !== FORECAST_DATE), ...years.filter(y => y !== FORECAST_DATE.slice(0, 4))];
    if (off.length > 0)
      problems.push(`the growth section's heading ${JSON.stringify(heading)} gives ${JSON.stringify(off)}; the forecast date is ${FORECAST_DATE} (GROWTH_FORECAST_DATE): edit the heading with the constant`);
    console.log(`the growth section's heading gives the dates ${JSON.stringify(dates)} and the years ${JSON.stringify(years)}; GROWTH_FORECAST_DATE is ${FORECAST_DATE}`);
  }
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render both growth charts for fleet, rides and miles in vm and read their legends, forecast tooltips and lane endpoints.
Expectata: one legend order in both charts; each forecast's median, 5th and 95th percentiles printed at three significant figures (miles before the unit suffix, "6.27M"; rides and the fleet in full digits), the same in both charts; each history point's value and range at the fewest significant figures, at least three, that print apart the ones differing in whole units; the endpoint at the forecast date's month for the fleet and the month before for the cumulative metrics, its tooltip dated GROWTH_FORECAST_DATE (${FORECAST_DATE}); every history point labelled "<helmer> · <month>", without a scenario share; a note giving Tesla's two scenario shares ("~<robotaxi share>%" and "~<HW4 share>%") as the legend chips carry them; and every date and year in the growth section's heading (index.html #sec-fleet) the forecast date's.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log("qual pass: the growth charts share one legend order, print forecasts alike at three significant figures, date the endpoint by its own time convention, label history points by helmer and explain the scenario shares; the section heading's date is the forecast date");

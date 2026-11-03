// Sanity backstop: our full-history Waymo incident rates vs Waymo's OWN
// published rates (WAYMO_PUBLISHED_IPMM). Different scopes (we use all-roads SGO
// self-reported severity; Waymo publishes surface-street, location-weighted), so
// the bounds are deliberately loose — this catches gross miscounts, not subtle
// methodology gaps. The injury bound is tighter because all-injury rates should
// track closely: it would have caught the 2026-06 silent-drop bug, where our
// Waymo injury rate sagged to ~0.40 vs Waymo's 0.71 (ratio 0.56, below 0.6).
// Airbag ("any vehicle") is comparable since the archive SV|CP fix
// (_normalize_archive_row). The precise guard against the silent-drop class is
// severity-classification.qual.
//
// Since 2026-10-03 (audit #8, #48) this qual also reads the rendered
// "Waymo cross-check" table: each row divides by its own metric's exposure
// (five-day-track metrics by the receipt-coverage-scaled VMT, Monthly-track
// injury also by the incident-coverage factor, as the cards do; until then
// every row used the five-day denominator), the rates show enough digits to
// reproduce the ratio (they showed 0.04 vs 0.01 beside a 3.6x ratio that the
// rounded 0.01 had produced; unrounded it is 3.3x), and a note says why the
// serious-injury+ ratio sits far from 1.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class Stub {
  constructor() { this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this._textContent = ""; this._innerHTML = ""; this.value = "0"; }
  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  get textContent() { return this._textContent; }
  appendChild(c) { return c; }
  replaceChildren() {} append() {} addEventListener() {} setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return new Stub(); }
  querySelectorAll() { return []; }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
}
const nodes = new Map();
const getNode = id => { if (!nodes.has(id)) nodes.set(id, new Stub()); return nodes.get(id); };
const ctx = vm.createContext({
  console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date,
  document: { getElementById: getNode, createElement: () => new Stub(), body: new Stub(), addEventListener() {}, querySelector: () => new Stub() },
  window: { innerWidth: 1024, innerHeight: 768, addEventListener() {}, location: { search: "", href: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext("incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); faultData = buildFaultDataFromIncidents(INCIDENT_DATA);", ctx);

const pub = vm.runInContext("WAYMO_PUBLISHED_IPMM", ctx);
const stats = vm.runInContext(`(() => {
  const way = INCIDENT_DATA.filter(r => r.helmer === "Waymo");
  const rows = vmtRows.filter(r => r.helmer === "Waymo");
  // Receipt-coverage-scaled: the numerator holds only reports received
  // through the data-through cutoff, so the data-through month counts at its
  // coverage fraction, not at full weight; Monthly-track metrics are further
  // thinned by that month's incident coverage (as on the cards).
  const fiveDayM = rows.reduce((s, r) => s + r.vmtBest * r.coverage, 0) / 1e6;
  const monthlyM = rows.reduce((s, r) => s + r.vmtBest * r.coverage * r.incCov, 0) / 1e6;
  const vmtFor = key => METRIC_BY_KEY[key].fiveDay === true ? fiveDayM : monthlyM;
  const k = {
    injury: way.filter(r => INJURY_SEVERITIES.has(r.severity)).length,
    airbag: way.filter(r => r.airbagAny).length,
    ssi: way.filter(r => SERIOUS_INJURY_SEVERITIES.has(r.severity)).length,
  };
  return {
    fiveDayM, monthlyM, k,
    injury: k.injury / vmtFor("injury"),
    airbag: k.airbag / vmtFor("airbag"),
    ssi: k.ssi / vmtFor("seriousInjury"),
  };
})()`, ctx);

assert.ok(stats.fiveDayM > 100 && stats.monthlyM < stats.fiveDayM,
  `Replicata: sum full-history Waymo VMT on both reporting tracks.\nExpectata: > 100M mi, the Monthly-track sum below the five-day one (incident coverage < 1 in the data-through month).\nResultata: five-day ${stats.fiveDayM.toFixed(1)}M, Monthly ${stats.monthlyM.toFixed(1)}M.`);

// [metric, published key, lo ratio, hi ratio]
const checks = [
  ["injury", "injury", 0.6, 1.6],
  ["airbag", "airbag", 0.5, 1.8],  // any-vehicle; some scope slack (all-severity SGO vs Waymo's)
  ["ssi", "ssi", 0.3, 4.5],
];
for (const [metric, key, lo, hi] of checks) {
  const ratio = stats[metric] / pub[key];
  assert.ok(
    ratio >= lo && ratio <= hi,
    `Replicata: our full-history Waymo ${metric} rate = ${stats[metric].toFixed(3)} IPMM vs Waymo published ${pub[key]}.
Expectata: ratio in [${lo}, ${hi}] (loose cross-check; a breach means a real divergence — fix the counting or, if the methodology gap genuinely widened, widen the bound).
Resultata: ratio ${ratio.toFixed(2)}x.`);
}

// --- The rendered "Waymo cross-check" table (audit #8, #48) ---
// Its section is the heading before the table with id sanity-waymo-check up
// to the next heading, and a metric's row is the one whose published rate is
// that metric's (the three differ several-fold). Until 2026-10-31 the section
// was found by its heading's words and the rows by their labels, which are
// the human's (audit 2026-10-30, QT-09).
vm.runInContext("fullMonthSeries = monthSeriesData(); activeSeries = fullMonthSeries; buildSanityChecks();", ctx);
const html = getNode("sanity-checks").innerHTML;
const at = html.indexOf('id="sanity-waymo-check"');
assert.ok(at >= 0, "Replicata: render the sanity checks. Expectata: a Waymo cross-check table (id sanity-waymo-check). Resultata: none.");
const start = html.lastIndexOf("<h3", at), next = html.indexOf("<h3", at);
const section = html.slice(start, next < 0 ? html.length : next);
const rendered = [...section.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)]
  .map(m => ({label: m[1], ours: m[2], published: m[3], ratio: m[4]}));
const expected = {
  injury: {ours: stats.injury, published: pub.injury, track: "Monthly-track"},
  airbag: {ours: stats.airbag, published: pub.airbag, track: "five-day-track"},
  seriousInjury: {ours: stats.ssi, published: pub.ssi, track: "five-day-track"},
};
assert.equal(rendered.length, Object.keys(expected).length,
  `Replicata: read the Waymo cross-check table's rows. Expectata: one per metric compared (${Object.keys(expected).join(", ")}). Resultata: ${JSON.stringify(rendered)}.`);
for (const [metric, exp] of Object.entries(expected)) {
  // Within 0.5%: both rate columns must show enough digits to reproduce the
  // ratio beside them (2 dp showed the serious-injury+ rates as 0.04 and 0.01).
  const near = (shown, want) => Math.abs(Number(shown) - want) / want <= 0.005;
  const rows = rendered.filter(r => near(r.published, exp.published));
  assert.ok(rows.length === 1,
    `Replicata: find the ${metric} row of the Waymo cross-check: the row whose published rate is ${exp.published.toPrecision(4)} per M mi (WAYMO_PUBLISHED_IPMM, within 0.5%: Waymo's unrounded rate).
Expectata: exactly one.
Resultata: rows ${JSON.stringify(rendered)}.`);
  const row = rows[0];
  assert.ok(near(row.ours, exp.ours),
    `Replicata: read the ${metric} row's own rate in the Waymo cross-check.
Expectata: ${exp.ours.toPrecision(4)} per M mi (within 0.5%; ${exp.track} denominator).
Resultata: ${JSON.stringify(row)}.`);
  assert.equal(row.ratio, `${(exp.ours / exp.published).toFixed(1)}x`,
    `Replicata: read the ${metric} row's ratio in the Waymo cross-check.
Expectata: ${(exp.ours / exp.published).toFixed(1)}x, ours over Waymo's unrounded published rate.
Resultata: ${JSON.stringify(row.ratio)}.`);
}
// No hard-coded ratio here (review, 2026-10-03): the loop above already ties
// every displayed ratio to ours over the published rate, the published column
// to WAYMO_PUBLISHED_IPMM within 0.5%, and human-benchmark-provenance.qual pins
// that constant to the hub's unrounded 0.01106. A literal "3.3x" (the value on
// the 2026-09-15 data) would go red at the next NHTSA release with no code change.
// The note under the table is the human's prose and is not checked (no
// wording pins, 2026-10-28): until 2026-11-03 this qual required it to name
// four report IDs, which the human's edit of that day cut from the note.

console.log(`qual pass: full-history Waymo rates within bounds of Waymo's published figures (injury ${(stats.injury / pub.injury).toFixed(2)}x, airbag ${(stats.airbag / pub.airbag).toFixed(2)}x, serious+ ${(stats.ssi / pub.ssi).toFixed(2)}x); cross-check rows use their track's VMT and unrounded published rates`);

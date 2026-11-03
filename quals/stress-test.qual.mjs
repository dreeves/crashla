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
    this._textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this._attributes = {};
    this.style = {};
    this.value = "0";
    this.classList = { toggle() {} };
  }

  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  get textContent() {
    return this._textContent;
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

  setAttribute(name, value) {
    this._attributes[name] = value;
  }

  getAttribute(name) {
    return this._attributes[name] ?? null;
  }

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
  Number,
  URLSearchParams,
  document: {
    getElementById: getNode,
    createElement: tag => new ElementStub(tag),
    body: new ElementStub("body"),
    addEventListener() {},
  },
  window: {
    innerWidth: 1024,
    innerHeight: 768,
    location: {search: "", pathname: "/crashla", hash: ""},
    history: {replaceState() {}},
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const stress = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const rows = monthlySummaryRows(monthSeriesData());
  buildMonthlyViews();
  buildSanityChecks();
  // The window the sanity section's tables show (the default one, as the page
  // loads): its rows with miles, as renderStressTestTable takes them.
  const shown = windowSummaryRows(activeSeries).filter(r => r.vmtBest > 0);
  return {
    byHelmer: Object.fromEntries(rows.filter(row => row.vmtBest > 0).map(row => [
      row.helmer,
      Object.fromEntries(METRIC_KEYS.filter(key => row.mpiEstimates[key] !== null)
        .map(key => [key, helmerHumanStress(row, key)])),
    ])),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    // null until crashla.js defines it, so the red run reports the check
    cardStressLabel: typeof CARD_STRESS_LABEL === "undefined" ? null : CARD_STRESS_LABEL,
    sanityHtml: document.getElementById("sanity-checks").innerHTML,
    verdictClass: Object.fromEntries(Object.entries(STRESS_VERDICT_META).map(([k, m]) => [k, m.className])),
    verdictLabel: Object.fromEntries(Object.entries(STRESS_VERDICT_META).map(([k, m]) => [k, m.label])),
    // The stress table's rows, a helmer's metrics with an estimate each, and
    // the fault-flip table's, a helmer with an at-fault estimate each: what
    // each row's cells must show, from helmerHumanStress and
    // faultFlipMultiplier (counts and ratios in the app's formats, fmtCount
    // and fmtRatio, which formatting.qual and summary-cards.qual check).
    stressCells: shown.flatMap(r => METRIC_KEYS.filter(key => r.mpiEstimates[key] !== null).map(key => {
      const s = helmerHumanStress(r, key);
      return {company: helmerLabel(r.helmer), metric: s.metric.cardLabel, k: s.av.k, kText: fmtCount(s.av.k),
        av: [s.av.postMedian, s.av.lo, s.av.hi], human: [s.human.lo, s.human.hi],
        ratio: [fmtRatio(s.ratioLo), fmtRatio(s.ratioHi)], verdict: s.verdictKey};
    })),
    flipCells: shown.filter(r => r.mpiEstimates.atfault !== null).map(r => {
      const s = helmerHumanStress(r, "atfault");
      const flip = faultFlipMultiplier(s.av, s.human, r.incTotal);
      return {company: helmerLabel(r.helmer), k: s.av.k, kText: fmtCount(s.av.k), verdict: s.verdictKey,
        mult: flip === null ? null : flip.mult === Infinity ? "Infinity" : fmtRatio(flip.mult),
        flipped: flip === null ? null : flip.flipped};
    }),
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(stress));

assert.equal(
  plain.byHelmer.Tesla.all.verdictKey,
  "ambiguous",
  `Replicata: compute stress-test verdict for Tesla on all incidents.
Expectata: Tesla all-incident claim is assumption-sensitive (Feb 2026 VMT widens CI).
Resultata: verdict was ${plain.byHelmer.Tesla.all.verdictKey}.`,
);

assert.equal(
  plain.byHelmer.Waymo.all.verdictKey,
  "ambiguous",
  `Replicata: compute stress-test verdict for Waymo on all incidents.
Expectata: Waymo all-incident claim remains assumption-sensitive rather than robust.
Resultata: verdict was ${plain.byHelmer.Waymo.all.verdictKey}.`,
);

// hospitalization joined this list 2026-10-03 (audit #1): on the
// CRSS-measured transport band (406k-1.38M; 402k-1.38M since 2026-10-27)
// Waymo's ratio floor is ~2.7x; on
// the old severity-neighbour bracket (617k-4.695M) it read "ambiguous".
for (const key of ["atfault", "injury", "hospitalization", "airbag", "seriousInjury"]) {
  assert.equal(
    plain.byHelmer.Waymo[key].verdictKey,
    "safer",
    `Replicata: compute stress-test verdict for Waymo on ${key}.
Expectata: Waymo is robustly safer than humans on ${key}.
Resultata: verdict was ${plain.byHelmer.Waymo[key].verdictKey}.`,
  );
}

// Nonstationary bands (audit #2, 2026-10-03). Until then the human bands
// removed a parked-car share their in-transport benchmark never held and kept
// the vehicles stopped in traffic that the AV side drops; Tesla's
// non-parking-lot verdict read "robustly safer" on a 1.8% margin
// (232,055 / 228,000). With the CRSS stopped-in-roadway share removed
// (AV cities 121k-251k) its floor is ~0.92x: ambiguous. Waymo stays safer on
// both nonstationary metrics. Tesla's floor will rise as its miles grow;
// re-pin when a release or VMT re-pin moves it past 1x.
assert.equal(plain.byHelmer.Tesla.roadwayNonstationary.verdictKey, "ambiguous",
  `Replicata: compute the stress verdict for Tesla on nonstationary non-parking-lot incidents.
Expectata: ambiguous — the AV/human ratio floor sits below 1x once the human band drops the vehicles stopped in the roadway (CRSS 2024), as the AV side drops its 0-mph incidents.
Resultata: ${plain.byHelmer.Tesla.roadwayNonstationary.verdictKey} at ${plain.byHelmer.Tesla.roadwayNonstationary.ratioLo}x–${plain.byHelmer.Tesla.roadwayNonstationary.ratioHi}x.`);
for (const key of ["nonstationary", "roadwayNonstationary"]) {
  assert.equal(plain.byHelmer.Waymo[key].verdictKey, "safer",
    `Replicata: compute the stress verdict for Waymo on ${key}.
Expectata: robustly safer on the CRSS-derived nonstationary band.
Resultata: ${plain.byHelmer.Waymo[key].verdictKey} at ${plain.byHelmer.Waymo[key].ratioLo}x–${plain.byHelmer.Waymo[key].ratioHi}x.`);
}

// byHelmer rows are the FULL series. This verdict sits ON the 1.00x knife
// edge and therefore moves with the receipt frontier every release:
//   - before 2026-08-28: ambiguous, ceiling exactly 1.00x
//   - 2026-08-28: flipped to worse, because capping the data-through month's
//     exposure by receipt coverage trimmed the effective-VMT upper edge
//   - 2026-09-15: flipped BACK to ambiguous, ceiling 1.0010x. The Sep-15
//     release advanced the cutoff to 2026-08, so 2026-07 is no longer the
//     capped month: its coverage_max went 0.52 -> 1.0 in data/vmt.js, which
//     restores the very upper-edge miles the previous release had trimmed.
//     (coverage_max is what sets ratioHi, so the same release's 0.31 -> 0.28
//     best / 0.25 -> 0.20 lo re-measurement does NOT bear on this.)
//   - 2026-09-25: worse again, ceiling 0.978x. The explicit operator scope
//     (operator-scope.qual) counts 30610-11752, an unoccupied Zoox rear-ended
//     in Las Vegas in SEP-2025 that the old "None"-only filter dropped because
//     NHTSA coded it "Remote (Commercial / Test)": one more real in-scope
//     incident over the same driverless miles.
//   - 2026-10-03: still worse, ceiling 0.978x -> 0.90x, from the CA DMV
//     rebuild of Zoox's early rows and the Dec-2025 knot (see the default-
//     window pin below).
//   - 2026-10-04: still worse, ceiling 0.902x -> 0.891x: the Monthly-report
//     lag model (data/slurp.py MONTHLY_ARRIVAL_LAG) thins Zoox's 2026-07
//     Monthly-track miles to its 5-Day share, 0.63 [0.25, 1.0], because its
//     July Monthly reports are not in the Sep-15-2026 file yet.
//   - by 7b348ce (2026-10-27, after the Oct-15 release): still worse, 0.839x.
//   - 2026-10-27 (later): still worse, 0.839x -> 0.865x: Zoox's 2026 rows
//     rebuilt on the per-day rate between its statements (0.821x in d73ce85,
//     whose end-July knot still had a ceiling; 0.865x once the July
//     statement became a floor only).
//   - 2026-11-02: still worse, 0.8648x -> 0.8657x: the smooth 2025 path
//     (open question 21) raised the Jan 1-Mar 24 rate, and with it the
//     end-March knot's upper edge and every later one, by 5,833 miles.
// Expect this assertion to keep alternating; re-pin it each release rather
// than treating either direction as the stable truth.
assert.ok(
  plain.byHelmer.Zoox.all.verdictKey === "worse" && plain.byHelmer.Zoox.all.ratioHi < 1,
  `Replicata: compute the full-history stress verdict for Zoox on all incidents.
Expectata: worse — with 30610-11752 counted, the AV/human ratio ceiling sits just below 1x.
Resultata: ${plain.byHelmer.Zoox.all.verdictKey} at ${plain.byHelmer.Zoox.all.ratioLo}x–${plain.byHelmer.Zoox.all.ratioHi}x.`,
);

// Default slider window (what the page shows on load). Also a knife edge,
// pinned separately so neither window's verdict is silently carried by the
// other's:
//   - through 2026-10-02: ambiguous, ceiling just above 1x (1.0486x)
//   - 2026-10-03: worse, ceiling 0.980x. Two VMT changes moved it: the CA DMV
//     rebuild of Zoox's early rows (approved 2026-09-29; 40,080 pre-series
//     miles now come off the official 1.3M, ceiling 1.0486x -> 1.0023x) and the
//     Dec-2025 knot that pins the cumulative band to that disclosure's own
//     uncertainty (audit finding #18; 1.0023x -> 0.980x).
//   - 2026-10-04: still worse, ceiling 0.980x -> 0.968x, from the
//     Monthly-report lag model (Zoox's 2026-07 at its 5-Day share).
//   - by 7b348ce (2026-10-27, after the Oct-15 release): still worse, 0.898x.
//   - 2026-10-27 (later): still worse, 0.898x -> 0.926x, the Zoox 2026
//     rebuild (0.874x in d73ce85, with the end-July ceiling).
//   - 2026-11-02: still worse, 0.9258x -> 0.9269x, the smooth 2025 path (the
//     same 5,833 miles on the window's upper edge).
// Re-pin it like the full-history one when a release or a VMT re-pin moves it.
const zooxDefault = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const row = monthlySummaryRows(activeSeries).find(r => r.helmer === "Zoox");
  const stress = helmerHumanStress(row, "all");
  return {verdictKey: stress.verdictKey, ratioHi: stress.ratioHi, k: stress.av.k, months: [activeSeries.months[0], activeSeries.months[activeSeries.months.length - 1]]};
})()
`, ctx)));
assert.ok(zooxDefault.verdictKey === "worse" && zooxDefault.ratioHi < 1,
  `Replicata: compute the default-window stress verdict for Zoox on all incidents.
Expectata: worse, with the AV/human ratio ceiling just below 1x (the Dec-2025 knot on Zoox's official 1.3M disclosure narrows the window's VMT band).
Resultata: ${JSON.stringify(zooxDefault)}.`);

// Magnitude drift guard on Tesla's optimistic edge (the straddles-1x claim
// itself is the verdictKey assert above). Bound moved 3 -> 3.5 on 2026-07-22
// when the Tesla denominator was re-anchored to the deck-chart series
// (default-window VMT +16% moved ratioHi 2.78 -> 3.23 proportionally).
assert.ok(
  plain.byHelmer.Tesla.all.ratioHi < 3.5,
  `Replicata: inspect Tesla all-incident AV/human ratio range.
Expectata: Tesla's CI still straddles 1x human safety rather than being robustly safe.
Resultata: ratio range was ${plain.byHelmer.Tesla.all.ratioLo}x to ${plain.byHelmer.Tesla.all.ratioHi}x.`,
);

assert.ok(
  plain.byHelmer.Waymo.atfault.ratioLo > 1,
  `Replicata: inspect Waymo at-fault AV/human ratio range.
Expectata: even Waymo's pessimistic edge remains above 1x human safety.
Resultata: ratio range was ${plain.byHelmer.Waymo.atfault.ratioLo}x to ${plain.byHelmer.Waymo.atfault.ratioHi}x.`,
);

// The cards' stress line is the All-incidents verdict, headed
// CARD_STRESS_LABEL (it read "Overall:" until 2026-10-03, audit #6;
// summary-cards.qual checks the line itself). Until 2026-10-29 this also
// banned the word "Overall:" and found an ambiguous verdict by its word; the
// verdict is now found by its badge's class (STRESS_VERDICT_META).
const badge = key => `class="stress-badge ${plain.verdictClass[key]}`;
assert.ok(
  plain.cardStressLabel !== null &&
    plain.summaryCardHtml.includes(`<div class="mpi-card-stress">${plain.cardStressLabel} `) &&
    plain.summaryCardHtml.includes(badge("ambiguous")),
  `Replicata: render top summary cards with stress labels.
Expectata: each stress line is headed CARD_STRESS_LABEL (the All-incidents verdict), and ambiguous verdict badges appear.
Resultata: label ${JSON.stringify(plain.cardStressLabel)}; summary card HTML snippet was ${JSON.stringify(plain.summaryCardHtml.slice(0, 400))}.`,
);

// A table's body rows (by the table's id), each as its cells' markup.
const tableRows = id => {
  const table = (new RegExp(`<table[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/table>`).exec(plain.sanityHtml) || [])[1] || "";
  return [...((/<tbody>([\s\S]*?)<\/tbody>/.exec(table) || [])[1] || "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]));
};
const cellText = cell => (cell || "").replace(/<[^>]*>/g, "");
const cellFigures = cell => cellText(cell).match(/\d[\d,]*(?:\.\d+)?/g) || [];
const whole = n => Math.round(n).toLocaleString("en-US");
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// A verdict badge: its classes after stress-badge, sorted, and its text; a
// verdict on zero incidents adds prior-only (sanity-values.qual checks its tip).
const badgeOf = cell => {
  const m = /<span class="stress-badge ([^"]*)"[^>]*>([^<]*)<\/span>/.exec(cell || "");
  return m === null ? null : { classes: m[1].split(" ").sort(), label: m[2] };
};
const wantBadge = (verdict, priorOnly) => ({
  classes: [plain.verdictClass[verdict], ...(priorOnly ? ["prior-only"] : [])].sort(),
  label: escHtml(plain.verdictLabel[verdict]),
});

// The sanity section's stress table (id sanity-stress): a row per helmer
// metric with an estimate, robustly safer among them, its seven cells what
// helmerHumanStress computes: the company and metric (their labels), the
// incident count k, the AV's posterior median and 95% CI, the AV-cities human
// band, the AV/human ratio range, and the verdict's badge (marked prior-only
// at k = 0). Until 2026-10-29 this checked the heading's, the ratio column's
// and the safer verdict's words; until 2026-10-31 only the ratio cell and the
// badge's first class (audit 2026-10-30, QTV-M1 and QT-02: the median shown
// as the CI's upper edge, the human band's low edge halved, and every badge's
// prior-only marking inverted all passed).
{
  const rows = tableRows("sanity-stress");
  const want = plain.stressCells.map(c => [escHtml(c.company), escHtml(c.metric), c.kText, c.av.map(whole), c.human.map(whole),
    `${c.ratio[0]}x – ${c.ratio[1]}x`, wantBadge(c.verdict, c.k === 0)]);
  const got = rows.map(cells => [cells[0], cells[1], cellText(cells[2]), cellFigures(cells[3]), cellFigures(cells[4]),
    cells[5], badgeOf(cells[6])]);
  const wrong = want.map((w, i) => [i, w, got[i]]).filter(([i, w, g]) => rows[i] === undefined || rows[i].length !== 7 || JSON.stringify(g) !== JSON.stringify(w));
  assert.ok(
    want.length > 0 && rows.length === want.length && wrong.length === 0 && plain.stressCells.some(c => c.verdict === "safer"),
    `Replicata: render the skeptical stress-test sanity subsection (default window) and read every cell of the stress table.
Expectata: a row per helmer metric with an estimate (${want.length} rows), a robustly safer one among them, each of seven cells: company, metric, k, the AV's median then 95% CI, the human band, the AV/human ratio range, and the verdict's badge (prior-only at k = 0), as helmerHumanStress computes them.
Resultata: ${rows.length} rows; ${wrong.length} differ, e.g. ${JSON.stringify(wrong.slice(0, 3).map(([i, w, g]) => ({ row: i + 1, want: w, got: g })))}.`,
  );
}

// Faultfrac sensitivity: smallest multiplier on the judged at-fault mass that
// changes the verdict. (Serialized as strings because Infinity doesn't
// survive JSON.)
const flips = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const rows = monthlySummaryRows(monthSeriesData()).filter(r => r.vmtBest > 0);
  const out = {};
  for (const row of rows) {
    const stress = helmerHumanStress(row, "atfault");
    const flip = faultFlipMultiplier(stress.av, stress.human, row.incTotal);
    out[row.helmer] = flip === null ? null : {mult: String(flip.mult), flipped: flip.flipped, sMax: row.incTotal / stress.av.k};
  }
  return {out,
    distHtml: document.getElementById("chart-distributions").innerHTML,
    distHeading: document.getElementById("dist-heading").textContent,
    metricLabel: selectedMonthMetric().label,
    window: [activeSeries.months[0], activeSeries.months[activeSeries.months.length - 1]]};
})()
`, ctx)));

assert.ok(
  flips.out.Waymo !== null &&
    Number(flips.out.Waymo.mult) > 1 && Number.isFinite(Number(flips.out.Waymo.mult)) &&
    flips.out.Waymo.flipped === "ambiguous",
  `Replicata: compute the faultfrac flip multiplier for Waymo's at-fault verdict.
Expectata: a finite multiplier > 1 at which "robustly safer" degrades to "ambiguous".
Resultata: flip was ${JSON.stringify(flips.out.Waymo)}.`,
);

// Tesla: 8.55 judged at-fault incidents out of 23 (2026-09-26 data; 6.65 of
// 24 when written). Even with every one of the 23 at fault (s = 2.69) the
// verdict stays ambiguous, so the flip is unreachable: the multiplier must be
// Infinity, not the 5.85x (39 at-fault incidents out of 24) the uncapped
// search reported until 2026-09-04.
assert.ok(
  flips.out.Tesla !== null && flips.out.Tesla.mult === "Infinity" && flips.out.Tesla.flipped === null &&
    flips.out.Tesla.sMax < 10,
  `Replicata: compute the faultfrac flip multiplier for Tesla's at-fault verdict with the incident-count cap.
Expectata: unreachable — mult Infinity, flipped null, because every Tesla incident at fault (s = incidents / k) leaves the verdict ambiguous.
Resultata: flip was ${JSON.stringify(flips.out.Tesla)}.`,
);
assert.ok(
  Number(flips.out.Waymo.mult) < flips.out.Waymo.sMax,
  `Replicata: compare Waymo's flip multiplier to its cap (incidents / judged at-fault mass).
Expectata: the flip is feasible (multiplier below the cap), so a finite value is reported.
Resultata: flip was ${JSON.stringify(flips.out.Waymo)}.`,
);

// --- The shared shift toward 1 (decision #3 of the 2026-10-04 audit) ------
// faultFlipMultiplier moves every incident's fault probability toward 1 by
// one shared fraction t, p -> p + (1 - p)t, over the n incidents of the
// metric the fault fractions are taken over (All incidents for at-fault,
// Injury for at-fault injury), and reports s = (shifted mass) / (judged mass)
// = 1 + (n/k - 1)t. At t = 0 the shifted mixture is the displayed at-fault
// posterior's, exactly; at t = 1 every incident is at fault, so it is that
// universe metric's posterior, exactly, and the cap s = n/k is reachable.
// Until 2026-10-31 the search scaled each Poisson-binomial component's mass
// (a_K = K·s + 1/2) with fixed weights, so the K = 0 component (Zoox's
// P(K = 0) = 0.0976) kept its weight at every s and Zoox read ∞ in the
// default window beside an All-incidents verdict of robustly worse.
const shift = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  if (typeof shiftedFaultComponents === "undefined") return null;
  const full = monthSeriesData();
  const months = full.months, last = months.length - 1;
  const out = [];
  for (const [name, a] of [["default", months.indexOf(DEFAULT_START_MONTH)], ["full", 0]]) {
    for (const row of monthlySummaryRows(sliceSeries(full, a, last)).filter(r => r.vmtBest > 0)) {
      for (const [key, universe, n] of [["atfault", "all", row.incTotal], ["atfaultInjury", "injury", row.incInjury]]) {
        const est = row.mpiEstimates[key], whole = row.mpiEstimates[universe];
        if (est === null || est.k === 0) continue;
        out.push({window: name, helmer: row.helmer, key, n, k: est.k,
          t0: JSON.stringify(shiftedFaultComponents(est, n, 0)) === JSON.stringify(est.comps),
          t1: JSON.stringify(shiftedFaultComponents(est, n, 1)) === JSON.stringify(whole.comps),
          band: [est.vmtMin, est.vmtBest, est.vmtMax].join() === [whole.vmtMin, whole.vmtBest, whole.vmtMax].join()});
      }
    }
  }
  return out;
})()
`, ctx)));
assert.ok(shift !== null && shift.length >= 12 && shift.every(r => r.t0 && r.t1 && r.band),
  `Replicata: for every company's at-fault and at-fault-injury estimate (k > 0) in the default window and the full history, build the shared-shift mixture (shiftedFaultComponents) at t = 0 and at t = 1.
Expectata: at t = 0 exactly the displayed estimate's mixture components; at t = 1 exactly the components of the metric the fault fractions are taken over (All incidents, Injury), on the same VMT band, so the shifted posterior there is that metric's.
Resultata: ${shift === null ? "crashla.js defines no shiftedFaultComponents" : JSON.stringify(shift.filter(r => !(r.t0 && r.t1 && r.band)).slice(0, 4)) + ` (${shift.length} estimates checked)`}.`);

// The default window's fault-flip table (what the page shows on load), at the
// fault values and VMT of 2026-10-31 (NHTSA's Oct-15-2026 release): Zoox's
// multiplier is finite, the verdict it reaches is its All-incidents verdict
// (robustly worse), as at the cap (t = 1); Waymo's "robustly safer" lasts to
// 4.45x (4.3x on the old scaling, two figures); Tesla's and its no-monitor
// line's verdicts stay ambiguous at the cap, as their All-incidents ones do.
// Like the knife-edge pins above, these values move with the data: re-pin
// them when a release or a VMT or fault re-pin moves them.
const defaultFlips = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const full = monthSeriesData();
  const rows = monthlySummaryRows(sliceSeries(full, full.months.indexOf(DEFAULT_START_MONTH), full.months.length - 1))
    .filter(r => r.vmtBest > 0 && r.mpiEstimates.atfault !== null);
  return Object.fromEntries(rows.map(row => {
    const stress = helmerHumanStress(row, "atfault");
    const flip = faultFlipMultiplier(stress.av, stress.human, row.incTotal);
    return [row.helmer, {mult: flip === null ? null : flip.mult === Infinity ? "∞" : fmtRatio(flip.mult) + "x",
      flipped: flip && flip.flipped, all: helmerHumanStress(row, "all").verdictKey}];
  }));
})()
`, ctx)));
const WANT_DEFAULT_FLIPS = {
  Tesla: {mult: "∞", flipped: null, all: "ambiguous"},
  TeslaNoMonitor: {mult: "∞", flipped: null, all: "ambiguous"},
  Waymo: {mult: "4.45x", flipped: "ambiguous", all: "ambiguous"},
  Zoox: {mult: "18.1x", flipped: "worse", all: "worse"},
};
assert.deepEqual(defaultFlips, WANT_DEFAULT_FLIPS,
  `Replicata: compute the default window's fault-flip multipliers (faultFlipMultiplier, printed by fmtRatio) and each company's All-incidents verdict.
Expectata: ${JSON.stringify(WANT_DEFAULT_FLIPS)}: Zoox's multiplier finite and its verdict after the flip its All-incidents verdict.
Resultata: ${JSON.stringify(defaultFlips)}.`);

// The k=0 branch: with no judged at-fault mass the multiplier s (the shifted
// mass over the judged mass) has no value, and the search reports null, as
// it did when it scaled the judged mass (which could never change a verdict
// at k = 0). Tested with a synthetic estimate rather than whichever helmer
// happens to have zero mass this month (Zoox was zero until its incidents
// were rated).
const zeroMassFlip = vm.runInContext(
  `faultFlipMultiplier({k: 0, vmtMin: 1e5, vmtBest: 2e5, vmtMax: 4e5, lo: 1, hi: 1}, {lo: 1e5, hi: 3e5}, 5)`,
  ctx);
assert.equal(
  zeroMassFlip,
  null,
  `Replicata: call faultFlipMultiplier with a synthetic estimate whose judged at-fault mass k is 0.
Expectata: null — scaling zero mass can never change the verdict.
Resultata: flip was ${JSON.stringify(zeroMassFlip)}.`,
);

// Every helmer with VMT yields a usable flip entry (non-null once it has any
// judged mass); guards against the table silently dropping a row.
for (const helmer of ["Tesla", "Waymo", "Zoox"]) {
  assert.ok(
    flips.out[helmer] !== null && flips.out[helmer] !== undefined,
    `Replicata: read the faultfrac flip entry for ${helmer}.
Expectata: a non-null flip entry (all three helmers now have judged at-fault mass > 0).
Resultata: entry was ${JSON.stringify(flips.out[helmer])}.`,
  );
}

// The faultfrac sensitivity table (id sanity-fault-flip) renders in the same
// section as the stress table, a row per helmer with an at-fault estimate,
// its five cells what faultFlipMultiplier computes for it: the company, the
// judged at-fault mass k, the current verdict's badge (prior-only at k = 0),
// the flip multiplier (fmtRatio and "x", "∞" where no feasible multiplier
// flips the verdict, no figure where there is no judged mass to scale) and
// the verdict after the flip (no badge where there is none). Until 2026-10-29
// this checked its headers' words; until 2026-10-31 only its five cells a
// row (audit 2026-10-30, QTV-M1: Waymo's 4.4x printed as "∞" passed).
{
  const at = plain.sanityHtml.indexOf('id="sanity-fault-flip"');
  const sameSection = at >= 0 && plain.sanityHtml.lastIndexOf("<h3", at) === plain.sanityHtml.lastIndexOf("<h3", plain.sanityHtml.indexOf('id="sanity-stress"'));
  const rows = tableRows("sanity-fault-flip");
  const multShown = c => c.mult === null ? { none: true } : c.mult === "Infinity" ? "∞" : `${c.mult}x`;
  const wrong = plain.flipCells.map((c, i) => {
    const cells = rows[i] || [];
    const multCell = cells[3] === undefined ? null : c.mult === null
      ? { none: cellFigures(cells[3]).length === 0 && !cellText(cells[3]).includes("∞") && badgeOf(cells[3]) === null }
      : cellText(cells[3]);
    const flipped = cells[4] === undefined ? undefined : c.flipped === null
      ? (badgeOf(cells[4]) === null && cellFigures(cells[4]).length === 0 ? null : { shown: cellText(cells[4]) })
      : badgeOf(cells[4]);
    const want = [escHtml(c.company), c.kText, wantBadge(c.verdict, c.k === 0), multShown(c), c.flipped === null ? null : wantBadge(c.flipped, false)];
    const got = [cells[0], cellText(cells[1]), badgeOf(cells[2]), multCell, flipped];
    return cells.length === 5 && JSON.stringify(got) === JSON.stringify(want) ? null : { row: i + 1, want, got };
  }).filter(x => x !== null);
  assert.ok(
    sameSection && rows.length === plain.flipCells.length && wrong.length === 0,
    `Replicata: render the sanity-checks sensitivity subsection (default window) and read every cell of the faultfrac sensitivity table.
Expectata: the table renders in the stress table's section, a row of five cells for each of the ${plain.flipCells.length} helmers with an at-fault estimate: company, judged fault, current verdict (prior-only at k = 0), flip multiplier and verdict after the flip, as faultFlipMultiplier computes them.
Resultata: ${at < 0 ? "no table with id sanity-fault-flip" : `same section ${sameSection}; ${rows.length} rows; ${wrong.length} differ, e.g. ${JSON.stringify(wrong.slice(0, 3))}`}.`,
  );
}

// The distributions container holds exactly one chart for the slider-selected
// window: no second trailing-window chart, no constant-rate note, and no
// in-body heading (the title is in the #dist-heading section header, which
// names the selected metric, by its label, and the window's first and last
// months). Recency is controlled by the date-range slider. Until 2026-10-29
// this also banned the old title suffixes' words ("Aggregated", "Trailing")
// and found the window in the heading by its words ("using data from").
{
  const months = flips.distHeading.match(/\d{4}-\d{2}/g) || [];
  assert.ok(
    (flips.distHtml.match(/<svg[\s>]/g) || []).length === 1 &&
      !/<h3[\s>]/.test(flips.distHtml) &&
      !flips.distHtml.includes("dist-note") &&
      flips.distHeading.includes(flips.metricLabel) &&
      JSON.stringify(months) === JSON.stringify(flips.window),
    `Replicata: build monthly views and inspect the chart-distributions container and #dist-heading.
Expectata: one chart body (one <svg>) with no in-body <h3>/note; the section header names the metric (${JSON.stringify(flips.metricLabel)}) and the window's months ${JSON.stringify(flips.window)}.
Resultata: heading ${JSON.stringify(flips.distHeading)}; body head ${JSON.stringify(flips.distHtml.slice(0, 120))}.`,
  );
}

// --- Fault-flip search next to a band edge (audit #5, 2026-10-03) ---------
// Until 2026-10-03 the flip search ran a light CDF (mixture trimmed at 1e-4,
// 13 prior nodes) whose CI edges sat up to ~0.7% from the displayed ones on
// the widest-band month, and asserted its own s = 1 verdict equal to the
// displayed one: a CI edge inside that gap threw, and the throw blanked the
// sanity section and the incident browser for the window (reproduced on live
// data: three faultfracs moved, Waymo 2026-08 CI low 432,887 against the
// 430,000 band top). Spec: next to an edge the search never throws, measures
// from the displayed verdict, and reports a flip in the direction more
// at-fault mass moves it (toward "worse"), at a multiplier just above 1. A CI
// that does not belong to its estimate (far from every edge) still throws.
{
  const near = JSON.parse(JSON.stringify(vm.runInContext(`
  (() => {
    // Waymo-like single month: judged at-fault mass 1.3 over four incidents,
    // on 2026-08's effective at-fault VMT band (the widest of the series).
    const est = estimateMpiWindow(1.3, [0.9, 0.2, 0.1, 0.1], 800818, 1931503, 13342289);
    // The page's displayed rule (the stress table's): robustly safer when the
    // whole ratio range is above 1, robustly worse when it is below 1.
    const displayed = human => est.lo / human.hi > 1 ? "safer" : est.hi / human.lo < 1 ? "worse" : "ambiguous";
    const run = (edge, r, human, expectFlip) => {
      let flip = null, err = null;
      try { flip = faultFlipMultiplier(est, human, 4); } catch (e) { err = e.message; }
      return {edge, r, displayed: displayed(human), expectFlip, err,
        flip: flip && {base: flip.base, flipped: flip.flipped, mult: String(flip.mult)}};
    };
    const cases = [];
    // Band top just under the CI low edge (ratio floor r): displayed "safer".
    for (const r of [1.0002, 1.0005, 1.001, 1.002, 1.003, 1.004, 1.005, 1.006, 1.01, 1.02]) {
      cases.push(run("low", r, {lo: 103000, hi: est.lo / r}, "ambiguous"));
    }
    // Band bottom just under the CI high edge (ratio ceiling 1/r): displayed "ambiguous".
    for (const r of [0.9998, 0.9995, 0.999, 0.998, 0.997, 0.996, 0.995]) {
      cases.push(run("high", r, {lo: est.hi * r, hi: est.hi * r * 4.2}, "worse"));
    }
    // A CI that is not this mixture's (low edge inflated 1.5x) against a band
    // top 20% under the true edge: the search's own CDF verdict disagrees
    // with the displayed one 22% (in ln) from the band edge, far outside
    // numerical error.
    let corruptErr = null;
    try { faultFlipMultiplier({...est, lo: est.lo * 1.5}, {lo: 103000, hi: est.lo * 1.2}, 4); }
    catch (e) { corruptErr = e.message; }
    return {lo: est.lo, hi: est.hi, cases, corruptErr};
  })()
  `, ctx)));
  for (const c of near.cases) {
    const ok = c.err === null && c.flip !== null &&
      c.flip.base === c.displayed && c.flip.flipped === c.expectFlip &&
      Number(c.flip.mult) > 1 && Number(c.flip.mult) < 1.05;
    assert.ok(ok,
      `Replicata: faultFlipMultiplier on a Waymo-like k = 1.3 estimate (CI ${Math.round(near.lo)} - ${Math.round(near.hi)}) with the AV-cities band's ${c.edge === "low" ? "top at CI low / " + c.r : "bottom at CI high x " + c.r}.
Expectata: no throw; base verdict = the displayed one (${c.displayed}); a flip to ${c.expectFlip} at a multiplier in (1, 1.05).
Resultata: ${JSON.stringify(c)}.`);
  }
  assert.ok(near.corruptErr !== null && /disagrees/.test(near.corruptErr),
    `Replicata: faultFlipMultiplier on an estimate whose displayed CI low edge is 1.5x its own mixture's, against a band top 20% under the true edge.
Expectata: it throws (the CI does not belong to the estimate: the search's own verdict at s = 1 disagrees with the displayed one far from any band edge).
Resultata: ${JSON.stringify(near.corruptErr)}.`);
}

console.log("qual pass: skeptical stress test classifies headline safety claims");

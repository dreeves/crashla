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
    cohortLabel: helmerLabel("HumansAV"),
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(stress));

// --- Every estimate, in the default window and over the full history -------
// Until 2026-11-17 this qual pinned verdicts and ratio edges on live data:
// Tesla's and Waymo's All-incidents verdicts ("ambiguous"), Waymo's "robustly
// safer" on seven metrics, Tesla's non-parking-lot verdict, Zoox's
// All-incidents verdict in both windows (a knife edge whose comment here
// carried nine dated notes of data moving it or nearly moving it between
// 2026-08-28 and 2026-11-03; AGENTS.md's ledger has each), Tesla's ratio ceiling under 3.5x and Waymo's at-fault
// floor above 1x. Each was copied from the page's own output and re-pinned
// when a release or a VMT or fault change moved it, so what it tested was the
// re-pinning. The human, 2026-11-17: "maybe they should be sanity checks,
// like only failing on insane numbers, not merely mildly surprising
// numbers?", then "sure, convert outcome pins to sanity check ranges". So no
// verdict is required of any company now. For every line with miles and
// every metric it has an estimate for, in both windows:
//   - what the page derives, exactly: the human band is the metric's Humans
//     (AV cities) band, read here from the metric itself
//     (METRIC_BY_KEY[key].humanMPI.HumansAV: until 2026-11-21 this qual took
//     the band from helmerHumanStress, the function under test, so a
//     comparison against the US-average band under the table's AV-cities
//     header passed every qual, whatever verdicts it moved; audit
//     2026-11-20, A20; the band depends on the metric alone, so this also holds the
//     band of every fault-flip search and of every row of the two tables
//     checked below, which take it from the same call); the ratio range is
//     the AV's 95% CI over that band (floor: CI low over the band's top;
//     ceiling: CI high over the band's bottom), and the verdict follows from
//     it (robustly safer when the floor is above 1x, robustly worse when the
//     ceiling is below 1x, else ambiguous);
//   - sanity ranges, wide enough that only a broken figure leaves them (a
//     unit error, a dropped denominator, a NaN): the count is finite and not
//     negative; the CI is positive, ordered and holds the median; the ratio
//     floor lies in RATIO_FLOOR and the ceiling in RATIO_CEILING (seen on
//     2026-11-17: 0.0045x-21.6x and 0.88x-46,489x); with ENOUGH incidents or
//     more behind it, the median over the human band's geometric centre lies
//     in CENTRE (seen: 0.45-10.4), and an All-incidents median in ALL_MPI
//     miles per incident (seen: 65,182-190,605).
// And each window holds every company, with an All-incidents estimate on at
// least one incident.
const RATIO_FLOOR = [1e-7, 1e4], RATIO_CEILING = [1e-3, 1e9], CENTRE = [0.05, 100], ALL_MPI = [1e4, 1e7], ENOUGH = 20;
const estimates = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const full = monthSeriesData();
  const out = [];
  for (const [name, first] of [["default", full.months.indexOf(DEFAULT_START_MONTH)], ["full", 0]]) {
    for (const row of monthlySummaryRows(sliceSeries(full, first, full.months.length - 1)).filter(r => r.vmtBest > 0)) {
      for (const key of METRIC_KEYS.filter(k => row.mpiEstimates[k] !== null)) {
        const s = helmerHumanStress(row, key);
        out.push({window: name, helmer: row.helmer, key, k: s.av.k, median: s.av.postMedian, lo: s.av.lo, hi: s.av.hi,
          human: [s.human.lo, s.human.hi], cohort: [METRIC_BY_KEY[key].humanMPI.HumansAV.lo, METRIC_BY_KEY[key].humanMPI.HumansAV.hi],
          ratioLo: s.ratioLo, ratioHi: s.ratioHi, verdict: s.verdictKey});
      }
    }
  }
  return {out, companies: ADS_HELMERS};
})()
`, ctx)));
const inRange = (x, [a, b]) => Number.isFinite(x) && x >= a && x <= b;
const verdictOf = (ratioLo, ratioHi) => ratioLo > 1 ? "safer" : ratioHi < 1 ? "worse" : "ambiguous";
const estimateProblems = estimates.out.flatMap(e => {
  const centre = e.median / Math.sqrt(e.human[0] * e.human[1]);
  return [
    [Number.isFinite(e.k) && e.k >= 0, `a count of ${e.k}`],
    [[e.lo, e.median, e.hi].every(v => Number.isFinite(v) && v > 0) && e.lo <= e.median && e.median <= e.hi,
      `a median and 95% CI of ${e.median} [${e.lo}, ${e.hi}]`],
    [e.human.every(v => Number.isFinite(v) && v > 0) && e.human[0] <= e.human[1], `a human band of ${JSON.stringify(e.human)}`],
    [e.human[0] === e.cohort[0] && e.human[1] === e.cohort[1], `a human band of ${JSON.stringify(e.human)}, where the metric's AV-cities band is ${JSON.stringify(e.cohort)}`],
    [e.ratioLo === e.lo / e.human[1] && e.ratioHi === e.hi / e.human[0],
      `a ratio range of ${e.ratioLo}x to ${e.ratioHi}x for a CI of [${e.lo}, ${e.hi}] over the band ${JSON.stringify(e.human)}`],
    [e.verdict === verdictOf(e.ratioLo, e.ratioHi), `the verdict ${JSON.stringify(e.verdict)} on a ratio range of ${e.ratioLo}x to ${e.ratioHi}x`],
    [inRange(e.ratioLo, RATIO_FLOOR) && inRange(e.ratioHi, RATIO_CEILING), `a ratio range of ${e.ratioLo}x to ${e.ratioHi}x, outside the sanity ranges`],
    [e.k < ENOUGH || inRange(centre, CENTRE), `a median ${centre} times the human band's centre, on ${e.k} incidents`],
    [e.k < ENOUGH || e.key !== "all" || inRange(e.median, ALL_MPI), `an All-incidents median of ${e.median} miles per incident, on ${e.k} incidents`],
  ].filter(([ok]) => !ok).map(([, what]) => `${e.window} ${e.helmer} ${e.key}: ${what}`);
});
const absent = ["default", "full"].flatMap(w => estimates.companies
  .filter(h => !estimates.out.some(e => e.window === w && e.helmer === h && e.key === "all" && e.k >= 1))
  .map(h => `${w} ${h}: no All-incidents estimate on at least one incident`));
assert.deepEqual([...estimateProblems, ...absent], [],
  `Replicata: compute helmerHumanStress for every line with miles and every metric it has an estimate for, in the default window and over the full history (${estimates.out.length} estimates).
Expectata: each human band is its metric's ${plain.cohortLabel} band (METRIC_BY_KEY[key].humanMPI.HumansAV), each ratio range is the AV's 95% CI over it and its verdict follows from it (safer above 1x, worse below 1x, else ambiguous); each figure is sane: a finite count, a positive ordered CI holding its median, a ratio floor in [${RATIO_FLOOR}] and ceiling in [${RATIO_CEILING}], and with ${ENOUGH} incidents or more a median within x${CENTRE[0]} to x${CENTRE[1]} of the human band's centre and an All-incidents median of ${ALL_MPI[0]} to ${ALL_MPI[1]} miles per incident; and each window holds ${estimates.companies.join(", ")} with an All-incidents estimate. No verdict is required of any company: a figure outside a sanity range is broken, or news worth a look before the range moves.
Resultata: ${estimateProblems.length + absent.length} problems: ${[...estimateProblems, ...absent].slice(0, 8).join("; ")}.`);

// The verdict rule itself, on synthetic CIs around its two thresholds, against
// a human band of 100 to 200. Live data may hold no estimate near a
// threshold: on 2026-11-17 no ratio floor lay between 0.9x and 1x, so a rule
// that read "safer" from 0.9x up passed every check above.
const RULE_CASES = [
  [201, 500, "safer"], [200, 500, "ambiguous"], [190, 500, "ambiguous"], [20, 500, "ambiguous"],
  [20, 105, "ambiguous"], [20, 100, "ambiguous"], [20, 99, "worse"], [20, 95, "worse"],
];
const ruleWrong = RULE_CASES.map(([lo, hi, want]) => ({ lo, hi, want, got: vm.runInContext(`stressVerdictKey(${lo}, ${hi}, {lo: 100, hi: 200})`, ctx) }))
  .filter(c => c.got !== c.want);
assert.deepEqual(ruleWrong, [],
  `Replicata: call stressVerdictKey with each of ${RULE_CASES.length} CIs against a human band of 100 to 200.
Expectata: robustly safer when the CI's low edge is above the band's top (201 and up), robustly worse when its high edge is below the band's bottom (99 and down), ambiguous otherwise, the two edges themselves included.
Resultata: ${JSON.stringify(ruleWrong)}.`);

// The verdicts and their ranges are this table's, not the summary cards':
// since 2026-11-17 a card has no stress line (the human's layout of that day;
// summary-cards.qual), and its multipliers carry their own 95% intervals
// (multiplier-interval.qual). Until then each card's stress line gave the
// All-incidents verdict here, headed CARD_STRESS_LABEL, with its badge, and
// this checked the label and a badge.
assert.ok(
  !plain.summaryCardHtml.includes("mpi-card-stress") &&
    !Object.values(plain.verdictClass).some(c => plain.summaryCardHtml.includes(`class="stress-badge ${c}`)),
  `Replicata: render the summary cards on the default view and look for a stress line or a verdict badge.
Expectata: neither: the verdicts and their ranges are the sensitivity table's.
Resultata: ${JSON.stringify(plain.summaryCardHtml.slice(0, 400))}.`,
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
// metric with an estimate (until 2026-11-17 a robustly safer one had to be
// among them, a verdict the data happened to hold), its seven cells what
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
    want.length > 0 && rows.length === want.length && wrong.length === 0,
    `Replicata: render the skeptical stress-test sanity subsection (default window) and read every cell of the stress table.
Expectata: a row per helmer metric with an estimate (${want.length} rows), each of seven cells: company, metric, k, the AV's median then 95% CI, the human band, the AV/human ratio range, and the verdict's badge (prior-only at k = 0), as helmerHumanStress computes them.
Resultata: ${rows.length} rows; ${wrong.length} differ, e.g. ${JSON.stringify(wrong.slice(0, 3).map(([i, w, g]) => ({ row: i + 1, want: w, got: g })))}.`,
  );
}

// The distribution chart's container and heading, read once the monthly views
// are built (checked at the end of this qual).
const distView = JSON.parse(JSON.stringify(vm.runInContext(`
(() => ({
  distHtml: document.getElementById("chart-distributions").innerHTML,
  distHeading: document.getElementById("dist-heading").textContent,
  metricLabel: selectedMonthMetric().label,
  window: [activeSeries.months[0], activeSeries.months[activeSeries.months.length - 1]],
}))()
`, ctx)));

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

// --- The fault-flip search on live data: a relation, not pins ---------------
// Faultfrac sensitivity: the smallest multiplier on the judged at-fault mass
// that changes the verdict. Until 2026-11-17 this qual pinned Waymo's and
// Tesla's flips and the default window's table (WANT_DEFAULT_FLIPS: "4.45x",
// "18.3x", "∞", the verdicts reached and each All-incidents verdict), all
// copied from the page's output and re-pinned as the data moved. More judged
// fault can only move a verdict toward worse, and at the cap, every incident
// at fault, the posterior is the universe metric's (the shared shift, above).
// So for every line with an at-fault or at-fault-injury estimate, in both
// windows:
//   - no judged mass (k = 0): no entry;
//   - else the flip is finite exactly when the verdict at the cap (the
//     universe metric's CI against this metric's human band) lies further
//     toward worse than the displayed one; a finite multiplier lies above 1
//     and at or below the cap (incidents over judged mass), and reaches the
//     next verdict toward worse; an infinite one reaches none.
// The table's printed cells are checked against the search below
// (sanity-fault-flip).
const RANK = { safer: 0, ambiguous: 1, worse: 2 };
const flipRows = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const full = monthSeriesData();
  const out = [];
  for (const [name, first] of [["default", full.months.indexOf(DEFAULT_START_MONTH)], ["full", 0]]) {
    for (const row of monthlySummaryRows(sliceSeries(full, first, full.months.length - 1)).filter(r => r.vmtBest > 0)) {
      for (const [key, universe, n] of [["atfault", "all", row.incTotal], ["atfaultInjury", "injury", row.incInjury]]) {
        if (row.mpiEstimates[key] === null) continue;
        const s = helmerHumanStress(row, key), whole = row.mpiEstimates[universe];
        const flip = faultFlipMultiplier(s.av, s.human, n);
        out.push({window: name, helmer: row.helmer, key, k: s.av.k, n, shown: s.verdictKey,
          atCap: stressVerdictKey(whole.lo, whole.hi, s.human),
          flip: flip === null ? null : {mult: String(flip.mult), flipped: flip.flipped}});
      }
    }
  }
  return out;
})()
`, ctx)));
const flipProblems = flipRows.flatMap(r => {
  const where = `${r.window} ${r.helmer} ${r.key} (judged mass ${r.k} of ${r.n} incidents, shown ${r.shown}, at the cap ${r.atCap})`;
  if (r.k === 0) return r.flip === null ? [] : [`${where}: an entry, ${JSON.stringify(r.flip)}, with no judged mass`];
  if (r.flip === null) return [`${where}: no entry`];
  const finite = r.flip.mult !== "Infinity", mult = Number(r.flip.mult);
  const ok = finite === (RANK[r.atCap] > RANK[r.shown]) &&
    (finite ? mult > 1 && mult <= r.n / r.k * (1 + 1e-9) && RANK[r.flip.flipped] === RANK[r.shown] + 1 : r.flip.flipped === null);
  return ok ? [] : [`${where}: ${JSON.stringify(r.flip)}`];
});
assert.ok(flipRows.length >= 2 * estimates.companies.length && flipProblems.length === 0,
  `Replicata: run faultFlipMultiplier for every line's at-fault and at-fault-injury estimate, in the default window and over the full history (${flipRows.length} estimates).
Expectata: at least an at-fault estimate for each company in each window; no entry where there is no judged mass; else a finite multiplier exactly when the verdict at the cap (every incident at fault: the universe metric's CI against this metric's human band) lies further toward worse than the one shown, above 1 and at or below the cap (incidents over judged mass), reaching the next verdict toward worse; an infinite multiplier otherwise, reaching none.
Resultata: ${flipProblems.length} problems: ${flipProblems.slice(0, 6).join("; ")}.`);

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
    // Each entry names its row's cell count: a row short of its last cell
    // reads that cell as undefined, which JSON prints as null, so until
    // 2026-11-06 such a row's want and got printed alike.
    return cells.length === 5 && JSON.stringify(got) === JSON.stringify(want) ? null : { row: i + 1, cells: cells.length, want, got };
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
  const months = distView.distHeading.match(/\d{4}-\d{2}/g) || [];
  assert.ok(
    (distView.distHtml.match(/<svg[\s>]/g) || []).length === 1 &&
      !/<h3[\s>]/.test(distView.distHtml) &&
      !distView.distHtml.includes("dist-note") &&
      distView.distHeading.includes(distView.metricLabel) &&
      JSON.stringify(months) === JSON.stringify(distView.window),
    `Replicata: build monthly views and inspect the chart-distributions container and #dist-heading.
Expectata: one chart body (one <svg>) with no in-body <h3>/note; the section header names the metric (${JSON.stringify(distView.metricLabel)}) and the window's months ${JSON.stringify(distView.window)}.
Resultata: heading ${JSON.stringify(distView.distHeading)}; body head ${JSON.stringify(distView.distHtml.slice(0, 120))}.`,
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

console.log(`qual pass: the stress test's ${estimates.out.length} estimates (two windows) each follow from their 95% CI and human band and lie in the sanity ranges (no verdict is required of any company); ${flipRows.length} fault-flip searches agree with the verdict at the cap; the stress and fault-flip tables show what the page computes`);

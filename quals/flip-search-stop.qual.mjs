// The fault-flip search stops at printed precision (audit 2026-10-04 #23).
// faultFlipMultiplier brackets the smallest multiplier at which the at-fault
// verdict changes, then halves the bracket. Until 2026-10-05 it halved it 40
// times, to ~12 significant figures, for a multiplier the Sensitivity table
// prints to two (fmtRatio); each halving builds a full marginal CDF, and the
// search was 61 of the sanity section's ~80 ms per slider step. Spec:
//  - narrowToPrinted(lo, hi, flips) narrows a bracket (no flip at lo, a flip
//    at hi) until every value in it prints alike under fmtRatio, and stops at
//    the first such bracket: its result flips and prints as the flip point
//    does, and it evaluates no bracket that already printed alike. A flip
//    point on a print boundary (1.05, between "1.0" and "1.1") has no such
//    bracket; there it stops once the bracket is narrower than 1e-12 in ln;
//  - the rule is fmtRatio's, not a precision of its own: with fmtRatio printing
//    four significant figures the same holds at four;
//  - faultFlipMultiplier prints the same multiplier and the same verdict after
//    the flip as a search that halves 60 times, in the default window, the
//    full history and every window ending at the latest month.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    Object.assign(this, { tagName, id, children: [], className: "", dataset: {}, listeners: {}, style: {}, value: "0",
      _textContent: "", _innerHTML: "", _attributes: {}, classList: { toggle() {} } });
  }
  set textContent(v) { this._textContent = String(v); }
  get textContent() { return this._textContent; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...n) { this.children = [...n]; }
  addEventListener(t, fn) { this.listeners[t] = [...(this.listeners[t] || []), fn]; }
  setAttribute(n, v) { this._attributes[n] = v; }
  getAttribute(n) { return this._attributes[n] ?? null; }
  querySelector() { return new ElementStub("queried"); }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodeById = new Map();
const ctx = vm.createContext({
  console, Math, Number, URLSearchParams,
  document: {
    getElementById: id => { if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id)); return nodeById.get(id); },
    createElement: tag => new ElementStub(tag), body: new ElementStub("body"), addEventListener() {},
  },
  window: { innerWidth: 1024, innerHeight: 768, location: { search: "", pathname: "/crashla", hash: "" }, history: { replaceState() {} } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const run = src => JSON.parse(JSON.stringify(vm.runInContext(src, ctx)));

// --- narrowToPrinted on known flip points ----------------------------------
// The flip points sit inside print cells, on and beside cell edges at two,
// three and four significant figures, and on either side of the whole-number
// switch at 10. Each starts from the bracket the search's first phase finds:
// consecutive steps of 10^(1/20).
const FLIP_POINTS = [1.0002, 1.004, 1.0049999, 1.005, 1.0450001, 1.049999, 1.05, 1.0500001, 1.5, 3.14159,
  4.5, 9.94, 9.95, 9.96, 9.9999, 10, 10.4, 10.5, 99.5, 158.3, 999.6, 1234.5, 37125.4];
const narrowCheck = () => run(`(() => {
  const out = [];
  for (const target of ${JSON.stringify(FLIP_POINTS)}) {
    let e = 0;
    while (Math.pow(10, (e + 1) / 20) < target) e++;
    const lo0 = Math.pow(10, e / 20), hi0 = Math.pow(10, (e + 1) / 20);
    // Each evaluation records the bracket it was asked to narrow.
    const asked = [];
    let lo = lo0, hi = hi0;
    const flips = s => {
      asked.push([lo, hi]);
      const f = s >= target;
      if (f) hi = s; else lo = s;
      return f;
    };
    let result = null, err = null;
    try { result = narrowToPrinted(lo0, hi0, flips); } catch (x) { err = String(x.message || x); }
    out.push({
      target, lo0, hi0, result, err, evaluations: asked.length,
      // asked while the bracket already printed alike (should never happen)
      overshoot: asked.filter(([a, b]) => fmtRatio(a) === fmtRatio(b)).length,
      flipsAtResult: result !== null && result >= target,
      // Within 1e-12 of a print boundary either side's print is the flip
      // point's to that precision (a double's last bits decide which).
      printsAsTarget: result !== null && (fmtRatio(result) === fmtRatio(target) ||
        (Math.log(hi / lo) <= 1e-12 && fmtRatio(lo) === fmtRatio(target))),
      // the bracket it stopped on prints alike, or holds a print boundary
      stoppedAlike: fmtRatio(lo) === fmtRatio(hi) || Math.log(hi / lo) <= 1e-12,
    });
  }
  return out;
})()`);
{
  const rows = narrowCheck();
  const bad = rows.filter(r => r.err !== null || !r.flipsAtResult || !r.printsAsTarget || r.overshoot > 0 || !r.stoppedAlike);
  assert.ok(bad.length === 0,
    `Replicata: narrowToPrinted(lo, hi, flips) on the bracket [10^(e/20), 10^((e+1)/20)] around each of ${FLIP_POINTS.length} flip points (flips(s): s >= the point), with fmtRatio as shipped.
Expectata: a result that flips and prints as the flip point does (fmtRatio; around a print boundary, as one of its two sides), reached by narrowing until the bracket prints alike (or, around a print boundary, is narrower than 1e-12 in ln) and evaluating no bracket that already printed alike.
Resultata: ${bad.length} wrong: ${JSON.stringify(bad.slice(0, 4))}${rows[0].evaluations !== undefined ? `; evaluations per point: ${JSON.stringify(rows.map(r => r.evaluations))}` : ""}.`);
}

// --- The stop rule follows fmtRatio -----------------------------------------
// With fmtRatio printing four significant figures, the same properties hold at
// four: a rule of its own coarser than fmtRatio's would stop before the
// result printed as the flip point does, and a finer one would go on
// evaluating brackets that already print alike.
{
  const shipped = narrowCheck().map(r => r.evaluations);
  vm.runInContext(`
    var shippedFmtRatio = fmtRatio;
    fmtRatio = n => new Intl.NumberFormat("en-US", {minimumSignificantDigits: 4, maximumSignificantDigits: 4}).format(n);
  `, ctx);
  const rows = narrowCheck();
  vm.runInContext(`fmtRatio = shippedFmtRatio;`, ctx);
  const bad = rows.filter(r => r.err !== null || !r.flipsAtResult || !r.printsAsTarget || r.overshoot > 0 || !r.stoppedAlike);
  assert.ok(bad.length === 0,
    `Replicata: replace fmtRatio with a four-significant-figure formatter and narrow the same brackets.
Expectata: the same properties at four figures: the stop rule is fmtRatio's.
Resultata: ${bad.length} wrong: ${JSON.stringify(bad.slice(0, 4))}; evaluations ${JSON.stringify(rows.map(r => r.evaluations))} (shipped precision: ${JSON.stringify(shipped)}).`);
}

// --- faultFlipMultiplier prints what a 60-halving search prints -------------
const compared = run(`(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData();
  const months = full.months, last = months.length - 1;
  const windows = [[months.indexOf(DEFAULT_START_MONTH), last], [0, last]];
  for (let a = 0; a <= last; a++) windows.push([a, last]);
  const shipped = narrowToPrinted;
  const fine = (lo, hi, flips) => { for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (flips(mid)) hi = mid; else lo = mid; } return hi; };
  const show = f => f === null ? "null" : f.mult === Infinity ? "inf " + f.flipped : fmtRatio(f.mult) + " " + f.flipped + " from " + f.base;
  const out = [];
  let searches = 0;
  for (const [a, b] of windows) {
    const rows = monthlySummaryRows(sliceSeries(full, a, b)).filter(r => r.vmtBest > 0 && r.mpiEstimates.atfault !== null);
    for (const row of rows) {
      const stress = helmerHumanStress(row, "atfault");
      narrowToPrinted = shipped;
      const got = show(faultFlipMultiplier(stress.av, stress.human, row.incTotal));
      narrowToPrinted = fine;
      const want = show(faultFlipMultiplier(stress.av, stress.human, row.incTotal));
      narrowToPrinted = shipped;
      searches++;
      if (got !== want) out.push({window: months[a] + ".." + months[b], helmer: row.helmer, got, want});
    }
  }
  return {searches, windows: windows.length, wrong: out};
})()`);
assert.ok(compared.searches > 100 && compared.wrong.length === 0,
  `Replicata: for the default window, the full history and each of the ${compared.windows - 2} windows ending at the latest month, run faultFlipMultiplier for every company's at-fault verdict, once as shipped and once with the bisection run 60 times.
Expectata: the same printed multiplier (fmtRatio), the same verdict after the flip and the same base verdict in every search.
Resultata: ${compared.searches} searches; ${compared.wrong.length} differ: ${JSON.stringify(compared.wrong.slice(0, 5))}.`);

console.log("qual pass: the fault-flip search stops once its bracket prints alike, by fmtRatio's own rule, and prints what a full-precision search prints");

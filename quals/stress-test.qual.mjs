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
    location: {search: "", pathname: "/crashla"},
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
  return {
    byHelmer: Object.fromEntries(rows.filter(row => row.vmtBest > 0).map(row => [
      row.helmer,
      Object.fromEntries(METRIC_KEYS.filter(key => row.mpiEstimates[key] !== null)
        .map(key => [key, helmerHumanStress(row, key)])),
    ])),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    sanityHtml: document.getElementById("sanity-checks").innerHTML,
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

for (const key of ["atfault", "injury", "airbag", "seriousInjury"]) {
  assert.equal(
    plain.byHelmer.Waymo[key].verdictKey,
    "safer",
    `Replicata: compute stress-test verdict for Waymo on ${key}.
Expectata: Waymo is robustly safer than humans on ${key}.
Resultata: verdict was ${plain.byHelmer.Waymo[key].verdictKey}.`,
  );
}

assert.equal(
  plain.byHelmer.Zoox.all.verdictKey,
  "ambiguous",
  `Replicata: compute stress-test verdict for Zoox on all incidents.
Expectata: Zoox remains ambiguous on the all-incident metric.
Resultata: verdict was ${plain.byHelmer.Zoox.all.verdictKey}.`,
);

assert.ok(
  plain.byHelmer.Tesla.all.ratioHi < 3,
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

assert.ok(
  plain.summaryCardHtml.includes("Overall:") &&
    plain.summaryCardHtml.includes("ambiguous"),
  `Replicata: render top summary cards with stress labels.
Expectata: summary cards include the English stress label and ambiguous verdicts.
Resultata: summary card HTML snippet was ${JSON.stringify(plain.summaryCardHtml.slice(0, 400))}.`,
);

assert.ok(
  plain.sanityHtml.includes("Sensitivity analysis") &&
    plain.sanityHtml.includes("AV/human ratio") &&
    plain.sanityHtml.includes("robustly safer"),
  `Replicata: render skeptical stress-test sanity subsection.
Expectata: sanity HTML includes the English heading, ratio column, and safer verdict label.
Resultata: sanity HTML snippet was ${JSON.stringify(plain.sanityHtml.slice(0, 500))}.`,
);

// Faultfrac sensitivity: smallest multiplier on the judged at-fault mass that
// changes the verdict. (Serialized as strings because Infinity doesn't
// survive JSON.)
const flips = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const rows = monthlySummaryRows(monthSeriesData()).filter(r => r.vmtBest > 0);
  const out = {};
  for (const row of rows) {
    const stress = helmerHumanStress(row, "atfault");
    const flip = faultFlipMultiplier(stress.av, stress.human);
    out[row.helmer] = flip === null ? null : {mult: String(flip.mult), flipped: flip.flipped};
  }
  return {out, distHtml: document.getElementById("chart-distributions").innerHTML};
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

assert.ok(
  flips.out.Tesla !== null && flips.out.Tesla.flipped === "worse",
  `Replicata: compute the faultfrac flip multiplier for Tesla's at-fault verdict.
Expectata: scaling Tesla's judged fault mass up eventually flips ambiguous to robustly worse.
Resultata: flip was ${JSON.stringify(flips.out.Tesla)}.`,
);

assert.equal(
  flips.out.Zoox,
  null,
  `Replicata: compute the faultfrac flip multiplier for Zoox (judged at-fault mass 0).
Expectata: null — scaling zero mass can never change the verdict.
Resultata: flip was ${JSON.stringify(flips.out.Zoox)}.`,
);

assert.ok(
  plain.sanityHtml.includes("Flip multiplier") &&
    plain.sanityHtml.includes("Judged fault") &&
    plain.sanityHtml.includes("Verdict after flip"),
  `Replicata: render the sanity-checks sensitivity subsection.
Expectata: the faultfrac sensitivity table (human-finalized English headers) renders under the Sensitivity analysis h3.
Resultata: sanity HTML lacks the fault sensitivity table.`,
);

// Pooled-window disclosure: the distributions container renders the full
// window AND a trailing-6-month companion, prefaced by the constant-rate note.
assert.ok(
  flips.distHtml.includes("dist-note") &&
    (flips.distHtml.match(/<h3>/g) || []).length === 2,
  `Replicata: build monthly views and inspect the chart-distributions container.
Expectata: a dist-note plus two distribution charts (full window and trailing 6 months).
Resultata: ${(flips.distHtml.match(/<h3>/g) || []).length} h3s, note ${flips.distHtml.includes("dist-note") ? "present" : "missing"}.`,
);

console.log("qual pass: skeptical stress test classifies headline safety claims");

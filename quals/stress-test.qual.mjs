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

  querySelector() { return null; }

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
    byCompany: Object.fromEntries(rows.map(row => [
      row.company,
      Object.fromEntries(STRESS_METRIC_KEYS.map(key => [key, companyHumanStress(row, key)])),
    ])),
    summaryCardHtml: document.getElementById("mpi-summary-cards").innerHTML,
    sanityHtml: document.getElementById("sanity-checks").innerHTML,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(stress));

assert.equal(
  plain.byCompany.Tesla.all.verdictKey,
  "worse",
  `Replicata: compute stress-test verdict for Tesla on all incidents.
Expectata: Tesla remains robustly worse than humans on the all-incident metric.
Resultata: verdict was ${plain.byCompany.Tesla.all.verdictKey}.`,
);

assert.equal(
  plain.byCompany.Waymo.all.verdictKey,
  "ambiguous",
  `Replicata: compute stress-test verdict for Waymo on all incidents.
Expectata: Waymo all-incident claim remains assumption-sensitive rather than robust.
Resultata: verdict was ${plain.byCompany.Waymo.all.verdictKey}.`,
);

for (const key of ["atfault", "injury", "seriousInjury"]) {
  assert.equal(
    plain.byCompany.Waymo[key].verdictKey,
    "safer",
    `Replicata: compute stress-test verdict for Waymo on ${key}.
Expectata: Waymo is robustly safer than humans on ${key}.
Resultata: verdict was ${plain.byCompany.Waymo[key].verdictKey}.`,
  );
}

assert.equal(
  plain.byCompany.Zoox.all.verdictKey,
  "ambiguous",
  `Replicata: compute stress-test verdict for Zoox on all incidents.
Expectata: Zoox remains ambiguous on the all-incident metric.
Resultata: verdict was ${plain.byCompany.Zoox.all.verdictKey}.`,
);

assert.ok(
  plain.byCompany.Tesla.all.ratioHi < 1,
  `Replicata: inspect Tesla all-incident AV/human ratio range.
Expectata: even Tesla's optimistic edge remains below 1x human safety.
Resultata: ratio range was ${plain.byCompany.Tesla.all.ratioLo}x to ${plain.byCompany.Tesla.all.ratioHi}x.`,
);

assert.ok(
  plain.byCompany.Waymo.atfault.ratioLo > 1,
  `Replicata: inspect Waymo at-fault AV/human ratio range.
Expectata: even Waymo's pessimistic edge remains above 1x human safety.
Resultata: ratio range was ${plain.byCompany.Waymo.atfault.ratioLo}x to ${plain.byCompany.Waymo.atfault.ratioHi}x.`,
);

assert.ok(
  plain.summaryCardHtml.includes("Overall:") &&
    plain.summaryCardHtml.includes("robustly worse") &&
    plain.summaryCardHtml.includes("ambiguous"),
  `Replicata: render top summary cards with stress labels.
Expectata: summary cards include the English stress label plus both worse and ambiguous verdicts.
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

console.log("qual pass: skeptical stress test classifies headline safety claims");

// Human-benchmark source links (audit findings #41, #42, #68, #69, #70; 2026-10-03).
// Every humanMPI band lists its sources as URLs, and BENCHMARK_SOURCES gives
// each URL its one label, so the human cards' "Benchmarks:" line (which
// gathers every band's sources) names each source once, under one name.
// Until 2026-10-03 srcLinks were {label, url} pairs and the line deduplicated
// whole "<a>label</a>" strings: arXiv 2312.12675, the Waymo hub and NHTSA
// 813791 each appeared twice under two labels. The same fix pins which
// sources each derivation cites: the at-fault-injury bands cite the injury
// band's sources and NHTSA 812115 (the 94%), every Blincoe-adjusted band
// cites the Blincoe edition it uses (2023, 813403, which Kusano et al. and
// the hub use; plus 2015, 812013, where the US low edges average the two),
// the release notes link the current (Sep 24, 2026) edition, and the arXiv
// papers are "Kusano et al." (7 and 6 authors).
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName; this.id = id; this.children = []; this.parentNode = null;
    this.className = ""; this.dataset = {}; this._textContent = ""; this.listeners = {};
    this._innerHTML = ""; this._attributes = {}; this.style = {}; this.value = "0";
    this.classList = { toggle() {} };
  }
  set textContent(v) {
    this._textContent = v;
    this._innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  get textContent() { return this._textContent; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(name, value) { this._attributes[name] = value; }
  getAttribute(name) { return this._attributes[name] ?? null; }
  querySelector() { return new ElementStub("queried"); }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}
const nodeById = new Map();
const getNode = id => { if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id)); return nodeById.get(id); };
const ctx = vm.createContext({
  console, Math, Number, URLSearchParams,
  document: { getElementById: getNode, createElement: tag => new ElementStub(tag), body: new ElementStub("body"), addEventListener() {} },
  window: { innerWidth: 1024, innerHeight: 768, location: {search: "", pathname: "/crashla", hash: ""}, history: {replaceState() {}} },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const SOURCES = JSON.parse(JSON.stringify(vm.runInContext(
  `typeof BENCHMARK_SOURCES === "undefined" ? null : BENCHMARK_SOURCES`, ctx)));
const BANDS = JSON.parse(JSON.stringify(vm.runInContext(
  `METRIC_DEFS.flatMap(m => Object.entries(m.humanMPI || {}).map(([cohort, h]) => ({metric: m.key, cohort, srcLinks: h.srcLinks})))`, ctx)));

// --- #68: a source table keyed by URL, one label each ---
assert.ok(SOURCES !== null && Object.keys(SOURCES).length > 0 &&
  Object.entries(SOURCES).every(([url, label]) => /^https:\/\//.test(url) && typeof label === "string" && label.length > 0),
  `Replicata: read BENCHMARK_SOURCES in crashla.js.
Expectata: an object mapping each benchmark source URL to its one label.
Resultata: ${JSON.stringify(SOURCES)}.`);
const unlisted = BANDS.flatMap(b => b.srcLinks
  .filter(s => typeof s !== "string" || (SOURCES ?? {})[s] === undefined)
  .map(s => `${b.cohort} ${b.metric}: ${JSON.stringify(s)}`));
assert.deepEqual(unlisted, [],
  `Replicata: check every humanMPI srcLinks entry against BENCHMARK_SOURCES.
Expectata: each entry is a URL string with a label in the table (so one URL can only ever carry one label).
Resultata: entries outside the table: ${JSON.stringify(unlisted)}.`);
// (Past the first assert SOURCES is non-null; the ?? {} only keeps a
// soft-assert red run going on code that predates the table.)
const S = SOURCES ?? {};
const labels = Object.values(S);
assert.equal(new Set(labels).size, labels.length,
  `Replicata: compare the labels in BENCHMARK_SOURCES.
Expectata: no two sources share a label.
Resultata: ${JSON.stringify(labels)}.`);
const sep = vm.runInContext(`typeof SOURCE_LIST_SEP === "undefined" ? ", " : SOURCE_LIST_SEP`, ctx);
assert.ok(labels.every(l => !l.includes(sep.trim())),
  `Replicata: look for the link-list separator ${JSON.stringify(sep)} inside a source label.
Expectata: none — a label like "Kusano et al. 2024, Table 3" keeps its comma, and the lists separate entries with ${JSON.stringify(sep)}, so one label never reads as two.
Resultata: ${JSON.stringify(labels.filter(l => l.includes(sep.trim())))}.`);

// The rendered human cards: every "Benchmarks:" line lists each source once.
const cardHtml = vm.runInContext(`(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  buildMonthlyViews();
  return document.getElementById("mpi-summary-cards").innerHTML;
})()`, ctx);
const benchLines = [...cardHtml.matchAll(/<div class="mpi-card-vmt">Benchmarks: (.*?)<\/div>/g)].map(m => m[1]);
assert.equal(benchLines.length, 3,
  `Replicata: render the summary cards and find the human cards' "Benchmarks:" lines.
Expectata: three (AV cities, US average, Uber/Lyft).
Resultata: ${benchLines.length}.`);
for (const line of benchLines) {
  const hrefs = [...line.matchAll(/href="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
  assert.ok(hrefs.length > 0 && new Set(hrefs).size === hrefs.length,
    `Replicata: list the links on a human card's "Benchmarks:" line.
Expectata: each source linked once.
Resultata: ${hrefs.length} links, ${new Set(hrefs).size} distinct: ${JSON.stringify(hrefs)}.`);
  assert.match(line, new RegExp(`^<a href="[^"]*">[^<]*</a>(${sep}<a href="[^"]*">[^<]*</a>)*$`),
    `Replicata: read the separators on a human card's "Benchmarks:" line.
Expectata: links joined by ${JSON.stringify(sep)}.
Resultata: ${line.slice(0, 300)}.`);
  for (const [href, label] of [...line.matchAll(/href="([^"]*)">([^<]*)<\/a>/g)].map(m => [m[1].replace(/&amp;/g, "&"), m[2].replace(/&amp;/g, "&")])) {
    assert.equal(label, S[href],
      `Replicata: compare a "Benchmarks:" link label with BENCHMARK_SOURCES.
Expectata: ${JSON.stringify(S[href])} for ${href}.
Resultata: ${JSON.stringify(label)}.`);
  }
}

// --- #70: the two Kusano papers have 7 and 6 authors ---
for (const url of ["https://arxiv.org/abs/2312.12675", "https://arxiv.org/abs/2505.01515"]) {
  assert.ok(S[url] && S[url].startsWith("Kusano et al."),
    `Replicata: read the label for ${url}.
Expectata: "Kusano et al. ..." (the paper has more than two authors).
Resultata: ${JSON.stringify(S[url])}.`);
}
assert.ok(labels.every(l => !/Kusano & Scanlon/.test(l)),
  `Replicata: search the source labels for "Kusano & Scanlon".
Expectata: none.
Resultata: ${JSON.stringify(labels.filter(l => /Kusano & Scanlon/.test(l)))}.`);

const linksOf = (metric, cohort) => {
  const b = BANDS.find(x => x.metric === metric && x.cohort === cohort);
  assert.ok(b, `missing ${cohort} ${metric}`);
  return b.srcLinks;
};
const HUB = "https://waymo.com/safety/impact/";
const N812115 = "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115";
const B2015 = "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013";
const B2023 = "https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813403";

// --- #41: at-fault injury = injury band / 94% (812115) .. / 50% ---
assert.deepEqual([...linksOf("atfaultInjury", "HumansAV")].sort(), [HUB, N812115].sort(),
  `Replicata: read the AV-cities at-fault-injury sources.
Expectata: the injury band's source (the Waymo hub) and NHTSA 812115 (the 94% share) — not Kusano's Table 3 or NHTSA 813791, which feed no number of this band.
Resultata: ${JSON.stringify(linksOf("atfaultInjury", "HumansAV"))}.`);
{
  const us = linksOf("atfaultInjury", "HumansUS");
  const missing = [...linksOf("injury", "HumansUS"), N812115].filter(u => !us.includes(u));
  assert.deepEqual(missing, [],
    `Replicata: read the US-average at-fault-injury sources.
Expectata: the US injury band's sources plus NHTSA 812115 (the 94% share).
Resultata: missing ${JSON.stringify(missing)} from ${JSON.stringify(us)}.`);
}

// --- #42: the Blincoe edition each Blincoe-adjusted band uses ---
for (const [metric, cohort] of [["all", "HumansAV"], ["atfault", "HumansAV"], ["all", "HumansUS"],
  ["atfault", "HumansUS"], ["injury", "HumansUS"], ["atfaultInjury", "HumansUS"], ["hospitalization", "HumansUS"]]) {
  assert.ok(linksOf(metric, cohort).includes(B2023),
    `Replicata: read the ${cohort} ${metric} sources.
Expectata: Blincoe et al. 2023 (NHTSA 813403), whose underreporting shares the band uses (directly, or through Kusano et al.'s 9.67 IPMM).
Resultata: ${JSON.stringify(linksOf(metric, cohort))}.`);
}
const avBlincoe2015 = BANDS.filter(b => b.cohort === "HumansAV" && b.srcLinks.includes(B2015)).map(b => b.metric);
assert.deepEqual(avBlincoe2015, [],
  `Replicata: look for Blincoe 2015 (NHTSA 812013) among the AV-cities sources.
Expectata: none — the AV-cities bands use Blincoe et al. 2023 through Kusano et al. and the hub.
Resultata: ${JSON.stringify(avBlincoe2015)}.`);
assert.ok(/2015/.test(S[B2015] || "") && /2023/.test(S[B2023] || ""),
  `Replicata: read the two Blincoe labels.
Expectata: each names its edition (2015, 2023).
Resultata: ${JSON.stringify([S[B2015], S[B2023]])}.`);

// --- #69: the current release notes ---
const notes = Object.keys(S).filter(u => /Release_Notes/.test(u));
assert.deepEqual(notes, ["https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/Waymo_Safety_Impact_Data_Hub_Release_Notes_20260924.pdf"],
  `Replicata: read the Waymo Data Hub release-notes link.
Expectata: the Sep 24, 2026 edition the hub links (data through Jun 2026), not the superseded Jun 24 one.
Resultata: ${JSON.stringify(notes)}.`);

console.log(`qual pass: ${Object.keys(S).length} benchmark sources, one label each; human cards list each once; derivations cite the sources they use`);

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const locationStub = {
  pathname: "/crashla",
  search: "",
};
let replaceUrl = "";

const ctx = vm.createContext({
  console,
  Math,
  URLSearchParams,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
  window: {
    location: locationStub,
    history: {
      replaceState(_state, _title, url) {
        replaceUrl = String(url);
        locationStub.search = replaceUrl.includes("?")
          ? replaceUrl.slice(replaceUrl.indexOf("?"))
          : "";
      },
    },
  },
});

vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const state = vm.runInContext(`
(() => {
  monthHelmerEnabled = {HumansAV: true, HumansUS: false, Tesla: true, Waymo: false, Zoox: true};
  selectedMetricKey = "injury";
  activeFilter = "Waymo";
  sortCol = "speed";
  sortAsc = false;

  const query = encodeUiStateQuery();

  monthHelmerEnabled = {HumansAV: true, HumansUS: true, Tesla: true, Waymo: true, Zoox: true};
  selectedMetricKey = "all";
  activeFilter = "All";
  sortCol = null;
  sortAsc = true;

  applyUiStateQuery(query);
  syncUrlState();

  return {
    query,
    locationSearch: window.location.search,
    activeFilter,
    sortCol,
    sortAsc,
    monthHelmerEnabled,
    selectedMetricKey,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(state));

assert.equal(
  plain.query,
  "f=Waymo&s=speed&a=0&c=HumansAV.Tesla.Zoox&m=injury",
  `Replicata: encode UI state to a query string.
Expectata: query string exactly captures filter/sort/helmer/metric state.
Resultata: query was ${plain.query}.`,
);

assert.equal(
  plain.locationSearch,
  "?" + plain.query,
  `Replicata: sync URL state after setting UI state.
Expectata: window.location.search matches encoded query.
Resultata: search was ${plain.locationSearch}.`,
);

assert.equal(
  plain.activeFilter,
  "Waymo",
  `Replicata: apply encoded query to reset state.
Expectata: activeFilter restored to Waymo.
Resultata: activeFilter was ${plain.activeFilter}.`,
);

assert.equal(
  plain.sortCol,
  "speed",
  `Replicata: apply encoded query to reset state.
Expectata: sort column restored to speed.
Resultata: sortCol was ${plain.sortCol}.`,
);

assert.equal(
  plain.sortAsc,
  false,
  `Replicata: apply encoded query to reset state.
Expectata: descending sort restored.
Resultata: sortAsc was ${plain.sortAsc}.`,
);

assert.deepEqual(
  plain.monthHelmerEnabled,
  {HumansAV: true, HumansUS: false, HumansRideshare: false, Tesla: true, Waymo: false, Zoox: true},
  `Replicata: apply encoded query to reset helmer toggles.
Expectata: helmer toggles restored (Tesla+Zoox on, Waymo off, rideshare off).
Resultata: helmer toggles were ${JSON.stringify(plain.monthHelmerEnabled)}.`,
);

assert.equal(
  plain.selectedMetricKey,
  "injury",
  `Replicata: apply encoded query to reset metric selection.
Expectata: selectedMetricKey restored to injury.
Resultata: selectedMetricKey was ${plain.selectedMetricKey}.`,
);

// --- Date range URL state ---

const dateRangeState = vm.runInContext(`
(() => {
  // Set a non-default date range
  monthRangeStart = 2;
  monthRangeEnd = 5;
  fullMonthSeries = {months: ["2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01"]};
  const queryWithRange = encodeUiStateQuery();

  // Apply a query with d= to restore range
  monthRangeStart = 0;
  monthRangeEnd = Infinity;
  applyUiStateQuery(queryWithRange);
  const restoredStart = monthRangeStart;
  const restoredEnd = monthRangeEnd;

  // Apply a query WITHOUT d= (backward compat) — should not crash
  monthRangeStart = 99;
  monthRangeEnd = 99;
  applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all");
  const unchangedStart = monthRangeStart;
  const unchangedEnd = monthRangeEnd;

  // Verify default range omits d=
  monthRangeStart = 0;
  monthRangeEnd = Infinity;
  const defaultQuery = encodeUiStateQuery();

  // Clean up
  fullMonthSeries = null;

  return {queryWithRange, restoredStart, restoredEnd, unchangedStart, unchangedEnd, defaultQuery};
})()
`, ctx);
const drPlain = JSON.parse(JSON.stringify(dateRangeState));

assert.ok(
  drPlain.queryWithRange.includes("d=2-5"),
  `Replicata: encode UI state with monthRangeStart=2, monthRangeEnd=5.
Expectata: query string contains d=2-5.
Resultata: query was ${drPlain.queryWithRange}.`,
);

assert.equal(
  drPlain.restoredStart,
  2,
  `Replicata: apply query with d=2-5.
Expectata: monthRangeStart restored to 2.
Resultata: monthRangeStart was ${drPlain.restoredStart}.`,
);

assert.equal(
  drPlain.restoredEnd,
  5,
  `Replicata: apply query with d=2-5.
Expectata: monthRangeEnd restored to 5.
Resultata: monthRangeEnd was ${drPlain.restoredEnd}.`,
);

assert.equal(
  drPlain.unchangedStart,
  99,
  `Replicata: apply query without d= key (backward compat).
Expectata: monthRangeStart unchanged at 99.
Resultata: monthRangeStart was ${drPlain.unchangedStart}.`,
);

assert.equal(
  drPlain.unchangedEnd,
  99,
  `Replicata: apply query without d= key (backward compat).
Expectata: monthRangeEnd unchanged at 99.
Resultata: monthRangeEnd was ${drPlain.unchangedEnd}.`,
);

assert.ok(
  !drPlain.defaultQuery.includes("d="),
  `Replicata: encode UI state with default (full) date range.
Expectata: query string does not contain d= key.
Resultata: query was ${drPlain.defaultQuery}.`,
);

let threwInvalid = false;
try {
  vm.runInContext(
    `applyUiStateQuery("f=Bad&s=-&a=1&c=Tesla.Waymo.Zoox&m=all")`,
    ctx,
  );
} catch (_err) {
  threwInvalid = true;
}
assert.ok(
  threwInvalid,
  `Replicata: apply URL state with invalid filter token.
Expectata: immediate throw.
Resultata: no throw.`,
);

let threwUnknownKey = false;
try {
  vm.runInContext(
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&z=1")`,
    ctx,
  );
} catch (_err) {
  threwUnknownKey = true;
}
assert.ok(
  threwUnknownKey,
  `Replicata: apply URL state containing unknown key z.
Expectata: immediate throw.
Resultata: no throw.`,
);

// --- Collapsed-section URL state (optional key x) ---

const collapseState = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const allOpen = Object.fromEntries(SECTION_IDS.map(id => [id, false]));
  sectionCollapsed = {...allOpen};
  const defaultQuery = encodeUiStateQuery();

  sectionCollapsed = {...allOpen, browser: true, sanity: true};
  const collapsedQuery = encodeUiStateQuery();

  sectionCollapsed = {...allOpen};
  applyUiStateQuery(collapsedQuery);
  return {defaultQuery, collapsedQuery, restored: sectionCollapsed,
    expected: {...allOpen, browser: true, sanity: true}};
})()
`, ctx)));

assert.ok(
  !collapseState.defaultQuery.includes("x="),
  `Replicata: encode UI state with no sections collapsed.
Expectata: query omits the x= key.
Resultata: query was ${collapseState.defaultQuery}.`,
);

assert.ok(
  collapseState.collapsedQuery.includes("x=browser.sanity"),
  `Replicata: encode UI state with the browser and sanity sections collapsed.
Expectata: query contains x=browser.sanity.
Resultata: query was ${collapseState.collapsedQuery}.`,
);

assert.deepEqual(
  collapseState.restored,
  collapseState.expected,
  `Replicata: apply a query with x=browser.sanity.
Expectata: sectionCollapsed restored (browser+sanity collapsed, all others open).
Resultata: sectionCollapsed was ${JSON.stringify(collapseState.restored)}.`,
);

let threwBadCollapse = false;
try {
  vm.runInContext(
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&x=bogus")`,
    ctx,
  );
} catch (_err) {
  threwBadCollapse = true;
}
assert.ok(
  threwBadCollapse,
  `Replicata: apply URL state with an unknown collapsed-section id x=bogus.
Expectata: immediate throw.
Resultata: no throw.`,
);

let threwBadDateRange = false;
try {
  vm.runInContext(
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&d=abc")`,
    ctx,
  );
} catch (_err) {
  threwBadDateRange = true;
}
assert.ok(
  threwBadDateRange,
  `Replicata: apply URL state with malformed date range d=abc.
Expectata: immediate throw.
Resultata: no throw.`,
);

let threwReversedRange = false;
try {
  vm.runInContext(
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&d=5-2")`,
    ctx,
  );
} catch (_err) {
  threwReversedRange = true;
}
assert.ok(
  threwReversedRange,
  `Replicata: apply URL state with reversed date range d=5-2.
Expectata: immediate throw (start > end).
Resultata: no throw.`,
);

assert.ok(
  replaceUrl.endsWith("?" + plain.query),
  `Replicata: sync URL state.
Expectata: replaceState called with encoded query.
Resultata: replaceState URL was ${replaceUrl}.`,
);

// Every SECTION_ID must have matching collapsible markup in index.html, and
// vice versa — so the collapse machinery can't drift from the page structure.
const sectionIds = JSON.parse(JSON.stringify(vm.runInContext("SECTION_IDS", ctx)));
const indexHtml = fs.readFileSync("index.html", "utf8");
for (const id of sectionIds) {
  const re = new RegExp(`<section class="collapsible" id="sec-${id}">`);
  assert.ok(
    re.test(indexHtml),
    `Replicata: search index.html for the collapsible section sec-${id}.
Expectata: a <section class="collapsible" id="sec-${id}"> wrapper exists.
Resultata: not found.`,
  );
}
const htmlSectionIds = [...indexHtml.matchAll(/<section class="collapsible" id="sec-([a-z]+)">/g)]
  .map(m => m[1]);
assert.deepEqual(
  htmlSectionIds.slice().sort(),
  sectionIds.slice().sort(),
  `Replicata: collect collapsible section ids from index.html and from SECTION_IDS.
Expectata: the two sets match exactly (no orphan markup or unbacked id).
Resultata: html=${JSON.stringify(htmlSectionIds)}, SECTION_IDS=${JSON.stringify(sectionIds)}.`,
);
// Each collapsible section needs a clickable .sec-head (the collapse toggle).
const headCount = (indexHtml.match(/class="sec-head"/g) || []).length;
assert.equal(
  headCount,
  sectionIds.length,
  `Replicata: count class="sec-head" headers in index.html.
Expectata: one per collapsible section (${sectionIds.length}).
Resultata: found ${headCount}.`,
);

console.log("qual pass: URL state round-trips and fails loudly on invalid query params");

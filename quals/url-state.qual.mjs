import assert from "node:assert/strict";
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
  monthDriverEnabled = {Humans: true, Tesla: true, Waymo: false, Zoox: true};
  selectedMetricKey = "injury";
  activeFilter = "Waymo";
  sortCol = "speed";
  sortAsc = false;

  const query = encodeUiStateQuery();

  monthDriverEnabled = {Humans: true, Tesla: true, Waymo: true, Zoox: true};
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
    monthDriverEnabled,
    selectedMetricKey,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(state));

assert.equal(
  plain.query,
  "f=Waymo&s=speed&a=0&c=Humans.Tesla.Zoox&m=injury",
  `Replicata: encode UI state to a query string.
Expectata: query string exactly captures filter/sort/driver/metric state.
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
  plain.monthDriverEnabled,
  {Humans: true, Tesla: true, Waymo: false, Zoox: true},
  `Replicata: apply encoded query to reset driver toggles.
Expectata: driver toggles restored (Tesla+Zoox on, Waymo off).
Resultata: driver toggles were ${JSON.stringify(plain.monthDriverEnabled)}.`,
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
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&x=1")`,
    ctx,
  );
} catch (_err) {
  threwUnknownKey = true;
}
assert.ok(
  threwUnknownKey,
  `Replicata: apply URL state containing unknown key x.
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

console.log("qual pass: URL state round-trips and fails loudly on invalid query params");

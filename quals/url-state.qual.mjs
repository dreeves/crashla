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
  monthCompanyEnabled = {Tesla: true, Waymo: false, Zoox: true, Humans: true};
  monthMetricEnabled = Object.fromEntries(METRIC_DEFS.map(m => [m.key, false]));
  monthMetricEnabled.all = true;
  monthMetricEnabled.injury = true;
  activeFilter = "Waymo";
  sortCol = "speed";
  sortAsc = false;

  const query = encodeUiStateQuery();

  monthCompanyEnabled = {Tesla: true, Waymo: true, Zoox: true, Humans: true};
  monthMetricEnabled = Object.fromEntries(METRIC_DEFS.map(m => [m.key, m.defaultEnabled]));
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
    monthCompanyEnabled,
    monthMetricEnabled,
  };
})()
`, ctx);
const plain = JSON.parse(JSON.stringify(state));

assert.equal(
  plain.query,
  "f=Waymo&s=speed&a=0&c=Tesla.Zoox&m=all.injury",
  `Replicata: encode UI state to a query string.
Expectata: query string exactly captures filter/sort/company/metric state.
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
  plain.monthCompanyEnabled,
  {Tesla: true, Waymo: false, Zoox: true, Humans: true},
  `Replicata: apply encoded query to reset company toggles.
Expectata: company toggles restored (Tesla+Zoox on, Waymo off).
Resultata: company toggles were ${JSON.stringify(plain.monthCompanyEnabled)}.`,
);

const metricSummary = {
  all: plain.monthMetricEnabled.all,
  injury: plain.monthMetricEnabled.injury,
  nonstationary: plain.monthMetricEnabled.nonstationary,
};
assert.deepEqual(
  metricSummary,
  {all: true, injury: true, nonstationary: false},
  `Replicata: apply encoded query to reset metric toggles.
Expectata: all+injury enabled, nonstationary disabled.
Resultata: metrics were ${JSON.stringify(metricSummary)}.`,
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

assert.ok(
  replaceUrl.endsWith("?" + plain.query),
  `Replicata: sync URL state.
Expectata: replaceState called with encoded query.
Resultata: replaceState URL was ${replaceUrl}.`,
);

console.log("qual pass: URL state round-trips and fails loudly on invalid query params");

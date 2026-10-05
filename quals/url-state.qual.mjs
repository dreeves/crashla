import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

// The VMT master alone: the encoder and parser name the window by its months
// (d=YYYY-MM.YYYY-MM), so they need the month series, which is parseVmtCsv's.
const vmtScript = fs.readFileSync("data/vmt.js", "utf8");

// A fresh page: the app's top level (no init) over stubs for the address bar
// and the URL banner. Every global holds its default, as at page load.
function makeHarness() {
  const location = { pathname: "/crashla", search: "", hash: "" };
  const replaced = [];
  // The banner: a stub with the two properties the code touches (hidden +
  // its text spans) and a dismiss button that records its handler.
  const bannerText = { textContent: "", hidden: false };
  const bannerRejected = { textContent: "", hidden: false };
  const banner = {
    hidden: true,
    querySelector(sel) {
      return { ".banner-text": bannerText, ".banner-rejected": bannerRejected }[sel] ?? null;
    },
  };
  const dismissButton = { addEventListener(type, fn) { if (type === "click") harness.dismiss = fn; } };
  const DOM = { "url-banner": banner, "url-banner-dismiss": dismissButton };
  const ctx = vm.createContext({
    console,
    Math,
    Set,
    URLSearchParams,
    document: {
      getElementById(id) { return DOM[id] ?? null; },
      createElement() { return { textContent: "", innerHTML: "" }; },
    },
    window: {
      location,
      history: {
        replaceState(_state, _title, url) {
          const s = String(url);
          replaced.push(s);
          const q = s.indexOf("?");
          const h = s.indexOf("#");
          location.search = q < 0 ? "" : s.slice(q, h < 0 ? s.length : h);
          location.hash = h < 0 ? "" : s.slice(h);
        },
      },
    },
  });
  vm.runInContext(vmtScript, ctx, { filename: "data/vmt.js" });
  vm.runInContext(appScript, ctx, { filename: "crashla.js" });
  vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
  // Every piece of state a link can set (Infinity survives JSON as a string).
  const stateCode = `({activeFilter, sortCol, sortAsc, monthHelmerEnabled, selectedMetricKey,
    monthRangeStart, monthRangeEnd: String(monthRangeEnd), vmtCumulative,
    selectedGrowthMetric, sectionCollapsed})`;
  const harness = { ctx, run, location, replaced, banner, bannerText, bannerRejected,
    dismiss: null, state: () => run(stateCode) };
  return harness;
}

const page = makeHarness();
const { ctx, location: locationStub, banner, bannerText } = page;
const lastReplace = () => page.replaced[page.replaced.length - 1] ?? "";

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

// --- Date range URL state: the window's months, not indices ---------------
// d= used to hold indices into the month series, whose first month moved
// twice (2025-06 -> 2022-11 on 2026-03-16, -> 2021-07 on 2026-06-17), so a
// March link d=1-6 (2025-07..2025-12) silently opened 2021-08..2022-01
// (audit #45). It now names the first and last month, dotted like c= and x=.

const dateRangeState = vm.runInContext(`
(() => {
  const months = vmtMonthList();
  // Set a non-default date range: 2025-07 .. 2025-12
  monthRangeStart = months.indexOf("2025-07");
  monthRangeEnd = months.indexOf("2025-12");
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
  monthRangeStart = -1;
  monthRangeEnd = Infinity;
  const defaultQuery = encodeUiStateQuery();
  // ... also once the default start has been resolved to its index
  monthRangeStart = months.indexOf(DEFAULT_START_MONTH);
  monthRangeEnd = months.length - 1;
  const resolvedDefaultQuery = encodeUiStateQuery();

  // Round trips at the series' two ends and a single month
  const roundTrip = (a, b) => {
    monthRangeStart = months.indexOf(a); monthRangeEnd = months.indexOf(b);
    const q = encodeUiStateQuery();
    monthRangeStart = -1; monthRangeEnd = Infinity;
    applyUiStateQuery(q);
    return {q, start: months[monthRangeStart], end: months[monthRangeEnd]};
  };
  const last = months[months.length - 1];
  const trips = [roundTrip(months[0], last), roundTrip(last, last), roundTrip(months[0], months[0]),
    roundTrip(DEFAULT_START_MONTH, months[months.length - 2])];

  monthRangeStart = -1;
  monthRangeEnd = Infinity;
  return {queryWithRange, restoredStart, restoredEnd, unchangedStart, unchangedEnd, defaultQuery,
    resolvedDefaultQuery, trips, first: months[0], last,
    expectStart: months.indexOf("2025-07"), expectEnd: months.indexOf("2025-12")};
})()
`, ctx);
const drPlain = JSON.parse(JSON.stringify(dateRangeState));

assert.ok(
  drPlain.queryWithRange.includes("d=2025-07.2025-12"),
  `Replicata: encode UI state with the window 2025-07 .. 2025-12.
Expectata: query string contains d=2025-07.2025-12.
Resultata: query was ${drPlain.queryWithRange}.`,
);

assert.equal(
  drPlain.restoredStart,
  drPlain.expectStart,
  `Replicata: apply query with d=2025-07.2025-12.
Expectata: monthRangeStart restored to the index of 2025-07 (${drPlain.expectStart}).
Resultata: monthRangeStart was ${drPlain.restoredStart}.`,
);

assert.equal(
  drPlain.restoredEnd,
  drPlain.expectEnd,
  `Replicata: apply query with d=2025-07.2025-12.
Expectata: monthRangeEnd restored to the index of 2025-12 (${drPlain.expectEnd}).
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
  !drPlain.defaultQuery.includes("d=") && !drPlain.resolvedDefaultQuery.includes("d="),
  `Replicata: encode UI state with the default window (DEFAULT_START_MONTH to the latest month), unresolved and resolved.
Expectata: query string does not contain d= key.
Resultata: queries were ${drPlain.defaultQuery} and ${drPlain.resolvedDefaultQuery}.`,
);

for (const trip of drPlain.trips) {
  const [, a, b] = /[?&]?d=(\d{4}-\d{2})\.(\d{4}-\d{2})/.exec(trip.q) ?? [];
  assert.ok(
    a !== undefined && trip.start === a && trip.end === b,
    `Replicata: encode a window, apply the query to a reset state, read the window back.
Expectata: d= names the window's first and last month and restores exactly those months.
Resultata: ${JSON.stringify(trip)}.`,
  );
}

// Unreadable d= values throw, as every unreadable owned value does: the
// index form (old links), a reversed window, months outside the series, and
// anything that is not two dotted months.
for (const d of ["abc", "5-2", "1-6", "47-62", "34-42", "2025-12.2025-07", "2019-01.2019-03",
                 `${drPlain.first}.2099-01`, "2025-07", "2025-7.2025-12", "2025-07.2025-12.2026-01",
                 "2025-07-2025-12", ""]) {
  let threw = false;
  try {
    vm.runInContext(`applyUiStateQuery(${JSON.stringify(`f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&d=${d}`)})`, ctx);
  } catch (_err) {
    threw = true;
  }
  assert.ok(
    threw,
    `Replicata: apply URL state with date range d=${d}.
Expectata: immediate throw (d= must be two months of the series, dotted, first <= last).
Resultata: no throw.`,
  );
}

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

vm.runInContext("sectionCollapsed = Object.fromEntries(SECTION_IDS.map(id => [id, false]));", ctx);

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
    `applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&d=2025-12.2025-07")`,
    ctx,
  );
} catch (_err) {
  threwReversedRange = true;
}
assert.ok(
  threwReversedRange,
  `Replicata: apply URL state with reversed date range d=2025-12.2025-07.
Expectata: immediate throw (start > end).
Resultata: no throw.`,
);

assert.ok(
  page.replaced.length > 0 && page.replaced[0].endsWith("?" + plain.query),
  `Replicata: sync URL state.
Expectata: replaceState called with encoded query.
Resultata: replaceState URL was ${page.replaced[0]}.`,
);

// A throw leaves the state as it was: the parser assigns nothing until every
// owned key has been read (a rejected link must not leave a half-applied
// state behind it).
{
  const before = page.state();
  let threw = false;
  try {
    vm.runInContext(`applyUiStateQuery("f=Tesla&s=speed&a=0&c=Waymo&m=injury&g=bogus")`, ctx);
  } catch (_err) {
    threw = true;
  }
  assert.ok(threw, "g=bogus must throw");
  assert.deepEqual(page.state(), before,
    `Replicata: apply a link whose f, s, a, c and m are readable but whose g= is not.
Expectata: it throws and no state changes (f=Tesla, s=speed, a=0, c=Waymo, m=injury are not applied).
Resultata: state changed to ${JSON.stringify(page.state())}.`);
}

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

// --- Keys the page does not own: reported and stripped, never fatal ---
// A link shared through Facebook arrives with ?fbclid=... appended; treating
// it as malformed state took the whole page down (2026-09-07). Foreign keys
// are not state: they are named in a dismissable banner and removed from the
// address bar, and the keys the page does own are still read strictly.

const withUnknown = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  activeFilter = "All"; sortCol = null; sortAsc = true;
  const unknown = applyUiStateQuery("f=Waymo&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&z=1&fbclid=abc");
  return { unknown, activeFilter };
})()
`, ctx)));
assert.deepEqual(
  withUnknown,
  { unknown: ["z", "fbclid"], activeFilter: "Waymo" },
  `Replicata: apply URL state carrying the page's keys plus z=1 and fbclid=abc.
Expectata: the parser returns the foreign keys in order and still applies the
owned state (filter Waymo).
Resultata: ${JSON.stringify(withUnknown)}.`,
);

const FBCLID = "IwY2xjawUMO35wZG9mBWV4dG4DYWVtAjEwAGJyaWQRMWRmTjNGSE1rR1AyYmVWRmRzcnRjBmFwcF9pZBAyMjIwMzkxNzg4MjAwODkyAAEeaMUK5pu8wD8vvBPhBBbhY4Vwlgdb25V8cMyRGCfujKdJ3kEUkpSqLF-PUKM_aem_qDHlZgziCVls0uwOE4M_eQ";
locationStub.search = `?fbclid=${FBCLID}`;
page.replaced.length = 0;
const fbLoad = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  activeFilter = "All"; sortCol = null; sortAsc = true; selectedMetricKey = "all";
  loadUiStateFromLocation();
  return { activeFilter, sortCol, search: window.location.search };
})()
`, ctx)));
assert.deepEqual(
  { ...fbLoad, hidden: banner.hidden, names: bannerText.textContent.includes("fbclid") },
  { activeFilter: "All", sortCol: null, search: `?${vm.runInContext("encodeUiStateQuery()", ctx)}`, hidden: false, names: true },
  `Replicata: open the page from a Facebook link (only ?fbclid=... in the URL).
Expectata: default state, the banner shown and naming fbclid, and the address
bar rewritten to the page's own state without it.
Resultata: ${JSON.stringify({ ...fbLoad, hidden: banner.hidden, text: bannerText.textContent })}.`,
);
assert.ok(!lastReplace().includes("fbclid"), `the rewritten URL still carries fbclid: ${lastReplace()}`);
assert.ok(!bannerText.hidden && page.bannerRejected.hidden,
  `Replicata: open the page from a Facebook link (only ?fbclid=... in the URL).
Expectata: the foreign-key sentence shows and the rejected-parameter sentence stays hidden (nothing of the page's own was rejected).
Resultata: foreign hidden=${bannerText.hidden}, rejected hidden=${page.bannerRejected.hidden} (${JSON.stringify(page.bannerRejected.textContent)}).`);

assert.equal(typeof page.dismiss, "function", "the dismiss button has a click handler");
page.dismiss();
assert.equal(banner.hidden, true, "dismissing hides the banner");

locationStub.search = "";
page.replaced.length = 0;
vm.runInContext("loadUiStateFromLocation()", ctx);
assert.deepEqual(
  { hidden: banner.hidden, search: locationStub.search },
  { hidden: true, search: `?${vm.runInContext("encodeUiStateQuery()", ctx)}` },
  `Replicata: open the page with no query string.
Expectata: no banner; the address bar carries the page's own state, as it
always has after init.
Resultata: ${JSON.stringify({ hidden: banner.hidden, search: locationStub.search })}.`,
);

const html = fs.readFileSync("index.html", "utf8");
assert.match(
  html,
  /<div id="url-banner" class="banner" role="alert" hidden>[\s\S]*?<span class="banner-text"><\/span>[\s\S]*?<span class="banner-rejected"><\/span>[\s\S]*?<button id="url-banner-dismiss" type="button">[^<]+<\/button>[\s\S]*?<\/div>/,
  "index.html carries the hidden banner with its two text spans (foreign keys, rejected own parameters) and dismiss button",
);
const css = fs.readFileSync("style.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
assert.match(css, /\.banner\[hidden\]\s*\{\s*display:\s*none;?\s*\}/,
  ".banner[hidden] must restore display: none, since .banner is a flex box");
// The banner quotes values as the link gave them, and one long unbroken value
// (c=HumansAV.HumansUS.HumansRideshare.Tesla.Waymo.Zoox.Bogus) pushed the
// page 250px wider than a 400px phone, the dismiss button off screen.
assert.match(css, /(^|\})\s*\.banner\s*\{[^}]*\boverflow-wrap:\s*anywhere\b/,
  `Replicata: read style.css's .banner rule.
Expectata: overflow-wrap: anywhere, so a long quoted value wraps inside the banner (a flex item's
minimum width only shrinks below a long word with "anywhere", not with "break-word").
Resultata: the rule has no overflow-wrap: anywhere.`);

// --- A dotted legacy m= value is invalid, not silently reduced -------------
// Until 2026-09-26 "m=injury.all" was parsed as the retired multi-metric
// format and rewritten to the first enabled key in METRIC_KEYS order (not
// even URL order), with no banner: the last DWIM path in the parser.
{
  let threw = false;
  try { vm.runInContext(`applyUiStateQuery("f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=injury.all")`, ctx); }
  catch (_err) { threw = true; }
  assert.ok(threw,
    `Replicata: apply URL state with a dotted metrics value (m=injury.all).
Expectata: it asserts (one metric key only), as m= empty and unknown keys do.
Resultata: accepted and reduced to one metric.`);
}

// --- A link this page cannot read: the default view, with the banner -------
// Until 2026-10-03 any owned-key rejection stopped init: nothing rendered
// below the abstract, the banner stayed hidden, the bad query stayed in the
// address bar, and the only trace was a console error (audit #3). That hit
// every default URL the site itself wrote 2026-03-18..06-11 (c=Humans...).
// Spec, extending the 2026-09-07 foreign-key rule to the page's own keys:
// the parser stays strict, and the loader shows the default view, names the
// rejected parameter(s) in the banner (key=value as given; a bare key for a
// required one the link left out; '' for an empty string), names any
// foreign keys as before, and rewrites the address bar from state.
const D = "f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const REJECTIONS = [
  // [query, rejected items the banner must name, foreign keys it must name]
  ["?f=All&s=-&a=1&c=Humans.Tesla.Waymo.Zoox&m=all", ["c=Humans.Tesla.Waymo.Zoox"], []],
  ["?m=injury", ["f", "s", "a", "c"], []],
  [`?${D.replace("m=atfault", "m=all.atfault")}`, ["m=all.atfault"], []],
  [`?${D.replace("m=atfault", "m=stationary")}`, ["m=stationary"], []],
  [`?${D.replace("m=atfault", "m=noInjury")}`, ["m=noInjury"], []],
  [`?${D.replace("m=atfault", "m=injuryOnly")}`, ["m=injuryOnly"], []],
  [`?${D.replace("m=atfault", "m=hospitalizationOnly")}`, ["m=hospitalizationOnly"], []],
  [`?${D.replace("m=atfault", "m=parkingLotNonstationary")}`, ["m=parkingLotNonstationary"], []],
  [`?${D.replace("m=atfault", "m=faultVariance")}`, ["m=faultVariance"], []],
  [`?${D.replace("s=-", "s=driver")}`, ["s=driver"], []],
  [`?${D.replace("s=-", "s=company")}`, ["s=company"], []],
  [`?${D}&v=0`, ["v=0"], []],
  [`?${D}&g=vmt`, ["g=vmt"], []],
  [`?${D}&x=bogus`, ["x=bogus"], []],
  [`?${D}&d=47-62`, ["d=47-62"], []],
  ["?f=All&s=-&a=1&c=Tesla.Waymo.Zoox&m=all&d=1-6", ["d=1-6"], []],
  [`?${D}&d=34-42`, ["d=34-42"], []],
  [`?${D}&d=2025-12.2025-07`, ["d=2025-12.2025-07"], []],
  ["?F=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault", ["f"], ["F"]],
  ["?utm_source=x&m=injury", ["f", "s", "a", "c"], ["utm_source"]],
  [`?${D.replace("f=All", "f=All&f=Tesla")}`, ["f=All", "f=Tesla"], []],
  [`?${D.replace("m=atfault", "m=")}`, ["m=''"], []],
  // A doubled "??" (audit 2026-10-04 #75): the query's first key is "?f",
  // a foreign key, so f is missing. Until 2026-10-04 applyUiStateQuery
  // sliced one "?" off and URLSearchParams another, and the link opened as
  // if it had one, with no banner.
  ["??f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=injury", ["f"], ["?f"]],
];
for (const [query, items, foreign] of REJECTIONS) {
  const p = makeHarness();
  const defaults = p.state();
  const defaultQuery = p.run("encodeUiStateQuery()");
  p.location.search = query;
  let threw = null;
  try { vm.runInContext("loadUiStateFromLocation()", p.ctx); } catch (err) { threw = err.message; }
  const rejectedText = p.bannerRejected.textContent;
  // Each item must stand as its own word of the sentence, the list in order
  // (so a bare "f" cannot be satisfied by a letter of some other word).
  const words = text => text.split(/[\s,]+/);
  const listed = items.every(item => words(rejectedText).includes(item)) &&
    rejectedText.includes(items.join(", "));
  const got = {
    threw, state: p.state(), search: p.location.search,
    bannerHidden: p.banner.hidden, rejectedHidden: p.bannerRejected.hidden, rejectedText,
    foreignHidden: p.bannerText.hidden, foreignText: p.bannerText.textContent,
  };
  const ok = threw === null &&
    JSON.stringify(got.state) === JSON.stringify(defaults) &&
    got.search === `?${defaultQuery}` &&
    !got.bannerHidden && !got.rejectedHidden && listed &&
    got.foreignHidden === (foreign.length === 0) &&
    foreign.every(key => words(got.foreignText).includes(key));
  assert.ok(ok,
    `Replicata: open the page at ${query}.
Expectata: no exception; the default view's state; the address bar rewritten to ?${defaultQuery};
the banner shown, naming ${items.join(", ")} as rejected${foreign.length ? ` and ${foreign.join(", ")} as foreign` : ", with the foreign-key sentence hidden"}.
Resultata: ${JSON.stringify(got)}.`);
}

// A key-less "=x" is a foreign key with an empty name: the banner shows it
// as '' rather than a blank between the dashes (audit #96).
{
  const p = makeHarness();
  p.location.search = `?=x&${D}`;
  vm.runInContext("loadUiStateFromLocation()", p.ctx);
  assert.ok(!p.banner.hidden && !p.bannerText.hidden && /''/.test(p.bannerText.textContent) && p.bannerRejected.hidden,
    `Replicata: open the page at ?=x&${D}.
Expectata: the banner names the stripped key-less parameter visibly, as '', and rejects nothing of the page's own.
Resultata: ${JSON.stringify({hidden: p.banner.hidden, text: p.bannerText.textContent, rejectedHidden: p.bannerRejected.hidden})}.`);
}

// --- The URL fragment survives the rewrite ---------------------------------
// syncUrlState's replaceState used to drop location.hash (audit #95): a
// #sec-... link lost its fragment, and Chromium and WebKit, which scroll to
// the fragment the URL carries when the page finishes loading, stayed at the
// top. With the fragment kept, all three engines land on the section on
// their own (checked in the browser, 2026-10-03); the page adds no scrolling
// of its own.
{
  const p = makeHarness();
  p.location.search = `?${D}`;
  p.location.hash = "#sec-fleet";
  vm.runInContext("loadUiStateFromLocation()", p.ctx);
  const url = p.replaced[p.replaced.length - 1] ?? "";
  assert.ok(url.endsWith(`?${D}#sec-fleet`) && p.location.hash === "#sec-fleet",
    `Replicata: open the page at ?${D}#sec-fleet.
Expectata: the rewritten address keeps #sec-fleet.
Resultata: replaceState URL ${JSON.stringify(url)}, hash ${JSON.stringify(p.location.hash)}.`);
  // ... and every later rewrite (a slider release, a collapsed section) too.
  vm.runInContext("monthRangeStart = vmtMonthList().indexOf('2025-07'); monthRangeEnd = vmtMonthList().indexOf('2025-12'); syncUrlState();", p.ctx);
  const later = p.replaced[p.replaced.length - 1] ?? "";
  assert.ok(later.endsWith("&d=2025-07.2025-12#sec-fleet"),
    `Replicata: open the page at ?${D}#sec-fleet, then change the window to 2025-07..2025-12.
Expectata: the address carries the new window and still ends in #sec-fleet.
Resultata: replaceState URL ${JSON.stringify(later)}.`);

  const bare = makeHarness();
  bare.location.hash = "#sec-sanity";
  vm.runInContext("loadUiStateFromLocation()", bare.ctx);
  const bareUrl = bare.replaced[bare.replaced.length - 1] ?? "";
  assert.ok(bareUrl === `/crashla?${bare.run("encodeUiStateQuery()")}#sec-sanity`,
    `Replicata: open the page at /#sec-sanity (no query).
Expectata: the address bar gains the default query and keeps #sec-sanity.
Resultata: replaceState URL ${JSON.stringify(bareUrl)}.`);
}

console.log("qual pass: URL state round-trips (d= by month), shows unreadable links as the default view with the banner, keeps the fragment, and reports foreign keys");

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
    this._textContent = String(v);
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

  querySelector() {
    return {
      addEventListener() {},
      classList: { toggle() {} },
    };
  }

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

const result = vm.runInContext(`
(() => {
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  buildMonthlyViews();
  const months = fullMonthSeries.months;
  return {
    sliderHtml: document.getElementById("date-range-controls").innerHTML,
    firstMonth: months[0],
    lastMonth: months[months.length - 1],
  };
})()
`, ctx);

const plain = JSON.parse(JSON.stringify(result));

assert.ok(
  plain.sliderHtml.includes(
    `<span class="date-range-end-label min">${plain.firstMonth}</span>`),
  `Replicata: build the monthly views and render the date range slider.
Expectata: the slider labels its left end with the first month of the full series (${plain.firstMonth}).
Resultata: no min end label for ${plain.firstMonth} in the slider markup.`,
);

assert.ok(
  plain.sliderHtml.includes(
    `<span class="date-range-end-label max">${plain.lastMonth}</span>`),
  `Replicata: build the monthly views and render the date range slider.
Expectata: the slider labels its right end with the last month of the full series (${plain.lastMonth}).
Resultata: no max end label for ${plain.lastMonth} in the slider markup.`,
);

const ariaLabels = [...plain.sliderHtml.matchAll(/aria-label="([^"]*)"/g)]
  .map(m => m[1]);
assert.equal(
  ariaLabels.length,
  2,
  `Replicata: build the monthly views and render the date range slider.
Expectata: both range inputs carry an aria-label for screen readers.
Resultata: found ${ariaLabels.length} aria-label attributes (${JSON.stringify(ariaLabels)}).`,
);

// The sliders announce months, not series indices (audit #33): aria-valuetext
// is the month each thumb stands for, at render and as it moves.
const valueTexts = [...plain.sliderHtml.matchAll(/aria-valuetext="([^"]*)"/g)].map(m => m[1]);
const defaultStart = vm.runInContext("DEFAULT_START_MONTH", ctx);
assert.deepEqual(
  valueTexts,
  [defaultStart, plain.lastMonth],
  `Replicata: build the monthly views and read the two range inputs' aria-valuetext.
Expectata: the months of the default window's ends (${defaultStart}, ${plain.lastMonth}), not their indices.
Resultata: ${JSON.stringify(valueTexts)}.`,
);
const moved = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const months = fullMonthSeries.months;
  const min = document.getElementById("date-range-min");
  const max = document.getElementById("date-range-max");
  min.value = String(months.indexOf(${JSON.stringify(defaultStart)}) - 1);
  max.value = String(months.length - 2);
  for (const fn of min.listeners.input) fn();
  return { want: [months[Number(min.value)], months[Number(max.value)]],
    got: [min.getAttribute("aria-valuetext"), max.getAttribute("aria-valuetext")] };
})()
`, ctx)));
assert.deepEqual(
  moved.got,
  moved.want,
  `Replicata: move the start thumb one month earlier and the end thumb one month back, then fire the input event.
Expectata: each input's aria-valuetext follows its own month (${JSON.stringify(moved.want)}).
Resultata: ${JSON.stringify(moved.got)}.`,
);

// --- The thumbs cannot cross (audit 2026-10-04 #14) -------------------------
// A moved thumb stops at the other (the WAI-ARIA multi-thumb slider), so
// "Start month" always holds the window's first month and "End month" its
// last. Until 2026-10-04 the thumbs crossed: after End on "Start month" and
// Home on "End month", the start input announced 2026-08 and the end input
// 2021-07 for the window 2021-07..2026-08, and ArrowRight on "End month" then
// moved the window's start.
const crossed = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  monthRangeStart = -1; monthRangeEnd = Infinity;
  // A browser's re-render makes new inputs; the stub's are the same objects,
  // so drop the listeners the first render attached.
  for (const id of ["date-range-min", "date-range-max", "date-range-fill"]) document.getElementById(id).listeners = {};
  buildMonthlyViews();
  const months = fullMonthSeries.months, last = months.length - 1;
  const min = document.getElementById("date-range-min");
  const max = document.getElementById("date-range-max");
  // The stub keeps an input's value across renders; a browser takes it from
  // the rendered markup (the default window).
  min.value = String(monthRangeStart); max.value = String(last);
  const fire = (input, type) => { for (const fn of input.listeners[type]) fn(); };
  const read = () => ({ start: [min.value, min.getAttribute("aria-valuetext")], end: [max.value, max.getAttribute("aria-valuetext")],
    window: [monthRangeStart, monthRangeEnd] });
  const steps = [];
  min.value = String(last); fire(min, "input"); fire(min, "change"); steps.push(read()); // End on "Start month"
  max.value = "0"; fire(max, "input"); fire(max, "change"); steps.push(read());           // Home on "End month"
  min.value = "10"; fire(min, "input");                                                     // drag the start thumb back
  max.value = "5"; fire(max, "input"); steps.push(read());                                  // drag the end thumb past it
  min.value = "20"; fire(min, "input"); steps.push(read());                                 // and the start thumb past the end
  return { last, months: [months[10], months[last]], steps };
})()
`, ctx)));
{
  const { last, months: [m10, mLast], steps } = crossed;
  // Each step's moved thumb stops at the other: "Start month" at the end
  // thumb's last month, "End month" at the start thumb's month (last, then 10).
  const want = [
    { start: [String(last), mLast], end: [String(last), mLast], window: [last, last] },
    { start: [String(last), mLast], end: [String(last), mLast], window: [last, last] },
    { start: ["10", m10], end: ["10", m10], window: [10, 10] },
    { start: ["10", m10], end: ["10", m10], window: [10, 10] },
  ];
  assert.deepEqual(steps, want,
    `Replicata: on the default window, press End on "Start month", then Home on "End month"; then drag the start thumb to month 10, the end thumb to month 5 (past it), and the start thumb to month 20 (past the end).
Expectata: each moved thumb stops at the other, so "Start month" always holds the window's first month and "End month" its last: ${JSON.stringify(want)} (values, aria-valuetexts, window indices).
Resultata: ${JSON.stringify(steps)}.`);
}

// While the two thumbs share a month, the start thumb is drawn over the end
// thumb in the slider's right half and under it in the left half, so the one
// that can still move outward is the one a pointer grabs. With crossing gone,
// a window collapsed onto the last month would otherwise trap a pointer: the
// end thumb, on top, cannot move left past the start thumb it hides.
const stacked = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const months = fullMonthSeries.months, last = months.length - 1;
  const min = document.getElementById("date-range-min");
  const max = document.getElementById("date-range-max");
  const fire = (input, type) => { for (const fn of input.listeners[type]) fn(); };
  // Both thumbs onto month v, in an order no clamp interferes with: start to
  // 0, end to v, start to v.
  const at = v => {
    min.value = "0"; fire(min, "input");
    max.value = String(v); fire(max, "input");
    min.value = String(v); fire(min, "input");
    return Number(min.style.zIndex || 2) > Number(max.style.zIndex || 3);
  };
  return { atLast: at(last), atFirst: at(0), rightHalf: at(last - 3), leftHalf: at(3) };
})()
`, ctx)));
assert.deepEqual(stacked, { atLast: true, atFirst: false, rightHalf: true, leftHalf: false },
  `Replicata: collapse the window onto one month at the series' last month, its first month, and a month near each end; compare the two inputs' z-index (style.css: start 2, end 3).
Expectata: the start thumb on top in the right half (it can still move left), the end thumb on top in the left half (it can still move right).
Resultata: start thumb on top: ${JSON.stringify(stacked)}.`);

// --- One address-bar write per commit, after every view (audit 2026-10-04 #10)
// WebKit allows 100 history.replaceState calls per 10 s. A commit wrote the
// URL twice (commitRange, then renderTable) and the first write came before
// the sanity checks and the incident browser were rebuilt, so on a held arrow
// key the 101st write threw and left both on an older window.
const commits = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  const months = fullMonthSeries.months, last = months.length - 1;
  const min = document.getElementById("date-range-min");
  const max = document.getElementById("date-range-max");
  const fire = (input, type) => { for (const fn of input.listeners[type]) fn(); };
  const heading = () => document.getElementById("incident-browser-heading").textContent;
  const sanity = () => document.getElementById("sanity-checks").innerHTML;
  const writes = [];
  window.history.replaceState = () => writes.push({ heading: heading(), sanity: sanity() });
  max.value = String(last); fire(max, "input"); fire(max, "change");
  min.value = String(last - 4); fire(min, "input");
  writes.length = 0;
  fire(min, "change");
  const commit = { writes: writes.length, headingAtWrite: writes.map(w => w.heading),
    sanityCurrentAtWrite: writes.map(w => w.sanity === sanity()), heading: heading() };
  // WebKit's throw: the views still follow the slider.
  window.history.replaceState = () => { throw new Error("SecurityError: Attempt to use history.replaceState() more than 100 times per 10 seconds"); };
  min.value = String(last - 9); fire(min, "input");
  let threw = null;
  try { fire(min, "change"); } catch (err) { threw = String(err.message).slice(0, 40); }
  const thrown = { threw, heading: heading(), sanityHasWindow: sanity() === (buildSanityChecks(), sanity()) };
  window.history.replaceState = () => {};
  return { want: "Incident browser using data from " + months[last - 4] + " to " + months[last],
    wantAfterThrow: "Incident browser using data from " + months[last - 9] + " to " + months[last], commit, thrown };
})()
`, ctx)));
assert.ok(commits.commit.writes === 1 && commits.commit.headingAtWrite[0] === commits.want && commits.commit.sanityCurrentAtWrite[0] === true,
  `Replicata: move the start thumb four months back from the last month and release it (the change event), counting history.replaceState calls.
Expectata: exactly one, made after the incident browser ("${commits.want}") and the sanity section were rebuilt for the new window.
Resultata: ${commits.commit.writes} writes; heading at each write ${JSON.stringify(commits.commit.headingAtWrite)}; sanity section already rebuilt at each write: ${JSON.stringify(commits.commit.sanityCurrentAtWrite)}.`);
assert.ok(commits.thrown.threw !== null && commits.thrown.heading === commits.wantAfterThrow && commits.thrown.sanityHasWindow,
  `Replicata: with history.replaceState throwing (WebKit past 100 calls in 10 s), move the start thumb nine months back from the last month and release it.
Expectata: the throw reaches the caller, and the incident browser ("${commits.wantAfterThrow}") and the sanity section already show the new window.
Resultata: ${JSON.stringify(commits.thrown)}.`);

console.log("qual pass: date range slider labels its endpoints and its inputs, its inputs announce months, its thumbs cannot cross, and a commit writes the URL once, last");

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

console.log("qual pass: date range slider labels its endpoints and its inputs, and its inputs announce months");

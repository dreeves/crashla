// The date slider's work per animation frame (audit 2026-10-04 #23). A key
// press on a slider fires "input" and then "change". Until 2026-10-05 the
// input event drew the charts and cards on the next frame and the change event
// committed at once (charts and cards again, the sanity section, the incident
// browser, the URL), so every press drew the charts twice with identical
// markup and computed the window's summary rows six times; and a held key
// (30 presses a second) ran a ~0.4 s commit for every press, so the page went
// on working for ~13 s after the key was released. A drag's release likewise
// redrew the charts its last frame had already drawn. Spec, in a DOM stub with
// a hand-run animation-frame queue:
//  - a press draws the charts and cards once and commits once, in the next
//    frame, computing the window's summary rows once;
//  - however many presses arrive between two frames, the next frame draws and
//    commits once, for the window the thumbs then hold, and the page it leaves
//    is the page a full rebuild draws for that window;
//  - a release after a drag commits without redrawing the window the drag's
//    last frame drew;
//  - a commit asked for before a later thumb move in the same frame commits
//    the later window;
//  - a commit whose URL write throws (WebKit past 100 replaceState calls in
//    10 s) leaves no commit pending: a later drag commits only on release;
//  - without requestAnimationFrame (as in the other quals' stubs) a press
//    still draws once and commits once, at once.
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
  set textContent(v) { this._textContent = String(v); }
  get textContent() { return this._textContent; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { for (const node of nodes) node.parentNode = this; this.children = [...nodes]; }
  addEventListener(type, fn) { this.listeners[type] = [...(this.listeners[type] || []), fn]; }
  setAttribute(name, value) { this._attributes[name] = value; }
  getAttribute(name) { return this._attributes[name] ?? null; }
  focus() {}
  querySelector() { return { addEventListener() {}, classList: { toggle() {} } }; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
}

// A page in a fresh context. withFrames: requestAnimationFrame queues its
// callback until the qual runs the frame (flush); without it the app draws at
// once, as in the other quals' stubs.
function makePage(withFrames) {
  const nodeById = new Map();
  const getNode = id => {
    if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div", id));
    return nodeById.get(id);
  };
  const frames = [];
  const writes = [];
  const globals = {
    console, Math, Number, URLSearchParams,
    document: {
      getElementById: getNode,
      createElement: tag => new ElementStub(tag),
      body: new ElementStub("body"),
      activeElement: new ElementStub("body"),
      addEventListener() {},
    },
    window: {
      innerWidth: 1024, innerHeight: 768,
      location: { search: "", pathname: "/crashla", hash: "" },
      history: { replaceState: (s, t, url) => writes.push(url) },
    },
  };
  if (withFrames) globals.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  const ctx = vm.createContext(globals);
  vm.runInContext(dataScript, ctx, { filename: "data.js" });
  vm.runInContext(appScript, ctx, { filename: "crashla.js" });
  vm.runInContext(`
    incidents = INCIDENT_DATA;
    vmtRows = parseVmtCsv(VMT_CSV_TEXT);
    faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
    buildMonthlyViews();
    // Count the work: chart-and-card draws, summary-row computations, sanity
    // and incident-browser builds.
    var counts = { draw: 0, summary: 0, sanity: 0, browser: 0 };
    renderWindowedViews = (f => function () { counts.draw++; return f.apply(this, arguments); })(renderWindowedViews);
    monthlySummaryRows = (f => function () { counts.summary++; return f.apply(this, arguments); })(monthlySummaryRows);
    buildSanityChecks = (f => function () { counts.sanity++; return f.apply(this, arguments); })(buildSanityChecks);
    buildBrowser = (f => function () { counts.browser++; return f.apply(this, arguments); })(buildBrowser);
    // The stub keeps an input's value across renders; a browser takes it from
    // the rendered markup (the default window).
    document.getElementById("date-range-min").value = String(monthRangeStart);
    document.getElementById("date-range-max").value = String(fullMonthSeries.months.length - 1);
  `, ctx);
  const run = src => JSON.parse(JSON.stringify(vm.runInContext(src, ctx)));
  const flush = () => { while (frames.length > 0) for (const fn of frames.splice(0)) fn(0); };
  const fire = (id, type) => vm.runInContext(`for (const fn of document.getElementById(${JSON.stringify(id)}).listeners[${JSON.stringify(type)}] || []) fn();`, ctx);
  const press = (id, delta) => {
    vm.runInContext(`{ const el = document.getElementById(${JSON.stringify(id)}); el.value = String(Number(el.value) + (${delta})); }`, ctx);
    fire(id, "input");
    fire(id, "change");
  };
  const counts = () => run(`({...counts})`);
  const reset = () => { vm.runInContext(`for (const k of Object.keys(counts)) counts[k] = 0;`, ctx); writes.length = 0; };
  // What the window's views show: the slider's window, the incident browser
  // (heading, filters, rows), the sanity section, the charts and cards, the
  // headings, and the address the page last wrote.
  const views = () => ({
    ...run(`(() => {
      const el = id => document.getElementById(id);
      return {
        window: [monthRangeStart, monthRangeEnd],
        heading: el("incident-browser-heading").textContent,
        filters: el("filters").children.map(b => b.textContent),
        rows: el("incidents-body").children.map(tr => tr.innerHTML),
        sanity: el("sanity-checks").innerHTML,
        mpi: el("chart-mpi-all").innerHTML,
        dist: el("chart-distributions").innerHTML,
        cards: el("mpi-summary-cards").innerHTML,
        vmt: el("chart-helmer-series").innerHTML,
        headings: [el("mpi-heading").textContent, el("dist-heading").textContent],
      };
    })()`),
    url: writes[writes.length - 1] ?? null,
  });
  // A full rebuild of every view for the current state, as a fresh load draws it.
  const rebuild = () => {
    vm.runInContext(`
      for (const id of ["date-range-min", "date-range-max", "date-range-fill"]) document.getElementById(id).listeners = {};
      buildMonthlyViews();`, ctx);
  };
  const lastIdx = run(`fullMonthSeries.months.length - 1`);
  const months = run(`fullMonthSeries.months`);
  return { run, flush, fire, press, counts, reset, views, rebuild, writes, frames, lastIdx, months };
}

const diffKeys = (a, b) => Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

// --- One press: one draw, one summary, one commit, in the next frame -------
{
  const p = makePage(true);
  p.reset();
  p.press("date-range-min", -1);
  const beforeFrame = p.counts();
  p.flush();
  const after = p.counts();
  const want = { draw: 1, summary: 1, sanity: 1, browser: 1 };
  assert.ok(JSON.stringify(after) === JSON.stringify(want) && p.writes.length === 1,
    `Replicata: on the default view, press ArrowLeft on "Start month" (input, then change) and run the next animation frame.
Expectata: the charts and cards drawn once, the window's summary rows computed once, the sanity section and the incident browser built once, the URL written once: ${JSON.stringify(want)}, 1 write.
Resultata: before the frame ${JSON.stringify(beforeFrame)}; after it ${JSON.stringify(after)}, ${p.writes.length} URL writes.`);
}

// --- A held key: 30 presses before a frame, one draw and one commit --------
{
  const p = makePage(true);
  p.reset();
  for (let i = 0; i < 30; i++) p.press("date-range-min", -1);
  const beforeFrame = p.counts();
  const writesBefore = p.writes.length;
  p.flush();
  const after = p.counts();
  const got = p.views();
  const want = { draw: 1, summary: 1, sanity: 1, browser: 1 };
  assert.ok(JSON.stringify(beforeFrame) === JSON.stringify({ draw: 0, summary: 0, sanity: 0, browser: 0 }) && writesBefore === 0 &&
    JSON.stringify(after) === JSON.stringify(want) && p.writes.length === 1,
    `Replicata: on the default view, press ArrowLeft on "Start month" 30 times before the next animation frame (a held key), then run the frame.
Expectata: nothing drawn or committed before the frame; in it the charts and cards drawn once, the summary rows computed once, the sanity section and the incident browser built once and the URL written once (${JSON.stringify(want)}).
Resultata: before the frame ${JSON.stringify(beforeFrame)}, ${writesBefore} URL writes; after it ${JSON.stringify(after)}, ${p.writes.length} URL writes.`);
  const startMonth = p.months[got.window[0]];
  p.rebuild();
  const full = p.views();
  const differ = diffKeys(got, full);
  assert.ok(differ.length === 0 && startMonth === p.months[p.months.indexOf("2025-06") - 30],
    `Replicata: hold ArrowLeft on "Start month" for 30 presses before a frame, run the frame, then rebuild every view from scratch for the same state.
Expectata: the window starts 30 months before 2025-06 and the coalesced commit left exactly the page the full rebuild draws (slider window, incident browser, sanity section, charts, cards, headings, URL).
Resultata: window starts ${startMonth}; views differing: ${JSON.stringify(differ)}.`);
}

// --- A drag, then its release: the release commits without a redraw --------
{
  const p = makePage(true);
  for (let i = 0; i < 5; i++) {
    p.run(`{ const el = document.getElementById("date-range-max"); el.value = String(Number(el.value) - 1); }`);
    p.fire("date-range-max", "input");
    p.flush();
  }
  const drag = p.counts();
  p.reset();
  p.fire("date-range-max", "change");
  p.fire("date-range-max", "pointerup");
  p.flush();
  const release = p.counts();
  assert.ok(drag.draw === 5 && drag.browser === 0 && drag.sanity === 0 &&
    JSON.stringify(release) === JSON.stringify({ draw: 0, summary: 0, sanity: 1, browser: 1 }) && p.writes.length === 1,
    `Replicata: drag "End month" five months left, one month per animation frame, then release it (change and pointerup) and run the next frame.
Expectata: the drag draws the charts and cards in each of its five frames and commits nothing; the release commits once (sanity section, incident browser, one URL write) and draws nothing, since the drag's last frame drew that window.
Resultata: drag ${JSON.stringify(drag)}; release ${JSON.stringify(release)}, ${p.writes.length} URL writes.`);
}

// --- A commit asked for before a later thumb move in the same frame --------
{
  const p = makePage(true);
  p.reset();
  p.fire("date-range-min", "pointerup");                  // a release (no move yet)
  p.press("date-range-min", -2);                          // then a press moves the thumb, before the frame
  p.flush();
  const after = p.counts();
  const got = p.views();
  const startMonth = p.months[got.window[0]];
  const want = p.months[p.months.indexOf("2025-06") - 2];
  assert.ok(startMonth === want && got.heading.startsWith(`Incident browser using data from ${want} `) &&
    JSON.stringify(after) === JSON.stringify({ draw: 1, summary: 1, sanity: 1, browser: 1 }),
    `Replicata: release "Start month" (pointerup), then move it two months left with a key press before the next animation frame, then run the frame.
Expectata: one draw and one commit, both for the later window (start ${want}): the incident browser's heading names it.
Resultata: window starts ${startMonth}, heading ${JSON.stringify(got.heading)}, counts ${JSON.stringify(after)}.`);
}

// --- A commit whose URL write throws leaves no commit pending --------------
// WebKit allows 100 history.replaceState calls in 10 s and throws a
// SecurityError past them (audit #10); the throw ends that frame's commit,
// after its views. Until 2026-10-05 (review) the frame left the commit request
// standing when it threw, so every later frame that drew a new window
// committed as well: in WebKit past the limit, a mouse drag of the fill
// rebuilt the incident browser on each of its frames (6 builds in a 6-step
// drag), which a drag in progress must not do.
{
  const p = makePage(true);
  p.run(`(window.__replaceState = window.history.replaceState, window.history.replaceState = () => { throw new Error("SecurityError: Attempt to use history.replaceState() more than 100 times per 10 seconds"); }, true)`);
  p.press("date-range-min", -1);
  let threw = null;
  try { p.flush(); } catch (e) { threw = e.message; }
  p.run(`(window.history.replaceState = window.__replaceState, true)`);
  p.reset();
  for (let i = 0; i < 3; i++) {
    p.run(`{ const el = document.getElementById("date-range-max"); el.value = String(Number(el.value) - 1); }`);
    p.fire("date-range-max", "input");
    p.flush();
  }
  const drag = p.counts();
  p.fire("date-range-max", "change");
  p.fire("date-range-max", "pointerup");
  p.flush();
  const release = p.counts();
  assert.ok(threw !== null && /more than 100 times/.test(threw) &&
    drag.draw === 3 && drag.sanity === 0 && drag.browser === 0 &&
    release.sanity === 1 && release.browser === 1 && p.writes.length === 1,
    `Replicata: with history.replaceState throwing (WebKit past 100 calls in 10 s), press ArrowLeft on "Start month" and run the next animation frame; then, with replaceState working again, drag "End month" three months left, one month per frame, and release it.
Expectata: the press's frame throws the SecurityError; the drag draws the charts and cards in each of its three frames and commits nothing; the release commits once (sanity section, incident browser, one URL write).
Resultata: thrown ${JSON.stringify(threw)}; drag ${JSON.stringify(drag)}; after the release ${JSON.stringify(release)}, ${p.writes.length} URL writes.`);
}

// --- No requestAnimationFrame: a press draws once and commits once, at once --
{
  const p = makePage(false);
  p.reset();
  p.press("date-range-min", -1);
  const after = p.counts();
  assert.ok(JSON.stringify(after) === JSON.stringify({ draw: 1, summary: 1, sanity: 1, browser: 1 }) && p.writes.length === 1,
    `Replicata: in a page without requestAnimationFrame, press ArrowLeft on "Start month" (input, then change).
Expectata: at once, the charts and cards drawn once, the summary rows computed once, the sanity section and the incident browser built once and one URL write.
Resultata: ${JSON.stringify(after)}, ${p.writes.length} URL writes.`);
}

console.log("qual pass: the date slider draws once and commits once per animation frame, for the window its thumbs then hold, and a release redraws nothing");

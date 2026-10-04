// Tooltips must pin on tap in WebKit (iPhone Safari). WebKit synthesizes a
// click from a tap only on nodes it deems clickable -- ones with their own
// click/mouse listeners, links and form controls. The pin/dismiss logic is a
// delegated click listener on document, so on an iPhone a tap on a chart
// dot, a card's Effective-VMT line or a "[?]" hint pinned nothing, and a tap
// on the "[?]" hint was retargeted to the neighbouring source link and
// navigated away (measured in playwright's WebKit with the iPhone 14
// descriptor, 2026-09-26; a per-element no-op click listener fixes both,
// `cursor: pointer` does not). armTipTargets gives every [data-tip] element
// that listener; a MutationObserver re-arms after each render. The first two
// checks pin that mechanism in node (its wiring, then armTipTargets itself).
//
// The same heuristic left a pinned tooltip stuck on screen: a tap on a
// paragraph, a table cell or a chart's empty plot area produced no click, so
// the "clicked elsewhere" dismissal never ran (audit #31, 2026-10-03). Since
// then document.body carries the same no-op listener. The last check taps
// through it in WebKit with the iPhone 14 descriptor.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const js = fs.readFileSync(new URL("../crashla.js", import.meta.url), "utf8");
const init = js.slice(js.indexOf("function initTooltips()"), js.indexOf("// --- Prediction markets"));
assert.ok(/armTipTargets\(document\)/.test(init) && /new MutationObserver\(\(\) => armTipTargets\(document\)\)\s*\.observe\(document\.body, \{\s*childList: true, subtree: true\s*\}\)/.test(init),
  `Replicata: read initTooltips in crashla.js.
Expectata: it arms the existing [data-tip] elements and observes document.body (childList + subtree) to arm the ones each render creates.
Resultata: wiring not found.`);

// Function level: every [data-tip] element under the root gets ONE click
// listener, and arming twice adds nothing (the same listener reference is
// passed each time, which the DOM de-duplicates).
class Stub {
  constructor() { this.listeners = []; }
  addEventListener(type, fn) { if (!this.listeners.some(l => l.type === type && l.fn === fn)) this.listeners.push({ type, fn }); }
}
const ctx = vm.createContext({ console, Math, Number, document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } } });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const stubs = [new Stub(), new Stub(), new Stub()];
const root = { querySelectorAll: sel => (sel === "[data-tip]" ? stubs : []) };
const arm = vm.runInContext("armTipTargets", ctx);
arm(root); arm(root);
assert.ok(stubs.every(s => s.listeners.length === 1 && s.listeners[0].type === "click" && typeof s.listeners[0].fn === "function"),
  `Replicata: call armTipTargets twice on a root holding three [data-tip] elements.
Expectata: each element ends with exactly one click listener.
Resultata: ${JSON.stringify(stubs.map(s => s.listeners.map(l => l.type)))}.`);

// --- iPhone: a tap on page content dismisses a pinned tooltip -------------

const { ENGINES, devices, serveRepo, openPage } = await import("./browser.mjs");
const server = await serveRepo();
const browser = await ENGINES.webkit.launch();
const page = await openPage(browser, server.url + "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault", devices["iPhone 14"]);
const shown = () => page.evaluate(() => getComputedStyle(document.getElementById("chart-tip")).display !== "none");
// Taps the centre of the `nth` element matching `selector` that is the
// topmost element there (so the tap lands on it, not on a neighbour). Each
// candidate is brought to the middle of the screen before its centre is
// probed: since 2026-10-03 a phone draws the charts at their declared size
// (audit #28), so the MPI chart's tall CI bands no longer fit on screen
// beside the first one, whose centre lies under the dots' hit circles.
const tapOn = async (selector, label, nth = 0) => {
  const point = await page.evaluate(([sel, nth]) => {
    let seen = 0;
    for (const el of document.querySelectorAll(sel)) {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (r.width > 0 && r.y >= 0 && r.bottom <= innerHeight && document.elementFromPoint(x, y) === el) {
        if (seen === nth) return { x, y };
        seen += 1;
      }
    }
    return null;
  }, [selector, nth]);
  assert.ok(point !== null, `no tappable ${label} (${selector}, #${nth}) on the iPhone layout`);
  await page.touchscreen.tap(point.x, point.y);
};
const steps = [];
const DOT = "#chart-mpi-all circle[data-tip]";
// A different dot each time: a tap on a new target re-pins even if the last
// tooltip was left stuck, so each step tests its own dismissal.
for (const [i, [selector, label]] of [
  ["#sanity-checks > p", "a paragraph in the sanity-check section"],
  ["#incidents-body td:nth-child(3)", "a Location cell in the incident table"],
  ["#chart-mpi-all svg > path", "the MPI chart's plot (a CI band)"],
].entries()) {
  await tapOn(DOT, "MPI-chart dot", i);
  const pinned = await shown();
  await tapOn(selector, label);
  steps.push({ label, pinned, afterTap: await shown() });
}
const stuck = steps.filter(s => !s.pinned || s.afterTap);
assert.deepEqual(stuck, [],
  `Replicata: open the default view in WebKit with the iPhone 14 descriptor, tap a dot on the MPI chart, then tap
page content that is not a tooltip target (a paragraph, a Location cell, the chart's plot).
Expectata: the tap on the dot pins its tooltip, and the tap elsewhere dismisses it.
Resultata: ${JSON.stringify(steps)}.`);
assert.deepEqual(page.errors, [], `uncaught page errors: ${JSON.stringify(page.errors)}`);
await browser.close();
await server.close();

console.log("qual pass: tooltip targets carry their own click listener (WebKit tap-to-pin), re-arm after every render, and on an iPhone a tap elsewhere dismisses a pinned tooltip");

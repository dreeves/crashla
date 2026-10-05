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
//
// The plot tap must land on empty plot, away from every tooltip target. It was
// the centre of the first CI band's box, which on simulated Oct-15 data lay on
// the edge of a dot's hit circle, and WebKit's tap targeting delivered the tap
// to the dot, re-pinning its tooltip (audit 2026-10-04 #59). The tap point is
// now chosen on a CI band, at least TAP_CLEARANCE px from every target.
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
// A point of the MPI chart's plot on a CI band (the topmost element there is
// a band's <path>) and at least TAP_CLEARANCE px from every tooltip target's
// box, with the chart brought to the middle of the screen. Taps it.
const TAP_CLEARANCE = 20;
const tapEmptyPlot = async () => {
  const point = await page.evaluate(clearance => {
    const svg = document.querySelector("#chart-mpi-all svg");
    svg.scrollIntoView({ block: "center" });
    const boxes = [...document.querySelectorAll("[data-tip]")].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
    const gap = (x, y) => Math.min(...boxes.map(r => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))));
    const s = svg.getBoundingClientRect();
    let best = null;
    for (let y = Math.max(s.top, 0) + 4; y < Math.min(s.bottom, innerHeight) - 4; y += 4) {
      for (let x = s.left + 4; x < s.right - 4; x += 4) {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || hit.tagName !== "path" || hit.parentNode !== svg) continue;
        const g = gap(x, y);
        if (g >= clearance && (best === null || g > best.g)) best = { x, y, g };
      }
    }
    return best;
  }, TAP_CLEARANCE);
  assert.ok(point !== null, `no point of the MPI chart's CI bands lies ${TAP_CLEARANCE}px from every tooltip target on the iPhone layout`);
  await page.touchscreen.tap(point.x, point.y);
};
const steps = [];
const DOT = "#chart-mpi-all circle[data-tip]";
// A different dot each time: a tap on a new target re-pins even if the last
// tooltip was left stuck, so each step tests its own dismissal.
for (const [i, [label, tapElsewhere]] of [
  ["a paragraph in the sanity-check section", () => tapOn("#sanity-checks > p", "a paragraph in the sanity-check section")],
  ["a Location cell in the incident table", () => tapOn("#incidents-body td:nth-child(3)", "a Location cell in the incident table")],
  ["the MPI chart's plot (a CI band)", tapEmptyPlot],
].entries()) {
  await tapOn(DOT, "MPI-chart dot", i);
  const pinned = await shown();
  await tapElsewhere();
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

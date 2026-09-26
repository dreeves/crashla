// Tooltips must pin on tap in WebKit (iPhone Safari). WebKit synthesizes a
// click from a tap only on nodes it deems clickable -- ones with their own
// click/mouse listeners, links and form controls. The pin/dismiss logic is a
// delegated click listener on document, so on an iPhone a tap on a chart
// dot, a card's Effective-VMT line or a "[?]" hint pinned nothing, and a tap
// on the "[?]" hint was retargeted to the neighbouring source link and
// navigated away (measured in playwright's WebKit with the iPhone 14
// descriptor, 2026-09-26; a per-element no-op click listener fixes both,
// `cursor: pointer` does not). armTipTargets gives every [data-tip] element
// that listener; a MutationObserver re-arms after each render. No qual drives
// a browser, so this pins the mechanism: the function and its wiring.
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

console.log("qual pass: tooltip targets carry their own click listener (WebKit tap-to-pin) and re-arm after every render");

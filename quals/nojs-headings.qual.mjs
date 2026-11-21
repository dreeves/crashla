// Without JavaScript the section headings are plain headings. Driven in
// Chromium, Firefox and WebKit with JavaScript disabled.
//
// The headings' text spans were role="button" Tab stops in index.html itself
// (2026-10-03, audit #30), so with JavaScript off a reader met nine inert
// "buttons", two of them empty and nameless, that Enter did nothing to (audit
// 2026-10-04 #66). Since 2026-10-04 crashla.js initCollapsibles gives the
// spans their role and Tab stop when it wires them; quals/keyboard-focus.qual.mjs
// checks the scripted page, which is unchanged.
//
// The count of headings is crashla.js's SECTION_IDS (one collapsible section
// each), read from the app: until 2026-11-20, when the assumptions section
// made ten, this qual pinned nine (restated under the human's go of that day,
// "can we get all such assumptions clearly listed in one place on the page?",
// with its intent unchanged: every heading plain without JavaScript).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";
import { ENGINES, serveRepo } from "./browser.mjs";

const app = vm.createContext({ console, document: {
  getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } } });
vm.runInContext(appScript, app, { filename: "crashla.js" });
const SECTIONS = vm.runInContext("SECTION_IDS.length", app);

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const toggles = [...html.matchAll(/<span class="sec-toggle"([^>]*)>/g)].map(m => m[1]);
assert.ok(toggles.length === SECTIONS && toggles.every(attrs => !/\b(role|tabindex|aria-expanded)=/.test(attrs)),
  `Replicata: read index.html's section-heading spans (class "sec-toggle"), one for each of crashla.js's ${SECTIONS} SECTION_IDS.
Expectata: ${SECTIONS} spans, in plain markup: no role, tabindex or aria-expanded (crashla.js initCollapsibles adds them).
Resultata: ${toggles.length} spans: ${JSON.stringify(toggles)}.`);

const server = await serveRepo();
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 900 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
  const page = await context.newPage();
  await page.goto(server.url, { waitUntil: "load" });
  const seen = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("h2.sec-head")].map(h => h.textContent.trim()),
    buttons: [...document.querySelectorAll('[role="button"]')].map(e => e.textContent.trim()),
    stops: [...document.querySelectorAll("[tabindex]")].map(e => `${e.tagName}.${e.getAttribute("class")}`),
  }));
  assert.ok(seen.headings.length === SECTIONS && seen.buttons.length === 0 && seen.stops.length === 0,
    `[${engine}] Replicata: open the page with JavaScript disabled and read its section headings, role="button" elements
and tabindex attributes.
Expectata: ${SECTIONS} plain headings (crashla.js's SECTION_IDS); no role="button" element and no tabindex anywhere.
Resultata: ${JSON.stringify(seen)}.`);
  await context.close();
  await browser.close();
}
await server.close();

console.log(`qual pass: without JavaScript the ${SECTIONS} section headings are plain headings, in Chromium, Firefox and WebKit`);

// Without JavaScript the section headings are plain headings. Driven in
// Chromium, Firefox and WebKit with JavaScript disabled.
//
// The headings' text spans were role="button" Tab stops in index.html itself
// (2026-10-03, audit #30), so with JavaScript off a reader met nine inert
// "buttons", two of them empty and nameless, that Enter did nothing to (audit
// 2026-10-04 #66). Since 2026-10-04 crashla.js initCollapsibles gives the
// spans their role and Tab stop when it wires them; quals/keyboard-focus.qual.mjs
// checks the scripted page, which is unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo } from "./browser.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const toggles = [...html.matchAll(/<span class="sec-toggle"([^>]*)>/g)].map(m => m[1]);
assert.ok(toggles.length === 9 && toggles.every(attrs => !/\b(role|tabindex|aria-expanded)=/.test(attrs)),
  `Replicata: read index.html's nine section-heading spans (class "sec-toggle").
Expectata: plain markup: no role, tabindex or aria-expanded (crashla.js initCollapsibles adds them).
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
  assert.ok(seen.headings.length === 9 && seen.buttons.length === 0 && seen.stops.length === 0,
    `[${engine}] Replicata: open the page with JavaScript disabled and read its section headings, role="button" elements
and tabindex attributes.
Expectata: nine plain headings; no role="button" element and no tabindex anywhere.
Resultata: ${JSON.stringify(seen)}.`);
  await context.close();
  await browser.close();
}
await server.close();

console.log("qual pass: without JavaScript the nine section headings are plain headings, in Chromium, Firefox and WebKit");

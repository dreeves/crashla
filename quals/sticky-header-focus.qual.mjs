// A focused incident narrative is never hidden under the incident table's
// sticky header row (WCAG 2.4.11, focus not obscured). Driven in Chromium,
// Firefox and WebKit at 1200, 400 and 320 px, because where a browser scrolls
// a focused element to is browser behaviour.
//
// The narratives became Tab stops on 2026-10-03 (audit #4). Going back with
// Shift+Tab, a browser scrolls a row into view only once it leaves the
// table's box, and a row still inside the box but under the sticky header
// counted as visible: rows 29, 21, 14 and 7 (Firefox 28, 14, 7) ended wholly
// under the header, focus ring and all (audit 2026-10-04 #13). The box's
// scroll-padding-top marks the header's band as outside the view, so the
// browser scrolls the row out from under it.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const SPEED_QUERY = "?f=All&s=speed&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// A focus ring is a 2px outline 2px out from its box (style.css), and the
// header row draws a 2px rule under itself (its box-shadow).
const RING = 4, RULE = 2;

// Where the focused narrative and the header are, and what the page shows at
// the focused narrative's centre.
const probe = page => page.evaluate(() => {
  const el = document.activeElement;
  // The header cells are what sticks (the thead's own box scrolls away).
  const headBottom = Math.max(...[...document.querySelectorAll("#incidents-head th")].map(th => th.getBoundingClientRect().bottom));
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
  const tr = el.closest("tr");
  return {
    isNarrative: el.matches("#incidents-body .narrative-toggle"),
    row: tr ? [...tr.parentElement.children].indexOf(tr) + 1 : null,
    top: r.top, bottom: r.bottom, headBottom,
    hitIsToggle: hit !== null && el.contains(hit),
    hit: hit === null ? null : `${hit.tagName}:${hit.textContent.trim().slice(0, 20)}`,
  };
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  for (const width of [1200, 400, 320]) {
    // Sorted by speed, the header row is at its tallest: at 320 and 400 px the
    // sort triangle wraps onto a third line under "Speed (mph)".
    for (const query of [DEFAULT_QUERY, SPEED_QUERY]) {
      const page = await openPage(browser, server.url + query, { viewport: { width, height: 900 } });
      await page.focus("#incidents-body tr:first-child .narrative-toggle");
      for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
      const hidden = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Shift+Tab");
        const p = await probe(page);
        assert.ok(p.isNarrative, `[${engine} ${width}px] Shift+Tab ${i + 1} left the narratives: ${JSON.stringify(p)}`);
        if (p.top - RING < p.headBottom + RULE || !p.hitIsToggle) hidden.push(p);
      }
      assert.deepEqual(hidden, [],
        `[${engine} ${width}px ${query}] Replicata: Tab to the first incident narrative, Tab 40 more times, then Shift+Tab 40 times.
Expectata: each focused narrative sits wholly below the sticky header row and its rule, with room for its focus ring,
and is the topmost element at its own centre.
Resultata: ${hidden.length} narratives under the header, e.g. ${JSON.stringify(hidden.slice(0, 3))}.`);
      // The box's scroll padding covers the header row with its rule and the
      // ring of the row under it.
      const fit = await page.evaluate(() => ({
        padding: parseFloat(getComputedStyle(document.querySelector(".table-scroll")).scrollPaddingTop),
        header: Math.max(...[...document.querySelectorAll("#incidents-head th")].map(th => th.getBoundingClientRect().height)),
      }));
      assert.ok(Number.isFinite(fit.padding) && fit.padding >= fit.header + RULE + RING,
        `[${engine} ${width}px ${query}] Replicata: read the incident table box's scroll-padding-top and its header row's height.
Expectata: the padding covers the header row, its ${RULE}px rule and a ${RING}px focus ring (>= ${(fit.header + RULE + RING).toFixed(1)}px).
Resultata: padding ${JSON.stringify(fit.padding)}, header ${fit.header.toFixed(1)}px.`);

      assert.deepEqual(page.errors, [], `[${engine} ${width}px] uncaught page errors: ${JSON.stringify(page.errors)}`);
      await page.context().close();
    }
  }
  await browser.close();
}
await server.close();

console.log("qual pass: Shift+Tab never leaves a focused incident narrative under the sticky header, in Chromium, Firefox and WebKit at 1200, 400 and 320 px");

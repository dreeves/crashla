// A tooltip shown by keyboard focus sits beside its target, where the target
// is after the browser has scrolled it into view. Driven in Chromium, Firefox
// and WebKit, because when a browser scrolls a newly focused element into view
// is browser behaviour.
//
// The focus handler read the target's position inside focusin. Chromium and
// Firefox scroll the target into view before that event, WebKit after it, so
// in WebKit the first tooltip stop reached in each region of the page showed
// its tooltip where the target had been before the scroll, off-screen (7 of
// 210 stops; audit 2026-10-04 #18).
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const STOPS = 230; // the Tab stops from the top through the distribution chart's markers

// After the frame that follows a Tab: the focused target's tooltip, and where
// the page's own placement rule (initTooltips position(): 12px right of and
// below the target's bottom-right corner, flipped or clamped to stay 12px
// inside the viewport) puts a box of that size for the target as it now is.
const placed = page => page.evaluate(async () => {
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const el = document.activeElement;
  const text = el.getAttribute("data-tip");
  if (text === null) return null;
  const tip = document.getElementById("chart-tip");
  const t = tip.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 12;
  let left = r.right + pad, top = r.bottom + pad;
  if (left + t.width > innerWidth - pad) left = r.right - t.width - pad;
  if (top + t.height > innerHeight - pad) top = r.bottom - t.height - pad;
  return {
    where: `${el.tagName}.${el.getAttribute("class")} ${text.slice(0, 40)}`,
    shown: getComputedStyle(tip).display !== "none" && tip.textContent === text,
    at: [Math.round(t.left), Math.round(t.top)],
    want: [Math.round(Math.max(pad, left)), Math.round(Math.max(pad, top))],
    onScreen: t.top >= 0 && t.bottom <= innerHeight && t.left >= 0 && t.right <= innerWidth,
    // At least partly: a browser scrolls a focused element only if it is out
    // of view (Firefox leaves a hit circle 3px past the bottom edge where it is).
    targetOnScreen: r.bottom > 0 && r.top < innerHeight,
  };
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 1200, height: 900 } });
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  const wrong = [];
  let tipStops = 0;
  for (let i = 0; i < STOPS; i++) {
    await page.keyboard.press("Tab");
    const p = await placed(page);
    if (p === null) continue;
    tipStops++;
    const off = Math.max(Math.abs(p.at[0] - p.want[0]), Math.abs(p.at[1] - p.want[1]));
    if (!p.shown || !p.onScreen || !p.targetOnScreen || off > 1) wrong.push({ stop: i + 1, ...p });
  }
  assert.ok(tipStops >= 100 && wrong.length === 0,
    `[${engine}] Replicata: open the default view at 1200x900 from the top and press Tab ${STOPS} times.
Expectata: at each tooltip stop the target is (at least partly) on screen and its tooltip shows beside it: 12px right of and below
its bottom-right corner, flipped or clamped to stay inside the viewport.
Resultata: ${tipStops} tooltip stops; ${wrong.length} misplaced, e.g. ${JSON.stringify(wrong.slice(0, 3))}.`);

  // Every tooltip target, each focused with the page scrolled to its top, so
  // the browser scrolls each one below the fold into view as it focuses it
  // (the walk above reaches the first regions only).
  const targets = await page.evaluate(() => [...document.querySelectorAll('[data-tip][tabindex="0"]')].length);
  const wrongAll = [];
  for (let i = 0; i < targets; i++) {
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.keyboard.press("Shift");
    await page.evaluate(i => document.querySelectorAll('[data-tip][tabindex="0"]')[i].focus(), i);
    const p = await placed(page);
    const off = p === null ? Infinity : Math.max(Math.abs(p.at[0] - p.want[0]), Math.abs(p.at[1] - p.want[1]));
    if (p === null || !p.shown || !p.onScreen || !p.targetOnScreen || off > 1) wrongAll.push({ target: i, ...p });
  }
  assert.ok(targets >= 150 && wrongAll.length === 0,
    `[${engine}] Replicata: for each tooltip target on the default view, scroll to the top of the page and focus it from the keyboard.
Expectata: the browser scrolls it into view and its tooltip shows beside it, as in the walk above.
Resultata: ${targets} targets; ${wrongAll.length} misplaced, e.g. ${JSON.stringify(wrongAll.slice(0, 3))}.`);
  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: a focused target's tooltip sits beside it after the browser's focus scroll, in Chromium, Firefox and WebKit");

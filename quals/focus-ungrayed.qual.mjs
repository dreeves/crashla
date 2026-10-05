// A grayed element shows its keyboard focus at full strength (WCAG 1.4.11,
// focus indicator contrast at least 3:1). Driven in Chromium, Firefox and
// WebKit, because :focus-visible and how opacity composites a focus ring are
// browser behaviour.
//
// Some Tab stops sit in deliberately grayed elements: unchecked helmers'
// summary cards (opacity 0.4), k = 0 "prior-only" multipliers and verdict
// badges (0.55), market rows whose odds are not live (0.55), and the market
// refresh button while it refreshes (0.35). A focus ring is painted at its
// element's opacity, so in those elements it fell to 1.2-2.6:1 against the
// page, where the ungrayed ring is 6:1 (audit 2026-10-04 #16). The graying
// stays; an element un-grays while it, or something in it, holds keyboard
// focus, so the opacity every focused element is drawn at is 1.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";

// For every Tab stop in the summary cards, the sanity checks and the market
// panel: whether it matched :focus-visible when focused from the keyboard's
// side, and the opacity it is drawn at (its own times its ancestors').
const sweep = page => page.evaluate(() => {
  const drawnOpacity = el => { let o = 1; for (let e = el; e !== null; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const stops = [...document.querySelectorAll("#sec-summary, #sec-sanity, #sec-markets")]
    .flatMap(sec => [...sec.querySelectorAll('a[href], button, input, select, [tabindex="0"]')]);
  const out = { stops: stops.length, grayedBefore: 0, notVisible: [], dim: [] };
  for (const el of stops) {
    const where = `${el.tagName}.${el.getAttribute("class")} ${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 40)}`;
    // Unfocused first: a focused neighbour un-grays the card they share.
    document.activeElement.blur();
    if (drawnOpacity(el) < 1) out.grayedBefore++;
    el.focus();
    if (!el.matches(":focus-visible")) out.notVisible.push(where);
    const o = drawnOpacity(el);
    if (o < 1) out.dim.push(`${where} at ${o.toFixed(2)}`);
  }
  document.activeElement.blur();
  return out;
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  // Refused market requests fail after 400 ms, so every market row stays
  // grayed (its odds the snapshot's) and a refresh lasts long enough to watch.
  const page = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 1200, height: 900 } }, 400);
  // A key press first, so the focus the sweep gives counts as keyboard focus.
  await page.focus("#month-metric-select");
  await page.keyboard.press("Shift");
  const s = await sweep(page);
  assert.ok(s.stops > 100 && s.grayedBefore >= 50 && s.notVisible.length === 0 && s.dim.length === 0,
    `[${engine}] Replicata: load the default view (Humans (US average), Humans (Uber/Lyft) and Zoox unchecked, so their
cards are grayed; markets offline, so every market row is grayed) and focus each Tab stop in the summary cards, the
sanity checks and the market panel from the keyboard.
Expectata: each focused element is drawn at opacity 1 (its own and its ancestors'), so its focus ring keeps its full
contrast; the elements are grayed while not focused.
Resultata: ${s.stops} stops, ${s.grayedBefore} grayed while unfocused; ${s.notVisible.length} did not match
:focus-visible (${JSON.stringify(s.notVisible.slice(0, 3))}); ${s.dim.length} drawn below opacity 1 while focused,
e.g. ${JSON.stringify(s.dim.slice(0, 4))}.`);

  // The refresh button keeps keyboard focus while it refreshes (its graying
  // says it is busy) and must then show its ring at full strength too.
  await page.focus(".pm-refresh");
  await page.keyboard.press("Enter");
  const busy = await page.evaluate(() => {
    const el = document.activeElement;
    let o = 1; for (let e = el; e !== null; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return { cls: el.getAttribute("class"), busy: el.getAttribute("aria-disabled"), visible: el.matches(":focus-visible"), opacity: o };
  });
  assert.ok(busy.cls === "pm-refresh" && busy.busy === "true" && busy.visible && busy.opacity === 1,
    `[${engine}] Replicata: focus the market refresh button and press Enter; read it while the refresh runs.
Expectata: it keeps keyboard focus, reads aria-disabled="true", and is drawn at opacity 1 while focused.
Resultata: ${JSON.stringify(busy)}.`);
  await page.waitForFunction(() => document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");

  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: grayed cards, prior-only marks, market rows and the busy refresh button un-gray while they hold keyboard focus, in Chromium, Firefox and WebKit");

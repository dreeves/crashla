// Keyboard focus survives every redraw of the control holding it. Driven in
// Chromium, Firefox and WebKit, because which control a click focuses, and
// what happens to focus when its element is replaced, is browser behaviour.
//
// rerenderKeepingFocus hands focus from a control to the replacement a
// re-render draws for it, found by the data-focus-key both carry. The market
// links, the two date sliders and the narrative toggles had no key, so focus
// on one fell to <body> when a market refresh landed, and in WebKit, which
// does not move focus to a control the mouse clicks, when a click on a helmer
// label, a sort header or a filter redrew the slider or the table; and the
// growth radios, which have keys, lost focus on any width change because the
// resize listener redrew them without rerenderKeepingFocus (audit
// 2026-10-04 #17, #65). WebKit itself drops focus to <body> on the mousedown
// of a click on a label, a button or plain text, before any redraw, where
// Chromium and Firefox focus a clicked button or labelled checkbox; so a
// helmer checkbox, a sort header's button and an incident filter that a click
// operates now take focus themselves, in every engine.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";

const active = page => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, id: el.id, key: el.getAttribute("data-focus-key"),
    text: el.textContent.trim().slice(0, 50), href: el.getAttribute("href"), ring: el.matches(":focus-visible") };
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  // Refused market requests answer after 1.5 s, so a refresh is in flight
  // long enough to put focus on a market link first.
  const page = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 1200, height: 900 } }, 1500);

  // --- every control a re-render replaces carries a unique key -------------

  const keys = await page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-focus-key]")].map(e => e.getAttribute("data-focus-key"));
    const dupes = all.filter((k, i) => all.indexOf(k) !== i);
    const unkeyed = [
      ...document.querySelectorAll("#predmarket-panel a[href]"),
      ...document.querySelectorAll("#date-range-controls input"),
      ...document.querySelectorAll("#incidents-body .narrative-toggle"),
    ].filter(e => !e.hasAttribute("data-focus-key")).map(e => `${e.tagName}.${e.getAttribute("class")} ${e.textContent.trim().slice(0, 30)}`);
    // The ids the narratives' names and descriptions point at must be unique too.
    const ids = [...document.querySelectorAll("[id]")].map(e => e.id);
    const dupeIds = ids.filter((k, i) => ids.indexOf(k) !== i);
    return { count: all.length, dupes: [...new Set(dupes)].slice(0, 5), unkeyed: unkeyed.length, examples: unkeyed.slice(0, 3),
      ids: ids.length, dupeIds: [...new Set(dupeIds)].slice(0, 5) };
  });
  assert.ok(keys.dupes.length === 0 && keys.unkeyed === 0 && keys.dupeIds.length === 0,
    `[${engine}] Replicata: load the default view and read every data-focus-key and every id.
Expectata: each market link (question, header and outcome links), both date sliders and each narrative toggle carries
a data-focus-key, and no two elements share a key or an id.
Resultata: ${keys.count} keys; duplicated ${JSON.stringify(keys.dupes)}; ${keys.unkeyed} unkeyed, e.g. ${JSON.stringify(keys.examples)};
${keys.ids} ids, duplicated ${JSON.stringify(keys.dupeIds)}.`);

  // --- a market link keeps focus when a refresh lands ---------------------

  for (const [label, sel] of [
    ["a market's question link", "#predmarket-panel .pm-card:not(.pm-subcard) a[href]"],
    ["a multi-outcome market's outcome link", "#predmarket-panel .pm-subcard a[href]"],
  ]) {
    await page.focus(".pm-refresh");
    await page.keyboard.press("Enter");
    await page.focus(`${sel} >> nth=1`);
    const before = await active(page);
    await page.waitForFunction(() => document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
    const after = await active(page);
    assert.ok(before.tag === "A" && after.tag === "A" && after.text === before.text && after.href === before.href,
      `[${engine}] Replicata: press the market refresh button, then focus ${label} before the refresh lands; wait for it to land.
Expectata: focus stays on the same link in the redrawn panel.
Resultata: before ${JSON.stringify(before)}; after ${JSON.stringify(after)}.`);
  }

  // --- a redraw hands a slider's or a narrative's focus to its replacement --

  // The redraws a helmer change and a filter make, run while the control is
  // focused from the keyboard.
  const handOff = (sel, render) => page.evaluate(([sel, render]) => {
    const before = document.querySelector(sel);
    before.focus();
    rerenderKeepingFocus(render === "views" ? buildMonthlyViews : buildBrowser);
    const now = document.activeElement;
    return { replaced: now !== before && before.isConnected === false, key: now.getAttribute("data-focus-key"),
      was: before.getAttribute("data-focus-key"), visible: now.matches(":focus-visible") };
  }, [sel, render]);
  await page.keyboard.press("Shift");
  for (const [label, sel, render] of [
    ["the start-month slider", "#date-range-min", "views"],
    ["the end-month slider", "#date-range-max", "views"],
    ["the third incident's narrative", "#incidents-body tr:nth-child(3) .narrative-toggle", "browser"],
  ]) {
    const h = await handOff(sel, render);
    assert.ok(h.replaced && h.key !== null && h.key === h.was && h.visible,
      `[${engine}] Replicata: focus ${label} from the keyboard and redraw the views around it (rerenderKeepingFocus).
Expectata: the redraw replaces it, and focus moves to its replacement (the same data-focus-key), ring showing.
Resultata: ${JSON.stringify(h)}.`);
  }

  // --- a click focuses the control it operates -----------------------------

  // The focus a click gives draws no ring (it is not :focus-visible), as
  // Chromium and Firefox draw none on a clicked control. In WebKit the
  // Zoox checkbox showed a ring after a click on its label, with or without
  // keyboard use before: the change handler's focus() and the re-render's
  // hand-off of focus each counted there as focus from the keyboard (found
  // in review, 2026-10-05).

  // The start-month slider, operated from the keyboard, then a click on the
  // Zoox checkbox's label (which redraws the slider).
  await page.focus("#date-range-min");
  await page.keyboard.press("ArrowRight");
  await page.click("#month-legend-mpi-helmers label:has-text('Zoox')");
  let a = await active(page);
  assert.ok(a.id === "month-helmer-toggle-zoox" && !a.ring,
    `[${engine}] Replicata: focus the start-month slider, press ArrowRight, then click the 'Zoox' checkbox label.
Expectata: focus is on the Zoox checkbox (the control clicked), with no focus ring, in every engine; never <body>.
Resultata: focus is on ${JSON.stringify(a)}.`);

  // A narrative opened from the keyboard, then a click on a sort header: the
  // same rows, in a new order.
  const third = "#incidents-body tr:nth-child(3) .narrative-toggle";
  await page.focus(third);
  await page.keyboard.press("Enter");
  await page.click("#incidents-head th:nth-child(5)");
  a = await active(page);
  assert.ok(a.tag === "BUTTON" && a.text === "Speed (mph)" && !a.ring,
    `[${engine}] Replicata: focus the third incident's narrative, press Enter, then click the 'Speed (mph)' header.
Expectata: focus is on the header's button (the control clicked), with no focus ring, in every engine; never <body>.
Resultata: focus is on ${JSON.stringify(a)}.`);

  // Then a click on a filter, which may hide that narrative's row.
  await page.focus(third);
  await page.click("#filters button:nth-child(3)");
  a = await active(page);
  assert.ok(a.tag === "BUTTON" && a.text.startsWith("Waymo (") && !a.ring,
    `[${engine}] Replicata: focus the third incident's narrative, then click the 'Waymo (n)' incident filter.
Expectata: focus is on the 'Waymo (n)' filter (the control clicked), with no focus ring, in every engine; never <body>.
Resultata: focus is on ${JSON.stringify(a)}.`);

  // --- #65: a width change keeps focus on the growth radios ---------------

  await page.focus('#chart-fleet-timeseries input[value="fleet"]');
  await page.keyboard.press("Shift");
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForFunction(() => document.querySelector("#chart-fleet-timeseries svg").getAttribute("viewBox").split(" ")[2] !== "900");
  a = await active(page);
  assert.ok(a.key === "growth-fleet" && a.tag === "INPUT",
    `[${engine}] Replicata: focus the 'Fleet size' growth radio at 1200px, then narrow the window to 600px.
Expectata: the charts redraw at the new width and focus stays on the 'Fleet size' radio.
Resultata: focus is on ${JSON.stringify(a)}.`);

  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: focus survives market refreshes, clicks elsewhere and width changes, in Chromium, Firefox and WebKit");

// Every control works from the keyboard, keeps focus while the page redraws
// around it, and tells assistive technology its state. Driven in Chromium,
// Firefox and WebKit, because focus is browser behaviour a DOM stub cannot
// model.
//
// Until 2026-10-03: a re-render replaced the control a keyboard user had just
// operated, so focus fell to <body>, the next Tab started that group over, a
// second Enter on a sort header did nothing and a second arrow key on the
// growth radios went nowhere (audit #29); the refresh button was disabled
// while refreshing, which drops focus by itself; the collapsible section
// headings were mouse-only (#30); the date sliders announced series indices
// such as "47" (#33); the active incident filter was shown by colour alone
// (#92); and the refresh button's accessible name was the glyph "↻" (#93).
// The sortable headers were focusable <th> cells with no control role, so a
// screen reader did not say that Enter sorts (audit 2026-10-04 #19): each
// header's text is now a <button type="button"> in its th, which keeps
// aria-sort, and a click anywhere in the th still sorts.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";

// What the reader's keyboard is on.
const active = page => page.evaluate(() => {
  const el = document.activeElement;
  return {
    tag: el.tagName, id: el.id, value: el.value ?? null, checked: el.checked ?? null,
    text: el.textContent.trim().slice(0, 60), role: el.getAttribute("role"),
    cls: el.getAttribute("class"),
    ariaSort: el.getAttribute("aria-sort"), ariaPressed: el.getAttribute("aria-pressed"),
    type: el.getAttribute("type"), thSort: el.closest("th") === null ? null : el.closest("th").getAttribute("aria-sort"),
    ariaDisabled: el.getAttribute("aria-disabled"), ariaExpanded: el.getAttribute("aria-expanded"),
    ring: el.matches(":focus-visible"),
  };
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  // Refused market requests answer after 150 ms, so a refresh lasts long
  // enough to be observed in flight.
  const page = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 1200, height: 900 } }, 150);

  // --- #29: the operated control keeps focus -------------------------------

  await page.focus("#month-helmer-toggle-humansus");
  await page.keyboard.press("Space");
  let a = await active(page);
  assert.ok(a.id === "month-helmer-toggle-humansus" && a.checked === true && a.ring && page.url().includes("HumansUS"),
    `[${engine}] Replicata: load the default view, focus the 'Humans (US average)' checkbox and press Space.
Expectata: the checkbox is checked, the link gains HumansUS, and focus stays on that checkbox, its ring showing.
Resultata: focus is on ${JSON.stringify(a)}; url ${page.url()}.`);
  await page.keyboard.press("Tab");
  a = await active(page);
  assert.equal(a.id, "month-helmer-toggle-humansrideshare",
    `[${engine}] Replicata: after toggling 'Humans (US average)' with Space, press Tab.
Expectata: focus moves on to the next checkbox, 'Humans (Uber/Lyft)'.
Resultata: focus is on ${JSON.stringify(a)}.`);

  await page.focus("#month-metric-select");
  await page.selectOption("#month-metric-select", "injury");
  a = await active(page);
  assert.ok(a.id === "month-metric-select" && a.value === "injury",
    `[${engine}] Replicata: focus the 'Miles per' metric select and choose 'injury-causing'.
Expectata: the metric changes and focus stays on the select.
Resultata: focus is on ${JSON.stringify(a)}.`);

  const filterButton = label => page.locator("#filters button", { hasText: new RegExp(`^${label} \\(`) });
  await filterButton("Waymo").focus();
  await page.keyboard.press("Enter");
  a = await active(page);
  assert.ok(a.tag === "BUTTON" && a.text.startsWith("Waymo (") && a.ring,
    `[${engine}] Replicata: in the Incident browser, focus 'Waymo (n)' and press Enter.
Expectata: the filter applies and focus stays on 'Waymo (n)', its ring showing.
Resultata: focus is on ${JSON.stringify(a)}.`);
  const pressed = await page.$$eval("#filters button", bs => bs.map(b => [b.textContent.split(" (")[0], b.getAttribute("aria-pressed")]));
  assert.deepEqual(pressed, [["All", "false"], ["Tesla", "false"], ["Waymo", "true"], ["Zoox", "false"]],
    `[${engine}] Replicata: choose the Waymo incident filter and read each filter button's aria-pressed (#92).
Expectata: the active filter is announced as pressed and the others as not pressed.
Resultata: ${JSON.stringify(pressed)}.`);
  await page.keyboard.press("Tab");
  a = await active(page);
  assert.ok(a.text.startsWith("Zoox ("),
    `[${engine}] Replicata: after choosing 'Waymo (n)' with Enter, press Tab.
Expectata: focus moves on to 'Zoox (n)'.
Resultata: focus is on ${JSON.stringify(a)}.`);

  const headerCells = await page.$$eval("#incidents-head th", ths => ths.map(th => ({
    text: th.textContent, tabIndex: th.tabIndex,
    buttons: [...th.children].map(c => [c.tagName, c.getAttribute("type"), c.textContent]),
  })));
  const plainHeaders = headerCells.filter(h => h.tabIndex !== -1 || h.buttons.length !== 1 ||
    h.buttons[0][0] !== "BUTTON" || h.buttons[0][1] !== "button" || h.buttons[0][2] !== h.text);
  assert.ok(headerCells.length === 8 && plainHeaders.length === 0,
    `[${engine}] Replicata: read the incident table's eight column headers (#19).
Expectata: each th holds one <button type="button"> with the header's text, and the th itself is not a Tab stop.
Resultata: ${JSON.stringify(plainHeaders.length > 0 ? plainHeaders : headerCells)}.`);
  await page.locator("#incidents-head th button", { hasText: "Speed (mph)" }).focus();
  await page.keyboard.press("Enter");
  a = await active(page);
  assert.ok(a.tag === "BUTTON" && a.type === "button" && a.text === "Speed (mph)" && a.thSort === "ascending" && a.ring,
    `[${engine}] Replicata: focus the 'Speed (mph)' column header's button and press Enter.
Expectata: the table sorts ascending by speed (its th reads aria-sort="ascending") and focus stays on that button, its ring showing.
Resultata: focus is on ${JSON.stringify(a)}.`);
  await page.keyboard.press("Enter");
  a = await active(page);
  assert.ok(a.text === "Speed (mph)" && a.thSort === "descending",
    `[${engine}] Replicata: sort by 'Speed (mph)' with Enter, then press Enter again.
Expectata: the sort reverses (aria-sort descending) with focus still on the header's button.
Resultata: focus is on ${JSON.stringify(a)}.`);
  // Space sorts as Enter does (quals/sortable-headers.qual.mjs pressed it on
  // the th until the header became a button, 2026-10-04; reviewer).
  await page.keyboard.press("Space");
  a = await active(page);
  assert.ok(a.tag === "BUTTON" && a.text === "Speed (mph)" && a.thSort === "ascending" && a.ring,
    `[${engine}] Replicata: sort by 'Speed (mph)' descending with Enter twice, then press Space.
Expectata: the sort reverses again (aria-sort ascending) with focus still on the header's button, its ring showing.
Resultata: focus is on ${JSON.stringify(a)}.`);
  // A click in the header cell's padding, outside its button, sorts as a
  // click on the text does.
  const company = await page.$eval("#incidents-head th:first-child", th => {
    const r = th.getBoundingClientRect(), b = th.querySelector("button").getBoundingClientRect();
    return { x: r.left + 2, y: r.top + r.height / 2, outside: r.left + 2 < b.left };
  });
  await page.mouse.click(company.x, company.y);
  const companySort = await page.$eval("#incidents-head th:first-child", th => th.getAttribute("aria-sort"));
  assert.ok(company.outside && companySort === "ascending",
    `[${engine}] Replicata: click the 'Company' header cell 2px inside its left edge, outside its button.
Expectata: the table sorts by company (aria-sort ascending), as a click on the header's text does.
Resultata: ${JSON.stringify({ ...company, companySort })}.`);

  await page.focus('#chart-fleet-timeseries input[value="fleet"]');
  await page.keyboard.press("ArrowRight");
  a = await active(page);
  assert.ok(a.value === "rides" && a.checked === true && a.ring,
    `[${engine}] Replicata: focus the 'Fleet size' radio under 'AV company growth' and press ArrowRight.
Expectata: 'Rides (cumulative)' is selected and keeps focus, its ring showing.
Resultata: focus is on ${JSON.stringify(a)}.`);
  await page.keyboard.press("ArrowRight");
  a = await active(page);
  assert.ok(a.value === "miles" && a.checked === true && page.url().includes("g=miles"),
    `[${engine}] Replicata: press ArrowRight on the growth radios twice.
Expectata: the second press moves on to 'Miles (cumulative)' (g=miles).
Resultata: focus is on ${JSON.stringify(a)}; url ${page.url()}.`);

  // --- #93 and #29: the refresh button ---------------------------------------

  const refreshName = await page.$eval(".pm-refresh", b => ({
    label: b.getAttribute("aria-label"), title: b.getAttribute("title"),
    glyph: [...b.querySelectorAll('[aria-hidden="true"]')].map(g => g.textContent).join(""),
    text: b.textContent,
  }));
  assert.ok(refreshName.label !== null && refreshName.label === refreshName.title && refreshName.glyph === refreshName.text && refreshName.text === "↻",
    `[${engine}] Replicata: read the prediction-market refresh button's accessible name (#93).
Expectata: aria-label is its title text, and the glyph is hidden from assistive technology.
Resultata: ${JSON.stringify(refreshName)}.`);
  await page.focus(".pm-refresh");
  await page.keyboard.press("Enter");
  a = await active(page);
  assert.ok(a.cls === "pm-refresh" && a.ariaDisabled === "true",
    `[${engine}] Replicata: focus the prediction-market refresh button and press Enter.
Expectata: while the refresh runs the button keeps focus and reads aria-disabled="true" (disabling it would drop focus).
Resultata: focus is on ${JSON.stringify(a)}.`);
  await page.waitForFunction(() => document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
  a = await active(page);
  assert.ok(a.cls === "pm-refresh" && a.ariaDisabled === null && a.ring,
    `[${engine}] Replicata: press Enter on the refresh button and wait for the refresh to finish.
Expectata: the redrawn refresh button has focus, its ring showing, and is enabled again.
Resultata: focus is on ${JSON.stringify(a)}.`);

  // --- #33: the date sliders speak months ---------------------------------

  const valueText = () => page.evaluate(() => [
    document.getElementById("date-range-min").getAttribute("aria-valuetext"),
    document.getElementById("date-range-max").getAttribute("aria-valuetext"),
  ]);
  const months = await page.evaluate(() => fullMonthSeries.months);
  let vt = await valueText();
  assert.deepEqual(vt, ["2025-06", months[months.length - 1]],
    `[${engine}] Replicata: read the start and end date sliders' aria-valuetext on the default view.
Expectata: the months they stand for ("2025-06" and the last month), not series indices.
Resultata: ${JSON.stringify(vt)}.`);
  await page.focus("#date-range-min");
  await page.keyboard.press("ArrowLeft");
  vt = await valueText();
  assert.equal(vt[0], "2025-05",
    `[${engine}] Replicata: focus the start-month slider and press ArrowLeft.
Expectata: it announces "2025-05".
Resultata: aria-valuetext is ${JSON.stringify(vt[0])}.`);

  // --- #30: section headings toggle from the keyboard ---------------------

  await page.goto(server.url + DEFAULT_QUERY + "&x=browser.sanity", { waitUntil: "load" });
  const heads = await page.$$eval(".sec-head", hs => hs.map(h => {
    const t = h.querySelectorAll('[role="button"]');
    return {
      section: h.closest("section").id, toggles: t.length,
      tabIndex: t.length === 1 ? t[0].tabIndex : null,
      expanded: t.length === 1 ? t[0].getAttribute("aria-expanded") : null,
      collapsed: h.closest("section").classList.contains("collapsed"),
    };
  }));
  const wrong = heads.filter(h => h.toggles !== 1 || h.tabIndex !== 0 || h.expanded !== String(!h.collapsed));
  assert.ok(heads.length === 9 && wrong.length === 0,
    `[${engine}] Replicata: load the page with x=browser.sanity and inspect every section heading.
Expectata: each heading holds one role=button toggle in the Tab order whose aria-expanded says whether its section is open.
Resultata: ${JSON.stringify(wrong.length === 0 ? heads : wrong)}.`);
  const browserToggle = page.locator("#sec-browser .sec-head [role=button]");
  await browserToggle.focus();
  await page.keyboard.press("Enter");
  let state = await page.evaluate(() => ({
    collapsed: document.getElementById("sec-browser").classList.contains("collapsed"),
    expanded: document.querySelector("#sec-browser .sec-head [role=button]").getAttribute("aria-expanded"),
    focused: document.activeElement.closest("#sec-browser .sec-head") !== null,
  }));
  assert.ok(!state.collapsed && state.expanded === "true" && state.focused && !/[?&]x=[^&]*browser/.test(page.url()),
    `[${engine}] Replicata: with 'Incident browser' collapsed by x=browser.sanity, focus its heading and press Enter.
Expectata: the section opens, aria-expanded becomes "true", focus stays on the heading, and x= no longer lists browser.
Resultata: ${JSON.stringify(state)}; url ${page.url()}.`);
  await page.keyboard.press(" ");
  state = await page.evaluate(() => ({
    collapsed: document.getElementById("sec-browser").classList.contains("collapsed"),
    expanded: document.querySelector("#sec-browser .sec-head [role=button]").getAttribute("aria-expanded"),
    scrollY: window.scrollY,
  }));
  assert.ok(state.collapsed && state.expanded === "false",
    `[${engine}] Replicata: press Space on the open 'Incident browser' heading.
Expectata: the section collapses again (aria-expanded "false").
Resultata: ${JSON.stringify(state)}.`);
  await page.focus("#date-range-max");
  await page.keyboard.press("Tab");
  a = await active(page);
  const vmtToggle = await page.evaluate(() => document.activeElement.closest("#sec-vmt .sec-head") !== null);
  assert.ok(vmtToggle && a.role === "button",
    `[${engine}] Replicata: focus the end-month slider, the last control of 'What and when to compare', and press Tab.
Expectata: focus lands on the next section's heading toggle, 'Vehicle Miles Traveled'.
Resultata: focus is on ${JSON.stringify(a)}.`);

  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: keyboard focus survives re-renders, section headings and sliders work and speak their state, in Chromium, Firefox and WebKit");

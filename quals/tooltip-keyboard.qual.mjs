// What the page says only in tooltips must reach readers who have no pointer:
// keyboard users get the tooltip on focus, screen readers get its text in the
// accessibility tree, and the fault reasoning is also on the page itself.
// Driven in Chromium, Firefox and WebKit.
//
// Until 2026-10-03 none of the 1,429 [data-tip] elements was focusable or
// carried its text for assistive technology, the tooltip opened only on
// pointer events, the incident narratives expanded only on click (audit #4),
// a tooltip could not be dismissed with Escape (#34), and the six charts had
// no accessible name: screen readers announced their tick text and the
// invisible "?" markers (#32).
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const DEFAULT_QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";

const tip = page => page.evaluate(() => {
  const t = document.getElementById("chart-tip");
  return { shown: getComputedStyle(t).display !== "none", text: t.textContent };
});

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 1200, height: 900 } });

  // --- #4: every tooltip target is reachable and readable -----------------

  const audit = await page.evaluate(() => {
    const out = { targets: 0, notFocusable: [], svgUnnamed: [], htmlUnread: [], faultCells: 0 };
    for (const el of document.querySelectorAll("[data-tip]")) {
      out.targets++;
      const text = el.getAttribute("data-tip");
      const where = `${el.tagName}.${el.getAttribute("class")} ${text.slice(0, 40)}`;
      const isFaultCell = el.matches("td.fault-cell");
      out.faultCells += isFaultCell ? 1 : 0;
      if (!isFaultCell && el.tabIndex !== 0) out.notFocusable.push(where);
      if (el instanceof SVGElement && el.getAttribute("aria-label") !== text) out.svgUnnamed.push(where);
      if (!(el instanceof SVGElement)) {
        const hidden = [...el.children].filter(c => c.matches(".visually-hidden")).map(c => c.textContent);
        if (hidden.length !== 1 || hidden[0] !== text) out.htmlUnread.push(where);
      }
    }
    return out;
  });
  assert.ok(audit.targets > 1000 && audit.faultCells > 1000 &&
    audit.notFocusable.length === 0 && audit.svgUnnamed.length === 0 && audit.htmlUnread.length === 0,
    `[${engine}] Replicata: load the default view and inspect every [data-tip] tooltip target.
Expectata: every target but the incident table's fault cells is a Tab stop; an SVG mark's aria-label is its tip;
an HTML target carries its tip as visually hidden text.
Resultata: ${audit.targets} targets (${audit.faultCells} fault cells); not focusable ${audit.notFocusable.length}
(${JSON.stringify(audit.notFocusable.slice(0, 3))}); SVG unnamed ${audit.svgUnnamed.length}
(${JSON.stringify(audit.svgUnnamed.slice(0, 3))}); HTML text not exposed ${audit.htmlUnread.length}
(${JSON.stringify(audit.htmlUnread.slice(0, 3))}).`);

  // Tab from the Cumulative-VMT radio lands on the first VMT chart mark, and
  // its tooltip shows beside it; the next Tab moves the tooltip on.
  await page.focus("#vmt-mode-cumulative");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => {
    const el = document.activeElement;
    return { inChart: el.closest("#chart-helmer-series") !== null, tip: el.getAttribute("data-tip") };
  });
  let t = await tip(page);
  assert.ok(first.inChart && first.tip !== null && t.shown && t.text === first.tip,
    `[${engine}] Replicata: focus the 'Cumulative VMT' radio and press Tab.
Expectata: focus lands on the first VMT chart mark and its tooltip shows that mark's text.
Resultata: focus ${JSON.stringify(first)}; tooltip ${JSON.stringify(t)}.`);
  // The first mark is an invisible hit circle (a range end, fill="none"),
  // which Firefox draws no focus ring around: the focused circle itself must
  // show, stroked in the accent colour.
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    return { fill: el.getAttribute("fill"), stroke: getComputedStyle(el).stroke,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() };
  });
  assert.ok(ring.fill === "none" && ring.stroke === "rgb(32, 96, 192)" && ring.accent === "#2060c0",
    `[${engine}] Replicata: Tab onto the first VMT chart mark, an invisible (fill="none") hit circle.
Expectata: the focused circle is drawn, stroked in the accent colour --accent #2060c0.
Resultata: ${JSON.stringify(ring)}.`);
  await page.keyboard.press("Tab");
  const second = await page.evaluate(() => document.activeElement.getAttribute("data-tip"));
  t = await tip(page);
  assert.ok(second !== null && second !== first.tip && t.shown && t.text === second,
    `[${engine}] Replicata: from the first VMT chart mark, press Tab again.
Expectata: the next mark takes focus and the tooltip follows it.
Resultata: focus tip ${JSON.stringify(second)}; tooltip ${JSON.stringify(t)}.`);

  // Arrive by Tab: the tooltip follows keyboard focus (:focus-visible), not
  // focus a pointer press gives.
  const hint = page.locator(".mpi-card-src").first();
  await hint.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const hintTip = await hint.getAttribute("data-tip");
  t = await tip(page);
  assert.ok(await hint.evaluate(el => el === document.activeElement) && t.shown && t.text === hintTip,
    `[${engine}] Replicata: focus the first summary card's '[?]' hint.
Expectata: the tooltip shows its derivation.
Resultata: tooltip ${JSON.stringify(t)}.`);
  await page.focus("#month-metric-select");
  t = await tip(page);
  assert.ok(!t.shown,
    `[${engine}] Replicata: focus a '[?]' hint, then move focus to the metric select.
Expectata: the tooltip hides when its target loses focus.
Resultata: tooltip ${JSON.stringify(t)}.`);

  // The narrative cell is a disclosure button; opening it also shows the
  // row's fault reasoning (the fault cell's tip).
  const row = page.locator("#incidents-body tr").first();
  const toggle = row.locator(".narrative-cell [role=button]");
  const closed = await row.evaluate(tr => {
    const b = tr.querySelector(".narrative-cell [role=button]");
    const f = tr.querySelector(".narrative-fault");
    return { tabIndex: b && b.tabIndex, expanded: b && b.getAttribute("aria-expanded"),
      faultShown: f !== null && getComputedStyle(f).display !== "none" };
  });
  assert.deepEqual(closed, { tabIndex: 0, expanded: "false", faultShown: false },
    `[${engine}] Replicata: read the first incident row's narrative cell.
Expectata: a role=button disclosure in the Tab order, aria-expanded "false", fault reasoning not shown.
Resultata: ${JSON.stringify(closed)}.`);
  await toggle.focus();
  await page.keyboard.press("Enter");
  const open = await row.evaluate(tr => {
    const b = tr.querySelector(".narrative-cell [role=button]");
    const f = tr.querySelector(".narrative-fault");
    return { expanded: b.getAttribute("aria-expanded"),
      cellExpanded: tr.querySelector(".narrative-cell").classList.contains("expanded"),
      faultShown: getComputedStyle(f).display !== "none",
      faultText: f.innerText, faultTip: tr.querySelector("td.fault-cell").getAttribute("data-tip") };
  });
  assert.ok(open.expanded === "true" && open.cellExpanded && open.faultShown &&
    open.faultText.replace(/\s+/g, " ").includes(open.faultTip.replace(/\s+/g, " ")),
    `[${engine}] Replicata: focus the first incident's narrative and press Enter.
Expectata: it expands (aria-expanded "true") and shows the row's fault reasoning, the fault cell's tooltip text.
Resultata: ${JSON.stringify(open)}.`);
  await page.keyboard.press(" ");
  const shut = await row.evaluate(tr => tr.querySelector(".narrative-cell [role=button]").getAttribute("aria-expanded"));
  assert.equal(shut, "false",
    `[${engine}] Replicata: press Space on the open narrative.
Expectata: it collapses again (aria-expanded "false").
Resultata: aria-expanded ${JSON.stringify(shut)}.`);

  // --- #34: Escape dismisses the tooltip ----------------------------------

  // A dot that no neighbouring helmer's hit circle covers, so the pointer
  // actions reach it.
  await page.locator("#chart-mpi-all").scrollIntoViewIfNeeded();
  const picked = await page.evaluate(() => {
    for (const c of document.querySelectorAll("#chart-mpi-all circle[data-tip]")) {
      const r = c.getBoundingClientRect();
      if (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === c) { c.setAttribute("data-qual-pick", ""); return true; }
    }
    return false;
  });
  assert.ok(picked, `[${engine}] some MPI-chart dot is the topmost element at its own centre`);
  const dot = page.locator("#chart-mpi-all circle[data-qual-pick]");
  await dot.hover();
  t = await tip(page);
  assert.ok(t.shown, `[${engine}] hovering an MPI-chart dot shows its tooltip: ${JSON.stringify(t)}`);
  await page.keyboard.press("Escape");
  t = await tip(page);
  assert.ok(!t.shown,
    `[${engine}] Replicata: hover a dot on the MPI chart and press Escape.
Expectata: the tooltip disappears without moving the pointer.
Resultata: tooltip ${JSON.stringify(t)}.`);
  await dot.click();
  await page.mouse.move(5, 5);
  t = await tip(page);
  assert.ok(t.shown, `[${engine}] a clicked MPI-chart dot pins its tooltip: ${JSON.stringify(t)}`);
  await page.keyboard.press("Escape");
  t = await tip(page);
  assert.ok(!t.shown,
    `[${engine}] Replicata: click an MPI-chart dot to pin its tooltip, move the pointer away, press Escape.
Expectata: the pinned tooltip disappears.
Resultata: tooltip ${JSON.stringify(t)}.`);
  // The click above left focus on the dot; Shift+Tab and Tab bring keyboard
  // focus back onto it.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.ok(await dot.evaluate(el => el === document.activeElement), `[${engine}] Shift+Tab, Tab returns to the dot`);
  t = await tip(page);
  await page.keyboard.press("Escape");
  const afterEsc = await tip(page);
  assert.ok(t.shown && !afterEsc.shown,
    `[${engine}] Replicata: focus an MPI-chart dot with the keyboard, then press Escape.
Expectata: the tooltip shows on focus and Escape dismisses it.
Resultata: on focus ${JSON.stringify(t)}; after Escape ${JSON.stringify(afterEsc)}.`);

  // --- #32: charts have names; their decorative text is hidden -------------

  const charts = await page.evaluate(() => [...document.querySelectorAll("svg.month-svg")].map(svg => {
    const ids = (svg.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const labelledBy = ids.map(id => document.getElementById(id));
    const name = labelledBy.length > 0
      ? labelledBy.map(el => el === null ? "<missing id>" : el.textContent.trim()).join(" ")
      : (svg.getAttribute("aria-label") || "");
    const texts = [...svg.querySelectorAll("text")];
    return { host: svg.closest("[id]").id, role: svg.getAttribute("role"), name,
      visibleTexts: texts.filter(x => x.closest('[aria-hidden="true"]') === null).map(x => x.textContent) };
  }));
  const badCharts = charts.filter(c => c.role !== "figure" || c.name === "" || c.name.includes("<missing id>") || c.visibleTexts.length > 0);
  assert.ok(charts.length === 6 && badCharts.length === 0,
    `[${engine}] Replicata: inspect each chart <svg> on the default view.
Expectata: six charts, each role="figure" with a non-empty accessible name from existing page text, and every
<text> (ticks, axis titles, "?" markers) inside an aria-hidden group.
Resultata: ${JSON.stringify(badCharts.length > 0 ? badCharts : charts).slice(0, 1500)}.`);
  const mpiName = charts.find(c => c.host === "chart-mpi-all").name;
  const mpiHeading = await page.evaluate(() => document.getElementById("mpi-heading").textContent);
  assert.equal(mpiName, mpiHeading,
    `[${engine}] Replicata: compare the MPI chart's accessible name with its section heading.
Expectata: the chart is named by the heading ("${mpiHeading}").
Resultata: ${JSON.stringify(mpiName)}.`);

  if (engine === "chromium") {
    // The browser's own accessibility tree, not just the attributes.
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const figures = nodes.filter(n => !n.ignored && n.role && n.role.value === "figure").map(n => n.name && n.name.value);
    const marks = nodes.filter(n => !n.ignored && n.role && n.role.value === "graphics-symbol");
    const unnamedMarks = marks.filter(n => !n.name || n.name.value === "").length;
    const questionMarks = nodes.filter(n => !n.ignored && n.name && n.name.value === "?").length;
    assert.ok(figures.length === 6 && figures.every(n => n) && marks.length > 100 && unnamedMarks === 0 && questionMarks === 0,
      `[chromium] Replicata: read the accessibility tree of the default view.
Expectata: six named figures, every chart mark (graphics-symbol) named, and no node named "?".
Resultata: figures ${JSON.stringify(figures)}; ${marks.length} marks, ${unnamedMarks} unnamed; ${questionMarks} nodes named "?".`);
  }

  // The visually hidden tip text was first absolutely positioned, the usual
  // recipe. Inside a scroll box that is not its containing block it escaped
  // the box's clipping and widened a 400px phone page to 955px (Chromium,
  // WebKit; found 2026-10-03), so .visually-hidden is an in-flow box.
  const phone = await openPage(browser, server.url + DEFAULT_QUERY, { viewport: { width: 400, height: 860 } });
  const widths = await phone.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.equal(widths.scroll, widths.client,
    `[${engine}] Replicata: open the default view 400px wide and compare the page's scroll width with its width.
Expectata: no horizontal scrolling: the hidden tip text stays clipped inside its table's scroll box.
Resultata: ${JSON.stringify(widths)}.`);

  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  assert.deepEqual(phone.errors, [], `[${engine}] uncaught page errors at 400px: ${JSON.stringify(phone.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: tooltip targets are Tab stops with their text exposed, narratives expand from the keyboard with the fault reasoning, Escape dismisses, and charts are named figures");

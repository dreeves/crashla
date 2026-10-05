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
//
// The second audit (2026-10-04) found the names short of what the page shows:
// a mark on the MPI or distribution chart, which several companies share, did
// not say whose it was (#15); the cards' "[?]" hints read as a literal "[?]"
// glued to their derivation, and the 46 focusable HTML targets had role
// generic and no name (#63); each fault cell held a second, visually hidden
// copy of its tip, laid out on every rebuild of the 1,228-row table (#26);
// and each narrative toggle was named by its whole narrative (median 948
// characters, #62). Since then no target holds its tip as hidden text: an SVG
// mark is named by its tip (on the shared charts, by its company's label, " · "
// and its tip, as the growth chart's tips read), an HTML target is an image
// named by what it shows and its tip, a fault cell is described by its row's
// "Fault fraction:" line, and a narrative toggle has a short name and the
// narrative as its description.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

// The narrative toggle's short name is new copy, so it is Latin with its TODO
// recap directly above (AGENTS.md rule 7).
const js = fs.readFileSync(new URL("../crashla.js", import.meta.url), "utf8");
const nameAt = js.indexOf("function narrativeToggleName(");
assert.ok(nameAt > 0 && /\/\/ TODO[^\n]*\n(?:\/\/[^\n]*\n)*$/.test(js.slice(0, nameAt)),
  `Replicata: read crashla.js above function narrativeToggleName.
Expectata: the narrative toggle's short name, a Latin string, has a comment block starting "// TODO" directly above it.
Resultata: ${nameAt < 0 ? "no narrativeToggleName" : JSON.stringify(js.slice(Math.max(0, nameAt - 300), nameAt))}.`);

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
    const out = { targets: 0, faultCells: 0, notFocusable: [], badSvg: [], badHtml: [], badFault: [], copies: [] };
    // A company's label by its series colour.
    const labelOf = {};
    for (const h of ALL_HELMERS) labelOf[HELMER_COLORS[h].toLowerCase()] = helmerLabel(h);
    // On the two charts several companies share, a mark's glyph (its colour)
    // and its hit circle come in the same order.
    const seriesLabel = new Map();
    for (const host of ["#chart-mpi-all", "#chart-distributions"]) {
      const svg = document.querySelector(host + " svg");
      const glyphs = [...svg.querySelectorAll("circle.month-dot")];
      const hits = [...svg.querySelectorAll("circle[data-tip]")];
      hits.forEach((c, i) => {
        const m = glyphs.length === hits.length ? /(?:fill|stroke):\s*(#[0-9a-f]{6})/i.exec(glyphs[i].getAttribute("style") || "") : null;
        seriesLabel.set(c, m === null ? "<no glyph>" : (labelOf[m[1].toLowerCase()] || "<unknown colour " + m[1] + ">"));
      });
    }
    // What an element shows, its decoration (aria-hidden) left out.
    const shown = el => {
      let s = "";
      const walk = n => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) s += c.textContent;
          else if (c.nodeType === 1 && c.getAttribute("aria-hidden") !== "true") walk(c);
        }
      };
      walk(el);
      return s.replace(/\s+/g, " ").trim();
    };
    for (const el of document.querySelectorAll("[data-tip]")) {
      out.targets++;
      const text = el.getAttribute("data-tip");
      const name = el.getAttribute("aria-label");
      const where = `${el.tagName}.${el.getAttribute("class")} ${text.slice(0, 40)}`;
      const isFaultCell = el.matches("td.fault-cell");
      out.faultCells += isFaultCell ? 1 : 0;
      if (!isFaultCell && el.tabIndex !== 0) out.notFocusable.push(where);
      // No target holds its tip as text of its own (a hidden second copy).
      if (el.textContent.includes(text)) out.copies.push(where);
      if (el instanceof SVGElement) {
        const want = seriesLabel.has(el) ? `${seriesLabel.get(el)} · ${text}` : text;
        if (name !== want) out.badSvg.push(`${where} named ${JSON.stringify(name)}, want ${JSON.stringify(want.slice(0, 60))}`);
      } else if (isFaultCell) {
        const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
        const described = ids.map(id => document.getElementById(id));
        const rowFault = el.closest("tr").querySelector(".narrative-fault");
        if (described.length !== 1 || described[0] !== rowFault || rowFault.textContent !== `${NARRATIVE_FAULT_LABEL} ${text}`) {
          out.badFault.push(`${where} described by ${JSON.stringify(ids)}`);
        }
      } else {
        const visible = shown(el);
        const want = visible === "" ? text : `${visible} ${text}`;
        if (el.getAttribute("role") !== "img" || name !== want) {
          out.badHtml.push(`${where} role ${el.getAttribute("role")} named ${JSON.stringify(name && name.slice(0, 60))}, want ${JSON.stringify(want.slice(0, 60))}`);
        }
      }
    }
    return out;
  });
  assert.ok(audit.targets > 1000 && audit.faultCells > 1000 && audit.notFocusable.length === 0 &&
    audit.badSvg.length === 0 && audit.badHtml.length === 0 && audit.badFault.length === 0 && audit.copies.length === 0,
    `[${engine}] Replicata: load the default view and inspect every [data-tip] tooltip target.
Expectata: every target but the incident table's fault cells is a Tab stop, and none holds its tip as text of its own;
an SVG mark's aria-label is its tip, and on the MPI and distribution charts its company's label, " · " and its tip;
an HTML target is role="img" named by what it shows (its aria-hidden decoration left out) and its tip;
a fault cell's aria-describedby is its row's "${"Fault fraction:"}" line, which holds its tip.
Resultata: ${audit.targets} targets (${audit.faultCells} fault cells); not focusable ${audit.notFocusable.length}
(${JSON.stringify(audit.notFocusable.slice(0, 3))}); SVG misnamed ${audit.badSvg.length}
(${JSON.stringify(audit.badSvg.slice(0, 3))}); HTML misnamed ${audit.badHtml.length}
(${JSON.stringify(audit.badHtml.slice(0, 3))}); fault cells undescribed ${audit.badFault.length}
(${JSON.stringify(audit.badFault.slice(0, 3))}); tip copied into the target's text ${audit.copies.length}
(${JSON.stringify(audit.copies.slice(0, 3))}).`);

  // Every narrative toggle has a short name of its own and the narrative as
  // its description (#62).
  const narr = await page.evaluate(() => {
    const want = new Set(activeIncidents().map(r => narrativeToggleName(r.reportId)));
    const names = [], bad = [];
    for (const b of document.querySelectorAll("#incidents-body .narrative-cell [role=button]")) {
      const name = b.getAttribute("aria-label");
      names.push(name);
      const ids = (b.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      const described = ids.map(id => document.getElementById(id));
      const ok = want.has(name) && described.length === 1 && described[0] !== null &&
        b.contains(described[0]) && described[0].textContent === b.textContent && b.textContent.length > 0;
      if (!ok) bad.push({ name, ids, text: b.textContent.slice(0, 40) });
    }
    return { toggles: names.length, unique: new Set(names).size, incidents: want.size,
      longest: Math.max(...names.map(n => (n || "").length)), bad: bad.slice(0, 3), nBad: bad.length };
  });
  assert.ok(narr.toggles > 1000 && narr.toggles === narr.incidents && narr.unique === narr.toggles &&
    narr.nBad === 0 && narr.longest <= 40,
    `[${engine}] Replicata: read every incident narrative toggle's accessible name and description on the default view.
Expectata: each is named by narrativeToggleName(its report id), at most 40 characters, one name per incident, and
described (aria-describedby) by the narrative text inside it.
Resultata: ${JSON.stringify(narr)}.`);

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

  // --- 2026-10-04 #64: no chart clips a tooltip target -----------------------

  // Tesla's first Miles point sits just above the growth chart's x axis; its
  // 12-unit hit circle reaches below it. A point near the circle's bottom edge
  // must still be on the circle (the plot's clip-path cut it off there).
  const growthPage = await openPage(browser, server.url + DEFAULT_QUERY + "&g=miles", { viewport: { width: 1200, height: 900 } });
  const low = await growthPage.evaluate(() => {
    const c = [...document.querySelectorAll("#chart-fleet-timeseries circle[data-tip]")]
      .find(e => e.getAttribute("data-tip").startsWith("Tesla · 2025-06\n"));
    c.scrollIntoView({ block: "center" });
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height * 0.9;
    const hit = document.elementFromPoint(x, y);
    return { found: true, hitIsTarget: hit === c, hit: hit === null ? null : hit.tagName, r: c.getAttribute("r"), cy: c.getAttribute("cy") };
  });
  assert.ok(low.hitIsTarget,
    `[${engine}] Replicata: open the growth chart on Miles (g=miles) and probe the point 90% of the way down Tesla's 2025-06 hit circle.
Expectata: the point is on that hit circle (the whole target counts, below the x axis too).
Resultata: ${JSON.stringify(low)}.`);
  assert.deepEqual(growthPage.errors, [], `[${engine}] uncaught page errors on g=miles: ${JSON.stringify(growthPage.errors)}`);
  await growthPage.context().close();

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
    // #63: the "[?]" glyph is decoration, and no Tab stop is a nameless
    // generic: the card hints, Effective-VMT lines, prior-only multipliers and
    // badges and the markets' status are images named by their text and tip.
    const live = nodes.filter(n => !n.ignored);
    const glyphs = live.filter(n => n.role && n.role.value === "StaticText" && n.name && n.name.value === "[?]").length;
    const focusable = n => (n.properties || []).some(p => p.name === "focusable" && p.value && p.value.value === true);
    const namelessStops = live.filter(n => focusable(n) && n.role && n.role.value === "generic" && (!n.name || n.name.value === ""))
      .map(n => n.backendDOMNodeId);
    const images = live.filter(n => focusable(n) && n.role && n.role.value === "image");
    const unnamedImages = images.filter(n => !n.name || n.name.value === "").length;
    assert.ok(glyphs === 0 && namelessStops.length === 0 && images.length >= 40 && unnamedImages === 0,
      `[chromium] Replicata: read the accessibility tree of the default view.
Expectata: no "[?]" text node (the glyph is aria-hidden), no focusable generic without a name, and the focusable
HTML tooltip targets (40 and more) exposed as named images.
Resultata: ${glyphs} "[?]" text nodes; ${namelessStops.length} nameless focusable generics; ${images.length} focusable images, ${unnamedImages} unnamed.`);
    // #19: a sortable header is a button in its column header, named by the
    // header's text.
    // (The sanity tables' headers, plain text, share some of these names.)
    const LABELS = ["Company", "Date", "Location", "Crash with", "Speed (mph)", "Fault", "Severity", "Narrative"];
    const byId = new Map(nodes.map(n => [n.nodeId, n]));
    const withButton = live.filter(h => {
      if (!h.role || h.role.value !== "columnheader" || !h.name) return false;
      const kids = (h.childIds || []).map(id => byId.get(id)).filter(k => k && !k.ignored);
      return kids.length === 1 && kids[0].role.value === "button" && kids[0].name && kids[0].name.value === h.name.value;
    }).map(h => h.name.value);
    assert.deepEqual(withButton, LABELS,
      `[chromium] Replicata: read the incident table's header row in the accessibility tree.
Expectata: its eight column headers, each holding one button named by its text (the ARIA sortable-table pattern).
Resultata: column headers holding such a button: ${JSON.stringify(withButton)}.`);
    // #62 and #26: a narrative toggle is a button with a short name and the
    // narrative as its description; a fault cell is described by its row's
    // fault reasoning.
    const wanted = new Set(await page.evaluate(() => activeIncidents().map(r => narrativeToggleName(r.reportId))));
    const toggles = live.filter(n => n.role && n.role.value === "button" && n.name && wanted.has(n.name.value));
    const undescribed = toggles.filter(n => !n.description || n.description.value.length < 20).length;
    const faultLabel = await page.evaluate(() => NARRATIVE_FAULT_LABEL);
    const faultCells = live.filter(n => n.description && n.description.value.startsWith(faultLabel + " ")).length;
    assert.ok(toggles.length === wanted.size && toggles.length > 1000 && undescribed === 0 && faultCells === wanted.size,
      `[chromium] Replicata: read the incident table's narrative toggles and fault cells in the accessibility tree.
Expectata: one button per incident, named by its short name and described by its narrative; one fault cell per
incident described by its "${faultLabel}" line.
Resultata: ${toggles.length} of ${wanted.size} toggles found by name, ${undescribed} without a description;
${faultCells} nodes described by a fault line.`);
  }

  // Visually hidden tip text, as first absolutely positioned (the usual
  // recipe), escaped its scroll box's clipping and widened a 400px phone page
  // to 955px (Chromium, WebKit; found 2026-10-03). Since 2026-10-04 no target
  // holds hidden text; nothing on the page may widen it.
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

// Page layout as the three engines draw it (2026-10-03, audit #23, #24, #28,
// #63, #64, #66). The DOM-stub quals cannot see layout; these checks load
// index.html in Chromium, Firefox and WebKit:
//  - #23: the Sensitivity-analysis table fits its scroll box at desktop width
//    (it was 952px in a 928px box in every engine, cutting "ambiguous" to
//    "ambiguo"), in the windows where it was widest;
//  - #24: no horizontal page scroll from 320 CSS px up (the "Miles per
//    [select] incident" control could not wrap: 389-394px wide);
//  - #28: on a phone, chart text renders near the page's own sizes (ticks
//    were 5.7-5.9 CSS px, axis titles 4.9-5.0), and every chart tooltip
//    target is a finger-sized circle unless its neighbours are closer; the
//    charts follow their column's width when the window is resized;
//  - #28, #58: chart labels clear each other and the rotated y titles, by
//    their real widths (whole values dropped their ".0" and outgrew the
//    label model's assumption that every K/M label had a ".");
//  - #63 (#28 too): a pointer at a target's centre reaches that target,
//    unless another target's centre lies within 4 units (marks drawn on top
//    of each other);
//  - #64: incident dates stay on one line ("JUL-" / "2025" in Chromium and
//    WebKit), and keeping them whole does not make the table taller (made
//    unbreakable alone, they grew WebKit's table 12%);
//  - #66: the date slider's fill runs exactly between the two thumb centres
//    (it ran on raw percentages, 4px past the thumb in one-month windows at
//    either end of the series).
import assert from "node:assert/strict";
import { ENGINES, devices, serveRepo } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// openPage in browser.mjs waits for incident rows, which a window with no
// incidents (2021-07) lacks; this one waits for the slider and the markets.
async function open(browser, url, contextOptions) {
  const context = await browser.newContext(contextOptions);
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", err => page.errors.push(err.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("date-range-fill") !== null &&
    document.querySelector(".pm-refresh") !== null &&
    document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
  return page;
}

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    const closePage = async page => {
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();
    };

    // #23 -- the stress table at desktop width, in the default window and
    // the windows where its nowrap cells were widest.
    for (const d of ["", "&d=2026-02.2026-07", "&d=2026-07.2026-08", "&d=2025-01.2025-06", "&d=2021-07.2026-08"]) {
      const page = await open(browser, server.url + DEF + d, { viewport: { width: 1200, height: 900 } });
      const r = await page.evaluate(() => {
        const t = document.querySelector("table.stress-table");
        return { table: t.getBoundingClientRect().width, box: t.parentElement.clientWidth };
      });
      if (r.table > r.box + 0.5) problems.push(`${engineName} 1200px${d}: Sensitivity-analysis table ${r.table.toFixed(1)}px wide in a ${r.box}px box`);
      await closePage(page);
    }

    // #24 -- no sideways scroll on narrow phones.
    for (const width of [320, 360, 375, 390]) {
      const page = await open(browser, server.url + DEF, { viewport: { width, height: 800 } });
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (r.sw > r.cw) problems.push(`${engineName} ${width}px: the page scrolls sideways (scrollWidth ${r.sw} > ${r.cw})`);
      await closePage(page);
    }

    // #28, #63 -- chart text and tooltip targets at phone and desktop width;
    // WebKit also as an iPhone 14.
    const layouts = [["400px", { viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 }],
      ["1200px", { viewport: { width: 1200, height: 900 } }]];
    if (engineName === "webkit") layouts.push(["iPhone 14", devices["iPhone 14"]]);
    for (const [what, options] of layouts) {
      const page = await open(browser, server.url + DEF, options);
      const r = await page.evaluate(() => {
        const out = { text: [], targets: [], stolen: [], edge: [] };
        for (const svg of document.querySelectorAll("svg.month-svg")) {
          const host = svg.closest("[id]").id;
          const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
          for (const [sel, min] of [["text.month-tick", 12], ["text.month-label", 11]]) {
            const el = svg.querySelector(sel);
            if (el === null) continue;
            const px = parseFloat(getComputedStyle(el).fontSize) * scale;
            if (px < min - 0.05) out.text.push(`${host} ${sel} renders at ${px.toFixed(2)} CSS px (< ${min})`);
          }
          const hits = [...svg.querySelectorAll("circle[data-tip]")];
          const centres = hits.map(c => ({ c, x: c.cx.baseVal.value, y: c.cy.baseVal.value, r: c.r.baseVal.value }));
          svg.scrollIntoView({ block: "center" });
          for (const t of centres) {
            const near = Math.min(Infinity, ...centres.filter(u => u !== t).map(u => Math.hypot(u.x - t.x, u.y - t.y)));
            const radiusPx = t.r * scale, wantPx = Math.min(12, near * scale / 2);
            if (radiusPx < wantPx - 0.5) out.targets.push(`${host} "${t.c.getAttribute("data-tip").split("\n")[0]}" radius ${radiusPx.toFixed(1)} CSS px (room for ${wantPx.toFixed(1)})`);
            const b = t.c.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            const owner = centres.find(u => u.c === hit);
            if (hit !== t.c && !(owner !== undefined && Math.hypot(owner.x - t.x, owner.y - t.y) <= 4))
              out.stolen.push(`${host} centre of "${t.c.getAttribute("data-tip").replace(/\n/g, " / ")}" reaches ${hit === null ? "nothing" : hit.matches("[data-tip]") ? `"${hit.getAttribute("data-tip").replace(/\n/g, " / ")}"` : `<${hit.tagName}>`}`);
            // A target is its disc: 0.3 units inside its edge it is hit, 0.3
            // outside it is not (an invisible 1-unit stroke counted under
            // pointer-events: all and widened every radius by half a unit in
            // Chromium and Firefox). Probed where no other target is near.
            if (near > 2 * t.r + 2) {
              const y = b.top + b.height / 2, x0 = b.left + b.width / 2;
              const inside = document.elementFromPoint(x0 + (t.r - 0.3) * scale, y) === t.c;
              const outside = document.elementFromPoint(x0 + (t.r + 0.3) * scale, y) === t.c;
              if (!inside || outside) out.edge.push(`${host} "${t.c.getAttribute("data-tip").split("\n")[0]}" (r ${t.r}): hit ${inside ? "" : "not "}0.3 inside its edge, ${outside ? "" : "not "}0.3 outside`);
            }
          }
        }
        return out;
      });
      for (const p of [...r.text, ...r.targets.slice(0, 6), ...r.stolen.slice(0, 6), ...r.edge.slice(0, 6)]) problems.push(`${engineName} ${what}: ${p}`);
      if (r.edge.length > 6) problems.push(`${engineName} ${what}: ${r.edge.length - 6} more targets larger or smaller than their disc`);
      if (r.targets.length > 6) problems.push(`${engineName} ${what}: ${r.targets.length - 6} more undersized targets`);
      if (r.stolen.length > 6) problems.push(`${engineName} ${what}: ${r.stolen.length - 6} more targets whose centre reaches another`);
      await closePage(page);
    }

    // #28 -- the charts follow their column's width: a page loaded wide and
    // then narrowed (a phone turned, a window resized) redraws every chart
    // with a viewBox as wide as its column, and widening it again restores
    // the 900-unit layout; a resize that keeps the width (a phone's toolbar
    // hiding as the page scrolls) redraws nothing.
    {
      const page = await open(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
      const widths = () => page.evaluate(() => ({
        column: document.getElementById("month-panel").clientWidth,
        boxes: [...document.querySelectorAll("svg.month-svg")].map(s => s.viewBox.baseVal.width),
      }));
      const mark = () => page.evaluate(() => { document.querySelector("#chart-mpi-all svg").dataset.qualMark = "kept"; });
      const kept = () => page.evaluate(() => document.querySelector("#chart-mpi-all svg").dataset.qualMark === "kept");
      const steps = [];
      for (const [width, height] of [[400, 860], [400, 700], [1200, 900]]) {
        await mark();
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(300);
        const w = await widths();
        const want = Math.min(900, w.column);
        steps.push({ width, height, column: w.column, boxes: [...new Set(w.boxes)], kept: await kept(), want });
      }
      const [narrow, shorter, wide] = steps;
      if (!(narrow.boxes.length === 1 && narrow.boxes[0] === narrow.want && !narrow.kept))
        problems.push(`${engineName}: narrowing 1200 -> 400px left the charts' viewBoxes at ${JSON.stringify(narrow.boxes)} for a ${narrow.column}px column (redrawn: ${!narrow.kept})`);
      if (!shorter.kept) problems.push(`${engineName}: a height-only resize (400x860 -> 400x700) redrew the charts`);
      if (!(wide.boxes.length === 1 && wide.boxes[0] === 900))
        problems.push(`${engineName}: widening back to 1200px left the viewBoxes at ${JSON.stringify(wide.boxes)}`);
      await closePage(page);
    }

    // #28, #58 -- chart labels clear each other and the y titles, measured by
    // their real advance widths (getComputedTextLength; Firefox's getBBox
    // pads every text box ~2 units a side). A y label is end-anchored one
    // TICK_GAP left of the axis and must stop short of the rotated title,
    // whose baseline is x=18 and whose descenders reach ~21; x labels are
    // centred on their gridlines or months and must not touch. The label
    // model (tickLabelWidth) assumed a "." in every K/M label until whole
    // values dropped their ".0" (audit #58): "159M" is 35.6 units wide at
    // 13px, a third of a glyph past four of them.
    for (const [what, options, q] of [
      ["1200px", { viewport: { width: 1200, height: 900 } }, DEF],
      ["400px", { viewport: { width: 400, height: 860 } }, DEF],
      ["1200px, all six, full history, cumulative VMT, miles", { viewport: { width: 1200, height: 900 } },
        "?f=All&s=-&a=1&c=HumansAV.HumansUS.HumansRideshare.Tesla.Waymo.Zoox&m=all&d=2021-07.2026-08&v=1&g=miles"],
      ["400px, all six, full history, cumulative VMT, miles", { viewport: { width: 400, height: 860 } },
        "?f=All&s=-&a=1&c=HumansAV.HumansUS.HumansRideshare.Tesla.Waymo.Zoox&m=all&d=2021-07.2026-08&v=1&g=miles"],
      ["1200px, fatality, last month, rides", { viewport: { width: 1200, height: 900 } },
        "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo.Zoox&m=fatality&d=2026-08.2026-08&g=rides"],
      ["400px, injury, 2025-01..06, cumulative VMT", { viewport: { width: 400, height: 860 } },
        "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=injury&d=2025-01.2025-06&v=1"],
    ]) {
      const page = await open(browser, server.url + q, options);
      const r = await page.evaluate(() => {
        const out = [];
        for (const svg of document.querySelectorAll("svg.month-svg")) {
          const host = svg.closest("[id]").id;
          const ticks = [...svg.querySelectorAll("text.month-tick")].filter(t => t.textContent !== "?");
          for (const t of ticks.filter(t => t.getAttribute("text-anchor") === "end")) {
            const left = Number(t.getAttribute("x")) - t.getComputedTextLength();
            if (left < 21) out.push(`${host} y label "${t.textContent}" reaches x=${left.toFixed(1)}, into the y title (descenders to ~21)`);
          }
          const xs = ticks.filter(t => t.getAttribute("text-anchor") === "middle" && t.getAttribute("transform") === null)
            .map(t => { const x = Number(t.getAttribute("x")), w = t.getComputedTextLength(), y = t.getAttribute("y");
              return { label: t.textContent, y, x0: x - w / 2, x1: x + w / 2 }; })
            .sort((a, b) => a.x0 - b.x0);
          for (let i = 1; i < xs.length; i++) if (xs[i].y === xs[i - 1].y && xs[i].x0 < xs[i - 1].x1)
            out.push(`${host} x labels "${xs[i - 1].label}" and "${xs[i].label}" overlap by ${(xs[i - 1].x1 - xs[i].x0).toFixed(1)}`);
        }
        return out;
      });
      for (const p of r) problems.push(`${engineName} ${what}: ${p}`);
      await closePage(page);
    }

    // #64 -- dates on one line; whole dates do not grow the table.
    for (const width of [1200, 400]) {
      const page = await open(browser, server.url + DEF, { viewport: { width, height: 900 } });
      const r = await page.evaluate(() => {
        const cells = [...document.querySelectorAll("#incidents-body tr")].map(tr => tr.children[1]);
        const wraps = td => { const range = document.createRange(); range.selectNodeContents(td); return new Set([...range.getClientRects()].map(q => Math.round(q.top))).size > 1; };
        const table = document.querySelector("#incidents-body").closest("table");
        const wrapped = cells.filter(wraps).length;
        const whole = table.getBoundingClientRect().height;
        // The same table with the dates free to break at their hyphen.
        for (const td of cells) td.style.whiteSpace = "normal";
        const breakable = table.getBoundingClientRect().height;
        return { cells: cells.length, wrapped, whole, breakable };
      });
      if (r.wrapped > 0) problems.push(`${engineName} ${width}px: ${r.wrapped} of ${r.cells} incident dates break across lines`);
      if (r.whole > r.breakable * 1.005) problems.push(`${engineName} ${width}px: whole dates make the incident table ${((r.whole / r.breakable - 1) * 100).toFixed(1)}% taller (${Math.round(r.breakable)} -> ${Math.round(r.whole)}px)`);
      await closePage(page);
    }

    // #66 -- the slider fill spans the two thumb centres.
    for (const d of ["", "&d=2026-08.2026-08", "&d=2021-07.2021-07", "&d=2025-01.2025-06"]) {
      const page = await open(browser, server.url + DEF + d, { viewport: { width: 1200, height: 900 } });
      const r = await page.evaluate(() => {
        const fill = document.getElementById("date-range-fill").getBoundingClientRect();
        const box = document.querySelector(".date-range-slider").getBoundingClientRect();
        const lo = document.getElementById("date-range-min"), hi = document.getElementById("date-range-max");
        // A range thumb's centre travels from half its width (9px) to the
        // box width less half its width.
        const centre = input => box.left + 9 + (box.width - 18) * Number(input.value) / Number(input.max);
        return { left: fill.left, right: fill.right, a: centre(lo), b: centre(hi) };
      });
      // The fill runs from the start thumb's centre to the end thumb's; its
      // two 2px borders keep an empty (one-month) window's box 4px wide.
      const ok = Math.abs(r.left - r.a) <= 1 && Math.abs(r.right - Math.max(r.b, r.a + 4)) <= 1;
      if (!ok) problems.push(`${engineName} slider${d || " (default window)"}: fill ${r.left.toFixed(1)}-${r.right.toFixed(1)}, thumb centres ${r.a.toFixed(1)} and ${r.b.toFixed(1)}`);
      await closePage(page);
    }
    await browser.close();
  }
} finally {
  await server.close();
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load the page in Chromium, Firefox and WebKit; measure the Sensitivity-analysis table at 1200px in five windows, the page width at 320-390px, chart text and tooltip targets at 400px, 1200px and (WebKit) on an iPhone 14, the charts' viewBoxes across a 1200 -> 400 -> 400 (shorter) -> 1200px resize, chart labels in six states, incident dates and table height at 1200 and 400px, and the date slider's fill in four windows.
Expectata: the table fits its box; no sideways scroll; chart ticks >= 12 and axis titles >= 11 CSS px; every target as large as its spacing allows up to a 12 CSS px radius, and its centre its own; the charts redrawn at their column's width on a width change and not on a height change; no label into a y title or onto its neighbour; dates on one line without a taller table; the fill from thumb centre to thumb centre.
Resultata: ${problems.length} problems:
${problems.slice(0, 30).join("\n")}`);
console.log("qual pass: tables, controls, charts and the date slider fit and line up in three engines at phone and desktop widths");

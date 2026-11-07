// The date slider's two thumbs in the three engines (audit 2026-10-04 #14).
// The thumbs cannot cross: a moved thumb stops at the other, so "Start
// month" always holds the window's first month and "End month" its last.
// Until 2026-10-04 they crossed: End on "Start month" and Home on "End
// month" gave the window 2021-07..2026-08 with "Start month" announcing
// 2026-08 and "End month" 2021-07, and ArrowRight on "End month" then moved
// the window's start. date-slider.qual checks the clamp in a DOM stub; this
// checks it, and which thumb is drawn on top, where keys, pointers and the
// cascade are real:
//  - the keys above leave a one-month window whose two inputs both announce
//    its month;
//  - while the two thumbs share a month, a pointer at them reaches the start
//    thumb in the slider's right half and the end thumb in its left half
//    (the engine's own hit test; until 2026-11-07 date-slider.qual checked
//    this with style.css's values, read through a model of the cascade);
//  - a window collapsed onto one month opens again by dragging the thumb a
//    pointer reaches there: at the series' last month the start thumb (drawn
//    on top, it moves left), at its first month the end thumb (it moves
//    right). With the end thumb always on top, a window collapsed onto the
//    last month could not be widened by pointer once the thumbs stopped
//    crossing;
//  - a drag that the clamp stops commits on release (the incident browser,
//    the sanity section and the URL follow), which WebKit's change event
//    alone did not do (reviewer, 2026-10-04).
import assert from "node:assert/strict";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// browser.mjs's openPage waits for incident rows, which a window with none
// (2021-07) lacks; this waits for the slider and the markets instead.
async function open(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
  // Where a pointer reaches a range input's thumb at value v, and the travel
  // per step: the thumb is var(--thumb) across (style.css), its centre
  // running from half a thumb in from the input's left edge to half a thumb
  // in from its right. The size is the length the engine resolves the token
  // to, laid out as the width of a hidden probe beside the input, so any
  // form of the token (a px or rem length, calc(), max()) reads as the
  // engine draws it. History: until 2026-11-07 the qual took 18 px, a copy
  // of style.css's, so a thumb under 9 px put the pointer off it at the
  // slider's ends; then, the same day, parseFloat of the token, which read
  // a rem length as px and stopped on max() or calc(). assert is crashla.js's.
  await context.addInitScript(() => {
    window.__thumbAt = (input, v) => {
      const size = getComputedStyle(input).getPropertyValue("--thumb");
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;visibility:hidden;height:0";
      probe.style.width = size;
      input.parentElement.appendChild(probe);
      const thumb = probe.getBoundingClientRect().width;
      probe.remove();
      assert(thumb > 0, "Replicata: lay out the date slider's thumb size, style.css's --thumb as read on #" + input.id + ", as the width of a hidden probe beside it.\nExpectata: a positive width.\nResultata:", {size, thumb});
      const box = input.getBoundingClientRect();
      return { x: box.left + thumb / 2 + (box.width - thumb) * v / Number(input.max), y: box.top + box.height / 2,
        perStep: (box.width - thumb) / Number(input.max) };
    };
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", err => page.errors.push(err.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("date-range-fill") !== null &&
    document.querySelector(".pm-refresh") !== null &&
    document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
  await page.waitForFunction(drawnAll);
  return page;
}
const read = page => page.evaluate(() => ({
  label: document.querySelector(".date-range-label").textContent,
  start: [document.getElementById("date-range-min").getAttribute("aria-label"), document.getElementById("date-range-min").getAttribute("aria-valuetext")],
  end: [document.getElementById("date-range-max").getAttribute("aria-label"), document.getElementById("date-range-max").getAttribute("aria-valuetext")],
  search: location.search,
}));
// Drag the thumb a pointer reaches at the month the window is collapsed on,
// by dx CSS px.
async function dragFromThumbs(page, dx) {
  const at = await page.evaluate(() => {
    const input = document.getElementById("date-range-max");
    return window.__thumbAt(input, Number(input.value));
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y, { steps: 12 });
  await page.mouse.up();
}

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      // Keys: End on "Start month", Home on "End month", then ArrowRight.
      // Each input keeps the name it loads with, the two names distinct (read
      // from the page; until 2026-10-31 this spelled them, and they are the
      // human's words: audit 2026-10-30, QT-09).
      const page = await open(browser, server.url + DEF);
      const months = await page.evaluate(() => fullMonthSeries.months);
      const last = months[months.length - 1];
      const names = await read(page);
      await page.focus("#date-range-min");
      await page.keyboard.press("End");
      await page.focus("#date-range-max");
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      const keys = await read(page);
      const wantKeys = { label: last, start: [names.start[0], last], end: [names.end[0], last] };
      if (!names.start[0] || !names.end[0] || names.start[0] === names.end[0])
        problems.push(`${engineName}: the start and end inputs load named ${JSON.stringify([names.start[0], names.end[0]])}; want two distinct names`);
      if (keys.label !== wantKeys.label || JSON.stringify(keys.start) !== JSON.stringify(wantKeys.start) || JSON.stringify(keys.end) !== JSON.stringify(wantKeys.end))
        problems.push(`${engineName}: after End on "Start month", Home and ArrowRight on "End month": ${JSON.stringify(keys)}; want ${JSON.stringify(wantKeys)} (each input keeping the name it loaded with)`);
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();

      // While the two thumbs share a month, the one drawn on top is the one a
      // pointer grabs, so it must be one that can still move outward: the
      // start thumb in the slider's right half (it can move left), the end
      // thumb in the left half (it can move right). With crossing gone, a
      // window collapsed onto the last month would otherwise trap a pointer:
      // the end thumb, on top, cannot move left past the start thumb it
      // hides. Read from the engine at the series' last and first months and
      // a month near each end: the element a pointer at the thumbs' centre
      // reaches (document.elementFromPoint, the hit test the drags below go
      // through), with each input's computed z-index for the message.
      {
        const p = await open(browser, server.url + DEF);
        const stacked = await p.evaluate(() => {
          const last = fullMonthSeries.months.length - 1;
          const min = document.getElementById("date-range-min");
          const max = document.getElementById("date-range-max");
          const move = (input, v) => { input.value = String(v); input.dispatchEvent(new Event("input", { bubbles: true })); };
          max.scrollIntoView({ block: "center" });
          // Both thumbs onto month v, in an order no clamp interferes with:
          // start to 0, end to v, start to v; then the thumbs' centre, as the
          // drags below find it.
          const at = v => {
            move(min, 0); move(max, v); move(min, v);
            const point = window.__thumbAt(max, v);
            const hit = document.elementFromPoint(point.x, point.y);
            // The element reached, by its tag, id and class (until
            // 2026-11-07 its markup, whose value attribute is the one set at
            // load, not the input's current value; that is in window).
            return { reaches: [hit === min, hit === max],
              hit: hit === null ? null : { tag: hit.tagName.toLowerCase(), id: hit.id, class: hit.getAttribute("class") },
              zIndex: [getComputedStyle(min).zIndex, getComputedStyle(max).zIndex], window: [min.value, max.value] };
          };
          return { atLast: at(last), atFirst: at(0), rightHalf: at(last - 3), leftHalf: at(3) };
        });
        // Which input a pointer at the thumbs' centre reaches, as [the start
        // input, the end input].
        const got = Object.fromEntries(Object.entries(stacked).map(([at, c]) => [at, c.reaches]));
        const want = { atLast: [true, false], atFirst: [false, true], rightHalf: [true, false], leftHalf: [false, true] };
        if (JSON.stringify(got) !== JSON.stringify(want))
          problems.push(`${engineName}: with the window collapsed onto one month, a pointer at the thumbs' centre reaches [the start input, the end input] ${JSON.stringify(got)}; want ${JSON.stringify(want)} (each case's element reached, the inputs' computed z-index, start then end, and the window: ${JSON.stringify(stacked)})`);
        if (p.errors.length > 0) problems.push(`${engineName} thumb stacking: page errors ${JSON.stringify(p.errors)}`);
        await p.context().close();
      }

      // Pointer: a window collapsed onto the last month, then onto the first.
      for (const [d, dx, want] of [
        [`${last}.${last}`, -200, w => w.start !== last && w.end === last],
        ["2021-07.2021-07", 200, w => w.start === "2021-07" && w.end !== "2021-07"],
      ]) {
        const p = await open(browser, server.url + DEF + "&d=" + d);
        await dragFromThumbs(p, dx);
        const after = await read(p);
        const win = { start: after.start[1], end: after.end[1] };
        if (!want(win) || win.start > win.end) problems.push(`${engineName}: window collapsed onto ${d.slice(0, 7)}, a ${dx > 0 ? "rightward" : "leftward"} drag from its thumbs gives ${JSON.stringify(after)}; want the window widened ${dx > 0 ? "rightward (end thumb moved)" : "leftward (start thumb moved)"}`);
        if (p.errors.length > 0) problems.push(`${engineName} d=${d}: page errors ${JSON.stringify(p.errors)}`);
        await p.context().close();
      }

      // Pointer: a drag that ends where the clamp stopped the thumb commits
      // (reviewer, 2026-10-04): WebKit measures its change event from the
      // last value a script assigned, which is the clamp's, so such a release
      // fired none, and the incident browser, the sanity section and the URL
      // stayed on the old window while the slider and the charts showed the
      // new one. On 2025-06..2026-03, the end thumb dragged 20 months left
      // stops at 2025-06, the start thumb dragged 20 months right at 2026-03.
      for (const [id, dMonths, want] of [["date-range-max", -20, "2025-06"], ["date-range-min", 20, "2026-03"]]) {
        const p = await open(browser, server.url + DEF + "&d=2025-06.2026-03");
        const at = await p.evaluate(id => {
          const input = document.getElementById(id);
          return window.__thumbAt(input, Number(input.value));
        }, id);
        await p.mouse.move(at.x, at.y);
        await p.mouse.down();
        await p.mouse.move(at.x + dMonths * at.perStep, at.y, { steps: 20 });
        await p.mouse.up();
        await p.waitForTimeout(300);
        // The heading names the window by its months (YYYY-MM).
        const after = await p.evaluate(() => ({
          label: document.querySelector(".date-range-label").textContent,
          heading: document.getElementById("incident-browser-heading").textContent.match(/\d{4}-\d{2}/g),
          d: (/[?&]d=([^&]*)/.exec(location.search) || [, "(none)"])[1],
        }));
        const wantAfter = { label: want, heading: [want, want], d: `${want}.${want}` };
        if (JSON.stringify(after) !== JSON.stringify(wantAfter)) problems.push(`${engineName}: on 2025-06..2026-03, ${id === "date-range-max" ? "the end thumb dragged 20 months left" : "the start thumb dragged 20 months right"} (stopped by the other) gives ${JSON.stringify(after)}; want ${JSON.stringify(wantAfter)} (the release commits the window)`);
        if (p.errors.length > 0) problems.push(`${engineName} clamped drag ${id}: page errors ${JSON.stringify(p.errors)}`);
        await p.context().close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit, (a) on the default view press End on "Start month", then Home and ArrowRight on "End month"; (b) open d=<last month>.<last month> and drag the thumbs' spot 200 px left; (c) open d=2021-07.2021-07 and drag it 200 px right; (d) open d=2025-06.2026-03 and drag the end thumb 20 months left, then (fresh page) the start thumb 20 months right, past the other; (e) on a fresh default view collapse the window onto one month at the series' last month, its first month, and a month near each end (the start thumb to 0, the end thumb to the month, the start thumb to it), and find the input a pointer at the thumbs' centre reaches (document.elementFromPoint).
Expectata: (a) a one-month window on the last month, both inputs announcing it ("Start month" and "End month" never swap roles); (b) the start thumb moves: the window widens leftward to end on the last month; (c) the end thumb moves: the window widens rightward from 2021-07; (d) each moved thumb stops at the other and the release commits that one-month window: the slider label, the incident browser's heading and the URL's d= all name it; (e) the start input in the slider's right half (its thumb can still move left), the end input in its left half (its thumb can still move right).
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: the date slider's thumbs cannot cross, the one drawn on top of a collapsed window can move outward, a window collapsed onto one month at either end opens again by pointer, and a drag the clamp stops commits on release, in Chromium, Firefox and WebKit");

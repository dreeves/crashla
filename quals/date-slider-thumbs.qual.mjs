// The date slider's two thumbs in the three engines (audit 2026-10-04 #14).
// The thumbs cannot cross: a moved thumb stops at the other, so "Start
// month" always holds the window's first month and "End month" its last.
// Until 2026-10-04 they crossed: End on "Start month" and Home on "End
// month" gave the window 2021-07..2026-08 with "Start month" announcing
// 2026-08 and "End month" 2021-07, and ArrowRight on "End month" then moved
// the window's start. date-slider.qual checks the clamp and the stacking in a
// DOM stub; this checks them where keys and pointers are real:
//  - the keys above leave a one-month window whose two inputs both announce
//    its month;
//  - a window collapsed onto one month opens again by dragging the thumb a
//    pointer reaches there: at the series' last month the start thumb (drawn
//    on top, it moves left), at its first month the end thumb (it moves
//    right). With the end thumb always on top, a window collapsed onto the
//    last month could not be widened by pointer once the thumbs stopped
//    crossing.
import assert from "node:assert/strict";
import { ENGINES, serveRepo } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// browser.mjs's openPage waits for incident rows, which a window with none
// (2021-07) lacks; this waits for the slider and the markets instead.
async function open(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
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
    const box = input.getBoundingClientRect();
    const x = box.left + 9 + (box.width - 18) * Number(input.value) / Number(input.max);
    return { x, y: box.top + box.height / 2 };
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
      const page = await open(browser, server.url + DEF);
      const months = await page.evaluate(() => fullMonthSeries.months);
      const last = months[months.length - 1];
      await page.focus("#date-range-min");
      await page.keyboard.press("End");
      await page.focus("#date-range-max");
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      const keys = await read(page);
      const wantKeys = { label: last, start: ["Start month", last], end: ["End month", last] };
      if (keys.label !== wantKeys.label || JSON.stringify(keys.start) !== JSON.stringify(wantKeys.start) || JSON.stringify(keys.end) !== JSON.stringify(wantKeys.end))
        problems.push(`${engineName}: after End on "Start month", Home and ArrowRight on "End month": ${JSON.stringify(keys)}; want ${JSON.stringify(wantKeys)}`);
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();

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
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit, (a) on the default view press End on "Start month", then Home and ArrowRight on "End month"; (b) open d=<last month>.<last month> and drag the thumbs' spot 200 px left; (c) open d=2021-07.2021-07 and drag it 200 px right.
Expectata: (a) a one-month window on the last month, both inputs announcing it ("Start month" and "End month" never swap roles); (b) the start thumb moves: the window widens leftward to end on the last month; (c) the end thumb moves: the window widens rightward from 2021-07.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: the date slider's thumbs cannot cross, and a window collapsed onto one month at either end opens again by pointer, in Chromium, Firefox and WebKit");

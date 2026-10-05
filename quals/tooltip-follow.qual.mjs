// A tooltip that keyboard focus shows follows its target when the page
// scrolls (2026-10-05, with audit 2026-10-04 #18 and #25). WebKit may scroll a
// newly focused target into view only after the next animation frame, where
// the focus handler read the target's corner a second time, so the tip stayed
// where the target had been, off-screen: for 0-1 of 210 targets in about half
// the WebKit runs of tooltip-focus-position.qual, and for 3-6 in every run once
// the incident box was laid out only near the screen (content-visibility).
// Spec, in Chromium, Firefox and WebKit, where scrolling is real:
//  - a target focused from the keyboard shows its tip beside its corner, and
//    after the page scrolls the tip is beside the target's new corner;
//  - a tip a pointer shows afterwards is the pointer's: a scroll does not move
//    it to the focused target (it stays where the pointer put it, or, in
//    Chromium, which fires pointerleave as the marker scrolls away, hides);
//  - a tip follows its target only while focus is on it: once a redraw has
//    removed the focused marker (focus falls to <body>), a scroll leaves the
//    tip hidden (Chromium) or where it was (Firefox, WebKit), not at the
//    viewport's top-left corner (reviewer, 2026-10-05).
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// Where the page's placement rule (initTooltips position(): 12px right of and
// below the corner, flipped or clamped to stay 12px inside the viewport)
// puts the tip for the focused target as it now is, and where the tip is.
const placement = page => page.evaluate(() => {
  const el = document.activeElement, tip = document.getElementById("chart-tip");
  const t = tip.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = 12;
  let left = r.right + pad, top = r.bottom + pad;
  if (left + t.width > innerWidth - pad) left = r.right - t.width - pad;
  if (top + t.height > innerHeight - pad) top = r.bottom - t.height - pad;
  return { shown: getComputedStyle(tip).display !== "none", text: tip.textContent.slice(0, 30),
    at: [Math.round(t.left), Math.round(t.top)], want: [Math.round(Math.max(pad, left)), Math.round(Math.max(pad, top))] };
});
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      const page = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
      // A chart marker on the MPI chart, focused from the keyboard with the
      // page scrolled so the marker sits mid-screen.
      await page.evaluate(() => {
        const el = document.querySelector("#chart-mpi-all circle[data-tip][tabindex='0']");
        el.scrollIntoView({ block: "center" });
      });
      await frames(page);
      await page.keyboard.press("Shift");
      await page.evaluate(() => document.querySelector("#chart-mpi-all circle[data-tip][tabindex='0']").focus());
      await frames(page);
      const before = await placement(page);
      await page.evaluate(() => window.scrollBy(0, 120));
      await frames(page);
      const after = await placement(page);
      const off = p => Math.max(Math.abs(p.at[0] - p.want[0]), Math.abs(p.at[1] - p.want[1]));
      if (!before.shown || off(before) > 1) problems.push(`${engineName}: a focused marker's tip at ${JSON.stringify(before.at)}, want ${JSON.stringify(before.want)}`);
      if (!after.shown || off(after) > 1) problems.push(`${engineName}: after a 120 px scroll the focused marker's tip is at ${JSON.stringify(after.at)}, want ${JSON.stringify(after.want)} (beside the target's new corner)`);

      // Then a pointer over another marker: its tip is the pointer's, and a
      // scroll leaves it where the pointer put it.
      const other = await page.evaluate(() => {
        const el = document.querySelectorAll("#chart-mpi-all circle[data-tip][tabindex='0']")[3];
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.getAttribute("data-tip").slice(0, 30) };
      });
      await page.mouse.move(other.x, other.y);
      await frames(page);
      const hovered = await page.evaluate(() => { const t = document.getElementById("chart-tip").getBoundingClientRect(); return [Math.round(t.left), Math.round(t.top)]; });
      await page.evaluate(() => window.scrollBy(0, 40));
      await frames(page);
      const hoverAfter = await page.evaluate(() => { const t = document.getElementById("chart-tip"); const r = t.getBoundingClientRect(); return { shown: getComputedStyle(t).display !== "none", at: [Math.round(r.left), Math.round(r.top)], text: t.textContent.slice(0, 30) }; });
      // (Chromium fires pointerleave when a scroll moves the marker from under
      // the pointer, which hides the tip; the others leave it shown.)
      if (hoverAfter.shown && (hoverAfter.text !== other.text || hoverAfter.at[0] !== hovered[0] || hoverAfter.at[1] !== hovered[1]))
        problems.push(`${engineName}: a hovered marker's tip (${JSON.stringify(other.text)} at ${JSON.stringify(hovered)}) became ${JSON.stringify(hoverAfter)} after a scroll`);
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();

      // A focused marker that a redraw removes (a width change redraws the
      // charts, and a chart mark carries no data-focus-key, so focus falls to
      // <body>): Chromium fires focusout and hides the tip; Firefox and
      // WebKit fire none, and the tip stays where it was. It follows nothing
      // afterwards: until 2026-10-05 (reviewer) the next scroll moved it to
      // the corner of the removed marker, which reads (0, 0), so it sat at the
      // viewport's top-left corner over the page.
      const gone = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
      await gone.evaluate(() => document.querySelector("#chart-mpi-all circle[data-tip][tabindex='0']").scrollIntoView({ block: "center" }));
      await frames(gone);
      await gone.keyboard.press("Shift");
      await gone.evaluate(() => document.querySelector("#chart-mpi-all circle[data-tip][tabindex='0']").focus());
      await frames(gone);
      const tipAt = () => gone.evaluate(() => { const t = document.getElementById("chart-tip"), r = t.getBoundingClientRect();
        return { shown: getComputedStyle(t).display !== "none", at: [Math.round(r.left), Math.round(r.top)], focus: document.activeElement.tagName }; });
      const focusedTip = await tipAt();
      await gone.setViewportSize({ width: 700, height: 900 });
      await gone.waitForFunction(() => chartViewW < 900);
      await frames(gone);
      await gone.evaluate(() => window.scrollBy(0, 100));
      await frames(gone);
      const goneTip = await tipAt();
      if (!focusedTip.shown || goneTip.focus !== "BODY" || (goneTip.shown && (goneTip.at[0] !== focusedTip.at[0] || goneTip.at[1] !== focusedTip.at[1])))
        problems.push(`${engineName}: a focused marker's tip at ${JSON.stringify(focusedTip)}; after a redraw removed the marker and a scroll it is ${JSON.stringify(goneTip)} (want hidden, or where it was, with focus on BODY)`);
      if (gone.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(gone.errors)}`);
      await gone.context().close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit, on the default view, focus an MPI-chart marker from the keyboard, scroll the page 120 px; then hover another marker and scroll 40 px; then, on a fresh page, focus a marker from the keyboard, narrow the window to 700 px (the charts redraw without it) and scroll 100 px.
Expectata: the focused marker's tip beside its corner before and after the scroll; after the second scroll the tip is the hovered marker's, where the pointer put it, or hidden (Chromium's pointerleave), never moved to the focused marker; after the redraw focus is on BODY and the tip is hidden or where it was.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: a tooltip keyboard focus shows follows its target as the page scrolls, and a pointer's tip stays the pointer's, in three engines");

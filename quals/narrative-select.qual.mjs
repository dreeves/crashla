// Selecting text in an expanded narrative keeps it expanded (audit
// 2026-10-04 #60). A narrative cell toggles on click, and a drag that
// selects text inside it ends in a click on the cell, so until 2026-10-04
// dragging across an expanded narrative to copy it collapsed it (in
// Chromium, Firefox and WebKit; the selection survived behind the ellipsis).
// The toggle is skipped while the selection inside the cell is non-empty;
// a plain click, and Enter on the toggle, still flip it. Checked in the three
// engines, where selection is real.
import assert from "node:assert/strict";
import { ENGINES, openPage, serveRepo } from "./browser.mjs";

const URL_QUERY = "?f=Tesla&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      const page = await openPage(browser, server.url + URL_QUERY, { viewport: { width: 1200, height: 900 } });
      const cell = page.locator("#incidents-body tr").nth(1).locator("td.narrative-cell");
      const state = () => cell.evaluate(td => ({
        expanded: td.classList.contains("expanded"),
        ariaExpanded: td.querySelector(".narrative-toggle").getAttribute("aria-expanded"),
        selection: String(getSelection()).length,
      }));
      // The incident box is laid out only near the screen (content-visibility,
      // since 2026-10-05), and WebKit gives its rows empty boxes until it is,
      // which Playwright reads as "not visible" and never scrolls to: the DOM
      // scrolls the row in, and a frame lays it out.
      await cell.evaluate(async td => {
        td.scrollIntoView({ block: "center" });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await cell.click();
      const opened = await state();
      // Drag across the expanded narrative's text, as a reader copying it.
      const box = await cell.locator(".narrative-toggle").boundingBox();
      await page.mouse.move(box.x + 3, box.y + 4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 10, box.y + box.height - 6, { steps: 12 });
      await page.mouse.up();
      const dragged = await state();
      // With no selection a plain click still flips it, and so does Enter on
      // the toggle. (A click on the selected text itself first clears the
      // selection in Chromium and WebKit, which collapse it only after the
      // click event, so that click does not toggle; Firefox collapses it on
      // mousedown, and that click does.)
      await page.evaluate(() => getSelection().removeAllRanges());
      await cell.click();
      const clicked = await state();
      await cell.locator(".narrative-toggle").focus();
      await page.keyboard.press("Enter");
      const entered = await state();
      const ok = opened.expanded && opened.ariaExpanded === "true"
        && dragged.expanded && dragged.ariaExpanded === "true" && dragged.selection > 20
        && !clicked.expanded && clicked.ariaExpanded === "false"
        && entered.expanded && entered.ariaExpanded === "true";
      if (!ok) problems.push(`${engineName}: ${JSON.stringify({ opened, dragged, clicked, entered })}`);
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      await page.context().close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit open ${URL_QUERY}, click row 2's narrative open, drag across its text, click it again, then press Enter on its toggle.
Expectata: opened (aria-expanded "true"); still open after the drag, with the text selected; closed by the plain click; open again after Enter.
Resultata: ${problems.join("\n")}`);
console.log("qual pass: selecting text in an expanded narrative keeps it open; clicks and Enter still toggle it, in Chromium, Firefox and WebKit");

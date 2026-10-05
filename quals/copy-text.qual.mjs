// Copied text is what the page shows. Driven in Chromium, Firefox and WebKit,
// because how a selection turns into text is browser behaviour.
//
// Since 2026-10-03 (audit #4) the tooltip targets had held their tips as
// visually hidden text, and the narrative was a block box in its cell, so a
// copied incident row pasted as two lines with the fault reasoning glued to
// its number, and a copied verdict or card line carried its tip ("robustly
// saferZero incidents of this type ..."; audit 2026-10-04 #61). Since
// 2026-10-04 no target holds hidden text (its tip is its accessible name or
// description) and the narrative is an inline box.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const server = await serveRepo();
const TESLA_QUERY = "?f=Tesla&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + TESLA_QUERY, { viewport: { width: 1200, height: 900 } });

  // Drag from the first incident's Company cell to the second's Severity cell.
  // The incident box is laid out only near the screen (content-visibility,
  // since 2026-10-05), and WebKit gives its rows empty boxes until it is, so
  // Playwright's own scroll found nothing to scroll to: the DOM scrolls it in,
  // and a frame lays it out.
  const rows = page.locator("#incidents-body tr");
  await page.evaluate(async () => {
    document.querySelector("#incidents-body tr").scrollIntoView({ block: "center" });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const from = await rows.nth(0).locator("td").nth(0).boundingBox();
  const to = await rows.nth(1).locator("td").nth(6).boundingBox();
  await page.mouse.move(from.x + 2, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height - 5, { steps: 10 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const tips = [...document.querySelectorAll("#incidents-body tr")].slice(0, 2)
      .map(tr => tr.querySelector("td.fault-cell").getAttribute("data-tip").split("\n")[0]);
    const text = getSelection().toString();
    getSelection().removeAllRanges();
    return { text, lines: text.replace(/\n+$/, "").split("\n").length, tipsCopied: tips.filter(t => text.includes(t)) };
  });
  assert.ok(dragged.lines === 2 && dragged.tipsCopied.length === 0 && dragged.text.startsWith("Tesla"),
    `[${engine}] Replicata: in the Tesla-filtered incident browser, drag-select from the first incident's Company cell to
the second's Severity cell and read the selection's text.
Expectata: one line per incident (two lines), and no fault reasoning (the fault cells' tips) in it.
Resultata: ${dragged.lines} lines; tips copied ${JSON.stringify(dragged.tipsCopied)}; text ${JSON.stringify(dragged.text.slice(0, 400))}.`);

  // A prior-only verdict in the Sensitivity analysis, and the cards' lines
  // with tooltips (the Effective-VMT line, a prior-only multiplier, a "[?]"
  // hint), copied whole.
  const copied = await page.evaluate(() => {
    const read = el => { getSelection().selectAllChildren(el); const t = getSelection().toString(); getSelection().removeAllRanges(); return t; };
    const out = [];
    for (const el of document.querySelectorAll("#sanity-checks .stress-badge.prior-only, .mpi-card .mpi-card-vmt[data-tip], .mpi-card-mult.prior-only, .mpi-card-src")) {
      const holder = el.closest("tr, .mpi-card-metric, .mpi-card-vmt");
      const text = read(holder);
      if (text.includes(el.getAttribute("data-tip").trim().slice(0, 40))) out.push(`${el.getAttribute("class")}: ${JSON.stringify(text.slice(0, 120))}`);
    }
    return { checked: document.querySelectorAll("#sanity-checks .stress-badge.prior-only, .mpi-card .mpi-card-vmt[data-tip], .mpi-card-mult.prior-only, .mpi-card-src").length, out };
  });
  assert.ok(copied.checked >= 40 && copied.out.length === 0,
    `[${engine}] Replicata: select and read, whole, each Sensitivity-analysis row with a prior-only verdict and each summary-card
line holding a tooltip target (Effective VMT, a prior-only multiplier, a "[?]" hint).
Expectata: the text is what the page shows; none carries its target's tip.
Resultata: ${copied.checked} checked; ${copied.out.length} carry their tip, e.g. ${JSON.stringify(copied.out.slice(0, 3))}.`);

  assert.deepEqual(page.errors, [], `[${engine}] uncaught page errors: ${JSON.stringify(page.errors)}`);
  await browser.close();
}
await server.close();

console.log("qual pass: copied incident rows, verdicts and card lines hold only what the page shows, in Chromium, Firefox and WebKit");

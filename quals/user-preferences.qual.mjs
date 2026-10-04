// The page honours two display preferences the reader sets in the OS.
//
// Forced colours (Windows contrast themes): the browser repaints backgrounds
// and borders in theme colours but leaves the SVG chart series alone, so the
// legend chips and CI swatches went blank -- six identical empty squares --
// while the curves kept their colours, and the section chevron's transparent
// border sides turned it into a bar (audit #36, until 2026-10-03). Marks
// whose colour is data opt out of the repaint.
//
// Reduced motion: the block that stops the hover lifts and the chevron turn
// lost on specificity to the rules it overrode, so the chevron still turned
// over 150 ms (audit #94, until 2026-10-03).
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, decls, selectors } from "./css-parse.mjs";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const parsed = rules(stripComments(fs.readFileSync("style.css", "utf8")));

// --- 1. Forced colours: data colours opt out of the repaint ---------------

const KEEP = [".month-chip", ".ci-fan-swatch", ".errbar-key", ".fault-bar", ".pm-dot", ".sec-head::before", "th[aria-sort]::after"];
const optOut = parsed.filter(r => r.context.length === 0 && decls(r.body, "forced-color-adjust").includes("none"));
const covered = optOut.flatMap(selectors);
assert.deepEqual(KEEP.filter(sel => !covered.includes(sel)), [],
  `Replicata: grep style.css for forced-color-adjust: none.
Expectata: it covers every mark whose colour carries meaning: ${KEEP.join(", ")}.
Resultata: covered ${JSON.stringify(covered)}.`);

const server = await serveRepo();
const QUERY = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const TRANSPARENT = c => c === "rgba(0, 0, 0, 0)" || c === "transparent";
for (const engine of ["chromium", "firefox"]) {
  const browser = await ENGINES[engine].launch();
  // Most Windows contrast themes are dark, so both schemes are checked.
  for (const colorScheme of ["light", "dark"]) {
    const page = await openPage(browser, server.url + QUERY, { viewport: { width: 1200, height: 900 }, forcedColors: "active", colorScheme });
    const seen = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("#month-legend-mpi-helmers .month-chip")]
        .map(c => ({ inline: c.style.background, computed: getComputedStyle(c).backgroundColor }));
      const swatches = [...document.querySelectorAll(".ci-fan-swatch")].map(s => getComputedStyle(s).backgroundImage);
      const chevron = getComputedStyle(document.querySelector(".sec-head"), "::before");
      document.querySelector("#incidents-head th").click();
      const th = document.querySelector("#incidents-head th[aria-sort]");
      const arrow = getComputedStyle(th, "::after");
      return { forced: matchMedia("(forced-colors: active)").matches, chips, swatches,
        chevronSides: [chevron.borderLeftColor, chevron.borderRightColor],
        sortArrow: { header: getComputedStyle(th).color, drawn: arrow.borderBottomColor, sides: [arrow.borderLeftColor, arrow.borderRightColor] } };
    });
    // Inline colours read back in rgb() notation, as computed colours do.
    const lostChips = seen.chips.filter(c => c.computed !== c.inline);
    assert.ok(seen.forced && seen.chips.length === 6 && lostChips.length === 0 &&
      seen.swatches.every(s => s.startsWith("linear-gradient")) &&
      seen.chevronSides.every(TRANSPARENT),
      `[${engine}, ${colorScheme}] Replicata: open the default view with forced colours active (a Windows contrast theme).
Expectata: each helmer legend chip keeps its series colour, the CI-fan swatches keep their gradients, and the
section chevron's side borders stay transparent (a triangle, not a bar).
Resultata: ${JSON.stringify(seen)}.`);
    // The sort arrow is drawn in currentColor: it must stay a triangle and
    // take the header's (forced) text colour. Under "none" Chromium kept the
    // page's #333 ink, which all but vanished on a dark theme's black canvas
    // (1.7:1; found in review, 2026-10-03).
    assert.ok(seen.sortArrow.drawn === seen.sortArrow.header && seen.sortArrow.sides.every(TRANSPARENT),
      `[${engine}, ${colorScheme}] Replicata: with forced colours active, sort the incident table by a column and read its sort arrow.
Expectata: the arrow is drawn in the header's text colour, with transparent sides (a triangle, not a bar).
Resultata: ${JSON.stringify(seen.sortArrow)}.`);
    assert.deepEqual(page.errors, [], `[${engine}, ${colorScheme}] uncaught page errors: ${JSON.stringify(page.errors)}`);
    await page.context().close();
  }
  await browser.close();
}

// --- 2. Reduced motion: every transition is instantaneous -----------------

for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + QUERY, { viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const moving = await page.evaluate(() => {
    const probes = [
      ["section chevron", getComputedStyle(document.querySelector(".sec-head"), "::before")],
      ["link", getComputedStyle(document.querySelector(".abstract a"))],
      ["filter button", getComputedStyle(document.querySelector("#filters button"))],
      ["refresh button", getComputedStyle(document.querySelector(".pm-refresh"))],
    ];
    return { reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
      moving: probes.filter(([, cs]) => cs.transitionDuration.split(",").some(d => parseFloat(d) !== 0))
        .map(([name, cs]) => `${name}: ${cs.transitionDuration}`) };
  });
  assert.ok(moving.reduce && moving.moving.length === 0,
    `[${engine}] Replicata: open the default view with prefers-reduced-motion: reduce and read computed transitions.
Expectata: every transition-duration is 0s (the chevron no longer turns, links and buttons no longer ease).
Resultata: ${JSON.stringify(moving)}.`);
  await browser.close();
}
await server.close();

console.log("qual pass: forced colours keep the data colours of legends and marks, and reduced motion stops every transition");

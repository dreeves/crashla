// An uncaught error shows itself (2026-10-30 audit, critic-1): the page's
// asserts fail loudly by throwing (rules 9 and 12), but until 2026-10-31 a
// throw at init or in a redraw left a silently half-drawn page. When a deploy
// paired the current crashla.js with the previous release's data/vmt.js (one
// file from a cache, one fresh), init threw "GHOST_VMT_CSV_TEXT is not
// defined" and the page drew no chart, card or incident row, the markets
// stayed at "Loading...", and nothing said that anything had failed. Spec:
// one handler, for window "error" and "unhandledrejection" events, shows the
// page's banner (#url-banner) with the error's message after a lead-in
// (PAGE_ERROR_LEAD, the app's; its words start in Latin with a to-do recap,
// rule 7, and are not pinned here). Checked in Chromium, Firefox and WebKit:
//  - a data/vmt.js without GHOST_VMT_CSV_TEXT (the skew above): the banner
//    shows the lead-in and the message, which names the missing variable,
//    and its button dismisses it;
//  - on a page that drew, an error thrown from a timer, then an unhandled
//    promise rejection: the banner shows each one's message in turn, and its
//    button dismisses it;
//  - a page that drew with no error keeps the banner hidden;
//  - a data/vmt.js from a release that moved Waymo's first knot (since
//    2026-11-03): the cumulative band of Waymo's first fully knotted month
//    widened at its top to the running sum of the monthly bands, so that month
//    is no longer knotted while crashla.js's PRE_SERIES_OFFSET still names it;
//    init stops at checkPreSeriesOffsets, and the banner shows its message,
//    which names Waymo, the month the data gives and the constant's, and its
//    button dismisses it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const skewedVmt = fs.readFileSync("data/vmt.js", "utf8").replace(/const GHOST_VMT_CSV_TEXT\b/, "const GHOST_VMT_CSV_TEXT_NOT_IN_THIS_RELEASE");
assert.ok(skewedVmt !== fs.readFileSync("data/vmt.js", "utf8"), "data/vmt.js declares GHOST_VMT_CSV_TEXT (the qual's skew removes it)");
// The moved knot: Waymo's analysis rows (VMT_CSV_TEXT, before the ghost
// segment), the first fully knotted month found as checkPreSeriesOffsets and
// window-band.qual find it (the month after the last whose cumulative band is
// not strictly inside the running sums of the monthly bands), and that month's
// kyoom_max set to its running sum, which makes the next month the first.
const vmtJs = fs.readFileSync("data/vmt.js", "utf8");
const waymoRows = vmtJs.slice(0, vmtJs.indexOf("const GHOST_VMT_CSV_TEXT")).split("\n").filter(l => l.startsWith("waymo,"))
  .map(line => { const p = line.split(","); return { line, month: p[1], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7] }; })
  .sort((a, b) => (a.month < b.month ? -1 : 1));
let runLo = 0, runHi = 0, lastLoose = -1;
waymoRows.forEach((r, i) => { runLo += r.vmin; runHi += r.vmax; r.runHi = runHi; if (!(r.kmin > runLo && r.kmax < runHi)) lastLoose = i; });
const knot = waymoRows[lastLoose + 1], nextKnot = waymoRows[lastLoose + 2];
assert.ok(knot !== undefined && nextKnot !== undefined, "data/vmt.js holds Waymo rows with a first fully knotted month and a month after it");
const movedKnotVmt = vmtJs.replace(knot.line, knot.line.split(",").map((f, i) => (i === 5 ? String(knot.runHi) : f)).join(","));
assert.ok(movedKnotVmt !== vmtJs, "the qual's moved knot changes data/vmt.js");

const banner = () => {
  const b = document.getElementById("url-banner");
  const e = b.querySelector(".banner-error");
  return { shown: getComputedStyle(b).display !== "none", errorShown: e !== null && getComputedStyle(e).display !== "none",
    error: e === null ? null : e.textContent, lead: typeof PAGE_ERROR_LEAD === "string" ? PAGE_ERROR_LEAD : null };
};
const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      // --- the skewed deploy -------------------------------------------------
      {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        await ctx.route(/\/data\/vmt\.js$/, route => route.fulfill({ status: 200, contentType: "text/javascript", body: skewedVmt }));
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", err => errors.push(err.message));
        await page.goto(server.url + DEF, { waitUntil: "load" });
        await page.waitForTimeout(500);
        const b = await page.evaluate(banner);
        if (!(errors.length > 0 && b.shown && b.errorShown && b.lead !== null && b.lead.trim() !== "" &&
              b.error.startsWith(b.lead) && b.error.includes("GHOST_VMT_CSV_TEXT")))
          problems.push(`${engineName}, data/vmt.js without GHOST_VMT_CSV_TEXT: page errors ${JSON.stringify(errors)}; banner ${JSON.stringify(b)}`);
        // The button works even though init stopped early (until 2026-11-01
        // its handler was wired late in init, so a skewed deploy's banner
        // could not be dismissed).
        await page.evaluate(() => document.getElementById("url-banner-dismiss").click());
        if ((await page.evaluate(banner)).shown) problems.push(`${engineName}, data/vmt.js without GHOST_VMT_CSV_TEXT: the banner's button does not dismiss the error banner`);
        await ctx.close();
      }
      // --- a release that moved Waymo's first knot ---------------------------
      {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        await ctx.route(/\/data\/vmt\.js$/, route => route.fulfill({ status: 200, contentType: "text/javascript", body: movedKnotVmt }));
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", err => errors.push(err.message));
        await page.goto(server.url + DEF, { waitUntil: "load" });
        await page.waitForTimeout(500);
        const b = await page.evaluate(banner);
        const names = [`"helmer":"Waymo"`, `"expected":"${nextKnot.month}"`, `"found":"${knot.month}"`];
        if (!(errors.length > 0 && b.shown && b.errorShown && b.lead !== null && b.error.startsWith(b.lead) &&
              names.every(n => b.error.includes(n))))
          problems.push(`${engineName}, data/vmt.js with Waymo's ${knot.month} band top widened to ${knot.runHi}: page errors ${JSON.stringify(errors)}; banner ${JSON.stringify(b)}; want the banner naming ${names.join(", ")}`);
        await page.evaluate(() => document.getElementById("url-banner-dismiss").click());
        if ((await page.evaluate(banner)).shown) problems.push(`${engineName}, data/vmt.js with Waymo's ${knot.month} band top widened: the banner's button does not dismiss the error banner`);
        await ctx.close();
      }
      // --- errors on a page that drew -------------------------------------
      {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        const page = await ctx.newPage();
        page.on("pageerror", () => {});
        await page.goto(server.url + DEF, { waitUntil: "load" });
        await page.waitForFunction(drawnAll, null, { timeout: 30000 });
        await page.waitForTimeout(300);
        const clean = await page.evaluate(banner);
        if (clean.shown || clean.errorShown) problems.push(`${engineName}: a page that drew with no error shows the banner ${JSON.stringify(clean)}`);
        for (const [what, raise, word] of [
          ["an error thrown from a timer", () => { setTimeout(() => { throw new Error("probe-thrown-from-a-timer"); }); }, "probe-thrown-from-a-timer"],
          ["an unhandled rejection", () => { Promise.reject(new Error("probe-unhandled-rejection")); }, "probe-unhandled-rejection"],
        ]) {
          await page.evaluate(raise);
          await page.waitForTimeout(300);
          const b = await page.evaluate(banner);
          if (!(b.shown && b.errorShown && b.lead !== null && b.error.startsWith(b.lead) && b.error.includes(word)))
            problems.push(`${engineName}, ${what}: banner ${JSON.stringify(b)}`);
        }
        await page.evaluate(() => document.getElementById("url-banner-dismiss").click());
        const dismissed = await page.evaluate(banner);
        if (dismissed.shown) problems.push(`${engineName}: the banner's button does not dismiss the error banner`);
        await ctx.close();
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
  `Replicata: in Chromium, Firefox and WebKit, load the default view with data/vmt.js served without GHOST_VMT_CSV_TEXT (a deploy pairing this crashla.js with the previous release's data), and with Waymo's first fully knotted month's band top widened to its running sum (a release that moved the knot); then load it whole, throw an error from a timer, reject a promise unhandled, and press the banner's button.
Expectata: the banner (#url-banner) shows PAGE_ERROR_LEAD and the error's message (naming GHOST_VMT_CSV_TEXT; for the moved knot checkPreSeriesOffsets's, naming Waymo, the month the data gives and PRE_SERIES_OFFSET's; then each probe's message), stays hidden on a page that drew with no error, and its button dismisses it.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: an uncaught error or unhandled rejection, at init or after it, shows the page's banner with its message, in three engines");

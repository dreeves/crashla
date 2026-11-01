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
//    shows the lead-in and the message, which names the missing variable;
//  - on a page that drew, an error thrown from a timer, then an unhandled
//    promise rejection: the banner shows each one's message in turn, and its
//    button dismisses it;
//  - a page that drew with no error keeps the banner hidden.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const skewedVmt = fs.readFileSync("data/vmt.js", "utf8").replace(/const GHOST_VMT_CSV_TEXT\b/, "const GHOST_VMT_CSV_TEXT_NOT_IN_THIS_RELEASE");
assert.ok(skewedVmt !== fs.readFileSync("data/vmt.js", "utf8"), "data/vmt.js declares GHOST_VMT_CSV_TEXT (the qual's skew removes it)");

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
  `Replicata: in Chromium, Firefox and WebKit, load the default view with data/vmt.js served without GHOST_VMT_CSV_TEXT (a deploy pairing this crashla.js with the previous release's data); then load it whole, throw an error from a timer, reject a promise unhandled, and press the banner's button.
Expectata: the banner (#url-banner) shows PAGE_ERROR_LEAD and the error's message (naming GHOST_VMT_CSV_TEXT; then each probe's message), stays hidden on a page that drew with no error, and its button dismisses it.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: an uncaught error or unhandled rejection, at init or after it, shows the page's banner with its message, in three engines");

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
//    button dismisses it;
//  - a crashla.js whose PRE_SERIES_OFFSET gives Waymo a range of NaN (since
//    2026-11-04, when the range assert began naming the range's type; it has
//    named the line and the range since 2026-11-03): init stops at the range
//    assert, and the banner shows its message, which names Waymo, the range
//    as String() writes it and its type, and its button dismisses it.
//  - a data/vmt.js whose first analysis row's rationale holds a link with its
//    target left open, and one whose first ghost row's rationale holds a link
//    whose anchor is in capitals (since 2026-11-05, when the rationales'
//    section pointers became links, "[<text>](data/#<anchor>)"): init stops
//    where parseVmtCsv or parseGhostVmtCsv reads the rationale, and the
//    banner shows the link assert's message, whose details name the row's
//    line, 2, and its rationale, and its button dismisses it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";
import { parseCsv } from "./csv-parse.mjs";

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
// The malformed entry: Waymo's range in PRE_SERIES_OFFSET set to NaN by a
// statement served just before crashla.js's init block, at its one
// "// --- Init ---" line (where quals/load-app.mjs splits the app too), so the
// constant's layout does not matter (first written on 2026-11-04 as a regex on
// the literal's Waymo line, which a comment before that line, an entry over
// two lines or a range written 110_000 would have broken).
const appJs = fs.readFileSync("crashla.js", "utf8");
const INIT = "\n// --- Init ---\n";
assert.ok(appJs.split(INIT).length === 2,
  `Replicata: find crashla.js's init block, before which the qual serves Waymo's PRE_SERIES_OFFSET range set to NaN.
Expectata: one "// --- Init ---" line, the one quals/load-app.mjs splits the app at.
Resultata: ${appJs.split(INIT).length - 1} such lines.`);
const nanRangeApp = appJs.replace(INIT, `\nPRE_SERIES_OFFSET.Waymo.range = NaN;${INIT}`);
// The malformed links: the first row of each CSV segment (the line after its
// header, inside the segment's template literal), its rationale (its last
// field, read as CSV, quoted or not) given a link of the wrong form at its
// end, and the row written back with that field double-quoted; its other
// fields hold no comma, quote or line break, so they need no quotes.
const firstRow = segment => {
  assert.ok(vmtJs.split(`const ${segment} =`).length === 2,
    `Replicata: find ${segment}'s declaration in data/vmt.js. Expectata: one "const ${segment} =". Resultata: ${vmtJs.split(`const ${segment} =`).length - 1}.`);
  const at = vmtJs.indexOf("`", vmtJs.indexOf(`const ${segment} =`)) + 1;
  return vmtJs.slice(at, vmtJs.indexOf("`", at)).split("\n")[1];
};
const badLink = (segment, link) => {
  const row = firstRow(segment), fields = parseCsv(row)[0];
  assert.ok(vmtJs.split(row).length === 2 && fields.length > 1 && fields.slice(0, -1).every(f => !/[",\n]/.test(f)),
    `Replicata: read the first row of data/vmt.js's ${segment}. Expectata: a row once in the file, its fields but the rationale (its last) free of commas, quotes and line breaks. Resultata: ${JSON.stringify(row.slice(0, 80))}.`);
  const rationale = fields[fields.length - 1] + link;
  return vmtJs.replace(row, () => [...fields.slice(0, -1), `"${rationale.replace(/"/g, '""')}"`].join(","));
};
const openTargetVmt = badLink("VMT_CSV_TEXT", " ([data/README.md, Ghost months](data/#ghost-months");
const capitalAnchorVmt = badLink("GHOST_VMT_CSV_TEXT", " [data/README.md, Ghost months](data/#Ghost-Months).");

const banner = () => {
  const b = document.getElementById("url-banner");
  const e = b.querySelector(".banner-error");
  return { shown: getComputedStyle(b).display !== "none", errorShown: e !== null && getComputedStyle(e).display !== "none",
    error: e === null ? null : e.textContent, lead: typeof PAGE_ERROR_LEAD === "string" ? PAGE_ERROR_LEAD : null };
};
const server = await serveRepo();
const problems = [];
// A load that init stops: the default view with one file served changed. The
// banner must show the lead-in and a message naming each of `names`, and its
// button must dismiss it, which works even though init stopped early (until
// 2026-11-01 its handler was wired late in init, so a skewed deploy's banner
// could not be dismissed).
const stoppedLoad = async (browser, engineName, what, file, body, names) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
  await ctx.route(file, route => route.fulfill({ status: 200, contentType: "text/javascript", body }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto(server.url + DEF, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const b = await page.evaluate(banner);
  if (!(errors.length > 0 && b.shown && b.errorShown && b.lead !== null && b.lead.trim() !== "" &&
        b.error.startsWith(b.lead) && names.every(n => b.error.includes(n))))
    problems.push(`${engineName}, ${what}: page errors ${JSON.stringify(errors)}; banner ${JSON.stringify(b)}; want the banner naming ${names.join(", ")}`);
  await page.evaluate(() => document.getElementById("url-banner-dismiss").click());
  if ((await page.evaluate(banner)).shown) problems.push(`${engineName}, ${what}: the banner's button does not dismiss the error banner`);
  await ctx.close();
};
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      // --- the skewed deploy -------------------------------------------------
      await stoppedLoad(browser, engineName, "data/vmt.js without GHOST_VMT_CSV_TEXT", /\/data\/vmt\.js$/, skewedVmt,
        ["GHOST_VMT_CSV_TEXT"]);
      // --- a release that moved Waymo's first knot ---------------------------
      await stoppedLoad(browser, engineName, `data/vmt.js with Waymo's ${knot.month} band top widened to ${knot.runHi}`,
        /\/data\/vmt\.js$/, movedKnotVmt, [`"helmer":"Waymo"`, `"expected":"${nextKnot.month}"`, `"found":"${knot.month}"`]);
      // --- a malformed PRE_SERIES_OFFSET entry --------------------------------
      await stoppedLoad(browser, engineName, "crashla.js with Waymo's PRE_SERIES_OFFSET range NaN",
        /\/crashla\.js$/, nanRangeApp, [`"helmer":"Waymo"`, `"range":"NaN"`, `"type":"number"`]);
      // --- a rationale's link of the wrong form -----------------------------
      // Each of the details' keys is read on its own, in any order (until
      // 2026-11-07 one fragment, '{"lineNo":2,"rationale":"', also pinned
      // their order, so a correct reordering of the details was red).
      await stoppedLoad(browser, engineName, "data/vmt.js whose first analysis rationale holds a link with its target left open",
        /\/data\/vmt\.js$/, openTargetVmt, ['"lineNo":2', '"rationale":"']);
      await stoppedLoad(browser, engineName, "data/vmt.js whose first ghost rationale holds a link whose anchor is in capitals",
        /\/data\/vmt\.js$/, capitalAnchorVmt, ['"lineNo":2', '"rationale":"']);
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
  `Replicata: in Chromium, Firefox and WebKit, load the default view with data/vmt.js served without GHOST_VMT_CSV_TEXT (a deploy pairing this crashla.js with the previous release's data), with Waymo's first fully knotted month's band top widened to its running sum (a release that moved the knot), with crashla.js served with Waymo's PRE_SERIES_OFFSET range set to NaN, and with data/vmt.js's first analysis rationale given a link whose target is left open and its first ghost rationale a link whose anchor is in capitals; then load it whole, throw an error from a timer, reject a promise unhandled, and press the banner's button.
Expectata: the banner (#url-banner) shows PAGE_ERROR_LEAD and the error's message (naming GHOST_VMT_CSV_TEXT; for the moved knot checkPreSeriesOffsets's, naming Waymo, the month the data gives and PRE_SERIES_OFFSET's; for the NaN range its range assert's, naming Waymo, "NaN" and the type "number"; for each malformed link the link assert's, its details naming line 2 and the rationale; then each probe's message), stays hidden on a page that drew with no error, and its button dismisses it.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: an uncaught error or unhandled rejection, at init or after it, shows the page's banner with its message, in three engines");

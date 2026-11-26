// The browser quals' waits on a page have one limit, WAIT_LIMIT_MS in
// quals/browser.mjs, set at the lower bound of what the human's laptop,
// overloaded, is known to need, and raised a step each time a qual times out
// there for that reason (the human, 2026-11-24: "just set it to a lower bound
// on what we know it needs to be to pass on my overloaded laptop. then we just
// bump it up each time we need to and it never ends up much above the high
// water mark"; until then a page's later waits had 20 times its first load,
// and at least 30 s).
//
//   1. The limit is a finite number of milliseconds, room above Playwright's
//      default (30 s, which waits in quals/scroll-restore.qual.mjs outran on
//      the overloaded laptop) for section 2's wait.
//   2. A page opened with openPage has the limit in force: a wait longer than
//      30 s (and shorter than the limit) completes, as a reload then does.
//   3. A page whose script throws as it loads: loadPage rejects at once,
//      naming the error, rather than waiting out the limit for views that are
//      never drawn.
//   4. A window with no incidents (d=2021-07.2021-07, a month of Waymo's
//      miles before its first incident) loads as any other does: loadPage
//      waits for the views drawn (drawnAll), not for an incident row, which
//      such a window never draws (until 2026-11-24 it waited for a row, so
//      such a page never finished loading).
//
// Chromium only: the limit is Playwright's, the same in every engine.
// Replicata/Expectata/Resultata are in each assertion's message.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, openPage, loadPage, WAIT_LIMIT_MS } from "./browser.mjs";

const DEFAULT_MS = 30000;
// Section 2's wait: past Playwright's default, with room under the limit for
// the wait's own polling on a loaded machine.
const WAIT_MS = DEFAULT_MS + 5000;
const ROOM_MS = 10000;
const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const EMPTY_WINDOW = "&d=2021-07.2021-07";

// --- 1. The limit -----------------------------------------------------------------
assert.ok(Number.isFinite(WAIT_LIMIT_MS) && WAIT_LIMIT_MS >= WAIT_MS + ROOM_MS,
  `Replicata: read WAIT_LIMIT_MS from quals/browser.mjs.
Expectata: a finite number of milliseconds, at least ${WAIT_MS + ROOM_MS} (Playwright's default, ${DEFAULT_MS} ms, which the overloaded laptop's waits outran, plus room for a ${WAIT_MS} ms wait).
Resultata: ${WAIT_LIMIT_MS}.`);

const server = await serveRepo();
const browser = await ENGINES.chromium.launch();
try {
  // --- 2. openPage's pages have the limit in force ------------------------------
  {
    const page = await openPage(browser, server.url + DEF);
    let waited = null;
    try {
      await page.waitForFunction(until => Date.now() >= until, Date.now() + WAIT_MS, { polling: 1000 });
      waited = "done";
    } catch (e) { waited = String(e).split("\n")[0]; }
    // And a reload, the kind of step that outran 30 s in scroll-restore.
    let reloaded = null;
    try {
      await Promise.all([page.waitForEvent("load"), page.evaluate(() => location.reload())]);
      reloaded = "done";
    } catch (e) { reloaded = String(e).split("\n")[0]; }
    assert.deepEqual([waited, reloaded, page.errors], ["done", "done", []],
      `Replicata: open the page with quals/browser.mjs's openPage, wait ${WAIT_MS} ms on it with its default limit, then reload it and wait for its load event.
Expectata: both complete within WAIT_LIMIT_MS, ${WAIT_LIMIT_MS} ms (Playwright's own default, ${DEFAULT_MS} ms, would stop the first), with no page error.
Resultata: the wait ${waited}; the reload ${reloaded}; page errors ${JSON.stringify(page.errors)}.`);
    await page.context().close();
  }

  // --- 3. A page that throws as it loads: loadPage stops at once ---------------
  {
    const context = await browser.newContext();
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
    const thrown = "browser-waits: thrown on purpose";
    await context.route(/\/crashla\.js(?:\?|$)/, route => route.fulfill({ contentType: "text/javascript", body: `throw new Error(${JSON.stringify(thrown)});\n` + fs.readFileSync("crashla.js", "utf8") }));
    const page = await context.newPage();
    const started = Date.now();
    const outcome = await loadPage(page, server.url + DEF).then(() => "loaded", e => String(e));
    const took = Date.now() - started;
    assert.ok(outcome.includes(thrown) && took < WAIT_LIMIT_MS,
      `Replicata: load the page, its crashla.js throwing "${thrown}" first, with quals/browser.mjs's loadPage.
Expectata: loadPage rejects, naming the page error, before WAIT_LIMIT_MS (${WAIT_LIMIT_MS} ms) runs out, instead of waiting for views that are never drawn.
Resultata: ${outcome} (after ${took} ms).`);
    await context.close();
  }

  // --- 4. A window with no incidents loads ------------------------------------------
  {
    const got = await openPage(browser, server.url + DEF + EMPTY_WINDOW).then(page => ({ page }), err => ({ outcome: String(err).split("\n")[0] }));
    const seen = got.page === undefined ? null : await got.page.evaluate(() => ({
      rows: document.querySelectorAll("#incidents-body tr").length,
      heading: document.getElementById("incident-browser-heading").textContent,
    }));
    assert.ok(seen !== null && seen.rows === 0 && seen.heading.includes("2021-07") && got.page.errors.length === 0,
      `Replicata: open the page on a window with no incidents (${DEF + EMPTY_WINDOW}) with quals/browser.mjs's openPage.
Expectata: it loads as the default page does, drawing no incident row and a heading that names 2021-07, with no page error.
Resultata: ${seen === null ? got.outcome : `${seen.rows} incident rows; heading ${JSON.stringify(seen.heading)}; page errors ${JSON.stringify(got.page.errors)}`}.`);
    await got.page.context().close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`qual pass: a wait on a page may take WAIT_LIMIT_MS, ${WAIT_LIMIT_MS / 1000} s (a ${WAIT_MS / 1000} s wait and a reload completed), a page that throws as it loads stops loadPage at once, and a window with no incidents loads`);

// Shared helper for the quals that drive a real browser: a static server for
// the repo and Playwright's three engines. Keyboard focus, tap-to-click and
// the accessibility tree are browser behaviour that a DOM stub cannot model,
// so these quals load index.html for real.
//
// Needs playwright-core in node_modules and its browsers in Playwright's cache
// (npm install --no-save playwright-core && npx playwright-core install
// chromium firefox webkit). Without them the import below throws: a qual that
// cannot run fails rather than passing unchecked.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, devices } from "../node_modules/playwright-core/index.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif",
  ".webmanifest": "application/manifest+json",
};

export const ENGINES = { chromium, firefox, webkit };
export { devices };

// Serves the repo on a free localhost port. The query string is dropped
// before "/" maps to index.html (the page reads it from location, not the
// server).
export function serveRepo() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(done => server.close(done)),
  })));
}

// A page on `url` in a fresh context. Requests that leave localhost (the
// prediction-market refresh) are answered with a network error after
// `offlineDelayMs`, so a qual never depends on the network and the refresh
// still runs its failure path. Uncaught page errors are collected in
// page.errors for the caller to assert on.
export async function openPage(browser, url, contextOptions = {}, offlineDelayMs = 0) {
  const context = await browser.newContext(contextOptions);
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, async route => {
    await new Promise(resolve => setTimeout(resolve, offlineDelayMs));
    await route.abort("internetdisconnected");
  });
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", err => page.errors.push(err.message));
  await loadPage(page, url);
  return page;
}

// The longest any wait on a page loaded here may take (a load, a reload or a
// return through the history, a view drawn, a click), in place of
// Playwright's default, 30 s: set at the lower bound of what the human's
// laptop, overloaded, is known to need, and raised a step each time a qual
// times out there for that reason (the human, 2026-11-24: "can you find a way
// to make that qual robuster and work regardless of how slow my laptop is?",
// then "just set it to a lower bound on what we know it needs to be to pass on
// my overloaded laptop. then we just bump it up each time we need to and it
// never ends up much above the high water mark"). Known: waits in
// quals/scroll-restore.qual.mjs outran 30 s on 2026-11-20, -21 and -23 (two
// of them navigations; the load average at 150-250 on the last two; on
// 2026-11-24 the laptop's swap held 33 GB against 16 GB of memory). A wait
// cut off by its limit does not show how long it needed, so each step doubles
// the limit, which then stays within twice the longest wait the laptop has
// needed: 60 s is the first step above 30 s. quals/browser-waits.qual.mjs
// holds it.
export const WAIT_LIMIT_MS = 60000;

// Loads `url` in `page` and waits for every view the page draws at load,
// each wait on the page then and later limited to WAIT_LIMIT_MS. A page error
// during the load stops it at once, naming the error, rather than when the
// limit runs out.
export async function loadPage(page, url) {
  page.setDefaultTimeout(WAIT_LIMIT_MS);
  page.setDefaultNavigationTimeout(WAIT_LIMIT_MS);
  let onError;
  const failed = new Promise((_, reject) => {
    onError = err => reject(new Error(`a page error during the first load of ${url}: ${err.message}`));
    page.on("pageerror", onError);
  });
  failed.catch(() => {});  // one after the load is the caller's (page.errors)
  try {
    await Promise.race([failed, (async () => {
      await page.goto(url, { waitUntil: "load" });
      // The page draws every view at load (drawnAll, which holds in a window
      // with no incidents too: until 2026-11-24 this waited for an incident
      // row, which such a window never draws); the market refresh, which
      // marks its button busy in the same task, then settles once its
      // (refused) requests come back.
      await page.waitForFunction(drawnAll);
      await page.waitForFunction(() => document.querySelector(".pm-refresh") !== null &&
        document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
    })()]);
  } finally {
    page.off("pageerror", onError);
  }
}

// Whether the page has drawn the views below its charts (the incident
// browser's heading names the window's months, YYYY-MM, once it is built,
// also in a window with no incidents; index.html's heading names none): for
// quals that open pages themselves. The page builds them at load; on
// 2026-10-05 it built them in tasks after its first frame. Until 2026-10-31
// this waited for the heading's words (" using data from "), which are the
// human's, so a rewording timed every waiting qual out (audit 2026-10-30,
// QT-09).
export const drawnAll = () => /\d{4}-\d{2}/.test(document.getElementById("incident-browser-heading").textContent) &&
  document.querySelector("#sanity-checks h3") !== null &&
  document.querySelector("#chart-fleet-forecast svg") !== null;

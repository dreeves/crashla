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
  await page.goto(url, { waitUntil: "load" });
  // The page draws everything synchronously at load; the market refresh then
  // settles once its (refused) requests come back.
  await page.waitForFunction(() => document.querySelectorAll("#incidents-body tr").length > 0 &&
    document.querySelector(".pm-refresh") !== null &&
    document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
  return page;
}

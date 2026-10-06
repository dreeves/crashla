// A reload, and a return through the history, put the reader back where they
// were, in Chromium, Firefox and WebKit, on a desktop and on phones: once the
// page has built every view again, a section the reader had scrolled to the
// top of the window, past the incident box, is at the top again (or the page
// is scrolled as far as it goes). The browser restores that place itself
// (history.scrollRestoration "auto"); Firefox and WebKit restore it while the
// page loads and not after.
//  - On 2026-10-05 (audit #25) the page built the incident table, the sanity
//    section and the growth charts after its first frame, after the load, so
//    in Firefox and WebKit a reload or a return put the reader where the
//    shorter page could take them: up to ~29,000 px short of the growth
//    section and ~650 px short of the sanity section, and in WebKit 56-119 px
//    past the markets heading (until the second review of 2026-10-05, for
//    reloads and returns; the page builds every view at load since).
//  - The incident box is laid out only near the screen (content-visibility)
//    and is 80vh until it is first drawn: right for a box its rows fill to
//    its 80vh cap, which comes back exactly; a short table's box, drawn at
//    its own height while the reader scrolled past it, comes back undrawn at
//    80vh, so a section below it is allowed to come back off by the room its
//    rows leave in the box (80vh minus its drawn height; for two rows 546 px
//    in WebKit at 1200x900, 475 px on a Pixel 7, 336 px on an iPhone 14, and
//    none in Chromium at 1200x900 or in Firefox), and not otherwise
//    (accepted by the human on 2026-10-05, over laying a short table's box
//    out always, which made some filter clicks slower; load-order.qual).
//    That offset is allowed, not required.
// A fresh load starts at the top (or at its fragment: fragment-landing.qual)
// and is not checked here. The reload is the page's own location.reload()
// and the return history.back() from another page of the site: Playwright's
// reload in Firefox is a fresh navigation (navigation type "navigate"),
// which starts at the top.
import assert from "node:assert/strict";
import { ENGINES, devices, serveRepo, openPage, drawnAll } from "./browser.mjs";

// The default view (the incident box full: its 80vh cap) and a short table
// (Tesla's incidents of May 2026, two rows: the box shorter than its cap).
const PAGES = {
  default: { query: "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault", short: false,
    sections: ["#sec-browser", "#sec-markets", "#sec-sanity", "#sec-fleet"] },
  short: { query: "?f=Tesla&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault&d=2026-05.2026-05", short: true,
    sections: ["#sec-markets", "#sec-sanity", "#sec-fleet"] },
};
const CONFIGS = {
  chromium: [["1200x900", { viewport: { width: 1200, height: 900 } }], ["Pixel 7", devices["Pixel 7"]]],
  firefox: [["1200x900", { viewport: { width: 1200, height: 900 } }], ["412x915", { viewport: { width: 412, height: 915 } }]],
  webkit: [["1200x900", { viewport: { width: 1200, height: 900 } }], ["iPhone 14", devices["iPhone 14"]]],
};
// Each way leaves the page and comes back to it, and names the navigation
// type the page then reads (a document kept in the back/forward cache would
// still read the first load's "navigate", and would test nothing here).
const WAYS = {
  "location.reload()": {
    type: "reload",
    go: async page => { await Promise.all([page.waitForEvent("load"), page.evaluate(() => location.reload())]); },
  },
  "history.back()": {
    type: "back_forward",
    go: async (page, server) => {
      await page.goto(server.url + "favicon.svg", { waitUntil: "load" });
      await Promise.all([page.waitForEvent("load"), page.evaluate(() => history.back())]);
    },
  },
};
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));

const server = await serveRepo();
const problems = [];
const results = [];
try {
  for (const [engineName, configs] of Object.entries(CONFIGS)) {
    const browser = await ENGINES[engineName].launch();
    try {
      for (const [what, options] of configs) {
        for (const [pageName, { query, short, sections }] of Object.entries(PAGES)) {
          const page = await openPage(browser, server.url + query, options);
          for (const [way, { type, go }] of Object.entries(WAYS)) {
            for (const sel of sections) {
              // The reader scrolls down past the incident box (on screen, so
              // drawn) to the section, and leaves. The box is drawn once its
              // rows are no longer skipped: Chromium draws it as it scrolls
              // in, WebKit in the second frame after, Firefox in the third.
              const left = await page.evaluate(async sel => {
                const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const box = document.querySelector(".table-scroll");
                box.scrollIntoView({ block: "center" });
                const row = document.querySelector("#incidents-body tr");
                for (let i = 0; !row.checkVisibility({ contentVisibilityAuto: true }); i++) {
                  if (i === 30) throw new Error("the incident box was not drawn within 30 frames of being scrolled into view");
                  await new Promise(r => requestAnimationFrame(r));
                }
                await frame();
                const boxHeight = box.getBoundingClientRect().height;
                document.querySelector(sel).scrollIntoView();
                await frame();
                window.__left = true;  // gone once the page is loaded again
                return { scrollY: document.scrollingElement.scrollTop, href: location.href, boxHeight, cap: 0.8 * innerHeight };
              }, sel);
              const where = `${engineName} ${what} ${pageName} ${way} at ${sel}`;
              if (left.boxHeight < left.cap - 1 !== short) problems.push(`${where}: the incident box was drawn ${Math.round(left.boxHeight)} px tall (its cap ${Math.round(left.cap)} px), not ${short ? "shorter than" : "at"} its cap: this page no longer tests ${short ? "a short" : "a full"} box`);
              await go(page, server);
              await page.waitForFunction(drawnAll);
              await settle(page);
              const at = await page.evaluate(sel => {
                const se = document.scrollingElement;
                const top = document.querySelector(sel).getBoundingClientRect().top;
                return { top, scrollY: se.scrollTop, want: Math.min(top + se.scrollTop, se.scrollHeight - se.clientHeight),
                  type: performance.getEntriesByType("navigation")[0].type, kept: window.__left === true, href: location.href };
              }, sel);
              results.push(`${where}: top ${Math.round(at.top)}, scrollY ${Math.round(left.scrollY)} -> ${Math.round(at.scrollY)} (want ${Math.round(at.want)}), ${at.type}`);
              if (at.type !== type || at.kept) problems.push(`${where}: the page came back as navigation type ${JSON.stringify(at.type)}${at.kept ? ", the same document (back/forward cache)" : ""}, not as a ${JSON.stringify(type)} load of a new document, so the check did not run`);
              // How far below the window's top the section came back, and the
              // most it may: none with a full box, the room a short table's
              // rows leave in its box with a short one.
              const off = at.want - at.scrollY;
              const room = short ? left.cap - left.boxHeight : 0;
              if (!(off >= -1 && off <= room + 1)) problems.push(`${where}: the section's top is ${Math.round(at.top)} px below the window's top, scrolled to ${Math.round(at.scrollY)} px (left at ${Math.round(left.scrollY)} px) where ${Math.round(at.want)} px puts it at the top${short ? ` (allowed: up to ${Math.round(room)} px below it, the room the table's rows leave in its ${Math.round(left.cap)} px box)` : ""}`);
              if (at.href !== left.href) problems.push(`${where}: the address changed from ${left.href} to ${at.href}`);
            }
          }
          if (page.errors.length > 0) problems.push(`${engineName} ${what} ${pageName}: page errors ${JSON.stringify(page.errors)}`);
          await page.context().close();
        }
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
  `Replicata: in Chromium, Firefox and WebKit, at 1200x900 and on a phone (Pixel 7, Firefox at 412x915, iPhone 14), open ${PAGES.default.query} (the default view) and ${PAGES.short.query} (a two-row incident table) fresh and wait until every view is built; then, for each of ${PAGES.default.sections.join(", ")} in turn (on the second page those below the incident box), scroll the incident box into view and then the section to the top of the window, and either reload from the page (location.reload()) or go to another page of the site and come back (history.back()), and wait until every view is built again.
Expectata: each time, the page a new load of navigation type "reload" or "back_forward", the address unchanged, no page error; on the default page (the incident box drawn at its 80vh cap) the section's top back at the top of the window (or the page scrolled as far as it goes); on the two-row page (its box drawn shorter) the section's top at most the room its rows leave in the box below that (80vh minus the box's drawn height), and not above it.
Resultata: ${problems.length} problems in ${results.length} returns:
${problems.join("\n")}`);
console.log(`qual pass: ${results.length} reloads and returns through the history put the reader back where they were (with a short incident table, within the room its rows leave in its box), in three engines, desktop and phone`);

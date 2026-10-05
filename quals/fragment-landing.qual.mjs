// A #sec-... link opened fresh lands on its section, in Chromium, Firefox and
// WebKit, on a desktop and on phones: once the page has built every view, the
// section's top is at the top of the window (or the page is scrolled as far
// as it goes). The browser makes that scroll itself (syncUrlState keeps the
// fragment for it, audit #95); Firefox and WebKit make it while the page
// loads and not after. On 2026-10-05 (audit #25) the page built the incident
// table, the sanity section and the growth charts after its first frame,
// once the page had loaded, so in those two engines the page grew above the
// target, or below a target it could not yet scroll to, and the link landed
// up to ~29,000 px off (Firefox off on every section below the charts,
// WebKit and iPhone on the sanity and growth sections); and the empty
// incident box, laid out only near the screen (content-visibility), was 80vh
// off screen and ~41 px on screen, so in Firefox the page shrank ~680 px
// under the scroll once the box came on screen (until the review of
// 2026-10-05).
// Also text-fragment links (#:~:text=), which no script can see in Firefox
// or WebKit: one to a heading between the incident browser and the sanity
// section, or to the growth section's heading, shows that heading, as before
// 2026-10-05 (with the views built after the first frame, the empty box
// moved the first two ~700 px out of the window in Firefox and WebKit, and
// the page grew ~13,000-29,000 px above the growth heading in Firefox, WebKit
// and on an iPhone, until the page built every view at load again). One to
// text the script writes (in the sanity section) is not checked: Firefox
// looks for the words before the script has written them, and missed them
// before 2026-10-05 too.
import assert from "node:assert/strict";
import { ENGINES, devices, serveRepo, openPage } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const BELOW = ["#sec-browser", "#sec-markets", "#sec-summary", "#sec-sanity", "#sec-fleet"];
const PHONE = ["#sec-browser", "#sec-sanity", "#sec-fleet"];
const TEXT_LINKS = [["Prediction Markets", "#sec-markets"], ["Sources and raw numbers", "#sec-summary"],
  ["AV company growth and forecast", "#sec-fleet"]];
const CONFIGS = {
  chromium: [["1200x900", { viewport: { width: 1200, height: 900 } }, BELOW], ["Pixel 7", devices["Pixel 7"], PHONE]],
  firefox: [["1200x900", { viewport: { width: 1200, height: 900 } }, BELOW], ["412x915", { viewport: { width: 412, height: 915 } }, PHONE]],
  webkit: [["1200x900", { viewport: { width: 1200, height: 900 } }, BELOW], ["iPhone 14", devices["iPhone 14"], PHONE]],
};

const server = await serveRepo();
const problems = [];
const results = [];
try {
  for (const [engineName, configs] of Object.entries(CONFIGS)) {
    const browser = await ENGINES[engineName].launch();
    try {
      for (const [what, options, fragments] of configs) {
        for (const fragment of fragments) {
          const page = await openPage(browser, server.url + DEF + fragment, options);
          // Let a late layout (a box coming on screen) take effect first.
          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
          const at = await page.evaluate(sel => {
            const se = document.scrollingElement;
            const top = document.querySelector(sel).getBoundingClientRect().top;
            return { top, scrollY: se.scrollTop, want: Math.min(top + se.scrollTop, se.scrollHeight - se.clientHeight), hash: location.hash };
          }, fragment);
          results.push(`${engineName} ${what} ${fragment}: top ${Math.round(at.top)}, scrollY ${Math.round(at.scrollY)} (want ${Math.round(at.want)})`);
          if (Math.abs(at.scrollY - at.want) > 1) problems.push(`${engineName} ${what} ${fragment}: the section's top is ${Math.round(at.top)} px below the window's top, scrolled to ${Math.round(at.scrollY)} px where ${Math.round(at.want)} px puts it at the top`);
          if (at.hash !== fragment) problems.push(`${engineName} ${what} ${fragment}: the address lost its fragment (${JSON.stringify(at.hash)})`);
          if (page.errors.length > 0) problems.push(`${engineName} ${what} ${fragment}: page errors ${JSON.stringify(page.errors)}`);
          await page.context().close();
        }
      }
      // Text-fragment links to the two headings between the incident browser
      // and the sanity section and to the growth section's, at 1200x900.
      for (const [text, section] of TEXT_LINKS) {
        const page = await openPage(browser, server.url + DEF + "#:~:text=" + encodeURIComponent(text), { viewport: { width: 1200, height: 900 } });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));
        const box = await page.evaluate(sel => {
          const b = document.querySelector(sel + " .sec-head").getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, height: innerHeight };
        }, section);
        results.push(`${engineName} 1200x900 #:~:text=${text}: heading at ${Math.round(box.top)}-${Math.round(box.bottom)} of ${box.height}`);
        if (!(box.top >= 0 && box.bottom <= box.height)) problems.push(`${engineName} 1200x900 #:~:text=${text}: the "${text}" heading is at ${Math.round(box.top)}-${Math.round(box.bottom)} px, outside the ${box.height} px window`);
        if (page.errors.length > 0) problems.push(`${engineName} 1200x900 #:~:text=${text}: page errors ${JSON.stringify(page.errors)}`);
        await page.context().close();
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
  `Replicata: in Chromium, Firefox and WebKit, at 1200x900 and on a phone (Pixel 7, Firefox at 412x915, iPhone 14), open ${DEF} followed by each of ${BELOW.join(", ")} (on phones ${PHONE.join(", ")}) in a fresh context, wait until every view is built, and read where the section sits; at 1200x900 also open it followed by ${TEXT_LINKS.map(([text]) => `#:~:text=${encodeURIComponent(text)}`).join(" and ")}.
Expectata: the section's top at the top of the window (or the page scrolled as far as it goes), the fragment still in the address, no page error; each text-fragment link shows its heading whole in the window.
Resultata: ${problems.length} of ${results.length} loads wrong:
${problems.join("\n")}`);
console.log(`qual pass: ${results.length} links opened fresh (#sec-... and #:~:text=) land on their targets in three engines, desktop and phone`);

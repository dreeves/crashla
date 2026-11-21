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
// With a short incident table (fewer rows than fill the box's cap: 80vh,
// 50vh under a coarse pointer since 2026-10-31, decision #22; read from the
// box's max-height) a section below the box may land off by as much as the
// room its rows leave in the box (its cap minus its drawn height), in either
// direction: the box is at its cap until it is first drawn and its own height
// after, so a section
// below it moves by that room when the box is first drawn (accepted by the
// human on 2026-10-05, over laying a short table's box out always, which
// made some filter clicks slower; load-order.qual, scroll-restore.qual).
// That is allowed, not required: a fresh link lands exactly in every engine
// today (2026-10-05).
// Also text-fragment links (#:~:text=), which no script can see in Firefox
// or WebKit: one to a heading between the incident browser and the sanity
// section (the markets', the summary's and, since 2026-11-20, the
// assumptions section's), or to the growth section's heading, whose words
// appear nowhere above it (TEXT_LINKS, below), shows that heading, on a
// desktop and on phones, as before 2026-10-05 (with the views built after
// the first frame, the empty box moved the first two ~700 px out of the
// window in Firefox and WebKit, and the page grew ~13,000-29,000 px above the
// growth heading in Firefox, WebKit, Firefox at 412x915 and on an iPhone,
// until the page built every view at load again). One to text the script
// writes (in the sanity section) is not checked: Firefox looks for the words
// before the script has written them, and missed them before 2026-10-05 too.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, devices, serveRepo, openPage } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
// Tesla's incidents of May 2026: two rows, a box shorter than its cap.
const SHORT = "?f=Tesla&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault&d=2026-05.2026-05";
// (The assumptions section, between the summary and sanity sections, joined
// these lists and the text-fragment links on 2026-11-20.)
const BELOW = ["#sec-browser", "#sec-markets", "#sec-summary", "#sec-assumptions", "#sec-sanity", "#sec-fleet"];
const PHONE = ["#sec-browser", "#sec-sanity", "#sec-fleet"];
const SHORT_BELOW = ["#sec-markets", "#sec-assumptions", "#sec-sanity", "#sec-fleet"];
// A text-fragment link to a section's heading: the heading's text as
// index.html gives it (the text the browsers search before the script runs),
// read from the section with that id. Until 2026-10-31 the three headings'
// words were spelled here; they are the human's (audit 2026-10-30, QT-09).
const INDEX = fs.readFileSync("index.html", "utf8");
const headingText = id => {
  const m = new RegExp(`<section class="collapsible" id="${id.slice(1)}">\\s*<h2 class="sec-head"><span class="sec-toggle">([^<]+)</span></h2>`).exec(INDEX);
  assert.ok(m, `Replicata: read the heading of ${id} in index.html. Expectata: <h2 class="sec-head"><span class="sec-toggle">(its text)</span></h2> right after the section's opening tag. Resultata: none.`);
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").trim();
};
// A bare text-fragment link reaches a heading only when the heading's words
// appear nowhere above it: a browser goes to the first match on the page,
// ignoring case. So the links are to those of these headings whose text
// index.html shows nowhere earlier as whole words (comments, scripts, styles
// and noscript content are not shown), and the others are named on the pass
// line. Since 2026-11-21, when the human's heading "Assumptions" (until then
// the Latin placeholder "Suppositiones") also matched the abstract's
// "Waymo-vs-humans assumptions." and its link landed there (the human: "that
// qual change sounds correct"). The section's own link, #sec-assumptions, is
// tested above whatever its heading says.
const TEXT_CANDIDATES = ["#sec-markets", "#sec-summary", "#sec-assumptions", "#sec-fleet"].map(id => [headingText(id), id]);
const SHOWN = INDEX.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ");
const shownAbove = id => {
  const end = SHOWN.indexOf(`<section class="collapsible" id="${id.slice(1)}">`);
  assert.ok(end > 0, `Replicata: find ${id} in index.html. Expectata: its section. Resultata: none.`);
  return SHOWN.slice(SHOWN.indexOf("<body"), end).replace(/<[^>]*>/g, " ").replace(/&[#\w]+;/g, " ").replace(/\s+/g, " ");
};
const wordsIn = (text, shown) => new RegExp(`(^|[^\\p{L}\\p{N}])${text.replace(/\s+/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(shown);
const TEXT_LINKS = TEXT_CANDIDATES.filter(([text, id]) => !wordsIn(text, shownAbove(id)));
const UNREACHABLE = TEXT_CANDIDATES.filter(([text, id]) => wordsIn(text, shownAbove(id)));
assert.ok(TEXT_LINKS.length > 0, `Replicata: read the headings ${TEXT_CANDIDATES.map(([, id]) => id).join(", ")} and the text index.html shows above each.
Expectata: at least one heading whose words appear nowhere above it, so this qual tests a text-fragment link at all.
Resultata: every one appears above: ${JSON.stringify(UNREACHABLE)}.`);
// The fragment directive's own delimiters ("-" and ",", besides "&") are
// escaped, so the heading's text is searched for whole.
const textDirective = text => encodeURIComponent(text).replace(/-/g, "%2D");
const DESK = { viewport: { width: 1200, height: 900 } };
// [name, context options, sections for the default view, sections for the short table]
const CONFIGS = {
  chromium: [["1200x900", DESK, BELOW, SHORT_BELOW], ["Pixel 7", devices["Pixel 7"], PHONE, []]],
  firefox: [["1200x900", DESK, BELOW, SHORT_BELOW], ["412x915", { viewport: { width: 412, height: 915 } }, PHONE, []]],
  webkit: [["1200x900", DESK, BELOW, SHORT_BELOW], ["iPhone 14", devices["iPhone 14"], PHONE, []]],
};
// Let a late layout (a box coming on screen) take effect first.
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300)))));

const server = await serveRepo();
const problems = [];
const results = [];
try {
  for (const [engineName, configs] of Object.entries(CONFIGS)) {
    const browser = await ENGINES[engineName].launch();
    try {
      for (const [what, options, fragments, shortFragments] of configs) {
        for (const [query, list, short] of [[DEF, fragments, false], [SHORT, shortFragments, true]]) {
          for (const fragment of list) {
            const where = `${engineName} ${what}${short ? " short table" : ""} ${fragment}`;
            const page = await openPage(browser, server.url + query + fragment, options);
            await settle(page);
            const at = await page.evaluate(sel => {
              const se = document.scrollingElement;
              const top = document.querySelector(sel).getBoundingClientRect().top;
              return { top, scrollY: se.scrollTop, want: Math.min(top + se.scrollTop, se.scrollHeight - se.clientHeight), hash: location.hash };
            }, fragment);
            // Then the incident box's drawn height: the room a short table's
            // rows leave in it is how far a section below it may be off.
            const box = await page.evaluate(async () => {
              const b = document.querySelector(".table-scroll");
              b.scrollIntoView({ block: "center" });
              const row = document.querySelector("#incidents-body tr");
              for (let i = 0; !row.checkVisibility({ contentVisibilityAuto: true }); i++) {
                if (i === 30) throw new Error("the incident box was not drawn within 30 frames of being scrolled into view");
                await new Promise(r => requestAnimationFrame(r));
              }
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              return { height: b.getBoundingClientRect().height, cap: parseFloat(getComputedStyle(b).maxHeight) };
            });
            const off = at.want - at.scrollY;
            const room = short ? box.cap - box.height : 0;
            results.push(`${where}: top ${Math.round(at.top)}, scrollY ${Math.round(at.scrollY)} (want ${Math.round(at.want)}), box ${Math.round(box.height)} of ${Math.round(box.cap)}`);
            if (box.height < box.cap - 1 !== short) problems.push(`${where}: the incident box is drawn ${Math.round(box.height)} px tall (its cap ${Math.round(box.cap)} px), not ${short ? "shorter than" : "at"} its cap: this page no longer tests ${short ? "a short" : "a full"} box`);
            if (Math.abs(off) > room + 1) problems.push(`${where}: the section's top is ${Math.round(at.top)} px below the window's top, scrolled to ${Math.round(at.scrollY)} px where ${Math.round(at.want)} px puts it at the top${short ? ` (allowed: up to ${Math.round(room)} px either way, the room the table's rows leave in its ${Math.round(box.cap)} px box)` : ""}`);
            if (at.hash !== fragment) problems.push(`${where}: the address lost its fragment (${JSON.stringify(at.hash)})`);
            if (page.errors.length > 0) problems.push(`${where}: page errors ${JSON.stringify(page.errors)}`);
            await page.context().close();
          }
        }
        // Text-fragment links to the headings between the incident browser
        // and the sanity section and to the growth section's, those a bare
        // link can reach (TEXT_LINKS).
        for (const [text, section] of TEXT_LINKS) {
          const where = `${engineName} ${what} #:~:text=${text}`;
          const page = await openPage(browser, server.url + DEF + "#:~:text=" + textDirective(text), options);
          await settle(page);
          const head = await page.evaluate(sel => {
            const b = document.querySelector(sel + " .sec-head").getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, height: innerHeight };
          }, section);
          results.push(`${where}: heading at ${Math.round(head.top)}-${Math.round(head.bottom)} of ${head.height}`);
          if (!(head.top >= 0 && head.bottom <= head.height)) problems.push(`${where}: the "${text}" heading is at ${Math.round(head.top)}-${Math.round(head.bottom)} px, outside the ${head.height} px window`);
          if (page.errors.length > 0) problems.push(`${where}: page errors ${JSON.stringify(page.errors)}`);
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
  `Replicata: in Chromium, Firefox and WebKit, at 1200x900 and on a phone (Pixel 7, Firefox at 412x915, iPhone 14), open ${DEF} followed by each of ${BELOW.join(", ")} (on phones ${PHONE.join(", ")}) in a fresh context, wait until every view is built, and read where the section sits; at 1200x900 also open ${SHORT} (a two-row incident table) followed by each of ${SHORT_BELOW.join(", ")}; then scroll the incident box into view and read its drawn height; and in every configuration open ${DEF} followed by ${TEXT_LINKS.map(([text]) => `#:~:text=${textDirective(text)}`).join(", ")}.
Expectata: the section's top at the top of the window (or the page scrolled as far as it goes), with the two-row table at most the room its rows leave in the box (its cap, 80vh or under a coarse pointer 50vh, minus the box's drawn height) above or below that; the default view's box drawn at its cap and the two-row one shorter; the fragment still in the address; no page error; each text-fragment link shows its heading whole in the window.
Resultata: ${problems.length} of ${results.length} loads wrong:
${problems.join("\n")}`);
console.log(`qual pass: ${results.length} links opened fresh (#sec-... and #:~:text=) land on their targets in three engines, desktop and phone (a section below a two-row incident table within the room its rows leave in its box)${UNREACHABLE.length > 0 ? `; no text-fragment link to ${UNREACHABLE.map(([text, id]) => `${id} ("${text}")`).join(", ")}, whose words appear above it` : ""}`);

// A load paints the page whole and without a layout shift (audit 2026-10-04
// #25). Until 2026-10-05 the frame painted before the script ran (the
// headings over empty sections) put every section below the controls ~124 px
// higher than the charts then pushed them, a layout shift of 0.208 on a
// 1200x900 desktop. On 2026-10-05 init built the incident browser, the sanity
// section and the growth charts in tasks after its first frame, so that the
// frame showed the charts sooner; but Firefox and WebKit put the reader in
// place while the page loads (a #sec-... or #:~:text= link, a reload, a
// return through the history), and with those views built later the page
// grew under that scroll (fragment-landing.qual, scroll-restore.qual). Spec,
// in Chromium, Firefox and WebKit:
//  - every view is built in the script's task: the first frame that shows
//    the charts and the cards also shows the incident table, the sanity
//    section and the growth charts;
//  - before the script runs, the controls and the charts' places hold the
//    room they take in the default view: the "Vehicle Miles Traveled" heading
//    sits where the drawn page has it (crashla.js withheld here);
//  - in Chromium, a fresh desktop load shifts nothing (layout shift < 0.01);
//  - the room is held only until the first build: with no company checked,
//    the company charts' box is empty and takes none;
//  - the incident box is laid out only near the screen (content-visibility),
//    whatever its rows: a filter click to a short table leaves it so. On
//    2026-10-05 a box of fewer than 100 rows was laid out always, which
//    switched the layout skipping on under the click that took the table
//    back past 100 rows, and made it ~70% slower in Firefox (Tesla's 23 rows
//    to all 1,228);
//  - until the incident browser is first built, the empty incident box is as
//    tall as the drawn default view's, where it sits off screen and once
//    scrolled on screen. Until the review of 2026-10-05 it was ~41 px on
//    screen and 80vh (its placeholder) off screen, so in Firefox a #sec-...
//    link, scrolled to while the page was still the bare HTML, had the page
//    shrink ~680 px under it once the box came on screen, and landed short
//    (fragment-landing.qual).
import assert from "node:assert/strict";
import fs from "node:fs";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";
import { stripComments, rules, decls } from "./css-parse.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const css = rules(stripComments(fs.readFileSync("style.css", "utf8")));
const box = css.find(r => r.sel === ".table-scroll" && r.context.length === 0);
assert.ok(box && decls(box.body, "content-visibility").includes("auto"),
  `Replicata: read style.css's .table-scroll rule.
Expectata: content-visibility: auto, so the incident box's rows are laid out only near the screen.
Resultata: ${JSON.stringify(box && box.body)}.`);

// Recorded from the document's start: what the first animation frame that
// saw the MPI chart and a summary card drawn also saw built.
const WATCH = `
  window.__order = { frames: 0, chartFrame: null };
  window.__shift = 0;
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  (function watch() {
    requestAnimationFrame(() => {
      window.__order.frames++;
      if (document.querySelector("#chart-mpi-all svg") !== null && document.querySelector(".mpi-card") !== null) {
        window.__order.chartFrame = { frame: window.__order.frames,
          rows: document.querySelectorAll("#incidents-body tr").length,
          sanity: document.querySelectorAll("#sanity-checks h3").length,
          growth: document.querySelectorAll("#chart-fleet-timeseries svg, #chart-fleet-forecast svg").length };
      } else watch();
    });
  })();`;

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      // The first frame with the charts has every other view built too.
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
      await context.addInitScript(WATCH);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", err => errors.push(err.message));
      await page.goto(server.url + DEF, { waitUntil: "load" });
      await page.waitForFunction(drawnAll, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(300);
      const seen = await page.evaluate(() => ({ ...window.__order, shift: window.__shift,
        built: { rows: document.querySelectorAll("#incidents-body tr").length, sanity: document.querySelectorAll("#sanity-checks h3").length,
          growth: document.querySelectorAll("#chart-fleet-timeseries svg, #chart-fleet-forecast svg").length },
        vmtHeadingTop: document.querySelector("#sec-vmt .sec-head").getBoundingClientRect().top + scrollY,
        boxHeight: document.querySelector(".table-scroll").getBoundingClientRect().height,
        boxVisibility: getComputedStyle(document.querySelector(".table-scroll")).contentVisibility }));
      const first = seen.chartFrame;
      if (first === null) problems.push(`${engineName}: no frame showed the charts and cards (${seen.frames} frames watched)`);
      else if (!(first.rows === seen.built.rows && first.sanity === seen.built.sanity && first.growth === 2)) problems.push(`${engineName}: the first frame that showed the charts and cards (frame ${first.frame}) had ${first.rows} incident rows, ${first.sanity} sanity headings and ${first.growth} growth charts built, of the ${seen.built.rows}, ${seen.built.sanity} and 2 the page then holds`);
      if (!(seen.built.rows > 100 && seen.built.sanity > 5 && seen.built.growth === 2)) problems.push(`${engineName}: after load the page built ${JSON.stringify(seen.built)}`);
      if (seen.boxVisibility !== "auto") problems.push(`${engineName}: the default view's incident box (${seen.built.rows} rows) has content-visibility ${JSON.stringify(seen.boxVisibility)}, not "auto"`);
      // A filter click to a short table (Tesla's 23 rows) and back to all.
      for (const label of ["Tesla", "All"]) {
        const after = await page.evaluate(async label => {
          [...document.querySelectorAll("#filters button")].find(b => b.textContent.startsWith(label + " (")).click();
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { rows: document.querySelectorAll("#incidents-body tr").length,
            visibility: getComputedStyle(document.querySelector(".table-scroll")).contentVisibility };
        }, label);
        if (after.visibility !== "auto") problems.push(`${engineName}: after a click on the "${label}" filter the incident box (${after.rows} rows) has content-visibility ${JSON.stringify(after.visibility)}, not "auto"`);
      }
      if (engineName === "chromium" && !(seen.shift < 0.01)) problems.push(`chromium: a fresh 1200x900 load shifted the layout by ${seen.shift.toFixed(3)} (want < 0.01)`);
      if (errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(errors)}`);
      await context.close();

      // The page before its script runs: crashla.js withheld.
      const bare = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      await bare.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
      await bare.route(/\/crashla\.js$/, route => route.abort("blockedbyclient"));
      const skeleton = await bare.newPage();
      await skeleton.goto(server.url + DEF, { waitUntil: "load" });
      const before = await skeleton.evaluate(() => document.querySelector("#sec-vmt .sec-head").getBoundingClientRect().top + scrollY);
      if (Math.abs(before - seen.vmtHeadingTop) > 1) problems.push(`${engineName}: before the script runs the "Vehicle Miles Traveled" heading is at ${before.toFixed(1)} px, and ${seen.vmtHeadingTop.toFixed(1)} px once the page is drawn`);
      // The empty incident box: as tall as the drawn page's, off screen where
      // it sits and on screen once scrolled to.
      const offScreen = await skeleton.evaluate(() => document.querySelector(".table-scroll").getBoundingClientRect().height);
      const onScreen = await skeleton.evaluate(async () => {
        document.querySelector(".table-scroll").scrollIntoView();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return document.querySelector(".table-scroll").getBoundingClientRect().height;
      });
      if (Math.abs(offScreen - seen.boxHeight) > 1 || Math.abs(onScreen - seen.boxHeight) > 1) problems.push(`${engineName}: before the script runs the empty incident box is ${offScreen.toFixed(1)} px tall off screen and ${onScreen.toFixed(1)} px on screen, and ${seen.boxHeight.toFixed(1)} px once the page is drawn`);
      await bare.close();

      // The room is held only until the first build: with no company checked
      // the company charts' box is empty again, and takes none.
      const none = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      await none.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
      const humans = await none.newPage();
      await humans.goto(server.url + "?f=All&s=-&a=1&c=HumansAV&m=atfault", { waitUntil: "load" });
      await humans.waitForFunction(drawnAll, null, { timeout: 30000 }).catch(() => {});
      const empty = await humans.evaluate(() => ({ children: document.getElementById("chart-helmer-series").children.length,
        height: document.getElementById("chart-helmer-series").getBoundingClientRect().height }));
      if (!(empty.children === 0 && empty.height < 1)) problems.push(`${engineName}: with no company checked the company charts' box holds ${empty.children} charts and is ${empty.height.toFixed(1)} px tall (want none, 0 px)`);
      await none.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit, load the default view at 1200x900, watching every animation frame from the document's start, then click the "Tesla" filter and the "All" filter; load the default view again with crashla.js withheld; then load c=HumansAV (no company checked).
Expectata: the first frame that shows the charts and cards also shows every incident row, the sanity section and both growth charts; no page error; the incident box has content-visibility auto in the default view and after each filter click; Chromium records a layout shift under 0.01; the "Vehicle Miles Traveled" heading sits within 1 px of the same place before the script runs and once the page is drawn; the empty incident box before the script runs is, within 1 px, as tall as the drawn page's, both where it sits off screen and once scrolled on screen; and with no company checked (c=HumansAV) the company charts' box is empty and 0 px tall.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: a load paints the page whole, with every view built in the script's task, keeps the incident box's layout skipping through filter clicks, and shifts nothing, in three engines");

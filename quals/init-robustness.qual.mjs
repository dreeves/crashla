// The page draws in a hidden or zero-width iframe and in a very narrow
// window, and recovers once it has width (audit 2026-10-04 #32). Init used to
// measure the charts' column first and assert it had width, then lay out the
// charts, and only after them build the incident browser, the sanity section
// and the URL state and register the listeners, the tooltips, the
// collapsible sections and the markets. So in a display:none iframe the
// measurement threw ("the charts' column has no width") and, shown later, the
// page stayed blank: no charts, cards, rows, sanity tables or colophon,
// markets stuck "Loading...", dead toggles. In a window of ~136 CSS px or
// less the charts' layout threw ("drawLogXTicks: mapX must grow with x"),
// and widening recovered nothing. Now init sets up everything that is not a
// chart first, the charts draw at their column's width (no narrower than
// CHART_MIN_W, scaled down into a narrower column), a page with no width
// draws them at CHART_MIN_W, and the resize that gives it width redraws them;
// the column assert stays for a viewport at least CHART_MIN_W wide whose
// column has no width.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, drawnAll } from "./browser.mjs";

// What a document drew.
const SUMMARY = () => {
  const q = s => document.querySelectorAll(s).length;
  return {
    charts: q("svg.month-svg"), cards: q(".mpi-card"), rows: q("#incidents-body tr"),
    markets: q("#predmarket-panel .pm-card"), sanity: (document.getElementById("sanity-checks").textContent || "").length,
    colophon: (document.getElementById("colophon").textContent || "").length > 0,
    chartViewW: typeof chartViewW === "number" ? chartViewW : null,
  };
};
const drewAll = s => s.charts >= 6 && s.cards >= 6 && s.rows > 100 && s.markets > 10 && s.sanity > 5000 && s.colophon;
// A section heading toggles its section.
const TOGGLES = async () => {
  const sec = document.getElementById("sec-browser");
  const before = sec.classList.contains("collapsed");
  sec.querySelector(".sec-toggle").click();
  const after = sec.classList.contains("collapsed");
  if (after !== before) sec.querySelector(".sec-toggle").click();
  return after !== before;
};

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      // 1. An iframe hidden (display:none) or zero-width at load, shown later.
      for (const [what, style] of [["display:none", "display:none;width:900px;height:700px"], ["width:0", "width:0;height:700px;border:0"]]) {
        const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", err => errors.push(err.message));
        await page.setContent(`<iframe id="f" style="${style}" src="${server.url}"></iframe>`);
        let frame = null;
        for (let i = 0; i < 100 && !frame; i++) {
          frame = page.frames().find(f => f.url().startsWith(server.url)) || null;
          if (!frame) await page.waitForTimeout(50);
        }
        await frame.waitForFunction(() => document.readyState === "complete");
        await frame.waitForFunction(() => document.querySelector(".pm-refresh") !== null &&
          document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true", null, { timeout: 30000 }).catch(() => {});
        await page.evaluate(() => { const f = document.getElementById("f"); f.style.display = "block"; f.style.width = "900px"; });
        await frame.waitForFunction(() => typeof chartViewW === "number" && chartViewW > 500, null, { timeout: 10000 }).catch(() => {});
        // The views below the charts (built at load).
        await frame.waitForFunction(drawnAll, null, { timeout: 10000 }).catch(() => {});
        const shown = await frame.evaluate(SUMMARY);
        const toggles = await frame.evaluate(TOGGLES);
        if (!drewAll(shown) || !toggles || shown.chartViewW < 500) problems.push(`${engineName}, iframe ${what} at load then shown 900 px wide: ${JSON.stringify({ shown, toggles })}; want every chart, card, row, market and the sanity section drawn, the charts at the shown width, and the section toggles working`);
        if (errors.length > 0) problems.push(`${engineName}, iframe ${what}: page errors ${JSON.stringify(errors)}`);
        await context.close();
      }
      // 2. A 130 CSS px window, widened to 1200.
      {
        const context = await browser.newContext({ viewport: { width: 130, height: 800 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", err => errors.push(err.message));
        await page.goto(server.url, { waitUntil: "load" });
        await page.waitForFunction(() => document.querySelector(".pm-refresh") !== null &&
          document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true", null, { timeout: 30000 }).catch(() => {});
        await page.waitForFunction(drawnAll, null, { timeout: 10000 }).catch(() => {});
        const narrow = await page.evaluate(SUMMARY);
        await page.setViewportSize({ width: 1200, height: 800 });
        await page.waitForFunction(() => typeof chartViewW === "number" && chartViewW === 900, null, { timeout: 10000 }).catch(() => {});
        const wide = await page.evaluate(SUMMARY);
        const toggles = await page.evaluate(TOGGLES);
        if (!drewAll(narrow) || !drewAll(wide) || wide.chartViewW !== 900 || !toggles) problems.push(`${engineName}, 130 px window widened to 1200: ${JSON.stringify({ narrow, wide, toggles })}; want everything drawn at 130 px (the charts at their narrowest layout) and the charts redrawn at 900 units once widened, toggles working`);
        if (errors.length > 0) problems.push(`${engineName}, 130 px window: page errors ${JSON.stringify(errors)}`);
        await context.close();
      }
      // 3. The assert still catches a column that collapses on a page with
      // width: style.css served with the column forced to zero width.
      {
        const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
        await context.route(/style\.css$/, async route => {
          const res = await route.fetch();
          await route.fulfill({ response: res, body: (await res.text()) + "\n#month-panel { width: 0; overflow: hidden; }\n" });
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", err => errors.push(err.message));
        await page.goto(server.url, { waitUntil: "load" });
        await page.waitForTimeout(500);
        if (!errors.some(e => /the charts' column has no width/.test(e))) problems.push(`${engineName}, a 1200 px page whose column CSS forces to zero width: page errors ${JSON.stringify(errors)}; want "the charts' column has no width"`);
        await context.close();
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
  `Replicata: in Chromium, Firefox and WebKit, load the page in an iframe styled display:none (then width:0), show it 900 px wide; load it in a 130 CSS px window, then widen it to 1200; and load it at 1200 px with style.css forcing #month-panel to zero width.
Expectata: no page error; every chart, summary card, incident row, market card and the sanity section drawn; the charts at the shown width (900 units once the column allows); the section toggles working. And a 1200 px page whose stylesheet collapses the charts' column still fails loudly ("the charts' column has no width").
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: the page draws in a hidden or zero-width iframe and in a 130 px window, and redraws its charts once it has width, in Chromium, Firefox and WebKit");

// Tables and the date slider on phones, in Chromium, Firefox and WebKit
// (audit 2026-10-04 #20, #21, #67, #68, #69). layout-fit.qual covers the page
// from 320 CSS px up; these checks cover what it did not:
//  - #20: the "VMT sources" table fits its box. One unbreakable token in a
//    rationale ("x.com/SawyerMerritt/status/2095687786309341612)", 342 px)
//    set the table's minimum width, so on phones in Chromium and WebKit it
//    laid out 437 px wide in a 296-388 px box and cut every methodology line
//    off at the right edge (Firefox fitted it);
//  - #69: in "VMT sources" each company's name sits at the top of its row,
//    not halfway down a row up to ~4,600 px tall;
//  - #21: the "Specific human benchmark derivations" table's Derivation column
//    is at least 18em wide (it was squeezed to ~126-133 px, about 14
//    characters a line, starting past the right edge of an iPhone SE);
//  - #68: no sideways scroll at 270-290 CSS px (the summary cards' 280 px
//    minimum width made the page 292 px wide);
//  - #67: under a coarse pointer the slider thumbs are 24-28 px across (they
//    were 18 px, with a month 4.6-6.1 px of travel), and the fill still runs
//    from thumb centre to thumb centre; under a fine pointer they stay 18 px.
import assert from "node:assert/strict";
import { ENGINES, devices, serveRepo } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
async function open(browser, url, contextOptions) {
  const context = await browser.newContext(contextOptions);
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, route => route.abort("internetdisconnected"));
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", err => page.errors.push(err.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#sanity-checks h3") !== null &&
    document.querySelectorAll("#incidents-body tr").length > 0 &&
    document.querySelector(".pm-refresh") !== null &&
    document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
  return page;
}
// The sanity table under the heading `title`.
const tables = page => page.evaluate(() => {
  const wrapAfter = title => {
    const h = [...document.querySelectorAll("#sanity-checks h3")].find(h => h.textContent === title);
    let n = h.nextElementSibling;
    while (n !== null && !n.classList.contains("table-wrap")) n = n.nextElementSibling;
    return n;
  };
  const vw = wrapAfter("VMT sources"), dw = wrapAfter("Specific human benchmark derivations");
  const vt = vw.querySelector("table"), dt = dw.querySelector("table");
  const names = [...vt.querySelectorAll("tbody tr")].map(tr => {
    const td = tr.children[0];
    const range = document.createRange();
    range.selectNodeContents(td);
    const text = range.getBoundingClientRect(), cell = td.getBoundingClientRect();
    // At the top: within the cell's top padding and its first line.
    return { company: td.textContent, rowHeight: Math.round(cell.height), nameBelowTop: Math.round(text.top - cell.top),
      firstLine: parseFloat(getComputedStyle(td).paddingTop) + parseFloat(getComputedStyle(td).lineHeight) };
  });
  const derivation = [...dt.querySelectorAll("tbody tr")].map(tr => {
    const td = tr.children[4];
    return { width: td.getBoundingClientRect().width, em: parseFloat(getComputedStyle(td).fontSize) };
  });
  return {
    vmt: { table: vt.getBoundingClientRect().width, box: vw.clientWidth },
    names,
    derivationNarrowest: Math.min(...derivation.map(d => d.width / d.em)),
  };
});
// The slider's thumbs, measured by hit-testing along the slider's middle: the
// run of points that reach each input (an input takes the pointer only on its
// thumb), and the fill's ends.
const slider = page => page.evaluate(async () => {
  const minIn = document.getElementById("date-range-min"), maxIn = document.getElementById("date-range-max");
  minIn.scrollIntoView({ block: "center" });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = document.querySelector(".date-range-slider").getBoundingClientRect();
  const y = box.top + box.height / 2;
  const runs = { min: [], max: [] };
  for (let x = Math.floor(box.left) - 20; x <= box.right + 20; x += 0.25) {
    const hit = document.elementFromPoint(x, y);
    if (hit === minIn) runs.min.push(x);
    if (hit === maxIn) runs.max.push(x);
  }
  const span = xs => xs.length === 0 ? null : { from: xs[0], to: xs[xs.length - 1], width: xs[xs.length - 1] - xs[0] + 0.25 };
  const fill = document.getElementById("date-range-fill").getBoundingClientRect();
  return { min: span(runs.min), max: span(runs.max), fill: { left: fill.left, right: fill.right },
    coarse: matchMedia("(pointer: coarse)").matches };
});

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      const phones = engineName === "webkit" ? [["iPhone 14", devices["iPhone 14"]], ["iPhone SE", devices["iPhone SE"]]]
        : engineName === "chromium" ? [["Pixel 7", devices["Pixel 7"]], ["375px", { viewport: { width: 375, height: 800 } }]]
        : [["375px touch", { viewport: { width: 375, height: 800 }, hasTouch: true }]];
      for (const [what, options] of [...phones, ["1200px", { viewport: { width: 1200, height: 900 } }]]) {
        const page = await open(browser, server.url + DEF, options);
        const t = await tables(page);
        if (t.vmt.table > t.vmt.box + 0.5) problems.push(`${engineName} ${what}: "VMT sources" table ${t.vmt.table.toFixed(1)} px wide in its ${t.vmt.box} px box`);
        for (const n of t.names) if (n.nameBelowTop > n.firstLine)
          problems.push(`${engineName} ${what}: in "VMT sources" ${n.company}'s name is ${n.nameBelowTop} px below the top of its ${n.rowHeight} px row`);
        if (t.derivationNarrowest < 18 - 0.05) problems.push(`${engineName} ${what}: a Derivation cell is ${t.derivationNarrowest.toFixed(1)}em wide (< 18em)`);
        const s = await slider(page);
        const [lo, hi] = s.coarse ? [24, 28] : [18, 18];
        for (const [name, run] of [["start", s.min], ["end", s.max]]) {
          if (run === null || run.width < lo - 1 || run.width > hi + 1)
            problems.push(`${engineName} ${what} (${s.coarse ? "coarse" : "fine"} pointer): the ${name} thumb takes the pointer over ${run === null ? "nothing" : run.width.toFixed(2) + " px"} (want ${lo === hi ? lo : lo + "-" + hi} px)`);
        }
        if (s.min !== null && s.max !== null) {
          const a = (s.min.from + s.min.to) / 2, b = (s.max.from + s.max.to) / 2;
          if (Math.abs(s.fill.left - a) > 1.5 || Math.abs(s.fill.right - b) > 1.5)
            problems.push(`${engineName} ${what}: slider fill ${s.fill.left.toFixed(1)}-${s.fill.right.toFixed(1)}, thumb centres ${a.toFixed(1)} and ${b.toFixed(1)}`);
        }
        if (page.errors.length > 0) problems.push(`${engineName} ${what}: page errors ${JSON.stringify(page.errors)}`);
        await page.context().close();
      }
      for (const width of [270, 280, 290]) {
        const page = await open(browser, server.url + DEF, { viewport: { width, height: 653 } });
        const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        if (r.sw > r.cw) problems.push(`${engineName} ${width}px: the page scrolls sideways (scrollWidth ${r.sw} > ${r.cw})`);
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
  `Replicata: in Chromium (Pixel 7, 375 px, 1200 px), Firefox (375 px with touch, 1200 px) and WebKit (iPhone 14, iPhone SE, 1200 px), open the default view and measure the "VMT sources" table against its box, where each company's name sits in its row, the narrowest Derivation cell of "Specific human benchmark derivations", and the date slider's thumbs (by hit-testing) and fill; then the page width at 270, 280 and 290 px.
Expectata: the "VMT sources" table fits its box; each name at its row's top; Derivation cells at least 18em wide; thumbs 24-28 px under a coarse pointer and 18 px under a fine one, the fill from thumb centre to thumb centre; no sideways scroll.
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: on phones the sanity tables fit and read at a normal line length, the slider's thumbs are finger-sized, and the page does not scroll sideways from 270 px, in three engines");

// A held arrow key on a date slider, in Chromium, Firefox and WebKit (audit
// 2026-10-04 #23). Each key press fires "input" and "change"; until
// 2026-10-05 every change event committed at once (charts, sanity section,
// incident browser, URL; ~0.45 s on a desktop, ~1.9 s at 4x CPU throttling),
// so the ~30 presses of a one-second hold queued ~30 commits and the page kept
// working for ~13 s after the key came up. Now the views follow the thumbs in
// the next animation frame, once per frame. slider-frame.qual pins that rule in
// a DOM stub; this checks it where keys and frames are real: of 20 presses
// sent while the page is busy (as a held key's repeats queue behind a slow
// commit), however many arrive between two animation frames are followed by
// exactly one commit, in the next frame (a frame with no press before it
// commits nothing); at least once two or more arrive between the same two
// frames, so they are coalesced; and the page left is the page a fresh load of
// the resulting address draws. How many commits that makes depends on how
// each engine's driver delivers the presses (all 20 queue behind the busy page
// in Chromium: one commit; Playwright's Firefox and WebKit drivers send one
// press at a time, so a press can land between any two frames: 2 to 7
// commits measured), so the total is not pinned. Until 2026-10-05 (reviewer)
// this qual wanted at most 5 commits and failed on a WebKit run with 7.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const PRESSES = 20;
const views = page => page.evaluate(() => {
  const el = id => document.getElementById(id);
  return {
    label: document.querySelector(".date-range-label").textContent,
    start: el("date-range-min").value, end: el("date-range-max").value,
    heading: el("incident-browser-heading").textContent,
    filters: [...el("filters").children].map(b => b.textContent),
    rows: el("incidents-body").innerHTML,
    sanity: el("sanity-checks").innerHTML,
    mpi: el("chart-mpi-all").innerHTML, dist: el("chart-distributions").innerHTML,
    cards: el("mpi-summary-cards").innerHTML, vmt: el("chart-helmer-series").innerHTML,
  };
});
// Two frames and a task after the last one: whatever the presses asked for is done.
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));

const server = await serveRepo();
const problems = [];
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch();
    try {
      const page = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
      await page.focus("#date-range-min");
      const startValue = Number(await page.evaluate(() => document.getElementById("date-range-min").value));
      // Log each press (keydown) and each commit (it builds the incident
      // browser once) with the number of the last animation frame begun. The
      // counter's callback is queued in the frame before, ahead of any the
      // presses queue, so a commit in a frame carries that frame's number.
      await page.evaluate(() => {
        window.__frame = 0;
        window.__log = [];
        (function tick() { requestAnimationFrame(() => { window.__frame++; tick(); }); })();
        const build = window.buildBrowser;
        window.buildBrowser = function () { window.__log.push(["commit", window.__frame]); return build.apply(this, arguments); };
        document.addEventListener("keydown", () => window.__log.push(["press", window.__frame]), true);
      });
      // Keep the page busy while the presses are sent, so they queue and
      // arrive together, as a held key's repeats do behind a slow commit.
      const busy = page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 400) { /* busy */ } });
      await new Promise(r => setTimeout(r, 50));
      const sent = [];
      for (let i = 0; i < PRESSES; i++) sent.push(page.keyboard.press("ArrowLeft"));
      await busy;
      await Promise.all(sent);
      await settle(page);
      const log = await page.evaluate(() => window.__log);
      const byFrame = kind => { const n = {}; for (const [k, f] of log) if (k === kind) n[f] = (n[f] || 0) + 1; return n; };
      const presses = byFrame("press"), commits = byFrame("commit");
      const frames = [...new Set(log.map(([, f]) => f))];
      // Every frame a press or a commit names, and the frame after each.
      const wrongFrames = [...new Set([...frames, ...frames.map(f => f + 1)])].sort((a, b) => a - b)
        .filter(f => (commits[f] || 0) !== ((presses[f - 1] || 0) > 0 ? 1 : 0))
        .map(f => ({ frame: f, pressesBefore: presses[f - 1] || 0, commits: commits[f] || 0 }));
      const perInterval = Object.values(presses);
      const got = await views(page);
      const url = await page.evaluate(() => location.pathname + location.search);
      const wantStart = startValue - PRESSES;
      if (Number(got.start) !== wantStart) problems.push(`${engineName}: after ${PRESSES} presses "Start month" is at ${got.start}, want ${wantStart}`);
      if (perInterval.reduce((a, b) => a + b, 0) !== PRESSES) problems.push(`${engineName}: ${perInterval.reduce((a, b) => a + b, 0)} of the ${PRESSES} presses reached the page`);
      if (wrongFrames.length > 0) problems.push(`${engineName}: frames whose commits are not one after presses (none after none): ${JSON.stringify(wrongFrames.slice(0, 4))} (${log.filter(([k]) => k === "commit").length} commits for presses per frame interval ${JSON.stringify(perInterval)})`);
      if (!perInterval.some(n => n >= 2)) problems.push(`${engineName}: no two presses arrived between the same two frames, so nothing was coalesced (presses per frame interval ${JSON.stringify(perInterval)})`);
      if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
      // The same address, loaded fresh.
      const fresh = await openPage(browser, server.url + url.replace(/^\//, ""), { viewport: { width: 1200, height: 900 } });
      const want = await views(fresh);
      const differ = Object.keys(want).filter(k => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
      if (differ.length > 0) problems.push(`${engineName}: after the held key the page differs from a fresh load of ${url} in ${JSON.stringify(differ)}${differ.includes("filters") ? ` (filters ${JSON.stringify(got.filters)} vs ${JSON.stringify(want.filters)})` : ""}`);
      await fresh.context().close();
      await page.context().close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: in Chromium, Firefox and WebKit, on the default view, focus "Start month" and send ${PRESSES} ArrowLeft presses while the page is busy (so they queue, as a held key's repeats do behind a slow commit); log each press and each commit (incident-browser build) with the animation frame it falls in; then load the resulting address fresh and compare.
Expectata: "Start month" moved ${PRESSES} months; the presses that arrive between two frames, however many, are followed by exactly one commit, in the next frame, and a frame with no press before it commits nothing; at least once two or more presses arrive between the same two frames; the page equals the fresh load (slider, incident browser, sanity section, charts, cards).
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
console.log("qual pass: a held arrow key on the date slider commits once per frame, not once per press, and leaves the page a fresh load draws, in three engines");

// The human benchmark derivations table's colours and marks, as Chromium,
// Firefox and WebKit draw them. ai-derivation-text.qual checks the table's
// markup and style.css's uses of the AI ink; this checks the computed result,
// which no reading of the markup or the stylesheet can (an inherited colour,
// a rule on a parent, a text fill colour that paints over the colour, a
// decoration a parent's rule draws under its children's text). In each
// Derivation cell of the sanity section's human benchmark derivations table,
// #sanity-benchmarks (decision 23(b) of the 2026-11-01 open questions; open
// question 33):
//  - every text run inside an .ai-text span is drawn in the AI ink (--ai-ink,
//    resolved on a probe element) with a dotted underline;
//  - every run's text fill colour (-webkit-text-fill-color, which paints over
//    the colour where set) is its colour;
//  - every other run outside a link (a human src, a srcNote, the parentheses
//    and separators around the links) is drawn in the ink of the row's own
//    cohort cell, and no cohort cell is drawn in the AI ink;
//  - a link's text is not drawn in the AI ink (the links are not AI text);
//  - no run outside .ai-text, link or not, sits under a dotted underline: no
//    element from the run's own up to the root draws one, since a decoration
//    reaches the text of the element's inline descendants (the dotted
//    underline is the AI mark that does not depend on colour, decision #29
//    of the 2026-10-04 audit; until 2026-11-03 a rule underlining every
//    derivation cell dotted passed this qual);
//  - the same marks hold with the page in forced colours (emulated, which
//    each engine must report through matchMedia), where the browser repaints
//    every colour and the dotted underline is the AI text's only mark; the
//    colours are not checked there.
// At least one cell holds AI text and at least one does not, in each mode,
// so neither half passes on an empty set. No words are checked (no wording
// pins, 2026-10-28).
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

// Every Derivation cell's text runs, as the page draws them: each run's kind
// (inside an .ai-text span, inside a link, or plain), colour, fill colour
// and marks (the .ai-text span's own decoration; for any other run, the
// nearest element at or above it that draws a dotted underline).
const scan = () => {
  const probe = document.createElement("span");
  probe.style.color = "var(--ai-ink)";
  document.body.appendChild(probe);
  const aiInk = getComputedStyle(probe).color;
  probe.remove();
  const dotted = s => /\bunderline\b/.test(s.getPropertyValue("text-decoration-line")) && s.getPropertyValue("text-decoration-style") === "dotted";
  const dottedAt = el => {
    for (let e = el; e !== null; e = e.parentElement) {
      if (dotted(getComputedStyle(e))) return `<${e.tagName.toLowerCase()}${e.id === "" ? "" : "#" + e.id}${[...e.classList].map(c => "." + c).join("")}>`;
    }
    return null;
  };
  const table = document.getElementById("sanity-benchmarks");
  const rows = table === null ? [] : [...table.querySelectorAll("tbody tr")].map((tr, i) => {
    const tds = tr.querySelectorAll("td");
    const cell = tds[tds.length - 1];
    const runs = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n.textContent.trim() === "") continue;
      const el = n.parentElement, s = getComputedStyle(el);
      const span = el.closest(".ai-text"), link = el.closest("a");
      const kind = span !== null && cell.contains(span) ? "ai" : link !== null && cell.contains(link) ? "link" : "plain";
      runs.push({ kind, text: n.textContent.trim().slice(0, 24), color: s.color, fill: s.getPropertyValue("-webkit-text-fill-color"),
        aiMark: kind === "ai" ? `${getComputedStyle(span).getPropertyValue("text-decoration-line")} ${getComputedStyle(span).getPropertyValue("text-decoration-style")}` : null,
        aiDotted: kind === "ai" ? dotted(getComputedStyle(span)) : null,
        dottedAt: kind === "ai" ? null : dottedAt(el) });
    }
    return { where: `row ${i + 1} (${tds[0].textContent} | ${tds[1].textContent})`, ink: getComputedStyle(tds[0]).color, runs };
  });
  return { aiInk, forced: matchMedia("(forced-colors: active)").matches, table: table !== null, rows };
};

// The marks, in either mode: AI text dotted-underlined, nothing else; at
// least one cell of each kind.
const markProblems = (tag, r) => {
  const out = [];
  if (!r.table) out.push(`${tag} no #sanity-benchmarks table`);
  for (const row of r.rows) for (const run of row.runs) {
    const what = `${tag} ${row.where}: ${run.kind} run ${JSON.stringify(run.text)}...`;
    if (run.kind === "ai" && !run.aiDotted) out.push(`${what} decorated "${run.aiMark}", want a dotted underline`);
    if (run.kind !== "ai" && run.dottedAt !== null) out.push(`${what} sits under a dotted underline, the AI text's mark, drawn by ${run.dottedAt}`);
  }
  const aiCells = r.rows.filter(row => row.runs.some(run => run.kind === "ai")).length;
  if (r.rows.length === 0 || aiCells === 0 || aiCells === r.rows.length) out.push(`${tag} ${r.rows.length} rows, ${aiCells} with AI text, ${r.rows.length - aiCells} without; want at least one of each`);
  return out;
};

// The colours, in the page's own colours only.
const colourProblems = (tag, r) => {
  const out = [];
  for (const row of r.rows) {
    if (row.ink === r.aiInk) out.push(`${tag} ${row.where}: its cohort cell is drawn in the AI ink`);
    for (const run of row.runs) {
      const what = `${tag} ${row.where}: ${run.kind} run ${JSON.stringify(run.text)}...`;
      if (run.fill !== run.color) out.push(`${what} filled ${run.fill}, drawn ${run.color}; want its fill to be its colour`);
      if (run.kind === "ai" && run.color !== r.aiInk) out.push(`${what} drawn ${run.color}, want the AI ink, ${r.aiInk}`);
      if (run.kind === "link" && run.color === r.aiInk) out.push(`${what} drawn in the AI ink`);
      if (run.kind === "plain" && run.color !== row.ink) out.push(`${what} drawn ${run.color}, want the row's ink, ${row.ink}${run.color === r.aiInk ? " (it is the AI ink)" : ""}`);
    }
  }
  return out;
};

const server = await serveRepo();
const problems = [];
const counts = [];
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url, { viewport: { width: 1200, height: 900 } });
  const own = await page.evaluate(scan);
  if (own.forced) problems.push(`[${engine}] the page is in forced colours before any emulation`);
  problems.push(...colourProblems(`[${engine}]`, own), ...markProblems(`[${engine}]`, own));
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await page.evaluate(scan);
  if (!forced.forced) problems.push(`[${engine}, forced colours] matchMedia does not report forced colours after emulateMedia({forcedColors: "active"})`);
  problems.push(...markProblems(`[${engine}, forced colours]`, forced));
  for (const e of page.errors) problems.push(`[${engine}] page error: ${e}`);
  const ai = own.rows.filter(row => row.runs.some(run => run.kind === "ai")).length;
  counts.push(`${engine} ${own.rows.length} rows (${ai} with AI text)`);
  await browser.close();
}
await server.close();

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load the page in Chromium, Firefox and WebKit and read the computed colour and decoration of every text run in the Derivation cells of the human benchmark derivations table (#sanity-benchmarks), then read the decorations again with the page in forced colours (emulated).
Expectata: each run's text fill colour is its colour; each run inside an .ai-text span is drawn in the AI ink (--ai-ink) with a dotted underline; each run outside a link and outside .ai-text (a human src, a srcNote, the parentheses and separators) is drawn in its row's ink, the cohort cell's colour, which is not the AI ink; no link text is drawn in the AI ink; no run outside .ai-text sits under a dotted underline; in forced colours, every .ai-text run keeps its dotted underline and no other run gains one; at least one cell holds AI text and one does not; no page errors.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log(`qual pass: ${counts.join("; ")}; AI text in the AI ink with a dotted underline, every other run in its row's ink and under no dotted underline; in forced colours, the same marks`);

// AI text outside the human benchmark derivations table (whose AI text
// ai-derivation-text.qual and ai-derivation-colors.qual check): the
// incident browser's fault reasoning, an agent's English in every row of
// data/faultfrac.csv (judged under the faultfrac criterion), and the five AI
// srcs (srcAiText) the human cards' [?] hints show. The human's answers of
// 2026-11-03: the reasoning under the opened narrative renders as AI text,
// green with a dotted underline ("yes to narratives at least"), and a
// tooltip, plain text on a dark box, opens its AI part with the label
// AI_TEXT_PREFIX ("Claude: ", the human's own label for AI text in plain
// contexts). Until then all of it rendered plain. In Chromium, Firefox and
// WebKit, over the default view:
//  1. each incident row's fault line (.narrative-fault) holds exactly one
//     .ai-text element, whose text is AI_TEXT_PREFIX and the incident's
//     reasoning (faultData), and nothing else of the line is inside it (the
//     label, the fault fraction before it and the contact areas after it are
//     not AI text);
//  2. the line's text is the label, a space and the fault cell's tooltip, so
//     the tooltip holds the same labelled reasoning;
//  3. the reasoning is drawn in the AI ink (--ai-ink) with a dotted
//     underline, and every other run of the line in another ink under no
//     dotted underline from any element up to the root;
//  4. markup in a reasoning renders escaped inside the one .ai-text element:
//     for one render, the first row's reasoning holds a synthetic span of the
//     AI-text class, a <b> and an ampersand; the table is rebuilt as before
//     afterwards;
//  5. each card [?] hint's tooltip and name are a human band's src, opening
//     with AI_TEXT_PREFIX exactly when the band carries srcAiText, and each
//     of the five AI srcs is some hint's;
//  6. no fault line's AI text and no card hint's tooltip opens with the label
//     twice (an AI src or a reasoning whose own text opened with it: the
//     AV-cities fatality src's did until the human dropped it, 2026-11-03);
//  7. no tooltip on the page (every data-tip) and no element's name
//     (aria-label) holds the label twice in a row anywhere in it (added
//     2026-11-04, when the five-day line in the Effective VMT tooltip of each
//     ADS line's card began taking its label from AI_TEXT_PREFIX: the label
//     typed back into that line's text would read twice, mid-tooltip, where
//     check 6 does not look).
// No words are checked (no wording pins, 2026-10-28): the reasoning and the
// srcs are compared with the app's own, and the label and the line's label
// are read from the app.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const MARKUP = '<span class="ai-text">x</span> & <b>y</b> > z';
const server = await serveRepo();
const problems = [];
const counts = [];
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url, { viewport: { width: 1200, height: 900 } });
  const r = await page.evaluate(markup => {
    const prefix = AI_TEXT_PREFIX;
    const probe = document.createElement("span");
    probe.style.color = "var(--ai-ink)";
    document.body.appendChild(probe);
    const aiInk = getComputedStyle(probe).color;
    probe.remove();
    const dotted = e => {
      const s = getComputedStyle(e);
      return /\bunderline\b/.test(s.getPropertyValue("text-decoration-line")) && s.getPropertyValue("text-decoration-style") === "dotted";
    };
    const dottedAt = el => {
      for (let e = el; e !== null; e = e.parentElement) if (dotted(e)) return e.tagName.toLowerCase() + [...e.classList].map(c => "." + c).join("");
      return null;
    };
    const bad = [];
    // 1-3. The fault lines.
    const rows = [...document.querySelectorAll("#incidents-body tr")];
    for (const tr of rows) {
      const line = tr.querySelector(".narrative-fault");
      const cell = tr.querySelector("td.fault-cell");
      const id = line === null ? "" : line.id.replace(/^narr-fault-/, "");
      const where = `row ${id}`;
      if (line === null || cell === null) { bad.push(`${where}: no fault line or fault cell`); continue; }
      const ai = line.querySelectorAll(".ai-text");
      if (ai.length !== 1) { bad.push(`${where}: ${ai.length} .ai-text elements in the fault line, want 1`); continue; }
      const want = faultData[id] === undefined ? null : `${prefix}${faultData[id].reasoning}`;
      if (ai[0].textContent !== want) bad.push(`${where}: the AI text is ${JSON.stringify(ai[0].textContent.slice(0, 40))}, want the label and the incident's reasoning, ${JSON.stringify(String(want).slice(0, 40))}`);
      if (line.textContent !== `${NARRATIVE_FAULT_LABEL} ${cell.getAttribute("data-tip")}`) bad.push(`${where}: the fault line's text is not the label, a space and the fault cell's tooltip`);
      const s = getComputedStyle(ai[0]);
      if (s.color !== aiInk) bad.push(`${where}: the reasoning is drawn ${s.color}, want the AI ink, ${aiInk}`);
      if (!dotted(ai[0])) bad.push(`${where}: the reasoning is decorated "${s.getPropertyValue("text-decoration-line")} ${s.getPropertyValue("text-decoration-style")}", want a dotted underline`);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if (n.textContent.trim() === "" || ai[0].contains(n)) continue;
        const el = n.parentElement;
        const run = JSON.stringify(n.textContent.trim().slice(0, 24));
        if (getComputedStyle(el).color === aiInk) bad.push(`${where}: plain run ${run} is drawn in the AI ink`);
        const at = dottedAt(el);
        if (at !== null) bad.push(`${where}: plain run ${run} sits under a dotted underline, the AI text's mark, drawn by ${at}`);
      }
    }
    // 4. Escaping, on a synthetic reasoning for the first row's incident.
    const first = rows.length === 0 ? null : rows[0].querySelector(".narrative-fault").id.replace(/^narr-fault-/, "");
    const before = document.getElementById("incidents-body").innerHTML;
    if (first !== null) {
      const saved = faultData[first].reasoning;
      try {
        faultData[first].reasoning = markup;
        buildBrowser();
        const line = document.getElementById(`narr-fault-${first}`);
        const ai = line.querySelectorAll(".ai-text");
        if (ai.length !== 1 || ai[0].textContent !== `${prefix}${markup}` || line.querySelector("b") !== null) {
          bad.push(`synthetic markup in ${first}'s reasoning: ${ai.length} .ai-text elements (want 1, holding the label and the markup as text), ${line.querySelectorAll("b").length} <b> elements (want 0)`);
        }
      } finally {
        faultData[first].reasoning = saved;
        buildBrowser();
      }
      if (document.getElementById("incidents-body").innerHTML !== before) bad.push("the incident table renders differently after the synthetic reasoning is restored");
    }
    // 5. The card hints.
    const bands = HUMAN_HELMERS.flatMap(hh => METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[hh] && m.humanMPI[hh].src)
      .map(m => ({ who: `${hh} ${m.key}`, flagged: m.humanMPI[hh].srcAiText === true, src: m.humanMPI[hh].src })));
    const tipOf = b => (b.flagged ? prefix : "") + b.src;
    const wanted = new Set(bands.map(tipOf));
    const hints = [...document.querySelectorAll(".mpi-card-src")];
    for (const h of hints) {
      const tip = h.getAttribute("data-tip");
      if (!wanted.has(tip)) bad.push(`a card hint's tooltip ${JSON.stringify(String(tip).slice(0, 50))} is no band's src as a tooltip shows it (${AI_TEXT_PREFIX.trim()} before an AI src, the human's src as written)`);
      if (h.getAttribute("aria-label") !== tip) bad.push(`a card hint is named ${JSON.stringify(String(h.getAttribute("aria-label")).slice(0, 50))}, not its tooltip`);
    }
    // 6. No label twice.
    const twice = prefix.repeat(2).trimEnd();
    for (const h of hints) if (h.getAttribute("data-tip").startsWith(twice)) bad.push(`a card hint's tooltip opens with the AI label twice: ${JSON.stringify(h.getAttribute("data-tip").slice(0, 50))}`);
    for (const tr of rows) {
      const ai = tr.querySelector(".narrative-fault .ai-text");
      if (ai !== null && ai.textContent.startsWith(twice)) bad.push(`row ${tr.querySelector(".narrative-fault").id}: the fault line's AI text opens with the AI label twice`);
    }
    const shown = new Set(hints.map(h => h.getAttribute("data-tip")));
    for (const b of bands.filter(x => x.flagged)) if (!shown.has(tipOf(b))) bad.push(`${b.who}: its AI src, labelled, is no card hint's tooltip`);
    // 7. The label twice in a row in any tooltip or name on the page.
    const texts = [...document.querySelectorAll("[data-tip]")].map(e => ({ attr: "data-tip", v: e.getAttribute("data-tip") }))
      .concat([...document.querySelectorAll("[aria-label]")].map(e => ({ attr: "aria-label", v: e.getAttribute("aria-label") })));
    for (const t of texts.filter(x => x.v.includes(twice))) {
      const at = t.v.indexOf(twice);
      bad.push(`an element's ${t.attr} holds the AI label twice in a row: ${JSON.stringify(t.v.slice(Math.max(0, at - 40), at + twice.length + 30))}`);
    }
    return { rows: rows.length, hints: hints.length, aiHints: hints.filter(h => h.getAttribute("data-tip").startsWith(prefix)).length, flagged: bands.filter(b => b.flagged).length,
      texts: texts.length, labelled: texts.filter(x => x.v.includes(prefix)).length, bad };
  }, MARKUP);
  if (r.rows < 100) problems.push(`[${engine}] ${r.rows} incident rows; want the default view's table (over 1,000)`);
  if (r.hints === 0 || r.flagged === 0) problems.push(`[${engine}] ${r.hints} card hints and ${r.flagged} flagged srcs; want some of each`);
  for (const b of r.bad) problems.push(`[${engine}] ${b}`);
  for (const e of page.errors) problems.push(`[${engine}] page error: ${e}`);
  counts.push(`${engine} ${r.rows} rows, ${r.hints} hints (${r.aiHints} labelled), ${r.texts} tooltips and names (${r.labelled} holding the label)`);
  await browser.close();
}
await server.close();

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load the page in Chromium, Firefox and WebKit; read every incident row's fault line (.narrative-fault, shown under the opened narrative), its markup, computed colours and decorations, and its fault cell's tooltip; render the table once with markup in the first row's reasoning; read every card [?] hint's tooltip and name; read every tooltip (data-tip) and every element's name (aria-label) on the page.
Expectata: each fault line holds exactly one .ai-text element, holding AI_TEXT_PREFIX and the incident's reasoning and nothing else of the line; the line's text is the label, a space and the fault cell's tooltip; the reasoning is drawn in the AI ink with a dotted underline and the line's other runs are not, under no dotted underline; markup in a reasoning renders as text inside the one .ai-text element, and the table is as before once restored; each card hint's tooltip and name are a band's src, AI_TEXT_PREFIX before it exactly when the band carries srcAiText, and each AI src is some hint's; no tooltip or fault line opens with the label twice, and no tooltip or name on the page holds it twice in a row anywhere; no page errors.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log(`qual pass: ${counts.join("; ")}; every fault line's reasoning renders as labelled AI text (the AI ink, a dotted underline) and its tooltip holds the same label; card hints label exactly the AI srcs; markup in a reasoning renders escaped; no tooltip or name holds the label twice in a row`);

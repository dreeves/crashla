// Text an AI wrote renders as AI text (style.css .ai-text: green, dotted
// underline; the VMT sources table's legend: "green text = AI-generated"),
// in the human benchmark derivations table too (decision 23(b) of the
// 2026-11-01 open questions, the human's, 2026-11-02; audit copy-8), and the
// human's text renders plain. A band's src (METRIC_DEFS humanMPI) is the
// human's unless it carries srcAiText: true. Five srcs are AI text:
//  - the AV-cities fatality band's, which the human committed labelled
//    "Claude:" (f75b903, 2026-08-31), in place of the Latin an agent wrote
//    on 2026-08-28 (the label dropped from its text on 2026-11-03 at the
//    human's word, since a card tooltip opens every AI src with the app's
//    AI_TEXT_PREFIX; ai-text-labels.qual);
//  - the AV-cities injury, airbag and serious-injury+ bands' Waymo-hub
//    derivations, which an agent wrote in English on 2026-08-22 (6ef93d6,
//    the repin to the Waymo hub's per-area rates) and agents have since
//    edited in their figures (9c41e6d, 396df3c, db984d8) and in "six
//    cities" -> "five areas" (9c41e6d);
//  - the US-average fatality band's, which the human labelled "Claude:" on
//    2026-11-03 (open question 33) and took the label off again in 80b73d9,
//    the commit that gave it the flag.
// The first four are decision 23(b)'s. On 2026-11-03 the human reviewed each
// src that day's to-do pass marked as an agent's in whole or in part (open
// question 33; a DONE comment above each in crashla.js's METRIC_DEFS gives
// its history, but for the US-average injury and fatality srcs, whose to-do
// comments the review removed, the fatality one in favour of the "Claude:"
// label). That pass missed one, the US-average all-incidents src
// (agent English with the human's caveat), which the human reviewed later
// that day without an edit, so it renders plain under a DONE comment like
// the others; every other src is the human's text. The two
// srcNotes, the at-fault injury bands' notes on the 94%, are the human's
// translations (f75b903, 2026-08-31) and render plain since 2026-11-03 (the
// human's answer on open question 33; until then the table wrapped every
// srcNote in .ai-text).
// So:
//  1. those five bands carry srcAiText: true, and no other band does;
//  2. srcAiText is absent or true, nothing else (anti-Postel: a false or a
//     string would read as a flag and mean nothing), and srcNote is absent or
//     a non-empty string;
//  3. every derivation cell renders its src as the flag says: inside one
//     .ai-text span when flagged, as plain text otherwise, its links after it
//     either way (the links are not AI text);
//  4. every srcNote renders as plain text at its cell's end, after the links'
//     closing parenthesis, and no cell holds an .ai-text span but a flagged
//     src's own;
//  5. no band but the two at-fault injury bands carries a srcNote: a srcNote
//     renders plain, as the human's text, so a new one turns this red until
//     its author is known (an agent's would read as the human's);
//  6. markup characters render escaped in a flagged src, an unflagged src and
//     a srcNote: for one render, two bands get a synthetic src and srcNote
//     holding them, one band flagged and one not (no srcNote today holds &,
//     < or >, and no flagged src does, so checks 3 and 4 alone cannot see a
//     dropped escHtml on those branches);
//  7. nothing but the .ai-text rule paints the AI ink: in style.css,
//     var(--ai-ink) appears only as that rule's colour and the token's value
//     only in the token's definition, and the table's markup carries no style
//     attribute, so no other rule and no inline style draws the table's plain
//     text in the AI ink (ai-derivation-colors.qual checks the colours the
//     browsers draw, whatever sets them).
// The srcs' and srcNotes' words are not checked (no wording pins, 2026-10-28).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { stripComments, rules, decls } from "./css-parse.mjs";

class EscStub {
  set textContent(v) {
    this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
const ctx = vm.createContext({ console, Math, Number, Float64Array, Object, String, Map, JSON,
  document: { getElementById() { return null; }, createElement() { return new EscStub(); } } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const AI_WRITTEN = [["HumansAV", "injury"], ["HumansAV", "airbag"], ["HumansAV", "seriousInjury"], ["HumansAV", "fatality"],
  ["HumansUS", "fatality"]];
// The bands that may carry a srcNote, each the human's (check 5).
const NOTED = [["HumansAV", "atfaultInjury"], ["HumansUS", "atfaultInjury"]];

const app = JSON.parse(vm.runInContext(`JSON.stringify({
  bands: HUMAN_HELMERS.flatMap(hh => METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[hh]).map(m => ({
    cohort: hh, metric: m.key, label: helmerLabel(hh), cardLabel: m.cardLabel,
    src: m.humanMPI[hh].src, srcEsc: escHtml(m.humanMPI[hh].src),
    flag: m.humanMPI[hh].srcAiText === undefined ? "absent" : m.humanMPI[hh].srcAiText,
    noteType: m.humanMPI[hh].srcNote === undefined ? "absent" : typeof m.humanMPI[hh].srcNote,
    note: m.humanMPI[hh].srcNote === undefined ? null : m.humanMPI[hh].srcNote,
    noteEsc: m.humanMPI[hh].srcNote === undefined ? null : escHtml(m.humanMPI[hh].srcNote),
  }))),
  table: renderHumanBenchmarkTable(),
})`, ctx));

const problems = [];
// 1. The five AI-text srcs are flagged, and no other src is.
for (const [cohort, metric] of AI_WRITTEN) {
  const b = app.bands.find(x => x.cohort === cohort && x.metric === metric);
  if (b === undefined) problems.push(`no ${cohort} ${metric} band`);
  else if (b.flag !== true) problems.push(`${cohort} ${metric}: srcAiText is ${JSON.stringify(b.flag)}, want true (its src is AI text)`);
}
for (const b of app.bands) {
  const listed = AI_WRITTEN.some(([cohort, metric]) => cohort === b.cohort && metric === b.metric);
  if (b.flag === true && !listed) problems.push(`${b.cohort} ${b.metric}: srcAiText is true, but its src is not one of the ${AI_WRITTEN.length} AI-text srcs AI_WRITTEN lists (list it there if its src is AI text; every other src is the human's text, each agent-written one reviewed by the human on 2026-11-03, open question 33)`);
}
// 2. The flag is absent or true; a srcNote is absent or a non-empty string.
for (const b of app.bands) {
  if (b.flag !== "absent" && b.flag !== true) problems.push(`${b.cohort} ${b.metric}: srcAiText is ${JSON.stringify(b.flag)}; it must be absent or true`);
  if (b.noteType !== "absent" && !(b.noteType === "string" && b.note !== "")) problems.push(`${b.cohort} ${b.metric}: srcNote is ${JSON.stringify(b.note)} (${b.noteType}); it must be absent or a non-empty string`);
}
// 3. Each derivation cell renders its src as its flag says. A row is the
// cohort's label, the metric's card label, two figures, then the cell.
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Where a cell first parts from what it should open (or end) with, for the
// Resultata: up to 30 characters before that point and 50 after it, both
// ways (fewer where the point is near an end).
const around = (got, want, fromEnd) => {
  const g = fromEnd ? [...got].reverse().join("") : got, w = fromEnd ? [...want].reverse().join("") : want;
  let i = 0;
  while (i < g.length && i < w.length && g[i] === w[i]) i++;
  const cut = x => { const piece = x.slice(Math.max(0, i - 30), i + 50); return fromEnd ? [...piece].reverse().join("") : piece; };
  return `${JSON.stringify(cut(g))}; want ${JSON.stringify(cut(w))}`;
};
// The derivation cell may carry attributes after its class (check 7 names a
// style attribute itself; until 2026-11-03 any attribute there made every
// row vanish from this match, which buried that check's finding).
const rowsOf = table => [...table.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td class="num">[^<]*<\/td><td class="num">[^<]*<\/td><td class="derivation"[^>]*>([\s\S]*?)<\/td><\/tr>/g)]
  .map(m => ({ label: m[1], cardLabel: m[2], cell: m[3] }));
const rows = rowsOf(app.table);
if (rows.length !== app.bands.length) problems.push(`the derivations table has ${rows.length} rows, the bands number ${app.bands.length}`);
const AI_SPAN = '<span class="ai-text">';
const spanCount = cell => cell.split(AI_SPAN).length - 1;
let notes = 0;
for (const b of app.bands) {
  const row = rows.filter(r => r.label === esc(b.label) && r.cardLabel === esc(b.cardLabel));
  if (row.length !== 1) { problems.push(`${b.cohort} ${b.metric}: ${row.length} rows in the derivations table`); continue; }
  const cell = row[0].cell;
  const want = b.flag === true ? `${AI_SPAN}${b.srcEsc}</span> (` : `${b.srcEsc} (`;
  if (!cell.startsWith(want)) problems.push(`${b.cohort} ${b.metric}: the cell's opening parts from its src there: ${around(cell, want, false)} (${b.flag === true ? "its src in one .ai-text span" : "its src as plain text"}, then its links)`);
  if (b.flag !== true && cell.slice(0, b.srcEsc.length + 2).includes('class="ai-text"')) problems.push(`${b.cohort} ${b.metric}: a human src renders as AI text`);
  // 4. A srcNote is plain text at the cell's end, after the links' closing
  // parenthesis; the cell's only .ai-text span, if any, is a flagged src's.
  // (A src's or note's text cannot hold "<span", which escaping makes
  // "&lt;span", so every AI_SPAN counted is markup; check 6 tests that.)
  if (b.noteType === "string") {
    notes++;
    const tail = `) ${b.noteEsc}`;
    if (!cell.endsWith(tail)) problems.push(`${b.cohort} ${b.metric}: the cell's end parts from its srcNote there: ${around(cell, tail, true)} (its srcNote as plain text, after its links' closing parenthesis)`);
  }
  const spans = spanCount(cell);
  const wantSpans = b.flag === true ? 1 : 0;
  if (spans !== wantSpans) problems.push(`${b.cohort} ${b.metric}: the cell holds ${spans} .ai-text spans, want ${wantSpans} (${b.flag === true ? "its flagged src's only" : "its src is the human's"}${b.noteType === "string" ? "; its srcNote renders plain" : ""})`);
}

// 5. Only the bands NOTED lists carry a srcNote. A srcNote renders plain, as
// the human's text, so a note on any other band waits on its author.
for (const b of app.bands) {
  const listed = NOTED.some(([cohort, metric]) => cohort === b.cohort && metric === b.metric);
  if (b.noteType !== "absent" && !listed) problems.push(`${b.cohort} ${b.metric}: carries a srcNote, but only the ${NOTED.length} bands NOTED lists may (a srcNote renders plain, as the human's text: list the band there once its note is known to be the human's)`);
}

// 6. Escaping, on synthetic text. The table's first two bands get a src and
// a srcNote holding markup characters (one of them an .ai-text span's own
// markup) for one render, the first band flagged and the second not; both
// bands are restored after it.
const MARKUP = '<span class="ai-text">x</span> & <b>y</b> > z';
if (app.bands.length < 2) problems.push(`check 6 needs two bands; there are ${app.bands.length}`);
else {
  const picks = [[app.bands[0], true], [app.bands[1], false]];
  const synTable = vm.runInContext(`(() => {
    const picks = ${JSON.stringify(picks.map(([b, flagged]) => [b.cohort, b.metric, flagged]))};
    const saved = picks.map(([cohort, metric]) => { const h = METRIC_BY_KEY[metric].humanMPI[cohort]; return [h, { ...h }]; });
    try {
      picks.forEach(([, , flagged], i) => {
        const h = saved[i][0];
        h.src = ${JSON.stringify(MARKUP)};
        h.srcNote = ${JSON.stringify(MARKUP)};
        if (flagged) h.srcAiText = true; else delete h.srcAiText;
      });
      return renderHumanBenchmarkTable();
    } finally {
      for (const [h, orig] of saved) { for (const k of Object.keys(h)) delete h[k]; Object.assign(h, orig); }
    }
  })()`, ctx);
  const synRows = rowsOf(synTable);
  for (const [b, flagged] of picks) {
    const who = `synthetic markup on ${b.cohort} ${b.metric} (${flagged ? "flagged" : "unflagged"})`;
    const row = synRows.filter(r => r.label === esc(b.label) && r.cardLabel === esc(b.cardLabel));
    if (row.length !== 1) { problems.push(`${who}: ${row.length} rows in the derivations table`); continue; }
    const cell = row[0].cell;
    const head = flagged ? `${AI_SPAN}${esc(MARKUP)}</span> (` : `${esc(MARKUP)} (`;
    if (!cell.startsWith(head)) problems.push(`${who}: the cell's opening parts from the escaped src there: ${around(cell, head, false)}`);
    const tail = `) ${esc(MARKUP)}`;
    if (!cell.endsWith(tail)) problems.push(`${who}: the cell's end parts from the escaped srcNote there: ${around(cell, tail, true)}`);
    if (spanCount(cell) !== (flagged ? 1 : 0)) problems.push(`${who}: the cell holds ${spanCount(cell)} .ai-text spans, want ${flagged ? "1, the flagged src's own" : "none"} (the text's own "<span" renders escaped, and the srcNote plain)`);
    if (cell.includes("<b>")) problems.push(`${who}: the cell holds a raw <b> tag from the text`);
  }
  // The bands are as they were: the table renders as before the synthetic one.
  if (vm.runInContext("renderHumanBenchmarkTable()", ctx) !== app.table) problems.push("check 6 left its synthetic text in the bands: the table renders differently after it");
}

// 7. Only the .ai-text rule paints the AI ink.
const css = stripComments(fs.readFileSync("style.css", "utf8"));
const cssRules = rules(css);
const declarations = body => body.split(";").map(s => s.trim()).filter(s => s !== "").map(s => {
  const at = s.indexOf(":");
  return at < 0 ? { prop: s, value: "" } : { prop: s.slice(0, at).trim().toLowerCase(), value: s.slice(at + 1).trim() };
});
const inkUses = cssRules.flatMap(r => declarations(r.body).filter(d => /var\(\s*--ai-ink\s*[,)]/.test(d.value))
  .map(d => ({ sel: r.sel, context: r.context, prop: d.prop, value: d.value })));
const wantUse = [{ sel: ".ai-text", context: [], prop: "color", value: "var(--ai-ink)" }];
if (JSON.stringify(inkUses) !== JSON.stringify(wantUse)) problems.push(`style.css: var(--ai-ink) is used by ${JSON.stringify(inkUses)}; want only the top-level .ai-text rule's colour, ${JSON.stringify(wantUse)}`);
const inkDefs = cssRules.flatMap(r => decls(r.body, "--ai-ink").map(value => ({ sel: r.sel, context: r.context, value })));
if (inkDefs.length === 0) problems.push("style.css: no rule defines --ai-ink");
for (const def of inkDefs) {
  const hex = /^#([0-9a-f]{6})$/i.exec(def.value);
  if (hex === null) { problems.push(`style.css: --ai-ink is ${JSON.stringify(def.value)} in ${def.sel}; check 7 reads a six-digit hex value`); continue; }
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const hexUses = [...css.matchAll(new RegExp(def.value, "gi"))].length;
  const hexDefs = inkDefs.filter(d => d.value.toLowerCase() === def.value.toLowerCase()).length;
  if (hexUses !== hexDefs) problems.push(`style.css: the AI ink's value ${def.value} appears ${hexUses} times, ${hexDefs} of them --ai-ink's definitions; want it nowhere else (a rule could paint the AI ink without the token)`);
  const rgbUses = [...css.matchAll(new RegExp(`rgba?\\(\\s*${r}\\s*[, ]\\s*${g}\\s*[, ]\\s*${b}\\b`, "gi"))].length;
  if (rgbUses !== 0) problems.push(`style.css: the AI ink's value appears ${rgbUses} times as rgb(${r}, ${g}, ${b}); want it nowhere but --ai-ink's definition`);
}
if (/\sstyle\s*=/i.test(app.table)) problems.push("the derivations table's markup carries a style attribute; want none (an inline colour would bypass .ai-text)");

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render the human benchmark derivations table (renderHumanBenchmarkTable), read each band's srcAiText and srcNote, render it once more with synthetic markup in two bands' src and srcNote, and read style.css's uses of the AI ink (--ai-ink).
Expectata: the AV-cities injury, airbag, serious-injury+ and fatality bands and the US-average fatality band, whose srcs are AI text, carry srcAiText: true, and no other band does; every band's flag is absent or true and its srcNote absent or a non-empty string; each derivation cell renders a flagged src inside one .ai-text span and an unflagged one as plain text, its links after it; each srcNote renders as plain text at its cell's end, after the links; no cell holds an .ai-text span but a flagged src's own; only the two at-fault injury bands carry a srcNote; markup in a flagged src, an unflagged src and a srcNote renders escaped; only the .ai-text rule paints the AI ink, and the table carries no inline style.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log(`qual pass: ${AI_WRITTEN.length} AI-text derivation srcs render as AI text; the other ${app.bands.length - AI_WRITTEN.length} bands' srcs as plain text; ${notes} srcNotes render plain, on the ${NOTED.length} bands NOTED lists only; synthetic markup renders escaped in a flagged src, an unflagged src and a srcNote; only .ai-text paints the AI ink`);

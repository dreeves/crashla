// Text an AI wrote renders as AI text (style.css .ai-text: green, dotted
// underline; the VMT sources table's legend: "green text = AI-generated"),
// in the human benchmark derivations table too (decision 23(b) of the
// 2026-11-01 open questions, the human's, 2026-11-02; audit copy-8), and the
// human's text renders plain. A band's src (METRIC_DEFS humanMPI) is the
// human's unless it carries srcAiText: true. Five srcs are AI text:
//  - the AV-cities fatality band's, which the human committed labelled
//    "Claude:" (f75b903, 2026-08-31), in place of the Latin an agent wrote
//    on 2026-08-28;
//  - the AV-cities injury, airbag and serious-injury+ bands' Waymo-hub
//    derivations, which an agent wrote in English on 2026-08-22 (6ef93d6,
//    the repin to the Waymo hub's per-area rates) and agents have since
//    edited in their figures (9c41e6d, 396df3c, db984d8) and in "six
//    cities" -> "five areas" (9c41e6d);
//  - the US-average fatality band's, which the human labelled "Claude:" on
//    2026-11-03 (open question 33).
// The first four are decision 23(b)'s. Every other src is the human's text:
// on 2026-11-03 the human reviewed each one an agent wrote in whole or in
// part (open question 33; a DONE comment above each in crashla.js's
// METRIC_DEFS gives its history, but for the US-average injury src, whose
// to-do comment the review removed). The two srcNotes, the at-fault injury
// bands' notes on the 94%, are the human's translations (f75b903,
// 2026-08-31) and render plain since 2026-11-03 (the human's answer on open
// question 33; until then the table wrapped every srcNote in .ai-text).
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
//     src's own.
// The srcs' and srcNotes' words are not checked (no wording pins, 2026-10-28).
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

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
  if (b.flag === true && !listed) problems.push(`${b.cohort} ${b.metric}: srcAiText is true, but its src is not one of the ${AI_WRITTEN.length} AI-text srcs (every other src is the human's reviewed text, 2026-11-03)`);
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
// Resultata: the 80 characters from just before that point, both ways.
const around = (got, want, fromEnd) => {
  const g = fromEnd ? [...got].reverse().join("") : got, w = fromEnd ? [...want].reverse().join("") : want;
  let i = 0;
  while (i < g.length && i < w.length && g[i] === w[i]) i++;
  const cut = x => { const piece = x.slice(Math.max(0, i - 30), i + 50); return fromEnd ? [...piece].reverse().join("") : piece; };
  return `${JSON.stringify(cut(g))}; want ${JSON.stringify(cut(w))}`;
};
const rows = [...app.table.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td class="num">[^<]*<\/td><td class="num">[^<]*<\/td><td class="derivation">([\s\S]*?)<\/td><\/tr>/g)]
  .map(m => ({ label: m[1], cardLabel: m[2], cell: m[3] }));
if (rows.length !== app.bands.length) problems.push(`the derivations table has ${rows.length} rows, the bands number ${app.bands.length}`);
const AI_SPAN = '<span class="ai-text">';
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
  // "&lt;span", so every AI_SPAN counted is markup.)
  if (b.noteType === "string") {
    notes++;
    const tail = `) ${b.noteEsc}`;
    if (!cell.endsWith(tail)) problems.push(`${b.cohort} ${b.metric}: the cell's end parts from its srcNote there: ${around(cell, tail, true)} (its srcNote as plain text, after its links' closing parenthesis)`);
  }
  const spans = cell.split(AI_SPAN).length - 1;
  const wantSpans = b.flag === true ? 1 : 0;
  if (spans !== wantSpans) problems.push(`${b.cohort} ${b.metric}: the cell holds ${spans} .ai-text spans, want ${wantSpans} (${b.flag === true ? "its flagged src's only" : "its src is the human's"}${b.noteType === "string" ? "; its srcNote renders plain" : ""})`);
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render the human benchmark derivations table (renderHumanBenchmarkTable) and read each band's srcAiText and srcNote.
Expectata: the AV-cities injury, airbag, serious-injury+ and fatality bands and the US-average fatality band, whose srcs are AI text, carry srcAiText: true, and no other band does; every band's flag is absent or true and its srcNote absent or a non-empty string; each derivation cell renders a flagged src inside one .ai-text span and an unflagged one as plain text, its links after it; each srcNote renders as plain text at its cell's end, after the links; no cell holds an .ai-text span but a flagged src's own.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log(`qual pass: ${AI_WRITTEN.length} AI-text derivation srcs render as AI text; the other ${app.bands.length - AI_WRITTEN.length} bands' srcs as plain text; ${notes} srcNotes render plain`);

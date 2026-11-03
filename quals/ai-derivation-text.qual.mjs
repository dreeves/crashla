// Text an AI wrote renders as AI text (style.css .ai-text: green, dotted
// underline; the VMT sources table's legend: "green text = AI-generated"),
// in the human benchmark derivations table too (decision 23(b) of the
// 2026-11-01 open questions, the human's, 2026-11-02; audit copy-8). A
// band's src (METRIC_DEFS humanMPI) is the human's unless it carries
// srcAiText: true. Four srcs are AI text:
//  - the AV-cities fatality band's, which the human committed labelled
//    "Claude:" (f75b903, 2026-08-31), in place of the Latin an agent wrote
//    on 2026-08-28;
//  - the AV-cities injury, airbag and serious-injury+ bands' Waymo-hub
//    derivations, which an agent wrote in English on 2026-08-22 (6ef93d6,
//    the repin to the Waymo hub's per-area rates) and agents have since
//    edited in their figures (9c41e6d, 396df3c, db984d8) and in "six
//    cities" -> "five areas" (9c41e6d).
// So:
//  1. those four bands carry srcAiText: true;
//  2. srcAiText is absent or true, nothing else (anti-Postel: a false or a
//     string would read as a flag and mean nothing);
//  3. every derivation cell renders its src as the flag says: inside one
//     .ai-text span when flagged, as plain text otherwise, its links after it
//     either way (the links are not AI text).
// The srcs' words are not checked (no wording pins, 2026-10-28).
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

const AI_WRITTEN = [["HumansAV", "injury"], ["HumansAV", "airbag"], ["HumansAV", "seriousInjury"], ["HumansAV", "fatality"]];

const app = JSON.parse(vm.runInContext(`JSON.stringify({
  bands: HUMAN_HELMERS.flatMap(hh => METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[hh]).map(m => ({
    cohort: hh, metric: m.key, label: helmerLabel(hh), cardLabel: m.cardLabel,
    src: m.humanMPI[hh].src, srcEsc: escHtml(m.humanMPI[hh].src),
    flag: m.humanMPI[hh].srcAiText === undefined ? "absent" : m.humanMPI[hh].srcAiText,
  }))),
  table: renderHumanBenchmarkTable(),
})`, ctx));

const problems = [];
// 1. The four AI-text srcs are flagged.
for (const [cohort, metric] of AI_WRITTEN) {
  const b = app.bands.find(x => x.cohort === cohort && x.metric === metric);
  if (b === undefined) problems.push(`no ${cohort} ${metric} band`);
  else if (b.flag !== true) problems.push(`${cohort} ${metric}: srcAiText is ${JSON.stringify(b.flag)}, want true (its src is AI text)`);
}
// 2. The flag is absent or true.
for (const b of app.bands) {
  if (b.flag !== "absent" && b.flag !== true) problems.push(`${b.cohort} ${b.metric}: srcAiText is ${JSON.stringify(b.flag)}; it must be absent or true`);
}
// 3. Each derivation cell renders its src as its flag says. A row is the
// cohort's label, the metric's card label, two figures, then the cell.
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rows = [...app.table.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td class="num">[^<]*<\/td><td class="num">[^<]*<\/td><td class="derivation">([\s\S]*?)<\/td><\/tr>/g)]
  .map(m => ({ label: m[1], cardLabel: m[2], cell: m[3] }));
if (rows.length !== app.bands.length) problems.push(`the derivations table has ${rows.length} rows, the bands number ${app.bands.length}`);
for (const b of app.bands) {
  const row = rows.filter(r => r.label === esc(b.label) && r.cardLabel === esc(b.cardLabel));
  if (row.length !== 1) { problems.push(`${b.cohort} ${b.metric}: ${row.length} rows in the derivations table`); continue; }
  const cell = row[0].cell;
  const want = b.flag === true ? `<span class="ai-text">${b.srcEsc}</span> (` : `${b.srcEsc} (`;
  if (!cell.startsWith(want)) problems.push(`${b.cohort} ${b.metric}: the cell opens ${JSON.stringify(cell.slice(0, 80))}; want ${JSON.stringify(want.slice(0, 80))} (${b.flag === true ? "its src in one .ai-text span" : "its src as plain text"}, then its links)`);
  if (b.flag !== true && cell.slice(0, b.srcEsc.length + 2).includes('class="ai-text"')) problems.push(`${b.cohort} ${b.metric}: a human src renders as AI text`);
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: render the human benchmark derivations table (renderHumanBenchmarkTable) and read each band's srcAiText.
Expectata: the AV-cities injury, airbag, serious-injury+ and fatality bands, whose srcs are AI text, carry srcAiText: true; every band's flag is absent or true; each derivation cell renders a flagged src inside one .ai-text span and an unflagged one as plain text, its links after it.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 8).join("\n")}`);
console.log(`qual pass: ${AI_WRITTEN.length} AI-text derivation srcs render as AI text; the other ${app.bands.length - AI_WRITTEN.length} bands' srcs as plain text`);

import assert from "node:assert/strict";
import fs from "node:fs";

// GitHub Pages runs every .md file in the repo through Jekyll (kramdown), so
// AGENTS.md is also served as /AGENTS.html. Raw HTML in the ledger's prose is
// passed through as markup: a literal <title> opened a hidden <title> that
// swallowed 1,810 characters of a ledger entry, a literal <font
// color="green"> turned 3,223 characters green, and placeholders such as
// <growth metric> or <url> vanished (audit #99). Spec: below the
// agent-scratchpad marker (the part agents write), every HTML-tag-like token
// sits inside a backtick code span, where kramdown prints it as text. The
// human's part above the marker is not checked.
//
// The tag pattern is a superset of kramdown's span-level HTML (a "<" or "</"
// followed by a tag name, "<!--", "<?"); autolinks (<https://...>, <a@b.c>)
// render as links and are allowed. Code spans follow CommonMark: a run of N
// backticks opens a span that the next run of exactly N backticks closes; an
// unmatched run is literal. Spans are found per block: a blank line ends one,
// and a list item or a heading starts one, since a code span never crosses
// them (a backtick left open in one ledger entry cannot pair with one in the
// next entry). Fenced code blocks are skipped.

const MARKER = "# Agent Scratchpad (human edits only above this line)";
const text = fs.readFileSync("AGENTS.md", "utf8");
const lines = text.split("\n");
const markerAt = lines.findIndex(l => l.trim() === MARKER);
assert.ok(markerAt >= 0,
  `Replicata: look for the line "${MARKER}" in AGENTS.md.
Expectata: it is there; the ledger below it is what this qual checks.
Resultata: not found.`);

function codeMask(s) {
  const mask = new Array(s.length).fill(false);
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) { i += 2; continue; }
    if (s[i] !== "`") { i++; continue; }
    let j = i;
    while (j < s.length && s[j] === "`") j++;
    const run = j - i;
    let k = j, close = -1;
    while (k < s.length) {
      if (s[k] !== "`") { k++; continue; }
      let m = k;
      while (m < s.length && s[m] === "`") m++;
      if (m - k === run) { close = k; break; }
      k = m;
    }
    if (close < 0) { i = j; continue; }
    for (let q = i; q < close + run; q++) mask[q] = true;
    i = close + run;
  }
  return mask;
}

const STARTS_BLOCK = /^\s*([-*+]|\d{1,9}[.)])\s|^\s{0,3}#{1,6}(\s|$)/;
const blocks = [];
let cur = [], curStart = 0, inFence = false;
lines.slice(markerAt + 1).forEach((line, idx) => {
  const lineno = markerAt + 2 + idx;
  if (/^\s*(```|~~~)/.test(line)) {
    inFence = !inFence;
    if (cur.length) blocks.push({start: curStart, lines: cur});
    cur = [];
    return;
  }
  if (inFence) return;
  const blank = line.trim() === "";
  if (blank || STARTS_BLOCK.test(line)) {
    if (cur.length) blocks.push({start: curStart, lines: cur});
    cur = [];
    if (blank) return;
  }
  if (!cur.length) curStart = lineno;
  cur.push(line);
});
if (cur.length) blocks.push({start: curStart, lines: cur});
assert.ok(!inFence, "AGENTS.md: a fenced code block below the marker is never closed");

const TAG = /<(\/?[A-Za-z][A-Za-z0-9:_.-]*)(?=[\s/>])|<!--|<\?/g;
const AUTOLINK = /^<((mailto|https?|ftps?):[^>]+?|[-.\w]+@[-\w]+(?:\.[-\w]+)*\.[a-z]+)>/;
const raw = [];
for (const b of blocks) {
  const s = b.lines.join("\n");
  const mask = codeMask(s);
  for (const m of s.matchAll(TAG)) {
    if (mask[m.index] || AUTOLINK.test(s.slice(m.index))) continue;
    const before = s.slice(0, m.index);
    const line = b.start + (before.match(/\n/g) || []).length;
    const end = s.indexOf(">", m.index);
    raw.push(`AGENTS.md:${line}: ${s.slice(m.index, end >= 0 && end - m.index < 120 ? end + 1 : m.index + 40)}`);
  }
}
assert.deepEqual(raw, [],
  `Replicata: open https://teslapologetics.dreev.es/AGENTS.html (Jekyll's render of AGENTS.md) and read the ledger.
Expectata: every entry renders as written; each literal HTML tag below the agent-scratchpad marker is wrapped in backticks.
Resultata: ${raw.length} raw tag(s) outside code spans:\n  ${raw.join("\n  ")}`);

console.log("qual pass: AGENTS.md's ledger quotes every HTML tag in backticks, so /AGENTS.html renders it as written");

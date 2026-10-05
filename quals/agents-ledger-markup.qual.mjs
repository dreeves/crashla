import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
// Extended 2026-10-04 (second audit, #73) to every Markdown file GitHub Pages
// serves, each checked whole: data/README.md's 'labels each release "through
// <date>"' opened an unknown <date> element at /data/, so the word vanished
// and the paragraph's three code spans showed literal backticks. Served means
// what Jekyll renders with no _config.yml: every .md / .markdown / .mkd /
// .mkdn / .mdown file outside dot- or underscore-named paths, node_modules
// and vendor (Jekyll's default excludes). README.md is the human's own file
// and IGNOREME.md holds human lines too; both are clean today, and a raw tag
// there would turn this qual red for the human to see.
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
const agentsLines = fs.readFileSync("AGENTS.md", "utf8").split("\n");
const markerAt = agentsLines.findIndex(l => l.trim() === MARKER);
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
const TAG = /<(\/?[A-Za-z][A-Za-z0-9:_.-]*)(?=[\s/>])|<!--|<\?/g;
const AUTOLINK = /^<((mailto|https?|ftps?):[^>]+?|[-.\w]+@[-\w]+(?:\.[-\w]+)*\.[a-z]+)>/;

// The raw tags in <file> from line <first> (0-based) on, as "file:line: tag".
function rawTags(file, first) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const blocks = [];
  let cur = [], curStart = 0, inFence = false;
  lines.slice(first).forEach((line, idx) => {
    const lineno = first + 1 + idx;
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
  assert.ok(!inFence, `${file}: a fenced code block is never closed`);
  const raw = [];
  for (const b of blocks) {
    const s = b.lines.join("\n");
    const mask = codeMask(s);
    for (const m of s.matchAll(TAG)) {
      if (mask[m.index] || AUTOLINK.test(s.slice(m.index))) continue;
      const before = s.slice(0, m.index);
      const line = b.start + (before.match(/\n/g) || []).length;
      const end = s.indexOf(">", m.index);
      raw.push(`${file}:${line}: ${s.slice(m.index, end >= 0 && end - m.index < 120 ? end + 1 : m.index + 40)}`);
    }
  }
  return raw;
}

// Every Markdown file Jekyll serves, relative to the repo root.
const MARKDOWN = /\.(md|markdown|mkd|mkdn|mdown)$/i;
const EXCLUDED_DIRS = new Set(["node_modules", "vendor"]);
function servedMarkdown(dir) {
  return fs.readdirSync(dir, {withFileTypes: true})
    .filter(e => !/^[._]/.test(e.name) && !EXCLUDED_DIRS.has(e.name))
    .flatMap(e => e.isDirectory() ? servedMarkdown(path.join(dir, e.name))
      : MARKDOWN.test(e.name) ? [path.join(dir, e.name)] : [])
    .map(p => p.replace(/^\.\//, ""));
}
const served = servedMarkdown(".").sort();
// The discovery must find the files GitHub Pages is known to serve (else a
// broken walk would check nothing and pass).
const KNOWN = ["AGENTS.md", "CLAUDE.md", "IGNOREME.md", "README.md", "data/README.md", "data/snapshots/README.md"];
const missing = KNOWN.filter(f => !served.includes(f));
assert.deepEqual(missing, [],
  `Replicata: list the repo's Markdown files that GitHub Pages serves (no dot- or underscore-named path, not node_modules or vendor).
Expectata: the list includes ${KNOWN.join(", ")}.
Resultata: missing ${JSON.stringify(missing)} (found ${JSON.stringify(served)}).`);

const raw = served.flatMap(f => rawTags(f, f === "AGENTS.md" ? markerAt + 1 : 0));
assert.deepEqual(raw, [],
  `Replicata: open each Markdown page GitHub Pages serves (https://teslapologetics.dreev.es/AGENTS.html, /IGNOREME.html, /data/, ...) and read it.
Expectata: every page renders as written; each literal HTML tag is wrapped in backticks (in AGENTS.md, below the agent-scratchpad marker).
Resultata: ${raw.length} raw tag(s) outside code spans:\n  ${raw.join("\n  ")}`);

console.log(`qual pass: ${served.length} served Markdown files (AGENTS.md's ledger, and ${served.length - 1} others whole) quote every HTML tag in backticks, so they render as written`);

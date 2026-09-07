import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, decls, onlyDecl } from "./css-parse.mjs";

// Generated tables: each pans inside its own box (so the phone page never
// scrolls sideways and the global sticky th has nothing to stick to), numeric
// cells are named rather than counted, and the sort direction is drawn.

const js = fs.readFileSync("crashla.js", "utf8");
// Commented-out renderers are the human's; they are not counted either way.
const liveJs = js.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(fs.readFileSync("style.css", "utf8"));
const parsed = rules(css);
const rule = sel => parsed.find(r => r.sel === sel && r.context.length === 0);

// --- 1. Every generated table sits in a .table-wrap ----------------------

const opens = (liveJs.match(/<table[\s>]/g) || []).length;
const wrapped = (liveJs.match(/<div class="table-wrap"><table[\s>]/g) || []).length;
const closes = (liveJs.match(/<\/table>/g) || []).length;
const closedWraps = (liveJs.match(/<\/table><\/div>/g) || []).length;
assert.ok(
  opens > 0 && opens === wrapped && closes === closedWraps,
  `Replicata: grep crashla.js (comments stripped) for <table and </table>.
Expectata: every opening tag is preceded by <div class="table-wrap"> and every
closing tag is followed by </div>.
Resultata: ${opens} <table, ${wrapped} wrapped; ${closes} </table>, ${closedWraps} closed wraps.`,
);
assert.equal(onlyDecl(rule(".table-wrap").body, "overflow-x", ".table-wrap"), "auto");
assert.equal(onlyDecl(rule(".table-scroll").body, "overscroll-behavior-x", ".table-scroll"), "contain",
  "a horizontal pan in the incident table must not trigger back-swipe");

// --- 2. Numeric cells are named, not positional ----------------------------

const positional = parsed.filter(r => /:nth-child\(/.test(r.sel) && /source-table|stress-table/.test(r.sel));
assert.deepEqual(positional.map(r => r.sel), [],
  `Replicata: grep style.css for :nth-child inside .source-table/.stress-table.
Expectata: none -- positional alignment right-aligned the text "Metric" column.
Resultata: ${JSON.stringify(positional.map(r => r.sel))}.`);
const num = rule("td.num, th.num");
assert.ok(num, "one td.num, th.num rule");
assert.equal(onlyDecl(num.body, "text-align", "td.num, th.num"), "right");
assert.equal(onlyDecl(num.body, "white-space", "td.num, th.num"), "nowrap");
for (const header of ["k", "MPI AV (median; 95%)", "Human MPI (AV cities)", "AV/human ratio",
                      "Judged fault", "Flip multiplier", "Low MPI", "High MPI"]) {
  assert.ok(liveJs.includes(`<th class="num">${header}</th>`),
    `Replicata: read the stress and derivation table headers in crashla.js.
Expectata: the numeric column header ${JSON.stringify(header)} carries class="num" so it aligns with its cells.
Resultata: it does not.`);
}
assert.equal((liveJs.match(/<td class="num">\$\{fmtCount\(stress\.av\.k\)\}<\/td>/g) || []).length, 2,
  "both stress tables mark the k cell numeric");
assert.ok(liveJs.includes('<td class="num">${fmtMiles(h.lo)}</td><td class="num">${fmtMiles(h.hi)}</td>'),
  "the derivation table marks Low and High MPI numeric");

// --- 3. Sort direction is drawn, never a glyph -----------------------------

assert.ok(!/[▲▼]/.test(js),
  `Replicata: grep crashla.js for U+25B2 / U+25BC.
Expectata: none -- the arrows are outside the web font's ranges and rendered
from whatever the OS fell back to; the indicator is a CSS triangle keyed on
aria-sort, like the section chevron.
Resultata: a triangle glyph is still emitted.`);
const asc = rule("th[aria-sort]::after");
const desc = rule('th[aria-sort="descending"]::after');
assert.ok(asc && desc, "th[aria-sort]::after and th[aria-sort=\"descending\"]::after rules exist");
assert.match(onlyDecl(asc.body, "border-bottom", "th[aria-sort]::after"), /currentColor$/);
assert.match(onlyDecl(desc.body, "border-top", 'th[aria-sort="descending"]::after'), /currentColor$/);
assert.equal(decls(asc.body, "content").length, 1);

console.log("qual pass: generated tables are wrapped, numeric cells are named, sort direction is drawn");

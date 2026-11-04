import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripComments, rules, decls, onlyDecl } from "./css-parse.mjs";
import { appScript, dataScript } from "./load-app.mjs";

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
// Each numeric column's header carries class="num" so it aligns with its
// cells. Read off the rendered sanity section (default window): in every
// table a header cell carries the class exactly when its column's body cells
// do, and in the three tables of figures (the stress table, the fault-flip
// table and the human benchmark derivations) the columns that carry it are
// exactly those whose cells are figures ("—" and "∞", which stand in for a
// figure, fit either kind of column). Until 2026-10-31 this looked for eight
// header words in crashla.js, which are the human's (audit 2026-10-30,
// QT-09).
{
  class Stub { constructor() { this._h = ""; } set textContent(v) { this._h = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } get textContent() { return this._h; } set innerHTML(v) { this._h = v; } get innerHTML() { return this._h; } }
  const nodes = new Map();
  const ctx = vm.createContext({ console, document: { getElementById: id => (nodes.has(id) || nodes.set(id, new Stub()), nodes.get(id)), createElement: () => new Stub() } });
  vm.runInContext(dataScript, ctx, { filename: "data.js" });
  vm.runInContext(appScript, ctx, { filename: "crashla.js" });
  const html = vm.runInContext(`incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
    fullMonthSeries = monthSeriesData();
    activeSeries = sliceSeries(fullMonthSeries, fullMonthSeries.months.indexOf(DEFAULT_START_MONTH), fullMonthSeries.months.length - 1);
    buildSanityChecks(); document.getElementById("sanity-checks").innerHTML`, ctx);
  const FIGURES = new Set(["sanity-stress", "sanity-fault-flip", "sanity-benchmarks"]);
  const isNum = attrs => /\bclass="[^"]*\bnum\b/.test(attrs);
  const kind = text => /^[\u2014\u221e]$/.test(text) ? "stand-in" : /^[\d.,;\s\u2013x\u221eKMBT]*\d[\d.,;\s\u2013x\u221eKMBT]*$/.test(text) ? "figure" : "text";
  const problems = [], seen = new Set();
  for (const m of html.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/g)) {
    const id = (/\bid="([^"]*)"/.exec(m[1]) || [])[1];
    seen.add(id);
    // The header cells and the body are read, never assumed (until
    // 2026-11-04 a table without a thead, or without a tbody, read as no
    // columns or no rows, and the comparisons below checked nothing of it).
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(m[2]), body = /<tbody>([\s\S]*?)<\/tbody>/.exec(m[2]);
    assert.ok(head !== null && body !== null && /<th[\s>]/.test(head[1]),
      `Replicata: render the sanity section (default window) and read the header cells and body of the table ${JSON.stringify(id)}.
Expectata: a thead holding header cells, and a tbody: the cells compared below.
Resultata: ${JSON.stringify(m[2].slice(0, 300))}.`);
    const heads = [...head[1].matchAll(/<th([^>]*)>/g)].map(h => isNum(h[1]));
    const rows = [...body[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map(r => [...r[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(c => ({ num: isNum(c[1]), span: /colspan/.test(c[1]), text: c[2].replace(/<[^>]*>/g, "").trim() })))
      .filter(r => r.length === heads.length && !r.some(c => c.span));
    heads.forEach((thNum, j) => {
      const cells = rows.map(r => r[j]);
      if (cells.some(c => c.num !== thNum)) problems.push(`${id} column ${j + 1}: header ${thNum ? "" : "not "}numeric, body cells ${JSON.stringify([...new Set(cells.map(c => c.num))])}`);
      if (!FIGURES.has(id)) return;
      const kinds = new Set(cells.map(c => kind(c.text)));
      const figures = kinds.has("figure") && !kinds.has("text"), text = kinds.has("text");
      if ((figures && !thNum) || (text && thNum)) problems.push(`${id} column ${j + 1}: header ${thNum ? "" : "not "}numeric, its cells ${figures ? "figures" : "text"} (e.g. ${JSON.stringify(cells[0] && cells[0].text.slice(0, 40))})`);
    });
  }
  const missing = [...FIGURES].filter(id => !seen.has(id));
  assert.ok(problems.length === 0 && missing.length === 0,
    `Replicata: render the sanity section (default window) and compare each table's header cells with its body cells.
Expectata: a header cell carries class="num" exactly when its column's body cells do; in ${[...FIGURES].join(", ")}, exactly the columns of figures carry it.
Resultata: ${missing.length ? `no table ${JSON.stringify(missing)}; ` : ""}${JSON.stringify(problems)}.`);
}
// (The Sensitivity table's count carries its metric's count note since
// 2026-10-31, countHtml: the fatality count's tooltip, decision #1.)
assert.equal((liveJs.match(/<td class="num">\$\{(?:fmtCount\(stress\.av\.k\)|countHtml\(stress\.metric, fmtCount\(stress\.av\.k\)\))\}<\/td>/g) || []).length, 2,
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
// Since 2026-10-04 a sortable header's text is a button in its th (audit
// #19), and the triangle is drawn inside the button, after its text: drawn
// after the button (an atomic inline box), it took a line of its own wherever
// the header's text wrapped ("Speed (mph)" at 1200 px).
const ASC = "th[aria-sort] > button::after", DESC = 'th[aria-sort="descending"] > button::after';
const asc = rule(ASC);
const desc = rule(DESC);
assert.ok(asc && desc, `${ASC} and ${DESC} rules exist`);
assert.match(onlyDecl(asc.body, "border-bottom", ASC), /currentColor$/);
assert.match(onlyDecl(desc.body, "border-top", DESC), /currentColor$/);
assert.equal(decls(asc.body, "content").length, 1);

console.log("qual pass: generated tables are wrapped, numeric cells are named, sort direction is drawn");

// The VMT sources table's links (since 2026-11-05; the human's "ok, go with
// links", 2026-11-04). A data/vmt.csv rationale points at a section of
// data/README.md with a markdown link, "[<text>](data/#<anchor>)"
// (quals/rationale-links.mjs), which the sanity section's VMT sources table
// (id sanity-vmt-sources) shows as an a element to that section of the site,
// where GitHub Pages renders data/README.md at data/. Checked with the app
// loaded in node (quals/load-app.mjs):
//  1. in each window below, each line's cell holds one a element per link of
//     the rationales it shows (its analysis months', and its ghost months'
//     when the window ends at the newest NHTSA month), in order, each with
//     href="data/#<anchor>" as its only attribute (as the sanity section's
//     other links have only their href) and the link's text, escaped, as its
//     content; and its text outside those a elements (each read as a
//     blank) holds no link syntax: no "](" and no target "data/#" (but
//     inside a longer path or address, as the site's address in prose:
//     quals/rationale-links.mjs, OPEN_TARGET);
//  2. a synthetic rationale with two links, a band in square brackets, and &,
//     < and > in its text and in a link's text (no rationale holds those
//     today, so check 1 alone could not see a dropped escape), given to one
//     line's analysis rows and to its ghost row, renders as
//     quals/rationale-links.mjs's rationaleMarkup gives it;
//  3. parseVmtCsv and parseGhostVmtCsv, which read the rationales at load,
//     stop on a link of the wrong form (each case in BAD below), with details
//     naming the row's line and its rationale, so the page stops with the
//     error banner (error-banner.qual loads such a data/vmt.js); and they
//     read unchanged a well-formed link, a band in square brackets, square
//     brackets that do not pair (a half-open interval, a nested one), and the
//     site's address in prose.
// No words are checked: the rationales' wording is free (the human's rule of
// 2026-11-03), so no window is required to show a link (the pass line counts
// them); vmt-rationale-text.qual checks each link's anchor against
// data/README.md's headings.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { rationaleLinks, rationaleMarkup, escText, OPEN_TARGET } from "./rationale-links.mjs";

// escHtml reads a node's textContent back through innerHTML: &, < and >.
class ElementStub {
  constructor() { this._text = ""; this._html = ""; }
  set textContent(v) { this._text = v; this._html = escText(String(v)); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
}
const nodes = new Map();
const getNode = id => (nodes.has(id) || nodes.set(id, new ElementStub()), nodes.get(id));
const ctx = vm.createContext({ console, document: { getElementById: getNode, createElement: () => new ElementStub() } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  fullMonthSeries = monthSeriesData();
`, ctx);
const run = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));
const months = run("fullMonthSeries.months");
const LINES = run("ADS_SERIES");
const LABEL = run("Object.fromEntries(ADS_SERIES.map(h => [h, helmerLabel(h)]))");
const NOTE = run("VMT_GHOST_NOTE");
const last = months[months.length - 1];
const WINDOWS = {
  default: [run("DEFAULT_START_MONTH"), last],
  full: [months[0], last],
  "ending a month before the newest": [run("DEFAULT_START_MONTH"), months[months.length - 2]],
  "Waymo's first months": ["2021-07", "2023-01"],
  "the newest month alone": [last, last],
};
// Each window's months are in the series, so that none is sliced to nothing.
for (const [name, [a, b]] of Object.entries(WINDOWS)) {
  assert.ok(months.indexOf(a) !== -1 && months.indexOf(b) >= months.indexOf(a),
    `Replicata: find the window "${name}", ${a}..${b}, in the app's months (${months[0]}..${last}). Expectata: both months there, the first not after the last. Resultata: indices ${months.indexOf(a)} and ${months.indexOf(b)}.`);
}

// The VMT sources table's cells, by line label, for a window.
const cells = ([a, b]) => {
  const html = vm.runInContext(`
    activeSeries = sliceSeries(fullMonthSeries, ${months.indexOf(a)}, ${months.indexOf(b)});
    buildSanityChecks();
    document.getElementById("sanity-checks").innerHTML;`, ctx);
  const table = /<table[^>]*\bid="sanity-vmt-sources"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  assert.ok(table !== null, `Replicata: build the sanity section for ${a}..${b}. Expectata: a table with id sanity-vmt-sources. Resultata: none.`);
  return Object.fromEntries([...table[1].matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td class="ai-text">([\s\S]*?)<\/td>\s*<\/tr>/g)].map(m => [m[1], m[2]]));
};
// The rationales a window shows for a line, in the table's order: one per
// run of months its analysis rows share (in month order), then its ghost
// rows' when the window ends at the newest NHTSA month.
const shown = (helmer, [a, b]) => {
  const rows = run(`vmtRows.filter(r => r.helmer === ${JSON.stringify(helmer)}).map(r => ({month: r.month, rationale: r.rationale}))`)
    .filter(r => r.month >= a && r.month <= b).sort((x, y) => (x.month < y.month ? -1 : 1));
  const runs = rows.filter((r, i) => i === 0 || rows[i - 1].rationale !== r.rationale).map(r => r.rationale);
  const ghost = b === last ? run(`ghostVmtRows.filter(r => r.helmer === ${JSON.stringify(helmer)}).map(r => ({month: r.month, rationale: r.rationale}))`)
    .sort((x, y) => (x.month < y.month ? -1 : 1)).map(r => r.rationale) : [];
  return [...runs, ...ghost];
};
// A cell's a elements.
const anchorsOf = cell => [...cell.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(m => ({ attrs: m[1], html: m[2] }));
// A cell's text outside its a elements, each a element a blank (as
// crashla.js's vmtRationale reads a rationale outside its links), tags dropped.
const outside = cell => cell.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, " ").replace(/<[^>]*>/g, "");
const leftover = text => [/\]\(/, new RegExp(OPEN_TARGET.source)].filter(re => re.test(text)).map(String);

const problems = [];
const counts = [];
// --- 1. one a element per link, nothing left of the link syntax -------------
for (const [name, win] of Object.entries(WINDOWS)) {
  const byLabel = cells(win);
  let found = 0;
  for (const helmer of LINES) {
    const cell = byLabel[escText(LABEL[helmer])];
    const rationales = shown(helmer, win);
    if (cell === undefined) {
      if (rationales.length > 0) problems.push(`${name} (${win.join("..")}), ${helmer}: no row in the table, where ${rationales.length} rationales are shown`);
      continue;
    }
    const want = rationales.flatMap(r => rationaleLinks(r)).map(l => ({ attrs: ` href="${l.target}"`, html: escText(l.text) }));
    const got = anchorsOf(cell);
    found += got.length;
    if (JSON.stringify(got) !== JSON.stringify(want))
      problems.push(`${name} (${win.join("..")}), ${helmer}: a elements ${JSON.stringify(got).slice(0, 300)}, want one per link of its ${rationales.length} rationales, ${JSON.stringify(want).slice(0, 300)}`);
    const left = leftover(outside(cell));
    if (left.length > 0) problems.push(`${name} (${win.join("..")}), ${helmer}: its text outside the a elements holds link syntax ${left.join(", ")}`);
  }
  counts.push(`${name} ${found}`);
}

// --- 2. a synthetic rationale with links, a band and markup ------------------
// Zoox's analysis rows in the default window take SYNTHETIC and its ghost row
// SYNTHETIC_GHOST; the cell must be the markup rationaleMarkup gives, after
// the month heads the app writes (its first and last month, and the ghost
// month with the human's note).
{
  const SYNTHETIC = `Synthetic & <b>not bold</b> > text: a band [2,075,000, 3,289,000], two links ([data/README.md, Zoox anchors](data/#zoox-anchors); [R&D <notes> > x](data/#ghost-months)), and "quotes".`;
  const SYNTHETIC_GHOST = `Ghost & <i>x</i>: [data/README.md, Ghost months](data/#ghost-months) [1.05M, 3.00M].`;
  const win = WINDOWS.default;
  vm.runInContext(`
    savedRationales = [...vmtRows, ...ghostVmtRows].map(r => r.rationale);
    for (const r of vmtRows) if (r.helmer === "Zoox") r.rationale = ${JSON.stringify(SYNTHETIC)};
    for (const r of ghostVmtRows) if (r.helmer === "Zoox") r.rationale = ${JSON.stringify(SYNTHETIC_GHOST)};`, ctx);
  const cell = cells(win)[escText(LABEL.Zoox)];
  vm.runInContext(`[...vmtRows, ...ghostVmtRows].forEach((r, i) => { r.rationale = savedRationales[i]; });`, ctx);
  const zoox = run("vmtRows.filter(r => r.helmer === 'Zoox').map(r => r.month)").filter(m => m >= win[0] && m <= win[1]).sort();
  const ghost = run("ghostVmtRows.filter(r => r.helmer === 'Zoox').map(r => r.month)").sort();
  assert.ok(zoox.length > 1 && ghost.length > 0 && win[1] === last,
    `Replicata: list Zoox's analysis and ghost months for the default window, ${win.join("..")}. Expectata: two or more analysis months and a ghost month, the window ending at the newest NHTSA month (${last}). Resultata: ${JSON.stringify({ zoox, ghost })}.`);
  // Two links in SYNTHETIC, one in SYNTHETIC_GHOST for each ghost month.
  const want = [`${zoox[0]} – ${zoox[zoox.length - 1]}: ${rationaleMarkup(SYNTHETIC)}`,
    ...ghost.map(m => `${m} (<span class="vmt-ghost-note">${escText(NOTE)}</span>): ${rationaleMarkup(SYNTHETIC_GHOST)}`)].join("<br>");
  if (cell !== want || anchorsOf(cell).length !== 2 + ghost.length)
    problems.push(`a synthetic rationale given to Zoox's rows: the cell is ${JSON.stringify(cell)}, with ${cell === undefined ? 0 : anchorsOf(cell).length} a elements; want ${JSON.stringify(want)}, with ${2 + ghost.length}`);
}

// --- 3. a link of the wrong form stops the page at load ----------------------
const HEAD = "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,coverage,coverage_min,coverage_max,incident_coverage,incident_coverage_min,incident_coverage_max,rationale";
const GHOST_HEAD = "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale";
const quoted = s => `"${s.replace(/"/g, '""')}"`;
const PARSERS = {
  parseVmtCsv: r => `${HEAD}\nzoox,2026-01,100,100,90,110,90,110,1,1,1,1,1,1,${quoted(r)}`,
  parseGhostVmtCsv: r => `${GHOST_HEAD}\nzoox,2026-11,100,100,90,110,90,110,${quoted(r)}`,
};
// The JSON details at the end of an assert's message (crashla.js fail),
// read as data: the first brace from which the rest parses.
const detailsOf = message => {
  for (let i = message.indexOf("{"); i !== -1; i = message.indexOf("{", i + 1)) {
    try { return JSON.parse(message.slice(i)); } catch { /* a brace among the message's words */ }
  }
  return null;
};
const parse = (parser, rationale) => {
  try { return { rows: run(`${parser}(${JSON.stringify(PARSERS[parser](rationale))}).map(r => r.rationale)`) }; }
  catch (e) { return { error: e.message, details: detailsOf(e.message) }; }
};
const GOOD = [
  "a link ([data/README.md, Zoox anchors](data/#zoox-anchors)).",
  "two links ([data/README.md, Waymo anchors](data/#waymo-anchors); [data/README.md, Waymo monthly allocation](data/#waymo-monthly-allocation)).",
  "a band [2,075,000, 3,289,000] beside a link [data/README.md, Ghost months](data/#ghost-months), and a quote's [seat].",
  "no link at all, a parenthesis (data/waymo-ca.csv) and a band [1.040, 1.076].",
  // Square brackets that do not pair, which correct prose writes (crashla.js
  // itself has "coverage must be in (0, 1]").
  "a half-open interval, its coverage in (0, 1], beside a link [data/README.md, Ghost months](data/#ghost-months).",
  "a half-open interval [0.995, 1.05) and a nested bracket [a [b] c].",
  // The site's address in prose, its "data/#" inside a longer path.
  "the section on the site, teslapologetics.dreev.es/data/#ghost-months, and https://teslapologetics.dreev.es/data/#zoox-anchors, beside a link [data/README.md, Ghost months](data/#ghost-months).",
];
const BAD = {
  "a link with no text": "see [](data/#zoox-anchors).",
  "a link whose text is only spaces": "see [ ](data/#zoox-anchors).",
  "a link whose text holds a square bracket": "see [data/[README].md](data/#zoox-anchors).",
  "an anchor in capitals": "see [data/README.md, Zoox anchors](data/#Zoox-Anchors).",
  "an anchor with a space": "see [data/README.md, Zoox anchors](data/#zoox anchors).",
  "an anchor with an underscore": "see [data/README.md, Zoox anchors](data/#zoox_anchors).",
  "an anchor with a period": "see [data/README.md, Zoox anchors](data/#zoox.anchors).",
  "a link to another page": "see [the hub](https://waymo.com/safety/impact/).",
  "a link to data/ with no anchor": "see [data/README.md](data/).",
  "a link whose target is left open": "see [data/README.md, Zoox anchors](data/#zoox-anchors.",
  "a link whose text is left open": "see ([data/README.md, Zoox anchors(data/#zoox-anchors)).",
  "a target with no text before it": "see (data/#zoox-anchors).",
  "a target with no parentheses after a text": "see [data/README.md, Zoox anchors]data/#zoox-anchors.",
  "a target alone in prose": "see data/#zoox-anchors.",
  "a target at a rationale's start": "data/#zoox-anchors, the section.",
  "a target right after a link": "[data/README.md, Ghost months](data/#ghost-months)data/#zoox-anchors.",
  "a target right after a link after a word": "see[data/README.md, Ghost months](data/#ghost-months)data/#zoox-anchors.",
  "a space between a link's text and its target": "see [data/README.md, Zoox anchors] (data/#zoox-anchors).",
};
for (const parser of Object.keys(PARSERS)) {
  for (const rationale of GOOD) {
    const r = parse(parser, rationale);
    if (r.error !== undefined || JSON.stringify(r.rows) !== JSON.stringify([rationale]))
      problems.push(`${parser} on ${JSON.stringify(rationale)}: ${r.error !== undefined ? `threw ${JSON.stringify(r.error.slice(0, 200))}` : `read ${JSON.stringify(r.rows)}`}, want the rationale unchanged`);
  }
  for (const [what, rationale] of Object.entries(BAD)) {
    const r = parse(parser, rationale);
    if (r.error === undefined) problems.push(`${parser}, ${what} (${JSON.stringify(rationale)}): read without a stop`);
    else if (!(r.details !== null && r.details.lineNo === 2 && r.details.rationale === rationale))
      problems.push(`${parser}, ${what}: stopped with ${JSON.stringify(r.error.slice(0, 200))}, whose details do not name line 2 and the rationale`);
  }
}

assert.deepEqual(problems, [],
  `Replicata: build the sanity section in node for the windows ${Object.entries(WINDOWS).map(([n, w]) => `${n} (${w.join("..")})`).join(", ")} and read the VMT sources table (id sanity-vmt-sources); give Zoox's rows a synthetic rationale with links, a band and markup; and read rationales with a link of the wrong form through parseVmtCsv and parseGhostVmtCsv.
Expectata: each line's cell holds one a element per link of the rationales it shows, in order, with href="data/#<anchor>" alone and the link's text escaped, and no link syntax ("](" or a target "data/#" but inside a longer path or address) outside them; the synthetic rationale renders as rationaleMarkup gives it; each wrong form (${Object.keys(BAD).join("; ")}) stops both parsers with details naming line 2 and the rationale, and a well-formed link, a band, square brackets that do not pair, or the site's address in prose (${GOOD.length} rationales) read unchanged.
Resultata: ${problems.length} problems:
${problems.slice(0, 12).join("\n")}`);
console.log(`qual pass: the VMT sources table draws each rationale link as an a element to its section (a elements by window: ${counts.join(", ")}), escapes the text around and inside it, and leaves no link syntax; ${Object.keys(BAD).length} wrong forms of a link stop both CSV readers at load`);

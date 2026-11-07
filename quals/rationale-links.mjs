// The links in data/vmt.csv's rationales, read for the quals apart from
// crashla.js (which checks their form at load, vmtRationale, and draws them
// in the sanity section's VMT sources table, rationaleHtml). Since 2026-11-05
// a rationale points a reader at a section of data/README.md with a markdown
// link whose text is the pointer and whose target is that section on the
// site, "[data/README.md, Zoox anchors](data/#zoox-anchors)": GitHub Pages
// renders data/README.md at data/, each heading with an id (headingAnchors
// below). The human's choice of 2026-11-04, "ok, go with links", over prose
// pointers that a qual had to guess at.
import assert from "node:assert/strict";

// Any markdown inline link: "[", a text without square brackets, "](", a
// target without parentheses, ")". The text may be empty and the target any,
// so vmt-rationale-text.qual can name a link of the wrong form.
export const LINK = /\[([^\[\]]*)\]\(([^()]*)\)/g;
// The form crashla.js draws as an a element: a text holding a character
// other than a blank, and a target of data/# and an anchor of lowercase
// letters, digits and hyphens.
export const DATA_LINK = /\[(?=[^\[\]]*[^\[\]\s])([^\[\]]+)\]\((data\/#[a-z0-9-]+)\)/g;
// A target "data/#" in a rationale's text outside its links (each read as a
// blank, so a target right after a link is one), which crashla.js takes for a
// link left open: one not inside a longer path or address (not right after a
// word character, ".", "/", ":" or "-"), so a rationale can give the site's
// address in prose ("teslapologetics.dreev.es/data/#...").
export const OPEN_TARGET = /(?<![\w.\/:-])data\/#/g;

// A rationale's links, in order: each one's text, its target and where it
// starts.
export const rationaleLinks = rationale => [...rationale.matchAll(LINK)]
  .map(m => ({ text: m[1], target: m[2], at: m.index, source: m[0] }));

// What a reader sees of a rationale: each link as its text.
export const rationaleText = rationale => rationale.replace(LINK, "$1");

// Text escaped as a node's textContent reads back through innerHTML, the way
// crashla.js's escHtml escapes it: &, < and >, not quotes.
export const escText = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The VMT sources table's markup for a rationale: its text escaped, each
// link an a element whose only attribute is its target (as every other link
// in the sanity section has only its href) and whose content is its text,
// escaped. Built by walking the links, apart from crashla.js's rationaleHtml,
// which replaces them in the escaped text.
export function rationaleMarkup(rationale) {
  let html = "", at = 0;
  for (const m of rationale.matchAll(DATA_LINK)) {
    html += escText(rationale.slice(at, m.index)) + `<a href="${m[2]}">${escText(m[1])}</a>`;
    at = m.index + m[0].length;
  }
  return html + escText(rationale.slice(at));
}

// --- The ids GitHub Pages gives a markdown file's headings -------------------
// GitHub Pages builds the site with Jekyll (github-pages 232, by
// pages.github.com/versions.json, read 2026-11-07; until then this said 233,
// which pins the same kramdown versions), which drops a
// leading byte-order mark and a leading YAML front matter block
// (YAML_FRONT_MATTER_REGEXP), runs Liquid on a file that holds "{{" or "{%",
// and gives the rest to kramdown 2.4.0 with kramdown-parser-gfm 1.1.0 (input
// GFM, gfm_quirks paragraph_end). That parser gives each heading outside an
// HTML element and a footnote, when it parses the file, the id
// generate_gfm_header_id makes from the heading's text as it renders
// (update_raw_text): lowercased; every
// character dropped but a letter, a mark, a decimal digit, a connector (the
// underscore among them), a hyphen, a space or a tab (Ruby's \p{Word}, the
// hyphen and the blanks); each space or tab a hyphen; and an id already given
// takes -1, -2 and so on, counted per id in document order (an empty id is
// one the page does not write). A heading inside an HTML element read as
// markdown gets its id when kramdown's HTML converter writes the page
// (convert_header, generate_id): from the same text, its characters dropped
// up to its first ASCII letter, then every character but an ASCII letter or
// digit, a space or a hyphen; each space a hyphen; lowercased; "section" if
// nothing is left; numbered by the converter's own counter, in document
// order. A footnote's headings get the converter's ids where the page writes
// the footnote, after the rest, and only if it is referenced.
//
// headingAnchors reads the file's blocks as kramdown's block parsers do
// (parse_blocks), ported here with their regexes: blank lines, indented and
// fenced code blocks, quotes, ATX and setext headings, thematic breaks,
// lists, definition lists, block HTML (comments, and elements, read to the
// tag that closes them as parse_raw_html reads them, or as markdown where a
// markdown attribute says so), math blocks, tables, footnote, link and
// abbreviation definitions, attribute definitions and block attribute
// lists, end-of-block markers and paragraphs, tried in
// kramdown's order at each block's start, and a list item's, quote's or
// definition's content read as its own blocks at its content column. So a
// heading in a list item, a quote or a definition is read as the site reads
// it, a # line that code, a comment, an HTML element read raw or a lazy line
// takes is no heading, as on the site, and one in an element read as
// markdown takes the converter's id. It stops (throws, naming each line and
// why) on the forms whose effect on the file's headings it does not
// compute: Liquid ({{ or {%), which Jekyll runs on the file before kramdown
// reads it; a kramdown extension at a block's start ({:: or {:/), which can
// drop content or set the options that give headings their ids; an
// attribute list or attribute definition at a block's start that sets an id
// ({: #<id>}, {:<name>: #<id>} or id=), which can set a heading's (one that
// sets none, "{:toc}" or "{: .no_toc}", is read and leaves every id as it is;
// until 2026-11-07 every "{:" at a block's start stopped it); and a table
// holding an inline HTML element with content, which kramdown's pipe check
// reads with every span parser. A heading whose text holds one of the
// marks HEADING_STOPS lists, or that sits in a footnote, it leaves unread,
// its id not known (headingAnchors, below). Its ids, stops and unread
// headings are checked on vmt-rationale-text.qual's synthetic files, each
// case's ids the ones in the page GitHub Pages' own stack serves
// (Document#to_html; run on them 2026-11-05 and 2026-11-07). The sixth fix
// run's first reader (2026-11-05, before it reached git) read the file line
// by line, stopped on many correct forms (a # line in code in a list item or
// a quote, a heading after one) and read some others wrong (a list item's
// lazy line, a comment in a list item); the third review of that day found
// both. Until 2026-11-07 this reader gave a heading inside an element read
// as markdown no id (the ids set when the file is parsed, which the served
// page adds to) and stopped on the headings it now leaves unread.
//
// Ruby's regexes as JS sources. Ruby's ^ is a line start, and at a
// StringScanner's position (fixed_anchor false), which Scanner.check reads
// by matching at the start of the rest of the source; Ruby's \s, \S and . are
// ASCII blanks, their complement and any character but "\n"; its \b and
// [[:alpha:]] are Unicode.
const S = "[ \\t\\n\\v\\f\\r]";
const NS = "[^ \\t\\n\\v\\f\\r]";
const DOT = "[^\\n]";
const WORD = "[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]";
const UNAME = "(?:[\\p{Alphabetic}_][-\\p{Alphabetic}\\p{Nd}._]*:)?[\\p{Alphabetic}_][-\\p{Alphabetic}\\p{Nd}._]*"; // REXML's UNAME_STR
const EOS = "(?=\\n?(?![\\s\\S]))"; // \Z
const INDENT = "(?:\\t| {4})";
const BLANK_LINE = "(?:^[ \\t\\v\\f\\r]*\\n)+";
const EOB_MARKER = `^\\^${S}*?\\n`;
const ALD_ID_NAME = "\\w[\\w-]*";
const ALD_ANY = "(?:\\\\\\}|[^}])";
const IAL_BLOCK = `\\{:(?![:\\/])${ALD_ANY}+\\}${S}*?\\n`;
const IAL_BLOCK_START = `^ {0,3}${IAL_BLOCK}`;
const SPAN_ELEMENTS = ["a", "abbr", "acronym", "b", "big", "bdo", "br", "button", "cite", "code", "del", "dfn", "em", "i", "img", "input", "ins", "kbd",
  "label", "mark", "option", "q", "rb", "rbc", "rp", "rt", "rtc", "ruby", "samp", "select", "small", "span", "strong", "sub", "sup", "tt", "u", "var"];
const NOT_LAZY_SPAN = `(?!(?:${[...SPAN_ELEMENTS, "script"].join("|")})(?!${WORD}))`;
const LAZY_END_HTML_START = `<${NOT_LAZY_SPAN}${UNAME}`;
const LAZY_END_HTML_STOP = `<\\/${NOT_LAZY_SPAN}${UNAME}${S}*>`;
const LAZY_END = `(?:${BLANK_LINE}|${IAL_BLOCK_START}|${EOB_MARKER}|^ {0,3}${LAZY_END_HTML_STOP}|^ {0,3}${LAZY_END_HTML_START}|${EOS})`;
const BLOCK_BOUNDARY = `(?:${BLANK_LINE}|${EOB_MARKER}|${IAL_BLOCK_START}|${EOS})`;
const PATTERN_TAIL = `[\\t| ]${DOT}*?\\n`;
const LIST_START_UL = `^( {0,3}[+*-])(${PATTERN_TAIL})`;
const LIST_START_OL = `^( {0,3}\\d+\\.)(${PATTERN_TAIL})`;
const LIST_START = `(?:${LIST_START_UL}|${LIST_START_OL})`;
const DEFINITION_LIST_START = `^( {0,3}:)(${PATTERN_TAIL})`;
const BLOCKQUOTE_START = "^ {0,3}> ?";
const ATX_HEADER_START = `^(#{1,6})[\\t ]+(${DOT}*)\\n`; // kramdown-parser-gfm's
const FENCED_CODEBLOCK_START = "^ {0,3}[~`]{3,}"; // kramdown-parser-gfm's
const PARAGRAPH_MATCH = `^${DOT}*?\\n`;
const HTML_TAG_ATTR = `${S}+${UNAME}(?:${S}*=${S}*(?:${WORD}+|(?<q>["'])[\\s\\S]*?\\k<q>))?`;
const HTML_TAG = `<(?=(?<n>${UNAME}))\\k<n>${S}*(?<attrs>(?:(?=(?<a>${HTML_TAG_ATTR}))\\k<a>)*)${S}*(?<closed>\\/)?>`; // HTML_TAG_RE
const HTML_TAG_CLOSE = `<\\/(${UNAME})${S}*>`;
const HTML_COMMENT = "<!--[\\s\\S]*?-->";
const TABLE_PIPE_CHECK = `(?:\\||${DOT}*?[^\\\\\\n]\\|)`;
const TABLE_LINE = `${TABLE_PIPE_CHECK}${DOT}*?\\n`;
const CODEBLOCK_MATCH = `(?:(?:${BLANK_LINE})?(?:${INDENT}[ \\t]*${NS}${DOT}*\\n)+(?:(?!${IAL_BLOCK_START}|${EOB_MARKER}|^ {0,3}${LAZY_END_HTML_STOP}|^ {0,3}${LAZY_END_HTML_START})^[ \\t]*${NS}${DOT}*\\n)*)*`;
// The message of a check of this port's own reading, which fails loudly.
const portCheck = (expected, found) => `Replicata: read a markdown file's blocks (quals/rationale-links.mjs, headingAnchors).
Expectata: ${expected}.
Resultata: ${found}.`;
// A regex that matches at a scanner's position (sticky), or anywhere in a
// string (find), with ^ at line starts.
const at = source => new RegExp(source, "muy");
const find = source => new RegExp(source, "mu");

// --- A heading's text, as GitHub Pages renders it ---------------------------
// A heading's text is read left to right as kramdown's span parsers read it
// (headingText): an escape ("\" and a character of ESCAPED_CHARS_GFM) is that
// character; a code span (parse_codespan: a run of backticks to the next
// occurrence of the same run, which can start a longer one; a lone backtick
// with a blank or nothing before it and a blank after it, or a run never
// closed, is text) is its text as written, less a space at each end when its
// run is two or more backticks; an autolink (AUTOLINK_START) is its address,
// less "mailto:"; an inline link ("[<text>](<target>)", its text without
// square brackets or backticks, its target a <...> or a run without blanks or
// parentheses, a quoted title allowed) is its text, read in turn; and in the
// rest kramdown sets "---" and "--" as dashes, which the id drops (a run of
// hyphens takes its dashes left to right: "----" is a dash and a hyphen). The
// other marks in HEADING_STOPS, each of which can change the text kramdown
// renders for a heading and so its id, stop the reader. Square brackets,
// braces, backslashes, backticks and angle brackets read as text otherwise, as
// kramdown renders them there (the id drops them; a shortcut reference "[x]"
// renders as x either way).

// The id GitHub Pages gives a heading's rendered text, before numbering.
const headingId = text => text.toLowerCase().replace(/[^\p{L}\p{M}\p{Nd}\p{Pc}\- \t]/gu, "").replace(/[ \t]/g, "-");
const blanked = s => "\0".repeat(s.length);
const dashes = s => s.replace(/---/g, "—").replace(/--/g, "–");

// The spans of a heading's text read here, each reader given the text from
// the current character on (rest) and the text before it, and giving null or
// the span: its length, its rendered text (shown), and its text in the views
// HEADING_STOPS look at, marks (code spans, escapes, autolinks and link
// targets blanked, a link's text kept) and plain (the whole span blanked).
const ESCAPE = /^\\([\\.*_+`<>()\[\]{}#!:|"'$=\-~])/; // ESCAPED_CHARS_GFM
const AUTOLINK = /^<((?:mailto|https?|ftps?):.+?|[\p{Alphabetic}\p{Nd}\-_.]+?@[\p{Alphabetic}\p{Nd}\-_.]+?)>/u; // AUTOLINK_START
const INLINE_LINK = /^\[([^\[\]`]*)\]\([ \t]*(?:<[^<>\n]*>|[^()\s<]*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/;
const whole = (shown, source) => ({ length: source.length, shown, marks: blanked(source), plain: blanked(source) });
function escaped(rest) {
  const m = ESCAPE.exec(rest);
  return m === null ? null : whole(m[1], m[0]);
}
function codeSpan(rest, before) {
  const run = /^`+/.exec(rest)?.[0];
  if (run === undefined) return null;
  const lone = run === "`" && (before === "" || new RegExp(`${S}$`).test(before)) && new RegExp(`^${S}`).test(rest.slice(1));
  const close = lone ? -1 : rest.indexOf(run, run.length);
  if (close === -1) return { length: run.length, shown: run, marks: run, plain: run };
  const code = rest.slice(run.length, close);
  return whole(run.length > 1 ? code.replace(/^ /, "").replace(/ $/, "") : code, rest.slice(0, close + run.length));
}
function autolink(rest) {
  const m = AUTOLINK.exec(rest);
  return m === null ? null : whole(m[1].replace(/^mailto:/, ""), m[0]);
}
function inlineLink(rest) {
  const m = INLINE_LINK.exec(rest);
  if (m === null) return null;
  const text = headingText(m[1]);
  return { length: m[0].length, shown: text.shown, marks: `[${text.marks}]${blanked(m[0].slice(m[1].length + 2))}`, plain: blanked(m[0]) };
}
const SPANS = [escaped, codeSpan, autolink, inlineLink];
// A heading's text as GitHub Pages renders it (shown), and its two views.
function headingText(text) {
  const out = { shown: "", marks: "", plain: "" };
  let run = ""; // plain text not yet given its dashes
  for (let i = 0; i < text.length;) {
    const span = SPANS.reduce((found, read) => found ?? read(text.slice(i), text.slice(0, i)), null);
    if (span === null) {
      run += text[i];
      out.marks += text[i];
      out.plain += text[i];
      i += 1;
      continue;
    }
    out.shown += dashes(run) + span.shown;
    run = "";
    out.marks += span.marks;
    out.plain += span.plain;
    i += span.length;
  }
  out.shown += dashes(run);
  return out;
}

// Marks in a heading that can change the text kramdown renders, and so its
// id, which this reader does not read: a test of the heading (its contents
// as written, raw, and its views) and of the labels the file defines, and
// what it is.
const HEADING_STOPS = [
  [h => /[\t ]\{#[^{}]*\}$/.test(h.raw), "an explicit id ({#...} at its end)"],
  [h => /\{:/.test(h.marks), "a kramdown attribute list or extension ({:), which kramdown applies or drops after a span"],
  [h => /&(?:[A-Za-z0-9_:][A-Za-z0-9_.:-]*|#\d+|#x[\da-fA-F]+);/.test(h.marks), "an entity, which renders as its character (HTML_ENTITY_RE)"],
  [h => /<(?:[\p{Alphabetic}_?\/]|!--)/u.test(h.marks), "inline HTML, whose tags kramdown drops"],
  [h => /<<|>>/.test(h.marks), "a typographic << or >>, which takes the blank beside it"],
  [h => /\$\$/.test(h.marks), "math ($$), which renders as written"],
  [h => /!\[/.test(h.marks), "an image, which renders as nothing"],
  [h => /\[[^]*\]\(/.test(h.plain), "a link of a form this reader does not read (square brackets or backticks in its text, blanks or parentheses in its target)"],
  [(h, labels) => [...h.plain.matchAll(/\[[^\[\]]*\][ \t]*\[([^\[\]]+)\]/g)].some(m => labels.has(m[1].replace(/[ \t\n\v\f\r]+/g, " ").toLowerCase())),
    "a reference link to a label the file defines, which renders as its text alone"],
  [(h, labels) => [...h.plain.matchAll(/\[(\^[A-Za-z0-9_][A-Za-z0-9_-]*)\]/g)].some(m => labels.has(m[1])),
    "a footnote the file defines, which renders as its number"],
  [h => /(?<!\p{Alphabetic}-?)_(?![ \t\n\v\f\r])[^]*(?<![ \t\n\v\f\r])_(?![\p{Alphabetic}\p{Nd}])/u.test(h.marks),
    "an underscore that can open emphasis, and one after it that can close it (emphasis drops both)"],
];

// --- A file's blocks, as kramdown reads them ----------------------------------
const RE = {
  blank: at(BLANK_LINE), codeStart: at(INDENT), code: at(CODEBLOCK_MATCH),
  fenceStart: at(FENCED_CODEBLOCK_START),
  fence: at(`^ {0,3}(([~\`]){3,})${S}*?((${NS}+?)(?:\\?${NS}*)?)?${S}*?\\n([\\s\\S]*?)^ {0,3}\\1\\2*${S}*?\\n`), // FENCED_CODEBLOCK_MATCH
  quote: at(BLOCKQUOTE_START), atx: at(ATX_HEADER_START),
  hr: at(`^ {0,3}([*\\-_])[ \\t]*\\1[ \\t]*\\1(?:\\1|[ \\t])*\\n`), // HR_START
  list: at(LIST_START), ul: at(LIST_START_UL), ol: at(LIST_START_OL), dl: at(DEFINITION_LIST_START),
  html: at(`^ {0,3}<(?:${UNAME}|!--|\\/)`), // HTML_BLOCK_START
  htmlComment: at(HTML_COMMENT), htmlTag: at(`^ {0,3}${HTML_TAG}`), htmlClose: at(`^ {0,3}${HTML_TAG_CLOSE}`),
  rawTag: at(HTML_TAG), rawClose: at(HTML_TAG_CLOSE), rawInstruction: at("<\\?[\\s\\S]*?\\?>"),
  rawStart: find(`<(?:${UNAME}|\\/|!--|\\?)`), // HTML_RAW_START
  trailing: at("[ \\t]*\\n"), // TRAILING_WHITESPACE
  setext: at(`^ {0,3}(?<contents>[^ \\t]${DOT}*)\\n(?<level>[-=])[-=]*[ \\t\\r\\f\\v]*\\n`), // SETEXT_HEADER_START
  math: at(`^ {0,3}(\\\\)?\\$\\$([\\s\\S]*?)\\$\\$(${S}*?\\n)?`), mathEscape: at("^ {0,3}\\\\"), // BLOCK_MATH_START
  boundary: at(BLOCK_BOUNDARY),
  tableStart: at(`^ {0,3}(?=${NS})${TABLE_LINE}`), tableLine: at(TABLE_LINE),
  tableSep: at(`^([+|: \\t-]*?-[+|: \\t-]*?)[ \\t]*\\n`), tableFsep: at(`^[+|: \\t=]*?=[+|: \\t=]*?[ \\t]*\\n`), tableRow: at(`^(${DOT}*?)[ \\t]*\\n`),
  footnote: at(`^ {0,3}\\[\\^(${ALD_ID_NAME})\\]:${S}*?(${DOT}*?\\n${CODEBLOCK_MATCH})`), // FOOTNOTE_DEFINITION_START
  linkDef: at(`^ {0,3}\\[([^\\n\\]]+)\\]:[ \\t]*(?:<(${DOT}*?)>|([^\\n]*?${NS}[^\\n]*?))(?:(?:[ \\t]*?\\n|[ \\t]+?)[ \\t]*?(["'])(${DOT}+?)\\4)?[ \\t]*?\\n`), // LINK_DEFINITION_START
  abbrevDef: at(`^ {0,3}\\*\\[(${DOT}+?)\\]:(${DOT}*?)\\n`), // ABBREV_DEFINITION_START
  extensions: at("^ {0,3}\\{:"), // BLOCK_EXTENSIONS_START
  ald: at(`^ {0,3}\\{:(${ALD_ID_NAME}):(${ALD_ANY}+)\\}${S}*?\\n`), // ALD_START
  ext: at(`^ {0,3}(?:\\{::(\\w+)(?:${S}${ALD_ANY}*?|)(\\/)?\\}|\\{:\\/(${ALD_ID_NAME})?\\})${S}*?\\n`), // EXT_BLOCK_START
  ial: at(`^ {0,3}\\{:(?![:\\/])(${ALD_ANY}+)\\}${S}*?\\n`), eob: at(EOB_MARKER), // IAL_BLOCK_START, its content read
  paragraphStart: at(`^ {0,3}[^ \\t]${DOT}*?\\n`), paragraph: at(PARAGRAPH_MATCH),
  paragraphEnd: at(`(?:${LAZY_END}|${LIST_START}|${ATX_HEADER_START}|${DEFINITION_LIST_START}|${BLOCKQUOTE_START}|${FENCED_CODEBLOCK_START})`), // PARAGRAPH_END_GFM
  lazyEnd: at(LAZY_END), line: at(`${DOT}*\\n`),
};
const LIST_ITEM_IAL = `^${S}*\\{:(?!(?:${ALD_ID_NAME})?:|\\/)${ALD_ANY}+\\}${S}*`;
const LIST_ITEM_IAL_CHECK = new RegExp(`^(?:${LIST_ITEM_IAL})?${S}*\\n`, "u");
const LIST_ITEM_IAL_AT = new RegExp(LIST_ITEM_IAL, "u");
const LIST_START_IN = find(LIST_START);
const rstrip = s => s.replace(/[\0\t\n\v\f\r ]+$/, ""); // Ruby's rstrip
// A list item's or definition's patterns for its content's indentation
// (PARSE_FIRST_LIST_LINE_REGEXP_CACHE), and the marker of a sibling item
// (fetch_pattern).
const ITEM_PATTERNS = new Map();
function itemPatterns(n) {
  if (!ITEM_PATTERNS.has(n)) ITEM_PATTERNS.set(n, {
    content: at(`^(?:${INDENT}{${n >> 2}} {${n % 4}}|${INDENT}{${(n >> 2) + 1}})${DOT}*${NS}${DOT}*\\n`),
    lazy: at(`(?!^ {0,${Math.min(n, 3)}}(?:${IAL_BLOCK}|${LAZY_END_HTML_STOP}|${LAZY_END_HTML_START}))${DOT}*${NS}${DOT}*\\n`),
    indent: new RegExp(`^ {${n}}`, "u"),
  });
  return ITEM_PATTERNS.get(n);
}
const MARKER = { ul: "[+*-]", ol: "\\d+\\.", dl: ":" };
const siblingPattern = (type, n) => at(`^( {0,${Math.min(Math.max(n - 1, 0), 3)}}${MARKER[type]})(${PATTERN_TAIL})`);
// parse_first_list_line: the marker line's content (its tabs expanded, then
// its leading blanks dropped) and the content's indentation.
function firstListLine(indentation, content) {
  if (LIST_ITEM_IAL_CHECK.test(content)) indentation = 4;
  else {
    while (/^ *\t/.test(content)) {
      const temp = /^ */.exec(content)[0].length + indentation;
      content = content.replace(/^( *)(\t+)/, (_, spaces, tabs) => spaces + " ".repeat(4 - (temp % 4) + (tabs.length - 1) * 4));
    }
    indentation += /^ */.exec(content)[0].length;
  }
  return [content.replace(/^[ \t\n\v\f\r]*/, "").replace(LIST_ITEM_IAL_AT, ""), indentation];
}
const leadingTabs = line => line.replace(/^\t+/, t => " ".repeat(4 * t.length));

// HTML elements by kramdown's lists (kramdown/parser/html.rb).
const HTML_BLOCK_MODEL = new Set(["address", "applet", "article", "aside", "blockquote", "body", "dd", "details", "div", "dl", "fieldset", "figure",
  "figcaption", "footer", "form", "header", "hgroup", "iframe", "li", "main", "map", "menu", "nav", "noscript", "object", "section", "summary", "td"]);
const HTML_SPAN_MODEL = new Set(["a", "abbr", "acronym", "b", "bdo", "big", "button", "cite", "caption", "del", "dfn", "dt", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "i", "ins", "label", "legend", "optgroup", "p", "q", "rb", "rbc", "rp", "rt", "rtc", "ruby", "select", "small", "span", "strong",
  "sub", "sup", "th", "tt"]);
const HTML_RAW_MODEL = new Set(["script", "style", "math", "option", "textarea", "pre", "code", "kbd", "samp", "var"]);
const HTML_BLOCK_ELEMENTS = new Set(["address", "article", "aside", "applet", "body", "blockquote", "caption", "col", "colgroup", "dd", "div", "dl",
  "dt", "fieldset", "figcaption", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "head", "iframe", "legend",
  "menu", "li", "main", "map", "nav", "ol", "optgroup", "p", "pre", "section", "summary", "table", "tbody", "td", "th", "thead", "tfoot", "tr", "ul"]);
const HTML_VOID = new Set(["area", "base", "br", "col", "command", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
const HTML_SPAN = new Set(SPAN_ELEMENTS);
const HTML_ELEMENT = new Set([...HTML_SPAN, ...HTML_BLOCK_ELEMENTS, ...HTML_VOID, ...HTML_BLOCK_MODEL, ...HTML_SPAN_MODEL, ...HTML_RAW_MODEL]);
const contentModel = name => (HTML_BLOCK_MODEL.has(name) ? "block" : HTML_SPAN_MODEL.has(name) ? "span" : "raw"); // HTML_CONTENT_MODEL
const HTML_ATTRIBUTE = new RegExp(`${S}*(${UNAME})(?:${S}*=${S}*(?:(${WORD}+)|(["'])([\\s\\S]*?)\\3))?`, "gu"); // HTML_ATTRIBUTE_RE

// A source kramdown reads (a file, or a list item's, quote's or footnote's
// content): its text, whole lines each ending "\n", the file line each of
// its lines came from, and a position.
class Scanner {
  constructor(lines) {
    this.src = lines.map(l => `${l.text}\n`).join("");
    this.starts = [];
    let offset = 0;
    for (const l of lines) {
      this.starts.push(offset);
      offset += l.text.length + 1;
    }
    this.fileLines = lines.map(l => l.line);
    this.pos = 0;
  }
  get eos() { return this.pos >= this.src.length; }
  // A regex's match at the position, ^ matching there (StringScanner#check),
  // and the same moving past it (scan).
  check(re) {
    re.lastIndex = 0;
    return re.exec(this.src.slice(this.pos));
  }
  scan(re) {
    const m = this.check(re);
    if (m !== null) this.pos += m[0].length;
    return m;
  }
  // The index of a regex's first match at or after the position, or -1.
  search(re) {
    const i = this.src.slice(this.pos).search(re);
    return i === -1 ? -1 : this.pos + i;
  }
  lineAt(pos) {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return this.fileLines[lo];
  }
  // The source from a to b, which ends a line, as lines with their file lines.
  lines(a, b) {
    assert.ok(b === a || this.src[b - 1] === "\n", portCheck("a span of a source read as lines ends a line", `${a}..${b} ends ${JSON.stringify(this.src.slice(b - 20, b))}`));
    const out = [];
    let offset = a;
    for (const text of this.src.slice(a, b).split("\n").slice(0, -1)) {
      out.push({ text, line: this.lineAt(offset) });
      offset += text.length + 1;
    }
    return out;
  }
}

// parse_attribute_list's tokens (ALD_TYPE_ANY): a key and its quoted value
// (ALD_TYPE_KEY_VALUE_PAIR, group 1 the key), a reference to an attribute
// definition (ALD_TYPE_REF), or ids and classes run together
// (ALD_TYPE_ID_OR_CLASS_MULTI, group 5: "#<id>", ".<class>"), each after the
// list's start or a blank and before a blank or its end. Ruby's [^\}\2]
// (inside a class \2 is the character U+0002, not the quote) as written.
const ALD_TOKEN = new RegExp(`(?:^|${S})(?:(${ALD_ID_NAME})=("|')((?:\\\\\\}|\\\\\\2|[^}\\x02])*?)\\2|(${ALD_ID_NAME})|((?:#[A-Za-z][\\w:-]*|\\.[^ \\t\\n\\v\\f\\r.#]+)+))(?=${S}|$)`, "gu");
// Whether an attribute list's or definition's content sets an id: a key id,
// or an "#<id>" among its ids and classes.
const setsId = content => [...content.matchAll(ALD_TOKEN)].some(t => t[1] === "id" || /#[A-Za-z]/.test(t[5] ?? ""));

// What a parser's tree holds that the parsers read back: each child's type,
// and a blank's lines or an end-of-block marker's kind (value).
const add = (tree, type, value) => tree.children.push({ type, value });
const afterBlockBoundary = tree => {
  const last = tree.children.at(-1);
  return last === undefined || last.type === "blank" || (last.type === "eob" && last.value === null);
};
const FOUND = Symbol("found"); // the block HTML parser found the end tag of the element being read (throw :stop_block_parsing, :found)

// kramdown's block parsers in its order (GFM's ATX heading and fenced code
// block parsers in place of kramdown's), each a start regex and a parser
// given the scanner, the tree, the file's state and which renderer gives a
// heading here its id (ids); a parser gives true (read), false (not, so the
// next is tried) or FOUND.
const BLOCK_PARSERS = [
  [RE.blank, (sc, tree, file, ids, m) => {
    sc.pos += m[0].length;
    const last = tree.children.at(-1);
    if (last?.type === "blank") last.value += m[0];
    else add(tree, "blank", m[0]);
    return true;
  }],
  [RE.codeStart, (sc, tree) => {
    const m = sc.scan(RE.code);
    assert.ok(m[0] !== "", portCheck("an indented code block (CODEBLOCK_MATCH) takes a line", `none at ${JSON.stringify(sc.src.slice(sc.pos, sc.pos + 40))}`));
    add(tree, "codeblock");
    return true;
  }],
  [RE.fenceStart, (sc, tree) => {
    const m = sc.scan(RE.fence);
    if (m === null) return false;
    add(tree, "codeblock");
    return true;
  }],
  [RE.quote, (sc, tree, file, ids) => {
    const from = sc.pos;
    sc.scan(RE.paragraph);
    while (sc.check(RE.lazyEnd) === null) sc.scan(RE.paragraph);
    add(tree, "blockquote");
    parseBlocks(new Scanner(sc.lines(from, sc.pos).map(l => ({ ...l, text: l.text.replace(/^ {0,3}> ?/, "") }))),
      { type: "blockquote", children: [] }, file, ids);
    return true;
  }],
  [RE.atx, (sc, tree, file, ids, m) => {
    const raw = rstrip(m[2]);
    const text = raw.replace(/[\t ]#+$/, "").replace(/[\0\t\n\v\f\r ]+$/, "");
    if (text === "") return false;
    return header(sc, tree, file, ids, m, raw, text);
  }],
  [RE.hr, (sc, tree, file, ids, m) => {
    sc.pos += m[0].length;
    add(tree, "hr");
    return true;
  }],
  [RE.list, (sc, tree, file, ids) => parseList(sc, tree, file, ids)],
  [RE.dl, (sc, tree, file, ids) => parseDefinitionList(sc, tree, file, ids)],
  [RE.html, (sc, tree, file, ids) => parseBlockHtml(sc, tree, file, ids)],
  [RE.setext, (sc, tree, file, ids, m) => {
    if (!afterBlockBoundary(tree)) return false;
    const raw = rstrip(m.groups.contents);
    return raw === "" ? false : header(sc, tree, file, ids, m, raw, raw);
  }],
  [RE.math, (sc, tree, file, ids, m) => {
    if (!afterBlockBoundary(tree)) return false;
    if (m[1] !== undefined) {
      if (m[3] !== undefined) sc.scan(RE.mathEscape);
      return false;
    }
    const saved = sc.pos;
    sc.pos += m[0].length;
    if (sc.check(RE.boundary) !== null) {
      add(tree, "math");
      return true;
    }
    sc.pos = saved;
    return false;
  }],
  [RE.tableStart, (sc, tree, file) => parseTable(sc, tree, file)],
  [RE.footnote, (sc, tree, file, ids, m) => {
    const from = sc.pos + m[0].length - m[2].length;
    sc.pos += m[0].length;
    file.labels.add(`^${m[1]}`);
    parseBlocks(new Scanner(sc.lines(from, sc.pos).map(l => ({ ...l, text: l.text.replace(/^(?:\t| {4})/, "") }))),
      { type: "footnote_def", children: [] }, file, "footnote");
    add(tree, "eob", "footnote_def");
    return true;
  }],
  [RE.linkDef, (sc, tree, file, ids, m) => {
    if (/[ \t]+["']/.test(m[3] ?? "")) return false;
    sc.pos += m[0].length;
    file.labels.add(m[1].replace(/[ \t\n\v\f\r]+/g, " ").toLowerCase());
    add(tree, "eob", "link_def");
    return true;
  }],
  [RE.abbrevDef, (sc, tree, file, ids, m) => {
    sc.pos += m[0].length;
    add(tree, "eob", "abbrev_def");
    return true;
  }],
  // parse_block_extensions: an attribute definition, an extension or a
  // block attribute list. An extension ({::comment}, {::nomarkdown},
  // {::options ...}, a stray stop tag) stops the reader: it can drop content
  // or set the options that give headings their ids. A definition or a list
  // whose attributes set an id stops it too, since a list can give a heading
  // an id, directly or through a definition it refers to (the definitions'
  // references are resolved after the whole file is read, so one that sets an
  // id stops the reader wherever it stands); any other definition or list
  // gives no heading an id ("{:toc}", "{: .no_toc}", a title), and is read as
  // kramdown reads it: a definition an end-of-block marker, a list one after
  // the block it follows where it applies to that block (and no list follows
  // it), and nothing where it waits for the next block. Until the second final
  // review of the sixth fix run (2026-11-07) every one of them stopped the
  // reader, so a table of contents or a class added to data/README.md, which
  // leave every id as it is, turned vmt-rationale-text.qual red.
  [RE.extensions, (sc, tree, file) => {
    const line = sc.lineAt(sc.pos);
    let m = sc.scan(RE.ald);
    if (m !== null) {
      if (setsId(m[2])) file.stop(line, "a kramdown attribute definition that sets an id ({:<name>: #<id>} or id=), which an attribute list can give a heading");
      add(tree, "eob", "ald");
      return true;
    }
    if (sc.check(RE.ext) !== null) {
      sc.scan(RE.line);
      file.stop(line, "a kramdown extension ({:: or {:/), which can drop content or set the options that give headings their ids");
      add(tree, "eob", "extension");
      return true;
    }
    m = sc.scan(RE.ial);
    if (m === null) return false;
    if (setsId(m[1])) file.stop(line, "a kramdown attribute list that sets an id ({: #<id>} or id=), which can set a heading's");
    const last = tree.children.at(-1);
    const toLast = last !== undefined && last.type !== "blank" && (last.type !== "eob" || ["link_def", "abbrev_def", "footnote_def"].includes(last.value));
    if (toLast && sc.check(RE.ial) === null) add(tree, "eob", "ial");
    return true;
  }],
  [RE.eob, (sc, tree, file, ids, m) => {
    sc.pos += m[0].length;
    add(tree, "eob", null);
    return true;
  }],
  [RE.paragraphStart, (sc, tree) => {
    sc.scan(RE.paragraph);
    while (sc.check(RE.paragraphEnd) === null) sc.scan(RE.paragraph);
    if (tree.children.at(-1)?.type !== "p") add(tree, "p");
    return true;
  }],
];

// A heading (add_header): its line, its text as written (raw, which an
// explicit id ends) and as kramdown reads it, and which renderer gives it its
// id (ids, INSIDE_ELEMENT's modes).
function header(sc, tree, file, ids, m, raw, text) {
  file.headers.push({ line: sc.lineAt(sc.pos), raw, text, ids });
  sc.pos += m[0].length;
  add(tree, "header");
  return true;
}

// parse_blocks: the source's blocks into the tree, each read by the first
// parser in order that reads it, a line none reads being text. FOUND when an
// end tag of the element whose content this is ends it.
function parseBlocks(sc, tree, file, ids) {
  while (!sc.eos) {
    let read = false;
    for (const [start, parse] of BLOCK_PARSERS) {
      const m = sc.check(start);
      if (m === null) continue;
      read = parse(sc, tree, file, ids, m);
      if (read === FOUND) return FOUND;
      if (read) break;
    }
    if (!read) {
      sc.scan(RE.line);
      if (tree.children.at(-1)?.type !== "raw_text") add(tree, "raw_text");
    }
  }
  return null;
}

// parse_list: a list's items, each to the line that ends it, then each
// item's content (in chunks, a nested list's first line starting one) as
// its own blocks.
function parseList(sc, tree, file, ids) {
  const type = sc.check(RE.ul) !== null ? "ul" : "ol";
  let marker = type === "ul" ? RE.ul : RE.ol, item = null, indentation = 0, patterns = null;
  let eobFound = false, nestedListFound = false, lastIsBlank = false;
  const items = [];
  while (!sc.eos) {
    if (lastIsBlank && sc.check(RE.hr) !== null) break;
    if (sc.scan(RE.eob) !== null) {
      eobFound = true;
      break;
    }
    const line = sc.lineAt(sc.pos);
    let m = sc.scan(marker);
    if (m !== null) {
      let content;
      [content, indentation] = firstListLine(m[1].length, m[2]);
      assert.ok(content === "" || content.endsWith("\n"), portCheck("a list item's first line ends a line or is empty", JSON.stringify(content)));
      patterns = itemPatterns(indentation);
      marker = siblingPattern(type, indentation);
      nestedListFound = LIST_START_IN.test(content);
      lastIsBlank = false;
      item = [content === "" ? [] : [{ text: content.slice(0, -1), line }]];
      items.push(item);
      continue;
    }
    const from = sc.pos;
    m = sc.scan(patterns.content) ?? (lastIsBlank ? null : sc.scan(patterns.lazy));
    if (m !== null) {
      let result = leadingTabs(m[0]);
      const indented = patterns.indent.test(result);
      result = result.replace(patterns.indent, "");
      if (!nestedListFound && indented && LIST_START_IN.test(result)) {
        item.push([]);
        nestedListFound = true;
      } else if (nestedListFound && !indented && LIST_START_IN.test(result)) result = " ".repeat(indentation + 4) + result;
      item.at(-1).push({ text: result.slice(0, -1), line: sc.lineAt(from) });
      lastIsBlank = false;
      continue;
    }
    if (sc.check(RE.blank) !== null) {
      const blankFrom = sc.pos;
      sc.scan(RE.blank);
      nestedListFound = true;
      lastIsBlank = true;
      item.at(-1).push(...sc.lines(blankFrom, sc.pos));
      continue;
    }
    break;
  }
  add(tree, type);
  let last = null;
  for (const chunks of items) {
    const temp = { type: "li", children: [] };
    for (const chunk of chunks) parseBlocks(new Scanner(chunk), temp, file, ids);
    if (temp.children.length === 0) continue;
    last = temp.children.at(-1).type === "blank" ? temp.children.pop() : null;
  }
  if (last !== null && !eobFound) tree.children.push(last);
  return true;
}

// parse_definition_list: after a paragraph (its lines the terms), each
// definition to the line that ends it, then each one's content as its own
// blocks.
function parseDefinitionList(sc, tree, file, ids) {
  const children = tree.children, n = children.length;
  if (n === 0 || (n === 1 && children[0].type !== "p")
    || (n >= 2 && children[n - 1].type !== "p" && (children[n - 1].type !== "blank" || children[n - 1].value !== "\n" || children[n - 2].type !== "p"))) return false;
  if (children.pop().type === "blank") children.pop();
  let marker = RE.dl, item = null, patterns = null, lastIsBlank = false;
  const items = [];
  while (!sc.eos) {
    const line = sc.lineAt(sc.pos);
    let m = sc.scan(marker);
    if (m !== null) {
      const [content, indentation] = firstListLine(m[1].length, m[2]);
      assert.ok(content === "" || content.endsWith("\n"), portCheck("a definition's first line ends a line or is empty", JSON.stringify(content)));
      patterns = itemPatterns(indentation);
      marker = siblingPattern("dl", indentation);
      lastIsBlank = false;
      item = content === "" ? [] : [{ text: content.slice(0, -1), line }];
      items.push(item);
      continue;
    }
    if (sc.check(RE.eob) !== null) break;
    const from = sc.pos;
    m = sc.scan(patterns.content) ?? (lastIsBlank ? null : sc.scan(patterns.lazy));
    if (m !== null) {
      item.push({ text: leadingTabs(m[0]).replace(patterns.indent, "").slice(0, -1), line: sc.lineAt(from) });
      lastIsBlank = false;
      continue;
    }
    if (sc.check(RE.blank) !== null) {
      const blankFrom = sc.pos;
      sc.scan(RE.blank);
      item.push(...sc.lines(blankFrom, sc.pos));
      lastIsBlank = true;
      continue;
    }
    break;
  }
  let last = null;
  for (const lines of items) {
    const dd = { type: "dd", children: [] };
    parseBlocks(new Scanner(lines), dd, file, ids);
    if (dd.children.length === 0) continue;
    last = dd.children.at(-1).type === "blank" ? dd.children.pop() : null;
  }
  // The definitions join a definition list just before them (a blank line
  // between dropped), or start one.
  if (children.at(-1)?.type === "blank" && children.at(-2)?.type === "dl") children.pop();
  if (children.at(-1)?.type !== "dl") add(tree, "dl");
  if (last !== null) children.push(last);
  return true;
}

// parse_block_html: a comment, an element's start tag (not a span-level
// element's), or the end tag of the element whose content is being read.
function parseBlockHtml(sc, tree, file, ids) {
  if (sc.scan(RE.htmlComment) !== null) {
    add(tree, "xml_comment");
    sc.scan(RE.trailing);
    return true;
  }
  let m = sc.check(RE.htmlTag);
  if (m !== null && !HTML_SPAN.has(m.groups.n.toLowerCase())) {
    sc.pos += m[0].length;
    htmlStartTag(sc, tree, file, m, ids);
    return true;
  }
  m = sc.check(RE.htmlClose);
  if (m !== null && !HTML_SPAN.has(m[1].toLowerCase())) {
    if (tree.type !== "html_element" || tree.value !== m[1].toLowerCase()) return false;
    sc.pos += m[0].length;
    return FOUND;
  }
  return false;
}

// handle_html_start_tag and handle_kramdown_html_tag: an element whose start
// tag was just read, its content read by its content model: raw (to its end
// tag, nested elements' own end tags read as theirs: parse_raw_html), span
// (to its end tag) or block (as blocks, to its end tag at a block's start),
// raw unless a markdown attribute says otherwise. No heading inside an
// element gets an id when the file is parsed (kramdown-parser-gfm's
// update_elements does not look inside one): one inside an element read as
// markdown gets its id when the page is written, from kramdown's HTML
// converter (INSIDE_ELEMENT).
function htmlStartTag(sc, tree, file, m, ids) {
  const known = HTML_ELEMENT.has(m.groups.n.toLowerCase());
  const name = known ? m.groups.n.toLowerCase() : m.groups.n;
  const attrs = new Map([...m.groups.attrs.matchAll(HTML_ATTRIBUTE)].map(a => [known ? a[1].toLowerCase() : a[1], a[2] ?? a[4] ?? ""]));
  const el = { type: "html_element", value: name, children: [], model: "raw" };
  tree.children.push(el);
  const closed = m.groups.closed !== undefined || HTML_VOID.has(name);
  const raw = name === "script" || name === "style";
  if (raw) pastEndTag(sc, name);
  el.model = new Map([["0", "raw"], ["1", contentModel(name)], ["span", "span"], ["block", "block"]]).get(attrs.get("markdown")) ?? "raw"; // HTML_MARKDOWN_ATTR_MAP
  if (el.model === "block") sc.scan(RE.trailing);
  if (closed || raw) return;
  if (el.model === "block") parseBlocks(sc, el, file, INSIDE_ELEMENT[ids]);
  else if (el.model === "span") pastEndTag(sc, name);
  else parseRawHtml(sc, el, file, ids);
  if (!(tree.type === "html_element" && tree.model === "raw")) sc.scan(RE.trailing);
}

// To past an element's end tag (its name, in any case), or the source's end
// (scan_until, then HTML_TAG_CLOSE_RE).
function pastEndTag(sc, name) {
  const end = sc.search(new RegExp(`<\\/${name}${S}*>`, "imu"));
  if (end === -1) {
    sc.pos = sc.src.length;
    return;
  }
  sc.pos = end;
  sc.scan(RE.rawClose);
}

// parse_raw_html: an element's raw content, to its end tag (one of its name,
// in the case written unless kramdown knows the element), or the source's
// end; comments, processing instructions and nested elements read as such.
function parseRawHtml(sc, el, file, ids) {
  while (!sc.eos) {
    const next = sc.search(RE.rawStart);
    if (next === -1) {
      sc.pos = sc.src.length;
      return;
    }
    sc.pos = next;
    let m;
    if (sc.scan(RE.htmlComment) !== null || sc.scan(RE.rawInstruction) !== null) continue;
    if ((m = sc.check(RE.rawTag)) !== null) {
      sc.pos += m[0].length;
      htmlStartTag(sc, el, file, m, ids);
      continue;
    }
    if ((m = sc.scan(RE.rawClose)) !== null) {
      if (el.value === (HTML_ELEMENT.has(el.value) ? m[1].toLowerCase() : m[1])) return;
      continue;
    }
    sc.pos += 1;
  }
}

// parse_table: lines with a pipe, after a block boundary and before one, in
// which each line holds a pipe outside code spans, and with a body;
// otherwise no table, and the next parser reads its first line.
function parseTable(sc, tree, file) {
  if (!afterBlockBoundary(tree)) return false;
  const saved = sc.pos;
  sc.scan(RE.tableSep);
  let rows = 0, hasFooter = false, aligned = false;
  const containers = [];
  const addContainer = (type, force) => {
    if (!hasFooter || type !== "tbody" || force) {
      containers.push(type);
      rows = 0;
    }
  };
  while (!sc.eos && sc.check(RE.tableLine) !== null) {
    if (sc.scan(RE.tableSep) !== null) {
      if (rows === 0) continue;
      if (!aligned && !hasFooter) {
        addContainer("thead", false);
        aligned = true;
      } else addContainer("tbody", false);
    } else if (sc.scan(RE.tableFsep) !== null) {
      if (rows > 0) addContainer("tbody", true);
      hasFooter = true;
    } else if (sc.scan(RE.tableRow) !== null) rows += 1;
    else break;
  }
  if (sc.check(RE.boundary) === null) {
    sc.pos = saved;
    return false;
  }
  const spans = tableSpans(sc.src.slice(saved, sc.pos - 1));
  if (spans === null) {
    file.stop(sc.lineAt(saved), "a table holding an inline HTML element with content, which kramdown's pipe check reads with every span parser");
    sc.pos = saved;
    return false;
  }
  if (!pipeOnEveryLine(spans)) {
    sc.pos = saved;
    return false;
  }
  if (rows > 0) addContainer(hasFooter ? "tfoot" : "tbody", false);
  if (!containers.includes("tbody")) {
    sc.pos = saved;
    return false;
  }
  add(tree, "table");
  return true;
}
// parse_span_html's regexes at a span's start: HTML_SPAN_START, then a
// comment, an end tag or a start tag.
const SPAN_HTML = {
  start: new RegExp(`^<(?:${UNAME}|!--|\\/)`, "u"), comment: new RegExp(`^${HTML_COMMENT}`, "u"),
  close: new RegExp(`^${HTML_TAG_CLOSE}`, "u"), tag: new RegExp(`^${HTML_TAG}`, "u"),
};
// The table's text as parse_spans reads it with the code span and span
// HTML parsers alone: text, code spans, comments and elements with no
// content, each with its value (a code span's code, a comment's text, an
// element's name); null where an inline element has content.
function tableSpans(text) {
  const out = [];
  const textSpan = s => {
    if (s === "") return;
    if (out.at(-1)?.type === "text") out.at(-1).value += s;
    else out.push({ type: "text", value: s });
  };
  let i = 0;
  while (i < text.length) {
    const j = text.slice(i).search(/[`<]/);
    if (j === -1) {
      textSpan(text.slice(i));
      break;
    }
    textSpan(text.slice(i, i + j));
    i += j;
    const rest = text.slice(i);
    if (rest[0] === "`") {
      const run = /^`+/.exec(rest)[0], before = text.slice(0, i);
      if (run === "`" && (before === "" || /[ \t\n\v\f\r]$/.test(before)) && /^`[ \t\n\v\f\r]/.test(rest)) {
        textSpan(run);
        i += 1;
        continue;
      }
      const close = text.indexOf(run, i + run.length);
      if (close === -1) {
        textSpan(run);
        i += run.length;
        continue;
      }
      const code = text.slice(i + run.length, close);
      out.push({ type: "codespan", value: run === "`" ? code : code.replace(/^ /, "").replace(/ $/, "") });
      i = close + run.length;
      continue;
    }
    let m;
    if (!SPAN_HTML.start.test(rest)) {
      textSpan("<");
      i += 1;
    } else if ((m = SPAN_HTML.comment.exec(rest)) !== null) {
      out.push({ type: "comment", value: m[0] });
      i += m[0].length;
    } else if ((m = SPAN_HTML.close.exec(rest)) !== null) {
      textSpan(m[0]);
      i += m[0].length;
    } else if ((m = SPAN_HTML.tag.exec(rest)) !== null) {
      const name = HTML_ELEMENT.has(m.groups.n.toLowerCase()) ? m.groups.n.toLowerCase() : m.groups.n;
      if (HTML_BLOCK_ELEMENTS.has(name)) textSpan(m[0]);
      else if (m.groups.closed !== undefined || HTML_VOID.has(name)) out.push({ type: "element", value: name });
      else return null;
      i += m[0].length;
    } else {
      textSpan("<");
      i += 1;
    }
  }
  return out;
}
// parse_table's check that every line holds a pipe outside code spans.
const PIPE_CHECK = new RegExp(`^${TABLE_PIPE_CHECK}`, "u");
function pipeOnEveryLine(spans) {
  let pipe = false;
  for (const s of spans) {
    const lines = s.value.split("\n");
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    if (s.type === "codespan") {
      if (lines.length > 2 || (lines.length === 2 && !pipe)) break;
      if (lines.length === 2) pipe = false;
    } else {
      if (lines.length > 1 && !pipe && !PIPE_CHECK.test(lines[0])) break;
      pipe = (lines.length > 1 ? false : pipe) || (lines.length > 0 && PIPE_CHECK.test(lines.at(-1)));
    }
  }
  return pipe;
}

// Jekyll's YAML_FRONT_MATTER_REGEXP.
const FRONT_MATTER = new RegExp(`^(---${S}*\\n[\\s\\S]*?\\n?)(?:(?<=\\n)|(?<![\\s\\S]))((?:---|\\.\\.\\.)${S}*(?=\\n|(?![\\s\\S]))\\n?)`, "u");

// Which renderer gives a heading its id, by where the heading sits (the
// mode parseBlocks carries): "gfm" at the file's top level and in a list
// item, a quote or a definition there, when the file is parsed
// (kramdown-parser-gfm's generate_gfm_header_id, its counter per id, in
// document order); "converter" inside an HTML element read as markdown, when
// the page is written (kramdown's HTML converter, convert_header:
// generate_id, its own counter, in document order); "footnote" in a
// footnote's content, which the page writes after the rest and only where
// the footnote is referenced, the converter's id there, in that order (this
// reader leaves such a heading unread). An element inside a footnote is the
// footnote's; until 2026-11-07 a heading inside an element read as markdown
// was read as getting no id, which the page gives it.
const INSIDE_ELEMENT = { gfm: "converter", converter: "converter", footnote: "footnote" };
// The id kramdown's HTML converter makes from a heading's text as it renders
// (basic_generate_id, then generate_id's "section" for an empty one), before
// numbering: its characters dropped up to its first ASCII letter, then every
// character but an ASCII letter or digit, a space or a hyphen; each space a
// hyphen; lowercased.
const converterId = text => text.replace(/^[^a-zA-Z]+/, "").replace(/[^a-zA-Z0-9 -]/g, "").replace(/ /g, "-").toLowerCase() || "section";
const BASE_ID = { gfm: headingId, converter: converterId };
// Why a heading is left unread by where it sits, beside the marks
// HEADING_STOPS lists in its text.
const UNREAD_WHERE = { gfm: [], converter: [],
  footnote: ["a heading in a footnote, which the page writes after the rest, only where the footnote is referenced"] };

// Each heading of a markdown file, in document order: its line, its text as
// kramdown reads it (heading), and its id. A heading whose text holds a mark
// HEADING_STOPS lists, or that sits in a footnote, is left unread (unread
// gives why): its id is not known here (anchor null, anchors empty), and,
// since it may share a later heading's base, it makes the number of each
// later id its renderer gives uncertain by one (anchors, every id the
// heading may have, the first, anchor, the one it has if no unread heading
// before it shares its base). An empty id (a heading whose text keeps no
// character the id keeps) is one the page does not write. The forms whose
// effect on the file's headings this reader does not compute, Liquid, a
// kramdown extension at a block's start, an attribute list or attribute
// definition there that sets an id, and a table holding an inline HTML
// element with content, stop it (it throws, naming each line and why). Until
// 2026-11-07 a heading of an unread form stopped it too, so a correct edit of
// the file adding one, which no link targets, turned vmt-rationale-text.qual
// red.
export function headingAnchors(markdown, file) {
  const bomless = markdown.replace(/^\uFEFF/, "");
  const front = FRONT_MATTER.exec(bomless);
  const content = front === null ? bomless : bomless.slice(front[0].length);
  const skipped = front === null ? 0 : front[0].replace(/\r\n?/g, "\n").split("\n").length - 1;
  // adapt_source
  const text = content.replace(/\r\n?/g, "\n").replace(/\n$/, "") + "\n";
  const lines = text.split("\n").slice(0, -1);
  const problems = [];
  const state = {
    headers: [], labels: new Set(),
    stop: (line, what) => problems.push(`line ${line}, ${what}: ${JSON.stringify(lines[line - skipped - 1])}`),
  };
  for (const [i, l] of lines.entries()) if (/\{\{|\{%/.test(l)) state.stop(i + skipped + 1, "Liquid ({{ or {%), which Jekyll runs on the file before kramdown reads it");
  parseBlocks(new Scanner(lines.map((l, i) => ({ text: l, line: i + skipped + 1 }))), { type: "root", children: [] }, state, "gfm");
  if (problems.length > 0) {
    throw new Error(`Replicata: read the headings of ${file} to compute the ids GitHub Pages gives them.
Expectata: no form whose effect on the file's headings this reader does not compute (quals/rationale-links.mjs, headingAnchors): Liquid, a kramdown extension at a block's start, an attribute list or attribute definition there that sets an id, or a table holding an inline HTML element with content.
Resultata: ${problems.join("; ")}.`);
  }
  const ids = [], counts = { gfm: new Map(), converter: new Map() }, unreadBefore = { gfm: 0, converter: 0, footnote: 0 };
  for (const h of state.headers) {
    const t = { raw: h.raw, ...headingText(h.text) };
    // An explicit id, "{#<id>}" ending the heading's text (kramdown's
    // HEADER_ID, its id an XML name, read here in its ASCII part; an id with
    // another character stays unread, HEADING_STOPS' "an explicit id"), is the
    // heading's id as written, and it counts toward neither counter: GFM's
    // update_elements and the converter number only the ids they generate
    // (kramdown-parser-gfm 1.1.0, gfm.rb: `!child.attr.key?('id')`). Until the
    // main agent's pass after the sixth fix run's third final review
    // (2026-11-07) such a heading was left unread, so a correct edit of
    // data/README.md giving a linked heading its own id as an explicit one
    // turned vmt-rationale-text.qual red, its links naming no heading.
    const explicit = /[\t ]\{#([A-Za-z_:][\w.:-]*)\}$/.exec(h.raw);
    if (explicit !== null && h.ids !== "footnote") { ids.push({ line: h.line, heading: h.text, anchor: explicit[1], anchors: [explicit[1]], unread: [] }); continue; }
    const unread = [...UNREAD_WHERE[h.ids], ...HEADING_STOPS.filter(([stops]) => stops(t, state.labels)).map(([, what]) => what)];
    if (unread.length > 0) {
      unreadBefore[h.ids] += 1;
      ids.push({ line: h.line, heading: h.text, anchor: null, anchors: [], unread });
      continue;
    }
    const base = BASE_ID[h.ids](t.shown), count = counts[h.ids], n = (count.get(base) ?? -1) + 1;
    count.set(base, n);
    const anchors = Array.from({ length: unreadBefore[h.ids] + 1 }, (_, k) => (n + k === 0 ? base : `${base}-${n + k}`));
    ids.push({ line: h.line, heading: h.text, anchor: anchors[0], anchors, unread });
  }
  return ids;
}

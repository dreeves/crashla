import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";
import { LINK, DATA_LINK, OPEN_TARGET, rationaleLinks, rationaleText, headingAnchors } from "./rationale-links.mjs";

// The sanity section's "VMT sources" table shows each data/vmt.csv rationale
// as written, its links as links (those of the window's months, and a ghost
// month's when the window ends at the newest NHTSA month; data/README.md,
// Ghost months), so the rationales are page text. Added 2026-10-03 for the 2026-10-02 audit
// findings #38, #39, #47 and #76-#80:
//   (1) every link names a section of data/README.md. A rationale points a
//       reader at a section with a markdown link whose text is the pointer
//       and whose target is that section on the site, "[data/README.md, Zoox
//       anchors](data/#zoox-anchors)", which the VMT sources table shows as a
//       link (vmt-source-links.qual): GitHub Pages renders data/README.md at
//       data/, each heading with an id, which quals/rationale-links.mjs
//       computes offline from each heading's text as GitHub Pages renders it
//       (headingAnchors, which reads the file's blocks as kramdown does and
//       stops on the few forms whose effect on a heading it does not compute;
//       it is checked on synthetic files against the ids GitHub Pages' own
//       stack gives them). Each link (any
//       "[<text>](<target>)") has a text other than blanks and the target
//       data/#<anchor>, <anchor> one of those ids, each of which is
//       non-empty, in the form the page reads (crashla.js reads an anchor as
//       lowercase letters, digits and hyphens, so a link to a heading whose
//       id holds an underscore or another letter would stop the page; this
//       test is also run on synthetic links); and no "](" or target "data/#"
//       stands outside a link but inside a longer path or address (a link of
//       the wrong form; the site's address in prose is no link,
//       OPEN_TARGET). A prose mention of a file or a section goes unchecked.
//       Since 2026-11-05
//       links replace the prose citations ("<file>, <section>") this check
//       read until then, which it had to guess at, so that some correct
//       phrasings turned it red (the human's "ok, go with links",
//       2026-11-04);
//   (2) no repo-internal column name or shorthand (kyoom, vmt_min/vmt_max,
//       TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best", "D/H"), none
//       of which the page defines (rule 13);
//   (3) every figure a rationale states in a form (3a) reads passes that
//       form's test: a value is the rows' to its stated precision (a
//       cumulative, a cumulative band or its floor, a calendar year's miles,
//       a row's miles, band, daily or weekly rate or band multipliers, a
//       named month's or quarter's daily rate, a figure of Tesla's
//       no-monitor page, a lifetime on a day, and a hub figure, the one the
//       anchors for its month use); a sum holds (a row's listed terms, a
//       quarter's split of an increment, one line's miles less another's), as
//       do a product ("<b> x <f> = <r>", r to its precision), a share, a
//       run-rate and a month at another's per-day rates, the stated figures
//       taken as exact; each reading a rationale says a band holds lies
//       inside it; a floor (a public one the series clears, one set on a
//       month's miles, a floor only one of three readings meets) is one the
//       rows meet; a figure marked approximate by its "~" holds to one unit
//       of its last digit; and the CPUC miles a product starts from are a
//       month's of data/waymo-ca.csv. Most forms read Waymo's rationales;
//       the end-of-month form, a product, the forms that name a month or
//       state a row's own figures, and the forms added for Tesla's and Zoox's
//       figures read every line's, but for the no-monitor page's readings
//       and the figures after them, read in the Tesla lines' rows only.
//       Since 2026-11-04 they include the terms, products, CPUC
//       miles and Tesla and Zoox figures the fourth fix run's reviews listed,
//       and the band edges and floors (3c) required until 2026-11-03
//       (below); since 2026-11-05, the figures the fifth run's reviews
//       listed: Tesla's July-September 2026 floors, centrals and tops, its
//       rows' figures of the no-monitor line and the Q2 deck, the no-monitor
//       line's page readings, Zoox's 1M crossing, its Dec-31 lifetime and
//       its October rates, Tesla's 2025 deck floor, Waymo's July crash
//       count, Tesla's "~15%" and "~3%", Waymo's Q2 splits and run-rates,
//       October's per-day terms and Zoox's pre-series arithmetic. These
//       figures are checked where their wording appears and no (3a) form is
//       required, so a statement reworded out of its form goes unchecked: no
//       qual may enforce the wording of text the human might edit (the
//       human's rule of 2026-11-03). Earlier on 2026-11-03 six of the seven
//       forms (3a) then read each had to be found at least once, which
//       turned the qual red on a rewording alone; before that (3a) read one
//       form, a Waymo "<x>M end-<Mon>-<YYYY>", which no Waymo rationale had
//       used since 2026-10-31, and which now reads every line. Until
//       2026-11-05 that form read a figure as the line's series cumulative
//       only, which leaves out its pre-series miles, its rider-only (Waymo)
//       or driverless (Zoox) miles before the series starts, so a correct
//       lifetime or hub figure failed there. Every figure a Waymo rationale
//       states for the pre-series offset (the builder's "miles driven before
//       it, <central> (range <low>-<high>)", the Apr-Jun 2026 rows' "<x>M
//       pre-series miles" and June's "pre-series miles' range, <low>M-<high>M")
//       equals data/waymo_vmt.py's OFFSET, where its form appears, no form
//       being required (since 2026-11-03; that day also required each form at
//       least once and every "pre-series" in a Waymo rationale inside one,
//       until the human's answer that evening; until then this checked
//       milestones listed as "exact centrals minus ~0.15M", a wording gone
//       from the rows since 2026-10-31, against the cumulative plus 0.15M);
//   (4) the specific facts the audit corrected stay corrected.
// Checks (2), (3) and (4) read each rationale as the page shows it, each link
// as its text (quals/rationale-links.mjs, rationaleText), so no frame or
// phrase reads a link's target or brackets; the visible text is the
// rationale as it stood before its pointers became links (2026-11-05).
// No check here requires a wording: a link, figure or fact is checked
// where it appears, and a statement reworded out of its form goes
// unchecked. Until 2026-11-03 three checks since removed required words, so a
// correct rewording turned them red: (3c) required five knot and floor
// rows (Zoox Nov-2025, Dec-2025, Mar-2026 and Jul-2026, Tesla Aug-2026) to
// state their band edges as the rows' figures with thousands commas; three of
// (4)'s facts required words beside a trigger (Waymo's weekly-trips quote
// word for word, "'more than half a million paid trips weekly' (Waymo, Sep
// 15, 2026", wherever "half a million" appeared in a Waymo rationale; "Aug 28"
// beside NTA's "Sub 5" order; "X user" beside Zoox's "Jan 22-27" outage); and
// (5) required "driver's seat", "Level 2 file" and "no-monitor line" in each
// of Tesla's Sep 2025-Jun 2026 rationales, which disclose that those months
// may hold trips with a safety monitor in the driver's seat (the human's
// decision of 2026-10-31, open question 13). The human chose "Drop required
// words" for them on 2026-11-03, after (3b)'s two requirements went the
// same day. Two checks forbid wording, so a correct statement that uses one
// of their phrases turns the qual red: (2)'s seven shorthand patterns (item
// (2) above), and the phrase each of (4)'s facts but the last (which reads
// the rows) looks for: in any rationale "±<n>% " followed by a capital
// letter, "fleet figure measured after Jun 2026", "~28% high for Q2",
// "x1.0688", "CSV4 v2" with "not yet linked" in the same rationale, and
// "tow-away of a vehicle equipped with an ADS" (or "of an ADS-equipped
// vehicle"); in a Waymo rationale "Denver" or "Las Vegas" within 40
// characters before "public from Sep", "Next anchors: Alphabet", "No Waymo
// total-miles figure measured after Jun 2026 exists", "only Waymo total-miles
// figure" (or "total-distance") and "scaled to US"; in a Zoox rationale
// "granted Jul 30", "exemption Jul 30" and "Nov 22"; and in the no-monitor
// line's rationales "the mean of holding the last week flat" and "plus the
// 4.8% gap". A frame of (3a) or (3b) takes a figure set in its words for the
// figure it names, so a correct figure that means something else could fail
// there. No frame may turn red on a correct figure (the human's rule of
// 2026-11-03), so a frame reads only beside the words that say whose figure
// it states, or else accepts a figure that is right under any meaning its
// words could have, and a figure right under none still fails. Read only
// beside such words: the builder's offset follows "miles driven before it, "
// (since 2026-11-04; until then a component's "3,245,248 (range
// 3,100,000-3,400,000)" was read as the offset); a Waymo "Total <x>M, about
// <y>k a day" has right after it a parenthesis, holding no other, with
// "<Monthname>'s row <digit>" in it, which sets its rate beside a row's
// (since 2026-11-04; until then a component's "Total 1.40M, about 47k a day"
// failed as the row's, and a "measured Q<n>" in a parenthesis after it was
// read as the row's quarter); a Waymo "Band x<lo> to x<hi>" has "the
// components' ranges combined" after it in its sentence, which a stop not
// between digits ends and a semicolon does not (since 2026-11-04; until then
// a component's band failed as the row's); and since 2026-11-05 the hub's
// figure follows "update: " with its clause ending after the month (until
// then a county's "92.121M rider-only miles thru Jun-2026" failed as the
// hub's), and a "Cross-check: <x>M/mo ≈ <y>M/wk" is the row's only with " vs
// Waymo's" after it, its two figures agreeing with each other for the row's
// month either way (until then a component's pair failed as the row's).
// Read under any meaning, since 2026-11-05: a month-end figure is a line's
// series cumulative, its lifetime or, for Waymo, the hub's figure (until
// then the series cumulative only, so "271.329M end-Jun-2026", written for
// the hub's figure, failed); a month named without its year is the month of
// that name within 11 months either way of the row's, in the row's line or,
// for a Tesla line, either Tesla line (until then that month of the row's
// year in the row's line, so a January row's "December's cumulative band"
// was read as the December after it, and the no-monitor line's figure in a
// Tesla row as Tesla's); and a CPUC base is any month's of its stated
// quarter (until then the row's month's, so a June row quoting May's miles
// failed). Since 2026-11-05 a list of Waymo terms sums every term it holds
// (until then the five or six it named, so a correct "Travis 1.75M, Denver
// 0.10M, Atlanta 1.26M" failed), and a product's base is the figure right
// before its " x" (until then the clause's leftmost "<num>M", so a correct
// "June's 9.69M trend, extrapolated to 9.85M (±10%), x ... 1.058 = 10.42M"
// failed). What a frame cannot read goes unchecked, and the pass line counts
// it: a list with a figure that is no labelled term, a month-end Waymo figure
// that may be the hub's where no anchor gives that, a cross-line figure with
// no row on the line it is read against, and the rest the pass line names.
// What remains: a frame takes a stated input as exact (products, sums,
// rates and per-day scalings "multiply out" as written), so a correct
// result computed from an unrounded input that rounds otherwise fails
// (today's closest: October's Travis 1.95M x 31/30 = 2.015M against 2.02M
// and its metros' base 2.85M x 31/30 = 2.945M against 2.95M, each 5,000
// miles of the 5,001 allowed off, then its 10.4M x 31/30 = 10.75M, 3,333 of
// 5,001; a half-down rounding, 2.01M, passes too); October's per-day
// scaling reads a term with no figure in its parenthesis as unadjusted, so an
// adjustment stated elsewhere fails it; the Waymo milestone day and the
// floor the series clears read the
// lifetime with OFFSET's central; and a named month in Waymo's or Zoox's
// rows is read in the row's line only, as a "measured Q<n>" is the latest
// quarter n ending at or before the row's month. Relaxing any of them
// further is the human's call (rule 5).

// Each row's rationale as data/vmt.csv holds it, its links written in
// markdown (markdown), which (1) reads, and as the page shows it, each link as
// its text (rationale), which (2)-(4) read.
const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const rows = raw.slice(1).map(p => ({
  helmer: p[0], month: p[1], vmt: +p[2], cume: +p[3], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7],
  markdown: p[8], rationale: rationaleText(p[8]),
}));
const rowOf = (helmer, month) => rows.find(r => r.helmer === helmer && r.month === month);
// The months before `knot` whose cumulative band a later constraint narrowed:
// narrower than the month before's band plus the month's own band, the chain
// forward (a series' first month chains from zero, the band before it).
const narrowedBefore = (helmer, knot) => {
  const own = rows.filter(r => r.helmer === helmer && r.month < knot);
  const before = [{kmin: 0, kmax: 0}, ...own];
  return own.filter((r, i) => r.kmin > before[i].kmin + r.vmin || r.kmax < before[i].kmax + r.vmax)
    .map(r => r.month);
};
const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
// Half a unit of the last stated decimal, in miles ("174.26M" -> 5,000), plus
// one mile of float slack.
const decimals = num => num.replace(/^[^.]*\.?/, "").length; // "174.26" -> 2, "524" -> 0
const halfUnit = num => 0.5 * 10 ** (6 - decimals(num)) + 1;
const fmt = n => n.toLocaleString("en-US");
// data/waymo_vmt.py's OFFSET (central, low, high), the rider-only miles Waymo
// drove before the series starts, which (3a) and (3b) read; and a stated
// figure as miles with its slack: whole miles exactly ("205,000"), thousands
// and millions to their stated precision ("658k", "0.205M").
const offsetLine = fs.readFileSync("data/waymo_vmt.py", "utf8").match(/^OFFSET = \((\d+), (\d+), (\d+)\)/m);
assert.ok(offsetLine, "Replicata: read OFFSET in data/waymo_vmt.py. Expectata: a (central, low, high) literal. Resultata: not found.");
const OFFSET = { central: Number(offsetLine[1]), low: Number(offsetLine[2]), high: Number(offsetLine[3]) };
const wholeMiles = s => ({ stated: s, miles: Number(s.replace(/,/g, "")), slack: 0 });
const thousands = s => ({ stated: `${s}k`, miles: Number(s) * 1e3, slack: 0.5 * 10 ** (3 - decimals(s)) + 1 });
const millions = s => ({ stated: `${s}M`, miles: Number(s) * 1e6, slack: halfUnit(s) });

// (1) every link names a section of data/README.md: its text non-empty, its
// target data/#<anchor>, the anchor one of the ids GitHub Pages gives the
// file's headings (header), each of them non-empty; and no link syntax ("](",
// a target "data/#" but inside a longer path or address) outside a link.
const README_IDS = headingAnchors(fs.readFileSync("data/README.md", "utf8"), "data/README.md");
const emptyIds = README_IDS.filter(h => h.anchor === "");
assert.ok(README_IDS.length > 0 && emptyIds.length === 0,
  `Replicata: compute the ids GitHub Pages gives data/README.md's headings (quals/rationale-links.mjs, headingAnchors).
Expectata: at least one heading, each with a non-empty id.
Resultata: ${README_IDS.length} headings; with an empty id: ${JSON.stringify(emptyIds)}.`);
const ANCHORS = README_IDS.map(h => h.anchor);
// The reader on synthetic files (self-contained: they read no file), each
// case's ids the ones GitHub Pages' own stack gives (kramdown 2.4.0 with
// kramdown-parser-gfm 1.1.0, the versions github-pages 233 pins, run on these
// files 2026-11-05; a front matter case on the file Jekyll leaves, the front
// matter dropped). The cases read, as kramdown reads them, a heading's text:
// code marks dropped with their text kept, an escape's character kept, a code
// span of two or more backticks less a space at each end, a code span closed
// by its run's next occurrence (which can start a longer run), an autolink's
// address, an inline link's text; punctuation dropped, letters lowercased (an
// accented one kept), an underscore and decimal digits kept and other numbers
// dropped, each space or tab a hyphen, a repeated id numbered, a closing run
// of #s dropped, a typographic "--" or "---" a dash, which the id drops, one
// hyphen of "----" kept; square brackets, braces, a lone or unclosed
// backtick, a backslash before a character it does not escape, and an
// underscore with none after it that can close emphasis, as text. And the
// blocks around it:
// fenced code blocks closed as kramdown closes them, and a fence kramdown
// does not read as one a paragraph's line; an indented code block, and the
// lines it takes after it, no headings; setext headings; a heading in a list
// item, a quote or a definition, at its content column or lazily, and a # line
// in code in one no heading; a comment, a block-level element (its markdown
// content too) or a math block, and the # lines inside it, as kramdown reads
// them; a line starting with a span-level element, an autolink line and a
// thematic break; a table and the pipe lines it takes; a footnote's content,
// whose headings get no id; front matter dropped, a YAML comment in it too;
// "\r\n" line ends. Each form the reader stops on stops it, for the reason
// given (its message names it): each can make the text GitHub Pages renders
// for a heading, and so its id, differ from what this reader reads, or make,
// hide or rename a heading (here the stack gives "Foo {#bar}" bar, "`x`{: .y}
// z" x-z, "R&amp;D" rd, "Angle a << b >> c" angle-a-b-c, "[a](b c) d" a-d,
// "[the hub][hub]" with [hub] defined the-hub, "_Emphasis_ here"
// emphasis-here, "## Heading" after "{: #x}" x; Liquid is Jekyll's, which the
// stack does not run). Until 2026-11-05 the reader stopped on many of the
// forms read here, or read them wrong (the third review of that day).
const ruleProblems = [];
for (const [markdown, want] of [
  ["## What `data/slurp.py` reads", ["what-dataslurppy-reads"]],
  ["### Tesla's no-monitor line", ["teslas-no-monitor-line"]],
  ["# A\n## A\n### A", ["a", "a-1", "a-2"]],
  ["## Snake_case 2026, and ?!", ["snake_case-2026-and-"]],
  ["## Closed ##", ["closed"]],
  ["## Closed2##", ["closed2"]],
  ["```\n# a comment\n```\n## After", ["after"]],
  ["<!-- a comment -->\n## After", ["after"]],
  ["## A -- B", ["a--b"]],
  ["## Flag `--x` -- y", ["flag---x--y"]],
  ["## a---b----c", ["ab-c"]],
  ["## Fifty--fifty", ["fiftyfifty"]],
  ["## See [the hub](https://example.com) notes", ["see-the-hub-notes"]],
  ["## Link [a -- b](u) text", ["link-a--b-text"]],
  ["## Dash-[](u)-dash", ["dash--dash"]],
  ["## Ellipsis...", ["ellipsis"]],
  ["## MONTHLY_ARRIVAL_LAG and x-_y", ["monthly_arrival_lag-and-x-_y"]],
  ["## a _ b", ["a-_-b"]],
  ["## Count ² ½ 3", ["count---3"]],
  ["## Café Ñ", ["café-ñ"]],
  ["## Tab\there", ["tab-here"]],
  ["## Strike ~~gone~~ x", ["strike-gone-x"]],
  ["## *Bold* and **strong**", ["bold-and-strong"]],
  ["## Quotes \"x\" and 'y'", ["quotes-x-and-y"]],
  ["## Code `a  b`", ["code-a--b"]],
  ["## 1. numbered heading", ["1-numbered-heading"]],
  ["## Résumé — naïve façade", ["résumé--naïve-façade"]],
  // square brackets, braces, escapes, backticks and underscores as text
  ["## Regeneration [offline]", ["regeneration-offline"]],
  ["### [AI TEXT] Zoox anchors", ["ai-text-zoox-anchors"]],
  ["## Coverage [0.20, 0.52]", ["coverage-020-052"]],
  ["## A [ref] link", ["a-ref-link"]],
  ["## A footnote[^1]", ["a-footnote1"]],
  ["## See [the hub][hub] notes", ["see-the-hubhub-notes"]],
  ["## See [the hub][] notes\n\n[the hub]: https://example.com", ["see-the-hub-notes"]],
  ["## \\[a](b) c", ["ab-c"]],
  ["## a](b) e", ["ab-e"]],
  ["## [a](b 't') d", ["a-d"]],
  ["## [a]( b ) d", ["a-d"]],
  ["### The {lo, hi} bands", ["the-lo-hi-bands"]],
  ["## Foo {#bar} ##", ["foo-bar"]],
  ["## A \\* escaped", ["a--escaped"]],
  ["## a\\--b", ["a--b"]],
  ["## Two ``ticks`` here", ["two-ticks-here"]],
  ["## `` a `` b", ["a-b"]],
  ["## A ` lone tick", ["a--lone-tick"]],
  ["## a ` b ` c", ["a--b--c"]],
  ["## <https://a--b.com/x_y_> c", ["httpsa--bcomx_y_-c"]],
  ["## <mailto:a@b.co> c", ["abco-c"]],
  ["## 2026_q3 rows", ["2026_q3-rows"]],
  ["### The 5_day track", ["the-5_day-track"]],
  // headings' own forms
  ["## ", []],
  ["1) ## c", []],
  ["  ## Indented", []],
  ["Para\n  ## continued", []],
  ["## A\r\n## B\r\n", ["a", "b"]],
  ["---\ntitle: Data sources\n---\n\n# Data Sources", ["data-sources"]],
  ["---\ntitle: Data sources\n# a YAML comment\n---\n\n# Data Sources", ["data-sources"]],
  // blocks around headings
  ["## Before\n\n~~~~\n~~~\n# Inside\n~~~~\n\n## After", ["before", "after"]],
  ["````\n```\n# Inside\n```\n````\n\n## After", ["after"]],
  ["````\n# x\n```\n## After", ["after"]],
  ["To regenerate:\n\n    # offline, from the newest snapshots\n    python3 data/slurp.py\n\n## After", ["after"]],
  ["Para\n\n    code\n\n# x", ["x"]],
  ["- a\n\nb\n\n  ## c", []],
  ["## A\n\n<!--\nA paragraph set aside for now.\n-->\n\n## B", ["a", "b"]],
  ["## A\n\n<details>\n<summary>Old notes</summary>\n\nA note.\n\n</details>\n\n## B", ["a", "b"]],
  ["Para\n<details>\n\ntext\n\n</details>\n## After", ["after"]],
  ["## A\n\n<https://teslapologetics.dreev.es/data/>\n\n## B", ["a", "b"]],
  ["<sup>1</sup> A note.\n## B", ["b"]],
  ["<br>\n# x", ["x"]],
  ["<hr>\n# x", ["x"]],
  ["<span>\n# x\n</span>", ["x"]],
  ["## A\n---\n\nText.\n\n## B", ["a", "b"]],
  ["```\nx\n```\n---\n## B", ["b"]],
  ["| a | b |\n|---|---|\n| 1 | 2 |\n---\n## B", ["b"]],
  ["## A\nText\n---", ["a"]],
  ["Line one\nTitle\n---", []],
  ["Title\n  ---", []],
  // forms the reader stopped on until 2026-11-05
  ["Title\n=====", ["title"]],
  ["Title\n---", ["title"]],
  ["- two\n---", ["two"]],
  ["- a\n\n  T\n  ---", ["t"]],
  ["> ## Quoted", ["quoted"]],
  ["- ## A list item heading", ["a-list-item-heading"]],
  ["1. ## In an ordered item", ["in-an-ordered-item"]],
  ["- a\n  ## c", ["c"]],
  ["<div>\n\n# x\n\n</div>", []],
  ["<div>\n<!-- </div> -->\n# x\n</div>\n\n## After", ["after"]],
  ["<!--\n# hidden\n-->\n## After", ["after"]],
  ["Para\n<!--\n# x\n-->", ["x"]],
  ["$$\n# x\n$$", []],
  ["Para\n\n    code\n# x", []],
  ["```\n# an open fence", ["an-open-fence"]],
  ["```js title\n# x\n```", ["x"]],
  ["## Before\n\n```\n# x\n```js\n\n## After", ["before", "x", "after"]],
  // the third review of 2026-11-05: correct edits in list items and quotes,
  // and forms read wrong until then
  ["10. Stop on any unrated incident:\n    ```bash\n    # list the unrated reports\n    python3 data/slurp.py\n    ```\n\n## After", ["after"]],
  ["- The master:\n  - to check it:\n    ```bash\n    # the master's own quals\n    node quals/vmt-ledger.qual.mjs\n    ```\n\n## After", ["after"]],
  ["- the snapshots are archival\n\n    # regenerate from the newest snapshots\n    python3 data/slurp.py\n\n## After", ["after"]],
  ["> ```bash\n> # offline\n> python3 data/slurp.py\n> ```\n\n## After", ["after"]],
  ["1. Fetch.\n\n    Then run slurp.\n## After", ["after"]],
  ["10. Run:\n\n    ```bash\n    python3 data/slurp.py\n    ```\n11. Count the\n    # of rows\n\n## After", ["of-rows", "after"]],
  ["- a\n  <!--\n  # x\n  -->\n\n## After", ["x", "after"]],
  ["    python3 data/slurp.py\n<details>\n\n## Folded\n\n</details>\n\n## After", ["after"]],
  ["| a | b |\n|---|---|\n| 1 | 2 |\n## Knots | bands", []],
  ["[x]: https://example.com\n===", ["x-httpsexamplecom"]],
  ["   $$\n> # A -- B\n   $$\n   ## Bands 1.5x\u20132x", ["a--b"]],
  ["| a | b |\n|---|---|\n      - nested item\n## Ghost months\n $$\n> # Ghost months\n      $$", ["ghost-months", "ghost-months-1"]],
  ["## A\n\n<!--\n## Regeneration\n\nText.\n-->\n\n## B", ["a", "b"]],
  ["## A\n\n<details>\n<summary>Old</summary>\n\n## Regeneration\n\nText.\n\n</details>\n\n## B", ["a", "b"]],
  ["## ``a``` --b`", ["a---b"]],
  ["## ` --x `y`", ["-x-y"]],
  // more blocks
  ["    code\n## After", []],
  ["- item\n## After", ["after"]],
  ["> quote\n## After", ["after"]],
  ["| a | b |\n|---|---|\n## After", ["after"]],
  ["| a | b |\n|---|---|\n## H | x\nText", ["h--x"]],
  ["| a | b |\n|---|---|\n## H | x\n\nText", []],
  ["| `x|y` | b |\n|---|---|\n| 1 | 2 |\n\n## After", ["after"]],
  ["<div>\n<p>\n</div>\n\n## After", []],
  ["<div markdown=\"1\">\n\n## Inside\n\n</div>\n\n## After", ["after"]],
  ["## A\n\nText[^1].\n\n[^1]: Note.\n\n    ## In a footnote\n\n## After", ["a", "after"]],
  ["Term\n: A definition\n\n  ## In a definition", ["in-a-definition"]],
  ["Para\n$$\n# x\n$$", ["x"]],
  ["- a\n\n- b\n\n      ## code\n\n## After", ["after"]],
]) {
  // A stop is a problem of its case, so every case's outcome is reported.
  let got;
  try { got = JSON.stringify(headingAnchors(markdown, "a synthetic file").map(h => h.anchor)); }
  catch (e) { got = `a stop, ${JSON.stringify(e.message.split("Resultata: ")[1])}`; }
  if (got !== JSON.stringify(want)) ruleProblems.push(`${JSON.stringify(markdown)} gives ${got}, want ${JSON.stringify(want)}`);
}
for (const [markdown, why] of [
  ["## Before\n{: #custom}", "a kramdown extension, attribute list or attribute definition"],
  ["## Foo {#bar}", "an explicit id"],
  ["## `x`{: .y} z", "a kramdown attribute list or extension ({:)"],
  ["## Liquid {{ site.x }}", "Liquid"],
  ["## A\n\n{% if x %}\n## B\n{% endif %}", "Liquid"],
  ["## R&amp;D", "an entity"],
  ["## A <b>bold</b> idea", "inline HTML"],
  ["## Angle a << b >> c", "a typographic << or >>"],
  ["## Math $$x--y$$", "math ($$)"],
  ["## An ![alt](x.png) image", "an image"],
  ["## [a](b c) d", "a link of a form this reader does not read"],
  ["## See [the hub][hub] notes\n\n[hub]: https://example.com", "a reference link to a label the file defines"],
  ["## A footnote[^1]\n\nText.\n\n[^1]: A note.", "a footnote the file defines"],
  ["## _Emphasis_ here", "an underscore that can open emphasis"],
  ["{: #x}\n## Heading", "a kramdown extension, attribute list or attribute definition"],
  ["{:ref: .x}\n## Heading", "a kramdown extension, attribute list or attribute definition"],
  ["{::comment}\n## Hidden\n{:/comment}\n\n## After", "a kramdown extension, attribute list or attribute definition"],
  ["| <b>a</b> | b |\n|---|---|\n| 1 | 2 |", "a table holding an inline HTML element with content"],
]) {
  let message = null;
  try { headingAnchors(markdown, "a synthetic file"); } catch (e) { message = e.message; }
  const stopped = message !== null && message.startsWith("Replicata: read the headings of a synthetic file") && message.includes(why);
  if (!stopped) ruleProblems.push(`${JSON.stringify(markdown)} ${message === null ? "is read without a stop" : `stops with ${JSON.stringify(message.slice(0, 300))}`}, want headingAnchors' stop naming ${JSON.stringify(why)}`);
}
// The link form the page draws (crashla.js RATIONALE_LINK), whole.
const PAGE_LINK = new RegExp(`^${DATA_LINK.source}$`, "u");
// What is wrong with a link, given the ids of the headings, or null.
const linkProblem = (link, anchors) => {
  const anchor = /^data\/#(.*)$/.exec(link.target)?.[1];
  return link.text.trim() === "" ? "has no text but blanks"
    : anchor === undefined ? "targets no section of data/README.md (a target is data/#<anchor>)"
    : !anchors.includes(anchor) ? `names no heading of data/README.md (no heading's id is ${JSON.stringify(anchor)})`
    : !PAGE_LINK.test(link.source) ? "names a heading whose id the page does not read: crashla.js reads a link's anchor as lowercase letters, digits and hyphens, so the page would stop at load"
    : null;
};
// The same test on synthetic links, against synthetic ids (one holding an
// underscore, as a heading's code span can give), each wrong form named.
const linkRuleProblems = [];
for (const [source, want] of [
  ["[data/README.md, Zoox anchors](data/#zoox-anchors)", null],
  ["[](data/#zoox-anchors)", "has no text but blanks"],
  ["[ ](data/#zoox-anchors)", "has no text but blanks"],
  ["[the hub](https://waymo.com/safety/impact/)", "targets no section"],
  ["[data/README.md, Nowhere](data/#nowhere)", "names no heading"],
  ["[the lag table](data/#the-monthly_arrival_lag-table)", "names a heading whose id the page does not read"],
]) {
  const got = linkProblem(rationaleLinks(source)[0], ["zoox-anchors", "the-monthly_arrival_lag-table"]);
  if (!(want === null ? got === null : got !== null && got.startsWith(want)))
    linkRuleProblems.push(`${source} gives ${JSON.stringify(got)}, want ${want === null ? "none" : JSON.stringify(want)}`);
}
const badLinks = [];
let links = 0;
for (const r of rows) {
  for (const link of rationaleLinks(r.markdown)) {
    links++;
    const why = linkProblem(link, ANCHORS);
    if (why !== null) badLinks.push(`${r.helmer} ${r.month}: ${link.source} ${why}`);
  }
  // Each link a blank, as crashla.js's vmtRationale reads it, so a target
  // right after a link is one outside a link.
  const outside = r.markdown.replace(LINK, " ");
  for (const m of outside.matchAll(new RegExp(`\\]\\(|${OPEN_TARGET.source}`, "g"))) {
    badLinks.push(`${r.helmer} ${r.month}: ${JSON.stringify(m[0])} outside a link, in ${JSON.stringify(outside.slice(Math.max(0, m.index - 40), m.index + 40))} (a link is [<text>](data/#<anchor>))`);
  }
}

// (2) no internal column names or undefined shorthand
const BANNED = [/\bkyoom/i, /\bvmt_(min|max)\b/, /TotalVMTZEV/, /\bhub ?\+ ?E\b/, /\+ E \d/, /\bE (lo|hi|best)\b/, /\bD\/H\b/];
const jargon = [];
for (const r of rows) for (const re of BANNED) {
  const m = r.rationale.match(re);
  if (m) jargon.push(`${r.helmer} ${r.month}: ${JSON.stringify(m[0])}`);
}

// (3a) Figures as the rationales state them pass the test their form names
// against the rows (most are the rows' values, each to its stated precision;
// a floor is one the rows meet). Each form is located by the frame
// its figures sit in, and its figures are checked wherever that frame
// appears; where its words cannot tell whose figure it is, it accepts a
// figure right under any meaning they could have (header). No form is
// required: a statement reworded out of its frame goes unchecked rather than
// failing, since no qual may enforce the wording of text the human might
// edit (the human's rule of 2026-11-03), and the pass line counts each
// form's checked statements, so a form gone idle shows.
// Earlier on 2026-11-03 six of the first seven forms each had to be found at
// least once, which turned the qual red on a rewording alone with every
// figure right ("thru" made "through" and "lands on the anchor: the hub's"
// made "lands on the anchor, the hub's" gave three problems). Before that
// this read one form, a Waymo "<x>M end-<Mon>-<YYYY>", which no Waymo
// rationale had used since 2026-10-31, so it checked nothing; that form now
// reads every line's rationales (Tesla's deck rows give "658k end-2025,
// 1.717M end-Mar-2026").
//   end of a month or year (every line): "<x>k" or "<x>M" then
//     "end-<Mon>-<YYYY>" or "end-<YYYY>" is, for that month (for a year,
//     December), the series cumulative or the lifetime (the cumulative plus
//     the pre-series miles, PRE_SERIES) of a line the row may mean
//     (LINES_MEANT), or for Waymo the hub's figure an anchor gives; a Waymo
//     figure that is none of those, in a month whose hub figure no anchor
//     gives, may be the hub's if it is at most the lifetime, so it goes
//     unchecked (since 2026-11-05; until then the row's line's series
//     cumulative only);
//   Waymo's anchor: in a Waymo row, "The <Mon>-<YYYY> cumulative lands on the
//     anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles" is
//     that month's cumulative, h + e - o (the April-June 2026 rows);
//   its band: in a Waymo row, "its cumulative band is the hub total plus <a>M
//     to <b>M ..., less the pre-series miles' range, <l>M-<u>M", after an
//     anchor in the same rationale, is that month's cumulative band, h + a - u
//     to h + b - l (June's row); with no anchor before it in its rationale its
//     hub total is unstated, so it goes unchecked (the pass line counts it
//     so);
//   the hub's figure: in a Waymo row, "update: <h>M rider-only miles thru
//     <Mon>-<YYYY>", its clause ending after the month, is the hub figure
//     every anchor for that month uses (the April-June 2026 rows; since
//     2026-11-05 read only after "update: ", which makes it the hub update's
//     total); with no anchor for that month in any rationale it goes
//     unchecked (the pass line counts it so);
//   calendar years: in a Waymo row, each "<n> in <YYYY>" inside "by calendar
//     year (...)" is that year's miles, its months summed, for each year whose
//     January the series holds (2021's total includes January-June 2021,
//     before the series starts, which only the pre-series offset holds; the
//     builder's July 2021-January 2023 rows);
//   a milestone day: in a Waymo row, "first million rider-only miles on <Mon>
//     <D>, <YYYY>": the lifetime (the cumulative plus OFFSET's central, the
//     month's miles spread evenly over its days) is below 1,000,000 at the
//     end of the day before and at least 1,000,000 less one mile at the end
//     of that day (the same rows);
//   a floor the series clears: in a Waymo row, "floor the series clears,
//     ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon>
//     <D>, <YYYY>)", with no stop, semicolon or quote in the "...": the
//     lifetime at the end of that day, reckoned as for the milestone day, is
//     at least N million less one mile (a floor, so no rounding slack), the
//     day's month being any month data/vmt.csv has a row for, a ghost month
//     included (the July-September 2026 rows, for Alphabet's Oct 28, 2026
//     remarks; October's ghost row gives the same floor with its date before
//     the quote and no year, which this does not read). The frame starts at
//     "floor the series clears" because a rationale may also quote a floor
//     the series does not clear, to say so;
//   a Waymo row's total and daily rate: "Total <x>M, about <y>k a day (...)",
//     the parenthesis right after it holding no other and holding
//     "<Monthname>'s row <digit>", is its miles and its miles over its days
//     (October 2026's ghost row: "Total 22.25M, about 718k a day (September's
//     row 714k; measured Q2 608k)"). The total is read only beside the row's
//     daily rate, since "Total" can begin any total, the hub's or a
//     component's (until a further review later on 2026-11-03 any "Total
//     <x>M" in a Waymo row was read as its miles, which fails a correct
//     "Total 271.329M rider-only miles thru Jun-2026"), and since 2026-11-04
//     only with that parenthesis, whose comparison with another row's rate
//     makes it the row's (until then a component's "Total 1.40M, about 47k a
//     day" failed as the row's); and the frame starts at the total so that no
//     component's daily rate, and no month's miles in thousands (as Waymo's
//     early months are), is read as a row's. In that parenthesis each
//     "<Monthname>'s row <z>k" is the miles over the days of that month as a
//     named month is read (below; since 2026-11-05; until then the latest
//     month of that name at or before the row's), and each "measured Q<n>
//     <w>k" the miles over the days of the latest quarter n ending at or
//     before the row's month. The parenthesis sets the row's rate beside
//     rates already measured, so a January row's "measured Q3" is the year
//     before's (until a review later on 2026-11-03 the quarter was read in
//     the row's own year, which fails that correct figure);
//   a month and its week: "Cross-check: <x>M/mo ≈ <y>M/wk" in a Waymo row has
//     x and y agree for the row's month, x times 7 over its days being y, to
//     their precisions, whoever's they are, and with " vs Waymo's" after it,
//     setting them beside a fleet figure of Waymo's, they are its miles and
//     its miles times 7 over its days (September 2026's row, against Waymo's
//     weekly floor; the rationales give components' monthly rates as
//     "<x>M/mo" too, so the frame starts at "Cross-check:"; until 2026-11-05
//     every such pair was read as the row's);
//   band multipliers: a Waymo row's "Band x<lo> to x<hi>", followed later in
//     its sentence (which a stop not between digits ends and a semicolon
//     does not) by "the components' ranges combined", is its band over its
//     miles (October 2026's ghost row; until 2026-11-04 any such band was
//     read, so a component's failed as the row's);
//   a Waymo row's terms (since 2026-11-04, as all the forms below): the
//     terms its list holds sum to its miles, to the sum of the terms' stated
//     precisions (each within half a unit of its last digit). The list is
//     the sentence a clause "CA = ..." or "CA <digit>..." opens, naming
//     Maricopa, Travis, Atlanta and metros in that order ("CA ... = <c>M;
//     Maricopa <m>M (...), Travis <t>M, Atlanta <a>M (...); + uncounted
//     metros <u>M ..."; in April-June ", Travis" is " and Travis" and
//     "Atlanta" follows "; "); CA's term is the last "= <c>M" of its clause,
//     and since 2026-11-05 every other figure of the list at depth 0 must be
//     a labelled term, all of which are summed (until then the five or six
//     terms it named, so a term it did not name was left out of the sum): a
//     list with any other figure there goes unchecked (the comment at its
//     code says what a term is; the April-October 2026 rows);
//   a CPUC product: in a Waymo row, "CPUC Q<n>-<YYYY> driverless actual <d>
//     deployment + <p> pilot (...) x <f>, ... = <r>M" has (d + p) x f equal
//     to r, to r's precision, the stated figures taken as exact; and d and p
//     are one month's deployment and pilot miles of that quarter in
//     data/waymo-ca.csv, each to half a mile either way (since 2026-11-05
//     any month of the quarter; until then the row's month, in the row's
//     quarter only); a base that is no month's the file holds, in a quarter
//     whose three months it does not all hold, goes unchecked, and the pass
//     line counts it so (the April-June 2026 rows);
//   a product: in any row, "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[
//     [<range>]] = <r>M", f a decimal or a ratio a/b and b the figure right
//     before " x" (no figure between them at depth 0; since 2026-11-05), has
//     b x f equal to r, to r's precision, the stated figures taken as exact;
//     the result can be the next product's base (the July-October 2026 Waymo
//     rows' CA terms; October's "10.4M CPUC-basis x 31/30 = 10.75M x the
//     hub-vs-CPUC CA ratio 1.0576 = 11.37M" is two);
//   a month by its name, in any row, whole miles exactly, read as the month
//     of that name within 11 months either way of the row's (its own month,
//     or else the last one before it and the next one after it), in the
//     row's line or, for a Tesla line, either Tesla line (namedRows, since
//     2026-11-05; until then that month of the row's year in the row's
//     line), the figure holding for any of them: "<Month> keeps <source>'s
//     end-of-month <c>[ (...)], its band <lo>-<hi>" is its cumulative and
//     cumulative band; each of the three readings of "end-<Month> <a> / <b>
//     / <c>" lies inside that month's cumulative band where a later "<Month>
//     keeps ..., its band <lo>-<hi> holding the three readings" says the
//     band holds them; "<Month>'s cumulative is that reading, <c>" or "... is
//     the chart's ~<c>" is its cumulative (the "~" marks the chart's reading
//     approximate, not the cumulative, which is that figure); "<Month>'s
//     cumulative is that reading, <c>, its band from the call's <f> to <p>%
//     above it" has its band's floor f and its top p% above c, to the whole
//     percent; "<Month>'s cumulative is the chart's ~<c>, its floor <f>" its
//     band's floor f (Tesla's June-August 2025 rows); "<Month>'s miles are at
//     least <n>" has its miles at least n, and "..., puts them there (<v>
//     with" its miles v (Zoox's December 2025 row); "<Month>'s cumulative
//     band, <lo> to <hi>" is its cumulative band (Zoox's June-November 2025
//     rows); "End-<Month> cumulative floor <f>" is its band's floor (Zoox's
//     April-September 2026 rows);
//   a row's own figures, in any row: "Each month is its cumulative less the
//     month before's, its band the difference of their bands" has its miles
//     its cumulative less the row before's, its band's floor its cumulative
//     floor less the row before's cumulative top and its band's top its
//     cumulative top less the row before's cumulative floor, whole miles
//     exactly, the row before being its line's previous row in the file
//     (consecutive months, vmt-ledger.qual), from zero for a line's first
//     (Tesla's June-August 2025 rows); "a month's band is <a>x-<b>x its
//     miles, within the difference of its cumulative band and the month
//     before's" has its band a and b times its miles, each edge held inside
//     the difference of the two cumulative bands (its cumulative floor less
//     the row before's cumulative top to its cumulative top less the row
//     before's cumulative floor), to half a mile either way (Tesla's
//     September 2025-March 2026 rows); "the cumulative is ...: <x>M less the
//     <o> pre-series miles, <c>" has its cumulative c, and x less o equal to
//     c to x's precision, and "Its band, <lo> to <hi>, is that statement's
//     range" its cumulative band (Zoox's December 2025 row); "Cumulative
//     band <lo> to <hi>:" opening a sentence is its cumulative band (Zoox's
//     March 2026 row); "Central <c>." opening a sentence is its miles, or for
//     a Tesla line the other Tesla line's that month (the no-monitor line's
//     October 2026 row); and "The cumulative band's floor through <Mon>
//     <D>, <f>, is the end-<Month> floor (<j>: ...) plus the <Month> and
//     <Month> floors" has D the last day of <Mon>'s month, f that month's
//     cumulative floor, j the end-<Month> one, and j plus those two months'
//     own floors f, the four months read as a named month is read, in one
//     line (Tesla's August 2026 row);
//   and the forms added on 2026-11-05, each described where it is read
//     below: Tesla's no-monitor page readings and the floors, centrals and
//     tops after them, one Tesla line's miles less the other's and their
//     share, the no-monitor line's projected month, lifetimes on a day and
//     approximate lifetimes, a floor only one deck's reading meets, a crash
//     count at a rate, a band's and a floor's approximate shares, a month at
//     its daily rates, a quarter's split and run-rate, and a month at
//     another's per-day rates.
const figureErrors = [];
const figureForms = Object.fromEntries(["end of a month or year", "Waymo anchor", "Waymo anchor band", "hub figure",
  "calendar year", "milestone day", "floor the series clears", "Waymo total and daily rate",
  "a month's daily rate", "a quarter's daily rate", "a month and its week", "band multipliers",
  "Waymo terms", "CPUC product", "CPUC base", "product", "a month's cumulative and band", "a band holding readings",
  "a month's cumulative", "a cumulative's floor and top", "a cumulative's floor", "a month as a difference",
  "a band within a difference", "a cumulative less pre-series miles", "a band from a statement's range",
  "a month's miles at least", "a month's miles as put", "a month's cumulative band", "a row's cumulative band",
  "an end-of-month floor", "a floor through a month's end",
  "a page reading", "a month's floor, central or top", "a central from a reading and a remainder",
  "a top from a reading", "a monitor-aboard remainder", "a monitor-aboard share", "a projected month's band",
  "a row's central", "a lifetime milestone", "an approximate lifetime", "a floor one reading meets",
  "a crash count at a rate", "a band's approximate shares", "a floor an approximate share below",
  "a quarter's split", "a quarter's run-rate", "a month at another's per-day rates",
  "a month at its daily rates"].map(f => [f, []]));
// statements found in their frames but with nothing to read them against,
// which the pass line counts: a Waymo month-end figure that is none of the
// known readings and at most the lifetime, in a month whose hub figure no
// anchor gives (end of a month or year); no anchor sentence for its month
// (Waymo anchor band, hub figure); a base that is none of the months of its
// quarter data/waymo-ca.csv holds, the file lacking one of them (CPUC base);
// a list holding a figure that is no labelled term (Waymo terms); no row for
// the month on the line a cross-line figure is read against (a page reading,
// a monitor-aboard remainder, a monitor-aboard share, a projected month's
// band); no pre-series miles stated in the row's rationale (a lifetime
// milestone); no list of decks, or no readings of the month (a floor one
// reading meets, a floor an approximate share below); no deck reading beside
// the page's (a top from a reading); a split pairing its terms with another
// number of totals, naming a quarter the row's month is not in, or in a
// quarter not every month of which states it (a quarter's split); neither the
// quarter's three listed terms nor a split's increment (a quarter's
// run-rate); and the row's own list unread, a term with no term of its label
// in the month named, or a parenthesis this does not read (a month at
// another's per-day rates)
const unchecked = Object.fromEntries(["end of a month or year", "Waymo anchor band", "hub figure", "CPUC base", "Waymo terms",
  "a page reading", "a monitor-aboard remainder", "a monitor-aboard share", "a projected month's band",
  "a lifetime milestone", "a floor one reading meets", "a floor an approximate share below", "a top from a reading",
  "a quarter's split", "a quarter's run-rate", "a month at another's per-day rates"].map(f => [f, []]));
const UNIT = { k: thousands, M: millions };
const within = (stated, actual, slack) => Math.abs(stated - actual) <= slack;
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const waymo = rows.filter(x => x.helmer === "waymo");
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
const MON_NAMES = Object.keys(MON); // "Jan" to "Dec", in order
// A Waymo lifetime at the end of day d of a row's month: the cumulative
// through the month before, plus the month's miles spread evenly over its
// days, plus OFFSET's central, the miles before the series starts.
const lifetimeAt = (row, d) => row.cume - row.vmt + row.vmt * d / daysIn(row.month) + OFFSET.central;
const milesOf = x => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
// Frame tokens (since 2026-11-04): a parenthesis, nested up to three deep, or
// a bracket, stepped over whole, so a figure inside one is never read as the
// frame's and a frame stops at a parenthesis it cannot close; a whole number
// of miles as written, with thousands commas, never part of a longer number;
// and a month's name, in full or (MON_NAME) in three letters. (Until
// 2026-11-05 a token CLAUSE, a clause's text at depth 0, served the terms'
// frame, which since reads its list at depth 0 through maskGroups.)
const PAREN = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
const BRACKET = String.raw`\[[^\[\]]*\]`;
const WHOLE = String.raw`(?<![\d,.])(\d{1,3}(?:,\d{3})*)(?![,.]?\d)`;
const MONTH_NAME = `(${MONTH_NAMES.join("|")})`;
const MON_NAME = `(${MON_NAMES.join("|")})`;
// A whole number that may be a rounded figure, to half a unit of its last
// nonzero digit ("33,000" -> 500, "303,535" -> 0.5); and an approximate
// percentage, marked so by its "~" ("~15%"), to one unit of its last digit
const roundedWhole = s => {
  const d = s.replace(/,/g, "");
  return { stated: s, miles: Number(d), slack: 0.5 * 10 ** (d.length - d.replace(/0+$/, "").length) };
};
const nearPercent = (actual, p) => Math.abs(actual - Number(p)) <= 10 ** -decimals(p) + 1e-9;
// A month a rationale names without its year (since 2026-11-05; until then
// that month of the row's year): the month of that name within 11 months of
// the row's, either way, so the row's own month, or else the last one before
// it and the next one after it, a figure being read as either one's. A June
// row's "July" is then that year's (or the year before's) and a January row's
// "December" the year before's (or that year's), and a rationale reused in a
// later year's row still reads the months it was written for.
const monthIndex = m => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthOf = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
const namedMonths = (from, n) => [-1, 0, 1].map(dy => (Number(from.slice(0, 4)) + dy) * 12 + n)
  .filter(i => Math.abs(i - monthIndex(from)) <= 11).map(monthOf);
// The lines a row's rationale may mean where a frame names none (since
// 2026-11-05): its own, and for the two Tesla lines either one, since each
// one's rationales state the other's figures (until then the row's own line).
const LINES_MEANT = { tesla: ["tesla", "teslanomonitor"], teslanomonitor: ["teslanomonitor", "tesla"], waymo: ["waymo"], zoox: ["zoox"] };
const unmeant = [...new Set(rows.map(r => r.helmer))].filter(h => LINES_MEANT[h] === undefined);
assert.deepEqual(unmeant, [],
  `Replicata: read data/vmt.csv's lines. Expectata: each one in LINES_MEANT, the lines its rationales may mean. Resultata: not there: ${JSON.stringify(unmeant)}.`);
// The rows a month's name (n, 0 for January) may mean in row r's rationale
const namedRows = (r, n) => LINES_MEANT[r.helmer].flatMap(line => namedMonths(r.month, n).map(month => rowOf(line, month)))
  .filter(x => x !== undefined);
const cumeAndBand = row => row === undefined ? "(no row)" : `${fmt(row.cume)}, its band ${fmt(row.kmin)} to ${fmt(row.kmax)}`;
const rowsNote = list => list.length === 0 ? "no row of that month's name within 11 months"
  : list.map(x => `${x.helmer} ${x.month}: miles ${fmt(x.vmt)} (band ${fmt(x.vmin)} to ${fmt(x.vmax)}), cumulative ${cumeAndBand(x)}`).join("; ");
// Whether some choice of one item from each list passes the test
const someCombination = (lists, test, picked = []) => picked.length === lists.length
  ? test(picked) : lists[picked.length].some(x => someCombination(lists, test, [...picked, x]));
// The pre-series miles a line's lifetime adds to its series cumulative:
// Waymo's OFFSET range; Zoox's as the row's own rationale states them ("the
// <o> pre-series miles", "the <o> driverless miles before it", "counting the
// <o> earlier driverless miles"), arithmetic only, since no file holds them;
// and none for the Tesla lines, whose series start with their service.
const ZOOX_PRE = new RegExp(String.raw`\bthe ${WHOLE} (?:pre-series|(?:earlier )?driverless) miles\b`, "g");
const NO_PRE = () => [{ low: 0, high: 0, central: 0 }];
const PRE_SERIES = {
  waymo: () => [{ low: OFFSET.low, high: OFFSET.high, central: OFFSET.central }],
  zoox: r => [...r.rationale.matchAll(ZOOX_PRE)].map(m => wholeMiles(m[1]).miles).map(o => ({ low: o, high: o, central: o })),
  tesla: NO_PRE,
  teslanomonitor: NO_PRE,
};
const noPre = Object.values(LINES_MEANT).flat().filter(line => PRE_SERIES[line] === undefined);
assert.deepEqual(noPre, [],
  `Replicata: read the lines LINES_MEANT names. Expectata: each one in PRE_SERIES, the rule for its pre-series miles. Resultata: not there: ${JSON.stringify(noPre)}.`);
// A line's lifetime at the end of day d of row x's month, its month's miles
// spread evenly over its days, for pre-series miles o
const lifetimeOf = (x, d, o) => x.cume - x.vmt + x.vmt * d / daysIn(x.month) + o;
// A quarter's months, and the latest quarter q ending at or before a month:
// the year before's when quarter q ends later in the month's year (a January
// row's "Q3")
const quarterMonths = (year, q) => [1, 2, 3].map(i => `${year}-${String(3 * (q - 1) + i).padStart(2, "0")}`);
const latestQuarter = (month, q) =>
  quarterMonths(Number(month.slice(0, 4)) - Number(`${month.slice(0, 4)}-${String(3 * q).padStart(2, "0")}` > month), q);

// Waymo's anchors, first: their hub figures are what the hub-figure and
// end-of-month forms read.
const hubFigures = []; // each anchor's month and hub figure
const anchorsOf = new Map();
for (const r of waymo) {
  const anchors = [...r.rationale.matchAll(/The ([A-Z][a-z]{2})-(\d{4}) cumulative lands on the anchor: the hub's (\d+(?:\.\d+)?)M plus (\d+(?:\.\d+)?)M\b[^;]*?, less the (\d+(?:\.\d+)?)M pre-series miles/g)]
    .map(m => ({ text: m[0], end: m.index + m[0].length, month: `${m[2]}-${MON[m[1]]}`, hub: millions(m[3]), metros: millions(m[4]), offset: millions(m[5]) }));
  anchorsOf.set(r, anchors);
  for (const a of anchors) {
    figureForms["Waymo anchor"].push(r.month);
    hubFigures.push({ month: a.month, hub: a.hub });
    const row = rowOf("waymo", a.month), want = a.hub.miles + a.metros.miles - a.offset.miles;
    if (row === undefined || !within(want, row.cume, a.hub.slack + a.metros.slack + a.offset.slack)) {
      figureErrors.push(`waymo ${r.month}: "${a.text}" gives ${fmt(want)}, vs ${a.month}'s cumulative ${row === undefined ? "(no row)" : fmt(row.cume)}`);
    }
  }
}
// End of a month or year, any line: what the figure may be (since 2026-11-05;
// until then only the row's line's series cumulative): each line the row may
// mean, its series cumulative and its lifetime (the cumulative plus its
// pre-series miles), and for Waymo the hub's figure an anchor gives for the
// month. A figure passes when its stated precision reaches one of them. For
// a Waymo month no anchor gives a hub figure for, the hub's figure is
// unknown, but the hub counts a part of Waymo's miles, so it is at most the
// lifetime: a figure no higher than that and reaching no known reading may be
// the hub's, and goes unchecked; one above it is no reading's.
const monthEndReadings = (r, month) => [
  ...LINES_MEANT[r.helmer].flatMap(line => [rowOf(line, month)].filter(x => x !== undefined).flatMap(x => [
    { what: `${line}'s cumulative`, lo: x.cume, hi: x.cume },
    ...PRE_SERIES[line](r).filter(p => p.high > 0).map(p => ({ what: `${line}'s lifetime`, lo: x.cume + p.low, hi: x.cume + p.high })),
  ])),
  ...hubFigures.filter(h => LINES_MEANT[r.helmer].includes("waymo") && h.month === month)
    .filter((h, i, all) => all.findIndex(g => g.hub.stated === h.hub.stated) === i) // each figure once
    .map(h => ({ what: "the hub's figure", lo: h.hub.miles - h.hub.slack, hi: h.hub.miles + h.hub.slack })),
  ...[rowOf("waymo", month)].filter(x => x !== undefined && LINES_MEANT[r.helmer].includes("waymo") && !hubFigures.some(h => h.month === month))
    .map(x => ({ what: "the hub's figure, which no anchor gives, at most the lifetime", lo: 0, hi: x.cume + OFFSET.high, unknown: true })),
];
for (const r of rows) {
  for (const m of r.rationale.matchAll(/(\d+(?:\.\d+)?)([kM]) end-(?:([A-Z][a-z]{2})-)?(\d{4})\b/g)) {
    const month = `${m[4]}-${m[3] === undefined ? "12" : MON[m[3]]}`, stated = UNIT[m[2]](m[1]), readings = monthEndReadings(r, month);
    const reaches = x => stated.miles + stated.slack >= x.lo && stated.miles - stated.slack <= x.hi;
    const reached = readings.some(x => !x.unknown && reaches(x));
    if (!reached && readings.some(x => x.unknown && reaches(x))) { // perhaps the hub's figure
      unchecked["end of a month or year"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["end of a month or year"].push(`${r.helmer} ${r.month}`);
    if (!reached) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${readings.length === 0 ? `no figure for ${month}` : readings.map(x => `${x.what} ${x.lo === x.hi ? fmt(x.lo) : `${milesOf(x.lo)} to ${milesOf(x.hi)}`}`).join("; ")}`);
    }
  }
}
for (const r of waymo) {
  const anchors = anchorsOf.get(r);
  for (const m of r.rationale.matchAll(/its cumulative band is the hub total plus (\d+(?:\.\d+)?)M to (\d+(?:\.\d+)?)M\b[^;]*?, less the pre-series miles' range, (\d+(?:\.\d+)?)M-(\d+(?:\.\d+)?)M/g)) {
    const a = anchors.filter(x => x.end <= m.index).at(-1);
    if (a === undefined) { // no anchor before it names the hub total
      unchecked["Waymo anchor band"].push(r.month);
      continue;
    }
    figureForms["Waymo anchor band"].push(r.month);
    const [plusLo, plusHi, rangeLo, rangeHi] = [m[1], m[2], m[3], m[4]].map(millions), row = rowOf("waymo", a.month);
    const wantMin = a.hub.miles + plusLo.miles - rangeHi.miles, wantMax = a.hub.miles + plusHi.miles - rangeLo.miles;
    if (row === undefined || !within(wantMin, row.kmin, a.hub.slack + plusLo.slack + rangeHi.slack) || !within(wantMax, row.kmax, a.hub.slack + plusHi.slack + rangeLo.slack)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" gives ${fmt(wantMin)} to ${fmt(wantMax)}, vs ${a.month}'s cumulative band ${row === undefined ? "(no row)" : `${fmt(row.kmin)} to ${fmt(row.kmax)}`}`);
    }
  }
}
for (const r of waymo) {
  // The hub's figure is read only after "update: ", the words that make it
  // the hub update's total, and with its clause ending after the month (since
  // 2026-11-05; header).
  for (const m of r.rationale.matchAll(/\bupdate: (\d+(?:\.\d+)?)M rider-only miles thru ([A-Z][a-z]{2})-(\d{4})(?=[;,)]|\.(?!\d)|$)/g)) {
    const month = `${m[3]}-${MON[m[2]]}`, stated = millions(m[1]), used = hubFigures.filter(h => h.month === month).map(h => h.hub);
    if (used.length === 0) { // no anchor for that month states a hub figure
      unchecked["hub figure"].push(r.month);
      continue;
    }
    figureForms["hub figure"].push(r.month);
    if (!used.every(h => within(h.miles, stated.miles, h.slack + stated.slack))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}", where the anchors for ${month} use ${JSON.stringify(used.map(h => h.stated))}`);
    }
  }
  for (const frame of r.rationale.matchAll(/by calendar year \(([^)]*)\)/g)) {
    for (const m of frame[1].matchAll(/(\d{1,3}(?:,\d{3})+) in (\d{4})\b/g)) {
      if (`${m[2]}-01` < waymo[0].month) continue; // a year that began before the series
      figureForms["calendar year"].push(r.month);
      const year = waymo.filter(x => x.month.startsWith(`${m[2]}-`)), stated = wholeMiles(m[1]);
      const miles = year.reduce((s, x) => s + x.vmt, 0);
      if (year.length !== 12 || miles !== stated.miles) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${year.length} months of ${m[2]} summing to ${fmt(miles)}`);
      }
    }
  }
  for (const m of r.rationale.matchAll(/first million rider-only miles on ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/g)) {
    figureForms["milestone day"].push(r.month);
    const day = Number(m[2]), row = rowOf("waymo", `${m[3]}-${MON[m[1]]}`);
    if (row === undefined || !(lifetimeAt(row, day - 1) < 1e6 && 1e6 <= lifetimeAt(row, day) + 1)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs the lifetime ${row === undefined ? "(no row)" : `${milesOf(lifetimeAt(row, day - 1))} at the end of the day before and ${milesOf(lifetimeAt(row, day))} at the end of the day`}`);
    }
  }
  for (const m of r.rationale.matchAll(/\bfloor the series clears, [^.;']*'more than (\d+(?:\.\d+)?) million fully autonomous miles' \((?:[^()]+?, )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})\)/g)) {
    figureForms["floor the series clears"].push(r.month);
    const floor = Number(m[1]) * 1e6, day = Number(m[3]), month = `${m[4]}-${MON[m[2]]}`, row = rowOf("waymo", month);
    if (row === undefined || !(1 <= day && day <= daysIn(month) && floor <= lifetimeAt(row, day) + 1)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs the lifetime ${row === undefined ? `(no row for ${month})` : `${milesOf(lifetimeAt(row, day))} at the end of day ${day} of ${month}, a month of ${daysIn(month)} days`}`);
    }
  }
  // The total is read only with the parenthesis right after it, holding no
  // other and holding "<Monthname>'s row <digit>", which sets its rate beside
  // a row's, the words that make it the row's (since 2026-11-04; header).
  for (const frame of r.rationale.matchAll(new RegExp(String.raw`\bTotal (\d+(?:\.\d+)?)M, about (\d+(?:\.\d+)?)k a day \(([^()]*\b${MONTH_NAME}'s row \d[^()]*)\)`, "g"))) {
    figureForms["Waymo total and daily rate"].push(r.month);
    const total = millions(frame[1]), rate = thousands(frame[2]), perDay = r.vmt / daysIn(r.month);
    if (!within(total.miles, r.vmt, total.slack) || !within(rate.miles, perDay, rate.slack)) {
      figureErrors.push(`waymo ${r.month}: "Total ${frame[1]}M, about ${frame[2]}k a day" vs its miles, ${fmt(r.vmt)}, and its miles over its ${daysIn(r.month)} days, ${milesOf(perDay)}`);
    }
    for (const m of frame[3].matchAll(new RegExp(String.raw`\b${MONTH_NAME}'s row (\d+(?:\.\d+)?)k\b`, "g"))) {
      figureForms["a month's daily rate"].push(r.month);
      const stated = thousands(m[2]), meant = namedRows(r, MONTH_NAMES.indexOf(m[1]));
      if (!meant.some(row => within(stated.miles, row.vmt / daysIn(row.month), stated.slack))) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${meant.length === 0 ? `no ${m[1]} row within 11 months` : meant.map(row => `${row.month}'s miles over its ${daysIn(row.month)} days, ${milesOf(row.vmt / daysIn(row.month))}`).join("; ")}`);
      }
    }
    for (const m of frame[3].matchAll(/\bmeasured Q([1-4]) (\d+(?:\.\d+)?)k\b/g)) {
      figureForms["a quarter's daily rate"].push(r.month);
      const months = latestQuarter(r.month, Number(m[1]));
      const quarter = waymo.filter(x => months.includes(x.month)), stated = thousands(m[2]);
      const perDay = quarter.reduce((s, x) => s + x.vmt, 0) / months.reduce((s, x) => s + daysIn(x), 0);
      if (quarter.length !== 3 || !within(stated.miles, perDay, stated.slack)) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${quarter.length} of the 3 rows for ${months.join(", ")}, ${milesOf(perDay)} a day`);
      }
    }
  }
  // A month and its week: the two figures agree for the row's month whoever's
  // they are, and they are the row's miles only when " vs Waymo's" follows,
  // setting them beside a fleet figure of Waymo's (since 2026-11-05; header).
  for (const m of r.rationale.matchAll(/Cross-check: (\d+(?:\.\d+)?)M\/mo ≈ (\d+(?:\.\d+)?)M\/wk\b( vs Waymo's\b)?/g)) {
    figureForms["a month and its week"].push(r.month);
    const [perMonth, perWeek] = [m[1], m[2]].map(millions), days = daysIn(r.month), week = r.vmt * 7 / days;
    const agree = within(perMonth.miles * 7 / days, perWeek.miles, perMonth.slack * 7 / days + perWeek.slack);
    const theRows = m[3] === undefined || (within(perMonth.miles, r.vmt, perMonth.slack) && within(perWeek.miles, week, perWeek.slack));
    if (!agree || !theRows) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": ${perMonth.stated} over ${days} days is ${milesOf(perMonth.miles * 7 / days)} a week${m[3] === undefined ? "" : `; its miles are ${fmt(r.vmt)}, ${milesOf(week)} a week`}`);
    }
  }
  // The band is read only when "the components' ranges combined" follows it
  // later in its sentence, the words that make it the row's (since
  // 2026-11-04; header).
  for (const m of r.rationale.matchAll(/Band x(\d+(?:\.\d+)?) to x(\d+(?:\.\d+)?)(?=(?:[^.]|\.(?=\d))*?\bthe components' ranges combined\b)/g)) {
    figureForms["band multipliers"].push(r.month);
    const slack = s => 0.5 * 10 ** -decimals(s) + 1e-9;
    if (!within(Number(m[1]), r.vmin / r.vmt, slack(m[1])) || !within(Number(m[2]), r.vmax / r.vmt, slack(m[2]))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs its band over its miles, x${(r.vmin / r.vmt).toFixed(4)} to x${(r.vmax / r.vmt).toFixed(4)}`);
    }
  }
}
// A Waymo row's terms (since 2026-11-05 every term its list holds; until then
// the five or six it named): the list is the sentence a clause "CA = ..." or
// "CA <digit>..." opens, read at depth 0 (parentheses and brackets stepped
// over), naming Maricopa, Travis, Atlanta and metros in that order. CA's term
// is the last "= <c>M" of that clause, the one before its first semicolon;
// the rest of the sentence is split at its semicolons into items, and each
// item, up to an "=" that starts its explanation, at its commas and its
// " and "s into terms, a leading "+ " or "and " dropped. A term is a figure
// (millions, thousands or whole miles) after a label: a place's name (words
// each starting with a capital), words naming metros, or "about". Every
// figure of the list at depth 0 must be CA's term or such a term, and CA's
// clause must hold none after its term; a list with any other figure there (a
// figure after "=", one with no label, a rate such as "1.08M/mo") is one this
// cannot sum, so it goes unchecked, and the pass line counts it so.
const maskGroups = s => s.replace(new RegExp(`${PAREN}|${BRACKET}`, "g"), g => `\x01${" ".repeat(g.length - 2)}\x02`);
const FIGURE = /(?<![\d.,])(?:(\d+(?:\.\d+)?)([kM])(?![A-Za-z])(\/[a-z]+)?|(\d{1,3}(?:,\d{3})+)(?![,.]?\d))/g;
const asFigure = f => (f[4] === undefined ? UNIT[f[2]](f[1]) : roundedWhole(f[4]));
const LABEL = /^(?:[A-Z][A-Za-z.'+\/-]*(?: [A-Z][A-Za-z.'+\/-]*)*|[a-z][a-z' -]*\bmetros\b[a-z' -]*|about)$/;
// The parenthesis right after a point of a text, if one opens there (the
// empty alternative makes the match always succeed)
const PAREN_AFTER = new RegExp(`^ (${PAREN})|`);
// The pieces of a masked text between its separators, each with its offset
const pieces = (text, at, sep) => {
  const cuts = [...text.matchAll(sep)].map(e => [e.index, e.index + e[0].length]);
  const starts = [0, ...cuts.map(c => c[1])], ends = [...cuts.map(c => c[0]), text.length];
  return starts.map((from, i) => ({ text: text.slice(from, ends[i]), at: at + from }));
};
// A list's terms and the figures in it that are no term: after CA's term in
// its clause, in an item's explanation (after its "="), or with no label
const listTerms = (r, list, caTerm) => {
  const stray = [...list[1].slice(caTerm.index + caTerm[0].length).matchAll(FIGURE)].map(f => f[0]);
  const terms = [{ label: "CA", ...millions(caTerm[1]), paren: undefined }];
  for (const item of pieces(list[2], list.indices[2][0], /;/g)) {
    const head = item.text.split("=")[0];
    stray.push(...[...item.text.slice(head.length).matchAll(FIGURE)].map(f => f[0]));
    for (const sub of pieces(head, item.at, /, | and /g)) {
      const lead = /^\s*(?:\+ |and )?/.exec(sub.text)[0].length, text = sub.text.slice(lead);
      for (const [i, f] of [...text.matchAll(FIGURE)].entries()) {
        const label = text.slice(0, f.index).replace(/\x01 *\x02/g, " ").replace(/\s+/g, " ").trim();
        if (i === 0 && f[3] === undefined && LABEL.test(label)) {
          terms.push({ label, ...asFigure(f), paren: PAREN_AFTER.exec(r.rationale.slice(sub.at + lead + f.index + f[0].length))[1] });
        } else {
          stray.push(f[0]);
        }
      }
    }
  }
  return { terms, stray };
};
const termsOf = new Map(); // a Waymo row -> the terms its list sums, where it can
const TERMS_LIST = /\bCA (?:= |(?=\d))([^;]*); ((?:[^.]|\.(?!\s|$))*)/dg;
for (const r of waymo) {
  for (const list of maskGroups(r.rationale).matchAll(TERMS_LIST)) {
    if (!/\bMaricopa\b[^]*\bTravis\b[^]*\bAtlanta\b[^]*\bmetros\b/.test(list[2])) continue; // another list
    const caTerm = [...list[1].matchAll(/= (\d+(?:\.\d+)?)M\b/g)].at(-1);
    const parsed = caTerm === undefined ? undefined : listTerms(r, list, caTerm);
    // a delimiter left over by the masking is one that does not balance
    if (parsed === undefined || parsed.stray.length > 0 || /[()\[\]]/.test(list[0])) {
      unchecked["Waymo terms"].push(r.month);
      continue;
    }
    figureForms["Waymo terms"].push(r.month);
    termsOf.set(r, parsed.terms);
    const sum = parsed.terms.reduce((s, t) => s + t.miles, 0), slack = parsed.terms.reduce((s, t) => s + t.slack, 0);
    if (!within(sum, r.vmt, slack)) {
      figureErrors.push(`waymo ${r.month}: its terms ${parsed.terms.map(t => t.stated).join(" + ")} sum to ${fmt(sum)}, vs its miles, ${fmt(r.vmt)} (their rounding allows ${fmt(slack)})`);
    }
  }
}
// data/waymo-ca.csv: CPUC's measured driverless miles a month, deployment
// and pilot, the base the April-June 2026 rows state for their CA terms
const caRaw = parseCsv(fs.readFileSync("data/waymo-ca.csv", "utf8"));
assert.deepEqual(caRaw[0].slice(0, 3), ["month", "deployment", "pilot"],
  `Replicata: read data/waymo-ca.csv's header. Expectata: month, deployment and pilot as its first three columns. Resultata: ${JSON.stringify(caRaw[0])}.`);
const badCa = caRaw.slice(1).filter(p => !(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(p[0]) && /^\d+(?:\.\d+)?$/.test(p[1]) && /^\d+(?:\.\d+)?$/.test(p[2])));
assert.deepEqual(badCa, [],
  `Replicata: read data/waymo-ca.csv's rows. Expectata: each a YYYY-MM month and deployment and pilot miles as plain numbers. Resultata: ${JSON.stringify(badCa)}.`);
const CPUC_CA = Object.fromEntries(caRaw.slice(1).map(p => [p[0], { deployment: Number(p[1]), pilot: Number(p[2]) }]));
const CPUC_PRODUCT = new RegExp(String.raw`\bCPUC Q([1-4])-(\d{4}) driverless actual ${WHOLE} deployment \+ ${WHOLE} pilot(?: ${PAREN})? x (\d+(?:\.\d+)?)(?:[^;=()\[\]]|${PAREN}|${BRACKET})*= (\d+(?:\.\d+)?)M`, "g");
// Any line's product: "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[ [<range>]]
// = <r>M", the factor a decimal or a ratio a/b, the base the figure right
// before " x" (no figure between them at depth 0, since 2026-11-05; until
// then the clause's leftmost "<num>M" that reached it); the result is read in
// a lookahead, so it can be the next product's base (October's "10.4M ... x
// 31/30 = 10.75M x ... 1.0576 = 11.37M").
const FIGURE_AHEAD = String.raw`\d+(?:\.\d+)?[kM](?![A-Za-z])|\d{1,3}(?:,\d{3})+(?![,.]?\d)`;
const PRODUCT = new RegExp(String.raw`(?<![\d.,])(\d+(?:\.\d+)?)M(?:(?!${FIGURE_AHEAD})[^;=.()\[\]]|\.(?=\d)|${PAREN})*? x (?:the hub-vs-CPUC CA ratio )?(\d+(?:\.\d+)?(?:\/\d+)?)(?: ${BRACKET})? = (?=(\d+(?:\.\d+)?)M)`, "g");
for (const r of waymo) {
  for (const m of r.rationale.matchAll(CPUC_PRODUCT)) {
    figureForms["CPUC product"].push(r.month);
    const [dep, pilot] = [m[3], m[4]].map(wholeMiles), result = millions(m[6]), product = (dep.miles + pilot.miles) * Number(m[5]);
    if (!within(product, result.miles, result.slack)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": (${dep.stated} + ${pilot.stated}) x ${m[5]} is ${milesOf(product)}`);
    }
    // The base, CPUC's miles for a month: any month of the stated quarter,
    // the words naming no month (since 2026-11-05; until then the row's
    // month, in the row's quarter only). It is checked where it is one
    // month's of data/waymo-ca.csv, and where the file holds the quarter's
    // three months; a base that is none of the months the file holds, in a
    // quarter whose months it does not all hold, may be one it lacks, so it
    // goes unchecked.
    const held = quarterMonths(m[2], Number(m[1])).filter(x => CPUC_CA[x] !== undefined);
    const isMonth = x => within(dep.miles, CPUC_CA[x].deployment, 0.5) && within(pilot.miles, CPUC_CA[x].pilot, 0.5);
    if (!held.some(isMonth) && held.length < 3) {
      unchecked["CPUC base"].push(r.month);
      continue;
    }
    figureForms["CPUC base"].push(r.month);
    if (!held.some(isMonth)) {
      figureErrors.push(`waymo ${r.month}: "${dep.stated} deployment + ${pilot.stated} pilot" vs data/waymo-ca.csv's Q${m[1]}-${m[2]}: ${held.map(x => `${x} deployment ${milesOf(CPUC_CA[x].deployment)} and pilot ${milesOf(CPUC_CA[x].pilot)}`).join("; ")}`);
    }
  }
}
for (const r of rows) {
  for (const m of r.rationale.matchAll(PRODUCT)) {
    figureForms["product"].push(`${r.helmer} ${r.month}`);
    // a decimal factor reads as itself over 1
    const [num, den] = `${m[2]}/1`.split("/").map(Number), base = millions(m[1]), result = millions(m[3]);
    if (!within(base.miles * num / den, result.miles, result.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}${m[3]}M": ${base.stated} x ${m[2]} is ${milesOf(base.miles * num / den)}`);
    }
  }
}
// A month's cumulative and band by its name (Tesla's June-August 2025 rows,
// Zoox's 2025-2026 ones), whole miles exactly, read as each row it may mean
// (namedRows: since 2026-11-05 the month of that name within 11 months either
// way, in the row's line or the other Tesla line; until then that month of
// the row's year in the row's line).
const NAMED_FORMS = [
  // "<Month> keeps <source>'s end-of-month <c>[ (...)], its band <lo>-<hi>":
  // its cumulative and band
  { form: "a month's cumulative and band",
    re: new RegExp(String.raw`\b${MONTH_NAME} keeps [^,;()]*?\bend-of-month ${WHOLE}(?: ${PAREN})?, its band ${WHOLE}-${WHOLE}`, "g"),
    holds: (row, m) => row.cume === wholeMiles(m[2]).miles && row.kmin === wholeMiles(m[3]).miles && row.kmax === wholeMiles(m[4]).miles },
  // "end-<Month> <a> / <b> / <c>", where "<Month> keeps ..., its band <lo>-<hi>
  // holding the three readings" follows: each reading inside the month's band
  { form: "a band holding readings",
    re: new RegExp(String.raw`\bend-${MONTH_NAME} ${WHOLE} \/ ${WHOLE} \/ ${WHOLE}(?=[^]*?\b\1 keeps [^,;()]*?\bend-of-month [\d,]+(?: ${PAREN})?, its band [\d,]+-[\d,]+ holding the three readings\b)`, "g"),
    holds: (row, m) => [m[2], m[3], m[4]].every(s => row.kmin <= wholeMiles(s).miles && wholeMiles(s).miles <= row.kmax) },
  // "<Month>'s cumulative is that reading, <c>" or "is the chart's ~<c>": its
  // cumulative (the "~" marks the chart's reading approximate, not the
  // cumulative, which is that figure)
  { form: "a month's cumulative",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is (?:that reading, |the chart's ~)${WHOLE}`, "g"),
    holds: (row, m) => row.cume === wholeMiles(m[2]).miles },
  // "<Month>'s cumulative is that reading, <c>, its band from the call's <f> to
  // <p>% above it": the band's floor f and its top c x (1 + p/100), p to the
  // whole percent
  { form: "a cumulative's floor and top",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is that reading, ${WHOLE}, its band from the call's ${WHOLE} to (\d+)% above it\b`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[3]).miles && within(row.kmax / wholeMiles(m[2]).miles - 1, Number(m[4]) / 100, 0.005 + 1e-9) },
  // "<Month>'s cumulative is the chart's ~<c>, its floor <f>": the band's floor
  { form: "a cumulative's floor",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is the chart's ~${WHOLE}, its floor ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[3]).miles },
  // "<Month>'s miles are at least <n>": a floor on its miles
  { form: "a month's miles at least",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s miles are at least ${WHOLE}`, "g"),
    holds: (row, m) => row.vmt >= wholeMiles(m[2]).miles },
  // "<Month>'s miles are at least <n>, ..., puts them there (<v> with": its
  // miles
  { form: "a month's miles as put",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s miles are at least ${WHOLE},(?:[^.;()]|\.(?=\d))*?\bputs them there \(${WHOLE} with\b`, "g"),
    holds: (row, m) => row.vmt === wholeMiles(m[3]).miles },
  // "<Month>'s cumulative band, <lo> to <hi>": its cumulative band
  { form: "a month's cumulative band",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative band, ${WHOLE} to ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[2]).miles && row.kmax === wholeMiles(m[3]).miles },
  // "End-<Month> cumulative floor <f>": its cumulative band's floor
  { form: "an end-of-month floor",
    re: new RegExp(String.raw`\bEnd-${MONTH_NAME} cumulative floor ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[2]).miles },
];
for (const r of rows) for (const { form, re, holds } of NAMED_FORMS) for (const m of r.rationale.matchAll(re)) {
  figureForms[form].push(`${r.helmer} ${r.month}`);
  const meant = namedRows(r, MONTH_NAMES.indexOf(m[1]));
  if (!meant.some(row => holds(row, m))) {
    figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${rowsNote(meant)}`);
  }
}
// The row's own figures, any line; the row before is its line's previous row
// in the file (consecutive months, vmt-ledger.qual), or zero for its first.
const rowBefore = r => { const own = rows.filter(x => x.helmer === r.helmer); return [{ cume: 0, kmin: 0, kmax: 0 }, ...own][own.indexOf(r)]; };
for (const r of rows) {
  // "Each month is its cumulative less the month before's, its band the
  // difference of their bands": its miles its cumulative less the row
  // before's, its band's floor its cumulative floor less the row before's
  // cumulative top, and its band's top its cumulative top less the row
  // before's cumulative floor, whole miles exactly
  for (const m of r.rationale.matchAll(/\bEach month is its cumulative less the month before's, its band the difference of their bands\b/g)) {
    figureForms["a month as a difference"].push(`${r.helmer} ${r.month}`);
    const before = rowBefore(r);
    if (r.vmt !== r.cume - before.cume || r.vmin !== r.kmin - before.kmax || r.vmax !== r.kmax - before.kmin) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs its miles ${fmt(r.vmt)} and band ${fmt(r.vmin)} to ${fmt(r.vmax)}, its cumulative ${cumeAndBand(r)}, the row before's ${cumeAndBand(before)}`);
    }
  }
  // "a month's band is <a>x-<b>x its miles, within the difference of its
  // cumulative band and the month before's": its band is a and b times its
  // miles, each edge held inside that difference (its cumulative floor less
  // the row before's top to its cumulative top less the row before's
  // floor), to half a mile either way
  for (const m of r.rationale.matchAll(/\ba month's band is (\d+(?:\.\d+)?)x-(\d+(?:\.\d+)?)x its miles, within the difference of its cumulative band and the month before's\b/g)) {
    figureForms["a band within a difference"].push(`${r.helmer} ${r.month}`);
    const before = rowBefore(r), lo = Math.max(Number(m[1]) * r.vmt, r.kmin - before.kmax), hi = Math.min(Number(m[2]) * r.vmt, r.kmax - before.kmin);
    if (!within(r.vmin, lo, 0.5) || !within(r.vmax, hi, 0.5)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" gives ${milesOf(lo)} to ${milesOf(hi)}, vs its band ${fmt(r.vmin)} to ${fmt(r.vmax)} (its cumulative ${cumeAndBand(r)}, the row before's ${cumeAndBand(before)})`);
    }
  }
  // "the cumulative is ...: <x>M less the <o> pre-series miles, <c>": its
  // cumulative c, whole miles exactly, and x less o is c to x's precision
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bthe cumulative is\b(?:[^.;]|\.(?=\d))*?: (\d+(?:\.\d+)?)M less the ${WHOLE} pre-series miles, ${WHOLE}`, "g"))) {
    figureForms["a cumulative less pre-series miles"].push(`${r.helmer} ${r.month}`);
    const x = millions(m[1]), [o, c] = [m[2], m[3]].map(s => wholeMiles(s).miles);
    if (r.cume !== c || !within(x.miles - o, c, x.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs its cumulative ${fmt(r.cume)}; ${x.stated} less ${fmt(o)} is ${fmt(x.miles - o)}`);
    }
  }
  // "Its band, <lo> to <hi>, is that statement's range": its cumulative band
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bIts band, ${WHOLE} to ${WHOLE}, is that statement's range\b`, "g"))) {
    figureForms["a band from a statement's range"].push(`${r.helmer} ${r.month}`);
    if (r.kmin !== wholeMiles(m[1]).miles || r.kmax !== wholeMiles(m[2]).miles) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs its cumulative band, ${fmt(r.kmin)} to ${fmt(r.kmax)}`);
    }
  }
  // "Cumulative band <lo> to <hi>:" opening a sentence: its cumulative band
  for (const m of r.rationale.matchAll(new RegExp(String.raw`(?<=^|\. )Cumulative band ${WHOLE} to ${WHOLE}:`, "g"))) {
    figureForms["a row's cumulative band"].push(`${r.helmer} ${r.month}`);
    if (r.kmin !== wholeMiles(m[1]).miles || r.kmax !== wholeMiles(m[2]).miles) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs its cumulative band, ${fmt(r.kmin)} to ${fmt(r.kmax)}`);
    }
  }
  // "Central <c>." opening a sentence: its miles, or for a Tesla line the
  // other Tesla line's that month (since 2026-11-05)
  for (const m of r.rationale.matchAll(new RegExp(String.raw`(?<=^|\. )Central ${WHOLE}(?=\.(?:\s|$))`, "g"))) {
    figureForms["a row's central"].push(`${r.helmer} ${r.month}`);
    const meant = LINES_MEANT[r.helmer].map(line => rowOf(line, r.month)).filter(x => x !== undefined);
    if (!meant.some(x => x.vmt === wholeMiles(m[1]).miles)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${rowsNote(meant)}`);
    }
  }
  // "The cumulative band's floor through <Mon> <D>, <f>, is the end-<Month>
  // floor (<j>: ...) plus the <Month> and <Month> floors": D the last day of
  // its month, f that month's cumulative floor, j the end-<Month> one, and j
  // plus the two months' own floors is f, whole miles exactly; each month
  // read as namedRows reads one, the four in one line
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bThe cumulative band's floor through ${MON_NAME} (\d{1,2}), ${WHOLE}, is the end-${MONTH_NAME} floor \(${WHOLE}:[^()]*\) plus the ${MONTH_NAME} and ${MONTH_NAME} floors\b`, "g"))) {
    figureForms["a floor through a month's end"].push(`${r.helmer} ${r.month}`);
    const [f, j] = [m[3], m[5]].map(s => wholeMiles(s).miles), names = [MON_NAMES.indexOf(m[1]), ...[m[4], m[6], m[7]].map(x => MONTH_NAMES.indexOf(x))];
    const holds = LINES_MEANT[r.helmer].some(line => someCombination(
      names.map(n => namedMonths(r.month, n).map(month => rowOf(line, month)).filter(x => x !== undefined)),
      ([at, end, a, b]) => Number(m[2]) === daysIn(at.month) && at.kmin === f && end.kmin === j && j + a.vmin + b.vmin === f));
    if (!holds) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${names.map(n => `${MONTH_NAMES[n]}: ${rowsNote(namedRows(r, n))}`).join(" | ")}`);
    }
  }
}

// The forms added on 2026-11-05 (the fifth fix run's reviews; frames as in
// the (3a) comment above).
// Tesla's no-monitor page, in the Tesla lines' rows (where "the page" is
// Tesla's Robotaxi Safety Report page): "<Month>: <p> on the page" or
// "<Month>'s no-monitor miles are <p> on the page", the clause ending there
// or going on with a parenthesis or its deck reading (so a part of a month,
// "on the page through Oct 18", is not read), then optionally "[ (...)], <d>
// in the deck" or " and <d> in the deck": p is the no-monitor line's miles
// for that month (namedMonths), whole miles exactly
const PAGE_READING = new RegExp(String.raw`\b${MONTH_NAME}(?:'s no-monitor miles are|:) ${WHOLE} on the page(?=[;.,)]|$| \(| and \d)(?:(?: ${PAREN})?(?:,| and) ${WHOLE} in the deck\b)?`, "g");
const PAGE_LINES = ["tesla", "teslanomonitor"]; // the rows whose "the page" is Tesla's
const leadsOf = new Map(); // a row -> its page readings, in order (none outside PAGE_LINES)
for (const r of rows) {
  const leads = [...r.rationale.matchAll(PAGE_READING)].filter(() => PAGE_LINES.includes(r.helmer)).map(m => ({ m, end: m.index + m[0].length, n: MONTH_NAMES.indexOf(m[1]),
    page: wholeMiles(m[2]), deck: m[3] === undefined ? undefined : wholeMiles(m[3]) }));
  leadsOf.set(r, leads);
  for (const { m, n, page } of leads) {
    const meant = namedMonths(r.month, n).map(month => rowOf("teslanomonitor", month)).filter(x => x !== undefined);
    if (meant.length === 0) { // the no-monitor line has no row for that month
      unchecked["a page reading"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a page reading"].push(`${r.helmer} ${r.month}`);
    if (!meant.some(x => x.vmt === page.miles)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs the no-monitor line's ${rowsNote(meant)}`);
    }
  }
}
// After a page reading in the same rationale, the month's figures it gives:
// "[;.] floor <f>" (or "Floor"), "[;.] the central, <c>" and "[;.] the top,
// <t>", each figure ending its clause, are that month's floor, central and
// top (its miles' or its cumulative's), whole miles exactly, in a line the
// row may mean; "the central, <c>, adds <Month>'s <r> monitor-aboard
// remainder" has c the page reading, the deck reading or the no-monitor
// line's miles for that month plus r, and "the top, <t>, ... (the higher
// reading x <f>)" t the higher of the page and deck readings times f, each to
// the precision of c or t (its last nonzero digit); with no page reading
// before them their words name no month, so they go unread
const MONTH_FIGURE = new RegExp(String.raw`(?<=[;.] )([Ff]loor|[Tt]he central,|[Tt]he top,) ${WHOLE}(?=[;.,]|$)`, "g");
const FIGURE_FIELDS = { "floor": ["vmin", "kmin"], "the central,": ["vmt", "cume"], "the top,": ["vmax", "kmax"] };
const CENTRAL_SUM = new RegExp(String.raw`\b[Tt]he central, ${WHOLE}, adds ${MONTH_NAME}'s ${WHOLE} monitor-aboard remainder\b`, "g");
const TOP_FACTOR = new RegExp(String.raw`\b[Tt]he top, ${WHOLE}, [^;.()]*\(the higher reading x (\d+(?:\.\d+)?)\)`, "g");
const leadBefore = (r, at) => leadsOf.get(r).filter(x => x.end <= at).at(-1);
for (const r of rows) {
  for (const m of r.rationale.matchAll(MONTH_FIGURE)) {
    const lead = leadBefore(r, m.index);
    if (lead === undefined) continue; // no month named before it
    figureForms["a month's floor, central or top"].push(`${r.helmer} ${r.month}`);
    const fields = FIGURE_FIELDS[m[1].toLowerCase()], meant = namedRows(r, lead.n);
    if (!meant.some(x => fields.some(k => x[k] === wholeMiles(m[2]).miles))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" (after "${lead.m[0]}") vs ${rowsNote(meant)}`);
    }
  }
  for (const m of r.rationale.matchAll(CENTRAL_SUM)) {
    const lead = leadBefore(r, m.index);
    if (lead === undefined) continue;
    figureForms["a central from a reading and a remainder"].push(`${r.helmer} ${r.month}`);
    const c = roundedWhole(m[1]), rem = wholeMiles(m[3]).miles;
    const bases = [lead.page, lead.deck].filter(x => x !== undefined).map(x => x.miles)
      .concat(namedMonths(r.month, lead.n).map(month => rowOf("teslanomonitor", month)).filter(x => x !== undefined).map(x => x.vmt));
    if (!bases.some(b => within(c.miles, b + rem, c.slack))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${[...new Set(bases)].map(b => `${fmt(b)} plus ${m[3]} is ${fmt(b + rem)}`).join("; ")}`);
    }
  }
  for (const m of r.rationale.matchAll(TOP_FACTOR)) {
    const lead = leadBefore(r, m.index);
    if (lead === undefined || lead.deck === undefined) {
      unchecked["a top from a reading"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a top from a reading"].push(`${r.helmer} ${r.month}`);
    const t = roundedWhole(m[1]), want = Math.max(lead.page.miles, lead.deck.miles) * Number(m[2]);
    if (!within(t.miles, want, t.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": the higher of ${lead.page.stated} and ${lead.deck.stated} times ${m[2]} is ${milesOf(want)}`);
    }
  }
}
// June's remainder and share between Tesla's two lines: "<r> monitor-aboard
// miles, <Month>'s measured remainder (the Q<q> deck's <a> paid miles less
// the page's <b> no-monitor miles)" has a Tesla's miles that month (in
// quarter q), b the no-monitor line's, and r a less b; "<Month>'s <r>
// monitor-aboard remainder" r Tesla's miles less the no-monitor line's; and
// "monitor-aboard share [stayed ]at or below <Month>'s <p>%" p their
// difference over Tesla's miles, to the whole percent. r to its precision
// (its last nonzero digit), a and b whole miles exactly.
const DECK_LESS_PAGE = new RegExp(String.raw`\b${WHOLE} monitor-aboard miles, ${MONTH_NAME}'s measured remainder \(the Q([1-4]) deck's ${WHOLE} paid miles less the page's ${WHOLE} no-monitor miles\)`, "g");
const REMAINDER = new RegExp(String.raw`\b${MONTH_NAME}'s ${WHOLE} monitor-aboard remainder\b`, "g");
const SHARE = new RegExp(String.raw`\bmonitor-aboard share (?:stayed )?at or below ${MONTH_NAME}'s (\d+)%`, "g");
// Tesla's and the no-monitor line's rows for each month a name may mean
const bothLines = (r, name) => namedMonths(r.month, MONTH_NAMES.indexOf(name))
  .map(month => ({ month, all: rowOf("tesla", month), none: rowOf("teslanomonitor", month) }))
  .filter(x => x.all !== undefined && x.none !== undefined);
const linesNote = list => list.length === 0 ? "no month of that name within 11 months with rows on both Tesla lines"
  : list.map(x => `${x.month}: Tesla's ${fmt(x.all.vmt)}, the no-monitor line's ${fmt(x.none.vmt)}`).join("; ");
for (const r of rows) {
  for (const m of r.rationale.matchAll(DECK_LESS_PAGE)) {
    const rem = roundedWhole(m[1]), [a, b] = [m[4], m[5]].map(s => wholeMiles(s).miles), meant = bothLines(r, m[2]);
    if (meant.length === 0) {
      unchecked["a monitor-aboard remainder"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a monitor-aboard remainder"].push(`${r.helmer} ${r.month}`);
    if (!meant.some(x => Math.ceil(Number(x.month.slice(5, 7)) / 3) === Number(m[3]) && x.all.vmt === a && x.none.vmt === b) || !within(rem.miles, a - b, rem.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${fmt(a)} less ${fmt(b)} is ${fmt(a - b)}; vs ${linesNote(meant)}`);
    }
  }
  for (const m of r.rationale.matchAll(REMAINDER)) {
    const rem = roundedWhole(m[2]), meant = bothLines(r, m[1]);
    if (meant.length === 0) {
      unchecked["a monitor-aboard remainder"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a monitor-aboard remainder"].push(`${r.helmer} ${r.month}`);
    if (!meant.some(x => within(rem.miles, x.all.vmt - x.none.vmt, rem.slack))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${linesNote(meant)}`);
    }
  }
  for (const m of r.rationale.matchAll(SHARE)) {
    const meant = bothLines(r, m[1]);
    if (meant.length === 0) {
      unchecked["a monitor-aboard share"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a monitor-aboard share"].push(`${r.helmer} ${r.month}`);
    if (!meant.some(x => within(Number(m[2]), 100 * (x.all.vmt - x.none.vmt) / x.all.vmt, 0.5 + 1e-9))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${linesNote(meant)}`);
    }
  }
  // "no-monitor miles for the month as projected on the no-monitor line, <c>
  // [<lo>, <hi>] (...), set the floor": the no-monitor line's miles and band
  // for the row's month, and lo the row's floor, whole miles exactly
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bno-monitor miles for the month as projected on the no-monitor line, ${WHOLE} \[${WHOLE}, ${WHOLE}\](?: ${PAREN})?, set the floor\b`, "g"))) {
    const [c, lo, hi] = [m[1], m[2], m[3]].map(s => wholeMiles(s).miles), none = rowOf("teslanomonitor", r.month);
    if (none === undefined) {
      unchecked["a projected month's band"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a projected month's band"].push(`${r.helmer} ${r.month}`);
    if (none.vmt !== c || none.vmin !== lo || none.vmax !== hi || r.vmin !== lo) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs the no-monitor line's ${rowsNote([none])}, and the row's floor ${fmt(r.vmin)}`);
    }
  }
}
// A lifetime on a day: "crosses <x>M at the start of <Mon> <D>" (or "on
// <Mon> <D>") has the lifetime reach x during that day, with one mile's slack
// (at most x + 1 at the end of the day before, at least x - 1 at its end);
// "stands at <x>M on <Mon> <D>" has the lifetime at the end of that day x, to
// x's precision; and "the <o> driverless miles before it come off <Name>'s
// ~<x>M-mile figure for <Mon> <D>, <YYYY>" has the cumulative at the end of
// that day plus o x, to one unit of x's last digit (its "~"). The lifetime
// is the series cumulative, the month's miles spread evenly over its days,
// plus the line's pre-series miles (PRE_SERIES), any amount in their range;
// for a Zoox row whose rationale states none the first two go unchecked. A
// month named without its year is read as namedMonths reads one.
const LIFETIME_FORMS = [
  { re: new RegExp(String.raw`\bcrosses (\d+(?:\.\d+)?)M (?:at the start of|on) ${MON_NAME} (\d{1,2})\b`, "g"),
    holds: (row, day, p, x) => Math.max(p.low, x.miles - 1 - lifetimeOf(row, day, 0)) <= Math.min(p.high, x.miles + 1 - lifetimeOf(row, day - 1, 0)) },
  { re: new RegExp(String.raw`\bstands at (\d+(?:\.\d+)?)M on ${MON_NAME} (\d{1,2})\b`, "g"),
    holds: (row, day, p, x) => lifetimeOf(row, day, p.low) <= x.miles + x.slack && x.miles - x.slack <= lifetimeOf(row, day, p.high) },
];
const COMES_OFF = new RegExp(String.raw`\bthe ${WHOLE} driverless miles before it come off [A-Z][A-Za-z]*'s ~(\d+(?:\.\d+)?)M-mile figure for ${MON_NAME} (\d{1,2}), (\d{4})\b`, "g");
for (const r of rows) {
  for (const { re, holds } of LIFETIME_FORMS) for (const m of r.rationale.matchAll(re)) {
    const pres = LINES_MEANT[r.helmer].map(line => [line, PRE_SERIES[line](r)]).filter(([, p]) => p.length > 0);
    if (pres.length === 0) { // no pre-series miles stated
      unchecked["a lifetime milestone"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a lifetime milestone"].push(`${r.helmer} ${r.month}`);
    const x = millions(m[1]), day = Number(m[3]);
    const meant = pres.flatMap(([line, p]) => namedMonths(r.month, MON_NAMES.indexOf(m[2])).map(month => rowOf(line, month))
      .filter(row => row !== undefined && day <= daysIn(row.month)).flatMap(row => p.map(o => ({ row, o }))));
    if (!meant.some(({ row, o }) => holds(row, day, o, x))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${meant.length === 0 ? "no row for that day" : meant.map(({ row, o }) => `${row.helmer}'s cumulative ${milesOf(lifetimeOf(row, day - 1, 0))} at the end of ${row.month}'s day ${day - 1} and ${milesOf(lifetimeOf(row, day, 0))} at the end of day ${day}, plus ${o.low === o.high ? fmt(o.low) : `${fmt(o.low)}-${fmt(o.high)}`} pre-series miles`).join("; ")}`);
    }
  }
  for (const m of r.rationale.matchAll(COMES_OFF)) {
    figureForms["an approximate lifetime"].push(`${r.helmer} ${r.month}`);
    const o = wholeMiles(m[1]).miles, x = millions(m[2]), day = Number(m[4]), row = rowOf(r.helmer, `${m[5]}-${MON[m[3]]}`);
    if (row === undefined || day > daysIn(row.month) || !within(lifetimeOf(row, day, o), x.miles, 10 ** (6 - decimals(m[2])))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${row === undefined ? `no row for ${m[5]}-${MON[m[3]]}` : `the cumulative ${milesOf(lifetimeOf(row, day, 0))} at the end of day ${day} of ${row.month}, which plus ${fmt(o)} is ${milesOf(lifetimeOf(row, day, o))}`}`);
    }
  }
}
// Tesla's deck readings of 2025: "in its <deck> (...), <deck> and <deck>
// (...) update decks" lists the decks, "end-<Month> <a> / <b> / <c>" the
// month's readings in that order, and "a floor on the end-<Month> cumulative
// that only the <deck> deck's reading meets" has that deck's reading the one
// reading at or above the month's cumulative floor; "<Month>'s cumulative is
// the chart's ~<c>, its floor <f> (the lowest reading less ~<q>% read
// noise)" has f q% below the month's lowest reading, and "the end-<Month>
// floor (<j>: the deck's <d>M less ~<q>% read noise)" d that month's
// cumulative to its precision and j q% below d, each percentage to one unit
// of its last digit (its "~"); with no list of decks or no readings of the
// month in the rationale the first two go unchecked.
const DECKS = /\bin its (Q[1-4]-\d{4})(?: \([^()]*\))?, (Q[1-4]-\d{4})(?: \([^()]*\))? and (Q[1-4]-\d{4})(?: \([^()]*\))? update decks\b/g;
const READINGS = new RegExp(String.raw`\bend-${MONTH_NAME} ${WHOLE} \/ ${WHOLE} \/ ${WHOLE}\b`, "g");
const readingsOf = (r, name) => [...r.rationale.matchAll(READINGS)].filter(x => x[1] === name).map(x => [x[2], x[3], x[4]].map(s => wholeMiles(s).miles));
for (const r of rows) {
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\ba floor on the end-${MONTH_NAME} cumulative that only the (Q[1-4]-\d{4}) deck's reading meets\b`, "g"))) {
    const decks = [...r.rationale.matchAll(DECKS)].map(x => x.slice(1)), readings = readingsOf(r, m[1]);
    if (decks.length === 0 || readings.length === 0) {
      unchecked["a floor one reading meets"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a floor one reading meets"].push(`${r.helmer} ${r.month}`);
    const meant = namedRows(r, MONTH_NAMES.indexOf(m[1]));
    const holds = decks.some(list => readings.some(set => meant.some(row =>
      JSON.stringify(set.filter(x => x >= row.kmin)) === JSON.stringify([set[list.indexOf(m[2])]]))));
    if (!holds) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}", the decks ${JSON.stringify(decks)} reading ${JSON.stringify(readings)}, vs ${rowsNote(meant)}`);
    }
  }
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is the chart's ~${WHOLE}, its floor ${WHOLE} \(the lowest reading less ~(\d+(?:\.\d+)?)% read noise\)`, "g"))) {
    const readings = readingsOf(r, m[1]);
    if (readings.length === 0) {
      unchecked["a floor an approximate share below"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a floor an approximate share below"].push(`${r.helmer} ${r.month}`);
    const f = wholeMiles(m[3]).miles, below = set => 100 * (1 - f / Math.min(...set));
    if (!readings.some(set => nearPercent(below(set), m[4]))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs the readings ${JSON.stringify(readings)}, ${fmt(f)} being ${readings.map(set => `${below(set).toFixed(2)}%`).join(" or ")} below the lowest`);
    }
  }
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bthe end-${MONTH_NAME} floor \(${WHOLE}: the deck's (\d+(?:\.\d+)?)M less ~(\d+(?:\.\d+)?)% read noise\)`, "g"))) {
    figureForms["a floor an approximate share below"].push(`${r.helmer} ${r.month}`);
    const j = wholeMiles(m[2]).miles, d = millions(m[3]), meant = namedRows(r, MONTH_NAMES.indexOf(m[1]));
    if (!meant.some(row => within(d.miles, row.cume, d.slack)) || !nearPercent(100 * (1 - j / d.miles), m[4])) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${fmt(j)} is ${(100 * (1 - j / d.miles)).toFixed(2)}% below ${d.stated}; vs ${rowsNote(meant)}`);
    }
  }
  // "<n> <MON> SGO crashes in them ≈ <x>M at the <rate>/M": n over the rate
  // is x, to x's precision, the stated figures taken as exact
  for (const m of r.rationale.matchAll(/\b(\d+) [A-Z]{3} SGO crashes in them ≈ (\d+(?:\.\d+)?)M at the (\d+(?:\.\d+)?)\/M\b/g)) {
    figureForms["a crash count at a rate"].push(`${r.helmer} ${r.month}`);
    const x = millions(m[2]), want = Number(m[1]) / Number(m[3]) * 1e6;
    if (!within(want, x.miles, x.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${m[1]} over ${m[3]} a million miles is ${milesOf(want)}`);
    }
  }
  // "the cumulative band's top carries ~<p>% upside and its floor ~<q>% read
  // noise": its cumulative band's top p% above its cumulative and its floor
  // q% below, each to one unit of its last digit (its "~")
  for (const m of r.rationale.matchAll(/\bthe cumulative band's top carries ~(\d+(?:\.\d+)?)% upside and its floor ~(\d+(?:\.\d+)?)% read noise\b/g)) {
    figureForms["a band's approximate shares"].push(`${r.helmer} ${r.month}`);
    const up = 100 * (r.kmax / r.cume - 1), down = 100 * (1 - r.kmin / r.cume);
    if (!nearPercent(up, m[1]) || !nearPercent(down, m[2])) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs its cumulative ${cumeAndBand(r)}: its top ${up.toFixed(2)}% above it, its floor ${down.toFixed(2)}% below`);
    }
  }
  // "(<a> a day with the x<k>) and the rest at <b> a day: <s>, rounded to
  // <v>": s the two rates times the row's days, to half a mile either way,
  // the rates taken as exact, and v its miles, s to v's precision (its last
  // nonzero digit)
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\b(\d{1,3}(?:,\d{3})*\.\d+) a day with the x\d+(?:\.\d+)?\) and the rest at (\d{1,3}(?:,\d{3})*\.\d+) a day: ${WHOLE}, rounded to ${WHOLE}`, "g"))) {
    figureForms["a month at its daily rates"].push(`${r.helmer} ${r.month}`);
    const [a, b] = [m[1], m[2]].map(t => Number(t.replace(/,/g, ""))), total = wholeMiles(m[3]).miles, v = roundedWhole(m[4]);
    const want = (a + b) * daysIn(r.month);
    if (!within(total, want, 0.5 + 1e-6) || r.vmt !== v.miles || !within(total, v.miles, v.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": (${m[1]} + ${m[2]}) x ${daysIn(r.month)} days is ${milesOf(want)}; its miles are ${fmt(r.vmt)}`);
    }
  }
}
// A quarter's split, in Waymo rows: "<A> <a>M[ and <B> <b>M] = the hub's
// measured Q<q> <...> increment[s] (<x>M[ / <y>M])" has the A terms of
// quarter q's three rows, of the row's year, summing to x (and the B terms to
// y), to the sum of their stated precisions, the row's month being in that
// quarter; a quarter not every month of which states it goes unchecked, as
// does a statement pairing its terms with a different number of totals.
// "<A> <a>M (hub Q<q> run-rate <r>M/mo" has r a third of the latest quarter
// q ending at or before the row's month: of the A terms its three rows list
// (termsOf), or of the A increment its split statements give, to r's
// precision plus a third of theirs; where neither is there, it goes
// unchecked.
const SPLIT = /\b([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M(?: and ([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M)? = the hub's measured Q([1-4]) [A-Za-z+ ]*?increments? \((\d+(?:\.\d+)?)M(?: \/ (\d+(?:\.\d+)?)M)?\)/g;
const splits = [];
for (const r of waymo) for (const m of r.rationale.matchAll(SPLIT)) {
  const labels = [m[1], m[3]].filter(x => x !== undefined), parts = [m[2], m[4]].filter(x => x !== undefined), totals = [m[6], m[7]].filter(x => x !== undefined);
  const quarter = quarterMonths(r.month.slice(0, 4), Number(m[5]));
  if (labels.length !== totals.length || !quarter.includes(r.month)) {
    unchecked["a quarter's split"].push(r.month);
    continue;
  }
  splits.push(...labels.map((label, i) => ({ r, quarter, label, part: millions(parts[i]), total: millions(totals[i]), text: m[0] })));
}
for (const s of splits) {
  const group = s.quarter.map(month => splits.find(x => x.label === s.label && x.r.month === month));
  if (group.includes(undefined)) {
    unchecked["a quarter's split"].push(s.r.month);
    continue;
  }
  figureForms["a quarter's split"].push(s.r.month);
  const sum = group.reduce((t, x) => t + x.part.miles, 0), slack = group.reduce((t, x) => t + x.part.slack, 0) + s.total.slack;
  if (!within(sum, s.total.miles, slack)) {
    figureErrors.push(`waymo ${s.r.month}: "${s.text}": the ${s.label} terms of ${s.quarter.join(", ")}, ${group.map(x => x.part.stated).join(" + ")}, sum to ${fmt(sum)}, vs ${s.total.stated} (their rounding allows ${fmt(slack)})`);
  }
}
const listedTerm = (month, label) => (termsOf.get(rowOf("waymo", month)) ?? []).find(t => t.label === label);
for (const r of waymo) for (const m of r.rationale.matchAll(/\b([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M \(hub Q([1-4]) run-rate (\d+(?:\.\d+)?)M\/mo\b/g)) {
  const months = latestQuarter(r.month, Number(m[3])), parts = months.map(month => listedTerm(month, m[1]));
  // each quarter total it may mean, with its slack: the listed terms' sum,
  // and each increment a split statement gives
  const totals = [parts].filter(p => !p.includes(undefined))
    .map(p => ({ what: `the ${m[1]} terms ${p.map(t => t.stated).join(" + ")}`, miles: p.reduce((t, x) => t + x.miles, 0), slack: p.reduce((t, x) => t + x.slack, 0) }))
    .concat(splits.filter(x => x.label === m[1] && x.quarter.join() === months.join()).map(x => ({ what: `the increment ${x.total.stated}`, miles: x.total.miles, slack: x.total.slack })));
  if (totals.length === 0) {
    unchecked["a quarter's run-rate"].push(r.month);
    continue;
  }
  figureForms["a quarter's run-rate"].push(r.month);
  const rate = millions(m[4]);
  if (!totals.some(t => within(rate.miles, t.miles / 3, rate.slack + t.slack / 3))) {
    figureErrors.push(`waymo ${r.month}: "${m[0]}" vs a third of ${months.join(", ")}'s ${[...new Set(totals.map(t => `${t.what}: ${milesOf(t.miles / 3)}`))].join("; ")}`);
  }
}
// "the <Month> row's terms at their per-day rates for <D> days", in a Waymo
// row: each term its list holds but CA's (whose clause states its own
// product) against the term of the same label that the named month's row
// lists (termsOf), read at its per-day rate for D days, T x D / its days. A
// term with no figure in a parenthesis after it is that. One whose
// parenthesis opens "<b>M at <Month>'s rate" has b that, and the term b plus
// the parenthesis' adjustments; one whose parenthesis opens "<Month>'s <b>M
// before its <...> deduction" has b the named month's figure before its
// deduction (that month's term's parenthesis opening "(<b>M less"), and the
// term b x D / its days plus the adjustments. The adjustments are each
// "plus about <x>M", "less about <x>M" and "and about <x>M" (the sign of the
// one before) in the parenthesis at its own depth. A parenthesis holding any
// other figure there, or naming another month, is one this does not read, so
// its term goes unchecked, as does a term with no term of its label in the
// named month. Each result to the term's precision, the stated figures taken
// as exact.
// Each base a term's parenthesis may open with, as the figure it gives the
// term (T being the named month's term of its label), whether that holds,
// and a note for the failure message, or undefined where it cannot be read
const PER_DAY_BASES = [
  // "(<b>M at <Month>'s rate": b, which is T at its per-day rate
  { re: new RegExp(String.raw`^\((\d+(?:\.\d+)?)M at ${MONTH_NAME}'s rate\b`), name: b => b[2],
    base: (b, before, perDay) => ({ miles: millions(b[1]).miles, holds: within(millions(b[1]).miles, perDay(before.miles), millions(b[1]).slack),
      note: `${b[1]}M, where ${before.stated} at its per-day rate is ${milesOf(perDay(before.miles))}` }) },
  // "(<Month>'s <b>M before its <...> deduction": b at its per-day rate, b
  // being the figure before T's deduction, the "<b>M less" in T's
  // parenthesis at its own depth (with none there b is unstated, so the term
  // goes unchecked)
  { re: new RegExp(String.raw`^\(${MONTH_NAME}'s (\d+(?:\.\d+)?)M before its [a-z ]+ deduction\b`), name: b => b[1],
    base: (b, before, perDay) => [...maskGroups((before.paren ?? "()").slice(1, -1)).matchAll(/(?<![\d.,])(\d+(?:\.\d+)?)M less\b/g)].slice(0, 1)
      .map(pre => ({ miles: perDay(millions(b[2]).miles), holds: Number(pre[1]) === Number(b[2]),
        note: `${b[2]}M at its per-day rate, ${milesOf(perDay(millions(b[2]).miles))}, where that month's term is ${before.stated} ${before.paren}` }))[0] },
];
const ADJUSTMENT = /(?:^|, | )(plus|less|and) about (\d+(?:\.\d+)?)M\b/g;
// The signed adjustments of a parenthesis, masked inside, after its base
// figure, or undefined where another figure stands at its depth or an "and"
// has no sign before it
const adjustmentsOf = inner => {
  const figs = [...inner.matchAll(FIGURE)].slice(1), adjs = [...inner.matchAll(ADJUSTMENT)];
  const signs = adjs.reduce((s, a) => [...s, ({ plus: 1, less: -1 })[a[1]] ?? s.at(-1)], []);
  const placed = figs.length === adjs.length && figs.every((f, i) => f.index === adjs[i].index + adjs[i][0].length - adjs[i][2].length - 1);
  return placed && !signs.includes(undefined) ? adjs.map((a, i) => signs[i] * millions(a[2]).miles) : undefined;
};
// What the named month's row x makes term t (before being x's term of t's
// label): the figure, whether its base holds, and a note; or undefined where
// t's parenthesis is one this does not read
const perDayWant = (t, before, x, days, name) => {
  const perDay = y => y * days / daysIn(x.month), inner = maskGroups((t.paren ?? "()").slice(1, -1));
  if ([...inner.matchAll(FIGURE)].length === 0) { // no figure in a parenthesis, so no adjustment
    return { want: perDay(before.miles), holds: true, note: `${before.stated} at its per-day rate` };
  }
  const read = PER_DAY_BASES.map(b => ({ b, m: b.re.exec(t.paren) })).find(({ b, m }) => m !== null && b.name(m) === name);
  const adjustments = adjustmentsOf(inner), base = read === undefined ? undefined : read.b.base(read.m, before, perDay);
  if (base === undefined || adjustments === undefined) return undefined;
  return { want: base.miles + adjustments.reduce((sum, a) => sum + a, 0), holds: base.holds,
    note: `${base.note}, adjusted by ${adjustments.map(a => milesOf(a)).join(", ")}` };
};
for (const r of waymo) for (const m of r.rationale.matchAll(new RegExp(String.raw`\bthe ${MONTH_NAME} row's terms at their per-day rates for (\d+) days\b`, "g"))) {
  if (!termsOf.has(r)) { // its own list unread
    unchecked["a month at another's per-day rates"].push(r.month);
    continue;
  }
  const days = Number(m[2]), named = namedMonths(r.month, MONTH_NAMES.indexOf(m[1])).map(month => rowOf("waymo", month)).filter(x => termsOf.has(x));
  for (const t of termsOf.get(r).filter(u => u.label !== "CA")) {
    const wants = named.map(x => ({ x, before: termsOf.get(x).find(u => u.label === t.label) })).filter(w => w.before !== undefined)
      .map(w => ({ x: w.x, ...perDayWant(t, w.before, w.x, days, m[1]) })).filter(w => w.want !== undefined);
    if (wants.length === 0) {
      unchecked["a month at another's per-day rates"].push(`${r.month} ${t.label}`);
      continue;
    }
    figureForms["a month at another's per-day rates"].push(`${r.month} ${t.label}`);
    if (!wants.some(w => w.holds && within(t.miles, w.want, t.slack))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": its ${t.label} term, ${t.stated}, vs ${wants.map(w => `${w.x.month}'s: ${w.note}, ${milesOf(w.want)}${w.holds ? "" : " (its base does not hold)"}`).join(" or ")}`);
    }
  }
}

// (3b) The pre-series offset as Waymo rationales state it: the rider-only
// miles Waymo drove before the series starts, which every lifetime figure
// includes, data/waymo_vmt.py's OFFSET (central, low, high). Each stated
// figure equals it, whole miles exactly and millions to their stated
// precision, wherever its form appears; no form is required, so a figure
// reworded out of its form goes unchecked, as in (3a). From 2026-11-03 until
// the human's answer later that day each form had to be found at least once
// and every "pre-series" in a Waymo rationale had to lie in a form's match;
// asked whether to drop those two requirements, the human asked "is there an
// unambiguous common-sense answer to this?", and the answer given (yes: under
// the human's rule of that day, both are checks a rewording of text the human
// might edit turns red) is the decision. Until 2026-11-03 this check
// looked instead for milestones listed as "(...) are exact centrals minus
// ~0.15M" and held each to the month's cumulative plus 150,000, the offset's
// central until 2026-11-02; no rationale had used that wording since
// 2026-10-31, so it checked nothing (open question 35(a)).
const OFFSET_FORMS = [
  // data/waymo_vmt.py's EARLY_NOTE, July 2021-January 2023: "the miles
  // driven before it, <central> (range <low>-<high>)" in whole miles, "it"
  // being the series (since 2026-11-04 read only after "miles driven before
  // it, "; header)
  { form: "builder", re: /\bmiles driven before it, (\d{1,3}(?:,\d{3})+) \(range (\d{1,3}(?:,\d{3})+)-(\d{1,3}(?:,\d{3})+)\)/g,
    figures: m => [["central", wholeMiles(m[1])], ["low", wholeMiles(m[2])], ["high", wholeMiles(m[3])]] },
  // April-June 2026, the June anchor's central: "less the <x>M pre-series miles"
  { form: "central in millions", re: /(\d+(?:\.\d+)?)M pre-series miles\b/g,
    figures: m => [["central", millions(m[1])]] },
  // June 2026, its cumulative band: "less the pre-series miles' range, <low>M-<high>M"
  { form: "range in millions", re: /pre-series miles' range, (\d+(?:\.\d+)?)M-(\d+(?:\.\d+)?)M/g,
    figures: m => [["low", millions(m[1])], ["high", millions(m[2])]] },
];
const offsetErrors = [], offsetForms = Object.fromEntries(OFFSET_FORMS.map(f => [f.form, []]));
for (const r of rows.filter(x => x.helmer === "waymo")) {
  for (const { form, re, figures } of OFFSET_FORMS) {
    for (const m of r.rationale.matchAll(re)) {
      offsetForms[form].push(r.month);
      for (const [field, f] of figures(m)) {
        if (!(Math.abs(f.miles - OFFSET[field]) <= f.slack)) {
          offsetErrors.push(`${r.month}: the ${form} form's ${field} "${f.stated}" in "${m[0]}", where OFFSET's ${field} is ${fmt(OFFSET[field])}`);
        }
      }
    }
  }
}

// (4) the audit's specific corrections
const FACTS = [
  // #76: a band note runs into the next sentence without a stop
  [r => /±\d+% [A-Z]/.test(r.rationale), "a band note joined to the next sentence ('±25% Re-chained')"],
  // #39: Waymo's 'more than 4,000 vehicles' (TechCrunch, Sep 1) is a fleet figure measured after June
  [r => /fleet figure measured after Jun 2026/.test(r.rationale), "claims no post-June Waymo fleet figure exists"],
  // #77: Q2-2026's monthly estimates ran ~1.4-2.9x high; 28% is the end-Q2 cumulative
  [r => /~28% high for Q2/.test(r.rationale), "states Q2's miss as the cumulative's 28%"],
  // #79: the Oct-Dec 2025 bridge was x1.0653 before the 2026-08-28 move
  [r => /x1\.0688/.test(r.rationale), "gives x1.0688 as the prior bridge factor"],
  // #80, restated 2026-10-27: until at least Oct 4, 2026 01:54 UTC the hub
  // did not link Waymo's corrected CSV4 v2, and this fact required saying
  // so. Waymo's release notes dated Oct 2 (uploaded Oct 5) say the corrected
  // CSV3 and CSV4 "should replace the files released on September 24", and
  // the hub has linked CSV4 v2 (not CSV3 v2) since between Oct 4 and Oct 6
  // UTC.
  [r => /CSV4 v2/.test(r.rationale) && /not yet linked/.test(r.rationale), "says Waymo's corrected CSV4 v2 is not yet linked (the hub has linked it since Oct 4-6, 2026)"],
  // 2026-10-27 sweep: NHTSA's notice FR 2026-15485 grants Zoox's FMVSS
  // exemption "Issued on July 28, 2026", effective Jul 31 (13 rationales
  // had Jul 30)
  [r => r.helmer === "zoox" && /granted Jul 30|exemption Jul 30/.test(r.rationale),
    "dates Zoox's FMVSS exemption grant Jul 30, 2026 (FR 2026-15485: issued Jul 28, effective Jul 31)"],
  // 2026-10-27 sweep: Waymo admitted Denver, San Diego and Tampa riders by
  // invitation from Sep 1 and Las Vegas riders gradually from Sep 14 (Waymo
  // Help Center); San Diego and Tampa opened to anyone on Oct 14, Denver and
  // Las Vegas are still invite-gated
  [r => r.helmer === "waymo" && /(Denver|Las Vegas)[^;)]{0,40}public from Sep/.test(r.rationale),
    "calls Waymo's Denver/San Diego/Tampa or Las Vegas service public from September (riders were admitted by invitation; anyone only from Oct 14 in San Diego and Tampa)"],
  // Audit 2026-10-30 (added 2026-10-31). VMT-7: Alphabet's Q3 remarks (Oct
  // 28, 2026) gave "more than 300 million fully autonomous miles", a
  // Waymo total-miles floor stated after June, so the call is no longer a
  // coming anchor and "no figure exists" no longer holds
  [r => r.helmer === "waymo" && /Next anchors: Alphabet/.test(r.rationale),
    "lists Alphabet's Oct 28, 2026 call as a coming anchor"],
  [r => r.helmer === "waymo" && /No Waymo total-miles figure measured after Jun 2026 exists/.test(r.rationale),
    "says no Waymo total-miles figure after June 2026 exists (Alphabet's Oct 28 remarks gave a floor)"],
  // Review of the VMT package (2026-10-31): Alphabet's Oct 28 floor is not
  // the only Waymo total-distance figure stated after June 2026, nor the only
  // one for a date after June. The hub's 271.329M (Sep 24) is for June 30,
  // and Waymo stated current floors in kilometres: "more than 300 million
  // fully autonomous kilometres" (https://waymo.com/blog/2026/09/waymo-in-singapore,
  // Sep 17, 2026) and "over 450 million fully autonomous kilometres"
  // (https://waymo.com/waymo-in-canada/, with its Oct 16, 2026 Toronto note).
  // The Oct 28 figure is the highest and the newest.
  [r => r.helmer === "waymo" && /only Waymo total-(miles|distance) figure/.test(r.rationale),
    "calls Alphabet's Oct 28 floor the only Waymo total-distance figure after June 2026 (the hub stated 271.329M for June on Sep 24; Waymo's Sep 17 and Oct 16 pages state kilometre floors)"],
  // VMT-3: Waymo's 2023-2024 rows did not follow California's monthly miles
  [r => r.helmer === "waymo" && /scaled to US/.test(r.rationale),
    "describes Waymo rows as California miles scaled to the US"],
  // VMT-4: the inner combination of the October projection is geometric
  [r => r.helmer === "teslanomonitor" && /the mean of holding the last week flat/.test(r.rationale),
    "calls the October projection's flat/continued-growth combination 'the mean' (it is geometric)"],
  // VMT-5: the October no-monitor band's page/deck term is 0.066, 1.96 x the
  // rms log gap over Apr-Sep, not September's 4.8%
  [r => r.helmer === "teslanomonitor" && /plus the 4\.8% gap/.test(r.rationale),
    "names September's 4.8% page/deck gap as the October band's term"],
  // #12 (2026-10-04 audit): Levinson's "just last week" (Fortune, Dec 8, 2025)
  // dates Zoox's 1M-mile crossing to Dec 1-7, not about Nov 22
  [r => r.helmer === "zoox" && /Nov 22/.test(r.rationale),
    "dates Zoox's 1M-mile crossing to about Nov 22 (Fortune, Dec 8, 2025: during Dec 1-7)"],
  // Second review of the VMT package (2026-10-31): the Third Amended SGO
  // (dated Apr 24, 2025,
  // https://www.nhtsa.gov/sites/nhtsa.gov/files/2025-04/third-amended-SGO-2021-01_2025.pdf)
  // lists "Vehicle tow-away, if the crash involved a subject vehicle equipped
  // with an ADS" (Request No. 1.D.v), and p. 13 counts "a tow-away of or air
  // bag deployment on any vehicle involved in the crash": the towed vehicle
  // need not be the one with the ADS
  [r => /tow-?away of (?:a vehicle equipped with an ADS|an ADS-equipped vehicle)/.test(r.rationale),
    "says the SGO's tow-away trigger needs the towed vehicle to carry an ADS (Request No. 1.D: any vehicle's tow-away, 'if the crash involved a subject vehicle equipped with an ADS')"],
  // Review of the VMT package (2026-10-31): since the 1M-crossing reshape
  // (decision #12 of the 2026-10-04 audit) the Dec-2025 Zoox knot narrows
  // back one month's cumulative band, November 2025's; October's and every
  // earlier month's forward chain already lies inside the knot's backward
  // chain, so a plural "earlier months'" is true only if the rows narrow two
  [r => r.helmer === "zoox" && r.month === "2025-12" && /earlier months' (?:bands? )?(?:are )?narrow(?:ed)? back/.test(r.rationale)
    && narrowedBefore("zoox", "2025-12").length < 2,
    `says the Dec-2025 knot narrows back earlier months' bands (the rows narrow ${JSON.stringify(narrowedBefore("zoox", "2025-12"))} only)`],
];

const factErrors = [];
for (const r of rows) for (const [bad, what] of FACTS) if (bad(r)) factErrors.push(`${r.helmer} ${r.month}: ${what}`);
const problems = {
  anchorRule: ruleProblems,
  linkRule: linkRuleProblems,
  linksNamingNoSection: [...new Set(badLinks)],
  internalShorthand: jargon,
  figuresNotTheRows: [...new Set(figureErrors)],
  preSeriesOffsetNotOffset: offsetErrors,
  correctedFactsRecur: factErrors,
};
const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0));
assert.deepEqual(failing, {},
  `Replicata: read every data/vmt.csv rationale (shown as written, its links as links, in the page's VMT sources table) and check (1) links to sections of data/README.md, (2) internal shorthand, (3) stated figures against the rows (and CPUC's miles in data/waymo-ca.csv), and the stated pre-series offset against data/waymo_vmt.py's OFFSET, (4) the audit's corrected facts.
Expectata: (1) each link (any "[<text>](<target>)") has a text other than blanks and the target data/#<anchor>, <anchor> the id GitHub Pages gives one of data/README.md's headings (${ANCHORS.join(", ")}) and of the form the page reads (lowercase letters, digits and hyphens), and no "](" or target "data/#" stands outside a link but inside a longer path or address; on synthetic files the heading reader gives GitHub Pages' ids, and stops with its message on each form it stops on; on synthetic links each wrong form is named; (2) no kyoom, vmt_min/vmt_max, TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best" or "D/H"; (3) each figure stated in one of the forms that follow passes its form's test and is checked where its wording appears, none of these forms being required (a statement reworded out of its form goes unchecked, the human's rule of 2026-11-03), and a figure passes where it is right under any meaning its form's words could have (a month named without its year is the month of that name within 11 months either way of the row's, in the row's line or, for a Tesla line, either Tesla line). The tests: a value to its stated precision, whole miles exactly and a whole number that may be rounded to its last nonzero digit; CPUC's miles and a band's clipped edges to half a mile either way; a floor and a day's lifetime with one mile's slack; a figure marked "~" to one unit of its last digit; and in products, sums, rates and per-day scalings the stated figures taken as exact. The forms: each "<x>k" or "<x>M" "end-[<Mon>-]<YYYY>" is a line's series cumulative or lifetime for that month or, in a Waymo row, the hub's figure an anchor gives (where no anchor gives it, a figure at most the lifetime goes unchecked); each Waymo anchor ("The <Mon>-<YYYY> cumulative lands on the anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles") is that month's cumulative, h + e - o; each Waymo band after an anchor in its rationale ("its cumulative band is the hub total plus <a>M to <b>M ..., less the pre-series miles' range, <l>M-<u>M") that month's cumulative band; each Waymo "update: <h>M rider-only miles thru <Mon>-<YYYY>" the hub figure every anchor for that month uses, where one exists; each Waymo "<n> in <YYYY>" of "by calendar year (...)" that year's summed months, for each year whose January the series holds; each Waymo "first million rider-only miles on <Mon> <D>, <YYYY>" the day the lifetime (the cumulative plus OFFSET's central, the month's miles spread evenly) reaches 1,000,000; each Waymo "floor the series clears, ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon> <D>, <YYYY>)" with N million no more than the lifetime at the end of that day; each Waymo "Total <x>M, about <y>k a day (...)" whose parenthesis holds "<Monthname>'s row <digit>" its miles and its miles over its days, and in that parenthesis each "<Monthname>'s row <z>k" that month's miles over its days and each "measured Q<n> <w>k" those of the latest quarter n ending at or before the row's month; each Waymo "Cross-check: <x>M/mo ≈ <y>M/wk" a pair that agrees for the row's month, and with " vs Waymo's" after it its miles and its miles times 7 over its days; each Waymo "Band x<lo> to x<hi>" followed in its sentence by "the components' ranges combined" its row's band over its miles; each Waymo list of terms (the sentence "CA = ..." or "CA <digit>..." opens, naming Maricopa, Travis, Atlanta and metros) its row's miles, every term it holds summed, where each figure in it is CA's term or a labelled term (otherwise it goes unchecked); each Waymo "CPUC Q<n>-<YYYY> driverless actual <d> deployment + <p> pilot (...) x <f>, ... = <r>M" with (d + p) x f equal to r, and d and p one month's of that quarter in data/waymo-ca.csv (a base that is none of the months the file holds, the file lacking one of the quarter's, goes unchecked); each "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[ [<range>]] = <r>M", b the figure right before " x", with b x f equal to r, f a decimal or a ratio a/b; each "<Month> keeps ...end-of-month <c>[ (...)], its band <lo>-<hi>" that month's cumulative and cumulative band; each of the three readings of "end-<Month> <a> / <b> / <c>" inside that month's cumulative band where a later "<Month> keeps ..., its band <lo>-<hi> holding the three readings" says the band holds them; each "<Month>'s cumulative is that reading, <c>" or "is the chart's ~<c>" its cumulative, "..., its band from the call's <f> to <p>% above it" its band's floor f and its top p% above c, to the whole percent, and "..., its floor <f>" its band's floor; each "<Month>'s miles are at least <n>" with its miles at least n, and "..., puts them there (<v> with" its miles v; each "<Month>'s cumulative band, <lo> to <hi>" its cumulative band and each "End-<Month> cumulative floor <f>" its band's floor; in each row, "Each month is its cumulative less the month before's, its band the difference of their bands" its miles and band from its line's row before (from zero for a line's first), "a month's band is <a>x-<b>x its miles, within the difference of its cumulative band and the month before's" its band a and b times its miles, each edge held inside the difference of the two cumulative bands, "the cumulative is ...: <x>M less the <o> pre-series miles, <c>" its cumulative c with x less o equal to c, "Its band, <lo> to <hi>, is that statement's range" and a sentence's opening "Cumulative band <lo> to <hi>:" its cumulative band, a sentence's opening "Central <c>." its miles, and "The cumulative band's floor through <Mon> <D>, <f>, is the end-<Month> floor (<j>: ...) plus the <Month> and <Month> floors" with D the last day of <Mon>'s month, f that month's cumulative floor, j the end-<Month> one and j plus the two months' floors f; in a Tesla line's row, each "<Month>: <p> on the page" or "<Month>'s no-monitor miles are <p> on the page" the no-monitor line's miles that month, and after it each "floor <f>", "the central, <c>" and "the top, <t>" that month's floor, central and top, each "the central, <c>, adds <Month>'s <r> monitor-aboard remainder" with c a reading (the page's or the deck's) or the no-monitor line's miles plus r, and each "the top, <t>, ... (the higher reading x <f>)" with t the higher reading times f; each "<r> monitor-aboard miles, <Month>'s measured remainder (the Q<q> deck's <a> paid miles less the page's <b> no-monitor miles)" with a and b Tesla's and the no-monitor line's miles that month and r a less b, each "<Month>'s <r> monitor-aboard remainder" with r their difference, and each "monitor-aboard share [stayed ]at or below <Month>'s <p>%" with p their difference over Tesla's miles (with no row for the month on both lines these go unchecked); each "no-monitor miles for the month as projected on the no-monitor line, <c> [<lo>, <hi>] (...), set the floor" the no-monitor line's miles and band that month, and lo the row's floor; each "crosses <x>M at the start of <Mon> <D>" (or "on") a day the lifetime reaches x and each "stands at <x>M on <Mon> <D>" the lifetime at the end of that day, the lifetime adding the line's pre-series miles (Waymo's OFFSET range, Zoox's as its row's rationale states them, with none stated unchecked), and each "the <o> driverless miles before it come off <Name>'s ~<x>M-mile figure for <Mon> <D>, <YYYY>" with the cumulative that day plus o x; each "a floor on the end-<Month> cumulative that only the <deck> deck's reading meets" with that deck's reading the one of the month's three readings (in the order "in its <deck> (...), <deck> and <deck> (...) update decks" lists them) at or above its cumulative floor; each "<Month>'s cumulative is the chart's ~<c>, its floor <f> (the lowest reading less ~<q>% read noise)" with f q% below the month's lowest reading, each "the end-<Month> floor (<j>: the deck's <d>M less ~<q>% read noise)" with d that month's cumulative and j q% below d, and each "the cumulative band's top carries ~<p>% upside and its floor ~<q>% read noise" with its cumulative band's top p% above its cumulative and its floor q% below; each "<n> <MON> SGO crashes in them ≈ <x>M at the <rate>/M" with n over the rate x; each "(<a> a day with the x<k>) and the rest at <b> a day: <s>, rounded to <v>" with s the two rates times the row's days and v its miles; each Waymo "<A> <a>M[ and <B> <b>M] = the hub's measured Q<q> ... increment[s] (<x>M[ / <y>M])" with the quarter's three A terms summing to x (and B's to y); each Waymo "<A> <a>M (hub Q<q> run-rate <r>M/mo" with r a third of the latest quarter q's A total, its listed terms' or its split's; and each Waymo "the <Month> row's terms at their per-day rates for <D> days" with each term but CA's that month's term of its label at its per-day rate for D days, plus the adjustments its parenthesis states ("<b>M at <Month>'s rate" or "<Month>'s <b>M before its ... deduction", then "plus about", "less about" and "and about"); every figure a Waymo rationale states for the pre-series offset (the builder's "miles driven before it, <central> (range <low>-<high>)", "<x>M pre-series miles", "pre-series miles' range, <low>M-<high>M") equals OFFSET, central ${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)}, whole miles exactly and millions to their stated precision; (4) none of the corrected statements recurs.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: ${rows.length} VMT rationales link only to sections of data/README.md (${links} links, to the ids of its ${README_IDS.length} headings), use no internal shorthand, and state figures that pass their form's test (the rows' values; sums, products, shares and rates that hold; readings inside the rows' bands; floors the rows meet; approximate figures within a unit of their last digit; and CPUC miles that data/waymo-ca.csv holds) in every form read here (${Object.entries(figureForms).map(([f, found]) => `${found.length} ${f}`).join(", ")}; found with nothing to read them against, so unchecked: ${Object.entries(unchecked).map(([f, found]) => `${found.length} ${f}`).join(", ")}); ${Object.values(offsetForms).flat().length} Waymo statements of the pre-series offset, in ${OFFSET_FORMS.length} forms, give data/waymo_vmt.py's OFFSET (${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)})`);

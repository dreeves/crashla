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
//       form's test against the rows: a cumulative, a cumulative band or its
//       floor, a calendar year's miles, a milestone day, a row's miles (alone
//       or as the sum of the terms it lists), its band, its daily or weekly
//       rate or its band's multipliers, and a named month's or quarter's daily
//       rate are the rows' values to their stated precision; a hub figure
//       there is the one the anchors for its month use; a product written
//       "<b> x <f> = <r>" holds, r to its precision, and the CPUC miles one
//       starts from are data/waymo-ca.csv's; and a floor (a public one the
//       series clears, or one set on a month's miles) is one the rows meet.
//       The forms read Waymo's rationales, but for these, which read every
//       line's: the end-of-month form, a product, and the forms that name a
//       month or state a row's own cumulative, band or floor (Tesla's and
//       Zoox's today). Since 2026-11-04 they include the terms, products, CPUC
//       miles and Tesla and Zoox figures the fourth fix run's reviews listed,
//       and the band edges and floors (3c) required until 2026-11-03 (below),
//       each read where found. These figures are checked where their wording
//       appears and no (3a) form is required, so a statement reworded out of
//       its form goes unchecked: no qual may enforce the wording of text the
//       human might edit (the human's rule of 2026-11-03). Earlier on
//       2026-11-03 six of the seven forms (3a) then read each had to be
//       found at least once, which turned the qual red on a rewording alone;
//       before that (3a) read one form, a Waymo "<x>M end-<Mon>-<YYYY>",
//       which no Waymo rationale had used since 2026-10-31, and which now
//       reads every line. That form, "end of a month or year", reads each
//       line's series cumulative, which leaves out the line's pre-series
//       miles, its rider-only (Waymo) or driverless (Zoox) miles driven
//       before its series starts (Waymo's, OFFSET below; Zoox's 40,080; the
//       Tesla lines have no such offset), so a Waymo or Zoox lifetime figure
//       written in that form fails whenever its last stated digit stands for
//       fewer miles than those, and can fail when it stands for more (no
//       rationale states one today). Every figure a Waymo rationale states
//       for the pre-series offset (the builder's "miles driven before it,
//       <central> (range <low>-<high>)", the Apr-Jun 2026 rows' "<x>M
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
// 4.8% gap". And a frame of (3a) or (3b) takes any figure set in its words
// for the figure it names, so a correct figure that means something else can
// fail there. Since 2026-11-04 three frames read only beside the words that
// say whose figure they state, so such a figure goes unread: the builder's
// offset follows "miles driven before it, " (until then any Waymo "<central>
// (range <low>-<high>)" was read as the offset, so a component's "3,245,248
// (range 3,100,000-3,400,000)" failed); a Waymo row's "Total <x>M, about <y>k
// a day" has the parenthesis after it that sets its rate beside a row's,
// "<Monthname>'s row" (until then any was read as the row's, so a
// component's "Total 1.40M, about 47k a day" failed, and a "measured Q<n>"
// in a parenthesis after it was read as the row's quarter); and a Waymo
// "Band x<lo> to x<hi>" is in a sentence that gives it as "the components'
// ranges combined" (until then any was read as the row's band, so a
// component's band failed). The other frames still read such figures. The
// end-of-month form is left as it was because the statements it reads today
// (Tesla's "658k end-2025, 1.717M end-Mar-2026") carry no words that say
// whose figure they state: it reads "271.329M end-Jun-2026" written for the
// hub figure as the series cumulative, and a lifetime as item (3) above
// says. The hub figure's frame reads a county's "92.121M rider-only miles
// thru Jun-2026" as the hub's, and "Cross-check: <x>M/mo ≈ <y>M/wk" reads a
// component's monthly and weekly miles as the row's. A frame that names a
// month reads it as that month of the row's year in the row's line, so a
// January row's "December's cumulative band" would be read as the December
// after it, and another line's figure as the row's line's. A June row's
// "CPUC Q2-2026 driverless actual ..." quoting May's miles would be checked
// against June's in data/waymo-ca.csv. Relaxing any of them is the human's
// call (rule 5).

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
// appears; a frame also reads a figure of another meaning set in its words
// (header). No form is required: a statement reworded out of its frame goes
// unchecked rather than failing, since no qual may enforce the wording of
// text the human might edit (the human's rule of 2026-11-03), and the pass
// line counts each form's checked statements, so a form gone idle shows.
// Earlier on 2026-11-03 six of the first seven forms each had to be found at
// least once, which turned the qual red on a rewording alone with every
// figure right ("thru" made "through" and "lands on the anchor: the hub's"
// made "lands on the anchor, the hub's" gave three problems). Before that
// this read one form, a Waymo "<x>M end-<Mon>-<YYYY>", which no Waymo
// rationale had used since 2026-10-31, so it checked nothing; that form now
// reads every line's rationales (Tesla's deck rows give "658k end-2025,
// 1.717M end-Mar-2026").
//   end of a month or year (every line): "<x>k" or "<x>M" then "end-<Mon>-<YYYY>"
//     or "end-<YYYY>" is that month's (for a year, December's) series
//     cumulative, which leaves out the line's pre-series miles (header, (3));
//   Waymo's anchor: in a Waymo row, "The <Mon>-<YYYY> cumulative lands on the
//     anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles" is
//     that month's cumulative, h + e - o (the April-June 2026 rows);
//   its band: in a Waymo row, "its cumulative band is the hub total plus <a>M
//     to <b>M ..., less the pre-series miles' range, <l>M-<u>M", after an
//     anchor in the same rationale, is that month's cumulative band, h + a - u
//     to h + b - l (June's row); with no anchor before it in its rationale its
//     hub total is unstated, so it goes unchecked (the pass line counts it
//     so);
//   the hub's figure: in a Waymo row, "<h>M rider-only miles thru
//     <Mon>-<YYYY>" is the hub figure every anchor for that month uses (the
//     April-June 2026 rows); with no anchor for that month in any rationale it
//     goes unchecked (the pass line counts it so);
//   calendar years: in a Waymo row, each "<n> in <YYYY>" inside "by calendar
//     year (...)" is that year's miles, its months summed, for each year whose
//     January the series holds (2021's total includes January-June 2021,
//     before the series starts, which only the pre-series offset holds; the
//     builder's July 2021-January 2023 rows);
//   a milestone day: in a Waymo row, "first million rider-only miles on <Mon>
//     <D>, <YYYY>": the lifetime (the cumulative plus OFFSET's central, the
//     month's miles spread evenly over its days) reaches 1,000,000 during that
//     day, to a mile (the same rows);
//   a floor the series clears: in a Waymo row, "floor the series clears,
//     ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon>
//     <D>, <YYYY>)", with no stop, semicolon or quote in the "...": the
//     lifetime at the end of that day, reckoned as for the milestone day, is
//     at least N million, to a mile (a floor, so no rounding slack), the
//     day's month being any month data/vmt.csv has a row for, a ghost month
//     included (the July-September 2026 rows, for Alphabet's Oct 28, 2026
//     remarks; October's ghost row gives the same floor with its date before
//     the quote and no year, which this does not read). The frame starts at
//     "floor the series clears" because a rationale may also quote a floor
//     the series does not clear, to say so;
//   a Waymo row's total and daily rate: "Total <x>M, about <y>k a day (...)",
//     with "<Monthname>'s row" in the parenthesis, is its miles and its miles
//     over its days (October 2026's ghost row: "Total 22.25M, about 718k a day
//     (September's row 714k; measured Q2 608k)"). The total is read only
//     beside the row's daily rate, since "Total" can begin any total, the
//     hub's or a component's (until a further review later on 2026-11-03 any
//     "Total <x>M" in a Waymo row was read as its miles, which fails a correct
//     "Total 271.329M rider-only miles thru Jun-2026"), and since 2026-11-04
//     only with that parenthesis, whose comparison with another row's rate
//     makes it the row's (until then a component's "Total 1.40M, about 47k a
//     day" failed as the row's); and the frame starts at the total so that no
//     component's daily rate, and no month's miles in thousands (as Waymo's
//     early months are), is read as a row's. In that parenthesis each
//     "<Monthname>'s row <z>k" is the miles over the days of the latest month
//     of that name at or before the row's, and each "measured Q<n> <w>k" the
//     miles over the days of the latest quarter n ending at or before the
//     row's month. The parenthesis sets the row's rate beside rates already
//     measured, so a January row's "measured Q3" is the year before's (until a
//     review later on 2026-11-03 the quarter was read in the row's own year,
//     which fails that correct figure); a month or quarter ending after the
//     row's month, which no rationale cites there today, would be read as
//     the year before's too;
//   a month and its week: "Cross-check: <x>M/mo ≈ <y>M/wk" in a Waymo row is
//     its miles and its miles times 7 over its days (September 2026's row,
//     against Waymo's weekly floor; the rationales give components' monthly
//     rates as "<x>M/mo" too, so the frame starts at "Cross-check:");
//   band multipliers: a Waymo row's "Band x<lo> to x<hi>", in a sentence that
//     gives it as "the components' ranges combined", is its band over its
//     miles (October 2026's ghost row; until 2026-11-04 any such band was
//     read, so a component's failed as the row's);
//   a Waymo row's terms (since 2026-11-04, as all the forms below): the
//     terms it lists, "CA ... = <c>M; Maricopa <m>M, Travis <t>M ...; Atlanta
//     <a>M ...; + rider-only metros the hub does not count (...) <u>M" or
//     "... uncounted metros <u>M", and October's "; and about <x>M for ...",
//     sum to its miles, to the sum of the terms' stated precision (each
//     within half a unit of its last digit); CA's term is the last "= <c>M"
//     of its clause, and a figure inside a parenthesis or bracket is no term
//     (the April-October 2026 rows);
//   a CPUC product: in a Waymo row, "CPUC Q<n>-<YYYY> driverless actual <d>
//     deployment + <p> pilot (...) x <f>, ... = <r>M" has (d + p) x f equal
//     to r, to r's precision, the stated figures taken as exact; and where
//     the row's month lies in that quarter and data/waymo-ca.csv holds it, d
//     and p are that month's deployment and pilot miles there, to a mile
//     (the April-June 2026 rows; with no such row in that file, or another
//     quarter, the base goes unchecked, and the pass line counts it so);
//   a product: in any row, "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[
//     [<range>]] = <r>M", f a decimal or a ratio a/b, has b x f equal to r,
//     to r's precision, the stated figures taken as exact; the result can be
//     the next product's base (the July-October 2026 Waymo rows' CA terms;
//     October's "10.4M CPUC-basis x 31/30 = 10.75M x the hub-vs-CPUC CA
//     ratio 1.0576 = 11.37M" is two);
//   a month by its name, in any row, read as that month of the row's year in
//     the row's line, whole miles exactly: "<Month> keeps <source>'s
//     end-of-month <c>[ (...)], its band <lo>-<hi>" is its cumulative and
//     cumulative band; each reading of "end-<Month> <a> / <b> / <c>", where
//     "<Month> keeps ..., its band <lo>-<hi> holding the three readings"
//     follows, lies inside that band; "<Month>'s cumulative is that reading,
//     <c>" or "... is the chart's ~<c>" is its cumulative (the "~" marks the
//     chart's reading approximate, not the cumulative, which is that figure);
//     "<Month>'s cumulative is that reading, <c>, its band from the call's
//     <f> to <p>% above it" has its band's floor f and its top p% above c,
//     to the whole percent; "<Month>'s cumulative is the chart's ~<c>, its
//     floor <f>" its band's floor f (Tesla's June-August 2025 rows);
//     "<Month>'s miles are at least <n>" has its miles at least n, and
//     "..., puts them there (<v> with" its miles v (Zoox's December 2025
//     row); "<Month>'s cumulative band, <lo> to <hi>" is its cumulative band
//     (Zoox's June-November 2025 rows); "End-<Month> cumulative floor <f>"
//     is its band's floor (Zoox's April-September 2026 rows);
//   a row's own figures, in any row: "Each month is its cumulative less the
//     month before's, its band the difference of their bands" has its miles
//     its cumulative less the row before's, and its band's edges its band's
//     floor less the row before's top and its top less the row before's floor,
//     the row before being its line's previous row in the file (consecutive
//     months, vmt-ledger.qual), from zero for a line's first (Tesla's
//     June-August 2025 rows); "a month's band is <a>x-<b>x its miles, within
//     the difference of its cumulative band and the month before's" has its
//     band a and b times its miles, each edge held inside the difference of
//     the two cumulative bands (its floor less the row before's top to its top
//     less the row before's floor), to a mile (Tesla's September 2025-March
//     2026 rows); "the cumulative is ...: <x>M less the <o> pre-series miles,
//     <c>" has its cumulative c, and x less o equal to c to x's precision, and
//     "Its band, <lo> to <hi>, is that statement's range" its cumulative band
//     (Zoox's December 2025 row); "Cumulative band <lo> to <hi>:" opening a
//     sentence is its cumulative band (Zoox's March 2026 row); and "The
//     cumulative band's floor through <Mon> <D>, <f>, is the end-<Month> floor
//     (<j>: ...) plus the <Month> and <Month> floors" has D the last day of
//     <Mon> (of the row's year), f that month's cumulative floor, j the
//     end-<Month> one, and j plus those two months' own floors f (Tesla's
//     August 2026 row).
const figureErrors = [];
const figureForms = Object.fromEntries(["end of a month or year", "Waymo anchor", "Waymo anchor band", "hub figure",
  "calendar year", "milestone day", "floor the series clears", "Waymo total and daily rate",
  "a month's daily rate", "a quarter's daily rate", "a month and its week", "band multipliers",
  "Waymo terms", "CPUC product", "CPUC base", "product", "a month's cumulative and band", "a band holding readings",
  "a month's cumulative", "a cumulative's floor and top", "a cumulative's floor", "a month as a difference",
  "a band within a difference", "a cumulative less pre-series miles", "a band from a statement's range",
  "a month's miles at least", "a month's miles as put", "a month's cumulative band", "a row's cumulative band",
  "an end-of-month floor", "a floor through a month's end"].map(f => [f, []]));
// statements found in their frames but with nothing to read them against: no
// anchor sentence, or (CPUC base) no data/waymo-ca.csv row for the row's
// month, or a quarter that is not the row's
const unchecked = { "Waymo anchor band": [], "hub figure": [], "CPUC base": [] };
const UNIT = { k: thousands, M: millions };
const within = (stated, actual, slack) => Math.abs(stated - actual) <= slack;
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const waymo = rows.filter(x => x.helmer === "waymo");
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
// A Waymo lifetime at the end of day d of a row's month: the cumulative
// through the month before, plus the month's miles spread evenly over its
// days, plus OFFSET's central, the miles before the series starts.
const lifetimeAt = (row, d) => row.cume - row.vmt + row.vmt * d / daysIn(row.month) + OFFSET.central;
const milesOf = x => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
// Frame tokens (since 2026-11-04): a parenthesis, nested up to three deep, or
// a bracket, stepped over whole, so a figure inside one is never read as the
// frame's and a frame stops at a parenthesis it cannot close; a clause's text
// at depth 0, anything but a semicolon; a whole number of miles as written,
// with thousands commas, never part of a longer number; and a month's name,
// which a Tesla or Zoox rationale gives for a month of its row's year.
const PAREN = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
const BRACKET = String.raw`\[[^\[\]]*\]`;
const CLAUSE = String.raw`(?:[^;()\[\]]|${PAREN}|${BRACKET})`;
const WHOLE = String.raw`(?<![\d,.])(\d{1,3}(?:,\d{3})*)(?![,.]?\d)`;
const MONTH_NAME = `(${MONTH_NAMES.join("|")})`;
const namedMonth = (r, name) => `${r.month.slice(0, 4)}-${String(MONTH_NAMES.indexOf(name) + 1).padStart(2, "0")}`;
for (const r of rows) {
  for (const m of r.rationale.matchAll(/(\d+(?:\.\d+)?)([kM]) end-(?:([A-Z][a-z]{2})-)?(\d{4})\b/g)) {
    figureForms["end of a month or year"].push(`${r.helmer} ${r.month}`);
    const month = `${m[4]}-${m[3] === undefined ? "12" : MON[m[3]]}`, stated = UNIT[m[2]](m[1]), row = rowOf(r.helmer, month);
    if (row === undefined || !within(stated.miles, row.cume, stated.slack)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${month}'s cumulative ${row === undefined ? "(no row)" : fmt(row.cume)}`);
    }
  }
}
const hubFigures = []; // each anchor's month and hub figure
for (const r of waymo) {
  const anchors = [...r.rationale.matchAll(/The ([A-Z][a-z]{2})-(\d{4}) cumulative lands on the anchor: the hub's (\d+(?:\.\d+)?)M plus (\d+(?:\.\d+)?)M\b[^;]*?, less the (\d+(?:\.\d+)?)M pre-series miles/g)]
    .map(m => ({ text: m[0], end: m.index + m[0].length, month: `${m[2]}-${MON[m[1]]}`, hub: millions(m[3]), metros: millions(m[4]), offset: millions(m[5]) }));
  for (const a of anchors) {
    figureForms["Waymo anchor"].push(r.month);
    hubFigures.push({ month: a.month, hub: a.hub });
    const row = rowOf("waymo", a.month), want = a.hub.miles + a.metros.miles - a.offset.miles;
    if (row === undefined || !within(want, row.cume, a.hub.slack + a.metros.slack + a.offset.slack)) {
      figureErrors.push(`waymo ${r.month}: "${a.text}" gives ${fmt(want)}, vs ${a.month}'s cumulative ${row === undefined ? "(no row)" : fmt(row.cume)}`);
    }
  }
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
  for (const m of r.rationale.matchAll(/(\d+(?:\.\d+)?)M rider-only miles thru ([A-Z][a-z]{2})-(\d{4})/g)) {
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
  // The total is read only with the parenthesis after it that sets its rate
  // beside a row's ("<Monthname>'s row"), the words that make it the row's
  // (since 2026-11-04; header).
  for (const frame of r.rationale.matchAll(new RegExp(String.raw`\bTotal (\d+(?:\.\d+)?)M, about (\d+(?:\.\d+)?)k a day \(([^()]*\b${MONTH_NAME}'s row \d[^()]*)\)`, "g"))) {
    figureForms["Waymo total and daily rate"].push(r.month);
    const total = millions(frame[1]), rate = thousands(frame[2]), perDay = r.vmt / daysIn(r.month);
    if (!within(total.miles, r.vmt, total.slack) || !within(rate.miles, perDay, rate.slack)) {
      figureErrors.push(`waymo ${r.month}: "Total ${frame[1]}M, about ${frame[2]}k a day" vs its miles, ${fmt(r.vmt)}, and its miles over its ${daysIn(r.month)} days, ${milesOf(perDay)}`);
    }
    for (const m of frame[3].matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)'s row (\d+(?:\.\d+)?)k\b/g)) {
      figureForms["a month's daily rate"].push(r.month);
      const mm = String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, "0"), stated = thousands(m[2]);
      const row = rowOf("waymo", waymo.map(x => x.month).filter(x => x.endsWith(`-${mm}`) && x <= r.month).sort().at(-1));
      if (row === undefined || !within(stated.miles, row.vmt / daysIn(row.month), stated.slack)) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${row === undefined ? `no ${m[1]} row at or before ${r.month}` : `${row.month}'s miles over its ${daysIn(row.month)} days, ${milesOf(row.vmt / daysIn(row.month))}`}`);
      }
    }
    for (const m of frame[3].matchAll(/\bmeasured Q([1-4]) (\d+(?:\.\d+)?)k\b/g)) {
      figureForms["a quarter's daily rate"].push(r.month);
      // the latest quarter n ending at or before the row's month, as the month
      // names above read the latest such month: the year before's when quarter
      // n ends later in the row's year (a January row's "measured Q3")
      const q = Number(m[1]), endInRowsYear = `${r.month.slice(0, 4)}-${String(3 * q).padStart(2, "0")}`;
      const year = Number(r.month.slice(0, 4)) - Number(endInRowsYear > r.month);
      const months = [1, 2, 3].map(i => `${year}-${String(3 * (q - 1) + i).padStart(2, "0")}`);
      const quarter = waymo.filter(x => months.includes(x.month)), stated = thousands(m[2]);
      const perDay = quarter.reduce((s, x) => s + x.vmt, 0) / months.reduce((s, x) => s + daysIn(x), 0);
      if (quarter.length !== 3 || !within(stated.miles, perDay, stated.slack)) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${quarter.length} of the 3 rows for ${months.join(", ")}, ${milesOf(perDay)} a day`);
      }
    }
  }
  for (const m of r.rationale.matchAll(/Cross-check: (\d+(?:\.\d+)?)M\/mo ≈ (\d+(?:\.\d+)?)M\/wk\b/g)) {
    figureForms["a month and its week"].push(r.month);
    const [perMonth, perWeek] = [m[1], m[2]].map(millions), week = r.vmt * 7 / daysIn(r.month);
    if (!within(perMonth.miles, r.vmt, perMonth.slack) || !within(perWeek.miles, week, perWeek.slack)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs its miles, ${fmt(r.vmt)}, and its miles times 7 over its ${daysIn(r.month)} days, ${milesOf(week)}`);
    }
  }
  // The band is read only in a sentence that makes it the row's, its
  // components' ranges combined (since 2026-11-04; header).
  for (const m of r.rationale.matchAll(/Band x(\d+(?:\.\d+)?) to x(\d+(?:\.\d+)?)(?=(?:[^.]|\.(?=\d))*?\bthe components' ranges combined\b)/g)) {
    figureForms["band multipliers"].push(r.month);
    const slack = s => 0.5 * 10 ** -decimals(s) + 1e-9;
    if (!within(Number(m[1]), r.vmin / r.vmt, slack(m[1])) || !within(Number(m[2]), r.vmax / r.vmt, slack(m[2]))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs its band over its miles, x${(r.vmin / r.vmt).toFixed(4)} to x${(r.vmax / r.vmt).toFixed(4)}`);
    }
  }
}
// The forms added on 2026-11-04 (the fourth fix run's reviews; frames as in
// the (3a) comment above).
// A Waymo row's named terms: "CA ... = <c>M; Maricopa <m>M[ (...)] and|,
// Travis <t>M ...; Atlanta <a>M ...; [+ ]rider-only metros the hub does not
// count (...) <u>M" or "... uncounted metros <u>M", and October's "; and about
// <x>M for ..."; CA's term is the last "= <c>M" of its clause.
const TERMS = new RegExp(String.raw`\bCA (?:= |(?=\d))${CLAUSE}*= (\d+(?:\.\d+)?)M(?: ${PAREN})?; Maricopa (\d+(?:\.\d+)?)M(?: ${PAREN})?(?:,| and) Travis (\d+(?:\.\d+)?)M${CLAUSE}*?[;,] Atlanta (\d+(?:\.\d+)?)M${CLAUSE}*; (?:\+ )?(?:rider-only metros the hub does not count ${PAREN}|uncounted metros) (\d+(?:\.\d+)?)M(?: ${BRACKET})?(?: ${PAREN})?(?:; and about (\d+(?:\.\d+)?)M for\b)?`, "g");
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
// = <r>M", the factor a decimal or a ratio a/b; the result is read in a
// lookahead, so it can be the next product's base (October's "10.4M ... x
// 31/30 = 10.75M x ... 1.0576 = 11.37M").
const PRODUCT = new RegExp(String.raw`(?<![\d.,])(\d+(?:\.\d+)?)M(?:[^;=.()\[\]]|\.(?=\d)|${PAREN})*? x (?:the hub-vs-CPUC CA ratio )?(\d+(?:\.\d+)?(?:\/\d+)?)(?: ${BRACKET})? = (?=(\d+(?:\.\d+)?)M)`, "g");
for (const r of waymo) {
  for (const m of r.rationale.matchAll(TERMS)) {
    figureForms["Waymo terms"].push(r.month);
    // a list without the optional sixth term leaves its group undefined
    const terms = m.slice(1).filter(x => x !== undefined).map(millions);
    const sum = terms.reduce((s, t) => s + t.miles, 0), slack = terms.reduce((s, t) => s + t.slack, 0);
    if (!within(sum, r.vmt, slack)) {
      figureErrors.push(`waymo ${r.month}: its terms ${terms.map(t => t.stated).join(" + ")} sum to ${fmt(sum)}, vs its miles, ${fmt(r.vmt)} (their rounding allows ${fmt(slack)})`);
    }
  }
  for (const m of r.rationale.matchAll(CPUC_PRODUCT)) {
    figureForms["CPUC product"].push(r.month);
    const [dep, pilot] = [m[3], m[4]].map(wholeMiles), result = millions(m[6]), product = (dep.miles + pilot.miles) * Number(m[5]);
    if (!within(product, result.miles, result.slack)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": (${dep.stated} + ${pilot.stated}) x ${m[5]} is ${milesOf(product)}`);
    }
    // The base, CPUC's miles for the row's month, is checked where
    // data/waymo-ca.csv holds that month and the stated quarter is its own.
    const ca = CPUC_CA[r.month];
    if (`${m[2]}-Q${m[1]}` !== `${r.month.slice(0, 4)}-Q${Math.ceil(Number(r.month.slice(5, 7)) / 3)}` || ca === undefined) {
      unchecked["CPUC base"].push(r.month);
      continue;
    }
    figureForms["CPUC base"].push(r.month);
    if (!within(dep.miles, ca.deployment, 0.5) || !within(pilot.miles, ca.pilot, 0.5)) {
      figureErrors.push(`waymo ${r.month}: "${dep.stated} deployment + ${pilot.stated} pilot" vs data/waymo-ca.csv's ${r.month}, deployment ${milesOf(ca.deployment)} and pilot ${milesOf(ca.pilot)}`);
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
// Zoox's 2025-2026 ones), each read as that month of the row's year in the
// row's line; whole miles exactly.
const nameRow = (r, name) => ({ month: namedMonth(r, name), row: rowOf(r.helmer, namedMonth(r, name)) });
const cumeAndBand = row => row === undefined ? "(no row)" : `${fmt(row.cume)}, its band ${fmt(row.kmin)} to ${fmt(row.kmax)}`;
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
  const { month, row } = nameRow(r, m[1]);
  if (row === undefined || !holds(row, m)) {
    figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${month}'s miles ${row === undefined ? "(no row)" : `${fmt(row.vmt)}, its cumulative ${cumeAndBand(row)}`}`);
  }
}
// The row's own figures, any line; the row before is its line's previous row
// in the file (consecutive months, vmt-ledger.qual), or zero for its first.
const rowBefore = r => { const own = rows.filter(x => x.helmer === r.helmer); return [{ cume: 0, kmin: 0, kmax: 0 }, ...own][own.indexOf(r)]; };
for (const r of rows) {
  // "Each month is its cumulative less the month before's, its band the
  // difference of their bands": its miles and band from the row before's
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
  // floor), to a mile
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
  // "The cumulative band's floor through <Mon> <D>, <f>, is the end-<Month>
  // floor (<j>: ...) plus the <Month> and <Month> floors": f the floor of the
  // month <D> ends (of the row's year), j the end-<Month> one, and j plus the
  // two months' own floors is f
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\bThe cumulative band's floor through (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), ${WHOLE}, is the end-${MONTH_NAME} floor \(${WHOLE}:[^()]*\) plus the ${MONTH_NAME} and ${MONTH_NAME} floors\b`, "g"))) {
    figureForms["a floor through a month's end"].push(`${r.helmer} ${r.month}`);
    const month = `${r.month.slice(0, 4)}-${MON[m[1]]}`, rowAt = rowOf(r.helmer, month);
    const [end, a, b] = [m[4], m[6], m[7]].map(name => nameRow(r, name).row), [f, j] = [m[3], m[5]].map(s => wholeMiles(s).miles);
    if ([rowAt, end, a, b].includes(undefined) || Number(m[2]) !== daysIn(month) || rowAt.kmin !== f || end.kmin !== j || j + a.vmin + b.vmin !== f) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${[[month, rowAt], [m[4], end], [m[6], a], [m[7], b]].map(([name, x]) => `${name}: ${x === undefined ? "(no row)" : `floor ${fmt(x.kmin)}, its miles' floor ${fmt(x.vmin)}`}`).join("; ")}; ${month} has ${daysIn(month)} days`);
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
Expectata: (1) each link (any "[<text>](<target>)") has a text other than blanks and the target data/#<anchor>, <anchor> the id GitHub Pages gives one of data/README.md's headings (${ANCHORS.join(", ")}) and of the form the page reads (lowercase letters, digits and hyphens), and no "](" or target "data/#" stands outside a link but inside a longer path or address; on synthetic files the heading reader gives GitHub Pages' ids, and stops with its message on each form it stops on; on synthetic links each wrong form is named; (2) no kyoom, vmt_min/vmt_max, TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best" or "D/H"; (3) each figure stated in one of the forms that follow passes its form's test (a value to its stated precision, whole miles exactly; a floor to a mile; a milestone day to the day) and is checked where its wording appears, none of these forms being required (a statement reworded out of its form goes unchecked, the human's rule of 2026-11-03): each "<x>k" or "<x>M" "end-[<Mon>-]<YYYY>" is that line's series cumulative; each Waymo anchor ("The <Mon>-<YYYY> cumulative lands on the anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles") is that month's cumulative, h + e - o; each Waymo band after an anchor in its rationale ("its cumulative band is the hub total plus <a>M to <b>M ..., less the pre-series miles' range, <l>M-<u>M") that month's cumulative band; each Waymo "<h>M rider-only miles thru <Mon>-<YYYY>" the hub figure every anchor for that month uses, where one exists; each Waymo "<n> in <YYYY>" of "by calendar year (...)" that year's summed months, for each year whose January the series holds; each Waymo "first million rider-only miles on <Mon> <D>, <YYYY>" the day the lifetime (the cumulative plus OFFSET's central, the month's miles spread evenly) reaches 1,000,000; each Waymo "floor the series clears, ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon> <D>, <YYYY>)" with N million no more than the lifetime at the end of that day; each Waymo "Total <x>M, about <y>k a day (...)" with "<Monthname>'s row" in its parenthesis its miles and its miles over its days, and in that parenthesis each "<Monthname>'s row <z>k" the miles over the days of the latest month of that name at or before the row's, and each "measured Q<n> <w>k" those of the latest quarter n ending at or before the row's month; each Waymo "Cross-check: <x>M/mo ≈ <y>M/wk" its miles and its miles times 7 over its days; each Waymo "Band x<lo> to x<hi>" in a sentence that gives it as "the components' ranges combined" its row's band over its miles; each Waymo list of terms ("CA ... = <c>M; Maricopa <m>M ... Travis <t>M ...; Atlanta <a>M ...; ... metros ... <u>M[; and about <x>M for ...]") its row's miles, the terms summed, to their stated precision; each Waymo "CPUC Q<n>-<YYYY> driverless actual <d> deployment + <p> pilot (...) x <f>, ... = <r>M" with (d + p) x f equal to r, and d and p data/waymo-ca.csv's deployment and pilot miles for the row's month, rounded to a mile, where that file holds the month and it lies in that quarter; each "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[ [<range>]] = <r>M" with b x f equal to r, f a decimal or a ratio a/b; with a month's name read as that month of the row's year in the row's line, each "<Month> keeps ...end-of-month <c>[ (...)], its band <lo>-<hi>" that month's cumulative and cumulative band, each reading of "end-<Month> <a> / <b> / <c>" that a later "its band <lo>-<hi> holding the three readings" places in that month's band inside it, each "<Month>'s cumulative is that reading, <c>" or "is the chart's ~<c>" its cumulative, "..., its band from the call's <f> to <p>% above it" its band's floor f and its top p% above c, to the whole percent, "..., its floor <f>" its band's floor, each "<Month>'s miles are at least <n>" with its miles at least n and "..., puts them there (<v> with" its miles v, each "<Month>'s cumulative band, <lo> to <hi>" its cumulative band and each "End-<Month> cumulative floor <f>" its band's floor; in each row, "Each month is its cumulative less the month before's, its band the difference of their bands" its miles and band from its line's row before (from zero for a line's first), "a month's band is <a>x-<b>x its miles, within the difference of its cumulative band and the month before's" its band a and b times its miles, each edge held inside the difference of the two cumulative bands, to a mile, "the cumulative is ...: <x>M less the <o> pre-series miles, <c>" its cumulative c with x less o equal to c, "Its band, <lo> to <hi>, is that statement's range" and a sentence's opening "Cumulative band <lo> to <hi>:" its cumulative band, and "The cumulative band's floor through <Mon> <D>, <f>, is the end-<Month> floor (<j>: ...) plus the <Month> and <Month> floors" with D the last day of <Mon>, f that month's cumulative floor, j the end-<Month> one and j plus the two months' floors f; every figure a Waymo rationale states for the pre-series offset (the builder's "miles driven before it, <central> (range <low>-<high>)", "<x>M pre-series miles", "pre-series miles' range, <low>M-<high>M") equals OFFSET, central ${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)}, whole miles exactly and millions to their stated precision; (4) none of the corrected statements recurs.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: ${rows.length} VMT rationales link only to sections of data/README.md (${links} links, to the ids of its ${README_IDS.length} headings), use no internal shorthand, and state figures that pass their form's test against the rows (the rows' values, floors the rows meet and products that hold) in every form read here (${Object.entries(figureForms).map(([f, found]) => `${found.length} ${f}`).join(", ")}; found with nothing to read them against, so unchecked: ${Object.entries(unchecked).map(([f, found]) => `${found.length} ${f}`).join(", ")}); ${Object.values(offsetForms).flat().length} Waymo statements of the pre-series offset, in ${OFFSET_FORMS.length} forms, give data/waymo_vmt.py's OFFSET (${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)})`);

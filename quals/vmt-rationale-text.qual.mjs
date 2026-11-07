import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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
//       (headingAnchors, which reads the file's blocks as kramdown does,
//       stops on the few forms whose effect on the file's headings it does
//       not compute, and leaves unread a heading of a form whose effect on
//       its id it does not compute; it is checked on synthetic files against
//       the ids GitHub Pages' own stack gives them in the page it serves).
//       Each link (any "[<text>](<target>)") has a text other than blanks
//       and the target data/#<anchor>, <anchor> one of those ids that the
//       page writes (a non-empty one; a link to an unread heading is red,
//       its message naming the unread headings), in the form the page
//       reads (crashla.js reads an anchor as
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
//       no-monitor page, and a hub figure, the one the anchors for its month
//       use); a lifetime on a day lies on a path through its month, the
//       month-end lifetime on its last day (the Zoox model's path on a Zoox
//       line where a clause names the model's path, its days out where a
//       rationale places them, and elsewhere the month's miles spread evenly,
//       one only some other path bears out going unchecked, since the rows
//       hold no path within a month); a sum holds (a row's listed
//       terms, a quarter's split of an increment, one line's miles less
//       another's), as do a product
//       ("<b> x <f> = <r>", r to its precision), a share, a run-rate and a
//       month at another's per-day rates, each stated input's half-unit
//       carried through to the result (since 2026-11-07; until then the
//       stated figures were taken as exact);
//       each reading a rationale says a band holds lies inside it; a floor or
//       a ceiling (a public one the series clears, one set on a month's
//       miles, a floor only one of three readings meets, a month-end figure
//       after "more than" or "less than") is one the rows meet; a figure
//       marked approximate by its "~" (or "≈", "about" and the like) holds to
//       one unit of its last digit; the CPUC miles a product starts from are a
//       month's of data/waymo-ca.csv, or a sum of its months; Zoox's
//       statements of its pre-series miles give the Zoox model's figure,
//       quals/zoox-vmt-model.qual.mjs's PRE_C, or one of its band, PRE (an
//       edge, or its California or Las Vegas part), to their precision (since
//       the round-3 review of 2026-11-06; until 2026-11-07 PRE_C alone, so a
//       correct statement of an edge or a part failed; from the round-2
//       review of 2026-11-05 until the round-3 review they had only to agree,
//       some one figure within the stated precision of each; until that
//       review this header said they agreed and nothing checked it); and the
//       days a Zoox rationale says a month leaves out, "<Monthname> leaves
//       out <list>", are as many in all as the model holds out of a month of
//       that name, its LV_PAUSE (since the round-3 review; until 2026-11-07
//       any "leaves out <Mon> <a>-<b>" was read so, whatever its subject, and
//       a list's first stretch alone). Each of the model's
//       constants is read from that file and evaluated alone (constantOf).
//       Most forms read Waymo's rationales;
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
// it states, or else accepts a figure that is right under each meaning it
// reads its words to have (those below), and a figure right under none of
// them still fails; the meanings a correct figure could have that a frame
// does not read are listed below as what remains. Read only
// beside such words: the builder's offset follows "miles driven before it, "
// (since 2026-11-04; until then a component's "3,245,248 (range
// 3,100,000-3,400,000)" was read as the offset); a Waymo "Total <x>M, about
// <y>k a day" has right after it a parenthesis, holding no other, with
// "<Monthname>'s row <digit>" in it, which sets its rate beside a row's
// (since 2026-11-04; until then a component's "Total 1.40M, about 47k a day"
// failed as the row's, and a "measured Q<n>" in a parenthesis after it was
// read as the row's quarter); a Waymo "Band x<lo> to x<hi>" has "the
// components' ranges combined" later in its sentence, which a stop not
// followed by a digit ends and a semicolon does not (since 2026-11-04; until
// then a component's band failed as the row's); since 2026-11-05 the hub's
// figure follows "update: " with its clause ending after the month at a
// semicolon, a stop or a closing parenthesis (until then a county's
// "92.121M rider-only miles thru Jun-2026" failed as the hub's; until that
// day's round-1 review a comma ended the clause too, so a county's figure
// after "update: ", qualified after a comma, still did); and a "Cross-check:
// <x>M/mo ≈ <y>M/wk" is the row's only with " vs Waymo's" after it (until
// then a component's pair failed as the row's).
// Read under the meanings their words could have, since 2026-11-05 and as
// that day's round-1 and round-2 reviews and the round-3 review of 2026-11-06
// restated them: a month-end figure is a line's series cumulative or its
// lifetime, for a line the row may mean or its clause names, or Waymo's hub
// figure, as a floor, a ceiling or approximate where the words right before
// it say so ("more than", "less than", "~"), and one that is none of these
// goes unchecked where its clause names another owner (a county, a city,
// another series, a deck's or a page's reading) or a line data/vmt.csv has
// no rows of, where it may be the lifetime in a month a line has no row for
// (after the line's last row at least its cumulative, before its first at
// most its pre-series miles; since the round-3 review, until then whatever
// the figure), or where it may be Waymo's unknown hub figure, which its words
// leave among its meanings unless they name the series or a line and not
// the hub (since the round-3 review; until then whatever the words, and
// unchecked too where Zoox's pre-series miles were unstated); a clause
// holding a pronoun ("it", "its") or a noun that names no owner ("the
// total") with none that does refers back, so the clauses before it in its
// sentence (or, where it opens one, the sentence before) and what a
// parenthesis follows count as its words, and a stop cuts a clause only
// before a capital, not an abbreviation's ("Maricopa Co."), so that a deck's
// "the total", a county's "...; it stood at" and "Maricopa Co. stood at" are
// another owner's (since the round-2 review; until then each failed as the
// row's line's; until the round-1 review the series cumulative only, and a
// figure that was none of the readings failed whatever its words); a month
// named without its year is any month of that name with a row, in the row's
// line or, for a Tesla line, either Tesla line, and where the nearest one
// has no row a figure no row bears out goes unchecked where it may be that
// month's (after the line's last row each cumulative or band edge at least
// the last row's, before its first at most its pre-series miles, a month's
// own miles anything; since the round-3 review, until then whatever its
// value; until the round-1 review the month of that name within 11 months
// either way, so a shared rationale naming a month 12-14 months from some of
// its rows failed; before that day the row's year's); a quarter named
// without its year is any year's (until the round-1 review the latest at or
// before the row's month); a CPUC base is any month's of its stated quarter
// or the sum of two or three of them (until the round-1 review a month's
// only; before that day the row's month's); a Waymo list's terms hold when
// its components plus any choice of its other labelled terms sum to its
// miles (until the round-1 review every labelled term, so a part of a term
// failed; before that day the five or six it named, so an added term
// failed); a product's base is any figure of its clause before " x" (until
// the round-1 review the one right before " x", so an aside figure failed;
// before that day the leftmost, so an earlier figure failed); a page reading
// is the no-monitor line's month or its cumulative, or, where month names
// stand before its month in its clause, the miles from one of them through
// it ("July and August: <p>"), and goes unchecked where other words stand
// there, which may name a part ("In Houston, July: <p>"), or below the
// month's floor with no deck reading beside it, which may be the days a
// month in progress had measured (since the round-2 review; until then one
// below the floor went unchecked beside a deck reading too, and one after
// "July and" was read as the month's alone; until the round-1 review the
// month's miles only, wherever the reading stood); the figures after page
// readings are any such reading's month's or a month's their sentence names,
// and one that another month's row bears out goes unchecked, since words can
// name a month relatively ("the month before's"; since the round-2 review,
// until then it failed; until the round-1 review the latest reading's only);
// a lifetime on a day is the series cumulative or the lifetime of a line the
// row may mean or its clause names, or on a month's last day Waymo's hub
// figure (an anchor's, or, where none gives one and its words leave the hub
// among its meanings, the unknown figure, at most the lifetime), on the day
// of the month its year names or else of any month of its name with a row,
// within the rounding the line's months carry, read on a Zoox line on the
// Zoox model's path where its clause names the model's path ("the path",
// "its path", "Zoox's path", "the smooth path", "the smoothest path", "the
// model's path", "the model path", "the Zoox model's path", none followed by
// "of", "that", "which", "where" or "whose", words that go on to identify
// another path; or "that path", "this path" or "the same path" where the
// last path its words name before it is one of those), or names no path of
// its own and refers back to a clause that does (since 2026-11-07; until
// then "the path of ...", "the path that ..." and "the path which ..." were
// read as the model's, so a correct figure of another path failed, and "that
// path", "the model path" and "the Zoox model's path" were not, so a
// corrupted crossing there passed) (the month's miles spread evenly over its days, or its Las Vegas
// share at one rate a driving day with the days the model holds out of the
// month where a rationale places them, and else anywhere in it), and
// elsewhere on the even spread; and one that only some other path through
// the month bears out goes unchecked, as does one whose clause names another
// owner, away from the model's path, or a line with no rows (since the
// round-3 review the lines and owners its clause names, the year, the
// model's path by name, the days out where placed and the hub's unknown
// figure; until then the row's own lines whatever the words, any year of the
// month's name, any "path" word, the days out anywhere and no unknown hub
// figure; since 2026-11-06 the model's path, from the round-2 review until
// then any path through the month bearing a figure out, so a Zoox crossing a
// day late passed; from the round-1 review until the round-2 review the even
// spread alone, which failed a correct figure of a month a series ran
// through unevenly; until the round-1 review the lifetime only, on the even
// spread exactly); a day no month of its name has, or that its stated
// year's month lacks, fails (since the round-2 review; until then a day past
// its month's end went unchecked; the stated year since the round-3 review),
// and one of a month the rows do not reach goes unchecked only where the
// series' growth allows it then (after a line's last row the lifetime is at
// least its cumulative, for a hub figure on a Waymo month's last day
// anything, before its first row at most its pre-series miles; since
// 2026-11-06, until then whatever the figure); a floor the series clears is
// cleared where the even spread through its day, with OFFSET's high edge,
// clears it, and goes unchecked where only its month's end does (since
// 2026-11-06; from the round-2 review until then the month's end cleared it;
// until then the even spread with OFFSET's central), one dated after the
// rows cleared where the last row's lifetime clears it and otherwise
// unchecked (until the round-1 review it failed), and one dated before the
// series unchecked where it is at most OFFSET's high edge and otherwise
// failing (since the round-3 review; until then unchecked whatever its
// value); a run-rate is a third of an increment a split statement gives
// (until the round-1 review also of the quarter's listed terms, which for
// estimated rows are no hub figure); and a per-day term that states no
// adjustment of its own may add any signed sum of the figures stated outside
// its list and its total, and goes unchecked where none fits and its label
// recurs (since the round-2 review; until then it went unchecked wherever the
// rationale held one of three wordings of an adjustment and was read as
// unadjusted where it held none, so an adjustment in other words failed).
// What a frame cannot read goes unchecked, and the pass line counts it (the
// comment at `unchecked` lists each case).
// What remains, the meanings a correct figure could have that no frame
// reads, so that the figure fails (since 2026-11-07 a product, a month at
// its daily rates and a term at another month's per-day rates carry their
// inputs' half-units through to the result, and sums their terms', so a
// correct result computed from an unrounded input no longer fails: until
// then the stated inputs were taken as exact, and October's 10.4M x 31/30 =
// 10.75M passed with 3,333 of the 5,001 miles allowed, where 10.80M, right
// for a base of 10.449M, failed; and Zoox's statements of a part or an edge
// of its pre-series miles are read too): a month-end figure or a
// lifetime on a day whose clause holds only words of a reading of the row's
// own line (OWN_WORDS, and for a lifetime the path's words and plain ones,
// PLAIN), and no pronoun, is read as one, so another owner's figure fails
// where an earlier sentence named the owner and "the lifetime" or "the
// series" in that clause refers back to it; a pronoun is read as referring
// to the clauses before it in its sentence or, where it opens one, to the
// sentence before, so a referent further back is not read; Waymo's hub
// figure called "the series" or "the line" without the word "hub" (the
// hub's "benchmarked series") is read as the rows' own, and so fails; a
// lifetime on a day on a Zoox line, in a clause that names the model's path
// (or names it by a demonstrative after naming it, or whose pronoun refers
// back to one that does), is read on the model's path whatever else its
// words name, so a figure there that is not the path's (a source's own day
// for the crossing, or another owner's figure beside the path's name) fails;
// a window of days a Zoox rationale says a month leaves out ("<Monthname>
// leaves out <list>") is read as the model's Las Vegas days out, so a window
// of another share's days fails; a page reading whose month opens its clause, at
// or above its month's floor or below it beside a deck reading, is read as
// the month's whole, so a part named only in an earlier sentence fails; a
// per-day term that states no adjustment of its own and is adjusted in words
// that state no figure and do not name its label ("Austin freeway rides add
// a twentieth") fails; the milestone day reads the builder's lifetime on the
// even spread with OFFSET's central (its rationale has January 2023 keep one
// daily rate), so a milestone in a month whose daily rate changes, or read
// with another offset, could fail; a month-end figure of another measure of
// the row's company named by the company's name alone ("Waymo passed 10M
// end-2018", its testing miles with safety drivers aboard) is read as the
// line's lifetime, and fails where the rows bound that, here before the
// series at most its pre-series miles; and a named month in Waymo's or
// Zoox's rows is read in the row's line only. And what the frames cannot check, which passes or goes
// unchecked: a lifetime on a day away from the Zoox model's path, off the
// even spread but within its month (it goes unchecked, since some path
// through the month may put it there: a crossing a day late, say, which the
// crossing and the Dec-31 lifetime catch only where their clause names the
// model's path, so that "Zoox's lifetime crosses 1M at the start of Dec 3"
// goes unchecked), and a figure on the Zoox model's path read with no
// pre-series miles (the series itself, which crosses Zoox's 1M on Dec 5,
// 2025, so that "the path crosses 1M on Dec 5" passes); the days out of a
// month where no rationale places them in the words read, which may lie
// anywhere in it; a page reading below its month's floor with no deck
// reading beside it; a month-end figure that may be another owner's or
// Waymo's unknown hub figure, which after Waymo's last row may be anything; a
// floor dated after the rows above the last row's lifetime; a month's own
// miles of a month by its name beyond the rows, which need not grow; and a
// floor through a month's end of a month beyond the rows, whatever its
// value.

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
// Half a unit of a stated factor's or rate's last decimal ("1.058" ->
// 0.0005, "3,290.79" -> 0.005), the most its rounding moves it; a whole number
// ("2", a count of days) is exact. A product, rate or per-day scaling carries
// its inputs' half-units through to its result (since 2026-11-07; until then
// the stated inputs were taken as exact, so a correct result computed from
// an unrounded input that rounds otherwise failed).
const inputHalf = num => (num.includes(".") ? 0.5 * 10 ** -decimals(num) : 0);
const fmt = n => n.toLocaleString("en-US");
// data/waymo_vmt.py's OFFSET (central, low, high), the rider-only miles Waymo
// drove before the series starts, which (3a) and (3b) read; and a stated
// figure as miles with its slack: whole miles exactly ("205,000"), thousands
// and millions to their stated precision ("658k", "0.205M", "1,717k"), and
// one marked approximate by its "about" or "≈" ("about 718k", "≈ 1.8M") to
// one unit of its last digit, as a "~" is (since the round-2 review of
// 2026-11-05; until then the rates of a "Total <x>M, about <y>k a day" and a
// crash count's "≈ <x>M" held to half a unit, and thousands commas before a
// unit stopped the number, so "1,717k" read 717k).
const offsetLine = fs.readFileSync("data/waymo_vmt.py", "utf8").match(/^OFFSET = \((\d+), (\d+), (\d+)\)/m);
assert.ok(offsetLine, "Replicata: read OFFSET in data/waymo_vmt.py. Expectata: a (central, low, high) literal. Resultata: not found.");
const OFFSET = { central: Number(offsetLine[1]), low: Number(offsetLine[2]), high: Number(offsetLine[3]) };
const wholeMiles = s => ({ stated: s, miles: Number(s.replace(/,/g, "")), slack: 0 });
const thousands = s => ({ stated: `${s}k`, miles: Number(s.replace(/,/g, "")) * 1e3, slack: 0.5 * 10 ** (3 - decimals(s)) + 1 });
const millions = s => ({ stated: `${s}M`, miles: Number(s.replace(/,/g, "")) * 1e6, slack: halfUnit(s) });
const aboutThousands = s => ({ ...thousands(s), slack: 10 ** (3 - decimals(s)) + 1 });
const aboutMillions = s => ({ ...millions(s), slack: 10 ** (6 - decimals(s)) + 1 });
// A constant another file of the repo declares at a line's start ("const
// <name> = <expression>;"), its expression everything up to the first
// semicolon after the "=", evaluated alone in a fresh context, so that each
// literal form of a value reads alike (either quote, a trailing comma,
// comments without a semicolon, several lines, Object.freeze(...)); a
// constant declared other than once, an expression that does not evaluate
// alone in strict mode (one holding a semicolon, a declaration list's later
// declarator, or a name the file defines elsewhere), or a missing file stops
// the qual with its message. Since the round-3 review of 2026-11-06 (until
// then one line's regex and JSON.parse read quals/zoox-vmt-model.qual.mjs's
// LV_PAUSE, so a correct edit of its literal form, valid JavaScript to that
// qual, stopped this one with a raw SyntaxError); in strict mode since
// 2026-11-07 (until then a declaration list read as its last declarator's
// value, so "const PRE_C = 40080, PRE_C_CA = 20174.2;" failed every correct
// Zoox statement of 40,080).
const constantOf = (file, name) => {
  assert.ok(fs.existsSync(file),
    `Replicata: read ${file} for the constant ${name}. Expectata: the file, which defines it. Resultata: no such file (until 2026-11-07 this stopped on a raw ENOENT).`);
  const decls = [...fs.readFileSync(file, "utf8").matchAll(new RegExp(String.raw`^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+${name}[ \t]*=([^;]*);`, "gm"))];
  assert.equal(decls.length, 1,
    `Replicata: read ${file} for the constant ${name}. Expectata: one declaration at a line's start, "const ${name} = <expression>;". Resultata: ${decls.length} declarations.`);
  let value, failure = null;
  try { value = vm.runInNewContext(`"use strict"; (${decls[0][1]}\n)`, Object.create(null), { timeout: 1000 }); } catch (e) { failure = e.message; }
  assert.equal(failure, null,
    `Replicata: read the constant ${name} in ${file} and evaluate its expression, up to the first semicolon, alone, in strict mode (until 2026-11-07 in sloppy mode, where a declaration list, "const ${name} = <a>, <other> = <b>;", read as its last declarator's value).
Expectata: a value that needs nothing else the file defines (a declaration of ${name} alone).
Resultata: evaluating ${JSON.stringify(decls[0][1].trim())} gave ${JSON.stringify(failure)}.`);
  return value;
};

// (1) every link names a section of data/README.md: its text non-empty, its
// target data/#<anchor>, the anchor one of the ids GitHub Pages gives the
// file's headings (header), which the page writes (a non-empty one); and no
// link syntax ("](", a target "data/#" but inside a longer path or address)
// outside a link. A heading the reader leaves unread (headingAnchors: a mark
// in its text whose effect on its id it does not compute, or a footnote's)
// or one with an empty id (the page writes none) turns nothing red by
// itself; a link to it names no heading whose id is known, and is red, its
// message naming the unread headings. Until 2026-11-07 an unread heading
// stopped the reader, and a heading with an empty id was red, so a correct
// edit of data/README.md adding one that no link targets ("### R&amp;D
// notes", "### The _ghost_ rows", "## 🚧") turned this qual red.
const README_IDS = headingAnchors(fs.readFileSync("data/README.md", "utf8"), "data/README.md");
const ANCHORS = README_IDS.flatMap(h => h.anchors).filter(a => a !== "");
const UNREAD = README_IDS.filter(h => h.anchor === null);
assert.ok(ANCHORS.length > 0,
  `Replicata: compute the ids GitHub Pages gives data/README.md's headings (quals/rationale-links.mjs, headingAnchors).
Expectata: at least one heading with an id the page writes (a non-empty one).
Resultata: ${README_IDS.length} headings: ${JSON.stringify(README_IDS)}.`);
// The reader on synthetic files (self-contained: they read no file), each
// case's ids the ones GitHub Pages' own stack gives (kramdown 2.4.0 with
// kramdown-parser-gfm 1.1.0, the versions github-pages 232 pins, run on these
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
// content too, whose headings take the ids kramdown's HTML converter gives,
// generate_id, its own counter) or a math block, and the # lines inside it,
// as kramdown reads them; a line starting with a span-level element, an
// autolink line and a thematic break; a table and the pipe lines it takes; a
// footnote's content, whose headings it leaves unread (the page writes them
// after the rest, where the footnote is referenced); an empty id, which the
// page does not write; front matter dropped, a YAML comment in it too;
// "\r\n" line ends. Each form that changes the file's headings in a way the
// reader does not compute stops it, and a heading holding a mark that can
// make the text GitHub Pages renders for it, and so its id, differ from what
// this reader reads is left unread, each naming why (here the stack gives
// "Foo {#bar}" bar, "`x`{: .y} z" x-z, "R&amp;D" rd, "Angle a << b >> c"
// angle-a-b-c, "[a](b c) d" a-d, "[the hub][hub]" with [hub] defined the-hub,
// "_Emphasis_ here" emphasis-here, "## Heading" after "{: #x}" x; Liquid is
// Jekyll's, which the stack does not run); a heading after an unread one may
// take an id one number higher. The sixth fix run's first reader (2026-11-05,
// before it reached git) stopped on many of the forms read here, or read
// them wrong (the third review of that day);
// until 2026-11-07 it stopped on the headings it now leaves unread, and gave
// a heading inside an element read as markdown no id (the final review of
// the sixth fix run: the served page's ids, Document#to_html, not the ones
// set when the file is parsed, are the links' targets).
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
  // forms the sixth fix run's first reader (2026-11-05, before it reached
  // git) stopped on
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
  // which that first reader stopped on,
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
  // a heading inside an element read as markdown takes the id kramdown's
  // HTML converter gives it (generate_id, its own counter), and one in a
  // footnote is left unread (null): until 2026-11-07 these two cases wanted
  // ["after"] and ["a", "after"], the ids set when the file is parsed, not
  // the ones the served page has
  ["<div markdown=\"1\">\n\n## Inside\n\n</div>\n\n## After", ["inside", "after"]],
  ["## A\n\nText[^1].\n\n[^1]: Note.\n\n    ## In a footnote\n\n## After", ["a", null, "after"]],
  ["<div markdown=\"1\">\n\n## 2026 notes\n\n## Café au lait\n\n## ?!\n\n## Café au lait\n\n## The `vmt_min` column\n\n## A -- B\n\n</div>\n\n## Café au lait",
    ["notes", "caf-au-lait", "section", "caf-au-lait-1", "the-vmtmin-column", "a--b", "café-au-lait"]],
  ["## Inside\n\n<div markdown=\"1\">\n\n## Inside\n\n</div>\n\n## Inside", ["inside", "inside", "inside-1"]],
  ["## A\n\n<details markdown=\"1\">\n<summary>Old</summary>\n\n### Ghost months\n\nText.\n\n</details>\n\n## B", ["a", "ghost-months", "b"]],
  ["<div markdown=\"1\">\n\n- ## In a list item\n\n</div>", ["in-a-list-item"]],
  ["<div markdown=\"1\">\n<div>\n\n## Raw\n\n</div>\n</div>\n\n## After", ["after"]],
  ["<div markdown=\"1\">\n\n## 🚧\n\n## 🚧\n\n</div>", ["section", "section-1"]],
  ["## A\n\nText[^1].\n\n[^1]: Note.\n\n    ## A\n\n## A", ["a", null, "a-1"]],
  ["## A\n\n[^1]: Note.\n\n    ## Unreferenced\n\n## B", ["a", null, "b"]],
  // an empty id is one the page does not write; a second takes -1
  ["## 🚧\n\n## 🚧\n\n## B", ["", "-1", "b"]],
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
// Forms whose effect on the file's headings the reader does not compute
// stop it, naming why.
for (const [markdown, why] of [
  ["## Before\n{: #custom}", "a kramdown extension, attribute list or attribute definition"],
  ["## Liquid {{ site.x }}", "Liquid"],
  ["## A\n\n{% if x %}\n## B\n{% endif %}", "Liquid"],
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
// A heading holding a mark whose effect on its id the reader does not
// compute is left unread, naming why: no id, none possible (until 2026-11-07
// each of these stopped the reader).
for (const [markdown, why] of [
  ["## Foo {#bar}", "an explicit id"],
  ["## `x`{: .y} z", "a kramdown attribute list or extension ({:)"],
  ["## R&amp;D", "an entity"],
  ["## A <b>bold</b> idea", "inline HTML"],
  ["## Angle a << b >> c", "a typographic << or >>"],
  ["## Math $$x--y$$", "math ($$)"],
  ["## An ![alt](x.png) image", "an image"],
  ["## [a](b c) d", "a link of a form this reader does not read"],
  ["## See [the hub][hub] notes\n\n[hub]: https://example.com", "a reference link to a label the file defines"],
  ["## A footnote[^1]\n\nText.\n\n[^1]: A note.", "a footnote the file defines"],
  ["## _Emphasis_ here", "an underscore that can open emphasis"],
  ["## The _ghost_ rows", "an underscore that can open emphasis"],
  ["Text[^1].\n\n[^1]: Note.\n\n    ## In a footnote", "a heading in a footnote"],
]) {
  let got = null, message = null;
  try { got = headingAnchors(markdown, "a synthetic file"); } catch (e) { message = e.message; }
  const left = got === null ? [] : got.filter(h => h.anchor === null && h.anchors.length === 0 && h.unread.some(w => w.includes(why)));
  if (!(got !== null && got.length === 1 && left.length === 1))
    ruleProblems.push(`${JSON.stringify(markdown)} ${message !== null ? `stops with ${JSON.stringify(message.slice(0, 300))}` : `gives ${JSON.stringify(got)}`}, want its one heading left unread, naming ${JSON.stringify(why)}`);
}
// A heading left unread may share a later heading's base, so every later id
// its renderer gives may be one number higher: each read heading after k
// unread ones has k + 1 possible ids, the first the one it has where none
// shares its base (GitHub Pages' stack gives these "rd-notes", "x", "x-1" and
// "bar", "bar").
for (const [markdown, want] of [
  ["## R&amp;D notes\n\n## X\n\n## X", [[], ["x", "x-1"], ["x-1", "x-2"]]],
  ["## Foo {#bar}\n\n## bar", [[], ["bar", "bar-1"]]],
  ["## A\n\nText[^1].\n\n[^1]: Note.\n\n    ## A\n\n## A", [["a"], [], ["a-1"]]],
]) {
  let got;
  try { got = JSON.stringify(headingAnchors(markdown, "a synthetic file").map(h => h.anchors)); }
  catch (e) { got = `a stop, ${JSON.stringify(e.message.split("Resultata: ")[1])}`; }
  if (got !== JSON.stringify(want)) ruleProblems.push(`${JSON.stringify(markdown)} gives the possible ids ${got}, want ${JSON.stringify(want)}`);
}
// The link form the page draws (crashla.js RATIONALE_LINK), whole.
const PAGE_LINK = new RegExp(`^${DATA_LINK.source}$`, "u");
// The headings data/README.md's reader leaves unread, for a message: a link
// may mean one of them, whose id is not known here.
const unreadNote = UNREAD.length === 0 ? "" : `; the reader does not know the ids of these headings, which it leaves unread: ${JSON.stringify(UNREAD.map(h => ({line: h.line, heading: h.heading, why: h.unread})))}`;
// What is wrong with a link, given the ids of the headings, or null.
const linkProblem = (link, anchors) => {
  const anchor = /^data\/#(.*)$/.exec(link.target)?.[1];
  return link.text.trim() === "" ? "has no text but blanks"
    : anchor === undefined ? "targets no section of data/README.md (a target is data/#<anchor>)"
    : !anchors.includes(anchor) ? `names no heading of data/README.md (no heading's id is ${JSON.stringify(anchor)}; the ids are ${JSON.stringify(anchors)}${unreadNote})`
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
//     (LINES_MEANT) or its clause names (LINE_WORDS), or for Waymo the hub's
//     figure an anchor gives, to its stated precision, or as a floor, a
//     ceiling or approximate where the words right before it say so
//     (MODIFIERS); one that is none of those goes unchecked where it may be a
//     reading the rows do not hold: the lifetime in a month one of those
//     lines has no row for, where the line's growth allows it then
//     (growthReading), a Waymo hub figure no anchor gives (at most the
//     lifetime, and after Waymo's rows anything), where its words leave the
//     hub among its meanings (hubMeant), a line its clause names that has no
//     rows, or another owner, its clause holding a word that is not one of
//     OWN_WORDS, its clause being, where a pronoun or a noun that names no
//     owner refers back, its sentence's clauses before it too (or the
//     sentence before) and what a parenthesis follows (ownerOf; since
//     2026-11-05; until then the row's line's series cumulative only; until
//     that day's round-1 review a figure that was none of the readings
//     failed whatever its words, and "more than" or "~" before it was not
//     read; until its round-2 review a pronoun read nothing it refers to, and
//     thousands commas before a unit, "1,717k", stopped the number; until the
//     round-3 review of 2026-11-06 a month with no row on those lines left a
//     figure unchecked whatever it was, the hub's unknown figure was a
//     meaning whatever the words, and a Zoox lifetime whose pre-series miles
//     no rationale stated was one too);
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
//     <Mon>-<YYYY>", its clause ending after the month at a semicolon, a stop
//     or a closing parenthesis, is the hub figure every anchor for that month
//     uses (the April-June 2026 rows; since 2026-11-05 read only after
//     "update: ", which makes it the hub update's total; since that day's
//     round-1 review not where a comma follows the month, after which words
//     can make it a part's); with no anchor for that month in any rationale
//     it goes unchecked (the pass line counts it so);
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
//     lifetime (the cumulative plus the pre-series offset, any amount in
//     OFFSET's range) at least N million less one mile at the end of that day
//     (a floor, so no rounding slack) on the month's even spread with
//     OFFSET's high edge; one that only some uneven path through the month
//     clears by that day, the lifetime at its month's end with that edge
//     clearing it, goes unchecked, since the rows hold no path within a
//     month (since 2026-11-06; from the round-2 review of 2026-11-05 until
//     then the month's end cleared it; until that review the month's even
//     spread with OFFSET's central, which a correct floor could fail where
//     the series drove more of the month by that day or the offset was
//     larger), the day's month being any month data/vmt.csv has a
//     row for, a ghost month included (the July-September 2026 rows, for
//     Alphabet's Oct 28, 2026 remarks; October's ghost row gives the same
//     floor with its date before the quote and no year, which this does not
//     read); for a day after the rows, the floor is cleared where the last
//     earlier row's lifetime at its month's end clears it, and otherwise goes
//     unchecked (since the round-1 review of 2026-11-05; until then such a
//     day failed); for a day before the series, when the lifetime was at most
//     OFFSET's high edge, a floor no higher goes unchecked and a higher one
//     fails (since the round-3 review of 2026-11-06; until then any floor of
//     such a day went unchecked); a day no month of its name has (0, 32, Nov
//     31) fails (since the round-2 review). The frame
//     starts at "floor the series clears" because a rationale may also quote
//     a floor the series does not clear, to say so;
//   a Waymo row's total and daily rate: "Total <x>M, about <y>k a day (...)",
//     the parenthesis right after it holding no other and holding
//     "<Monthname>'s row <digit>", is its miles and its miles over its days,
//     the rate, which its "about" marks approximate, to one unit of its last
//     digit (since the round-2 review of 2026-11-05; until then to half a
//     unit) (October 2026's ghost row: "Total 22.25M, about 718k a day (September's
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
//     <w>k" the miles over the days of a quarter n, any year's whose three
//     months have rows (since the round-1 review of 2026-11-05, as a month
//     named without its year is read; until then the latest quarter n ending
//     at or before the row's month, which a rationale reused a year later
//     reads as the quarter after it; until a review later on 2026-11-03 the
//     row's own year's, which failed a January row's "measured Q3");
//   a month and its week: "Cross-check: <x>M/mo ≈ <y>M/wk" in a Waymo row has
//     x and y agree, x times 7 over a month's days being y, x to its
//     precision and y, which the "≈" marks approximate, to one unit of its
//     last digit, whoever's they are, for a month of 28 to 31 days or the
//     average month, 365.25/12 days; and with " vs Waymo's" after it,
//     setting them beside a fleet figure of Waymo's, they are its miles and
//     its miles times 7 over its days or the average month's (September
//     2026's row, against Waymo's weekly floor; the rationales give
//     components' monthly rates as "<x>M/mo" too, so the frame starts at
//     "Cross-check:"; until 2026-11-05 every such pair was read as the row's;
//     until that day's round-1 review each pair agreed for the row's days
//     only, y to half a unit);
//   band multipliers: a Waymo row's "Band x<lo> to x<hi>", followed later in
//     its sentence (which a stop not followed by a digit ends and a
//     semicolon does not) by "the components' ranges combined", is its band over its
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
//     a labelled term (until then the five or six terms it named were read,
//     so a term it did not name was left out of the sum): a list with any
//     other figure there goes unchecked (the comment at its code says what a
//     term is; the April-October 2026 rows). The list's form names its
//     components, CA's, Maricopa's, Travis's, Atlanta's and the metros' terms
//     and an "about" term after " and " (the start frame's sixth); any other
//     labelled term may be one more component or a part of one, so the list
//     holds when its components plus any choice of the others sum to its
//     miles (since the round-1 review of 2026-11-05; from earlier that day
//     until then every labelled term was summed, so a correct part failed);
//   a CPUC product: in a Waymo row, "CPUC Q<n>-<YYYY> driverless actual <d>
//     deployment + <p> pilot (...) x <f>, ... = <r>M" has (d + p) x f equal
//     to r, to r's precision plus d + p times half a unit of f's last digit
//     (until 2026-11-07 the stated figures taken as exact); and d and p
//     are one month's deployment and pilot miles of that quarter in
//     data/waymo-ca.csv, or their sums over two or three of its months, each
//     to half a mile either way for each month summed (since 2026-11-05 any
//     month of the quarter, and since that day's round-1 review a sum too;
//     until then the row's month, in the row's quarter only); a base that is
//     no such figure of the file, in a quarter whose three months it does
//     not all hold, goes unchecked, and the pass line counts it so (the
//     April-June 2026 rows);
//   a product: in any row, "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[
//     [<range>]] = <r>M", f a decimal or a ratio a/b and b any "<num>M" at
//     depth 0 of its clause from its leftmost one to " x" (since the round-1
//     review of 2026-11-05; until then the leftmost, and from earlier that
//     day the one right before " x"), has b x f equal to r for one b, to r's
//     precision plus what half a unit of the last digit of b and of f
//     moves the product (until 2026-11-07 the stated figures taken as
//     exact); the result can be the next product's base (the July-October 2026 Waymo
//     rows' CA terms; October's "10.4M CPUC-basis x 31/30 = 10.75M x the
//     hub-vs-CPUC CA ratio 1.0576 = 11.37M" is two);
//   a month by its name, in any row, whole miles exactly, read as any month
//     of that name with a row, in the row's line or, for a Tesla line, either
//     Tesla line (namedRows; since the round-1 review of 2026-11-05; from
//     earlier that day the month of that name within 11 months either way of
//     the row's; until then that month of the row's year in the row's line),
//     the figure holding for any of them, and where the month of that name
//     nearest the row's (or another row's sharing the rationale) has no row,
//     one no row bears out goes unchecked where it may be that month's
//     (beyondNamed: after the line's last row each cumulative or band edge at
//     least the last row's, before its first at most its pre-series miles, a
//     month's own miles anything; since the round-3 review of 2026-11-06,
//     until then whatever its value; for "a floor through a month's end",
//     below, still whatever its value, beyondRows): "<Month> keeps <source>'s
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
//     approximate lifetimes (and on 2026-11-06 a path's lifetime on a day,
//     "puts <n> lifetime miles at <Mon> <D>", and a month's days out, "leaves
//     out <Mon> <a>-<b>"), a floor only one deck's reading meets, a crash
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
  "a row's central", "a lifetime milestone", "a path's lifetime on a day", "an approximate lifetime", "Zoox's pre-series miles", "a month's days out", "a floor one reading meets",
  "a crash count at a rate", "a band's approximate shares", "a floor an approximate share below",
  "a quarter's split", "a quarter's run-rate", "a month at another's per-day rates",
  "a month at its daily rates"].map(f => [f, []]));
// statements found in their frames but with nothing to read them against,
// which the pass line counts: a month-end figure that is none of the known
// readings, perhaps the lifetime in a month a line it may mean has no row for
// (the line's growth allowing it then), a Waymo hub figure no anchor gives (at
// most the lifetime, and after the rows anything) where its words leave the
// hub among its meanings, a figure of a line its clause names that has no
// rows, or another owner's, its clause, or what it refers back to, naming one
// (end of a month or year); a figure of a month by its name that no row bears
// out, where the nearest month of that name has no row and the figure may be
// that month's (a month by its name, for the named forms, and for the floor
// through a month's end whatever its value); a lifetime on a day no reading
// bears out where some other path through its month would (away from the Zoox
// model's path), it may be the hub's unknown figure, a lifetime in a month of
// that name a line has no row for may be it, its clause names another owner
// (away from the model's path) or a line with no rows (a lifetime milestone, a
// path's lifetime on a day); a floor, central or top after a page reading that
// no month it may mean bears out but another month's row does (a month's
// floor, central or top); no anchor sentence for its month (Waymo anchor band,
// hub figure); a floor dated after the rows that the last row's lifetime does
// not clear, one dated before the series no higher than OFFSET's high edge, or
// one that only its month's end clears (floor the series clears); a base that
// is none of the figures of its quarter data/waymo-ca.csv holds, the file
// lacking one of the quarter's months (CPUC base); a list holding a figure
// that is no labelled term (Waymo terms); a page reading none of its readings
// bears out with words before its month other than month names and range words
// (perhaps a part), or below its month's floor with no deck reading beside it
// (perhaps a month in progress), or no row for the month on the no-monitor
// line (a page reading); no row for the month on both Tesla lines (a
// monitor-aboard remainder, a monitor-aboard share) or on the no-monitor line
// (a projected month's band); no row for its month where the lifetime may be
// it then, or a figure only some uneven path through its month bears out (an
// approximate lifetime); no list of decks, or no readings of the month (a
// floor one reading meets, a floor an approximate share below); no deck
// reading beside a page reading before it (a top from a reading); a split
// pairing its terms with another number of totals, naming a quarter the row's
// month is not in, or in a quarter not every month of which states it (a
// quarter's split); no split increment for that quarter (a quarter's
// run-rate); and the row's own list unread, an "about" term, a term with no
// term of its label in the month named, a parenthesis this does not read, or a
// term with no adjustment of its own that no signed sum of the figures stated
// elsewhere bears out, its label standing elsewhere in the rationale too (a
// month at another's per-day rates)
const unchecked = Object.fromEntries(["end of a month or year", "a month by its name", "Waymo anchor band", "hub figure", "floor the series clears", "CPUC base", "Waymo terms",
  "a page reading", "a month's floor, central or top", "a monitor-aboard remainder", "a monitor-aboard share", "a projected month's band",
  "a lifetime milestone", "a path's lifetime on a day", "an approximate lifetime", "a floor one reading meets", "a floor an approximate share below",
  "a top from a reading", "a quarter's split", "a quarter's run-rate", "a month at another's per-day rates"].map(f => [f, []]));
const UNIT = { k: thousands, M: millions };
const within = (stated, actual, slack) => Math.abs(stated - actual) <= slack;
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const waymo = rows.filter(x => x.helmer === "waymo");
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
const MON_NAMES = Object.keys(MON); // "Jan" to "Dec", in order
const LONGEST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // the most days a month of each name has
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
// A month a rationale names without its year is any month of that name
// data/vmt.csv has a row for, on any line, a figure being read as any one's
// (since the round-1 review of 2026-11-05): the words name no year, so every
// year is a meaning they could have, and a rationale shared by rows a year or
// more apart, or reused in a later year's row, reads the months it was
// written for. From earlier on 2026-11-05 until then it was the month of that
// name within 11 months of the row's either way, which failed a shared
// rationale naming a month 12-14 months from some of its rows (Zoox's
// June-November 2025 rationale naming Aug 5, 2026); until then that month of
// the row's year, which read a January row's "December" as the December
// after it. A corrupted figure still fails unless it is another year's.
const MONTHS = [...new Set(rows.map(x => x.month))].sort();
const monthsNamed = n => MONTHS.filter(m => Number(m.slice(5, 7)) === n + 1);
// And where the month of that name nearest the row's (both on a tie), or the
// nearest month of that name to another row sharing the rationale, has no row
// on any line the figure may be read in (before a series starts, or after its
// data), the figure may be that month's, which the rows cannot bear out: a
// floor through a month's end that no row bears out goes unchecked there
// rather than failing (beyondRows; since the round-1 review of 2026-11-05),
// and in the forms that read a month by its name and the lifetimes on a day,
// such a figure goes unchecked only where the line's growth allows it then,
// after the line's last row at least its cumulative and before its first at
// most its pre-series miles, and fails otherwise (beyondNamed and
// growthReading, since the round-3 review of 2026-11-06; until 2026-11-07
// this comment said every such form left the figure unchecked).
const monthIndex = m => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthOf = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
// The months of name n (0 for January) nearest month `from`, both on a tie,
// among those holding day d (since the round-3 review of 2026-11-06, so that
// a Feb 29 is a leap year's; until then any month of the name, within a
// year either way)
const nearestNamed = (from, n, d) => {
  const near = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(dy => (Number(from.slice(0, 4)) + dy) * 12 + n).filter(i => d <= daysIn(monthOf(i)));
  const gap = i => Math.abs(i - monthIndex(from));
  return near.filter(i => gap(i) === Math.min(...near.map(gap))).map(monthOf);
};
const beyondRows = (r, n, lines) => rows.filter(x => x.rationale === r.rationale)
  .some(x => nearestNamed(x.month, n, 1).some(month => lines.every(line => rowOf(line, month) === undefined)));
// The lines a row's rationale may mean where a frame names none (since
// 2026-11-05): its own, and for the two Tesla lines either one, since each
// one's rationales state the other's figures (until then the row's own line).
const LINES_MEANT = { tesla: ["tesla", "teslanomonitor"], teslanomonitor: ["teslanomonitor", "tesla"], waymo: ["waymo"], zoox: ["zoox"] };
const unmeant = [...new Set(rows.map(r => r.helmer))].filter(h => LINES_MEANT[h] === undefined);
assert.deepEqual(unmeant, [],
  `Replicata: read data/vmt.csv's lines. Expectata: each one in LINES_MEANT, the lines its rationales may mean. Resultata: not there: ${JSON.stringify(unmeant)}.`);
// The rows a month's name (n, 0 for January) may mean in row r's rationale
const namedRows = (r, n) => LINES_MEANT[r.helmer].flatMap(line => monthsNamed(n).map(month => rowOf(line, month)))
  .filter(x => x !== undefined);
const cumeAndBand = row => row === undefined ? "(no row)" : `${fmt(row.cume)}, its band ${fmt(row.kmin)} to ${fmt(row.kmax)}`;
const rowsNote = list => list.length === 0 ? "no row of a month of that name"
  : list.map(x => `${x.helmer} ${x.month}: miles ${fmt(x.vmt)} (band ${fmt(x.vmin)} to ${fmt(x.vmax)}), cumulative ${cumeAndBand(x)}`).join("; ");
// Whether some choice of one item from each list passes the test
const someCombination = (lists, test, picked = []) => picked.length === lists.length
  ? test(picked) : lists[picked.length].some(x => someCombination(lists, test, [...picked, x]));
// The pre-series miles a line's lifetime adds to its series cumulative, each
// a range with a note for messages: Waymo's OFFSET range; Zoox's the Zoox
// model's, quals/zoox-vmt-model.qual.mjs's PRE_C, "its central, as the
// series counts it", which its lifetimes count; and none for the Tesla lines,
// whose series start with their service. Each Zoox statement of them ("the
// <o> pre-series miles", "the <o> earlier driverless miles", "the <o>
// driverless miles before it", never a possessive "miles'") gives PRE_C, or
// a figure of the model's band of them, PRE (its low or high edge, or its
// California or Las Vegas part: the band runs from CA + 0.5 x LV to CA + 2 x
// LV, so the parts are read from its edges), to its precision, a whole
// number that may be rounded, to half a unit of its last nonzero digit
// ("40,080" 40,075 to 40,085; "the 40,000 earlier driverless miles" 39,500
// to 40,500); one qualified by the words right after it ("in California",
// "of them") may state a part of them, so it is not read (until 2026-11-07
// PRE_C alone, so a correct statement of the band's high edge, "the 59,987
// pre-series miles, their band's high edge", or of California's part in the
// words of the whole failed). (Since the round-3 review of 2026-11-06, which found PRE_C in a file
// this qual reads; from the round-2 review of 2026-11-05 until then the
// statements had only to agree, some one figure within the precision of
// each, so all of them moved together passed, and where none was readable
// the miles were unknown; from that day's round-1 review until then the
// row's own statements or else any Zoox rationale's; from earlier that day
// until the round-1 review the row's own only, and "the <o> driverless
// miles" in any words, which other driverless miles can be.)
const PRE_C = constantOf("quals/zoox-vmt-model.qual.mjs", "PRE_C");
assert.ok(typeof PRE_C === "number" && Number.isFinite(PRE_C) && PRE_C > 0,
  `Replicata: read PRE_C in quals/zoox-vmt-model.qual.mjs. Expectata: a positive number of miles, Zoox's pre-series driverless miles as its series counts them. Resultata: ${String(PRE_C)}.`);
const PRE_BAND = constantOf("quals/zoox-vmt-model.qual.mjs", "PRE");
assert.ok(Array.isArray(PRE_BAND) && PRE_BAND.length === 2 && PRE_BAND.every(Number.isFinite) && PRE_BAND[0] < PRE_C && PRE_C < PRE_BAND[1],
  `Replicata: read PRE in quals/zoox-vmt-model.qual.mjs. Expectata: the band [low, high] of Zoox's pre-series miles, around PRE_C. Resultata: ${JSON.stringify(PRE_BAND)}.`);
const PRE_LV = (PRE_BAND[1] - PRE_BAND[0]) / 1.5, PRE_CA = PRE_BAND[0] - 0.5 * PRE_LV;
assert.ok(Math.abs(PRE_CA + PRE_LV - PRE_C) <= 1,
  `Replicata: split PRE's band into its California and Las Vegas parts (CA + 0.5 x LV to CA + 2 x LV). Expectata: parts summing to PRE_C, ${PRE_C}. Resultata: ${PRE_CA} + ${PRE_LV}.`);
const PRE_MEANINGS = [PRE_C, ...PRE_BAND, PRE_CA, PRE_LV];
const ZOOX_PRE = new RegExp(String.raw`\bthe ${WHOLE} (?:pre-series miles|earlier driverless miles|driverless miles before it)\b(?!'| (?:in|of|on|at|from|for|by|across|outside|within|among|between)\b)`, "g");
for (const x of rows.filter(y => y.helmer === "zoox")) for (const m of x.rationale.matchAll(ZOOX_PRE)) {
  figureForms["Zoox's pre-series miles"].push(`zoox ${x.month}`);
  const pre = roundedWhole(m[1]);
  if (!PRE_MEANINGS.some(v => within(pre.miles, v, pre.slack))) {
    figureErrors.push(`zoox ${x.month}: "${m[0]}" vs the Zoox model's pre-series miles, quals/zoox-vmt-model.qual.mjs's PRE_C, ${fmt(PRE_C)}, or a figure of its band PRE (edges ${fmt(PRE_BAND[0])} and ${fmt(PRE_BAND[1])}, parts California ${fmt(PRE_CA)} and Las Vegas ${fmt(PRE_LV)}) (the statement's precision ${fmt(pre.slack)})`);
  }
}
const PRE_SERIES = {
  waymo: [{ low: OFFSET.low, high: OFFSET.high, note: `${fmt(OFFSET.low)}-${fmt(OFFSET.high)}` }],
  zoox: [{ low: PRE_C, high: PRE_C, note: fmt(PRE_C) }],
  tesla: [],
  teslanomonitor: [],
};
const noPre = Object.values(LINES_MEANT).flat().filter(line => PRE_SERIES[line] === undefined);
assert.deepEqual(noPre, [],
  `Replicata: read the lines LINES_MEANT names. Expectata: each one in PRE_SERIES, the rule for its pre-series miles. Resultata: not there: ${JSON.stringify(noPre)}.`);
// A line's lifetime at the end of day d of row x's month, its month's miles
// spread evenly over its days, for pre-series miles o
const lifetimeOf = (x, d, o) => x.cume - x.vmt + x.vmt * d / daysIn(x.month) + o;
// A quarter's months, and a quarter named without its year read as any
// year's quarter q, as a month named without its year is (since the round-1
// review of 2026-11-05; until then the latest quarter q ending at or before
// the row's month, so a rationale reused in a later year's row read the
// quarter after the one it was written for)
const quarterMonths = (year, q) => [1, 2, 3].map(i => `${year}-${String(3 * (q - 1) + i).padStart(2, "0")}`);
const quartersNamed = q => [...new Set(MONTHS.map(m => m.slice(0, 4)))].map(year => quarterMonths(year, q));

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
// The clause around a span [at, end) of a text (since the round-1 review of
// 2026-11-05): inside the innermost parenthesis or bracket holding the span,
// or the whole text, cut at semicolons and at stops before a space and a
// capital letter or at the text's end, so that an abbreviation's stop
// ("Maricopa Co.") or a decimal point cuts nothing (since the round-2 review
// of that day; until then any stop not followed by a digit), the groups
// nested in it stepped over. Its words before the span; its words after the
// span up to the clause's next comma; for a span in a parenthesis' first
// clause, the words before the parenthesis in the clause it follows (what the
// parenthesis says something about); and what a pronoun in it may refer to
// (since the round-2 review): its sentence's clauses before it, or, where it
// opens its sentence, the sentence before.
const groupSpans = s => {
  const spans = [], open = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" || s[i] === "[") open.push(i);
    if ((s[i] === ")" || s[i] === "]") && open.length > 0) spans.push([open.pop(), i]);
  }
  return spans;
};
const clauseAround = (s, at, end) => {
  const spans = groupSpans(s), inner = spans.filter(([o, c]) => o < at && end <= c).sort((a, b) => b[0] - a[0])[0];
  const [from, to] = inner === undefined ? [0, s.length] : [inner[0] + 1, inner[1]];
  const nested = spans.filter(([o, c]) => from <= o && c < to);
  const blank = s.split("").map((ch, i) => nested.some(([o, c]) => o <= i && i <= c) ? " " : ch).join("");
  const cuts = [...blank.slice(from, to).matchAll(/;|\.(?=\s+[A-Z]|\s*$)/g)].map(c => from + c.index);
  const start = Math.max(from, ...cuts.filter(c => c < at).map(c => c + 1)), stop = Math.min(to, ...cuts.filter(c => c >= end));
  // where the sentence holding the clause starts, and the one before it
  const stops = cuts.filter(c => s[c] === ".").map(c => c + 1);
  const sentence = Math.max(from, ...stops.filter(c => c <= start)), previous = Math.max(from, ...stops.filter(c => c < sentence));
  const firstClause = inner !== undefined && s[inner[0]] === "(" && !cuts.some(c => c < at);
  return { before: s.slice(start, at), after: s.slice(end, end + blank.slice(end, stop).split(",")[0].length),
    antecedent: firstClause ? clauseAround(s, inner[0], inner[0]).before : "",
    earlier: s.slice(sentence < start ? sentence : previous, start) };
};
// A clause's words, lowercased, the end-of-month figures in it left out; a
// figure is never part of a longer number, and one with thousands commas
// before its unit ("1,717k") is read whole (since the round-2 review of
// 2026-11-05; until then "1,717k end-Mar-2026" read 717k)
const EOM = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)([kM]) end-(?:([A-Z][a-z]{2})-)?(\d{4})\b/g;
const wordsOf = s => [...s.replace(EOM, " ").toLowerCase().matchAll(/(?<![\d.,])[a-z][a-z'-]*/g)].map(w => w[0]);
// The words a clause may hold around a month-end figure, besides a modifier
// right before it (MODIFIERS), and still say it is a reading of the row's own
// line: function words, pronouns and verbs, which name no owner, and the
// readings' and the lines' names; and, among them, the nouns that say whose
// figure it is, the pronouns, which leave it to what they refer to, and the
// nouns that name no owner ("the total", "the figure"), which leave it so
// where no noun of a reading or a line stands beside them (since the round-2
// review of 2026-11-05; until then "total" and "figure" said it was the row's
// line's, and a pronoun read nothing it refers to, so a deck's "the total"
// and a county's "...; it stood at" failed as the row's line's). Any other
// word may name another owner: a county or a city, another series, or a
// deck's or a page's reading.
const OWN_WORDS = new Set(["the", "its", "it", "itself", "this", "that", "they", "their", "these", "those", "a", "an", "own",
  "is", "was", "are", "were", "be", "stood", "stands", "stand", "gave", "gives", "put", "puts", "came", "comes", "grew", "grows",
  "rose", "rises", "fell", "falls", "ran", "runs", "had", "has", "have", "held", "holds",
  "at", "of", "as", "and", "then", "by", "with", "to", "so",
  "hub", "hub's", "figure", "total", "cumulative", "lifetime", "series", "series'", "line", "line's", "no-monitor",
  "tesla", "tesla's", "waymo", "waymo's", "zoox", "zoox's"]);
const OWN_NOUNS = new Set(["hub", "hub's", "cumulative", "lifetime", "series", "series'", "line", "line's",
  "no-monitor", "tesla", "tesla's", "waymo", "waymo's", "zoox", "zoox's"]);
// Words that name no other owner either, beside OWN_WORDS: prepositions,
// adverbs, months' names and words that set one figure beside another
// (PLAIN, which the lifetimes on a day read too); and, in the month-end
// form, "miles" and "most", which name what the figure counts or its share
// (MONTH_END_OWN; since 2026-11-07, until then such a word in a month-end
// figure's clause read as another owner, so a corrupted "lifetime miles
// 1.817M end-Mar-2026" or "1.817M end-Mar-2026 and most in March" went
// unchecked).
const PLAIN = new Set(["on", "in", "for", "from", "through", "after", "before", "since", "until", "about", "around", "still",
  "already", "only", "just", "now", "when", "where", "which", "comparison", "contrast", "scale",
  ...MONTH_NAMES.map(x => x.toLowerCase()), ...MON_NAMES.map(x => x.toLowerCase())]);
const MONTH_END_OWN = new Set([...OWN_WORDS, ...PLAIN, "miles", "most"]);
const PRONOUNS = new Set(["it", "its", "this", "that", "they", "their", "these", "those"]);
const GENERIC_NOUNS = new Set(["total", "figure"]);
// Whether a clause's words leave Waymo's hub figure, which counts a part of
// Waymo's miles, among the meanings of its figure: unless they name the
// series, the rows' own reading ("the series", "the line"), and not the hub
// (since the round-3 review of 2026-11-06; until then "the series stood at
// <x>M end-<Mon>-<YYYY>" in a Waymo row could be the hub's unknown figure, so
// a wrong figure at most the lifetime went unchecked). "Cumulative" and
// "lifetime" leave it: Waymo's published total is its cumulative, lifetime
// rider-only miles in the places the hub counts.
const SERIES_NOUNS = new Set(["series", "series'", "line", "line's"]), HUB_NOUNS = new Set(["hub", "hub's"]);
const hubMeant = words => words.some(w => HUB_NOUNS.has(w)) || !words.some(w => SERIES_NOUNS.has(w));
// Whose figure a clause states, from the clause's words around the figure
// (words), the text before a parenthesis whose first clause it is
// (antecedent) and the clauses before it (earlier), given the nouns that say
// whose figure it is (nouns) and the words that name no other owner (own): a
// noun of those in it says so; a pronoun, or a noun that names no owner
// (GENERIC_NOUNS) with none of those beside it, refers back, to the clauses
// before it and what a parenthesis follows; with neither, a parenthesis'
// first clause speaks of what the parenthesis follows. It gives whether the
// clause refers back (refers), the words that may name its owner's line
// (named), and those that may name another owner (others). (Since the round-2
// review of 2026-11-05 for the end of a month; since the round-3 review of
// 2026-11-06, in this one function, for lifetimes on a day too.)
const ownerOf = (words, antecedent, earlier, nouns, own) => {
  const owned = words.some(w => nouns.has(w)), refers = words.some(w => PRONOUNS.has(w)) || (!owned && words.some(w => GENERIC_NOUNS.has(w)));
  const back = refers ? wordsOf(earlier) : [];
  return { refers, named: [...words, ...wordsOf(antecedent), ...back],
    others: [...words, ...back, ...(owned && !refers ? [] : wordsOf(antecedent))].filter(w => !own.has(w)) };
};
// The lines a word names
const LINE_WORDS = { "tesla": ["tesla", "teslanomonitor"], "tesla's": ["tesla", "teslanomonitor"], "waymo": ["waymo"], "waymo's": ["waymo"],
  "zoox": ["zoox"], "zoox's": ["zoox"], "no-monitor": ["teslanomonitor"] };
// The lines a figure may be a reading of, given the words that may name its
// owner: those the row may mean (LINES_MEANT) and those the words name
// (LINE_WORDS), but for lines data/vmt.csv has no rows of; and, apart, the
// lines the words name that have none (absent), against which a figure has
// nothing to be read, so that a miss goes unchecked (since the round-3 review
// of 2026-11-06; until then such a line stopped the lifetime forms with a
// TypeError, as data/vmt.csv before 2026-10-24, which has no no-monitor
// line, would)
const linesFor = (r, named) => {
  const namedLines = Object.entries(LINE_WORDS).filter(([w]) => named.includes(w)).flatMap(([, ls]) => ls);
  const has = line => rows.some(x => x.helmer === line);
  return { lines: [...new Set([...LINES_MEANT[r.helmer], ...namedLines])].filter(has), absent: [...new Set(namedLines)].filter(line => !has(line)) };
};
// The series alone, with no pre-series miles, as a pre-series range
const NONE = { low: 0, high: 0, note: "none" };
// What a line's lifetime or cumulative may be in a month it has no row for,
// given pre-series ranges pre (the series alone being NONE): the lifetime
// only grows, so after its last row it is at least that row's cumulative
// plus the least pre-series amount, and before its first row, the series not
// begun, at most the most; and where a Waymo hub figure may be meant (hub),
// after the rows anything, since the hub counts a part of Waymo's miles. Each
// such reading is unknown: a figure inside it may be its, which the rows
// cannot bear out (since the round-3 review of 2026-11-06 for the end of a
// month too; from 2026-11-06 until then for lifetimes on a day only, so that
// a month-end figure in a month the rows do not reach went unchecked
// whatever its value; the floor the series clears and the named forms read
// the same bound in their own terms).
const growthReading = (line, month, pre, hub) => {
  const own = rows.filter(x => x.helmer === line), last = own.at(-1);
  assert.ok(month > last.month || month < own[0].month,
    `Replicata: read ${line}'s months in data/vmt.csv for ${month}. Expectata: a row for every month from its first, ${own[0].month}, to its last, ${last.month}. Resultata: none for ${month}.`);
  return month > last.month
    ? { what: `${line} after its last row, ${last.month}`, lo: hub ? 0 : last.cume + Math.min(...pre.map(p => p.low)), hi: Infinity, unknown: true }
    : { what: `${line} before its first row, ${own[0].month}`, lo: 0, hi: Math.max(...pre.map(p => p.high)), unknown: true };
};
// A reading's words and range, for a message
const readingNote = x => `${x.what}: ${x.lo === x.hi ? fmt(x.lo) : `${milesOf(x.lo)} to ${milesOf(x.hi)}`}`;
// What a stated figure x (miles, slack) and the words right before it in
// its clause make it: a floor ("more than", "over", "at least", "above",
// "past", "beyond", and "reached", "passed", "crossed", "topped" or
// "exceeded", which can also give the value itself, which a floor admits),
// a ceiling ("less than", "under", "below", "at most", "up to"), approximate
// ("~", "about", "nearly", "approximately", "roughly", "almost", "around": one
// unit of its last digit, as a "~" elsewhere) or exact (to its stated
// precision); the first that matches
const MODIFIERS = [
  { re: /\b(?:more than|over|at least|above|past|beyond|reached|reaches|passed|passes|crossed|crosses|topped|tops|exceeded|exceeds) $/,
    how: "a floor", interval: x => [x.miles - 1, Infinity] },
  { re: /\b(?:less than|under|below|at most|up to) $/, how: "a ceiling", interval: x => [-Infinity, x.miles + 1] },
  { re: /(?:~|\b(?:about|nearly|approximately|roughly|almost|around) )$/, how: "approximate", interval: (x, unit) => [x.miles - unit - 1, x.miles + unit + 1] },
  { re: /$/, how: "to its stated precision", interval: x => [x.miles - x.slack, x.miles + x.slack] },
];
// End of a month or year, any line: what the figure may be (since 2026-11-05;
// until then only the row's line's series cumulative; restated again in the
// round-1 review of 2026-11-05). Its known readings: the series cumulative
// and the lifetime (the cumulative plus its pre-series miles) of each line
// the row may mean (LINES_MEANT) or its clause names (LINE_WORDS), and for
// Waymo the hub's figure an anchor gives for the month. A figure passes when
// its interval (MODIFIERS) meets one of them. One that meets none is no
// reading of the rows where its clause holds only OWN_WORDS; it goes
// unchecked, rather than failing, where it may be a reading the rows do not
// hold: in a month one of those lines has no row for, where the lifetime may
// be it then (growthReading: after the line's last row at least its
// cumulative, before its first at most its pre-series miles; since the
// round-3 review of 2026-11-06, until then whatever the figure), in a Waymo
// month whose hub figure no anchor gives (the hub's figure is then unknown,
// but the hub counts a part of Waymo's miles, so it is at most the lifetime:
// a figure no higher may be the hub's), where its clause names a line
// data/vmt.csv has no rows of, and where its clause holds another word, which
// may name another owner (until the round-1 review of 2026-11-05 a county's,
// Tesla's Bay Area series', another company's and a deck's figure failed as
// the row's line's).
const monthEndReadings = (lines, month, hub) => [
  ...lines.flatMap(line => [rowOf(line, month)].filter(x => x !== undefined).flatMap(x => [
    { what: `${line}'s cumulative`, lo: x.cume, hi: x.cume },
    ...PRE_SERIES[line].map(p => ({ what: `${line}'s lifetime (pre-series miles ${p.note})`, lo: x.cume + p.low, hi: x.cume + p.high })),
  ])),
  ...lines.filter(line => rowOf(line, month) === undefined).map(line => growthReading(line, month, [...PRE_SERIES[line], NONE], hub && line === "waymo")),
  ...hubFigures.filter(h => lines.includes("waymo") && h.month === month)
    .filter((h, i, all) => all.findIndex(g => g.hub.stated === h.hub.stated) === i) // each figure once
    .map(h => ({ what: "the hub's figure", lo: h.hub.miles - h.hub.slack, hi: h.hub.miles + h.hub.slack })),
  ...[rowOf("waymo", month)].filter(x => x !== undefined && hub && lines.includes("waymo") && !hubFigures.some(h => h.month === month))
    .map(x => ({ what: "the hub's figure, which no anchor gives, at most the lifetime", lo: 0, hi: x.cume + OFFSET.high, unknown: true })),
];
for (const r of rows) {
  for (const m of r.rationale.matchAll(EOM)) {
    const month = `${m[4]}-${m[3] === undefined ? "12" : MON[m[3]]}`, stated = UNIT[m[2]](m[1]);
    const { before, after, antecedent, earlier } = clauseAround(r.rationale, m.index, m.index + m[0].length);
    const modifier = MODIFIERS.find(x => x.re.test(before)), [lo, hi] = modifier.interval(stated, 10 ** ({ k: 3, M: 6 }[m[2]] - decimals(m[1])));
    // whose figure it is (ownerOf), the modifier left out of its words
    const words = wordsOf(`${before.replace(modifier.re, "")} ${after}`);
    const { named, others } = ownerOf(words, antecedent, earlier, OWN_NOUNS, MONTH_END_OWN);
    const { lines, absent } = linesFor(r, named);
    const readings = monthEndReadings(lines, month, hubMeant(named)), meets = x => lo <= x.hi && x.lo <= hi;
    const reached = readings.some(x => !x.unknown && meets(x));
    // a reading the rows do not hold may be its: a lifetime in a month a line
    // has no row for, a Waymo hub figure no anchor gives, a line with no rows,
    // or another owner its words name
    const unread = readings.some(x => x.unknown && meets(x)) || absent.length > 0 || others.length > 0;
    if (!reached && unread) {
      unchecked["end of a month or year"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["end of a month or year"].push(`${r.helmer} ${r.month}`);
    if (!reached) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" (${modifier.how}) vs ${readings.map(readingNote).join("; ")}`);
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
  // the hub update's total, and with its clause ending after the month at a
  // semicolon, a stop or a closing parenthesis (since 2026-11-05; since the
  // round-1 review of that day not at a comma, after which words can make it
  // a part's, "..., Maricopa's share"; header).
  for (const m of r.rationale.matchAll(/\bupdate: (\d+(?:\.\d+)?)M rider-only miles thru ([A-Z][a-z]{2})-(\d{4})(?=[;)]|\.(?!\d)|$)/g)) {
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
    const floor = Number(m[1]) * 1e6, day = Number(m[3]), month = `${m[4]}-${MON[m[2]]}`, row = rowOf("waymo", month);
    // a day after the rows: the lifetime then is at least the last earlier
    // row's at its month's end, so a floor no higher is cleared, and one
    // higher may be, which the rows cannot tell (since the round-1 review of
    // 2026-11-05; until then a day with no row failed); a day before the
    // series: the lifetime then is at most the pre-series offset's high edge,
    // so only a floor no higher may be cleared (since the round-3 review of
    // 2026-11-06; until then any floor of such a day went unchecked)
    const earlier = waymo.filter(x => x.month < month).at(-1);
    // the lifetime at a month's end with the pre-series offset's high edge,
    // the most the series' lifetime can be
    const highest = x => x.cume + OFFSET.high, possible = 1 <= day && day <= LONGEST[MON_NAMES.indexOf(m[2])];
    // cleared on the even spread through the day (since 2026-11-06), the
    // lifetime with the offset's high edge; and one that only an uneven path
    // through the month clears by that day, the lifetime at its month's end
    // clearing it, one dated after the rows that the last row's lifetime does
    // not clear, or one dated before the series no higher than the offset's
    // high edge, may be cleared, which the rows cannot tell, so it goes
    // unchecked
    const clears = possible && (row === undefined ? earlier !== undefined && floor <= highest(earlier) + 1
      : day <= daysIn(month) && floor <= lifetimeOf(row, day, OFFSET.high) + 1);
    const mayClear = possible && (row === undefined ? earlier !== undefined || floor <= OFFSET.high + 1
      : day <= daysIn(month) && floor <= highest(row) + 1);
    if (!clears && mayClear) {
      unchecked["floor the series clears"].push(r.month);
      continue;
    }
    figureForms["floor the series clears"].push(r.month);
    if (!clears) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs the lifetime ${row === undefined ? `(no row for ${month}; the series starts ${waymo[0].month}, its lifetime before then at most the pre-series offset's high edge, ${fmt(OFFSET.high)})` : `${milesOf(highest(row))} at the end of ${month}, a month of ${daysIn(month)} days, with the pre-series offset's high edge`} (a ${m[2]} has 1 to ${LONGEST[MON_NAMES.indexOf(m[2])]} days)`);
    }
  }
  // The total is read only with the parenthesis right after it, holding no
  // other and holding "<Monthname>'s row <digit>", which sets its rate beside
  // a row's, the words that make it the row's (since 2026-11-04; header).
  for (const frame of r.rationale.matchAll(new RegExp(String.raw`\bTotal (\d+(?:\.\d+)?)M, about (\d+(?:\.\d+)?)k a day \(([^()]*\b${MONTH_NAME}'s row \d[^()]*)\)`, "g"))) {
    figureForms["Waymo total and daily rate"].push(r.month);
    const total = millions(frame[1]), rate = aboutThousands(frame[2]), perDay = r.vmt / daysIn(r.month);
    if (!within(total.miles, r.vmt, total.slack) || !within(rate.miles, perDay, rate.slack)) {
      figureErrors.push(`waymo ${r.month}: "Total ${frame[1]}M, about ${frame[2]}k a day" vs its miles, ${fmt(r.vmt)}, and its miles over its ${daysIn(r.month)} days, ${milesOf(perDay)}`);
    }
    for (const m of frame[3].matchAll(new RegExp(String.raw`\b${MONTH_NAME}'s row (\d+(?:\.\d+)?)k\b`, "g"))) {
      figureForms["a month's daily rate"].push(r.month);
      const stated = thousands(m[2]), meant = namedRows(r, MONTH_NAMES.indexOf(m[1]));
      if (!meant.some(row => within(stated.miles, row.vmt / daysIn(row.month), stated.slack))) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${meant.length === 0 ? `no ${m[1]} row` : meant.map(row => `${row.month}'s miles over its ${daysIn(row.month)} days, ${milesOf(row.vmt / daysIn(row.month))}`).join("; ")}`);
      }
    }
    for (const m of frame[3].matchAll(/\bmeasured Q([1-4]) (\d+(?:\.\d+)?)k\b/g)) {
      figureForms["a quarter's daily rate"].push(r.month);
      const stated = thousands(m[2]), quarters = quartersNamed(Number(m[1]))
        .map(months => ({ months, perDay: waymo.filter(x => months.includes(x.month)).reduce((s, x) => s + x.vmt, 0) / months.reduce((s, x) => s + daysIn(x), 0) }))
        .filter(q => q.months.every(month => rowOf("waymo", month) !== undefined));
      if (!quarters.some(q => within(stated.miles, q.perDay, stated.slack))) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${quarters.length === 0 ? `no Q${m[1]} with three Waymo rows` : quarters.map(q => `${q.months.join(", ")}: ${milesOf(q.perDay)} a day`).join("; ")}`);
      }
    }
  }
  // A month and its week: the two figures agree for a month whoever's they
  // are, and they are the row's miles only when " vs Waymo's" follows,
  // setting them beside a fleet figure of Waymo's (since 2026-11-05; header).
  // The "≈" marks the week approximate, so it holds to one unit of its last
  // digit, as a "~" does; a month may be turned into weeks by its own days or
  // by the average month's, 365.25/12; and a pair that is not the row's may
  // be any month's, so it agrees for some month of 28 to 31 days or the
  // average month, the row's pair for the row's days or the average month
  // (since the round-1 review of 2026-11-05; from earlier that day until then
  // every pair for the row's days only, and the week to half a unit).
  for (const m of r.rationale.matchAll(/Cross-check: (\d+(?:\.\d+)?)M\/mo ≈ (\d+(?:\.\d+)?)M\/wk\b( vs Waymo's\b)?/g)) {
    figureForms["a month and its week"].push(r.month);
    const perMonth = millions(m[1]), perWeek = aboutMillions(m[2]);
    const days = daysIn(r.month), daysMeant = m[3] === undefined ? [28, 29, 30, 31, 365.25 / 12] : [days, 365.25 / 12];
    const agree = daysMeant.some(d => within(perMonth.miles * 7 / d, perWeek.miles, perMonth.slack * 7 / d + perWeek.slack));
    const theRows = m[3] === undefined || (within(perMonth.miles, r.vmt, perMonth.slack) && daysMeant.some(d => within(perWeek.miles, r.vmt * 7 / d, perWeek.slack)));
    if (!agree || !theRows) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": ${daysMeant.map(d => `${perMonth.stated} over ${milesOf(d)} days is ${milesOf(perMonth.miles * 7 / d)} a week`).join("; ")}${m[3] === undefined ? "" : `; its miles are ${fmt(r.vmt)}, ${daysMeant.map(d => milesOf(r.vmt * 7 / d)).join(" or ")} a week`}`);
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
// (millions, thousands or whole miles; thousands commas before a unit,
// "1,430k", read whole since the round-2 review of 2026-11-05, until then
// the number stopped at its comma) after a label: a place's name (words
// each starting with a capital), words naming metros, or "about". Every
// figure of the list at depth 0 must be CA's term or such a term, and CA's
// clause must hold none after its term; a list with any other figure there (a
// figure after "=", one with no label, a rate such as "1.08M/mo") is one this
// cannot sum, so it goes unchecked, and the pass line counts it so. The terms
// the list's form names are its components: the first term of each of CA,
// Maricopa, Travis and Atlanta, the first whose label holds "metros", and
// the first "about" term after " and " (the start frame's sixth); any other
// labelled term may be one more component or a part of one ("Denver 0.10M of
// them", "Austin 1.80M (most of Travis)", "the southern metros 0.6M of
// them"), so the list holds when its components plus any choice of the other
// terms sum to its miles (since the round-1 review of 2026-11-05; from
// earlier that day until then every labelled term was summed, so a correct
// part of a term failed).
const maskGroups = s => s.replace(new RegExp(`${PAREN}|${BRACKET}`, "g"), g => `\x01${" ".repeat(g.length - 2)}\x02`);
const FIGURE = /(?<![\d.,])(?:(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)([kM])(?![A-Za-z])(\/[a-z]+)?|(\d{1,3}(?:,\d{3})+)(?![,.]?\d|[kM]))/g;
const asFigure = f => (f[4] === undefined ? UNIT[f[2]](f[1]) : roundedWhole(f[4]));
const LABEL = /^(?:[A-Z][A-Za-z.'+\/-]*(?: [A-Z][A-Za-z.'+\/-]*)*|[a-z][a-z' -]*\bmetros\b[a-z' -]*|about)$/;
// The parenthesis right after a point of a text, if one opens there (the
// empty alternative makes the match always succeed)
const PAREN_AFTER = new RegExp(`^ (${PAREN})|`);
// The pieces of a masked text between its separators, each with its offset
// and the separator before it
const pieces = (text, at, sep) => {
  const cuts = [...text.matchAll(sep)].map(e => [e.index, e.index + e[0].length, e[0]]);
  const starts = [0, ...cuts.map(c => c[1])], ends = [...cuts.map(c => c[0]), text.length], seps = ["", ...cuts.map(c => c[2])];
  return starts.map((from, i) => ({ text: text.slice(from, ends[i]), at: at + from, sep: seps[i] }));
};
// The component a term's label names, if any: CA's, Maricopa's, Travis's or
// Atlanta's, the metros' (a label holding "metros"), or, for an "about" term
// joined by " and ", the closing adjustment
const componentOf = (label, joined) => [[/^(?:CA|Maricopa|Travis|Atlanta)$/.test(label), label], [/\bmetros\b/.test(label), "metros"],
  [label === "about" && joined, "about"]].filter(([is]) => is).map(([, kind]) => kind)[0];
// A list's terms and the figures in it that are no term: after CA's term in
// its clause, in an item's explanation (after its "="), or with no label.
// Each term records the component its label names (kind) and the
// parenthesis right after it.
const listTerms = (r, list, caTerm) => {
  const stray = [...list[1].slice(caTerm.index + caTerm[0].length).matchAll(FIGURE)].map(f => f[0]);
  const terms = [{ label: "CA", ...millions(caTerm[1]), kind: "CA", paren: undefined }];
  for (const item of pieces(list[2], list.indices[2][0], /;/g)) {
    const head = item.text.split("=")[0];
    stray.push(...[...item.text.slice(head.length).matchAll(FIGURE)].map(f => f[0]));
    for (const sub of pieces(head, item.at, /, | and /g)) {
      const leadText = /^\s*(?:\+ |and )?/.exec(sub.text)[0], lead = leadText.length, text = sub.text.slice(lead);
      for (const [i, f] of [...text.matchAll(FIGURE)].entries()) {
        const label = text.slice(0, f.index).replace(/\x01 *\x02/g, " ").replace(/\s+/g, " ").trim();
        if (i === 0 && f[3] === undefined && LABEL.test(label)) {
          const end = sub.at + lead + f.index + f[0].length, paren = PAREN_AFTER.exec(r.rationale.slice(end))[1];
          terms.push({ label, ...asFigure(f), paren, kind: componentOf(label, sub.sep === " and " || leadText.trim() === "and") });
        } else {
          stray.push(f[0]);
        }
      }
    }
  }
  return { terms, stray };
};
const termsOf = new Map(); // a Waymo row -> the terms its list sums, where it can
const listSpans = new Map(); // a Waymo row -> where that list stands in its rationale
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
    listSpans.set(r, [list.index, list.index + list[0].length]);
    // the first term of each component kind; every other term may or may not be summed
    const components = parsed.terms.filter((t, i, all) => t.kind !== undefined && all.findIndex(u => u.kind === t.kind) === i);
    const others = parsed.terms.filter(t => !components.includes(t));
    const sumOf = ts => ({ miles: ts.reduce((s, t) => s + t.miles, 0), slack: ts.reduce((s, t) => s + t.slack, 0) });
    const holds = someCombination(others.map(t => [t, null]), picked => {
      const sum = sumOf([...components, ...picked.filter(t => t !== null)]);
      return within(sum.miles, r.vmt, sum.slack);
    });
    if (!holds) {
      const sum = sumOf(components);
      figureErrors.push(`waymo ${r.month}: its terms ${components.map(t => t.stated).join(" + ")} sum to ${fmt(sum.miles)}${others.map(t => `, with ${t.label}'s ${t.stated} ${fmt(sum.miles + t.miles)}`).join("")}, vs its miles, ${fmt(r.vmt)} (their rounding allows ${fmt(sum.slack)} and each other term's half a unit)`);
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
// = <r>M", the factor a decimal or a ratio a/b, the base any "<num>M" at
// depth 0 from the clause's leftmost one that reaches " x" (the frame's
// start) to " x" (since the round-1 review of 2026-11-05; until then the
// leftmost, so a correct product with an earlier figure in its clause failed,
// and from earlier that day the one right before " x", so one with an aside
// figure after its base failed); the result is read in a lookahead, so it
// can be the next product's base (October's "10.4M ... x 31/30 = 10.75M x
// ... 1.0576 = 11.37M").
const PRODUCT = new RegExp(String.raw`(?<![\d.,])(\d+(?:\.\d+)?)M((?:[^;=.()\[\]]|\.(?=\d)|${PAREN})*?) x (?:the hub-vs-CPUC CA ratio )?(\d+(?:\.\d+)?(?:\/\d+)?)(?: ${BRACKET})? = (?=(\d+(?:\.\d+)?)M)`, "g");
for (const r of waymo) {
  for (const m of r.rationale.matchAll(CPUC_PRODUCT)) {
    figureForms["CPUC product"].push(r.month);
    const [dep, pilot] = [m[3], m[4]].map(wholeMiles), result = millions(m[6]), product = (dep.miles + pilot.miles) * Number(m[5]);
    if (!within(product, result.miles, result.slack + (dep.miles + pilot.miles) * inputHalf(m[5]))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": (${dep.stated} + ${pilot.stated}) x ${m[5]} is ${milesOf(product)}`);
    }
    // The base, CPUC's miles for a month or more of the stated quarter: any
    // month's, or the sum of two of its months or of all three (the quarter's
    // actual), the words naming no month (since 2026-11-05 any month's; since
    // the round-1 review of that day a sum's too; until then the row's
    // month's, in the row's quarter only), each to half a mile either way for
    // each month summed. It is checked where it is such a figure of
    // data/waymo-ca.csv, and where the file holds the quarter's three months;
    // a base that is none of the figures the file holds, in a quarter whose
    // months it does not all hold, may be one it lacks, so it goes unchecked.
    const held = quarterMonths(m[2], Number(m[1])).filter(x => CPUC_CA[x] !== undefined);
    const sets = [...Array(2 ** held.length - 1).keys()].map(i => held.filter((_, j) => ((i + 1) >> j) & 1));
    const isSum = set => ["deployment", "pilot"].every((k, i) => within([dep, pilot][i].miles, set.reduce((sum, x) => sum + CPUC_CA[x][k], 0), 0.5 * set.length));
    if (!sets.some(isSum) && held.length < 3) {
      unchecked["CPUC base"].push(r.month);
      continue;
    }
    figureForms["CPUC base"].push(r.month);
    if (!sets.some(isSum)) {
      figureErrors.push(`waymo ${r.month}: "${dep.stated} deployment + ${pilot.stated} pilot" vs data/waymo-ca.csv's Q${m[1]}-${m[2]} (each month, and the sum of any of them): ${held.map(x => `${x} deployment ${milesOf(CPUC_CA[x].deployment)} and pilot ${milesOf(CPUC_CA[x].pilot)}`).join("; ")}`);
    }
  }
}
for (const r of rows) {
  for (const m of r.rationale.matchAll(PRODUCT)) {
    figureForms["product"].push(`${r.helmer} ${r.month}`);
    // a decimal factor reads as itself over 1
    const [num, den] = `${m[3]}/1`.split("/").map(Number), result = millions(m[4]);
    const bases = [m[1], ...[...maskGroups(m[2]).matchAll(/(?<![\d.,])(\d+(?:\.\d+)?)M(?![A-Za-z])/g)].map(b => b[1])].map(millions);
    // the slack: the result's half-unit, and its inputs' carried through
    const slackOf = base => result.slack + base.slack * num / den + base.miles * inputHalf(m[3].split("/")[0]) / den;
    if (!bases.some(base => within(base.miles * num / den, result.miles, slackOf(base)))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}${m[4]}M": ${bases.map(base => `${base.stated} x ${m[3]} is ${milesOf(base.miles * num / den)}`).join("; ")}`);
    }
  }
}
// A month's cumulative and band by its name (Tesla's June-August 2025 rows,
// Zoox's 2025-2026 ones), whole miles exactly, read as each row it may mean
// (namedRows: since the round-1 review of 2026-11-05 any month of that name
// with a row, in the row's line or the other Tesla line; from earlier that
// day the month of that name within 11 months either way; until then that
// month of the row's year in the row's line), and unchecked where it may be a
// month the rows do not reach (beyondNamed). Each form names the figures it
// states that only grow, a cumulative or a band's edge, with the field each
// is (fields), which beyondNamed reads.
const NAMED_FORMS = [
  // "<Month> keeps <source>'s end-of-month <c>[ (...)], its band <lo>-<hi>":
  // its cumulative and band
  { form: "a month's cumulative and band",
    re: new RegExp(String.raw`\b${MONTH_NAME} keeps [^,;()]*?\bend-of-month ${WHOLE}(?: ${PAREN})?, its band ${WHOLE}-${WHOLE}`, "g"),
    holds: (row, m) => row.cume === wholeMiles(m[2]).miles && row.kmin === wholeMiles(m[3]).miles && row.kmax === wholeMiles(m[4]).miles,
    fields: m => [[m[2], "cume"], [m[3], "kmin"], [m[4], "kmax"]] },
  // "end-<Month> <a> / <b> / <c>", where "<Month> keeps ..., its band <lo>-<hi>
  // holding the three readings" follows: each reading inside the month's band
  { form: "a band holding readings",
    re: new RegExp(String.raw`\bend-${MONTH_NAME} ${WHOLE} \/ ${WHOLE} \/ ${WHOLE}(?=[^]*?\b\1 keeps [^,;()]*?\bend-of-month [\d,]+(?: ${PAREN})?, its band [\d,]+-[\d,]+ holding the three readings\b)`, "g"),
    holds: (row, m) => [m[2], m[3], m[4]].every(s => row.kmin <= wholeMiles(s).miles && wholeMiles(s).miles <= row.kmax),
    fields: m => [[m[2], "kmin"], [m[3], "kmin"], [m[4], "kmin"]] },
  // "<Month>'s cumulative is that reading, <c>" or "is the chart's ~<c>": its
  // cumulative (the "~" marks the chart's reading approximate, not the
  // cumulative, which is that figure)
  { form: "a month's cumulative",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is (?:that reading, |the chart's ~)${WHOLE}`, "g"),
    holds: (row, m) => row.cume === wholeMiles(m[2]).miles, fields: m => [[m[2], "cume"]] },
  // "<Month>'s cumulative is that reading, <c>, its band from the call's <f> to
  // <p>% above it": the band's floor f and its top c x (1 + p/100), p to the
  // whole percent
  { form: "a cumulative's floor and top",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is that reading, ${WHOLE}, its band from the call's ${WHOLE} to (\d+)% above it\b`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[3]).miles && within(row.kmax / wholeMiles(m[2]).miles - 1, Number(m[4]) / 100, 0.005 + 1e-9),
    fields: m => [[m[2], "cume"], [m[3], "kmin"]] },
  // "<Month>'s cumulative is the chart's ~<c>, its floor <f>": the band's floor
  { form: "a cumulative's floor",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative is the chart's ~${WHOLE}, its floor ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[3]).miles, fields: m => [[m[3], "kmin"]] },
  // "<Month>'s miles are at least <n>": a floor on its miles
  { form: "a month's miles at least",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s miles are at least ${WHOLE}`, "g"),
    holds: (row, m) => row.vmt >= wholeMiles(m[2]).miles, fields: () => [] },
  // "<Month>'s miles are at least <n>, ..., puts them there (<v> with": its
  // miles
  { form: "a month's miles as put",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s miles are at least ${WHOLE},(?:[^.;()]|\.(?=\d))*?\bputs them there \(${WHOLE} with\b`, "g"),
    holds: (row, m) => row.vmt === wholeMiles(m[3]).miles, fields: () => [] },
  // "<Month>'s cumulative band, <lo> to <hi>": its cumulative band
  { form: "a month's cumulative band",
    re: new RegExp(String.raw`\b${MONTH_NAME}'s cumulative band, ${WHOLE} to ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[2]).miles && row.kmax === wholeMiles(m[3]).miles,
    fields: m => [[m[2], "kmin"], [m[3], "kmax"]] },
  // "End-<Month> cumulative floor <f>": its cumulative band's floor
  { form: "an end-of-month floor",
    re: new RegExp(String.raw`\bEnd-${MONTH_NAME} cumulative floor ${WHOLE}`, "g"),
    holds: (row, m) => row.kmin === wholeMiles(m[2]).miles, fields: m => [[m[2], "kmin"]] },
];
// The months of name n a named form's figures may be in that the rows do not
// reach: the month of that name nearest each row sharing r's rationale where
// no line the row may mean has a row, each with whether the figures fit it on
// a line: after the line's last row each figure that only grows (a
// cumulative, or a band's edge or a reading inside the band) at least the
// last row's same field, before its first at most the line's pre-series
// miles' high edge (the lifetime then, the series not begun), and a month's
// own miles anything (since the round-3 review of 2026-11-06; until then a
// figure of such a month went unchecked whatever its value, although
// cumulatives only grow)
const beyondNamed = (r, n, fields) => {
  const lines = LINES_MEANT[r.helmer].filter(line => rows.some(x => x.helmer === line));
  return [...new Set(rows.filter(x => x.rationale === r.rationale).flatMap(x => nearestNamed(x.month, n, 1)))]
    .filter(month => lines.every(line => rowOf(line, month) === undefined)).flatMap(month => lines.map(line => {
      const own = rows.filter(x => x.helmer === line), last = own.at(-1), high = Math.max(0, ...PRE_SERIES[line].map(p => p.high));
      return month > last.month
        ? { fits: fields.every(([s, k]) => wholeMiles(s).miles >= last[k]), note: `${month}, after ${line}'s last row, ${last.month}, whose cumulative is ${cumeAndBand(last)}` }
        : { fits: fields.every(([s]) => wholeMiles(s).miles <= high), note: `${month}, before ${line}'s first row, ${own[0].month}, its lifetime then at most ${fmt(high)}` };
    }));
};
for (const r of rows) for (const { form, re, holds, fields } of NAMED_FORMS) for (const m of r.rationale.matchAll(re)) {
  const n = MONTH_NAMES.indexOf(m[1]), meant = namedRows(r, n), held = meant.some(row => holds(row, m)), beyond = beyondNamed(r, n, fields(m));
  if (!held && beyond.some(b => b.fits)) { // perhaps a month the rows do not reach
    unchecked["a month by its name"].push(`${form}: ${r.helmer} ${r.month}`);
    continue;
  }
  figureForms[form].push(`${r.helmer} ${r.month}`);
  if (!held) {
    figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${rowsNote(meant)}${beyond.map(b => `; ${b.note}`).join("")}`);
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
    const [f, j] = [m[3], m[5]].map(s => wholeMiles(s).miles), names = [MON_NAMES.indexOf(m[1]), ...[m[4], m[6], m[7]].map(x => MONTH_NAMES.indexOf(x))];
    const holds = LINES_MEANT[r.helmer].some(line => someCombination(
      names.map(n => monthsNamed(n).map(month => rowOf(line, month)).filter(x => x !== undefined)),
      ([at, end, a, b]) => Number(m[2]) === daysIn(at.month) && at.kmin === f && end.kmin === j && j + a.vmin + b.vmin === f));
    if (!holds && names.some(n => beyondRows(r, n, LINES_MEANT[r.helmer]))) { // perhaps a month the rows do not reach
      unchecked["a month by its name"].push(`a floor through a month's end: ${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a floor through a month's end"].push(`${r.helmer} ${r.month}`);
    if (!holds) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${names.map(n => `${MONTH_NAMES[n]}: ${rowsNote(namedRows(r, n))}`).join(" | ")}`);
    }
  }
}

// The forms added on 2026-11-05 (the fifth fix run's reviews; frames as in
// the (3a) comment above).
// Tesla's no-monitor page, in the Tesla lines' rows (where "the page" is
// Tesla's Robotaxi Safety Report page): "<Month>: <p> on the page" or
// "<Month>'s no-monitor miles are <p> on the page", the month after no
// possessive, at depth 0 (a parenthesis is an aside, which may give a part),
// its clause either ending right after "on the page" (";", "." or ")" then a
// space or the rationale's end) or going on to its deck reading, "[ (...)],
// <d> in the deck" or " and <d> in the deck" (so a part, "on the page
// through Oct 18", "on the page (Oct 1-18)" or "on the page in Houston", is
// not read); p is the no-monitor line's miles or its cumulative (the page
// charts cumulative miles) that month, a month of that name, whole miles
// exactly, or, where month names stand before the month in its clause, the
// miles from a month they name through it ("July and August: <p>", "June to
// August: <p>"). Words before the month in its clause (since its last
// semicolon, colon or stop) other than month names and "through", "thru",
// "to", "and", "until" and "till" may name a part ("In Houston, July's ...",
// "Austin, through September: ..."), so a p none of those readings bears out
// goes unchecked there; so does one below the month's floor with no deck
// reading beside it, which may be the days the page had measured of a month
// in progress (a deck reading marks a month the deck charted to its end), and
// one with no row for its month. (Since the round-2 review of 2026-11-05; from
// that day's round-1 review until then p below the month's floor went
// unchecked even beside a deck reading, and a reading with words before its
// month was read as that month's alone, so "July and August: <p>" failed; from
// earlier that day until the round-1 review a reading inside a parenthesis,
// after a possessive or with a part's words after it was read, and p as the
// month's miles only.)
const PAGE_READING = new RegExp(String.raw`(?<!'s )\b${MONTH_NAME}(?:'s no-monitor miles are|:) ${WHOLE} on the page(?=(?: ${PAREN})?(?:,| and) [\d,]+ in the deck\b|[;.)](?:\s|$)|$)(?:(?: ${PAREN})?(?:,| and) ${WHOLE} in the deck\b)?`, "g");
const PAGE_LINES = ["tesla", "teslanomonitor"]; // the rows whose "the page" is Tesla's
const leadsOf = new Map(); // a row -> its page readings, in order (none outside PAGE_LINES)
const RANGE_WORDS = new Set(["through", "thru", "to", "and", "until", "till", ...MONTH_NAMES.map(x => x.toLowerCase())]);
const noMonitor = rows.filter(x => x.helmer === "teslanomonitor");
for (const r of rows) {
  const masked = maskGroups(r.rationale);
  // where each clause at depth 0 starts: after a semicolon, a colon or a stop before a space or the end
  const clauseStarts = [0, ...[...masked.matchAll(/[;:]|\.(?=\s|$)/g)].map(c => c.index + 1)];
  const leads = [...r.rationale.matchAll(PAGE_READING)].filter(m => PAGE_LINES.includes(r.helmer) && masked[m.index] === r.rationale[m.index])
    .map(m => ({ m, end: m.index + m[0].length, n: MONTH_NAMES.indexOf(m[1]), page: wholeMiles(m[2]), deck: m[3] === undefined ? undefined : wholeMiles(m[3]),
      lead: [...r.rationale.slice(Math.max(...clauseStarts.filter(c => c <= m.index)), m.index).toLowerCase().matchAll(/[a-z]+/g)].map(w => w[0]) }));
  leadsOf.set(r, leads);
  for (const { m, n, page, deck, lead } of leads) {
    const meant = monthsNamed(n).map(month => rowOf("teslanomonitor", month)).filter(x => x !== undefined);
    // the readings of row x: its miles, its cumulative, and the miles from
    // the latest month at or before it of each month name before it in its clause
    const froms = MONTH_NAMES.filter(name => lead.includes(name.toLowerCase())).map(name => monthsNamed(MONTH_NAMES.indexOf(name)));
    const readings = x => [x.vmt, x.cume, ...froms.map(list => list.filter(month => month <= x.month).at(-1)).filter(from => from !== undefined)
      .map(from => noMonitor.filter(y => from <= y.month && y.month <= x.month).reduce((sum, y) => sum + y.vmt, 0))];
    const held = meant.some(x => readings(x).includes(page.miles));
    // a part its words may name, a month in progress, or no row for it
    if (!held && (meant.length === 0 || lead.some(w => !RANGE_WORDS.has(w)) || (deck === undefined && meant.every(x => page.miles < x.vmin)))) {
      unchecked["a page reading"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a page reading"].push(`${r.helmer} ${r.month}`);
    if (!held) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs the no-monitor line's ${meant.map(x => `${x.month}: ${readings(x).map(fmt).join(" or ")}`).join("; ")} (its miles, its cumulative, and the miles from each month named before it)`);
    }
  }
}
// After a page reading in the same rationale, the month's figures it gives:
// "[;.] floor <f>" (or "Floor"), "[;.] the central, <c>" and "[;.] the top,
// <t>", each figure ending its clause, are a floor, central and top (its
// miles' or its cumulative's), whole miles exactly, of a month they may mean,
// in a line the row may mean; "the central, <c>, adds <Month>'s <r>
// monitor-aboard remainder" has c a page or deck reading or the no-monitor
// line's miles of a month it may mean, plus r, and "the top, <t>, ... (the
// higher reading x <f>)" t the higher of a page reading and its deck reading
// times f, each to the precision of c or t (its last nonzero digit). The
// months they may mean: every page reading's before them in the rationale,
// and every month their sentence names (since the round-1 review of
// 2026-11-05; from earlier that day until then the latest page reading's
// only, so a correct figure of another month failed). With no page reading
// before them their words name no month, so they go unread. A floor, central
// or top that no such month bears out but another month's row of a line the
// row may mean does goes unchecked: words can name a month relatively ("the
// month before's"), which this does not read (since the round-2 review of
// 2026-11-05; until then it failed).
const MONTH_FIGURE = new RegExp(String.raw`(?<=[;.] )([Ff]loor|[Tt]he central,|[Tt]he top,) ${WHOLE}(?=[;.,]|$)`, "g");
const FIGURE_FIELDS = { "floor": ["vmin", "kmin"], "the central,": ["vmt", "cume"], "the top,": ["vmax", "kmax"] };
const CENTRAL_SUM = new RegExp(String.raw`\b[Tt]he central, ${WHOLE}, adds ${MONTH_NAME}'s ${WHOLE} monitor-aboard remainder\b`, "g");
const TOP_FACTOR = new RegExp(String.raw`\b[Tt]he top, ${WHOLE}, [^;.()]*\(the higher reading x (\d+(?:\.\d+)?)\)`, "g");
const leadsBefore = (r, at) => leadsOf.get(r).filter(x => x.end <= at);
// The sentence of a text holding a position, its stops those not followed by
// a digit, outside parentheses and brackets
const sentenceAt = (s, at) => {
  const cuts = [...maskGroups(s).matchAll(/\.(?!\d)(?=\s|$)/g)].map(c => c.index + 1);
  return s.slice(Math.max(0, ...cuts.filter(c => c <= at)), Math.min(s.length, ...cuts.filter(c => c > at)));
};
const monthsMeant = (r, at) => [...new Set([...leadsBefore(r, at).map(x => x.n),
  ...[...sentenceAt(r.rationale, at).matchAll(new RegExp(String.raw`\b${MONTH_NAME}\b`, "g"))].map(x => MONTH_NAMES.indexOf(x[1]))])];
const leadsNote = leads => leads.map(x => `"${x.m[0]}"`).join(", ");
for (const r of rows) {
  for (const m of r.rationale.matchAll(MONTH_FIGURE)) {
    const leads = leadsBefore(r, m.index);
    if (leads.length === 0) continue; // no month named before it
    const fields = FIGURE_FIELDS[m[1].toLowerCase()], meant = monthsMeant(r, m.index).flatMap(n => namedRows(r, n));
    const bears = x => fields.some(k => x[k] === wholeMiles(m[2]).miles);
    if (!meant.some(bears) && rows.some(x => LINES_MEANT[r.helmer].includes(x.helmer) && bears(x))) { // perhaps that month's, named relatively
      unchecked["a month's floor, central or top"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a month's floor, central or top"].push(`${r.helmer} ${r.month}`);
    if (!meant.some(bears)) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" (after ${leadsNote(leads)}) vs ${rowsNote(meant)}`);
    }
  }
  for (const m of r.rationale.matchAll(CENTRAL_SUM)) {
    const leads = leadsBefore(r, m.index);
    if (leads.length === 0) continue;
    figureForms["a central from a reading and a remainder"].push(`${r.helmer} ${r.month}`);
    const c = roundedWhole(m[1]), rem = wholeMiles(m[3]).miles;
    const bases = [...new Set(leads.flatMap(x => [x.page, x.deck]).filter(x => x !== undefined).map(x => x.miles)
      .concat(monthsMeant(r, m.index).flatMap(monthsNamed).map(month => rowOf("teslanomonitor", month)).filter(x => x !== undefined).map(x => x.vmt)))];
    if (!bases.some(b => within(c.miles, b + rem, c.slack))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${bases.map(b => `${fmt(b)} plus ${m[3]} is ${fmt(b + rem)}`).join("; ")}`);
    }
  }
  for (const m of r.rationale.matchAll(TOP_FACTOR)) {
    const leads = leadsBefore(r, m.index).filter(x => x.deck !== undefined);
    if (leads.length === 0) {
      unchecked["a top from a reading"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["a top from a reading"].push(`${r.helmer} ${r.month}`);
    const t = roundedWhole(m[1]), wants = leads.map(x => Math.max(x.page.miles, x.deck.miles) * Number(m[2]));
    if (!wants.some(want => within(t.miles, want, t.slack))) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}": ${leads.map((x, i) => `the higher of ${x.page.stated} and ${x.deck.stated} times ${m[2]} is ${milesOf(wants[i])}`).join("; ")}`);
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
const bothLines = (r, name) => monthsNamed(MONTH_NAMES.indexOf(name))
  .map(month => ({ month, all: rowOf("tesla", month), none: rowOf("teslanomonitor", month) }))
  .filter(x => x.all !== undefined && x.none !== undefined);
const linesNote = list => list.length === 0 ? "no month of that name with rows on both Tesla lines"
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
// A lifetime on a day (restated in the round-1, round-2 and round-3 reviews
// of 2026-11-05 and 2026-11-06): "crosses <x>M at the start of <Mon> <D>" (or
// "on <Mon> <D>") has the lifetime reach x during that day, with one mile's
// slack (at most x + 1 at the end of the day before, at least x - 1 at its
// end); "stands at <x>M on <Mon> <D>" has the lifetime at the end of that day
// x, to x's precision, and so does "puts <n> lifetime miles at <Mon> <D>" n,
// to its last nonzero digit (since 2026-11-06; Zoox's 2026 rows give the
// path's Mar 24 and Aug 5 figures so). A ", <YYYY>" right after the day names
// the year of its month (since the round-3 review of 2026-11-06; until then
// it was not read, so "stands at 1.25M on Dec 31, 2024" was read as Dec 31,
// 2025's); without one the day is in a month of that name with a row
// (monthsNamed). Its lines are those the row may mean or its clause names,
// and whose figure it is is read as at the end of a month (ownerOf,
// linesFor; since the round-3 review, until then the row's own lines only,
// so that a county's, a city's, another company's or a deck's correct figure
// failed as the row's line's): the lifetime is the series cumulative plus the
// line's pre-series miles (PRE_SERIES), any amount in their range, or none
// (the series itself); and on a month's last day "stands at" may also give
// Waymo's hub figure an anchor gives for that month, or, where none gives
// one, the hub's unknown figure, at most the lifetime (since the round-3
// review). The rows hold each month's miles and no path within it, so a
// figure is read on paths through the month, within the rounding the line's
// months carry (half a unit of the last nonzero digit of the miles of each of
// the line's months through the day, for Zoox about 70 miles through November
// 2025, 13,940 by Mar 24, 2026 and 35,875 by Aug 5, 2026):
//   - on a Zoox line where the clause names the Zoox model's path ("the
//     path", "its path", "Zoox's path", "the smooth path", "the smoothest
//     path", "the model's path", "the model path", "the Zoox model's path",
//     none followed by "of", "that", "which", "where" or "whose"; or a
//     demonstrative path, "that path", "this path" or "the same path", where
//     the last path its words name before it is one of those), or names no
//     path of its own and a pronoun in it may refer to a clause that does
//     (THE_PATH, DEMONSTRATIVE_PATH; since the round-3 review, until then any
//     "path" word, so that a correct "a path that crosses 1M on Dec 7", or
//     "path" in a revision note, was read as the model's; since 2026-11-07
//     the trigger's other forms and the words that identify another path),
//     the model's path (data/README.md, Zoox anchors): the month's
//     miles spread evenly over its days, as the model counts its statements,
//     or its Las Vegas share at one rate a Las Vegas driving day, the days the
//     model holds out of the month (LV_PAUSE below: five, for January 2026's
//     Jan 22-26) where a Zoox rationale places them ("<Monthname> leaves out
//     <list>") and anywhere in the month where none does, and its California
//     share, which no row holds apart, anything from none of the month's
//     miles to all of them, spread over its days. A figure on no such path
//     fails, so a crossing a day late does ("the path crosses 1M at the start
//     of Dec 2", where the path is at 1,008,064 by the end of Dec 1).
//   - elsewhere, the month's miles spread evenly over its days: a figure
//     there is checked, and one only some other path bears out (the lifetime
//     anywhere from the month's start, or on its last day its end, to its
//     end) goes unchecked rather than failing, since a series can run
//     unevenly within a month (the Waymo builder's daily rates change within
//     months; Tesla's no-monitor series grows within each one, so that its
//     388,672 by Jul 22 and 1,035,164 by Sep 3 lie below the even spread's
//     406,253 and 1,058,645); and so does one no reading bears out whose
//     clause, or what it refers back to, holds a word that may name another
//     owner (a word other than OWN_WORDS, PATH_WORDS and PLAIN below), or
//     names a line data/vmt.csv has no rows of.
// A day no month of its name has (0, 32, Nov 31), or that its stated year's
// month lacks (Feb 29, 2026), fails; and a figure no reading bears out goes
// unchecked where, in the month of that name holding the day nearest a row
// sharing the rationale (or the month its year names), a line has no row and
// its lifetime may be the figure then (growthReading: after the line's last
// row at least its cumulative, on a Waymo month's last day anything, its hub
// figure counting a part of its miles, before its first row at most its
// pre-series miles; since 2026-11-06, until then whatever the figure). (From
// the round-2 review of 2026-11-05 until 2026-11-06 a figure lying anywhere
// some path through its month could put it passed, so the Zoox crossing a
// day late did; from the round-1 review until the round-2 review every line
// was read on the even spread alone, a figure off it failing, as the
// no-monitor series' figures of Jul 22 and Sep 3 did once reworded into the
// form, and a day past its month's end went unchecked; from earlier on
// 2026-11-05 until the round-1 review the lifetime only, on the even spread
// exactly, and a Zoox row stating no pre-series miles unchecked.) And "the
// <o> driverless miles before it come off <Name>'s ~<x>M-mile figure for
// <Mon> <D>, <YYYY>" has the cumulative at the end of that day plus o x, to
// one unit of x's last digit (its "~"), read as "stands at" reads a figure
// away from a path, so that one only some uneven path bears out goes
// unchecked, and one of a month with no row too where the lifetime may be it
// then (growthReading; since 2026-11-06; from the round-2 review until then
// any path bore it out, and until the round-2 review the even spread; until
// 2026-11-06 a month with no row failed), and o, to its own precision, in the
// line's pre-series range (PRE_SERIES) where it has one (since the round-1
// review; until then o held only to x's "~").
//
// The days of each Zoox month the model counts without Las Vegas driving:
// quals/zoox-vmt-model.qual.mjs's LV_PAUSE, its count of them, read from that
// file as data/waymo_vmt.py's OFFSET is read (since 2026-11-06; nothing
// before then read the model's path within a month; since the round-3 review
// of that day through constantOf, until then one line's regex and
// JSON.parse, which stopped on a correct edit of its literal form).
const LV_PAUSE = constantOf("quals/zoox-vmt-model.qual.mjs", "LV_PAUSE");
assert.equal(Object.prototype.toString.call(LV_PAUSE), "[object Object]",
  `Replicata: read LV_PAUSE in quals/zoox-vmt-model.qual.mjs. Expectata: an object of the months the Zoox model counts Las Vegas driving days out of, each with their count. Resultata: ${String(LV_PAUSE)}.`);
const badPause = Object.entries(LV_PAUSE).filter(([month, k]) => !(/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && Number.isInteger(k) && 0 < k && k < daysIn(month)));
assert.deepEqual(badPause, [],
  `Replicata: read LV_PAUSE in quals/zoox-vmt-model.qual.mjs. Expectata: each entry a YYYY-MM month and a whole number of days, at least one and fewer than the month has. Resultata: ${JSON.stringify(badPause)}.`);
// The days the model holds out of a month, none where it lists none
const pausedIn = month => Object.entries(LV_PAUSE).filter(([m]) => m === month).reduce((sum, [, k]) => sum + k, 0);
// Where a Zoox rationale places a month's days out, "<Monthname> leaves out
// <list>" ("January leaves out Jan 22-26", or "January leaves out Jan 22-24
// and Jan 25-26"): each stretch of the list ("<Mon> <a>[-<b>]", joined by
// ", ", " and " or ", and ") days of that month, and their days summed as
// many as the model holds out of a month of that name (a month named
// without its year, read as any month of the name; since the round-3 review
// of 2026-11-06, until then the days lay anywhere in the month, so that "the
// path stands at 1.25M on Jan 3" passed, Jan 1-5 taken as the days out). A
// window that no such month holds fails: the rationale and the model then
// disagree on the month's days out. Only a month's own window is read: until
// 2026-11-07 any "leaves out <Mon> <a>-<b>" was, whatever its subject (so a
// correct "the statement leaves out Mar 25-31" failed), and a list's first
// stretch alone (so the five days written as two stretches failed).
const MON_ANY = `(?:${MON_NAMES.join("|")})`;
const STRETCH = String.raw`${MON_ANY} \d{1,2}(?:-\d{1,2})?`;
const PAUSE_WINDOW = new RegExp(String.raw`\b${MONTH_NAME} leaves out (${STRETCH}(?:(?:, and |, | and )${STRETCH})*)(?![\d-])`, "g");
const windows = rows.filter(x => x.helmer === "zoox").flatMap(x => [...x.rationale.matchAll(PAUSE_WINDOW)]
  .map(m => ({ row: x, text: m[0], n: MONTH_NAMES.indexOf(m[1]),
    stretches: [...m[2].matchAll(new RegExp(String.raw`(${MON_ANY}) (\d{1,2})(?:-(\d{1,2}))?`, "g"))].map(s => ({ n: MON_NAMES.indexOf(s[1]), first: Number(s[2]), last: Number(s[3] ?? s[2]) })) }))
  .map(w => ({ ...w, days: w.stretches.reduce((sum, s) => sum + s.last - s.first + 1, 0) })));
const windowOf = (w, month) => Number(month.slice(5, 7)) === w.n + 1 && w.stretches.every(s => s.n === w.n && 1 <= s.first && s.first <= s.last && s.last <= daysIn(month)) && pausedIn(month) === w.days;
for (const w of windows) {
  figureForms["a month's days out"].push(`zoox ${w.row.month}`);
  if (!Object.keys(LV_PAUSE).some(month => windowOf(w, month))) {
    figureErrors.push(`zoox ${w.row.month}: "${w.text}" (${w.days} days of a ${MON_NAMES[w.n]}) vs quals/zoox-vmt-model.qual.mjs's LV_PAUSE, the days the model holds out of each month, ${JSON.stringify(LV_PAUSE)}`);
  }
}
// A family of paths through row x's month, as the least and the most of the
// month's D days' miles its paths have driven by the end of day d (0 to D):
// the even spread; the Zoox model's path (above), k its days out of the
// month, its Las Vegas driving days by the end of day d being d less the days
// out a rationale places by then, or, where none places them, anywhere from
// d less k (all of them at the month's start) to d (all at its end); and any
// path, which by then has driven anything from none of them to all of them,
// none at the month's start and all at its end
const EVEN = () => (d, D) => [d / D, d / D];
const ZOOX_PATH = x => {
  const k = pausedIn(x.month), placed = windows.filter(w => windowOf(w, x.month));
  const driven = (d, D) => placed.length === 0 ? [Math.max(0, d - k), Math.min(d, D - k)]
    : placed.map(w => d - w.stretches.reduce((sum, s) => sum + Math.max(0, Math.min(d, s.last) - s.first + 1), 0));
  return (d, D) => [Math.min(d / D, ...driven(d, D).map(v => v / (D - k))), Math.max(d / D, ...driven(d, D).map(v => v / (D - k)))];
};
const ANY = () => (d, D) => [Math.floor(d / D), Math.ceil(d / D)];
// The series' lifetime less its pre-series miles at the end of day d of row
// x's month, the least and the most a family's paths give
const spanAt = (x, path, d) => path(d, daysIn(x.month)).map(s => x.cume - x.vmt + x.vmt * s);
const pathRounding = (x, d) => rows.filter(y => y.helmer === x.helmer && y.month < x.month).reduce((sum, y) => sum + roundedWhole(String(y.vmt)).slack, 0)
  + roundedWhole(String(x.vmt)).slack * d / daysIn(x.month);
// Each form: its pass-line name, whether a hub figure may be its, its stated
// figure f (miles and slack), and the span a lifetime that day must meet,
// from a function giving the span at the end of any day (a crossing's from
// the least at the end of the day before to the most at the end of the day,
// the others' that day's), with words for it in a message
const STANDS = { re: new RegExp(String.raw`\bstands at (\d+(?:\.\d+)?)M on ${MON_NAME} (\d{1,2})\b(?:, (\d{4})\b)?`, "g"), name: "a lifetime milestone", hub: true,
  figure: m => millions(m[1]), span: (at, d) => at(d), when: d => `at the end of day ${d}` };
const LIFETIME_FORMS = [
  { re: new RegExp(String.raw`\bcrosses (\d+(?:\.\d+)?)M (?:at the start of|on) ${MON_NAME} (\d{1,2})\b(?:, (\d{4})\b)?`, "g"), name: "a lifetime milestone", hub: false,
    figure: m => ({ ...millions(m[1]), slack: 1 }), span: (at, d) => [at(d - 1)[0], at(d)[1]], when: d => `from the end of day ${d - 1} to the end of day ${d}` },
  STANDS,
  { re: new RegExp(String.raw`\bputs ${WHOLE} lifetime miles at ${MON_NAME} (\d{1,2})\b(?:, (\d{4})\b)?`, "g"), name: "a path's lifetime on a day", hub: false,
    figure: m => roundedWhole(m[1]), span: (at, d) => at(d), when: STANDS.when },
];
// Whether the stated figure f lies, with some pre-series amount in p, where a
// path of the family puts the lifetime on day d of row x's month, within the
// rounding the line's months carry through that day
const lifetimeHolds = (form, x, path, d, p, f) => {
  const [a, b] = form.span(dd => spanAt(x, path, dd), d), slack = f.slack + pathRounding(x, d);
  return Math.max(p.low, f.miles - slack - b) <= Math.min(p.high, f.miles + slack - a);
};
// Whether a reading from lo to hi meets a stated figure f (miles and slack)
const meetsFigure = (g, f) => g.lo <= f.miles + f.slack && f.miles - f.slack <= g.hi;
// The words of a lifetime's clause that say whose it is: a path's, as well as
// a reading's or a line's (OWN_NOUNS); and those that name no other owner:
// OWN_WORDS, the path's, and PLAIN's prepositions, adverbs, months' names and
// words that set one figure beside another ("On the path the lifetime
// crosses ...", "For comparison, Waymo's series crosses ...", "In August,
// ...")
const PATH_WORDS = new Set(["path", "path's", "paths"]);
const LIFETIME_NOUNS = new Set([...OWN_NOUNS, ...PATH_WORDS]), LIFETIME_OWN = new Set([...OWN_WORDS, ...PATH_WORDS, ...PLAIN]);
// The Zoox model's path, named (above)
const THE_PATH = /\b(?:the|its|zoox's) (?:zoox )?(?:smooth(?:est)? |model(?:'s)? )?path\b(?! (?:of|that|which|where|whose)\b)/i;
const DEMONSTRATIVE_PATH = /\b(?:that|this|the same) path\b/i;
// the last path a text names ("a faster path", "the smoothest path")
const lastPath = t => [...t.matchAll(/\b(?:[\w']+ ){1,2}path\b/gi)].map(x => x[0]).at(-1) ?? "";
const COMES_OFF = new RegExp(String.raw`\bthe ${WHOLE} driverless miles before it come off [A-Z][A-Za-z]*'s ~(\d+(?:\.\d+)?)M-mile figure for ${MON_NAME} (\d{1,2}), (\d{4})\b`, "g");
for (const r of rows) {
  for (const form of LIFETIME_FORMS) for (const m of r.rationale.matchAll(form.re)) {
    const f = form.figure(m), day = Number(m[3]), n = MON_NAMES.indexOf(m[2]);
    // the months the day may be in: the one its year names, or else every
    // month of its name with a row
    const months = m[4] === undefined ? monthsNamed(n) : [`${m[4]}-${MON[m[2]]}`];
    const longest = m[4] === undefined ? LONGEST[n] : daysIn(months[0]), dayOk = 1 <= day && day <= longest;
    // whose figure it is (ownerOf), and the Zoox model's path where the
    // clause names it, or names no path of its own and refers back to a
    // clause that does
    const { before, after, antecedent, earlier } = clauseAround(r.rationale, m.index, m.index + m[0].length), words = wordsOf(`${before} ${after}`);
    const { refers, named, others } = ownerOf(words, antecedent, earlier, LIFETIME_NOUNS, LIFETIME_OWN);
    const { lines, absent } = linesFor(r, named);
    const onPath = THE_PATH.test(`${before} ${after}`)
      || (DEMONSTRATIVE_PATH.test(`${before} ${after}`) && THE_PATH.test(lastPath(`${earlier} ${antecedent} ${before}`.replace(DEMONSTRATIVE_PATH, ""))))
      || (!words.some(w => PATH_WORDS.has(w)) && refers && THE_PATH.test(`${earlier} ${antecedent}`));
    // the families a row's figure is checked on, then the one it may lie on
    const families = x => onPath && x.helmer === "zoox" ? [ZOOX_PATH, ZOOX_PATH] : [EVEN, ANY];
    const meant = lines.flatMap(line => months.map(month => rowOf(line, month))
      .filter(row => row !== undefined && 1 <= day && day <= daysIn(row.month)).flatMap(row => [...PRE_SERIES[line], NONE].map(o => ({ row, o }))));
    const hubs = hubFigures.filter(h => form.hub && lines.includes("waymo") && months.includes(h.month) && day === daysIn(h.month));
    const held = meant.some(({ row, o }) => lifetimeHolds(form, row, families(row)[0](row), day, o, f)) || hubs.some(h => within(h.hub.miles, f.miles, h.hub.slack + f.slack));
    const possible = meant.some(({ row, o }) => lifetimeHolds(form, row, families(row)[1](row), day, o, f));
    // the hub's unknown figure on the last day of a Waymo month no anchor
    // gives one for, at most the lifetime
    const hubMay = form.hub && hubMeant(named) && meant.some(({ row }) => row.helmer === "waymo" && day === daysIn(row.month) && !hubFigures.some(h => h.month === row.month) && f.miles - f.slack <= row.cume + OFFSET.high);
    // the lifetimes it may be in the months it may be in (the nearest of its
    // name holding the day to each row sharing the rationale, or the month
    // its year names) that a line has no row for
    const beyond = [...new Set(m[4] === undefined ? rows.filter(x => x.rationale === r.rationale).flatMap(x => nearestNamed(x.month, n, day)) : months)]
      .flatMap(month => lines.filter(line => rowOf(line, month) === undefined)
        .map(line => growthReading(line, month, [...PRE_SERIES[line], NONE], form.hub && hubMeant(named) && line === "waymo" && day === daysIn(month))));
    // a real day, and some path the rows cannot rule out, the hub's unknown
    // figure, a lifetime in a month a line has no row for, another owner its
    // words may name (away from the model's path) or a line with no rows
    // bearing it out
    if (!held && dayOk && (possible || hubMay || beyond.some(g => meetsFigure(g, f)) || (!onPath && others.length > 0) || absent.length > 0)) {
      unchecked[form.name].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms[form.name].push(`${r.helmer} ${r.month}`);
    if (!held) {
      const spanNote = row => form.span(dd => spanAt(row, families(row)[0](row), dd), day).map(milesOf).join(" to ");
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${meant.length} readings of rows holding day ${day} (its month has at most ${longest} days)${[...new Set(meant.map(({ row }) => row))].map(row => `; ${row.helmer}'s series ${spanNote(row)} on ${onPath && row.helmer === "zoox" ? "the Zoox model's path" : "the even spread"} ${form.when(day)} of ${row.month} (${milesOf(row.cume - row.vmt)} at its start, ${milesOf(row.cume)} at its end), give or take its months' rounding, up to ${milesOf(pathRounding(row, day))}, plus no pre-series miles${PRE_SERIES[row.helmer].map(o => ` or ${o.note}`).join("")}`).join("")}${hubs.map(h => `; the hub's ${h.hub.stated} for ${h.month}`).join("")}${beyond.map(g => `; ${readingNote(g)}`).join("")}`);
    }
  }
  for (const m of r.rationale.matchAll(COMES_OFF)) {
    const pre = roundedWhole(m[1]), o = { low: pre.miles, high: pre.miles }, x = { ...millions(m[2]), slack: 10 ** (6 - decimals(m[2])) }, day = Number(m[4]);
    const month = `${m[5]}-${MON[m[3]]}`, row = rowOf(r.helmer, month), stated = PRE_SERIES[r.helmer];
    const agrees = stated.length === 0 || stated.some(p => p.low <= pre.miles + pre.slack && pre.miles - pre.slack <= p.high);
    const real = 1 <= day && day <= daysIn(month), onEven = row !== undefined && lifetimeHolds(STANDS, row, EVEN(), day, o, x);
    // a real day and agreeing pre-series miles, and a month with no row where
    // the lifetime may be that, or only some uneven path bearing it out
    if (!onEven && real && agrees && (row === undefined ? meetsFigure(growthReading(r.helmer, month, [o], false), x)
      : lifetimeHolds(STANDS, row, ANY(), day, o, x))) {
      unchecked["an approximate lifetime"].push(`${r.helmer} ${r.month}`);
      continue;
    }
    figureForms["an approximate lifetime"].push(`${r.helmer} ${r.month}`);
    if (!real || !onEven || !agrees) {
      figureErrors.push(`${r.helmer} ${r.month}: "${m[0]}" vs ${row === undefined ? `no row for ${month}: ${readingNote(growthReading(r.helmer, month, [o], false))}` : `the cumulative ${milesOf(lifetimeOf(row, day, 0))} at the end of day ${day} of ${row.month} on the even spread, which plus ${fmt(pre.miles)} is ${milesOf(lifetimeOf(row, day, pre.miles))}`} (a ${m[3]} ${m[5]} has ${daysIn(month)} days); its line's pre-series miles: ${stated.map(p => p.note).join(" or ")}`);
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
  // is x, to one unit of x's last digit (its "≈"; since the round-2 review of
  // 2026-11-05, until then to half a unit), the stated figures taken as exact
  for (const m of r.rationale.matchAll(/\b(\d+) [A-Z]{3} SGO crashes in them ≈ (\d+(?:\.\d+)?)M at the (\d+(?:\.\d+)?)\/M\b/g)) {
    figureForms["a crash count at a rate"].push(`${r.helmer} ${r.month}`);
    const x = aboutMillions(m[2]), want = Number(m[1]) / Number(m[3]) * 1e6;
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
  // plus the days times half a unit of each rate's last digit (until
  // 2026-11-07 the rates taken as exact), and v its miles, s to v's precision
  // (its last nonzero digit)
  for (const m of r.rationale.matchAll(new RegExp(String.raw`\b(\d{1,3}(?:,\d{3})*\.\d+) a day with the x\d+(?:\.\d+)?\) and the rest at (\d{1,3}(?:,\d{3})*\.\d+) a day: ${WHOLE}, rounded to ${WHOLE}`, "g"))) {
    figureForms["a month at its daily rates"].push(`${r.helmer} ${r.month}`);
    const [a, b] = [m[1], m[2]].map(t => Number(t.replace(/,/g, ""))), total = wholeMiles(m[3]).miles, v = roundedWhole(m[4]);
    const want = (a + b) * daysIn(r.month);
    if (!within(total, want, 0.5 + 1e-6 + (inputHalf(m[1]) + inputHalf(m[2])) * daysIn(r.month)) || r.vmt !== v.miles || !within(total, v.miles, v.slack)) {
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
// "<A> <a>M (hub Q<q> run-rate <r>M/mo" has r a third of the hub's measured
// A increment for a quarter q, any year's, that a split statement gives, to
// r's precision plus a third of the increment's; where none gives one, it
// goes unchecked. (Since the round-1 review of 2026-11-05; from earlier that
// day until then also a third of the A terms the latest quarter q's three
// rows list, which for a quarter of estimated rows are no hub figure, so the
// hub's own run-rate could fail against them.)
const SPLIT = /\b([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M(?: and ([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M)? = the hub's measured Q([1-4]) [A-Za-z+ ]*?increments? \((\d+(?:\.\d+)?)M(?: \/ (\d+(?:\.\d+)?)M)?\)/g;
const splits = [];
for (const r of waymo) for (const m of r.rationale.matchAll(SPLIT)) {
  const labels = [m[1], m[3]].filter(x => x !== undefined), parts = [m[2], m[4]].filter(x => x !== undefined), totals = [m[6], m[7]].filter(x => x !== undefined);
  const quarter = quarterMonths(r.month.slice(0, 4), Number(m[5]));
  if (labels.length !== totals.length || !quarter.includes(r.month)) {
    unchecked["a quarter's split"].push(r.month);
    continue;
  }
  splits.push(...labels.map((label, i) => ({ r, q: Number(m[5]), quarter, label, part: millions(parts[i]), total: millions(totals[i]), text: m[0] })));
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
for (const r of waymo) for (const m of r.rationale.matchAll(/\b([A-Z][A-Za-z+]*) (\d+(?:\.\d+)?)M \(hub Q([1-4]) run-rate (\d+(?:\.\d+)?)M\/mo\b/g)) {
  // each increment it may mean, with its slack: those a split statement of
  // quarter q gives for A
  const totals = splits.filter(x => x.label === m[1] && x.q === Number(m[3])).map(x => ({ what: `${x.quarter.join(", ")}'s increment ${x.total.stated}`, miles: x.total.miles, slack: x.total.slack }));
  if (totals.length === 0) {
    unchecked["a quarter's run-rate"].push(r.month);
    continue;
  }
  figureForms["a quarter's run-rate"].push(r.month);
  const rate = millions(m[4]);
  if (!totals.some(t => within(rate.miles, t.miles / 3, rate.slack + t.slack / 3))) {
    figureErrors.push(`waymo ${r.month}: "${m[0]}" vs a third of ${[...new Set(totals.map(t => `${t.what}: ${milesOf(t.miles / 3)}`))].join("; ")}`);
  }
}
// "the <Month> row's terms at their per-day rates for <D> days", in a Waymo
// row: each term its list holds but CA's (whose clause states its own
// product) against the term of the same label that the named month's row
// lists (termsOf), read at its per-day rate for D days, T x D / its days. A
// term with no figure in a parenthesis after it is that, adjusted by any
// signed sum of the figures the rationale states outside the list and its
// "Total ... (...)" frame (each added, taken away or left out, none of them
// at all leaving it unadjusted), since an adjustment stated anywhere, in any
// words, may be the term's; one no such sum bears out goes unchecked where
// its label's last word ("Travis", "metros") stands elsewhere in the
// rationale too, which may state an adjustment in words, with no figure
// (since the round-2 review of 2026-11-05; from that day's round-1 review
// until then such a term went unchecked wherever the rationale held "about
// <x>M", "<b>M at <Month>'s rate" or "... before its ... deduction" outside
// the list's own adjustments, so an adjustment in other words failed and an
// unrelated "about" left every bare term unread; from earlier that day until
// the round-1 review it was read as unadjusted wherever its adjustment was
// written). One whose
// parenthesis opens "<b>M at <Month>'s rate" has b that, and the term b plus
// the parenthesis' adjustments; one whose parenthesis opens "<Month>'s <b>M
// before its <...> deduction" has b the named month's figure before its
// deduction (that month's term's parenthesis opening "(<b>M less"), and the
// term b x D / its days plus the adjustments. The adjustments are each
// "plus about <x>M", "less about <x>M" and "and about <x>M" (the sign of the
// one before) in the parenthesis at its own depth. A parenthesis holding any
// other figure there, or naming another month, is one this does not read, so
// its term goes unchecked, as does a term with no term of its label in the
// named month and an "about" term, an adjustment no named month's term gives
// (until the round-1 review of 2026-11-05 an "about" term was read against
// the named month's "about" term, an unrelated adjustment). Each result to
// the term's precision plus its inputs' carried through (the named month's
// term's half-unit at the per-day rate, and each stated adjustment's; until
// 2026-11-07 the stated figures taken as exact).
// Each base a term's parenthesis may open with, as the figure it gives the
// term (T being the named month's term of its label), whether that holds,
// and a note for the failure message, or undefined where it cannot be read
const PER_DAY_BASES = [
  // "(<b>M at <Month>'s rate": b, which is T at its per-day rate
  { re: new RegExp(String.raw`^\((\d+(?:\.\d+)?)M at ${MONTH_NAME}'s rate\b`), name: b => b[2],
    base: (b, before, perDay) => ({ miles: millions(b[1]).miles, slack: millions(b[1]).slack, holds: within(millions(b[1]).miles, perDay(before.miles), millions(b[1]).slack + perDay(before.slack)),
      note: `${b[1]}M, where ${before.stated} at its per-day rate is ${milesOf(perDay(before.miles))}` }) },
  // "(<Month>'s <b>M before its <...> deduction": b at its per-day rate, b
  // being the figure before T's deduction, the "<b>M less" in T's
  // parenthesis at its own depth (with none there b is unstated, so the term
  // goes unchecked)
  { re: new RegExp(String.raw`^\(${MONTH_NAME}'s (\d+(?:\.\d+)?)M before its [a-z ]+ deduction\b`), name: b => b[1],
    base: (b, before, perDay) => [...maskGroups((before.paren ?? "()").slice(1, -1)).matchAll(/(?<![\d.,])(\d+(?:\.\d+)?)M less\b/g)].slice(0, 1)
      .map(pre => ({ miles: perDay(millions(b[2]).miles), slack: perDay(millions(b[2]).slack), holds: Number(pre[1]) === Number(b[2]),
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
  return placed && !signs.includes(undefined) ? adjs.map((a, i) => ({ miles: signs[i] * millions(a[2]).miles, slack: millions(a[2]).slack })) : undefined;
};
// What the named month's row x makes term t (before being x's term of t's
// label): the figure, whether its base holds, and a note; or undefined where
// t's parenthesis is one this does not read
const perDayWant = (t, before, x, days, name) => {
  const perDay = y => y * days / daysIn(x.month), inner = maskGroups((t.paren ?? "()").slice(1, -1));
  if ([...inner.matchAll(FIGURE)].length === 0) { // no figure in a parenthesis after it
    return { want: perDay(before.miles), slack: perDay(before.slack), holds: true, bare: true, note: `${before.stated} at its per-day rate` };
  }
  const read = PER_DAY_BASES.map(b => ({ b, m: b.re.exec(t.paren) })).find(({ b, m }) => m !== null && b.name(m) === name);
  const adjustments = adjustmentsOf(inner), base = read === undefined ? undefined : read.b.base(read.m, before, perDay);
  if (base === undefined || adjustments === undefined) return undefined;
  return { want: base.miles + adjustments.reduce((sum, a) => sum + a.miles, 0), slack: base.slack + adjustments.reduce((sum, a) => sum + a.slack, 0), holds: base.holds, bare: false,
    note: `${base.note}, adjusted by ${adjustments.map(a => milesOf(a.miles)).join(", ")}` };
};
// The figures (millions, thousands or whole miles, no rate) a rationale
// states outside its list and its "Total <x>M ... (...)" frame, any of which
// may adjust a term of the list that states no adjustment of its own
const looseFigures = r => {
  const frames = [listSpans.get(r), ...[...r.rationale.matchAll(/\bTotal \d(?:[^().]|\.(?=\d))*\([^()]*\)/g)].map(t => [t.index, t.index + t[0].length])];
  const blanked = frames.reduce((s, [a, b]) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b), r.rationale);
  return [...blanked.matchAll(FIGURE)].filter(f => f[3] === undefined).map(f => asFigure(f).miles);
};
// Whether some signed sum of values (each added, taken away or left out) lies
// within slack of target: the reach of the sums with their slack, kept as
// intervals merged where they meet, which bounds the work by the values'
// spread over the slack rather than by 3 to the power of their count
const mergeSpans = spans => {
  const out = [];
  for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
    if (out.length > 0 && a <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
};
const signedSumNear = (values, target, slack) => values
  .reduce((spans, v) => mergeSpans([...spans, ...spans.map(([a, b]) => [a + v, b + v]), ...spans.map(([a, b]) => [a - v, b - v])]), [[-slack, slack]])
  .some(([a, b]) => a <= target && target <= b);
// Whether a term's label recurs: its last word ("Travis", "metros") stands in
// the rationale more than once
const labelRecurs = (r, t) => [...r.rationale.matchAll(new RegExp(String.raw`\b${t.label.split(" ").at(-1).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}\b`, "gi"))].length > 1;
for (const r of waymo) for (const m of r.rationale.matchAll(new RegExp(String.raw`\bthe ${MONTH_NAME} row's terms at their per-day rates for (\d+) days\b`, "g"))) {
  if (!termsOf.has(r)) { // its own list unread
    unchecked["a month at another's per-day rates"].push(r.month);
    continue;
  }
  const days = Number(m[2]), named = monthsNamed(MONTH_NAMES.indexOf(m[1])).map(month => rowOf("waymo", month)).filter(x => termsOf.has(x));
  const loose = looseFigures(r);
  for (const t of termsOf.get(r).filter(u => u.label !== "CA")) {
    // an "about" term is an adjustment, which no named month's term gives
    const wants = named.map(x => ({ x, before: termsOf.get(x).find(u => u.label === t.label && u.label !== "about") })).filter(w => w.before !== undefined)
      .map(w => ({ x: w.x, ...perDayWant(t, w.before, w.x, days, m[1]) })).filter(w => w.want !== undefined);
    if (wants.length === 0) {
      unchecked["a month at another's per-day rates"].push(`${r.month} ${t.label}`);
      continue;
    }
    // a bare term (no adjustment of its own) with any signed sum of the loose figures added
    const held = wants.some(w => w.holds && (w.bare ? signedSumNear(loose, t.miles - w.want, t.slack + w.slack) : within(t.miles, w.want, t.slack + w.slack)));
    if (!held && wants[0].bare && labelRecurs(r, t)) { // perhaps adjusted in words where its label recurs
      unchecked["a month at another's per-day rates"].push(`${r.month} ${t.label}`);
      continue;
    }
    figureForms["a month at another's per-day rates"].push(`${r.month} ${t.label}`);
    if (!held) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}": its ${t.label} term, ${t.stated}, vs ${wants.map(w => `${w.x.month}'s: ${w.note}, ${milesOf(w.want)}${w.holds ? "" : " (its base does not hold)"}`).join(" or ")}; a term with no adjustment of its own may also add any signed sum of the ${loose.length} figures stated outside the list and the total (${loose.map(milesOf).join(", ")})`);
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
  `Replicata: read every data/vmt.csv rationale (shown as written, its links as links, in the page's VMT sources table) and check (1) links to sections of data/README.md, (2) internal shorthand, (3) stated figures against the rows (and CPUC's miles in data/waymo-ca.csv, and Zoox's pre-series miles and days out against quals/zoox-vmt-model.qual.mjs's PRE_C and LV_PAUSE), and the stated pre-series offset against data/waymo_vmt.py's OFFSET, (4) the audit's corrected facts.
Expectata: (1) each link (any "[<text>](<target>)") has a text other than blanks and the target data/#<anchor>, <anchor> the id GitHub Pages gives one of data/README.md's headings (${ANCHORS.join(", ")}) and of the form the page reads (lowercase letters, digits and hyphens), and no "](" or target "data/#" stands outside a link but inside a longer path or address; on synthetic files the heading reader gives the ids of the page GitHub Pages serves (a heading inside an element read as markdown the HTML converter's), stops with its message on each form it stops on, and leaves unread, naming why, each heading of a form it does not read (a heading after one with as many possible ids as there are unread headings before it, plus one); on synthetic links each wrong form is named; (2) no kyoom, vmt_min/vmt_max, TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best" or "D/H"; (3) each figure stated in one of the forms that follow passes its form's test and is checked where its wording appears, none of these forms being required (a statement reworded out of its form goes unchecked, the human's rule of 2026-11-03), and a figure passes where it is right under one of the meanings its form reads its words to have (a month named without its year is any month of that name with a row, in the row's line or, for a Tesla line, either Tesla line, and a quarter named without its year any year's; the meanings a correct figure could have that no form reads are listed in the header as what remains), and goes unchecked rather than failing where a reading the rows do not hold may be its (each case below). The tests: a value to its stated precision, whole miles exactly and a whole number that may be rounded to its last nonzero digit; CPUC's miles to half a mile either way for each month summed, and a band's clipped edges to half a mile either way; the floor the series clears, the milestone day and a crossing with one mile's slack, a month-end floor or ceiling with one mile's, and the other floors exactly; a lifetime on a day on a path through its month, within the rounding the line's months carry (on a Zoox line the Zoox model's path where a clause names the model's path, "the path", "its path", "Zoox's path", "the smooth[est] path", "the model['s] path" or "the Zoox model's path", none followed by "of", "that", "which", "where" or "whose", or "that path", "this path" or "the same path" where the last path its words name before it is one of those, or names none of its own and refers back to one that does: the month's miles spread evenly or its Las Vegas share at one rate a driving day with the model's days out of the month, LV_PAUSE in quals/zoox-vmt-model.qual.mjs, where a Zoox rationale's "<Monthname> leaves out <list>" places them and else anywhere in it; elsewhere the even spread, a figure only some other path through the month bears out going unchecked); a figure marked "~" (or "≈", "about" and the like) to one unit of its last digit; and in products, sums, rates and per-day scalings each stated input's half-unit carried through to the result. The forms: each "<x>k" or "<x>M" "end-[<Mon>-]<YYYY>" is a series cumulative or lifetime that month of a line the row may mean or its clause names or, in a Waymo row, the hub's figure an anchor gives, as a floor, a ceiling or approximate where the words right before it say so (one that is none of these goes unchecked where it may be the lifetime in a month one of those lines has no row for, after the line's last row at least its cumulative and before its first at most its pre-series miles, a hub figure no anchor gives, at most the lifetime and after Waymo's rows anything, where its words do not name the series or a line without the hub, a figure of a line its clause names that has no rows, or another owner's, its clause holding a word other than the words of a reading of the row's own line, its clause counting, where a pronoun or a noun that names no owner refers back, the clauses before it in its sentence, or the sentence before, and what a parenthesis follows; a stop cuts a clause only before a capital letter or at the end); each Waymo anchor ("The <Mon>-<YYYY> cumulative lands on the anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles") is that month's cumulative, h + e - o; each Waymo band after an anchor in its rationale ("its cumulative band is the hub total plus <a>M to <b>M ..., less the pre-series miles' range, <l>M-<u>M") that month's cumulative band; each Waymo "update: <h>M rider-only miles thru <Mon>-<YYYY>", its clause ending after the month at a semicolon, a stop or a closing parenthesis, the hub figure every anchor for that month uses, where one exists; each Waymo "<n> in <YYYY>" of "by calendar year (...)" that year's summed months, for each year whose January the series holds; each Waymo "first million rider-only miles on <Mon> <D>, <YYYY>" the day the lifetime (the cumulative plus OFFSET's central, the month's miles spread evenly) reaches 1,000,000; each Waymo "floor the series clears, ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon> <D>, <YYYY>)" with N million no more than the lifetime at the end of that day on the even spread with the pre-series offset's high edge (one only the month's end clears going unchecked; for a day after the rows, no more than the last row's at its month's end, or else unchecked; for a day before the series, unchecked where no more than OFFSET's high edge, or else failing; a day no month of its name has failing); each Waymo "Total <x>M, about <y>k a day (...)" whose parenthesis holds "<Monthname>'s row <digit>" its miles and its miles over its days (the rate to one unit of its last digit, its "about"), and in that parenthesis each "<Monthname>'s row <z>k" that month's miles over its days and each "measured Q<n> <w>k" those of a quarter n; each Waymo "Cross-check: <x>M/mo ≈ <y>M/wk" a pair that agrees for a month of 28 to 31 days or the average month, 365.25/12 days, and with " vs Waymo's" after it its miles and its miles times 7 over its days or the average month's; each Waymo "Band x<lo> to x<hi>" followed in its sentence by "the components' ranges combined" its row's band over its miles; each Waymo list of terms (the sentence "CA = ..." or "CA <digit>..." opens, naming Maricopa, Travis, Atlanta and metros) its row's miles, its components (CA's, Maricopa's, Travis's, Atlanta's and the metros' terms, and an "about" term after " and ") plus any choice of its other labelled terms summed, where each figure in it is CA's term or a labelled term (otherwise it goes unchecked); each Waymo "CPUC Q<n>-<YYYY> driverless actual <d> deployment + <p> pilot (...) x <f>, ... = <r>M" with (d + p) x f equal to r, and d and p a month's of that quarter in data/waymo-ca.csv or the sums of two or three of its months (a base that is none of these, the file lacking one of the quarter's months, goes unchecked); each "<b>M ... x [the hub-vs-CPUC CA ratio ]<f>[ [<range>]] = <r>M", b one of the clause's "<num>M" figures before " x", with b x f equal to r, f a decimal or a ratio a/b; each "<Month> keeps ...end-of-month <c>[ (...)], its band <lo>-<hi>" that month's cumulative and cumulative band; each of the three readings of "end-<Month> <a> / <b> / <c>" inside that month's cumulative band where a later "<Month> keeps ..., its band <lo>-<hi> holding the three readings" says the band holds them; each "<Month>'s cumulative is that reading, <c>" or "is the chart's ~<c>" its cumulative, "..., its band from the call's <f> to <p>% above it" its band's floor f and its top p% above c, to the whole percent, and "..., its floor <f>" its band's floor; each "<Month>'s miles are at least <n>" with its miles at least n, and "..., puts them there (<v> with" its miles v; each "<Month>'s cumulative band, <lo> to <hi>" its cumulative band and each "End-<Month> cumulative floor <f>" its band's floor (where the month of that name nearest the row's, or another row's sharing its rationale, has no row, a figure of these forms that no row bears out goes unchecked where it may be that month's, after the line's last row each cumulative or band edge at least the last row's and before its first at most its pre-series miles, a month's own miles anything); in each row, "Each month is its cumulative less the month before's, its band the difference of their bands" its miles and band from its line's row before (from zero for a line's first), "a month's band is <a>x-<b>x its miles, within the difference of its cumulative band and the month before's" its band a and b times its miles, each edge held inside the difference of the two cumulative bands, "the cumulative is ...: <x>M less the <o> pre-series miles, <c>" its cumulative c with x less o equal to c, "Its band, <lo> to <hi>, is that statement's range" and a sentence's opening "Cumulative band <lo> to <hi>:" its cumulative band, a sentence's opening "Central <c>." its miles, and "The cumulative band's floor through <Mon> <D>, <f>, is the end-<Month> floor (<j>: ...) plus the <Month> and <Month> floors" with D the last day of <Mon>'s month, f that month's cumulative floor, j the end-<Month> one and j plus the two months' floors f; in a Tesla line's row, each "<Month>: <p> on the page" or "<Month>'s no-monitor miles are <p> on the page", at depth 0, its month after no possessive and its clause ending after "on the page" or going on to its deck reading, the no-monitor line's miles or cumulative that month, or the miles from a month named before it in its clause through it (with other words before its month, below the month's floor with no deck reading beside it, or with no row for its month, one none of these bears out goes unchecked), and after it each "floor <f>", "the central, <c>" and "the top, <t>" a floor, central and top of a month of a page reading before it or one its sentence names (one that another month's row bears out goes unchecked), each "the central, <c>, adds <Month>'s <r> monitor-aboard remainder" with c such a reading (the page's or the deck's) or the no-monitor line's miles plus r, and each "the top, <t>, ... (the higher reading x <f>)" with t the higher of a page reading before it and its deck reading times f; each "<r> monitor-aboard miles, <Month>'s measured remainder (the Q<q> deck's <a> paid miles less the page's <b> no-monitor miles)" with a and b Tesla's and the no-monitor line's miles that month and r a less b, each "<Month>'s <r> monitor-aboard remainder" with r their difference, and each "monitor-aboard share [stayed ]at or below <Month>'s <p>%" with p their difference over Tesla's miles (with no row for the month on both lines these go unchecked); each "no-monitor miles for the month as projected on the no-monitor line, <c> [<lo>, <hi>] (...), set the floor" the no-monitor line's miles and band that month, and lo the row's floor; each "crosses <x>M at the start of <Mon> <D>" (or "on") a day the lifetime reaches x, each "stands at <x>M on <Mon> <D>" the lifetime at the end of that day (or, on a month's last day, Waymo's hub figure an anchor gives, or where none gives one and the words do not name the series or a line without the hub, the unknown hub figure, at most the lifetime) and each "puts <n> lifetime miles at <Mon> <D>" the same, a ", <YYYY>" after the day naming its month's year, on a path through the day's month as above, of a line the row may mean or its clause names, the lifetime the series cumulative plus none or the line's pre-series miles (Waymo's OFFSET range, Zoox's PRE_C), a day no month of its name has, or that its year's month lacks, failing, a figure of a month the rows do not reach going unchecked only where the series' growth allows it (after a line's last row at least its cumulative, before its first at most its pre-series miles), and one no reading bears out going unchecked where, away from the Zoox model's path, its clause names another owner or a line with no rows; each "the <o> driverless miles before it come off <Name>'s ~<x>M-mile figure for <Mon> <D>, <YYYY>" with the lifetime that day, read so off a path (its month with no row going unchecked where the lifetime may be its figure then), counting o, x and o the line's pre-series figure; each Zoox "<Monthname> leaves out <list>", the list's stretches ("<Mon> <a>[-<b>]", joined by ", ", " and " or ", and ") all days of that month, as many days in all as LV_PAUSE holds out of a month of that name; each "a floor on the end-<Month> cumulative that only the <deck> deck's reading meets" with that deck's reading the one of the month's three readings (in the order "in its <deck> (...), <deck> and <deck> (...) update decks" lists them) at or above its cumulative floor; each "<Month>'s cumulative is the chart's ~<c>, its floor <f> (the lowest reading less ~<q>% read noise)" with f q% below the month's lowest reading, each "the end-<Month> floor (<j>: the deck's <d>M less ~<q>% read noise)" with d that month's cumulative and j q% below d, and each "the cumulative band's top carries ~<p>% upside and its floor ~<q>% read noise" with its cumulative band's top p% above its cumulative and its floor q% below; each "<n> <MON> SGO crashes in them ≈ <x>M at the <rate>/M" with n over the rate x, x to one unit of its last digit (its "≈"); each "(<a> a day with the x<k>) and the rest at <b> a day: <s>, rounded to <v>" with s the two rates times the row's days and v its miles; each Waymo "<A> <a>M[ and <B> <b>M] = the hub's measured Q<q> ... increment[s] (<x>M[ / <y>M])" with the quarter's three A terms summing to x (and B's to y); each Waymo "<A> <a>M (hub Q<q> run-rate <r>M/mo" with r a third of an A increment for a quarter q that a split statement gives; and each Waymo "the <Month> row's terms at their per-day rates for <D> days" with each term but CA's and the "about" terms that month's term of its label at its per-day rate for D days, plus the adjustments its parenthesis states ("<b>M at <Month>'s rate" or "<Month>'s <b>M before its ... deduction", then "plus about", "less about" and "and about"), a term whose parenthesis states none read so with any signed sum of the figures the rationale states outside the list and its "Total ... (...)" added (one none of these bears out goes unchecked where its label's last word stands elsewhere in the rationale too); Zoox's statements of its pre-series miles ("the <o> pre-series miles", "the <o> earlier driverless miles", "the <o> driverless miles before it", none qualified by the words right after it) give quals/zoox-vmt-model.qual.mjs's PRE_C, ${fmt(PRE_C)}, or a figure of its band PRE (an edge, ${fmt(PRE_BAND[0])} or ${fmt(PRE_BAND[1])}, or its California or Las Vegas part, ${fmt(PRE_CA)} or ${fmt(PRE_LV)}), to their precision, a whole number that may be rounded to half a unit of its last nonzero digit; every figure a Waymo rationale states for the pre-series offset (the builder's "miles driven before it, <central> (range <low>-<high>)", "<x>M pre-series miles", "pre-series miles' range, <low>M-<high>M") equals OFFSET, central ${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)}, whole miles exactly and millions to their stated precision; (4) none of the corrected statements recurs.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: ${rows.length} VMT rationales link only to sections of data/README.md (${links} links, to the ids of its ${README_IDS.length} headings), use no internal shorthand, and state figures that pass their form's test (the rows' values; sums, products, shares and rates that hold; readings inside the rows' bands; floors and ceilings the rows meet; lifetimes on a day on a path through their month; approximate figures within a unit of their last digit; CPUC miles that data/waymo-ca.csv holds, a month's or a sum's; Zoox's statements of its pre-series miles giving the Zoox model's PRE_C, ${fmt(PRE_C)}, to their precision; and the days out a Zoox rationale states as many as the model's LV_PAUSE holds) in every form read here (${Object.entries(figureForms).map(([f, found]) => `${found.length} ${f}`).join(", ")}; found with nothing to read them against, so unchecked: ${Object.entries(unchecked).map(([f, found]) => `${found.length} ${f}`).join(", ")}); ${Object.values(offsetForms).flat().length} Waymo statements of the pre-series offset, in ${OFFSET_FORMS.length} forms, give data/waymo_vmt.py's OFFSET (${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)})`);

import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// The sanity section's "VMT sources" table shows each data/vmt.csv rationale
// verbatim (those of the window's months, and a ghost month's when the window
// ends at the newest NHTSA month; data/README.md, Ghost months), so the
// rationales are page text. Added 2026-10-03 for the 2026-10-02 audit
// findings #38, #39, #47 and #76-#80:
//   (1) every document a rationale cites resolves: it names the file
//       (data/README.md or IGNOREME.md; a bare "README" is ambiguous) and a
//       section heading that exists in it;
//   (2) no repo-internal column name or shorthand (kyoom, vmt_min/vmt_max,
//       TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best", "D/H"), none
//       of which the page defines (rule 13);
//   (3) every figure a rationale states in a form (3a) reads (a cumulative
//       or cumulative band, a calendar year's miles, a milestone day, a
//       row's miles, its daily or weekly rate or its band's multipliers, a
//       named month's or quarter's daily rate) is the rows' value to its
//       stated precision; a hub figure there is the one the anchors for its
//       month use, and a public floor the series clears is one the rows'
//       lifetime meets. These figures are checked where their wording
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
//       for the pre-series offset (the builder's "<central> (range
//       <low>-<high>)", the Apr-Jun 2026 rows' "<x>M pre-series miles" and
//       June's "pre-series miles' range, <low>M-<high>M") equals
//       data/waymo_vmt.py's OFFSET, each form is found at least once and
//       every "pre-series" in a Waymo rationale lies in one (since
//       2026-11-03; until then this checked milestones listed as "exact
//       centrals minus ~0.15M", a wording gone from the rows since
//       2026-10-31, against the cumulative plus 0.15M); the Zoox Nov-2025
//       (added 2026-11-02), Dec-2025 and Mar-2026 knots, the Zoox Jul-2026
//       floor (both added 2026-10-27) and Tesla's Aug-2026 floor state the
//       band edges their rows carry;
//   (4) the specific facts the audit corrected stay corrected;
//   (5) Tesla's Sep 2025-Jun 2026 rationales disclose possible driver's-seat
//       trips (decision of 2026-10-31, open question 13).
// No (3a) form is required, but other checks here still require or forbid
// wording, so a rewording alone, with every figure right, can turn the qual
// red. They require: (1) "<file>, <heading>" in every mention of
// data/README.md, IGNOREME.md or "README", each taken for a citation; (3b)
// each of its three offset forms at least once and every "pre-series" inside
// one; (3c) its five knot and floor rows' band edges written as the rows'
// figures, with thousands commas; (4) Waymo's weekly-trips quote word for
// word with its citation, "'more than half a million paid trips weekly'
// (Waymo, Sep 15, 2026", wherever "half a million" appears in a Waymo
// rationale (and "Aug 28" with NTA's "Sub 5" order and "X user" with Zoox's
// "Jan 22-27" outage, should either return); and (5) the words "driver's
// seat", "Level 2 file" and "no-monitor line" in each of Tesla's Sep
// 2025-Jun 2026 rationales. They forbid, so a correct statement that uses
// one turns the qual red too: (2)'s seven shorthand patterns (item (2)
// above), and the phrase each of (4)'s other facts but the last (which reads
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
// fail there, as a lifetime written in the end-of-month form would (item (3)
// above). Relaxing any of them is the human's call (rule 5).

const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const rows = raw.slice(1).map(p => ({
  helmer: p[0], month: p[1], vmt: +p[2], cume: +p[3], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7], rationale: p[8],
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

// (1) citations resolve
const headingsOf = path => fs.readFileSync(path, "utf8").split("\n")
  .filter(l => /^#+ /.test(l)).map(l => l.replace(/^#+ /, "").replace(/^\[AI TEXT\] /, "").trim());
const HEADINGS = { "data/README.md": headingsOf("data/README.md"), "IGNOREME.md": headingsOf("IGNOREME.md") };
const badCites = [];
for (const r of rows) {
  for (const m of r.rationale.matchAll(/(data\/README\.md|IGNOREME\.md|README)(?:, ([^;)]+))?/g)) {
    const [whole, file, section] = m;
    if (!(file in HEADINGS) || section === undefined || !HEADINGS[file].includes(section.trim())) {
      badCites.push(`${r.helmer} ${r.month}: ${JSON.stringify(whole)}`);
    }
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
// a floor is one the rows' lifetime meets). Each form is located by the frame
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
//   Waymo's anchor: "The <Mon>-<YYYY> cumulative lands on the anchor: the
//     hub's <h>M plus <e>M ..., less the <o>M pre-series miles" is that
//     month's cumulative, h + e - o (the April-June 2026 rows);
//   its band: "its cumulative band is the hub total plus <a>M to <b>M ...,
//     less the pre-series miles' range, <l>M-<u>M", after an anchor in the same
//     rationale, is that month's cumulative band, h + a - u to h + b - l
//     (June's row); with no anchor before it in its rationale its hub total
//     is unstated, so it goes unchecked (the pass line counts it so);
//   the hub's figure: "<h>M rider-only miles thru <Mon>-<YYYY>" is the hub
//     figure every anchor for that month uses (the April-June 2026 rows); with
//     no anchor for that month in any rationale it goes unchecked (the pass
//     line counts it so);
//   calendar years: each "<n> in <YYYY>" inside "by calendar year (...)" is
//     that year's miles, its months summed, for each year whose January the
//     series holds (2021's total includes January-June 2021, before the series
//     starts, which only the pre-series offset holds; the builder's July
//     2021-January 2023 rows);
//   a milestone day: "first million rider-only miles on <Mon> <D>, <YYYY>": the
//     lifetime (the cumulative plus OFFSET's central, the month's miles
//     spread evenly over its days) reaches 1,000,000 during that day, to a
//     mile (the same rows);
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
//   a Waymo row's total and daily rate: "Total <x>M, about <y>k a day" is its
//     miles and its miles over its days (October 2026's ghost row: "Total
//     22.25M, about 718k a day (September's row 714k; measured Q2 608k)").
//     The total is read only beside the row's daily rate, since "Total" can
//     begin any total, the hub's or a component's (until a further review
//     later on 2026-11-03 any "Total <x>M" in a Waymo row was read as its
//     miles, which fails a correct "Total 271.329M rider-only miles thru
//     Jun-2026"); and the frame starts at the total so that no component's
//     daily rate, and no month's miles in thousands (as Waymo's early months
//     are), is read as a row's. In the parenthesis right after it each
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
//   band multipliers: a Waymo row's "Band x<lo> to x<hi>" is its band over
//     its miles (October 2026's ghost row).
const figureErrors = [];
const figureForms = Object.fromEntries(["end of a month or year", "Waymo anchor", "Waymo anchor band", "hub figure",
  "calendar year", "milestone day", "floor the series clears", "Waymo total and daily rate",
  "a month's daily rate", "a quarter's daily rate", "a month and its week", "band multipliers"].map(f => [f, []]));
// statements found in their frames but with no anchor sentence to read them against
const unchecked = { "Waymo anchor band": [], "hub figure": [] };
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
  for (const m of r.rationale.matchAll(/\bTotal (\d+(?:\.\d+)?)M, about (\d+(?:\.\d+)?)k a day\b/g)) {
    figureForms["Waymo total and daily rate"].push(r.month);
    const total = millions(m[1]), rate = thousands(m[2]), perDay = r.vmt / daysIn(r.month);
    if (!within(total.miles, r.vmt, total.slack) || !within(rate.miles, perDay, rate.slack)) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs its miles, ${fmt(r.vmt)}, and its miles over its ${daysIn(r.month)} days, ${milesOf(perDay)}`);
    }
  }
  for (const frame of r.rationale.matchAll(/\bTotal \d+(?:\.\d+)?M, about \d+(?:\.\d+)?k a day \(([^()]*)\)/g)) {
    for (const m of frame[1].matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)'s row (\d+(?:\.\d+)?)k\b/g)) {
      figureForms["a month's daily rate"].push(r.month);
      const mm = String(MONTH_NAMES.indexOf(m[1]) + 1).padStart(2, "0"), stated = thousands(m[2]);
      const row = rowOf("waymo", waymo.map(x => x.month).filter(x => x.endsWith(`-${mm}`) && x <= r.month).sort().at(-1));
      if (row === undefined || !within(stated.miles, row.vmt / daysIn(row.month), stated.slack)) {
        figureErrors.push(`waymo ${r.month}: "${m[0]}" vs ${row === undefined ? `no ${m[1]} row at or before ${r.month}` : `${row.month}'s miles over its ${daysIn(row.month)} days, ${milesOf(row.vmt / daysIn(row.month))}`}`);
      }
    }
    for (const m of frame[1].matchAll(/\bmeasured Q([1-4]) (\d+(?:\.\d+)?)k\b/g)) {
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
  for (const m of r.rationale.matchAll(/Band x(\d+(?:\.\d+)?) to x(\d+(?:\.\d+)?)/g)) {
    figureForms["band multipliers"].push(r.month);
    const slack = s => 0.5 * 10 ** -decimals(s) + 1e-9;
    if (!within(Number(m[1]), r.vmin / r.vmt, slack(m[1])) || !within(Number(m[2]), r.vmax / r.vmt, slack(m[2]))) {
      figureErrors.push(`waymo ${r.month}: "${m[0]}" vs its band over its miles, x${(r.vmin / r.vmt).toFixed(4)} to x${(r.vmax / r.vmt).toFixed(4)}`);
    }
  }
}

// (3b) The pre-series offset as Waymo rationales state it: the rider-only
// miles Waymo drove before the series starts, which every lifetime figure
// includes, data/waymo_vmt.py's OFFSET (central, low, high). Each stated
// figure equals it, whole miles exactly and millions to their stated
// precision. Each form is found at least once, and every "pre-series" in a
// Waymo rationale lies in a form's match, so a figure stated in a new wording
// stops the check rather than escaping it. Until 2026-11-03 this check
// looked instead for milestones listed as "(...) are exact centrals minus
// ~0.15M" and held each to the month's cumulative plus 150,000, the offset's
// central until 2026-11-02; no rationale had used that wording since
// 2026-10-31, so it checked nothing (open question 35(a)).
const OFFSET_FORMS = [
  // data/waymo_vmt.py's EARLY_NOTE, July 2021-January 2023: "<central>
  // (range <low>-<high>)" in whole miles
  { form: "builder", re: /(\d{1,3}(?:,\d{3})+) \(range (\d{1,3}(?:,\d{3})+)-(\d{1,3}(?:,\d{3})+)\)/g,
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
  const read = [];
  for (const { form, re, figures } of OFFSET_FORMS) {
    for (const m of r.rationale.matchAll(re)) {
      offsetForms[form].push(r.month);
      read.push([m.index, m.index + m[0].length]);
      for (const [field, f] of figures(m)) {
        if (!(Math.abs(f.miles - OFFSET[field]) <= f.slack)) {
          offsetErrors.push(`${r.month}: the ${form} form's ${field} "${f.stated}" in "${m[0]}", where OFFSET's ${field} is ${fmt(OFFSET[field])}`);
        }
      }
    }
  }
  for (const m of r.rationale.matchAll(/pre-series/g)) {
    if (!read.some(([a, b]) => a <= m.index && m.index < b)) {
      offsetErrors.push(`${r.month}: "pre-series" at "${r.rationale.slice(Math.max(0, m.index - 40), m.index + 40)}" in no form this check reads`);
    }
  }
}
for (const [form, months] of Object.entries(offsetForms)) {
  if (months.length === 0) offsetErrors.push(`the ${form} form is in no Waymo rationale`);
}

// (3c) knot and floor rows state the band edges they carry (Zoox's November
// 2025 knot, the 1M crossing's, added 2026-11-02 with the smooth 2025 path)
const unstated = [];
for (const [helmer, month, edges] of [["zoox", "2025-11", ["kmin", "kmax"]], ["zoox", "2025-12", ["kmin", "kmax"]],
  ["zoox", "2026-03", ["kmin", "kmax"]], ["zoox", "2026-07", ["kmin"]], ["tesla", "2026-08", ["kmin"]]]) {
  const r = rows.find(x => x.helmer === helmer && x.month === month);
  for (const e of edges) if (!r.rationale.includes(fmt(r[e]))) unstated.push(`${helmer} ${month}: ${fmt(r[e])}`);
}

// (4) the audit's specific corrections
const FACTS = [
  // #76: a band note runs into the next sentence without a stop
  [r => /±\d+% [A-Z]/.test(r.rationale), "a band note joined to the next sentence ('±25% Re-chained')"],
  // #39: Waymo's 'more than 4,000 vehicles' (TechCrunch, Sep 1) is a fleet figure measured after June
  [r => /fleet figure measured after Jun 2026/.test(r.rationale), "claims no post-June Waymo fleet figure exists"],
  // #77: Q2-2026's monthly estimates ran ~1.4-2.9x high; 28% is the end-Q2 cumulative
  [r => /~28% high for Q2/.test(r.rationale), "states Q2's miss as the cumulative's 28%"],
  // #78: NTA's Sub 5 order is dated Aug 28, 2026
  [r => /Sub 5/.test(r.rationale) && !/Aug 28/.test(r.rationale), "dates Sub 5 other than Aug 28"],
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
  // Second audit (2026-10-04) #38: Waymo's Sep 14, 2026 Las Vegas post gives
  // no weekly figure; its Sep 15, 2026 Allianz Partners post says "serving
  // more than half a million paid trips weekly"
  [r => r.helmer === "waymo" && /half a million/.test(r.rationale)
    && !/'more than half a million paid trips weekly' \(Waymo, Sep 15, 2026/.test(r.rationale),
    "quotes Waymo's weekly-trips floor other than as its Sep 15, 2026 words, 'more than half a million paid trips weekly'"],
  // Second audit #39: LVRJ (Jan 28, 2026) credits the Jan 22 start of Zoox's
  // Las Vegas outage to an X user's posts; the NTA spokeswoman gave the cause
  // and the Jan 27 restart
  [r => r.helmer === "zoox" && /Jan 22-27/.test(r.rationale) && !/X user/.test(r.rationale),
    "credits the Jan 22 start of Zoox's Las Vegas outage to someone other than the X user LVRJ cites"],
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

// Decision of 2026-10-31 (open question 13): every Tesla month that may hold
// trips with a safety monitor in the driver's seat (Sep 2025-Jun 2026, the
// every-mode line's months before Tesla's no-monitor series) discloses it:
// such a trip's crashes, if it ran as FSD (Supervised), go to NHTSA's Level 2
// file, so they may be missing from the count.
const undisclosed = rows.filter(r => r.helmer === "tesla" && r.month >= "2025-09" && r.month <= "2026-06"
  && !(/driver's seat/.test(r.rationale) && /Level 2 file/.test(r.rationale) && /no-monitor line/.test(r.rationale)))
  .map(r => r.month);
const factErrors = [];
for (const r of rows) for (const [bad, what] of FACTS) if (bad(r)) factErrors.push(`${r.helmer} ${r.month}: ${what}`);
const problems = {
  unresolvedCitations: [...new Set(badCites)],
  internalShorthand: jargon,
  figuresNotTheRows: [...new Set(figureErrors)],
  preSeriesOffsetNotOffset: offsetErrors,
  bandEdgesNotStated: unstated,
  correctedFactsRecur: factErrors,
  driversSeatUndisclosed: undisclosed,
};
const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0));
assert.deepEqual(failing, {},
  `Replicata: read every data/vmt.csv rationale (shown verbatim in the page's VMT sources table) and check (1) citations, (2) internal shorthand, (3) stated figures and band edges against the rows, and the stated pre-series offset against data/waymo_vmt.py's OFFSET, (4) the audit's corrected facts, (5) Tesla's driver's-seat disclosure.
Expectata: (1) each citation names data/README.md or IGNOREME.md and a section heading that exists there; (2) no kyoom, vmt_min/vmt_max, TotalVMTZEV, "hub + E", "+ E <digit>", "E lo/hi/best" or "D/H"; (3) each figure stated in one of the forms that follow passes its form's test, to its stated precision, and is checked where its wording appears, none of these forms being required (a statement reworded out of its form goes unchecked, the human's rule of 2026-11-03): each "<x>k" or "<x>M" "end-[<Mon>-]<YYYY>" is that line's series cumulative; each Waymo anchor ("The <Mon>-<YYYY> cumulative lands on the anchor: the hub's <h>M plus <e>M ..., less the <o>M pre-series miles") is that month's cumulative, h + e - o; each band after an anchor in its rationale ("its cumulative band is the hub total plus <a>M to <b>M ..., less the pre-series miles' range, <l>M-<u>M") that month's cumulative band; each "<h>M rider-only miles thru <Mon>-<YYYY>" the hub figure every anchor for that month uses, where one exists; each "<n> in <YYYY>" of "by calendar year (...)" that year's summed months, for each year whose January the series holds; each "first million rider-only miles on <Mon> <D>, <YYYY>" the day the lifetime (the cumulative plus OFFSET's central, the month's miles spread evenly) reaches 1,000,000; each Waymo "floor the series clears, ...'more than <N> million fully autonomous miles' ([<source>, ]<Mon> <D>, <YYYY>)" with N million no more than the lifetime at the end of that day, to a mile; each Waymo "Total <x>M, about <y>k a day" its miles and its miles over its days, and in the parenthesis after it each "<Monthname>'s row <z>k" the miles over the days of the latest month of that name at or before the row's, and each "measured Q<n> <w>k" those of the latest quarter n ending at or before the row's month; each Waymo "Cross-check: <x>M/mo ≈ <y>M/wk" its miles and its miles times 7 over its days; each Waymo "Band x<lo> to x<hi>" its row's band over its miles. Two parts of (3) do require their statements (relaxing them is the human's call, rule 5): every figure a Waymo rationale states for the pre-series offset (the builder's "<central> (range <low>-<high>)", "<x>M pre-series miles", "pre-series miles' range, <low>M-<high>M") equals OFFSET, central ${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)}, whole miles exactly and millions to their stated precision, each of those three forms is found at least once, and every "pre-series" in a Waymo rationale lies in one; and the Zoox Nov-2025, Dec-2025 and Mar-2026 knots, the Zoox Jul-2026 floor and Tesla's Aug-2026 floor state the band edges their rows carry, as the rows' figures with thousands commas; (4) none of the corrected statements recurs; (5) every Tesla rationale of Sep 2025-Jun 2026 says those months may hold trips with a safety monitor in the driver's seat, whose crashes NHTSA may file in its Level 2 file, a bias the no-monitor line avoids.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: ${rows.length} VMT rationales cite resolvable sections, use no internal shorthand, and give the rows' figures in every form read here (${Object.entries(figureForms).map(([f, found]) => `${found.length} ${f}`).join(", ")}; found with no anchor sentence to read them against, so unchecked: ${Object.entries(unchecked).map(([f, found]) => `${found.length} ${f}`).join(", ")}); ${Object.values(offsetForms).flat().length} Waymo statements of the pre-series offset, in ${OFFSET_FORMS.length} forms, give data/waymo_vmt.py's OFFSET (${fmt(OFFSET.central)}, range ${fmt(OFFSET.low)}-${fmt(OFFSET.high)})`);

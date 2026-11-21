// The page's list of its assumptions (the human, 2026-11-20: "can we get all
// such assumptions clearly listed in one place on the page?"): the section
// #sec-assumptions, between the summary cards' section (#sec-summary) and the
// sanity section (#sec-sanity), drawn once at init by crashla.js
// renderAssumptions from one constant, ASSUMPTIONS: per group
// (ASSUMPTION_GROUPS) a table whose rows give an entry's text, green AI text,
// and where its value is set. Every figure a text shows is read live from
// crashla.js (its constants, the VMT rows) or held as a literal in the entry's
// values, which this qual checks against its source. Spec, in a DOM stub (1-9)
// and in Chromium, Firefox and WebKit (10):
//  1. Structure: the groups are tesla, waymo, zoox, reporting, incidents,
//     model, humans and growth, in that order, each with a title and at least
//     one entry; every entry has a unique kebab-case id, a known group, a text
//     function, a values object and where pairs [file, names], the file named.
//  2. Render: renderAssumptions gives the intro (AI text in a month-note
//     paragraph), then per group an h3 and a .table-wrap holding
//     table#assumptions-<group>, whose header row has the two column headers
//     and whose body has one row tr#assumption-<id> per entry, in ASSUMPTIONS
//     order: its first cell td.ai-text holding the entry's text with its
//     links as this qual draws them (rationale-links.mjs, apart from
//     crashla.js), its second plain, the where pairs. No text holds
//     "undefined", "NaN", "null", "Infinity", "[object" or a "{" left from a
//     placeholder.
//  3. Inventory: INVENTORY below and ASSUMPTIONS hold the same entries, and
//     for each, INVENTORY names exactly the entry's values.
//  4. Values: each value equals its source, read by its kind: py (an
//     expression on data/slurp.py, data/faultrate.py or data/waymo_vmt.py,
//     all read by one python3 run), qual (top-level consts of a qual, each
//     initializer evaluated in a fresh vm with the consts it names, and for
//     the camera rule's figures the newest camera table saved in
//     data/snapshots, read through quals/camera-table.mjs, since the tables
//     entered data/snapshots on 2026-11-20: the camera qual's weekly rates
//     are no longer a literal), rel (a
//     relation recomputed on data/vmt.csv, data/waymo-ca.csv,
//     data/waymo-ca-sources.json, a qual's consts or the app's), or doc (no
//     file computes it: DOC pins each such value, so a new one, or a changed
//     one, is added deliberately; a figure a model qual uses is read from a
//     named top-level const of it, not pinned here, since 2026-11-20).
//     CLAIMS checks the words and live figures of a text that no value
//     holds.
//  5. Where: each pair resolves: a crashla.js name is defined in it; a .py
//     file's names are attributes of its module; a qual's names are declared
//     in it; data/README.md's are headings of it; data/vmt.csv's are a line,
//     with or without a span of its months ("<line> <YYYY-MM> – <YYYY-MM>");
//     any other file exists, a .json file's names keys of its entries.
//  6. Registries: every human band of METRIC_DEFS (the derived
//     HumansRideshare bands included) is in exactly one entry's bands; every
//     helmer of FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST is in some
//     entry's forecasts; each constant of TEXT_CONSTANTS is read by some
//     entry's text.
//  7. Months: every line-month of data/vmt.csv, ghost months included, lies
//     in a span some entry covers for its line, each span's ends months of
//     that line. A release that adds a month turns this red until the entry
//     for the month's method covers it (data/README.md, Each NHTSA release).
//  8. Constants: every module-level UPPER_CASE name of the three Python
//     builders, and every top-level UPPER_CASE const of the three model quals
//     (tesla-camera-miles, zoox-vmt-model, waymo-vmt-model), is named in some
//     entry's where or listed in NOT_ASSUMPTIONS with a one-word reason (its
//     words in REASONS); NOT_ASSUMPTIONS names nothing that is gone or that a
//     where names.
//  9. Credit and links: no web address stands outside a markdown link in any
//     text; every link to robotaxitracker.com has its address as its text and
//     sits in a text that names Robotaxi Tracker; every link has a form the
//     page draws (rationale-links.mjs DRAWN_LINK, crashla.js RATIONALE_LINK).
// 10. In Chromium, Firefox and WebKit (the default view, 1200x900, and for
//     (d) also 641, 375 and 320 px wide):
//     (a) #sec-assumptions sits right after #sec-summary and right before
//     #sec-sanity, and its heading collapses it with x= listing assumptions,
//     which a reload keeps, and opens it again with x= dropping it; (b) each
//     text run inside AI text is drawn in the AI ink (--ai-ink) and its AI
//     text dotted-underlined, and no other run (headings, column headers,
//     where cells) is in the AI ink or under a dotted underline; with forced
//     colors (emulated) only the marks are checked; (c) every link inside
//     the entries, and one more that the app's rationaleHtml draws into the
//     first entry's text cell for the check (so a list with no link is
//     still checked), keeps the AI ink at rest and hovered, with a solid
//     underline; (d) at 1200, 641 (the narrowest width at which the where
//     column sits beside the text), 375 and 320 px wide, no assumptions
//     table needs a sideways pan in its box, no where cell breaks a line
//     between two word characters (an identifier split across lines), and
//     every where cell has room for at least WHERE_MIN_CHARS characters a
//     line (a column squeezed to a few characters a line, as the derivations
//     column once was, audit 2026-10-04 #21, is unreadable); (e) no page
//     errors.
// No wording is checked: the texts' words are free, and only their figures
// (values, CLAIMS) and links are read.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";
import { parseCsv } from "./csv-parse.mjs";
import { LINK, DRAWN_LINK, rationaleMarkup, escText } from "./rationale-links.mjs";
import { ENGINES, serveRepo, openPage, drawnAll } from "./browser.mjs";
import { NEWEST_CAMERA_TABLE } from "./camera-table.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const GROUPS = ["tesla", "waymo", "zoox", "reporting", "incidents", "model", "humans", "growth"];
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const nextMonth = m => { const n = +m.slice(0, 4) * 12 + +m.slice(5, 7); return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; };
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- The app in a DOM stub whose nodes escape text as a browser's do --------
class Stub {
  constructor() { this._h = ""; }
  set textContent(v) { this._h = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  get textContent() { return this._h; }
  set innerHTML(v) { this._h = v; }
  get innerHTML() { return this._h; }
}
const nodes = new Map();
const ctx = vm.createContext({ console, document: {
  getElementById: id => (nodes.has(id) || nodes.set(id, new Stub()), nodes.get(id)),
  createElement: () => new Stub() } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const app = src => vm.runInContext(src, ctx);
const appJson = src => JSON.parse(app(`JSON.stringify(${src})`));
app("incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);");
assert.ok(app(`typeof ASSUMPTIONS !== "undefined" && typeof ASSUMPTION_GROUPS !== "undefined" && typeof ASSUMPTION_COLUMNS !== "undefined" &&
  typeof ASSUMPTIONS_INTRO !== "undefined" && typeof renderAssumptions === "function"`),
  `Replicata: load crashla.js and read ASSUMPTIONS, ASSUMPTION_GROUPS, ASSUMPTION_COLUMNS, ASSUMPTIONS_INTRO and renderAssumptions.
Expectata: the page's list of assumptions: its entries, its groups, its two column headers, its intro and the function that draws the section.
Resultata: ${["ASSUMPTIONS", "ASSUMPTION_GROUPS", "ASSUMPTION_COLUMNS", "ASSUMPTIONS_INTRO", "renderAssumptions"].filter(n => app(`typeof ${n}`) === "undefined").join(", ")} undefined.`);
const entries = app("ASSUMPTIONS");
const groups = appJson("ASSUMPTION_GROUPS");
const byId = new Map([...entries].map(e => [e.id, e]));
const valuesOf = id => JSON.parse(JSON.stringify(byId.get(id).values));
const problems = [];

// --- data/vmt.csv, data/waymo-ca.csv, data/waymo-ca-sources.json ------------
const vmtCsv = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
assert.deepEqual(vmtCsv[0].slice(0, 8), ["helmer", "month", "vmt", "helmer_cumulative_vmt", "kyoom_min", "kyoom_max", "vmt_min", "vmt_max"],
  "data/vmt.csv's first eight columns are helmer, month, vmt, helmer_cumulative_vmt, kyoom_min, kyoom_max, vmt_min and vmt_max");
const csvRows = vmtCsv.slice(1).map(r => ({ line: r[0], month: r[1], vmt: +r[2], cume: +r[3], kmin: +r[4], kmax: +r[5], vmin: +r[6], vmax: +r[7] }));
const row = (line, month) => {
  const r = csvRows.find(x => x.line === line && x.month === month);
  assert.ok(r !== undefined, `data/vmt.csv has no ${line} row for ${month}`);
  return r;
};
const lineRows = line => csvRows.filter(r => r.line === line).sort((a, b) => (a.month < b.month ? -1 : 1));
const span = (line, from, to) => lineRows(line).filter(r => r.month >= from && r.month <= to);
const before = r => { const all = lineRows(r.line); return all[all.findIndex(x => x.month === r.month) - 1]; };
const LINES = { tesla: "Tesla", teslanomonitor: "TeslaNoMonitor", waymo: "Waymo", zoox: "Zoox" };
const caCsv = parseCsv(fs.readFileSync("data/waymo-ca.csv", "utf8"));
const caSources = JSON.parse(fs.readFileSync("data/waymo-ca-sources.json", "utf8"));

// --- A qual's top-level consts ------------------------------------------------
// The scanner reads past strings, template literals, comments, regular-
// expression literals and brackets to the end of a declarator, a "," or ";"
// outside them. It tells a regular expression's "/" from division by what
// comes before it: an operator, an opening bracket, a "," or ";", or one of
// the keywords after which an expression starts (REGEX_AFTER: `return
// /x/.test(s)`); after anything else (a name, a number, a closing bracket) it
// reads division. Limits, none of which the model quals' top-level consts
// use: a template literal's ${...} holding a backquote, a regular expression
// after a closing bracket (`if (a) /x/.test(s)`), and a division after a
// property named like one of those keywords (`a.in / 2`). A declarator read
// wrongly stops this qual, at "a declarator runs to the file's end" or when
// constOf evaluates the cut initializer (until 2026-11-20 a regular
// expression after `return` did, though the keyword was not read).
const REGEX_AFTER = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);
function declaratorEnd(src, i) {
  let depth = 0, prev = "=";
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); assert.ok(i >= 0, "a line comment runs to the file's end"); continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === "'" || c === '"' || c === "`") {
      for (i++; src[i] !== c; i++) if (src[i] === "\\") i++;
      prev = c; continue;
    }
    // The word just before this character, if one ends there (the optional
    // group matches the empty string where none does).
    const word = c === "/" ? /([A-Za-z_$][\w$]*)?\s*$/.exec(src.slice(Math.max(0, i - 40), i))[1] : undefined;
    if (c === "/" && ("(,=:[!&|?{};+-*%<>~^".includes(prev) || REGEX_AFTER.has(word))) {
      let inClass = false;
      for (i++; inClass || src[i] !== "/"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
      }
      prev = "/"; continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && (c === "," || c === ";")) return i;
    if (!/\s/.test(c)) prev = c;
  }
  return assert.fail(`a declarator runs to the file's end at ${i}`);
}
const DECLS = new Map();
function constDeclarations(file) {
  if (DECLS.has(file)) return DECLS.get(file);
  const src = fs.readFileSync(file, "utf8");
  const decls = new Map();
  for (const m of src.matchAll(/^const\s/gm)) {
    let i = m.index + m[0].length;
    for (;;) {
      const head = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*/.exec(src.slice(i, i + 200));
      if (head === null) break; // a destructuring declaration
      const end = declaratorEnd(src, i + head[0].length);
      assert.ok(!decls.has(head[1]), `${file} declares the const ${head[1]} twice at its top level`);
      decls.set(head[1], src.slice(i + head[0].length, end).trim());
      if (src[end] === ";") break;
      i = end + 1;
    }
  }
  DECLS.set(file, decls);
  return decls;
}
// A const's value: its initializer evaluated in a fresh vm, with each const of
// the same file it names evaluated first (a name the file does not declare
// stops this qual).
const VALUES = new Map();
function constOf(file, name, chain = []) {
  const key = `${file} ${name}`;
  if (VALUES.has(key)) return VALUES.get(key);
  const decls = constDeclarations(file);
  assert.ok(decls.has(name), `${file} declares no top-level const ${name}`);
  assert.ok(!chain.includes(name), `${file}'s const ${name} depends on itself (${chain.join(" -> ")})`);
  const sandbox = vm.createContext({});
  for (;;) {
    try {
      const value = vm.runInContext(`(${decls.get(name)})`, sandbox);
      VALUES.set(key, value);
      return value;
    } catch (e) {
      const missing = e !== null && e.name === "ReferenceError" ? /^(\S+) is not defined$/.exec(e.message) : null;
      assert.ok(missing !== null && decls.has(missing[1]),
        `Replicata: evaluate ${file}'s top-level const ${name} (${decls.get(name).slice(0, 120)}).\nExpectata: a value, from literals and the file's other consts.\nResultata: ${e}.`);
      sandbox[missing[1]] = constOf(file, missing[1], [...chain, name]);
    }
  }
}
const CAMERA = "quals/tesla-camera-miles.qual.mjs", ZOOX = "quals/zoox-vmt-model.qual.mjs", WAYMO = "quals/waymo-vmt-model.qual.mjs";
const PROVENANCE = "quals/tesla-vmt-provenance.qual.mjs", FLOOR = "quals/tesla-unsupervised-floor.qual.mjs";
const HUMANS = "quals/human-benchmark-provenance.qual.mjs", MARKET = "quals/tesla-forecast-inputs.qual.mjs";
// The camera rule's figures (tesla-camera-miles.qual.mjs, rule 3), from its
// consts and the newest saved camera table, whose whole weeks' Cybercab means
// are the camera qual's CAMERA_WEEKS (both read them through
// quals/camera-table.mjs; until the tables entered data/snapshots on
// 2026-11-20, CAMERA_WEEKS was a literal that constOf evaluated).
const camera = (() => {
  const weeks = constOf(CAMERA, "TESLA_WEEKS"), t = constOf(CAMERA, "T975");
  const rates = Object.fromEntries(Object.entries(NEWEST_CAMERA_TABLE.weeks).map(([monday, w]) => [monday, w.mean]));
  const cal = Object.keys(weeks).sort(), n = cal.length;
  const logs = cal.map(w => Math.log(weeks[w] / rates[w]));
  const mean = logs.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(logs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  const term = t[n - 1] * s * Math.sqrt(1 + 1 / n);
  const middle = cal.flatMap(w => [0, 1, 2, 3, 4, 5, 6].map(i => Date.parse(w) + (i + 0.5) * DAY)).reduce((a, b) => a + b, 0) / (7 * n);
  const halfWidth = day => Math.hypot(term, constOf(CAMERA, "Z975") * constOf(CAMERA, "DRIFT") *
    Math.sqrt(Math.abs(Date.parse(day) + DAY / 2 - middle) / DAY / constOf(CAMERA, "MONTH_DAYS")));
  const lastWeek = Object.keys(rates).sort().at(-1), lastMonth = constOf(CAMERA, "MONTHS").at(-1);
  const heldFrom = iso(Date.parse(lastWeek) + 7 * DAY), heldTo = `${lastMonth}-${daysIn(lastMonth)}`;
  assert.ok(heldFrom <= heldTo,
    `Replicata: read the newest saved camera table (${NEWEST_CAMERA_TABLE.path}) against the months the camera qual recomputes (${CAMERA} MONTHS, the last ${lastMonth}).
Expectata: a day of those months after the table's last whole week, the first of the days the tesla-camera-held entry holds at that week's rate.
Resultata: its last whole week ends ${iso(Date.parse(lastWeek) + 6 * DAY)}, so the held days would run from ${heldFrom} to ${heldTo}: the table runs past the months whose rows rest on it. Add the next month's Tesla rows to data/vmt.csv (and the month to ${CAMERA}'s MONTHS, which must name each camera-estimated month), or restate that entry with the human.`);
  // The held days' no-monitor miles: each at the ratio times the last week's rate, over 7.
  const heldMiles = ((Date.parse(heldTo) - Date.parse(heldFrom)) / DAY + 1) * Math.exp(mean) * rates[lastWeek] / 7;
  // The newest table's last Monday-to-Sunday week, whole or not, and its days'
  // rates against the same weekdays a week before, Cybercabs' and Waymo's (the
  // tesla-camera-held entry): the held days the table holds while it holds
  // part of the held week, the days of the week whose rate is held once its
  // last week is whole (a table that ends on a Sunday).
  const value = new Map(NEWEST_CAMERA_TABLE.days.map(d => [d.day, d.values]));
  const partTo = NEWEST_CAMERA_TABLE.days[0].day;
  const partFrom = iso(Date.parse(partTo) - (new Date(Date.parse(partTo)).getUTCDay() + 6) % 7 * DAY);
  const part = NEWEST_CAMERA_TABLE.days.map(d => d.day).filter(day => day >= partFrom);
  const rate = (day, column) => {
    assert.ok(value.has(day), `the newest saved camera table (${NEWEST_CAMERA_TABLE.path}) holds no day ${day}`);
    const v = value.get(day)[column];
    assert.ok(typeof v === "number", `the newest saved camera table (${NEWEST_CAMERA_TABLE.path}) has no ${column} rate for ${day}: ${JSON.stringify(value.get(day))}`);
    return v;
  };
  const weekBefore = day => iso(Date.parse(day) - 7 * DAY);
  const against = column => part.reduce((a, d) => a + rate(d, column), 0) / part.reduce((a, d) => a + rate(weekBefore(d), column), 0);
  return { cal, n, K: Math.round(Math.exp(mean)), term, middle, halfWidth,
    firstEstimated: iso(Date.parse(cal.at(-1)) + 7 * DAY), lastCovered: iso(Date.parse(lastWeek) + 6 * DAY),
    heldFrom, heldTo, heldMiles, partFrom, partTo, weekdays: against("Cybercab"), waymo: against("Waymo") };
})();
// Zoox's December 2025 Las Vegas rate: the path's two binding statements put
// December's miles at the 1.25M floor less the 1M crossing at Nov 30.
const zooxRate = () => (constOf(ZOOX, "S0")[0] - constOf(ZOOX, "CROSS") -
  constOf(ZOOX, "CA_DMV")["2025-11"] * constOf(ZOOX, "CPUC_DEC_2025") / constOf(ZOOX, "CPUC_NOV_2025")) / 31;
const sigmaOf = h => constOf(ZOOX, "sigmaOf")(h);

// --- The Python builders, in one python3 run -------------------------------
const PY_EXPRS = {
  offset: "list(waymo_vmt.OFFSET)",
  knots: "{k[0]: list(k[1:]) for k in waymo_vmt.KNOTS}",
  floors: "[list(f) for f in waymo_vmt.FLOORS]",
  alloc: "waymo_vmt.ALLOC",
  longWidth: "waymo_vmt.LONG_INTERVAL_WIDTH",
  calibratedMonths: "waymo_vmt.CALIBRATED_MONTHS",
  ln2: "math.log(2)",
  // The receipt share's reference month: of a newer month with 2 incidents
  // and an older one with 3, the reference is the most recent with at least
  // the threshold, so the reference count is 3 for a threshold of 3 (2 for a
  // threshold under 3; none, a stop, above it).
  minRef: "slurp.pooled_reference_rate({('Waymo', '2031-01'): 3, ('Waymo', '2031-02'): 2, ('Waymo', '2031-03'): 1}, '2031-03', " +
    "{('Waymo', m): 1e6 for m in ('2031-01', '2031-02', '2031-03')}, {'Waymo': '2031-02'})[2]",
  receiptMax: "slurp.FIVE_DAY_RECEIPT_COVERAGE_MAX",
  receiptRecord: "list(max((n / d, m) for m, (n, d) in slurp.FIVE_DAY_RECEIPT_OBSERVATIONS.items()))",
  arrivals: "slurp.MONTHLY_ARRIVAL_OBSERVATIONS",
  lags: "slurp.MONTHLY_ARRIVAL_LAG",
  preprintList: "slurp.PREPRINT_LIST",
  preprintOperator: "slurp.PREPRINT_OPERATOR_TYPE",
  preprintType: "slurp.PREPRINT_REPORT_TYPE",
  preprintVersion: "slurp.PREPRINT_REPORT_VERSION",
  listAbsent: "list(slurp.LIST_ABSENT_COLUMNS)",
  listCounts: "list_counts()",
  operatorOverrides: "sorted(slurp.OPERATOR_TYPE_OVERRIDE)",
  operatorScope: "{k: sorted(v) for k, v in slurp.PUBLIC_SERVICE_OPERATOR_TYPES.items()}",
  teleop: "sorted(slurp.TELEOP_DRIVEN_REPORTS)",
  teleopOnList: "len(set(slurp.TELEOP_DRIVEN_REPORTS) & slurp.TESLA_NO_MONITOR_REPORTS)",
  additions: "len(slurp.TESLA_NO_MONITOR_ADDITIONS)",
  remoteKept: "len(slurp.REMOTE_LANGUAGE_ADS_DRIVEN)",
  manualKept: "len(slurp.SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN)",
  misfiled: "len(slurp.MISFILED_ADS_REPORTS)",
  splits: "len(slurp.SPLIT_SAME_INCIDENT_REPORTS)",
  superseded: "len(slurp.SUPERSEDED_REPORTS)",
  contactAgreement: "slurp.CONTACT_AREA_MIN_AGREEMENT",
  raters: "[faultrate.RATERS, faultrate.MODEL, faultrate.EFFORT]",
  monthlyFirstAirbags: "monthly_first_airbags()",
};
const PY = String.raw`
import ast, importlib.util, json, math, re, sys
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
slurp = load("slurp", "data/slurp.py")
faultrate = load("faultrate", "data/faultrate.py")
waymo_vmt = load("waymo_vmt", "data/waymo_vmt.py")
MODULES = {"data/slurp.py": slurp, "data/faultrate.py": faultrate, "data/waymo_vmt.py": waymo_vmt}
def monthly_first_airbags():
    # In-scope airbag incidents whose crash's first filing is a Monthly
    # report (an incident's track is its first filing's Report Type,
    # REPORT_TRACK; a re-filing takes the report it replaced).
    rows = [r for r in slurp.newest_report_rows() if r["Report Type"].strip() != slurp.PREPRINT_REPORT_TYPE]
    filed = slurp.filed_incident_rows(rows)
    first = {r["Report ID"]: r["Report Type"].strip() for r in filed if int(r["Report Version"]) == 1}
    replaced = {new: old for old, new in slurp.SUPERSEDED_REPORTS.items()}
    text = open("data/incidents.js").read()
    start = text.index("/* INCIDENT_DATA_START */") + len("/* INCIDENT_DATA_START */")
    records = {r["reportId"]: r for r in json.loads(text[start:text.index("/* INCIDENT_DATA_END */")])}
    ids = [r["Report ID"] for r in slurp.public_service_incidents(filed).values()]
    return sorted(rid for rid in ids if rid in records and records[rid]["airbagAny"]
                  and slurp.REPORT_TRACK.get(first.get(replaced.get(rid, rid))) == "monthly")
def list_counts():
    # The company list's rows (its newest snapshot, list_rows()) and its
    # preprints, the rows whose Report ID none of NHTSA's newest rows holds
    # (preprint_rows()).
    return [len(slurp.list_rows(slurp.latest_list_path())), len(slurp.preprint_rows(slurp.newest_snapshot_rows()))]
request = json.load(sys.stdin)
env = {"slurp": slurp, "faultrate": faultrate, "waymo_vmt": waymo_vmt, "math": math, "monthly_first_airbags": monthly_first_airbags,
       "list_counts": list_counts}
upper = {}
for path in MODULES:
    names = []
    for node in ast.parse(open(path).read()).body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        for target in targets:
            for name in ([target] if isinstance(target, ast.Name) else target.elts if isinstance(target, ast.Tuple) else []):
                if isinstance(name, ast.Name) and re.fullmatch(r"[A-Z][A-Z0-9_]*", name.id):
                    names.append(name.id)
    upper[path] = names
out = {"values": {key: eval(expr, env) for key, expr in request["values"].items()},
       "attrs": {path: {n: hasattr(MODULES[path], n) for n in names} for path, names in request["attrs"].items()},
       "upper": upper}
json.dump(out, sys.stdout, default=lambda o: sorted(o) if isinstance(o, (set, frozenset)) else list(o))
`;
const wherePyNames = {};
for (const e of entries) for (const [file, names] of e.where) {
  if (file.endsWith(".py")) (wherePyNames[file] ??= []).push(...names.split(", ").filter(n => n !== ""));
}
const py = JSON.parse(execFileSync("python3", ["-c", PY], { input: JSON.stringify({ values: PY_EXPRS, attrs: wherePyNames }), encoding: "utf8", maxBuffer: 1 << 26 }));
const pv = key => py.values[key];

// --- The inventory: each entry's values and their sources -------------------
// py: value = f(the python expression's result, the entry's values); qual: value =
// f(the named consts of a qual, the entry's values); rel: check(value, the entry's
// values) gives a list of problems; doc: no machine source (DOC below).
const pyv = (key, f = x => x) => ({ kind: "py", expected: v => f(pv(key), v) });
const qual = (f) => ({ kind: "qual", expected: f });
const rel = check => ({ kind: "rel", check });
const doc = () => ({ kind: "doc" });
const within = (got, want, tolerance) => Math.abs(got - want) <= tolerance * Math.abs(want);
const NO_MONITOR = () => constOf(FLOOR, "NO_MONITOR");
// A model qual's [low, high] multipliers that run pct% either way.
const evenBand = ([lo, hi], pct, name) => round(100 * (1 - lo), 9) === pct && round(100 * (hi - 1), 9) === pct ? [] : [`${WAYMO} ${name} is [${lo}, ${hi}], not ${pct}% either way`];
// The sum of a model qual's named parts (its PAUSES' or OPENINGS' month).
const total = parts => Object.values(parts).reduce((a, b) => a + b, 0);
const INVENTORY = {
  "tesla-deck-reading": {},
  "tesla-deck-ranges": {
    cumLo: rel(v => span("tesla", "2025-09", "2026-06").filter(r => r.kmin !== Math.round(v * r.cume)).map(r => `tesla ${r.month}: kyoom_min ${r.kmin}, not round(${v} x ${r.cume})`)),
    cumHi: rel(v => span("tesla", "2025-09", "2026-06").filter(r => r.kmax !== Math.round(v * r.cume)).map(r => `tesla ${r.month}: kyoom_max ${r.kmax}, not round(${v} x ${r.cume})`)),
    monLo: rel(v => span("tesla", "2025-09", "2026-06").filter(r => r.vmin !== Math.round(Math.max(v * r.vmt, r.kmin - before(r).kmax))).map(r => `tesla ${r.month}: vmt_min ${r.vmin}, not round(max(${v} x ${r.vmt}, ${r.kmin} - ${before(r).kmax}))`)),
    monHi: rel(v => span("tesla", "2025-09", "2026-06").filter(r => r.vmax !== Math.round(Math.min(v * r.vmt, r.kmax - before(r).kmin))).map(r => `tesla ${r.month}: vmt_max ${r.vmax}, not round(min(${v} x ${r.vmt}, ${r.kmax} - ${before(r).kmin}))`)),
  },
  "tesla-launch-months": {
    augLo: qual(() => Math.min(...constOf(PROVENANCE, "DECK_READINGS")["2025-08"])),
    augHi: qual(() => Math.max(...constOf(PROVENANCE, "DECK_READINGS")["2025-08"])),
  },
  "tesla-bay-area": {},
  "tesla-drivers-seat": {},
  "tesla-no-monitor-scope": { floorFrom: qual(() => nextMonth(constOf(PROVENANCE, "PINS").at(-1)[0])) },
  "tesla-no-monitor-band": {
    pct: rel(v => Object.entries(NO_MONITOR()).flatMap(([month, [page, deck]]) => {
      const r = row("teslanomonitor", month), f = 1 + v / 100;
      const want = [page, Math.max(Math.floor(Math.min(page, deck) / f), Math.floor(page / 2)), Math.ceil(Math.max(page, deck) * f)];
      return same([r.vmt, r.vmin, r.vmax], want) ? [] : [`teslanomonitor ${month}: vmt, vmt_min, vmt_max ${[r.vmt, r.vmin, r.vmax]}, the page and deck readings ${page} and ${deck} give ${want}`];
    })),
  },
  "tesla-monitor-aboard": {
    held: rel(v => [
      ...(constOf(CAMERA, "MONITOR_ABOARD") === v ? [] : [`${CAMERA} MONITOR_ABOARD is ${constOf(CAMERA, "MONITOR_ABOARD")}`]),
      ...span("tesla", "2026-07", "2026-09").filter(r => r.vmt !== Math.round((row("teslanomonitor", r.month).vmt + v) / 1000) * 1000).map(r => `tesla ${r.month}: vmt ${r.vmt}, not the no-monitor ${row("teslanomonitor", r.month).vmt} + ${v} to 1,000`),
      ...span("tesla", "2026-10", "2026-11").filter(r => r.vmt - row("teslanomonitor", r.month).vmt !== v).map(r => `tesla ${r.month}: vmt ${r.vmt}, not the no-monitor ${row("teslanomonitor", r.month).vmt} + ${v}`),
    ]),
  },
  "tesla-oct-nov-ranges": {
    within: rel((v, all) => span("tesla", "2026-07", "2026-09").flatMap(r => {
      const nm = row("teslanomonitor", r.month);
      const top = r.vmt * Math.exp(Math.hypot(Math.log(nm.vmax / nm.vmt), Math.log(all.shareTop * nm.vmt / r.vmt)));
      return Math.abs(top / r.vmax - 1) <= v / 100 ? [] : [`tesla ${r.month}: the combined top ${Math.round(top)} is not within ${v}% of vmt_max ${r.vmax}`];
    })),
    shareTop: rel(v => span("tesla", "2026-07", "2026-09").filter(r => r.vmax !== Math.ceil(Math.max(...NO_MONITOR()[r.month]) * v / 1000) * 1000)
      .map(r => `tesla ${r.month}: vmt_max ${r.vmax}, not the higher no-monitor reading x ${v} rounded up to 1,000`)),
    gap: rel(v => {
      const gaps = Object.entries(NO_MONITOR()).filter(([m]) => m >= "2026-04").map(([, [page, deck]]) => Math.log(deck / page));
      const rms = Math.sqrt(gaps.reduce((a, g) => a + g * g, 0) / gaps.length);
      return [
        ...(constOf(CAMERA, "PAGE_DECK_GAP") === v ? [] : [`${CAMERA} PAGE_DECK_GAP is ${constOf(CAMERA, "PAGE_DECK_GAP")}`]),
        ...(round(1.96 * rms, 3) === v ? [] : [`1.96 x the RMS of ln(deck/page) over April-September 2026 is ${1.96 * rms}`]),
      ];
    }),
  },
  "tesla-camera-ratio": {
    pageThrough: qual(() => constOf(CAMERA, "MEASURED")["2026-10"].through),
    readOn: doc(),
    K: qual(() => camera.K),
    n: qual(() => camera.n),
    calFrom: qual(() => camera.cal[0]),
    calTo: qual(() => iso(Date.parse(camera.cal.at(-1)) + 6 * DAY)),
  },
  "tesla-camera-calibration": {
    lo: qual(() => round(Math.exp(-camera.term), 2)),
    hi: qual(() => round(Math.exp(camera.term), 2)),
    n: qual(() => camera.n),
  },
  "tesla-camera-drift": {
    z: qual(() => constOf(CAMERA, "Z975")),
    drift: rel(v => [
      ...(constOf(CAMERA, "DRIFT") === v ? [] : [`${CAMERA} DRIFT is ${constOf(CAMERA, "DRIFT")}`]),
      ...(within(Math.sqrt(sigmaOf(1) ** 2 - sigmaOf(0) ** 2), v, 1e-9) ? [] : [`Zoox's sigma's drift term is ${Math.sqrt(sigmaOf(1) ** 2 - sigmaOf(0) ** 2)}`]),
    ]),
    mid: rel(v => camera.middle % DAY === 0 && iso(camera.middle) === v ? [] : [`the calibration weeks' middle is ${new Date(camera.middle).toISOString()}, not the start of ${v}`]),
    fDay: qual(() => camera.firstEstimated),
    lDay: qual(() => camera.lastCovered),
    fLo: qual(() => round(Math.exp(-camera.halfWidth(camera.firstEstimated)), 2)),
    fHi: qual(() => round(Math.exp(camera.halfWidth(camera.firstEstimated)), 2)),
    lLo: qual(() => round(Math.exp(-camera.halfWidth(camera.lastCovered)), 2)),
    lHi: qual(() => round(Math.exp(camera.halfWidth(camera.lastCovered)), 2)),
  },
  "tesla-camera-held": {
    heldFrom: qual(() => camera.heldFrom),
    heldTo: qual(() => camera.heldTo),
    noLo: qual(() => constOf(CAMERA, "NO_DATA")[0]),
    noHi: qual(() => constOf(CAMERA, "NO_DATA")[1]),
    heldMiles: qual(() => Math.round(camera.heldMiles / 1000) * 1000),
    // The newest saved table's last week, whole or not, and its rates against
    // the same weekdays a week before (CLAIMS holds it to the held week or the
    // week before it). Until 2026-11-20, when no file held the table, partTo,
    // weekdays and waymo were pinned in DOC as read by hand, as the part of
    // the held week the table then held.
    partFrom: qual(() => camera.partFrom),
    partTo: qual(() => camera.partTo),
    weekdays: qual(() => round(camera.weekdays, 3)),
    waymo: qual(() => round(camera.waymo, 3)),
  },
  "waymo-definition": {
    oldFrom: rel(v => { const old = caSources.filter(s => s.program === "pilot" && s.field !== "TotalVMTZEV").flatMap(s => s.months).sort(); return old[0] === v ? [] : [`the first month of CPUC's older pilot figures is ${old[0]}`]; }),
    oldTo: rel(v => { const old = caSources.filter(s => s.program === "pilot" && s.field !== "TotalVMTZEV").flatMap(s => s.months).sort(); return old.at(-1) === v ? [] : [`the last month of CPUC's older pilot figures is ${old.at(-1)}`]; }),
    // CPUC's deployment miles start then: the first month its deployment
    // field (TotalVMTZEV) is read, and data/waymo-ca.csv's deployment column
    // is 0 before it and above 0 from it.
    depFrom: rel(v => {
      const first = caSources.filter(s => s.program === "deployment").flatMap(s => s.months).sort()[0];
      const dep = caCsv[0].indexOf("deployment");
      const wrong = caCsv.slice(1).filter(r => (r[0] < v) !== (+r[dep] === 0)).map(r => r[0]);
      return [...(first === v ? [] : [`the first month of CPUC's deployment figures is ${first}`]),
        ...(wrong.length === 0 ? [] : [`data/waymo-ca.csv's deployment column is 0 exactly before ${v}, not in ${wrong.join(", ")}`])];
    }),
  },
  "waymo-hub-anchors": {
    eBest: rel((v, all) => { const [c, lo] = pv("knots")["2026-06"]; return Math.abs((c - lo) - (v - all.eLo)) <= 10000 ? [] : [`the June 2026 knot's central sits ${c - lo} above its low edge, E's best ${v - all.eLo} above its low`]; }),
    eLo: rel((v, all) => { const [, lo, hi] = pv("knots")["2026-06"]; return hi - lo === all.eHi - v ? [] : [`the June 2026 knot's range is ${hi - lo} wide, E's ${all.eHi - v}`]; }),
    eHi: rel((v, all) => { const [, lo, hi] = pv("knots")["2026-06"]; return hi - lo === v - all.eLo ? [] : [`the June 2026 knot's range is ${hi - lo} wide, E's ${v - all.eLo}`]; }),
    decAtlanta: doc(), decE: doc(),
  },
  "waymo-e-size": {
    rate: qual(() => constOf(WAYMO, "E_RATE").best),
    rLo: qual(() => constOf(WAYMO, "E_RATE").lo),
    rHi: qual(() => constOf(WAYMO, "E_RATE").hi),
    // September's E after the San Diego split: its pool less San Diego's share.
    sepE: rel(v => {
      const sep = constOf(WAYMO, "Q3_METROS").find(r => r[0] === "2026-09");
      return Math.round(sep[2] * (1 - sep[5])) === v ? [] : [`September 2026's pool ${sep[2]} less a share of ${sep[5]} is ${sep[2] * (1 - sep[5])}`];
    }),
    // The pool's ranges before the split, as multiples of its best, at one
    // decimal: the lowest low and the highest high of July-September.
    eLo: rel(v => { const lo = Math.min(...constOf(WAYMO, "Q3_METROS").map(r => r[3] / r[2])); return round(lo, 1) === v ? [] : [`the lowest of the pool's low edges is ${lo} times its best`]; }),
    eHi: rel(v => { const hi = Math.max(...constOf(WAYMO, "Q3_METROS").map(r => r[4] / r[2])); return round(hi, 1) === v ? [] : [`the highest of the pool's high edges is ${hi} times its best`]; }),
  },
  "waymo-pre-series": { c: pyv("offset", x => x[0]), lo: pyv("offset", x => x[1]), hi: pyv("offset", x => x[2]) },
  "waymo-early-figures": {
    o714: pyv("knots", k => k["2023-10"][2]),
    floor: rel((v, all) => pv("floors").some(([m, f]) => m === all.floorMonth && f === v) ? [] : [`data/waymo_vmt.py FLOORS has no (${all.floorMonth}, ${v})`]),
    floorMonth: rel((v, all) => pv("floors").some(([m, f]) => m === v && f === all.floor) ? [] : [`data/waymo_vmt.py FLOORS has no (${v}, ${all.floor})`]),
    jLo: rel(v => { const k = pv("knots"); const want = Math.floor(1000000 + 10 * v * (1000000 - k["2022-12"][2]) / 21); return k["2023-01"][1] === want ? [] : [`January 2023's low knot ${k["2023-01"][1]}, the rule at ${v} gives ${want}`]; }),
    jHi: rel(v => { const k = pv("knots"); const want = Math.ceil(1002600 + 10 * v * (1002600 - k["2022-12"][1]) / 21); return k["2023-01"][2] === want ? [] : [`January 2023's high knot ${k["2023-01"][2]}, the rule at ${v} gives ${want}`]; }),
  },
  "waymo-allocation": {
    alloc: pyv("alloc"),
    caFrom: rel(v => caCsv[1][0] === v ? [] : [`data/waymo-ca.csv starts at ${caCsv[1][0]}`]),
  },
  "waymo-california-ratio": { q2: qual(() => round(constOf(WAYMO, "q2Ratio"), 4)), q1: doc(), ca: rel(v => evenBand(constOf(WAYMO, "CA_BAND"), v, "CA_BAND")) },
  "waymo-county-extrapolation": { q2pct: doc(), q3pct: rel(v => evenBand(constOf(WAYMO, "MATURE_BAND"), v, "MATURE_BAND")) },
  "waymo-san-diego": {
    sdN: qual(() => constOf(WAYMO, "SAN_DIEGO").reports), sdOf: qual(() => constOf(WAYMO, "SAN_DIEGO").of),
    rate: rel(v => v === valuesOf("waymo-e-size").rate ? [] : ["differs from waymo-e-size's rate"]),
    rLo: rel(v => v === valuesOf("waymo-e-size").rLo ? [] : ["differs from waymo-e-size's rLo"]),
    rHi: rel(v => v === valuesOf("waymo-e-size").rHi ? [] : ["differs from waymo-e-size's rHi"]),
  },
  "waymo-weather": { sep: qual(() => total(constOf(WAYMO, "PAUSES")["2026-09"])), oct: qual(() => total(constOf(WAYMO, "PAUSES")["2026-10"])) },
  "waymo-projection": { octAdd: qual(() => total(constOf(WAYMO, "OPENINGS")["2026-10"])), novAdd: qual(() => total(constOf(WAYMO, "OPENINGS")["2026-11"])) },
  "waymo-ghost-range": { caTo: rel(v => caCsv.at(-1)[0] === v ? [] : [`data/waymo-ca.csv's last month is ${caCsv.at(-1)[0]}`]) },
  "zoox-statements": { s0: qual(() => constOf(ZOOX, "S0")), s1: qual(() => constOf(ZOOX, "S1")), s2: qual(() => constOf(ZOOX, "S2")) },
  "zoox-path": {},
  "zoox-flat-rate": {
    rate: qual(() => round(zooxRate(), 2)),
    pause: qual(() => constOf(ZOOX, "LV_PAUSE")["2026-01"]),
    cap: doc(), nhtsaCars: doc(),
  },
  "zoox-early-las-vegas": {},
  "zoox-pre-series": {
    pre: qual(() => constOf(ZOOX, "PRE_C")),
    ca: qual(() => { const [lo, hi] = constOf(ZOOX, "PRE"); return Math.round(lo - (hi - lo) / 1.5 / 2); }),
    lv: qual(() => { const [lo, hi] = constOf(ZOOX, "PRE"); return Math.round((hi - lo) / 1.5); }),
  },
  "zoox-december-california": {
    dec: qual(() => Math.round(constOf(ZOOX, "CA_2025")["2025-12"])),
    decLo: qual(() => Math.round(constOf(ZOOX, "CA_2025_LO")["2025-12"])),
    decHi: qual(() => Math.round(constOf(ZOOX, "CA_2025_HI")["2025-12"])),
    share: rel(v => within(constOf(ZOOX, "CA_2025_HI")["2025-12"], constOf(ZOOX, "CPUC_DEC_2025") / v, 1e-12) ? [] : [`December's high edge is not CPUC's December over ${v}`]),
  },
  "zoox-dmv-factor": {
    f: qual(() => constOf(ZOOX, "DMV_FACTOR")),
    lo: rel(v => { const r = row("zoox", "2026-09"); const want = Math.round((constOf(ZOOX, "CPUC")["2026-09"] * v + 30 * zooxRate() * 0.5) / 1000) * 1000; return r.vmin === want ? [] : [`zoox 2026-09 vmt_min ${r.vmin}, CPUC x ${v} plus half the rest gives ${want}`]; }),
    hi: rel(v => {
      const r = row("zoox", "2026-09");
      const want = Math.round((constOf(ZOOX, "CPUC")["2026-09"] * v + 30 * zooxRate() * 2) / 1000) * 1000;
      const ratio = round(constOf(ZOOX, "CA_DMV")["2025-11"] / constOf(ZOOX, "CPUC_NOV_2025"), 2);
      return [...(r.vmax === want ? [] : [`zoox 2026-09 vmt_max ${r.vmax}, CPUC x ${v} plus twice the rest gives ${want}`]),
        ...(ratio === v ? [] : [`November 2025's DMV/CPUC ratio is ${ratio}`])];
    }),
    lastCpuc: qual(() => Object.keys(constOf(ZOOX, "CPUC")).sort().at(-1)),
    g: qual(() => round((Math.exp(constOf(ZOOX, "GROWTH")) - 1) * 100, 1)),
  },
  "zoox-range-formula": (() => {
    const fits = (v, all) => [0, 1, 2.5].every(h => within(sigmaOf(h) ** 2, all.r ** 2 + all.d ** 2 * h + all.n ** 2, 1e-12)) ? [] : [`${ZOOX} sigmaOf(h)^2 is not ${all.r}^2 + ${all.d}^2 h + ${all.n}^2`];
    return { r: rel(fits), d: rel(fits), n: rel(fits) };
  })(),
  "zoox-no-data": {
    lo: rel(v => v === valuesOf("zoox-dmv-factor").lo ? [] : ["differs from zoox-dmv-factor's lo"]),
    hi: rel(v => v === valuesOf("zoox-dmv-factor").hi ? [] : ["differs from zoox-dmv-factor's hi"]),
    noLo: rel(v => [...(constOf(ZOOX, "NO_DATA")[0] === v ? [] : [`${ZOOX} NO_DATA is ${constOf(ZOOX, "NO_DATA")}`]),
      ...span("zoox", "2026-10", "2026-11").filter(r => r.vmin !== v * r.vmt).map(r => `zoox ${r.month}: vmt_min ${r.vmin}, not ${v} x ${r.vmt}`)]),
    noHi: rel(v => [...(constOf(ZOOX, "NO_DATA")[1] === v ? [] : [`${ZOOX} NO_DATA is ${constOf(ZOOX, "NO_DATA")}`]),
      ...span("zoox", "2026-10", "2026-11").filter(r => r.vmax !== v * r.vmt).map(r => `zoox ${r.month}: vmt_max ${r.vmax}, not ${v} x ${r.vmt}`)]),
  },
  "zoox-carry": { lo: qual(() => constOf(ZOOX, "CARRY")[0]), hi: qual(() => constOf(ZOOX, "CARRY")[1]) },
  "reporting-receipt-share": { minRef: pyv("minRef") },
  "reporting-receipt-top": {
    max: pyv("receiptMax"),
    record: pyv("receiptRecord", x => x[0]),
    recordMonth: pyv("receiptRecord", x => x[1]),
  },
  "reporting-incident-share": { record: doc() },
  "reporting-pooled": {},
  "reporting-earlier-months": {
    month: pyv("arrivals", a => Object.entries(a.Waymo).filter(([, c]) => c.length === 2).sort((x, y) => y[1][1] - x[1][1])[0][0]),
    late: pyv("arrivals", (a, v) => a.Waymo[v.month][1]),
    of: pyv("arrivals", (a, v) => a.Waymo[v.month][0] + a.Waymo[v.month][1]),
  },
  "reporting-five-day": {},
  "reporting-thinning": {},
  "reporting-range-product": {},
  "reporting-sgo-exemption": {},
  "reporting-unfiled": {},
  "reporting-tesla-list": { through: pyv("preprintList", p => p.through), miles: pyv("preprintList", p => p.miles) },
  "reporting-tesla-list-complete": {
    onTime: pyv("arrivals", a => Object.values(a.Tesla).filter(c => c.length === 2).reduce((s, c) => s + c[0], 0)),
    filed: pyv("arrivals", a => Object.values(a.Tesla).filter(c => c.length === 2).reduce((s, c) => s + c[0] + c[1], 0)),
  },
  "incidents-operator-scope": { n: pyv("operatorOverrides", o => o.length) },
  "incidents-remote-driving": { n: pyv("teleop", t => t.length), remote: pyv("remoteKept"), manual: pyv("manualKept") },
  "incidents-no-monitor-list": { teleop: pyv("teleopOnList"), additions: pyv("additions") },
  "incidents-other-files": { n: pyv("misfiled") },
  "incidents-preprints": {
    through: pyv("preprintList", p => p.through),
    operator: pyv("preprintOperator"),
    type: pyv("preprintType"),
    version: pyv("preprintVersion"),
    blank: pyv("listAbsent"),
    // The list's crashes NHTSA's files hold: its rows less its preprints.
    published: pyv("listCounts", ([rows, preprints]) => rows - preprints),
  },
  "incidents-second-cars": {},
  "incidents-latest-filing": {},
  "incidents-stationary": {},
  "incidents-contact-areas": { agree: pyv("contactAgreement", a => round(100 * a, 6)) },
  "incidents-severity": {},
  "incidents-airbag": {},
  "incidents-fatal-fraction": {},
  "incidents-passengers": {},
  "fault-criterion": {},
  "fault-raters": { raters: pyv("raters", r => r[0]), model: pyv("raters", r => r[1]), effort: pyv("raters", r => r[2]) },
  "model-constant-rate": {},
  "model-prior": {},
  "model-miles-prior": {},
  "model-window-range": {},
  "model-fault-mixture": {},
  "model-benchmark-readings": {},
  "model-dispersion": {},
  "humans-all-incidents": {},
  "humans-stopped": {
    av: rel(v => stoppedBands("HumansAV", v, constOf(HUMANS, "CRSS2024").stoppedAV)),
    us: rel(v => stoppedBands("HumansUS", v, constOf(HUMANS, "CRSS2024").stoppedUS)),
  },
  "humans-at-fault": {
    share: rel(v => ["HumansAV", "HumansUS"].flatMap(cohort => {
      const all = band("all", cohort), fault = band("atfault", cohort);
      return fault.lo === all.lo && within(fault.hi, all.hi / v, 0.01) ? [] : [`${cohort}: at-fault ${fault.lo}-${fault.hi}, all incidents ${all.lo}-${all.hi} / ${v}`];
    })),
  },
  "humans-at-fault-injury": {
    p: rel(v => ["HumansAV", "HumansUS"].flatMap(cohort => within(band("atfaultInjury", cohort).lo, band("injury", cohort).lo / (v / 100), 0.01) ? [] : [`${cohort}: at-fault injury lo ${band("atfaultInjury", cohort).lo}, injury lo / ${v}%`])),
    half: rel(v => ["HumansAV", "HumansUS"].flatMap(cohort => within(band("atfaultInjury", cohort).hi, band("injury", cohort).hi / (v / 100), 0.01) ? [] : [`${cohort}: at-fault injury hi ${band("atfaultInjury", cohort).hi}, injury hi / ${v}%`])),
  },
  "humans-hub-areas": {},
  "humans-hospitalization": {
    rInj: qual(() => round(constOf(HUMANS, "CRSS2024").hospPerInjury, 3)),
    rAb: qual(() => round(constOf(HUMANS, "CRSS2024").hospPerAirbag, 3)),
    usHosp: rel(v => v === valuesOf("humans-us-severe").hosp ? [] : ["differs from humans-us-severe's hosp"]),
    unknown: doc(),
  },
  "humans-us-severe": {
    // The US injury band runs from the police-reported rate to it raised by
    // this share: its edges' ratio, to the nearest percent.
    inj: rel(v => { const us = band("injury", "HumansUS"), share = 100 * (1 - us.lo / us.hi); return Math.round(share) === v ? [] : [`Humans (US average) injury ${us.lo}-${us.hi}: its low edge sits ${share}% below its high`]; }),
    hosp: rel(v => [...(round(100 * constOf(HUMANS, "BLINCOE2023_INJURY_UNREPORTED"), 1) === v ? [] : [`${HUMANS} BLINCOE2023_INJURY_UNREPORTED is ${constOf(HUMANS, "BLINCOE2023_INJURY_UNREPORTED")}`]),
      ...(within(band("hospitalization", "HumansUS").lo, band("hospitalization", "HumansUS").hi * (1 - v / 100), 0.001) ? [] : [`Humans (US average) hospitalization+ lo ${band("hospitalization", "HumansUS").lo} is not its hi x (1 - ${v}%)`])]),
  },
  "humans-fatality": {
    peak: rel(v => within(band("fatality", "HumansAV").lo, 1e8 / v, 0.01) ? [] : [`Humans (AV cities) fatality lo ${band("fatality", "HumansAV").lo}, not 1e8 / ${v}`]),
    floor: rel(v => within(band("fatality", "HumansAV").hi, 1e8 / v, 0.01) ? [] : [`Humans (AV cities) fatality hi ${band("fatality", "HumansAV").hi}, not 1e8 / ${v}`]),
    r24: doc(),
    // Fatal crashes against deaths: the US band's edges are FARS 2024's
    // deaths and fatal crashes per mile, so their ratio is the share fewer.
    pct: rel(v => { const us = band("fatality", "HumansUS"), fewer = 100 * (1 - us.lo / us.hi); return Math.round(fewer) === v ? [] : [`Humans (US average) fatality ${us.lo}-${us.hi}: fatal crashes ${fewer}% fewer than deaths`]; }),
  },
  "humans-fatality-other": {},
  "humans-rideshare-lean": {},
  "humans-constant": { fall: rel(v => { const f = valuesOf("humans-fatality"); return Math.round(100 * (f.peak - f.r24) / f.peak) === v ? [] : [`humans-fatality's ${f.peak} and ${f.r24} give a fall of ${100 * (f.peak - f.r24) / f.peak}%`]; }) },
  "humans-comparator": { austinSep: doc() },
  "humans-surface-streets": {},
  "growth-date": {},
  "growth-band-reading": {},
  "growth-tesla-scenarios": {},
  "growth-tesla-weights": {
    price: qual(() => round(100 * constOf(MARKET, "MARKET_PRICE"), 2)),
    distinct: qual(() => constOf(MARKET, "DISTINCT_PER_CAR_EQUIVALENT")),
    waymo: qual(() => constOf(MARKET, "WAYMO_MEDIAN")),
    cYes: qual(() => constOf(MARKET, "C_COUNTS")),
  },
  "growth-eyes-off": {},
  "growth-car-equivalents": {
    uLo: rel(v => carEquivalentRanges(v, valuesOf("growth-car-equivalents").uHi)),
    uHi: rel(v => carEquivalentRanges(valuesOf("growth-car-equivalents").uLo, v)),
    juneCars: rel(v => { const perCar = row("tesla", "2026-06").vmt / daysIn("2026-06") / v, rate = app("TESLA_MILES_PER_CAR_DAY"); return within(perCar, rate, 0.05) ? [] : [`June 2026's miles over ${v} cars are ${perCar.toFixed(1)} a car-day, not within 5% of ${rate}`]; }),
  },
  "growth-tesla-path": {},
  "growth-tesla-rides": {},
  "growth-waymo-fleet": { plan: doc() },
  "growth-waymo-miles-rides": {},
  "growth-zoox": { limit: rel(v => { const hi = appJson(`FLEET_FORECAST.find(f => f.helmer === "Zoox").components.map(c => c.parts[0].hi)`); return same(hi, [v]) ? [] : [`Zoox's fleet forecast tops ${hi}`]; }) },
  "growth-history": { ridersLo: doc(), ridersHi: doc() },
  "growth-floor": {},
  "growth-trajectory": {},
};
// The human bands, from the app.
function band(metric, cohort) { return appJson(`METRIC_BY_KEY[${JSON.stringify(metric)}].humanMPI[${JSON.stringify(cohort)}]`); }
function stoppedBands(cohort, value, share) {
  return [...(round(100 * share, 1) === value ? [] : [`${HUMANS} CRSS2024's stopped share for ${cohort} is ${share}`]),
    ...["nonstationary", "roadwayNonstationary"].flatMap(metric => ["lo", "hi"].filter(e => !within(band(metric, cohort)[e], band("all", cohort)[e] / (1 - share), 0.01))
      .map(e => `${cohort} ${metric} ${e} ${band(metric, cohort)[e]}, not all incidents' ${band("all", cohort)[e]} / (1 - ${share})`))];
}
// Tesla's fleet points for the camera months: miles a day over 180 a car-day,
// the range the miles band and utilization uLo-uHi a car-day combined as
// independent errors, rounded outward.
function carEquivalentRanges(uLo, uHi) {
  const rate = app("TESLA_MILES_PER_CAR_DAY"), fleet = appJson("FLEET_HISTORY.Tesla");
  return ["2026-10", "2026-11"].flatMap(month => {
    const r = row("tesla", month), best = r.vmt / daysIn(month) / rate, point = fleet.find(p => p.month === month);
    const lo = best * Math.exp(-Math.hypot(Math.log(r.vmt / r.vmin), Math.log(uHi / rate)));
    const hi = best * Math.exp(Math.hypot(Math.log(r.vmax / r.vmt), Math.log(rate / uLo)));
    return point !== undefined && point.lo === Math.floor(lo) && point.hi === Math.ceil(hi) ? [] : [`FLEET_HISTORY Tesla ${month} ${JSON.stringify(point)}, its miles at ${uLo}-${uHi} a car-day give ${lo.toFixed(2)} to ${hi.toFixed(2)}`];
  });
}
// The values with no machine source, each pinned here (a new one is added,
// and a changed one changed, deliberately).
// Since 2026-11-20 (review) the figures the model quals use are read from
// their named consts (E_RATE, SAN_DIEGO, CA_BAND, MATURE_BAND, PAUSES,
// OPENINGS, CARRY), not pinned here, and since the camera tables entered
// data/snapshots (2026-11-20) the table's last week is read from the newest:
// what is left is a date or a measurement no file holds (the day Tesla's
// safety page was last read; a figure from data/README.md's tables or a
// source's text).
const DOC = [
  ["tesla-camera-ratio", "readOn", "2026-11-16"],
  ["waymo-hub-anchors", "decAtlanta", 3500000], ["waymo-hub-anchors", "decE", 3700000],
  ["waymo-california-ratio", "q1", 1.04],
  ["waymo-county-extrapolation", "q2pct", 10],
  ["zoox-flat-rate", "cap", 100], ["zoox-flat-rate", "nhtsaCars", 600],
  ["reporting-incident-share", "record", 0.26],
  ["humans-hospitalization", "unknown", 3.5],
  ["humans-fatality", "r24", 1.01],
  ["humans-comparator", "austinSep", 72.5],
  ["growth-waymo-fleet", "plan", 20000],
  ["growth-history", "ridersLo", 1.2], ["growth-history", "ridersHi", 2],
];

// --- 1. Structure -----------------------------------------------------------
{
  const ids = [...entries].map(e => e.id);
  const out = [];
  if (!same(groups.map(g => g.id), GROUPS)) out.push(`the groups are ${JSON.stringify(groups.map(g => g.id))}`);
  for (const g of groups) if (typeof g.title !== "string" || g.title.trim() === "") out.push(`group ${g.id} has no title`);
  for (const g of GROUPS) if (!entries.some(e => e.group === g)) out.push(`group ${g} has no entry`);
  if (new Set(ids).size !== ids.length) out.push(`ids twice: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  for (const e of entries) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) out.push(`id ${JSON.stringify(e.id)} is not kebab-case`);
    if (!GROUPS.includes(e.group)) out.push(`${e.id}: unknown group ${e.group}`);
    if (typeof e.text !== "function") out.push(`${e.id}: text is not a function`);
    if (e.values === null || typeof e.values !== "object" || Array.isArray(e.values)) out.push(`${e.id}: values is not an object`);
    if (!Array.isArray(e.where) || e.where.length === 0 || !e.where.every(w => Array.isArray(w) && w.length === 2 && typeof w[0] === "string" && w[0] !== "" && typeof w[1] === "string"))
      out.push(`${e.id}: where is not a list of [file, names] pairs`);
  }
  problems.push(...out.map(p => `1 structure: ${p}`));
}

// --- 2. Render --------------------------------------------------------------
const texts = new Map([...entries].map(e => [e.id, e.text(e.values)]));
{
  const html = app("renderAssumptions()");
  const [col0, col1] = appJson("ASSUMPTION_COLUMNS");
  const intro = app("ASSUMPTIONS_INTRO");
  const want = `<p class="month-note"><span class="ai-text">${escText(intro)}</span></p>` + groups.map(g =>
    `<h3>${escText(g.title)}</h3><div class="table-wrap"><table class="source-table vmt-sources" id="assumptions-${g.id}"><thead><tr><th>${escText(col0)}</th><th>${escText(col1)}</th></tr></thead><tbody>` +
    [...entries].filter(e => e.group === g.id).map(e => `<tr id="assumption-${e.id}"><td class="ai-text derivation">${rationaleMarkup(texts.get(e.id))}</td><td>${escText(e.where.map(([file, names]) => `${file} ${names}`.trim()).join("; "))}</td></tr>`).join("") +
    "</tbody></table></div>").join("");
  if (html !== want) {
    let i = 0; while (i < want.length && html[i] === want[i]) i++;
    problems.push(`2 render: renderAssumptions() differs from the intro, headings, tables and rows built from ASSUMPTIONS at character ${i}: ${JSON.stringify(html.slice(Math.max(0, i - 80), i + 80))} where ${JSON.stringify(want.slice(Math.max(0, i - 80), i + 80))}`);
  }
  if (typeof intro !== "string" || intro.trim() === "" || typeof col0 !== "string" || col0.trim() === "" || typeof col1 !== "string" || col1.trim() === "") problems.push("2 render: an empty intro or column header");
  for (const [id, text] of [...texts, ["(intro)", intro]]) {
    const bad = ["undefined", "NaN", "null", "Infinity", "[object", "{"].filter(w => text.includes(w));
    if (bad.length > 0 || text.trim() === "") problems.push(`2 render: ${id}'s text ${text.trim() === "" ? "is empty" : `holds ${JSON.stringify(bad)}`}`);
  }
}

// --- 3. Inventory -----------------------------------------------------------
{
  const ids = [...entries].map(e => e.id).sort(), listed = Object.keys(INVENTORY).sort();
  if (!same(ids, listed)) problems.push(`3 inventory: entries without an inventory line ${JSON.stringify(ids.filter(id => !listed.includes(id)))}, inventory lines without an entry ${JSON.stringify(listed.filter(id => !ids.includes(id)))}`);
  for (const id of ids.filter(i => listed.includes(i))) {
    const names = Object.keys(valuesOf(id)).sort(), specs = Object.keys(INVENTORY[id]).sort();
    if (!same(names, specs)) problems.push(`3 inventory: ${id}'s values ${JSON.stringify(names)}, its inventory ${JSON.stringify(specs)}`);
  }
}

// --- 4. Values --------------------------------------------------------------
const counts = { py: 0, qual: 0, rel: 0, doc: 0 };
{
  for (const [id, specs] of Object.entries(INVENTORY).filter(([i]) => byId.has(i))) {
    const values = valuesOf(id);
    for (const [name, spec] of Object.entries(specs).filter(([n]) => n in values)) {
      counts[spec.kind]++;
      const v = values[name];
      if (spec.kind === "rel") problems.push(...spec.check(v, values).map(p => `4 values: ${id} ${name} = ${JSON.stringify(v)}: ${p}`));
      else if (spec.kind === "doc") {
        if (!DOC.some(([i, n, d]) => i === id && n === name && same(d, v))) problems.push(`4 values: ${id} ${name} = ${JSON.stringify(v)} has no machine source and is not pinned in DOC`);
      } else {
        const want = spec.expected(values);
        if (!same(v, want)) problems.push(`4 values: ${id} ${name} = ${JSON.stringify(v)}, its source (${spec.kind}) gives ${JSON.stringify(want)}`);
      }
    }
  }
  const docSpecs = Object.entries(INVENTORY).flatMap(([id, specs]) => Object.entries(specs).filter(([, s]) => s.kind === "doc").map(([name]) => `${id} ${name}`)).sort();
  const pinned = DOC.map(([id, name]) => `${id} ${name}`).sort();
  if (!same(docSpecs, pinned)) problems.push(`4 values: the values marked doc ${JSON.stringify(docSpecs)}, DOC pins ${JSON.stringify(pinned)}`);
}

// The words and live figures of a text that no value holds, checked where
// they are set.
const CLAIMS = {
  "tesla-deck-reading": () => {
    const last = constOf(PROVENANCE, "PINS").at(-1);
    return last[0] === "2026-06" && row("tesla", "2026-06").cume === last[1] ? [] : [`the deck pins end at ${last}, the text at June 2026 (${row("tesla", "2026-06").cume})`];
  },
  "tesla-launch-months": () => {
    const deck = constOf(PROVENANCE, "DECK_READINGS"), floor = constOf(PROVENANCE, "CALL_FLOOR_JUL_2025");
    const allowed = deck["2025-07"].filter(x => x >= floor), jun = row("tesla", "2025-06"), aug = row("tesla", "2025-08");
    return [...(same(allowed, [row("tesla", "2025-07").cume]) ? [] : [`July's readings at or above the call's ${floor} are ${allowed}, the row ${row("tesla", "2025-07").cume}`]),
      ...(deck["2025-06"].every(x => x >= jun.kmin && x <= jun.kmax) ? [] : [`June's band ${jun.kmin}-${jun.kmax} leaves out a reading of ${deck["2025-06"]}`]),
      ...(aug.cume > Math.max(...deck["2025-08"]) && aug.cume < 1.05 * Math.max(...deck["2025-08"]) ? [] : [`August's ${aug.cume} is not a little above every reading of ${deck["2025-08"]}`])];
  },
  // The camera estimate enters the list's month's rates only through its
  // range: each Tesla line's row of that month scales its miles to the list's
  // (coverage = the list's miles over the row's, to four decimals).
  "tesla-camera-ratio": () => appJson(`vmtRows.filter(r => r.through !== NHTSA_DATA_THROUGH_DATE).map(r => [r.helmer, r.month, r.vmtBest, r.coverage])`)
    .filter(([, month, vmt, coverage]) => month !== pv("preprintList").through.slice(0, 7) || Math.abs(vmt * coverage - pv("preprintList").miles) > 0.5e-4 * vmt + 1)
    .map(([line, month, vmt, coverage]) => `${line} ${month}: ${vmt} x ${coverage} is not the list's ${pv("preprintList").miles} miles of ${pv("preprintList").through.slice(0, 7)}`),
  // The table's last week, from its Monday, is the held week (the table holds
  // part of it) or the week before it (the week whose rate is held).
  "tesla-camera-held": () => {
    const v = valuesOf("tesla-camera-held");
    const monday = new Date(Date.parse(v.partFrom)).getUTCDay() === 1, span = Date.parse(v.partTo) - Date.parse(v.partFrom);
    const week = v.partFrom === v.heldFrom || v.partFrom === iso(Date.parse(v.heldFrom) - 7 * DAY);
    return monday && span >= 0 && span < 7 * DAY && week ? [] : [`the last week's days ${v.partFrom} to ${v.partTo} are not a week from its Monday that is the held week (from ${v.heldFrom}) or the week before it`];
  },
  "waymo-pre-series": () => app("PRE_SERIES_OFFSET.Waymo.range") === pv("offset")[2] - pv("offset")[1] ? [] : ["PRE_SERIES_OFFSET.Waymo.range is not OFFSET's range"],
  "waymo-allocation": () => pv("longWidth") === pv("ln2") && pv("calibratedMonths") === 6 ? [] : [`LONG_INTERVAL_WIDTH ${pv("longWidth")} (half to twice is ln 2), CALIBRATED_MONTHS ${pv("calibratedMonths")}`],
  "zoox-statements": () => constOf(ZOOX, "CROSS") === 1000000 ? [] : [`the crossing statement is ${constOf(ZOOX, "CROSS")}, not the millionth mile`],
  "zoox-path": () => same([...constOf(ZOOX, "BINDING")].sort(), ["1M not crossed before Dec 1, 2025", "Dec 31, 2025 at least 1.25M"]) && constOf(ZOOX, "S0")[0] === 1250000 ? [] : [`the binding statements are ${JSON.stringify(constOf(ZOOX, "BINDING"))}`],
  "zoox-pre-series": () => {
    const [lo, hi] = constOf(ZOOX, "PRE"), first = lineRows("zoox")[0].month;
    const crashes = app(`INCIDENT_DATA.filter(r => r.helmer === "Zoox").map(r => monthKeyFromIncidentLabel(r.date)).sort()[0]`);
    return [...(app("PRE_SERIES_OFFSET.Zoox.range") === Math.floor(hi - lo) ? [] : ["PRE_SERIES_OFFSET.Zoox.range is not the pre-series band's width, floored"]),
      ...(first === crashes ? [] : [`the Zoox series starts ${first}, its first crash ${crashes}`])];
  },
  "zoox-early-las-vegas": () => span("zoox", "2024-05", "2025-05").filter(r => Math.abs(r.vmin - 0.75 * r.vmt) > 1 || Math.abs(r.vmax - 1.5 * r.vmt) > 1)
    .map(r => `zoox ${r.month}: ${r.vmin}-${r.vmax} is not 0.75 to 1.5 times ${r.vmt} (California plus half to twice as much again)`),
  "reporting-earlier-months": () => Object.values(pv("lags")).every(l => l === 0) ? [] : [`MONTHLY_ARRIVAL_LAG is ${JSON.stringify(pv("lags"))}, not none`],
  "reporting-five-day": () => pv("monthlyFirstAirbags").length >= 1 ? [] : ["no in-scope airbag crash was first filed in a Monthly report"],
  "reporting-tesla-list": () => appJson("vmtRows.filter(r => r.through !== NHTSA_DATA_THROUGH_DATE).map(r => [r.coverage, r.coverageMin, r.coverageMax])")
    .filter(([c, lo, hi]) => c !== lo || c !== hi).map(t => `a row on the list's coverage has the range ${t}`),
  "incidents-operator-scope": () => [
    ...(same(pv("operatorScope"), { "Tesla, Inc.": ["In-Vehicle (Commercial / Test)", "None", "Remote (Commercial / Test)"], "Waymo LLC": ["None", "Remote (Commercial / Test)"], "Zoox, Inc.": ["None", "Remote (Commercial / Test)"] }) ? [] : [`the counted modes are ${JSON.stringify(pv("operatorScope"))}`]),
    ...pv("operatorOverrides").filter(id => !id.startsWith("30270-")).map(id => `${id} is not a Waymo report`)],
  "incidents-remote-driving": () => pv("teleop").filter(id => !id.startsWith("13781-")).map(id => `${id} is not a Tesla report`),
  // The page's preprint records are the list's preprints (the text counts
  // the records, data/incidents.js; the list, data/slurp.py).
  "incidents-preprints": () => {
    const records = app(`INCIDENT_DATA.filter(r => r.preprint === true).length`);
    return records === pv("listCounts")[1] ? [] : [`data/incidents.js holds ${records} preprint records, the company list ${pv("listCounts")[1]} preprints`];
  },
  "incidents-latest-filing": () => pv("splits") === 1 && pv("superseded") === 1 ? [] : [`${pv("splits")} split crashes and ${pv("superseded")} re-filings, not one each`],
  "incidents-severity": () => {
    const s = appJson("SEVERITY_INFO");
    return s.Serious.hosp === true && s["Minor W/ Hospitalization"].hosp === true && s["Moderate W/ Hospitalization"].hosp === true &&
      s.Minor.injury === true && s.Moderate.injury === true && s.Minor.hosp === undefined && s.Moderate.hosp === undefined ? [] : ["SEVERITY_INFO does not read 'W/ Hospitalization' and a bare 'Serious' as a transport and a bare 'Minor' and 'Moderate' as an injury without one"];
  },
  "model-prior": () => {
    // Jeffreys: with no incidents the rate times the miles is Gamma(1/2, 1),
    // half a chi-square of one degree of freedom (its 97.5%, 2.5% and 50%
    // points 5.023886187, 0.000982069117 and 0.454936423).
    const got = appJson(`[0.975, 0.025, 0.5].map(p => 1 / gammaquant(mixtureComponents(0, null)[0].a, 1, p))`);
    const want = [5.023886187314888, 0.0009820691171752583, 0.454936423119572].map(x => 2 / x);
    return got.every((g, i) => within(g, want[i], 1e-6)) ? [] : [`the prior's multiples ${got}, half a chi-square gives ${want}`];
  },
  "model-miles-prior": () => {
    const r = appJson(`(() => { const s = splitPriorSigmas(55000, 170000, 340000), nodes = vmtPriorNodes(55000, 170000, 340000, 1);
      const split = nodes.lnv.indexOf(s.mu, 1); const pLo = s.sigmaLo / (s.sigmaLo + s.sigmaHi);
      return {pLo, below: 2 * pLo * normalCdf(-(s.mu - Math.log(55000)) / s.sigmaLo), above: 2 * (1 - pLo) * normalCdf(-(Math.log(340000) - s.mu) / s.sigmaHi),
        lowHalf: nodes.w.slice(0, split).reduce((a, b) => a + b, 0)}; })()`);
    const ratio = Math.log(170000 / 55000) / Math.log(340000 / 170000);
    return within(1 - r.below - r.above, 0.95, 0.001 / 0.95) && within(r.below / r.above, ratio, 1e-9) && within(r.lowHalf, r.pLo, 1e-6) ? [] :
      [`the band [55,000, 170,000, 340,000]: ${(1 - r.below - r.above).toFixed(5)} between its edges, the outside split ${(r.below / r.above).toFixed(4)} (its sides' widths ${ratio.toFixed(4)}), the low half's nodes ${r.lowHalf} of the weight (want ${r.pLo})`];
  },
  "growth-band-reading": () => {
    const r = appJson(`(() => { const c = FLEET_FORECAST.find(f => f.helmer === "Zoox").components[0], b = c.parts[0];
      return {lo: componentAt(c, Math.log(b.lo)).p, hi: componentAt(c, Math.log(b.hi)).q, sides: Math.log(b.best / b.lo) / Math.log(b.hi / b.best)}; })()`);
    return within(1 - r.lo - r.hi, 0.9, 0.001 / 0.9) && within(r.lo / r.hi, r.sides, 1e-6) ? [] : [`Zoox's fleet band holds ${1 - r.lo - r.hi} between its edges, the outside split ${r.lo / r.hi} (its sides' widths ${r.sides})`];
  },
  "growth-tesla-weights": () => app("TESLA_EYES_OFF.weight") === constOf(MARKET, "C_WEIGHT") ? [] : [`TESLA_EYES_OFF.weight ${app("TESLA_EYES_OFF.weight")}, the fit's C_WEIGHT ${constOf(MARKET, "C_WEIGHT")}`],
};
for (const [id, check] of Object.entries(CLAIMS)) {
  if (!byId.has(id)) problems.push(`4 claims: no entry ${id}`);
  else problems.push(...check().map(p => `4 claims: ${id}: ${p}`));
}

// --- 5. Where ---------------------------------------------------------------
{
  const readme = fs.readFileSync("data/README.md", "utf8");
  const headings = [...readme.matchAll(/^#{1,6} (.+)$/gm)].map(m => m[1].trim());
  for (const e of entries) for (const [file, names] of e.where) {
    const list = names === "" ? [] : names.split(", ");
    const where = `5 where: ${e.id} ${file} ${JSON.stringify(names)}`;
    if (!fs.existsSync(file)) { problems.push(`${where}: no such file`); continue; }
    if (file === "crashla.js") problems.push(...list.filter(n => app(`typeof ${n}`) === "undefined").map(n => `${where}: crashla.js defines no ${n}`));
    else if (file.endsWith(".py")) problems.push(...list.filter(n => py.attrs[file][n] !== true).map(n => `${where}: ${file} has no attribute ${n}`));
    else if (file.startsWith("quals/")) {
      const src = fs.readFileSync(file, "utf8");
      problems.push(...list.filter(n => !constDeclarations(file).has(n) && !new RegExp(`^(?:function|let|var)\\s+${n}\\b`, "m").test(src)).map(n => `${where}: ${file} declares no ${n} at its top level`));
    } else if (file === "data/README.md") problems.push(...list.filter(n => !headings.includes(n)).map(n => `${where}: data/README.md has no heading ${JSON.stringify(n)}`));
    else if (file === "data/vmt.csv") {
      const m = /^(\w+)(?: (\d{4}-\d{2}) – (\d{4}-\d{2}))?$/.exec(names);
      const months = m === null ? [] : lineRows(m[1]).map(r => r.month);
      if (m === null || months.length === 0 || (m[2] !== undefined && !(months.includes(m[2]) && months.includes(m[3]) && m[2] <= m[3]))) problems.push(`${where}: not a line of data/vmt.csv, or months of it ("<line> <YYYY-MM> – <YYYY-MM>")`);
    } else if (file.endsWith(".json")) {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      problems.push(...list.filter(n => !(Array.isArray(json) && json.every(x => n in x))).map(n => `${where}: not a key of every entry of ${file}`));
    } else problems.push(...list.map(n => `${where}: names ${n} in a file this qual does not read`));
  }
}

// --- 6. Registries ----------------------------------------------------------
{
  const bands = appJson("METRIC_DEFS.flatMap(m => Object.keys(m.humanMPI).map(c => m.key + ' ' + c))").sort();
  const described = [...entries].flatMap(e => (e.bands ? JSON.parse(JSON.stringify(e.bands)) : []).map(([m, c]) => `${m} ${c}`));
  problems.push(...bands.filter(b => described.filter(d => d === b).length !== 1).map(b => `6 registries: the human band ${b} is in ${described.filter(d => d === b).length} entries' bands, not one`));
  problems.push(...described.filter(d => !bands.includes(d)).map(d => `6 registries: an entry's bands name ${d}, no human band`));
  const tables = appJson(`Object.entries({FLEET_FORECAST, MILES_FORECAST, RIDES_FORECAST}).flatMap(([t, rows]) => rows.map(r => t + " " + r.helmer))`);
  const forecasts = [...entries].flatMap(e => (e.forecasts ? JSON.parse(JSON.stringify(e.forecasts)) : []).map(([t, h]) => `${t} ${h}`));
  problems.push(...tables.filter(t => !forecasts.includes(t)).map(t => `6 registries: no entry's forecasts describe ${t}`));
  problems.push(...forecasts.filter(f => !tables.includes(f)).map(f => `6 registries: an entry's forecasts name ${f}, no forecast`));
  const TEXT_CONSTANTS = ["TESLA_MILES_PER_CAR_DAY", "TESLA_MILES_PER_RIDE", "TESLA_RIDE_BASIS", "TESLA_ROBOTAXI_SCENARIOS", "TESLA_EYES_OFF",
    "TESLA_PATH_START", "GROWTH_FORECAST_DATE", "FLEET_HISTORY", "RIDES_HISTORY", "RIDESHARE_WORST", "RIDESHARE_BEST", "PRE_SERIES_OFFSET",
    "DISPERSION_LIMITS", "FAULT_GRID", "SEVERITY_INFO", "CI_MASS_DEFAULT_PCT"];
  const sources = [...entries].map(e => e.text.toString());
  problems.push(...TEXT_CONSTANTS.filter(c => !sources.some(s => new RegExp(`\\b${c}\\b`).test(s))).map(c => `6 registries: no entry's text reads ${c}`));
}

// --- 7. Months --------------------------------------------------------------
{
  const spans = [...entries].flatMap(e => Object.entries(e.covers ? JSON.parse(JSON.stringify(e.covers)) : {}).map(([line, [from, to]]) => ({ id: e.id, line, from, to })));
  for (const s of spans) {
    const csvLine = Object.keys(LINES).find(l => LINES[l] === s.line);
    const months = csvLine === undefined ? [] : lineRows(csvLine).map(r => r.month);
    if (!(months.includes(s.from) && months.includes(s.to) && s.from <= s.to)) problems.push(`7 months: ${s.id} covers ${s.line} ${s.from}-${s.to}, not months of that line`);
  }
  const uncovered = csvRows.filter(r => !spans.some(s => s.line === LINES[r.line] && r.month >= s.from && r.month <= s.to));
  if (uncovered.length > 0) problems.push(`7 months: no entry covers ${uncovered.map(r => `${r.line} ${r.month}`).join(", ")} (each new month needs the entry for its estimate method to cover it)`);
}

// --- 8. Constants -----------------------------------------------------------
const REASONS = { path: "a file or folder", url: "an address fetched", format: "the form of a file or record", measured: "a measured figure or date",
  guard: "a check that stops a run", tripwire: "a pattern that stops a run for review", regex: "a pattern", reviewed: "a reviewed list behind a check",
  scope: "which companies or files the page reads", correction: "a reviewed data fix that moves no figure", derived: "computed from other constants",
  check: "a qual's own copy or check", unit: "a unit", internal: "a run setting" };
const NOT_ASSUMPTIONS = {
  "data/slurp.py": {
    DATA_DIR: "path", ROOT_DIR: "path", SNAPSHOT_DIR: "path", LEGACY_SNAPSHOT_PATHS: "path", NHTSA_ADS_CSV_URL: "url", NHTSA_ADS_ARCHIVE_URL: "url",
    NHTSA_ADAS_CSV_URL: "url", NHTSA_OTHER_CSV_URL: "url",
    NHTSA_DATA_THROUGH_DATE: "measured", INCIDENT_JS: "path", VMT_JS: "path", VMT_MASTER: "path", FAULT_INPUT: "path", FAULT_CSV_FIELDS: "format",
    FAULT_MASTER_FIELDS: "format", FIELDS: "format", KEY_MAP: "format", CONTACT_AREA_LABELS: "format", CONTACT_AREA_NARRATIVE_TESTS: "guard",
    CONTACT_AREA_MIN_MATCHES: "guard", HELMER_SHORT: "scope", NARRATIVE_BOILERPLATE: "format", NARRATIVE_UNCHANGED_PREAMBLE: "format",
    NARRATIVE_MOJIBAKE: "format", NARRATIVE_TYPOS: "format", NARRATIVE_AIRBAG_CORRECTION: "format", LOCATION_OVERRIDE: "correction",
    PAX_NO: "format", PAX_BELTED: "format", PAX_BELT_UNSTATED: "format", PAX_CLASS: "format", OCCUPANCY_PATTERN: "tripwire",
    OCCUPANCY_LANGUAGE_REVIEWED: "reviewed", SECOND_INVOLVEMENT_SUFFIX: "format", SECOND_AV_PATTERN: "tripwire", SECOND_AV_REVIEWED: "reviewed",
    ARCHIVE_COLUMN_MAP: "format", ARCHIVE_ABSENT_COLUMNS: "format", NHTSA_SOURCES: "url", NON_ADS_SOURCES: "url", LIST_COLUMNS: "format",
    LIST_NO_CONTACT_AREA: "format", XLSX_NS: "format", XLSX_EPOCH: "format", FAULT_GRID: "guard",
    MONTH_ABBR_TO_NUM: "format", EXPECTED_REPORT_TYPES: "guard", NEGATIVE_FILING_TYPES: "format", EXPECTED_DRIVER_TYPES: "guard",
    EXPECTED_SEVERITIES: "guard", EXPECTED_HELMERS: "guard", TELEOP_PATTERN: "tripwire",
    SECOND_INVOLVEMENT_COLUMNS: "format", SECOND_INVOLVEMENT_CONTACTS: "format", SERIES_COMPANY: "format", DERIVED_SERIES_REPORTS: "format",
    SAFETY_DRIVER_PATTERN: "tripwire", INCIDENT_DATE_RE: "regex", SUBMISSION_DATE_RE: "regex",
  },
  "data/faultrate.py": {
    REASON_MAX: "format", WORKERS: "internal", ATTEMPTS: "guard", CRITERION: "path", RATINGS: "path", RATING_FIELDS: "format", SCHEMA: "format",
    COMPANIES: "format", COMPANY_RE: "regex", ANY_COMPANY_RE: "regex", CASE_FORMAT: "format", SECOND_LINE: "format", NOT_STATED: "format",
  },
  "data/waymo_vmt.py": { ROOT: "path", ALLOCATION_NOTE: "format", EARLY_NOTE: "format" },
  [CAMERA]: { MONTHS: "scope", DAY: "unit", K: "derived", CAMERA: "derived" },
  [ZOOX]: {
    CA_DMV: "measured", CPUC_NOV_2025: "measured", CPUC_DEC_2025: "measured", CPUC: "measured", LAST_CPUC_MONTH: "derived", M: "derived",
    N: "derived", CA: "derived", LV_DAYS: "derived", U_MAY: "derived", B: "derived", T: "derived", M25: "derived", LV: "derived",
    SHAPES: "check", M26: "derived", FIRST: "derived", AHEAD: "derived", SERIES: "check",
  },
  [WAYMO]: { OFFSET: "check" },
};
{
  const whereNames = {};
  for (const e of entries) for (const [file, names] of e.where) {
    whereNames[file] ??= new Set();
    for (const n of names.split(", ").filter(x => x !== "")) whereNames[file].add(n);
  }
  const upper = { ...py.upper };
  for (const file of [CAMERA, ZOOX, WAYMO]) upper[file] = [...constDeclarations(file).keys()].filter(n => /^[A-Z][A-Z0-9_]*$/.test(n));
  for (const [file, names] of Object.entries(upper)) {
    const named = whereNames[file] ?? new Set(), listed = NOT_ASSUMPTIONS[file] ?? {};
    problems.push(...names.filter(n => !named.has(n) && !(n in listed)).map(n => `8 constants: ${file} ${n} is named in no entry's where and not listed in NOT_ASSUMPTIONS`));
    problems.push(...Object.keys(listed).filter(n => !names.includes(n)).map(n => `8 constants: NOT_ASSUMPTIONS lists ${file} ${n}, which it does not declare`));
    problems.push(...Object.keys(listed).filter(n => named.has(n)).map(n => `8 constants: NOT_ASSUMPTIONS lists ${file} ${n}, which an entry's where names`));
    problems.push(...Object.entries(listed).filter(([, r]) => !(r in REASONS)).map(([n, r]) => `8 constants: ${file} ${n}'s reason ${JSON.stringify(r)} is not one of ${Object.keys(REASONS).join(", ")}`));
  }
  problems.push(...Object.keys(NOT_ASSUMPTIONS).filter(f => !(f in upper)).map(f => `8 constants: NOT_ASSUMPTIONS lists ${f}, which this qual does not read`));
}

// --- 9. Credit and links ----------------------------------------------------
let links = 0;
{
  for (const [id, text] of texts) {
    const outside = text.replace(LINK, " ");
    problems.push(...[...outside.matchAll(/(?:https?:\/\/|www\.)\S*|\b[\w-]+\.(?:com|org|gov|net|es)\b\S*/g)].map(m => `9 links: ${id}: the address ${JSON.stringify(m[0])} stands outside a link`));
    for (const m of text.matchAll(LINK)) {
      links++;
      if (!new RegExp(`^${DRAWN_LINK.source}$`).test(m[0])) problems.push(`9 links: ${id}: ${m[0]} is not a form the page draws`);
      if (/robotaxitracker\.com/.test(m[2]) && !(m[1] === m[2] && /Robotaxi Tracker/.test(text))) problems.push(`9 links: ${id}: ${m[0]} must show its address as its text, in a text naming Robotaxi Tracker`);
    }
  }
  const pageForm = new RegExp(`^${app("RATIONALE_LINK.source")}$`);
  problems.push(...[...texts].flatMap(([id, text]) => [...text.matchAll(LINK)].filter(m => !pageForm.test(m[0])).map(m => `9 links: ${id}: ${m[0]} does not fit crashla.js's RATIONALE_LINK`)));
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load crashla.js in a DOM stub, render the assumptions section (renderAssumptions) and read ASSUMPTIONS against INVENTORY, DOC, CLAIMS and NOT_ASSUMPTIONS in this qual, data/vmt.csv, data/waymo-ca.csv, data/waymo-ca-sources.json, data/README.md, the Python builders (one python3 run) and the quals the entries cite.
Expectata: the structure, render, inventory, values, claims, where pairs, registries, month coverage, constants and links of this qual's header (1-9).
Resultata: ${problems.length} problems:
${problems.join("\n")}`);

// --- 10. In Chromium, Firefox and WebKit -------------------------------------
// Each text run in the section: inside AI text (an .ai-text element in the
// list) or not, its color and fill, its AI text's own decoration, and for a
// run outside AI text the nearest element at or above it drawing a dotted
// underline.
const scan = () => {
  const probe = document.createElement("span");
  probe.style.color = "var(--ai-ink)";
  document.body.appendChild(probe);
  const aiInk = getComputedStyle(probe).color;
  probe.remove();
  const dotted = s => /\bunderline\b/.test(s.getPropertyValue("text-decoration-line")) && s.getPropertyValue("text-decoration-style") === "dotted";
  const dottedAt = el => { for (let e = el; e !== null; e = e.parentElement) if (dotted(getComputedStyle(e))) return e.tagName.toLowerCase() + (e.id ? "#" + e.id : ""); return null; };
  const list = document.getElementById("assumptions-list");
  const runs = [];
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.textContent.trim() === "") continue;
    const el = n.parentElement, ai = el.closest(".ai-text"), s = getComputedStyle(el);
    const inAi = ai !== null && list.contains(ai);
    runs.push({ text: n.textContent.trim().slice(0, 30), ai: inAi, tag: el.tagName, color: s.color, fill: s.getPropertyValue("-webkit-text-fill-color"),
      aiDotted: inAi ? dotted(getComputedStyle(ai)) : null, dottedAt: inAi ? null : dottedAt(el) });
  }
  return { aiInk, forced: matchMedia("(forced-colors: active)").matches, runs,
    rows: list.querySelectorAll("tr[id^='assumption-']").length };
};
const marks = (tag, r) => [
  ...r.runs.filter(x => x.ai && !x.aiDotted).map(x => `${tag} AI text ${JSON.stringify(x.text)} is not dotted-underlined`),
  ...r.runs.filter(x => !x.ai && x.dottedAt !== null).map(x => `${tag} ${x.tag} ${JSON.stringify(x.text)} sits under a dotted underline (${x.dottedAt})`),
  ...(r.runs.some(x => x.ai) && r.runs.some(x => !x.ai) ? [] : [`${tag} the section's runs are all ${r.runs.some(x => x.ai) ? "AI text" : "plain"}`]),
];
const inks = (tag, r) => [
  ...r.runs.filter(x => x.fill !== x.color).map(x => `${tag} ${JSON.stringify(x.text)} is filled ${x.fill}, drawn ${x.color}`),
  ...r.runs.filter(x => x.ai && x.color !== r.aiInk).map(x => `${tag} AI text ${JSON.stringify(x.text)} is drawn ${x.color}, not the AI ink ${r.aiInk}`),
  ...r.runs.filter(x => !x.ai && x.color === r.aiInk).map(x => `${tag} ${x.tag} ${JSON.stringify(x.text)} is drawn in the AI ink`),
];
// (d) The tables' fit and their where cells, at each width: each table's box
// against its width; for each row's where cell (its last cell), the
// characters a line it holds room for (its content box's width over its
// text's mean character width: the sum of the characters' boxes over their
// count), and the first line break that falls between two word characters of
// its text (a line starts where a character's box sits more than 2 px below
// the last box before it; the character before the break is read from the
// text, so a break at a space is none). 641 px is the narrowest width at
// which the column sits beside its text (style.css: below 40rem it goes
// under it). At 320 px the column held room for about 5-8 characters a line
// and split 92 of 95 rows' names, and at 1200 px it split 17-26 (until
// 2026-11-20).
const WIDTHS = [1200, 641, 375, 320];
const WHERE_MIN_CHARS = 16;
const whereLayout = () => {
  const list = document.getElementById("assumptions-list");
  const range = document.createRange();
  const cells = [...list.querySelectorAll("tr[id^='assumption-']")].map(tr => {
    const cell = tr.cells[tr.cells.length - 1];
    let lines = 0, top = null, last = "", split = null, drawn = 0, width = 0;
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      for (let i = 0; i < n.textContent.length; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1);
        const box = [...range.getClientRects()].find(r => r.width > 0);
        const ch = n.textContent[i];
        if (box !== undefined) { drawn++; width += box.width; }
        if (box !== undefined && (top === null || box.top > top + 2)) {
          if (top !== null && split === null && /\w/.test(last) && /\w/.test(ch)) split = `${last}|${ch}`;
          lines++;
          top = box.top;
        }
        last = ch;
      }
    }
    const s = getComputedStyle(cell);
    const room = cell.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    return { id: tr.id, lines, split, room: room / (width / drawn) };
  });
  return { cells, wraps: [...list.querySelectorAll(".table-wrap")].map(w => ({ id: w.firstElementChild.id, scroll: w.scrollWidth, client: w.clientWidth })) };
};
const layoutProblems = (tag, m) => [
  ...m.wraps.filter(w => w.scroll > w.client).map(w => `${tag} #${w.id} is ${w.scroll} px wide in its ${w.client} px box`),
  ...m.cells.filter(c => c.lines === 0).map(c => `${tag} #${c.id}'s where cell draws no line`),
  ...m.cells.filter(c => c.split !== null).map(c => `${tag} #${c.id}'s where cell breaks a line inside a name (${c.split})`),
  ...m.cells.filter(c => !(c.room >= WHERE_MIN_CHARS)).map(c => `${tag} #${c.id}'s where cell has room for ${c.room.toFixed(1)} characters a line, under ${WHERE_MIN_CHARS}`),
];
// For the pass line: the room of the narrowest where cell.
const narrowest = m => `room for ${Math.min(...m.cells.map(c => c.room)).toFixed(1)} characters a line or more`;
const server = await serveRepo();
const browserProblems = [], seen = [];
const assumptionCount = [...entries].length;
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
  const tag = `[${engine}]`;
  // (a)
  const order = await page.evaluate(() => [...document.querySelectorAll("section.collapsible")].map(s => s.id));
  const at = order.indexOf("sec-assumptions");
  if (!(at > 0 && order[at - 1] === "sec-summary" && order[at + 1] === "sec-sanity")) browserProblems.push(`${tag} the sections are ${order.join(", ")}`);
  const state = () => page.evaluate(() => ({ collapsed: document.getElementById("sec-assumptions").classList.contains("collapsed"),
    x: new URL(location.href).searchParams.get("x") ?? "" }));
  await page.locator("#sec-assumptions .sec-toggle").click();
  const shut = await state();
  if (!(shut.collapsed && shut.x.split(".").includes("assumptions"))) browserProblems.push(`${tag} a click on the heading leaves ${JSON.stringify(shut)}, want it collapsed and x= listing assumptions`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(drawnAll);
  const kept = await state();
  if (!(kept.collapsed && kept.x.split(".").includes("assumptions"))) browserProblems.push(`${tag} reloaded, the section reads ${JSON.stringify(kept)}, want it still collapsed`);
  await page.locator("#sec-assumptions .sec-toggle").click();
  const open = await state();
  if (open.collapsed || open.x.split(".").includes("assumptions")) browserProblems.push(`${tag} a second click leaves ${JSON.stringify(open)}, want it open and x= without assumptions`);
  // (b), (d)
  const own = await page.evaluate(scan);
  if (own.forced) browserProblems.push(`${tag} the page is in forced colors before any emulation`);
  if (own.rows !== assumptionCount) browserProblems.push(`${tag} the section draws ${own.rows} rows, ASSUMPTIONS holds ${assumptionCount}`);
  browserProblems.push(...marks(tag, own), ...inks(tag, own));
  // (d) at each width, on a page of its own
  const layouts = [];
  for (const width of WIDTHS) {
    const at = await openPage(browser, server.url + DEF, { viewport: { width, height: 900 } });
    const m = await at.evaluate(whereLayout);
    browserProblems.push(...layoutProblems(`${tag} [${width} px]`, m), ...at.errors.map(e => `${tag} [${width} px] page error: ${e}`));
    layouts.push(`${width} px: ${narrowest(m)}`);
    await at.context().close();
  }
  // (c) The entries' own links, and one more drawn by the app's own
  // rationaleHtml into the first entry's text cell for this check (removed
  // after it), so the check reads a link in the section's cells whatever the
  // entries hold (open question 39 may take Robotaxi Tracker's links out).
  const realLinks = await page.locator("#assumptions-list .ai-text a").count();
  const added = await page.evaluate(() => {
    const cell = document.querySelector("#assumptions-list tr[id^='assumption-'] td.ai-text");
    const span = document.createElement("span");
    span.id = "assumptions-qual-link";
    span.innerHTML = " " + rationaleHtml("[data/README.md, Ghost months](data/#ghost-months)");
    cell.appendChild(span);
    return span.querySelectorAll("a").length;
  });
  if (added !== 1) browserProblems.push(`${tag} rationaleHtml drew ${added} links from one markdown link`);
  const linkCount = realLinks + added;
  for (let i = 0; i < linkCount; i++) {
    const link = page.locator("#assumptions-list .ai-text a").nth(i);
    const read = () => link.evaluate(a => {
      const probe = document.createElement("span"); probe.style.color = "var(--ai-ink)"; document.body.appendChild(probe);
      const ink = getComputedStyle(probe).color; probe.remove();
      const s = getComputedStyle(a);
      return { text: a.textContent, ink, color: s.color, line: s.textDecorationLine, style: s.textDecorationStyle, hovered: a.matches(":hover") };
    });
    await page.mouse.move(0, 0);
    const rest = await read();
    await link.hover();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));
    const hover = await read();
    for (const [when, l] of [["at rest", rest], ["hovered", hover]]) {
      if (l.color !== l.ink) browserProblems.push(`${tag} link ${JSON.stringify(l.text)} ${when} is drawn ${l.color}, not the AI ink ${l.ink}`);
      if (!(/\bunderline\b/.test(l.line) && l.style === "solid")) browserProblems.push(`${tag} link ${JSON.stringify(l.text)} ${when} is decorated "${l.line} ${l.style}", want a solid underline`);
    }
    if (!hover.hovered) browserProblems.push(`${tag} link ${JSON.stringify(hover.text)}: the pointer is on it but it does not match :hover`);
  }
  await page.evaluate(() => document.getElementById("assumptions-qual-link").remove());
  await page.mouse.move(0, 0);
  // (b) in forced colors: the marks only
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await page.evaluate(scan);
  if (!forced.forced) browserProblems.push(`${tag} matchMedia does not report forced colors after emulateMedia({forcedColors: "active"})`);
  browserProblems.push(...marks(`${tag} [forced colors]`, forced));
  // (e)
  browserProblems.push(...page.errors.map(e => `${tag} page error: ${e}`));
  seen.push(`${engine} ${own.rows} rows, ${own.runs.length} text runs, ${realLinks} links and one added; ${layouts.join("; ")}`);
  await browser.close();
}
await server.close();
// The engines this run drove, by name (quals/browser.mjs ENGINES; until
// 2026-11-20 the pass line named all three whatever ran).
const ENGINE_NAMES = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" };
assert.ok(Object.keys(ENGINES).every(e => e in ENGINE_NAMES), `quals/browser.mjs ENGINES holds an engine this qual has no name for: ${Object.keys(ENGINES)}`);
const engineList = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(Object.keys(ENGINES).map(e => ENGINE_NAMES[e]));
for (const p of browserProblems) console.error(p);
assert.ok(browserProblems.length === 0,
  `Replicata: load the default view in ${engineList} at 1200x900; read the sections' order; click the assumptions heading, reload, click it again; read every text run in #assumptions-list and each link in its AI text at rest and hovered; then emulate forced colors and read the runs again; and at ${WIDTHS.join(", ")} px wide read each table's box and each where cell's lines.
Expectata: #sec-assumptions right after #sec-summary and right before #sec-sanity; collapsed with x= listing assumptions after the click and the reload, open with x= dropping it after the second click; one row per entry; AI text drawn in the AI ink and dotted-underlined, every other run in another ink and under no dotted underline (in forced colors, the same marks); each link in the AI ink at rest and hovered, with a solid underline; at each width no table wider than its box, no where cell breaking a line inside a name, and each where cell with room for at least ${WHERE_MIN_CHARS} characters a line; no page errors.
Resultata: ${browserProblems.length} problems:
${browserProblems.join("\n")}`);

console.log(`qual pass: the assumptions section lists ${assumptionCount} entries in ${groups.length} groups; ${Object.values(counts).reduce((a, b) => a + b, 0)} values match their sources (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ")}), ${Object.keys(CLAIMS).length} entries' words and live figures their claims; every data/vmt.csv line-month is covered, every human band and forecast described, every builder and model-qual constant classified, ${links} links in the page's forms; ${seen.join("; ")}: AI text in the AI ink with a dotted underline, its links solid-underlined in it, nothing else in it or dotted, in ${engineList}`);

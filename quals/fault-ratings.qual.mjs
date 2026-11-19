// Fault values come from one instrument, and every reading is on file.
//
// The human, 2026-11-16: "there's value in just picking a simple, repeatable
// method for getting faultfracs from blind sub-agents with known parameters",
// and "we don't want messy special cases with overrides. that can insert bias,
// since we're more likely to look closer and override for Tesla in
// particular."
//
// The instrument (data/faultrate.py): a blind rater is one headless model call
// that sees data/fault-criterion.md as its whole system prompt and one crash
// report (the report's month, time and road type, each party's movement and
// contact area, the AV's speed at contact, and the narrative with the
// company's name replaced), from an empty folder outside the repo, with no
// tools. RATERS such calls rate each incident; the incident's fault value is
// their median, and its one-line reason is the median rater's. Nobody edits a
// value afterwards.
//
// Spec:
//   1. The instrument's parts are what this header says (model, effort,
//      number of raters, the 80-character reason, the call's arguments, the
//      empty folder, the masking, what a case shows and hides, the median).
//   2. Its identity, instrument_id(), changes with the criterion's text.
//   3. data/fault-ratings.csv holds every rating: reportID, rater, faultfrac,
//      reasoning, instrument, case. Every rating was made by the current
//      instrument (so an edit to the criterion, the model or the case format
//      leaves this qual red until every incident is rated again: one method
//      for every row), and of its report's current case: its case is
//      case_id() of the text a rater reads for the report now (since
//      2026-11-18, the human: "hash is smart to avoid special cases, smart.
//      yes to that"), so a report whose case has changed (an NHTSA update to
//      its filing, or NHTSA's row taking a preprint's place) leaves this qual
//      red until data/faultrate.py rates it again. Any character changed
//      counts ("if even a character changed, re-rating is correct"), but not
//      whitespace or the Unicode encoding of a character: case_id() hashes
//      the text with every run of whitespace made one space and in Unicode
//      normal form C (the human: "we could canonicalize whitespace perhaps",
//      and of the other ideas offered, "i think everything but 1 is trying
//      to be too clever").
//   4. Every data/faultfrac.csv row has exactly RATERS ratings, raters 1 to
//      RATERS, and no rating lacks a row; each rating is on the 0.05 grid in
//      0 to 1, with a reason of 1 to 80 characters that names no company.
//   5. Each data/faultfrac.csv value is the median of its ratings, and its
//      reasoning is that of the lowest-numbered rater at the median.
//   6. data/faultrate.py rates a report again when its case has changed: run
//      on a copy of the ratings in which one report's ratings carry another
//      case, with a stand-in rater, it makes RATERS ratings of that report's
//      current case and no other, drops the old ones, keeps every other
//      rating as it was, and writes the fault file from the new ratings.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv-parse.mjs";

const problems = [];
const check = (ok, replicata, expectata, resultata) => {
  if (!ok) problems.push(`Replicata: ${replicata}\nExpectata: ${expectata}\nResultata: ${resultata}`);
};

// ---- 1 and 2: the instrument's parts ---------------------------------------
const py = `
import json, os, sys
sys.path.insert(0, "data")
import faultrate as f
areas = {}
row = {
    "Report ID": "99999-1234", "Reporting Entity": "Waymo LLC", "Incident Date": "MAR-2031",
    "Incident Time (24:00)": "21:47", "City": "Springfield", "State": "ZZ", "Roadway Type": "Intersection",
    "Crash With": "Pickup Truck", "Highest Injury Severity Alleged": "Minor W/ Hospitalization",
    "SV Pre-Crash Movement": "Proceeding Straight", "SV Precrash Speed (MPH)": "17",
    "CP Pre-Crash Movement": "Making Left Turn", "Model": "Zeeblemobile", "VIN": "VINVINVIN",
    "SV Contact Area - Front Left": "Y", "CP Contact Area - Right": "Y",
    "Narrative": "A Waymo AV met a pickup. Waymo's car braked; the Waymos, a Tesla and ZOOX were near. The second Waymo AV was struck.",
}
quote = "The second Waymo AV was struck."
text = f.CRITERION.read_text()
blind = f.blind_dir()
print(json.dumps({
    "id": f.instrument_id(text), "idOther": f.instrument_id(text + " x"),
    "model": f.MODEL, "effort": f.EFFORT, "raters": f.RATERS, "reasonMax": f.REASON_MAX, "schema": f.SCHEMA,
    "masked": f.mask(row["Narrative"]),
    "case": f.case_text(row, ""), "caseSecond": f.case_text(row, quote),
    "args": f.cli_args("SYSTEM PROMPT"),
    "blind": os.path.realpath(blind), "blindHolds": os.listdir(blind), "repo": os.path.realpath("."),
    "median": [f.median_rating([(1, 0.1, "one"), (2, 0.3, "two"), (3, 0.1, "three")]),
               f.median_rating([(1, 0.4, "one"), (2, 0.0, "two"), (3, 0.2, "three")]),
               f.median_rating([(3, 0.5, "three"), (2, 0.5, "two"), (1, 0.9, "one")])],
    "fields": f.RATING_FIELDS,
    "caseIds": [f.case_id("one case"), f.case_id("one case"), f.case_id("one case.")] if hasattr(f, "case_id") else None,
    "caseSame": [f.case_id(t) for t in ["Caf\\u00e9 at 9 mph.\\nThe AV stopped.", "Cafe\\u0301  at 9 mph. \\n\\n The AV\\u00a0stopped.\\t",
                                        " Caf\\u00e9 at 9 mph. The AV stopped."]] if hasattr(f, "case_id") else None,
    "caseOther": [f.case_id(t) for t in ["Caf\\u00e9 at 9 mph. The AV stopped", "Caf\\u00e9 at 99 mph. The AV stopped.",
                                         "Cafe at 9 mph. The AV stopped.", "caf\\u00e9 at 9 mph. The AV stopped."]] if hasattr(f, "case_id") else None,
}))
`;
let inst = null;
try {
  inst = JSON.parse(execFileSync("python3", ["-B", "-c", py], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (e) {
  check(false, "import data/faultrate.py and read the instrument's parts (model, effort, raters, schema, mask, case text, CLI arguments, blind folder, median).",
    "the module loads and answers.", String(e.stderr || e.message).trim().split("\n").slice(-3).join(" | "));
}
if (inst) {
  check(/^[0-9a-f]{12}$/.test(inst.id) && inst.id !== inst.idOther,
    "compute instrument_id() for the criterion's text and for the text with one character added.",
    "two different 12-digit hex ids.", `${inst.id} and ${inst.idOther}`);
  check(inst.raters === 3 && inst.reasonMax === 80 && inst.schema.properties.reasoning.maxLength === inst.reasonMax
    && JSON.stringify(inst.schema.required) === JSON.stringify(["faultfrac", "reasoning"]) && inst.schema.additionalProperties === false,
    "read RATERS, REASON_MAX and the output schema.",
    "3 raters; an 80-character reason, which the schema enforces (maxLength); exactly faultfrac and reasoning required.",
    JSON.stringify({ raters: inst.raters, reasonMax: inst.reasonMax, schema: inst.schema }));
  check(!/waymo|tesla|zoox/i.test(inst.masked) && !/\ba Acme\b/.test(inst.masked) && (inst.masked.match(/Acme/g) || []).length === 6,
    `mask "A Waymo AV met a pickup. Waymo's car braked; the Waymos, a Tesla and ZOOX were near. The second Waymo AV was struck."`,
    'no company name left, six "Acme", and "an Acme" where "a Waymo" stood.', inst.masked);
  const shown = ["MAR-2031", "21:47", "Intersection", "Proceeding Straight", "17 mph", "front left", "Pickup Truck", "Making Left Turn", "right", "An Acme AV met a pickup."];
  const hidden = ["99999-1234", "Springfield", "ZZ", "Minor W/ Hospitalization", "Zeeblemobile", "VINVINVIN", "Waymo", "Tesla", "ZOOX"];
  check(shown.every(s => inst.case.includes(s)) && hidden.every(s => !inst.case.includes(s)),
    "build the case text for a synthetic report.",
    `it shows ${JSON.stringify(shown)} and hides ${JSON.stringify(hidden)}.`,
    `missing: ${JSON.stringify(shown.filter(s => !inst.case.includes(s)))}; leaked: ${JSON.stringify(hidden.filter(s => inst.case.includes(s)))}`);
  check(inst.caseSecond.includes("The second Acme AV was struck.") && inst.caseSecond.length > inst.case.length
    && inst.caseSecond.split("The second Acme AV was struck.").length === 3,
    "build the case text for the second AV of a two-AV report (its quote given).",
    "the case says which AV it is about by quoting the narrative's sentence, masked (so the sentence appears twice).", inst.caseSecond);
  const a = inst.args, at = flag => a[a.indexOf(flag) + 1];
  check(a.includes("-p") && at("--tools") === "" && at("--system-prompt") === "SYSTEM PROMPT" && at("--model") === inst.model
    && at("--effort") === inst.effort && at("--output-format") === "json" && at("--json-schema") === JSON.stringify(inst.schema)
    && ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"].every(f => a.includes(f)),
    "read the rater call's arguments, cli_args(system).",
    "a headless call with no tools, the given system prompt, the model, the effort, the schema, and no MCP servers, slash commands or saved session.",
    JSON.stringify(a.map(x => (x.length > 60 ? x.slice(0, 60) + "..." : x))));
  check(inst.blindHolds.length === 0 && !inst.blind.startsWith(inst.repo + path.sep) && inst.blind !== inst.repo,
    "ask for the folder a rater runs in, blind_dir().", "an empty folder outside the repo.",
    `${inst.blind} holding ${JSON.stringify(inst.blindHolds)} (repo ${inst.repo})`);
  check(JSON.stringify(inst.median) === JSON.stringify([[0.1, "one"], [0.2, "three"], [0.5, "two"]]),
    "take median_rating() of (0.1, 0.3, 0.1), of (0.4, 0, 0.2) and of raters 3, 2, 1 at (0.5, 0.5, 0.9).",
    'the median value with the reason of the lowest-numbered rater at it: [0.1, "one"], [0.2, "three"], [0.5, "two"].', JSON.stringify(inst.median));
  check(JSON.stringify(inst.fields) === JSON.stringify(["reportID", "rater", "faultfrac", "reasoning", "instrument", "case"]),
    "read RATING_FIELDS.", "reportID, rater, faultfrac, reasoning, instrument, case.", JSON.stringify(inst.fields));
  check(inst.caseIds !== null && inst.caseIds.every(id => /^[0-9a-f]{12}$/.test(id)) && inst.caseIds[0] === inst.caseIds[1] && inst.caseIds[0] !== inst.caseIds[2],
    'compute case_id() of "one case" twice and of "one case." once.',
    "12-digit hex ids, the same for the same text and different for a text one character longer.", JSON.stringify(inst.caseIds));
  const same = inst.caseSame, other = inst.caseOther;
  check(same !== null && new Set(same).size === 1 && other.every(id => id !== same[0]) && new Set(other).size === other.length,
    'compute case_id() of "Café at 9 mph.\\nThe AV stopped." written three ways (é composed and decomposed, line breaks, runs of spaces, a no-break space, a tab, spaces at either end) and of four texts each one character away (no final period, 99 for 9, e for é, a lowercase c).',
    "one id for the three writings, which differ only in whitespace and Unicode form, and a different id for each of the four.",
    JSON.stringify({ same, other }));
}

// The current case of every in-scope incident, as data/faultrate.py builds it.
let current = null;
try {
  current = JSON.parse(execFileSync("python3", ["-B", "-c", `
import json, sys
sys.path.insert(0, "data")
import faultrate as f
print(json.dumps({rid: f.case_id(f.case_text(row, quote)) for rid, (row, quote) in f.incident_rows().items()}))
`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }));
} catch (e) {
  check(false, "compute case_id(case_text()) for every in-scope incident (data/faultrate.py incident_rows()).",
    "the module answers.", String(e.stderr || e.message).trim().split("\n").slice(-3).join(" | "));
}

// ---- 3 to 5: the ratings on file --------------------------------------------
const RATINGS = "data/fault-ratings.csv";
check(fs.existsSync(RATINGS), `look for ${RATINGS}.`, "the file of every rater's rating.", "no such file.");
if (inst && fs.existsSync(RATINGS)) {
  const [rh, ...ratings] = parseCsv(fs.readFileSync(RATINGS, "utf8"));
  check(JSON.stringify(rh) === JSON.stringify(inst.fields), `read ${RATINGS}'s header.`, JSON.stringify(inst.fields), JSON.stringify(rh));
  const [fh, ...faults] = parseCsv(fs.readFileSync("data/faultfrac.csv", "utf8"));
  const fi = Object.fromEntries(fh.map((h, i) => [h, i]));
  const by = new Map();
  const bad = [];
  for (const [rid, rater, ff, reason, instrument, kase] of ratings) {
    const v = Number(ff), k = Number(rater);
    if (instrument !== inst.id) bad.push(`${rid} rater ${rater}: made by instrument ${instrument}, not the current ${inst.id}`);
    if (current && kase !== current[rid]) bad.push(`${rid} rater ${rater}: made of case ${kase}, not its current case ${current[rid]} (run python3 data/faultrate.py, which rates it again)`);
    if (!(Number.isInteger(k) && k >= 1 && k <= inst.raters)) bad.push(`${rid}: rater ${rater} is not 1 to ${inst.raters}`);
    if (!(ff.trim() !== "" && v >= 0 && v <= 1 && Math.abs(v * 20 - Math.round(v * 20)) < 1e-9)) bad.push(`${rid} rater ${rater}: faultfrac ${ff} is not on the 0.05 grid in 0 to 1`);
    if (!(reason.length >= 1 && reason.length <= inst.reasonMax)) bad.push(`${rid} rater ${rater}: a reason of ${reason.length} characters`);
    if (/waymo|tesla|zoox|acme/i.test(reason)) bad.push(`${rid} rater ${rater}: the reason names a company: ${reason}`);
    if (!by.has(rid)) by.set(rid, new Map());
    if (by.get(rid).has(k)) bad.push(`${rid}: rater ${rater} twice`);
    by.get(rid).set(k, [v, reason]);
  }
  const ids = new Set(faults.map(r => r[fi.reportID]));
  for (const rid of by.keys()) if (!ids.has(rid)) bad.push(`${rid}: ratings on file, no data/faultfrac.csv row`);
  for (const r of faults) {
    const rid = r[fi.reportID], got = by.get(rid);
    if (!got || got.size !== inst.raters) { bad.push(`${rid}: ${got ? got.size : 0} ratings on file, not ${inst.raters}`); continue; }
    const sorted = [...got.values()].map(x => x[0]).sort((x, y) => x - y), med = sorted[(inst.raters - 1) / 2];
    const who = [...got.keys()].sort((x, y) => x - y).find(k => got.get(k)[0] === med);
    if (Number(r[fi.faultfrac]) !== med) bad.push(`${rid}: faultfrac ${r[fi.faultfrac]}, but its ratings' median is ${med} (${sorted.join(", ")})`);
    if (r[fi.reasoning] !== got.get(who)[1]) bad.push(`${rid}: reasoning is not rater ${who}'s (the lowest-numbered rater at the median)`);
  }
  check(bad.length === 0,
    `read ${RATINGS} (${ratings.length} ratings) against data/faultfrac.csv (${faults.length} rows) and the current instrument (${inst.id}).`,
    `every row has ${inst.raters} ratings by the current instrument, each of its report's current case and on the 0.05 grid with a reason of 1 to ${inst.reasonMax} characters naming no company; each fault value is its ratings' median and its reasoning the median rater's; no rating lacks a row.`,
    `${bad.length} problems, the first: ${bad.slice(0, 8).join(" | ")}`);
}

// ---- 6: a report whose case has changed is rated again -----------------------
if (inst && current && fs.existsSync(RATINGS)) {
  const run6 = `
import csv, io, json, pathlib, sys, tempfile
sys.path.insert(0, "data")
import faultrate as f, slurp
calls = []
def fake_rate(cli, system, case, folder):
    calls.append(case)
    return 0.35, "a stand-in rater's line", 0
real = pathlib.Path(f.RATINGS).read_text()
rows = list(csv.DictReader(io.StringIO(real)))
target = rows[0]["reportID"]
stale = [dict(r, case="000000000000") if r["reportID"] == target else r for r in rows]
with tempfile.TemporaryDirectory() as d:
    ratings, faults = pathlib.Path(d) / "ratings.csv", pathlib.Path(d) / "faultfrac.csv"
    with open(ratings, "w", newline="") as out:
        w = csv.DictWriter(out, fieldnames=f.RATING_FIELDS, lineterminator="\\n"); w.writeheader(); w.writerows(stale)
    f.RATINGS, slurp.FAULT_INPUT, f.rate, f.cli_path = ratings, faults, fake_rate, (lambda: "stand-in")
    f.main()
    after = list(csv.DictReader(io.StringIO(ratings.read_text())))
    fault_rows = {r["reportID"]: r for r in csv.DictReader(io.StringIO(faults.read_text()))}
rid_cases = {rid: f.case_id(f.case_text(row, quote)) for rid, (row, quote) in f.incident_rows().items() if rid == target}
print(json.dumps({"target": target, "calls": len(calls), "callCases": sorted({f.case_id(c) for c in calls}),
                  "want": rid_cases[target],
                  "targetAfter": [r for r in after if r["reportID"] == target],
                  "othersEqual": [r for r in after if r["reportID"] != target] == [r for r in rows if r["reportID"] != target],
                  "fault": fault_rows.get(target)}))
`;
  let r6 = null;
  try {
    r6 = JSON.parse(execFileSync("python3", ["-B", "-c", run6], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).trim().split("\n").at(-1));
  } catch (e) {
    check(false, "run data/faultrate.py's main() on a copy of the ratings with a stand-in rater.", "it runs.",
      String(e.stderr || e.message).trim().split("\n").slice(-3).join(" | "));
  }
  if (r6) {
    const t = r6.targetAfter;
    check(r6.calls === inst.raters && r6.callCases.length === 1 && r6.callCases[0] === r6.want
        && t.length === inst.raters && t.every(x => x.case === r6.want && x.faultfrac === "0.35" && x.instrument === inst.id)
        && r6.othersEqual && r6.fault && r6.fault.faultfrac === "0.35" && r6.fault.reasoning === "a stand-in rater's line",
      `run data/faultrate.py's main() on a copy of ${RATINGS} in which ${r6.target}'s ratings carry the case 000000000000, with a stand-in rater that gives 0.35.`,
      `it asks the rater ${inst.raters} times, each time ${r6.target}'s current case (${r6.want}); ${r6.target} then has ${inst.raters} ratings of 0.35 of that case and the old ones are gone; every other rating is as it was; the fault file gives ${r6.target} 0.35 and the stand-in's line.`,
      JSON.stringify({ calls: r6.calls, callCases: r6.callCases, targetAfter: t.map(x => [x.rater, x.faultfrac, x.case]), othersEqual: r6.othersEqual, fault: r6.fault }));
  }
}

assert.deepEqual(problems, [], `\n${problems.join("\n\n")}`);
console.log(`qual pass: every fault value is the median of ${inst.raters} blind ratings on file, all by the current instrument (${inst.id}: ${inst.model}, ${inst.effort} effort)`);

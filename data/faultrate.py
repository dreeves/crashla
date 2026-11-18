#!/usr/bin/env python3
"""Fault ratings by blind raters (data/README.md, Each NHTSA release, step 5).

    python3 data/faultrate.py

brings every in-scope incident to RATERS ratings by the current instrument,
keeps each rating in data/fault-ratings.csv, and writes data/faultfrac.csv from
them: an incident's fault value is the median of its ratings and its reasoning
is the median rater's one line. Nobody edits a value afterwards (the human,
2026-11-16: "we don't want messy special cases with overrides. that can insert
bias, since we're more likely to look closer and override for Tesla in
particular").

A rater is one headless model call (the Claude Code CLI, print mode). It gets
data/fault-criterion.md as its whole system prompt and one case as its input:
the report's month, time and road type, each party's movement and contact
area, the AV's speed at contact, and the narrative with the company's name
replaced by MASK_NAME. It runs in an empty folder outside the repo with no
tools, so it sees no other case, no other rater, no earlier value and nothing
of this repo. The output schema holds the reason to REASON_MAX characters: the
CLI checks the answer against the schema and the rater shortens a longer line
in the same session.

The instrument is the criterion's text, the model, the effort, the output
schema and the case format together; instrument_id() names it, and every
rating on file carries the id it was made with. Ratings by another instrument
stop the run (change the criterion, and every incident is rated again: one
method for every row).

A stopped run resumes: ratings are saved as they arrive, and a later run rates
only what is missing. data/faultfrac.csv is written once every incident has
its RATERS ratings.

quals/fault-ratings.qual.mjs holds this file to that description.
"""
import concurrent.futures
import csv
import glob
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import slurp  # noqa: E402  (the pipeline: which incidents are in scope, and the fault file's format)

must = slurp.must

MODEL = "claude-opus-5-5"
EFFORT = "medium"
RATERS = 3
REASON_MAX = 80        # characters in a rater's one line (the criterion says so too)
WORKERS = 16           # rater calls in flight at once
ATTEMPTS = 4           # calls per rating before the run stops on it

CRITERION = slurp.DATA_DIR / "fault-criterion.md"
RATINGS = slurp.DATA_DIR / "fault-ratings.csv"
RATING_FIELDS = ["reportID", "rater", "faultfrac", "reasoning", "instrument"]

SCHEMA = {
    "type": "object",
    "properties": {"faultfrac": {"type": "number"},
                   "reasoning": {"type": "string", "maxLength": REASON_MAX}},
    "required": ["faultfrac", "reasoning"],
    "additionalProperties": False,
}

# What stands in a narrative for the company's name (the criterion tells the
# rater so). A rater that knows whose car it is can rate the company.
MASK_NAME = "Acme"
COMPANIES = sorted(set(slurp.HELMER_SHORT.values()))
# A company's name, also before a plural or possessive s ("Waymos", "Waymo's").
COMPANY_RE = re.compile(r"\b(?:%s)(?=s?\b)" % "|".join(COMPANIES), re.I)
ANY_COMPANY_RE = re.compile("|".join(COMPANIES), re.I)

# The case a rater reads. The fields are the ones a rating can turn on; the
# Report ID, the company, the place, the severity, the airbag and belt fields
# and the vehicle's model are left out (the criterion: only avoidability
# counts).
CASE_FORMAT = """Crash report

Month: {month}    Time: {time}    Road: {road}
The AV: {av_movement}, {av_speed} mph; contact on its {av_area}
The other party: {other}; {other_movement}; contact on its {other_area}
{second}
Narrative:
{narrative}"""
# For the second AV of a report that covers two of a company's AVs
# (slurp.SECOND_INVOLVEMENTS): the fields above are that AV's, and this line
# says which AV of the narrative the case is about.
SECOND_LINE = '\nThis report is about the second of two {name} AVs in the crash, the one this sentence of the narrative names: "{quote}"\n'
NOT_STATED = "not stated"


def instrument_id(criterion_text):
    """The instrument's name: 12 hex digits that change with the criterion's
    text, the model, the effort, the output schema or the case format."""
    parts = [criterion_text, MODEL, EFFORT, json.dumps(SCHEMA, sort_keys=True), CASE_FORMAT, SECOND_LINE, MASK_NAME, NOT_STATED]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:12]


def mask(text):
    """<text> with each company's name replaced by MASK_NAME."""
    out = COMPANY_RE.sub(MASK_NAME, text)
    out = re.sub(r"\b([Aa]) (?=%s\b)" % MASK_NAME, r"\1n ", out)       # "a Acme" -> "an Acme"
    must(ANY_COMPANY_RE.search(out) is None,
         "a company's name survives the mask (teach COMPANY_RE this form of it)",
         found=ANY_COMPANY_RE.findall(out), text=out[:300])
    return out


def case_text(row, second_quote):
    """The case for one NHTSA report row; <second_quote> is the narrative's
    sentence naming the second AV when the row is that AV's, else ""."""
    stated = lambda value: value.strip() or NOT_STATED
    second = SECOND_LINE.format(name=MASK_NAME, quote=mask(second_quote)) if second_quote else ""
    return CASE_FORMAT.format(
        month=stated(row["Incident Date"]), time=stated(row["Incident Time (24:00)"]), road=stated(row["Roadway Type"]),
        av_movement=stated(row["SV Pre-Crash Movement"]), av_speed=stated(row["SV Precrash Speed (MPH)"]),
        av_area=stated(slurp._contact_areas(row, "SV Contact Area")),
        other=stated(row["Crash With"]), other_movement=stated(row["CP Pre-Crash Movement"]),
        other_area=stated(slurp._contact_areas(row, "CP Contact Area")),
        second=second, narrative=mask(row["Narrative"].strip()))


def cli_args(system):
    """The rater call's arguments after the CLI's path."""
    return ["-p", "--model", MODEL, "--effort", EFFORT, "--tools", "", "--strict-mcp-config",
            "--disable-slash-commands", "--no-session-persistence", "--system-prompt", system,
            "--output-format", "json", "--json-schema", json.dumps(SCHEMA, separators=(",", ":"))]


def cli_path():
    """The newest Claude Code CLI that the VS Code extension has installed."""
    version = lambda p: tuple(int(n) for n in re.search(r"claude-code-(\d+)\.(\d+)\.(\d+)", p).groups())
    found = sorted(glob.glob(os.path.expanduser("~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude")), key=version)
    must(len(found) > 0, "no Claude Code CLI found under ~/.vscode/extensions (the raters are headless calls of it)")
    return found[-1]


def blind_dir():
    """A new empty folder outside the repo for the raters to run in."""
    path = pathlib.Path(tempfile.mkdtemp(prefix="faultrate-")).resolve()
    repo = slurp.DATA_DIR.resolve().parent
    must(repo not in path.parents and path != repo, "the raters' folder is inside the repo", folder=str(path))
    return path


def median_rating(ratings):
    """(median fault value, the reason of the lowest-numbered rater at it) for
    <ratings>, RATERS triples (rater, faultfrac, reasoning)."""
    must(len(ratings) == RATERS and RATERS % 2 == 1, "an incident's ratings are not RATERS, an odd number", ratings=ratings)
    middle = sorted(value for _rater, value, _reason in ratings)[RATERS // 2]
    return middle, min((rater, reason) for rater, value, reason in ratings if value == middle)[1]


def rate(cli, system, case, folder):
    """One blind rating of <case>: (faultfrac, reasoning, tokens used)."""
    last = ""
    for attempt in range(ATTEMPTS):
        shown = ""
        try:                            # a call that hangs past its timeout is a failed attempt too
            done = subprocess.run([cli, *cli_args(system)], input=case, capture_output=True, text=True, cwd=folder, timeout=900)
            shown = f"; stdout {done.stdout[:300]!r}; stderr {done.stderr[:300]!r}"
            result = json.loads(done.stdout)
            answer = result["structured_output"]
            value, reason = float(answer["faultfrac"]), answer["reasoning"].strip()
            on_grid = 0 <= value <= 1 and abs(value * slurp.FAULT_GRID - round(value * slurp.FAULT_GRID)) < 1e-9
            assert on_grid, f"faultfrac {value} is not on the 0.05 grid in 0 to 1"
            assert 1 <= len(reason) <= REASON_MAX, f"a reason of {len(reason)} characters"
            assert ANY_COMPANY_RE.search(reason) is None and MASK_NAME.lower() not in reason.lower(), f"the reason names a company: {reason}"
            tokens = sum(n for key, n in result["usage"].items() if key.endswith("_tokens") and isinstance(n, int))
            return round(value * slurp.FAULT_GRID) / slurp.FAULT_GRID, reason, tokens
        except Exception as error:      # a failed call or an answer outside the rules: ask again, a fresh rating
            last = f"{type(error).__name__}: {str(error)[:300]}{shown}"
            time.sleep(5 * (attempt + 1))
    must(False, "a rater call failed ATTEMPTS times", attempts=ATTEMPTS, last=last, case=case[:300])


def incident_rows():
    """{Report ID: (the report's NHTSA row, the second AV's quote or "")} for
    every in-scope incident of the analysis window: the incidents slurp counts,
    read from the newest snapshots as slurp's fault stop reads them."""
    filed = slurp.filed_incident_rows(slurp.newest_snapshot_rows())
    incidents = list(slurp.public_service_incidents(filed).values())
    incidents += slurp.second_involvement_rows(incidents).values()
    window = slurp.unrated_reports(incidents, slurp.parse_vmt_months(slurp.read_vmt_master()), set())
    suffix = slurp.SECOND_INVOLVEMENT_SUFFIX
    quote = lambda rid: slurp.SECOND_INVOLVEMENTS[rid[:-len(suffix)]]["quote"] if rid.endswith(suffix) else ""
    rows = {row["Report ID"]: (row, quote(row["Report ID"])) for row in window}
    must(len(rows) == len(window), "two in-scope rows share a Report ID")
    return rows


def id_order(rid):
    """Sort key: Report IDs by their numbers, a second AV after its report."""
    return [int(part) if part.isdigit() else part for part in rid.split("-")]


def read_ratings():
    if not RATINGS.exists():
        return []
    with open(RATINGS, newline="") as f:
        reader = csv.DictReader(f)
        must(reader.fieldnames == RATING_FIELDS, "data/fault-ratings.csv header mismatch", header=reader.fieldnames, expected=RATING_FIELDS)
        return list(reader)


def write_ratings(ratings):
    with open(RATINGS, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RATING_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(sorted(ratings, key=lambda r: (id_order(r["reportID"]), int(r["rater"]))))


def main():
    criterion = CRITERION.read_text()
    instrument = instrument_id(criterion)
    rows = incident_rows()
    ratings = read_ratings()
    other = sorted({r["instrument"] for r in ratings} - {instrument})
    must(not other,
         "data/fault-ratings.csv holds ratings made by another instrument (the criterion, the model, the effort, "
         "the schema or the case format has changed since): restore what changed, or delete data/fault-ratings.csv "
         "to rate every incident again with the current instrument",
         current=instrument, onFile=other)
    gone = sorted({r["reportID"] for r in ratings} - set(rows), key=id_order)
    must(not gone,
         "data/fault-ratings.csv holds ratings for reports that are no longer in-scope incidents (a later filing "
         "re-coded or retired the report, or a re-filing replaced it): find out why from the newest snapshot, then "
         "delete those ratings and the report's data/faultfrac.csv row (data/README.md, Each NHTSA release, step 5)",
         reports=gone)
    have = {(r["reportID"], int(r["rater"])) for r in ratings}
    must(len(have) == len(ratings), "data/fault-ratings.csv holds a rater's rating of a report twice")
    jobs = [(rid, rater) for rid in sorted(rows, key=id_order) for rater in range(1, RATERS + 1) if (rid, rater) not in have]
    print(f"instrument {instrument}: {MODEL}, {EFFORT} effort, {RATERS} raters; {len(rows)} in-scope incidents, "
          f"{len(ratings)} ratings on file, {len(jobs)} to make")

    if jobs:
        cli, folder = cli_path(), blind_dir()
        print(f"  raters: {cli}\n  in the empty folder {folder}")
        write_ratings(ratings)                       # the header, and the rows in order, before appending
        lock, started, tokens = threading.Lock(), time.time(), 0

        def job(pair):
            rid, rater = pair
            row, quote = rows[rid]
            value, reason, used = rate(cli, criterion, case_text(row, quote), folder)
            rating = {"reportID": rid, "rater": rater, "faultfrac": f"{value:g}", "reasoning": reason, "instrument": instrument}
            with lock:                               # saved as it arrives, so a stopped run resumes
                with open(RATINGS, "a", newline="") as f:
                    csv.DictWriter(f, fieldnames=RATING_FIELDS, lineterminator="\n").writerow(rating)
            return rating, used

        pool = concurrent.futures.ThreadPoolExecutor(WORKERS)
        try:
            for count, (rating, used) in enumerate(pool.map(job, jobs), 1):
                ratings.append(rating)
                tokens += used
                if count % 100 == 0 or count == len(jobs):
                    print(f"  {count} of {len(jobs)} ratings, {round(time.time() - started)} s, {tokens:,} tokens", flush=True)
        finally:
            # A rating that fails ATTEMPTS times stops the run: the calls not yet
            # started are dropped (the ones in flight finish and are saved), so
            # a run that cannot go on, as past a usage limit, ends in a minute
            # and not after every queued call has failed in turn.
            pool.shutdown(wait=True, cancel_futures=True)
        must(not os.listdir(folder), "the raters' folder is no longer empty", folder=str(folder), holds=os.listdir(folder))
        os.rmdir(folder)
        write_ratings(ratings)

    by_report = {}
    for r in ratings:
        by_report.setdefault(r["reportID"], []).append((int(r["rater"]), float(r["faultfrac"]), r["reasoning"]))
    fault_rows = []
    for rid in sorted(rows, key=id_order):
        value, reason = median_rating(by_report[rid])
        fault_rows.append({**slurp.fault_master_row(rows[rid][0]), "faultfrac": f"{value:g}", "reasoning": reason})
    with open(slurp.FAULT_INPUT, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=slurp.FAULT_CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(fault_rows)
    print(f"wrote {slurp.relpath(slurp.FAULT_INPUT)}: {len(fault_rows)} rows, each the median of its {RATERS} ratings in {slurp.relpath(RATINGS)}")


if __name__ == "__main__":
    main()

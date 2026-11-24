[AI wrote this file]

# Data Sources

This repo has two different kinds of NHTSA CSV data:

1. Live source-of-truth inputs used by `data/slurp.py`
2. Checked-in archival snapshots kept in the repo for reference

## What `data/slurp.py` actually reads

`data/slurp.py` does not read `data/snapshots/nhtsa-2025-jun-dec.csv` or
`data/snapshots/nhtsa-2025-jun-2026-jan.csv`.

When you run `python3 data/slurp.py`, it fetches:

- The current ADS incident CSV from NHTSA
- The archive ADS incident CSV from NHTSA
- The current Level 2 (ADAS) and OTHER incident CSVs from NHTSA, of which it
  reads only the reports an ADS drove (`MISFILED_ADS_REPORTS`, below)

and it reads, from `data/snapshots`, the newest copy of Tesla's own list of
the crashes it has reported to NHTSA (`tesla-list-YYYYMMDD.xlsx`; see
"Preprints" below). That file is not fetched by a run: its address changes
with each list Tesla posts, and the page that links it refuses scripts, so a
person saves each new list ("Each NHTSA release", step 7). At the end of a run
in a terminal it also saves, in `data/snapshots`, Robotaxi Tracker's camera
table, which a person copies from the page in a browser once they answer the
step's first question (the camera step, after `main()`). Slurp writes nothing
from it: Tesla's camera-estimated rows in `data/vmt.csv` are redone from it
("Ghost months" below, the Tesla bullet), and the quals read the newest saved
table.

The live URLs are defined in `data/slurp.py` as:

- `NHTSA_ADS_CSV_URL`
- `NHTSA_ADS_ARCHIVE_URL`
- `NHTSA_ADAS_CSV_URL`
- `NHTSA_OTHER_CSV_URL`

NHTSA files each report by its latest version's "Automation System Engaged?"
(ADS, Level 2 ADAS, or not reported: the OTHER file; NHTSA's SGO page,
https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting,
read 2026-10-31), so a crash an ADS drove lands outside the ADS file when its
company codes that field wrong. One has: Waymo 30270-14303 (San Francisco,
MAR-2026, a stopped Waymo whose passenger opened a door into a passing car)
is coded "ADAS" though its narrative says "the Waymo AV's Level 4 ADS was
engaged in autonomous mode", so until 2026-10-31 it was the one report on
Waymo's own crash list (Safety Impact hub CSV2, data through Jun 2026) that
the page lacked. Since then (decision of 2026-10-31, open question 1) slurp
reads `MISFILED_ADS_REPORTS`' rows from those files with the ADS files' rows
(its contact areas moved to their true labels as in the current ADS file:
the ADAS file is rotated the same way), and stops on any other Waymo, Tesla
or Zoox report in them filed "None", "Remote (Commercial / Test)", "Other,
see Narrative" or "Unknown" until it is listed there or in
`NON_ADS_FILE_EXCLUDED` (13781-11293, a Tesla employee's loaner on Level 2 in
Georgia), and on a listed report that leaves its file, appears in the ADS
file too, or is re-filed with other values (`quals/misfiled-reports.qual.mjs`).
The ADAS and OTHER archives (2021-2025, closed since June 2025) are not read:
a 2026-10-31 sweep of them found no report a Waymo, Tesla or Zoox ADS drove.

NHTSA's canonical SGO page labels each release "through `<date>`": reports
received through that date, which is the 15th of the month before the
release, rolled forward to the next business day when the 15th falls on a
weekend or federal holiday (e.g. "through August 17, 2026" for the Sep 15,
2026 release; `quals/nhtsa-cutoff-date.qual.mjs` pins the rule). Each
release's newest incident month holds almost only five-day-track filings
(the Feb-2026 release's January also held four early Tesla Monthly filings)
and grows ~6x in the next release. That page blocks scripted fetches, so `NHTSA_DATA_THROUGH_DATE` in `slurp.py`
records the reviewed cutoff — one edit per release — and content asserts
guard it: the cutoff month must be the newest incident month and the newest
submission month (early Monthly filings inside that month are legitimate).
The CSV's HTTP headers and bytes are deliberately not pinned (a correction
must not break ingestion; the Aug 27, 2026 re-publish replaced one wrong
Stack AV narrative, 34952-11803 v1, and changed nothing else).

Reports received through the cutoff cover only crashes from the first part
of the data-through month (the five-day clock runs from the company's notice,
plus processing, and Monthly reports are due the 15th of the next month), so
that month is only partly reported. Since 2026-11-21 no share of it is
estimated (the human: "maximum conservativeness, don't show things when they
involve arbitrary guesses"; "if we know when a helmer's crash reports end then
we compute the exact VMT for the crashes. if not, we don't try to guess"). A
line's month at or before the data-through month enters the rates only when

- NHTSA's file is complete for the line's company and month: the month is
  before the data-through month and outside the company's Monthly-report lag
  (below). Its row of `data/vmt.js` is complete: its six coverage columns
  are 1 and its incidents run through NHTSA's receipt cutoff; or
- the company's own dated list covers it ("Preprints" below): the row counts
  the list's crashes through its date over the miles driven through that
  date.

Every other line-month at or before the data-through month is **pending** (a
provisional name): today Waymo's and Zoox's October 2026; in general the
data-through month for a company with no list, and a company's lag months.
A pending line-month's `data/vmt.csv` row goes with the ghost months in
`data/vmt.js`'s second segment ("Ghost months" below): the VMT charts draw it
faded, and no rate, card, verdict or table reads it. Its in-scope incidents
are validated, reviewed and fault-rated as every incident is, and go in a
second array of `data/incidents.js`, `PENDING_INCIDENT_DATA` (the record
shape of `INCIDENT_DATA`), which the incident browser lists, grayed and
labeled, and nothing counts. A crash of a list-covered month that the list
lacks is pending too. `month_sources()` and `record_counted()` in `slurp.py`
hold the rule; `quals/pending-months.qual.mjs` checks the two data files
against a recount of the newest snapshots and runs synthetic releases.

The first case rests on two premises about when a month's reports reach
NHTSA's file. A month's five-day-track reports are all in by its second
release: in the saved releases a month's in-scope five-day-track count has
not grown after its second release (Dec 2025 13 at its first release, 55
from its second on; Jan 2026 21, 63; Feb 19, 38; Apr 3, 58; May 16, 58; Jun
17, 61; Jul 12, 58; Aug 10, 48; Sep 7, 61 so far), except March 2026 (25,
53, then 72), whose second release, May 15, was truncated.
`quals/assumptions-list.qual.mjs` recounts this from `data/snapshots` at
every release (the assumptions entry `reporting-five-day`; "Each NHTSA
release", step 2). And its Monthly-track reports arrive by that same release
unless the company's lag says otherwise (next paragraph). A release cut
short as May 15's was, or a Monthly batch that arrives partly late (Waymo's
August 2026: 23 of 43 a release late; AGENTS.md, open question 36), still
leaves a month counted short for one release, and no range carries that.

Until 2026-11-21 the data-through month counted too, at an estimated share
of its miles: a receipt coverage (the release's in-scope five-day-track
incidents of the month over the count expected at each company's rate in an
earlier month, pooled, with a high edge of 0.52; before 2026-10-31 the
median of earlier months' first-release shares), and for Monthly-track
metrics a pooled incident coverage on top; a lagged company's lagged months
counted at its 5-Day share of incidents. Over nine first releases what
eventually arrived ran from 0.70 to 1.68 times the five-day estimate
(AGENTS.md ledger, 2026-11-20 (later 6)), and the human dropped it. The
tables and functions it used are gone from `slurp.py`
(`FIVE_DAY_RECEIPT_OBSERVATIONS`, `RECEIPT_MONTHS_EXCLUDED`,
`FIVE_DAY_RECEIPT_COVERAGE_MAX`, `FIVE_DAY_SHARE_OBSERVATIONS`,
`release_month_coverage()`, `pooled_reference_rate()`, `incident_coverage()`,
`row_coverage()`, `check_list_covered_rows()`).

Monthly-track (SGO Request No. 2) reports for a month are due by the 15th of
the next, so they normally reach the file at the month's second release, and
the month is complete from then on. Some companies' arrive
later: every in-scope Zoox Monthly-track report of January-July 2026 arrived
one release after that, so in the Sep 15, 2026 file Zoox's July held only its
one 5-Day report. `MONTHLY_ARRIVAL_LAG` in `slurp.py` is each company's extra
lag in releases, next to the observations it is measured from
(`MONTHLY_ARRIVAL_OBSERVATIONS`: per company and incident month, the
in-scope Monthly-track incidents by the release at which they first
appeared). Every lag has been 0 since the Oct 15, 2026 file (Zoox's was 1
before), which held Zoox's three August reports and seven of Tesla's eight
but only 20 of Waymo's 43: the other 23, and Tesla's eighth, arrived a
release late (AGENTS.md, open question 36). A lag is read from the majority
of the company's newest observed month, and at the Nov 16, 2026 release that
month was September, whose Monthly reports had arrived (62 of Waymo's), so
Waymo's lag stayed 0. The months inside a company's lag are pending for its lines, as
the data-through month is (until 2026-11-21 they counted, with a
Monthly-track incident coverage equal to the company's in-scope 5-Day
share). The same table gives a list-covered month its allowance for crashes
the list lacks: the share of the list's company's Monthly reports that
arrived on time ("Preprints" below). The run stops if a lagged company's lagged month
already holds a Monthly-track report (it means the lag itself is wrong), if
the table disagrees with the newest file,
if a month that has become measurable has no observation, or if its row
holds its on-time count alone (since 2026-11-21: a row takes its second
count, the reports that arrived a release late, at the month's third
release, and no sooner)
(`check_monthly_arrivals()`).
`quals/monthly-arrival-lag.qual.mjs` re-measures the table from
`data/snapshots` (its embedded script is the measurement recipe).

It also reads two local input files:

- `data/vmt.csv` — the in-repo VMT master (see "VMT master" below)
- `data/faultfrac.csv` — the fault values, which `data/faultrate.py` writes from the
  blind raters' ratings in `data/fault-ratings.csv` ("Each NHTSA release", step 5)

The slurp pipeline is:

1. Fetch the current + archive ADS CSVs and the current ADAS and OTHER CSVs
   directly from NHTSA, saving each one that differs from its newest
   snapshot to `data/snapshots` before any is parsed (the only files a run
   that stops writes: the fault batch and the reviews read the release
   there)
2. Normalize archive-only column-name differences, and move the current
   file's contact-area values from their rotated published labels to their
   true ones (`CURRENT_FILE_CONTACT_LABEL`; the run stops if narratives that
   name a contact area stop agreeing with the moved values —
   `quals/contact-labels.qual.mjs`); add the `MISFILED_ADS_REPORTS` rows of
   the ADAS and OTHER files, moved the same way, after checking those files
   for any other Waymo, Tesla or Zoox report an ADS could have driven
   (above). Then the preprints join NHTSA's rows: the rows of Tesla's own
   list (`PREPRINT_LIST`, read from its newest snapshot) whose Report ID no
   NHTSA file holds, mapped onto NHTSA's columns (`list_rows()`,
   `preprint_rows()`; "Preprints" below). They take every step from here on
   as NHTSA's rows do, except that the Monthly-report arrival counts (step
   8) read NHTSA's rows only
3. Validate every row against the whitelists (report type, operator type,
   reporting entity, severity, Roadway Type, date formats; the Roadway Type
   one, `ROADWAY_CLASS`, also gives each value its class, a road or a parking
   facility: step 12 and "Each NHTSA release", step 6), the per-helmer operator scope
   (every helmer row must file a counted or an excluded type), the
   teleoperator narrative tripwire, the safety-driver narrative tripwire
   (`check_safety_driver_classified`: a Waymo or Zoox narrative that puts a
   human in the driver's seat) and the second-AV narrative tripwire
   (`check_second_av_classified`, step 5); any surprise stops the run. The
   rows that file no crash are skipped by their Report Type
   (`NEGATIVE_FILING_TYPES`: "No New or Updated Incident Reports", in older
   files "Monthly - No Incident"); a Waymo, Tesla or Zoox crash report with a
   blank Same Incident ID or Incident Date stops the run, and another
   company's is skipped (never in scope). Until 2026-10-31 every row with
   either field blank was skipped, which would have dropped such a helmer
   report without a word (`quals/negative-filings.qual.mjs`)
4. Deduplicate by `Report ID` over every filed row, keeping the highest
   `Report Version` (a report's `Same Incident ID` can change between
   versions, and a later version can retire a report from scope)
5. Filter the surviving versions to the operator modes whose miles are in each company's VMT denominator (`PUBLIC_SERVICE_OPERATOR_TYPES` / `EXCLUDED_OPERATOR_TYPES` in `slurp.py`: `"None"` and `"Remote (Commercial / Test)"` for all three, plus `"In-Vehicle (Commercial / Test)"` for Tesla, whose deck miles include monitor-aboard miles; Waymo/Zoox safety-driver modes are excluded because their miles are not in those denominators; `"Other, see Narrative"` is classified per report via `OPERATOR_TYPE_OVERRIDE`), drop crashes in which a remote human was driving (`TELEOP_DRIVEN_REPORTS`, guarded by a narrative tripwire) and reports a re-filing under a new Report ID replaced (`SUPERSEDED_REPORTS`; only from rows that hold the re-filing, so an earlier release's snapshot, from before it, keeps the original when the quals recount it), then keep one report per `Same Incident ID`. Two in-scope reports under one Same Incident ID stop the run, and so does a helmer's out-of-scope filing under an in-scope report's Same Incident ID (a re-filing that may have moved the crash out of scope), until `SUPERSEDED_REPORTS` says which report stands or `SPLIT_SAME_INCIDENT_REPORTS` lists one as another crash or vehicle (since 2026-10-31; until then the higher `Report Version` won, though different Report IDs' versions share no scale). Other reporting entities' filings are never in scope, so a duplicate one files (Transdev, Waymo's fleet operator) can neither displace nor retire a helmer's report (`quals/same-incident-dedup.qual.mjs`). Then each crash one report files for two of a helmer's AVs gets a record for the second AV (`SECOND_INVOLVEMENTS`, since 2026-10-31; decision #47 of 2026-10-04: each AV involved counts, as in the crashed-vehicle human benchmarks and Waymo's own crash list, hub CSV2, which lists each such report twice but 30270-11224, counted since 2026-11-02 though the hub lists it once, since every AV a narrative shows struck counts, the human's answer to open question 19; two AVs that each filed a report, as in Atlanta in August 2026, already counted twice): the report's crash-level fields and their overrides (severity, airbag, place, vehicles involved), the second AV's own speed, movements, crash partner, passengers and contact areas as the narrative gives them, the Report ID + "-B", `secondOf` naming the report (the incident browser marks the row), and a fault row of its own. A narrative that names a second AV of its company (`SECOND_AV_PATTERN`) stops the run until the report is in `SECOND_INVOLVEMENTS` or in `SECOND_AV_REVIEWED` with the reason (`quals/second-involvements.qual.mjs`). The Monthly-report arrival counts read the reports, since they measure when reports arrive
6. Read the VMT master from `data/vmt.csv`: an incident month newer than its
   newest month stops the run, and so does a missing ghost month (see "Ghost
   months" below): at least the month after the data-through month, a row
   for every line in each, and none for a month that has not begun
7. Load the fault fractions from `data/faultfrac.csv`, checking their values
   (0-1, on the 0.05 grid) and that every row is still an in-scope incident;
   the file's six mirrored columns are synced from the NHTSA rows only in the
   last step
8. Verify the reviewed data-through cutoff against the CSV contents (the
   newest incident month and newest submission month must both equal it:
   `check_data_through_month()`), check the Monthly-report arrival table
   against the release (`check_monthly_arrivals()`; see above), and decide
   which line-months count (`month_sources()`, above): complete, covered by
   the company list, or pending. The run stops on a list dated in a month
   after the data-through month, and on a line with a pending month before a
   month that counts (a lag month before a list-covered one): neither has a
   rule ("Each NHTSA release", steps 3 and 7)
9. Apply narrative-verified field overrides from `slurp.py`, each keyed by
   Report ID (severity, airbag, city and state — see
   `quals/field-overrides.qual.mjs` for the pins;
   vehicles-involved — see `quals/fatality-guard.qual.mjs`, and
   `quals/vehicles-involved.qual.mjs` for the nonfatal counts a narrative
   states; passenger
   presence (`PASSENGER_OVERRIDE`): every Tesla report, since Tesla's filings
   conflate a rider with its in-car safety monitor, and any Waymo or Zoox
   report whose narrative contradicts its filed code — see
   `quals/passenger-classification.qual.mjs`; the dict comments carry each
   row's justification; a second AV's record takes its report's severity,
   airbag, place and vehicles-involved overrides). An override corrects only
   a field its own narrative flatly contradicts (the 2026-08-22 convention):
   Roadway Type, for one, is taken as filed, since none is so contradicted —
   13781-11784's "Intersection" is literally true of the aisle junction in
   the parking lot its narrative describes (decision of 2026-10-30, on the
   audit's finding that it counts in Tesla's non-parking-lot metric); the
   filed value's class, a road or a parking facility, comes from the one
   reviewed table of them (`ROADWAY_CLASS`, since 2026-11-21).
   A filed city is such a field where the narrative's opening names another
   place and Waymo's own crash list gives an address there: six Waymo
   reports filed "Los Angeles" whose narratives open "operating in West
   Hollywood, California" are stored as West Hollywood (30270-9763 since
   2026-10-04; 30270-13369, -13556, -13550, -14586 and -15285 since
   2026-11-21, audit finding A39, which read the list's addresses). No rate
   reads the city; the sanity section's Geography table does.
   NHTSA's field plus the report's own narrative is the one rule for every
   company's airbag and severity values (the human, 2026-11-21: "agreed.
   consistently respect the NHTSA data"): Waymo's own crash list (its Safety
   Impact hub's CSV2, column "Is Any Vehicle Airbag Deployment") is not a
   source for them. Of 1,970 shared reports the list differs from the stored
   airbag value on 7 (the 2026-11-20 audit, A8): list yes, field no on
   30270-10833, -13303, -13955, -14496 and -14977, none of whose narratives
   mentions an airbag; list no on 30270-11450, whose field and narrative both
   report one, and on 30270-6542, an `AIRBAG_OVERRIDE` entry. Tesla and Zoox
   publish no such list, and Waymo's contradicts its own filings in both
   directions; adopting it would have lowered Waymo's default-window airbag
   median 4-7%, the verdict safer either way.
   A hospital transport the narrative states counts whatever its cause
   (since 2026-11-21, the human's choice on audit finding A38): 30270-8940,
   filed "No Injuries Reported", whose other driver "was experiencing a
   medical emergency and was transported from the scene in an ambulance", is
   stored as "Minor W/ Hospitalization", as the human benchmark counts anyone
   transported; counting it applies that one rule again, where leaving it out
   would add a second, about why a person was taken. Then
   strip the narratives' fact-free filing boilerplate
   (`quals/narrative-boilerplate.qual.mjs`), join in the fault fractions,
   and list the lines each incident counts toward (`series`: its company, and
   Tesla's no-monitor line for a report on Tesla's no-monitor list or, newer
   than that list, reviewed as one, `TESLA_NO_MONITOR_ADDITIONS`; see
   "Tesla's no-monitor line" below).
   A filed severity, airbag, city, state or passenger value that no longer
   matches the one its override was reviewed against (the passenger stop
   lists every such entry at once, before any record is built:
   `check_passenger_reviews()`, since 2026-11-21), an in-scope incident
   left with severity "Unknown" (the app counts it as no injury), an incident
   left with no city or state, an in-scope incident with a blank severity or
   narrative, or with a speed that is neither blank nor a whole number of
   miles per hour (`quals/record-fields.qual.mjs`; since 2026-11-21, audit
   finding A23: the page refuses a record with no severity, a blank narrative
   passes every narrative review unread, and until then a speed such as
   "0.0" was stored as no speed, which the page counts as moving; a blank
   speed is still stored as none, as 30270-5114's and 30270-7938's are), an
   override entry that names no in-scope
   incident of the window (`quals/override-guards.qual.mjs`), an in-scope
   Tesla report with no reviewed passenger entry, a passenger entry for a
   report no longer in scope, a filed passenger code that crashla.js's three
   passenger classes do not list (`PAX_CLASS`), a narrative that says who
   was aboard the AV ("An occupied Zoox autonomous vehicle", "unoccupied",
   "had no occupants", and since 2026-11-21 a rider "not belted", "unbelted"
   or "not wearing a seat belt") against its filed passenger code, unreviewed
   (the narrative read is the crash's own report's: a second AV's record
   carries that narrative under its own reviewed passenger code), or a
   narrative that mentions an airbag while the filed field marks no
   deployment, unreviewed (`check_airbag_classified()`, since 2026-11-21,
   audit finding A7; `quals/airbag-tripwire.qual.mjs`), stops the
   run, as do an in-scope Tesla report from January 2026 on that is neither on
   Tesla's latest list nor in a reviewed monitor table, a monitor table's entry
   that names no such report, a reviewed report whose narrative fails the
   narrative test (an addition's names a safety monitor, a monitor-aboard
   report's names none), an addition whose receipt cutoff is after the
   release's own or before its first filing's month, a no-monitor addition
   that Tesla's latest list should hold (one Tesla had filed by the list's
   date; all of these "Each NHTSA release", step 7), and an incident on a line
   with no `data/vmt.csv` row for its month. Every check of this step and the
   next reads the pending incidents as it reads the counted ones. No SGO field counts the vehicles, so
   each `VEHICLES_INVOLVED` entry is (the count, the narrative's words that
   give it), and a re-filing whose narrative no longer holds those words
   stops the run for a re-count, as it does for the words the narrative
   reviews of checklist step 6 quote (since 2026-11-02; until then vehicles
   involved had nothing to re-check). The count is the narrative's own, a
   floor where it says "at least", and none is taken from outside NHTSA's
   data, since outside reporting reaches some crashes more than others (the
   human, 2026-11-21): for the January 2025 San Francisco fatal crash,
   30270-9724, the narrative gives 6 vehicles and firefighters, by CBS San
   Francisco, KTVU and ABC7, 7 (1/6 of a death against 1/7)
10. Stop on any in-scope incident of the window with no `data/faultfrac.csv`
    row (a second AV's record, Report ID + "-B", included), listing them all
    (since 2026-10-31, decision #4: until then an
    unrated incident was written with fault null, and the app drops its whole
    month, miles included, from every at-fault number;
    `quals/fault-batch-stop.qual.mjs`)
11. Split the incidents (`record_counted()`): one counts when every line it
    names counts its month, from NHTSA's file (a complete month) or from the
    company list (a list-covered month, and then only a crash on the list);
    every other one is pending. A record counted on one of its lines and
    pending on another stops the run. And give each analysis row its coverage
    (`build_vmt_csv()`): the generated CSV in `data/vmt.js` carries six
    coverage columns after `vmt_max` (`coverage`, `coverage_min`,
    `coverage_max`, the share of the row's miles its source covers, and
    `incident_coverage`, `_min`, `_max`, the share of that span's
    Monthly-track crashes the source is taken to hold) and a seventh,
    `incidents_through`, the date the row's incidents run through. A complete
    row has 1 in all six and NHTSA's receipt cutoff; a list-covered row has
    the list's coverage and date (`preprint_coverage()`; "Preprints" below).
    A pending line-month has no row there
12. Every check has passed: write `data/faultfrac.csv`'s six mirrored columns
    (see "Fault CSV synchronization" below), the counted incidents and the
    pending ones into `data/incidents.js` (`INCIDENT_DATA`,
    `PENDING_INCIDENT_DATA`) with each Roadway Type's class (`ROADWAY_CLASS`,
    the page's copy of slurp's table: `crashla.js` counts a moving crash in
    the nonstationary non-parking-lot metric when its road type's class is a
    road, and refuses a record whose type the table lacks;
    `quals/roadway-class.qual.mjs`), and the VMT CSV text into `data/vmt.js`, with
    the pending line-months' and the ghost months' master rows, as they
    stand, in its second segment
    (`GHOST_VMT_CSV_TEXT`). A run that stops writes none of the three (until
    2026-10-31 `data/faultfrac.csv` was synced before most checks)
13. After `main()`, never inside it (the quals run `main()`): the camera
    step, `camera_table_step()` ("Ghost months" below, the Tesla bullet). In
    a terminal it asks first, then opens Robotaxi Tracker's camera page in
    the person's own browser and saves the table they copy, when it differs
    from the newest saved one and no table is saved for that day or a later
    one; when stdin or stdout is not a terminal (an agent's or a script's
    run) it opens, reads and writes nothing and prints how a person saves
    the table. Its stops come after step 12's writes and leave only the
    camera table unsaved

## Each NHTSA release

`slurp.py` stops until these are done. A stop that a release's rows, a new
list of Tesla's, a row added to `data/vmt.csv` or an entry of the arrival
table can bring names, in its message, the step below that covers it
(`quals/release-stops.qual.mjs` reads every `must()` call of `slurp.py` and
goes red on one that names no step outside the functions it lists; since
2026-11-21, audit finding A55: until then this paragraph said that each stop
names its step, and 76 of the 145 did not, among them the forms of a list's
dates, speeds, weather values and contact areas, a preprint dated after the
data-through month and the date forms of NHTSA's rows). The stops that name
none are about the form of what a person or the code wrote, which no step
covers: a reviewed table's own form, checked when `slurp.py` loads (an entry
of the wrong shape, a report in two tables that exclude each other); a file
that is not in its own form (the archive file's columns, the header of
`data/vmt.csv` or of `data/faultfrac.csv`, a fault row that is no number, a
fetched file with no rows); the code's own bookkeeping; and the camera
step's, which step 8 describes. A run that stops writes only the release's snapshots (pipeline step
1; a stop in the camera step, which runs after `main()`, comes after step 12's
writes and leaves only the camera table unsaved), so re-run it after each
step. The first four are the constants every release needs:

1. `NHTSA_DATA_THROUGH_DATE`: the new release's cutoff.
2. No constant since 2026-11-21 (the number stays, so that the steps below
   keep theirs, which `slurp.py`'s stops, the quals and this file cite).
   Until then this step entered `FIVE_DAY_RECEIPT_OBSERVATIONS`, the
   first-release shares behind the estimate of the data-through month's
   coverage, which the human dropped (above). What is measured here now is
   the premise the new rule rests on, and a qual measures it, not `slurp.py`:
   `quals/assumptions-list.qual.mjs` recounts from `data/snapshots`, for
   every month with a saved second release, the in-scope five-day-track
   incidents whose first filing that second release lacked, and goes red
   when a month other than those its entry `reporting-five-day` names has
   one. Then that month was counted short for a release: update the entry
   and tell the human (a late five-day report has no rule, as a late
   Monthly batch has the lag of step 3).
3. The Monthly-report arrival table: each company's
   `MONTHLY_ARRIVAL_OBSERVATIONS` row for the
   month whose third release this is (data-through month - 2), and a check that
   `MONTHLY_ARRIVAL_LAG` still matches each company's newest observed month.
   It matters more since 2026-11-21: the table and the lag decide which
   months count at all (a month inside a company's lag is pending for its
   lines, where it used to count at an estimated share), and the table's
   on-time share is the allowance of a list-covered month (step 7). If a lagged
   company's Monthly reports start arriving on time, the run stops on its
   lagged month: record that month's on-time count as its observation (for
   every company, since the rows cover the same months) and set the lag. On
   the Oct 15, 2026 release Tesla's July tie (one report on time, one late)
   read as a lag of 1, but seven August reports of its own and Zoox's three
   had arrived, so 2026-08 entered early and every lag went to 0 (an eighth
   Tesla report and 23 of Waymo's 43 came a release late). A row entered
   early holds on-time counts only: re-measure it, late column included, at
   the month's third release, where `slurp.py` stops on a row that still
   lacks its second count (since 2026-11-21; a 0 where no report arrived
   late). The 2026-09 rows, entered early at the Nov 16, 2026 release as
   (62,), (3,) and (10,), take theirs at the December 2026 release; a second
   count entered before a month's third release stops the run too. A lag for a company
   whose own list covers the data-through month stops the run (a pending
   month would sit before a counted one, which has no rule): ask the human.
4. `data/vmt.csv`: every line's row for the month after the new
   data-through month, its ghost month (see "Ghost months" below; the month
   in progress on release day), and a re-read of the previous ghost month's
   rows, which become the new data-through month's (pending, unless a list
   covers the month) and of the rows of the month before it, which enter the
   rates now. A release can also bring a late Waymo report of July, August
   or September 2026, whose counts by metro split San Diego's miles out of
   Waymo's rows from July on ("Waymo anchors"): `quals/waymo-vmt-model.qual.mjs`
   recounts them from the regenerated `data/incidents.js` and goes red on a
   changed count or an unlisted place, until the split and the rows it moves
   are redone. The run also stops on an
   incident month newer than the master's newest month, and on an incident
   on a line with no row for its month (a new month with no `teslanomonitor`
   row).

Then what the release brings:

5. `data/faultfrac.csv`, the fault batch: a row for every new in-scope
   incident. slurp stops and lists the unrated Report IDs (since 2026-10-31,
   decision #4). Then

   ```bash
   python3 data/faultrate.py
   ```

   rates every in-scope incident that lacks ratings and writes
   `data/faultfrac.csv` (since 2026-11-17; the human, 2026-11-16: "a simple,
   repeatable method for getting faultfracs from blind sub-agents with known
   parameters"). A rater is one headless model call (`MODEL` and `EFFORT` in
   `faultrate.py`) that gets `data/fault-criterion.md` as its whole system
   prompt and one report: its month, time and road type, the other party's
   type (NHTSA's "Crash With": an SUV, a pole or tree), each party's
   movement and contact area, the AV's speed at contact, and the narrative
   with the company's name replaced. It runs in an empty folder outside the
   repo with no tools. Three raters rate each incident. Every rating is kept
   in `data/fault-ratings.csv`; an incident's fault value is the median of
   its three, and its reasoning is the median rater's line (at most 80
   characters, which the output schema enforces). Nobody edits a value. A
   second AV's case (Report ID + "-B") carries that AV's own fields and
   quotes the narrative's sentence that names it. The script reads the
   filings from the newest snapshot, which the stopped slurp run has saved,
   and a stopped rating run resumes.

   Each rating carries the id of the instrument that made it: the
   criterion's text, the model, the effort, the output schema and the case
   format together. After a change to any of them `faultrate.py` stops until
   `data/fault-ratings.csv` is deleted, and then rates every incident again
   (about 35M tokens: the full run of 2026-11-17 used 35,364,400 for 2,392
   incidents, 4,928 a rating), so one method covers every row
   (`quals/fault-ratings.qual.mjs`).

   Each rating also carries the id of the case it was made from, a hash of
   the text the rater read (`case_id()`, since 2026-11-18). Any character
   changed changes the id, but whitespace does not (every run of it counts
   as one space) and neither does how a character is encoded (the text is
   hashed in Unicode normal form C). A report whose
   case has changed since it was rated, by an NHTSA update to its filing or
   by NHTSA's row taking a preprint's place (step 7), is rated again: the
   run drops its old ratings and makes three new ones, and names those
   reports before it starts (about 15k tokens a report). A change to how
   `slurp.py` builds rows (a field moved under another label, say) changes
   many cases at once and so re-rates many reports. Run `faultrate.py` at
   every release: with nothing new or changed it rates nothing and rewrites
   `data/faultfrac.csv` from the ratings on file; `quals/fault-ratings.qual.mjs` goes red
   on a rating of a case that is no longer the report's.

   Both scripts stop on a report that is no longer an in-scope incident (a
   later filing re-coded or retired it, or a re-filing replaced it): find
   out why, then delete its ratings and its `data/faultfrac.csv` row, as for
   30270-8403, -14625 and -4881. A fault value off the 0.05 grid, or outside
   0-1, stops slurp too.
6. The narrative reviews, each a table in `slurp.py` with the narrative's own
   words beside its entry (`TELEOP_DRIVEN_REPORTS`,
   `REMOTE_LANGUAGE_ADS_DRIVEN`, `SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN`,
   `OCCUPANCY_LANGUAGE_REVIEWED`, `AIRBAG_LANGUAGE_REVIEWED` and
   `VEHICLES_INVOLVED` store those words
   verbatim, and a re-filing whose narrative no longer holds them stops the
   run until the entry is re-read: since 2026-11-02 for all but the first,
   and the airbag table since 2026-11-21):
   a value outside a whitelist (`EXPECTED_*`; a new
   severity also needs `crashla.js`'s `SEVERITY_INFO`), a Roadway Type
   outside `ROADWAY_CLASS` (read the reports that file it and give it its
   class there: `"parking"` for a parking facility, as "Parking Lot" and
   "Parking Garage" have, whose moving crashes stay out of the nonstationary
   non-parking-lot metric, since its human bands cover roadway crashes only;
   `"road"` otherwise, which "Unknown" has too, the cautious reading; since
   2026-11-21, when NHTSA's new "Parking Garage" had entered that metric as
   a road without a word) or an unclassified
   operator mode (`PUBLIC_SERVICE_OPERATOR_TYPES` /
   `EXCLUDED_OPERATOR_TYPES`); the teleoperator, safety-driver and second-AV
   tripwires (`TELEOP_DRIVEN_REPORTS` / `REMOTE_LANGUAGE_ADS_DRIVEN`,
   `OPERATOR_TYPE_OVERRIDE` / `SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN`,
   `SECOND_INVOLVEMENTS` / `SECOND_AV_REVIEWED`: a narrative naming a second
   AV of its company; if that AV was in the collision, its entry gives its
   own fields from the narrative, and step 5 rates its record); a Waymo,
   Tesla or Zoox report in NHTSA's ADAS or OTHER file filed with an operator
   type an ADS could have driven in (`MISFILED_ADS_REPORTS` /
   `NON_ADS_FILE_EXCLUDED`), or a listed one that moved or was re-filed; a
   Waymo, Tesla or Zoox crash report with a blank Same Incident ID or
   Incident Date; two
   in-scope reports, or a helmer's out-of-scope re-filing, under one Same
   Incident ID (`SUPERSEDED_REPORTS` / `SPLIT_SAME_INCIDENT_REPORTS`), and
   an in-scope report whose first filing is of no known track (a re-filing
   under a new Report ID that `SUPERSEDED_REPORTS` does not list yet); an
   in-scope incident filed severity "Unknown" (a `SEVERITY_OVERRIDE` entry
   from its narrative, the 2026-07-15 convention: a hospital transport is
   "Minor W/ Hospitalization", an injury without one "Minor W/O
   Hospitalization", none mentioned "Property Damage. No Injured Reported";
   Tesla's 13781-17203, on Tesla's list as Unknown with the other driver
   taken to a hospital, has its entry since 2026-11-18, as a preprint); an
   in-scope incident with a blank severity (a `SEVERITY_OVERRIDE` entry from
   its narrative, as for an Unknown one) or a blank narrative (no rule: ask
   the human), or with a speed that is neither blank nor a whole number of
   miles per hour (ask the human how to store it; a blank speed is stored as
   none, which the page counts as moving; all three since 2026-11-21); a
   re-filing that changes a
   value an override was reviewed against (severity, airbag, city and state,
   passenger code, operator type: re-read the narrative; the passenger stop
   lists every such entry at once), and an override
   entry that names no in-scope incident of the window; an incident with no
   city or state (`LOCATION_OVERRIDE`); a new in-scope Tesla report
   (`PASSENGER_OVERRIDE`, from its narrative, "Unknown" when the narrative
   says nothing about who was aboard; and, from the same reading, whether a
   safety monitor was aboard, step 7); an occupancy disagreement
   (`PASSENGER_OVERRIDE` / `OCCUPANCY_LANGUAGE_REVIEWED`: a narrative that
   calls the AV occupied or unoccupied, or a rider not belted, against the
   filed passenger code); a narrative that mentions an airbag while the
   filed "Any Air Bags Deployed?" marks no deployment (since 2026-11-21:
   read it; if it says an airbag deployed, in any vehicle, the report takes
   an `AIRBAG_OVERRIDE` entry, as 30270-17130 has, which Waymo reported
   "because a vehicle involved was towed away and because of airbag
   deployment" under a field of "No Subject Vehicle, No Crash Partner" and
   which was stored with no airbag until then; if not, an
   `AIRBAG_LANGUAGE_REVIEWED` entry
   with the words that show the filed value stands, as 13781-11687's
   retraction and 30270-16932's "Airbag deployment and tow status are
   unknown for both vehicles." have); and the
   contact-area label check
   (`CURRENT_FILE_CONTACT_LABEL`).

7. Tesla's list (`PREPRINT_LIST` in `slurp.py`; "Preprints" below). Open
   https://www.tesla.com/robotaxi/safety in a browser (it answers 403 to a
   script) and read its "As of" date and the address of "Download all SGO
   reportable events".
   - A newer list: save it as Tesla serves it,
     `curl -sS -o data/snapshots/tesla-list-YYYYMMDD.xlsx "<address>"` with
     the list's own date in the name; set `PREPRINT_LIST`'s `url`, `through`
     (that date) and `miles` (Tesla's no-monitor miles of that date's month
     through that date, from the safety page's weekly figures, as the
     `teslanomonitor` row of `data/vmt.csv` for that month reads them); and
     bring `TESLA_NO_MONITOR_REPORTS` in line with the list's Report IDs.
     The page's figure takes a second edit, in the one place the quals hold
     it: give `TESLA_PAGE_PART` in `quals/tesla-page-part.mjs` an entry for
     that month with the same date and miles. `quals/preprints.qual.mjs` goes
     red while `PREPRINT_LIST`'s date or miles differ from that entry (since
     2026-11-21, audit finding A17: until then no qual compared the miles
     with a source, so a list moved to a new date with the old miles passed
     them all: in the audit's example, a list through Nov 15 kept at
     October's miles, that month's coverage came out about a fifth low), the
     month's Tesla rows are recomputed from the entry (`quals/tesla-camera-miles.qual.mjs`;
     "Ghost months", the Tesla bullet), and `quals/assumptions-list.qual.mjs`
     goes red until the page's entry `reporting-tesla-list` states the same
     date and miles.
     `slurp.py` stops until the three agree, and on a list it cannot read as
     before (a new column, weather value or contact area), or whose newest
     crash, or whose own date, is after NHTSA's data-through month (ask the
     human: a month only a list covers has no rule yet). A list dated in the
     data-through month covers that month for Tesla's two lines (their rows
     count the list's crashes over its miles; "Preprints" below); a list
     dated earlier covers nothing NHTSA's file does not complete, and the
     data-through month is then pending for Tesla too. It stops too on a list that holds a
     report reviewed when no list held it (next bullet): an entry of
     `TESLA_NO_MONITOR_ADDITIONS` moves into `TESLA_NO_MONITOR_REPORTS` (drop
     the entry; the list now backs it), and one of
     `TESLA_MONITOR_ABOARD_REPORTS` means the list and the narrative disagree
     (re-read it and ask the human). A report the newer list drops (on the
     older list, not on the newer one: the stop names it, `onlyInSet`) is
     Tesla's list changing its mind: read it and ask the human before the
     set follows the list (then the run stops on it as unreviewed, and an
     addition for it stops again whenever Tesla had filed it by the newer
     list's date). Each preprint then needs what any new
     Tesla report needs (step 6: a `PASSENGER_OVERRIDE` entry, its filed
     value blank because the list has no belt field; a `SEVERITY_OVERRIDE`
     entry for a severity of Unknown) and its fault ratings (step 5).
   - A Tesla report the latest list does not hold (since 2026-11-20, audit
     finding A1): NHTSA's release after a list holds Tesla's reports of the
     days after the list's date, and of crashes Tesla filed after drawing
     the list up. Read its narrative, at the same reading as its
     `PASSENGER_OVERRIDE` entry (step 6). Tesla's narratives name a safety
     monitor when one is aboard ("The ADS had a safety monitor present in
     the vehicle with no passengers"): of Tesla's 30 in-scope crashes from
     May to Oct 18, 2026, the one whose narrative names a monitor
     (13781-16672) is the one the list leaves out, and the other 29 are on
     it (`quals/tesla-monitor-review.qual.mjs` holds the narratives to that
     record). If the narrative names a monitor aboard, add the report to
     `TESLA_MONITOR_ABOARD_REPORTS` with those words; if not, to
     `TESLA_NO_MONITOR_ADDITIONS` with its sentence that says who was aboard
     ("The ADS had no riders in the vehicle"), or the whole narrative where
     no sentence says, and this release's `NHTSA_DATA_THROUGH_DATE` (step 1):
     NHTSA's file held the report by that cutoff. The words are copied
     verbatim, and a re-filing whose narrative no longer holds them stops the
     run, as for step 6's tables; so does one whose narrative fails the
     narrative test (an addition's names a safety monitor, a monitor-aboard
     report's names none: move or fix the entry; a narrative that names a
     monitor only to say none was aboard has no rule yet: ask the human). A
     second Tesla robotaxi's record (the Report ID + "-B",
     `SECOND_INVOLVEMENTS`) has no rule yet: ask the human. An addition
     belongs to the no-monitor line until a list holds it (the bullet above);
     it counts once NHTSA's file is complete for its month, and until then,
     in a month the list covers or a pending one, it is pending.
     `slurp.py` stops, listing them all, on an in-scope Tesla report from
     January 2026 on in none of the three tables and on an entry of the two
     that names no such report; on an addition whose cutoff is after this
     release's or before the month of the report's first filing; and on an
     addition Tesla's latest list should hold and does not. A list holds the
     no-monitor crashes Tesla had reported by its date (each row carries its
     filing's Report ID), so it should hold an addition Tesla had filed by
     then: by its entry's cutoff, or by the end of the month of its first
     filing (NHTSA gives a filing's month only). A crash's own month says
     nothing here: Tesla files some crashes late (13781-17193, an Aug 22
     crash, in October), and a list dated before the filing lacks them. On
     that stop, re-read the narrative and ask the human. A crash of the
     month the list covers that the list does not hold, an addition or a
     monitor-aboard report (on the every-mode line), is pending: the list's
     coverage fits the list's own crashes, its miles through its date less
     an allowance for crashes Tesla files late, so no other crash counts
     there until NHTSA's file is complete for the month (since 2026-11-21;
     until then the run stopped on such a row, `check_list_covered_rows()`,
     the case undecided).
   - A preprint that NHTSA's new file now holds: NHTSA's row has taken its
     place. `slurp.py` stops on its `PASSENGER_OVERRIDE` entry, reviewed
     against the list's blank belt field: re-read the narrative against the
     filed code (step 6). One stop lists every such entry with its reviewed
     and its filed value, and its message names this step (since
     2026-11-21, audit finding A46: until then the run stopped on one report
     at a time, which would have meant a run for each of October 2026's eight
     preprints at the release that publishes them, under a message that spoke
     only of a re-filed report). Then run step 5: the report's case has changed
     (the list gives no time and no pre-crash movements, and its narrative
     can differ by a word: 13781-17015's "through a work zone" is "near a
     work zone" in NHTSA's filing), so `faultrate.py` rates it again from
     NHTSA's row.
   - Score the list: among the crashes NHTSA's new file holds for the days
     the list covered, count those the list lacked, and record the count in
     the ledger (`preprint_coverage()` assumes about one Monthly-track crash
     in ten is missing, from Tesla's record of late filings). NHTSA's file
     dates a crash by its month only, so for the list's last, partial month
     a report the list lacks cannot be placed before or after the list's
     date: that month's score waits for Tesla's next list, whose rows carry
     exact days. The months the list covered whole score from NHTSA's file
     alone (a no-monitor report of such a month that the list lacks is a
     miss).
8. Robotaxi Tracker's camera table (pipeline step 13: the step runs after
   `main()` has written its files, so its stops leave only the table
   unsaved). A live `python3 data/slurp.py` run in a terminal ends with the
   camera step: press Enter to open the page (or type skip, which opens and
   saves nothing), copy its table, press Enter again. When it names a week
   new, changed or gone, redo Tesla's camera-estimated rows and what rests
   on them ("Ghost months", the Tesla bullet). The new ghost month's Tesla
   rows (step 4) rest on the camera too: `quals/tesla-camera-miles.qual.mjs`
   fails until its `MONTHS` names the month, and then until the rows are its
   recomputation. A run whose stdin or stdout is not a terminal (an agent's)
   only prints how a person saves the table: no agent opens the site.

Then the quals: `quals/growth-ghost-month.qual.mjs` needs the growth chart's
rows for the new ghost month (`crashla.js` `FLEET_HISTORY` and
`RIDES_HISTORY`; "Ghost months" below) and the start of Tesla's forecast
path at that month's exit rate (`TESLA_PATH_START`; the qual's
`PAGE_MEASURED` records the no-monitor miles of the month's first stretch,
which the rate leaves out: Tesla's page figure where the page has measured
part of the month, as through Oct 18, 2026 (read from
`quals/tesla-page-part.mjs`, step 7), and otherwise the camera
estimate through its last whole week, as November 2026's 1,519,000 through
Nov 15), and
`quals/fleet-forecast.qual.mjs` then checks each Jan-1 fleet forecast against
them, and Waymo's and Zoox's miles low edges (`MILES_FORECAST`) against
their newest `data/vmt.csv` month held flat through the day before the
forecast date (since 2026-11-03), so a new ghost row moves both edges.
After the slurp, `quals/vehicles-involved.qual.mjs` goes red on each new
narrative that counts its vehicles ("All three vehicles sustained damage")
until `VEHICLES_INVOLVED` holds its count and those words (four narratives in
the Nov-16-2026 release); add them and run slurp again.
No qual pins a verdict, a multiple, a count or a cumulative copied from the
page's own output (since 2026-11-17, the human's "sure, convert outcome pins
to sanity check ranges"; until then a release meant re-pinning
`quals/stress-test.qual.mjs`'s knife-edge verdicts and fault-flip table,
`quals/vmt-ledger.qual.mjs`'s newest cumulatives and month, and
`quals/tesla-no-monitor.qual.mjs`'s crashes by month). Such figures are
recounted from the data, derived from the reviewed cutoff, or held to wide
sanity ranges, so a release that leaves a qual red on one of them has either
broken a figure (a digit too many, a dropped denominator) or holds news: look
at it before widening the range, and widen it with the human.
`quals/tesla-no-monitor.qual.mjs` still holds Tesla's list, the
monitor-aboard list and the page's and deck's miles for the months Tesla's
page has measured whole (source figures), and goes red on a Tesla report of
2026 that is on neither list nor among the reviewed no-monitor additions
(step 7), and on a monitor-aboard entry its own list of them lacks (add the
Report ID there at the release that adds the entry); `slurp.py` stops on a
reviewed report whose narrative fails the narrative test (step 7), and
`quals/tesla-monitor-review.qual.mjs` goes red on any Tesla narrative of
those months that names a safety monitor while the report counts on the
no-monitor line, Tesla's list's reports included, or names none while it is
listed as monitor-aboard.
`quals/passenger-classification.qual.mjs` checks the riders a release's
Tesla reports carry against their `PASSENGER_OVERRIDE` entries (since
2026-10-31; until then it pinned the list of Tesla reports with a rider,
re-pinned each release); a Tesla narrative that says nothing about who was
aboard (13781-16941, which NHTSA's Nov 16, 2026 release published) passes its
narrative check only when stored as (filed code, "Unknown") (the human,
2026-11-02).

The page's list of assumptions (the section "Assumptions", `crashla.js`
`ASSUMPTIONS`, since 2026-11-20) says how each month's miles are estimated,
and `quals/assumptions-list.qual.mjs` goes red until it covers every
line-month of `data/vmt.csv`: at each release extend the `covers` span of
the entry whose method the new ghost month follows (or add an entry for a
new method), and update the entries whose months or rules the release
changed (the list's month and counts, the arrival counts, a moved
knot). Two entries, `reporting-tesla-list` and `reporting-tesla-list-complete`,
stop the list's render at load unless the rows on a list's coverage are
Tesla's two lines in one month, through the date their values hold (no such
row is left once a release completes that month and no newer list covers
the new one): update
their values, or remove both, with `reporting-thinning` and
`reporting-range-product`, which describe a list row. Such a stop shows the page's error banner with
the entry's assert and leaves the list empty, and every other view draws:
the list is drawn last at init (since 2026-11-20; `quals/error-banner.qual.mjs`
serves an entry that stops). The qual also goes red when a figure an entry holds no longer matches
its source (a constant of `slurp.py`, `faultrate.py`, `waymo_vmt.py` or a
model qual, or a relation on `data/vmt.csv`), when a new module-level
constant of a builder or a model qual is neither named in an entry nor
listed in its `NOT_ASSUMPTIONS`, and when a human band or a forecast no
entry describes is added; an entry's text is the place to say what the
change assumes.

A data change that moves the first fully knotted month of a line with a
pre-series offset range (today Waymo and Zoox; the definition is above
`checkPreSeriesOffsets` in `crashla.js`), as a new knot can, stops the page
at load with the error banner until that line's `from` in
`PRE_SERIES_OFFSET` moves with it, and one that leaves such a line no fully
knotted month stops it too, naming the line; `quals/window-band.qual.mjs`
goes red first on either.

## VMT master

`data/vmt.csv` is the in-repo master for the monthly VMT estimates.
It was migrated verbatim (field-for-field) from the old VMT Google Sheet on
2026-06-11; git history is now the archive for VMT edits.

Its schema is:

```text
helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale
```

("Helmer" is this project's jargon for who or what is at the helm:
tesla, waymo, or zoox in this file, plus teslanomonitor, a second Tesla line
(see "Tesla's no-monitor line"); the app adds human benchmark cohorts.
"Kyoom" is the cumulative series: `kyoom_min`/`kyoom_max` band
`helmer_cumulative_vmt`, the all-time cumulative miles.)

Editing rules:

- One row per helmer-month; `month` is ISO `YYYY-MM`
- `vmt_min <= vmt <= vmt_max`, all non-negative (asserted downstream)
- `kyoom_min <= helmer_cumulative_vmt <= kyoom_max`, and the cumulative
  column must equal the running sum of `vmt` (asserted downstream)
- Numbers are plain integers (no thousands separators: slurp.py would
  accept a quoted "2,501,777", but the quals' parsers would not)
- `rationale` is free text explaining the estimate's source and uncertainty.
  The page shows it as written (sanity section, "VMT sources"), its links as
  links, so it avoids this file's column names and other repo shorthand. To
  point at a section of this file, write a markdown link whose target is the
  section on the site, its text what readers see, as
  `[data/README.md, Waymo anchors](data/#waymo-anchors)`. GitHub Pages
  renders this file at `data/`, each heading with an id made from its text as
  it renders (a code span's or a link's text kept, a typographic `--` a dash;
  then lowercased, every character but a letter, digit, underscore, hyphen or
  space dropped, each space a hyphen; a repeated id takes -1, -2 and so on),
  and the page shows the link as a link to that section (since 2026-11-05;
  until then these pointers were prose). A web page is linked the same way,
  its target the page's `https://` address (since 2026-11-17), and every web
  address in a rationale is written as a link, so that the table shows none
  as plain text. Where a source asks for its address to show beside the link,
  as Robotaxi Tracker does, the link's text is the address:
  `[https://robotaxitracker.com/cameras](https://robotaxitracker.com/cameras)`.
  A link of another form stops the
  page at load (`crashla.js` `vmtRationale`): its text must hold a character
  other than a blank and no square bracket, its target either `data/#` and an
  anchor of lowercase letters, digits and hyphens, or `https://` and an
  address with no blank, parenthesis, square or angle bracket, or quote. So a
  heading meant for links needs
  an id of that form (an underscore, from a word such as `vmt_min` or from a
  code span, or an accented letter gives one the page does not read), and
  outside a link `data/#` may stand only inside a longer path or address
  (prose can give the site's address,
  `teslapologetics.dreev.es/data/#ghost-months`). Square brackets outside the
  links are prose, as a band's "[2,075,000, 3,289,000]" or a half-open
  "(0, 1]". Another file named in prose ("IGNOREME.md, Waymo VMT
  Methodology") goes unchecked. `quals/vmt-rationale-text.qual.mjs` checks
  that each link's anchor is the id of one of this file's headings, in the
  form the page reads, so renaming a heading turns it red until the links to
  it follow; that each web link's address is of the form the page reads; and
  that no web address stands outside a link (whether a web page exists is not
  checked: no qual depends on the network). Its heading reader (`quals/rationale-links.mjs`,
  `headingAnchors`) reads this file's blocks as kramdown, which GitHub Pages
  runs, reads them (a heading in a list item, a quote or a definition, at its
  content column or on a lazy line, is a heading; one in an HTML element read
  as markdown, `markdown="1"`, takes the id kramdown's HTML converter gives
  it when it writes the page; a `#` line that code, a comment, an HTML
  element read raw, a math block or a table takes is none), and stops,
  naming the line, only on a form whose effect on this file's headings it
  does not compute: Liquid (a double brace, or a brace and a percent sign,
  which Jekyll runs on this whole file, code blocks included); a kramdown
  extension at a block's start (`{::`, or a stray `{:/`); an attribute list
  or attribute definition there that sets an id (`{: #...}`, or an `id=`),
  which can give a heading its id; or a table holding an inline HTML element
  with content. An attribute list that sets no id, as a table of contents
  (`{:toc}`) or a class (`{: .no_toc}`), is read and changes no id. A heading
  holding a mark that changes the text it renders (an entity, inline HTML,
  an image, math, a typographic `<<` or `>>`, an explicit id, `{:`, a link
  of another form, a reference link or footnote whose label this file
  defines, or an underscore with one after it that can make emphasis), or
  one in a footnote, it leaves unread: a link to it turns the qual red,
  naming it, but the heading by itself turns nothing red, nor does a heading
  whose id is empty (every character of it one an id drops), which the page
  writes without an id. It also
  checks each figure stated in a form it reads, where that wording appears;
  it requires no wording (the human's rule of 2026-11-03)

To change VMT data: edit `data/vmt.csv`, run `python3 data/slurp.py`, and
commit the master together with the regenerated artifacts.

### Ghost months

The rules below, and the anchors' and allocations' in the sections after
this one, are listed in plain words on the page in the section "Assumptions"
(`crashla.js` `ASSUMPTIONS`, since 2026-11-20), each with where its figures
are set (Each NHTSA release, above, says when to update it).

A ghost month is a month after NHTSA's data-through month for which
`data/vmt.csv` holds rows: the month in progress, or a finished month no
NHTSA release has reached yet. `slurp.py` (`ghost_vmt_csv`) copies their rows
as they stand into `data/vmt.js`'s second segment, `GHOST_VMT_CSV_TEXT`, and
the page draws them faded, with a dashed stretch of line, on the VMT charts
(each company's and the combined one) whenever the date window ends at the
slider's last month; in those windows the sanity section's VMT sources table
lists their rationales too, after each line's analysis months, each headed
by the ghost tooltip's note. No rate uses a ghost month's miles: its crashes are not
yet published, so its rows stay out of the analysis rows, the slider and
every other chart but the growth section's (below) until a release brings its
incidents. The run stops when
the master lacks the month after the data-through month, when a ghost month
lacks a line's row, and on a row for a month that has not begun (a VMT row
records miles already driven; forecasts live in `crashla.js`'s
`MILES_FORECAST`). `quals/ghost-month.qual.mjs` pins all of it.

Since 2026-11-21 the second segment also holds the pending line-months'
rows: months at or before the data-through month that no rate counts yet
(NHTSA's reports for them are still arriving and no dated list covers them;
"What `data/slurp.py` actually reads" above has the rule, and
`quals/pending-months.qual.mjs` checks it). The page tells the two kinds
apart by the month, once, where it parses the segment (`crashla.js`
`parseGhostVmtCsv`: a row at or before the data-through month carries the
pending note, `VMT_PENDING_NOTE`, a later one the ghost note,
`VMT_GHOST_NOTE`), and draws both the same way, each with its note: on the
VMT charts, in the VMT sources table and on the growth charts' history
points. The slider's last month is the newest month with an analysis row
(the data-through month while a list covers it for some line, the month
before it otherwise). A window that ends there runs to the present and shows
every later row of the second segment; a window that ends earlier shows only
its own months, so of that segment only a pending row inside it (`crashla.js`
`windowShows`). The incident browser follows the same test for the pending
incidents.

The growth section's chart (Fleet size, Rides, Miles) draws the ghost months
the same way, faded on the dashed stretch toward its Jan-1 forecast, with the
same tooltip note (since 2026-10-28; until then it stopped a month or more
short). Its Miles lines read the ghost rows; `crashla.js`'s `FLEET_HISTORY`
and `RIDES_HISTORY` hold each company's estimate for every ghost month,
written by hand. Tesla's derive from its `data/vmt.csv` row for the month:
its fleet is cars driving on a typical day of the month (the month's miles
over its days at ~180 miles a car per day, Tesla's Q2 2026 utilization,
120-250 combined with the miles band in quadrature), its rides the
cumulative miles over the miles-per-ride corridor (`TESLA_MILES_PER_RIDE`),
so re-derive both whenever that row changes. Tesla's growth forecast starts
from its newest month too (since 2026-10-30): `TESLA_PATH_START` is the day
after that month, the month's cumulative, and its late-month rate: the
no-monitor row's miles over the month's last stretch, the days after the
last one Tesla's page measured or, in a month the page measured none of,
after the camera's last whole week, plus the monitor-aboard remainder (the
all-modes row less the no-monitor row) at its average for the month. For
November 2026 the page had nothing, so the stretch is Nov 23-30, held at the
rate of the camera's last whole week, Nov 16-22, the rate of those seven
days too: the row's 3,169,000 less the 1,519,000 estimated for Nov 1-15,
over Nov 16-30's 15 days, 110,000 a day, plus 1,100, 111,100 a day in all
(with the camera table saved on 2026-11-23; until then the week of Nov 9's
rate held from Nov 16, 117,033 a day on the row's 3,258,000). Re-derive it
with the rows.
`quals/growth-ghost-month.qual.mjs` pins all of it. Waymo's and Zoox's
miles forecasts rest on their newest month too: each one's low edge in
`MILES_FORECAST` is its newest `data/vmt.csv` month's cumulative plus that
month's miles a day held flat from the first day after it through the day
before `GROWTH_FORECAST_DATE`, at three significant figures, so re-derive
both edges with each new month's rows and whenever the newest month's row
changes; `quals/fleet-forecast.qual.mjs`'s flat-hold check re-derives them
from `data/vmt.csv` and goes red until they match (since 2026-11-03).

So each release adds every line's estimate for the month after its
data-through month, a month that has begun by release day. When the next
release arrives, that month becomes its data-through month: pending for a
line no list covers, a list row where one does. At the release after that
it is complete and its band becomes the VMT prior of every rate, so re-read
the rows at both.

When a ghost month is measured (Tesla's page adds its weeks, CPUC or the
hub covers it), score its row: record in AGENTS.md's ledger whether the
measurement fell inside the band. A 95% band should miss about one time in
20, so one miss is no reason to widen it; change a line's constants when its
record shows more misses than that allows.

A ghost row's band is a 95% interval as the page reads it: `crashla.js`
`splitPriorSigmas` takes `vmt` as the mode of a two-piece log-normal with
each edge 1.96 of its own side's sigma away. The October 2026 rows used the
rules below, calibrated on 2026-10-27 by backtests on Tesla's and Waymo's
measured series (Zoox's constants are priors; its October rationale shows the
arithmetic, and `quals/zoox-vmt-model.qual.mjs` recomputes every 2026 row).
The choices they left open were settled the same day (AGENTS.md
ledger, 2026-10-27 (later)):

- Tesla's no-monitor line, from Tesla's weekly page: the measured part is
  the page's miles for the month so far (city sums, linear within each
  week). Days the page has not measured are estimated from the data in
  hand, with no growth assumed (the human, 2026-11-16: "assume as little as
  possible ... whatever the uncertainty is, the confidence bands should
  reflect that"). The data is Robotaxi Tracker's Camera watch
  ([Robotaxi Tracker](https://robotaxitracker.com),
  https://robotaxitracker.com/cameras), which counts Cybercabs per 1,000
  vehicles on Austin's public traffic cameras each UTC day. K, the miles
  per unit of camera rate, is the geometric mean, over the weeks both
  series cover, of Tesla's all-city weekly miles over the week's mean
  camera rate: 258,938 over the four weeks of Sep 21-Oct 18, 2026, each
  week within 10% of it. An unmeasured day gets K times its week's mean
  rate, over 7; a day past the camera's last week gets the last week's
  rate (no growth, no fall). Range: each camera-covered day times
  e^(±w), w = √((t s √(1 + 1/n))² + (1.96 × 0.07)² h). In the first term
  n is the weeks both series cover, s the sample standard deviation of
  ln(weekly miles / camera rate) over them and t Student's 97.5% point at
  n − 1 degrees of freedom (×0.78-1.29 at four weeks: the 95% prediction
  interval for one new week). The second is drift since those weeks, in
  the site's Cybercab detector or its cameras or in the ratio itself,
  which nothing measures (the human, 2026-11-20: "yes please to accounting
  for the detector uncertainty/drift"; the site's table notes that "A line
  starts the day its detector did"): 0.07 is the drift prior of Zoox's
  formula below (ln per square root of a month), an assumed number with no
  data behind it, and h the day's distance in months (days / 30.44) from
  the middle of the weeks both series cover (Oct 5, 00:00 UTC, between
  Oct 4 and Oct 5, for Sep 21-Oct 18, 2026), measured to the day's own
  middle: ×0.76-1.31 on Oct 19, 2026, ×0.74-1.35 on Nov 15 (until
  2026-11-20 every such day took the first term alone). The days' edges
  are summed (their errors taken as moving together); the days past the
  camera's last whole week ×0.5-2; the parts' edges summed with the
  measured part; then a log term for the gap between Tesla's page and its
  deck added in quadrature: 0.066, 1.96 times the root mean square of the
  monthly ln(deck / page) over April-September 2026 (about 6.8%). The one
  assumption is that the ratio holds, up to the drift the band allows. It
  would fail if Cybercabs' share of Tesla's miles, or Austin's share, moved
  far from the calibration weeks': cars in cities the Austin cameras cannot
  see are counted only through the ratio (Tesla opened Fort Worth on Nov 2
  and San Antonio about Nov 9, 2026). `quals/tesla-camera-miles.qual.mjs`
  recomputes the rows from Tesla's weeks, which it holds as entered by hand
  (add Tesla's own weeks to the calibration as its page publishes them),
  the page's figure for a month's measured part (`quals/tesla-page-part.mjs`,
  the one place the quals hold it: "Each NHTSA release", step 7),
  and the camera rates, which it reads from the newest table saved in
  `data/snapshots` (`robotaxitracker-cameras-YYYYMMDD.tsv`, through
  `quals/camera-table.mjs` and `data/slurp.py`'s `camera_table_days()` and
  `camera_week_means()`): each whole Monday-Sunday week's mean of the
  Cybercab column, a week the table holds only part of waiting for its
  last day (until 2026-11-20 the qual held the weekly means, copied by
  hand). A person saves each table: Robotaxi Tracker's terms forbid
  scraping and its robots.txt automated harvesting, so no script fetches
  the page (its llms.txt asks for credit by name with a link and the
  visible URL wherever its data is used). At the end of a live
  `python3 data/slurp.py` run in a terminal, the camera step
  (`camera_table_step()`, after `main()`, never inside it) asks that person
  first (Enter goes on; skip opens and saves nothing), then opens the page
  in their own browser, waits while they press "Show data" under "Over
  time", select the table and copy it, then reads the clipboard, checks the
  table and saves it when it differs from the newest saved one, never over a
  saved table (a different copy the same day stops with nothing saved; a run
  whose stdin or stdout is not a terminal, an agent's, only prints how a
  person saves it). It then lists the days the site changed (it can
  reprocess them) and the whole weeks whose mean is new, changed or gone. A
  week moves the rows of the months holding its days and, when it is the
  table's last whole week, of the days after it, which take its rate; a
  calibration week (Sep 21-Oct 18, 2026) moves them all. After any such week
  the rows it moves are redone from the newest table
  (`quals/tesla-camera-miles.qual.mjs`, which recomputes every Tesla row
  from October 2026 on, its `MONTHS` naming each, fails until they are, its
  message giving the figures), and with them what rests on them: their
  rationales' figures, `data/vmt.js` (slurp), the growth chart's Tesla
  points and `TESLA_PATH_START` (`quals/growth-ghost-month.qual.mjs`), and
  the assumptions list's camera entries (`quals/assumptions-list.qual.mjs`,
  which reads the newest table too: a table that only adds days to its last
  week moves the `tesla-camera-held` entry's figures, and one whose last
  whole week reaches past the last month `MONTHS` names stops it until that
  month's rows are added). Until 2026-11-16 the unmeasured days were
  projected at the last weeks' growth (the geometric mean of holding the
  last week flat and continuing its growth, and of continuing the three-week
  growth, ×e^(±0.30 √(h/7)), with a human-set central past five weeks): for
  Oct 19-31, 2026 that gave 1,382,000 miles where the camera rate gives
  1,032,000.
- Tesla, every operator mode (from July 2026, the months after Tesla's chart
  of miles from every mode ended; `quals/tesla-every-mode.mjs`, which the
  July-September rows, `quals/tesla-unsupervised-floor.qual.mjs`, and the
  camera months, `quals/tesla-camera-miles.qual.mjs`, share): the no-monitor
  line's miles plus the monitor-aboard miles, whose ranges combine as
  independent errors, in quadrature, at both edges (the human, 2026-11-23,
  "ok fine": the main unknown in the monitor-aboard miles, how much
  monitor-aboard driving continued after June, has nothing to do with Tesla's
  page). Central = the no-monitor central plus June 2026's measured
  monitor-aboard remainder (33,000 miles); floor = the central × e to minus
  the root-sum-square of ln(no-monitor central / no-monitor floor) and
  ln(central / no-monitor central), the monitor-aboard miles falling to none;
  top = the central × e to the root-sum-square of ln(no-monitor top /
  no-monitor central) and ln(1.27 × no-monitor central / central), a
  monitor-aboard share at or below June's 21%. Until 2026-11-23 only the top
  took this rule: the floor was the no-monitor line's floor for October and
  November 2026 and the lower of Tesla's two no-monitor readings for
  July-September, about 3% above that line's floors (2026-11-20 spec finding
  (c)).
- Waymo: each term of the latest row at its per-day rate for the month's
  days, plus documented openings and pauses (for October 2026, among them
  Waymo's Oct 27 expansion, https://waymo.com/blog/shorts/more-places/);
  band ×e^-(0.17 + 0.028k) to ×e^(0.15 + 0.02k), k being the months from
  the end of the latest quarter both CPUC and the hub have measured to the
  end of the month (k = 4:
  ×0.75-1.26), from four-month-ahead backtests on CPUC's monthly California
  miles and the hub's quarterly county miles. Alphabet's Q3 remarks of Oct
  28, 2026, "more than 300 million fully autonomous miles"
  (https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q3-2026/),
  gave only a floor, which the series clears.
  `quals/waymo-vmt-model.qual.mjs` holds every month after September 2026 to
  this rule (since 2026-11-21 it reads those months from `data/vmt.csv`;
  until then it named October and November, and a later month's row was
  checked by its cumulative chain alone): September's estimate before its
  weather deduction at its per-day rate for the month's days, plus the
  month's entry in the qual's `OPENINGS` and less its entry in `PAUSES`, in
  the band above with k counted from June 2026. A month with no entry in both
  stops the qual, so each new month's row comes with its two entries (an
  empty one where nothing is put on or taken off).
  November 2026 takes nothing off for Waymo's halt of freeway driving (its
  `PAUSES` entry is empty). The California DMV barred Waymo from operating or
  testing driverless cars on freeways on Nov 11, 2026, after three Waymo
  vehicles entered a construction closure on U.S. 101 near Burlingame on Nov
  5; the order became public on Nov 17, by when Waymo was "preventing its
  robotaxis from accessing freeways in any of the markets it operates in,
  including those outside of California" (TechCrunch, Nov 17, 2026,
  https://techcrunch.com/2026/11/17/waymo-suspends-freeway-rides-nationwide-after-california-dmv-order/;
  Fortune, Nov 18, 2026,
  https://fortune.com/2026/11/18/waymo-driverless-freeway-ban-california-nationwide/).
  Neither gives a date for the other markets or the freeway share of Waymo's
  miles, and the one measured precedent shows growth stalling, not miles
  lost: through the freeway suspension of May 21 to late July 2026, CPUC's
  California driverless miles a day, deployment plus pilot (the basis the
  rows use; `data/waymo-ca.csv`), ran about 316k in May, 323k in June and
  324k in July, then 367k in August (+13%) and 440k in September (+20%).
  Deployment alone fell 3.9% from May to June, and pilot miles rose by more.
  The November row already holds September's daily rate with no growth, so
  it deducts nothing, and its rationale says so.
- Zoox: California (CPUC driverless miles × 1.19 for the DMV-reported miles
  CPUC misses) grown e^0.05 (about 5.1%) a calendar month from its last CPUC
  month, and the rest at the smooth path's Las Vegas rate (since 2026-11-03
  one path through all four of Zoox's cumulative statements as ranges,
  which holds December 2025's 6,500.65 miles a driving day on; until then
  the per-day rate between Zoox's two latest statements, each held at its
  midpoint), held flat unless a dated, quantified change is known (a
  reported pause of known length removes its days). Band, through the month
  of Zoox's last statement (August 2026): ×e^(-1.96σ) to ×e^(1.96σ) on the
  month's rounded miles, edges rounded to 1,000, with
  σ = √(0.065² + 0.07²h + 0.09²) (statement rounding, drift, month noise) and
  h the months from the governing window's midpoint to the month's midpoint
  (definitions in "Zoox anchors" below). September 2026 falls after the last
  company mileage statement. Its California bounds are the filed driverless
  pilot miles times 1.05 and 1.33. Add half the estimated Las Vegas miles
  to the low edge and twice those miles to the high edge. For October and
  November neither part is measured, so the range is half to twice the
  rounded U.S. estimate, the rule adopted on 2026-11-17. Until that date
  the formula ran on, with 0.10 added in quadrature on the upside from
  October for fleet growth announced but unquantified.
  For the current one- and two-month forecast horizons the California
  rule gives 28 comparisons with later observations in CPUC's and the DMV's
  series. The forecast divided by actual ranged from 0.69 to 1.51. All
  were inside half to twice and five were outside the earlier formula's
  range. When June was the last filing, the three- to five-month check
  had 18 comparisons, six outside the formula's range and none outside
  half to twice. `quals/zoox-vmt-model.qual.mjs` reruns the check. When
  CPUC measures another month's California share, restate that month's
  band with the human. The formula's
  constants are priors:
  read as ranges, Zoox's statements allow one flat Las Vegas rate from
  December 2025 on, so they show no change in it to test the constants
  against (read at their midpoints, until 2026-11-03, they showed one). The
  same path sets Zoox's analysis months from June 2025 ("Zoox anchors"
  below).

### Waymo anchors

Waymo's Safety Impact hub "All Locations" total counts only locations that
have a county-level human benchmark (hub release notes, Jun 12, 2025: miles
and crashes from unbenchmarked cities "were not included in the All Locations
(mileage blended) analysis"). The repo's series is US-wide — its incident
numerator already includes crashes in the unbenchmarked metros — so each
cumulative anchor is the hub figure plus E, an explicit estimate of rider-only
miles (incl. deadhead) in metros the hub had not yet benchmarked at that date.
`quals/waymo-vmt-provenance.qual.mjs` pins the same table. When the hub adds
a metro, set that metro's share of E to 0 at that anchor and re-chain
`data/vmt.csv`, applying the monthly allocation method below to the intervals
it covers.

| Data through | Hub figure (hub CSV1) | Counted | E lo / best / hi | Excluded metros |
|---|---|---|---|---|
| Mar 2025 | 71.432M | PHX, SF, LA, ATX | 0.188 / 0.188 / 0.188M | Atlanta 0.056M + Mountain View 0.132M (listed, excluded — exact) |
| Jun 2025 | 95.965M | PHX, SF, LA, ATX | 0.4 / 0.7 / 1.3M | Atlanta (rider-only Jan 30, public Jun 24, 2025); Santa Clara / Mountain View |
| Sep 2025 | 127.158M | PHX, SF, LA, ATX | 1.3 / 2.0 / 3.1M | Atlanta; Santa Clara |
| Dec 2025 | 170.712M | Maricopa, SF, San Mateo, Santa Clara (newly counted), LA, Travis | 3.0 / 3.7 / 4.6M | Atlanta (~3.5M lifetime); Miami (rider-only Nov 18); Dallas, Houston, San Antonio, Orlando (Dec) |
| Mar 2026 | 220.613M | + Fulton, DeKalb (Atlanta, 5.379M lifetime) | 1.2 / 2.0 / 3.3M | Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson |
| Jun 2026 | 271.329M | same eight counties (Atlanta 8.624M lifetime) | 4.0 / 6.65 / 10.2M | Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson; plus employee rider-only Denver, Las Vegas, San Diego, Tampa from ~Jul |

Atlanta D (applied 2026-09-25, withdrawn 2026-09-29). The hub's thru-Mar and
thru-Jun 2026 per-cell detail files ("CSV4 - Miles and Benchmark Crashes for
Dynamic Benchmark") listed ~85 Fulton/DeKalb S2 cells twice, and CSV1's
county totals equalled the sums that count both copies, so the anchors
briefly subtracted D, the apparently double-counted Atlanta miles (2.841M
thru Jun 2026). Waymo answered that the duplicates came from a processing
error in the Atlanta benchmark data and that county miles come from a
separate process, and on Sep 28, 2026 posted "..._v2.csv" versions of CSV3 and
CSV4: v2 lists each cell once and still sums to the published county totals,
because per-cell miles are shares of those fixed totals. The published
figures stand; no D.

Hub-vs-CPUC California (2026-09-25). The hub's four California counties ran
1.040x CPUC's statewide TotalVMTZEV (deployment + pilot) in Q1 2026 and
1.058x in Q2, cause unknown. Until 2026-11-19 the months after June, built
from a projected CPUC-basis California estimate, multiplied it by 1.058
[1.040, 1.076]; no row uses that bracketed band now. October and November
2026 still carry the ratio itself (September's filed daily rate times
1.0576), inside their whole-row band ("Ghost months").
The July–September 2026 rows use the Q3 filing's statewide deployment and
pilot miles. Their California component uses the same Q2 conversion as before
(30,625,484 / 28,957,564, both in whole miles), with the ±3% range used for
measured California months in April–June. The numerator is the increase in
the four California counties' rider-only miles between Waymo's
[March CSV4](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV4%20-%20Miles%20and%20Benchmark%20Crashes%20for%20Dynamic%20Benchmark%20202009-202603-2022benchmark.csv)
and [June CSV4 v2](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV4%20-%20Miles%20and%20Benchmark%20Crashes%20for%20Dynamic%20Benchmark%20202009-202606-2022benchmark_v2.csv).

The filing includes San Diego passenger service. The older newer-metro
subtotal also included San Diego, and the public filing gives no monthly
mileage for that city. For July, August and September, San Diego accounted
for 0 of 12, 0 of 14 and 3 of 25 in-scope reports in those metros in the
November 16 NHTSA release (Miami includes Miami Beach). Assuming the same
reported crashes per mile across those metros, the September subtraction
is 3/25 × 2.85M = 342,000 miles, leaving 2.508M. The original 2.85M was
estimated before September's reports were available. The reports apportion
that subtotal and also enter the safety comparison.

The uncertainty in this split has two parts. Let `s` be San Diego's share
of reported crashes and `r` its reported crashes per mile relative to its
peers. Its share of miles is `m = s / (s + r × (1 − s))`. Take the endpoints
of the two-sided 95% Clopper–Pearson interval for `s` and allow `r` to
range from 4.5/6.6 to 9.5/6.6 using the young-market rates below. The 95%
confidence level applies to the crash share under the binomial model. The
crash interval and rate range give modeled mileage shares of 0–34.5% in
July, 0–30.7% in August and 1.8–40.0% in September. Multiply the original subtotal's low edge by `1 − m_high`
and its high edge by `1 − m_low`. [Waymo's Q3 CPUC narrative, p. 6 (deployment ZIP)](https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/consumer-protection-and-enforcement-division/documents/tlab/av-programs/waymo-deployment-2026q3.zip)
documents August demo rides for San Diego community organizations ("Provided
demo rides for several San Diego community organizations", under its Los
Angeles Area heading; it does not say where the rides were given), so even a
month with zero reports allows for overlap. October
and November carry September's disjoint components at their daily rates
and retain the existing adjustments for subsequent openings, expansion
and weather.

`quals/waymo-vmt-model.qual.mjs` recounts the split's reports from
`data/incidents.js` at every run (since 2026-11-21; until then this section
asked for a recheck "if later NHTSA filings change the September counts",
which nothing made): each of the three months' in-scope Waymo reports by
place, every place listed in the qual as one of the hub's counties' or a
newer metro's. It goes red when a count differs from the one its row was
written for (a late report of July, August or September is enough) and on a
place it does not list. Then redo the month's share and its Clopper–Pearson
endpoints in the qual, the rows it recomputes, their rationales and the
figures above ("Each NHTSA release", step 4).
When Waymo publishes Q3 county miles, compare the counties it covers with
the statewide CPUC geography. If San Diego still lacks a hub benchmark, its
miles belong in the newer-metro subtotal when building the hub-based U.S.
anchor. The statewide CPUC total already includes its passenger service.

Pre-series offset (a range since 2026-10-31, decision #49b of the 2026-10-04
audit). The series starts in July 2021, NHTSA's SGO reporting floor, so
every lifetime figure Waymo publishes also holds the rider-only miles driven
before it: the offset, range 150,000-260,000, central 205,000 (the range's
middle since 2026-11-02, open question 20(b); from 2026-07-01 until then
150,000, the range's floor). Waymo's figures set the range. Table 2
of Kusano et al. 2025 ([arXiv 2505.01515](https://arxiv.org/pdf/2505.01515),
pp. 10-11) gives 20,500 rider-only miles in 2019, 73,900 in 2020 and 328,000
in 2021; Schwall et al. 2020 ([arXiv 2011.00038](https://arxiv.org/abs/2011.00038):
"The data from driverless mode shared in this paper is from January 1, 2019
to September 30, 2020, during which Waymo AVs drove 65,000 miles in
driverless mode in the metro Phoenix ODD") leaves 29,400 for Q4 2020, about
320 a day. January-June 2021 ran between that daily rate (57,800 miles) and
half of 2021 (164,000, if 2021's rate did not fall), so the offset lies in
152,200-258,400, rounded outward to 150,000-260,000. (The 2026-10-04 answer proposed
100,000-200,000; Waymo's figures rule out its lower half and allow more
above.) A central on the band's floor would hold January-June 2021 at about
Q4 2020's 320 miles a day and then jump to about 1,480 a day for
July-December; the middle gives a steadier ramp, so since 2026-11-02 the
central is the middle: every knot's
cumulative central, and every one from December 2022 on, is 55,000 miles
lower, and so are July-December 2021's miles together (2021's lifetime
total less the offset). 2022's twelve months keep
their total, but their shape tilted toward the later months, because the
allocation interpolates daily rates across the year boundary: January 2022
4,058 miles lower, December 1,651 higher, and the two years now one rising
ramp (from about 1,160 a day in July 2021 to about 1,520 in November 2022,
where the floor central had put July-December 2021 above 2022's first
months). No month from January 2023 on moved. A knot's series band
is its lifetime band less the offset's range, [low - 260,000, high -
150,000], and its central the figure less 205,000. The offset is the same
at every knot and cancels between any two of them: `data/waymo_vmt.py`
reconciles the monthly bands on the lifetime basis, where the series start
is a knot of its own, so only July-December 2021 and the cumulative bands
carry it. The app's window band differences two cumulative bands
(`windowVmtBand`); since 2026-11-02 it adds the offset's range back once
when the row before the window is at or after the first knot, December
2021, where both bands carry it, so the shared offset cancels (until then
every window starting after a knot was widened by the range, 110,000 miles,
at each end: the default window to 217,587,237-257,586,873 from
217,697,237-257,476,873, 2022 to 412,250-635,750 from Table 2's
522,250-525,750).

E derivation (2026-08-28): SGO crash-count proxy (the repo's own incident
data shows 1/4/9 crashes in the excluded metros in Jan/Feb/Mar 2026 and
10/8/9 in Apr/May/Jun, against ~5-8 crashes per million rider-only miles
in the benchmarked metros), cross-checked against fleet counts (TxDMV
registry; local reporting) and rider disclosures (Dallas "nearly 150,000
riders since February", Houston ">100,000", Orlando ">60,000"). Monthly
excluded-metro estimates carried in the 2026 rows: Apr 1.4M, May 1.45M,
Jun 1.8M, Jul 2.0M, Aug 2.3M, Sep 2.508M (2.85M before removing San
Diego's estimated share above; lo/hi in the row bands). The Jun
2026 anchor's E best (6.65M) is the carried monthly sum. Its lo and hi
(4.0M / 10.2M) apply the same proxy to the hub's own crash list: the 41
unbenchmarked-county crashes of Jan-Jun 2026 at the young-market rate
(Travis 114 crashes / 17.839M + Atlanta 61 / 8.624M = 6.6 per M mi), with
the 4.5-9.5 per M range and Poisson noise folded in. The Sep 24, 2026 update
added no metro; the next (data through Sep 2026) is expected ~mid/late Dec
2026.

### Waymo monthly allocation

Since 2026-10-31 (open question 15, "Rebuild on Waymo's figures"), the 57
months July 2021–March 2026 use measured California miles plus an allocation
of the remaining miles between cumulative knots on Waymo's own figures; from
2026-10-27 until then only July 2024–March 2026 did, and the earlier months
kept an older ramp that did not follow those figures (it put 9.3M lifetime
miles at the end of 2023, an analyst's estimate, against Waymo's 10.066M).
`data/waymo-ca.csv` holds CPUC driverless deployment and pilot miles, including
deadhead; `data/waymo-ca-sources.json` identifies each public ZIP URL, member,
field and member SHA256. `!` separates nested ZIP members; the hash is of the
uncompressed CSV or XLSX member, not the ZIP. Older pilot workbooks use the
`Fleetwide Data` sheet. The files retain the full measured December 2022–September
2026 series so the extraction and calibration can be checked. Before
December 2022 there is no California series, so July 2021–November 2022 is
residual only.

Run `python3 data/waymo_vmt.py` to print the rebuilt rows as JSON without
editing the master. Each knot's series central is its lifetime figure less
the pre-series offset's central (above, Waymo anchors); the hub anchors
(March 2025 on) keep their reviewed centrals, and January 2025 its one-mile
ledger residue, so the rebuild moved no cumulative central from January 2025
on except February 2025's, 14,250 miles lower: January's monthly fell when
the December 2024 knot moved to CSV1 (below), and the interpolated daily
rates then shifted 14,250 of February-March 2025's fixed total from February
to March.
For each knot interval, subtract measured California miles from the US
increment. This residual includes other states and California miles outside
CPUC's passenger-service scope; it is not simply non-California mileage.
Compute the residual's average daily rate at the interval's duration-weighted
midpoint, interpolate linearly between neighboring interval rates, multiply
by each month's days, then rescale the monthly residuals to sum exactly to
the interval's residual. Add the measured California miles back. The final
month absorbs integer-rounding residue so no cumulative central moves. The
measured Q2-2026 interval supplies the last interpolation slope; its existing
monthly rows are retained.

Allocation uncertainty applies only to the residual. Its log half-width is
`0.20 * sqrt((n - 1) / 2)` for an interval of `n` months: zero for a single
month, 0.20 for a quarter and about 0.316 for six months. Multiply the
interval's low/high residual by the month's allocation weight and
`exp(±half-width)`, then add that month's fixed measured California part.
The interval edges subtract the opposite cumulative-knot edges and the
measured California total. The 0.20 is a modeling prior informed by
masking the monthly detail of 30 measured California months (January
2024–June 2026) and reconstructing them from block totals; it covers at least
90% of the masked months for blocks of up to six months
(`quals/waymo-allocation.qual.mjs`) and too few past eight (12 months: 85.7%).
An interval longer than six months, 2022's twelve, therefore keeps the
series' old early allowance, `ln 2` (half to twice a month's miles), which
covers 92.9% of the masked 12-month blocks. California is a proxy for the
unmeasured residual; these checks do not establish 95% coverage for national
monthly mileage, least of all for July 2021–November 2022, whose months have
no measured California part: the CPUC series in `data/waymo-ca.csv` starts
in December 2022, though Waymo's rider-only ride-hailing reached San
Francisco in March 2022
([Victor et al. 2023](https://storage.googleapis.com/waymo-uploads/files/documents/safety/Safety%20Performance%20of%20Waymo%20RO%20at%201M%20miles.pdf),
p. 8) and drove 70,000 rider-only miles there that year, 13% of 2022's
524,000 (Kusano et al. 2025, Table 2). The app interprets the authored edges
as a 95% two-piece log-normal prior, as for the other VMT rows.

Monthly and cumulative bounds are reconciled by interval arithmetic: carry
monthly ranges forward, constrain them backward from the cumulative knots
(and floors), then constrain each month by the difference of its adjacent
cumulative ranges. This preserves the known totals without treating every
month's low or high as jointly possible. It is not a fitted joint
probability model. The monthly bounds are reconciled on the lifetime basis,
where the pre-series offset is the series start's own knot and cancels
between later knots; the cumulative bounds are then the series basis, every
knot less the offset's range, swept from the series' exact zero at its start.

The knots and their precision: Table 2 of Kusano et al. 2025
([arXiv 2505.01515](https://arxiv.org/pdf/2505.01515), pp. 10-11, mileage from
Waymo's Safety Impact hub) gives rider-only miles by city and calendar year to
three significant figures, so its cumulative through 2023 is 10,066,400
±11,650. Each 2024 CSV1 total sums four values rounded to 1,000 miles,
allowing ±2,000 miles, and Table 2 lists 5,000 Mountain View miles in 2024,
allowing at most 5,500 missing miles at each 2024 knot. For January 2025, the
paper's explicit 56.700M total allows ±500 miles; its separately listed
Mountain View and Atlanta miles allow at most another 9,250. These
arithmetic envelopes are not empirically calibrated confidence intervals.

| Knot | Published lifetime miles | Series central | Series bounds |
|---|---:|---:|---:|
| December 2021 | [Table 2: 422,400 ±600](https://arxiv.org/pdf/2505.01515) | 217,400 | 161,800–273,000 |
| December 2022 | [Table 2: 946,400 ±1,150](https://arxiv.org/pdf/2505.01515) | 741,400 | 685,250–797,550 |
| January 2023 | [1,000,000 on Jan 21](https://storage.googleapis.com/waymo-uploads/files/documents/safety/Safety%20Performance%20of%20Waymo%20RO%20at%201M%20miles.pdf), January at Jan 1-21's daily rate: 1,025,524 | 820,524 | 752,488–907,220 |
| July 2023 | [Swiss Re: 3,868,506](https://arxiv.org/abs/2309.01206) | 3,663,506 | 3,572,946–3,718,506 |
| October 2023 | ["over 7.14 million"](https://arxiv.org/abs/2312.12675) | 6,935,000 | 6,880,000–7,000,000 |
| December 2023 | [Table 2: 10,066,400 ±11,650](https://arxiv.org/pdf/2505.01515) | 9,861,400 | 9,794,750–9,928,050 |
| March 2024 (floor) | ["Over 14.8M"](https://x.com/Waymo/status/1803095329304088922) | 15,003,321 (allocated) | at least 14,540,000 |
| June 2024 | [CSV1: 22,199,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202406-2022benchmark.csv) | 21,994,000 | 21,937,000–22,056,500 |
| July 2024 | [CSV1: 25,308,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202407-2022benchmark.csv) | 25,103,000 | 25,046,000–25,165,500 |
| September 2024 | [CSV1: 33,103,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202409-2022benchmark.csv) | 32,898,000 | 32,841,000–32,960,500 |
| December 2024 | [CSV1: 50,083,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202412-2022benchmark.csv) | 49,878,000 | 49,821,000–49,940,500 |
| January 2025 | [Paper: 56,700,000](https://arxiv.org/pdf/2505.01515) | 56,495,001 | 56,439,500–56,559,750 |

Sources and readings. The first million rider-only miles were reached "on
January 21, 2023" (Victor et al. 2023, Waymo, "Safety Performance of the Waymo
Rider-Only Automated Driving System at One Million Miles", p. 8): by that
day's end the lifetime stood at 1,000,000 to 1,002,600, so January's central
keeps Jan 1-21's 53,600 miles (from Table 2's end-2022 lifetime) at that daily
rate for the whole month, its bounds Jan 22-31 at half to twice that rate. Di
Lillo et al. 2023 (Swiss Re, arXiv 2309.01206) count 3,868,506 rider-only
miles in Phoenix and San Francisco "from 1/1/2018 to 8/1/2023" (Los
Angeles's rider-only miles came later in 2023: 46,700 through October); the low edge allows Aug 1, one more day at August-October
2023's average, 35,560. Kusano et al. 2024 (arXiv 2312.12675) report "over
7.14 million RO miles through the end of October 2023", read as 7.14M-7.15M
(its city figures, 5.34M + 1.76M + 0.0467M, agree). Waymo's post of Jun 18,
2024, "Over 14.8M rider-only miles driven through the end of March, it was
up to 3.5x better in avoiding crashes that cause injuries and 2x better in
avoiding police-reported crashes than human drivers in SF & Phoenix", is a
floor on March 2024's cumulative (and its band's low edge); the allocation
puts 15.21M lifetime there, 2.8% above it. The sentence names San Francisco
and Phoenix, so the figure may count those two cities only and leave out Los
Angeles's rider-only miles (46,700 through October 2023, above, and more by
March 2024). As a floor on the whole count it holds either way. It does not
show the allocation too high: had the post truncated a figure below 14.9M,
the allocation's 15.21M would sit about 0.3-0.4M above it, a gap Los
Angeles's miles may fill.

Until 2026-10-31 the June, July and December 2024 knots kept the rounded
milestones' centrals (22M, 25M and 50M less 150,000) inside envelopes
stretched to hold them, so Waymo's own CSV1 differences did not carry over:
August-September 2024 held 308,000 miles (4%) more than CSV1 has, July
109,000 fewer (audit 2026-10-30, VMT-2). They are now CSV1's figures less the
offset's central, like September 2024's: the pre-series offset is common to
every knot and cancels in their differences, and the retained centrals'
rounding gaps no longer enter the months between them. That moved 199,000
miles into the history before July 2024, Waymo's own figures' difference
from the old 22M milestone, and changed no cumulative central from January
2025 on except February 2025's, 14,250 miles lower (above).
April 2026 onward keeps its existing method; its cumulative bands chain from
the March 2026 knot (and back from June 2026's) as before, with the offset's
range.

### Zoox anchors

Zoox's letter to NHTSA of Jan 28, 2026 (docket NHTSA-2025-0523-0004 p.22)
gives "approximately 1.3 million driverless autonomous miles on public roads"
as of Dec 31, 2025. The series starts in May 2024 (Zoox's first in-scope SGO
crash), so the driverless miles before it come off: California DMV Feb
2023-Apr 2024 (permit AVDT004) 20,174, measured, plus a Las Vegas analog of
19,906 (equal to California's Jun 2023-Apr 2024) at the early rows' 0.5x-2x
Las Vegas band, 30,127-59,987, central 40,080. The Dec-2025 band (the knot,
added 2026-10-03) is the rounding interval of "approximately 1.3 million",
1.25M-1.35M, less that offset band: 1,190,013-1,319,873, the disclosure's own
uncertainty rather than the running sum of the monthly bands; later months'
bands chain forward from it. The Dec-2025 cumulative is where the smooth path
below puts it, since 2026-11-02 the range's low end: 1,250,000 - 40,080 =
1,209,920 (from 2026-10-03 until then the midpoint, 1,259,920).
`quals/zoox-vmt-provenance.qual.mjs` pins the knot.

Since 2026-10-27 the "nearly two million autonomous miles" statement (Zoox's
journal post of Mar 23, public Mar 24, 2026) is a knot too, and the "more
than 3 million miles on public roads" statement (Bloomberg, Aug 5, 2026,
"To date ... over 3 million miles on public roads"; Las Vegas Sun, Aug 6) a
floor. Until then both were only checked, because their wording varies.
Both count driverless miles. Zoox's March post puts them "in our robotaxi",
apart from "our retrofitted testing fleet". And the California DMV's 2025
mileage reports (Dec 2024-Nov 2025) hold 1,213,646 Zoox test miles with
safety drivers (permit AVT012), besides 312,648 driverless (permit AVDT004,
a separate file), so a count that included safety-driver miles would have
passed 2.5M by Dec 31, 2025 on that one California year alone. The March
post's "in less than a year since our first launch" could instead mean
miles since the Sep 10, 2025 launch, but then Jan 1-Mar 23 would need
about 14,000-16,000 miles a day, twice Q4 2025's rate, against Zoox's "To
date" (Mar 11) and Bloomberg's "To date" (Aug 5); the series reads both as
all-time counts.

Each statement is read as its rounding interval ("nearly X" as 0.94X to X,
"more than X" as X to about 1.07X: 1.88M-2.00M and 3.00M-3.20M) as of a day
up to a week before its date, the as-of day counting at its end, less the
pre-series miles at their own band (the unrounded 30,127.3-59,986.6), and
carried to the month's end at 0.7x-1.3x the model's daily miles, edges
rounded outward: end-March 1,861,485-2,123,912 (1,859,918-2,127,109 until
2026-11-03, when Mar 18-24 ran at the Jan 1-Mar 24 rate and Mar 25-31 at
the Mar 25-Aug 5 rate; its upper edge was 2,121,276 until 2026-11-02).
"More than" sets only a floor: Zoox's own "more than one
million autonomous miles" (Mar 11, 2026) came when the series stood near
1.84M, so the August statement gives end-July a floor of 2,880,077 (3.00M
less the pre-series high edge and up to 1.3x the model's miles for Aug 1-5;
2,878,404 before the Q3 filing, 2,880,483 until 2026-11-03) and no ceiling; the upper edge chains on from
March. Months between knots chain forward and narrow back
from the next knot. The as-of window is a judgment: Zoox's mileage
statements can lag, as the Mar 11 one shows.

The 1M-mile crossing and the smooth path (2026-11-02, the human's answer to
open question 21, "Smooth path, honest bands"; it replaced the 2026-10-31
reshape of decision #12 of the 2026-10-04 audit; since 2026-11-03, the
human's answer to open question 29, "All four as ranges", one path through
all four statements). Fortune, reporting what Zoox's CTO Jesse
Levinson said at Fortune Brainstorm AI in San Francisco on Monday, Dec 8,
2025: "Zoox crossed the 1 million mile technical threshold for autonomous
rides just last week, Levinson said." The words are Fortune's account, not
a quotation of him (Fortune, Dec 8, 2025,
https://fortune.com/2025/12/08/amazon-robotaxi-service-zoox-plans-fees-vegas-san-francisco/;
its Dec 9 newsletter has the same sentence ending "Levinson added",
https://fortune.com/2025/12/09/zooxs-road-to-revenue-begins-to-materialize/;
Fortune's Dec 17 piece has "A few weeks ago",
https://fortune.com/2025/12/17/amazon-zoox-cofounder-dramatically-more-social-rival-waymo-tesla-cybercab/).
So the series plus its 40,080 pre-series miles passes 1,000,000 during Dec
1-7, each month's miles spread evenly over its days. No one has measured
Zoox's Las Vegas miles by month, so the rows from June 2025 are a model.
California is the CA DMV's driverless miles; December, in no DMV report yet,
is November's times CPUC's December/November ratio (48,480), within CPUC's
December (36,482, a floor) and that over 0.6 (60,803, the 60% pilot-share
reading); from January 2026 it is CPUC's miles × 1.19 (below). The Las
Vegas share runs at one rate a Las Vegas driving day each month, and the
rates take the smoothest path: the least sum of squared month-to-month
changes in their logarithm, from May 2025 (fixed: the early rows' rule, Las
Vegas equal to California) through the series' last month, ghost months
included, subject to all four statements read as ranges (the crossing
during Dec 1-7, the lifetime in 1.25M-1.35M at Dec 31, 2025, in
1.88M-2.00M at Mar 24, 2026 and in 3.00M-3.20M at Aug 5, 2026) and to the
end-July floor above. Smoothing only the Las Vegas share keeps California's
measured months as measured, and counting per driving day keeps January's
outage out of the criterion. Two of the statements bind: the path's
lifetime reaches 1M at the end of Nov 30 (the crossing falls at the start
of Dec 1) and stands at 1.25M at Dec 31. The others hold with room:
1,887,653 at Mar 24, 3,083,678 at Aug 5, and an unrounded end-July series of
2,997,493 against the floor's 2,880,077. Since none after Dec 31 binds, the
path holds December's rate from then on, so "held flat after Aug 5", the
earlier rule, now follows from the criterion. The share runs 784, 1,246,
1,934, 2,898, 4,123, 5,435 and 6,501 miles a day June-December, then
6,500.65 a day through November 2026: June-December 2025 46,024 / 65,241 /
96,029 / 121,954 / 170,087 / 219,315 / 250,001 miles, December absorbing
the rounding residue. `quals/zoox-vmt-model.qual.mjs` checks that the path
is the smoothest near it (every other statement holds strictly, both
binding ones' multipliers are positive, and the Lagrangian's Hessian is
positive definite on the directions that keep them), and on 2026-11-03 a
general constrained solver from 60 random starts found no smoother one. The
path scores 1.032 on the criterion. The 2026-11-02 path, which smoothed
2025 alone and held the two 2026 statements at their midpoints (Jan 1-Mar
24 at 7,172 a day, 6,181 from Mar 25; June-December 45,892 / 64,849 /
95,252 / 120,825 / 168,940 / 219,441 / 253,452), scored 1.056 on the same
months. The 2026-10-31 reshape had taken both 2025 statements as exact (the
crossing on Dec 4, Dec 31 at 1.3M): December 338,181 miles, 10,909 a day
against January's 6,774, and June 41% lower than its earlier shape; on the
2026-11-02 criterion its path scored 1.45 and the earlier shape (the
crossing on about Nov 22, which Fortune's vaguer Dec 17 wording had seemed
to allow) 1.68.

The June-December 2025 bands are California plus half to twice the Las
Vegas share, the allowance the early rows give an unmeasured Las Vegas
split (and `data/waymo_vmt.py` an unmeasured split over more than six
months), within what the statements allow: each month inside the
difference of its lifetime cumulative bands, swept from May 2025's lifetime
band (its series band plus the pre-series band) with knots at November (the
crossing: not before Dec 1, and by the end of Dec 7 with December's miles at
most its California high plus twice its Las Vegas share, 463,842, spread
evenly: 895,261-1,000,000 lifetime)
and December (1.25M-1.35M), edges rounded outward. They hold both earlier
shapes of these months, the 10e2343 rows and the 2026-10-31 reshape, except
December's 10e2343 value, 245,852, which the statements rule out: December
is at least 250,000, 1.25M at Dec 31 less 1M at Nov 30. On the series basis
November's cumulative band is that crossing knot, 835,274-969,873, and
narrows August-October's upper edges back from it. From November 2025 on
every Zoox cumulative band carries the pre-series band's width, 29,859 miles
(floored), which the app's window band adds back once for a window whose
month before it is November 2025 or later (Waymo anchors, above).
`quals/zoox-vmt-model.qual.mjs` recomputes the path, its bands and every
cumulative band; `quals/zoox-vmt-provenance.qual.mjs` pins the crossing.

The 2026 rows are the same path's (since 2026-11-03): one Las Vegas rate a
driving day each month, which the path holds at December 2025's 6,500.65
from January on. California is CPUC's driverless pilot miles × 1.19 for the
DMV-reported driverless miles CPUC misses, an assumption: 1.19 is the
midpoint of 1.05-1.33, the measured DMV/CPUC ratio having fallen from 3.97
to 1.33 over Apr-Nov 2025 (the Dec-2025 row, built on the DMV's own figures,
implies 1.33). CPUC measures driverless pilot miles through September.
Zoox filed 69,125.74 miles in July, 70,865.34 in August and 69,362.69 in
September under permit 0038380-P. These are `TotalVMTZEV` for months 7–9
in `AV Pilot 2026Q3/Zoox/Driverless/Q3_2026_CPUC_PUBLIC_Driverless_Month-Level.csv`
(member SHA256 `8b713dd61713d7b37a33a6dbf510f45d686a1091f0099495c9bc79ad470a0c5c`).
[CPUC Q3 pilot filing (ZIP)](https://www.cpuc.ca.gov/-/media/cpuc-website/divisions/consumer-protection-and-enforcement-division/documents/tlab/av-programs/av-pilot-2026q3.zip)
After September the California daily rate grows by e^0.05 each calendar month
and stays constant within the month.
January's Las Vegas passenger outage, Jan 22-26, counts as 5 days without
Las Vegas driving. Months round to 10,000: January-November 210,000 /
230,000 / 260,000 / 250,000 / 280,000 / 280,000 / 280,000 / 290,000 /
280,000 / 290,000 / 290,000. Until 2026-11-03 the 2026 rows were the per-day rate
between consecutive statements, each held at its midpoint: Jan 1-Mar 24 (83
days) the March statement's midpoint, 1.94M, less the smooth path's Dec-31
lifetime, 1.25M, 690,000 miles, 7,171.76 a Las Vegas driving day (from
2026-10-27 until 2026-11-02 less the Dec-31 statement's midpoint, 1.30M:
640,000, 6,530.74 a day), and Mar 25-Aug 5 (134 days) the midpoints'
difference, 1,160,000, 6,180.83 a day, held flat after Aug 5 (220,000 /
250,000 / 280,000 / 240,000 / 270,000 / 270,000 / 280,000 / 280,000 /
280,000 / 290,000). Through August 2026 bands follow the statement-based
formula in "Ghost months" above. Its h is in months of 30.44 days, from the
midpoint of the stretch between the two statements around the month (the
mean of its first and last days: Feb 11 for Jan 1-Mar 24, which governs
January-March, and the end of May 30 for Mar 25-Aug 5, which governs April
through August) to the month's mean day (Jan 16, Feb 14.5, ...).
`quals/zoox-vmt-model.qual.mjs` recomputes every row, band and cumulative
band from June 2025 from these inputs.

### Tesla's no-monitor line

Tesla's own publications since October 2026 (the robotaxi safety page,
tesla.com/robotaxi/safety, live Oct 21, 2026, and the Q3-2026 deck) report
miles and crashes only for driving with no safety monitor in the vehicle, so
beside "Tesla" (every operator mode, monitor aboard or not) the page plots
that subset as a line of its own, `TeslaNoMonitor` in the app.

- Miles: the `teslanomonitor` rows of `data/vmt.csv`, January 2026 (the
  service began Jan 22) on. The safety page gives weekly cumulative miles per
  city; a month takes the city sums at its end, interpolated within that
  week. The Q3-2026 deck's chart "Cumulative Unsupervised Robotaxi Miles" is
  the second reading. Central: the page; band: the two readings widened 3%
  each way, the lower edge at least half the page's figure. That is the rule
  of the months Tesla's page has measured whole, January to September 2026.
  October and November 2026, which the page measures through Oct 18 and not
  at all, follow "Ghost months" above (the Tesla bullet): the page's miles
  where it has them, then the estimate from Robotaxi Tracker's camera counts
  ([Robotaxi Tracker](https://robotaxitracker.com), https://robotaxitracker.com).
- Crashes: the in-scope Tesla reports on Tesla's own list of SGO reports
  "while Robotaxi is driving autonomously with no safety monitor in the
  vehicle" (the page's spreadsheet download; `TESLA_NO_MONITOR_REPORTS` in
  `slurp.py`, 32 reports as of the Oct 18, 2026 spreadsheet, 15 of them newer
  than NHTSA's Oct-15 file), and the reports newer than Tesla's latest list
  whose narratives name no monitor (`TESLA_NO_MONITOR_ADDITIONS`, each with
  the narrative's words and the receipt cutoff of the release whose review
  added it, until a list holds them; "Each NHTSA release", step 7). Scope is
  the company line's: the crashes a remote human drove
  (`TELEOP_DRIVEN_REPORTS`) count on neither line, though Tesla's list
  includes them. `TESLA_MONITOR_ABOARD_REPORTS` holds the 2026 reports whose
  narratives put a monitor aboard, each with the words that do.
- Coverage: what Tesla's rows take, since the line's reports are a subset
  of Tesla's filings: complete where NHTSA's file is complete for Tesla's
  month; in a month Tesla's own list covers,
  the list's share of the line's own miles (Preprints, below: in October 2026
  53.3% on this line against 52.6% on the all-modes line, whose
  monitor-aboard miles the list does not cover); pending otherwise.

Driver's-seat trips (disclosed since 2026-10-31, the human's answer to open
question 13). The every-mode line's miles for September 2025-June 2026 may
include trips with a safety monitor in the driver's seat: "Safety monitors
are only in the driver's seat for trips that involve highway driving, as a
self-imposed cautious first step toward expanding to highways" (@robotaxi on
X, Sep 4, 2025, https://x.com/robotaxi/status/1963436732575072723); "This was
also my 5th ride in a row with the supervisor in the drivers [seat]" (David
Moss on X, Jan 28, 2026, https://x.com/DavidMoss/status/2016300508160418209,
the post's text cut at "drivers" where X shortens it); of his 42 rides,
"all of them had supervisors not just up front, but behind the wheel"
(Gizmodo, Jan 29, 2026,
https://gizmodo.com/elon-musk-made-tesla-fans-think-unsupervised-robotaxis-had-arrived-they-cant-find-them-2000715299).
If such a trip ran as FSD (Supervised), a Level 2 system, its crash is
reportable only under the Third Amended SGO's Level 2 triggers (Request No.
1.D: a fatality, a hospital transport, a struck vulnerable road user, an
airbag deployment, or "Vehicle tow-away, if the crash involved a subject
vehicle equipped with an ADS"; the order counts "a tow-away of or air bag
deployment on any vehicle involved in the crash, regardless of whether the
tow-away or air bag deployment involved the subject vehicle", so the towed
vehicle need not be the one with the ADS; NHTSA, dated Apr 24, 2025,
https://www.nhtsa.gov/sites/nhtsa.gov/files/2025-04/third-amended-SGO-2021-01_2025.pdf,
pp. 12-13) and goes to NHTSA's Level 2 file, none of whose Tesla reports the
page counts. The miles stay in the denominator, so the every-mode line may
understate Tesla's crash rate by an amount no public source measures; the
no-monitor line, whose miles exclude every monitor-aboard trip, avoids it.
The rationales of the Tesla rows for those months say so.

## Preprints

A preprint is a crash report as its company has published it, for a report
NHTSA's files do not hold yet (since 2026-11-18; the human: "can we add the
new incidents, style them in a clear way to show they're not official yet,
and incorporate them in a fully principled way?"). There is one source of
them: Tesla's robotaxi safety page (https://www.tesla.com/robotaxi/safety)
links, under "Download all SGO reportable events", a spreadsheet of every
collision Tesla reported to NHTSA "while Robotaxi is driving autonomously
with no safety monitor in the vehicle, including when a remote operator is
assisting or has taken control", under NHTSA's own Report IDs. NHTSA's file
of a given release holds the reports it had received by the 15th of the
month before, so Tesla's list runs ahead of it: the list of Oct 18, 2026
held eight October crashes (13781-17203 and 13781-17299 to -17305) that the
Nov-16 release, of reports received through Oct 15, did not. Their Report
IDs, from the one sequence NHTSA numbers every company's reports in, are
above that release's highest (30610-17196): Tesla had filed them, and NHTSA
had not published them.

- **The file.** `data/snapshots/tesla-list-YYYYMMDD.xlsx` is the spreadsheet
  as Tesla serves it, named for the date the list runs through
  (`PREPRINT_LIST` in `slurp.py` holds that date, the address and the miles
  below). `slurp.py` reads the newest one (`read_list_cells()`, by the
  standard library) and maps each row onto NHTSA's columns (`list_row()`):
  the month of its date, its place, road, weather, crash partner, severity,
  speed, damage areas, airbag text and narrative. The list gives no time, no
  pre-crash movements, no belt field, no report type or version and no
  operator type: the first four are blank, a list row's type is "Preprint",
  its version 1, and its operator type "None", the list's own definition (a
  remote operator who drove is named in the narrative, which the
  teleoperator tripwire reads). A preprint's blank movement shows on the
  page: the sanity section's Reporting threshold table counts the records
  with no stated movement (a blank, or NHTSA's own "Unknown") in a column of
  their own, right after "AV stopped" (`crashla.js` `SV_MOVEMENT_UNKNOWN`,
  since 2026-11-21; until then they counted as not stopped without a word,
  though three of the eight preprints' narratives say the car was stopped),
  until NHTSA's row, which states the movement, replaces it.
- **NHTSA's row stands.** A list row whose Report ID an NHTSA file holds is
  dropped; the others are the preprints (`preprint_rows()`). So a preprint
  turns official at the release that publishes its report, with no code
  change ("Each NHTSA release", step 7, has the two things to do then).
- **Same checks, same raters.** A preprint goes through scope, the narrative
  tripwires, the reviewed tables and the blind fault raters as an NHTSA row
  does (the raters' case reads "not stated" for the time and the movements).
  Its record in `data/incidents.js` carries `preprint: true`, and the
  incident browser sets its row apart and says what it is.
- **The list's record against NHTSA** (`quals/preprints.qual.mjs`): each of
  the 24 list rows NHTSA had published by 2026-11-18 agrees with a filed
  version of its report on month, place, road, weather, crash partner,
  severity, speed, airbags and contact areas; 23 narratives are NHTSA's word
  for word (its redactions aside) and one differs by a word (13781-17015:
  the list's "proceeding straight through a work zone" is "proceeding
  straight near a work zone" in NHTSA's filing).
- **Coverage** (`preprint_coverage()`). For the month the list runs through,
  the list holds every no-monitor crash through its date and none after: a
  known set of crashes over a known span of miles. So, while NHTSA's file is
  not complete for that month (the list's month is the data-through month),
  each Tesla line's row for it counts the list's span: receipt coverage = Tesla's
  no-monitor miles of the month through the list's date (`PREPRINT_LIST`'s
  `miles`: 1,179,333 for Oct 1-18, 2026, Tesla's page's figure, which
  `quals/preprints.qual.mjs` holds to the quals' one copy of it,
  `quals/tesla-page-part.mjs`) over the row's miles, best, low and
  high alike (0.5334 on the no-monitor line; 0.5255 on the all-modes line,
  whose monitor-aboard miles the list does not cover and which therefore
  count for nothing that month); and Monthly-track incident coverage = the
  share of Tesla's Monthly reports that reached NHTSA on time, over
  `MONTHLY_ARRIVAL_OBSERVATIONS`' months with both counts measured (17 of
  19 = 0.8947), from that share's Wilson 95% lower bound (0.6861) to 1: a
  list drawn up two days after its last crash can lack one Tesla files
  late. Once NHTSA's file is complete for the month (the release after),
  the row is NHTSA's: complete, whatever the list says (`month_sources()`).
  With no list for the data-through month, that month is pending for
  Tesla's lines as for any company's. (Until 2026-11-21 NHTSA's file had an
  estimated coverage of the data-through month, and a row took whichever
  source held more of it, by the product of the two best values.)
  `data/vmt.js`'s `incidents_through` column gives each row's date.
- **Known limits.** The coverage columns scale the row's whole-month band,
  whose width comes from the days after the list's date, so the covered
  miles get a band of -13%/+17% (no-monitor) and -14%/+31% (all modes;
  -12%/+15% and -13%/+30% until 2026-11-20, when the camera-estimated days
  took a drift term) where the measured miles warrant about -8%/+3%; exact would take columns
  for the covered miles' own band. A preprint dated after NHTSA's
  data-through month stops the run, and so does a list dated in a later
  month (a month only a list covers has no rule
  yet). A crash of the list's month that the list lacks, a reviewed
  no-monitor addition ("Each NHTSA release", step 7) or a monitor-aboard
  report on the every-mode line, is pending (`record_counted()`; until
  2026-11-21 it stopped the run, `check_list_covered_rows()`): the list's
  coverage fits the list's own crashes (its miles
  through the list's date, less the allowance for crashes Tesla files late,
  the every-mode line's other miles counted as uncovered), and neither is
  one of them. Once NHTSA's file holds the list's month whole, at the next
  release, that month's rows are complete and the line's crashes
  of the month are the list's and the additions'
  (`quals/tesla-monitor-review.qual.mjs` builds that release). A report
  rated from its preprint is rated again when NHTSA files
  it: its case changes, and `faultrate.py` rates every report whose case
  has changed (step 5).

## Fault CSV synchronization

The `faultfrac.csv` file is partly the blind raters' ratings and partly mirrored NHTSA data.

Their schema is:

```text
reportID,speed,crashwith,svhit,cphit,severity,faultfrac,reasoning
```

The rule is:

- The first six columns come from the latest deduplicated NHTSA master data
- The last two columns (`faultfrac`, `reasoning`) come from
  `data/fault-ratings.csv`: the median of the incident's three blind ratings
  and the median rater's one line. `data/faultrate.py` writes them and nobody
  edits them (`quals/fault-ratings.qual.mjs`; until 2026-11-17 they were
  agents' judgments, batch by batch, with adjudication and a few overrides)
- `faultfrac` is on a 0.05 grid (0, 0.05, 0.1, ..., 1): the page sums fault
  values in twentieths and refuses any other value, rendering nothing, so
  `data/slurp.py` stops on a value off the grid or outside 0-1
  (`quals/fault-grid.qual.mjs`)
- `reasoning` is a rater's English (one line of at most 80 characters, as
  `data/fault-criterion.md` asks), so the page shows it as AI text,
  opened with `AI_TEXT_PREFIX` ("Claude: ") in both places it appears: the
  fault cell's tooltip, which is plain text, and the fault line under the
  opened narrative, which is the line's own label (`NARRATIVE_FAULT_LABEL`),
  a space and the tooltip's text, with the labelled reasoning green
  (`AI_TEXT_PREFIX` inside the green span; `NARRATIVE_FAULT_LABEL`, the
  fault fraction and the contact areas outside it, plain)
  (`quals/ai-text-labels.qual.mjs`; the human's answers of 2026-11-03)

When `data/slurp.py` runs, it loads the fault fractions first, and
synchronizes the first six columns of `faultfrac.csv` from the live NHTSA
master rows at the end, with `data/incidents.js` and `data/vmt.js`, once
every check has passed (until 2026-10-31 it synced them before most of its
checks, so a run that stopped could leave the file rewritten).

That means:

- contact-area formatting stays consistent across models
- speed / crash partner / severity stay aligned with the latest NHTSA version
- the judgment columns `faultfrac` and `reasoning` are preserved

## What the checked-in NHTSA CSV files are for

`data/snapshots/nhtsa-2025-jun-dec.csv` and
`data/snapshots/nhtsa-2025-jun-2026-jan.csv` are archival snapshots only.

Those two files are legacy current-CSV snapshots that predate the timestamped
snapshot scheme.

They are useful for:

- Historical reference
- Manual inspection
- Comparing an older snapshot against the latest live NHTSA fetch
- The release history: they are NHTSA's Jan-2026 and Feb-2026 releases, the
  first to hold December 2025's and January 2026's incidents;
  `quals/monthly-arrival-lag.qual.mjs` (when each Monthly-track report
  arrived) and `quals/assumptions-list.qual.mjs` (whether any five-day-track
  report of a month first appeared after its second release) read them with
  the timestamped snapshots when they recount that history

They are not parsed as incident inputs in the current build pipeline.
The only code-path interaction in `data/slurp.py` is that it may compare a
fetched current NHTSA CSV against the latest legacy current snapshot to avoid
writing an immediate duplicate when the timestamped snapshot scheme is first
used.

## Why snapshot counts can disagree with `incidents.js`

Because `data/slurp.py` fetches live data from NHTSA, `data/incidents.js` can legitimately differ from the checked-in archival snapshots.

One important case is June 2025 coverage: some June incidents appear only after merging the live current CSV with the live archive CSV.

So if the checked-in archival snapshot and `data/incidents.js` disagree, that does not by itself mean the app is wrong. It may just mean the snapshot is older than the live fetch used to generate `data/incidents.js`.

`data/incidents.js` also counts AV involvements, not reports: a crash one report files for two of a helmer's AVs is two records (the second's id is the Report ID + "-B"; `SECOND_INVOLVEMENTS`), and it holds the one ADS-driven report NHTSA filed in its ADAS file (30270-14303), which no ADS snapshot holds.

## Snapshot storage policy

Every live upstream fetch is archived in `data/snapshots/`.

That includes:

- the raw current NHTSA ADS CSV
- the raw archive NHTSA ADS CSV
- the raw current NHTSA Level 2 (ADAS) and OTHER CSVs (since 2026-10-31, the
  release of Oct 15, 2026; slurp reads only `MISFILED_ADS_REPORTS` from them).
  Their first snapshots, `nhtsa-adas-20261031T002218.csv` and
  `nhtsa-other-20261031T002218.csv`, are the files the 2026-10-31 research for
  open question 1 downloaded at that time, byte for byte (MD5 equal to NHTSA's
  ETags, bd1851bc87845049b3aa4dc87bfe2617 and
  9f95c03bb060934a07956c960cec9ccf; Last-Modified Oct 15, 2026 12:30 GMT)

`data/snapshots/` also holds Tesla's own list of the crashes it has reported
(`tesla-list-YYYYMMDD.xlsx`, since 2026-11-18: "Preprints" above), each list
as Tesla served it and named for the date it runs through. A run reads the
newest and fetches none; a person saves each new one ("Each NHTSA release",
step 7). The first, `tesla-list-20261018.xlsx`, was downloaded on 2026-11-18
(Last-Modified Oct 20, 2026 21:22 GMT; MD5 equal to the server's ETag,
6d688f725e00740281b937a5ffc8ee19).

`data/snapshots/` also holds Robotaxi Tracker's Camera watch tables
(`robotaxitracker-cameras-YYYYMMDD.tsv`, since 2026-11-20; credit
[Robotaxi Tracker](https://robotaxitracker.com), https://robotaxitracker.com,
the page https://robotaxitracker.com/cameras), each the bytes a person
copied from the page's "Show data" table in a browser, named for the local
date it was saved. No script fetches the site (its terms forbid scraping and
its robots.txt automated harvesting): `data/slurp.py`'s camera step ("Ghost
months", the Tesla bullet) saves a copy only when it differs from the newest
saved table, and never over a saved table (a different second copy the same
day stops with nothing saved), and the quals read the newest
(`quals/camera-table.mjs`). The first,
`robotaxitracker-cameras-20261120.tsv`, is the table the human saved on
2026-11-20 (sha256
d448dffba9a55ac0a00e465e595d569f350ffd2aa649457b7020b42fc732a384). If
Robotaxi Tracker's owner declines this site's use of its figures (AGENTS.md,
open question 39), the tables come out with them.

(The `vmt-sheet-*.csv` snapshots are historical: they archived the VMT Google
Sheet export back when that sheet was the master. The master now lives at
`data/vmt.csv`, where git history serves as the archive, so no new VMT
snapshots are written.)

If a newly fetched CSV is identical to the latest stored snapshot for that
source, no new file is written.

If the fetched CSV differs from the latest stored snapshot for that source, a
new timestamped snapshot file is created.

New snapshots use timestamped filenames like `nhtsa-current-*.csv`,
`nhtsa-archive-*.csv`, `nhtsa-adas-*.csv` and `nhtsa-other-*.csv`.

For the current NHTSA CSV, `data/slurp.py` still compares against the latest of
the two legacy `nhtsa-2025-*.csv` snapshots until a timestamped
`nhtsa-current-*.csv` snapshot exists.

The goal is that every distinct fetched upstream CSV is preserved as a file in
the repo.

## Provenance comments

- `data/incidents.js` and `data/vmt.js` carry top-of-file provenance comments
- raw files under `data/snapshots/` intentionally do not get in-band comments,
  because those files are meant to remain archival snapshots of the fetched
  upstream bytes
- `data/faultfrac.csv` and `data/vmt.csv` stay plain CSV; their provenance is
  documented here instead of being encoded with a nonstandard CSV comment
  convention

## Practical source-of-truth rule

If the question is "what data does the app currently use?", the answer is:

- `data/incidents.js` and `data/vmt.js` are the generated artifacts the app uses at runtime
- `data/slurp.py` is the code that regenerates those artifacts from live NHTSA data plus the local masters
- `data/vmt.csv` is the in-repo master for VMT estimates; `data/fault-ratings.csv` holds the blind raters' fault ratings, from which `data/faultrate.py` writes `data/faultfrac.csv`'s fault values
- the checked-in `nhtsa-*.csv` files under `data/snapshots/` are archival snapshots, not inputs to the current slurp run

## Regeneration

To regenerate the app data, run:

```bash
python3 data/slurp.py
```

That command requires network access because it fetches NHTSA data live.
VMT comes from the local `data/vmt.csv` master, so no Google access is needed.

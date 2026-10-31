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
plus processing). The share of that month's five-day-track incidents the
release holds, its receipt coverage (best, lo, hi), is estimated from the
month itself (`release_month_coverage`, since 2026-10-31), as the pooled
Monthly-track incident coverage below is: observed = the month's in-scope
five-day-track incidents in the release (an incident's track is its first
filing's Report Type); expected = each company's five-day-track count in its
most recent earlier month with at least 3 of them and miles (final at this,
its second normal release), scaled by miles, pooled over the companies with
miles in the month (a company with no such month stays out); best =
observed / expected, lo = best ×
exp(−1.96 √(1/observed + 1/reference)), and hi = `FIVE_DAY_RECEIPT_COVERAGE_MAX`
(0.52), the highest share a first release has held, padded: the reading in
which the month's low count is real rather than lagging. September 2026, in
the Oct 15 file: 7 observed (all Waymo) of 51.6 expected (Waymo's August, 46,
and Zoox's June, 4; Tesla has no month with 3), (0.1356, 0.0615, 0.52). Until
then the coverage was the median of earlier months' first-release shares,
(0.28, 0.20, 0.52), right only if that share held steady; it fell from 0.50
in February 2026 to 0.21 in August. Those shares are still measured from
`data/snapshots` history, as the share of a month's eventual five-day-track
incidents present in the first release containing that month
(`FIVE_DAY_RECEIPT_OBSERVATIONS`: Dec 2025 0.24, then Jan 0.33, Feb 0.50, Mar
0.35, May 0.28, Jun 0.28, Jul 0.21, Aug 0.21 of 2026; Dec and Jan, whose first
releases are the two legacy snapshots, entered 2026-10-31), and they set the
high edge. April 2026 is excluded
because its first release, May 15, was truncated. A month's denominator is
final at its second normal release, so one observation is added per release,
one release in arrears. The Monthly-track metrics' exposure does not depend on
the receipt estimate: their incident coverage is conditional on the receipt
best, so the product is the month's all-incident observed / expected.

Monthly-track (SGO Request No. 2) reports for a month are due by the 15th of
the next, so they normally reach the file at the month's second release, and
the app treats the month as complete from then on. Some companies' arrive
later: every in-scope Zoox Monthly-track report of January-July 2026 arrived
one release after that, so in the Sep 15, 2026 file Zoox's July held only its
one 5-Day report. `MONTHLY_ARRIVAL_LAG` in `slurp.py` is each company's extra
lag in releases (all 0 since the Oct 15, 2026 file, which held every
company's August reports, Zoox's included; Zoox's was 1 before), next to the
observations it is measured from (`MONTHLY_ARRIVAL_OBSERVATIONS`: per company and incident month, the
in-scope Monthly-track incidents by the release at which they first
appeared). The months inside a company's lag get Monthly-track incident
coverage = its in-scope 5-Day share instead of 1
(`FIVE_DAY_SHARE_OBSERVATIONS`; while Zoox was lagged, Jan-Jun 2026: 17 of 27
= 0.63, band from the lowest month, February's 0.25, to 1.0); five-day-track
metrics are unaffected. The run stops if a lagged company's lagged month
already holds a Monthly-track report (checked before the share tables, since
it means the lag itself is wrong), if a table disagrees with the newest file,
or if a month that has become measurable has no observation.
`quals/monthly-arrival-lag.qual.mjs` re-measures the tables from
`data/snapshots` (its embedded script is the measurement recipe).

It also reads two local input files:

- `data/vmt.csv` — the in-repo VMT master (see "VMT master" below)
- `data/faultfrac.csv` — the fault-fraction judgments

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
   for any other Waymo, Tesla or Zoox report an ADS could have driven (above)
3. Validate every row against the whitelists (report type, operator type,
   reporting entity, severity, date formats), the per-helmer operator scope
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
5. Filter the surviving versions to the operator modes whose miles are in each company's VMT denominator (`PUBLIC_SERVICE_OPERATOR_TYPES` / `EXCLUDED_OPERATOR_TYPES` in `slurp.py`: `"None"` and `"Remote (Commercial / Test)"` for all three, plus `"In-Vehicle (Commercial / Test)"` for Tesla, whose deck miles include monitor-aboard miles; Waymo/Zoox safety-driver modes are excluded because their miles are not in those denominators; `"Other, see Narrative"` is classified per report via `OPERATOR_TYPE_OVERRIDE`), drop crashes in which a remote human was driving (`TELEOP_DRIVEN_REPORTS`, guarded by a narrative tripwire) and reports a re-filing under a new Report ID replaced (`SUPERSEDED_REPORTS`; only from rows that hold the re-filing, so an earlier release's snapshot, from before it, keeps the original when the quals recount it), then keep one report per `Same Incident ID`. Two in-scope reports under one Same Incident ID stop the run, and so does a helmer's out-of-scope filing under an in-scope report's Same Incident ID (a re-filing that may have moved the crash out of scope), until `SUPERSEDED_REPORTS` says which report stands or `SPLIT_SAME_INCIDENT_REPORTS` lists one as another crash or vehicle (since 2026-10-31; until then the higher `Report Version` won, though different Report IDs' versions share no scale). Other reporting entities' filings are never in scope, so a duplicate one files (Transdev, Waymo's fleet operator) can neither displace nor retire a helmer's report (`quals/same-incident-dedup.qual.mjs`). Then each crash one report files for two of a helmer's AVs gets a record for the second AV (`SECOND_INVOLVEMENTS`, since 2026-10-31; decision #47 of 2026-10-04: each AV involved counts, as in the crashed-vehicle human benchmarks and Waymo's own crash list, hub CSV2, which lists each such report twice; two AVs that each filed a report, as in Atlanta in August 2026, already counted twice): the report's crash-level fields and their overrides (severity, airbag, place, vehicles involved), the second AV's own speed, movements, crash partner, passengers and contact areas as the narrative gives them, the Report ID + "-B", `secondOf` naming the report (the incident browser marks the row), and a fault row of its own. A narrative that names a second AV of its company (`SECOND_AV_PATTERN`) stops the run until the report is in `SECOND_INVOLVEMENTS` or in `SECOND_AV_REVIEWED` with the reason (`quals/second-involvements.qual.mjs`). The receipt and Monthly-track coverage counts read the reports, since they measure when reports arrive
6. Read the VMT master from `data/vmt.csv`: an incident month newer than its
   newest month stops the run, and so does a missing ghost month (see "Ghost
   months" below): at least the month after the data-through month, a row
   for every line in each, and none for a month that has not begun
7. Load the fault fractions from `data/faultfrac.csv`, checking their values
   (0-1, on the 0.05 grid) and that every row is still an in-scope incident;
   the file's six mirrored columns are synced from the NHTSA rows only in the
   last step
8. Verify the reviewed data-through cutoff against the CSV contents (the
   newest incident month and newest submission month must both equal it),
   estimate the data-through month's receipt coverage (observed / expected,
   above), check the Monthly-report arrival tables against the release (see
   above), and restrict to the app's VMT analysis window
9. Apply narrative-verified field overrides from `slurp.py`, each keyed by
   Report ID (severity, airbag, city and state — see
   `quals/field-overrides.qual.mjs` for the pins;
   vehicles-involved — see `quals/fatality-guard.qual.mjs`; passenger
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
   audit's finding that it counts in Tesla's non-parking-lot metric). Then
   strip the narratives' fact-free filing boilerplate
   (`quals/narrative-boilerplate.qual.mjs`), join in the fault fractions,
   and list the lines each incident counts toward (`series`: its company, and
   Tesla's no-monitor line for a report on Tesla's no-monitor list; see
   "Tesla's no-monitor line" below).
   A filed severity, airbag, city, state or passenger value that no longer
   matches the one its override was reviewed against, an in-scope incident
   left with severity "Unknown" (the app counts it as no injury), an incident
   left with no city or state, an override entry that names no in-scope
   incident of the window (`quals/override-guards.qual.mjs`), an in-scope
   Tesla report with no reviewed passenger entry, a passenger entry for a
   report no longer in scope, a filed passenger code that crashla.js's three
   passenger classes do not list (`PAX_CLASS`), or a narrative that says who
   was aboard the AV ("An occupied Zoox autonomous vehicle", "unoccupied",
   "had no occupants") against its filed passenger code, unreviewed, stops the
   run, as do an in-scope Tesla report from January 2026 on that is on neither
   of the two reviewed monitor lists and an incident on a line with no
   `data/vmt.csv` row for its month (vehicles involved has no filed value to
   re-check: no SGO field counts the vehicles)
10. Stop on any in-scope incident of the window with no `data/faultfrac.csv`
    row (a second AV's record, Report ID + "-B", included), listing them all
    (since 2026-10-31, decision #4: until then an
    unrated incident was written with fault null, and the app drops its whole
    month, miles included, from every at-fault number;
    `quals/fault-batch-stop.qual.mjs`)
11. Apply the data-through month's receipt coverage (`coverage`,
    `coverage_min`, `coverage_max`) and the pooled Monthly-track incident
    coverage (`incident_coverage`, `_min`, `_max`), plus the Monthly-track
    incident coverage of the months inside each company's Monthly-report lag
    (`MONTHLY_ARRIVAL_LAG`) — the generated CSV in `data/vmt.js` carries these
    six columns after `vmt_max`; every other month gets 1. Tesla's
    no-monitor rows take Tesla's coverage, and the pooled incident coverage
    counts the companies only
12. Every check has passed: write `data/faultfrac.csv`'s six mirrored columns
    (see "Fault CSV synchronization" below), the incident data into
    `data/incidents.js`, and the VMT CSV text into `data/vmt.js`, with the
    ghost months' master rows, as they stand, in its second segment
    (`GHOST_VMT_CSV_TEXT`). A run that stops writes none of the three (until
    2026-10-31 `data/faultfrac.csv` was synced before most checks)

## Each NHTSA release

`slurp.py` stops until these are done; each stop names the step below that
covers it. A run that stops writes only the release's snapshots (pipeline
step 1), so re-run it after each step. The first four are the constants every
release needs:

1. `NHTSA_DATA_THROUGH_DATE`: the new release's cutoff.
2. `FIVE_DAY_RECEIPT_OBSERVATIONS`: the month that just became final (the
   one before the new data-through month), measured from the snapshots
   (`quals/receipt-observations.qual.mjs` recounts every row, an incident's
   track being its first filing's Report Type). `FIVE_DAY_RECEIPT_COVERAGE_MAX`
   must stay at or above every observed share: raise it when a new
   observation (or the data-through month's own observed / expected)
   exceeds it. The run also stops when the data-through month holds no
   in-scope five-day-track incident at all (a truncated release?).
3. The Monthly-report arrival table, re-measured alongside the receipt
   observations: each company's `MONTHLY_ARRIVAL_OBSERVATIONS` row for the
   month whose third release this is (data-through month - 2); a check that
   `MONTHLY_ARRIVAL_LAG` still matches each company's newest observed month;
   and each lagged company's `FIVE_DAY_SHARE_OBSERVATIONS` row for the month
   that just became final for it (data-through month - 1 - lag). If a lagged
   company's Monthly reports start arriving on time, the run stops on its
   lagged month: record that month's on-time count as its observation (for
   every company, since the rows cover the same months) and set the lag. On
   the Oct 15, 2026 release Tesla's July tie (one report on time, one late)
   read as a lag of 1, but its and Zoox's August reports had all arrived, so
   2026-08 entered early and every lag went to 0. A row entered early holds
   on-time counts only: re-measure it, late column included, at the month's
   third release (for 2026-08, the Nov 2026 release).
4. `data/vmt.csv`: every line's row for the month after the new
   data-through month, its ghost month (see "Ghost months" below; the month
   in progress on release day), and a re-read of the previous ghost month's
   rows, which become the new data-through month's. The run also stops on an
   incident month newer than the master's newest month, and on an incident
   on a line with no row for its month (a new month with no `teslanomonitor`
   row).

Then what the release brings:

5. `data/faultfrac.csv`, the fault batch: a row for every new in-scope
   incident, rated under the fault criterion. slurp stops and lists the
   unrated Report IDs (since 2026-10-31, decision #4); the batch reads their
   filings from the newest snapshot, which the stopped run has saved:

   ```bash
   python3 -B -c "
   import sys; sys.path.insert(0, 'data'); import slurp
   rows = slurp.filed_incident_rows(slurp.newest_snapshot_rows())
   inc = list(slurp.public_service_incidents(rows).values())
   inc += slurp.second_involvement_rows(inc).values()
   unrated = slurp.unrated_reports(inc, slurp.parse_vmt_months(slurp.read_vmt_master()),
                                   slurp.load_fault_data()[1])
   for r in unrated: print(r['Report ID'], r['Incident Date'], r['Narrative'])"
   ```

   `slurp.fault_master_row(r)` gives a new row's six mirrored columns (for a
   second AV's row, Report ID + "-B", its own fields and its report's filed
   severity). The
   run also stops on a row whose report is no longer an in-scope incident (a
   later filing re-coded or retired it, or a re-filing replaced it): find
   out why, then delete the row, as for 30270-8403, -14625 and -4881. A
   fault value off the 0.05 grid, or outside 0-1, stops it too.
6. The narrative reviews, each a table in `slurp.py` with the narrative's own
   words beside its entry: a value outside a whitelist (`EXPECTED_*`; a new
   severity also needs `crashla.js`'s `SEVERITY_INFO`) or an unclassified
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
   Incident ID (`SUPERSEDED_REPORTS` / `SPLIT_SAME_INCIDENT_REPORTS`); an
   in-scope incident filed severity "Unknown" (a `SEVERITY_OVERRIDE` entry
   from its narrative, the 2026-07-15 convention: a hospital transport is
   "Minor W/ Hospitalization", an injury without one "Minor W/O
   Hospitalization", none mentioned "Property Damage. No Injured Reported";
   Tesla's 13781-17203, filed Unknown with the other driver taken to a
   hospital, is due in the Nov 2026 release); a re-filing that changes a
   value an override was reviewed against (severity, airbag, city and state,
   passenger code, operator type: re-read the narrative), and an override
   entry that names no in-scope incident of the window; an incident with no
   city or state (`LOCATION_OVERRIDE`); a new in-scope Tesla report
   (`PASSENGER_OVERRIDE`, from its narrative, and `TESLA_NO_MONITOR_REPORTS`
   or `TESLA_MONITOR_ABOARD_REPORTS`: re-read Tesla's latest no-monitor list,
   below); an occupancy disagreement (`PASSENGER_OVERRIDE` /
   `OCCUPANCY_LANGUAGE_REVIEWED`); and the contact-area label check
   (`CURRENT_FILE_CONTACT_LABEL`).

Then the quals: `quals/growth-ghost-month.qual.mjs` needs the growth chart's
rows for the new ghost month (`crashla.js` `FLEET_HISTORY` and
`RIDES_HISTORY`; "Ghost months" below), and `quals/fleet-forecast.qual.mjs`
then checks each Jan-1 fleet forecast against them. Re-pin the knife-edge
verdicts in `quals/stress-test.qual.mjs` as its comments say.
`quals/tesla-no-monitor.qual.mjs` pins Tesla's list, the monitor-aboard
list, the line's crashes by month and its miles by month, and goes red on a
new no-monitor crash or row until they are re-pinned.
`quals/passenger-classification.qual.mjs` checks the riders a release's
Tesla reports carry against their `PASSENGER_OVERRIDE` entries (since
2026-10-31; until then it pinned the list of Tesla reports with a rider,
re-pinned each release); a Tesla narrative that says nothing about who was
aboard (13781-16941, due in the Nov 2026 release) fails its narrative check
whatever is stored, until a human decides what such a report stores.

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
  The page shows it verbatim (sanity section, "VMT sources"), so it cites
  documents by file and section ("data/README.md, Waymo anchors";
  "IGNOREME.md, Waymo VMT Methodology"), avoids this file's column names and
  other repo shorthand, and states the anchors its rows carry
  (`quals/vmt-rationale-text.qual.mjs`)

To change VMT data: edit `data/vmt.csv`, run `python3 data/slurp.py`, and
commit the master together with the regenerated artifacts.

### Ghost months

A ghost month is a month after NHTSA's data-through month for which
`data/vmt.csv` holds rows: the month in progress, or a finished month no
NHTSA release has reached yet. `slurp.py` (`ghost_vmt_csv`) copies their rows
as they stand into `data/vmt.js`'s second segment, `GHOST_VMT_CSV_TEXT`, and
the page draws them faded, with a dashed stretch of line, on the VMT charts
(each company's and the combined one) whenever the date window ends at the
newest NHTSA month; in those windows the sanity section's VMT sources table
lists their rationales too, after each line's analysis months, each headed
by the ghost tooltip's note. No rate uses a ghost month's miles: its crashes are not
yet published, so its rows stay out of the analysis rows, the slider and
every other chart until a release brings its incidents. The run stops when
the master lacks the month after the data-through month, when a ghost month
lacks a line's row, and on a row for a month that has not begun (a VMT row
records miles already driven; forecasts live in `crashla.js`'s
`MILES_FORECAST`). `quals/ghost-month.qual.mjs` pins all of it.

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
so re-derive both whenever that row changes. `quals/growth-ghost-month.qual.mjs`
pins all of it.

So each release adds every line's estimate for the month after its
data-through month, a month that has begun by release day. When the next
release arrives, that month becomes its data-through month and its band
becomes the VMT prior of every rate, so re-read the rows then.

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
  week). The rest is projected from the last published weeks as the
  geometric mean of two projections: the geometric mean of holding the last
  week flat and continuing its growth, and continuing the three-week growth.
  The projected part's range is that projection times e^(±0.30 √(h/7)), h
  being the days from the last published Sunday to the month's end
  (×0.66-1.51 at 13 days, ×0.53-1.88 at 31), combined with the measured part,
  with a log term for the gap between Tesla's page and its deck added in
  quadrature: 0.066, 1.96 times the root mean square of the monthly
  ln(deck / page) over April-September 2026 (about 6.8%). The 0.30 is a judgment, about 1.5 times what steady-growth
  weeks needed; it held every all-city 7-31-day stretch from late April to
  early October 2026, a regime of 1-30% weekly growth. When the page is more
  than five weeks behind the month's end, or a new city or vehicle type puts
  a launch-sized step in one of the last three published weeks, a human
  sets the central, with at least ×0.5-2 on the unmeasured part.
- Tesla, every operator mode: floor = the no-monitor line's floor;
  central = the no-monitor central plus June 2026's measured monitor-aboard
  remainder (33,000 miles); top = the central × e to the root-sum-square of
  ln(no-monitor top / no-monitor central) and ln(1.27 × no-monitor central /
  central), a monitor-aboard share at or below June's 21% (for July-September
  this gives their tops within 1.2%).
- Waymo: each term of the latest row at its per-day rate for the month's
  days, plus documented openings and pauses (for October 2026, among them
  Waymo's Oct 27 expansion, https://waymo.com/blog/shorts/more-places/, and
  Alphabet's Q3 remarks of Oct 28, "more than 300 million fully autonomous
  miles",
  https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q3-2026/);
  band ×e^-(0.17 + 0.028k) to ×e^(0.15 + 0.02k), k being the months from
  the end of the latest quarter both CPUC and the hub have measured to the
  end of the month (k = 4:
  ×0.75-1.26), from four-month-ahead backtests on CPUC's monthly California
  miles and the hub's quarterly county miles.
- Zoox: the per-day rate between Zoox's two latest cumulative statements,
  California (CPUC driverless miles × 1.19 for the DMV-reported miles CPUC
  misses) grown e^0.05 (about 5.1%) a calendar month from its last CPUC
  month and the rest held flat unless a dated, quantified change is known (a
  reported pause of known length removes its days); band ×e^(-1.96σ) to
  ×e^(1.96σ′) on the month's rounded miles, edges rounded to 1,000, with
  σ = √(0.065² + 0.07²h + 0.09²) (statement rounding, drift, month noise),
  σ′ = √(σ² + 0.10²) while fleet growth is announced but unquantified, and h
  the months from the governing window's midpoint to the month's midpoint
  (definitions in "Zoox anchors" below). Every Zoox constant is a prior: one
  measured change in Zoox's rate exists. The same method sets Zoox's
  analysis months from January 2026 ("Zoox anchors" below).

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
1.058x in Q2, cause unknown. Extension months built from a CPUC-basis
California estimate multiply it by 1.058 [1.040, 1.076].

Pre-series offset (a range since 2026-10-31, decision #49b of the 2026-10-04
audit). The series starts in July 2021, NHTSA's SGO reporting floor, so
every lifetime figure Waymo publishes also holds the rider-only miles driven
before it: the offset, central 150,000 (the series' convention since
2026-07-01), range 150,000-260,000. Waymo's figures set the range. Table 2
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
above.) The central sits at the range's floor: the range's middle, 205,000,
would lower every cumulative central by 55,000 miles and July-December 2021
by as much, and move no later month. A knot's series band
is its lifetime band less the offset's range, [low - 260,000, high -
150,000]: each series central sits as high in its band as the offset allows.
The
offset is the same at every knot and cancels between any two of them:
`data/waymo_vmt.py` reconciles the monthly bands on the lifetime basis,
where the series start is a knot of its own, so only July-December 2021
(2021's lifetime total less the offset) and the cumulative bands carry it.
The app's window band differences two cumulative bands (`windowVmtBand`),
which cannot see that the offset is shared, so a window that starts after a
knot is widened by up to the offset's range, 110,000 miles, at each end.

E derivation (2026-08-28): SGO crash-count proxy (the repo's own incident
data shows 1/4/9 crashes in the excluded metros in Jan/Feb/Mar 2026 and
10/8/9 in Apr/May/Jun, against ~5-8 crashes per million rider-only miles
in the benchmarked metros), cross-checked against fleet counts (TxDMV
registry; local reporting) and rider disclosures (Dallas "nearly 150,000
riders since February", Houston ">100,000", Orlando ">60,000"). Monthly
excluded-metro estimates carried in the 2026 rows: Apr 1.4M, May 1.45M,
Jun 1.8M, Jul 2.0M, Aug 2.3M, Sep 2.85M (lo/hi in the row bands). The Jun
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
`Fleetwide Data` sheet. The files retain the full measured December 2022–June
2026 series so the extraction and calibration can be checked. Before
December 2022 there is no California series, so July 2021–November 2022 is
residual only.

Run `python3 data/waymo_vmt.py` to print the rebuilt rows as JSON without
editing the master. Each knot's series central is its lifetime figure less
the pre-series offset's central (above, Waymo anchors); the hub anchors
(March 2025 on) keep their reviewed centrals, and January 2025 its one-mile
ledger residue, so no cumulative from January 2025 on moved in the rebuild.
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
monthly mileage, least of all for 2021-2022, when California had no
rider-only service to measure. The app interprets the authored edges as a 95%
two-piece log-normal prior, as for the other VMT rows.

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
| December 2021 | [Table 2: 422,400 ±600](https://arxiv.org/pdf/2505.01515) | 272,400 | 161,800–273,000 |
| December 2022 | [Table 2: 946,400 ±1,150](https://arxiv.org/pdf/2505.01515) | 796,400 | 685,250–797,550 |
| January 2023 | [1,000,000 on Jan 21](https://storage.googleapis.com/waymo-uploads/files/documents/safety/Safety%20Performance%20of%20Waymo%20RO%20at%201M%20miles.pdf), January at Jan 1-21's daily rate: 1,025,524 | 875,524 | 752,488–907,220 |
| July 2023 | [Swiss Re: 3,868,506](https://arxiv.org/abs/2309.01206) | 3,718,506 | 3,572,946–3,718,506 |
| October 2023 | ["over 7.14 million"](https://arxiv.org/abs/2312.12675) | 6,990,000 | 6,880,000–7,000,000 |
| December 2023 | [Table 2: 10,066,400 ±11,650](https://arxiv.org/pdf/2505.01515) | 9,916,400 | 9,794,750–9,928,050 |
| March 2024 (floor) | ["Over 14.8M"](https://x.com/Waymo/status/1803095329304088922) | 15,058,321 (allocated) | at least 14,540,000 |
| June 2024 | [CSV1: 22,199,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202406-2022benchmark.csv) | 22,049,000 | 21,937,000–22,056,500 |
| July 2024 | [CSV1: 25,308,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202407-2022benchmark.csv) | 25,158,000 | 25,046,000–25,165,500 |
| September 2024 | [CSV1: 33,103,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202409-2022benchmark.csv) | 32,953,000 | 32,841,000–32,960,500 |
| December 2024 | [CSV1: 50,083,000](https://storage.googleapis.com/waymo-uploads/files/documents/safety/safety-impact-data/CSV1%20-%20RO%20Miles%20per%20Location%20202009-202412-2022benchmark.csv) | 49,933,000 | 49,821,000–49,940,500 |
| January 2025 | [Paper: 56,700,000](https://arxiv.org/pdf/2505.01515) | 56,550,001 | 56,439,500–56,559,750 |

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
2024, "Over 14.8M rider-only miles driven through the end of March", is a
floor on March 2024's cumulative (and its band's low edge); the allocation
puts 15.21M lifetime there, 2.8% above it. If "Over 14.8M" truncated a
figure below 14.9M (a reading the decision that set the floor left open), the
allocation holds about 0.3-0.4M too many miles in January-March 2024 and as
many too few in April-June.

Until 2026-10-31 the June, July and December 2024 knots kept the rounded
milestones' centrals (22M, 25M and 50M less 150,000) inside envelopes
stretched to hold them, so Waymo's own CSV1 differences did not carry over:
August-September 2024 held 308,000 miles (4%) more than CSV1 has, July
109,000 fewer (audit 2026-10-30, VMT-2). They are now CSV1's figures less the
offset's central, like September 2024's: the pre-series offset is common to
every knot and cancels in their differences, and the retained centrals'
rounding gaps no longer enter the months between them. That moved 199,000
miles into the history before July 2024, Waymo's own figures' difference
from the old 22M milestone, and changed no cumulative from January 2025 on.
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
Las Vegas band, 30,127-59,987, central 40,080. The Dec-2025 cumulative is
1,300,000 - 40,080 = 1,259,920, and its band (the knot, added 2026-10-03) is
the rounding interval of "approximately 1.3 million", 1.25M-1.35M, less that
offset band: 1,190,013-1,319,873. Later months' bands chain forward from the
knot and Oct-Nov 2025's are narrowed back from it, so the band is the
disclosure's own uncertainty rather than the running sum of the monthly
bands. `quals/zoox-vmt-provenance.qual.mjs` pins the knot.

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
rounded outward: end-March 1,859,918-2,121,276. "More than" sets only a
floor: Zoox's own "more than one million autonomous miles" (Mar 11, 2026)
came when the series stood near 1.84M, so the August statement gives
end-July a floor of 2,880,483 (3.00M less the pre-series high edge and up
to 1.3x the model's miles for Aug 1-5) and no ceiling; the upper edge
chains on from March. Months between knots chain forward and narrow back
from the next knot. The as-of window is a judgment: Zoox's mileage
statements can lag, as the Mar 11 one shows.

The 1M-mile crossing (reshaped 2026-10-31, decision #12 of the 2026-10-04
audit). Zoox's CTO Jesse Levinson, at Fortune Brainstorm AI in San Francisco
on Monday, Dec 8, 2025: "Zoox crossed the 1 million mile technical threshold
for autonomous rides just last week" (Fortune, Dec 8, 2025,
https://fortune.com/2025/12/08/amazon-robotaxi-service-zoox-plans-fees-vegas-san-francisco/,
and its Dec 9 newsletter,
https://fortune.com/2025/12/09/zooxs-road-to-revenue-begins-to-materialize/;
Fortune's Dec 17 piece has "A few weeks ago",
https://fortune.com/2025/12/17/amazon-zoox-cofounder-dramatically-more-social-rival-waymo-tesla-cybercab/).
So the series plus its 40,080 pre-series miles passes 1,000,000 during Dec
1-7: the Jun-Dec 2025 rows keep California (CA DMV; December estimated) and
the Jun-Dec total, and the Las Vegas share keeps its earlier month-to-month
shape tilted by a constant factor a month, 1.2459, which puts the crossing
at Dec 4 (the middle of the week, each month's miles spread evenly over its
days). The Dec-31 knot and every row outside Jun-Dec 2025 are unchanged, and
so is every window holding all of Jun-Dec 2025 (its band too: the Las Vegas
share's total is unchanged). Until then the crossing fell on about Nov 22,
which Fortune's vaguer Dec 17 wording had seemed to allow.
`quals/zoox-vmt-provenance.qual.mjs` pins the crossing.

The 2026 rows follow one method, the per-day rate between consecutive
statements. Midpoints give 640,000 miles over Jan 1-Mar 24 (83 days) and
1,160,000 over Mar 25-Aug 5 (134 days). California is CPUC's driverless
pilot miles × 1.19 for the DMV-reported driverless miles CPUC misses, an
assumption: 1.19 is the midpoint of 1.05-1.33, the measured DMV/CPUC ratio
having fallen from 3.97 to 1.33 over Apr-Nov 2025 (the Dec-2025 row,
built on the DMV's own figures, implies 1.33). It is measured through June
and grown e^0.05 a calendar month after it, constant within a month. The
rest, mostly Las Vegas, is each interval's remainder over its driving days
(January's Las Vegas passenger outage, Jan 22-26, taken as 5 days without
Las Vegas driving): 6,530.74 a day, then 6,180.83 a day, held flat after
Aug 5. Months round to 10,000. Bands follow the formula in "Ghost months"
above, with no growth term before October; h is in months of 30.44 days,
from the governing window's midpoint (the mean of its first and last
driving days: Feb 11, and the end of May 30) to the month's mean day (Jan
16, Feb 14.5, ...); January-March are governed by Jan 1-Mar 24, April on
by Mar 25-Aug 5. `quals/zoox-vmt-model.qual.mjs` recomputes every 2026
row, band and cumulative band from these inputs.

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
  each way, the lower edge at least half the page's figure.
- Crashes: the in-scope Tesla reports on Tesla's own list of SGO reports
  "while Robotaxi is driving autonomously with no safety monitor in the
  vehicle" (the page's spreadsheet download; `TESLA_NO_MONITOR_REPORTS` in
  `slurp.py`, 32 reports as of the Oct 18, 2026 spreadsheet, 15 of them newer
  than NHTSA's Oct-15 file). Scope is the company line's: the crashes a
  remote human drove (`TELEOP_DRIVEN_REPORTS`) count on neither line, though
  Tesla's list includes them. `TESLA_MONITOR_ABOARD_REPORTS` holds the 2026
  reports whose narratives put a monitor aboard.
- Coverage: the same as Tesla's rows, since the line's reports are a subset
  of Tesla's filings.

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
airbag, or a tow-away of a vehicle equipped with an ADS) and goes to NHTSA's
Level 2 file, none of whose Tesla reports the page counts. The miles stay in
the denominator, so the every-mode line may understate Tesla's crash rate by
an amount no public source measures; the no-monitor line, whose miles
exclude every monitor-aboard trip, avoids it. The rationales of the Tesla
rows for those months say so.

## Fault CSV synchronization

The `faultfrac.csv` file is partly local judgment and partly mirrored NHTSA data.

Their schema is:

```text
reportID,speed,crashwith,svhit,cphit,severity,faultfrac,reasoning
```

The rule is:

- The first six columns come from the latest deduplicated NHTSA master data
- The last two columns (`faultfrac`, `reasoning`) are the judgment columns
- `faultfrac` is on a 0.05 grid (0, 0.05, 0.1, ..., 1): the page sums fault
  values in twentieths and refuses any other value, rendering nothing, so
  `data/slurp.py` stops on a value off the grid or outside 0-1
  (`quals/fault-grid.qual.mjs`)

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

They are not parsed as incident inputs in the current build pipeline.
The only code-path interaction is that `data/slurp.py` may compare a fetched
current NHTSA CSV against the latest legacy current snapshot to avoid writing an
immediate duplicate when the timestamped snapshot scheme is first used.

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
- `data/vmt.csv` is the in-repo master for VMT estimates; `data/faultfrac.csv` is the master for fault judgments
- the checked-in `nhtsa-*.csv` files under `data/snapshots/` are archival snapshots, not inputs to the current slurp run

## Regeneration

To regenerate the app data, run:

```bash
python3 data/slurp.py
```

That command requires network access because it fetches NHTSA data live.
VMT comes from the local `data/vmt.csv` master, so no Google access is needed.

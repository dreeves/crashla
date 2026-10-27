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

The live URLs are defined in `data/slurp.py` as:

- `NHTSA_ADS_CSV_URL`
- `NHTSA_ADS_ARCHIVE_URL`

NHTSA's canonical SGO page labels each release "through `<date>`": reports
received through that date, which is the 15th of the month before the
release, rolled forward to the next business day when the 15th falls on a
weekend or federal holiday (e.g. "through August 17, 2026" for the Sep 15,
2026 release; `quals/nhtsa-cutoff-date.qual.mjs` pins the rule). Each
release's newest incident month holds only five-day-track filings and grows
~6x in the next release. That page blocks scripted fetches, so `NHTSA_DATA_THROUGH_DATE` in `slurp.py`
records the reviewed cutoff — one edit per release — and content asserts
guard it: the cutoff month must be the newest incident month and the newest
submission month (early Monthly filings inside that month are legitimate).
The CSV's HTTP headers and bytes are deliberately not pinned (a correction
must not break ingestion; the Aug 27, 2026 re-publish replaced one wrong
Stack AV narrative, 34952-11803 v1, and changed nothing else).

Reports received through the cutoff cover only crashes from roughly the
first quarter to third of the data-through month (the five-day clock runs
from the company's notice, plus processing). `FIVE_DAY_RECEIPT_COVERAGE` =
(best, lo, hi) is that fraction, measured from `data/snapshots` history as
the share of a month's eventual five-day-track incidents present in the first
release containing that month (`FIVE_DAY_RECEIPT_OBSERVATIONS`: Feb 0.50,
Mar 0.35, May 0.28, Jun 0.28, Jul 0.21, Aug 0.21 of 2026; currently (0.28,
0.20, 0.52), best = the median). April 2026 is excluded because its first release, May 15,
was truncated. A month's denominator is final at its second normal release,
so one observation is added per release, one release in arrears.

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

1. Fetch current + archive NHTSA CSVs directly from NHTSA
2. Normalize archive-only column-name differences, and move the current
   file's contact-area values from their rotated published labels to their
   true ones (`CURRENT_FILE_CONTACT_LABEL`; the run stops if narratives that
   name a contact area stop agreeing with the moved values —
   `quals/contact-labels.qual.mjs`)
3. Validate every row against the whitelists (report type, operator type,
   reporting entity, severity, date formats), the per-helmer operator scope
   (every helmer row must file a counted or an excluded type), and the
   teleoperator narrative tripwire; any surprise stops the run
4. Deduplicate by `Report ID` over every filed row, keeping the highest
   `Report Version` (a report's `Same Incident ID` can change between
   versions, and a later version can retire a report from scope)
5. Filter the surviving versions to the operator modes whose miles are in each company's VMT denominator (`PUBLIC_SERVICE_OPERATOR_TYPES` / `EXCLUDED_OPERATOR_TYPES` in `slurp.py`: `"None"` and `"Remote (Commercial / Test)"` for all three, plus `"In-Vehicle (Commercial / Test)"` for Tesla, whose deck miles include monitor-aboard miles; Waymo/Zoox safety-driver modes are excluded because their miles are not in those denominators; `"Other, see Narrative"` is classified per report via `OPERATOR_TYPE_OVERRIDE`), drop crashes in which a remote human was driving (`TELEOP_DRIVEN_REPORTS`, guarded by a narrative tripwire), then deduplicate by `Same Incident ID`; `SPLIT_SAME_INCIDENT_REPORTS` in `slurp.py`
   exempts reports that share an ID but describe distinct crashes
6. Read the VMT master from `data/vmt.csv` (first, to fail fast on a stale
   ledger before any file is written) and check its ghost months (see
   "Ghost months" below): at least the month after the data-through month,
   a row for every line in each, and none for a month that has not begun
7. Sync the six mirrored columns of `data/faultfrac.csv` from the NHTSA
   rows and load the fault fractions
8. Verify the reviewed data-through cutoff against the CSV contents (the
   newest incident month and newest submission month must both equal it),
   check the Monthly-report arrival tables against them (see above), and
   restrict to the app's VMT analysis window
9. Apply narrative-verified field overrides from `slurp.py` (severity, airbag,
   city and state — see `quals/field-overrides.qual.mjs` for the pins;
   vehicles-involved — see `quals/fatality-guard.qual.mjs`; passenger
   presence (`PASSENGER_OVERRIDE`): every Tesla report, since Tesla's filings
   conflate a rider with its in-car safety monitor, and any Waymo or Zoox
   report whose narrative contradicts its filed code — see
   `quals/passenger-classification.qual.mjs`; the dict comments carry each
   row's justification), strip the narratives' fact-free filing boilerplate
   (`quals/narrative-boilerplate.qual.mjs`), join in the fault fractions,
   and list the lines each incident counts toward (`series`: its company, and
   Tesla's no-monitor line for a report on Tesla's no-monitor list; see
   "Tesla's no-monitor line" below).
   A filed city, state or passenger value that no longer matches the one its
   override was reviewed against, an incident left with no city or state, an
   in-scope Tesla report with no reviewed passenger entry, a passenger entry
   for a report no longer in scope, a filed passenger code that crashla.js's
   three passenger classes do not list (`PAX_CLASS`), or a narrative that
   says who was aboard the AV ("An occupied Zoox autonomous vehicle",
   "unoccupied", "had no occupants") against its filed passenger code,
   unreviewed, stops the run
   (the severity, airbag and vehicles-involved overrides carry no such check),
   as do an in-scope Tesla report from January 2026 on that is on neither of
   the two reviewed monitor lists and an incident on a line with no
   `data/vmt.csv` row for its month
10. Apply the data-through month's receipt coverage (`coverage`,
    `coverage_min`, `coverage_max`) and the pooled Monthly-track incident
    coverage (`incident_coverage`, `_min`, `_max`), plus the Monthly-track
    incident coverage of the months inside each company's Monthly-report lag
    (`MONTHLY_ARRIVAL_LAG`) — the generated CSV in `data/vmt.js` carries these
    six columns after `vmt_max`; every other month gets 1. Tesla's
    no-monitor rows take Tesla's coverage, and the pooled incident coverage
    counts the companies only
11. Inject the resulting incident data into `data/incidents.js`
12. Inject the resulting VMT CSV text into `data/vmt.js`, and the ghost
    months' master rows, as they stand, into its second segment
    (`GHOST_VMT_CSV_TEXT`)

## Each NHTSA release

`slurp.py` stops until these are done:

1. `NHTSA_DATA_THROUGH_DATE`: the new release's cutoff.
2. `FIVE_DAY_RECEIPT_OBSERVATIONS`: the month that just became final (the
   one before the new data-through month). Then `FIVE_DAY_RECEIPT_COVERAGE`
   = (best, lo, hi) must still agree with the observations: best within 0.02
   of their median, lo at or below the lowest observed fraction and hi at or
   above the highest. When the new observation falls outside the band, lower
   lo (or raise hi) to cover it, as the 2026-07 observation (12 of 58, 0.21)
   lowered lo from 0.25 to 0.20 (August 2026's, 10 of 48, stayed inside);
   `quals/receipt-observations.qual.mjs` recounts every row from the
   snapshots, an incident's track being its first filing's Report Type.
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
   rows, which become the new data-through month's.

These are the constants every release needs. The run also stops on what a
release brings: an incident month newer than the newest month in
`data/vmt.csv` (step 6), a value outside a whitelist or an unclassified
operator mode (step 3), a fault value off the 0.05 grid (step 7), and the
override re-reads and narrative checks of step 9, among them a new in-scope
Tesla report from January 2026 on (re-read Tesla's latest no-monitor list,
below) and a new month with no `teslanomonitor` row; and
`quals/fault-coverage.qual.mjs` needs a `data/faultfrac.csv` row for every
new incident.

Then re-pin the knife-edge verdicts in `quals/stress-test.qual.mjs` as its
comments say, and, when a new in-scope Tesla report has a passenger aboard
(its `PASSENGER_OVERRIDE` entry stores one), add it to the list of Tesla
reports with a rider that `quals/passenger-classification.qual.mjs` pins
exactly (9 of 31 as of the Oct 15, 2026 file); the qual goes red on any new
one until then. `quals/tesla-no-monitor.qual.mjs` pins Tesla's list, the
monitor-aboard list, the line's crashes by month and its miles by month, and
goes red on a new no-monitor crash or row until they are re-pinned.

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
rules below, calibrated on 2026-10-27 by backtests on each line's own
measured series (their rationales show the arithmetic; the choices still
open are listed in AGENTS.md):

- Tesla's no-monitor line, from Tesla's weekly page: the measured part is
  the page's miles for the month so far (city sums, linear within each
  week). The rest is projected from the last published weeks as the
  geometric mean of two projections: the mean of holding the last week flat
  and continuing its growth, and continuing the three-week growth. The
  projected part's range is that projection times e^(±0.30 √(h/7)), h being
  the days from the last published Sunday to the month's end (×0.66-1.51 at
  13 days, ×0.53-1.88 at 31), combined with the measured part, with a 0.066
  log term for the gap between Tesla's page and its deck added in
  quadrature. The 0.30 is a judgment, about 1.5 times what steady-growth
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
  days, plus documented openings and pauses; band ×e^-(0.17 + 0.028k) to
  ×e^(0.15 + 0.02k), k being the months from the end of the latest quarter
  both CPUC and the hub have measured to the end of the month (k = 4:
  ×0.75-1.26), from four-month-ahead backtests on CPUC's monthly California
  miles and the hub's quarterly county miles.
- Zoox: the per-day rate between Zoox's two latest cumulative statements,
  California (CPUC driverless miles × 1.19 for the DMV-reported miles CPUC
  misses) grown 5% a month from its last CPUC month and the rest held flat
  unless a dated change is known; band ×e^(-1.96σ) to ×e^(1.96σ′), with
  σ = √(0.065² + 0.07²h + 0.09²) (statement rounding, drift, month noise),
  σ′ = √(σ² + 0.10²) while fleet growth is announced but unquantified, and h
  the months from the bracketing window's midpoint to the month's midpoint.
  Every Zoox constant is a prior: one measured change in Zoox's rate exists.
  The same method sets Zoox's analysis months from January 2026 ("Zoox
  anchors" above).

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
`data/vmt.csv` (the monthly shape inside each interval is preserved).

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

Since 2026-10-27 the "nearly two million autonomous miles" (Mar 24, 2026) and
"more than 3 million miles on public roads" (Aug 5, 2026) statements are
knots too. Until then they were only checked, because their wording varies,
but both count driverless miles: California DMV reports hold 1,213,646 Zoox
test miles for Dec 2024-Nov 2025 (Consumer Watchdog's tally, Feb 25, 2026),
312,648 of them driverless (permit AVDT004), so a count that included the
safety-driver miles would have passed 2.2M by Dec 31, 2025, months before
Zoox said "nearly two million". Each statement is read as its rounding
interval (1.88M-2.00M; 3.00M-3.20M) as of a day up to a week before its
date, less the pre-series miles at their own band, and carried to the
month's end at 0.7x-1.3x the model's daily miles: end-March
1,859,918-2,121,276, end-July 2,880,483-3,193,308. Months between knots
chain forward and narrow back from the next knot.

The 2026 rows follow one method, the per-day rate between consecutive
statements. Midpoints give 640,000 miles over Jan 1-Mar 24 and 1,160,000
over Mar 25-Aug 5. California is CPUC's driverless pilot miles × 1.19 (the
DMV-reported driverless miles CPUC misses), measured through June and grown
5% a month after it. The rest, mostly Las Vegas, is each interval's
remainder over its driving days (January's Las Vegas outage, Jan 22-26,
taken as 5 days without it): 6,531 a day, then 6,181 a day, held flat after
Aug 5. Months round to 10,000, and bands follow the formula in "Ghost
months" above (no growth term before October).
`quals/zoox-vmt-model.qual.mjs` recomputes every 2026 row, band and
cumulative band from these inputs.

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

When `data/slurp.py` runs, it synchronizes the first six columns of
`faultfrac.csv` from the live NHTSA master rows before loading the fault
fractions into the app pipeline.

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

## Snapshot storage policy

Every live upstream fetch is archived in `data/snapshots/`.

That includes:

- the raw current NHTSA ADS CSV
- the raw archive NHTSA ADS CSV

(The `vmt-sheet-*.csv` snapshots are historical: they archived the VMT Google
Sheet export back when that sheet was the master. The master now lives at
`data/vmt.csv`, where git history serves as the archive, so no new VMT
snapshots are written.)

If a newly fetched CSV is identical to the latest stored snapshot for that
source, no new file is written.

If the fetched CSV differs from the latest stored snapshot for that source, a
new timestamped snapshot file is created.

New snapshots use timestamped filenames like `nhtsa-current-*.csv` and
`nhtsa-archive-*.csv`.

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

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
Mar 0.35, May 0.28, Jun 0.28, Jul 0.21 of 2026; currently (0.28, 0.20, 0.52),
best = the median). April 2026 is excluded because its first release, May 15,
was truncated. A month's denominator is final at its second normal release,
so one observation is added per release, one release in arrears.

Monthly-track (SGO Request No. 2) reports for a month are due by the 15th of
the next, so they normally reach the file at the month's second release, and
the app treats the month as complete from then on. Some companies' arrive
later: every in-scope Zoox Monthly-track report of 2026 so far arrived one
release after that, so in the Sep 15, 2026 file Zoox's July held only its one
5-Day report. `MONTHLY_ARRIVAL_LAG` in `slurp.py` is each company's extra lag in
releases (Waymo 0, Tesla 0, Zoox 1), next to the observations it is measured
from (`MONTHLY_ARRIVAL_OBSERVATIONS`: per company and incident month, the
in-scope Monthly-track incidents by the release at which they first
appeared). The months inside a company's lag get Monthly-track incident
coverage = its in-scope 5-Day share instead of 1
(`FIVE_DAY_SHARE_OBSERVATIONS`; Zoox Jan-Jun 2026: 17 of 27 = 0.63, band
from the lowest month, February's 0.25, to 1.0); five-day-track metrics are
unaffected. The run stops if a lagged company's lagged month already holds a
Monthly-track report, if a table disagrees with the newest file, or if a
month that has become measurable has no observation.
`quals/monthly-arrival-lag.qual.mjs` re-measures the tables from
`data/snapshots` (its embedded script is the measurement recipe).

It also reads two local input files:

- `data/vmt.csv` — the in-repo VMT master (see "VMT master" below)
- `data/faultfrac.csv` — the fault-fraction judgments

The slurp pipeline is:

1. Fetch current + archive NHTSA CSVs directly from NHTSA
2. Normalize archive-only column-name differences
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
   ledger before any file is written)
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
   (`quals/narrative-boilerplate.qual.mjs`), and join in the fault fractions.
   A filed city, state or passenger value that no longer matches the one its
   override was reviewed against, an incident left with no city or state, an
   in-scope Tesla report with no reviewed passenger entry, a passenger entry
   for a report no longer in scope, a filed passenger code that crashla.js's
   three passenger classes do not list (`PAX_CLASS`), or a narrative that
   says who was aboard the AV ("An occupied Zoox autonomous vehicle",
   "unoccupied", "had no occupants") against its filed passenger code,
   unreviewed, stops the run
   (the severity, airbag and vehicles-involved overrides carry no such check)
10. Apply the data-through month's receipt coverage (`coverage`,
    `coverage_min`, `coverage_max`) and the pooled Monthly-track incident
    coverage (`incident_coverage`, `_min`, `_max`), plus the Monthly-track
    incident coverage of the months inside each company's Monthly-report lag
    (`MONTHLY_ARRIVAL_LAG`) — the generated CSV in `data/vmt.js` carries these
    six columns after `vmt_max`; every other month gets 1
11. Inject the resulting incident data into `data/incidents.js`
12. Inject the resulting VMT CSV text into `data/vmt.js`

## Each NHTSA release

`slurp.py` stops until these are done:

1. `NHTSA_DATA_THROUGH_DATE`: the new release's cutoff.
2. `FIVE_DAY_RECEIPT_OBSERVATIONS`: the month that just became final (the
   one before the new data-through month). Then `FIVE_DAY_RECEIPT_COVERAGE`
   = (best, lo, hi) must still agree with the observations: best within 0.02
   of their median, lo at or below the lowest observed fraction and hi at or
   above the highest. When the new observation falls outside the band, lower
   lo (or raise hi) to cover it, as the 2026-07 observation (12 of 58, 0.21)
   lowered lo from 0.25 to 0.20; a new low is likely, since August 2026's
   numerator is 10 and every final 2026 denominator but February's has been
   57-72.
3. The Monthly-report arrival table, re-measured alongside the receipt
   observations: each company's `MONTHLY_ARRIVAL_OBSERVATIONS` row for the
   month whose third release this is (data-through month - 2); a check that
   `MONTHLY_ARRIVAL_LAG` still matches each company's newest observed month;
   and each lagged company's `FIVE_DAY_SHARE_OBSERVATIONS` row for the month
   that just became final for it (data-through month - 1 - lag). If a lagged
   company's Monthly reports start arriving on time, the run stops on its
   lagged month: record that month's on-time count as its observation and
   set the lag.

These are the constants every release needs. The run also stops on what a
release brings: an incident month newer than the newest month in
`data/vmt.csv` (step 6), a value outside a whitelist or an unclassified
operator mode (step 3), a fault value off the 0.05 grid (step 7), and the
override re-reads and narrative checks of step 9; and
`quals/fault-coverage.qual.mjs` needs a `data/faultfrac.csv` row for every
new incident.

Then re-pin the knife-edge verdicts in `quals/stress-test.qual.mjs` as its
comments say, and, when a new in-scope Tesla report has a passenger aboard
(its `PASSENGER_OVERRIDE` entry stores one), add it to the list of Tesla
reports with a rider that `quals/passenger-classification.qual.mjs` pins
exactly (8 of 23 as of the Sep 15, 2026 file); the qual goes red on any new
one until then.

## VMT master

`data/vmt.csv` is the in-repo master for the monthly VMT estimates.
It was migrated verbatim (field-for-field) from the old VMT Google Sheet on
2026-06-11; git history is now the archive for VMT edits.

Its schema is:

```text
helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale
```

("Helmer" is this project's jargon for who or what is at the helm:
tesla, waymo, or zoox in this file; the app adds human benchmark cohorts.
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
bands. The ~2M (late Mar 2026) and >3M (Aug 5, 2026) milestones are checked,
not knotted: their scope wording varies ("autonomous miles", "miles on public
roads"). `quals/zoox-vmt-provenance.qual.mjs` pins the knot.

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

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

NHTSA's canonical SGO page labels each release "through <date>": reports
received through that date, which is the 15th of the month before the
release, rolled forward to the next business day when the 15th falls on a
weekend or federal holiday (e.g. "through August 17, 2026" for the Sep 15,
2026 release; `quals/nhtsa-cutoff-date.qual.mjs` pins the rule). Each release's newest incident month
holds only five-day-track filings and grows ~6x in the next release). That
page blocks scripted fetches, so `NHTSA_DATA_THROUGH_DATE` in `slurp.py`
records the reviewed cutoff — one edit per release — and content asserts
guard it: the cutoff month must be the newest incident month and the newest
submission month (early Monthly filings inside that month are legitimate).
The CSV's HTTP headers and bytes are deliberately not pinned (a correction
must not break ingestion; the Aug 27, 2026 re-publish replaced one wrong
Stack AV narrative, 34952-11803 v1, and changed nothing else).

Reports received through the 15th cover only crashes from roughly the first
third of the data-through month (the five-day clock runs from the company's
notice, plus processing). `FIVE_DAY_RECEIPT_COVERAGE` = (best, lo, hi) is
that fraction, measured from `data/snapshots` history as the share of a
month's eventual five-day-track incidents present in the first release
containing that month (`FIVE_DAY_RECEIPT_OBSERVATIONS`: Feb 0.50, Mar 0.35,
May 0.28, Jun 0.28 of 2026, re-measured 2026-09-04; the anomalous May-15
release is excluded). It is re-measured and re-reviewed on each release.

It also reads two local input files:

- `data/vmt.csv` — the in-repo VMT master (see "VMT master" below)
- `data/faultfrac.csv` — the fault-fraction judgments

The slurp pipeline is:

1. Fetch current + archive NHTSA CSVs directly from NHTSA
2. Verify the reviewed data-through cutoff against the CSV contents (the
   newest incident month and newest submission month must both equal it)
3. Normalize archive-only column-name differences
4. Deduplicate by `Report ID` over every filed row, keeping the highest
   `Report Version` (a report's `Same Incident ID` can change between
   versions, and a later version can retire a report from scope)
5. Filter the surviving versions to each company's public robotaxi service (`Driver / Operator Type == "None"`, plus `"In-Vehicle (Commercial / Test)"` and `"Remote (Commercial / Test)"` for Tesla — the safety-monitor and remote-assistance modes of the same paid fleet), then deduplicate by `Same Incident ID`; `SPLIT_SAME_INCIDENT_REPORTS` in `slurp.py`
   exempts reports that share an ID but describe distinct crashes
6. Read the VMT master from `data/vmt.csv` (first, to fail fast on a stale
   ledger before any file is written)
7. Sync the six mirrored columns of `data/faultfrac.csv` from the NHTSA
   rows and load the fault fractions
8. Restrict to the app's VMT analysis window
9. Apply narrative-verified field overrides from `slurp.py` (severity, airbag,
   state — see `quals/field-overrides.qual.mjs` for the pins; vehicles-involved
   — see `quals/fatality-guard.qual.mjs`; the dict comments carry each row's
   justification) and join in the fault fractions
10. Apply the data-through month's receipt coverage (`coverage`,
    `coverage_min`, `coverage_max`) and the pooled Monthly-track incident
    coverage (`incident_coverage`, `_min`, `_max`) — the generated CSV in
    `data/vmt.js` carries these six columns after `vmt_max`; every other
    month gets 1
11. Inject the resulting incident data into `data/incidents.js`
12. Inject the resulting VMT CSV text into `data/vmt.js`

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
- Thousands-separator commas in numbers are tolerated (quote the field);
  slurp normalizes them to plain integers in the generated artifact
- `rationale` is free text explaining the estimate's source and uncertainty

To change VMT data: edit `data/vmt.csv`, run `python3 data/slurp.py`, and
commit the master together with the regenerated artifacts.

### Waymo anchors

Waymo's Safety Impact hub "All Locations" total counts only locations that
have a county-level human benchmark (hub release notes, Jun 12, 2025: miles
and crashes from unbenchmarked cities "were not included in the All Locations
(mileage blended) analysis"). The repo's series is US-wide — its incident
numerator already includes crashes in the unbenchmarked metros — so each
cumulative anchor is the hub figure plus E, an explicit estimate of rider-only
miles (incl. deadhead) in metros the hub had not yet benchmarked at that date,
minus D, the Atlanta miles the hub appears to count twice (below).
`quals/waymo-vmt-provenance.qual.mjs` pins the same table. When the hub adds
a metro, set that metro's share of E to 0 at that anchor and re-chain
`data/vmt.csv` (the monthly shape inside each interval is preserved).

| Data through | Hub figure (hub CSV1) | Counted | E lo / best / hi | Atlanta D | Excluded metros |
|---|---|---|---|---|---|
| Mar 2025 | 71.432M | PHX, SF, LA, ATX | 0.188 / 0.188 / 0.188M | 0 | Atlanta 0.056M + Mountain View 0.132M (listed, excluded — exact) |
| Jun 2025 | 95.965M | PHX, SF, LA, ATX | 0.4 / 0.7 / 1.3M | 0.213M | Atlanta (rider-only Jan 30, public Jun 24, 2025); Santa Clara / Mountain View |
| Sep 2025 | 127.158M | PHX, SF, LA, ATX | 1.3 / 2.0 / 3.1M | 0.473M | Atlanta; Santa Clara |
| Dec 2025 | 170.712M | Maricopa, SF, San Mateo, Santa Clara (newly counted), LA, Travis | 3.0 / 3.7 / 4.6M | 1.166M | Atlanta (~3.5M lifetime); Miami (rider-only Nov 18); Dallas, Houston, San Antonio, Orlando (Dec) |
| Mar 2026 | 220.613M | + Fulton, DeKalb (Atlanta, 5.379M lifetime) | 1.2 / 2.0 / 3.3M | 1.791M | Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson |
| Jun 2026 | 271.329M | same eight counties (Atlanta 8.624M lifetime) | 4.0 / 6.65 / 10.2M | 2.841M | Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson; plus employee rider-only Denver, Las Vegas, San Diego, Tampa from ~Jul |

Atlanta D (2026-09-25). The hub's per-cell detail file ("CSV4 - Miles and
Benchmark Crashes for Dynamic Benchmark") lists 67 Fulton and 18 DeKalb S2
cells twice within every Outcome in the thru-Jun-2026 release (54 and 14 in
thru-Mar-2026), each pair with identical Waymo RO Miles and HPMS VMT but a
different Benchmark Crash Count; no other county repeats a cell. The county
totals in CSV1 equal the every-row sums (Fulton 7.860M, DeKalb 0.764M thru
Jun 2026); counting each cell once gives 5.143M and 0.640M. The best reading
is a join artifact, so D = every-row sum minus distinct-cell sum for Fulton +
DeKalb, within one Outcome: 1,791,464 (Mar 2026) and 2,840,745 (Jun 2026),
one third of Atlanta's published total both times. Anchors from before
Atlanta entered the hub carried Atlanta inside E, estimated from the
published Mar-2026 figure, so the same one-third share applies there. It is
applied to Atlanta's published-basis ramp: 0.056M at Mar 2025, the ~3.5M E
share at Dec 2025, and 5.379M at Mar 2026. Between knots the ramp is shaped
by the hub's own Atlanta crash list (CSV2), with pre-Third-Amended-SGO
crashes at half weight. D's low edge is 0 (the published total is right):
the rows subtract D's monthly increments from `vmt` and `vmt_min` and D from
`helmer_cumulative_vmt` and `kyoom_min`, leaving `vmt_max`/`kyoom_max` on the
published reading. Recompute D with every hub release. If Waymo fixes the
file, D comes out 0. If Waymo confirms the published total, set D to 0
here, in the qual, and in the rows.

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
2026 anchor's E lo/hi (4.0 / 10.2M) come from the same proxy on the hub's
own crash list (41 unbenchmarked-county crashes Jan-Jun 2026 at 4.5-9.5 per
M mi); its best (6.65M) is the carried monthly sum. The Sep 24, 2026 update
added no metro; the next (data through Sep 2026) is expected ~mid/late Dec
2026.

## Fault CSV synchronization

The `faultfrac.csv` file is partly local judgment and partly mirrored NHTSA data.

Their schema is:

```text
reportID,speed,crashwith,svhit,cphit,severity,faultfrac,reasoning
```

The rule is:

- The first six columns come from the latest deduplicated NHTSA master data
- The last two columns (`faultfrac`, `reasoning`) are the judgment columns

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

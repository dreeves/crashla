[Codex wrote this file]

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

It also reads two local input files:

- `data/vmt.csv` — the in-repo VMT master (see "VMT master" below)
- `data/faultfrac.csv` — the fault-fraction judgments

The slurp pipeline is:

1. Fetch current + archive NHTSA CSVs directly from NHTSA
2. Normalize archive-only column-name differences
3. Filter to each company's public robotaxi service (`Driver / Operator Type == "None"`, plus `"In-Vehicle (Commercial / Test)"` for Tesla's monitored Austin service)
4. Deduplicate by `Same Incident ID`, keeping the highest `Report Version`
5. Restrict to the app's VMT analysis window
6. Join in local fault-fraction inputs from `data/faultfrac.csv`
7. Read the VMT master from `data/vmt.csv`
8. Inject the resulting incident data into `data/incidents.js`
9. Inject the resulting VMT CSV text into `data/vmt.js`

## VMT master

`data/vmt.csv` is the in-repo master for the monthly VMT estimates.
It was migrated verbatim (field-for-field) from the old VMT Google Sheet on
2026-06-11; git history is now the archive for VMT edits.

Its schema is:

```text
driver,month,vmt,driver_cumulative_vmt,vmt_min,vmt_max,rationale
```

Editing rules:

- One row per driver-month; `month` is ISO `YYYY-MM`
- `vmt_min <= vmt <= vmt_max`, all non-negative (asserted downstream)
- Thousands-separator commas in numbers are tolerated (quote the field);
  slurp normalizes them to plain integers in the generated artifact
- `rationale` is free text explaining the estimate's source and uncertainty

To change VMT data: edit `data/vmt.csv`, run `python3 data/slurp.py`, and
commit the master together with the regenerated artifacts.

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

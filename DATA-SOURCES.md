[Codex wrote this file]

# Data Sources

This repo has two different kinds of NHTSA CSV data:

1. Live source-of-truth inputs used by `preprocess.py`
2. Checked-in archival snapshots kept in the repo for reference

## What `preprocess.py` actually reads

`preprocess.py` does not read `nhtsa-2025-jun-dec.csv` or `nhtsa-2025-jun-2026-jan.csv`.

When you run `python3 preprocess.py`, it fetches:

- The current ADS incident CSV from NHTSA
- The archive ADS incident CSV from NHTSA
- The VMT CSV export from the Google Sheet

The live URLs are defined in `preprocess.py` as:

- `NHTSA_ADS_CSV_URL`
- `NHTSA_ADS_ARCHIVE_URL`
- `VMT_SHEET_URL`

The preprocess pipeline is:

1. Fetch current + archive NHTSA CSVs directly from NHTSA
2. Normalize archive-only column-name differences
3. Filter to `Driver / Operator Type == "None"`
4. Deduplicate by `Same Incident ID`, keeping the highest `Report Version`
5. Restrict to the app's VMT analysis window
6. Join in local fault-fraction inputs from `faultfrac-claude.csv`, `faultfrac-codex.csv`, and `faultfrac-gemini.csv`
7. Fetch the VMT sheet directly from Google Sheets
8. Inject the resulting incident data into `incidents.js`
9. Inject the resulting VMT CSV text into `vmt.js`

## Fault CSV synchronization

The `faultfrac-*.csv` files are partly local judgment and partly mirrored NHTSA data.

Their schema is:

```text
reportID,speed,crashwith,svhit,cphit,severity,faultfrac,reasoning
```

The rule is:

- The first six columns come from the latest deduplicated NHTSA master data
- The last two columns (`faultfrac`, `reasoning`) are the model-owned judgment columns

When `preprocess.py` runs, it synchronizes the first six columns of every
`faultfrac-*.csv` file from the live NHTSA master rows before loading the fault
fractions into the app pipeline.

That means:

- contact-area formatting stays consistent across models
- speed / crash partner / severity stay aligned with the latest NHTSA version
- the model-owned `faultfrac` and `reasoning` columns are preserved

## What the checked-in NHTSA CSV files are for

`nhtsa-2025-jun-dec.csv` and `nhtsa-2025-jun-2026-jan.csv` are archival snapshots only.

They are useful for:

- Historical reference
- Manual inspection
- Comparing an older snapshot against the latest live NHTSA fetch

They are not part of the current build pipeline.

## Why snapshot counts can disagree with `incidents.js`

Because `preprocess.py` fetches live data from NHTSA, `incidents.js` can legitimately differ from the checked-in archival snapshots.

One important case is June 2025 coverage: some June incidents appear only after merging the live current CSV with the live archive CSV.

So if the checked-in archival snapshot and `incidents.js` disagree, that does not by itself mean the app is wrong. It may just mean the snapshot is older than the live fetch used to generate `incidents.js`.

## Practical source-of-truth rule

If the question is "what data does the app currently use?", the answer is:

- `incidents.js` and `vmt.js` are the generated artifacts the app uses at runtime
- `preprocess.py` is the code that regenerates those artifacts from live upstream sources
- The checked-in `nhtsa-*.csv` files are reference snapshots, not inputs to the current preprocess run

## Regeneration

To regenerate the app data, run:

```bash
python3 preprocess.py
```

That command requires network access because it fetches NHTSA and Google Sheets data live.

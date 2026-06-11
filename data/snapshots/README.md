[Codex wrote this file]

# Snapshot Provenance

Files in this directory are archival snapshots of live upstream fetches made by
`data/slurp.py`.

They are intentionally kept as raw fetched payloads, so the CSV files
themselves do not get inline provenance comments.

Snapshot sources:

- `nhtsa-current-*.csv`: the live current ADS incident CSV from NHTSA
- `nhtsa-archive-*.csv`: the live archive ADS incident CSV from NHTSA
- `vmt-sheet-*.csv`: historical snapshots of the retired VMT Google Sheet CSV
  export, from before the VMT master moved into the repo at `data/vmt.csv`
  (2026-06-11)
- `nhtsa-2025-jun-dec.csv` and `nhtsa-2025-jun-2026-jan.csv`: legacy
  descriptive-name current-CSV snapshots from before the timestamped naming
  scheme

See `data/README.md` for the full source-of-truth and snapshot-policy rules.

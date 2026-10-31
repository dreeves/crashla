// FIVE_DAY_RECEIPT_OBSERVATIONS reproduces from data/snapshots (2026-10-16).
// The table in data/slurp.py is measured by hand at each release, and it has
// slipped twice: the 2026-08-28 table read 18/38, 25/69, 16/57, 17/60 (a
// transcription slip, fixed 2026-09-04), and the Oct-15-2026 release's
// 2026-08 row was first entered as (10, 47), counting an incident's track by
// its surviving report's type, so 30270-16286 (a 5-Day report whose v2 is an
// Update) dropped out of the denominator. An incident's track is its first
// filing's Report Type (REPORT_TRACK, as monthly_track_counts() and the
// arrival tables count it); a later Update does not change it, which is also
// what keeps every month's denominator final at its second normal release.
//
// Spec: for each month M in the table, the numerator is M's in-scope
// incidents whose first filing is 1-Day or 5-Day in the release whose
// data-through month is M (M's first release), and the denominator is the
// same count in the newest file; both deduplicated as main() does
// (public_service_incidents()), with this qual's own counting code. Every
// month whose first release data/snapshots holds (the two legacy snapshots
// included: data through Dec 2025 and Jan 2026) and that is final (before the
// newest data-through month) is in the table or in RECEIPT_MONTHS_EXCLUDED:
// until 2026-10-31 the table started at 2026-02, and Dec 2025 (13 of 55) and
// Jan 2026 (21 of 63), measurable from the legacy snapshots, were left out
// (decision of 2026-10-31 on open question 11, "(c)").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const py = String.raw`
import csv, importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location('slurp_receipt', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
iso = slurp.nhtsa_month_to_iso
snap = pathlib.Path('data/snapshots')
def filed(rows):
    return [r for r in rows if r['Report ID'].strip() and r['Report Version'].strip()
            and r['Same Incident ID'].strip() and r['Incident Date'].strip()]
def five_day_by_month(rows):
    rows = filed(rows)
    first_type = {r['Report ID']: r['Report Type'].strip() for r in rows if int(r['Report Version']) == 1}
    by_rid = {}
    for r in rows:
        rid, ver = r['Report ID'], int(r['Report Version'])
        if rid not in by_rid or ver > by_rid[rid][0]: by_rid[rid] = (ver, r)
    by_inc = {}
    # One in-scope report per Same Incident ID: a re-filing's replaced report
    # (SUPERSEDED_REPORTS) drops out of rows that hold the re-filing (a
    # month's first release, from before it, keeps the original), and two
    # left under one ID would stop main() (since 2026-10-31; until then the
    # higher Report Version won)
    replaced = {old for old, new in slurp.SUPERSEDED_REPORTS.items() if new in by_rid}
    for _ver, r in by_rid.values():
        if not slurp.is_public_service_incident(r) or r['Report ID'] in replaced: continue
        rid = r['Report ID']
        iid = rid if rid in slurp.SPLIT_SAME_INCIDENT_REPORTS else r['Same Incident ID']
        assert iid not in by_inc, ('two in-scope reports under one Same Incident ID', iid, rid, by_inc[iid]['Report ID'])
        by_inc[iid] = r
    counts = {}
    for r in by_inc.values():
        if first_type[r['Report ID']] in ('1-Day', '5-Day'):
            m = iso(r['Incident Date'].strip())
            counts[m] = counts.get(m, 0) + 1
    return counts
# Releases keyed by data-through month (the newest incident month), the two
# legacy current-file snapshots (data through Dec 2025 and Jan 2026) first;
# the Aug-28-2026 re-publish repeats 2026-07 and is skipped.
releases = {}
for p in [*slurp.LEGACY_SNAPSHOT_PATHS['nhtsa-current'], *sorted(snap.glob('nhtsa-current-*.csv'))]:
    rows = list(csv.DictReader(open(p, newline='')))
    D = max(iso(r['Incident Date'].strip()) for r in rows if r['Incident Date'].strip())
    releases.setdefault(D, (p.name, rows))
newest = slurp.newest_snapshot_rows()
final = five_day_by_month(newest)
out = {}
for m, row in slurp.FIVE_DAY_RECEIPT_OBSERVATIONS.items():
    name, rows = releases[m]
    out[m] = {'table': list(row), 'recount': [five_day_by_month(rows).get(m, 0), final.get(m, 0)], 'first': name}
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
print(json.dumps({'rows': out, 'final': sorted(m for m in releases if m < D),
                  'excluded': sorted(slurp.RECEIPT_MONTHS_EXCLUDED)}))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: recount FIVE_DAY_RECEIPT_OBSERVATIONS from data/snapshots with data/slurp.py's scope and dedup.
Expectata: the recount runs.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const { rows: r, final, excluded } = JSON.parse(run.stdout.trim().split("\n").at(-1));
const unmeasured = final.filter(m => !(m in r) && !excluded.includes(m));
assert.deepEqual(unmeasured, [],
  `Replicata: list the months whose first release data/snapshots holds (the legacy snapshots of data through Dec 2025 and Jan 2026, then every nhtsa-current-* file) and that are final (before the newest data-through month).
Expectata: each is in FIVE_DAY_RECEIPT_OBSERVATIONS or RECEIPT_MONTHS_EXCLUDED.
Resultata: neither: ${JSON.stringify(unmeasured)} (final months ${JSON.stringify(final)}).`);
const diffs = Object.entries(r).filter(([, x]) => JSON.stringify(x.table) !== JSON.stringify(x.recount));
assert.deepEqual(diffs, [],
  `Replicata: for each month M in FIVE_DAY_RECEIPT_OBSERVATIONS, count M's in-scope incidents whose first filing is 1-Day or 5-Day, deduplicated as main() does, in M's first release and in the newest file.
Expectata: (first-release count, newest-file count) equals the table row for every month.
Resultata: [month, {table, recount, first release}] ${JSON.stringify(diffs)}.`);
console.log(`qual pass: FIVE_DAY_RECEIPT_OBSERVATIONS reproduces from data/snapshots for ${Object.keys(r).length} months (${Object.entries(r).map(([m, x]) => `${m} ${x.table.join("/")}`).join(", ")})`);

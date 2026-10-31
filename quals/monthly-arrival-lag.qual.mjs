// Per-helmer Monthly-report arrival lag (2026-10-03, human decision: model
// the late arrival of Zoox's Monthly-track SGO reports rather than re-pin
// after they land). SGO Request No. 2 (Monthly) reports for incident month M
// are due by the 15th of M+1, so they normally reach NHTSA's public file at
// the release whose data-through month is M+1 (M's second release), and the
// app treats M as complete from then on. Every in-scope Zoox Monthly-track
// report of January-July 2026 reached the file one release later, so the
// Sep-15-2026 file held only Zoox's one July 5-Day report while the app called
// July final.
//
// data/slurp.py carries the measured lags (MONTHLY_ARRIVAL_LAG) with their
// observations (MONTHLY_ARRIVAL_OBSERVATIONS), and every month inside a
// helmer's extra lag gets a Monthly-track incident coverage equal to that
// helmer's in-scope 5-Day share (FIVE_DAY_SHARE_OBSERVATIONS), band [its
// lowest monthly share; 1.0], instead of 1. Five-day-track metrics are
// unaffected (the 5-Day reports arrive on the normal schedule).
//
// On the Oct-15-2026 release every helmer's in-scope August Monthly reports
// had arrived on time, Zoox's three included, so every lag is 0 and no live
// month is lagged. The lag machinery's checks therefore run on a synthetic
// world with one lagged helmer (section 3b) and on a synthetic lagged month in
// the app (sections 5 and 6), so they keep their teeth whoever is lagged.
//
// This qual pins:
//   1. the tables reproduce from data/snapshots history (an independent
//      recompute), slurp's own track counts agree with that recompute, and
//      the lags are the measured ones;
//   2. data/vmt.js carries, for every helmer-month, the pooled triple in the
//      data-through month, the lag triple in a lagged helmer's lagged months
//      and (1, 1, 1) elsewhere, with receipt coverage untouched there;
//      derived from the reviewed cutoff, so no re-pin is needed when a
//      release advances it;
//   3. slurp.main() stops (anti-Postel) on: a lag table missing a helmer, a
//      lag that disagrees with its observations, a month that became
//      measurable without an observation, observations that disagree with the
//      newest file, and a share table for a helmer with no lag;
//   3b. monthly_lag_coverage(), called directly on the synthetic world,
//      returns the lag triple and stops on: a lagged month that already holds
//      a Monthly-track report, and that stop comes BEFORE every share-table
//      check (on the Oct-15-2026 release the zero-share stop fired first and
//      asked for a coverage model when the lag was what had to change); a lag
//      that disagrees with its observations; a share row that disagrees with
//      the counts; a share table missing the month just final for its
//      helmer; a lowest monthly share of 0; a share table for an unlagged
//      helmer; a fractional lag; arrival tables covering different months; a
//      month both observed and excluded; an observation for the data-through
//      month; a measurable month without an observation, and that stop comes
//      BEFORE the lag check (with the month gone, a tie in the month before it
//      would otherwise read as a lag disagreement, as Tesla's 2026-07 would on
//      the Nov-2026 release); and an arrival row that disagrees with the
//      counts;
//   4. a lagged month is never the reference month of the pooled
//      data-through-month coverage (its count is incomplete);
//   5. the app accepts the extra partially received month(s) at the end of a
//      window and still rejects a partial month followed by a full one;
//   6. with a lagged helmer shown, the MPI chart's "?" and that helmer's dot
//      tooltip mark the lagged month.
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";

const py = String.raw`
import collections, csv, datetime, glob, importlib.util, json, pathlib, tempfile
from email.utils import format_datetime
spec = importlib.util.spec_from_file_location('slurp_lag', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
iso = slurp.nhtsa_month_to_iso
def mnum(m): return int(m[:4]) * 12 + int(m[5:]) - 1
def mstr(n): return f"{n // 12}-{n % 12 + 1:02d}"
def trimmed(c):
    c = list(c)
    while c and c[-1] == 0: c.pop()
    return c
out = {'lag': dict(slurp.MONTHLY_ARRIVAL_LAG), 'dataThrough': slurp.NHTSA_DATA_THROUGH_DATE}

# --- 1. independent recompute from data/snapshots ---------------------------
# Releases keyed by data-through month (the newest incident month); the
# Aug-28-2026 re-publish repeats 2026-07 and is skipped.
snap = pathlib.Path('data/snapshots')
releases = {}
for p in [snap / 'nhtsa-2025-jun-dec.csv', snap / 'nhtsa-2025-jun-2026-jan.csv'] + sorted(snap.glob('nhtsa-current-*.csv')):
    rows = list(csv.DictReader(open(p, newline='')))
    D = max(iso(r['Incident Date'].strip()) for r in rows if r['Incident Date'].strip())
    releases.setdefault(D, {r['Report ID'].strip() for r in rows if r['Report ID'].strip()})
newest = slurp.newest_snapshot_rows()
# In-scope incidents of the newest file, deduplicated as main() does; an
# incident's track is its surviving report's version-1 Report Type.
filed = [r for r in newest if r['Report ID'].strip() and r['Report Version'].strip()
         and r['Same Incident ID'].strip() and r['Incident Date'].strip()]
first_type = {r['Report ID']: r['Report Type'].strip() for r in filed if int(r['Report Version']) == 1}
by_rid = {}
for r in filed:
    rid, ver = r['Report ID'], int(r['Report Version'])
    if rid not in by_rid or ver > by_rid[rid][0]: by_rid[rid] = (ver, r)
by_inc = {}
# One in-scope report per Same Incident ID: a re-filing's replaced report
# (SUPERSEDED_REPORTS) drops out of rows that hold the re-filing, and two
# left under one ID would stop main() (since 2026-10-31; until then the
# higher Report Version won)
replaced = {old for old, new in slurp.SUPERSEDED_REPORTS.items() if new in by_rid}
for _ver, r in by_rid.values():
    if not slurp.is_public_service_incident(r) or r['Report ID'] in replaced: continue
    rid = r['Report ID']
    iid = rid if rid in slurp.SPLIT_SAME_INCIDENT_REPORTS else r['Same Incident ID']
    assert iid not in by_inc, ('two in-scope reports under one Same Incident ID', iid, rid, by_inc[iid]['Report ID'])
    by_inc[iid] = r
# Arrivals are measured for the table's months only (older incidents are in
# the archive file, which no release snapshot series covers; slurp's own
# must() makes the table reach every month that is now measurable).
table_months = {m for t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.values() for m in t}
arrivals = collections.defaultdict(collections.Counter)
tracks = collections.Counter()
for r in by_inc.values():
    h, M = slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip())
    track = {'1-Day': 'five_day', '5-Day': 'five_day', 'Monthly': 'monthly'}[first_type[r['Report ID']]]
    tracks[(h, M, track)] += 1
    if track == 'monthly' and M in table_months:
        due = mnum(M) + 1
        # A crash arrives with its first report: a report that a re-filing
        # under a new Report ID replaced (SUPERSEDED_REPORTS) reached the
        # file before the re-filing did (2026-10-31, review of package SLURP:
        # looking up the surviving Report ID alone measured such a crash as
        # arriving at its re-filing's release)
        reports = {r['Report ID']} | {old for old, new in slurp.SUPERSEDED_REPORTS.items() if new == r['Report ID']}
        seen = [D for D in sorted(releases) if mnum(D) >= due and reports & releases[D]]
        arrivals[(h, M)][mnum(seen[0]) - due] += 1
out['arrivalDiffs'] = [
    [h, m, list(c), trimmed(arrivals[(h, m)][j] for j in range(max([0, *arrivals[(h, m)]]) + 1))]
    for h, table in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items() for m, c in table.items()
    if trimmed(c) != trimmed(arrivals[(h, m)][j] for j in range(max([0, *arrivals[(h, m)]]) + 1))]
out['shareDiffs'] = [
    [h, m, list(c), [tracks[(h, m, 'five_day')], tracks[(h, m, 'five_day')] + tracks[(h, m, 'monthly')]]]
    for h, table in slurp.FIVE_DAY_SHARE_OBSERVATIONS.items() for m, c in table.items()
    if list(c) != [tracks[(h, m, 'five_day')], tracks[(h, m, 'five_day')] + tracks[(h, m, 'monthly')]]]
impl = slurp.monthly_track_counts(newest)
out['trackCountDiffs'] = sorted(['|'.join(k), impl.get(k, 0), tracks.get(k, 0)]
                                for k in set(impl) | set(tracks) if impl.get(k, 0) != tracks.get(k, 0))

# --- 2. what data/vmt.js must carry ------------------------------------------
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
# Share tables exist exactly for the lagged helmers (stop (g) below pins
# that), so iterating them covers every lagged month.
expected_lag = {}
for h, table in slurp.FIVE_DAY_SHARE_OBSERVATIONS.items():
    lag = slurp.MONTHLY_ARRIVAL_LAG[h]
    triple = [round(sum(n for n, _ in table.values()) / sum(d for _, d in table.values()), 4),
              round(min(n / d for n, d in table.values() if d > 0), 4), 1.0]
    for i in range(lag):
        expected_lag[h + '|' + mstr(mnum(D) - lag + i)] = triple
out['expectedLag'] = expected_lag
out['shareStarts'] = {h: min(t) for h, t in slurp.FIVE_DAY_SHARE_OBSERVATIONS.items()}

# --- 3. slurp stops on inconsistent inputs -----------------------------------
inc_text = pathlib.Path('data/incidents.js').read_text()
vmt_text = pathlib.Path('data/vmt.js').read_text()
def segment(text, start, end):
    b = text.index(start) + len(start)
    return text[b:text.index(end, b)]
modified = segment(inc_text, '/* NHTSA_MODIFIED_DATE_START */', '/* NHTSA_MODIFIED_DATE_END */').strip('"')
lm = format_datetime(datetime.datetime.fromisoformat(modified + 'T12:00:00+00:00'), usegmt=True)
headers = {slurp.NHTSA_ADS_CSV_URL: (lm, None), slurp.NHTSA_ADS_ARCHIVE_URL: (lm, None)}
slurp.sync_fault_csvs = lambda master_rows: None
def regenerate(all_rows):
    slurp.fetch_nhtsa_csv = lambda stamp: (list(all_rows), headers)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / 'incidents.js').write_text(inc_text)
        (tmp / 'vmt.js').write_text(vmt_text)
        slurp.INCIDENT_JS, slurp.VMT_JS = tmp / 'incidents.js', tmp / 'vmt.js'
        slurp.main()
        return (tmp / 'vmt.js').read_text()
def stop_message(all_rows, **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try:
        regenerate(all_rows)
    except AssertionError as exc:
        return str(exc)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
    return 'accepted'
out['regenOk'] = segment(regenerate(newest), '/* VMT_CSV_START */', '/* VMT_CSV_END */') == segment(vmt_text, '/* VMT_CSV_START */', '/* VMT_CSV_END */')
stops = {}
lags = slurp.MONTHLY_ARRIVAL_LAG
# (b) the lag table misses a helmer
stops['coverage'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={'Waymo': 0, 'Tesla': 0})
# (c) a lag that disagrees with its observations (one more release than the
# majority of the helmer's newest observed month says)
stops['zooxLag'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={**lags, 'Zoox': lags['Zoox'] + 1})
stops['waymoLag'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={**lags, 'Waymo': lags['Waymo'] + 1})
# (d) the month that is now measurable (data-through month - 2) has no observation
due_month = mstr(mnum(D) - 2)
stops['due'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {m: c for m, c in t.items() if m != due_month} for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()})
# (f) an arrival row that disagrees with the newest file
waymo_obs = dict(slurp.MONTHLY_ARRIVAL_OBSERVATIONS['Waymo'])
first_obs = min(waymo_obs)
waymo_obs[first_obs] = (waymo_obs[first_obs][0] + 1, *waymo_obs[first_obs][1:])
stops['arrivalTotal'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={**slurp.MONTHLY_ARRIVAL_OBSERVATIONS, 'Waymo': waymo_obs})
# (g) a share table for a helmer with no lag (dead data)
unlagged = min(h for h, lag in lags.items() if lag == 0)
stops['deadShare'] = stop_message(newest, FIVE_DAY_SHARE_OBSERVATIONS={
    **slurp.FIVE_DAY_SHARE_OBSERVATIONS, unlagged: {first_obs: (0, 1)}})
out['stops'] = stops

# --- 3b. monthly_lag_coverage() on a synthetic world, called directly -------
# Section 3 shows main() reaches the function. Here it runs on made-up months
# 2031-01..2031-06 (data-through month 2031-06) with one lagged helmer, Zoox
# (lag 1, lagged month 2031-05), whose Monthly-track arrivals and 5-Day shares
# agree with the made-up counts: pooled share 8/16 = 0.5, lowest 1/4 = 0.25.
# Each case breaks one thing, so only the must() under test can object; the
# order case breaks two at once (a zero share AND a Monthly report in the
# lagged month), and the lag's own stop must win.
counts = slurp.monthly_track_counts(newest)
def direct_stop(counts=counts, **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try:
        slurp.monthly_lag_coverage(counts, D)
    except AssertionError as exc:
        return str(exc)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
    return 'accepted'
direct = {'baseline': direct_stop()}
W_D = '2031-06'
W_OBS = {'Waymo': {'2031-01': (5, 0), '2031-02': (6, 0), '2031-03': (4, 1), '2031-04': (5, 0)},
         'Tesla': {'2031-01': (1, 0), '2031-02': (2, 0), '2031-03': (0, 0), '2031-04': (1, 0)},
         'Zoox': {'2031-01': (0, 2), '2031-02': (0, 1), '2031-03': (0, 3), '2031-04': (0, 2)}}
W_LAG = {'Waymo': 0, 'Tesla': 0, 'Zoox': 1}
W_SHARES = {'Zoox': {'2031-01': (2, 4), '2031-02': (3, 4), '2031-03': (1, 4), '2031-04': (2, 4)}}
def w_counts(obs=W_OBS, shares=W_SHARES, lagged_monthly=0):
    c = collections.Counter()
    for h, t in obs.items():
        for m, arrived in t.items(): c[(h, m, 'monthly')] = sum(arrived)
    for h, t in shares.items():
        for m, (five_day, _total) in t.items(): c[(h, m, 'five_day')] = five_day
    c[('Zoox', '2031-05', 'five_day')] = 1
    c[('Zoox', '2031-05', 'monthly')] = lagged_monthly
    return c
def w_call(counts=None, **patch):
    tables = {'MONTHLY_ARRIVAL_OBSERVATIONS': W_OBS, 'MONTHLY_ARRIVAL_LAG': W_LAG,
              'FIVE_DAY_SHARE_OBSERVATIONS': W_SHARES, 'MONTHLY_ARRIVAL_MONTHS_EXCLUDED': {}, **patch}
    saved = {k: getattr(slurp, k) for k in tables}
    for k, v in tables.items(): setattr(slurp, k, v)
    try:
        got = slurp.monthly_lag_coverage(w_counts() if counts is None else counts, W_D)
        return {f'{h}|{m}': list(t) for (h, m), t in got.items()}
    except AssertionError as exc:
        return str(exc)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
synthetic = {'baseline': w_call()}
# a lagged month that already holds a Monthly-track report
synthetic['tripwire'] = w_call(counts=w_counts(lagged_monthly=1))
# the same, plus a month whose incidents were all Monthly-track (share 0):
# the arrival row, the share row and the counts move together
zero_obs = {**W_OBS, 'Zoox': {**W_OBS['Zoox'], '2031-03': (0, 4)}}
zero_shares = {'Zoox': {**W_SHARES['Zoox'], '2031-03': (0, 4)}}
synthetic['order'] = w_call(counts=w_counts(zero_obs, zero_shares, lagged_monthly=1),
                            MONTHLY_ARRIVAL_OBSERVATIONS=zero_obs, FIVE_DAY_SHARE_OBSERVATIONS=zero_shares)
synthetic['zeroShare'] = w_call(counts=w_counts(zero_obs, zero_shares),
                                MONTHLY_ARRIVAL_OBSERVATIONS=zero_obs, FIVE_DAY_SHARE_OBSERVATIONS=zero_shares)
# a lag that disagrees with its observations
synthetic['zooxLag0'] = w_call(MONTHLY_ARRIVAL_LAG={**W_LAG, 'Zoox': 0})
# a lag that is not a whole number of releases
synthetic['wholeLag'] = w_call(MONTHLY_ARRIVAL_LAG={**W_LAG, 'Zoox': 1.5})
# a share row that disagrees with the counts
synthetic['share'] = w_call(FIVE_DAY_SHARE_OBSERVATIONS={'Zoox': {**W_SHARES['Zoox'], '2031-01': (3, 5)}})
# a share table without the month just final for its helmer (2031-04)
synthetic['shareSpan'] = w_call(FIVE_DAY_SHARE_OBSERVATIONS={'Zoox': {m: c for m, c in W_SHARES['Zoox'].items() if m != '2031-04'}})
# a share table for a helmer with no lag
synthetic['deadShare'] = w_call(FIVE_DAY_SHARE_OBSERVATIONS={**W_SHARES, 'Tesla': {'2031-01': (0, 1)}})
# a release's arrival row added for some helmers only
synthetic['sameMonths'] = w_call(MONTHLY_ARRIVAL_OBSERVATIONS={**W_OBS, 'Waymo': {m: c for m, c in W_OBS['Waymo'].items() if m != '2031-04'}})
# a month both observed and excluded
synthetic['observedExcluded'] = w_call(MONTHLY_ARRIVAL_MONTHS_EXCLUDED={'2031-02': 'synthetic'})
# an observation for the data-through month, which no release can measure yet
synthetic['future'] = w_call(MONTHLY_ARRIVAL_OBSERVATIONS={h: {**t, W_D: (0,)} for h, t in W_OBS.items()})
# the month that is now measurable (2031-04) has no observation
synthetic['due'] = w_call(MONTHLY_ARRIVAL_OBSERVATIONS={h: {m: c for m, c in t.items() if m != '2031-04'} for h, t in W_OBS.items()})
# the same where the month before it is a tie, (1, 1), for a helmer whose lag
# is 0 (Tesla): with the measurable month gone the tie is the helmer's newest
# observed month, and the missing month must still be what stops the run, not
# the tie read as a lag disagreement. On the Nov-2026 release the measurable
# month (2026-08) is every helmer's newest observation and Tesla's 2026-07 is
# such a tie (audit 2026-10-30, R2).
tie_obs = {**W_OBS, 'Tesla': {**W_OBS['Tesla'], '2031-03': (1, 1)}}
synthetic['dueTie'] = w_call(counts=w_counts(tie_obs), MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {m: c for m, c in t.items() if m != '2031-04'} for h, t in tie_obs.items()})
# an arrival row that disagrees with the counts
synthetic['arrivalTotal'] = w_call(MONTHLY_ARRIVAL_OBSERVATIONS={**W_OBS, 'Waymo': {**W_OBS['Waymo'], '2031-01': (6, 0)}})
out['direct'] = direct
out['synthetic'] = synthetic

# --- 4. a lagged month is never the pooled coverage's reference month --------
def report(rid, month):
    return {'Reporting Entity': 'Zoox, Inc.', 'Driver / Operator Type': 'None', 'Report ID': rid,
            'Report Version': '1', 'Same Incident ID': rid, 'Incident Date': month,
            'Report Submission Date': month, 'Report Type': '5-Day', 'Narrative': ''}
ref_rows = ([report(f'jun-{i}', 'JUN-2026') for i in range(8)] +
            [report(f'jul-{i}', 'JUL-2026') for i in range(4)] + [report('aug-0', 'AUG-2026')])
ref_vmt = {('Zoox', '2026-06'): 100, ('Zoox', '2026-07'): 100, ('Zoox', '2026-08'): 100}
saved_lag = slurp.MONTHLY_ARRIVAL_LAG
slurp.MONTHLY_ARRIVAL_LAG = {**saved_lag, 'Zoox': 1}
out['refLagged'] = slurp.incident_coverage(ref_rows, '2026-08', 0.32, ref_vmt)[('Zoox', '2026-08')][0]
slurp.MONTHLY_ARRIVAL_LAG = {**saved_lag, 'Zoox': 0}
out['refUnlagged'] = slurp.incident_coverage(ref_rows, '2026-08', 0.32, ref_vmt)[('Zoox', '2026-08')][0]
slurp.MONTHLY_ARRIVAL_LAG = saved_lag
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: run the Monthly-arrival-lag checks against data/slurp.py and data/snapshots.
Expectata: slurp.py defines MONTHLY_ARRIVAL_LAG, MONTHLY_ARRIVAL_OBSERVATIONS, FIVE_DAY_SHARE_OBSERVATIONS and monthly_track_counts(), and the checks run.
Resultata: exit ${run.status}; stderr ${run.stderr.slice(-1500)}`);
const r = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1. The measured lags, and the tables reproduce from data/snapshots.
// Re-pin the lags only when a release's measurement changes one (a human
// decision: slurp's own must() ties each lag to its newest observed month).
// Zoox's was 1 from 2026-10-03 until the Oct-15-2026 release.
assert.deepEqual(r.lag, { Waymo: 0, Tesla: 0, Zoox: 0 },
  `Replicata: read MONTHLY_ARRIVAL_LAG from data/slurp.py.
Expectata: {Waymo: 0, Tesla: 0, Zoox: 0} -- on the Oct-15-2026 release every helmer's in-scope August 2026 Monthly-track reports reached the public file at the normal release (Zoox's had arrived one release late from January through July).
Resultata: ${JSON.stringify(r.lag)}.`);
assert.deepEqual(r.arrivalDiffs, [],
  `Replicata: recompute each helmer-month's Monthly-track arrivals from data/snapshots (in-scope incidents of the newest file, deduplicated as main() does; arrival = the first release whose data-through month is at least M+1 holding the surviving Report ID or a report it replaced, SUPERSEDED_REPORTS).
Expectata: MONTHLY_ARRIVAL_OBSERVATIONS matches the recompute in every row.
Resultata: [helmer, month, table, recomputed] ${JSON.stringify(r.arrivalDiffs)}.`);
assert.deepEqual(r.shareDiffs, [],
  `Replicata: recompute each lagged helmer-month's (in-scope 5-Day-track incidents, in-scope incidents) from the newest snapshots.
Expectata: FIVE_DAY_SHARE_OBSERVATIONS matches in every row.
Resultata: [helmer, month, table, recomputed] ${JSON.stringify(r.shareDiffs)}.`);
assert.deepEqual(r.trackCountDiffs, [],
  `Replicata: compare slurp.monthly_track_counts() on the newest snapshots with this qual's independent count, every helmer-month-track.
Expectata: identical.
Resultata: [key, slurp, qual] ${JSON.stringify(r.trackCountDiffs.slice(0, 8))}.`);

// 2. data/vmt.js: the incident-coverage triple of every helmer-month.
const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const rows = JSON.parse(vm.runInContext(`JSON.stringify(parseVmtCsv(VMT_CSV_TEXT).map(x => ({
  helmer: x.helmer, month: x.month, inc: [x.incCov, x.incCovMin, x.incCovMax], rec: [x.coverage, x.coverageMin, x.coverageMax]})))`, ctx));
const dataThroughMonth = r.dataThrough.slice(0, 7);
const pooled = rows.filter(x => x.month === dataThroughMonth).map(x => JSON.stringify(x.inc));
assert.ok(pooled.length >= 3 && new Set(pooled).size === 1 && JSON.parse(pooled[0])[0] < 1,
  `Replicata: read every helmer's incident coverage in the data-through month ${dataThroughMonth} from data/vmt.js.
Expectata: one pooled triple shared by every helmer, below 1.
Resultata: ${JSON.stringify(pooled)}.`);
const wrong = [];
for (const x of rows) {
  if (x.month === dataThroughMonth) continue;
  const lag = r.expectedLag[`${x.helmer}|${x.month}`];
  const want = lag || [1, 1, 1];
  if (JSON.stringify(x.inc) !== JSON.stringify(want) || JSON.stringify(x.rec) !== JSON.stringify([1, 1, 1]))
    wrong.push({ helmer: x.helmer, month: x.month, incident: x.inc, receipt: x.rec, want });
}
assert.deepEqual(wrong, [],
  `Replicata: compare every helmer-month's incident and receipt coverage in data/vmt.js with slurp.py's lag model.
Expectata: in each helmer's lagged months (${JSON.stringify(r.expectedLag)}) incident coverage = (pooled 5-Day share, lowest monthly share, 1.0) and receipt coverage 1; every other month before the data-through month (1, 1, 1) for both.
Resultata: ${JSON.stringify(wrong.slice(0, 6))}.`);
// The window the 2026-10-03 decision named starts in 2026-01 (Zoox Jan-Jun
// 2026, 17 of 27 in-scope incidents on the 5-Day track, February 1 of 4 the
// lowest; its rows left FIVE_DAY_SHARE_OBSERVATIONS when its lag returned to
// 0, and slurp.py's comment keeps them): a lagged helmer's share table starts
// there.
assert.ok(Object.values(r.shareStarts).every(m => m === "2026-01"),
  `Replicata: read the first month of every FIVE_DAY_SHARE_OBSERVATIONS table in data/slurp.py.
Expectata: 2026-01, the start of the approved window.
Resultata: ${JSON.stringify(r.shareStarts)}.`);

// 3. slurp stops on inconsistent inputs.
assert.equal(r.regenOk, true,
  `Replicata: regenerate data/vmt.js offline from the newest snapshots. Expectata: byte-identical VMT segment. Resultata: differs.`);
// Each pattern names its own must()'s message, so a removed check cannot pass
// on a neighbour's.
const expectStops = {
  coverage: /^MONTHLY_ARRIVAL_LAG and MONTHLY_ARRIVAL_OBSERVATIONS must cover every helmer/,
  zooxLag: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Zoox'/,
  waymoLag: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Waymo'/,
  due: /^no Monthly-report arrival observation for a month that is now measurable/,
  arrivalTotal: /^MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release/,
  deadShare: /^FIVE_DAY_SHARE_OBSERVATIONS must cover exactly the lagged helmers/,
};
for (const [name, re] of Object.entries(expectStops)) {
  assert.match(r.stops[name], re,
    `Replicata: run slurp.main() offline with inconsistent input "${name}".
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.stops[name])}.`);
}
// 3b. The function itself, on this release's counts and on the synthetic world.
assert.equal(r.direct.baseline, "accepted",
  `Replicata: call slurp.monthly_lag_coverage() directly on the newest snapshots' track counts with the real tables.
Expectata: accepted.
Resultata: ${JSON.stringify(r.direct.baseline)}.`);
assert.deepEqual(r.synthetic.baseline, { "Zoox|2031-05": [0.5, 0.25, 1.0] },
  `Replicata: call slurp.monthly_lag_coverage() on the synthetic world (Zoox lag 1; its 5-Day shares 2/4, 3/4, 1/4, 2/4; data-through month 2031-06).
Expectata: only Zoox's lagged month 2031-05 gets a triple: (pooled share 8/16 = 0.5, lowest share 0.25, 1.0).
Resultata: ${JSON.stringify(r.synthetic.baseline)}.`);
const tripwire = /^a lagged month already holds an in-scope Monthly-track report/;
const expectSynthetic = {
  tripwire,
  order: tripwire,
  zeroShare: /^a lagged helmer's lowest monthly 5-Day share is 0/,
  zooxLag0: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Zoox'/,
  wholeLag: /^MONTHLY_ARRIVAL_LAG values must be whole numbers of releases/,
  share: /^FIVE_DAY_SHARE_OBSERVATIONS disagree with this release/,
  shareSpan: /^a lagged helmer's FIVE_DAY_SHARE_OBSERVATIONS must hold every month from its first through the newest month final for it/,
  deadShare: /^FIVE_DAY_SHARE_OBSERVATIONS must cover exactly the lagged helmers/,
  sameMonths: /^every helmer's MONTHLY_ARRIVAL_OBSERVATIONS must cover the same months/,
  observedExcluded: /^a month is both observed and excluded/,
  future: /^an arrival observation for the data-through month or later/,
  due: /^no Monthly-report arrival observation for a month that is now measurable/,
  dueTie: /^no Monthly-report arrival observation for a month that is now measurable/,
  arrivalTotal: /^MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release/,
};
for (const [name, re] of Object.entries(expectSynthetic)) {
  assert.match(String(r.synthetic[name]), re,
    `Replicata: call slurp.monthly_lag_coverage() on the synthetic world with inconsistent input "${name}"${name === "order" ? " (a month with 5-Day share 0 AND a Monthly-track report in Zoox's lagged month)" : ""}.
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.synthetic[name])}.`);
}

// 4. The reference month of the pooled data-through-month coverage skips a
// lagged month: Zoox with June 8 incidents, July 4 (lagged: 5-Day only), August
// 1, VMT 100 each, receipt 0.32. Lag 1 -> June is the reference: 1 / (8 x 0.32)
// = 0.3906; lag 0 -> July: 1 / (4 x 0.32) = 0.7813.
assert.ok(Math.abs(r.refLagged - 0.3906) < 1e-4 && Math.abs(r.refUnlagged - 0.7812) < 2e-4,
  `Replicata: slurp.incident_coverage on synthetic Zoox rows (June 8, July 4, August 1 incidents) with Zoox's lag 1 and 0.
Expectata: 0.3906 with lag 1 (June, complete, is the reference) and 0.7812 with lag 0 (July is).
Resultata: ${r.refLagged} and ${r.refUnlagged}.`);

// 5. The app: partially received months must be the window's newest. Zoox's
// month before the data-through month gets a synthetic lag triple (0.6, 0.25,
// 1.0), so a window ends in two partially received months whatever the live
// lags are.
const lagMonth = (() => {
  const [y, m] = dataThroughMonth.split("-").map(Number), n = y * 12 + m - 2;
  return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
})();
const injectLag = `vmtRows = parseVmtCsv(VMT_CSV_TEXT).map(x => x.helmer === "Zoox" && x.month === ${JSON.stringify(lagMonth)}
    ? {...x, incCov: 0.6, incCovMin: 0.25, incCovMax: 1} : x);`;
const app = JSON.parse(vm.runInContext(`(() => {
  incidents = INCIDENT_DATA; ${injectLag}
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const zoox = monthSeriesData().points.map(p => p.helmers.Zoox).filter(Boolean).slice(-6);
  const sel = [r => r.vmtMin, r => r.vmtBest, r => r.vmtMax];
  const partial = zoox.filter(r => r.vmtMin !== r.vmtMonthMin || r.vmtMax !== r.vmtMonthMax).map(r => r.month);
  let trailing = "accepted";
  try { windowVmtBand("Zoox", zoox, ...sel); } catch (e) { trailing = String(e.message); }
  const bad = zoox.slice(0, -2).map((r, i) => i === 1 ? {...r, vmtMin: r.vmtMonthMin / 2} : r);
  let middle = "accepted";
  try { windowVmtBand("Zoox", bad, ...sel); } catch (e) { middle = String(e.message); }
  return JSON.stringify({partial, trailing, middle});
})()`, ctx));
const lagMonths = [...new Set([...Object.keys(r.expectedLag).filter(k => k.startsWith("Zoox|")).map(k => k.slice(5)), lagMonth])].sort();
assert.deepEqual(app.partial, [...lagMonths, dataThroughMonth],
  `Replicata: give Zoox's ${lagMonth} a lag triple (0.6, 0.25, 1.0) and list Zoox's Monthly-track partially received months among its last six in the app.
Expectata: its lagged months then the data-through month, ${JSON.stringify([...lagMonths, dataThroughMonth])}.
Resultata: ${JSON.stringify(app.partial)}.`);
assert.equal(app.trailing, "accepted",
  `Replicata: windowVmtBand over Zoox's last six months (Monthly-track selectors). Expectata: accepted. Resultata: ${app.trailing}.`);
assert.match(app.middle, /precedes/,
  `Replicata: windowVmtBand over four Zoox months whose second is made partial. Expectata: it throws (a partial month precedes a full one). Resultata: ${app.middle}.`);

// 6. The MPI-over-time chart with Zoox shown (the default view hides it, so
// until the reviewer's 2026-10-04 addition nothing pinned this): each month's
// "?" fades in by the largest 1 - incident_coverage_min among the shown
// helmers' dots on a Monthly-track metric, so a lagged month gets its own
// "?", and the lagged helmer's dot tooltip carries that month's coverage note.
// Zoox's month before the data-through month carries the synthetic lag
// triple of section 5.
// On All incidents, a Monthly-track metric that needs no fault ratings, so
// every shown helmer-month with miles has a dot even before a release's
// fault batch (on at-fault, an unrated month draws none).
class EscStub { set textContent(v) { this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }
const ctx6 = vm.createContext({ console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return new EscStub(); } } });
vm.runInContext(dataScript, ctx6, { filename: "data.js" });
vm.runInContext(appScript, ctx6, { filename: "crashla.js" });
const shown = JSON.parse(vm.runInContext(`(() => {
  incidents = INCIDENT_DATA; ${injectLag}
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  monthHelmerEnabled.Zoox = true; selectedMetricKey = "all";
  const s = monthSeriesData(), start = s.months.indexOf(DEFAULT_START_MONTH);
  const metric = selectedMonthMetric();
  const ads = ADS_HELMERS.filter(h => monthHelmerEnabled[h]);
  const csv = vmtRows;
  const months = s.months.slice(start);
  return JSON.stringify({
    fiveDay: metric.fiveDay === true, metric: metric.key, ads,
    html: renderAllHelmersMpiChart(sliceSeries(s, start, s.months.length - 1)),
    months,
    expected: months.map(m => Math.max(0, ...csv.filter(r => r.month === m && ads.includes(r.helmer)).map(r => 1 - r.incCovMin))),
  });
})()`, ctx6));
assert.ok(!shown.fiveDay && shown.ads.includes("Zoox"),
  `Replicata: select All incidents and switch Zoox on. Expectata: a Monthly-track metric, Zoox shown. Resultata: ${shown.metric}, ${JSON.stringify(shown.ads)}.`);
// A run of adjacent incomplete months shares one "?" (audit 2026-10-04 #36:
// on a phone the lagged month's and the data-through month's glyphs sat 3.6
// units apart and read "??"), centred on the run at its largest
// incompleteness; every complete month keeps its own at opacity 0.
// (The markers are the month-tick texts that carry an opacity, found by that
// rather than by their glyph since 2026-10-29.)
const qmarks = [...shown.html.matchAll(/<text class="month-tick" x="([\d.]+)"[^>]*style="opacity:([\d.]+);pointer-events:none">[^<]*<\/text>/g)]
  .map(m => ({ x: Number(m[1]), opacity: m[2] }));
const monthX = [...new Set([...shown.html.matchAll(/<circle class="month-dot" cx="([\d.]+)"/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
const groups = [];
shown.expected.forEach((o, i) => { if (o > 0 && i > 0 && shown.expected[i - 1] > 0) groups[groups.length - 1].push(i); else groups.push([i]); });
const wantQ = groups.map(g => ({ months: g.map(i => shown.months[i]).join("+"),
  x: (monthX[g[0]] + monthX[g[g.length - 1]]) / 2, opacity: Math.max(...g.map(i => shown.expected[i])).toFixed(3) }));
assert.ok(monthX.length === shown.months.length && qmarks.length === wantQ.length &&
  qmarks.every((q, i) => q.opacity === wantQ[i].opacity && Math.abs(q.x - wantQ[i].x) <= 0.01),
  `Replicata: the "?" markers of the default-window MPI chart with Zoox shown (metric ${shown.metric}).
Expectata: one per complete month at opacity 0 and one per run of adjacent incomplete months, centred on the run, at the run's largest 1 - incident_coverage_min over the shown ADS helmers: visible ${JSON.stringify(wantQ.filter(q => q.opacity !== "0.000"))}, ${wantQ.length} in all.
Resultata: ${qmarks.length} markers, visible ${JSON.stringify(qmarks.map((q, i) => ({ ...q, at: wantQ[i] && wantQ[i].months })).filter(q => q.opacity !== "0.000"))}.`);
// A month's ADS dot tooltips, each with its helmer: the targets whose
// accessible name is the helmer's mark-name prefix (seriesMarkName) and the
// tip. The coverage note's figures are ~best% then ~worst%. Until 2026-10-29
// this told the ADS tooltips by their word "incident" and pinned the note's
// words ("incident coverage", "worst case").
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const markPrefix = JSON.parse(vm.runInContext("JSON.stringify(Object.fromEntries(ADS_SERIES.map(h => [h, seriesMarkName(h, '')])))", ctx6));
const tipsOf = month => [...shown.html.matchAll(/data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"/g)]
  .map(m => ({ tip: decode(m[1]), name: decode(m[2]) }))
  .map(t => ({ ...t, helmer: shown.ads.find(h => t.name === markPrefix[h] + t.tip) }))
  .filter(t => t.helmer !== undefined && t.tip.startsWith(month + "\n"));
const percents = tip => (tip.match(/~\d+%/g) || []).map(p => Number(p.slice(1, -1)));
for (const [key, [best, lo]] of Object.entries({ ...r.expectedLag, [`Zoox|${lagMonth}`]: [0.6, 0.25, 1] })) {
  const [lagged, month] = key.split("|");
  const want = [Math.round(best * 100), Math.round(lo * 100)];
  const tips = tipsOf(month);
  assert.ok(tips.length === shown.ads.length && new Set(tips.map(t => t.helmer)).size === tips.length
    && tips.every(t => JSON.stringify(percents(t.tip)) === JSON.stringify(t.helmer === lagged ? want : [])),
    `Replicata: the ${month} ADS dot tooltips of that chart.
Expectata: ${shown.ads.length} tooltips, one per shown ADS helmer; the lagged helmer's (${key}) gives its coverage as ~${want[0]}% (worst case ~${want[1]}%), the others no coverage figures.
Resultata: ${JSON.stringify(tips.map(t => [t.helmer, t.tip]))}.`);
}

console.log(`qual pass: Monthly-report arrival lags measured from data/snapshots (${JSON.stringify(r.lag)}); live lagged months ${JSON.stringify(r.expectedLag)} in data/vmt.js; slurp stops on ${Object.keys(expectStops).length} inconsistent inputs through main() and ${Object.keys(expectSynthetic).length} on a synthetic lagged helmer, the lag's own stop first; a synthetic lagged month (Zoox ${lagMonth}) on the MPI chart`);

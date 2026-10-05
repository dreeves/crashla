// Per-helmer Monthly-report arrival lag (2026-10-03, human decision: model
// the late arrival of Zoox's Monthly-track SGO reports rather than re-pin
// after they land). SGO Request No. 2 (Monthly) reports for incident month M
// are due by the 15th of M+1, so they normally reach NHTSA's public file at
// the release whose data-through month is M+1 (M's second release), and the
// app treats M as complete from then on. Every in-scope Zoox Monthly-track
// report of 2026 so far reached the file one release later, so the Sep-15-2026
// file held only Zoox's one July 5-Day report while the app called July final.
//
// data/slurp.py now carries the measured lags (MONTHLY_ARRIVAL_LAG) with
// their observations (MONTHLY_ARRIVAL_OBSERVATIONS), and every month inside a
// helmer's extra lag gets a Monthly-track incident coverage equal to that
// helmer's in-scope 5-Day share (FIVE_DAY_SHARE_OBSERVATIONS: Zoox Jan-Jun
// 2026 17/27 = 0.6296), band [its lowest monthly share, 0.25; 1.0], instead
// of 1. Five-day-track metrics are unaffected (Zoox's 5-Day reports arrive on
// the normal schedule).
//
// This qual pins:
//   1. the tables reproduce from data/snapshots history (an independent
//      recompute), and slurp's own track counts agree with that recompute;
//   2. data/vmt.js carries, for every helmer-month, the pooled triple in the
//      data-through month, the lag triple in the helmer's lagged months and
//      (1, 1, 1) elsewhere, with receipt coverage untouched there -- on the
//      Sep-15-2026 release that is Zoox 2026-07 = (0.6296, 0.25, 1.0) and
//      Waymo/Tesla 2026-07 = (1, 1, 1); derived from the reviewed cutoff, so
//      no re-pin is needed when a release advances it;
//   3. slurp stops (anti-Postel) on: a lag table missing a helmer, a lag that
//      disagrees with its observations, a month that became measurable
//      without an observation, observations that disagree with the newest
//      file, and a lagged helmer whose lagged month already holds a
//      Monthly-track report in the newest file; and (3b, called directly) on a
//      fractional lag, arrival tables covering different months, a month both
//      observed and excluded, an observation for the data-through month, a
//      share table missing the month just final for its helmer, and a lowest
//      monthly share of 0;
//   4. a lagged month is never the reference month of the pooled
//      data-through-month coverage (its count is incomplete);
//   5. the app accepts the extra partially received month(s) at the end of a
//      window and still rejects a partial month followed by a full one;
//   6. with the lagged helmer shown, the MPI chart's "?" and that helmer's dot
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
newest = []
for p, is_archive in [(sorted(snap.glob('nhtsa-current-*.csv'))[-1], False),
                      (sorted(snap.glob('nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(p, newline='')):
        if is_archive: slurp._normalize_archive_row(r)
        newest.append(r)
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
for _ver, r in by_rid.values():
    if not slurp.is_public_service_incident(r): continue
    rid = r['Report ID']
    iid = rid if rid in slurp.SPLIT_SAME_INCIDENT_REPORTS else r['Same Incident ID']
    if iid not in by_inc or slurp.newer_filing(r, by_inc[iid]): by_inc[iid] = r
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
        seen = [D for D in sorted(releases) if mnum(D) >= due and r['Report ID'] in releases[D]]
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
out['zooxShares'] = {m: list(c) for m, c in slurp.FIVE_DAY_SHARE_OBSERVATIONS.get('Zoox', {}).items()}

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
# (a) a lagged helmer's lagged month already holds an in-scope Monthly report:
# a clone of an in-scope Zoox 5-Day row, moved to Zoox's lagged month (the one
# before the data-through month), filed Monthly and submitted in the
# data-through month (so the submission guard passes).
label = lambda month: datetime.date.fromisoformat(month + '-01').strftime('%b-%Y').upper()
template = next(r for r in newest if r['Reporting Entity'].strip() == 'Zoox, Inc.'
                and r['Report Type'].strip() == '5-Day' and slurp.is_public_service_incident(r))
clone = dict(template)
clone.update({'Report ID': 'synthetic-zoox-monthly', 'Same Incident ID': 'synthetic-zoox-monthly',
              'Report Type': 'Monthly', 'Report Version': '1',
              'Incident Date': label(mstr(mnum(D) - 1)), 'Report Submission Date': label(D)})
stops['tripwire'] = stop_message(newest + [clone])
# (b) the lag table misses a helmer
stops['coverage'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={'Waymo': 0, 'Tesla': 0})
# (c) a lag that disagrees with its observations
stops['zooxLag0'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={**slurp.MONTHLY_ARRIVAL_LAG, 'Zoox': 0})
stops['waymoLag1'] = stop_message(newest, MONTHLY_ARRIVAL_LAG={**slurp.MONTHLY_ARRIVAL_LAG, 'Waymo': 1})
# (d) the month that is now measurable (data-through month - 2) has no observation
due_month = mstr(mnum(D) - 2)
stops['due'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {m: c for m, c in t.items() if m != due_month} for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()})
# (e) a share row and (f) an arrival row that disagree with the newest file
zoox_shares = dict(slurp.FIVE_DAY_SHARE_OBSERVATIONS['Zoox'])
first_share = min(zoox_shares)
zoox_shares[first_share] = (zoox_shares[first_share][0] + 1, zoox_shares[first_share][1] + 1)
stops['share'] = stop_message(newest, FIVE_DAY_SHARE_OBSERVATIONS={**slurp.FIVE_DAY_SHARE_OBSERVATIONS, 'Zoox': zoox_shares})
waymo_obs = dict(slurp.MONTHLY_ARRIVAL_OBSERVATIONS['Waymo'])
first_obs = min(waymo_obs)
waymo_obs[first_obs] = (waymo_obs[first_obs][0] + 1, *waymo_obs[first_obs][1:])
stops['arrivalTotal'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={**slurp.MONTHLY_ARRIVAL_OBSERVATIONS, 'Waymo': waymo_obs})
# (g) a share table for a helmer with no lag (dead data) is rejected too
stops['deadShare'] = stop_message(newest, FIVE_DAY_SHARE_OBSERVATIONS={**slurp.FIVE_DAY_SHARE_OBSERVATIONS, 'Tesla': {first_share: (0, 1)}})
out['stops'] = stops

# --- 3b. monthly_lag_coverage()'s other stops, called directly --------------
# Section 3 shows main() reaches the function; these call it on this release's
# own track counts with one inconsistent table each (reviewer, 2026-10-04: no
# qual reached these must()s, so deleting any of them left the suite green).
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
obs, shares, lags = slurp.MONTHLY_ARRIVAL_OBSERVATIONS, slurp.FIVE_DAY_SHARE_OBSERVATIONS, slurp.MONTHLY_ARRIVAL_LAG
direct = {'baseline': direct_stop()}
# (h) a lag that is not a whole number of releases
direct['wholeLag'] = direct_stop(MONTHLY_ARRIVAL_LAG={**lags, 'Zoox': lags['Zoox'] + 0.5})
# (i) a release's arrival row added for some helmers only (Zoox's newest dropped)
direct['sameMonths'] = direct_stop(MONTHLY_ARRIVAL_OBSERVATIONS={
    **obs, 'Zoox': {m: c for m, c in obs['Zoox'].items() if m != max(obs['Zoox'])}})
# (j) an excluded month observed as well
excluded = min(slurp.MONTHLY_ARRIVAL_MONTHS_EXCLUDED)
direct['observedExcluded'] = direct_stop(MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {**t, excluded: (counts[(h, excluded, 'monthly')],)} for h, t in obs.items()})
# (k) an observation for the data-through month, which no release can measure yet
direct['future'] = direct_stop(MONTHLY_ARRIVAL_OBSERVATIONS={h: {**t, D: (0, 0)} for h, t in obs.items()})
# (l) a lagged helmer's share table without the month that just became final for it
direct['shareSpan'] = direct_stop(FIVE_DAY_SHARE_OBSERVATIONS={
    **shares, 'Zoox': {m: c for m, c in shares['Zoox'].items() if m != max(shares['Zoox'])}})
# (m) a month whose incidents were all Monthly-track: lowest share 0. The
# counts, the arrival row and the share row move together, so only the
# zero-share check can object.
zero_month = min(shares['Zoox'])
zc = collections.Counter(counts)
total = zc[('Zoox', zero_month, 'five_day')] + zc[('Zoox', zero_month, 'monthly')]
zc[('Zoox', zero_month, 'five_day')], zc[('Zoox', zero_month, 'monthly')] = 0, total
direct['zeroShare'] = direct_stop(counts=zc,
    MONTHLY_ARRIVAL_OBSERVATIONS={**obs, 'Zoox': {**obs['Zoox'], zero_month: (0, total)}},
    FIVE_DAY_SHARE_OBSERVATIONS={**shares, 'Zoox': {**shares['Zoox'], zero_month: (0, total)}})
out['direct'] = direct

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
assert.deepEqual(r.lag, { Waymo: 0, Tesla: 0, Zoox: 1 },
  `Replicata: read MONTHLY_ARRIVAL_LAG from data/slurp.py.
Expectata: {Waymo: 0, Tesla: 0, Zoox: 1} -- every in-scope Zoox Monthly-track report of 2026 reached the public file one release after the normal one; Waymo's and Tesla's at the normal one.
Resultata: ${JSON.stringify(r.lag)}.`);
assert.deepEqual(r.arrivalDiffs, [],
  `Replicata: recompute each helmer-month's Monthly-track arrivals from data/snapshots (in-scope incidents of the newest file, deduplicated as main() does; arrival = the first release whose data-through month is at least M+1 holding the surviving Report ID).
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
// The window the 2026-10-03 decision named: Zoox Jan-Jun 2026, 17 of 27
// in-scope incidents on the 5-Day track (0.63), lowest month February 1 of 4
// (0.25). These rows are history and stay put; each release appends the month
// that became final (slurp's must() enforces it), so the lagged month's
// triple moves while this pin does not. On the Sep-15-2026 release the
// derived check above is Zoox 2026-07 = (0.6296, 0.25, 1.0) and Waymo/Tesla
// 2026-07 = (1, 1, 1).
const JAN_JUN = { "2026-01": [2, 2], "2026-02": [1, 4], "2026-03": [6, 8], "2026-04": [2, 5], "2026-05": [2, 2], "2026-06": [4, 6] };
assert.deepEqual(Object.fromEntries(Object.entries(r.zooxShares).filter(([m]) => m <= "2026-06")), JAN_JUN,
  `Replicata: read Zoox's FIVE_DAY_SHARE_OBSERVATIONS rows through 2026-06 from data/slurp.py.
Expectata: the approved window, starting 2026-01: ${JSON.stringify(JAN_JUN)} (17/27 = 0.63; February 0.25 the lowest).
Resultata: ${JSON.stringify(r.zooxShares)}.`);

// 3. slurp stops on inconsistent inputs.
assert.equal(r.regenOk, true,
  `Replicata: regenerate data/vmt.js offline from the newest snapshots. Expectata: byte-identical VMT segment. Resultata: differs.`);
// Each pattern names its own must()'s message, so a removed check cannot pass
// on a neighbour's.
const expectStops = {
  tripwire: /^a lagged month already holds an in-scope Monthly-track report/,
  coverage: /^MONTHLY_ARRIVAL_LAG and MONTHLY_ARRIVAL_OBSERVATIONS must cover every helmer/,
  zooxLag0: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Zoox'/,
  waymoLag1: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Waymo'/,
  due: /^no Monthly-report arrival observation for a month that is now measurable/,
  share: /^FIVE_DAY_SHARE_OBSERVATIONS disagree with this release/,
  arrivalTotal: /^MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release/,
  deadShare: /^FIVE_DAY_SHARE_OBSERVATIONS must cover exactly the lagged helmers/,
};
for (const [name, re] of Object.entries(expectStops)) {
  assert.match(r.stops[name], re,
    `Replicata: run slurp.main() offline with inconsistent input "${name}".
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.stops[name])}.`);
}
// 3b. The function's other stops, called directly on this release's counts.
assert.equal(r.direct.baseline, "accepted",
  `Replicata: call slurp.monthly_lag_coverage() directly on the newest snapshots' track counts with the real tables.
Expectata: accepted.
Resultata: ${JSON.stringify(r.direct.baseline)}.`);
const expectDirect = {
  wholeLag: /^MONTHLY_ARRIVAL_LAG values must be whole numbers of releases/,
  sameMonths: /^every helmer's MONTHLY_ARRIVAL_OBSERVATIONS must cover the same months/,
  observedExcluded: /^a month is both observed and excluded/,
  future: /^an arrival observation for the data-through month or later/,
  shareSpan: /^a lagged helmer's FIVE_DAY_SHARE_OBSERVATIONS must hold every month from its first through the newest month final for it/,
  zeroShare: /^a lagged helmer's lowest monthly 5-Day share is 0/,
};
for (const [name, re] of Object.entries(expectDirect)) {
  assert.match(r.direct[name], re,
    `Replicata: call slurp.monthly_lag_coverage() directly with inconsistent input "${name}".
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.direct[name])}.`);
}

// 4. The reference month of the pooled data-through-month coverage skips a
// lagged month: Zoox with June 8 incidents, July 4 (lagged: 5-Day only), August
// 1, VMT 100 each, receipt 0.32. Lag 1 -> June is the reference: 1 / (8 x 0.32)
// = 0.3906; lag 0 -> July: 1 / (4 x 0.32) = 0.7813.
assert.ok(Math.abs(r.refLagged - 0.3906) < 1e-4 && Math.abs(r.refUnlagged - 0.7812) < 2e-4,
  `Replicata: slurp.incident_coverage on synthetic Zoox rows (June 8, July 4, August 1 incidents) with Zoox's lag 1 and 0.
Expectata: 0.3906 with lag 1 (June, complete, is the reference) and 0.7812 with lag 0 (July is).
Resultata: ${r.refLagged} and ${r.refUnlagged}.`);

// 5. The app: partially received months must be the window's newest.
const app = JSON.parse(vm.runInContext(`(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
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
const lagMonths = Object.keys(r.expectedLag).filter(k => k.startsWith("Zoox|")).map(k => k.slice(5));
assert.deepEqual(app.partial, [...lagMonths, dataThroughMonth],
  `Replicata: list Zoox's Monthly-track partially received months among its last six in the app.
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
// On All incidents, a Monthly-track metric that needs no fault ratings, so
// every shown helmer-month with miles has a dot even before a release's
// fault batch (on at-fault, an unrated month draws none).
class EscStub { set textContent(v) { this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }
const ctx6 = vm.createContext({ console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return new EscStub(); } } });
vm.runInContext(dataScript, ctx6, { filename: "data.js" });
vm.runInContext(appScript, ctx6, { filename: "crashla.js" });
const shown = JSON.parse(vm.runInContext(`(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  monthHelmerEnabled.Zoox = true; selectedMetricKey = "all";
  const s = monthSeriesData(), start = s.months.indexOf(DEFAULT_START_MONTH);
  const metric = selectedMonthMetric();
  const ads = ADS_HELMERS.filter(h => monthHelmerEnabled[h]);
  const csv = parseVmtCsv(VMT_CSV_TEXT);
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
const qOpacity = [...shown.html.matchAll(/<text class="month-tick"[^>]*style="opacity:([\d.]+);pointer-events:none">\?<\/text>/g)].map(m => m[1]);
assert.deepEqual(qOpacity, shown.expected.map(o => o.toFixed(3)),
  `Replicata: the "?" markers of the default-window MPI chart with Zoox shown (metric ${shown.metric}).
Expectata: one per month at opacity max(1 - incident_coverage_min) over the shown ADS helmers: ${JSON.stringify(shown.months.map((m, i) => m + " " + shown.expected[i].toFixed(3)).filter(x => !x.endsWith(" 0.000")))} visible, the rest 0.
Resultata: ${JSON.stringify(shown.months.map((m, i) => m + " " + qOpacity[i]).filter(x => !x.endsWith(" 0.000")))}.`);
const tipsOf = month => [...shown.html.matchAll(/data-tip="([^"]*)"/g)]
  .map(m => m[1].replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
  .filter(t => t.startsWith(month + "\n") && /incident/.test(t));
for (const [key, [best, lo]] of Object.entries(r.expectedLag)) {
  const month = key.slice(key.indexOf("|") + 1);
  const note = `~${Math.round(best * 100)}% incident coverage (worst case ~${Math.round(lo * 100)}%)`;
  const tips = tipsOf(month);
  assert.ok(tips.length === shown.ads.length && tips.filter(t => t.includes(note)).length === 1
    && tips.filter(t => !t.includes(note)).every(t => !/incident coverage/.test(t)),
    `Replicata: the ${month} ADS dot tooltips of that chart.
Expectata: ${shown.ads.length} tooltips; the lagged helmer's (${key}) says "${note}", the others carry no coverage note.
Resultata: ${JSON.stringify(tips)}.`);
}

console.log(`qual pass: Monthly-report arrival lags measured from data/snapshots (Zoox ${r.lag.Zoox} release late); lagged months ${JSON.stringify(r.expectedLag)} in data/vmt.js and on the MPI chart; slurp stops on 8 inconsistent inputs through main() and 6 more called directly`);

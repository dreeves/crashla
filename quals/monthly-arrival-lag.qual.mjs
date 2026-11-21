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
// observations (MONTHLY_ARRIVAL_OBSERVATIONS). Since 2026-11-21 (the human's
// decision to drop every estimate of a partly reported month: "if we know
// when a helmer's crash reports end then we compute the exact VMT for the
// crashes. if not, we don't try to guess") every month inside a helmer's
// extra lag is PENDING for that helmer's lines: no analysis row in
// data/vmt.js, its incidents in PENDING_INCIDENT_DATA, no figure counting it
// (quals/pending-months.qual.mjs holds the rule and runs a lagged release
// through main()). Until then such a month counted with a Monthly-track
// incident coverage equal to the helmer's in-scope 5-Day share
// (FIVE_DAY_SHARE_OBSERVATIONS, band [its lowest monthly share; 1.0]), and
// NHTSA's data-through month with estimated shares of its own; the checks of
// those shares went with them (this qual's old share recompute, its share
// stops, its section 4 on the pooled coverage's reference month, and the
// synthetic lag triple its sections 5 and 6 injected into the app).
//
// On the Oct-15-2026 release every helmer's in-scope August Monthly reports
// had arrived on time, Zoox's three included, so every lag is 0 and no live
// month is lagged. The lag machinery's checks therefore run on a synthetic
// world with one lagged helmer (section 3b), so they keep their teeth whoever
// is lagged.
//
// This qual pins:
//   1. the arrival table reproduces from data/snapshots history (an
//      independent recompute), each row holds the counts its month's
//      releases can have shown (two or more through the month whose third
//      release this is, the on-time count alone after it; since 2026-11-21),
//      slurp's own track counts agree with that recompute, and the lags are
//      the measured ones;
//   2. a lag's effect: month_sources(), on data/vmt.csv, leaves a helmer's
//      lagged months without a source (pending) for each of its lines and
//      every other month before the data-through month complete, with the
//      live lags and with each helmer's lag raised by one where that leaves
//      no pending month before a counted one; and data/vmt.js carries, for
//      every line-month before the data-through month that has an analysis
//      row, receipt and incident coverage (1, 1, 1), and no analysis row for
//      a lagged month;
//   3. slurp.main() stops (anti-Postel) on: a lag table missing a helmer, a
//      lag that disagrees with its observations, a month that became
//      measurable without an observation, that month's row left with its
//      on-time count alone (since 2026-11-21; audit 2026-11-20, A45), and
//      observations that disagree with the newest file;
//   3b. check_monthly_arrivals(), called directly on the synthetic world,
//      accepts it and stops on: a lagged month that already holds a
//      Monthly-track report; a lag that disagrees with its observations; a
//      fractional lag; arrival tables covering different months; a month
//      both observed and excluded; an observation for the data-through
//      month; a measurable month without an observation, and that stop comes
//      BEFORE the lag check (with the month gone, a tie in the month before it
//      would otherwise read as a lag disagreement, as Tesla's 2026-07 would on
//      the Nov-2026 release); an arrival row that disagrees with the
//      counts; and, since 2026-11-21, a row that does not hold what its
//      releases can have shown: the measurable month's row with its on-time
//      count alone (a row entered early, as 2026-09's were at the Nov-16-2026
//      release, is re-measured at its third release: until then nothing
//      required it, so with no report late the row stayed as it was and the
//      list's allowance, which reads only rows with both counts, left the
//      month out), and a later month's row with a second count, which no
//      release can have measured yet. The first is also run on this
//      release's own tables read as the next release would read them, the
//      month before the data-through month on-time-only;
//   5. the app accepts one partially received month at the end of a window
//      (a list row, its line's newest analysis month) and rejects a partial
//      month followed by a full one and a window with two partial months
//      (from 2026-10-04 to 2026-11-21 it accepted several, the data-through
//      month and a helmer's lagged months before it);
//   6. on the MPI chart each month has its own "?", faded in by the largest
//      incompleteness among the shown lines' dots (a list row's month is the
//      only one that shows; a pending month has no dot), and a partially
//      received month's dot tooltip gives its share on the metric's track;
//      and (since 2026-11-03, open question 31) on every metric, in the
//      default window and in the newest month's one-month window, with the
//      default lines and with every company line shown, every dot and error
//      bar fades by its month's whole completeness at worst, as the chart's
//      "?" markers (checked there too) do, and the y axis tops out at the
//      first rung at or above the largest posterior median among the chart's
//      dots, whatever each month's completeness (since 2026-11-03, the
//      human's choice; until then a fully received month lifted it to its
//      top effective miles over its incident count).
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
# incident's track is its crash's first filing's Report Type (a re-filing
# under a new Report ID, SUPERSEDED_REPORTS, takes the report it replaced:
# since 2026-11-02, open question 26(a); until then the surviving report's own
# version 1).
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
replaced_by = {new: old for old, new in slurp.SUPERSEDED_REPORTS.items()}
for r in by_inc.values():
    h, M = slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip())
    first_report = replaced_by.get(r['Report ID'], r['Report ID'])
    track = {'1-Day': 'five_day', '5-Day': 'five_day', 'Monthly': 'monthly'}[first_type[first_report]]
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
# The form of each row, by the releases its month has had (counted here, not
# through check_monthly_arrivals(), whose stops on a row of the wrong form are
# tested below): a month through the one whose third release this is (two
# months before the data-through month) holds at least two counts, its second
# release's and the reports that arrived a release late, a 0 included; a later
# month, entered early, holds its on-time count alone. The comparison above
# trims trailing zeros, so it cannot tell (62,) from (62, 0) (audit 2026-11-20,
# A45).
out['arrivalForm'] = sorted(
    [h, m, list(c)] for h, table in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items() for m, c in table.items()
    if (len(c) < 2 if mnum(m) <= mnum(slurp.NHTSA_DATA_THROUGH_DATE[:7]) - 2 else len(c) != 1))
impl = slurp.monthly_track_counts(newest)
out['trackCountDiffs'] = sorted(['|'.join(k), impl.get(k, 0), tracks.get(k, 0)]
                                for k in set(impl) | set(tracks) if impl.get(k, 0) != tracks.get(k, 0))

# --- 2. what a lag does: its months have no source ----------------------------
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
vmt = slurp.parse_vmt_values(slurp.read_vmt_master())
list_cov = slurp.preprint_coverage(vmt)
def lagged_months(lags):
    return sorted(f'{line}|{mstr(mnum(D) - 1 - i)}' for line, h in slurp.SERIES_COMPANY.items() for i in range(lags[h])
                  if (line, mstr(mnum(D) - 1 - i)) in vmt)
def sources_under(lags):
    saved = slurp.MONTHLY_ARRIVAL_LAG
    slurp.MONTHLY_ARRIVAL_LAG = lags
    try:
        sources = slurp.month_sources(vmt, D, list_cov)
    except AssertionError as exc:
        return {'stop': str(exc)[:1200]}
    finally:
        slurp.MONTHLY_ARRIVAL_LAG = saved
    before = [(line, month) for line, month in vmt if month < D]
    return {'pending': sorted(f'{line}|{month}' for line, month in before if (line, month) not in sources),
            'other': sorted({sources[key] for key in before if key in sources}),
            'want': lagged_months(lags)}
out['lagged'] = lagged_months(slurp.MONTHLY_ARRIVAL_LAG)
out['liveSources'] = sources_under(dict(slurp.MONTHLY_ARRIVAL_LAG))
out['raised'] = {h: sources_under({**slurp.MONTHLY_ARRIVAL_LAG, h: slurp.MONTHLY_ARRIVAL_LAG[h] + 1}) for h in slurp.MONTHLY_ARRIVAL_LAG}
out['listCompanies'] = sorted({slurp.SERIES_COMPANY[line] for line, _month in list_cov})

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
# (e) the month that is now measurable holds its on-time counts only
stops['dueOnTimeOnly'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {**t, due_month: t[due_month][:1]} for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()})
# (f) an arrival row that disagrees with the newest file
waymo_obs = dict(slurp.MONTHLY_ARRIVAL_OBSERVATIONS['Waymo'])
first_obs = min(waymo_obs)
waymo_obs[first_obs] = (waymo_obs[first_obs][0] + 1, *waymo_obs[first_obs][1:])
stops['arrivalTotal'] = stop_message(newest, MONTHLY_ARRIVAL_OBSERVATIONS={**slurp.MONTHLY_ARRIVAL_OBSERVATIONS, 'Waymo': waymo_obs})
out['stops'] = stops

# --- 3b. check_monthly_arrivals() on a synthetic world, called directly -------
# Section 3 shows main() reaches the function. Here it runs on made-up months
# 2031-01..2031-06 (data-through month 2031-06) with one lagged helmer, Zoox
# (lag 1, lagged month 2031-05), whose Monthly-track arrivals agree with the
# made-up counts. Each case breaks one thing, so only the must() under test
# can object; the dueTie case breaks two at once (a measurable month without
# an observation AND a tie before it), and the missing month's stop must win.
counts = slurp.monthly_track_counts(newest)
def direct_stop(counts=counts, last_month=D, **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try:
        slurp.check_monthly_arrivals(counts, last_month)
    except AssertionError as exc:
        return str(exc)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
    return 'accepted'
direct = {'baseline': direct_stop()}
# The next release as it would read this one's tables were no Monthly report
# of the month before the data-through month to arrive late: the counts
# unchanged, that month's rows holding their on-time counts alone (as
# 2026-09's do at the Nov-16-2026 release), the data-through month one later.
# The month is then the measurable one, and its rows lack their second count.
prev_month = mstr(mnum(D) - 1)
out['prevMonth'] = prev_month
direct['nextOnTimeOnly'] = direct_stop(last_month=mstr(mnum(D) + 1), MONTHLY_ARRIVAL_OBSERVATIONS={
    h: {**t, prev_month: (counts[(h, prev_month, 'monthly')],)} for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()})
W_D = '2031-06'
W_OBS = {'Waymo': {'2031-01': (5, 0), '2031-02': (6, 0), '2031-03': (4, 1), '2031-04': (5, 0)},
         'Tesla': {'2031-01': (1, 0), '2031-02': (2, 0), '2031-03': (0, 0), '2031-04': (1, 0)},
         'Zoox': {'2031-01': (0, 2), '2031-02': (0, 1), '2031-03': (0, 3), '2031-04': (0, 2)}}
W_LAG = {'Waymo': 0, 'Tesla': 0, 'Zoox': 1}
# The world's 5-Day-track counts, which the arrival checks do not read (a
# month's Monthly-track count is all they compare).
W_FIVE_DAY = {'2031-01': 2, '2031-02': 3, '2031-03': 1, '2031-04': 2}
def w_counts(obs=W_OBS, lagged_monthly=0):
    c = collections.Counter()
    for h, t in obs.items():
        for m, arrived in t.items(): c[(h, m, 'monthly')] = sum(arrived)
    for m, five_day in W_FIVE_DAY.items(): c[('Zoox', m, 'five_day')] = five_day
    c[('Zoox', '2031-05', 'five_day')] = 1
    c[('Zoox', '2031-05', 'monthly')] = lagged_monthly
    return c
def w_call(counts=None, **patch):
    tables = {'MONTHLY_ARRIVAL_OBSERVATIONS': W_OBS, 'MONTHLY_ARRIVAL_LAG': W_LAG,
              'MONTHLY_ARRIVAL_MONTHS_EXCLUDED': {}, **patch}
    saved = {k: getattr(slurp, k) for k in tables}
    for k, v in tables.items(): setattr(slurp, k, v)
    try:
        got = slurp.check_monthly_arrivals(w_counts() if counts is None else counts, W_D)
        return 'accepted' if got is None else repr(got)
    except AssertionError as exc:
        return str(exc)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
synthetic = {'baseline': w_call()}
# a lagged month that already holds a Monthly-track report
synthetic['tripwire'] = w_call(counts=w_counts(lagged_monthly=1))
# a lag that disagrees with its observations
synthetic['zooxLag0'] = w_call(MONTHLY_ARRIVAL_LAG={**W_LAG, 'Zoox': 0})
# a lag that is not a whole number of releases
synthetic['wholeLag'] = w_call(MONTHLY_ARRIVAL_LAG={**W_LAG, 'Zoox': 1.5})
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
# the measurable month's rows (2031-04) left with their on-time counts alone,
# the counts those rows total (so no other check can object)
short_obs = {h: {**t, '2031-04': t['2031-04'][:1]} for h, t in W_OBS.items()}
synthetic['onTimeOnly'] = w_call(counts=w_counts(short_obs), MONTHLY_ARRIVAL_OBSERVATIONS=short_obs)
# the month after it (2031-05, Zoox's lagged month, which holds no Zoox
# Monthly report) entered early: with its on-time counts alone, accepted;
# with a second count, which no release can have measured, a stop
early_obs = {'Waymo': {**W_OBS['Waymo'], '2031-05': (4,)}, 'Tesla': {**W_OBS['Tesla'], '2031-05': (1,)}, 'Zoox': {**W_OBS['Zoox'], '2031-05': (0,)}}
synthetic['enteredEarly'] = w_call(counts=w_counts(early_obs), MONTHLY_ARRIVAL_OBSERVATIONS=early_obs)
unmeasured_obs = {h: {**t, '2031-05': (*t['2031-05'], 0)} for h, t in early_obs.items()}
synthetic['lateCountEarly'] = w_call(counts=w_counts(unmeasured_obs), MONTHLY_ARRIVAL_OBSERVATIONS=unmeasured_obs)
out['direct'] = direct
out['synthetic'] = synthetic

print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: run the Monthly-arrival-lag checks against data/slurp.py and data/snapshots.
Expectata: slurp.py defines MONTHLY_ARRIVAL_LAG, MONTHLY_ARRIVAL_OBSERVATIONS, monthly_track_counts(), check_monthly_arrivals() and month_sources(), and the checks run.
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
assert.deepEqual(r.arrivalForm, [],
  `Replicata: read each MONTHLY_ARRIVAL_OBSERVATIONS row's counts against the releases its month has had (data-through month ${r.dataThrough.slice(0, 7)}).
Expectata: a month through the one whose third release this is (two months before the data-through month) holds at least two counts, its second release's and the reports that arrived a release late, a 0 included; a later month, entered early, holds its on-time count alone.
Resultata: [helmer, month, row] ${JSON.stringify(r.arrivalForm)}.`);
assert.deepEqual(r.trackCountDiffs, [],
  `Replicata: compare slurp.monthly_track_counts() on the newest snapshots with this qual's independent count, every helmer-month-track.
Expectata: identical.
Resultata: [key, slurp, qual] ${JSON.stringify(r.trackCountDiffs.slice(0, 8))}.`);

// 2. A lag's effect: its months are pending. month_sources() on data/vmt.csv
// with the live lags, then with each helmer's lag raised by one release.
const dataThroughMonth = r.dataThrough.slice(0, 7);
assert.ok(JSON.stringify(r.liveSources.pending) === JSON.stringify(r.lagged) && JSON.stringify(r.liveSources.other) === JSON.stringify(["nhtsa"]),
  `Replicata: call slurp.month_sources() on data/vmt.csv (data-through month ${dataThroughMonth}) with MONTHLY_ARRIVAL_LAG ${JSON.stringify(r.lag)} and list the line-months before ${dataThroughMonth} it gives no source, and the sources of the others.
Expectata: no source (pending) for exactly each helmer's lagged months on each of its lines, ${JSON.stringify(r.lagged)}; every other month before the data-through month from NHTSA's file ("nhtsa").
Resultata: ${JSON.stringify(r.liveSources)}.`);
// A helmer whose list covers the data-through month cannot take a lag (a
// pending month before a counted one stops the run: quals/pending-months.qual.mjs
// (5d)); every other helmer's raised lag leaves its extra month pending.
const raisedProblems = Object.entries(r.raised).filter(([helmer, got]) => r.listCompanies.includes(helmer)
  ? !(typeof got.stop === "string" && got.stop.includes(dataThroughMonth))
  : !(got.stop === undefined && got.want.length > r.lagged.length && JSON.stringify(got.pending) === JSON.stringify(got.want) && JSON.stringify(got.other) === JSON.stringify(["nhtsa"])));
assert.deepEqual(raisedProblems, [],
  `Replicata: call slurp.month_sources() on data/vmt.csv with each helmer's lag raised by one release in turn.
Expectata: that helmer's lines have no source in one more month before ${dataThroughMonth} (the month is pending: no analysis row, no counted incident), and nothing else changes; for a helmer whose own list covers ${dataThroughMonth} (${JSON.stringify(r.listCompanies)}) the run stops instead, naming ${dataThroughMonth}, since a pending month would precede a counted one.
Resultata: ${JSON.stringify(raisedProblems)}.`);
// data/vmt.js: every analysis row before the data-through month is complete,
// and no lagged month has one.
const ctx = vm.createContext({
  console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const rows = JSON.parse(vm.runInContext(`JSON.stringify(parseVmtCsv(VMT_CSV_TEXT).map(x => ({
  helmer: x.helmer, month: x.month, inc: [x.incCov, x.incCovMin, x.incCovMax], rec: [x.coverage, x.coverageMin, x.coverageMax], through: x.through})))`, ctx));
const wrong = rows.filter(x => x.month < dataThroughMonth &&
  (JSON.stringify(x.inc) !== "[1,1,1]" || JSON.stringify(x.rec) !== "[1,1,1]" || x.through !== r.dataThrough || r.lagged.includes(`${x.helmer}|${x.month}`)));
assert.deepEqual(wrong, [],
  `Replicata: read every analysis row of data/vmt.js for a month before the data-through month ${dataThroughMonth}.
Expectata: receipt and incident coverage (1, 1, 1), its incidents through NHTSA's cutoff (${r.dataThrough}), and none for a helmer's lagged month (${JSON.stringify(r.lagged)}), which is pending.
Resultata: ${JSON.stringify(wrong.slice(0, 6))}.`);

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
  dueOnTimeOnly: /^a Monthly-report arrival row for a month whose third release has come holds its on-time count only/,
  arrivalTotal: /^MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release/,
};
for (const [name, re] of Object.entries(expectStops)) {
  assert.match(r.stops[name], re,
    `Replicata: run slurp.main() offline with inconsistent input "${name}".
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.stops[name])}.`);
}
// 3b. The function itself, on this release's counts and on the synthetic world.
assert.equal(r.direct.baseline, "accepted",
  `Replicata: call slurp.check_monthly_arrivals() directly on the newest snapshots' track counts with the real tables.
Expectata: accepted.
Resultata: ${JSON.stringify(r.direct.baseline)}.`);
assert.equal(r.synthetic.baseline, "accepted",
  `Replicata: call slurp.check_monthly_arrivals() on the synthetic world (Zoox lag 1, its Monthly reports of 2031-01..04 all a release late; data-through month 2031-06).
Expectata: accepted, returning nothing (the lagged month 2031-05 is pending by month_sources(); until 2026-11-21 this returned its coverage triple).
Resultata: ${JSON.stringify(r.synthetic.baseline)}.`);
assert.match(r.direct.nextOnTimeOnly, /^a Monthly-report arrival row for a month whose third release has come holds its on-time count only/,
  `Replicata: call slurp.check_monthly_arrivals() on the newest snapshots' track counts as the next release would read them were no Monthly report of ${r.prevMonth} to arrive late: the data-through month one later, the real tables with ${r.prevMonth}'s rows holding their on-time counts alone.
Expectata: it stops, naming the rows: ${r.prevMonth}'s third release has come, and its rows must take their second count, 0 included (data/README.md, Each NHTSA release, step 3).
Resultata: ${JSON.stringify(r.direct.nextOnTimeOnly)}.`);
assert.equal(r.synthetic.enteredEarly, "accepted",
  `Replicata: call slurp.check_monthly_arrivals() on the synthetic world with rows for 2031-05, the month before the data-through month, holding their on-time counts alone.
Expectata: accepted (a month entered early holds its on-time counts until its third release).
Resultata: ${JSON.stringify(r.synthetic.enteredEarly)}.`);
const tripwire = /^a lagged month already holds an in-scope Monthly-track report/;
const expectSynthetic = {
  tripwire,
  zooxLag0: /^a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations.*'helmer': 'Zoox'/,
  wholeLag: /^MONTHLY_ARRIVAL_LAG values must be whole numbers of releases/,
  sameMonths: /^every helmer's MONTHLY_ARRIVAL_OBSERVATIONS must cover the same months/,
  observedExcluded: /^a month is both observed and excluded/,
  future: /^an arrival observation for the data-through month or later/,
  due: /^no Monthly-report arrival observation for a month that is now measurable/,
  dueTie: /^no Monthly-report arrival observation for a month that is now measurable/,
  arrivalTotal: /^MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release/,
  onTimeOnly: /^a Monthly-report arrival row for a month whose third release has come holds its on-time count only/,
  lateCountEarly: /^a Monthly-report arrival row for a month whose third release has not come holds more than its on-time count/,
};
for (const [name, re] of Object.entries(expectSynthetic)) {
  assert.match(String(r.synthetic[name]), re,
    `Replicata: call slurp.check_monthly_arrivals() on the synthetic world with inconsistent input "${name}".
Expectata: it stops with a message matching ${re}.
Resultata: ${JSON.stringify(r.synthetic[name])}.`);
}

// 5. The app: a window holds at most one partially received month, after
// every fully received one. The partial rows are the list rows (a month a
// company's own dated list covers: receipt or incident coverage below 1),
// each its line's newest analysis month. A line with one is read from the
// data, never assumed; with none on the page (a release no list covers) the
// same checks run on a line's newest month made partial.
const app = JSON.parse(vm.runInContext(`(() => {
  loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  const series = monthSeriesData();
  const sel = [r => r.vmtMin, r => r.vmtBest, r => r.vmtMax];
  const isPartial = r => r.vmtMin !== r.vmtMonthMin || r.vmtMax !== r.vmtMonthMax;
  const attempt = (line, rows) => { try { windowVmtBand(line, rows, ...sel); return "accepted"; } catch (e) { return String(e.message); } };
  return JSON.stringify(ADS_SERIES.map(line => {
    const mine = series.points.map(p => p.helmers[line]).filter(Boolean).slice(-6);
    const full = mine.filter(r => !isPartial(r));
    const halved = r => ({...r, vmtMin: r.vmtMonthMin / 2});
    return { line, months: mine.map(r => r.month), partial: mine.filter(isPartial).map(r => r.month),
      trailing: attempt(line, mine),
      // the newest fully received month made partial, alone at the end
      one: attempt(line, [...full.slice(0, -1), halved(full.at(-1))]),
      // a partial month followed by a full one
      middle: attempt(line, full.slice(0, 4).map((r, i) => i === 1 ? halved(r) : r)),
      // two partial months at the end
      two: attempt(line, [...full.slice(0, -2), ...full.slice(-2).map(halved)]) };
  }));
})()`, ctx));
const listRowsOf = line => rows.filter(x => x.helmer === line && (x.rec.some(v => v !== 1) || x.inc.some(v => v !== 1))).map(x => x.month);
const bandProblems = app.filter(x => x.months.length < 5 || JSON.stringify(x.partial) !== JSON.stringify(listRowsOf(x.line).filter(m => x.months.includes(m)))
  || x.partial.length > 1 || (x.partial.length === 1 && x.partial[0] !== x.months.at(-1))
  || x.trailing !== "accepted" || x.one !== "accepted" || x.middle === "accepted" || x.two === "accepted");
assert.deepEqual(bandProblems, [],
  `Replicata: for each line, take its last six months in the app and ask windowVmtBand (Monthly-track selectors) for the band of: those months as they are; its fully received months with the newest made partial; four fully received months with the second made partial; its fully received months with the newest two made partial.
Expectata: at least five months each; its partially received months are its list rows, at most one, its newest; the first two windows accepted, the last two rejected (a partial month before a full one; two partial months).
Resultata: ${JSON.stringify(bandProblems)}.`);

// 6. The MPI-over-time chart: each month's "?" fades in by the largest
// incompleteness among the shown lines' dots on the metric's track, 1 - w,
// w the month's whole completeness at worst as the effective miles scale it
// (receivedShare's worst: coverage x incident_coverage_min on a Monthly-track
// metric, until 2026-11-02 1 - incident_coverage_min alone, decision 23(a);
// coverage_min on a five-day-track one, which until 2026-11-02 drew every "?"
// at opacity 0). Each month has its own marker: a window holds at most one
// partially received month per line, every line's in the same month (the
// list's), so no two adjacent months are marked (from 2026-10-04, audit #36,
// to 2026-11-21 a run of adjacent incomplete months, a lagged month and the
// data-through month, shared one "?"). A partially received month's dot
// tooltip carries its share on the metric's track, best then worst; a
// pending line-month has no dot. Checked with every company line shown, on
// All incidents (a Monthly-track metric that needs no fault ratings, so every
// shown line-month with miles has a dot even before a release's fault batch)
// and on each five-day-track metric.
class EscStub { set textContent(v) { this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }
const ctx6 = vm.createContext({ console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return new EscStub(); } } });
vm.runInContext(dataScript, ctx6, { filename: "data.js" });
vm.runInContext(appScript, ctx6, { filename: "crashla.js" });
// The world is set up once: monthSeriesData computes every metric and every
// line, so only the selected metric (and, in the last part, the shown lines
// and the window) changes between the renders below.
vm.runInContext(`loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  var section6DefaultLines = {...monthHelmerEnabled};
  for (const line of ADS_SERIES) monthHelmerEnabled[line] = true;
  var section6Series = monthSeriesData();`, ctx6);
// The default-window chart on one metric with every company line shown, and
// each month's expected "?" opacity: the largest 1 - (the month's whole
// completeness at worst for that metric's track) over the shown company
// lines, read from the coverage columns.
const renderOn = key => JSON.parse(vm.runInContext(`(() => {
  selectedMetricKey = ${JSON.stringify(key)};
  const s = section6Series, start = s.months.indexOf(DEFAULT_START_MONTH);
  const metric = selectedMonthMetric();
  const ads = ADS_SERIES.filter(h => monthHelmerEnabled[h]);
  const csv = vmtRows;
  const months = s.months.slice(start);
  const track = metric.fiveDay === true
    ? { best: r => r.coverage, worst: r => r.coverageMin, rule: "1 - coverage_min (the receipt coverage alone)" }
    : { best: r => r.coverage * r.incCov, worst: r => r.coverage * r.incCovMin, rule: "1 - coverage x incident_coverage_min" };
  return JSON.stringify({
    fiveDay: metric.fiveDay === true, metric: metric.key, ads, rule: track.rule,
    html: renderAllHelmersMpiChart(sliceSeries(s, start, s.months.length - 1)),
    months,
    expected: months.map(m => Math.max(0, ...csv.filter(r => r.month === m && ads.includes(r.helmer)).map(r => 1 - track.worst(r)))),
    rows: csv.filter(r => months.includes(r.month) && ads.includes(r.helmer)).map(r => ({ line: r.helmer, month: r.month, best: track.best(r), worst: track.worst(r) })),
  });
})()`, ctx6));
// (The markers are the month-tick texts that carry an opacity, found by that
// rather than by their glyph since 2026-10-29.)
const checkQmarks = chart => {
  const qmarks = [...chart.html.matchAll(/<text class="month-tick" x="([\d.]+)"[^>]*style="opacity:([\d.]+);pointer-events:none">[^<]*<\/text>/g)]
    .map(m => ({ x: Number(m[1]), opacity: m[2] }));
  const monthX = [...new Set([...chart.html.matchAll(/<circle class="month-dot" cx="([\d.]+)"/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  const wantQ = chart.months.map((month, i) => ({ month, x: monthX[i], opacity: chart.expected[i].toFixed(3) }));
  assert.ok(monthX.length === chart.months.length && qmarks.length === wantQ.length &&
    qmarks.every((q, i) => q.opacity === wantQ[i].opacity && Math.abs(q.x - wantQ[i].x) <= 0.01),
    `Replicata: the "?" markers of the ${chart.where ?? "default-window MPI chart with every company line shown"} (metric ${chart.metric}).
Expectata: one per month, over the month's dots, at the month's largest ${chart.rule} over the shown company lines (0 for a fully received month): visible ${JSON.stringify(wantQ.filter(q => q.opacity !== "0.000"))}, ${wantQ.length} in all.
Resultata: ${qmarks.length} markers, visible ${JSON.stringify(qmarks.map((q, i) => ({ ...q, at: wantQ[i] && wantQ[i].month })).filter(q => q.opacity !== "0.000"))}.`);
};
// A month's company dot tooltips, each with its line: the targets whose
// accessible name is the line's mark-name prefix (seriesMarkName) and the
// tip. The coverage note's figures are ~best% then ~worst%. Until 2026-10-29
// this told the company tooltips by their word "incident" and pinned the
// note's words ("incident coverage", "worst case").
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const markPrefix = JSON.parse(vm.runInContext("JSON.stringify(Object.fromEntries(ADS_SERIES.map(h => [h, seriesMarkName(h, '')])))", ctx6));
const tipsOf = (chart, month) => [...chart.html.matchAll(/data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"/g)]
  .map(m => ({ tip: decode(m[1]), name: decode(m[2]) }))
  .map(t => ({ ...t, line: chart.ads.find(h => t.name === markPrefix[h] + t.tip) }))
  .filter(t => t.line !== undefined && t.tip.startsWith(month + "\n"));
const percents = tip => [...tip.matchAll(/~(\d+)%/g)].map(m => Number(m[1]));
// Each month's company dot tooltips on a chart: one per shown line with a row
// that month (a pending line-month has no row and no dot), a partially
// received row's giving its share (best, worst) and a fully received one's
// no share.
const checkTips = chart => {
  const partialMonths = [...new Set(chart.rows.filter(x => x.worst < 0.999).map(x => x.month))];
  for (const month of [...partialMonths, chart.months[0]]) {
    const mine = chart.rows.filter(x => x.month === month);
    const tips = tipsOf(chart, month);
    const want = Object.fromEntries(mine.map(x => [x.line, x.worst < 0.999 ? [Math.round(x.best * 100), Math.round(x.worst * 100)] : []]));
    assert.ok(tips.length === mine.length && new Set(tips.map(t => t.line)).size === tips.length
      && tips.every(t => JSON.stringify(percents(t.tip)) === JSON.stringify(want[t.line])),
      `Replicata: the ${month} company dot tooltips of the default-window MPI chart with every company line shown (metric ${chart.metric}).
Expectata: one per shown line with a data/vmt.js analysis row that month (${mine.map(x => x.line).join(", ") || "none"}); a partially received row's gives its share of the month's eventual incidents on the metric's track as ~best% then ~worst% (${JSON.stringify(want)}), a fully received one's no share.
Resultata: ${JSON.stringify(tips.map(t => [t.line, t.tip]))}.`);
  }
  return partialMonths;
};
const shown = renderOn("all");
assert.ok(!shown.fiveDay && shown.ads.length >= 3,
  `Replicata: select All incidents and switch every company line on. Expectata: a Monthly-track metric, three or more lines shown. Resultata: ${shown.metric}, ${JSON.stringify(shown.ads)}.`);
checkQmarks(shown);
const monthlyPartial = checkTips(shown);
// Every five-day-track metric, in the same world: a list row is partial on
// that track too, by its receipt coverage alone (the list holds the crashes
// through its date), so the same month is marked.
const fiveDayKeys = JSON.parse(vm.runInContext("JSON.stringify(METRIC_DEFS.filter(m => m.fiveDay === true).map(m => m.key))", ctx6));
assert.ok(fiveDayKeys.length > 0,
  `Replicata: list the five-day-track metrics of METRIC_DEFS. Expectata: at least one. Resultata: none.`);
for (const metricKey of fiveDayKeys) {
  const chart = renderOn(metricKey);
  assert.ok(chart.fiveDay, `Replicata: select ${metricKey}. Expectata: a five-day-track metric. Resultata: ${chart.metric}, five-day ${chart.fiveDay}.`);
  checkQmarks(chart);
  const partial = checkTips(chart);
  assert.deepEqual(partial, monthlyPartial,
    `Replicata: list the default window's months in which a shown company line's receipt coverage at worst (coverage_min) is below 1 (metric ${metricKey}).
Expectata: the months partial on the Monthly track, ${JSON.stringify(monthlyPartial)} (a list row counts a share of its month's miles on both tracks).
Resultata: ${JSON.stringify(partial)}.`);
}

// The dots, error bars and y axis (open question 31; added 2026-11-03, when
// nothing pinned them). Since 0250d85 (2026-11-02, decision 23(a)) a month's
// dots and error bars fade by the quantity its "?" does, the month's whole
// completeness at worst, w (receivedShare's worst: coverage x
// incident_coverage_min on a Monthly-track metric, coverage_min on a five-day
// one, 1 for a human cohort), each drawn at opacity 0.35 + 0.65 x w (a dot
// through the group around it), so a fully received month's are opaque.
// Until then w was incident_coverage_min alone on the Monthly track and 1 on
// the five-day track: 2026-09's company marks drew at 0.528 on a
// Monthly-track metric, where 0.374 is due, and at 1.000 on a five-day one,
// where 0.390 is. And the y axis tops out at the first rung of its tick
// ladder at or above the largest posterior median among the chart's dots,
// whatever each month's completeness, so every dot is on-scale and an error
// bar that runs past the top is cut at the plot's edge. That is the human's
// choice of 2026-11-03 ("Medians only"), when this check was restated. Until
// then a fully received month (w above 0.99) lifted the axis to its mpiMax,
// a field crashla.js dropped that day, where that was finite (its top
// effective miles over its incident count; a human cohort's band high edge),
// and a fault mass or fatality share under 1 is finite too, at up to 20
// times its top effective miles: the default at-fault-injury chart topped
// out at 500M on Waymo 2026-05's 0.05 (20,544,572 / 0.05 = 411M), its 48
// dots in the bottom 15% of the plot, where 80M is due. And until 0250d85
// (2026-11-02) a five-day metric's partly received month counted as fully
// received there, so the one-month 2026-09 airbag chart topped out at 8M
// where 2M is due.
// Checked on every metric, in the default window and in the one-month window
// of the series' newest month (the slider's last: the newest month with an
// analysis row, where a list row is partly received; until 2026-11-21 the
// data-through month, which has no analysis row now unless a list covers
// it), with the default lines and with every company line shown, with the
// "?" markers of each of those charts. A line's
// month has a dot and an error bar where the series gives it a posterior for
// the metric (an unrated month on an at-fault metric gets none, and a
// pending line-month none on any), and the
// medians the rule takes are the series' own; the marks' colours
// tell the lines apart and their x positions the months. w is read from the
// coverage columns of parseVmtCsv's rows, as for the "?" above. The chart's
// tick requests (linearTicks(min, max, count)) are recorded while it renders,
// for the axis check's message: it states the ladder linearTicks gives for
// the largest median at the chart's own count, as mpi-y-range.qual's check
// 1b does. Until 2026-11-04 the message took the due top from the rendered
// ladder's step, so on the axis the rule before 2026-11-03 drew for the
// default at-fault-injury chart, 0-500M by 100M, it named 100M as due, where
// linearTicks on that chart's largest median, 74.1M, draws 0-80M by 20M.
const appLinearTicks = vm.runInContext("linearTicks", ctx6);
const chartCase = (key, oneMonth, everyLine) => JSON.parse(vm.runInContext(`(() => {
  const saved = [selectedMetricKey, monthHelmerEnabled];
  selectedMetricKey = ${JSON.stringify(key)};
  monthHelmerEnabled = {...section6DefaultLines${everyLine ? ", ...Object.fromEntries(ADS_SERIES.map(line => [line, true]))" : ""}};
  const s = section6Series, end = s.months.length - 1;
  const start = ${oneMonth ? "end" : "s.months.indexOf(DEFAULT_START_MONTH)"};
  const metric = selectedMonthMetric();
  const appTicks = linearTicks, tickCalls = [];
  linearTicks = (min, max, count) => { tickCalls.push({ min, max, count }); return appTicks(min, max, count); };
  const html = renderAllHelmersMpiChart(sliceSeries(s, start, end));
  linearTicks = appTicks;
  const months = s.months.slice(start, end + 1);
  const lines = includedHelmers().map(line => ({ line, human: HUMAN_HELMERS.includes(line), color: HELMER_COLORS[line],
    points: months.map((month, j) => {
      const row = s.points[start + j].helmers[line];
      const mpi = row ? row.mpiByMetric[metric.key] : null;
      const csv = vmtRows.find(x => x.helmer === line && x.month === month);
      return { month, dot: Boolean(mpi), median: mpi ? mpi.mpiMedian : null,
        csv: csv ? { coverage: csv.coverage, coverageMin: csv.coverageMin, incCovMin: csv.incCovMin } : null };
    }) }));
  [selectedMetricKey, monthHelmerEnabled] = saved;
  return JSON.stringify({ metric: metric.key, fiveDay: metric.fiveDay === true, companyLines: ADS_SERIES,
    defaultStart: DEFAULT_START_MONTH, months, lines, html, tickCalls });
})()`, ctx6));
const TICK_UNIT = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const tickValue = label => { const m = /^([\d,.]+)([KMBT]?)$/.exec(label); return m ? Number(m[1].replace(/,/g, "")) * TICK_UNIT[m[2]] : NaN; };
// A mark's style property. Each mark read here sets the ones read (a dot's
// and an error bar's stroke, its line's colour; an error bar's opacity), so
// one without is an error (until 2026-11-04 a missing one read as undefined,
// and the mark was reported as on no shown line's month, or at opacity
// undefined).
const styleOf = (style, prop, at) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(style);
  assert.ok(m !== null, `Replicata: render the MPI chart (${at}) and read the ${prop} of its mark styled ${JSON.stringify(style)} (section 6).
Expectata: its style sets ${prop}: the dots and error bars are matched to their lines by their stroke colour, and an error bar's fade is its opacity.
Resultata: no ${prop} in it.`);
  return m[1];
};
const miles = v => Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : String(v);
const fadeOf = w => 0.35 + 0.65 * w;
const metricKeys = JSON.parse(vm.runInContext("JSON.stringify(METRIC_DEFS.map(m => m.key))", ctx6));
const frameProblems = [], fadeProblems = { dot: [], "error bar": [] }, axisProblems = [], qmarkCharts = [];
let markCount = 0;
let newestMonth = null;
for (const key of metricKeys) for (const oneMonth of [false, true]) for (const everyLine of [false, true]) {
  const c = chartCase(key, oneMonth, everyLine);
  newestMonth = c.months.at(-1);
  const where = `MPI chart ${oneMonth ? `in the one-month ${newestMonth} window` : "in the default window"} with ${everyLine ? "every company line" : "the default lines"}`;
  const at = `${c.metric}, ${where.slice("MPI chart ".length)}`;
  if (!(newestMonth <= dataThroughMonth) || !(oneMonth ? c.months.length === 1 : c.months[0] === c.defaultStart && c.months.length >= 2)
    || (everyLine && !c.companyLines.every(line => c.lines.some(l => l.line === line)))) {
    frameProblems.push(`${at}: months ${c.months[0]}..${newestMonth} (the data-through month ${dataThroughMonth}), lines ${c.lines.map(l => l.line).join(", ")}`);
    continue;
  }
  // Each shown line-month with a dot: w and its median.
  const want = new Map();
  for (const l of c.lines) for (const p of l.points) {
    if (!p.dot) continue;
    if (!l.human && p.csv === null) { frameProblems.push(`${at}: ${l.line} ${p.month} has a dot and no data/vmt.js row`); continue; }
    const w = l.human ? 1 : c.fiveDay ? p.csv.coverageMin : p.csv.coverage * p.csv.incCovMin;
    want.set(`${l.line} ${p.month}`, { month: p.month, w, median: p.median });
  }
  const lineOf = new Map(c.lines.map(l => [l.color, l.line]));
  const marks = {
    dot: [...c.html.matchAll(/<g opacity="([^"]*)">\s*<circle class="month-dot" cx="([^"]*)"[^>]*\sstyle="([^"]*)"[^>]*><\/circle>\s*<\/g>/g)]
      .map(m => ({ opacity: m[1], x: Number(m[2]), color: styleOf(m[3], "stroke", at) })),
    "error bar": [...c.html.matchAll(/<line class="month-err" x1="([^"]*)"[^>]*\sstyle="([^"]*)"[^>]*>/g)]
      .map(m => ({ opacity: styleOf(m[2], "opacity", at), x: Number(m[1]), color: styleOf(m[2], "stroke", at) })),
  };
  const drawn = { dot: [...c.html.matchAll(/class="month-dot"/g)].length, "error bar": [...c.html.matchAll(/class="month-err"/g)].length };
  const monthX = [...new Set(marks.dot.map(d => d.x))].sort((a, b) => a - b);
  if (lineOf.size !== c.lines.length || marks.dot.length !== drawn.dot || marks["error bar"].length !== drawn["error bar"]
    || monthX.length !== c.months.length) {
    frameProblems.push(`${at}: ${c.lines.length} lines in ${lineOf.size} colours; ${marks.dot.length} of ${drawn.dot} dots in an opacity group; ${marks["error bar"].length} of ${drawn["error bar"]} error bars read; dots in ${monthX.length} columns for ${c.months.length} months`);
    continue;
  }
  for (const [kind, glyphs] of Object.entries(marks)) {
    const seen = new Map();
    for (const g of glyphs) {
      const i = monthX.findIndex(x => Math.abs(x - g.x) <= 0.006);
      const id = `${lineOf.get(g.color)} ${c.months[i]}`;
      const p = want.get(id);
      if (!lineOf.has(g.color) || i < 0 || p === undefined) {
        fadeProblems[kind].push(`${at}: a ${kind} (${g.color} at x ${g.x}) on no shown line's month with a dot`);
        continue;
      }
      seen.set(id, (seen.get(id) || 0) + 1);
      markCount++;
      if (!(Math.abs(Number(g.opacity) - fadeOf(p.w)) <= 5e-4 + 1e-12))
        fadeProblems[kind].push(`${at}: ${id}'s ${kind} at opacity ${g.opacity}, where 0.35 + 0.65 x ${+p.w.toFixed(4)} = ${fadeOf(p.w).toFixed(3)} is due`);
    }
    for (const id of want.keys()) if (seen.get(id) !== 1) fadeProblems[kind].push(`${at}: ${id} has ${seen.get(id) || 0} ${kind}s, where one is due`);
  }
  // The chart asks linearTicks for its ladder at least once while it renders
  // (a failure below states the ladder for each count asked for, so with none
  // it would state no ladder).
  assert.ok(c.tickCalls.length > 0, `Replicata: render the MPI chart (${at}) with its linearTicks requests recorded (section 6).
Expectata: at least one request, the ladder its y ticks come from.
Resultata: none.`);
  // The rule's maximum, the largest median among the chart's dots (a fully
  // received month's counts as a partly received one's does), and the
  // rendered tick ladder's top. A failure states the ladder linearTicks gives
  // for that median at each count the chart asked for (one, today).
  let top = { v: 0, id: "no line-month", w: null };
  for (const [id, p] of want) if (p.median > top.v) top = { v: p.median, id, w: p.w };
  const ticks = [...c.html.matchAll(/<text class="month-tick" x="[^"]*" y="[^"]*" text-anchor="end">([^<]*)<\/text>/g)]
    .map(m => tickValue(m[1])).sort((a, b) => a - b);
  const step = ticks[1] - ticks[0];
  const ladder = ticks.length >= 2 && ticks[0] === 0 && step > 0 && ticks.every((t, i) => Math.abs(t - i * step) <= 1e-9 * step);
  const due = ladder ? Math.ceil(top.v / step - 1e-9) * step : NaN;
  if (!(ladder && Math.abs(ticks.at(-1) - due) <= 1e-9 * step))
    axisProblems.push(`${at}: y ticks ${ticks.map(miles).join(", ")} (ticks asked for up to ${c.tickCalls.map(t => miles(t.max)).join(", ")}), where the top is due at the first rung at or above the largest median, ${top.id}'s ${miles(top.v)} (w ${top.w === null ? "none" : +top.w.toFixed(4)}), on the ladder linearTicks gives for that median: ${[...new Set(c.tickCalls.map(t => t.count))]
      .map(n => `linearTicks(0, ${miles(top.v)}, ${n}) gives ${Array.from(appLinearTicks(0, top.v, n)).map(miles).join(", ")}`).join("; ")}`);
  // The chart's "?" markers, from the same w: each month's largest 1 - w over
  // the shown lines' dots (a human cohort's is 0).
  qmarkCharts.push({ ...c, where, rule: c.fiveDay ? "1 - coverage_min (the receipt coverage alone)" : "1 - coverage x incident_coverage_min",
    expected: c.months.map(m => Math.max(0, ...[...want.values()].filter(p => p.month === m).map(p => 1 - p.w))) });
}
const caseCount = metricKeys.length * 2 * 2;
assert.deepEqual(frameProblems, [],
  `Replicata: render the MPI chart on each of the ${metricKeys.length} metrics, in the default window (${newestMonth} its newest month) and in the one-month ${newestMonth} window, with the default lines and with every company line shown: ${caseCount} charts.
Expectata: each window ends at the series' newest month, at or before the data-through month ${dataThroughMonth}; each shown line in its own colour; every dot in a group carrying its opacity; every error bar read; one column of dots per month (the human cohort has a dot in every month).
Resultata: ${frameProblems.length} problems: ${frameProblems.slice(0, 8).join("; ")}.`);
for (const [kind, problems] of Object.entries(fadeProblems)) {
  assert.deepEqual(problems, [],
    `Replicata: those ${caseCount} charts' ${kind}s, each matched to its line by colour and to its month by x.
Expectata: one ${kind} per shown line-month with a posterior, each at opacity 0.35 + 0.65 x w to 3 decimals, w the month's whole completeness at worst for the metric's track (coverage x incident_coverage_min on the Monthly track, coverage_min on the five-day track, 1 for a human cohort), so a partially received month's company ${kind}s fade with the month's "?" and every fully received month's are opaque.
Resultata: ${problems.length} problems: ${problems.slice(0, 10).join("; ")}.`);
}
assert.deepEqual(axisProblems, [],
  `Replicata: those ${caseCount} charts' y tick labels.
Expectata: 0 and evenly spaced rungs, the top one the first at or above the largest posterior median among the chart's dots, every month counting only its median whatever its completeness (an error bar running past the top is cut at the plot's edge).
Resultata: ${axisProblems.length} of ${caseCount} charts wrong: ${axisProblems.slice(0, 8).join("; ")}.`);
for (const chart of qmarkCharts) checkQmarks(chart);

console.log(`qual pass: Monthly-report arrival lags measured from data/snapshots (${JSON.stringify(r.lag)}); a lagged month has no source (live lagged months ${JSON.stringify(r.lagged)}; with each helmer's lag raised by one, ${Object.entries(r.raised).map(([h, got]) => `${h} ${got.stop === undefined ? JSON.stringify(got.pending) : "stops"}`).join(", ")}) and every analysis row before ${dataThroughMonth} is complete; slurp stops on ${Object.keys(expectStops).length} inconsistent inputs through main() and ${Object.keys(expectSynthetic).length} on a synthetic lagged helmer; the app takes one partially received month at a window's end and rejects two; on the MPI chart with every company line shown, on All incidents and on ${fiveDayKeys.length} five-day-track metrics, each month has its own "?" (partially received: ${JSON.stringify(monthlyPartial)}); on ${caseCount} MPI charts (every metric, two windows, two line sets) ${markCount} dots and error bars fade by their month's whole completeness, the y axis tops out at the first rung at or above the largest median, and the "?" markers follow the same completeness`);

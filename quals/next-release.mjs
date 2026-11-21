// A Python prelude, to follow SLURP_OFFLINE_PY (quals/slurp-offline.mjs), for
// quals that run data/slurp.py's main() offline on the NHTSA release after
// the newest snapshots': its data-through month N the one after theirs, M.
// Until 2026-11-21 quals/tesla-monitor-review.qual.mjs held this builder;
// quals/pending-months.qual.mjs builds the same release, so both read it
// here. The release is the newest snapshots' rows plus:
//   - the rows of Tesla's list that NHTSA lacks (the preprints), as NHTSA
//     files them (PREPRINTS_FILED);
//   - Waymo and Zoox reports (OTHERS): late five-day and Monthly reports of
//     month M, and five-day reports of the new month N;
//   - Tesla reports the latest list lacks (TESLA, by name), each a copy of a
//     filed Tesla report under a Report ID no file has, filed after the
//     newest snapshots' cutoff:
//       addM     no monitor, in month M after the list's date, filed in M
//                (only while the list ends before M does)
//       addN     no monitor, in N, filed in N
//       late     no monitor, a 5-Day report of the month before the list's,
//                filed in N: a late filing, from before the list's date
//       aboardN  a safety monitor aboard, in N, filed in N
// and the constants a release sets, from each run's rows (release()): the
// receipt cutoff, the arrival row of the month that became measurable, and a
// ghost month.
//
//   M, N, M1            the newest snapshots' data-through month, the one
//                       after it (the release's), the one before it
//   CUT                 the release's receipt cutoff (cutoff(N))
//   THROUGH, L, LM      the date Tesla's latest list runs through, its month,
//                       the month before it
//   label, last_day, shift_day, cutoff, fault_of, filing, day_cells, list_miles
//   LATEST              the newest snapshots' latest filing of each report
//   LISTED, ADD, ABOARD the three Tesla tables as data/slurp.py holds them
//   LIST_CELLS, LISTED_ROWS
//                       the latest list's cells and its rows in NHTSA's columns
//   TESLA, SPEC, ID, ADDS
//                       the Tesla copies by name, each one's source, entry
//                       words and table, its Report ID, and the additions' names
//   entries(names, received=CUT)
//                       the reviewed entries of the copies <names>:
//                       (additions, monitor-aboard)
//   next_release(names, additions, aboard, extra=(), listing=None, listed=LISTED, **more)
//                       run_main() on the release with the Tesla copies
//                       <names>, the entries <additions> and <aboard> beside
//                       slurp's own, Tesla's list's Report IDs <listed>, the
//                       slurp attributes <more> patched too, and, if
//                       <listing> = (date, cells, miles), a list through
//                       <date> holding <cells> with <miles> of its month
//                       through it; run_main()'s result plus 'rows' (every
//                       row of the release) and 'patch'
//   completed(run, what)
//                       the run's counted records by Report ID; stops this
//                       qual if the run stopped
export const NEXT_RELEASE_PY = String.raw`
import re
ADD, ABOARD, LISTED = slurp.TESLA_NO_MONITOR_ADDITIONS, slurp.TESLA_MONITOR_ABOARD_REPORTS, slurp.TESLA_NO_MONITOR_REPORTS
LATEST = slurp.latest_filings(_filed)
M = slurp.NHTSA_DATA_THROUGH_DATE[:7]
N = slurp.month_shift(M, 1)
M1 = slurp.month_shift(M, -1)
def label(month):
    return datetime.date.fromisoformat(month + '-01').strftime('%b-%Y').upper()
def last_day(month):
    return (datetime.date.fromisoformat(slurp.month_shift(month, 1) + '-01') - datetime.timedelta(days=1)).isoformat()
def shift_day(day, n):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=n)).isoformat()
def cutoff(month):
    # NHTSA's receipt cutoff for data through <month>: its 15th, rolled
    # forward past weekends and MLK and Presidents' Day (quals/nhtsa-cutoff-date.qual.mjs)
    first = lambda m: datetime.date(int(month[:4]), m, 1)
    holidays = {first(m) + datetime.timedelta(days=(7 - first(m).weekday()) % 7 + 14) for m in (1, 2)}
    day = datetime.date(int(month[:4]), int(month[5:]), 15)
    while day.weekday() >= 5 or day in holidays:
        day += datetime.timedelta(days=1)
    return day.isoformat()
CUT = cutoff(N)
THROUGH = slurp.PREPRINT_LIST['through']
L = THROUGH[:7]
LIST_PATH = slurp.latest_list_path()
LIST_CELLS = slurp.read_list_cells(LIST_PATH)
LISTED_ROWS = slurp.list_rows(LIST_PATH)
LM = slurp.month_shift(L, -1)   # a month that ended before the list's date
assert L <= M, (f"Replicata: build the release after the newest snapshots (data through {M}): data through {N}, "
                f"cutoff {CUT}, Tesla's list through {THROUGH} (quals/next-release.mjs). Expectata: the list's month at or "
                f"before {M}. Resultata: it is {L} (restate this builder's release for the data: ask the human).")
FAULT_LINES = TEXT['faultfrac.csv'].rstrip('\n').split('\n')
def fault_of(src, rid):
    lines = [l for l in FAULT_LINES if l.startswith(src + ',')]
    assert len(lines) == 1, (f"Replicata: find data/faultfrac.csv's row of {src}, to rate a copy of it. "
                             f"Expectata: one row. Resultata: {len(lines)}.")
    return rid + lines[0][len(src):]
def filing(row, rid, month, rtype, submitted):
    return clone(row, rid, **{'Incident Date': label(month), 'Report Submission Date': label(submitted), 'Report Type': rtype})

# The list's rows NHTSA lacks (the preprints), as NHTSA files them.
PREPRINTS_FILED = [dict(r, **{'Report Type': 'Monthly', 'Report Submission Date': label(L)})
                   for r in LISTED_ROWS if r['Report ID'] not in LATEST]
# Waymo and Zoox: late five-day and Monthly reports of month M, and five-day
# reports of the new month. (Until 2026-11-21 their counts were sized against
# the receipt-share estimate, which is gone: a month counts when its reports
# are complete or a dated list covers it, and how many reports a release
# holds decides nothing.)
W_SOURCE = template(M)
_zoox = [r for r in _filed
         if r['Reporting Entity'] == 'Zoox, Inc.' and r['Driver / Operator Type'].strip() == 'None'
         and slurp.is_public_service_incident(r) and r['City'].strip() and r['State'].strip()
         and r['Highest Injury Severity Alleged'].strip() != 'Unknown'
         and _versions[r['Report ID']] == 1 and _reports[r['Same Incident ID']] == 1
         and r['Report ID'] not in _REVIEWED and not _trips(r)]
assert _zoox, "Replicata: find a Zoox filing to copy as a new report (quals/next-release.mjs). Expectata: one. Resultata: none."
Z_SOURCE = max(_zoox, key=lambda r: r['Report ID'])
OTHERS = ([filing(W_SOURCE, f'synthetic-late-{i}', M, '5-Day', N) for i in range(2)]
          + [filing(W_SOURCE, f'synthetic-monthly-{i}', M, 'Monthly', N) for i in range(2)]
          + [filing(W_SOURCE, f'synthetic-new-{i}', N, '5-Day', N) for i in range(3)]
          + [filing(Z_SOURCE, 'synthetic-zoox-monthly', M, 'Monthly', N), filing(Z_SOURCE, 'synthetic-zoox-new', N, '5-Day', N)])
OTHERS_FAULT = ([fault_of(W_SOURCE['Report ID'], r['Report ID']) for r in OTHERS[:-2]]
                + [fault_of(Z_SOURCE['Report ID'], r['Report ID']) for r in OTHERS[-2:]])
# Tesla: copies of a no-monitor report on the list and of a monitor-aboard one,
# under Report IDs no file has, each filed after the newest snapshots' cutoff.
_tesla = lambda keep: min((r for r in _filed if r['Reporting Entity'] == 'Tesla, Inc.' and keep(r['Report ID'])
                           and slurp.is_public_service_incident(r) and _versions[r['Report ID']] == 1
                           and _reports[r['Same Incident ID']] == 1 and not _trips(r)
                           and r['Highest Injury Severity Alleged'].strip() != 'Unknown'),
                          key=lambda r: r['Report ID'])
NM_SOURCE, AB_SOURCE = _tesla(lambda rid: rid in LISTED), _tesla(lambda rid: rid in ABOARD)
_occupancy = lambda row: re.split(r'(?<=\.)\s+', row['Narrative'].strip())[-1].rstrip('.]')
_SPECS = [  # name, source row, the entry's words, Report ID, crash month, report type, submission month, table
    ('addM', NM_SOURCE, _occupancy(NM_SOURCE), '13781-99901', M, '5-Day', M, 'add'),
    ('addN', NM_SOURCE, _occupancy(NM_SOURCE), '13781-99902', N, '5-Day', N, 'add'),
    ('late', NM_SOURCE, _occupancy(NM_SOURCE), '13781-99904', LM, '5-Day', N, 'add'),
    ('aboardN', AB_SOURCE, ABOARD[AB_SOURCE['Report ID']], '13781-99903', N, 'Monthly', N, 'aboard'),
]
# A copy dated in M after the list's date exists only while the list ends before M does.
_SPECS = [s for s in _SPECS if s[0] != 'addM' or THROUGH < last_day(M)]
TESLA = {name: filing(src, rid, month, rtype, sub) for name, src, _w, rid, month, rtype, sub, _t in _SPECS}
SPEC = {name: {'source': src['Report ID'], 'words': words, 'table': table} for name, src, words, *_rest, table in _SPECS}
ID = {name: row['Report ID'] for name, row in TESLA.items()}
ADDS = [name for name in TESLA if SPEC[name]['table'] == 'add']
def entries(names, received=CUT):
    """The reviewed entries of the Tesla copies <names>: (additions, monitor-aboard)."""
    return ({ID[n]: (SPEC[n]['words'], received) for n in names if SPEC[n]['table'] == 'add'},
            {ID[n]: SPEC[n]['words'] for n in names if SPEC[n]['table'] == 'aboard'})

# The constants a release sets, from its rows.
_master = slurp.read_vmt_master()
_body = list(csv.reader(io.StringIO(_master)))
AFTER_N = slurp.month_shift(N, 1)
_ghost_rows = [] if any(r and r[1] == AFTER_N for r in _body) else [[r[0], AFTER_N, *r[2:]] for r in _body[1:] if r and r[1] == N]
_buf = io.StringIO(); csv.writer(_buf, lineterminator='\n').writerows(_ghost_rows)
MASTER_NEXT = _master.rstrip('\n') + '\n' + _buf.getvalue()
VMT_NEXT = slurp.parse_vmt_values(MASTER_NEXT)
def list_miles(day):
    """Tesla's no-monitor miles of <day>'s month through <day>, at the month's
    data/vmt.csv rate."""
    month = day[:7]
    return round(VMT_NEXT[('TeslaNoMonitor', month)] * int(day[8:]) / int(last_day(month)[8:]))
_real_ghost = slurp.ghost_vmt_csv
_counts_now = slurp.monthly_track_counts(ROWS)
def release(rows):
    # The arrival row of M1, measurable at its third release: its Monthly-track
    # reports by its second (the newest snapshots) and those that arrive now.
    counts = slurp.monthly_track_counts(rows)
    arrivals = {h: {**t, M1: (_counts_now[(h, M1, 'monthly')], counts[(h, M1, 'monthly')] - _counts_now[(h, M1, 'monthly')])}
                for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()}
    return dict(NHTSA_DATA_THROUGH_DATE=CUT,
                MONTHLY_ARRIVAL_OBSERVATIONS=arrivals,
                read_vmt_master=lambda: MASTER_NEXT,
                ghost_vmt_csv=lambda raw, last, run, analysis: _real_ghost(raw, last, max(run, AFTER_N), analysis))
def day_cells(rid, day):
    serial = (datetime.date.fromisoformat(day) - datetime.date(1899, 12, 30)).days
    return dict(LIST_CELLS[-1], report_id=rid, incident_date_local=str(serial))
_first_filing = {r['Report ID']: r['Report Submission Date'].strip() for r in _filed if int(r['Report Version']) == 1}
def next_release(names, additions, aboard, extra=(), listing=None, listed=LISTED, **more):
    """main() offline on the next release with the Tesla copies <names>, the
    reviewed entries <additions> and <aboard> beside slurp's own, Tesla's list's
    Report IDs <listed>, the slurp attributes <more> patched too, and, if
    <listing> = (date, cells, miles), a list through <date> holding <cells>,
    with <miles> of its month through it, and, as a list through that date
    would, the newest snapshots' own reviewed additions Tesla had filed by
    then (moved into its Report IDs; there are none while Tesla's latest list
    is newer than NHTSA's file)."""
    tesla_rows = [TESLA[n] for n in names]
    rows = list(ROWS) + PREPRINTS_FILED + OTHERS + tesla_rows + list(extra)
    adds, aboards = {**ADD, **additions}, {**ABOARD, **aboard}
    patch = dict(release(rows), TESLA_MONITOR_ABOARD_REPORTS=aboards,
                 PASSENGER_OVERRIDE=dict(slurp.PASSENGER_OVERRIDE, **{r['Report ID']: slurp.PASSENGER_OVERRIDE[SPEC[n]['source']]
                                                                       for n, r in zip(names, tesla_rows)}))
    if listing is not None:
        date, list_cells, miles = listing
        moving = sorted(rid for rid, (_words, received) in ADD.items()
                        if min(received, last_day(slurp.nhtsa_month_to_iso(_first_filing[rid]))) <= date)
        list_cells = list_cells + [day_cells(rid, slurp.nhtsa_month_to_iso(LATEST[rid]['Incident Date']) + '-01') for rid in moving]
        adds = {rid: entry for rid, entry in adds.items() if rid not in moving}
        listed = listed | set(moving)
        patch.update(PREPRINT_LIST=dict(slurp.PREPRINT_LIST, through=date, miles=miles),
                     latest_list_path=lambda: slurp.SNAPSHOT_DIR / ('tesla-list-' + date.replace('-', '') + '.xlsx'),
                     read_list_cells=lambda p: list_cells)
    patch.update(TESLA_NO_MONITOR_ADDITIONS=adds, TESLA_NO_MONITOR_REPORTS=listed, **more)
    faults = '\n'.join(FAULT_LINES + OTHERS_FAULT + [fault_of(SPEC[n]['source'], ID[n]) for n in names]) + '\n'
    result = run_main(extra=PREPRINTS_FILED + OTHERS + tesla_rows + list(extra), fault_text=faults, **patch)
    return dict(result, rows=rows, patch=patch)
def completed(run, what):
    assert run['stop'] == '', (f"Replicata: {what}. Expectata: the run completes. "
                               f"Resultata: it stops: {run['stop'][:900]}")
    return {r['reportId']: r for r in run['incidents']}
`;

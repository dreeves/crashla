// Tesla reports newer than Tesla's latest list (audit finding A1; the human,
// 2026-11-20: "ok", to: "At each release, every Tesla report newer than
// Tesla's latest list gets a reviewed entry (no-monitor or monitor-aboard),
// quoting the narrative's words, like the passenger table. The run stops if
// Tesla's next list disagrees with any entry.").
//
// NHTSA's release after one of Tesla's lists holds Tesla's reports of the days
// after the list's date, and of crashes Tesla filed after drawing it up, which
// no list holds yet. Until 2026-11-20 data/slurp.py required every in-scope
// Tesla report of the no-monitor line's months to be on the list
// (TESLA_NO_MONITOR_REPORTS, which list_rows() requires to be the list's
// Report IDs) or monitor-aboard (TESLA_MONITOR_ABOARD_REPORTS), so the ~Dec 15,
// 2026 release, with Tesla's reports of Oct 19-Nov 15, would have stopped with
// no valid classification.
//
// A list holds the no-monitor crashes Tesla had reported by its date (each row
// carries its filing's Report ID), so a crash Tesla files after that date is
// on no list of that date, whatever the crash's own date: Tesla files some
// late (13781-17193, an Aug 22 crash, in October). So a list should hold an
// addition Tesla had filed by the list's date. NHTSA's file dates a filing by
// month only, so what slurp knows is that Tesla had filed it by the receipt
// cutoff of the release whose review added it (stored with the entry) and by
// the end of the month of its first filing.
//
// Spec.
// (1) Two reviewed tables keyed by Report ID: TESLA_NO_MONITOR_ADDITIONS (no
//     safety monitor aboard, on no list yet; each entry the narrative's words
//     the review read, verbatim, and that review's receipt cutoff) and
//     TESLA_MONITOR_ABOARD_REPORTS (a monitor aboard; each entry the words).
//     reviewed_quotes() holds both tables' words, so check_reviewed_quotes()
//     re-checks them. The no-monitor line's members (DERIVED_SERIES_REPORTS)
//     are the list's Report IDs and the additions, and no report is in two of
//     TESLA_NO_MONITOR_REPORTS, TESLA_NO_MONITOR_ADDITIONS and
//     TESLA_MONITOR_ABOARD_REPORTS.
// (2) The narrative test the review rests on, held to its record: on every
//     in-scope Tesla report of the line's months in data/incidents.js, the
//     narrative names a safety monitor exactly when the report is
//     monitor-aboard, and every monitor-aboard entry's words name one (on
//     2026-11-20: 37 reports, 8 of them aboard; of the 30 since May 2026, the
//     one naming a monitor, 13781-16672, is the one Tesla's list leaves out).
//     A report that breaks it turns this qual red, for a human to read. The
//     committed data passes check_monitor_reviewed().
// (3) The next NHTSA release, built from the newest snapshots (its
//     data-through month N the one after theirs, M): Tesla's reports the
//     latest list lacks, all filed after the newest snapshots' cutoff (a
//     no-monitor one in month M after the list's date and filed in M, while
//     the list ends before M does; a no-monitor one in N; a no-monitor
//     5-Day report of the month before the list's, filed in N: a late
//     filing, from before the list's date; a monitor-aboard one in N), the
//     list's rows NHTSA lacks as NHTSA rows, and Waymo and Zoox reports; the
//     constants a release sets (the receipt cutoff, the receipt observation
//     of the month that became final, the arrival row of the month that
//     became measurable, a ghost month) set from each run's rows.
//     (a) With no reviewed entry for those Tesla reports, the run stops,
//         naming every one of them, the two tables and the release checklist's
//         step 7, and writes nothing; with an entry for all but one, it stops
//         naming that one and no other, for each of them.
//     (b) With the entries (each addition's cutoff the release's), it
//         completes: each addition counts on the no-monitor line, the late
//         filing among them, which Tesla filed after drawing up the list, the
//         monitor-aboard report on Tesla's line only; the line's crashes in
//         the month the list runs through are that month's in-scope list
//         crashes and additions; that month's rows take NHTSA's coverage and
//         cutoff, as a month NHTSA's file holds whole does, and the new
//         month's rows NHTSA's coverage of it, the same on both of Tesla's
//         lines.
//     (c) A later list that should hold an addition and lacks it stops the
//         run, naming each such addition and no other report: through the
//         additions' cutoff, every addition; through the end of month M, the
//         one filed in M (the others were filed in N); and at the release
//         after, with the additions reviewed at this one, through the day
//         after their cutoff, each of them, the one of month N included,
//         though the list ends before N does and before that release's cutoff
//         (check_monitor_reviewed() called on this run's records and rows).
//     (d) A list that holds an addition (the late one, on a list of the
//         latest list's date as Tesla would re-publish it after that filing)
//         stops the run ("move it"); once the entry moves into the list's
//         Report IDs, the run completes with the report still on the line.
//     (e) A re-filing whose narrative no longer holds an entry's words stops
//         the run, naming the table and the report, for both tables.
//     (f) A re-filing that keeps an addition's words and names a safety
//         monitor, and a no-monitor report reviewed as monitor-aboard, each
//         stop the run on the narrative test, naming the report.
//     (g) An entry naming a report that is not an in-scope Tesla report of the
//         line's months stops the run.
//     (h) An addition's cutoff after the release's own, or before the month of
//         its report's first filing, stops the run, naming the report; so does
//         an addition whose report has no first filing (Report Version 1)
//         among the rows (check_monitor_reviewed() called on (b)'s records).
//     (i) A row that takes the list's coverage (row_coverage(): a list dated
//         in the new month with that month's miles through its date, which
//         then holds more of the month than NHTSA's file) and counts a crash
//         the list lacks (an addition, and a monitor-aboard report on Tesla's
//         every-mode line) stops the run, naming both; with the list dated on
//         the month's first day, the rows take NHTSA's coverage and the run
//         completes with both counted.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const API = ["TESLA_NO_MONITOR_ADDITIONS", "TESLA_MONITOR_ABOARD_REPORTS", "SAFETY_MONITOR_PATTERN",
  "check_monitor_reviewed", "check_list_covered_rows", "row_coverage"];

const py = SLURP_OFFLINE_PY + String.raw`
import re
out = {'defined': {name: hasattr(slurp, name) for name in ${JSON.stringify(API)}}}
if not all(out['defined'].values()):
    print(json.dumps(out)); raise SystemExit(0)
ADD, ABOARD, LISTED = slurp.TESLA_NO_MONITOR_ADDITIONS, slurp.TESLA_MONITOR_ABOARD_REPORTS, slurp.TESLA_NO_MONITOR_REPORTS
DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
def with_patch(fn, **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try: return fn()
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
def stop(fn, **patch):
    def attempt():
        try: fn(); return ''
        except AssertionError as e: return str(e)
    return with_patch(attempt, **patch)

# (1) The tables.
quotes = slurp.reviewed_quotes()
words_of = {'TESLA_NO_MONITOR_ADDITIONS': {rid: entry[0] for rid, entry in ADD.items()},
            'TESLA_MONITOR_ABOARD_REPORTS': ABOARD}
out['tables'] = {
    'TESLA_NO_MONITOR_ADDITIONS': all(isinstance(e, tuple) and len(e) == 2 and isinstance(e[0], str) and e[0] != ''
                                      and isinstance(e[1], str) and DATE.fullmatch(e[1]) is not None for e in ADD.values()),
    'TESLA_MONITOR_ABOARD_REPORTS': all(isinstance(w, str) and w != '' for w in ABOARD.values())}
out['quoted'] = sorted(name for name, words in words_of.items() if name not in quotes or quotes[name] != words)
members = lambda: sorted(slurp.DERIVED_SERIES_REPORTS['TeslaNoMonitor'][1]())
out['line'] = {'members': members(), 'want': sorted(LISTED | set(ADD)),
               'patched': with_patch(lambda: '13781-99900' in members(),
                                     TESLA_NO_MONITOR_ADDITIONS={**ADD, '13781-99900': ('reviewed words', slurp.NHTSA_DATA_THROUGH_DATE)})}
out['overlap'] = sorted((LISTED & set(ADD)) | (LISTED & set(ABOARD)) | (set(ADD) & set(ABOARD)))

# (2) The narrative test on the committed data.
MONITOR = re.compile(r'\bsafety\s+monitor\b', re.I)
records = json.loads(_segment(TEXT['incidents.js'], '/* INCIDENT_DATA_START */', '/* INCIDENT_DATA_END */'))
since = [r for r in records if r['helmer'] == 'Tesla' and slurp.nhtsa_month_to_iso(r['date']) >= slurp.TESLA_NO_MONITOR_FROM]
out['narrativeTest'] = {'checked': len(since), 'aboard': sum(r['reportId'] in ABOARD for r in since),
                        'disagree': sorted(r['reportId'] for r in since
                                           if (MONITOR.search(r['narrative']) is not None) != (r['reportId'] in ABOARD))}
out['aboardWords'] = sorted(rid for rid, words in ABOARD.items() if MONITOR.search(words) is None)
out['committed'] = stop(lambda: slurp.check_monitor_reviewed(records, slurp.filed_incident_rows(list(ROWS) + slurp.preprint_rows(ROWS))))

# (3) The next release.
filed = slurp.filed_incident_rows(ROWS)
latest = slurp.latest_filings(filed)
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
path = slurp.latest_list_path()
cells = slurp.read_list_cells(path)
listed_rows = slurp.list_rows(path)
LM = slurp.month_shift(L, -1)   # a month that ended before the list's date
problems = []
problems += [] if L <= M else [f'the list runs through {THROUGH}, after the newest data-through month {M}']
out['setup'] = {'M': M, 'N': N, 'cut': CUT, 'through': THROUGH, 'L': L, 'problems': problems}
fault_lines = TEXT['faultfrac.csv'].rstrip('\n').split('\n')
def fault_of(src, rid):
    lines = [l for l in fault_lines if l.startswith(src + ',')]
    assert len(lines) == 1, (f"Replicata: find data/faultfrac.csv's row of {src}, to rate a copy of it. "
                             f"Expectata: one row. Resultata: {len(lines)}.")
    return rid + lines[0][len(src):]
def filing(row, rid, month, rtype, submitted):
    return clone(row, rid, **{'Incident Date': label(month), 'Report Submission Date': label(submitted), 'Report Type': rtype})

# The list's rows NHTSA lacks (the preprints), as NHTSA files them.
preprints = [dict(r, **{'Report Type': 'Monthly', 'Report Submission Date': label(L)})
             for r in listed_rows if r['Report ID'] not in latest]
# Waymo and Zoox: the late five-day reports of month M (its first release held
# a third), two of its Monthly reports, and five-day reports of the new month:
# about 15% of the newest final month's eventual five-day count (on 2026-11-20
# that month, September 2026, held 7 of an eventual 61 in its first release),
# so that NHTSA's file holds more of the new month than a list through its
# first day would and less than a list through the day before the cutoff, in
# (i).
def five_day(rows, month):
    return sum(n for (_h, m, track), n in slurp.monthly_track_counts(rows).items() if m == month and track == 'five_day')
first_five_day = five_day(ROWS, M)
final_month = max(slurp.FIVE_DAY_RECEIPT_OBSERVATIONS)
new_five_day = round(0.15 * slurp.FIVE_DAY_RECEIPT_OBSERVATIONS[final_month][1])
problems += [] if new_five_day >= 1 else [f'{final_month} has too few five-day reports to copy into the new month']
assert not problems, (f"Replicata: build the release after the newest snapshots (data through {M}): data through {N}, "
                      f"cutoff {CUT}, Tesla's list through {THROUGH}. Expectata: the list's month at or before {M}; a final "
                      f"month with five-day reports to copy. Resultata: {problems} (restate this qual's release for the "
                      f"data: ask the human).")
w = template(M)
zoox = [r for r in _filed
        if r['Reporting Entity'] == 'Zoox, Inc.' and r['Driver / Operator Type'].strip() == 'None'
        and slurp.is_public_service_incident(r) and r['City'].strip() and r['State'].strip()
        and r['Highest Injury Severity Alleged'].strip() != 'Unknown'
        and _versions[r['Report ID']] == 1 and _reports[r['Same Incident ID']] == 1
        and r['Report ID'] not in _REVIEWED and not _trips(r)]
assert zoox, "Replicata: find a Zoox filing to copy as a new report. Expectata: one. Resultata: none."
z = max(zoox, key=lambda r: r['Report ID'])
others = ([filing(w, f'synthetic-late-{i}', M, '5-Day', N) for i in range(2 * first_five_day)]
          + [filing(w, f'synthetic-monthly-{i}', M, 'Monthly', N) for i in range(2)]
          + [filing(w, f'synthetic-new-{i}', N, '5-Day', N) for i in range(new_five_day)]
          + [filing(z, 'synthetic-zoox-monthly', M, 'Monthly', N), filing(z, 'synthetic-zoox-new', N, '5-Day', N)])
others_fault = [fault_of(w['Report ID'], r['Report ID']) for r in others[:-2]] + [fault_of(z['Report ID'], r['Report ID']) for r in others[-2:]]
# Tesla: copies of a no-monitor report on the list and of a monitor-aboard one,
# under Report IDs no file has, each filed after the newest snapshots' cutoff.
tesla = lambda keep: min((r for r in _filed if r['Reporting Entity'] == 'Tesla, Inc.' and keep(r['Report ID'])
                          and slurp.is_public_service_incident(r) and _versions[r['Report ID']] == 1
                          and _reports[r['Same Incident ID']] == 1 and not _trips(r)
                          and r['Highest Injury Severity Alleged'].strip() != 'Unknown'),
                         key=lambda r: r['Report ID'])
nm, ab = tesla(lambda rid: rid in LISTED), tesla(lambda rid: rid in ABOARD)
occupancy = lambda row: re.split(r'(?<=\.)\s+', row['Narrative'].strip())[-1].rstrip('.]')
SPECS = [  # name, source row, the entry's words, Report ID, crash month, report type, submission month, table
    ('addM', nm, occupancy(nm), '13781-99901', M, '5-Day', M, 'add'),
    ('addN', nm, occupancy(nm), '13781-99902', N, '5-Day', N, 'add'),
    ('late', nm, occupancy(nm), '13781-99904', LM, '5-Day', N, 'add'),
    ('aboardN', ab, ABOARD[ab['Report ID']], '13781-99903', N, 'Monthly', N, 'aboard'),
]
# A copy dated in M after the list's date exists only while the list ends before M does.
SPECS = [s for s in SPECS if s[0] != 'addM' or THROUGH < last_day(M)]
TESLA = {name: filing(src, rid, month, rtype, sub) for name, src, _w, rid, month, rtype, sub, _t in SPECS}
SPEC = {name: {'source': src['Report ID'], 'words': words, 'table': table} for name, src, words, *_rest, table in SPECS}
ID = {name: row['Report ID'] for name, row in TESLA.items()}
ADDS = [name for name in TESLA if SPEC[name]['table'] == 'add']
out['setup'].update(ids=ID, additions=[ID[n] for n in ADDS],
                    copiedFrom={'noMonitor': nm['Report ID'], 'aboard': ab['Report ID'], 'waymo': w['Report ID'], 'zoox': z['Report ID']},
                    preprints=[r['Report ID'] for r in preprints],
                    wordsInNarrative=all(SPEC[n]['words'] in TESLA[n]['Narrative'] for n in TESLA))
def entries(names, received=CUT):
    """The reviewed entries of the Tesla copies <names>: (additions, monitor-aboard)."""
    return ({ID[n]: (SPEC[n]['words'], received) for n in names if SPEC[n]['table'] == 'add'},
            {ID[n]: SPEC[n]['words'] for n in names if SPEC[n]['table'] == 'aboard'})

# The constants a release sets, from its rows.
master = slurp.read_vmt_master()
body = list(csv.reader(io.StringIO(master)))
after_n = slurp.month_shift(N, 1)
ghost_rows = [] if any(r and r[1] == after_n for r in body) else [[r[0], after_n, *r[2:]] for r in body[1:] if r and r[1] == N]
buf = io.StringIO(); csv.writer(buf, lineterminator='\n').writerows(ghost_rows)
master_next = master.rstrip('\n') + '\n' + buf.getvalue()
vmt_next = slurp.parse_vmt_values(master_next)
def list_miles(day):
    """Tesla's no-monitor miles of <day>'s month through <day>, at the month's
    data/vmt.csv rate."""
    month = day[:7]
    return round(vmt_next[('TeslaNoMonitor', month)] * int(day[8:]) / int(last_day(month)[8:]))
real_ghost, real_build = slurp.ghost_vmt_csv, slurp.build_vmt_csv
built = {}
def spy_build(*args):
    built['vmt'] = real_build(*args)
    return built['vmt']
counts_now = slurp.monthly_track_counts(ROWS)
def release(rows):
    # The arrival row of M1, measurable at its third release: its Monthly-track
    # reports by its second (the newest snapshots) and those that arrive now.
    counts = slurp.monthly_track_counts(rows)
    arrivals = {h: {**t, M1: (counts_now[(h, M1, 'monthly')], counts[(h, M1, 'monthly')] - counts_now[(h, M1, 'monthly')])}
                for h, t in slurp.MONTHLY_ARRIVAL_OBSERVATIONS.items()}
    return dict(NHTSA_DATA_THROUGH_DATE=CUT,
                FIVE_DAY_RECEIPT_OBSERVATIONS=dict(slurp.FIVE_DAY_RECEIPT_OBSERVATIONS, **{M: (first_five_day, five_day(rows, M))}),
                MONTHLY_ARRIVAL_OBSERVATIONS=arrivals,
                read_vmt_master=lambda: master_next,
                ghost_vmt_csv=lambda raw, last, run: real_ghost(raw, last, max(run, after_n)),
                build_vmt_csv=spy_build)
def day_cells(rid, day):
    serial = (datetime.date.fromisoformat(day) - datetime.date(1899, 12, 30)).days
    return dict(cells[-1], report_id=rid, incident_date_local=str(serial))
first_filing = {r['Report ID']: r['Report Submission Date'].strip() for r in filed if int(r['Report Version']) == 1}
def next_release(names, additions, aboard, extra=(), listing=None, listed=LISTED):
    """main() offline on the next release with the Tesla copies <names>, the
    reviewed entries <additions> and <aboard> beside slurp's own, Tesla's list's
    Report IDs <listed>, and, if <listing> = (date, cells, miles), a list
    through <date> holding <cells>, with <miles> of its month through it, and,
    as a list through that date would, the newest snapshots' own reviewed
    additions Tesla had filed by then (moved into its Report IDs; there are
    none while Tesla's latest list is newer than NHTSA's file)."""
    tesla_rows = [TESLA[n] for n in names]
    rows = list(ROWS) + preprints + others + tesla_rows + list(extra)
    adds, aboards = {**ADD, **additions}, {**ABOARD, **aboard}
    patch = dict(release(rows), TESLA_MONITOR_ABOARD_REPORTS=aboards,
                 PASSENGER_OVERRIDE=dict(slurp.PASSENGER_OVERRIDE, **{r['Report ID']: slurp.PASSENGER_OVERRIDE[SPEC[n]['source']]
                                                                       for n, r in zip(names, tesla_rows)}))
    if listing is not None:
        date, list_cells, miles = listing
        moving = sorted(rid for rid, (_words, received) in ADD.items()
                        if min(received, last_day(slurp.nhtsa_month_to_iso(first_filing[rid]))) <= date)
        list_cells = list_cells + [day_cells(rid, slurp.nhtsa_month_to_iso(latest[rid]['Incident Date']) + '-01') for rid in moving]
        adds = {rid: entry for rid, entry in adds.items() if rid not in moving}
        listed = listed | set(moving)
        patch.update(PREPRINT_LIST=dict(slurp.PREPRINT_LIST, through=date, miles=miles),
                     latest_list_path=lambda: slurp.SNAPSHOT_DIR / ('tesla-list-' + date.replace('-', '') + '.xlsx'),
                     read_list_cells=lambda p: list_cells)
    patch.update(TESLA_NO_MONITOR_ADDITIONS=adds, TESLA_NO_MONITOR_REPORTS=listed)
    faults = '\n'.join(fault_lines + others_fault + [fault_of(SPEC[n]['source'], ID[n]) for n in names]) + '\n'
    built.clear()
    result = run_main(extra=preprints + others + tesla_rows + list(extra), fault_text=faults, **patch)
    return dict(result, vmt=built.get('vmt'), rows=rows, patch=patch)
def completed(run, what):
    assert run['stop'] == '', (f"Replicata: {what}. Expectata: the run completes. "
                               f"Resultata: it stops: {run['stop'][:900]}")
    return {r['reportId']: r for r in run['incidents']}
brief = lambda run: {'stop': run['stop'][:1500], 'changed': run['changed']}
ALL = list(TESLA)
runs = {}
# (a) no reviewed entries; then, for each copy, entries for the others only
runs['none'] = brief(next_release(ALL, {}, {}))
runs['each'] = {n: brief(next_release(ALL, *entries([m for m in ALL if m != n]))) for n in ALL}
# (b) the entries
adds, aboards = entries(ALL)
full = next_release(ALL, adds, aboards)
recs = completed(full, 'the next release with a reviewed entry for each Tesla copy')
runs['entries'] = brief(full)
runs['entries']['series'] = {ID[n]: recs[ID[n]]['series'] for n in ALL}
runs['entries']['offLine'] = sorted(rid for rid, r in recs.items() if 'TeslaNoMonitor' in r['series'] and rid not in LISTED | set(adds))
runs['entries']['flagged'] = sorted(rid for rid, r in recs.items() if 'preprint' in r)
runs['entries']['listMonthLine'] = sorted(rid for rid, r in recs.items()
                                          if 'TeslaNoMonitor' in r['series'] and slurp.nhtsa_month_to_iso(r['date']) == L)
runs['entries']['listMonthWant'] = sorted({r['Report ID'] for r in listed_rows
                                           if slurp.nhtsa_month_to_iso(r['Incident Date']) == L and r['Report ID'] not in slurp.TELEOP_DRIVEN_REPORTS}
                                          | {rid for rid in adds if slurp.nhtsa_month_to_iso(recs[rid]['date']) == L})
cols = ['coverage', 'coverage_min', 'coverage_max', 'incident_coverage', 'incident_coverage_min', 'incident_coverage_max', 'incidents_through']
rows_of = lambda run, months: {r['helmer'] + '|' + r['month']: [r[c] for c in cols] for r in csv.DictReader(io.StringIO(run['vmt']))
                               if r['helmer'] in ('tesla', 'teslanomonitor') and r['month'] in months}
runs['entries']['rows'] = rows_of(full, (L, N))
# (c) later lists lacking the additions: through their cutoff; through the end
# of month M; and, at the release after, through the day after their cutoff
runs['laterCut'] = brief(next_release(ALL, adds, aboards, listing=(CUT, cells, list_miles(CUT))))
runs['laterMonthEnd'] = brief(next_release(ALL, adds, aboards, listing=(last_day(M), cells, list_miles(last_day(M))))) if 'addM' in TESLA else None
after_cut = shift_day(CUT, 1)
runs['releaseAfter'] = {'stop': stop(lambda: slurp.check_monitor_reviewed(full['incidents'], slurp.filed_incident_rows(full['rows'])),
                                     **dict(full['patch'], NHTSA_DATA_THROUGH_DATE=cutoff(slurp.month_shift(N, 1)),
                                            PREPRINT_LIST=dict(slurp.PREPRINT_LIST, through=after_cut))),
                        'through': after_cut, 'cut': cutoff(slurp.month_shift(N, 1))}
# (d) a list holding the late addition (the list through its date, as Tesla
# re-published it after that filing), then the entry moved into its Report IDs
moved = ID['late']
holding = (THROUGH, cells + [day_cells(moved, LM + '-01')], slurp.PREPRINT_LIST['miles'])
runs['newer'] = brief(next_release(ALL, adds, aboards, listing=holding))
after = next_release(ALL, {k: v for k, v in adds.items() if k != moved}, aboards, listing=holding, listed=LISTED | {moved})
runs['moved'] = brief(after)
runs['moved']['series'] = completed(after, 'the next release with the late addition moved into the list')[moved]['series']
# (e) re-filings without the entries' words
refile = lambda n, narrative: dict(TESLA[n], **{'Report Version': '2', 'Report Type': 'Update', 'Narrative': narrative})
refiled = [refile(n, TESLA[n]['Narrative'].replace(SPEC[n]['words'], 'Narrative revised')) for n in ('addN', 'aboardN')]
runs['refiled'] = brief(next_release(ALL, adds, aboards, extra=refiled))
runs['refiled']['ids'] = [r['Report ID'] for r in refiled]
# (f) the narrative test: a re-filing of the November addition that keeps its
# words and names a safety monitor, and the late filing reviewed as monitor-aboard
named = refile('addN', TESLA['addN']['Narrative'] + ' Tesla is filing an updated report to note that a safety monitor was present in the vehicle.')
misread_adds = {k: v for k, v in adds.items() if k != ID['late']}
runs['misread'] = brief(next_release(ALL, misread_adds, dict(aboards, **{ID['late']: SPEC['late']['words']}), extra=[named]))
runs['misread']['ids'] = [ID['addN'], ID['late']]
# (g) an entry naming an in-scope Tesla report from before the line's months
old = min(rid for rid, r in latest.items() if r['Reporting Entity'] == 'Tesla, Inc.' and slurp.is_public_service_incident(r)
          and slurp.nhtsa_month_to_iso(r['Incident Date']) < slurp.TESLA_NO_MONITOR_FROM)
runs['stale'] = brief(next_release(ALL, adds, dict(aboards, **{old: latest[old]['Narrative'].strip()})))
runs['stale']['id'] = old
# (h) misdated entries: the November addition's cutoff the newest snapshots'
# (before November, its first filing's month), the late one's the release after's
misdated = dict(adds, **{ID['addN']: (SPEC['addN']['words'], slurp.NHTSA_DATA_THROUGH_DATE),
                         ID['late']: (SPEC['late']['words'], cutoff(slurp.month_shift(N, 1)))})
runs['misdated'] = brief(next_release(ALL, misdated, aboards))
runs['misdated']['ids'] = [ID['addN'], ID['late']]
# and the November addition with its first filing gone from the rows (the
# check called on the entries run's records)
no_first = [r for r in slurp.filed_incident_rows(full['rows']) if not (r['Report ID'] == ID['addN'] and r['Report Version'] == '1')]
runs['unfiled'] = {'stop': stop(lambda: slurp.check_monitor_reviewed(full['incidents'], no_first), **full['patch'])}
# (i) a list dated in the new month: the day before NHTSA's cutoff (its rows
# take the list's coverage), and the month's first day (they take NHTSA's)
same = ['addN', 'aboardN']
before_cut = shift_day(CUT, -1)
runs['listCovered'] = brief(next_release(same, *entries(same), listing=(before_cut, cells, list_miles(before_cut))))
runs['listCovered']['through'] = before_cut
early = next_release(same, *entries(same), listing=(N + '-01', cells, list_miles(N + '-01')))
early_recs = completed(early, f'the next release with a list through {N}-01')
runs['listEarly'] = brief(early)
runs['listEarly']['series'] = {ID[n]: early_recs[ID[n]]['series'] for n in same}
runs['listEarly']['rows'] = rows_of(early, (N,))
out['runs'] = runs
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots and on a synthetic next release.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-2500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

const undefinedNames = Object.entries(S.defined).filter(([, ok]) => !ok).map(([name]) => name);
assert.deepEqual(undefinedNames, [],
  `Replicata: look in data/slurp.py for the tables, the narrative test and the checks that classify Tesla's reports newer than its latest list (${API.join(", ")}).
Expectata: it defines each.
Resultata: it does not define ${JSON.stringify(undefinedNames)}.`);

// (1) The tables.
assert.ok(Object.values(S.tables).every(Boolean) && S.quoted.length === 0,
  `Replicata: read slurp.TESLA_NO_MONITOR_ADDITIONS, slurp.TESLA_MONITOR_ABOARD_REPORTS and slurp.reviewed_quotes().
Expectata: each addition is (the narrative's words, a non-empty string; a YYYY-MM-DD receipt cutoff), each monitor-aboard entry the words, and reviewed_quotes() holds both tables' words, so check_reviewed_quotes() re-checks every entry against the report's latest filing.
Resultata: tables ${JSON.stringify(S.tables)}; reviewed_quotes() lacking or differing on ${JSON.stringify(S.quoted)}.`);
assert.ok(JSON.stringify(S.line.members) === JSON.stringify(S.line.want) && S.line.patched && S.overlap.length === 0,
  `Replicata: read the no-monitor line's members (slurp.DERIVED_SERIES_REPORTS) and the three Tesla tables.
Expectata: the members are Tesla's list's Report IDs (TESLA_NO_MONITOR_REPORTS) and the additions, read from the tables (an addition set in TESLA_NO_MONITOR_ADDITIONS is a member); no report in two of the three tables.
Resultata: members ${S.line.members.length}, want ${S.line.want.length}; a patched-in addition a member: ${S.line.patched}; in two tables: ${JSON.stringify(S.overlap)}.`);

// (2) The narrative test.
assert.ok(S.narrativeTest.checked > 0 && S.narrativeTest.aboard > 0 && S.narrativeTest.disagree.length === 0 && S.aboardWords.length === 0,
  `Replicata: for each in-scope Tesla report in data/incidents.js from TESLA_NO_MONITOR_FROM on, ask whether its narrative names a safety monitor, and whether it is in TESLA_MONITOR_ABOARD_REPORTS; and read each monitor-aboard entry's words.
Expectata: the two answers agree on every report (the narrative test that classifies a report newer than Tesla's list), and every monitor-aboard entry's words name the monitor.
Resultata: ${S.narrativeTest.checked} reports checked, ${S.narrativeTest.aboard} aboard; disagreeing ${JSON.stringify(S.narrativeTest.disagree)}; aboard entries whose words name no monitor ${JSON.stringify(S.aboardWords)}.`);
assert.equal(S.committed, "",
  `Replicata: call slurp.check_monitor_reviewed() on data/incidents.js's records and the newest snapshots' rows.
Expectata: it passes (every in-scope Tesla report of the line's months is classified, every entry names one, and the reviewed ones pass the narrative test).
Resultata: it stops: ${S.committed.slice(0, 600)}`);

// (3) The next release.
const { setup, runs } = S;
const ID = setup.ids, additions = setup.additions, tesla = Object.values(ID);
assert.ok(setup.problems.length === 0 && setup.wordsInNarrative && additions.includes(ID.addN) && additions.includes(ID.late),
  `Replicata: build the release after the newest snapshots (data through ${setup.M}): data through ${setup.N}, cutoff ${setup.cut}, Tesla's list through ${setup.through}.
Expectata: the list's month at or before ${setup.M}; the month before ${setup.M} ended by the list's date; each helmer's arrival row for that month entered with its on-time count only (the next release adds the late column); Tesla copies whose entries' words are in their narratives; the November and the late no-monitor additions.
Resultata: ${JSON.stringify(setup)}.`);
const names = (stopText, ids) => ids.every(id => stopText.includes(id));
const spares = (stopText, ids) => !ids.some(id => stopText.includes(id));
assert.ok(runs.none.stop !== "" && /TESLA_NO_MONITOR_ADDITIONS/.test(runs.none.stop) && /TESLA_MONITOR_ABOARD_REPORTS/.test(runs.none.stop)
    && /step 7/.test(runs.none.stop) && names(runs.none.stop, tesla) && runs.none.changed.length === 0,
  `Replicata: run the next release (data through ${setup.N}) with Tesla reports Tesla's list (through ${setup.through}) lacks, ${JSON.stringify(tesla)}, and no reviewed monitor entry for them.
Expectata: the run stops, naming every one of them, TESLA_NO_MONITOR_ADDITIONS, TESLA_MONITOR_ABOARD_REPORTS and the release checklist's step 7, and writes nothing.
Resultata: ${runs.none.stop === "" ? "completed" : JSON.stringify(runs.none.stop.slice(0, 700))}; rewrote ${JSON.stringify(runs.none.changed)}.`);
const eachProblems = Object.entries(runs.each).filter(([n, R]) =>
  !(R.stop !== "" && R.stop.includes(ID[n]) && spares(R.stop, tesla.filter(id => id !== ID[n])) && R.changed.length === 0))
  .map(([n, R]) => `${ID[n]}: ${R.stop === "" ? "completed" : JSON.stringify(R.stop.slice(0, 300))}`);
assert.deepEqual(eachProblems, [],
  `Replicata: for each of the Tesla copies ${JSON.stringify(tesla)}, run the next release with a reviewed entry for every other copy and none for it.
Expectata: each run stops, naming that copy and no other, and writes nothing (a report the list lacks needs its own review whatever its month).
Resultata: ${JSON.stringify(eachProblems, null, 1)}.`);

const E = runs.entries;
const seriesProblems = tesla.map(id => [id, E.series[id]]).filter(([id, s]) =>
  JSON.stringify(s) !== JSON.stringify(id === ID.aboardN ? ["Tesla"] : ["Tesla", "TeslaNoMonitor"]));
assert.ok(seriesProblems.length === 0 && E.offLine.length === 0 && E.flagged.length === 0,
  `Replicata: the same release with a reviewed entry for each: ${JSON.stringify(additions)} in TESLA_NO_MONITOR_ADDITIONS (among them ${ID.late}, a crash of the month before the list's date that Tesla filed after drawing up the list), ${ID.aboardN} in TESLA_MONITOR_ABOARD_REPORTS.
Expectata: the run completes; each addition's record counts on Tesla's line and the no-monitor line, the monitor-aboard report's on Tesla's line only; no other record counts on the no-monitor line, and none is a preprint (NHTSA's file holds the list's reports now).
Resultata: ${JSON.stringify(seriesProblems)}; on the line though neither listed nor an addition ${JSON.stringify(E.offLine)}; preprints ${JSON.stringify(E.flagged)}.`);
assert.deepEqual(E.listMonthLine, E.listMonthWant,
  `Replicata: in that run, list the no-monitor line's records of ${setup.L}, the month Tesla's list runs through.
Expectata: the list's in-scope reports of that month and the additions of that month (${E.listMonthWant.length}).
Resultata: ${JSON.stringify(E.listMonthLine)}.`);
const rowProblems = [];
for (const line of ["tesla", "teslanomonitor"]) {
  const r = E.rows[`${line}|${setup.L}`];
  if (!r || r.slice(0, 6).some(v => Number(v) !== 1) || r[6] !== setup.cut)
    rowProblems.push(`${line} ${setup.L}: ${JSON.stringify(r)}, want coverage 1 throughout and ${setup.cut}`);
}
const tn = E.rows[`tesla|${setup.N}`], nn = E.rows[`teslanomonitor|${setup.N}`];
if (!tn || !nn || JSON.stringify(tn) !== JSON.stringify(nn) || tn[6] !== setup.cut || !(Number(tn[0]) < 1))
  rowProblems.push(`${setup.N}: tesla ${JSON.stringify(tn)}, teslanomonitor ${JSON.stringify(nn)}, want the same partial coverage on both through ${setup.cut}`);
assert.deepEqual(rowProblems, [],
  `Replicata: in that run, read the data/vmt.js rows build_vmt_csv() wrote for Tesla's two lines in ${setup.L} (the list's month) and ${setup.N} (the new data-through month).
Expectata: ${setup.L} takes NHTSA's coverage of a month its file holds whole (every column 1) and NHTSA's cutoff ${setup.cut}, not the list's; ${setup.N} takes NHTSA's partial coverage, the same on both lines, through ${setup.cut}.
Resultata: ${JSON.stringify(rowProblems, null, 1)}.`);

const later = [["laterCut", `a list through ${setup.cut}, the additions' receipt cutoff`, additions]];
if (runs.laterMonthEnd !== null) later.push(["laterMonthEnd", `a list through the last day of ${setup.M}, the month ${ID.addM} was filed in`, [ID.addM]]);
for (const [name, what, want] of later) {
  const R = runs[name];
  assert.ok(R.stop !== "" && /TESLA_NO_MONITOR_ADDITIONS/.test(R.stop) && names(R.stop, want)
      && spares(R.stop, tesla.filter(id => !want.includes(id))) && R.changed.length === 0,
    `Replicata: the release with its reviewed entries, and Tesla's list replaced by ${what}, lacking the additions.
Expectata: the run stops on the additions Tesla had filed by the list's date, ${JSON.stringify(want)} (by the receipt cutoff of the release that reviewed them, or by the end of their first filing's month), naming TESLA_NO_MONITOR_ADDITIONS, and on no other report; it writes nothing.
Resultata: ${R.stop === "" ? "completed" : JSON.stringify(R.stop.slice(0, 700))}.`);
}
const RA = runs.releaseAfter;
assert.ok(RA.stop !== "" && /TESLA_NO_MONITOR_ADDITIONS/.test(RA.stop) && names(RA.stop, additions) && spares(RA.stop, [ID.aboardN]),
  `Replicata: at the release after (cutoff ${RA.cut}), call slurp.check_monitor_reviewed() on the records and rows of the run above, with its reviewed entries (their cutoff ${setup.cut}) and Tesla's list replaced by one through ${RA.through} that lacks the additions.
Expectata: it stops on every addition, ${JSON.stringify(additions)}: Tesla had filed each by ${setup.cut}, before the list's date, though ${ID.addN}'s month ends after it and the release's cutoff is later still; and on no other report.
Resultata: ${RA.stop === "" ? "passed" : JSON.stringify(RA.stop.slice(0, 700))}.`);
assert.ok(/move/i.test(runs.newer.stop) && /TESLA_NO_MONITOR_ADDITIONS/.test(runs.newer.stop) && runs.newer.stop.includes(ID.late)
    && runs.moved.stop === "" && JSON.stringify(runs.moved.series) === JSON.stringify(["Tesla", "TeslaNoMonitor"]),
  `Replicata: the release with its reviewed entries, and Tesla's list through ${setup.through} re-published with the late addition ${ID.late} on it; then the same with that report moved from TESLA_NO_MONITOR_ADDITIONS into TESLA_NO_MONITOR_REPORTS.
Expectata: the first run stops, saying to move the entry and naming it and TESLA_NO_MONITOR_ADDITIONS; the second completes with the report still on the no-monitor line.
Resultata: ${JSON.stringify(runs.newer.stop.slice(0, 500))}; after the move ${runs.moved.stop === "" ? "completed" : "stopped: " + JSON.stringify(runs.moved.stop.slice(0, 400))}, series ${JSON.stringify(runs.moved.series)}.`);
assert.ok(/TESLA_NO_MONITOR_ADDITIONS/.test(runs.refiled.stop) && /TESLA_MONITOR_ABOARD_REPORTS/.test(runs.refiled.stop)
    && names(runs.refiled.stop, runs.refiled.ids) && runs.refiled.changed.length === 0,
  `Replicata: the release with its reviewed entries, plus a second version of ${runs.refiled.ids.join(" and ")} whose narratives lack the words their entries quote.
Expectata: the run stops on the reviewed words no longer in the reports' latest filings, naming both tables and both reports, and writes nothing.
Resultata: ${runs.refiled.stop === "" ? "completed" : JSON.stringify(runs.refiled.stop.slice(0, 700))}.`);
assert.ok(/narrative test/i.test(runs.misread.stop) && names(runs.misread.stop, runs.misread.ids)
    && spares(runs.misread.stop, tesla.filter(id => !runs.misread.ids.includes(id))) && runs.misread.changed.length === 0,
  `Replicata: the release with its reviewed entries, plus a second version of ${ID.addN} that keeps its entry's words and adds "Tesla is filing an updated report to note that a safety monitor was present in the vehicle.", and ${ID.late} (its narrative names no monitor) reviewed as monitor-aboard instead.
Expectata: the run stops on the narrative test, naming both reports and no other, and writes nothing.
Resultata: ${runs.misread.stop === "" ? "completed" : JSON.stringify(runs.misread.stop.slice(0, 700))}.`);
assert.ok(runs.stale.stop.includes(runs.stale.id) && /TESLA_MONITOR_ABOARD_REPORTS/.test(runs.stale.stop) && runs.stale.changed.length === 0,
  `Replicata: the release with its reviewed entries, plus a monitor-aboard entry for ${runs.stale.id}, an in-scope Tesla report from before TESLA_NO_MONITOR_FROM, quoting its whole narrative.
Expectata: the run stops on an entry that names no in-scope Tesla report of the line's months, naming the report.
Resultata: ${runs.stale.stop === "" ? "completed" : JSON.stringify(runs.stale.stop.slice(0, 700))}.`);
assert.ok(/receipt cutoff/i.test(runs.misdated.stop) && names(runs.misdated.stop, runs.misdated.ids)
    && spares(runs.misdated.stop, tesla.filter(id => !runs.misdated.ids.includes(id))) && runs.misdated.changed.length === 0,
  `Replicata: the release with its reviewed entries, but ${ID.addN}'s cutoff the newest snapshots' (before ${setup.N}, the month of its first filing) and ${ID.late}'s the release after's.
Expectata: the run stops on the two entries' receipt cutoffs, naming both and no other report, and writes nothing.
Resultata: ${runs.misdated.stop === "" ? "completed" : JSON.stringify(runs.misdated.stop.slice(0, 700))}.`);
assert.ok(/first filing/i.test(runs.unfiled.stop) && runs.unfiled.stop.includes(ID.addN) && spares(runs.unfiled.stop, tesla.filter(id => id !== ID.addN)),
  `Replicata: call slurp.check_monitor_reviewed() on the records of the release with its reviewed entries, with ${ID.addN}'s first filing (Report Version 1) taken out of the rows.
Expectata: it stops on an addition whose report has no first filing among the rows, naming it and no other report.
Resultata: ${runs.unfiled.stop === "" ? "passed" : JSON.stringify(runs.unfiled.stop.slice(0, 500))}.`);
const LC = runs.listCovered;
assert.ok(/list's coverage/i.test(LC.stop) && names(LC.stop, [ID.addN, ID.aboardN]) && LC.changed.length === 0,
  `Replicata: the release with only the new month's addition ${ID.addN} and monitor-aboard report ${ID.aboardN}, reviewed, and Tesla's list replaced by one through ${LC.through} (the day before NHTSA's cutoff ${setup.cut}) with the month's miles through that day, so ${setup.N}'s rows take the list's coverage.
Expectata: the run stops on the crashes those rows count that the list lacks, naming both reports, and writes nothing.
Resultata: ${LC.stop === "" ? "completed" : JSON.stringify(LC.stop.slice(0, 700))}.`);
const LE = runs.listEarly;
const earlyProblems = [];
if (JSON.stringify(LE.series[ID.addN]) !== JSON.stringify(["Tesla", "TeslaNoMonitor"]) || JSON.stringify(LE.series[ID.aboardN]) !== JSON.stringify(["Tesla"]))
  earlyProblems.push(`series ${JSON.stringify(LE.series)}`);
for (const line of ["tesla", "teslanomonitor"]) {
  const r = LE.rows[`${line}|${setup.N}`];
  if (!r || r[6] !== setup.cut) earlyProblems.push(`${line} ${setup.N}: ${JSON.stringify(r)}, want NHTSA's coverage through ${setup.cut}`);
}
assert.deepEqual(earlyProblems, [],
  `Replicata: the same, with Tesla's list through ${setup.N}-01 and the miles of that one day.
Expectata: the run completes: ${setup.N}'s rows take NHTSA's coverage (incidents through ${setup.cut}), the addition counts on both of Tesla's lines and the monitor-aboard report on Tesla's.
Resultata: ${JSON.stringify(earlyProblems, null, 1)}.`);

console.log(`qual pass: Tesla reports newer than its latest list (through ${setup.through}) are classified from their narratives, with the narrative test holding on ${S.narrativeTest.checked} reports; the next release (data through ${setup.N}) stops until each has an entry, then counts ${additions.length} addition(s) on the no-monitor line, and stops when a list holds an addition or lacks one Tesla had filed by its date, when the words change or fail the narrative test, and when a row on the list's coverage counts a crash the list lacks`);

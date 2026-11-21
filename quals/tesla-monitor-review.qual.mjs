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
//     committed data (its counted and its pending records) passes
//     check_monitor_reviewed().
// (3) The next NHTSA release, built from the newest snapshots by
//     quals/next-release.mjs (its data-through month N the one after theirs,
//     M): Tesla's reports the latest list lacks, all filed after the newest
//     snapshots' cutoff (a no-monitor one in month M after the list's date
//     and filed in M, while the list ends before M does; a no-monitor one in
//     N; a no-monitor 5-Day report of the month before the list's, filed in
//     N: a late filing, from before the list's date; a monitor-aboard one in
//     N), the list's rows NHTSA lacks as NHTSA rows, and Waymo and Zoox
//     reports; the constants a release sets (the receipt cutoff, the arrival
//     row of the month that became measurable, a ghost month) set from each
//     run's rows. A report is reviewed at the release that brings it whether
//     its month counts yet or is pending (since 2026-11-21 a month counts
//     only when NHTSA's file is complete for it or a dated list covers it:
//     quals/pending-months.qual.mjs).
//     (a) With no reviewed entry for those Tesla reports, the run stops,
//         naming every one of them, the two tables and the release checklist's
//         step 7, and writes nothing; with an entry for all but one, it stops
//         naming that one and no other, for each of them.
//     (b) With the entries (each addition's cutoff the release's), it
//         completes: each addition's record names Tesla's line and the
//         no-monitor line, the late filing among them, which Tesla filed
//         after drawing up the list, and the monitor-aboard report's Tesla's
//         line only. The reports of months NHTSA's file now completes count
//         (the one of month M, the late one); those of the new month N, which
//         no list covers, are pending. The no-monitor line's counted crashes
//         in the month the list runs through are that month's in-scope list
//         crashes and additions; that month's rows are complete (NHTSA's
//         coverage of a month its file holds whole, and its cutoff), and the
//         new month's rows are in data/vmt.js's second segment. (Until
//         2026-11-21 the new month's reports counted too, its rows on NHTSA's
//         estimated coverage of it.)
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
//     (i) A list dated in the new month (its first day, with that day's
//         miles) covers the month for Tesla's two lines: their rows of N are
//         list rows through the list's date (the list's miles over the
//         row's), and the reports of N that the list lacks (the addition, and
//         the monitor-aboard report on Tesla's every-mode line) are pending,
//         each still naming the lines it will count on; the run completes.
//         (Until 2026-11-21 a row took the list's coverage only where the
//         list held more of the month than NHTSA's file, and a row on the
//         list's coverage that counted a crash the list lacks stopped the
//         run, check_list_covered_rows(): such a crash is pending now.)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";
import { NEXT_RELEASE_PY } from "./next-release.mjs";

const API = ["TESLA_NO_MONITOR_ADDITIONS", "TESLA_MONITOR_ABOARD_REPORTS", "SAFETY_MONITOR_PATTERN",
  "check_monitor_reviewed", "month_sources", "record_counted"];

const py = SLURP_OFFLINE_PY + String.raw`
import re
out = {'defined': {name: hasattr(slurp, name) for name in ${JSON.stringify(API)}}}
if not all(out['defined'].values()):
    print(json.dumps(out)); raise SystemExit(0)
` + NEXT_RELEASE_PY + String.raw`
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
records = (json.loads(_segment(TEXT['incidents.js'], '/* INCIDENT_DATA_START */', '/* INCIDENT_DATA_END */'))
           + json.loads(_segment(TEXT['incidents.js'], '/* PENDING_INCIDENT_DATA_START */', '/* PENDING_INCIDENT_DATA_END */')))
since = [r for r in records if r['helmer'] == 'Tesla' and slurp.nhtsa_month_to_iso(r['date']) >= slurp.TESLA_NO_MONITOR_FROM]
out['narrativeTest'] = {'checked': len(since), 'aboard': sum(r['reportId'] in ABOARD for r in since),
                        'disagree': sorted(r['reportId'] for r in since
                                           if (MONITOR.search(r['narrative']) is not None) != (r['reportId'] in ABOARD))}
out['aboardWords'] = sorted(rid for rid, words in ABOARD.items() if MONITOR.search(words) is None)
out['committed'] = stop(lambda: slurp.check_monitor_reviewed(records, slurp.filed_incident_rows(list(ROWS) + slurp.preprint_rows(ROWS))))

# (3) The next release (quals/next-release.mjs builds it).
out['setup'] = {'M': M, 'N': N, 'cut': CUT, 'through': THROUGH, 'L': L, 'ids': ID, 'additions': [ID[n] for n in ADDS],
                'copiedFrom': {'noMonitor': NM_SOURCE['Report ID'], 'aboard': AB_SOURCE['Report ID'],
                               'waymo': W_SOURCE['Report ID'], 'zoox': Z_SOURCE['Report ID']},
                'preprints': [r['Report ID'] for r in PREPRINTS_FILED],
                'wordsInNarrative': all(SPEC[n]['words'] in TESLA[n]['Narrative'] for n in TESLA)}
brief = lambda run: {'stop': run['stop'][:1500], 'changed': run['changed']}
def every(run):
    """A completed run's records, counted and pending, by Report ID, each with
    whether it counts and its month."""
    return {r['reportId']: dict(r, counted=counted, month=slurp.nhtsa_month_to_iso(r['date']))
            for counted, key in ((True, 'incidents'), (False, 'pending')) for r in run[key]}
of = lambda recs, names: {ID[n]: {k: recs[ID[n]][k] for k in ('series', 'counted', 'month')} for n in names}
cols = ['coverage', 'coverage_min', 'coverage_max', 'incident_coverage', 'incident_coverage_min', 'incident_coverage_max', 'incidents_through']
TESLA_LINES = ('tesla', 'teslanomonitor')
rows_of = lambda run, months: {r['helmer'] + '|' + r['month']: [r[c] for c in cols] for r in run['vmt']
                               if r['helmer'] in TESLA_LINES and r['month'] in months}
second_of = lambda run: sorted(r['helmer'] + '|' + r['month'] for r in run['ghost'] if r['helmer'] in TESLA_LINES and r['month'] <= N)
ALL = list(TESLA)
runs = {}
# (a) no reviewed entries; then, for each copy, entries for the others only
runs['none'] = brief(next_release(ALL, {}, {}))
runs['each'] = {n: brief(next_release(ALL, *entries([m for m in ALL if m != n]))) for n in ALL}
# (b) the entries
adds, aboards = entries(ALL)
full = next_release(ALL, adds, aboards)
completed(full, 'the next release with a reviewed entry for each Tesla copy')
recs = every(full)
all_records = full['incidents'] + full['pending']
runs['entries'] = brief(full)
runs['entries']['records'] = of(recs, ALL)
runs['entries']['offLine'] = sorted(rid for rid, r in recs.items() if 'TeslaNoMonitor' in r['series'] and rid not in LISTED | set(adds))
runs['entries']['flagged'] = sorted(rid for rid, r in recs.items() if 'preprint' in r)
runs['entries']['listMonthLine'] = sorted(rid for rid, r in recs.items()
                                          if r['counted'] and 'TeslaNoMonitor' in r['series'] and r['month'] == L)
runs['entries']['listMonthWant'] = sorted({r['Report ID'] for r in LISTED_ROWS
                                           if slurp.nhtsa_month_to_iso(r['Incident Date']) == L and r['Report ID'] not in slurp.TELEOP_DRIVEN_REPORTS}
                                          | {rid for rid in adds if recs[rid]['month'] == L})
runs['entries']['rows'] = rows_of(full, (L, N))
runs['entries']['second'] = second_of(full)
# (c) later lists lacking the additions: through their cutoff; through the end
# of month M; and, at the release after, through the day after their cutoff
runs['laterCut'] = brief(next_release(ALL, adds, aboards, listing=(CUT, LIST_CELLS, list_miles(CUT))))
runs['laterMonthEnd'] = brief(next_release(ALL, adds, aboards, listing=(last_day(M), LIST_CELLS, list_miles(last_day(M))))) if 'addM' in TESLA else None
after_cut = shift_day(CUT, 1)
runs['releaseAfter'] = {'stop': stop(lambda: slurp.check_monitor_reviewed(all_records, slurp.filed_incident_rows(full['rows'])),
                                     **dict(full['patch'], NHTSA_DATA_THROUGH_DATE=cutoff(slurp.month_shift(N, 1)),
                                            PREPRINT_LIST=dict(slurp.PREPRINT_LIST, through=after_cut))),
                        'through': after_cut, 'cut': cutoff(slurp.month_shift(N, 1))}
# (d) a list holding the late addition (the list through its date, as Tesla
# re-published it after that filing), then the entry moved into its Report IDs
moved = ID['late']
holding = (THROUGH, LIST_CELLS + [day_cells(moved, LM + '-01')], slurp.PREPRINT_LIST['miles'])
runs['newer'] = brief(next_release(ALL, adds, aboards, listing=holding))
after = next_release(ALL, {k: v for k, v in adds.items() if k != moved}, aboards, listing=holding, listed=LISTED | {moved})
runs['moved'] = brief(after)
completed(after, 'the next release with the late addition moved into the list')
runs['moved']['record'] = {k: every(after)[moved][k] for k in ('series', 'counted')}
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
old = min(rid for rid, r in LATEST.items() if r['Reporting Entity'] == 'Tesla, Inc.' and slurp.is_public_service_incident(r)
          and slurp.nhtsa_month_to_iso(r['Incident Date']) < slurp.TESLA_NO_MONITOR_FROM)
runs['stale'] = brief(next_release(ALL, adds, dict(aboards, **{old: LATEST[old]['Narrative'].strip()})))
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
runs['unfiled'] = {'stop': stop(lambda: slurp.check_monitor_reviewed(all_records, no_first), **full['patch'])}
# (i) a list dated on the new month's first day, holding that day's miles and
# neither of the month's two Tesla copies
same = ['addN', 'aboardN']
first_day = N + '-01'
early = next_release(same, *entries(same), listing=(first_day, LIST_CELLS, list_miles(first_day)))
completed(early, f'the next release with a list through {first_day}')
runs['listEarly'] = brief(early)
runs['listEarly']['through'] = first_day
runs['listEarly']['records'] = of(every(early), same)
runs['listEarly']['rows'] = rows_of(early, (N,))
runs['listEarly']['second'] = second_of(early)
runs['listEarly']['share'] = {line.lower() + '|' + N: round(list_miles(first_day) / VMT_NEXT[(line, N)], 4) for line in ('Tesla', 'TeslaNoMonitor')}
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
  `Replicata: call slurp.check_monitor_reviewed() on data/incidents.js's records, counted and pending, and the newest snapshots' rows.
Expectata: it passes (every in-scope Tesla report of the line's months is classified, every entry names one, and the reviewed ones pass the narrative test).
Resultata: it stops: ${S.committed.slice(0, 600)}`);

// (3) The next release.
const { setup, runs } = S;
const ID = setup.ids, additions = setup.additions, tesla = Object.values(ID);
assert.ok(setup.wordsInNarrative && additions.includes(ID.addN) && additions.includes(ID.late),
  `Replicata: build the release after the newest snapshots (data through ${setup.M}): data through ${setup.N}, cutoff ${setup.cut}, Tesla's list through ${setup.through} (quals/next-release.mjs, which stops unless the list's month is at or before ${setup.M}).
Expectata: Tesla copies whose entries' words are in their narratives; the November and the late no-monitor additions.
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
// What each Tesla copy's record should say: the lines it names, and whether
// its month counts at this release (NHTSA's file completes every month before
// N; N itself, which no list covers, is pending).
const wantRecord = id => ({ series: id === ID.aboardN ? ["Tesla"] : ["Tesla", "TeslaNoMonitor"], counted: E.records[id].month < setup.N });
const recordProblems = tesla.filter(id => JSON.stringify({ series: E.records[id].series, counted: E.records[id].counted }) !== JSON.stringify(wantRecord(id)))
  .map(id => `${id} (${E.records[id].month}): ${JSON.stringify(E.records[id])}, want ${JSON.stringify(wantRecord(id))}`);
const counted = tesla.filter(id => E.records[id].counted), pendingIds = tesla.filter(id => !E.records[id].counted);
assert.ok(recordProblems.length === 0 && E.offLine.length === 0 && E.flagged.length === 0
    && counted.includes(ID.late) && pendingIds.includes(ID.addN) && pendingIds.includes(ID.aboardN),
  `Replicata: the same release with a reviewed entry for each: ${JSON.stringify(additions)} in TESLA_NO_MONITOR_ADDITIONS (among them ${ID.late}, a crash of the month before the list's date that Tesla filed after drawing up the list), ${ID.aboardN} in TESLA_MONITOR_ABOARD_REPORTS.
Expectata: the run completes; each addition's record names Tesla's line and the no-monitor line, the monitor-aboard report's Tesla's line only; a copy counts when its month is before ${setup.N} (NHTSA's file completes it: ${ID.late} among them) and is pending when its month is ${setup.N}, which no list covers (${ID.addN}, ${ID.aboardN}); no other record names the no-monitor line, and none is a preprint (NHTSA's file holds the list's reports now).
Resultata: ${JSON.stringify(recordProblems)}; counted ${JSON.stringify(counted)}, pending ${JSON.stringify(pendingIds)}; naming the line though neither listed nor an addition ${JSON.stringify(E.offLine)}; preprints ${JSON.stringify(E.flagged)}.`);
assert.deepEqual(E.listMonthLine, E.listMonthWant,
  `Replicata: in that run, list the no-monitor line's counted records of ${setup.L}, the month Tesla's list runs through.
Expectata: the list's in-scope reports of that month and the additions of that month (${E.listMonthWant.length}).
Resultata: ${JSON.stringify(E.listMonthLine)}.`);
const rowProblems = [];
for (const line of ["tesla", "teslanomonitor"]) {
  const r = E.rows[`${line}|${setup.L}`];
  if (!r || r.slice(0, 6).some(v => Number(v) !== 1) || r[6] !== setup.cut)
    rowProblems.push(`${line} ${setup.L}: ${JSON.stringify(r)}, want coverage 1 throughout and ${setup.cut}`);
  if (E.rows[`${line}|${setup.N}`] !== undefined || !E.second.includes(`${line}|${setup.N}`))
    rowProblems.push(`${line} ${setup.N}: analysis row ${JSON.stringify(E.rows[`${line}|${setup.N}`])}, second segment ${JSON.stringify(E.second)}; want no analysis row and a row in the second segment (the month is pending)`);
}
assert.deepEqual(rowProblems, [],
  `Replicata: in that run, read the data/vmt.js rows slurp wrote for Tesla's two lines in ${setup.L} (the list's month) and ${setup.N} (the new data-through month).
Expectata: ${setup.L} is complete (every coverage column 1) with NHTSA's cutoff ${setup.cut}, not the list's; ${setup.N}, which no list covers, has no analysis row on either line and a row in the second segment.
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
    && runs.moved.stop === "" && JSON.stringify(runs.moved.record) === JSON.stringify({ series: ["Tesla", "TeslaNoMonitor"], counted: true }),
  `Replicata: the release with its reviewed entries, and Tesla's list through ${setup.through} re-published with the late addition ${ID.late} on it; then the same with that report moved from TESLA_NO_MONITOR_ADDITIONS into TESLA_NO_MONITOR_REPORTS.
Expectata: the first run stops, saying to move the entry and naming it and TESLA_NO_MONITOR_ADDITIONS; the second completes with the report still counted on the no-monitor line.
Resultata: ${JSON.stringify(runs.newer.stop.slice(0, 500))}; after the move ${runs.moved.stop === "" ? "completed" : "stopped: " + JSON.stringify(runs.moved.stop.slice(0, 400))}, record ${JSON.stringify(runs.moved.record)}.`);
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
const LE = runs.listEarly;
const earlyProblems = [];
if (LE.stop !== "") earlyProblems.push(`the run stopped: ${LE.stop.slice(0, 500)}`);
for (const [id, series] of [[ID.addN, ["Tesla", "TeslaNoMonitor"]], [ID.aboardN, ["Tesla"]]]) {
  if (JSON.stringify(LE.records[id]) !== JSON.stringify({ series, counted: false, month: setup.N }))
    earlyProblems.push(`${id}: ${JSON.stringify(LE.records[id])}, want pending, in ${setup.N}, naming ${JSON.stringify(series)}`);
}
for (const line of ["tesla", "teslanomonitor"]) {
  const r = LE.rows[`${line}|${setup.N}`], share = LE.share[`${line}|${setup.N}`];
  if (!r || r[6] !== LE.through || r.slice(0, 3).some(v => Number(v) !== share) || !(share > 0 && share < 1) || !(Number(r[4]) < 1) || Number(r[5]) !== 1)
    earlyProblems.push(`${line} ${setup.N}: ${JSON.stringify(r)}, want a list row through ${LE.through}: receipt coverage ${share} three times, an incident coverage with a low edge under 1 and a high edge of 1`);
  if (LE.second.includes(`${line}|${setup.N}`)) earlyProblems.push(`${line} ${setup.N} is in the second segment too`);
}
assert.deepEqual(earlyProblems, [],
  `Replicata: the release with only the new month's addition ${ID.addN} and monitor-aboard report ${ID.aboardN}, reviewed, and Tesla's list replaced by one through ${LE.through}, the month's first day, with that day's miles, holding neither.
Expectata: the run completes: ${setup.N}'s rows for Tesla's two lines are list rows through ${LE.through} (the list's miles over the row's), and the two reports, which the list lacks, are pending, the addition naming both of Tesla's lines and the monitor-aboard report Tesla's.
Resultata: ${JSON.stringify(earlyProblems, null, 1)}.`);

console.log(`qual pass: Tesla reports newer than its latest list (through ${setup.through}) are classified from their narratives, with the narrative test holding on ${S.narrativeTest.checked} reports; the next release (data through ${setup.N}) stops until each has an entry, then counts those of the months NHTSA's file completes (${counted.length}) and holds the new month's pending (${pendingIds.length}), and stops when a list holds an addition or lacks one Tesla had filed by its date, when the words change or fail the narrative test; a list dated in the new month covers it, and the crashes it lacks stay pending`);

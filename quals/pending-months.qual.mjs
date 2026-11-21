// Pending months (the human, 2026-11-20/21, on NHTSA's partly reported newest
// month: "maximum conservativeness, don't show things when they involve
// arbitrary guesses"; restated and confirmed: "if we know when a helmer's
// crash reports end then we compute the exact VMT for the crashes. if not, we
// don't try to guess."). Until 2026-11-21 the page estimated what share of
// the data-through month's crashes NHTSA's file held and counted that share
// of the month's miles.
//
// The rule. T is NHTSA's data-through month (NHTSA_DATA_THROUGH_DATE's). A
// line's month at or before T enters the rates (an analysis row of
// data/vmt.js, its incidents in INCIDENT_DATA) only when
//   (a) NHTSA's file is complete for the line's company and month: the month
//       is before T and outside the company's Monthly-report lag (month <=
//       T - 1 - MONTHLY_ARRIVAL_LAG[company]); its row is complete (its six
//       coverage values 1, its incidents through NHTSA's receipt cutoff); or
//   (b) the company's own dated list covers it (PREPRINT_LIST: each line of
//       the list's company, in the list's month): its row counts the list's
//       span (the list's miles over the row's miles, three times over; the
//       company's on-time share of Monthly reports, its Wilson 95% lower
//       bound, and 1; its incidents through the list's date), and of that
//       month's crashes only those on the list count.
// Every other line-month at or before T is pending (its reports are still
// arriving): its data/vmt.csv row goes, with the months after T (the ghost
// months), in data/vmt.js's second segment, and its in-scope incidents, with
// the crashes of a list-covered month that the list lacks, go in a second
// array of data/incidents.js, PENDING_INCIDENT_DATA: same record shape, same
// checks, counted on no line. A record is counted on every line it names or
// on none.
//
// Spec.
// (1) data/vmt.js's analysis segment holds exactly data/vmt.csv's rows of the
//     complete and the list-covered line-months, in the master's order, each
//     with its seven coverage cells as the rule gives them (a list row's
//     recomputed here from PREPRINT_LIST, data/vmt.csv's miles and
//     MONTHLY_ARRIVAL_OBSERVATIONS, cell for cell as slurp writes them).
// (2) Its second segment holds exactly the master's other rows (the pending
//     line-months' and the ghost months'), verbatim; so every line has a row,
//     in one segment or the other, for each of its months through the newest
//     ghost month with no gap, and each line's second-segment months follow
//     its last analysis month.
// (3) INCIDENT_DATA holds the in-scope incidents the rule counts and
//     PENDING_INCIDENT_DATA the ones it does not, each recounted here from
//     the newest snapshots (the highest version of each report, the scope
//     filter, one report per Same Incident ID, a second AV's record), with no
//     record in both; a pending record has every field a counted one has.
// (4) The page. A window shows its own months and, when it ends at the
//     slider's last month, the months after it. In the windows that show a
//     pending record's month the incident browser lists the record after the
//     counted rows, its row marked by the class of the RECORD_MARKS entry
//     whose label is PENDING_LABEL (grayed by style.css), its narrative led
//     by that label; in other windows it lists none. Nothing else reads the
//     pending array: with the array emptied, the cards, the MPI,
//     distribution and VMT charts, the growth charts, the sanity section,
//     the filter buttons' counts and the incident count line are character
//     for character what they were, and the table's rows are the same but
//     for the pending ones. A pending line-month draws on its line's VMT
//     chart as a ghost month does (faded dot, faded error bar, the dashed
//     stretch), its dot's note VMT_PENDING_NOTE; a ghost month keeps
//     VMT_GHOST_NOTE; the MPI chart has no mark for a pending line-month. The
//     page checks the pending records at load (checkPendingIncidents): one
//     is accepted when, on every line it names, its month is pending or
//     list-covered, and refused when a line's month is one NHTSA's file
//     completes, a month after T, or a month the line has no row for. In
//     Chromium and WebKit (and Firefox where it runs): the pending rows are
//     there, grayed (opacity under 1) and labeled, in the default view, the
//     count line and the filter buttons count the other rows, a window
//     ending a month earlier lists none, and the page throws nothing; a
//     pending row un-grays while a control in it holds keyboard focus (a
//     focus ring is painted at its element's opacity); and the table's stuck
//     header covers a grayed row scrolled under it as it covers any other row
//     (an element with opacity under 1 is painted with the positioned
//     elements, in tree order, so a header with no z-index let a grayed row's
//     text show through it): the header's pixels do not change when the
//     header is raised far above every row.
// (5) Synthetic releases, each through slurp's main() offline:
//     (a) a company given one more release of Monthly-report lag: its month
//         before T is pending too (its row in the second segment, its
//         incidents in PENDING_INCIDENT_DATA), and nothing else moves;
//     (b) the next release (data through N, the month after T) with Tesla's
//         latest list as it is, which covers no part of N: every line is
//         pending at N, so the analysis rows end at T (the slider's last
//         month), N's reports are pending, and T, pending today for the
//         lines no list covers, is complete: its records are in
//         INCIDENT_DATA;
//     (c) that release with a list dated the day before its cutoff: N's rows
//         for Tesla's two lines are list rows, and Tesla's reports of N that
//         the list lacks (a reviewed no-monitor addition, a monitor-aboard
//         report) are pending, with the lines they will count on; the run
//         completes;
//     (d) a list dated in the month after T stops the run (a month only a
//         list covers has no rule), and so does a Monthly-report lag that
//         leaves a month pending before a month a list covers;
//     (e) the page loads what each of the runs (a), (b) and (c) wrote: its
//         load-time checks accept it, its slider ends at the newest month
//         with an analysis row, and the default window draws (the cards, the
//         charts, the sanity section, the growth charts), its incident table
//         listing the window's counted incidents, which the count line
//         counts, and after them, marked, the run's pending ones. (The
//         assumptions list is left out: its entries on the company list stop
//         it at a release that changes the list's rows, AGENTS.md open
//         question 42(c).)
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";
import { appScript, dataScript } from "./load-app.mjs";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";
import { NEXT_RELEASE_PY } from "./next-release.mjs";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const incJs = fs.readFileSync("data/incidents.js", "utf8");
const vmtJs = fs.readFileSync("data/vmt.js", "utf8");
const marked = (text, name) => {
  const start = `/* ${name}_START */`;
  const a = text.indexOf(start), b = text.indexOf(`/* ${name}_END */`);
  return a >= 0 && b > a ? text.slice(a + start.length, b) : null;
};
assert.ok(marked(incJs, "INCIDENT_DATA") !== null && marked(incJs, "PENDING_INCIDENT_DATA") !== null,
  `Replicata: read data/incidents.js's two record arrays, between its /* INCIDENT_DATA_START */ and /* PENDING_INCIDENT_DATA_START */ markers and their _END markers.
Expectata: both: the incidents the rates count, and the in-scope incidents of line-months whose reports are still arriving, which no line counts yet.
Resultata: ${["INCIDENT_DATA", "PENDING_INCIDENT_DATA"].filter(n => marked(incJs, n) === null).join(" and ")} missing.`);

// (The capture of the two segments' text goes in before the next-release
// prelude, which keeps its own reference to slurp.ghost_vmt_csv.)
const py = SLURP_OFFLINE_PY + String.raw`
RAW = {}
_build, _ghost = slurp.build_vmt_csv, slurp.ghost_vmt_csv
def _build_kept(*args):
    RAW['vmt'] = _build(*args); return RAW['vmt']
def _ghost_kept(*args):
    RAW['ghost'] = _ghost(*args); return RAW['ghost']
slurp.build_vmt_csv, slurp.ghost_vmt_csv = _build_kept, _ghost_kept
` + NEXT_RELEASE_PY + String.raw`
import math
iso = slurp.nhtsa_month_to_iso
T = M
COMPANY = slurp.HELMER_SHORT[slurp.PREPRINT_LIST['entity']]
LIST_LINES = sorted(s for s, c in slurp.SERIES_COMPANY.items() if c == COMPANY)
def rule(line, month, through=T, lags=None, covered=None):
    """The rule, restated: 'complete', 'list' or 'pending' for a line's month at
    or before <through>, under the lags <lags> and the list-covered
    line-months <covered>."""
    lags = slurp.MONTHLY_ARRIVAL_LAG if lags is None else lags
    covered = {(l, L) for l in LIST_LINES} if covered is None else covered
    if month <= slurp.month_shift(through, -1 - lags[slurp.SERIES_COMPANY[line]]): return 'complete'
    return 'list' if (line, month) in covered else 'pending'
def counts(rid, lines, month, list_ids, **world):
    """Whether the rule counts the record <rid> of <month>, on <lines>: on each
    it is complete, or list-covered with the record on the list."""
    states = {rule(l, month, **world) for l in lines}
    return all(s == 'complete' or (s == 'list' and rid in list_ids) for s in states)
def on_time(observations):
    """(share, its Wilson 95% lower bound) of the list's company's Monthly
    reports that arrived on time, over the months with both counts."""
    measured = [c for c in observations[COMPANY].values() if len(c) > 1]
    n = sum(sum(c) for c in measured); p = sum(c[0] for c in measured) / n; z = 1.96
    return p, (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)
def list_cells(miles, row_miles, observations, through):
    """A list row's seven coverage cells, as slurp writes them."""
    c = str(round(miles / row_miles, 4)); p, low = on_time(observations)
    return [c, c, c, str(round(p, 4)), str(round(low, 4)), '1.0', through]
out = {'T': T, 'N': N, 'L': L, 'through': THROUGH, 'cutoff': slurp.NHTSA_DATA_THROUGH_DATE, 'lags': dict(slurp.MONTHLY_ARRIVAL_LAG),
       'listLines': LIST_LINES, 'canon': {s.lower(): s for s in slurp.SERIES_COMPANY}}

# (1), (2) What the two segments of data/vmt.js must hold: each master row's
# status and, for an analysis row, its coverage cells.
master = [r for r in csv.reader(io.StringIO(slurp.read_vmt_master())) if any(c.strip() for c in r)]
vmt_values = slurp.parse_vmt_values(slurp.read_vmt_master())
rows = []
for r in master[1:]:
    line, month = slurp._canonical_helmer(r[0].strip()), r[1].strip()
    status = 'ghost' if month > T else rule(line, month)
    cells = {'complete': ['1'] * 6 + [slurp.NHTSA_DATA_THROUGH_DATE],
             'list': list_cells(slurp.PREPRINT_LIST['miles'], vmt_values[(line, month)], slurp.MONTHLY_ARRIVAL_OBSERVATIONS, THROUGH)}.get(status)
    rows.append({'label': r[0], 'line': line, 'month': month, 'status': status, 'coverage': cells,
                 'miles': [c.strip().replace(',', '') for c in r[2:8]], 'rationale': r[8]})
out['master'] = {'header': master[0], 'rows': rows}

# (3) The in-scope incidents of the newest snapshots, recounted: NHTSA's rows
# and the list's rows NHTSA lacks, the highest version of each report, the
# scope filter less the reports a re-filing replaced, one report per Same
# Incident ID (or per report, for a split crash), and a second AV's record.
every = list(ROWS) + slurp.preprint_rows(ROWS)
by_rid = {}
for r in every:
    if not all(r[k].strip() for k in ('Report ID', 'Report Version', 'Same Incident ID', 'Incident Date')): continue
    if r['Report ID'] not in by_rid or int(r['Report Version']) > int(by_rid[r['Report ID']]['Report Version']): by_rid[r['Report ID']] = r
replaced = {old for old, new in slurp.SUPERSEDED_REPORTS.items() if new in by_rid}
by_inc = {}
for r in by_rid.values():
    if not slurp.is_public_service_incident(r) or r['Report ID'] in replaced: continue
    key = r['Report ID'] if r['Report ID'] in slurp.SPLIT_SAME_INCIDENT_REPORTS else r['Same Incident ID']
    assert key not in by_inc, ('two in-scope reports under one Same Incident ID', key)
    by_inc[key] = r
no_monitor = slurp.TESLA_NO_MONITOR_REPORTS | set(slurp.TESLA_NO_MONITOR_ADDITIONS)
window = {month for _line, month in vmt_values if month <= T}
want = {}
for r in by_inc.values():
    helmer, month = slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip())
    if month not in window: continue
    seconds = [r['Report ID'] + slurp.SECOND_INVOLVEMENT_SUFFIX] if r['Report ID'] in slurp.SECOND_INVOLVEMENTS else []
    for rid in [r['Report ID']] + seconds:
        lines = [helmer] + [line for line, (company, members) in slurp.DERIVED_SERIES_REPORTS.items() if company == helmer and rid in members()]
        want[rid] = {'helmer': helmer, 'month': month, 'series': lines,
                     'counted': counts(rid, lines, month, slurp.TESLA_NO_MONITOR_REPORTS)}
out['records'] = want

# (5) Synthetic releases.
def keys(segment):
    return sorted([slurp._canonical_helmer(r['helmer']), r['month']] for r in segment)
def brief(run):
    done = run['stop'] == ''
    return {'stop': run['stop'][:700], 'changed': run['changed'],
            'analysis': keys(run['vmt']) if done else None, 'ghost': keys(run['ghost']) if done else None,
            'counted': sorted(r['reportId'] for r in run['incidents']) if done else None,
            'pending': {r['reportId']: {'helmer': r['helmer'], 'month': iso(r['date']), 'series': r['series']} for r in run['pending']} if done else None}
def partition(run, list_ids, **world):
    """The run's records the rule would put in the other array."""
    if run['stop'] != '': return None
    wrong = [r['reportId'] for r in run['incidents'] if not counts(r['reportId'], r['series'], iso(r['date']), list_ids, **world)]
    wrong += [r['reportId'] for r in run['pending'] if counts(r['reportId'], r['series'], iso(r['date']), list_ids, **world)]
    return sorted(wrong)
def segments(master_text, **world):
    """The (line, month)s the rule puts in each segment of data/vmt.js, from
    the master text <master_text>."""
    through = world.get('through', T)
    body = [r for r in csv.reader(io.StringIO(master_text)) if any(c.strip() for c in r)][1:]
    cells = [[slurp._canonical_helmer(r[0].strip()), r[1].strip()] for r in body]
    analysis = sorted(c for c in cells if c[1] <= through and rule(c[0], c[1], **world) != 'pending')
    return {'analysis': analysis, 'ghost': sorted(c for c in cells if c not in analysis)}
runs = {}
pages = {}
def page(name, run, through):
    """What a completed run wrote, for the page to load ((5)(e)): its
    data-through date, its two record arrays and the text of data/vmt.js's
    two segments; None for a run that stopped."""
    pages[name] = None if run['stop'] != '' else {'through': through, 'incidents': run['incidents'], 'pending': run['pending'],
                                                 'vmt': RAW['vmt'], 'ghost': RAW['ghost'], 'roadway': run['roadway']}
# the newest snapshots as they are
base = run_main()
runs['baseline'] = brief(base)
# (a) one more release of Monthly-report lag for a company with no list: its
# month before T is pending too. The arrival tables' own checks are set aside
# (quals/monthly-arrival-lag.qual.mjs holds them to the snapshots): what is
# under test is what a lag does to the months.
lag_company = sorted(h for h in set(slurp.HELMER_SHORT.values()) if h != COMPANY)[-1]
lags = {**slurp.MONTHLY_ARRIVAL_LAG, lag_company: slurp.MONTHLY_ARRIVAL_LAG[lag_company] + 1}
lagged = run_main(MONTHLY_ARRIVAL_LAG=lags, check_monthly_arrivals=lambda counts, last_month: None)
page('lag', lagged, slurp.NHTSA_DATA_THROUGH_DATE)
runs['lag'] = dict(brief(lagged), company=lag_company, month=slurp.month_shift(T, -1 - slurp.MONTHLY_ARRIVAL_LAG[lag_company]),
                   want=segments(slurp.read_vmt_master(), lags=lags), wrong=partition(lagged, slurp.TESLA_NO_MONITOR_REPORTS, lags=lags))
# (b) the next release, Tesla's latest list as it is
nolist = next_release([], {}, {})
page('next', nolist, CUT)
runs['next'] = dict(brief(nolist), want=segments(MASTER_NEXT, through=N), wrong=partition(nolist, LISTED, through=N),
                    new=sorted(r['Report ID'] for r in OTHERS if iso(r['Incident Date']) == N),
                    late=sorted(r['Report ID'] for r in OTHERS if iso(r['Incident Date']) == M),
                    lines=sorted(slurp.SERIES_COMPANY))
# (c) the next release with a list dated the day before its cutoff
before_cut = shift_day(CUT, -1)
same = ['addN', 'aboardN']
listed_run = next_release(same, *entries(same), listing=(before_cut, LIST_CELLS, list_miles(before_cut)))
page('listed', listed_run, CUT)
covered = {(l, N) for l in LIST_LINES}
list_ids = listed_run['patch']['TESLA_NO_MONITOR_REPORTS']
runs['listed'] = dict(brief(listed_run), want=segments(MASTER_NEXT, through=N, covered=covered), through=before_cut,
                      wrong=partition(listed_run, list_ids, through=N, covered=covered),
                      ids={n: ID[n] for n in same},
                      cells={l: list_cells(list_miles(before_cut), VMT_NEXT[(l, N)], listed_run['patch']['MONTHLY_ARRIVAL_OBSERVATIONS'], before_cut) for l in LIST_LINES},
                      rows={slurp._canonical_helmer(r['helmer']): [r[c] for c in ('coverage', 'coverage_min', 'coverage_max', 'incident_coverage',
                                                                           'incident_coverage_min', 'incident_coverage_max', 'incidents_through')]
                            for r in (listed_run['vmt'] or []) if r['month'] == N and slurp._canonical_helmer(r['helmer']) in LIST_LINES})
# (d) the stops: a list dated in the month after T (holding no crash of that
# month), on the newest snapshots; and, on the next release with the list
# dated the day before its cutoff, a Monthly-report lag for the list's
# company, which leaves its month before N pending though its N is covered
after_t = N + '-01'
runs['listAfter'] = brief(run_main(PREPRINT_LIST=dict(slurp.PREPRINT_LIST, through=after_t, miles=list_miles(after_t)),
                                   latest_list_path=lambda: slurp.SNAPSHOT_DIR / ('tesla-list-' + after_t.replace('-', '') + '.xlsx'),
                                   read_list_cells=lambda p: LIST_CELLS))
gap_lags = {**slurp.MONTHLY_ARRIVAL_LAG, COMPANY: slurp.MONTHLY_ARRIVAL_LAG[COMPANY] + 1}
runs['gap'] = brief(next_release(same, *entries(same), listing=(before_cut, LIST_CELLS, list_miles(before_cut)),
                                 MONTHLY_ARRIVAL_LAG=gap_lags, check_monthly_arrivals=lambda counts, last_month: None))
out['runs'] = runs
out['pages'] = pages
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read the newest snapshots through data/slurp.py and run its main() offline on them and on synthetic releases.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-2500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));
const problems = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- (1), (2) data/vmt.js's two segments ------------------------------------
const segment = name => parseCsv(marked(vmtJs, name).trim().replace(/^`/, "").replace(/`$/, "").trim());
const analysisCsv = segment("VMT_CSV"), ghostCsv = segment("GHOST_VMT_CSV");
const master = S.master.rows;
const wantAnalysis = master.filter(r => r.status === "complete" || r.status === "list").map(r => [r.label, r.month, ...r.miles, ...r.coverage, r.rationale]);
const wantGhost = master.filter(r => r.status === "pending" || r.status === "ghost").map(r => [r.label, r.month, ...r.miles, r.rationale]);
const firstDiff = (got, want) => { const i = want.findIndex((w, j) => !same(got[j], w)); return i < 0 ? got.length : i; };
if (!same(analysisCsv.slice(1), wantAnalysis)) {
  const i = firstDiff(analysisCsv.slice(1), wantAnalysis);
  problems.push(`(1) data/vmt.js's analysis segment has ${analysisCsv.length - 1} rows, the rule gives ${wantAnalysis.length} (the complete and the list-covered line-months of data/vmt.csv, in its order, each with its coverage cells); first difference at row ${i + 1}: ${JSON.stringify((analysisCsv[i + 1] || []).slice(0, 15))} where ${JSON.stringify((wantAnalysis[i] || []).slice(0, 15))}`);
}
if (!same(ghostCsv[0], S.master.header) || !same(ghostCsv.slice(1), wantGhost)) {
  const i = firstDiff(ghostCsv.slice(1), wantGhost);
  problems.push(`(2) data/vmt.js's second segment has ${ghostCsv.length - 1} rows under ${JSON.stringify(ghostCsv[0])}, the rule gives ${wantGhost.length} under data/vmt.csv's header (the pending line-months' rows and the ghost months', verbatim, in the master's order); first difference at row ${i + 1}: ${JSON.stringify((ghostCsv[i + 1] || []).slice(0, 8))} where ${JSON.stringify((wantGhost[i] || []).slice(0, 8))}`);
}
const nextMonth = m => { const n = +m.slice(0, 4) * 12 + +m.slice(5, 7); return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; };
const lines = [...new Set(master.map(r => r.line))].sort();
const monthsOf = (csv, line) => csv.slice(1).filter(r => S.canon[r[0].trim().toLowerCase()] === line).map(r => r[1]).sort();
const newestGhost = ghostCsv.slice(1).map(r => r[1]).sort().at(-1);
for (const line of lines) {
  const a = monthsOf(analysisCsv, line), g = monthsOf(ghostCsv, line), all = [...a, ...g];
  if (a.length === 0) problems.push(`(2) ${line} has no analysis row`);
  if (new Set(all).size !== all.length) problems.push(`(2) ${line} has a month in both segments`);
  if (!all.every((m, i) => i === 0 || m === nextMonth(all[i - 1]))) problems.push(`(2) ${line}'s months, its analysis rows' then its second-segment rows', are not one run month by month (its second-segment months must follow its last analysis month): ...${all.slice(-5).join(", ")}`);
  if (all.at(-1) !== newestGhost || !(newestGhost > S.T)) problems.push(`(2) ${line}'s rows end at ${all.at(-1)}, the newest ghost month is ${newestGhost} (after NHTSA's ${S.T})`);
  if (a.some(m => m > S.T)) problems.push(`(2) ${line} has an analysis row after NHTSA's data-through month ${S.T}`);
}
const pendingRows = master.filter(r => r.status === "pending"), listRows = master.filter(r => r.status === "list");

// --- (3) The two record arrays -----------------------------------------------
const dataCtx = vm.createContext({});
vm.runInContext(dataScript + "\nvar __counted = INCIDENT_DATA, __pending = PENDING_INCIDENT_DATA;", dataCtx);
const counted = JSON.parse(JSON.stringify(vm.runInContext("__counted", dataCtx)));
const pending = JSON.parse(JSON.stringify(vm.runInContext("__pending", dataCtx)));
const ids = records => records.map(r => r.reportId).sort();
const wantCounted = Object.keys(S.records).filter(id => S.records[id].counted).sort();
const wantPending = Object.keys(S.records).filter(id => !S.records[id].counted).sort();
const diff = (got, want) => `${got.filter(id => !want.includes(id)).slice(0, 8).join(", ") || "none"} unexpected, ${want.filter(id => !got.includes(id)).slice(0, 8).join(", ") || "none"} missing`;
if (!same(ids(counted), wantCounted)) problems.push(`(3) INCIDENT_DATA holds ${counted.length} records, the recount of the newest snapshots under the rule ${wantCounted.length} counted (${diff(ids(counted), wantCounted)})`);
if (!same(ids(pending), wantPending)) problems.push(`(3) PENDING_INCIDENT_DATA holds ${pending.length} records, the recount of the newest snapshots under the rule ${wantPending.length} pending (${diff(ids(pending), wantPending)})`);
const seriesWrong = [...counted, ...pending].filter(r => S.records[r.reportId] !== undefined && !same(r.series, S.records[r.reportId].series)).map(r => r.reportId);
if (seriesWrong.length > 0) problems.push(`(3) records whose series are not the recount's: ${seriesWrong.slice(0, 8).join(", ")}`);
if (counted.length > 0) {
  const fields = Object.keys(counted.find(r => r.preprint === undefined && r.secondOf === undefined)).sort();
  const odd = pending.filter(r => !same(Object.keys(r).filter(k => k !== "preprint" && k !== "secondOf").sort(), fields)).map(r => r.reportId);
  if (odd.length > 0) problems.push(`(3) pending records whose fields are not a counted record's (${fields.join(", ")}): ${odd.slice(0, 8).join(", ")}`);
}
const pendingBy = {};
for (const r of pending) pendingBy[r.helmer] = (pendingBy[r.helmer] || 0) + 1;

// --- (5) Synthetic releases ----------------------------------------------------
const R = S.runs;
const ran = (name, what) => {
  if (R[name].stop === "") return true;
  problems.push(`(5) ${what}: the run stops: ${JSON.stringify(R[name].stop.slice(0, 400))}`);
  return false;
};
if (ran("baseline", "the newest snapshots as they are") && !(same(R.baseline.counted, ids(counted)) && same(Object.keys(R.baseline.pending).sort(), ids(pending))))
  problems.push(`(5) an offline run on the newest snapshots writes ${R.baseline.counted.length} counted and ${Object.keys(R.baseline.pending).length} pending records, data/incidents.js holds ${counted.length} and ${pending.length}`);
const segmentsOk = (name, what) => {
  const r = R[name];
  if (!same(r.analysis, r.want.analysis) || !same(r.ghost, r.want.ghost))
    problems.push(`(5) ${what}: the run's analysis rows and second-segment rows are not the rule's: analysis ${r.analysis.length} (want ${r.want.analysis.length}; e.g. ${JSON.stringify(r.analysis.filter(k => !r.want.analysis.some(w => same(w, k))).concat(r.want.analysis.filter(k => !r.analysis.some(w => same(w, k)))).slice(0, 4))}), second segment ${r.ghost.length} (want ${r.want.ghost.length})`);
  if (r.wrong.length > 0) problems.push(`(5) ${what}: records in the array the rule does not put them in: ${r.wrong.slice(0, 8).join(", ")}`);
};
// (a)
if (ran("lag", `one more release of Monthly-report lag for ${R.lag.company}`)) {
  const what = `one more release of Monthly-report lag for ${R.lag.company}`;
  segmentsOk("lag", what);
  const key = [R.lag.company, R.lag.month];
  const moved = Object.entries(R.lag.pending).filter(([id]) => !(id in R.baseline.pending));
  if (!R.lag.ghost.some(k => same(k, key)) || R.lag.analysis.some(k => same(k, key)))
    problems.push(`(5) ${what}: its ${R.lag.month} row must leave the analysis rows for the second segment`);
  if (!(moved.length > 0 && moved.every(([, r]) => r.helmer === R.lag.company && r.month === R.lag.month)))
    problems.push(`(5) ${what}: the records that became pending are ${JSON.stringify(moved.slice(0, 4))}, want ${R.lag.company}'s of ${R.lag.month} and no other`);
  if (!same([...R.lag.counted, ...Object.keys(R.lag.pending)].sort(), [...R.baseline.counted, ...Object.keys(R.baseline.pending)].sort()))
    problems.push(`(5) ${what}: the run's records, counted and pending together, are not the baseline's`);
}
// (b)
if (ran("next", `the next release (data through ${S.N}) with Tesla's list through ${S.through}`)) {
  const what = `the next release (data through ${S.N}) with Tesla's list through ${S.through}`;
  segmentsOk("next", what);
  const newest = line => R.next.analysis.filter(k => k[0] === line).map(k => k[1]).sort().at(-1);
  const ends = R.next.lines.filter(line => newest(line) !== S.T || !R.next.ghost.some(k => same(k, [line, S.N])));
  if (ends.length > 0) problems.push(`(5) ${what}: no list covers ${S.N}, so every line's analysis rows must end at ${S.T} and its ${S.N} row sit in the second segment; not so for ${ends.join(", ")}`);
  const notPending = R.next.new.filter(id => !(id in R.next.pending)), notCounted = [...Object.keys(R.baseline.pending), ...R.next.late].filter(id => !R.next.counted.includes(id));
  if (R.next.new.length === 0 || notPending.length > 0) problems.push(`(5) ${what}: the reports of ${S.N} (${R.next.new.join(", ")}) must be pending; not so for ${notPending.join(", ") || "(none built)"}`);
  if (notCounted.length > 0) problems.push(`(5) ${what}: ${S.T} is complete now, so the records pending today and its late reports must be in INCIDENT_DATA; missing ${notCounted.slice(0, 8).join(", ")}`);
}
// (c)
if (ran("listed", `the next release with a list through ${R.listed.through}`)) {
  const what = `the next release with a list through ${R.listed.through}, the day before its cutoff`;
  segmentsOk("listed", what);
  for (const line of S.listLines) {
    if (!same(R.listed.rows[line], R.listed.cells[line])) problems.push(`(5) ${what}: ${line}'s ${S.N} row has the coverage cells ${JSON.stringify(R.listed.rows[line])}, want the list's ${JSON.stringify(R.listed.cells[line])}`);
  }
  const wantSeries = { addN: S.listLines.includes("TeslaNoMonitor") ? ["Tesla", "TeslaNoMonitor"] : null, aboardN: ["Tesla"] };
  for (const [name, id] of Object.entries(R.listed.ids)) {
    const p = R.listed.pending[id];
    if (p === undefined || !same(p.series, wantSeries[name])) problems.push(`(5) ${what}: ${id} (${name}), a Tesla report of ${S.N} that the list lacks, must be pending with the lines ${JSON.stringify(wantSeries[name])}; it is ${p === undefined ? (R.listed.counted.includes(id) ? "counted" : "in neither array") : `pending with ${JSON.stringify(p.series)}`}`);
  }
}
// (d)
if (!(R.listAfter.stop !== "" && /list/i.test(R.listAfter.stop) && R.listAfter.stop.includes(S.N) && R.listAfter.changed.length === 0))
  problems.push(`(5) a list dated ${S.N}-01, in the month after NHTSA's data-through month ${S.T}: want a stop that names the list and ${S.N} and writes nothing; ${R.listAfter.stop === "" ? "the run completes" : JSON.stringify(R.listAfter.stop.slice(0, 300))}, rewrote ${JSON.stringify(R.listAfter.changed)}`);
if (!(R.gap.stop !== "" && /pending/i.test(R.gap.stop) && R.gap.stop.includes(S.T) && R.gap.changed.length === 0))
  problems.push(`(5) the next release with a list covering ${S.N} and a Monthly-report lag that leaves the list's company's ${S.T} pending: want a stop that names the pending month ${S.T} before a counted one and writes nothing; ${R.gap.stop === "" ? "the run completes" : JSON.stringify(R.gap.stop.slice(0, 300))}, rewrote ${JSON.stringify(R.gap.changed)}`);

// The problems so far, reported: called before the page is loaded on the data
// (the page checks the same promises at load, checkGhostVmtRows and
// checkPendingIncidents, and its stop would otherwise be all a reader of a
// red run sees) and again after the page's views are read.
const report = () => {
  for (const p of problems) console.error(p);
  assert.ok(problems.length === 0,
  `Replicata: read data/vmt.js and data/incidents.js against data/vmt.csv and a recount of the newest snapshots under the rule (a line's month counts when NHTSA's file is complete for it, month <= ${S.T} - 1 - its company's Monthly-report lag, or Tesla's list through ${S.through} covers it; else it is pending); run slurp.main() offline on the snapshots with one more release of lag, on the next release (data through ${S.N}) and on it with a list dated the day before its cutoff, and with a list or a lag the rule has no answer for; render the page's views in a DOM stub in four windows, with the pending array as loaded and emptied.
Expectata: the spec of this qual's header, (1) to (5).
Resultata: ${problems.length} problems:
${problems.join("\n")}`);
};
report();

// --- (4) The page, in a DOM stub ---------------------------------------------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => esc(s).replace(/"/g, "&quot;");
const unesc = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this._html = ""; this._text = ""; this.className = ""; this.style = {}; this.dataset = {}; this.value = "0";
    this.classList = { toggle() { return false; } }; }
  set textContent(v) { this._text = String(v); this._html = esc(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  addEventListener() {}
  setAttribute(k, v) { this[k] = v; }
  focus() {}
  querySelector() { return new El("queried"); }
}
const nodes = new Map();
const ctx = vm.createContext({ console, Math, Number, Set, JSON, document: {
  getElementById: id => nodes.get(id) || (nodes.set(id, new El("div")), nodes.get(id)),
  createElement: tag => new El(tag), activeElement: new El("body") } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const defined = name => vm.runInContext(`typeof ${name}`, ctx) !== "undefined";
const API = ["loadIncidents", "pendingIncidents", "PENDING_LABEL", "VMT_PENDING_NOTE", "RECORD_MARKS"];
assert.deepEqual(API.filter(n => !defined(n)), [],
  `Replicata: load crashla.js and look for what shows the pending records and months: ${API.join(", ")}.
Expectata: it defines each.
Resultata: undefined.`);
vm.runInContext(`
  loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
  checkGhostVmtRows();
  fullMonthSeries = monthSeriesData();`, ctx);
const app = JSON.parse(vm.runInContext(`JSON.stringify({
  lines: ADS_SERIES, companies: ADS_HELMERS, months: fullMonthSeries.months, defaultStart: DEFAULT_START_MONTH,
  labels: Object.fromEntries(ADS_SERIES.map(h => [h, helmerLabel(h)])), prefixes: Object.fromEntries(ADS_SERIES.map(h => [h, seriesMarkName(h, "")])),
  label: PENDING_LABEL, pendingNote: VMT_PENDING_NOTE, ghostNote: VMT_GHOST_NOTE,
  mark: RECORD_MARKS.filter(m => m.label === PENDING_LABEL), loaded: pendingIncidents.map(r => r.reportId),
})`, ctx));
const sliderLast = app.months.at(-1);
const wantLast = master.filter(r => r.status === "complete" || r.status === "list").map(r => r.month).sort().at(-1);
if (sliderLast !== wantLast) problems.push(`(4) the slider's months end at ${sliderLast}, the newest month with an analysis row is ${wantLast}`);
if (app.mark.length !== 1 || app.mark[0].rowClass.trim() === "" || typeof app.label !== "string" || app.label.trim() === "")
  problems.push(`(4) RECORD_MARKS must hold one mark whose label is PENDING_LABEL, with a row class; it holds ${JSON.stringify(app.mark)} for the label ${JSON.stringify(app.label)}`);
if ([app.pendingNote, app.ghostNote].some(n => typeof n !== "string" || n.trim() === "") || app.pendingNote === app.ghostNote)
  problems.push(`(4) VMT_PENDING_NOTE must be a note of its own, apart from VMT_GHOST_NOTE: ${JSON.stringify(app.pendingNote)}`);
if (!same([...app.loaded].sort(), ids(pending))) problems.push(`(4) loadIncidents loads ${app.loaded.length} pending records, data/incidents.js holds ${pending.length}`);
const pendingClass = app.mark.length === 1 ? app.mark[0].rowClass.trim() : "";

// Every view of a window, as markup: with every line checked, on a
// Monthly-track metric.
const render = ([first, final], emptied) => JSON.parse(vm.runInContext(`(() => {
  const kept = pendingIncidents;
  pendingIncidents = ${emptied} ? [] : kept;
  for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
  selectedMetricKey = "all"; vmtCumulative = false; activeFilter = "All"; sortCol = null;
  monthRangeStart = fullMonthSeries.months.indexOf(${JSON.stringify(first)});
  monthRangeEnd = fullMonthSeries.months.indexOf(${JSON.stringify(final)});
  renderWindowedViews();
  buildBrowser();
  buildSanityChecks();
  const html = id => document.getElementById(id).innerHTML;
  const out = {
    views: {
      cards: html("mpi-summary-cards"), mpi: html("chart-mpi-all"), dist: html("chart-distributions"), own: html("chart-helmer-series"),
      combined: html("chart-vmt-combined"), sanity: html("sanity-checks"),
      growth: GROWTH_METRIC_KEYS.map(k => { selectedGrowthMetric = k; return renderFleetTimeSeriesChart() + renderFleetForecastChart(); }).join(""),
      filters: document.getElementById("filters").children.map(b => b.textContent).join(" | "),
      count: document.getElementById("incident-count").textContent,
    },
    ownCharts: Object.fromEntries(ADS_SERIES.map(h => [h, renderHelmerMonthlyChart(activeSeries, h)])),
    rows: document.getElementById("incidents-body").children.map(tr => ({ cls: tr.className, html: tr.innerHTML })),
  };
  selectedGrowthMetric = "fleet";
  pendingIncidents = kept;
  return JSON.stringify(out);
})()`, ctx));
const rowId = row => (/id="narr-text-([^"]*)"/.exec(row.html) || [])[1];
const rowText = row => unesc((/<span id="narr-text-[^"]*">([^<]*)/.exec(row.html) || [])[1] ?? "");
const isPending = row => pendingClass !== "" && row.cls.split(/\s+/).includes(pendingClass);
const shownIn = ([first, final]) => pending.filter(r => {
  const month = S.records[r.reportId] ? S.records[r.reportId].month : null;
  return month !== null && month >= first && (month <= final || final === sliderLast);
}).map(r => r.reportId).sort();
const DEFAULT_WINDOW = [app.defaultStart, sliderLast];
const windows = [["the default window", DEFAULT_WINDOW], ["the slider's last month alone", [sliderLast, sliderLast]],
  ["the window ending a month before the slider's last", [app.defaultStart, app.months.at(-2)]], ["the full history", [app.months[0], sliderLast]]];
for (const [what, window] of windows) {
  const full = render(window, false), bare = render(window, true);
  const where = `(4) ${what} (${window.join("..")})`;
  const changed = Object.keys(full.views).filter(k => full.views[k] !== bare.views[k]);
  if (changed.length > 0) problems.push(`${where}: with the pending array emptied, these views change: ${changed.join(", ")} (nothing but the incident table's rows may read it)`);
  const marks = full.rows.filter(isPending), others = full.rows.filter(r => !isPending(r));
  const want = shownIn(window);
  if (!same(marks.map(rowId).sort(), want)) problems.push(`${where}: the incident table marks ${marks.length} rows pending, want the ${want.length} pending records of the months the window shows`);
  if (!same(others, bare.rows)) problems.push(`${where}: the table's other rows (${others.length}) are not the rows it draws with the pending array emptied (${bare.rows.length})`);
  if (!same(full.rows.slice(0, others.length), others)) problems.push(`${where}: the pending rows do not follow the counted rows`);
  const unlabeled = marks.filter(r => !rowText(r).startsWith(app.label + " ")).map(rowId);
  if (unlabeled.length > 0) problems.push(`${where}: pending rows whose narrative does not lead with PENDING_LABEL: ${unlabeled.slice(0, 5).join(", ")}`);
  if (bare.rows.some(isPending)) problems.push(`${where}: a row is marked pending with the pending array emptied`);
  // The VMT charts: each line's second-segment rows the window shows, faded,
  // each dot's tooltip ending with its note; the line's analysis months solid.
  const shows = month => month >= window[0] && (month <= window[1] || window[1] === sliderLast);
  for (const line of app.lines) {
    const chart = full.ownCharts[line];
    const tips = [...chart.matchAll(/data-tip="([^"]*)"/g)].map(m => unesc(m[1]));
    const faded = [...chart.matchAll(/<circle class="month-dot month-ghost"/g)].length;
    const mine = master.filter(r => r.line === line && shows(r.month));
    const second = mine.filter(r => r.status === "pending" || r.status === "ghost");
    if (faded !== second.length) problems.push(`${where}, ${line}'s VMT chart: ${faded} faded dots, want ${second.length} (its pending and ghost months the window shows: ${second.map(r => r.month).join(", ") || "none"})`);
    for (const r of second) {
      const note = r.status === "pending" ? app.pendingNote : app.ghostNote;
      if (!tips.some(t => t.startsWith(r.month + "\n") && t.endsWith("\n" + note))) problems.push(`${where}, ${line}'s VMT chart: no dot tooltip for ${r.month} ending with ${r.status === "pending" ? "VMT_PENDING_NOTE" : "VMT_GHOST_NOTE"}`);
    }
    for (const r of mine.filter(r => r.status === "complete" || r.status === "list")) {
      if (tips.some(t => t.startsWith(r.month + "\n") && (t.endsWith("\n" + app.pendingNote) || t.endsWith("\n" + app.ghostNote))))
        problems.push(`${where}, ${line}'s VMT chart: ${r.month}, an analysis month, carries a pending or ghost note`);
    }
  }
  // The MPI chart: a mark per line-month with an analysis row in the window,
  // none for a pending one.
  const mpiTargets = [...full.views.mpi.matchAll(/data-tip="([^"]*)" tabindex="0" aria-label="([^"]*)"/g)].map(m => ({ tip: unesc(m[1]), name: unesc(m[2]) }));
  for (const r of master.filter(x => x.month >= window[0] && x.month <= window[1] && x.status !== "ghost")) {
    const has = mpiTargets.some(t => t.name === app.prefixes[r.line] + t.tip && t.tip.startsWith(r.month + "\n"));
    if (has !== (r.status !== "pending")) problems.push(`${where}, the MPI chart: ${r.line} ${r.month} (${r.status}) ${has ? "has" : "has no"} mark`);
  }
}
// The page's own check of the pending records at load (checkPendingIncidents),
// on a small synthetic state: line A complete through the month before T,
// then a list row at T; line B complete through two months before T, then
// pending (a lagged company's two months); both with a ghost month after T.
{
  const T = vm.runInContext("NHTSA_DATA_THROUGH_DATE", ctx).slice(0, 7);
  const shift = (month, n) => { const k = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n; return `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, "0")}`; };
  const label = month => `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(month.slice(5)) - 1]}-${month.slice(0, 4)}`;
  const [A, B] = app.lines;
  const whole = { coverage: 1, coverageMin: 1, coverageMax: 1, incCov: 1, incCovMin: 1, incCovMax: 1 };
  const listed = { coverage: 0.5, coverageMin: 0.5, coverageMax: 0.5, incCov: 0.9, incCovMin: 0.7, incCovMax: 1 };
  const analysis = [{ helmer: A, month: shift(T, -2), ...whole }, { helmer: A, month: shift(T, -1), ...whole }, { helmer: A, month: T, ...listed },
    { helmer: B, month: shift(T, -2), ...whole }];
  const second = [{ helmer: B, month: shift(T, -1) }, { helmer: B, month: T }, { helmer: A, month: shift(T, 1) }, { helmer: B, month: shift(T, 1) }];
  const REFUSAL = "a pending incident must be of a pending or a list-covered month of every line it names";
  const cases = [ // what, the record's lines, its month, accepted?
    ["of a pending month", [B], T, true],
    ["of a lagged company's pending month before T", [B], shift(T, -1), true],
    ["of a list-covered month (a crash the list lacks)", [A], T, true],
    ["of a month list-covered on one of its lines and pending on the other", [A, B], T, true],
    ["of a month NHTSA's file completes", [A], shift(T, -1), false],
    ["of a month complete on one of its lines and pending on the other", [A, B], shift(T, -1), false],
    ["of a ghost month, after T", [B], shift(T, 1), false],
    ["of a month its line has no row for", [B], shift(T, -3), false],
  ];
  const got = JSON.parse(vm.runInContext(`(() => {
    const kept = [vmtRows, ghostVmtRows, pendingIncidents];
    const out = [];
    try {
      vmtRows = ${JSON.stringify(analysis)}; ghostVmtRows = ${JSON.stringify(second)};
      for (const rec of ${JSON.stringify(cases.map(([_what, series, month], i) => ({ reportId: `synthetic-${i}`, series, date: label(month) })))}) {
        pendingIncidents = [rec];
        try { checkPendingIncidents(); out.push("accepted"); } catch (e) { out.push(String(e.message)); }
      }
    } finally { [vmtRows, ghostVmtRows, pendingIncidents] = kept; }
    return JSON.stringify(out);
  })()`, ctx));
  cases.forEach(([what, series, month, accepted], i) => {
    const ok = accepted ? got[i] === "accepted" : got[i].startsWith(REFUSAL);
    if (!ok) problems.push(`(4) checkPendingIncidents, with T = ${T}, ${A} complete through ${shift(T, -1)} and list-covered at ${T}, ${B} complete through ${shift(T, -2)} and pending from ${shift(T, -1)}: a pending record ${what} (${series.join(" and ")}, ${month}) is ${got[i] === "accepted" ? "accepted" : `refused or fails: ${got[i].slice(0, 160)}`}; want it ${accepted ? "accepted" : `refused ("${REFUSAL}")`}`);
  });
}
// --- (5)(e) The page on each completed synthetic release ------------------------
{
  const committed = fs.readFileSync("data/incidents.js", "utf8"), cut = committed.indexOf("const NHTSA_DATA_THROUGH_DATE");
  assert.ok(cut > 0, "quals/pending-months.qual.mjs: data/incidents.js declares no NHTSA_DATA_THROUGH_DATE to build a synthetic release's data from");
  for (const [name, what] of [["lag", "one more release of Monthly-report lag"], ["next", "the next release, Tesla's list as it is"], ["listed", "the next release with a list dated the day before its cutoff"]]) {
    const P = S.pages[name], R = S.runs[name];
    if (P === null) continue; // the run stopped: reported under (5) above
    const where = `(5)(e) the page on ${what} (data through ${P.through})`;
    // The run's output as the two data files would hold it (with the
    // Roadway Type classes it wrote, ROADWAY_CLASS, since 2026-11-21).
    const data = `${committed.slice(0, cut)}const NHTSA_DATA_THROUGH_DATE = ${JSON.stringify(P.through)};
const ROADWAY_CLASS = ${JSON.stringify(P.roadway)};
const INCIDENT_DATA = ${JSON.stringify(P.incidents)};
const PENDING_INCIDENT_DATA = ${JSON.stringify(P.pending)};
const VMT_CSV_TEXT = ${JSON.stringify(P.vmt + "\n")};
const GHOST_VMT_CSV_TEXT = ${JSON.stringify(P.ghost + "\n")};`;
    const pageNodes = new Map();
    const pageCtx = vm.createContext({ console, Math, Number, Set, JSON, document: {
      getElementById: id => pageNodes.get(id) || (pageNodes.set(id, new El("div")), pageNodes.get(id)),
      createElement: tag => new El(tag), activeElement: new El("body") } });
    vm.runInContext(data, pageCtx, { filename: "data.js" });
    vm.runInContext(appScript, pageCtx, { filename: "crashla.js" });
    let drawn;
    try {
      drawn = JSON.parse(vm.runInContext(`(() => {
        loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
        vmtRows = parseVmtCsv(VMT_CSV_TEXT);
        ghostVmtRows = parseGhostVmtCsv(GHOST_VMT_CSV_TEXT);
        checkGhostVmtRows();
        checkPreSeriesOffsets();
        checkPendingIncidents();
        fullMonthSeries = monthSeriesData();
        for (const h of ALL_HELMERS) monthHelmerEnabled[h] = true;
        selectedMetricKey = "all"; vmtCumulative = false; activeFilter = "All"; sortCol = null;
        monthRangeStart = fullMonthSeries.months.indexOf(DEFAULT_START_MONTH);
        monthRangeEnd = fullMonthSeries.months.length - 1;
        renderWindowedViews();
        buildBrowser();
        buildSanityChecks();
        for (const k of GROWTH_METRIC_KEYS) { selectedGrowthMetric = k; renderFleetTimeSeriesChart(); renderFleetForecastChart(); }
        const rows = document.getElementById("incidents-body").children.map(tr => tr.className.split(/\\s+/).includes(${JSON.stringify(pendingClass)}));
        return JSON.stringify({ last: fullMonthSeries.months.at(-1), start: DEFAULT_START_MONTH, rows, counted: activeIncidents().length,
          countLine: document.getElementById("incident-count").textContent === splur(activeIncidents().length, "incident") });
      })()`, pageCtx));
    } catch (e) {
      problems.push(`${where}: it stops: ${String(e.message).slice(0, 400)}`);
      continue;
    }
    const wantLast = R.analysis.map(([_line, month]) => month).sort().at(-1);
    const wantPending = Object.values(R.pending).filter(r => r.month >= drawn.start).length;
    const marked = drawn.rows.filter(Boolean).length;
    if (drawn.last !== wantLast) problems.push(`${where}: its slider ends at ${drawn.last}, want the run's newest month with an analysis row, ${wantLast}`);
    if (marked !== wantPending || drawn.rows.length !== drawn.counted + wantPending || drawn.rows.slice(0, drawn.counted).some(Boolean) || !drawn.countLine)
      problems.push(`${where}: the default window's incident table has ${drawn.rows.length} rows, ${marked} marked pending (${drawn.rows.slice(0, drawn.counted).filter(Boolean).length} of them among the first ${drawn.counted}), and its count line ${drawn.countLine ? "counts" : "does not count"} the window's ${drawn.counted} counted incidents; want those ${drawn.counted} rows, then the run's ${wantPending} pending records from ${drawn.start} on, marked, and the count line counting the first`);
  }
}
const css = fs.readFileSync("style.css", "utf8");
if (pendingClass !== "" && !new RegExp(`tr\\.${pendingClass}\\b[^{]*\\{[^}]*opacity:\\s*0?\\.\\d`).test(css))
  problems.push(`(4) style.css has no rule that grays a table row of class ${pendingClass} (an opacity under 1)`);

report();

// --- (4) In the browsers --------------------------------------------------------
const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const read = cls => {
  const rows = [...document.querySelectorAll("#incidents-body tr")];
  const marked = rows.filter(tr => tr.classList.contains(cls));
  const buttons = Object.fromEntries([...document.querySelectorAll("#filters button")].map(b => { const m = /^(.*) \(([\d,]+)\)$/.exec(b.textContent); return [m[1], Number(m[2].replace(/,/g, ""))]; }));
  return {
    rows: rows.length, marked: marked.length,
    opacity: marked.map(tr => Number(getComputedStyle(tr).opacity)),
    unlabeled: marked.filter(tr => !tr.querySelector(".narrative-toggle span").textContent.startsWith(PENDING_LABEL + " ")).length,
    byCompany: Object.fromEntries(Object.keys(buttons).map(k => [k, rows.filter(tr => !tr.classList.contains(cls) && (k === "All" || tr.cells[0].textContent === k)).length])),
    buttons, count: Number(document.getElementById("incident-count").textContent.replace(/[^\d]/g, "")),
    fadedDots: document.querySelectorAll("#chart-helmer-series .month-dot.month-ghost").length,
    notes: [...document.querySelectorAll("#chart-helmer-series [data-tip]")].filter(e => e.getAttribute("data-tip").endsWith("\n" + VMT_PENDING_NOTE)).length,
  };
};
const server = await serveRepo();
const browserProblems = [], seen = [];
const shownLines = ["Tesla", "Waymo"]; // the default view's companies
const wantFaded = master.filter(r => shownLines.includes(r.line) && (r.status === "pending" || r.status === "ghost")).length;
const wantNotes = master.filter(r => shownLines.includes(r.line) && r.status === "pending").length;
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const tag = `[${engine}]`;
  const page = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
  const at = await page.evaluate(read, pendingClass);
  const want = shownIn(DEFAULT_WINDOW).length;
  if (at.marked !== want) browserProblems.push(`${tag} the default view lists ${at.marked} pending rows, want ${want}`);
  if (at.opacity.some(o => !(o > 0 && o < 1))) browserProblems.push(`${tag} pending rows drawn at opacity ${[...new Set(at.opacity)].join(", ")}, want them grayed (under 1)`);
  if (at.unlabeled > 0) browserProblems.push(`${tag} ${at.unlabeled} pending rows do not lead their narrative with PENDING_LABEL`);
  if (at.count !== at.rows - at.marked || at.buttons.All !== at.count) browserProblems.push(`${tag} the count line reads ${at.count} and the All button ${at.buttons.All}, the table holds ${at.rows - at.marked} rows that are not pending`);
  const off = Object.keys(at.buttons).filter(k => at.buttons[k] !== at.byCompany[k]);
  if (off.length > 0) browserProblems.push(`${tag} filter buttons that do not count their company's rows that are not pending: ${off.map(k => `${k} ${at.buttons[k]} (rows ${at.byCompany[k]})`).join(", ")}`);
  if (at.fadedDots !== wantFaded || at.notes !== wantNotes) browserProblems.push(`${tag} the companies' VMT charts draw ${at.fadedDots} faded dots, ${at.notes} with the pending note; want ${wantFaded} and ${wantNotes}`);
  if (at.marked > 0) {
    // Keyboard focus un-grays the row: a key press first, so the focus given
    // below counts as keyboard focus (as quals/focus-ungrayed.qual.mjs does).
    await page.focus("#month-metric-select");
    await page.keyboard.press("Shift");
    const focus = await page.evaluate(cls => {
      const row = document.querySelector(`#incidents-body tr.${cls}`);
      const stop = row.querySelector('a[href], button, input, select, [tabindex="0"]');
      if (stop === null) return { stop: false };
      stop.focus();
      const held = { visible: stop.matches(":focus-visible"), opacity: Number(getComputedStyle(row).opacity) };
      stop.blur();
      return { stop: true, ...held, after: Number(getComputedStyle(row).opacity) };
    }, pendingClass);
    if (!(focus.stop && focus.visible && focus.opacity === 1 && focus.after < 1))
      browserProblems.push(`${tag} a pending row's first Tab stop, focused from the keyboard: ${JSON.stringify(focus)}; want a Tab stop, :focus-visible, the row at opacity 1 while it holds focus and grayed again after`);
    // The stuck header over a grayed row: scroll the first pending row half
    // under the header and compare the header's pixels with the same view in
    // which the header is raised far above every row (a style added for the
    // comparison): they are the same exactly when the header as styled
    // already covers the row. (Comparing with the header over another row
    // fails in WebKit for a reason of its own: hairline seams between the
    // stuck cells let whatever lies beneath tint a column of pixels.)
    const under = await page.evaluate(cls => {
      const row = document.querySelector(`#incidents-body tr.${cls}`);
      // The header's box is its cells' (the cells are what sticks: WebKit
      // gives the header row's own box where it would lie unstuck).
      const scroller = row.closest(".table-scroll"), cells = [...scroller.querySelectorAll("thead th")];
      scroller.scrollIntoView({ block: "start" });
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - cells[0].getBoundingClientRect().height / 2;
      const h = cells[0].getBoundingClientRect(), right = cells.at(-1).getBoundingClientRect().right, r = row.getBoundingClientRect();
      const y = Math.ceil(Math.max(h.top, 0)) + 1;
      return { row: r.top < h.bottom - 4 && r.bottom > h.top + 4, opacity: Number(getComputedStyle(row).opacity),
        clip: { x: Math.ceil(h.left) + 1, y, width: Math.floor(right - h.left) - 2, height: Math.floor(h.bottom) - y - 1 } };
    }, pendingClass);
    // Each side is a settled screenshot, the second of two in a row that are
    // identical: in WebKit the first screenshot after the scroll can differ
    // from the next with nothing changed between them (seen in 1 of 3 runs
    // on a scratch copy, 2026-11-21), which read as the row showing through.
    const settled = async () => {
      let last = await page.screenshot({ clip: under.clip });
      for (let tries = 0; tries < 10; tries++) {
        const next = await page.screenshot({ clip: under.clip });
        if (next.equals(last)) return next;
        last = next;
      }
      return null;
    };
    const styled = await settled();
    await page.addStyleTag({ content: ".table-scroll th { z-index: 50 !important; }" });
    const raised = await settled();
    if (styled === null || raised === null)
      browserProblems.push(`${tag} the incident table's stuck header with a grayed pending row scrolled half under it: no two screenshots in a row are identical in 11 tries (${styled === null ? "as styled" : "with the header raised"}), so the comparison cannot be made`);
    else if (!(under.row && under.opacity < 1 && under.clip.width > 100 && under.clip.height > 10 && styled.equals(raised)))
      browserProblems.push(`${tag} the incident table's stuck header with a grayed pending row scrolled half under it (row under the header: ${under.row}, at opacity ${under.opacity}; header box ${JSON.stringify(under.clip)}): its pixels change when the header is raised above every row, so the grayed row shows through the header as styled`);
  }
  browserProblems.push(...page.errors.map(e => `${tag} page error: ${e}`));
  await page.context().close();
  const earlier = await openPage(browser, `${server.url}${DEF}&d=${app.defaultStart}.${app.months.at(-2)}`, { viewport: { width: 1200, height: 900 } });
  const before = await earlier.evaluate(read, pendingClass);
  const wantBefore = shownIn([app.defaultStart, app.months.at(-2)]).length;
  if (before.marked !== wantBefore || before.count !== before.rows - before.marked) browserProblems.push(`${tag} the window ending at ${app.months.at(-2)} lists ${before.marked} pending rows (want ${wantBefore}) and counts ${before.count} of ${before.rows} rows`);
  browserProblems.push(...earlier.errors.map(e => `${tag} page error (window ending at ${app.months.at(-2)}): ${e}`));
  seen.push(`${engine} ${at.marked} grayed rows of ${at.rows}`);
  await browser.close();
}
await server.close();
for (const p of browserProblems) console.error(p);
assert.ok(browserProblems.length === 0,
  `Replicata: load the default view, and the window ending a month before the slider's last, in ${Object.keys(ENGINES).join(", ")}.
Expectata: the pending records of the months the window shows listed as rows marked ${JSON.stringify(pendingClass)}, grayed and led by PENDING_LABEL; the count line and the filter buttons counting the other rows; the companies' VMT charts drawing their pending and ghost months faded, the pending ones with VMT_PENDING_NOTE; a pending row un-grayed while a control in it holds keyboard focus; the table's stuck header covering a grayed row scrolled under it; no page error.
Resultata: ${browserProblems.length} problems:
${browserProblems.join("\n")}`);

const named = rows => [...new Set(rows.map(r => `${r.line} ${r.month}`))].join(", ") || "none";
console.log(`qual pass: with NHTSA's data through ${S.T}, the line-months no complete file or dated list covers are pending (${named(pendingRows)}; list-covered: ${named(listRows)}): their rows sit with the ghost months in data/vmt.js's second segment, their ${pending.length} in-scope incidents (${Object.entries(pendingBy).map(([h, n]) => `${h} ${n}`).join(", ") || "none"}) in PENDING_INCIDENT_DATA, each recounted from the newest snapshots; slurp puts a lagged company's month, the next release's newest month and a list-covered month's unlisted crashes there too, and counts a pending month once its release completes it; the page lists the pending records grayed, in the windows that show their month, and no other view reads them (${seen.join("; ")})`);

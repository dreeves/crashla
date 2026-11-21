// Preprints: crash reports a company has published that NHTSA's files do not
// hold yet (the human, 2026-11-18: "can we add the new incidents, style them
// in a clear way to show they're not official yet, and incorporate them in a
// fully principled way?", then "yes, build"). Tesla's robotaxi safety page
// links a spreadsheet of every crash it reported to NHTSA with no safety
// monitor aboard (data/snapshots/tesla-list-YYYYMMDD.xlsx, the file as Tesla
// serves it); on 2026-11-18 it held eight October crashes that NHTSA's
// Nov-16 release, of reports received through Oct 15, did not.
//
// Spec.
// (1) The list is one more source file of data/slurp.py: list_rows() maps
//     each of its rows onto NHTSA's columns, and a row whose Report ID no
//     NHTSA file holds is a preprint (preprint_rows()). NHTSA's row stands
//     wherever NHTSA has the report, so a preprint turns official at the
//     release that publishes it. A preprint goes through every check an
//     NHTSA row does (scope, the narrative tripwires, the reviewed tables,
//     the fault raters) and its record in data/incidents.js carries
//     `preprint: true`; no other record has the key.
// (2) The list has agreed with NHTSA so far: every list row whose report
//     NHTSA's files hold matches one of that report's filed versions on
//     month, place, road, weather, crash partner, severity, speed, airbags
//     and contact areas, and its narrative is that version's: word for word
//     (NHTSA's "[XXX]" standing for what it redacted), or at least nine
//     words in ten in order. On 2026-11-18, 23 of 24 were word for word; in
//     13781-17015 the list's "proceeding straight through a work zone" is
//     "proceeding straight near a work zone" in NHTSA's filing. A preprint
//     is trusted on that record; a list that stops agreeing turns this qual
//     red.
// (3) Coverage. For the month the list runs through, each line of the list's
//     company takes its coverage from the list where NHTSA's file is not yet
//     complete for that month:
//     receipt coverage = the list's miles (the company's no-monitor miles of
//     that month through the list's date) over the row's miles, and
//     Monthly-track incident coverage = the share of the company's Monthly
//     reports that reached NHTSA on time (MONTHLY_ARRIVAL_OBSERVATIONS, the
//     months with both counts measured), from its Wilson 95% lower bound to
//     1. A line-month NHTSA's file completes (a month before the
//     data-through month, outside the company's Monthly-report lag) takes
//     NHTSA's file whatever a list says of it: every coverage value 1. A
//     line-month neither covers has no row: it is pending
//     (quals/pending-months.qual.mjs). data/vmt.js gives every
//     row the date its incidents run through (incidents_through): NHTSA's
//     receipt cutoff, or the list's date on a row the list covers. (Until
//     2026-11-21 NHTSA's partly reported data-through month had an estimated
//     coverage of its own, and a row took whichever source covered more of
//     it, the larger product of the two best values, NHTSA's on a tie.)
//     The list's date and miles (PREPRINT_LIST's through and miles) are
//     Tesla's page's for the list's month, the entry of
//     quals/tesla-page-part.mjs, the one place the quals hold that figure
//     (since 2026-11-21, audit finding A17 of 2026-11-20: until then the
//     expectations here came from slurp's own miles, which nothing compared
//     with a source, so a list moved to a new date with the old miles, or
//     miles mistyped, passed every qual).
// (4) The run stops on a list it cannot read as described: an unknown
//     column, weather or contact area, a speed that is no whole number, a
//     crash dated after the list's date, a file whose name is not the list's
//     date, Report IDs that differ from TESLA_NO_MONITOR_REPORTS, a preprint
//     dated after NHTSA's data-through month, or list miles above a row's.
//     It stops too on a list that disagrees with a review of a report newer
//     than the list before it (since 2026-11-20, audit finding A1;
//     quals/tesla-monitor-review.qual.mjs): one holding a reviewed
//     no-monitor addition (TESLA_NO_MONITOR_ADDITIONS: move it into the
//     list's Report IDs) or a report reviewed as monitor-aboard
//     (TESLA_MONITOR_ABOARD_REPORTS).
// (5) The page: a partially received month's note names the row's own date;
//     the incident browser gives a preprint's row a class the stylesheet
//     styles and leads its narrative with PREPRINT_LABEL.
//
// No section needs a preprint to exist in the live data (after the release
// that publishes the last one there is none): the run-level checks add a
// synthetic one, a copy of a list row NHTSA has published under a new Report
// ID.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";
import { appScript, dataScript } from "./load-app.mjs";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";
import { TESLA_PAGE_PART } from "./tesla-page-part.mjs";

const API = ["PREPRINT_LIST", "PREPRINT_REPORT_TYPE", "latest_list_path", "read_list_cells", "list_row", "list_rows",
  "preprint_rows", "newest_report_rows", "preprint_coverage"];

const py = SLURP_OFFLINE_PY + String.raw`
import difflib, re, zipfile, xml.etree.ElementTree as ET
out = {'defined': {name: hasattr(slurp, name) for name in ${JSON.stringify(API)}}}
if not all(out['defined'].values()):
    print(json.dumps(out)); raise SystemExit(0)
L = slurp.PREPRINT_LIST
company = slurp.HELMER_SHORT[L['entity']]
out['list'] = dict(L); out['dataThrough'] = slurp.NHTSA_DATA_THROUGH_DATE; out['type'] = slurp.PREPRINT_REPORT_TYPE

# The list read by this qual's own reader: the first sheet's cells by header.
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
def cells(path):
    z = zipfile.ZipFile(path)
    shared = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(NS + 'si')]
    sheet = sorted(n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))[0]
    rows = []
    for r in ET.fromstring(z.read(sheet)).iter(NS + 'row'):
        d = {}
        for c in r.iter(NS + 'c'):
            v = c.find(NS + 'v')
            d[re.match(r'[A-Z]+', c.get('r')).group()] = '' if v is None else shared[int(v.text)] if c.get('t') == 's' else v.text
        rows.append(d)
    head = rows[0]
    return [{head[k]: r.get(k, '') for k in head} for r in rows[1:] if r.get('A')]
def day(serial):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(serial)))
path = slurp.latest_list_path()
out['file'] = path.name
raw = cells(path)
mapped = {r['Report ID']: r for r in slurp.list_rows(path)}
out['listCount'] = len(raw)

# (1) The mapping onto NHTSA's columns.
WX = ('Clear', 'Rain', 'Cloudy', 'Partly Cloudy')
BLANK = ('Incident Time (24:00)', 'SV Pre-Crash Movement', 'CP Pre-Crash Movement', 'Were All Passengers Belted?', 'Report Submission Date')
problems = []
for c in raw:
    rid = c['report_id']
    m = mapped.get(rid)
    if m is None:
        problems.append(rid + ': no mapped row'); continue
    want = {'Incident Date': day(c['incident_date_local']).strftime('%b-%Y').upper(), 'City': c['city'], 'State': c['state'],
            'Roadway Type': c['roadway_type'], 'Crash With': c['crash_with'],
            'Highest Injury Severity Alleged': c['highest_injury_severity_alleged'],
            'SV Precrash Speed (MPH)': str(int(float(c['subject_vehicle_pre_crash_speed (MPH)']))),
            'Narrative': c['narrative'], 'Reporting Entity': L['entity'], 'Report Type': slurp.PREPRINT_REPORT_TYPE}
    problems += [f'{rid} {k}: {m.get(k)!r}, the list says {v!r}' for k, v in want.items() if m.get(k) != v]
    wx = {w: m.get('Weather - ' + w) for w in WX}
    if wx != {w: ('Y' if w == c['weather'] else '') for w in WX}:
        problems.append(f'{rid} weather: {wx}, the list says {c["weather"]!r}')
    for cell, prefix in (('subject_vehicle_damage_area', 'SV Contact Area'), ('crash_partner_damage_area', 'CP Contact Area')):
        labels = [] if c[cell].strip() in ('N/A', '') else [x.strip() for x in c[cell].split(',')]
        want_areas = ' + '.join(l.lower() for l in slurp.CONTACT_AREA_LABELS if l in labels)
        if slurp._contact_areas(m, prefix) != want_areas or not set(labels) <= set(slurp.CONTACT_AREA_LABELS):
            problems.append(f'{rid} {prefix}: {slurp._contact_areas(m, prefix)!r}, the list says {c[cell]!r}')
    if ('Yes' in m.get('Any Air Bags Deployed?', '')) != ('Yes' in c['air_bags_deployed']):
        problems.append(f'{rid} airbags: {m.get("Any Air Bags Deployed?")!r}, the list says {c["air_bags_deployed"]!r}')
    problems += [f'{rid} {k}: {m.get(k)!r}, which the list does not give' for k in BLANK if m.get(k) != '']
out['mapping'] = problems
out['afterDate'] = sorted(c['report_id'] for c in raw if day(c['incident_date_local']).isoformat() > L['through'])

# (2) The list against NHTSA: some filed version of each shared report agrees.
versions = collections.defaultdict(list)
for r in ROWS: versions[r['Report ID']].append(r)
def norm(t):
    t = t.replace(' ', ' ').strip()
    if t.startswith('[') and t.endswith(']'): t = t[1:-1]
    return re.sub(r'\s+', ' ', t).strip().rstrip('.').strip()
def same_text(nhtsa, listed):
    pattern = '.+?'.join(re.escape(part) for part in norm(nhtsa).split('[XXX]'))
    return re.fullmatch(pattern, norm(listed)) is not None
SHARED = ('Incident Date', 'City', 'State', 'Roadway Type', 'Crash With', 'Highest Injury Severity Alleged',
          'SV Precrash Speed (MPH)') + tuple('Weather - ' + w for w in WX)
def close_text(nhtsa, listed):
    return difflib.SequenceMatcher(None, norm(nhtsa).split(), norm(listed).split()).ratio() >= 0.9
def differences(n, m, same):
    d = [f for f in SHARED if n[f].strip() != m[f].strip()]
    d += [p for p in ('SV Contact Area', 'CP Contact Area') if slurp._contact_areas(n, p) != slurp._contact_areas(m, p)]
    d += ['Any Air Bags Deployed?'] if ('Yes' in n['Any Air Bags Deployed?']) != ('Yes' in m['Any Air Bags Deployed?']) else []
    d += [] if same(n['Narrative'], m['Narrative']) else ['Narrative']
    return d
shared, unfaithful, reworded = 0, {}, []
for rid, m in mapped.items():
    if rid not in versions: continue
    shared += 1
    diffs = [differences(n, m, lambda a, b: same_text(a, b) or close_text(a, b)) for n in versions[rid]]
    if all(diffs): unfaithful[rid] = min(diffs, key=len)
    if all(differences(n, m, same_text) for n in versions[rid]): reworded.append(rid)
out['shared'] = shared; out['unfaithful'] = unfaithful; out['reworded'] = sorted(reworded)

# (1) Which rows are preprints, and NHTSA's row standing.
nhtsa_ids = {r['Report ID'] for r in ROWS}
pre = slurp.preprint_rows(ROWS)
out['preprints'] = sorted(r['Report ID'] for r in pre)
out['wantPreprints'] = sorted(set(mapped) - nhtsa_ids)
out['reportRows'] = [len(slurp.newest_report_rows()), len(ROWS) + len(pre)]
# The newest list row NHTSA has published word for word: the synthetic preprint's source.
published = sorted((rid for rid in mapped if rid in versions and rid not in reworded),
                   key=lambda rid: day(next(c for c in raw if c['report_id'] == rid)['incident_date_local']))
source = published[-1]

# (4) The stops, each on a copy of one list row or one patched constant.
def stop(fn, **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try: fn(); return ''
    except AssertionError as e: return str(e)[:400]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
listed_cells = slurp.read_list_cells(path)
base = dict(listed_cells[-1])
speed = 'subject_vehicle_pre_crash_speed (MPH)'
after = str(int(float(base['incident_date_local'])) + 400)
out['stops'] = {
    'none': stop(lambda: slurp.list_row(base)),
    'weather': stop(lambda: slurp.list_row(dict(base, weather='Hail'))),
    'area': stop(lambda: slurp.list_row(dict(base, subject_vehicle_damage_area='Front, Roof'))),
    'speed': stop(lambda: slurp.list_row(dict(base, **{speed: '2.5'}))),
    'missingColumn': stop(lambda: slurp.list_row({k: v for k, v in base.items() if k != 'weather'})),
    'extraColumn': stop(lambda: slurp.list_row(dict(base, operator='None'))),
    'afterDate': stop(lambda: slurp.list_row(dict(base, incident_date_local=after))),
    'fileName': stop(lambda: slurp.list_rows(path), PREPRINT_LIST=dict(L, through='2031-01-09')),
    'reportIds': stop(lambda: slurp.list_rows(path), TESLA_NO_MONITOR_REPORTS=frozenset(sorted(slurp.TESLA_NO_MONITOR_REPORTS)[1:])),
}
# A report on the list, reviewed instead as a no-monitor addition or as
# monitor-aboard (its Report ID taken out of the list's set)
on_list = sorted(slurp.TESLA_NO_MONITOR_REPORTS)[0]
off_list = slurp.TESLA_NO_MONITOR_REPORTS - {on_list}
out['stops']['moveIt'] = stop(lambda: slurp.list_rows(path), TESLA_NO_MONITOR_REPORTS=off_list,
                              TESLA_NO_MONITOR_ADDITIONS={**slurp.TESLA_NO_MONITOR_ADDITIONS,
                                                          on_list: ('reviewed words', slurp.NHTSA_DATA_THROUGH_DATE)})
out['stops']['aboardListed'] = stop(lambda: slurp.list_rows(path), TESLA_NO_MONITOR_REPORTS=off_list,
                                    TESLA_MONITOR_ABOARD_REPORTS={**slurp.TESLA_MONITOR_ABOARD_REPORTS, on_list: 'reviewed words'})
out['onList'] = on_list
synth_cells = dict(next(c for c in listed_cells if c['report_id'] == source), report_id='13781-99999')
synth_ids = slurp.TESLA_NO_MONITOR_REPORTS | {'13781-99999'}
# (Until 2026-11-20 DERIVED_SERIES_REPORTS, which held a copy of the line's
# members, was patched too; it reads TESLA_NO_MONITOR_REPORTS when called now.)
with_synth = dict(read_list_cells=lambda p: listed_cells + [synth_cells], TESLA_NO_MONITOR_REPORTS=synth_ids)
before_month = slurp.month_shift(day(synth_cells['incident_date_local']).strftime('%Y-%m'), -1) + '-15'
out['stops']['afterNhtsa'] = stop(lambda: slurp.preprint_rows(ROWS), NHTSA_DATA_THROUGH_DATE=before_month, **with_synth)

# (3) Coverage: the list's candidate, and which candidate a row takes.
vmt_values = slurp.parse_vmt_values(slurp.read_vmt_master())
month = L['through'][:7]
lines = sorted(s for s, c in slurp.SERIES_COMPANY.items() if c == company)
out['lines'] = lines
out['rowMiles'] = {s: vmt_values.get((s, month)) for s in lines}
out['coverage'] = {s + '|' + m: [list(v[0]), list(v[1]), v[2]] for (s, m), v in slurp.preprint_coverage(vmt_values).items()}
out['arrivals'] = [list(v) for v in slurp.MONTHLY_ARRIVAL_OBSERVATIONS[company].values()]
out['stops']['miles'] = stop(lambda: slurp.preprint_coverage({key: 1000 for key in vmt_values}))
# Which source a line-month takes: one line with two months, the second the
# data-through month, and a list candidate for neither, for the data-through
# month, and for the month before it (which NHTSA's file completes).
MASTER = ('helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,rationale\n'
          'waymo,2031-01,100,100,90,110,90,110,r\nwaymo,2031-02,100,200,180,220,90,110,r\n')
def built(list_cov):
    sources = slurp.month_sources(slurp.parse_vmt_values(MASTER), '2031-02', list_cov)
    head, *rows = list(csv.reader(io.StringIO(slurp.build_vmt_csv(MASTER, sources, list_cov))))
    return {row[head.index('month')]: dict(zip(head, row)) for row in rows}
candidate = ((0.6, 0.6, 0.6), (0.9, 0.7, 1.0), '2031-02-18')
out['select'] = {
    'none': built({}),
    'listed': built({('Waymo', '2031-02'): candidate}),
    'complete': built({('Waymo', '2031-01'): ((0.6, 0.6, 0.6), (0.9, 0.7, 1.0), '2031-01-18')}),
}

# (1) A run with a synthetic preprint: a copy of the newest list row NHTSA has
# published word for word, under a Report ID NHTSA has not. Then NHTSA
# publishes it.
source_nhtsa = slurp.latest_filings(slurp.filed_incident_rows(ROWS))[source]
fault_lines = TEXT['faultfrac.csv'].rstrip('\n').split('\n')
fault_line = next(l for l in fault_lines if l.startswith(source + ','))
fault_text = '\n'.join(fault_lines + ['13781-99999' + fault_line[len(source):]]) + '\n'
stored = slurp.PASSENGER_OVERRIDE[source][1]
as_preprint = dict(with_synth, PASSENGER_OVERRIDE=dict(slurp.PASSENGER_OVERRIDE, **{'13781-99999': ('', stored)}))
run = run_main(fault_text=fault_text, **as_preprint)
out['synthRun'] = run['stop']
records = {r['reportId']: r for r in (run['incidents'] or [])}
out['synthRecord'] = records.get('13781-99999'); out['sourceRecord'] = records.get(source)
out['flagged'] = sorted(rid for rid, r in records.items() if 'preprint' in r)
out['flagValues'] = sorted({json.dumps(r['preprint']) for r in records.values() if 'preprint' in r})
official = clone(source_nhtsa, '13781-99999')
unreviewed = run_main(extra=[official], fault_text=fault_text, **as_preprint)
out['publishedUnreviewed'] = {'stop': unreviewed['stop'][:400], 'changed': unreviewed['changed']}
filed = source_nhtsa['Were All Passengers Belted?'].strip()
as_official = dict(with_synth, PASSENGER_OVERRIDE=dict(slurp.PASSENGER_OVERRIDE, **{'13781-99999': (filed, stored)}))
after_run = run_main(extra=[official], fault_text=fault_text, **as_official)
out['publishedRun'] = after_run['stop']
out['publishedRecord'] = {r['reportId']: r for r in (after_run['incidents'] or [])}.get('13781-99999')
out['sourceFiled'] = {'time': source_nhtsa['Incident Time (24:00)'].strip(), 'svMovement': source_nhtsa['SV Pre-Crash Movement'].strip()}
base_run = run_main()
out['baseline'] = base_run['stop']
out['baselineFlagged'] = sorted(r['reportId'] for r in (base_run['incidents'] or []) if 'preprint' in r)
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read Tesla's list through data/slurp.py and run its main() offline on the newest snapshots.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-2000)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

const undefinedNames = Object.entries(S.defined).filter(([, ok]) => !ok).map(([name]) => name);
assert.deepEqual(undefinedNames, [],
  `Replicata: look in data/slurp.py for the names that read a company's own list of crash reports (${API.join(", ")}).
Expectata: it defines each.
Resultata: it does not define ${JSON.stringify(undefinedNames)}.`);

// (1) The list's file and its mapping onto NHTSA's columns.
assert.ok(S.listCount > 0 && S.file.endsWith(S.list.through.replaceAll("-", "") + ".xlsx"),
  `Replicata: read the newest data/snapshots file of the list (slurp.latest_list_path()).
Expectata: a spreadsheet with rows, named for the date the list runs through (PREPRINT_LIST's through, ${S.list.through}).
Resultata: ${S.file}, ${S.listCount} rows.`);
assert.deepEqual(S.mapping, [],
  `Replicata: read the list with this qual's own spreadsheet reader and compare each row with slurp.list_rows()'s row for the same Report ID.
Expectata: the month of the list's date, its place, road, crash partner, severity, speed and narrative as the list gives them, its weather as the one matching "Weather - ..." column, its contact areas as NHTSA's Y columns, its airbag text, the list's company as Reporting Entity, PREPRINT_REPORT_TYPE as Report Type, and blanks for what the list does not give (time, both pre-crash movements, the belt field, the submission month).
Resultata: ${JSON.stringify(S.mapping.slice(0, 12), null, 1)}${S.mapping.length > 12 ? ` and ${S.mapping.length - 12} more` : ""}.`);
assert.deepEqual(S.afterDate, [],
  `Replicata: compare each list row's date with the date the list runs through (${S.list.through}).
Expectata: none later.
Resultata: ${JSON.stringify(S.afterDate)}.`);

// (2) The list has agreed with NHTSA on every report both hold.
assert.deepEqual(S.unfaithful, {},
  `Replicata: for each list row whose report NHTSA's newest snapshots hold (${S.shared} of ${S.listCount}), compare it with each filed version of that report.
Expectata: some version agrees on month, city, state, road type, weather, crash partner, severity, speed, airbags and both contact areas, and its narrative is the list's: word for word (NHTSA's "[XXX]" standing for anything; a wrapping pair of brackets, runs of whitespace and a final period ignored) or at least nine words in ten in order.
Resultata: no version agrees for ${JSON.stringify(S.unfaithful, null, 1)} (the fields named are those of the closest version).`);

// (1) Preprints are exactly the list's rows NHTSA lacks; NHTSA's row stands.
assert.deepEqual(S.preprints, S.wantPreprints,
  `Replicata: call slurp.preprint_rows() on the newest snapshots' rows.
Expectata: the list's rows whose Report ID no NHTSA row has: ${JSON.stringify(S.wantPreprints)}.
Resultata: ${JSON.stringify(S.preprints)}.`);
assert.equal(S.reportRows[0], S.reportRows[1],
  `Replicata: count slurp.newest_report_rows().
Expectata: the newest snapshots' rows plus the preprints (${S.reportRows[1]}).
Resultata: ${S.reportRows[0]}.`);

// (4) The stops.
const stopWants = {
  weather: /weather/i, area: /contact area/i, speed: /speed/i, missingColumn: /column/i, extraColumn: /column/i,
  afterDate: /after|later|through/i, fileName: /name|date/i, reportIds: /TESLA_NO_MONITOR_REPORTS/, afterNhtsa: /data-through/i,
  miles: /miles/i, moveIt: /move.*TESLA_NO_MONITOR_ADDITIONS/is, aboardListed: /TESLA_MONITOR_ABOARD_REPORTS/,
};
const stopProblems = Object.entries(stopWants)
  .filter(([name, want]) => !want.test(S.stops[name]) || (["moveIt", "aboardListed"].includes(name) && !S.stops[name].includes(S.onList)))
  .map(([name]) => `${name}: ${S.stops[name] === "" ? "no stop" : JSON.stringify(S.stops[name].slice(0, 160))}`);
assert.ok(S.stops.none === "" && stopProblems.length === 0,
  `Replicata: give data/slurp.py a list it cannot read as described, one fault at a time: a weather value NHTSA's four columns lack ("Hail"), a contact area outside CONTACT_AREA_LABELS ("Roof"), a speed of 2.5, a row missing a column, a row with a column the list does not have, a crash dated after the list's date, a file not named for the list's date, Report IDs differing from TESLA_NO_MONITOR_REPORTS, a preprint dated after NHTSA's data-through month, list miles above a row's own miles, and a list holding a report (${S.onList}) reviewed as a no-monitor addition, then as monitor-aboard.
Expectata: each stops the run and says what is wrong; the unchanged row stops nothing.
Resultata: the unchanged row ${S.stops.none === "" ? "passes" : "stops: " + JSON.stringify(S.stops.none.slice(0, 160))}; ${JSON.stringify(stopProblems, null, 1)}.`);

// (3) Coverage: the list's candidate.
const round4 = x => Math.round(x * 1e4) / 1e4;
const near = (a, b) => Math.abs(a - b) < 5e-5;
const measured = S.arrivals.filter(a => a.length === 2);
const onTime = measured.reduce((s, a) => s + a[0], 0), all = measured.reduce((s, a) => s + a[0] + a[1], 0);
const share = onTime / all, z = 1.96;
const wilsonLow = (share + z * z / (2 * all) - z * Math.sqrt(share * (1 - share) / all + z * z / (4 * all * all))) / (1 + z * z / all);
const listMonth = S.list.through.slice(0, 7);
const pagePart = TESLA_PAGE_PART[listMonth];
assert.ok(pagePart !== undefined && pagePart.through === S.list.through && pagePart.miles === S.list.miles,
  `Replicata: compare data/slurp.py's PREPRINT_LIST, the date the list runs through and the company's no-monitor miles of that month through that date, with Tesla's page's figure for the list's month in quals/tesla-page-part.mjs (TESLA_PAGE_PART).
Expectata: the same date and the same miles: the list's miles set the coverage of the month the list covers, and Tesla's page is their source (a new list takes both edits: data/README.md, Each NHTSA release, step 7).
Resultata: PREPRINT_LIST runs through ${S.list.through} with ${S.list.miles} miles; the page's entry for ${listMonth} is ${JSON.stringify(pagePart)}.`);
const coverageProblems = [];
for (const line of S.lines) {
  const got = S.coverage[`${line}|${listMonth}`], c = S.list.miles / S.rowMiles[line];
  if (!got) { coverageProblems.push(`${line}: no candidate`); continue; }
  const [receipt, incident, through] = got;
  if (!receipt.every(v => near(v, round4(c)))) coverageProblems.push(`${line} receipt coverage ${JSON.stringify(receipt)}, want ${round4(c)} three times (${S.list.miles} of ${S.rowMiles[line]} miles)`);
  if (!(near(incident[0], share) && near(incident[1], wilsonLow) && incident[2] === 1)) coverageProblems.push(`${line} incident coverage ${JSON.stringify(incident)}, want [${round4(share)}, ${round4(wilsonLow)}, 1] (${onTime} of ${all} Monthly reports on time)`);
  if (through !== S.list.through) coverageProblems.push(`${line} date ${through}, want ${S.list.through}`);
}
if (Object.keys(S.coverage).length !== S.lines.length) coverageProblems.push(`candidates for ${JSON.stringify(Object.keys(S.coverage))}, want one per line of the list's company (${S.lines.join(", ")}) in ${listMonth}`);
assert.ok(all > 0 && coverageProblems.length === 0,
  `Replicata: call slurp.preprint_coverage() with data/vmt.csv's miles.
Expectata: for ${listMonth}, one candidate per line of the list's company: receipt coverage = the list's miles over the row's miles, three times over (the list reaches its date and no further); Monthly-track incident coverage = the company's on-time share of Monthly reports over MONTHLY_ARRIVAL_OBSERVATIONS' months with both counts (${onTime} of ${all}), its Wilson 95% lower bound, and 1; and the list's date.
Resultata: ${JSON.stringify(coverageProblems, null, 1)}.`);

// (3) Which source a line-month takes.
const cells = r => r === undefined ? "no row" : [r.coverage, r.coverage_min, r.coverage_max, r.incident_coverage, r.incident_coverage_min, r.incident_coverage_max, r.incidents_through].join(" ");
const completePick = `1 1 1 1 1 1 ${S.dataThrough}`;
const picked = name => [cells(S.select[name]["2031-01"]), cells(S.select[name]["2031-02"])];
assert.ok(JSON.stringify(picked("none")) === JSON.stringify([completePick, "no row"])
    && JSON.stringify(picked("listed")) === JSON.stringify([completePick, "0.6 0.6 0.6 0.9 0.7 1.0 2031-02-18"])
    && JSON.stringify(picked("complete")) === JSON.stringify([completePick, "no row"]),
  `Replicata: call slurp.month_sources() and slurp.build_vmt_csv() on one line with rows for 2031-01 and 2031-02, the data-through month 2031-02: with no list candidate, with one for 2031-02 (0.6 three times, 0.9 [0.7, 1], through 2031-02-18), and with one for 2031-01.
Expectata: 2031-01, which NHTSA's file completes, is a complete row (every coverage value 1, NHTSA's receipt cutoff ${S.dataThrough} as its incidents_through) in all three, whatever a list says of it; 2031-02 has a row only with its list candidate, the candidate's coverage and date.
Resultata: none ${JSON.stringify(picked("none"))}, listed ${JSON.stringify(picked("listed"))}, complete ${JSON.stringify(picked("complete"))}.`);

// (3) data/vmt.js as generated: every row's coverage and date.
const dataCtx = vm.createContext({});
vm.runInContext(dataScript, dataCtx);
const [vmtHead, ...vmtBody] = parseCsv(vm.runInContext("VMT_CSV_TEXT", dataCtx).trim());
const vmtRowsNow = vmtBody.map(r => Object.fromEntries(vmtHead.map((h, i) => [h, r[i]])));
const canon = Object.fromEntries(S.lines.map(l => [l.toLowerCase(), l]));
const dataThroughMonth = S.dataThrough.slice(0, 7);
const rowProblems = [];
for (const r of vmtRowsNow) {
  const line = canon[r.helmer.toLowerCase()];
  // The list's candidate stands where NHTSA's file is not complete: at or
  // after the data-through month (before it, the file's complete row).
  const cand = line && r.month >= dataThroughMonth ? S.coverage[`${line}|${r.month}`] : undefined;
  const want = cand ? [...cand[0], ...cand[1], cand[2]] : [1, 1, 1, 1, 1, 1, S.dataThrough];
  const got = [r.coverage, r.coverage_min, r.coverage_max, r.incident_coverage, r.incident_coverage_min, r.incident_coverage_max].map(Number);
  if (!(got.every((v, i) => near(v, want[i])) && r.incidents_through === want[6])) rowProblems.push(`${r.helmer} ${r.month}: ${got.join(" ")} ${r.incidents_through}, want ${want.join(" ")}`);
}
const listedNow = vmtRowsNow.filter(r => r.incidents_through !== S.dataThrough || Number(r.incident_coverage_min) !== 1).map(r => `${r.helmer} ${r.month}`);
const wantListed = Object.keys(S.coverage).filter(k => k.split("|")[1] >= dataThroughMonth).map(k => `${k.split("|")[0].toLowerCase()} ${k.split("|")[1]}`);
assert.ok(vmtHead.includes("incidents_through") && rowProblems.length === 0 && JSON.stringify(listedNow.sort()) === JSON.stringify(wantListed.sort()),
  `Replicata: read data/vmt.js's analysis rows.
Expectata: an incidents_through column; each line of the list's company has, in the list's month (${listMonth}) where NHTSA's file is not complete for it (the data-through month is ${dataThroughMonth}), the list's coverage and date; every other row is complete (every coverage value 1) with NHTSA's receipt cutoff (${S.dataThrough}) as its incidents_through; the rows on a list's coverage are exactly ${JSON.stringify(wantListed)}.
Resultata: columns ${JSON.stringify(vmtHead)}; rows on a list's coverage ${JSON.stringify(listedNow)}; ${JSON.stringify(rowProblems.slice(0, 10), null, 1)}.`);

// (1) A run with a synthetic preprint, then NHTSA publishing it.
const P = S.synthRecord, src = S.sourceRecord;
const copied = ["helmer", "date", "city", "state", "road", "crashWith", "severity", "speed", "narrative", "airbagAny", "svHit", "cpHit",
  "wxClear", "wxRain", "wxCloudy", "wxPartlyCloudy"];
// A narrative is compared as the list check compares it: runs of whitespace and a final period aside.
const plain = v => typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/\.$/, "") : v;
const differs = P && src ? copied.filter(f => JSON.stringify(plain(P[f])) !== JSON.stringify(plain(src[f]))) : ["(no record)"];
assert.ok(S.synthRun === "" && P && P.preprint === true && P.time === "" && P.svMovement === "" && P.cpMovement === "" && differs.length === 0,
  `Replicata: run slurp.main() offline with one more row on the list: a copy of the newest list row NHTSA has published word for word, under the Report ID 13781-99999, which no NHTSA file has (with its passenger entry and fault row).
Expectata: the run completes and writes a record for 13781-99999 with preprint true, the fields the list gives equal to the published report's record (${copied.join(", ")}), and blanks for the time and both pre-crash movements.
Resultata: ${S.synthRun === "" ? "completed" : "stopped: " + JSON.stringify(S.synthRun.slice(0, 300))}; record ${JSON.stringify(P && { preprint: P.preprint, time: P.time, svMovement: P.svMovement, cpMovement: P.cpMovement })}; differing fields ${JSON.stringify(differs)}.`);
assert.ok(S.flagged.length === S.wantPreprints.length + 1 && S.flagged.includes("13781-99999") && S.wantPreprints.every(rid => S.flagged.includes(rid)) && S.flagValues.join() === "true",
  `Replicata: in that run's records, list those with a preprint key.
Expectata: the synthetic preprint and the list's rows NHTSA lacks (${JSON.stringify(S.wantPreprints)}), each with the value true; no other record has the key.
Resultata: ${JSON.stringify(S.flagged)}, values ${JSON.stringify(S.flagValues)}.`);
assert.ok(/PASSENGER_OVERRIDE/.test(S.publishedUnreviewed.stop) && S.publishedUnreviewed.stop.includes("13781-99999") && S.publishedUnreviewed.changed.length === 0,
  `Replicata: run slurp.main() offline again with NHTSA's files now holding 13781-99999 (the published report's own filing under that Report ID), its PASSENGER_OVERRIDE entry still the one reviewed against the list's blank belt field.
Expectata: NHTSA's row stands, so the run stops for the entry to be re-read against the filed value, naming PASSENGER_OVERRIDE and the report, and writes nothing.
Resultata: ${S.publishedUnreviewed.stop === "" ? "completed" : JSON.stringify(S.publishedUnreviewed.stop.slice(0, 300))}; rewrote ${JSON.stringify(S.publishedUnreviewed.changed)}.`);
const O = S.publishedRecord;
assert.ok(S.publishedRun === "" && O && !("preprint" in O) && O.time === S.sourceFiled.time && O.svMovement === S.sourceFiled.svMovement && O.time !== "",
  `Replicata: the same run with the entry re-read against NHTSA's filed value.
Expectata: the run completes; the record of 13781-99999 comes from NHTSA's row (its time ${JSON.stringify(S.sourceFiled.time)}, its pre-crash movement ${JSON.stringify(S.sourceFiled.svMovement)}) and has no preprint key.
Resultata: ${S.publishedRun === "" ? "completed" : "stopped: " + JSON.stringify(S.publishedRun.slice(0, 300))}; record ${JSON.stringify(O && { preprint: O.preprint, time: O.time, svMovement: O.svMovement })}.`);

// (1) The data as generated.
vm.runInContext("var __records = INCIDENT_DATA;", dataCtx);
const live = JSON.parse(JSON.stringify(vm.runInContext("__records", dataCtx)));
const liveFlagged = live.filter(r => "preprint" in r).map(r => r.reportId).sort();
assert.ok(S.baseline === "" && JSON.stringify(S.baselineFlagged) === JSON.stringify(S.wantPreprints) && JSON.stringify(liveFlagged) === JSON.stringify(S.wantPreprints)
    && live.filter(r => "preprint" in r).every(r => r.preprint === true),
  `Replicata: run slurp.main() offline on the newest snapshots, and read data/incidents.js.
Expectata: the run completes, and in both the records with preprint true are the list's rows NHTSA lacks (${JSON.stringify(S.wantPreprints)}); no other record has the key.
Resultata: ${S.baseline === "" ? "completed" : "stopped: " + JSON.stringify(S.baseline.slice(0, 300))}; the run's ${JSON.stringify(S.baselineFlagged)}; data/incidents.js's ${JSON.stringify(liveFlagged)}.`);

// (5) The page.
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this._html = ""; this.className = ""; this.classList = { toggle() { return false; } }; }
  set textContent(v) { this._html = esc(v); }
  get textContent() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  addEventListener() {}
  setAttribute() {}
  querySelector() { return new El("td"); }
}
const nodes = new Map();
const app = vm.createContext({ console, Math, document: {
  getElementById: id => nodes.get(id) || (nodes.set(id, new El("div")), nodes.get(id)),
  createElement: tag => new El(tag), activeElement: new El("body") } });
vm.runInContext(dataScript, app, { filename: "data.js" });
vm.runInContext(appScript, app, { filename: "crashla.js" });
const appRun = expr => JSON.parse(JSON.stringify(vm.runInContext(expr, app) ?? null));

// The parsed rows carry the date, and a row without one stops the page.
const parsed = appRun(`(() => { const rows = parseVmtCsv(VMT_CSV_TEXT); return {n: rows.length, dates: [...new Set(rows.map(r => r.through))]}; })()`);
const wantDates = [...new Set(vmtRowsNow.map(r => r.incidents_through))];
const badDate = appRun(`(() => { try { parseVmtCsv(VMT_CSV_TEXT.replace(/,(\\d{4}-\\d{2}-\\d{2}),/, ",soon,")); return ""; } catch (e) { return String(e.message).slice(0, 200); } })()`);
assert.ok(parsed.n === vmtRowsNow.length && JSON.stringify(parsed.dates.sort()) === JSON.stringify(wantDates.sort()) && badDate !== "",
  `Replicata: parse data/vmt.js's rows with crashla.js's parseVmtCsv, then again with one row's incidents_through replaced by "soon".
Expectata: each parsed row carries its date as "through" (${JSON.stringify(wantDates)}); the bad date stops the page.
Resultata: ${parsed.n} rows with dates ${JSON.stringify(parsed.dates)}; the bad date ${badDate === "" ? "parsed" : "stopped: " + JSON.stringify(badDate)}.`);

// A partial month's note names the row's own date.
const notes = appRun(`(() => {
  incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT); faultData = buildFaultDataFromIncidents(INCIDENT_DATA);
  const full = monthSeriesData(), point = full.points[full.points.length - 1];
  const live = ADS_SERIES.filter(h => point.helmers[h]).map(h => ({helmer: h, through: point.helmers[h].through, note: partialCountLine(point.helmers[h], false)}));
  const synthetic = partialCountLine({coverage: 0.5, coverageMin: 0.5, incCov: 0.9, incCovMin: 0.7, through: "2031-01-09"}, false);
  return {live, synthetic, month: point.month};
})()`);
const noteProblems = notes.live.filter(n => !(n.note.includes(n.through) && wantDates.filter(d => d !== n.through).every(d => !n.note.includes(d))))
  .map(n => `${n.helmer}: date ${n.through}, note ${JSON.stringify(n.note)}`);
const wantThrough = Object.fromEntries(vmtRowsNow.filter(r => r.month === notes.month).map(r => [r.helmer.toLowerCase(), r.incidents_through]));
const throughProblems = notes.live.filter(n => n.through !== wantThrough[n.helmer.toLowerCase()]).map(n => `${n.helmer}: ${n.through}, data/vmt.js says ${wantThrough[n.helmer.toLowerCase()]}`);
assert.ok(notes.live.length > 0 && noteProblems.length === 0 && throughProblems.length === 0
    && notes.synthetic.includes("2031-01-09") && notes.synthetic.includes("45%") && notes.synthetic.includes("35%"),
  `Replicata: for each line's row of the newest analysis month (${notes.month}), read the note under its incident count (partialCountLine); and call it on a made-up row received 50% with incident coverage 0.9 [0.7], through 2031-01-09.
Expectata: each note names its own row's date, as data/vmt.js gives it, and no other row's; the made-up row's note names 2031-01-09, 45% and 35%.
Resultata: ${JSON.stringify([...noteProblems, ...throughProblems], null, 1)}; the made-up row's note ${JSON.stringify(notes.synthetic)}.`);

// The incident browser marks a preprint's row.
const sample = live.find(r => r.helmer === "Tesla" && !("preprint" in r) && r.secondOf === undefined);
app.SAMPLE = [sample, { ...sample, reportId: "13781-99999", preprint: true }];
vm.runInContext(`
incidents = SAMPLE;
faultData = buildFaultDataFromIncidents(incidents);
vmtRows = [{helmer: "Tesla", month: "2025-07", vmtMin: 1, vmtBest: 1, vmtMax: 1}];
activeSeries = { months: ["2025-07"] };
renderTable();
`, app);
const label = vm.runInContext("typeof PREPRINT_LABEL === 'string' ? PREPRINT_LABEL : null", app);
const trs = nodes.get("incidents-body").children;
const shown = trs.map(tr => (tr.innerHTML.match(/<span id="narr-text-[^"]*">([^<]*)/) || [])[1] ?? null);
const classes = trs.map(tr => tr.className.trim());
const css = fs.readFileSync("style.css", "utf8");
const styled = classes[1] !== undefined && classes[1] !== "" && classes[1].split(/\s+/).some(c => new RegExp(`tr\\.${c}\\b`).test(css));
assert.ok(label && label.trim() !== "" && shown.length === 2 && shown[0] === esc(sample.narrative) && shown[1] === esc(label) + " " + esc(sample.narrative)
    && classes[0] === "" && styled,
  `Replicata: render the incident browser's rows for a Tesla record and for a copy of it marked preprint.
Expectata: the record's row is as before (no class, its narrative alone); the preprint's row has a class that style.css styles on a table row, and its narrative leads with PREPRINT_LABEL.
Resultata: label ${JSON.stringify(label)}; classes ${JSON.stringify(classes)}, styled ${styled}; narrative spans start ${JSON.stringify(shown.map(s => s && s.slice(0, 50)))}.`);

console.log(`qual pass: ${S.listCount} list rows map onto NHTSA's columns, ${S.shared} agree with NHTSA's own filings (${S.shared - S.reworded.length} word for word${S.reworded.length ? `; reworded: ${S.reworded.join(", ")}` : ""}), ${S.wantPreprints.length} are preprints in the data and the page marks them; a preprint turns official when NHTSA files it; the list's coverage (${round4(share)} of Monthly reports on time, ${JSON.stringify(Object.fromEntries(S.lines.map(l => [l, round4(S.list.miles / S.rowMiles[l])])))} of ${listMonth}'s miles) is data/vmt.js's coverage of the list's month where NHTSA's file is not complete (${JSON.stringify(wantListed)})`);

// The airbag tripwire (2026-11-21, audit finding A7 of 2026-11-20). The page
// counts an airbag deployment in any vehicle (airbagAny), read from NHTSA's
// "Any Air Bags Deployed?" and, where a narrative states a deployment the
// field does not mark, from a reviewed AIRBAG_OVERRIDE entry (the 2026-08-22
// convention; the sources are NHTSA's field and the report's own narrative,
// for every company: the human, 2026-11-21). Until now nothing read a new
// narrative for this: 30270-17130 (OCT-2026, Austin) came in saying it was
// reported "because a vehicle involved was towed away and because of airbag
// deployment", 30270-9767's sentence, and was stored with no airbag. So
// data/slurp.py stops (check_airbag_classified) on an in-scope incident whose
// narrative mentions an airbag (AIRBAG_PATTERN) while its filed value marks no
// deployment (it holds no "Yes"), until its crash's report is in
// AIRBAG_OVERRIDE (the narrative says one deployed) or in
// AIRBAG_LANGUAGE_REVIEWED, with the narrative's words that show the filed
// value stands. Spec:
//  1. The pattern reads the forms the corpus writes ("airbag", "airbags",
//     "air bags") and "air-bag", in any case, and no narrative without one.
//  2. The check, on synthetic rows: a mention under a field with no "Yes"
//     stops, naming the crash's report; it passes with "Yes" in the field,
//     with no mention, and when the crash's report is in either table (a
//     second AV's row is read under its crash's Report ID).
//  3. Calibration, on the data: among the in-scope incidents of the newest
//     files (their latest filings, the preprints among them) the reports the
//     tripwire would stop on, were none listed, are exactly the reports of
//     the two tables (so nothing is unclassified, and no entry is one the
//     tripwire no longer needs); and over every filing of an in-scope report
//     in every file of data/snapshots, each one it would stop on is of a
//     report in the two tables or out of every metric (TELEOP_DRIVEN_REPORTS).
//  4. main() runs it, before anything is written: a copy of a filed report
//     whose narrative gains the sentence, under a field with no "Yes", stops
//     the run naming the copy; with "Yes" in the field it completes, counted
//     as an airbag crash; with an AIRBAG_OVERRIDE entry it completes, counted;
//     with an AIRBAG_LANGUAGE_REVIEWED entry quoting its narrative it
//     completes, not counted; and with an entry whose words the narrative
//     lacks it stops (the reviewed quotes' stop, as for every quoting table:
//     quals/override-guards.qual.mjs re-files a real entry's report).
// quals/field-overrides.qual.mjs pins the stored airbag records.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

// Unchanged code has none of the three names; say so before the prelude,
// whose template() calls the check.
const probe = spawnSync("python3", ["-B", "-c", String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location('slurp_airbag', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
print(json.dumps([n for n in ('AIRBAG_PATTERN', 'AIRBAG_LANGUAGE_REVIEWED', 'check_airbag_classified') if not hasattr(slurp, n)]))
`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(probe.status, 0, `Replicata: load data/slurp.py. Expectata: it loads. Resultata: exit ${probe.status}; ${probe.stderr.slice(-800)}`);
const missing = JSON.parse(probe.stdout.trim().split("\n").at(-1));
assert.deepEqual(missing, [],
  `Replicata: read data/slurp.py's airbag tripwire: AIRBAG_PATTERN, AIRBAG_LANGUAGE_REVIEWED and check_airbag_classified.
Expectata: all three (a narrative that mentions an airbag under a field that marks no deployment stops the run until it is read).
Resultata: data/slurp.py has no ${missing.join(", ")}.`);

const py = SLURP_OFFLINE_PY + String.raw`
def stop_of(fn, *a):
    try: fn(*a); return ''
    except AssertionError as e: return str(e)[:700]
out = {}
# 1. the pattern
out['matches'] = {s: slurp.AIRBAG_PATTERN.search(s) is not None for s in (
    'because a vehicle involved was towed away and because of airbag deployment.',
    "the SUV's airbags deployed as a result of the impact",
    'Air bags were not deployed and law enforcement was not called.',
    'AIRBAG DEPLOYMENT', 'the air-bag of the second car', 'the air  bag deployed')}
out['silent'] = {s: slurp.AIRBAG_PATTERN.search(s) is not None for s in (
    'The Waymo AV sustained damage.', 'A bag fell from the pickup truck into the lane.', 'The truck used its air brakes.',
    'Both vehicles were towed away.', '')}
# 2. the check, on synthetic rows
NO, YES = 'No Subject Vehicle, No Crash Partner', 'Yes Crash Partner, No Subject Vehicle'
SAID = 'Waymo is reporting this crash under Request No. 1 of Standing General Order 2021-01 because of airbag deployment.'
row = lambda field, narrative=SAID: {'Report ID': 'synthetic-row', 'Narrative': narrative, 'Any Air Bags Deployed?': field}
listed_override, listed_reviewed = min(slurp.AIRBAG_OVERRIDE), min(slurp.AIRBAG_LANGUAGE_REVIEWED)
out['check'] = {
    'mentionNo': stop_of(slurp.check_airbag_classified, row(NO), 'synthetic-row'),
    'mentionUnknown': stop_of(slurp.check_airbag_classified, row('Unknown'), 'synthetic-row'),
    'mentionBlank': stop_of(slurp.check_airbag_classified, row(''), 'synthetic-row'),
    'mentionYes': stop_of(slurp.check_airbag_classified, row(YES), 'synthetic-row'),
    'archiveYes': stop_of(slurp.check_airbag_classified, row('Yes'), 'synthetic-row'),
    'noMention': stop_of(slurp.check_airbag_classified, row(NO, 'Both vehicles sustained damage.'), 'synthetic-row'),
    'override': stop_of(slurp.check_airbag_classified, row(NO), listed_override),
    'reviewed': stop_of(slurp.check_airbag_classified, row(NO), listed_reviewed),
    # a second AV's row, read under its crash's report
    'secondListed': stop_of(slurp.check_airbag_classified, dict(row(NO), **{'Report ID': listed_override + slurp.SECOND_INVOLVEMENT_SUFFIX}), listed_override),
    'secondUnlisted': stop_of(slurp.check_airbag_classified, dict(row(NO), **{'Report ID': 'synthetic-row' + slurp.SECOND_INVOLVEMENT_SUFFIX}), 'synthetic-row'),
}
# 3. calibration. The newest files' in-scope incidents, as main() reads them
# (the preprints among them), each read as if no table listed it.
trips = lambda r: stop_of(slurp.check_airbag_classified, r, 'synthetic-probe') != ''
newest = slurp.filed_incident_rows(slurp.newest_report_rows())
incidents = list(slurp.public_service_incidents(newest).values())
flagged = sorted(r['Report ID'] for r in incidents if trips(r))
listed = sorted(set(slurp.AIRBAG_OVERRIDE) | set(slurp.AIRBAG_LANGUAGE_REVIEWED))
out['calibration'] = {'incidents': len(incidents), 'mention': sum(1 for r in incidents if slurp.AIRBAG_PATTERN.search(r['Narrative'])),
                      'flagged': flagged, 'listed': listed, 'both': sorted(set(slurp.AIRBAG_OVERRIDE) & set(slurp.AIRBAG_LANGUAGE_REVIEWED))}
# Every filing of an in-scope report in every saved ADS file (the current
# files, the two legacy ones, the archive files), parsed as slurp parses them.
paths = [*slurp.LEGACY_SNAPSHOT_PATHS['nhtsa-current'], *sorted(slurp.SNAPSHOT_DIR.glob('nhtsa-current-*.csv'))]
saved = []
for path in paths:
    with open(path, newline='', encoding='utf-8') as f:
        saved += [slurp._normalize_current_row(r) for r in csv.DictReader(f)]
for path in sorted(slurp.SNAPSHOT_DIR.glob('nhtsa-archive-*.csv')):
    with open(path, newline='', encoding='utf-8') as f:
        saved += slurp.archive_csv_rows(f.read())
def scoped(r):
    # an entry of OPERATOR_TYPE_OVERRIDE reviewed against another version's
    # operator type names a report the tables hold: read it
    try: return slurp.operator_in_scope(r)
    except AssertionError: return True
filings = [r for r in slurp.filed_incident_rows(saved) if r['Reporting Entity'].strip() in slurp.HELMER_SHORT and scoped(r)]
known = set(listed) | set(slurp.TELEOP_DRIVEN_REPORTS)
out['history'] = {'files': len(paths) + len(list(slurp.SNAPSHOT_DIR.glob('nhtsa-archive-*.csv'))), 'filings': len(filings),
                  'reports': len({r['Report ID'] for r in filings}),
                  'unknown': sorted({r['Report ID'] for r in filings if trips(r) and r['Report ID'] not in known})}
# 4. main()
t = template(slurp.NHTSA_DATA_THROUGH_DATE[:7])
fault_line = [l for l in TEXT['faultfrac.csv'].split('\n') if l.startswith(t['Report ID'] + ',')]
assert len(fault_line) == 1, ('one data/faultfrac.csv row for the template', t['Report ID'], len(fault_line))
rated = TEXT['faultfrac.csv'].rstrip('\n') + '\n' + 'synthetic-airbag' + fault_line[0][len(t['Report ID']):] + '\n'
said = t['Narrative'].rstrip() + ' ' + SAID
def run(field, **patch):
    res = run_main([clone(t, 'synthetic-airbag', Narrative=said, **{'Any Air Bags Deployed?': field})], fault_text=rated, **patch)
    stored = [r['airbagAny'] for r in (res['incidents'] or []) + (res['pending'] or []) if r['reportId'] == 'synthetic-airbag']
    return {'stop': res['stop'][:900], 'changed': res['changed'], 'stored': stored}
out['template'] = [t['Report ID'], t['Any Air Bags Deployed?'], slurp.AIRBAG_PATTERN.search(t['Narrative']) is not None]
out['main'] = {
    'unlisted': run(NO),
    'marked': run(YES),
    'overridden': run(NO, AIRBAG_OVERRIDE={**slurp.AIRBAG_OVERRIDE, 'synthetic-airbag': (NO, True)}),
    'asFiled': run(NO, AIRBAG_LANGUAGE_REVIEWED={**slurp.AIRBAG_LANGUAGE_REVIEWED, 'synthetic-airbag': SAID}),
    'misquoted': run(NO, AIRBAG_LANGUAGE_REVIEWED={**slurp.AIRBAG_LANGUAGE_REVIEWED, 'synthetic-airbag': 'No airbag deployed in either vehicle.'}),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: exercise data/slurp.py's airbag tripwire on synthetic rows, on the saved files and in main(), offline.
Expectata: the runs complete or stop with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1.
const unread = Object.entries(S.matches).filter(([, hit]) => !hit).map(([s]) => s);
const misread = Object.entries(S.silent).filter(([, hit]) => hit).map(([s]) => s);
assert.deepEqual({ unread, misread }, { unread: [], misread: [] },
  `Replicata: search AIRBAG_PATTERN in sentences that mention an airbag ("airbag", "airbags", "Air bags", "AIRBAG", "air-bag", "air  bag") and in sentences that mention none.
Expectata: a match in each of the first and in none of the second.
Resultata: no match in ${JSON.stringify(unread)}; a match in ${JSON.stringify(misread)}.`);

// 2.
const stops = ["mentionNo", "mentionUnknown", "mentionBlank", "secondUnlisted"];
const passes = ["mentionYes", "archiveYes", "noMention", "override", "reviewed", "secondListed"];
const silent = stops.filter(k => !(S.check[k].includes("synthetic-row") && /AIRBAG_OVERRIDE/.test(S.check[k]) && /AIRBAG_LANGUAGE_REVIEWED/.test(S.check[k]) && /Each NHTSA release, step 6/.test(S.check[k])));
const tripped = passes.filter(k => S.check[k] !== "");
assert.deepEqual({ silent, tripped }, { silent: [], tripped: [] },
  `Replicata: call check_airbag_classified on synthetic rows whose narrative says the crash was reported "because of airbag deployment": the field "No Subject Vehicle, No Crash Partner", "Unknown" or blank and the crash's report unlisted (also as a second AV's row); then "Yes Crash Partner, No Subject Vehicle" or the archive's "Yes"; a narrative with no mention; and the crash's report listed in AIRBAG_OVERRIDE or AIRBAG_LANGUAGE_REVIEWED (also as a second AV's row).
Expectata: the first four stop, naming the crash's report, both tables and step 6 of data/README.md's release checklist; the other six pass.
Resultata: passed without the stop: ${JSON.stringify(silent)}; stopped: ${JSON.stringify(Object.fromEntries(tripped.map(k => [k, S.check[k].slice(0, 200)])))}.`);

// 3.
const c = S.calibration;
assert.ok(c.incidents > 0 && c.mention >= c.flagged.length && c.both.length === 0 && JSON.stringify(c.flagged) === JSON.stringify(c.listed),
  `Replicata: over the newest files' ${c.incidents} in-scope incidents (latest filings, the preprints among them), list those whose narrative mentions an airbag under a field with no "Yes" (the tripwire's stop, were no report listed), and data/slurp.py's AIRBAG_OVERRIDE and AIRBAG_LANGUAGE_REVIEWED.
Expectata: the same reports (nothing unclassified, no entry the tripwire does not need), none in both tables.
Resultata: ${c.mention} narratives mention an airbag; the tripwire would stop on ${JSON.stringify(c.flagged)}; the tables list ${JSON.stringify(c.listed)}; in both: ${JSON.stringify(c.both)}.`);
assert.ok(S.history.filings > c.incidents && S.history.unknown.length === 0,
  `Replicata: over every filing of an in-scope Waymo, Tesla or Zoox report in every ADS file of data/snapshots (${S.history.files} files, ${S.history.filings} filings of ${S.history.reports} reports), list the reports the tripwire would stop on that are in neither airbag table nor in TELEOP_DRIVEN_REPORTS (out of every metric, their records never written).
Expectata: none: the pattern is calibrated on every saved narrative.
Resultata: ${JSON.stringify(S.history.unknown)}.`);

// 4.
const m = S.main;
assert.ok(S.template[2] === false || S.template[1].includes("Yes"),
  `Replicata: read the template filing this qual copies (${S.template[0]}).
Expectata: one the tripwire passes as filed (quals/slurp-offline.mjs template()).
Resultata: its field ${JSON.stringify(S.template[1])}, an airbag in its narrative: ${S.template[2]}.`);
assert.ok(m.unlisted.stop.includes("synthetic-airbag") && /AIRBAG_OVERRIDE/.test(m.unlisted.stop) && m.unlisted.changed.length === 0,
  `Replicata: run slurp.main() offline with one new in-scope report, a copy of ${S.template[0]} (rated) whose narrative gains "Waymo is reporting this crash ... because of airbag deployment." under the field "No Subject Vehicle, No Crash Partner".
Expectata: the run stops naming the copy and AIRBAG_OVERRIDE, and writes nothing.
Resultata: ${m.unlisted.stop === "" ? `completed, storing airbagAny ${JSON.stringify(m.unlisted.stored)}` : JSON.stringify(m.unlisted.stop.slice(0, 300))}; rewrote ${JSON.stringify(m.unlisted.changed)}.`);
for (const [name, want, what] of [
  ["marked", true, 'the field "Yes Crash Partner, No Subject Vehicle"'],
  ["overridden", true, 'the field "No Subject Vehicle, No Crash Partner" and an AIRBAG_OVERRIDE entry for the copy (reviewed against that value, deployed)'],
  ["asFiled", false, 'the field "No Subject Vehicle, No Crash Partner" and an AIRBAG_LANGUAGE_REVIEWED entry quoting the copy\'s narrative'],
]) {
  assert.ok(m[name].stop === "" && JSON.stringify(m[name].stored) === JSON.stringify([want]),
    `Replicata: run slurp.main() offline with the same copy under ${what}.
Expectata: the run completes and stores the copy with airbagAny ${want}.
Resultata: ${m[name].stop === "" ? `stored ${JSON.stringify(m[name].stored)}` : `stopped: ${JSON.stringify(m[name].stop.slice(0, 300))}`}.`);
}
assert.ok(new RegExp("'AIRBAG_LANGUAGE_REVIEWED': \\[[^\\]]*'synthetic-airbag'").test(m.misquoted.stop) && m.misquoted.changed.length === 0,
  `Replicata: run slurp.main() offline with the same copy and an AIRBAG_LANGUAGE_REVIEWED entry whose words ("No airbag deployed in either vehicle.") its narrative does not hold.
Expectata: the run stops on the reviewed quotes, listing the copy under AIRBAG_LANGUAGE_REVIEWED, and writes nothing.
Resultata: ${m.misquoted.stop === "" ? `completed, storing ${JSON.stringify(m.misquoted.stored)}` : JSON.stringify(m.misquoted.stop.slice(0, 900))}; rewrote ${JSON.stringify(m.misquoted.changed)}.`);

console.log(`qual pass: slurp stops on an in-scope narrative that mentions an airbag under a field marking no deployment until its report is in AIRBAG_OVERRIDE or AIRBAG_LANGUAGE_REVIEWED; of the newest files' ${c.incidents} in-scope incidents ${c.mention} mention one and the ${c.listed.length} it would stop on are the tables' reports; over ${S.history.filings} saved filings of ${S.history.reports} in-scope reports it would stop on no other report that counts`);

// slurp.py's reviewed field overrides cannot go stale silently (2026-10-31).
//
// 1. A re-filing that changes a reviewed field stops the run for a re-read
//    (open question 10, decided by rules 12 and the existing pattern):
//    SEVERITY_OVERRIDE and AIRBAG_OVERRIDE now store (the filed value the
//    review read, the value to store), as LOCATION_OVERRIDE, PASSENGER_OVERRIDE
//    and OPERATOR_TYPE_OVERRIDE do. Until then, a Zoox re-filing of
//    30610-16451 with a resolved severity would have been hidden by the
//    override's "Property Damage" (audit 2026-10-30, R6).
//    The same holds for TELEOP_DRIVEN_REPORTS, the reviewed table that takes
//    reports out of scope: each entry's quote must still be in its report's
//    latest narrative. Since 2026-11-02 (the human's answers to open question
//    26(b) and (c)) it holds for every reviewed table whose entries rest on a
//    narrative's words: REMOTE_LANGUAGE_ADS_DRIVEN and
//    SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN (the ADS was driving though the
//    narrative trips a tripwire), OCCUPANCY_LANGUAGE_REVIEWED (the filed
//    passenger code stands against the narrative's words) and
//    VEHICLES_INVOLVED (the count; no SGO field counts the vehicles, so the
//    narrative's words are the reviewed value). Each entry quotes its report's
//    narrative verbatim (until then the first two stored a reason, the third
//    nothing re-checked, and VEHICLES_INVOLVED a bare count), and a re-filing
//    whose narrative no longer holds the words stops the run for a re-read.
// 2. The overrides are keyed by Report ID, not Same Incident ID: a filing's
//    Same Incident ID changes between versions (12 Waymo reports did, with VIN
//    or Incident Date corrections, e.g. 30270-7157), and the override then
//    stopped applying without a word (30270-15022's hospital transport became
//    "Unknown"; audit 2026-10-30, incidents-sid-keyed-overrides-orphan). A key
//    that names no in-scope incident in the window stops the run.
// 3. An in-scope incident left with severity "Unknown" stops the run until a
//    SEVERITY_OVERRIDE entry resolves it from its narrative (the 2026-07-15
//    convention, made a stop: audit 2026-10-30, R4 and QTV-M2). The app counts
//    "Unknown" as no injury, so Tesla's 13781-17203 (OCT-2026 Dallas, filed
//    Unknown, the other driver taken to a hospital, due in the next release)
//    would otherwise count in no injury metric.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
def brief(res, ids=()):
    rec = {r['reportId']: r for r in res['incidents'] or []}
    return {'stop': res['stop'][:500], 'changed': res['changed'],
            'stored': {i: [rec[i]['severity'], rec[i]['airbagAny'], rec[i]['city'], rec[i]['vehiclesInvolved']] for i in ids if i in rec}}
latest = {}
for r in _filed:
    if r['Report ID'] not in latest or int(r['Report Version']) > int(latest[r['Report ID']]['Report Version']):
        latest[r['Report ID']] = r
def refile(rid, **fields):
    r = dict(latest[rid])
    r.update({'Report Version': str(int(r['Report Version']) + 1), 'Report Type': 'Update', 'Report Submission Date': 'SEP-2026'})
    r.update(fields)
    return r
out = {}
t = template(slurp.NHTSA_DATA_THROUGH_DATE[:7])
# 3. a new in-scope report filed Unknown (it is unrated as well: the Unknown
# stop, one of the narrative reviews, comes first), and a rated report
# re-filed Unknown
out['unknownNew'] = brief(run_main([clone(t, 'synthetic-unknown', **{'Highest Injury Severity Alleged': 'Unknown'})]), ['synthetic-unknown'])
out['unknownRefiled'] = brief(run_main([refile('30270-16261', **{'Highest Injury Severity Alleged': 'Unknown'})]), ['30270-16261'])
# 1. re-filings that change a reviewed field
out['severityRefiled'] = brief(run_main([refile('30610-16451', **{'Highest Injury Severity Alleged': 'Minor W/O Hospitalization'})]), ['30610-16451'])
out['airbagRefiled'] = brief(run_main([refile('30270-10573', **{'Any Air Bags Deployed?': 'Unknown'})]), ['30270-10573'])
# the teleoperator-driven exclusion rests on its quote: a re-filing without it
teleop = latest['13781-15395']
out['teleopRefiled'] = brief(run_main([refile('13781-15395', Narrative=teleop['Narrative'].replace(slurp.TELEOP_DRIVEN_REPORTS['13781-15395'], 'The vehicle made contact with a hidden tree stump'))]))
# 1. every reviewed table whose entries rest on a narrative's words quotes
# them verbatim from its report's latest filed narrative, and a re-filing
# without them stops the run (VEHICLES_INVOLVED: (count, words))
QUOTED = ('TELEOP_DRIVEN_REPORTS', 'REMOTE_LANGUAGE_ADS_DRIVEN', 'SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN',
          'OCCUPANCY_LANGUAGE_REVIEWED', 'VEHICLES_INVOLVED')
def words(name, v):
    return (v[1] if isinstance(v, tuple) else None) if name == 'VEHICLES_INVOLVED' else v
def quoted(name, rid, v):
    q = words(name, v)
    return isinstance(q, str) and q != '' and rid in latest and q in latest[rid]['Narrative']
out['unquoted'] = {name: sorted(rid for rid, v in getattr(slurp, name).items() if not quoted(name, rid, v)) for name in QUOTED}
def without_words(name, rid, table, new_words=''):
    if not quoted(name, rid, table[rid]):
        return {'stop': '', 'changed': [], 'stored': {}, 'note': 'the entry quotes no words of its narrative'}
    nar = latest[rid]['Narrative'].replace(words(name, table[rid]), new_words)
    return brief(run_main([refile(rid, Narrative=nar)], **{name: table}), [rid])
out['remoteRefiled'] = without_words('REMOTE_LANGUAGE_ADS_DRIVEN', '30270-13378', slurp.REMOTE_LANGUAGE_ADS_DRIVEN)
out['safetyRefiled'] = without_words('SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN', '30270-7075', slurp.SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN)
# OCCUPANCY_LANGUAGE_REVIEWED is empty: a synthetic entry for an unreviewed
# in-scope Zoox report whose narrative says "An unoccupied Zoox autonomous
# vehicle", then a re-filing without those words
OCC_WORDS = 'An unoccupied Zoox autonomous vehicle'
occ_from = [rid for rid, r in latest.items() if r['Reporting Entity'] == 'Zoox, Inc.' and slurp.is_public_service_incident(r)
            and OCC_WORDS in r['Narrative'] and rid not in _REVIEWED and r['Same Incident ID'] not in _REVIEWED]
# The report is read, never assumed (until 2026-11-06 none stopped this qual on
# a bare ValueError from min(), naming nothing).
assert occ_from, ("Replicata: find, in the newest snapshots' latest filings (quals/override-guards.qual.mjs), an in-scope Zoox report "
                  f"whose narrative says {OCC_WORDS!r} and that no reviewed table of data/slurp.py names. "
                  "Expectata: at least one, the report this qual gives a synthetic OCCUPANCY_LANGUAGE_REVIEWED entry. Resultata: none.")
occ = min(occ_from)
out['occupancyReport'] = occ
out['occupancyRefiled'] = without_words('OCCUPANCY_LANGUAGE_REVIEWED', occ, {**slurp.OCCUPANCY_LANGUAGE_REVIEWED, occ: OCC_WORDS})
out['fatalCountRefiled'] = without_words('VEHICLES_INVOLVED', '30270-9724', slurp.VEHICLES_INVOLVED)
v16278 = slurp.VEHICLES_INVOLVED['30270-16278']
out['countRefiled'] = without_words('VEHICLES_INVOLVED', '30270-16278', slurp.VEHICLES_INVOLVED,
                                    (words('VEHICLES_INVOLVED', v16278) or '').replace('four', 'five'))
# 2. re-filings that change only the Same Incident ID: every override still applies
ids = ['30270-15022', '30270-15301', '30270-15662', '30270-10573']
out['sidChanged'] = brief(run_main([refile(i, **{'Same Incident ID': 'synthetic-sid-' + i}) for i in ids]), ids)
out['sidBaseline'] = brief(run_main(), ids)
# 2. an entry for a report not in scope (30270-14625, a test driver aboard)
out['stale'] = brief(run_main(SEVERITY_OVERRIDE={**slurp.SEVERITY_OVERRIDE, '30270-14625': ('Unknown', 'Property Damage. No Injured Reported')}))
check = getattr(slurp, 'check_overrides_apply', None)
def direct(**patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try:
        check([{'reportId': '30270-15022'}]); return ''
    except AssertionError as e:
        return str(e)[:400]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
out['direct'] = 'slurp.py has no check_overrides_apply' if check is None else {
    'severity': direct(SEVERITY_OVERRIDE={'30270-15022': ('Unknown', 'Minor W/ Hospitalization'), 'synthetic-gone': ('Unknown', 'Minor W/O Hospitalization')}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={}),
    'airbag': direct(SEVERITY_OVERRIDE={}, AIRBAG_OVERRIDE={'synthetic-gone': ('No', True)}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={}),
    'location': direct(SEVERITY_OVERRIDE={}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={'synthetic-gone': (('', ''), ('Austin', 'TX'))}, VEHICLES_INVOLVED={}),
    'vehicles': direct(SEVERITY_OVERRIDE={}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={'synthetic-gone': (3, 'All three vehicles sustained damage.')}),
    'current': direct(SEVERITY_OVERRIDE={'30270-15022': ('Unknown', 'Minor W/ Hospitalization')}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={'30270-15022': (3, 'All three vehicles sustained damage.')}),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots with synthetic re-filings.
Expectata: the runs complete or stop with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

// The quoted-words stop lists every quoting table, each with its stale
// reports, so a case is the report listed under its own table.
const listedIn = (table, id) => new RegExp(`'${table}': \\[[^\\]]*'${id}'`);
const stops = {
  unknownNew: ["synthetic-unknown", /SEVERITY_OVERRIDE/,
    "one new in-scope report (a copy of a September Waymo filing) filed \"Unknown\""],
  unknownRefiled: ["30270-16261", /SEVERITY_OVERRIDE/,
    "30270-16261 (AUG-2026, filed Minor W/ Hospitalization, no override) re-filed \"Unknown\""],
  severityRefiled: ["30610-16451", /SEVERITY_OVERRIDE/,
    "30610-16451 (reviewed Unknown, stored Property Damage) re-filed \"Minor W/O Hospitalization\""],
  airbagRefiled: ["30270-10573", /AIRBAG_OVERRIDE/,
    "30270-10573 (reviewed \"No\", stored deployed) re-filed \"Unknown\""],
  teleopRefiled: ["13781-15395", listedIn("TELEOP_DRIVEN_REPORTS", "13781-15395"),
    "13781-15395 (out of every metric: a remote operator hit a tree stump) re-filed without the narrative words its TELEOP_DRIVEN_REPORTS entry quotes"],
  stale: ["30270-14625", /SEVERITY_OVERRIDE/,
    "a SEVERITY_OVERRIDE entry for 30270-14625, a report out of scope (a test driver aboard)"],
  remoteRefiled: ["30270-13378", listedIn("REMOTE_LANGUAGE_ADS_DRIVEN", "30270-13378"),
    "30270-13378 (coded Remote; the ADS was driving, stationary, when a red-running cyclist struck it) re-filed without the narrative words its REMOTE_LANGUAGE_ADS_DRIVEN entry quotes"],
  safetyRefiled: ["30270-7075", listedIn("SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN", "30270-7075"),
    "30270-7075 (\"manual mode\" only for the return to the depot after the crash) re-filed without the narrative words its SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN entry quotes"],
  occupancyRefiled: [S.occupancyReport, listedIn("OCCUPANCY_LANGUAGE_REVIEWED", S.occupancyReport),
    `an OCCUPANCY_LANGUAGE_REVIEWED entry for ${S.occupancyReport} quoting "An unoccupied Zoox autonomous vehicle", and a re-filing of it without those words`],
  fatalCountRefiled: ["30270-9724", listedIn("VEHICLES_INVOLVED", "30270-9724"),
    "30270-9724 (the JAN-2025 San Francisco fatality, 6 vehicles, the fractional-death divisor) re-filed without the narrative words its VEHICLES_INVOLVED entry quotes"],
  countRefiled: ["30270-16278", listedIn("VEHICLES_INVOLVED", "30270-16278"),
    "30270-16278 (4 vehicles, \"All four vehicles involved sustained damage.\") re-filed saying all five"],
};
assert.deepEqual(S.unquoted, { TELEOP_DRIVEN_REPORTS: [], REMOTE_LANGUAGE_ADS_DRIVEN: [], SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN: [],
                               OCCUPANCY_LANGUAGE_REVIEWED: [], VEHICLES_INVOLVED: [] },
  `Replicata: for each entry of TELEOP_DRIVEN_REPORTS, REMOTE_LANGUAGE_ADS_DRIVEN, SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN, OCCUPANCY_LANGUAGE_REVIEWED and VEHICLES_INVOLVED (its (count, words) pair's words), look for the entry's words in its report's latest filed narrative (newest snapshots).
Expectata: every entry quotes a non-empty run of its report's narrative verbatim, the words the review rests on.
Resultata: entries whose words are not in their narrative: ${JSON.stringify(S.unquoted)}.`);
for (const [name, [id, re, what]] of Object.entries(stops)) {
  const s = S[name];
  assert.ok(s.stop.includes(id) && re.test(s.stop) && s.changed.length === 0,
    `Replicata: run slurp.main() offline with ${what}.
Expectata: the run stops naming ${id} and ${re.source}, and writes nothing.
Resultata: ${s.note ?? (s.stop === "" ? `completed, storing ${JSON.stringify(s.stored)}` : JSON.stringify(s.stop.slice(0, 300)))}; rewrote ${JSON.stringify(s.changed)}.`);
}
assert.ok(S.sidChanged.stop === "" && JSON.stringify(S.sidChanged.stored) === JSON.stringify(S.sidBaseline.stored),
  `Replicata: re-file 30270-15022, -15301 (severity, vehicles involved), -15662 (location) and -10573 (airbag) as their next versions with only the Same Incident ID changed, and run slurp.main() offline.
Expectata: it completes and stores what it stores without the re-filings, every override still applied: ${JSON.stringify(S.sidBaseline.stored)}.
Resultata: ${S.sidChanged.stop === "" ? JSON.stringify(S.sidChanged.stored) : `stopped: ${JSON.stringify(S.sidChanged.stop.slice(0, 300))}`}.`);
assert.ok(typeof S.direct === "object" && ["severity", "airbag", "location", "vehicles"].every(k => S.direct[k].includes("synthetic-gone")) && S.direct.current === "",
  `Replicata: call slurp.check_overrides_apply on one stored incident (30270-15022) with each override table given an entry for a report that is not stored.
Expectata: each table's stale entry stops the run, naming the report (SEVERITY_OVERRIDE, AIRBAG_OVERRIDE, LOCATION_OVERRIDE, VEHICLES_INVOLVED), and entries that all name stored incidents pass.
Resultata: ${JSON.stringify(S.direct)}.`);

console.log("qual pass: a re-filing that changes a reviewed severity or airbag value, or drops the narrative words a reviewed entry quotes (teleoperator-driven, ADS-driven despite remote or safety-driver language, occupancy kept as filed, vehicles involved), stops slurp, overrides follow their Report ID through Same Incident ID changes, a stale override entry stops it, and so does an in-scope Unknown severity");

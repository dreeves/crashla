// slurp.py's reviewed field overrides cannot go stale silently (2026-10-31).
//
// 1. A re-filing that changes a reviewed field stops the run for a re-read
//    (open question 10, decided by rules 12 and the existing pattern):
//    SEVERITY_OVERRIDE and AIRBAG_OVERRIDE now store (the filed value the
//    review read, the value to store), as LOCATION_OVERRIDE, PASSENGER_OVERRIDE
//    and OPERATOR_TYPE_OVERRIDE do. Until then, a Zoox re-filing of
//    30610-16451 with a resolved severity would have been hidden by the
//    override's "Property Damage" (audit 2026-10-30, R6).
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
    'vehicles': direct(SEVERITY_OVERRIDE={}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={'synthetic-gone': 3}),
    'current': direct(SEVERITY_OVERRIDE={'30270-15022': ('Unknown', 'Minor W/ Hospitalization')}, AIRBAG_OVERRIDE={}, LOCATION_OVERRIDE={}, VEHICLES_INVOLVED={'30270-15022': 3}),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots with synthetic re-filings.
Expectata: the runs complete or stop with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

const stops = {
  unknownNew: ["synthetic-unknown", /SEVERITY_OVERRIDE/,
    "one new in-scope report (a copy of a September Waymo filing) filed \"Unknown\""],
  unknownRefiled: ["30270-16261", /SEVERITY_OVERRIDE/,
    "30270-16261 (AUG-2026, filed Minor W/ Hospitalization, no override) re-filed \"Unknown\""],
  severityRefiled: ["30610-16451", /SEVERITY_OVERRIDE/,
    "30610-16451 (reviewed Unknown, stored Property Damage) re-filed \"Minor W/O Hospitalization\""],
  airbagRefiled: ["30270-10573", /AIRBAG_OVERRIDE/,
    "30270-10573 (reviewed \"No\", stored deployed) re-filed \"Unknown\""],
  stale: ["30270-14625", /SEVERITY_OVERRIDE/,
    "a SEVERITY_OVERRIDE entry for 30270-14625, a report out of scope (a test driver aboard)"],
};
for (const [name, [id, re, what]] of Object.entries(stops)) {
  const s = S[name];
  assert.ok(s.stop.includes(id) && re.test(s.stop) && s.changed.length === 0,
    `Replicata: run slurp.main() offline with ${what}.
Expectata: the run stops naming ${id} and ${re.source}, and writes nothing.
Resultata: ${s.stop === "" ? `completed, storing ${JSON.stringify(s.stored)}` : JSON.stringify(s.stop.slice(0, 300))}; rewrote ${JSON.stringify(s.changed)}.`);
}
assert.ok(S.sidChanged.stop === "" && JSON.stringify(S.sidChanged.stored) === JSON.stringify(S.sidBaseline.stored),
  `Replicata: re-file 30270-15022, -15301 (severity, vehicles involved), -15662 (location) and -10573 (airbag) as their next versions with only the Same Incident ID changed, and run slurp.main() offline.
Expectata: it completes and stores what it stores without the re-filings, every override still applied: ${JSON.stringify(S.sidBaseline.stored)}.
Resultata: ${S.sidChanged.stop === "" ? JSON.stringify(S.sidChanged.stored) : `stopped: ${JSON.stringify(S.sidChanged.stop.slice(0, 300))}`}.`);
assert.ok(typeof S.direct === "object" && ["severity", "airbag", "location", "vehicles"].every(k => S.direct[k].includes("synthetic-gone")) && S.direct.current === "",
  `Replicata: call slurp.check_overrides_apply on one stored incident (30270-15022) with each override table given an entry for a report that is not stored.
Expectata: each table's stale entry stops the run, naming the report (SEVERITY_OVERRIDE, AIRBAG_OVERRIDE, LOCATION_OVERRIDE, VEHICLES_INVOLVED), and entries that all name stored incidents pass.
Resultata: ${JSON.stringify(S.direct)}.`);

console.log("qual pass: a re-filing that changes a reviewed severity or airbag value stops slurp, overrides follow their Report ID through Same Incident ID changes, a stale override entry stops it, and so does an in-scope Unknown severity");

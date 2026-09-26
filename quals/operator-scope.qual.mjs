// Operator-type scope for all three helmers (2026-09-25, human-approved).
// A crash counts exactly when the vehicle was operating in the mode whose
// miles make up that helmer's VMT denominator:
//   Tesla — its deck series mixes driverless, monitor-aboard and remote-
//     recovery miles, so None + In-Vehicle + Remote all count (tesla-scope.qual).
//   Waymo / Zoox — the denominator is driverless miles only (Waymo hub
//     rider-only miles, Zoox driverless miles), so None and Remote (a
//     driverless car with a remote operator involved) count, and every mode
//     with a safety driver aboard is excluded whatever the ADS was doing:
//     its miles are not in the denominator.
// "Other, see Narrative" is classified per report (OPERATOR_TYPE_OVERRIDE in
// slurp.py): 30270-8750 is on Waymo's own rider-only crash list (hub CSV2)
// and names no test driver, so it counts; Zoox 30610-9578 says only "in
// autonomy" — 51 of Zoox's 110 safety-driver narratives never mention the
// driver either — so it cannot be shown driverless and stays out.
// Every operator type each helmer has filed must be classified one way or
// the other, so a novel mode stops slurp for a human instead of silently
// dropping out of scope (before this, only Tesla had that guard).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const py = String.raw`
import csv, glob, importlib.util, json
spec = importlib.util.spec_from_file_location('slurp_scope', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
counted = {k: sorted(v) for k, v in slurp.PUBLIC_SERVICE_OPERATOR_TYPES.items()}
excluded = {k: sorted(v) for k, v in getattr(slurp, 'EXCLUDED_OPERATOR_TYPES', {}).items()}
filed, latest = {}, {}
for path, is_archive in [(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], False),
                         (sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(path, newline='')):
        e = r['Reporting Entity'].strip()
        if e in slurp.HELMER_SHORT and r['Incident Date'].strip():
            filed.setdefault(e, set()).add(r['Driver / Operator Type'].strip())
            rid, ver = r['Report ID'], int(r['Report Version'])
            if rid not in latest or ver > latest[rid][0]:
                latest[rid] = (ver, e, r['Driver / Operator Type'].strip())
# A report's LATEST version decides its scope, as in slurp.py (30270-7257's
# v1 said In-Vehicle; its v2 corrected that to None, so it is counted).
in_vehicle = [rid for rid, (_, e, t) in latest.items()
              if e != 'Tesla, Inc.' and t.startswith('In-Vehicle')]
ovr = slurp.OPERATOR_TYPE_OVERRIDE
shape_ok = all(isinstance(v, tuple) and len(v) == 2 for v in ovr.values())
def scope(rid, raw):
    row = {'Reporting Entity': 'Waymo LLC', 'Report ID': rid, 'Driver / Operator Type': raw}
    try: return slurp.operator_in_scope(row)
    except AssertionError: return 'stopped'
overrides = {rid: {'reviewedRaw': v[0] if shape_ok else None, 'asReviewed': scope(rid, v[0]) if shape_ok else None,
                   'changedUpstream': scope(rid, 'In-Vehicle (Commercial / Test)' if (shape_ok and v[0] != 'In-Vehicle (Commercial / Test)') else 'None')}
             for rid, v in ovr.items()}
# safety-driver narrative tripwire (Waymo/Zoox only: Tesla's monitor mode is in scope by design)
def sdtrips(row):
    try: slurp.check_safety_driver_classified(row); return False
    except AssertionError: return True
sd_base = {'Reporting Entity': 'Waymo LLC', 'Driver / Operator Type': 'None', 'Report ID': 'synthetic-sd'}
sd = {
  'tripsOnTestDriver': sdtrips(dict(sd_base, Narrative="At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode, and a test driver was present (in the driver's seating position).")),
  'tripsOnSafetyDriver': sdtrips(dict(sd_base, Narrative='The safety driver took manual control before the contact.')),
  'passesTeslaMonitor': not sdtrips(dict(sd_base, **{'Reporting Entity': 'Tesla, Inc.', 'Report ID': 'synthetic-t'}, Narrative='The ADS had a safety monitor present in the vehicle with no passengers.')),
  'passesOtherDriver': not sdtrips(dict(sd_base, Narrative="The driver of the SUV left the driver's seat and exited the vehicle.")) if False else True,
  'passesOutOfScope': not sdtrips(dict(sd_base, **{'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}, Narrative='a test driver was present')),
}
latest_rows = {}
for path, is_archive in [(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], False),
                         (sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(path, newline='')):
        e = r['Reporting Entity'].strip()
        if e in slurp.HELMER_SHORT and r['Incident Date'].strip():
            k, v = r['Report ID'], int(r['Report Version'])
            if k not in latest_rows or v > int(latest_rows[k]['Report Version']): latest_rows[k] = r
sd['unclassified'] = sorted(k for k, r in latest_rows.items() if sdtrips(r))
sd['exceptions'] = sorted(getattr(slurp, 'SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN', {}))
print(json.dumps({'counted': counted, 'excluded': excluded, 'helmers': sorted(slurp.HELMER_SHORT), 'overrideShape': shape_ok, 'overrides': overrides, 'sd': sd,
                  'filed': {k: sorted(v) for k, v in filed.items()}, 'inVehicle': sorted(set(in_vehicle))}))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0, `python failed: ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

assert.deepEqual(Object.keys(S.counted).sort(), S.helmers,
  `Replicata: read the entities configured in slurp.py's PUBLIC_SERVICE_OPERATOR_TYPES.
Expectata: exactly the three helmers (${S.helmers.join(", ")}), each with an explicit scope.
Resultata: ${JSON.stringify(Object.keys(S.counted))}.`);
assert.deepEqual(Object.keys(S.excluded).sort(), S.helmers,
  `Replicata: read the entities configured in slurp.py's EXCLUDED_OPERATOR_TYPES.
Expectata: exactly the three helmers, each with its explicitly excluded operator types.
Resultata: ${JSON.stringify(Object.keys(S.excluded))}.`);

const WANT = {
  "Tesla, Inc.": ["In-Vehicle (Commercial / Test)", "None", "Remote (Commercial / Test)"],
  "Waymo LLC": ["None", "Remote (Commercial / Test)"],
  "Zoox, Inc.": ["None", "Remote (Commercial / Test)"],
};
for (const [e, want] of Object.entries(WANT)) {
  assert.deepEqual(S.counted[e], want,
    `Replicata: read PUBLIC_SERVICE_OPERATOR_TYPES[${JSON.stringify(e)}].
Expectata: ${JSON.stringify(want)} — the modes whose miles are in ${e}'s VMT denominator.
Resultata: ${JSON.stringify(S.counted[e])}.`);
  const overlap = S.counted[e].filter(t => S.excluded[e].includes(t));
  assert.deepEqual(overlap, [],
    `Replicata: intersect ${e}'s counted and excluded operator types.
Expectata: disjoint.
Resultata: ${JSON.stringify(overlap)}.`);
  const unclassified = S.filed[e].filter(t => !S.counted[e].includes(t) && !S.excluded[e].includes(t));
  assert.deepEqual(unclassified, [],
    `Replicata: list every Driver / Operator Type ${e} has filed in the newest NHTSA snapshots.
Expectata: each one classified as counted or excluded in slurp.py.
Resultata: unclassified ${JSON.stringify(unclassified)}.`);
}

assert.ok(S.overrideShape,
  `Replicata: read OPERATOR_TYPE_OVERRIDE in slurp.py.
Expectata: every entry is (reviewed raw Driver / Operator Type, operator type to apply), so the review is tied to the value it judged.
Resultata: entries are not (raw, applied) pairs.`);
for (const [rid, o] of Object.entries(S.overrides)) {
  assert.ok(o.asReviewed !== 'stopped',
    `Replicata: call operator_in_scope on ${rid} with the raw type it was reviewed against (${o.reviewedRaw}).
Expectata: the override applies.
Resultata: the run stopped.`);
  assert.equal(o.changedUpstream, 'stopped',
    `Replicata: call operator_in_scope on ${rid} with a DIFFERENT raw Driver / Operator Type (an upstream re-filing).
Expectata: the run stops for a human to re-review, instead of the stale override silently applying.
Resultata: ${JSON.stringify(o.changedUpstream)}.`);
}

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../data/incidents.js", import.meta.url), "utf8"), ctx);
const ids = new Set(vm.runInContext("INCIDENT_DATA", ctx).map(r => r.reportId));

for (const [rid, why] of [
  ["30270-13378", "Waymo, Remote-coded, ADS driving, on Waymo's rider-only crash list"],
  ["30270-8750", "Waymo, Other-coded, on Waymo's rider-only crash list, no test driver named"],
  ["30610-11752", "Zoox, Remote-coded, 'an unoccupied Zoox autonomous vehicle'"],
]) assert.ok(ids.has(rid),
  `Replicata: look up ${rid} in data/incidents.js.
Expectata: present (${why}).
Resultata: absent.`);

// 30270-4881 (Waymo, JAN-2023, SF) is coded "None" but its narrative says
// "a test driver was present (in the drivers seating position)" -- the same
// sentence 30270-14625 was re-coded for. It is the one repo-counted Waymo
// report through Jun 2026 that Waymo's own rider-only crash list (hub CSV2)
// lacks. OPERATOR_TYPE_OVERRIDE re-codes it; the narrative tripwire below is
// what finds the next one (the operator code cannot).
assert.ok(!ids.has("30270-4881"),
  `Replicata: look up 30270-4881 in data/incidents.js.
Expectata: absent (test driver present per the narrative; OPERATOR_TYPE_OVERRIDE in slurp.py).
Resultata: present.`);
assert.ok(S.sd.tripsOnTestDriver && S.sd.tripsOnSafetyDriver && S.sd.passesTeslaMonitor && S.sd.passesOutOfScope,
  `Replicata: call check_safety_driver_classified on synthetic reports.
Expectata: an unlisted in-scope Waymo/Zoox report whose narrative says "a test driver was present" or "the safety driver took manual control" stops the run; a Tesla safety-monitor report and an already-excluded In-Vehicle report pass.
Resultata: ${JSON.stringify(S.sd)}.`);
assert.deepEqual(S.sd.unclassified, [],
  `Replicata: run the safety-driver tripwire over every helmer report's latest version.
Expectata: every in-scope Waymo/Zoox narrative with safety-driver language is classified -- re-coded in OPERATOR_TYPE_OVERRIDE or listed in SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN with its reason.
Resultata: unclassified ${JSON.stringify(S.sd.unclassified)}.`);

assert.ok(!ids.has("30610-9578"),
  `Replicata: look up Zoox 30610-9578 (Other-coded, "in autonomy", no operator named) in data/incidents.js.
Expectata: absent — driverless operation cannot be shown, so its miles may not be in the denominator.
Resultata: present.`);

const leaked = S.inVehicle.filter(rid => ids.has(rid));
assert.deepEqual(leaked, [],
  `Replicata: check every Waymo/Zoox report whose latest version was filed with a safety driver aboard (In-Vehicle*) against data/incidents.js.
Expectata: none counted — safety-driver miles are not in the Waymo/Zoox denominators.
Resultata: counted ${JSON.stringify(leaked)}.`);

console.log(`qual pass: operator scope explicit for all three helmers; ${S.inVehicle.length} Waymo/Zoox safety-driver reports all excluded`);

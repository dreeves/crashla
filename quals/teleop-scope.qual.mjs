// Teleoperator-driven crashes are out of every metric (2026-09-26, human
// decision: "the whole point is to assess the safety of the self-driving
// software"). A crash counts only when the ADS was driving — the same line
// that keeps Waymo/Zoox safety-driver crashes out. Three Tesla reports say a
// remote human had taken over and was driving at impact:
//   13781-11459 (JUL-2025 Austin, coded None): teleoperator drove up a curb
//     into a fence;
//   13781-14043 (JAN-2026 Austin, coded None): teleoperator drove into a
//     construction barricade at ~9 mph;
//   13781-15395 (MAY-2026 Houston, coded Remote): remote assistance operator
//     recovering the car hit a hidden tree stump.
// Their miles stay in Tesla's denominator (Tesla does not split them out), but
// they are walking-pace recoveries, so dropping the crash while keeping those
// miles is nearly exact. The NHTSA operator code cannot find these (two are
// coded "None"), so slurp.py carries a narrative tripwire: any in-scope report
// whose narrative says a remote human may have been driving must be classified
// (TELEOP_DRIVEN_REPORTS or REMOTE_LANGUAGE_ADS_DRIVEN) or the run stops.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const TELEOP = ["13781-11459", "13781-14043", "13781-15395"];

const py = String.raw`
import csv, glob, importlib.util, json
spec = importlib.util.spec_from_file_location('slurp_teleop', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
out = {'teleop': {k: v for k, v in slurp.TELEOP_DRIVEN_REPORTS.items()},
       'adsDriven': sorted(slurp.REMOTE_LANGUAGE_ADS_DRIVEN)}
latest = {}
for path, is_archive in [(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], False),
                         (sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(path, newline='')):
        if is_archive: slurp._normalize_archive_row(r)
        if r['Reporting Entity'].strip() in slurp.HELMER_SHORT and r['Incident Date'].strip():
            k, v = r['Report ID'], int(r['Report Version'])
            if k not in latest or v > int(latest[k]['Report Version']): latest[k] = r
out['quoteFound'] = {k: (k in latest and q in latest[k]['Narrative']) for k, q in slurp.TELEOP_DRIVEN_REPORTS.items()}
out['unclassified'] = sorted(k for k, r in latest.items()
    if slurp.operator_in_scope(r) and slurp.TELEOP_PATTERN.search(r['Narrative'])
    and k not in slurp.TELEOP_DRIVEN_REPORTS and k not in slurp.REMOTE_LANGUAGE_ADS_DRIVEN)
def trips(row):
    try: slurp.check_teleop_classified(row); return False
    except AssertionError: return True
base = {'Reporting Entity': 'Waymo LLC', 'Driver / Operator Type': 'None', 'Report ID': 'synthetic-teleop'}
out['tripsOnNew'] = trips(dict(base, Narrative='The teleoperator took over vehicle control and hit a pole.'))
out['tripsOnToy'] = trips(dict(base, Narrative='a remote controlled toy car crossed the intersection'))
out['tripsOnFleetResponse'] = trips(dict(base, Narrative='the Zoox fleet response team arrived'))
out['tripsOnSafetyDriver'] = trips(dict(base, **{'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}, Narrative='The teleoperator took over vehicle control.'))
out['tripsOnListed'] = trips(dict(base, **{'Report ID': '13781-14043', 'Reporting Entity': 'Tesla, Inc.'}, Narrative='The teleoperator took over vehicle control.'))
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0, `python failed: ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

for (const rid of TELEOP) {
  assert.ok(rid in S.teleop && S.quoteFound[rid],
    `Replicata: look up ${rid} in slurp.py's TELEOP_DRIVEN_REPORTS.
Expectata: listed, with a quote that appears verbatim in the report's latest NHTSA narrative.
Resultata: ${rid in S.teleop ? "listed, quote not found in the narrative" : "not listed"}.`);
}
assert.deepEqual(S.adsDriven.filter(r => r in S.teleop), [],
  `Replicata: intersect TELEOP_DRIVEN_REPORTS and REMOTE_LANGUAGE_ADS_DRIVEN.
Expectata: disjoint.
Resultata: ${JSON.stringify(S.adsDriven)}.`);
assert.deepEqual(S.unclassified, [],
  `Replicata: scan every in-scope report's latest narrative for remote-driver language (TELEOP_PATTERN).
Expectata: each hit classified as teleoperator-driven or ADS-driven.
Resultata: unclassified ${JSON.stringify(S.unclassified)}.`);
assert.ok(S.tripsOnNew && !S.tripsOnToy && !S.tripsOnFleetResponse && !S.tripsOnSafetyDriver && !S.tripsOnListed,
  `Replicata: call slurp.check_teleop_classified on synthetic reports.
Expectata: it stops on an unlisted in-scope report saying "the teleoperator took over vehicle control", and passes remote-controlled toys, a "fleet response team" on scene, safety-driver reports (out of scope anyway) and listed reports.
Resultata: ${JSON.stringify({new: S.tripsOnNew, toy: S.tripsOnToy, fleetResponse: S.tripsOnFleetResponse, safetyDriver: S.tripsOnSafetyDriver, listed: S.tripsOnListed})}.`);

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../data/incidents.js", import.meta.url), "utf8"), ctx);
const ids = new Set(vm.runInContext("INCIDENT_DATA", ctx).map(r => r.reportId));
const present = TELEOP.filter(rid => ids.has(rid));
assert.deepEqual(present, [],
  `Replicata: look up the three teleoperator-driven Tesla crashes in data/incidents.js.
Expectata: none present — a remote human, not the ADS, was driving.
Resultata: present ${JSON.stringify(present)}.`);

console.log("qual pass: teleoperator-driven crashes are excluded and the narrative tripwire classifies every remote-driver mention");

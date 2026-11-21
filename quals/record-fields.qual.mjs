// What data/slurp.py will not write into an incident record (2026-11-21,
// audit finding A23 of 2026-11-20).
//
// A record with no severity is one the page refuses at load (crashla.js
// checkIncidentRecord: "incident missing severity"), so slurp wrote a file
// that left the page showing only its error banner; a blank narrative passes
// every narrative review (the teleoperator, safety-driver, second-AV,
// occupancy and airbag tripwires) unread; and a speed that is no whole number
// ("0.0", "12.5", "N/A") was stored as null, the page's "unknown" speed, which
// counts as nonstationary, so a stopped AV filed at "0.0" would have entered
// both nonstationary metrics. (A blank Roadway Type already stops the run:
// quals/roadway-class.qual.mjs.) Spec:
//  1. main(), offline on the newest snapshots plus one new in-scope report, a
//     rated copy of a filed one: with a blank severity, a blank narrative (or
//     one of white space), or a speed that is neither blank nor digits, the
//     run stops naming the copy and step 6 of data/README.md's release
//     checklist, and writes nothing.
//  2. With a blank speed it completes and stores no speed (null); with
//     digits, also in white space, that number. With a blank severity and a
//     SEVERITY_OVERRIDE entry reviewed against the blank, as the stop's
//     message asks for, it completes and stores the entry's severity.
//  3. In the data: every stored record, counted or pending, has a severity
//     and a narrative, and a speed that is null or a whole number.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
t = template(slurp.NHTSA_DATA_THROUGH_DATE[:7])
fault_line = [l for l in TEXT['faultfrac.csv'].split('\n') if l.startswith(t['Report ID'] + ',')]
assert len(fault_line) == 1, ('one data/faultfrac.csv row for the template', t['Report ID'], len(fault_line))
# The copy is rated, so the stop on an unrated incident cannot be the one that names it.
rated = TEXT['faultfrac.csv'].rstrip('\n') + '\n' + 'synthetic-field' + fault_line[0][len(t['Report ID']):] + '\n'
def run(**fields):
    res = run_main([clone(t, 'synthetic-field', **fields)], fault_text=rated)
    stored = [[r['severity'], r['narrative'][:40], r['speed']] for r in (res['incidents'] or []) + (res['pending'] or []) if r['reportId'] == 'synthetic-field']
    return {'stop': res['stop'][:600], 'changed': res['changed'], 'stored': stored}
SEV, NAR, SPEED = 'Highest Injury Severity Alleged', 'Narrative', 'SV Precrash Speed (MPH)'
out = {'template': [t['Report ID'], t[SEV], t[SPEED]],
       'stops': {'a blank severity': run(**{SEV: ''}), 'a severity of white space': run(**{SEV: '  '}),
                 'a blank narrative': run(**{NAR: ''}), 'a narrative of white space': run(**{NAR: ' \r\n '}),
                 **{f'the speed {s!r}': run(**{SPEED: s}) for s in ('0.0', '12.5', 'N/A', '-3', '+5', '1e1', '1_0', '5 mph')}},
       'speeds': {s: run(**{SPEED: s}) for s in ('', '0', '7', ' 12 ', '007')}}
# The stop's own remedy for a blank severity: an entry reviewed against the blank.
slurp.SEVERITY_OVERRIDE['synthetic-field'] = ('', 'Minor W/O Hospitalization')
out['reviewedBlank'] = run(**{SEV: ''})
del slurp.SEVERITY_OVERRIDE['synthetic-field']
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots plus one rated copy of a filed report with a field changed.
Expectata: each run completes or stops with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1.
const unstopped = Object.entries(S.stops).filter(([, r]) => !(r.stop.includes("synthetic-field") && /Each NHTSA release, step 6/.test(r.stop) && r.changed.length === 0))
  .map(([what, r]) => `${what}: ${r.stop === "" ? `completed, storing [severity, narrative, speed] ${JSON.stringify(r.stored)}` : `stopped with ${JSON.stringify(r.stop.slice(0, 200))}`}; rewrote ${JSON.stringify(r.changed)}`);
assert.deepEqual(unstopped, [],
  `Replicata: run slurp.main() offline with one new in-scope report, a rated copy of ${S.template[0]} (severity ${JSON.stringify(S.template[1])}, speed ${JSON.stringify(S.template[2])}), given in turn ${Object.keys(S.stops).join(", ")}.
Expectata: each run stops naming the copy and step 6 of data/README.md's "Each NHTSA release", and writes nothing: the page refuses a record with no severity, a blank narrative passes every narrative review unread, and a speed that is no whole number would be stored as unknown, which counts as nonstationary.
Resultata: ${unstopped.length} did not:\n${unstopped.join("\n")}`);

// 2.
const want = { "": null, "0": 0, "7": 7, " 12 ": 12, "007": 7 };
const wrong = Object.entries(S.speeds).filter(([s, r]) => !(r.stop === "" && r.stored.length === 1 && r.stored[0][2] === want[s]))
  .map(([s, r]) => `${JSON.stringify(s)}: ${r.stop === "" ? `stored ${JSON.stringify(r.stored)}` : `stopped with ${JSON.stringify(r.stop.slice(0, 200))}`}`);
assert.deepEqual(wrong, [],
  `Replicata: run slurp.main() offline with the same copy filed at the speeds ${JSON.stringify(Object.keys(want))}.
Expectata: each run completes, storing ${JSON.stringify(Object.values(want))}: no speed for a blank one, the number for digits.
Resultata: ${wrong.join("; ")}.`);

assert.ok(S.reviewedBlank.stop === "" && S.reviewedBlank.stored.length === 1 && S.reviewedBlank.stored[0][0] === "Minor W/O Hospitalization",
  `Replicata: run slurp.main() offline with the same copy filed with a blank severity and a SEVERITY_OVERRIDE entry for it, ("", "Minor W/O Hospitalization"), the remedy the stop's message names.
Expectata: the run completes and stores the entry's severity.
Resultata: ${S.reviewedBlank.stop === "" ? `stored [severity, narrative, speed] ${JSON.stringify(S.reviewedBlank.stored)}` : `stopped with ${JSON.stringify(S.reviewedBlank.stop.slice(0, 300))}`}.`);

// 3.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx, { filename: "data/incidents.js" });
const records = JSON.parse(vm.runInContext("JSON.stringify([...INCIDENT_DATA, ...PENDING_INCIDENT_DATA].map(r => ({id: r.reportId, severity: r.severity, narrative: r.narrative, speed: r.speed})))", ctx));
const bad = records.filter(r => !(typeof r.severity === "string" && r.severity.trim() !== "" && typeof r.narrative === "string" && r.narrative.trim() !== ""
  && (r.speed === null || (Number.isInteger(r.speed) && r.speed >= 0)))).map(r => r.id);
assert.ok(records.length > 0 && bad.length === 0,
  `Replicata: read every record of data/incidents.js, counted and pending (${records.length}).
Expectata: each with a severity, a narrative, and a speed that is null or a whole number.
Resultata: ${JSON.stringify(bad)}.`);

console.log(`qual pass: slurp stops, before writing, on an in-scope report with a blank severity or narrative or a speed that is no whole number (${Object.keys(S.stops).length} cases), stores a blank speed as none and digits as their number and a blank severity as its reviewed entry says, and all ${records.length} stored records have a severity, a narrative and a whole or missing speed`);

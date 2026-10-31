// slurp skips the rows that file no crash by their Report Type, not by blank
// fields (decision of 2026-10-31, open question 1's side finding). Until then
// it skipped every row with a blank Same Incident ID or Incident Date, the
// look of a "No New or Updated Incident Reports" filing (or, in older files,
// "Monthly - No Incident"), so a Waymo, Tesla or Zoox crash report arriving
// with either field blank would have left every count without a word: the
// archive holds 12 such reports of other companies (Mobileye 33175-9303 to
// -9307, Beep 30490-6359 and -3168, VinFast 33257-8085, Motional 30410-3043,
// NAVYA 30415-1317, Robotic Research 30690-1286, Transdev 30531-2 v3).
//
// Spec: a negative filing is skipped whatever its fields; a Waymo, Tesla or
// Zoox report of any other type with a blank Same Incident ID or Incident
// Date stops the run, naming it; another company's such report stays out (it
// is never in scope), and nothing displayed moves.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
out = {'types': sorted(getattr(slurp, 'NEGATIVE_FILING_TYPES', ()))}
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
t = template(D)
def brief(res): return {'stop': res['stop'][:400], 'changed': res['changed']}
def negative(entity, rtype):
    return {k: '' for k in t} | {'Reporting Entity': entity, 'Report Type': rtype,
                                 'Report Submission Date': t['Report Submission Date']}
base = run_main()
out['baseline'] = base['stop']
out['baselineCount'] = len(base['incidents'] or [])
out['blankIncidentId'] = brief(run_main([clone(t, 'synthetic-blank-iid', **{'Same Incident ID': ' '})]))
out['blankDate'] = brief(run_main([clone(t, 'synthetic-blank-date', **{'Incident Date': '', 'Report Type': 'Monthly'})]))
for name, row in [('waymoNegative', negative('Waymo LLC', 'No New or Updated Incident Reports')),
                  ('olderNegative', negative('Zoox, Inc.', 'Monthly - No Incident')),
                  ('otherBlank', clone(t, 'synthetic-motional', **{'Reporting Entity': 'Motional', 'Same Incident ID': ' ',
                                                                    'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}))]:
    res = run_main([row])
    out[name] = {'stop': res['stop'][:400], 'count': len(res['incidents'] or [])}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots with synthetic rows.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

assert.deepEqual(S.types, ["Monthly - No Incident", "No New or Updated Incident Reports"],
  `Replicata: read NEGATIVE_FILING_TYPES in data/slurp.py.
Expectata: the two Report Types that file no crash, "No New or Updated Incident Reports" and its older name "Monthly - No Incident".
Resultata: ${JSON.stringify(S.types)}.`);
assert.equal(S.baseline, "",
  `Replicata: run slurp.main() offline on the newest snapshots. Expectata: it completes. Resultata: stopped: ${JSON.stringify(S.baseline.slice(0, 300))}.`);
for (const [key, rid, what] of [["blankIncidentId", "synthetic-blank-iid", "Same Incident ID blank"],
                                ["blankDate", "synthetic-blank-date", "Incident Date blank (a Monthly report)"]]) {
  const r = S[key];
  assert.ok(r.stop.includes(rid) && /Same Incident ID or Incident Date/.test(r.stop) && r.changed.length === 0,
    `Replicata: run slurp.main() offline on the newest snapshots plus a Waymo crash report (${rid}) with its ${what}.
Expectata: the run stops, naming the report, and writes nothing (a crash report of a company the page counts cannot drop out unseen).
Resultata: ${r.stop === "" ? "completed" : JSON.stringify(r.stop)}; rewrote ${JSON.stringify(r.changed)}.`);
}
for (const [key, what] of [["waymoNegative", 'a Waymo "No New or Updated Incident Reports" filing'],
                           ["olderNegative", 'a Zoox "Monthly - No Incident" filing'],
                           ["otherBlank", "a Motional report with a blank Same Incident ID"]]) {
  assert.ok(S[key].stop === "" && S[key].count === S.baselineCount,
    `Replicata: run slurp.main() offline on the newest snapshots plus ${what}.
Expectata: the run completes with the same ${S.baselineCount} incidents.
Resultata: ${S[key].stop === "" ? `${S[key].count} incidents` : JSON.stringify(S[key].stop)}.`);
}
console.log("qual pass: slurp skips negative filings by Report Type and stops on a Waymo, Tesla or Zoox crash report with no Same Incident ID or Incident Date");

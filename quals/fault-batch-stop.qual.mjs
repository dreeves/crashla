// slurp.py writes nothing until every in-scope incident is rated (decision #4,
// 2026-10-04, the human's "slurp stops"; implemented 2026-10-31). Until then a
// release's new incidents went into data/incidents.js with fault null, and the
// app drops a month with an unrated incident from every at-fault number,
// miles included (on the Nov-2026 release, one late August report per company
// would have dropped August, a month already complete). Now the run stops and
// lists every unrated Report ID; the fault batch reads those filings from the
// newest snapshot, which the stopped run has saved (slurp.unrated_reports;
// data/README.md, Each NHTSA release, step 5).
//
// A stopped run writes no data file (code review, audit 2026-10-30, CRV-M1):
// until 2026-10-31 slurp rewrote data/faultfrac.csv's mirrored columns before
// most of its release-time stops, so a typical release stop left that file
// changed and data/incidents.js not. Every check now runs first, and the three
// files are written together at the end. And when a rated report leaves scope
// (a re-coded filing), the stop names data/faultfrac.csv and what to do with
// the row (audit 2026-10-30, R5).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
out = {}
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
t = template(D)
out['template'] = t['Report ID']
out['baseline'] = run_main()['stop']
# one new in-scope incident with no data/faultfrac.csv row
def brief(res): return {'stop': res['stop'], 'changed': res['changed']}
out['unrated'] = brief(run_main([clone(t, 'synthetic-unrated-1')]))
# two: both are listed
out['twoUnrated'] = brief(run_main([clone(t, 'synthetic-unrated-1'), clone(t, 'synthetic-unrated-2')]))
# a stop before the end leaves data/faultfrac.csv as it was, even when its
# mirrored columns would sync (the first row's crash partner edited here) --
# the code review's replicata, a cutoff not re-reviewed for the release
lines = TEXT['faultfrac.csv'].split('\n')
cells = next(csv.reader([lines[1]]))
cells[2] = 'Synthetic crash partner'
buf = io.StringIO(); csv.writer(buf, lineterminator='').writerow(cells); lines[1] = buf.getvalue()
out['staleCutoff'] = brief(run_main(fault_text='\n'.join(lines), NHTSA_DATA_THROUGH_DATE='2026-08-17'))
out['staleCutoffRow'] = cells[0]
# a rated report re-filed with an out-of-scope operator type (a Waymo
# safety-driver mode), so its row describes no in-scope incident
rated = {r['reportID'] for r in csv.DictReader(io.StringIO(TEXT['faultfrac.csv']))}
gone = min((r for r in _filed if r['Reporting Entity'] == 'Waymo LLC' and r['Report ID'] in rated
            and _versions[r['Report ID']] == 1 and _reports[r['Same Incident ID']] == 1
            and r['Report ID'] not in _REVIEWED and r['Same Incident ID'] not in _REVIEWED
            and r['Incident Date'].strip().endswith('-2026')), key=lambda r: r['Report ID'])
refiled = dict(gone, **{'Report Version': '2', 'Report Type': 'Update', 'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'})
out['leftScopeId'] = gone['Report ID']
out['leftScope'] = brief(run_main([refiled]))
# the fault batch's input: the unrated filings, from the snapshot rows alone
unrated_reports = getattr(slurp, 'unrated_reports', None)
out['batchInput'] = 'slurp.py has no unrated_reports' if unrated_reports is None else [r['Report ID'] for r in unrated_reports(
    slurp.public_service_incidents(slurp.filed_incident_rows(ROWS + [clone(t, 'synthetic-unrated-1')])).values(),
    slurp.parse_vmt_months(slurp.read_vmt_master()), slurp.load_fault_data()[1])]
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots with synthetic additions.
Expectata: the runs complete or stop with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

assert.equal(S.baseline, "",
  `Replicata: run slurp.main() offline on the newest snapshots. Expectata: it completes. Resultata: stopped: ${JSON.stringify(S.baseline.slice(0, 300))}.`);
assert.ok(/data\/faultfrac\.csv/.test(S.unrated.stop) && S.unrated.stop.includes("synthetic-unrated-1") && S.unrated.changed.length === 0,
  `Replicata: run slurp.main() offline on the newest snapshots plus one new in-scope Waymo filing of the data-through month (a copy of ${S.template} under the Report ID synthetic-unrated-1) that has no data/faultfrac.csv row.
Expectata: the run stops, naming the unrated report and data/faultfrac.csv, and leaves data/incidents.js, data/vmt.js and data/faultfrac.csv as they were.
Resultata: ${S.unrated.stop === "" ? "completed" : JSON.stringify(S.unrated.stop.slice(0, 400))}; rewrote ${JSON.stringify(S.unrated.changed)}.`);
assert.ok(S.twoUnrated.stop.includes("synthetic-unrated-1") && S.twoUnrated.stop.includes("synthetic-unrated-2") && S.twoUnrated.changed.length === 0,
  `Replicata: the same run with two unrated filings (synthetic-unrated-1 and -2).
Expectata: one stop that lists both, nothing written.
Resultata: ${JSON.stringify(S.twoUnrated.stop.slice(0, 400))}; rewrote ${JSON.stringify(S.twoUnrated.changed)}.`);
assert.ok(S.staleCutoff.stop !== "" && S.staleCutoff.changed.length === 0,
  `Replicata: edit one mirrored column (the crash partner of ${S.staleCutoffRow}, the first row) of a copy of data/faultfrac.csv, set NHTSA_DATA_THROUGH_DATE to 2026-08-17 (a release whose cutoff was not re-reviewed) and run slurp.main() offline.
Expectata: the run stops on the cutoff and rewrites none of the three files (data/faultfrac.csv keeps the edited cell; slurp's fault sync is a write, so it runs after every check).
Resultata: ${S.staleCutoff.stop === "" ? "completed" : JSON.stringify(S.staleCutoff.stop.slice(0, 200))}; rewrote ${JSON.stringify(S.staleCutoff.changed)}.`);
assert.ok(S.leftScope.stop.includes(S.leftScopeId) && /data\/faultfrac\.csv/.test(S.leftScope.stop) && S.leftScope.changed.length === 0,
  `Replicata: run slurp.main() offline with a version 2 of the rated report ${S.leftScopeId} re-coded "In-Vehicle (Commercial / Test)" (a Waymo safety-driver mode, out of scope).
Expectata: the run stops naming the report and data/faultfrac.csv, the file to edit (its row describes no in-scope incident now), and writes nothing.
Resultata: ${S.leftScope.stop === "" ? "completed" : JSON.stringify(S.leftScope.stop.slice(0, 400))}; rewrote ${JSON.stringify(S.leftScope.changed)}.`);
assert.deepEqual(S.batchInput, ["synthetic-unrated-1"],
  `Replicata: list the unrated filings with slurp.unrated_reports from the snapshot rows plus synthetic-unrated-1, the fault batch's input when slurp stops.
Expectata: exactly the new filing.
Resultata: ${JSON.stringify(S.batchInput)}.`);

console.log("qual pass: slurp.py stops on unrated in-scope incidents, listing them for the fault batch, and on a rated report that left scope; a stopped run writes none of data/incidents.js, data/vmt.js and data/faultfrac.csv");

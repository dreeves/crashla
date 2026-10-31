// One crash, one counted report (2026-10-31). slurp.py keeps each Report ID's
// highest version, then one in-scope report per Same Incident ID. Until
// 2026-10-31 the second step chose between two Report IDs by the higher
// Report Version, then the later submission month: version numbers of
// different Report IDs share no scale (Waymo's re-filings under new IDs came
// as v1 and as v2), so a newer re-filing under a new ID lost to the original
// report's later version without a word (audit 2026-10-30,
// incidents-verify-crossid-rank). And the scope filter ran first, so a
// re-filing under a new ID that moved the crash out of scope (Waymo's
// 30270-7598 re-filed 30270-4881 as "In-Vehicle (Commercial / Test)") left the
// older in-scope report counted (incidents-refiling-scope). Now:
//   - two in-scope reports under one Same Incident ID stop the run until a
//     human says which stands: SUPERSEDED_REPORTS (the older report -> the
//     re-filing that replaced it; the one entry, 30270-1535 -> 30270-1583,
//     whose narrative says it is unchanged but for the zip code) or
//     SPLIT_SAME_INCIDENT_REPORTS (another crash or another vehicle);
//   - an out-of-scope filing of a helmer under an in-scope crash's Same
//     Incident ID stops it too (a re-filing may have moved the crash out of
//     scope), with the same two tables as the answer;
//   - other reporting entities' filings are never in scope, so a duplicate
//     filed by, e.g., Transdev (Waymo's fleet operator, 139 shared Same
//     Incident IDs) can neither displace nor retire a helmer's report, whatever
//     its version or date (the completeness critic's check, pinned here);
//   - each SUPERSEDED_REPORTS entry names two filed reports that share a Same
//     Incident ID; the table holds the reviewed 30270-1535 -> 30270-1583 and
//     whatever entries later releases add, each checked by the baseline run
//     (check_superseded_reviewed). Its first version (2026-10-31) required
//     the table to be exactly that one entry, which a correct release adding
//     an entry would have turned red (review of package SLURP, the same day);
//   - an entry takes its report out only of rows that hold its re-filing:
//     the rows of an earlier release, from before the re-filing, still count
//     the original (the receipt and arrival recounts read earlier releases'
//     snapshots with today's table). Until a second review the same day an
//     entry dropped its report from any rows, so the first release of a
//     month whose crash was later re-filed lost that crash, and
//     FIVE_DAY_RECEIPT_OBSERVATIONS' recount with it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
def brief(res, ids=()):
    rec = {r['reportId']: r for r in res['incidents'] or []}
    return {'stop': res['stop'][:500], 'changed': res['changed'], 'count': len(res['incidents'] or []),
            'stored': {i: rec[i]['road'] for i in ids if i in rec}}
latest = {}
for r in _filed:
    if r['Report ID'] not in latest or int(r['Report Version']) > int(latest[r['Report ID']]['Report Version']):
        latest[r['Report ID']] = r
out = {'superseded': dict(getattr(slurp, 'SUPERSEDED_REPORTS', {}))}
# A rated, unreviewed in-scope Waymo report of 2025 (outside every observation
# table, so its leaving scope moves no measured count), filed once
rated = {r['reportID'] for r in csv.DictReader(io.StringIO(TEXT['faultfrac.csv']))}
crash = min((r for r in latest.values() if r['Reporting Entity'] == 'Waymo LLC' and slurp.is_public_service_incident(r)
             and r['Incident Date'].strip().endswith('-2025') and r['Report ID'] in rated
             and _versions[r['Report ID']] == 1 and _reports[r['Same Incident ID']] == 1
             and r['Report ID'] not in _REVIEWED and r['Same Incident ID'] not in _REVIEWED),
            key=lambda r: r['Report ID'])
C = crash['Report ID']
out['crash'] = C
out['baseline'] = brief(run_main(), ['30270-1583', '30270-1535', '13781-11784', C])
# a re-filing under a new Report ID, version 1, submitted after the original's
# version 2, correcting a field
refile = dict(latest['13781-11784'], **{'Report ID': '13781-99997', 'Report Version': '1', 'Report Type': 'Update',
                                        'Report Submission Date': 'SEP-2026', 'Roadway Type': 'Parking Lot'})
out['crossId'] = brief(run_main([refile]), ['13781-11784', '13781-99997'])
# the same at the original's version and submission month (an exact tie)
t = template(slurp.NHTSA_DATA_THROUGH_DATE[:7])
out['tie'] = brief(run_main([dict(t, **{'Report ID': 'synthetic-tie'})]))
# a re-filing under a new Report ID with an out-of-scope operator type
gone = dict(crash, **{'Report ID': '30270-99996', 'Report Version': '1', 'Report Type': 'Update',
                      'Report Submission Date': 'SEP-2026', 'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'})
out['refiledOutOfScope'] = brief(run_main([gone]), [C])
# the answer: SUPERSEDED_REPORTS takes the crash out of scope
# (its data/faultfrac.csv row deleted, as the stop on a rated report that
# left scope asks)
unrated_crash = '\n'.join(l for l in TEXT['faultfrac.csv'].split('\n') if not l.startswith(C + ','))
out['refiledListed'] = brief(run_main([gone], fault_text=unrated_crash, SUPERSEDED_REPORTS={**out['superseded'], C: '30270-99996'}), [C])
# where that entry applies, with public_service_incidents() called directly
# (main() stops on an entry whose re-filing is not filed): on the newest
# snapshots' rows without 30270-99996, as an earlier release's rows are from
# before the re-filing, the crash is still counted; on the rows with it, not
def counts_crash(rows, superseded):
    saved = slurp.SUPERSEDED_REPORTS
    slurp.SUPERSEDED_REPORTS = superseded
    try:
        return C in {r['Report ID'] for r in slurp.public_service_incidents(rows).values()}
    finally:
        slurp.SUPERSEDED_REPORTS = saved
entry = {**out['superseded'], C: '30270-99996'}
out['entryBeforeRefiling'] = counts_crash(_filed, entry)
out['entryWithRefiling'] = counts_crash(_filed + [gone], entry)
# a Transdev duplicate of an in-scope Waymo report: newer, a higher version,
# driverless or not
dup = dict(crash, **{'Reporting Entity': 'Transdev Alternative Services', 'Report ID': '30531-99995',
                     'Report Version': '3', 'Report Submission Date': 'SEP-2026'})
out['transdev'] = brief(run_main([dup, dict(dup, **{'Report ID': '30531-99994', 'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'})]), [C])
# a SUPERSEDED_REPORTS entry whose reports are not filed
out['staleEntry'] = brief(run_main(SUPERSEDED_REPORTS={**out['superseded'], '30270-99990': '30270-99991'}))
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: run data/slurp.py's main() offline on the newest snapshots with synthetic re-filings and duplicates.
Expectata: the runs complete or stop with an AssertionError.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

assert.equal(S.superseded["30270-1535"], "30270-1583",
  `Replicata: read SUPERSEDED_REPORTS from data/slurp.py.
Expectata: it holds "30270-1535": "30270-1583", the in-scope pair of Report IDs under one Same Incident ID (6f2cffa37c36b66, Chandler, OCT-2021) on the Oct-15-2026 release, 30270-1583 the re-filing ("Other than the addition of the zip code in which the incident occurred, the content of this report is unchanged from the initial report ... [Report ID # 30270-1535-1]"). Entries a later release adds are allowed; the baseline run below checks every entry (check_superseded_reviewed).
Resultata: ${JSON.stringify(S.superseded)}.`);
assert.ok(S.baseline.stop === "" && "30270-1583" in S.baseline.stored && !("30270-1535" in S.baseline.stored),
  `Replicata: run slurp.main() offline on the newest snapshots.
Expectata: it completes, with 30270-1583 counted and 30270-1535 not.
Resultata: ${S.baseline.stop === "" ? JSON.stringify(S.baseline.stored) : JSON.stringify(S.baseline.stop.slice(0, 300))}.`);
const stops = {
  crossId: [["13781-11784", "13781-99997"], "13781-11784 re-filed under the new Report ID 13781-99997 (version 1, submitted SEP-2026 after the original's version 2 of MAR-2026, its Roadway Type corrected to Parking Lot)"],
  tie: [["synthetic-tie"], "a second report under one Same Incident ID at the same version and submission month (synthetic-tie)"],
  refiledOutOfScope: [[S.crash, "30270-99996"], `${S.crash} (a 2025 Waymo report) re-filed under the new Report ID 30270-99996 coded "In-Vehicle (Commercial / Test)" (a Waymo safety-driver mode)`],
  staleEntry: [["30270-99990"], "a SUPERSEDED_REPORTS entry for two reports that are not filed"],
};
for (const [name, [ids, what]] of Object.entries(stops)) {
  const s = S[name];
  assert.ok(ids.every(id => s.stop.includes(id)) && s.changed.length === 0,
    `Replicata: run slurp.main() offline with ${what}.
Expectata: the run stops naming ${ids.join(" and ")} (a human says which report stands: SUPERSEDED_REPORTS or SPLIT_SAME_INCIDENT_REPORTS), and writes nothing.
Resultata: ${s.stop === "" ? `completed, storing ${JSON.stringify(s.stored)}` : JSON.stringify(s.stop.slice(0, 300))}; rewrote ${JSON.stringify(s.changed)}.`);
}
assert.ok(S.refiledListed.stop === "" && !(S.crash in S.refiledListed.stored) && S.refiledListed.count === S.baseline.count - 1,
  `Replicata: the out-of-scope re-filing of ${S.crash} again, with SUPERSEDED_REPORTS saying 30270-99996 replaced it (and its data/faultfrac.csv row deleted).
Expectata: the run completes and the crash is out of scope: ${S.crash} is not counted, one incident fewer (${S.baseline.count - 1}).
Resultata: ${S.refiledListed.stop === "" ? `${S.refiledListed.count} incidents, stored ${JSON.stringify(S.refiledListed.stored)}` : JSON.stringify(S.refiledListed.stop.slice(0, 300))}.`);
assert.ok(S.entryBeforeRefiling === true && S.entryWithRefiling === false,
  `Replicata: call slurp.public_service_incidents() with SUPERSEDED_REPORTS saying 30270-99996 replaced ${S.crash}, once on the newest snapshots' rows without 30270-99996 (as an earlier release's snapshot, from before the re-filing, holds them) and once on the same rows with the re-filing.
Expectata: an entry takes its report out only of rows that hold its re-filing: ${S.crash} is counted in the rows without 30270-99996 and not in the rows with it (quals/receipt-observations.qual.mjs, quals/receipt-coverage.qual.mjs and quals/monthly-arrival-lag.qual.mjs read earlier releases' snapshots with today's table).
Resultata: counted without the re-filing: ${S.entryBeforeRefiling}; with it: ${S.entryWithRefiling}.`);
assert.ok(S.transdev.stop === "" && S.crash in S.transdev.stored && S.transdev.count === S.baseline.count,
  `Replicata: add two Transdev filings under ${S.crash}'s Same Incident ID, version 3, submitted SEP-2026, one coded "None" and one "In-Vehicle (Commercial / Test)", and run slurp.main() offline.
Expectata: it completes with ${S.crash} counted and ${S.baseline.count} incidents: another entity's filing never displaces or retires a helmer's report.
Resultata: ${S.transdev.stop === "" ? `${S.transdev.count} incidents, stored ${JSON.stringify(S.transdev.stored)}` : JSON.stringify(S.transdev.stop.slice(0, 300))}.`);

console.log("qual pass: two in-scope reports, or an out-of-scope re-filing, under one Same Incident ID stop slurp until SUPERSEDED_REPORTS or SPLIT_SAME_INCIDENT_REPORTS says which stands (30270-1583 for 30270-1535), and an entry applies only to rows that hold its re-filing; other entities' duplicates never displace a helmer's report");

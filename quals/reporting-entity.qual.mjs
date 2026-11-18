// Every Reporting Entity in NHTSA's ADS files is one a human has classified
// (EXPECTED_HELMERS in data/slurp.py), and slurp stops on one that is not
// (2026-11-16; the human asked whether that stop should be relaxed when the
// Nov-16-2026 release brought "Bot Auto", and no qual covered it).
//
// Why the stop exists: scope is an exact match on three names (HELMER_SHORT:
// "Waymo LLC", "Tesla, Inc.", "Zoox, Inc."), so a report filed under any
// other name leaves every count without a message. If one of the three
// began filing under another name (Tesla's Texas registrations are under
// "Tesla Robotaxi LLC"; Volkswagen's subsidiary MOIA began filing under its
// own name with the Sep-15-2026 release), its crash count would stop growing
// and the page would show it getting safer. The list is the one place a new
// name is read by someone before its reports are dropped.
//
// Spec:
//   1. every entity that files a crash report in the newest snapshots is in
//      EXPECTED_HELMERS (so a release that brings a new one is red here until
//      it is classified);
//   2. the three in-scope names are on the list;
//   3. being listed is not being in scope: no report of any other entity is a
//      public-service incident;
//   4. slurp.main() stops on a crash report filed under a name that is not on
//      the list, naming that name, before it writes anything: for a copy of a
//      Waymo report under a new Waymo-like name and for one under an
//      unrelated new name alike (the stop does not guess which names matter);
//   5. the same copy under a listed out-of-scope name changes nothing: the
//      run ends as it does without the copy.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
# The rows main() checks an entity on: crash reports (not a negative filing)
# with a Same Incident ID and an Incident Date, counted here with this qual's
# own loop.
seen = collections.Counter()
for r in ROWS:
    if r['Report Type'].strip() in slurp.NEGATIVE_FILING_TYPES: continue
    if not r['Same Incident ID'].strip() or not r['Incident Date'].strip(): continue
    seen[r['Reporting Entity'].strip()] += 1
out = {'unlisted': {e: n for e, n in seen.items() if e not in slurp.EXPECTED_HELMERS},
       'entities': len(seen), 'listed': len(slurp.EXPECTED_HELMERS),
       'scopeUnlisted': sorted(set(slurp.HELMER_SHORT) - slurp.EXPECTED_HELMERS),
       'otherInScope': sorted({r['Report ID'] for r in _filed
                               if r['Reporting Entity'].strip() not in slurp.HELMER_SHORT
                               and slurp.is_public_service_incident(r)})[:20]}
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
t = template(D)
def outcome(res): return {'stop': res['stop'][:600], 'changed': res['changed'],
                          'count': len(res['incidents'] or [])}
out['baseline'] = outcome(run_main())
NAMES = {'renamed': 'Waymo Robotaxi LLC', 'unrelated': 'Qual Synthetic Freight Co'}
out['names'] = NAMES
for key, name in NAMES.items():
    assert name not in slurp.EXPECTED_HELMERS, name
    out[key] = outcome(run_main([clone(t, 'synthetic-entity-' + key, **{'Reporting Entity': name})]))
listed = 'Motional'
assert listed in slurp.EXPECTED_HELMERS and listed not in slurp.HELMER_SHORT
out['listedName'] = listed
out['listed_copy'] = outcome(run_main([clone(t, 'synthetic-entity-listed', **{
    'Reporting Entity': listed, 'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'})]))
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read the newest snapshots through data/slurp.py and run its main() offline with synthetic rows.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

assert.deepEqual(S.unlisted, {},
  `Replicata: list the Reporting Entity of every crash report (not a negative filing, with a Same Incident ID and an Incident Date) in the newest snapshots of NHTSA's ADS files.
Expectata: each is in EXPECTED_HELMERS in data/slurp.py, where a human classified it (data/README.md, Each NHTSA release, step 6).
Resultata: not listed, with their report rows: ${JSON.stringify(S.unlisted)}.`);
assert.deepEqual(S.scopeUnlisted, [],
  `Replicata: compare HELMER_SHORT's names with EXPECTED_HELMERS in data/slurp.py.
Expectata: every in-scope name is listed.
Resultata: not listed: ${JSON.stringify(S.scopeUnlisted)}.`);
assert.deepEqual(S.otherInScope, [],
  `Replicata: ask slurp.is_public_service_incident() about every crash report of an entity other than HELMER_SHORT's three in the newest snapshots.
Expectata: none counts (being on EXPECTED_HELMERS classifies an entity; it does not put it in scope).
Resultata: counted (first 20): ${JSON.stringify(S.otherInScope)}.`);
for (const key of Object.keys(S.names)) {
  const r = S[key], name = S.names[key];
  assert.ok(r.stop.includes(JSON.stringify(name).replaceAll('"', "'")) && r.changed.length === 0,
    `Replicata: run slurp.main() offline on the newest snapshots plus a copy of a Waymo crash report filed under the Reporting Entity ${JSON.stringify(name)}, which EXPECTED_HELMERS does not list.
Expectata: the run stops, naming that entity, and writes nothing (under an unlisted name the report would leave every count unseen).
Resultata: ${r.stop === "" ? `completed with ${r.count} incidents` : `stopped: ${JSON.stringify(r.stop.slice(0, 300))}`}; rewrote ${JSON.stringify(r.changed)}.`);
}
assert.deepEqual(S.listed_copy, S.baseline,
  `Replicata: run slurp.main() offline on the newest snapshots plus a copy of a Waymo crash report filed under ${JSON.stringify(S.listedName)}, a listed entity outside the page's scope, with an operator aboard.
Expectata: the run ends exactly as it does without the copy (the same stop, or the same incident count): the copy is read and counts nowhere.
Resultata: without the copy ${JSON.stringify(S.baseline)}; with it ${JSON.stringify(S.listed_copy)}.`);
console.log(`qual pass: all ${S.entities} reporting entities of the newest snapshots are classified (${S.listed} listed), none but Waymo, Tesla and Zoox is in scope, and slurp stops on an unlisted one`);

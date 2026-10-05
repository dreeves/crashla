// Guards the passenger-presence silent-misclassification class. The SGO "Were
// All Passengers Belted?" field (stored as `belted`) has two distinct
// no-passenger encodings — "No Passengers in Vehicle" and "Subject Vehicle - No
// Passenger In Vehicle". The old classifier recognized only the second, so 485
// no-passenger incidents were silently counted as "with passenger". The fields
// are now explicit sets (PAX_NONE / PAX_PRESENT / PAX_UNKNOWN); this qual asserts
// every `belted` value in the data is classified, and pins the regression.
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";

class Stub {
  constructor() { this.style = {}; this.dataset = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this.textContent = ""; this._innerHTML = ""; this.value = "0"; }
  appendChild(c) { return c; }
  replaceChildren() {} append() {} addEventListener() {} setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return new Stub(); }
  querySelectorAll() { return []; }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
}
const ctx = vm.createContext({
  console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date,
  document: { getElementById: () => new Stub(), createElement: () => new Stub(), body: new Stub(), addEventListener() {}, querySelector: () => new Stub() },
  window: { innerWidth: 1024, innerHeight: 768, addEventListener() {}, location: { search: "", href: "" }, history: { replaceState() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const none = new Set(vm.runInContext("[...PAX_NONE]", ctx));
const present = new Set(vm.runInContext("[...PAX_PRESENT]", ctx));
const unknown = new Set(vm.runInContext("[...PAX_UNKNOWN]", ctx));
const dataVals = vm.runInContext("[...new Set(INCIDENT_DATA.map(r => r.belted))]", ctx);

// --- COVERAGE: every belted value in the data is classified ----------------
for (const v of dataVals) {
  assert.ok(
    none.has(v) || present.has(v) || unknown.has(v),
    `Replicata: scan distinct INCIDENT_DATA \`belted\` values against PAX_NONE/PAX_PRESENT/PAX_UNKNOWN.
Expectata: every value is classified (else it silently falls into the "unknown" remainder, or — pre-fix — "with passenger").
Resultata: unclassified belted value ${JSON.stringify(v)}.`);
}

// --- DISJOINT: the three sets must not overlap -----------------------------
for (const v of none) assert.ok(!present.has(v) && !unknown.has(v), `Replicata: PAX_NONE ∩ others.\nExpectata: disjoint.\nResultata: ${JSON.stringify(v)} double-classified.`);
for (const v of present) assert.ok(!unknown.has(v), `Replicata: PAX_PRESENT ∩ PAX_UNKNOWN.\nExpectata: disjoint.\nResultata: ${JSON.stringify(v)} double-classified.`);

// --- REGRESSION: both no-passenger encodings must be no-passenger ----------
assert.ok(none.has("No Passengers in Vehicle"),
  `Replicata: check "No Passengers in Vehicle" classification.
Expectata: in PAX_NONE (it means no passenger — the 485-incident bug).
Resultata: not in PAX_NONE.`);
assert.ok(none.has("Subject Vehicle - No Passenger In Vehicle"),
  `Replicata: check "Subject Vehicle - No Passenger In Vehicle" classification.
Expectata: in PAX_NONE.
Resultata: not in PAX_NONE.`);

// --- TESLA: RIDERS, NOT THE MONITOR (2026-10-03, audit finding #10) -------
// Tesla files its in-car safety monitor as a passenger: monitor-only rides
// carry "Subject Vehicle - All Belted", so the field cannot tell a rider from
// the monitor. The Passenger presence table counts riders (the paragraph above
// it contrasts passenger miles with deadhead; the caveat below it treats the
// monitor as a separate person), and every Tesla narrative says whether a
// passenger was aboard ("Safety monitor was present and no passengers were
// inside the vehicle"). slurp.py's reviewed PASSENGER_OVERRIDE stores
// the narrative's answer. Cross-check every Tesla record against its own
// narrative's wording ("a passenger vehicle" is a crash partner, not a rider):
const SAYS_NONE = /\bno passengers?\b|\bdid not have any passengers?\b/i;
const SAYS_RIDER = /\b(?:one|two|three|a) passengers?\b(?! (?:vehicle|car))|\bmonitor and (?:(?:a|one|two|three) )?passengers?\b/i;
// JSON round-trip: arrays built in the vm realm fail deepStrictEqual.
const tesla = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.filter(r => r.helmer === "Tesla").map(r => ({id: r.reportId, belted: r.belted, narrative: r.narrative})))`, ctx));
const mismatch = [];
for (const r of tesla) {
  const says = SAYS_NONE.test(r.narrative) ? "none" : SAYS_RIDER.test(r.narrative) ? "rider" : "unstated";
  const coded = none.has(r.belted) ? "none" : present.has(r.belted) ? "rider" : "unknown";
  if (says !== coded) mismatch.push(`${r.id}: narrative ${says}, coded ${coded} (${JSON.stringify(r.belted)})`);
}
assert.deepEqual(mismatch, [],
  `Replicata: classify each Tesla incident's \`belted\` value (PAX sets) and compare it with what its narrative says about passengers.
Expectata: they agree: "no passengers" -> PAX_NONE, a stated passenger -> PAX_PRESENT (the safety monitor is not a passenger).
Resultata: ${JSON.stringify(mismatch, null, 1)}.`);
const riders = tesla.filter(r => present.has(r.belted)).map(r => r.id).sort();
assert.deepEqual(riders, ["13781-11687", "13781-13237", "13781-13644", "13781-13647", "13781-13648", "13781-14630", "13781-15342", "13781-16255"],
  `Replicata: list the Tesla incidents classified "with passenger".
Expectata: the 8 whose narratives state a rider aboard (8 of 23, 35%; the other 15 say no passengers).
Resultata: ${JSON.stringify(riders)}.`);

// slurp.py's guards on the map: an entry reviewed against a filed value that
// has since changed stops the run (a re-filing must be re-read); every
// in-scope Tesla report must have an entry, so a new Tesla report stops the
// run until someone reads its narrative; an entry for a report no longer in
// scope stops it too. The occupancy tripwire stops the run on an in-scope
// Waymo or Zoox report whose latest narrative says who was aboard against its
// filed code, unless the report is listed, and main() runs it.
const py = String.raw`
import csv, glob, importlib.util, json, pathlib, re, tempfile
spec = importlib.util.spec_from_file_location('slurp_pax', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
text = open('data/incidents.js').read()
start = text.index('/* INCIDENT_DATA_START */') + len('/* INCIDENT_DATA_START */')
incidents = json.loads(text[start:text.index('/* INCIDENT_DATA_END */')])
tesla = sorted(r['reportId'] for r in incidents if r['helmer'] == 'Tesla')
def raises(fn, *a):
    try: fn(*a); return False
    except AssertionError: return True
out = {
  'mapCoversTesla': set(tesla) <= set(slurp.PASSENGER_OVERRIDE),
  'exactPasses': not raises(slurp.check_passengers_reviewed, incidents),
  'missingTrips': raises(slurp.check_passengers_reviewed, incidents + [dict(incidents[0], reportId='synthetic-tesla', helmer='Tesla')]),
  'staleTrips': raises(slurp.check_passengers_reviewed, [r for r in incidents if r['reportId'] != tesla[0]]),
  'staleZooxTrips': raises(slurp.check_passengers_reviewed, [r for r in incidents if r['reportId'] != '30610-15826']),
  'monitorOnly': slurp.reviewed_belted('13781-11375', 'Subject Vehicle - All Belted'),
  'refiledTrips': raises(slurp.reviewed_belted, '13781-11375', 'Unknown'),
  'otherUnchanged': slurp.reviewed_belted('30270-11302', 'Subject Vehicle - All Belted'),
  'zoox15826': list(slurp.PASSENGER_OVERRIDE.get('30610-15826', ())),
  'zooxRefiledTrips': raises(slurp.reviewed_belted, '30610-15826', 'Subject Vehicle - All Belted'),
}
# The tripwire on synthetic rows: one positive per wording, both directions
base = {'Reporting Entity': 'Zoox, Inc.', 'Driver / Operator Type': 'None', 'Report ID': 'synthetic-occupancy',
        'Were All Passengers Belted?': 'Subject Vehicle - No Passenger In Vehicle'}
belted = 'Subject Vehicle - All Belted'
out['trips'] = {
  'occupiedCodedNone': raises(slurp.check_occupancy_classified, dict(base, Narrative='An occupied Zoox autonomous vehicle was stopped at a light.')),
  'unoccupiedCodedBelted': raises(slurp.check_occupancy_classified, dict(base, **{'Were All Passengers Belted?': belted}, Narrative='An unoccupied Zoox vehicle in autonomy was stopped.')),
  'waymoNoOccupantsCodedBelted': raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC', 'Were All Passengers Belted?': belted}, Narrative='The Waymo AV, which had no occupants, was stopped.')),
  'occupiedCodedUnknown': raises(slurp.check_occupancy_classified, dict(base, **{'Were All Passengers Belted?': 'Unknown'}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
}
out['passes'] = {
  'occupiedCodedBelted': not raises(slurp.check_occupancy_classified, dict(base, **{'Were All Passengers Belted?': belted}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
  'unoccupiedCodedNone': not raises(slurp.check_occupancy_classified, dict(base, Narrative='An unoccupied Zoox autonomous vehicle was stopped.')),
  'laneOccupied': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='A bus crossed into the lane occupied by the Waymo AV.')),
  'passengerExited': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='After the passenger in the Waymo AV had exited, a car struck it.')),
  'listed': not raises(slurp.check_occupancy_classified, dict(base, **{'Report ID': '30610-15826'}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
  'outOfScope': not raises(slurp.check_occupancy_classified, dict(base, **{'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
}
# Calibration: every in-scope Waymo/Zoox report's latest narrative in the
# newest snapshots, with the filed code
rows = []
for path, is_archive in [(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], False),
                         (sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(path, newline='')):
        if is_archive: slurp._normalize_archive_row(r)
        rows.append(r)
latest = {}
for r in slurp.filed_incident_rows(rows):
    if r['Reporting Entity'].strip() in ('Waymo LLC', 'Zoox, Inc.') and slurp.operator_in_scope(r):
        k, v = r['Report ID'], int(r['Report Version'])
        if k not in latest or v > int(latest[k]['Report Version']): latest[k] = r
out['unclassified'] = sorted(k for k, r in latest.items() if raises(slurp.check_occupancy_classified, r))
out['flagged'] = sorted(k for k, r in latest.items() if raises(slurp.check_occupancy_classified, dict(r, **{'Report ID': 'probe'})))
listed = set(slurp.PASSENGER_OVERRIDE) | set(slurp.OCCUPANCY_LANGUAGE_REVIEWED)
out['listedNotFlagged'] = sorted(k for k in listed if k in latest and k not in out['flagged'])
out['reviewedKept'] = sorted(slurp.OCCUPANCY_LANGUAGE_REVIEWED)
# main() runs the tripwire: the snapshots plus one unlisted in-scope Zoox row,
# a copy of a 2025 report saying "unoccupied" (outside every observation
# table; filed once, so the copy is its own version-1 filing), filed with a
# belted passenger
template = min((r for r in latest.values() if r['Reporting Entity'].strip() == 'Zoox, Inc.'
                and r['Incident Date'].strip().endswith('-2025') and r['Driver / Operator Type'].strip() == 'None'
                and r['Report Version'].strip() == '1' and re.search(r'\bunoccupied\s+Zoox', r['Narrative'])),
               key=lambda r: r['Report ID'])
synth = dict(template, **{'Report ID': 'synthetic-occupancy', 'Same Incident ID': 'synthetic-occupancy',
                          'Were All Passengers Belted?': belted})
headers = {slurp.NHTSA_ADS_CSV_URL: ('Tue, 15 Sep 2026 12:00:00 GMT', None), slurp.NHTSA_ADS_ARCHIVE_URL: ('Tue, 15 Sep 2026 12:00:00 GMT', None)}
slurp.fetch_nhtsa_csv = lambda stamp: (rows + [synth], headers)
slurp.sync_fault_csvs = lambda master_rows: None
with tempfile.TemporaryDirectory() as d:
    d = pathlib.Path(d)
    (d / 'incidents.js').write_text(text); (d / 'vmt.js').write_text(open('data/vmt.js').read())
    slurp.INCIDENT_JS = d / 'incidents.js'; slurp.VMT_JS = d / 'vmt.js'
    try: slurp.main(); out['main'] = ''
    except AssertionError as e: out['main'] = str(e)
out['template'] = template['Report ID']
# The tripwire reads each in-scope code through PAX_CLASS: a code crashla.js
# does not classify must stop the run, not default to "with passenger"
out['paxClass'] = slurp.PAX_CLASS
try:
    slurp.check_occupancy_classified(dict(base, **{'Were All Passengers Belted?': 'Subject Vehicle - Novel Code'}, Narrative='A car struck the stopped AV.'))
    out['novelCode'] = ''
except (AssertionError, KeyError) as e:
    out['novelCode'] = type(e).__name__ + ': ' + str(e)
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { encoding: "utf8" });
assert.equal(run.status, 0, `Replicata: load data/slurp.py and exercise its passenger guards.
Expectata: PASSENGER_OVERRIDE, reviewed_belted(), check_passengers_reviewed() and check_occupancy_classified() exist and run.
Resultata: exit ${run.status}; ${run.stderr.slice(-800)}`);
const g = JSON.parse(run.stdout.trim().split("\n").at(-1));
const {trips, passes, unclassified, flagged, listedNotFlagged, reviewedKept, main, template, paxClass, novelCode, ...guards} = g;
assert.deepEqual(guards, {
  mapCoversTesla: true, exactPasses: true, missingTrips: true, staleTrips: true, staleZooxTrips: true,
  monitorOnly: "Subject Vehicle - No Passenger In Vehicle", refiledTrips: true,
  otherUnchanged: "Subject Vehicle - All Belted",
  zoox15826: ["Subject Vehicle - No Passenger In Vehicle", "Subject Vehicle - Passenger In Vehicle, Belt Use Not Stated"],
  zooxRefiledTrips: true,
}, `Replicata: exercise slurp.py's passenger guards on data/incidents.js and synthetic variants.
Expectata: every in-scope Tesla report has a PASSENGER_OVERRIDE entry; an unlisted Tesla report, or an entry (Tesla or Zoox) whose report is no longer in scope, stops the run; a monitor-only "All Belted" filing becomes the no-passenger code; a filing re-filed with a different value stops the run; Zoox 30610-15826 (filed no passenger, "An occupied Zoox autonomous vehicle") stores a passenger, belt use not stated; unlisted values pass through unchanged.
Resultata: ${JSON.stringify(guards)}.`);
const silent = Object.entries(trips).filter(([, t]) => !t).map(([k]) => k);
assert.deepEqual(silent, [],
  `Replicata: call slurp.py's check_occupancy_classified on unlisted in-scope reports whose narrative says who was aboard against their filed code ("occupied" filed no passenger or Unknown, "unoccupied" or Waymo's "had no occupants" filed with a belted passenger).
Expectata: each one stops the run.
Resultata: passed silently: ${JSON.stringify(silent)}.`);
const tripped = Object.entries(passes).filter(([, p]) => !p).map(([k]) => k);
assert.deepEqual(tripped, [],
  `Replicata: call check_occupancy_classified on reports that agree with their code, say nothing about the AV's own occupancy ("the lane occupied by the Waymo AV", a passenger who had exited), are listed (30610-15826), or are out of scope.
Expectata: none stops the run.
Resultata: stopped on ${JSON.stringify(tripped)}.`);
assert.deepEqual({unclassified, listedNotFlagged, flags15826: flagged.includes("30610-15826")},
  {unclassified: [], listedNotFlagged: [], flags15826: true},
  `Replicata: run the occupancy tripwire over every in-scope Waymo and Zoox report's latest narrative in the newest snapshots, as filed and with each report unlisted.
Expectata: nothing unclassified; the disagreement the calibration found (30610-15826) is one the tripwire flags; and every Waymo or Zoox report classified in PASSENGER_OVERRIDE or OCCUPANCY_LANGUAGE_REVIEWED is one it flags (so no wording the classifications rest on can drop out of the pattern unnoticed).
Resultata: unclassified ${JSON.stringify(unclassified)}, flagged ${JSON.stringify(flagged)}, classified but not flagged ${JSON.stringify(listedNotFlagged)}.`);
assert.match(main, /says who was aboard/,
  `Replicata: run slurp.main() offline on the snapshots plus one unlisted in-scope Zoox row (a 2025 copy of ${template}, "An unoccupied Zoox ... vehicle") filed "Subject Vehicle - All Belted".
Expectata: main() stops with the occupancy tripwire's message (the guard is wired in, not just defined).
Resultata: ${JSON.stringify(main.slice(0, 300))}.`);
// slurp.py's PAX_CLASS classifies a passenger code exactly as crashla.js's
// PAX_NONE / PAX_PRESENT / PAX_UNKNOWN do, and a code in none of them stops
// the run instead of defaulting to "with passenger", the 485-incident bug
// class this qual guards (second audit's review of #33, 2026-10-04).
const appClass = Object.fromEntries([
  ...[...none].map(v => [v, "none"]), ...[...present].map(v => [v, "present"]), ...[...unknown].map(v => [v, "unknown"])]);
assert.deepEqual(paxClass, appClass,
  `Replicata: compare data/slurp.py's PAX_CLASS with crashla.js's PAX_NONE, PAX_PRESENT and PAX_UNKNOWN.
Expectata: the same codes, each in the same class.
Resultata: slurp ${JSON.stringify(paxClass)}; app ${JSON.stringify(appClass)}.`);
assert.match(novelCode, /^AssertionError: unexpected passenger code/,
  `Replicata: call check_occupancy_classified on an in-scope report filed with a passenger code crashla.js does not classify ("Subject Vehicle - Novel Code").
Expectata: it stops the run naming the code (crashla.js would count it in the Unknown remainder).
Resultata: ${novelCode === "" ? "accepted" : JSON.stringify(novelCode.slice(0, 300))}.`);

// --- WAYMO AND ZOOX: THE NARRATIVE'S OCCUPANCY (second audit, 2026-10-04, #33)
// Zoox opens nearly every narrative with "An occupied Zoox autonomous vehicle"
// or "An unoccupied Zoox (autonomous) vehicle"; 30610-15826 (JUN-2026 San
// Francisco) says "An occupied Zoox autonomous vehicle" but was filed "Subject
// Vehicle - No Passenger In Vehicle", so Passenger presence read Zoox 37%
// where its narratives give 39%. slurp.py's PASSENGER_OVERRIDE (one map for
// every helmer, generalized from TESLA_PASSENGER_OVERRIDE) stores a passenger
// for it, and an occupancy tripwire stops the run on a new disagreement.
// Waymo states its car's occupancy once ("The Waymo AV, which had no
// occupants", 30270-9724). Cross-check every Waymo and Zoox record that uses
// that wording against its own code (except reports listed in slurp.py's
// OCCUPANCY_LANGUAGE_REVIEWED, whose filed code stands by review):
const OCC_NONE = /\bunoccupied\s+(?:Zoox|Waymo)\b|\bhad\s+no\s+occupants\b/i;
const OCC_PRESENT = /\boccupied\s+(?:Zoox|Waymo)\b/i;
const others = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.filter(r => r.helmer !== "Tesla").map(r => ({id: r.reportId, helmer: r.helmer, belted: r.belted, narrative: r.narrative})))`, ctx));
const occMismatch = [];
let occStated = 0;
for (const r of others.filter(r => !reviewedKept.includes(r.id))) {
  const says = [OCC_NONE.test(r.narrative) && "none", OCC_PRESENT.test(r.narrative) && "rider"].filter(Boolean);
  if (says.length === 0) continue;
  occStated += 1;
  const coded = none.has(r.belted) ? "none" : present.has(r.belted) ? "rider" : "unknown";
  if (says.length !== 1 || says[0] !== coded) occMismatch.push(`${r.helmer} ${r.id}: narrative ${says.join("+")}, coded ${coded} (${JSON.stringify(r.belted)})`);
}
assert.deepEqual(occMismatch, [],
  `Replicata: for each Waymo and Zoox incident whose narrative says "occupied"/"unoccupied" of the AV, or that it "had no occupants", compare its \`belted\` class with that statement.
Expectata: they agree ("An occupied Zoox autonomous vehicle" -> PAX_PRESENT; "unoccupied" or "had no occupants" -> PAX_NONE).
Resultata: ${JSON.stringify(occMismatch, null, 1)}.`);
const z15826 = others.find(r => r.id === "30610-15826");
assert.ok(z15826 !== undefined && present.has(z15826.belted),
  `Replicata: read Zoox 30610-15826 (JUN-2026 San Francisco, "An occupied Zoox autonomous vehicle was stopped at a traffic light") from data/incidents.js.
Expectata: counted with a passenger (PAX_PRESENT), via slurp.py's PASSENGER_OVERRIDE.
Resultata: ${z15826 === undefined ? "row missing" : JSON.stringify(z15826.belted)}.`);

console.log(`qual pass: all ${dataVals.length} distinct belted values are classified (PAX_NONE/PAX_PRESENT/PAX_UNKNOWN), disjoint, with both no-passenger encodings counted as no-passenger; Tesla's ${tesla.length} records count riders as their narratives state (${riders.length} with a passenger); ${occStated} Waymo/Zoox records that state their AV's occupancy agree with their codes; guarded in slurp.py`);

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
// narrative's wording ("a passenger vehicle" is a crash partner, not a rider).
// Tesla's narratives since August 2026 also say "rider(s)" ("The ADS had no
// riders in the vehicle", "one rider present"; its Oct-18-2026 spreadsheet,
// six reports due in NHTSA's next release), the same statement in other
// words, so both words count (audit 2026-10-30, R3):
const SAYS_NONE = /\bno (?:passengers?|riders?)\b|\bdid not have any passengers?\b/i;
const SAYS_RIDER = /\b(?:one|two|three|a) (?:passengers?|riders?)\b(?! (?:vehicle|car))|\bmonitor and (?:(?:a|one|two|three) )?passengers?\b/i;
// JSON round-trip: arrays built in the vm realm fail deepStrictEqual.
const tesla = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.filter(r => r.helmer === "Tesla").map(r => ({id: r.reportId, belted: r.belted, narrative: r.narrative})))`, ctx));
// What a narrative says about riders and what a code says, on one scale. A
// narrative that says nothing about who was aboard agrees only with an Unknown
// code, which the reviewed map stores for it (the human, 2026-11-02, open
// question 18; 13781-16941, due in the ~Nov 16, 2026 release, is the first).
const narrativeSays = n => SAYS_NONE.test(n) ? "none" : SAYS_RIDER.test(n) ? "rider" : "unknown";
const codeSays = b => none.has(b) ? "none" : present.has(b) ? "rider" : "unknown";
const SILENT = "The Tesla ADS was stopped when a passenger car made contact with the rear of the vehicle.";
for (const [code, agrees] of [["Unknown", true], ["Subject Vehicle - All Belted", false], ["Subject Vehicle - No Passenger In Vehicle", false]]) {
  assert.equal(narrativeSays(SILENT) === codeSays(code), agrees,
    `Replicata: classify a Tesla narrative that says nothing about who was aboard (${JSON.stringify(SILENT)}) and the code ${JSON.stringify(code)}.
Expectata: they agree exactly when the code is Unknown (open question 18's rule).
Resultata: narrative ${narrativeSays(SILENT)}, code ${codeSays(code)}.`);
}
const mismatch = [];
for (const r of tesla) {
  const says = narrativeSays(r.narrative), coded = codeSays(r.belted);
  if (says !== coded) mismatch.push(`${r.id}: narrative ${says}, coded ${coded} (${JSON.stringify(r.belted)})`);
}
assert.deepEqual(mismatch, [],
  `Replicata: classify each Tesla incident's \`belted\` value (PAX sets) and compare it with what its narrative says about passengers.
Expectata: they agree: "no passengers" -> PAX_NONE, a stated passenger -> PAX_PRESENT (the safety monitor is not a passenger).
Resultata: ${JSON.stringify(mismatch, null, 1)}.`);
// Which Tesla reports carry a rider is checked against slurp.py's reviewed
// map below, after the map is read (until 2026-10-31 this was a hand-kept list
// of the 9 Report IDs, re-pinned at every release that brought a rider).
const riders = tesla.filter(r => present.has(r.belted)).map(r => r.id).sort();

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
  'waymo16828': list(slurp.PASSENGER_OVERRIDE.get('30270-16828', ())),
}
# One stop lists every entry reviewed against another filed value (audit
# 2026-11-20, A46): two changed entries among four reports, then none.
def stop_of(fn, *a):
    try: fn(*a); return ''
    except AssertionError as e: return str(e)
check_reviews = getattr(slurp, 'check_passenger_reviews', None)
out['reviewStops'] = {'two': 'data/slurp.py has no check_passenger_reviews', 'none': 'data/slurp.py has no check_passenger_reviews'} if check_reviews is None else {
  'two': stop_of(check_reviews, {'13781-11375': 'Unknown', '30610-15826': 'Subject Vehicle - All Belted',
                                  '13781-11507': 'Unknown', '30270-11302': 'Subject Vehicle - All Belted'}),
  'none': stop_of(check_reviews, {'13781-11375': 'Subject Vehicle - All Belted', '13781-11507': 'Unknown', '30270-11302': 'Unknown'}),
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
  # a passenger who was not belted was aboard (audit 2026-11-20, A40)
  'notBeltedCodedNone': raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='The Waymo AV sustained damage. The passenger in the Waymo AV was not belted at the time of the collision as they were preparing to exit the vehicle.')),
  'unbeltedCodedUnknown': raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC', 'Were All Passengers Belted?': 'Unknown'}, Narrative='A passenger in the Waymo AV was unbelted at the time of the collision.')),
  'noSeatBeltCodedNone': raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='The ADS was engaged in autonomous mode, and the three passengers in the Waymo AV were not wearing seatbelts.')),
}
out['passes'] = {
  'occupiedCodedBelted': not raises(slurp.check_occupancy_classified, dict(base, **{'Were All Passengers Belted?': belted}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
  'unoccupiedCodedNone': not raises(slurp.check_occupancy_classified, dict(base, Narrative='An unoccupied Zoox autonomous vehicle was stopped.')),
  'laneOccupied': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='A bus crossed into the lane occupied by the Waymo AV.')),
  'passengerExited': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='After the passenger in the Waymo AV had exited, a car struck it.')),
  'listed': not raises(slurp.check_occupancy_classified, dict(base, **{'Report ID': '30610-15826'}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
  'notBeltedCodedNotBelted': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC', 'Were All Passengers Belted?': 'Subject Vehicle - Not Belted - see Narrative'}, Narrative='The passenger in the Waymo AV was not belted at the time of the collision.')),
  'notBeltedListed': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC', 'Report ID': '30270-16828'}, Narrative='The passenger in the Waymo AV was not belted at the time of the collision.')),
  'beltline': not raises(slurp.check_occupancy_classified, dict(base, **{'Reporting Entity': 'Waymo LLC'}, Narrative='The Waymo AV approached the Westside Beltline Connector trail.')),
  'outOfScope': not raises(slurp.check_occupancy_classified, dict(base, **{'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}, Narrative='An occupied Zoox autonomous vehicle was stopped.')),
}
# Calibration: every in-scope Waymo/Zoox report's latest narrative in the
# newest snapshots, with the filed code
rows = slurp.newest_snapshot_rows()
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
template_from = [r for r in latest.values() if r['Reporting Entity'].strip() == 'Zoox, Inc.'
                 and r['Incident Date'].strip().endswith('-2025') and r['Driver / Operator Type'].strip() == 'None'
                 and r['Report Version'].strip() == '1' and re.search(r'\bunoccupied\s+Zoox', r['Narrative'])]
# The report is read, never assumed (until 2026-11-06 none stopped this qual on
# a bare ValueError from min(), naming nothing).
assert template_from, ("Replicata: find, in the newest snapshots' latest filings (quals/passenger-classification.qual.mjs), a driverless "
                       "('None') Zoox report of 2025, filed once, whose narrative says 'unoccupied Zoox'. "
                       "Expectata: at least one, the template of this qual's synthetic report with a belted passenger. Resultata: none.")
template = min(template_from, key=lambda r: r['Report ID'])
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
out['paxMap'] = {k: list(v) for k, v in slurp.PASSENGER_OVERRIDE.items()}
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
const {trips, passes, unclassified, flagged, listedNotFlagged, reviewedKept, main, template, paxClass, novelCode, paxMap, reviewStops, ...guards} = g;

// The incidents counted with a rider are the ones the reviewed map stores a
// rider for (decision #57b, 2026-10-04: derived from PASSENGER_OVERRIDE, the
// point where each new Tesla report's narrative is read, instead of a list of
// Report IDs re-pinned at every release). For every helmer, among the reports
// the map covers (every in-scope Tesla report, above), those data/incidents.js
// counts with a passenger are exactly those whose stored code the map makes a
// passenger code, and every covered report stores the map's code.
const stored = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.map(r => ({id: r.reportId, helmer: r.helmer, belted: r.belted})))`, ctx));
const storedById = new Map(stored.map(r => [r.id, r]));
const mapDisagrees = Object.entries(paxMap).filter(([id, [, applied]]) => storedById.get(id)?.belted !== applied)
  .map(([id, [, applied]]) => `${id}: map ${JSON.stringify(applied)}, stored ${JSON.stringify(storedById.get(id)?.belted)}`);
const riderSets = [...new Set(stored.map(r => r.helmer))].sort().map(helmer => ({
  helmer,
  map: Object.entries(paxMap).filter(([id, [, applied]]) => storedById.get(id)?.helmer === helmer && paxClass[applied] === "present").map(([id]) => id).sort(),
  shown: stored.filter(r => r.helmer === helmer && r.id in paxMap && present.has(r.belted)).map(r => r.id).sort(),
})).filter(s => JSON.stringify(s.map) !== JSON.stringify(s.shown));
assert.deepEqual({ mapDisagrees, riderSets }, { mapDisagrees: [], riderSets: [] },
  `Replicata: compare data/incidents.js's passenger codes with slurp.py's reviewed PASSENGER_OVERRIDE, entry by entry and as each helmer's set of reports counted with a rider.
Expectata: every covered report stores the map's code, and for each helmer the covered reports counted with a passenger are the ones the map gives a passenger code.
Resultata: ${JSON.stringify({ mapDisagrees, riderSets })}.`);
assert.deepEqual(guards, {
  mapCoversTesla: true, exactPasses: true, missingTrips: true, staleTrips: true, staleZooxTrips: true,
  monitorOnly: "Subject Vehicle - No Passenger In Vehicle", refiledTrips: true,
  otherUnchanged: "Subject Vehicle - All Belted",
  zoox15826: ["Subject Vehicle - No Passenger In Vehicle", "Subject Vehicle - Passenger In Vehicle, Belt Use Not Stated"],
  zooxRefiledTrips: true,
  waymo16828: ["Subject Vehicle - No Passenger In Vehicle", "Subject Vehicle - Not Belted - see Narrative"],
}, `Replicata: exercise slurp.py's passenger guards on data/incidents.js and synthetic variants.
Expectata: every in-scope Tesla report has a PASSENGER_OVERRIDE entry; an unlisted Tesla report, or an entry (Tesla or Zoox) whose report is no longer in scope, stops the run; a monitor-only "All Belted" filing becomes the no-passenger code; a filing re-filed with a different value stops the run; Zoox 30610-15826 (filed no passenger, "An occupied Zoox autonomous vehicle") stores a passenger, belt use not stated; Waymo 30270-16828 (filed no passenger, "The passenger in the Waymo AV was not belted at the time of the collision") stores an unbelted passenger; unlisted values pass through unchanged.
Resultata: ${JSON.stringify(guards)}.`);
// One stop for every entry reviewed against another filed value (2026-11-21,
// audit finding A46 of 2026-11-20). At the release that publishes Tesla's
// preprints NHTSA's rows carry a filed code where each preprint's entry was
// reviewed against the list's blank: until then the run stopped on one report
// a run, under a message that named a re-filing only. The stop names both
// steps of data/README.md's release checklist that bring it: a re-filing's
// (6) and a replaced preprint's (7).
assert.ok(["13781-11375", "30610-15826"].every(id => reviewStops.two.includes(id)) && !reviewStops.two.includes("13781-11507") &&
    !reviewStops.two.includes("30270-11302") && /Each NHTSA release, step 6/.test(reviewStops.two) && /step 7/.test(reviewStops.two) && reviewStops.none === "",
  `Replicata: call slurp.py's check_passenger_reviews with four reports' filed passenger values: 13781-11375 and 30610-15826 changed from the values their PASSENGER_OVERRIDE entries were reviewed against, 13781-11507 as reviewed, and 30270-11302, which has no entry; then with none changed.
Expectata: one stop naming both changed reports and neither of the others, and both steps of data/README.md's "Each NHTSA release" that cover it (6, a re-filing; 7, NHTSA's row in a preprint's place); no stop when none changed.
Resultata: ${JSON.stringify({ two: reviewStops.two.slice(0, 700), none: reviewStops.none.slice(0, 300) })}.`);
const silent = Object.entries(trips).filter(([, t]) => !t).map(([k]) => k);
assert.deepEqual(silent, [],
  `Replicata: call slurp.py's check_occupancy_classified on unlisted in-scope reports whose narrative says who was aboard against their filed code ("occupied" filed no passenger or Unknown, "unoccupied" or Waymo's "had no occupants" filed with a belted passenger, a passenger "not belted", "unbelted" or "not wearing seatbelts" filed no passenger or Unknown).
Expectata: each one stops the run.
Resultata: passed silently: ${JSON.stringify(silent)}.`);
const tripped = Object.entries(passes).filter(([, p]) => !p).map(([k]) => k);
assert.deepEqual(tripped, [],
  `Replicata: call check_occupancy_classified on reports that agree with their code (a passenger "not belted" filed with a passenger code among them), say nothing about the AV's own occupancy ("the lane occupied by the Waymo AV", a passenger who had exited, the "Beltline" trail), are listed (30610-15826, 30270-16828), or are out of scope.
Expectata: none stops the run.
Resultata: stopped on ${JSON.stringify(tripped)}.`);
assert.deepEqual({unclassified, listedNotFlagged, flags15826: flagged.includes("30610-15826"), flags16828: flagged.includes("30270-16828")},
  {unclassified: [], listedNotFlagged: [], flags15826: true, flags16828: true},
  `Replicata: run the occupancy tripwire over every in-scope Waymo and Zoox report's latest narrative in the newest snapshots, as filed and with each report unlisted.
Expectata: nothing unclassified; the disagreements the calibrations found (30610-15826, "An occupied Zoox autonomous vehicle" filed no passenger; 30270-16828, "The passenger in the Waymo AV was not belted" filed no passenger) are ones the tripwire flags; and every Waymo or Zoox report classified in PASSENGER_OVERRIDE or OCCUPANCY_LANGUAGE_REVIEWED is one it flags (so no wording the classifications rest on can drop out of the pattern unnoticed).
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
// Since 2026-11-21 (audit 2026-11-20, A40) also a narrative that says a
// passenger was not belted: 30270-16828 (SEP-2026 Austin) says "The passenger
// in the Waymo AV was not belted at the time of the collision" and was filed
// "Subject Vehicle - No Passenger In Vehicle".
const OCC_PRESENT = /\boccupied\s+(?:Zoox|Waymo)\b|\bnot\s+belted\b|\bunbelted\b|\bnot\s+wearing\s+(?:a\s+)?seat\s*-?\s*belts?\b/i;
// A second AV's record (secondOf: data/slurp.py SECOND_INVOLVEMENTS) is left
// out: it carries its report's narrative, which speaks of the reporting AV's
// passengers (30270-11224: "The passenger in the moving Waymo AV was not
// belted", the stopped Waymo's own code Unknown), under the passenger code
// its reviewed entry gives; the report's own record is read.
const others = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.filter(r => r.helmer !== "Tesla" && r.secondOf === undefined).map(r => ({id: r.reportId, helmer: r.helmer, belted: r.belted, narrative: r.narrative})))`, ctx));
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
  `Replicata: for each Waymo and Zoox incident whose narrative says "occupied"/"unoccupied" of the AV, that it "had no occupants", or that a passenger was "not belted", "unbelted" or "not wearing" a seat belt, compare its \`belted\` class with that statement.
Expectata: they agree ("An occupied Zoox autonomous vehicle" or an unbelted passenger -> PAX_PRESENT; "unoccupied" or "had no occupants" -> PAX_NONE).
Resultata: ${JSON.stringify(occMismatch, null, 1)}.`);
const z15826 = others.find(r => r.id === "30610-15826");
assert.ok(z15826 !== undefined && present.has(z15826.belted),
  `Replicata: read Zoox 30610-15826 (JUN-2026 San Francisco, "An occupied Zoox autonomous vehicle was stopped at a traffic light") from data/incidents.js.
Expectata: counted with a passenger (PAX_PRESENT), via slurp.py's PASSENGER_OVERRIDE.
Resultata: ${z15826 === undefined ? "row missing" : JSON.stringify(z15826.belted)}.`);

const w16828 = others.find(r => r.id === "30270-16828");
assert.ok(w16828 !== undefined && present.has(w16828.belted),
  `Replicata: read Waymo 30270-16828 (SEP-2026 Austin, "The passenger in the Waymo AV was not belted at the time of the collision as they were preparing to exit the vehicle") from data/incidents.js.
Expectata: counted with a passenger (PAX_PRESENT), via slurp.py's PASSENGER_OVERRIDE.
Resultata: ${w16828 === undefined ? "row missing" : JSON.stringify(w16828.belted)}.`);

console.log(`qual pass: all ${dataVals.length} distinct belted values are classified (PAX_NONE/PAX_PRESENT/PAX_UNKNOWN), disjoint, with both no-passenger encodings counted as no-passenger; Tesla's ${tesla.length} records count riders as their narratives state (${riders.length} with a passenger); ${occStated} Waymo/Zoox records that state their AV's occupancy agree with their codes; guarded in slurp.py`);

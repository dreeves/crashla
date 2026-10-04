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
// inside the vehicle"). slurp.py's reviewed TESLA_PASSENGER_OVERRIDE stores
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

// slurp.py's two guards on the map: an entry reviewed against a filed value
// that has since changed stops the run (a re-filing must be re-read), and the
// map must cover exactly the in-scope Tesla reports, so a new Tesla report
// stops the run until someone reads its narrative.
const py = String.raw`
import importlib.util, json, re
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
  'mapCoversTesla': sorted(slurp.TESLA_PASSENGER_OVERRIDE) == tesla,
  'exactPasses': not raises(slurp.check_tesla_passengers_reviewed, incidents),
  'missingTrips': raises(slurp.check_tesla_passengers_reviewed, incidents + [dict(incidents[0], reportId='synthetic-tesla', helmer='Tesla')]),
  'staleTrips': raises(slurp.check_tesla_passengers_reviewed, [r for r in incidents if r['reportId'] != tesla[0]]),
  'monitorOnly': slurp.reviewed_belted('13781-11375', 'Subject Vehicle - All Belted'),
  'refiledTrips': raises(slurp.reviewed_belted, '13781-11375', 'Unknown'),
  'otherUnchanged': slurp.reviewed_belted('30270-11302', 'Subject Vehicle - All Belted'),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { encoding: "utf8" });
assert.equal(run.status, 0, `Replicata: load data/slurp.py and exercise its Tesla passenger guards.
Expectata: TESLA_PASSENGER_OVERRIDE, reviewed_belted() and check_tesla_passengers_reviewed() exist and run.
Resultata: exit ${run.status}; ${run.stderr.slice(-800)}`);
const g = JSON.parse(run.stdout.trim().split("\n").at(-1));
assert.deepEqual(g, {
  mapCoversTesla: true, exactPasses: true, missingTrips: true, staleTrips: true,
  monitorOnly: "Subject Vehicle - No Passenger In Vehicle", refiledTrips: true,
  otherUnchanged: "Subject Vehicle - All Belted",
}, `Replicata: exercise slurp.py's Tesla passenger guards on data/incidents.js and synthetic variants.
Expectata: the map covers exactly the in-scope Tesla reports; an unlisted Tesla report or a stale entry stops the run; a monitor-only "All Belted" filing becomes the no-passenger code; a filing re-filed with a different value stops the run; other helmers' values pass through unchanged.
Resultata: ${JSON.stringify(g)}.`);

console.log(`qual pass: all ${dataVals.length} distinct belted values are classified (PAX_NONE/PAX_PRESENT/PAX_UNKNOWN), disjoint, with both no-passenger encodings counted as no-passenger; Tesla's ${tesla.length} records count riders as their narratives state (${riders.length} with a passenger), guarded in slurp.py`);

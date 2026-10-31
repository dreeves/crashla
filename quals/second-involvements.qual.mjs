// Each AV involved counts (decision #47, the human's answer of 2026-10-04,
// "Each AV involved"; implemented 2026-10-31): a crash between two of a
// helmer's AVs counts once per AV, like the crashed-vehicle human benchmarks
// and Waymo's own crash list (Safety Impact hub CSV2, through Jun 2026, lists
// each of the reports below twice). Two AVs that each filed a report
// (30270-16207 and -16174, Atlanta, AUG-2026) already counted twice; until
// 2026-10-31 a crash one report filed for both AVs counted once.
//
// Spec: data/slurp.py's SECOND_INVOLVEMENTS lists each such report with the
// narrative's words naming the second AV, and slurp adds a record for that AV
// (Report ID + "-B"): the report's crash-level fields (date, time, place,
// road, severity, airbag, vehicles involved, narrative) as stored for the
// report, the second AV's own fields as its narrative gives them (below),
// `secondOf` naming the report, and its own data/faultfrac.csv row. A
// narrative tripwire stops the run on an in-scope report that names a second
// AV of its company until a human classifies it (SECOND_INVOLVEMENTS, or
// SECOND_AV_REVIEWED with the reason). The incident browser marks the second
// AV's row, so it does not read as a duplicate filing of the same narrative.
//
// 30270-11224 (Mesa, JUN-2025) is held for the human: its narrative says both
// Waymos' ADS were engaged and both were damaged, but hub CSV2 lists it once.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";
import { appScript } from "./load-app.mjs";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

// The second AV of each report, as its narrative gives it (2026-10-31), and
// its fault value (the 2026-10-31 adjudication under the locked criterion).
const PAX_UNKNOWN = "Unknown";
const WANT = {
  // parked for its own dropoff; the doored cyclist fell into its passenger side
  "30270-9987": { speed: 0, svMovement: "Parked", cpMovement: "Proceeding Straight", crashWith: "Non-Motorist: Cyclist",
                  belted: PAX_UNKNOWN, svHit: "right", cpHit: "", faultfrac: 0 },
  // reversing out of the stall beside the first Waymo, which pulled forward into its right side
  "30270-11424": { speed: null, svMovement: "Backing", cpMovement: "Proceeding Straight", crashWith: "SUV",
                   belted: PAX_UNKNOWN, svHit: "right", cpHit: "front left", faultfrac: 0.3 },
  // stopped in the red-light queue behind the first Waymo; the careening car's left side hit it
  "30270-13817": { speed: 0, svMovement: "Stopped", cpMovement: "Other, see Narrative", crashWith: "Passenger Car",
                   belted: PAX_UNKNOWN, svHit: "unknown", cpHit: "left", faultfrac: 0 },
  // parked; its passenger opened its rear left door into the passing first Waymo
  "30270-14890": { speed: 0, svMovement: "Parked", cpMovement: "Passing", crashWith: "SUV",
                   belted: "Subject Vehicle - Passenger In Vehicle, Belt Use Not Stated", svHit: "rear left", cpHit: "front right",
                   faultfrac: 0.1 },
  // stopped behind the first collision; the driverless SUV rolled backwards into its front left
  "30270-15346": { speed: 0, svMovement: "Stopped", cpMovement: "Other, see Narrative", crashWith: "SUV",
                   belted: PAX_UNKNOWN, svHit: "front left", cpHit: "rear right", faultfrac: 0 },
};
const CRASH_FIELDS = ["helmer", "version", "date", "time", "incidentId", "city", "state", "road", "severity",
  "narrative", "narrativeCbi", "airbagAny", "wxClear", "wxRain", "wxCloudy", "wxPartlyCloudy", "vehiclesInvolved", "series"];
const VEHICLE_FIELDS = ["speed", "svMovement", "cpMovement", "crashWith", "belted", "svHit", "cpHit"];
// In-scope narratives that name a second AV of their company, read by this
// qual's own pattern (the 2026-10-31 sweep of every in-scope narrative, all
// three helmers), and what each one is.
const SECOND_AV = /\b(?:second|another|different|additional|third|two|both|first|initial)\s+(?:Waymo|Zoox|Tesla|robotaxi|Cybercab|ADS)\b|\bLevel\s+4\s+ADS\s+of\s+both\b/i;
const DEFINED_TERM = /\b(?:Parked|Second)\s+Waymo\s+AV\b/;

const py = SLURP_OFFLINE_PY + String.raw`
import re
out = {'suffix': getattr(slurp, 'SECOND_INVOLVEMENT_SUFFIX', None),
       'second': {k: v.get('quote') for k, v in getattr(slurp, 'SECOND_INVOLVEMENTS', {}).items()},
       'reviewed': sorted(getattr(slurp, 'SECOND_AV_REVIEWED', {}))}
inc = slurp.public_service_incidents(slurp.filed_incident_rows(ROWS))
latest = {r['Report ID']: r for r in inc.values()}
out['quoteFound'] = {k: k in latest and q in latest[k]['Narrative'] for k, q in out['second'].items()}
out['narratives'] = {k: (r['Reporting Entity'], r['Narrative']) for k, r in latest.items()}
check = getattr(slurp, 'check_second_av_classified', None)
def trips(row):
    if check is None: return 'slurp.py has no check_second_av_classified'
    try: check(row); return False
    except AssertionError: return True
base = {'Reporting Entity': 'Waymo LLC', 'Driver / Operator Type': 'None', 'Report ID': 'synthetic-second-av'}
out['trips'] = {w: trips(dict(base, Narrative=w)) for w in [
    'two Waymo Autonomous Vehicles were involved in a collision',
    'the SUV then made contact with a second Waymo AV that was stopped',
    'the front of the Waymo AV made contact with another Zoox vehicle',
    'At the time of the impact, the Level 4 ADS of both Waymo AVs were engaged',
    'a passenger in the Parked Waymo AV opened the door',
]}
out['passes'] = {w: trips(dict(base, Narrative=w)) for w in [
    'the second passenger car made contact with the rear of the Waymo AV',
    'the parked Waymo AV was struck',
]}
out['passesOutOfScope'] = trips(dict(base, **{'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}, Narrative='a second Waymo AV was struck'))
out['passesListed'] = trips(dict(base, **{'Report ID': '30270-9987'}, Narrative='a second Waymo AV was struck'))
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
t = template(D)
res = run_main([clone(t, 'synthetic-second-av', Narrative=t['Narrative'] + ' A second Waymo AV stopped behind it was also struck.')])
out['mainTrip'] = {'stop': res['stop'], 'changed': res['changed']}
unrated = run_main(fault_text='\n'.join(l for l in TEXT['faultfrac.csv'].split('\n') if not l.startswith('30270-11424-B,')))
out['unratedSecond'] = {'stop': unrated['stop'], 'changed': unrated['changed']}
base_run = run_main()
out['baseline'] = base_run['stop']
out['regenerated'] = sorted(r['reportId'] for r in (base_run['incidents'] or []) if r['reportId'].endswith('-B'))
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read data/slurp.py's second-involvement tables and run its main() offline on the newest snapshots.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1. The reviewed table: exactly these reports, each with the narrative's words.
assert.deepEqual(Object.keys(S.second).sort(), Object.keys(WANT).sort(),
  `Replicata: list data/slurp.py's SECOND_INVOLVEMENTS.
Expectata: the five single-report crashes of two Waymos that the narrative and Waymo's hub CSV2 both show (${Object.keys(WANT).join(", ")}).
Resultata: ${JSON.stringify(Object.keys(S.second))}.`);
assert.equal(S.suffix, "-B",
  `Replicata: read SECOND_INVOLVEMENT_SUFFIX in data/slurp.py.
Expectata: "-B", the second AV's record id after its report's.
Resultata: ${JSON.stringify(S.suffix)}.`);
const unquoted = Object.entries(S.quoteFound).filter(([, ok]) => !ok).map(([rid]) => rid);
assert.deepEqual(unquoted, [],
  `Replicata: look for each SECOND_INVOLVEMENTS entry's quote in its report's latest filed narrative (newest snapshots).
Expectata: every quote is there verbatim.
Resultata: missing for ${JSON.stringify(unquoted)}.`);

// 2. The tripwire: every in-scope narrative naming a second AV is classified.
const classified = new Set([...Object.keys(S.second), ...S.reviewed]);
const hits = Object.entries(S.narratives)
  .filter(([, [, text]]) => SECOND_AV.test(text) || DEFINED_TERM.test(text)).map(([rid]) => rid).sort();
const unclassified = hits.filter(rid => !classified.has(rid));
assert.deepEqual(unclassified, [],
  `Replicata: scan every in-scope report's latest narrative (newest snapshots) for words naming a second AV of its company ("two Waymo", "a second Waymo AV", "another Zoox", "both Waymo AVs", the defined term "Parked Waymo AV", ...).
Expectata: each such report is in SECOND_INVOLVEMENTS or SECOND_AV_REVIEWED.
Resultata: unclassified ${JSON.stringify(unclassified)}.`);
const stale = [...classified].filter(rid => !hits.includes(rid));
assert.deepEqual(stale, [],
  `Replicata: read each SECOND_INVOLVEMENTS and SECOND_AV_REVIEWED entry's report.
Expectata: every entry is an in-scope report whose narrative names a second AV.
Resultata: entries naming none ${JSON.stringify(stale)}.`);
assert.deepEqual(Object.keys(S.second).filter(rid => S.reviewed.includes(rid)), [],
  `Replicata: intersect SECOND_INVOLVEMENTS and SECOND_AV_REVIEWED.
Expectata: disjoint.
Resultata: ${JSON.stringify(S.reviewed)}.`);
const silent = Object.entries(S.trips).filter(([, t]) => t !== true).map(([w]) => w);
assert.deepEqual(silent, [],
  `Replicata: call slurp.check_second_av_classified on an unlisted in-scope Waymo report, once per wording ("two Waymo Autonomous Vehicles", "a second Waymo AV", "another Zoox", "the Level 4 ADS of both Waymo AVs", "the Parked Waymo AV").
Expectata: every one stops the run.
Resultata: passed or missing: ${JSON.stringify(Object.fromEntries(Object.entries(S.trips).filter(([, t]) => t !== true)))}.`);
assert.ok(Object.values(S.passes).every(t => t === false) && S.passesOutOfScope === false && S.passesListed === false,
  `Replicata: call slurp.check_second_av_classified on "the second passenger car", "the parked Waymo AV" (the reporting AV, lowercase), an out-of-scope report and a listed one.
Expectata: none stops the run.
Resultata: ${JSON.stringify({ ...S.passes, outOfScope: S.passesOutOfScope, listed: S.passesListed })}.`);
assert.ok(/SECOND_INVOLVEMENTS/.test(S.mainTrip.stop) && S.mainTrip.stop.includes("synthetic-second-av") && S.mainTrip.changed.length === 0,
  `Replicata: run slurp.main() offline on the newest snapshots plus a new in-scope Waymo filing whose narrative adds "A second Waymo AV stopped behind it was also struck."
Expectata: the run stops, naming the report and SECOND_INVOLVEMENTS, and writes nothing.
Resultata: ${S.mainTrip.stop === "" ? "completed" : JSON.stringify(S.mainTrip.stop.slice(0, 300))}; rewrote ${JSON.stringify(S.mainTrip.changed)}.`);
assert.ok(S.unratedSecond.stop.includes("30270-11424-B") && /data\/faultfrac\.csv/.test(S.unratedSecond.stop) && S.unratedSecond.changed.length === 0,
  `Replicata: run slurp.main() offline on the newest snapshots with data/faultfrac.csv lacking the row of 30270-11424-B (the second Waymo of 30270-11424).
Expectata: the run stops, listing 30270-11424-B among the unrated incidents and naming data/faultfrac.csv, and writes nothing.
Resultata: ${S.unratedSecond.stop === "" ? "completed" : JSON.stringify(S.unratedSecond.stop.slice(0, 300))}; rewrote ${JSON.stringify(S.unratedSecond.changed)}.`);
assert.equal(S.baseline, "",
  `Replicata: run slurp.main() offline on the newest snapshots. Expectata: it completes. Resultata: stopped: ${JSON.stringify(S.baseline.slice(0, 300))}.`);
assert.deepEqual(S.regenerated, Object.keys(WANT).map(rid => rid + "-B").sort(),
  `Replicata: run slurp.main() offline on the newest snapshots and list the records it writes whose id ends in "-B".
Expectata: one per SECOND_INVOLVEMENTS report.
Resultata: ${JSON.stringify(S.regenerated)}.`);

// 3. The records in data/incidents.js and their fault rows.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx);
const records = vm.runInContext("INCIDENT_DATA", ctx);
const byId = new Map(records.map(r => [r.reportId, r]));
const [header, ...faultRows] = parseCsv(fs.readFileSync("data/faultfrac.csv", "utf8"));
const iId = header.indexOf("reportID"), iFrac = header.indexOf("faultfrac");
const fault = new Map(faultRows.map(r => [r[iId], Number(r[iFrac])]));
const problems = [];
for (const [rid, want] of Object.entries(WANT)) {
  const parent = byId.get(rid), second = byId.get(rid + "-B");
  if (!parent || !second) { problems.push(`${rid}: report ${parent ? "present" : "absent"}, second AV ${second ? "present" : "absent"}`); continue; }
  for (const f of CRASH_FIELDS) if (JSON.stringify(second[f]) !== JSON.stringify(parent[f])) problems.push(`${rid}-B ${f}: ${JSON.stringify(second[f])} vs the report's ${JSON.stringify(parent[f])}`);
  for (const f of VEHICLE_FIELDS) if (second[f] !== want[f]) problems.push(`${rid}-B ${f}: ${JSON.stringify(second[f])}, want ${JSON.stringify(want[f])}`);
  if (second.secondOf !== rid) problems.push(`${rid}-B secondOf: ${JSON.stringify(second.secondOf)}`);
  if (parent.secondOf !== undefined) problems.push(`${rid} secondOf: ${JSON.stringify(parent.secondOf)}`);
  if (fault.get(rid + "-B") !== want.faultfrac || second.fault?.faultfrac !== want.faultfrac)
    problems.push(`${rid}-B faultfrac: data/faultfrac.csv ${fault.get(rid + "-B")}, incidents.js ${second.fault?.faultfrac}, want ${want.faultfrac}`);
}
const strays = records.filter(r => r.secondOf !== undefined && !(r.secondOf in WANT)).map(r => r.reportId);
if (strays.length) problems.push(`records with secondOf outside the table: ${JSON.stringify(strays)}`);
assert.deepEqual(problems, [],
  `Replicata: for each SECOND_INVOLVEMENTS report, read its record and its "-B" record in data/incidents.js, and the "-B" row of data/faultfrac.csv.
Expectata: the "-B" record carries the report's crash-level fields (${CRASH_FIELDS.join(", ")}), the second AV's own fields as its narrative gives them, secondOf naming the report, and the adjudicated fault value in both files; the report's own record carries no secondOf.
Resultata: ${JSON.stringify(problems, null, 1)}.`);

// 4. The incident browser marks the second AV's row; the report's row is as before.
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this._html = ""; this.classList = { toggle() { return false; } }; }
  set textContent(v) { this._html = esc(v); }
  get textContent() { return this._html; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  addEventListener() {}
  setAttribute() {}
  querySelector() { return new El("td"); }
}
const nodes = new Map();
const app = vm.createContext({ console, Math, document: {
  getElementById: id => nodes.get(id) || (nodes.set(id, new El("div")), nodes.get(id)),
  createElement: tag => new El(tag), activeElement: new El("body") } });
vm.runInContext(appScript, app, { filename: "crashla.js" });
app.SAMPLE = ["30270-11424", "30270-11424-B"].map(rid => byId.get(rid)).filter(Boolean);
vm.runInContext(`
incidents = SAMPLE;
faultData = buildFaultDataFromIncidents(incidents);
vmtRows = [{helmer: "Waymo", month: "2025-07", vmtMin: 1, vmtBest: 1, vmtMax: 1}];
activeSeries = { months: ["2025-07"] };
renderTable();
`, app);
const label = vm.runInContext("typeof SECOND_INVOLVEMENT_LABEL === 'string' ? SECOND_INVOLVEMENT_LABEL : null", app);
const shown = nodes.get("incidents-body").children.map(tr => (tr.innerHTML.match(/<span id="narr-text-[^"]*">([^<]*)/) || [])[1] ?? null);
const narrative = esc(byId.get("30270-11424")?.narrative ?? "");
assert.ok(label && shown.length === 2 && shown[0] === narrative && shown[1] === esc(label) + " " + narrative,
  `Replicata: render the incident browser's rows for 30270-11424 and its second AV, 30270-11424-B.
Expectata: the report's row shows its narrative as before; the second AV's row shows the same narrative after SECOND_INVOLVEMENT_LABEL, so it does not read as a duplicate filing.
Resultata: label ${JSON.stringify(label)}; narrative spans start ${JSON.stringify(shown.map(s => s && s.slice(0, 60)))}.`);

console.log(`qual pass: each AV involved counts: ${Object.keys(WANT).length} second-AV records carry their report's crash and their own vehicle fields and fault rows, the browser marks them, and the narrative tripwire classifies all ${hits.length} reports naming a second AV`);

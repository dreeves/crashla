// One reviewed table gives every Roadway Type its class, a road or a parking
// facility (data/slurp.py ROADWAY_CLASS), and the nonstationary
// non-parking-lot metric counts a moving crash by that class (2026-11-21;
// audit A11 of 2026-11-20, the human's "ok on all 3").
//
// Until then the page counted a moving crash as on a roadway unless its
// Roadway Type was the literal "Parking Lot", and nothing listed the values
// the field may hold. NHTSA's Nov-16-2026 file brought a new one, "Parking
// Garage" (0 rows through the Sep-15 file, one out-of-scope row on Oct 15,
// five on Nov 16), and its crashes entered the metric as road crashes without
// a word: 30270-16350, a Waymo that drove into a garage entrance's barrier
// arm at 1 mph. The metric's human bands cover roadway crashes only, so
// parking facilities stay out on the AV side too.
//
// The decision: the table lists every Roadway Type of a row that passes
// slurp's validation loop in any saved snapshot; "Parking Lot" and "Parking
// Garage" are parking facilities, every other value a road; "Unknown" a road
// too, the cautious reading (it can only lower an AV's miles per incident on
// the metric); a value the table lacks stops slurp, as a new severity does.
// The class reaches the page as a constant slurp writes into
// data/incidents.js from the same table (ROADWAY_CLASS there), so there is
// one table.
//
// Spec:
//   1. data/slurp.py defines the table: an object whose values are two
//      classes, the class of "Street" (a road) and the class of "Parking Lot"
//      (a parking facility), read from it (their words are the table's);
//      "Parking Garage" has the parking class and "Unknown" the road class;
//   2. every Roadway Type on a row slurp validates (a crash report with a
//      Same Incident ID and an Incident Date) is a key: in every saved
//      snapshot of NHTSA's ADS files, in the ADS-driven reports of its other
//      files and in the company list's rows;
//   3. data/incidents.js's ROADWAY_CLASS, which the page reads, is slurp's
//      table;
//   4. slurp.main(), run offline on the newest snapshots plus a copy of a
//      Waymo report with a Roadway Type the table lacks, stops, naming
//      ROADWAY_CLASS and the value, and writes nothing; so it does for a
//      blank one, and for such a copy under another company's name (a row out
//      of scope is validated too); without a copy it completes;
//   5. the page's nonstationary non-parking-lot count of every line and
//      month is a recount from the incidents: those whose speed is not 0 and
//      whose Roadway Type's class, in slurp's table, is the road class;
//   6. the metric follows the table, not a value's name: a synthetic moving
//      record counts on "Unknown" and on a road-class type, and not on
//      "Parking Garage", "Parking Lot" or a parking-class type; and a type
//      given the road class for one draw counts, given the parking class does
//      not (each such record is nonstationary either way); a record on a
//      type the table lacks, handed to the count past the load-time check,
//      stops it;
//   7. the page stops at load on a record, counted or pending, whose
//      Roadway Type the table lacks (a new value, a blank, or a name every
//      object inherits, such as "constructor"), its error naming the record
//      and the value, and loads a record on any listed type.
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const UNLISTED = "Qual Synthetic Bridge";
const py = SLURP_OFFLINE_PY + String.raw`
import glob
out = {'table': getattr(slurp, 'ROADWAY_CLASS', None)}
# The rows main() checks a Roadway Type on: crash reports (not a negative
# filing) with a Same Incident ID and an Incident Date, counted here with this
# qual's own loop: in every saved snapshot of the ADS files (as filed), in
# the newest snapshots as slurp reads them (the ADS-driven reports of NHTSA's
# other files with them), and in the company list's rows.
def validated(rows):
    return [r for r in rows if r['Report Type'].strip() not in slurp.NEGATIVE_FILING_TYPES
            and r['Same Incident ID'].strip() and r['Incident Date'].strip()]
seen = collections.Counter()
files = sorted(set(glob.glob('data/snapshots/nhtsa-current-*.csv') + glob.glob('data/snapshots/nhtsa-archive-*.csv')
                   + [str(p) for paths in slurp.LEGACY_SNAPSHOT_PATHS.values() for p in paths]))
for path in files:
    with open(path, newline='', encoding='utf-8') as f:
        for r in validated(csv.DictReader(f)):
            seen[r['Roadway Type'].strip()] += 1
for r in validated(ROWS) + validated(slurp.list_rows(slurp.latest_list_path())):
    seen[r['Roadway Type'].strip()] += 1
out['files'] = len(files)
out['seen'] = dict(seen)
try:
    out['generated'] = json.loads(_segment(TEXT['incidents.js'], '/* ROADWAY_CLASS_START */', '/* ROADWAY_CLASS_END */'))
except ValueError:
    out['generated'] = None
def outcome(res): return {'stop': res['stop'][:700], 'changed': res['changed'], 'count': len(res['incidents'] or [])}
t = template(slurp.NHTSA_DATA_THROUGH_DATE[:7])
out['template'] = t['Report ID']
out['runs'] = None
if out['table'] is not None:
    out['runs'] = {
        'baseline': outcome(run_main()),
        'unlisted': outcome(run_main([clone(t, 'synthetic-road-unlisted', **{'Roadway Type': ${JSON.stringify(UNLISTED)}})])),
        'blank': outcome(run_main([clone(t, 'synthetic-road-blank', **{'Roadway Type': ' '})])),
        'otherCompany': outcome(run_main([clone(t, 'synthetic-road-other', **{
            'Roadway Type': ${JSON.stringify(UNLISTED)}, 'Reporting Entity': 'Motional',
            'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'})])),
    }
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read data/slurp.py's ROADWAY_CLASS and the saved snapshots, and run slurp.main() offline with synthetic rows.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1. The table and its two classes.
const table = S.table;
assert.ok(table !== null && typeof table === "object" && !Array.isArray(table) && typeof table.Street === "string" && typeof table["Parking Lot"] === "string"
    && table.Street !== table["Parking Lot"],
  `Replicata: read ROADWAY_CLASS in data/slurp.py.
Expectata: one table giving every Roadway Type its class, "Street" a road and "Parking Lot" a parking facility, two different classes.
Resultata: ${JSON.stringify(table)}.`);
const ROAD = table.Street, PARKING = table["Parking Lot"];
const other = Object.entries(table).filter(([, c]) => c !== ROAD && c !== PARKING);
assert.ok(other.length === 0 && table["Parking Garage"] === PARKING && table.Unknown === ROAD,
  `Replicata: read the classes ROADWAY_CLASS gives (the road class is "Street"'s, ${JSON.stringify(ROAD)}; the parking class "Parking Lot"'s, ${JSON.stringify(PARKING)}).
Expectata: every value one of the two; "Parking Garage" a parking facility, as "Parking Lot" is; "Unknown" a road, the cautious reading (the human, 2026-11-21).
Resultata: of another class: ${JSON.stringify(other)}; "Parking Garage": ${JSON.stringify(table["Parking Garage"])}; "Unknown": ${JSON.stringify(table.Unknown)}.`);

// 2. Every validated row's Roadway Type is a key.
const unlisted = Object.entries(S.seen).filter(([value]) => !Object.hasOwn(table, value));
assert.ok(Object.keys(S.seen).length >= 2 && unlisted.length === 0,
  `Replicata: list the Roadway Type of every crash report (not a negative filing, with a Same Incident ID and an Incident Date) in the ${S.files} saved snapshots of NHTSA's ADS files, in the newest snapshots as slurp reads them, and in the company list's rows.
Expectata: each is a key of ROADWAY_CLASS in data/slurp.py, where a human gave it its class (data/README.md, Each NHTSA release, step 6).
Resultata: not listed, with their rows: ${JSON.stringify(Object.fromEntries(unlisted))}; seen: ${JSON.stringify(S.seen)}.`);

// 3. The page's constant is slurp's table.
const sorted = o => JSON.stringify(Object.entries(o ?? {}).sort());
assert.ok(S.generated !== null && sorted(S.generated) === sorted(table),
  `Replicata: read data/incidents.js's ROADWAY_CLASS, between its /* ROADWAY_CLASS_START */ and /* ROADWAY_CLASS_END */ markers, beside data/slurp.py's ROADWAY_CLASS.
Expectata: the same table (slurp writes the page's copy from its own, so there is one reviewed table).
Resultata: data/incidents.js: ${JSON.stringify(S.generated)}; data/slurp.py: ${JSON.stringify(table)}.`);

// 4. slurp stops on a Roadway Type the table lacks.
{
  const R = S.runs;
  assert.ok(R.baseline.stop === "" && R.baseline.count > 0,
    `Replicata: run slurp.main() offline on the newest snapshots.
Expectata: it completes (every Roadway Type in them is listed).
Resultata: ${R.baseline.stop === "" ? `completed with ${R.baseline.count} incidents` : `stopped: ${JSON.stringify(R.baseline.stop.slice(0, 300))}`}.`);
  for (const [key, what, value] of [
    ["unlisted", `a copy of Waymo report ${S.template} with the Roadway Type ${JSON.stringify(UNLISTED)}, which ROADWAY_CLASS does not list`, UNLISTED],
    ["blank", `a copy of Waymo report ${S.template} with a blank Roadway Type`, ""],
    ["otherCompany", `a copy of Waymo report ${S.template} filed by another company, a safety operator aboard (out of scope), with the Roadway Type ${JSON.stringify(UNLISTED)}`, UNLISTED],
  ]) {
    const r = R[key];
    assert.ok(r.stop.includes("ROADWAY_CLASS") && r.stop.includes(`'value': '${value}'`) && r.changed.length === 0,
      `Replicata: run slurp.main() offline on the newest snapshots plus ${what}.
Expectata: the run stops, naming ROADWAY_CLASS and the value, and writes nothing (an unclassified road type would count in the non-parking-lot metric, or not, without a word).
Resultata: ${r.stop === "" ? `completed with ${r.count} incidents` : `stopped: ${JSON.stringify(r.stop.slice(0, 300))}`}; rewrote ${JSON.stringify(r.changed)}.`);
  }
}

// 5-7. The page.
class Stub {
  set textContent(v) { this.innerHTML = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
}
const ctx = vm.createContext({ console, document: { getElementById() { return null; }, createElement() { return new Stub(); } } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const app = src => JSON.parse(vm.runInContext(`JSON.stringify(${src})`, ctx));
vm.runInContext(`incidents = INCIDENT_DATA; vmtRows = parseVmtCsv(VMT_CSV_TEXT);`, ctx);
// Each line-month's two nonstationary counts as the page holds them.
const pageCounts = () => app(`(() => {
  const series = monthSeriesData();
  return ADS_SERIES.flatMap(line => series.points.filter(p => p.helmers[line] !== null).map(p => ({ line, month: p.month,
    nonstationary: nonstationaryIncidentCount(p.helmers[line].incidents.speeds), roadway: p.helmers[line].incidents.roadwayNonstationary })));
})()`);
const MONTH_NO = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const monthOf = label => `${label.slice(4)}-${String(MONTH_NO[label.slice(0, 3)]).padStart(2, "0")}`;

// 5. The recount, on slurp's table.
{
  const records = app(`INCIDENT_DATA.map(r => ({series: r.series, date: r.date, speed: r.speed, road: r.road}))`);
  const want = new Map();
  for (const r of records) for (const line of r.series) {
    const key = `${line}|${monthOf(r.date)}`;
    want.set(key, (want.get(key) ?? 0) + Number(r.speed !== 0 && table[r.road] === ROAD));
  }
  const got = pageCounts();
  const differ = got.filter(c => c.roadway !== (want.get(`${c.line}|${c.month}`) ?? 0)).map(c => ({ ...c, want: want.get(`${c.line}|${c.month}`) ?? 0 }));
  const total = got.reduce((n, c) => n + c.roadway, 0);
  const parkingMoving = records.filter(r => r.speed !== 0 && table[r.road] === PARKING).length;
  assert.ok(got.length > 0 && total > 0 && parkingMoving > 0 && differ.length === 0,
    `Replicata: for every line and every month it has miles for (${got.length} line-months), read the page's nonstationary non-parking-lot count, and recount it from the incidents: those whose speed is not 0 and whose Roadway Type has the road class in data/slurp.py's ROADWAY_CLASS.
Expectata: the same count in every line-month (${records.length} incidents, ${parkingMoving} of them moving in a parking facility and so left out).
Resultata: ${differ.length} line-months differ, e.g. ${JSON.stringify(differ.slice(0, 4))}.`);
}

// 6. The metric follows the table. A moving Waymo record's copy, on each road
// type in turn, is added to the incidents, and its line-month's two counts
// are read against those without it.
{
  const base = pageCounts();
  const added = (road, classNow) => app(`(() => {
    const source = INCIDENT_DATA.find(r => r.helmer === "Waymo" && r.speed !== null && r.speed > 0);
    const month = monthKeyFromIncidentLabel(source.date);
    const before = ROADWAY_CLASS[${JSON.stringify(road)}], had = Object.hasOwn(ROADWAY_CLASS, ${JSON.stringify(road)});
    ${classNow === undefined ? "" : `ROADWAY_CLASS[${JSON.stringify(road)}] = ${JSON.stringify(classNow)};`}
    incidents = [...INCIDENT_DATA, {...source, reportId: "synthetic-road", road: ${JSON.stringify(road)}}];
    try {
      const p = monthSeriesData().points.find(p => p.month === month).helmers.Waymo;
      return { month, nonstationary: nonstationaryIncidentCount(p.incidents.speeds), roadway: p.incidents.roadwayNonstationary };
    } finally {
      incidents = INCIDENT_DATA;
      if (had) ROADWAY_CLASS[${JSON.stringify(road)}] = before; else delete ROADWAY_CLASS[${JSON.stringify(road)}];
    }
  })()`);
  const roadKey = Object.keys(table).find(k => table[k] === ROAD && k !== "Street" && k !== "Unknown");
  const cases = [
    ["Unknown", undefined, 1], ["Street", undefined, 1], [roadKey, undefined, 1],
    ["Parking Garage", undefined, 0], ["Parking Lot", undefined, 0],
    // A type of the table's own given the other class for one draw, and a
    // type the table lacks given each: the count follows the class.
    ["Street", PARKING, 0], ["Parking Garage", ROAD, 1],
    ["Qual Synthetic Ramp", ROAD, 1], ["Qual Synthetic Ramp", PARKING, 0],
  ];
  const wrong = [];
  for (const [road, classNow, counts] of cases) {
    const got = added(road, classNow), was = base.find(c => c.line === "Waymo" && c.month === got.month);
    if (got.nonstationary !== was.nonstationary + 1 || got.roadway !== was.roadway + counts)
      wrong.push(`a moving record on ${JSON.stringify(road)}${classNow === undefined ? "" : ` (given the class ${JSON.stringify(classNow)} for the draw)`}: nonstationary ${was.nonstationary} -> ${got.nonstationary}, non-parking-lot ${was.roadway} -> ${got.roadway}; want +1 and +${counts}`);
  }
  assert.ok(roadKey !== undefined && wrong.length === 0 && sorted(app("ROADWAY_CLASS")) === sorted(table),
    `Replicata: add a copy of a moving Waymo record to the page's incidents on each of several Roadway Types (two of them with the type's class in the page's ROADWAY_CLASS changed for that draw, two on a type the table lacks, given a class) and read its line-month's nonstationary and nonstationary non-parking-lot counts.
Expectata: nonstationary up by one each time; non-parking-lot up by one on a type whose class is the road class ("Unknown" among them) and unchanged on a parking-class type ("Parking Garage" among them), whatever the type's name; the table as it was afterwards.
Resultata: ${JSON.stringify(wrong)}.`);

  // A record on a type the table lacks, handed to the count itself (past the
  // load-time check of 7, as a harness that sets the incidents directly
  // does): the count stops, naming the record and the road. Without the stop
  // such a record would read as a parking facility's without a word.
  const direct = [UNLISTED, "", "constructor"].map(road => app(`(() => {
    const source = INCIDENT_DATA.find(r => r.helmer === "Waymo" && r.speed !== null && r.speed > 0);
    incidents = [...INCIDENT_DATA, {...source, reportId: "synthetic-road", road: ${JSON.stringify(road)}}];
    try { monthSeriesData(); return {road: ${JSON.stringify(road)}, stopped: false}; }
    catch (e) {
      const at = String(e.message).indexOf("{");
      let details = null;
      try { details = JSON.parse(String(e.message).slice(at)); } catch (_) { details = null; }
      return {road: ${JSON.stringify(road)}, stopped: true, details, message: String(e.message).slice(0, 200)};
    } finally { incidents = INCIDENT_DATA; }
  })()`));
  const silent = direct.filter(r => !(r.stopped && r.details !== null && r.details.reportId === "synthetic-road" && r.details.road === r.road));
  assert.ok(silent.length === 0,
    `Replicata: set the page's incidents to its data plus a moving Waymo record on a Roadway Type ROADWAY_CLASS lacks (${JSON.stringify(UNLISTED)}, a blank, "constructor"), without the load-time check, and count the months (monthSeriesData).
Expectata: the count stops on each, its details naming the record and the road.
Resultata: ${JSON.stringify(silent)}.`);
}

// 7. The page stops at load on a record whose Roadway Type the table lacks.
{
  const load = (road, into) => app(`(() => {
    const source = INCIDENT_DATA.find(r => r.helmer === "Waymo");
    const record = {...source, reportId: "synthetic-road", road: ${JSON.stringify(road)}};
    try {
      loadIncidents(${into === "counted" ? "[...INCIDENT_DATA, record], PENDING_INCIDENT_DATA" : "INCIDENT_DATA, [...PENDING_INCIDENT_DATA, record]"});
      return {stopped: false};
    } catch (e) {
      // The details crashla.js's assert appends to its message, as data.
      const at = String(e.message).indexOf("{");
      let details = null;
      try { details = JSON.parse(String(e.message).slice(at)); } catch (_) { details = null; }
      return {stopped: true, details, message: String(e.message).slice(0, 200)};
    } finally {
      loadIncidents(INCIDENT_DATA, PENDING_INCIDENT_DATA);
    }
  })()`);
  const wrong = [];
  for (const into of ["counted", "pending"]) {
    for (const road of [UNLISTED, "", "constructor", "toString"]) {
      const r = load(road, into);
      if (!(r.stopped && r.details !== null && r.details.reportId === "synthetic-road" && r.details.road === road))
        wrong.push(`a ${into} record on ${JSON.stringify(road)}: ${r.stopped ? `stopped with ${JSON.stringify(r.message)}` : "loaded"}; want a stop whose details name the record and the road`);
    }
    for (const road of Object.keys(table)) {
      const r = load(road, into);
      if (r.stopped) wrong.push(`a ${into} record on ${JSON.stringify(road)}, a listed type: stopped with ${JSON.stringify(r.message)}; want it loaded`);
    }
  }
  assert.ok(wrong.length === 0,
    `Replicata: load the page's incidents (loadIncidents) with one more record, counted and then pending, on a Roadway Type ROADWAY_CLASS lacks (${JSON.stringify(UNLISTED)}, a blank, and "constructor" and "toString", names every object inherits), and on each type it lists.
Expectata: a stop at load on each type the table lacks, its details naming the record and the road; each listed type loaded.
Resultata: ${JSON.stringify(wrong)}.`);
}

console.log(`qual pass: ROADWAY_CLASS classes all ${Object.keys(S.seen).length} Roadway Types of the validated rows in ${S.files} saved snapshots and the company list (${Object.keys(table).filter(k => table[k] === PARKING).length} parking facilities, "Unknown" a road), the page reads the same table, slurp stops on a type it lacks, and the non-parking-lot count is the moving incidents on its road class`);

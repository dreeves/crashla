import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// NHTSA's current SGO ADS file (incidents from Jun 2025) publishes its SV and
// CP contact-area columns under rotated labels: the box a reporter checked as
// front-left appears under "Front", front under "Front Right", front-right
// under "Front Left", and the same within the rear row; Left, Right, Top,
// Bottom, Unknown and every archive-file column are labeled right. Found
// 2026-10-23: Tesla's own SGO spreadsheet (linked from tesla.com/robotaxi/
// safety, Robotaxi-SGO-Report_10_18_2026.xlsx) and the narratives agree with
// each other and not with NHTSA's labels, for every reporter. slurp.py moves
// each current-file value under its true label and stops the run if the
// narratives stop agreeing (e.g., NHTSA fixes its export, which the move would
// then scramble).

// (1) What the page shows: Tesla's spreadsheet gives these areas for the 14
// in-scope Tesla incidents it shares with NHTSA's Oct-15 file (the 3 remote-
// driven ones are checked in section 3); each matches its narrative where the
// narrative names a side (15400 "front right", 15809 "right side", 16675
// "guardrail on the right", 16673 "its left side", 16294/16676 rear-ended).
const TESLA_SHEET = {
  "13781-15342": ["front left", "rear right"],
  "13781-15399": ["front", ""],
  "13781-15400": ["front right", "rear left"],
  "13781-15808": ["right", "rear"],
  "13781-15809": ["rear right", "front left"],
  "13781-16255": ["left", ""],
  "13781-16256": ["front + front right", ""],
  "13781-16294": ["rear", "front"],
  "13781-16671": ["front", ""],
  "13781-16673": ["rear left", "front"],
  "13781-16674": ["front + top", ""],
  "13781-16675": ["front right", ""],
  "13781-16676": ["rear", "front"],
  "13781-16677": ["front right", ""],
};
const TELEOP_SHEET = {
  "13781-15395": ["front", ""],
  "13781-16678": ["front left", "front left"],
  "13781-16679": ["front left", ""],
};

const text = fs.readFileSync("data/incidents.js", "utf8");
const data = JSON.parse(text.slice(text.indexOf("/* INCIDENT_DATA_START */") + 25,
  text.indexOf("/* INCIDENT_DATA_END */")).trim().replace(/;$/, ""));
const byId = new Map(data.map(r => [r.reportId, r]));
const sheetMismatch = [];
for (const [rid, [sv, cp]] of Object.entries(TESLA_SHEET)) {
  const r = byId.get(rid);
  if (!r || r.svHit !== sv || r.cpHit !== cp) {
    sheetMismatch.push(`${rid}: page ${JSON.stringify([r?.svHit, r?.cpHit])} vs Tesla's sheet ${JSON.stringify([sv, cp])}`);
  }
}
assert.deepEqual(sheetMismatch, [],
  `Replicata: read svHit/cpHit in data/incidents.js for the 14 in-scope Tesla incidents in Tesla's SGO spreadsheet.
Expectata: each equals the spreadsheet's contact areas (which agree with the narratives).
Resultata: ${JSON.stringify(sheetMismatch, null, 1)}.`);

// (2) Every reporter: incidents from Jul 2025 on (all from the current file)
// whose narrative names a front or rear box of the AV carry that box.
const MON = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
const ym = d => { const [m, y] = d.split("-"); return +y * 100 + MON.indexOf(m) + 1; };
const AV = "(?:Waymo|ADS|AV|Zoox|Tesla)";
const PHRASES = [
  [new RegExp(`\\brear (?:bumper )?of the ${AV}\\b`, "i"), "rear"],
  [new RegExp(`\\b(?:rear left|left rear)(?: side| bumper| corner)? of the ${AV}\\b`, "i"), "rear left"],
  [new RegExp(`\\b(?:rear right|right rear)(?: side| bumper| corner)? of the ${AV}\\b`, "i"), "rear right"],
  [new RegExp(`\\b(?:front left|left front)(?: side| bumper| corner)? of the ${AV}\\b`, "i"), "front left"],
  [new RegExp(`\\b(?:front right|right front)(?: side| bumper| corner)? of the ${AV}\\b`, "i"), "front right"],
];
const agreement = {};
for (const [re, label] of PHRASES) {
  const hits = data.filter(r => ym(r.date) >= 202507 && re.test(r.narrative));
  const agree = hits.filter(r => r.svHit.split(" + ").includes(label)).length;
  agreement[label] = { hits: hits.length, agree, share: +(agree / hits.length).toFixed(3) };
}
const weak = Object.entries(agreement).filter(([, a]) => a.hits < 20 || a.share < 0.85);
assert.deepEqual(weak, [],
  `Replicata: for incidents dated Jul-2025 or later, match narratives naming the AV's rear, rear left, rear right, front left or front right, and check svHit.
Expectata: at least 20 matches per phrase, and at least 85% of them carry the named box.
Resultata: ${JSON.stringify(agreement)}.`);

// (3) The pipeline: one loader per NHTSA file, shared by fetch_nhtsa_csv and
// the offline regenerations; the relabel map; the guard.
const py = String.raw`
import sys, csv, io, json, glob
sys.path.insert(0, 'data')
import slurp
AREAS = ['Front Left','Front','Front Right','Left','Top','Right','Rear Left','Rear','Rear Right','Bottom','Unknown']
out = {'map': slurp.CURRENT_FILE_CONTACT_LABEL}
cur_text = open(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], newline='').read()
arc_text = open(sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], newline='').read()
cur = slurp.current_csv_rows(cur_text)
arc = slurp.archive_csv_rows(arc_text)
raw_cur = list(csv.DictReader(io.StringIO(cur_text)))
raw_arc = list(csv.DictReader(io.StringIO(arc_text)))
true_of = lambda a: slurp.CURRENT_FILE_CONTACT_LABEL.get(a, a)
out['currentMoved'] = all(r[f'{p} Contact Area - {true_of(a)}'] == raw[f'{p} Contact Area - {a}']
                          for r, raw in zip(cur, raw_cur) for p in ('SV', 'CP') for a in AREAS)
out['archiveAsPublished'] = all(r[f'{p} Contact Area - {a}'] == raw[f'{p} Contact Area - {a}']
                                for r, raw in zip(arc, raw_arc) for p in ('SV', 'CP') for a in AREAS)
latest = {}
for r in cur:
    if r['Report ID'] not in latest or int(r['Report Version']) > int(latest[r['Report ID']]['Report Version']):
        latest[r['Report ID']] = r
out['sheet'] = {rid: [slurp._contact_areas(latest[rid], 'SV Contact Area'), slurp._contact_areas(latest[rid], 'CP Contact Area')]
                for rid in json.loads(sys.argv[1])}
out['snapshotRowsShared'] = slurp.newest_snapshot_rows() == cur + arc
# fetch_nhtsa_csv must parse with the same loaders (served the snapshots; no snapshot written)
class Resp:
    def __init__(self, body): self.body = body; self.headers = {'Last-Modified': 'Thu, 15 Oct 2026 12:00:00 GMT', 'ETag': None}
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self.body
bodies = {slurp.NHTSA_ADS_CSV_URL: cur_text.encode('utf-8'), slurp.NHTSA_ADS_ARCHIVE_URL: arc_text.encode('utf-8')}
slurp.urllib.request.urlopen = lambda url, timeout=60: Resp(bodies[url])
slurp.snapshot_csv_if_changed = lambda prefix, text, stamp: None
import contextlib
with contextlib.redirect_stdout(io.StringIO()):   # its progress lines are not the JSON
    fetched, _headers = slurp.fetch_nhtsa_csv('qual')
out['fetchShared'] = fetched == cur + arc
# the guard: a file whose labels NHTSA has fixed must stop the run
fixed = io.StringIO()
writer = csv.DictWriter(fixed, fieldnames=list(raw_cur[0].keys()))
writer.writeheader()
for raw in raw_cur:
    writer.writerow(slurp._normalize_current_row(dict(raw)))
try:
    slurp.current_csv_rows(fixed.getvalue())
    out['guardOnFixed'] = ''
except AssertionError as e:
    out['guardOnFixed'] = str(e)
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py, JSON.stringify(Object.keys({ ...TESLA_SHEET, ...TELEOP_SHEET }))],
  { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 26 });
assert.equal(run.status, 0, `Replicata: run slurp's NHTSA loaders on the newest snapshots.
Expectata: python exits 0.
Resultata: ${run.stderr.slice(-1500)}`);
const out = JSON.parse(run.stdout);

assert.deepEqual(out.map, {
  "Front": "Front Left", "Front Right": "Front", "Front Left": "Front Right",
  "Rear": "Rear Left", "Rear Right": "Rear", "Rear Left": "Rear Right",
}, `Replicata: read slurp.CURRENT_FILE_CONTACT_LABEL.
Expectata: published label -> true label for the six rotated front/rear boxes, nothing else.
Resultata: ${JSON.stringify(out.map)}.`);
assert.ok(out.currentMoved && out.archiveAsPublished,
  `Replicata: load the newest current and archive snapshots with slurp.current_csv_rows / archive_csv_rows.
Expectata: every current-file contact value sits under its true label; archive values stay as published.
Resultata: currentMoved=${out.currentMoved}, archiveAsPublished=${out.archiveAsPublished}.`);
const pySheet = Object.entries({ ...TESLA_SHEET, ...TELEOP_SHEET })
  .filter(([rid, v]) => JSON.stringify(out.sheet[rid]) !== JSON.stringify(v));
assert.deepEqual(pySheet, [],
  `Replicata: compute slurp._contact_areas (SV, CP) for all 17 reports Tesla's spreadsheet shares with NHTSA's file.
Expectata: each equals the spreadsheet.
Resultata: ${JSON.stringify(pySheet.map(([rid]) => [rid, out.sheet[rid]]))}.`);
assert.ok(out.snapshotRowsShared && out.fetchShared,
  `Replicata: compare slurp.newest_snapshot_rows() and fetch_nhtsa_csv() (served the snapshots) with current_csv_rows + archive_csv_rows.
Expectata: all three give the same rows (one loader per file, used everywhere).
Resultata: newest_snapshot_rows equal=${out.snapshotRowsShared}, fetch equal=${out.fetchShared}.`);
assert.match(out.guardOnFixed, /CURRENT_FILE_CONTACT_LABEL/,
  `Replicata: feed slurp.current_csv_rows a current file whose contact labels NHTSA has already fixed.
Expectata: the run stops with a message naming CURRENT_FILE_CONTACT_LABEL.
Resultata: ${JSON.stringify(out.guardOnFixed.slice(0, 300))}.`);

console.log(`qual pass: current-file contact areas carry their true labels (${Object.values(agreement).map(a => a.share).join(", ")} narrative agreement); the guard stops a fixed file`);

// Fault values sit on a 0.05 grid (0, 0.05, ..., 1). The page has refused an
// off-grid value since 2026-10-03 (crashla.js faultSum asserts it during init,
// audit #56), so one off-grid judgment in data/faultfrac.csv — a plausible
// "one in three" 0.33 — blanked the whole page while slurp.py accepted it and
// wrote it to data/incidents.js (second audit, 2026-10-04, #6). Spec: slurp.py
// stops on an off-grid value as it stops on an out-of-range one, and names
// the report and the value; on-grid values pass; the checked-in
// data/faultfrac.csv is on the grid; and main() runs the check (an off-grid
// row in the fault CSV stops an offline run before anything is written).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const py = String.raw`
import csv, glob, importlib.util, json, pathlib, shutil, tempfile
spec = importlib.util.spec_from_file_location('slurp_grid', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)

def parse_with(value):
    with tempfile.TemporaryDirectory() as d:
        path = pathlib.Path(d) / 'faultfrac.csv'
        with open(path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=slurp.FAULT_CSV_FIELDS, lineterminator='\n')
            w.writeheader()
            w.writerow({'reportID': '13781-13647', 'speed': '0', 'crashwith': 'SUV', 'svhit': '', 'cphit': '',
                        'severity': 'No Injuries Reported', 'faultfrac': value, 'reasoning': 'Synthetic row'})
        try:
            slurp.parse_fault_csv(path); return ''
        except AssertionError as e:
            return str(e)

out = {v: parse_with(v) for v in ['0.33', '0.35', '0', '1', '0.05', '0.051', '1.0']}
try:
    data = slurp.parse_fault_csv(slurp.FAULT_INPUT); out['checkedIn'] = ''
except AssertionError as e:
    out['checkedIn'] = str(e)

# main() must run the check: the snapshots plus the checked-in fault CSV with
# one value moved off the grid (the finding's replicata), offline.
rows = []
for path, is_archive in [(sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1], False),
                         (sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1], True)]:
    for r in csv.DictReader(open(path, newline='')):
        if is_archive: slurp._normalize_archive_row(r)
        rows.append(r)
headers = {slurp.NHTSA_ADS_CSV_URL: ('Tue, 15 Sep 2026 12:00:00 GMT', None), slurp.NHTSA_ADS_ARCHIVE_URL: ('Tue, 15 Sep 2026 12:00:00 GMT', None)}
slurp.fetch_nhtsa_csv = lambda stamp: (list(rows), headers)
with tempfile.TemporaryDirectory() as d:
    d = pathlib.Path(d)
    fault = d / 'faultfrac.csv'
    lines = pathlib.Path('data/faultfrac.csv').read_text().split('\n')
    i = 1  # the first data row, whichever report it is
    cells = next(csv.reader([lines[i]]))
    out['mainRow'] = cells[0]
    cells[6] = '0.33'
    buf = __import__('io').StringIO(); csv.writer(buf, lineterminator='').writerow(cells); lines[i] = buf.getvalue()
    fault.write_text('\n'.join(lines))
    shutil.copy('data/incidents.js', d / 'incidents.js'); shutil.copy('data/vmt.js', d / 'vmt.js')
    before = (d / 'incidents.js').read_text()
    slurp.FAULT_INPUT = fault; slurp.INCIDENT_JS = d / 'incidents.js'; slurp.VMT_JS = d / 'vmt.js'
    try:
        slurp.main(); out['main'] = ''
    except AssertionError as e:
        out['main'] = str(e)
    out['mainWroteIncidents'] = (d / 'incidents.js').read_text() != before
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0, `Replicata: load data/slurp.py and parse synthetic fault CSVs.
Expectata: the script runs.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));

for (const v of ["0.33", "0.051"]) {
  assert.ok(/0\.05 grid/.test(S[v]) && S[v].includes("13781-13647") && S[v].includes(v),
    `Replicata: give slurp.py's parse_fault_csv a faultfrac.csv whose one row (13781-13647) has faultfrac ${v}.
Expectata: it stops, naming the 0.05 grid, the report and the value (the page refuses off-grid values and renders nothing).
Resultata: ${S[v] === "" ? "accepted" : JSON.stringify(S[v].slice(0, 300))}.`);
}
for (const v of ["0.35", "0", "1", "0.05", "1.0"]) {
  assert.equal(S[v], "",
    `Replicata: give slurp.py's parse_fault_csv a faultfrac.csv whose one row has faultfrac ${v}.
Expectata: accepted (on the 0.05 grid).
Resultata: ${JSON.stringify(S[v].slice(0, 300))}.`);
}
assert.equal(S.checkedIn, "",
  `Replicata: parse the checked-in data/faultfrac.csv with slurp.py.
Expectata: every value is on the 0.05 grid.
Resultata: ${JSON.stringify(S.checkedIn.slice(0, 300))}.`);
assert.ok(/0\.05 grid/.test(S.main) && !S.mainWroteIncidents,
  `Replicata: set one report's faultfrac (${S.mainRow}, the first row) to 0.33 in a copy of data/faultfrac.csv and run slurp.main() offline on the newest snapshots.
Expectata: the run stops with the grid message before writing data/incidents.js.
Resultata: ${S.main === "" ? "completed" : JSON.stringify(S.main.slice(0, 300))}; incidents.js ${S.mainWroteIncidents ? "rewritten" : "untouched"}.`);

console.log("qual pass: slurp.py stops on a fault value off the 0.05 grid (parser and main()), and the checked-in fault CSV is on the grid");

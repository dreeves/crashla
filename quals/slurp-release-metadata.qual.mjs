import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// data/slurp.py's handling of NHTSA's release frontier. Each NHTSA CSV holds
// reports RECEIVED through the reviewed NHTSA_DATA_THROUGH_DATE (the 15th of
// the month before the release, or the next business day when the 15th falls
// on a weekend or holiday; quals/nhtsa-cutoff-date.qual.mjs). The reviewed cutoff must (1) match the data
// by month, (2) be guarded by content (the newest submission month must be
// the cutoff month; early Monthly filings inside it are legitimate), (3)
// carry the measured five-day receipt-coverage
// triple, and (4) never be enforced by pinning the CSV's HTTP headers or
// bytes — a narrative correction (Aug 27, 2026: NHTSA replaced the wrong
// narrative on Stack AV 34952-11803 v1) must not break ingestion. Offline regeneration from the newest snapshots must
// reproduce the committed payloads byte for byte.

const py = String.raw`
import csv, glob, importlib.util, pathlib, tempfile
from email.utils import format_datetime
import datetime

spec = importlib.util.spec_from_file_location('slurp_offline', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slurp)
src = pathlib.Path('data/slurp.py').read_text()

# (4) no byte/header pins
for banned in ('NHTSA_EXPECTED_ETAG', 'NHTSA_EXPECTED_LAST_MODIFIED', 'validate_nhtsa_headers'):
    assert banned not in src, banned

# (3) the reviewed triple is consistent with its own measurements
cov = slurp.FIVE_DAY_RECEIPT_COVERAGE
fracs = sorted(n / d for n, d in slurp.FIVE_DAY_RECEIPT_OBSERVATIONS.values())
assert len(fracs) >= 3, fracs
assert 0 < cov[1] <= fracs[0] and fracs[-1] <= cov[2] < 1 and cov[1] < cov[0] < cov[2], (cov, fracs)
month = slurp.NHTSA_DATA_THROUGH_DATE[:7]
assert slurp.release_month_coverage(slurp.NHTSA_DATA_THROUGH_DATE, month) == cov

# (1) a new release (months advanced past the reviewed cutoff) fails loudly
for stale in ('2026-06', '2026-08', '2027-01'):
    try:
        slurp.release_month_coverage('2026-07-15', stale)
    except AssertionError:
        pass
    else:
        raise AssertionError('release_month_coverage accepted a cutoff month that disagrees with the data')

# a constant that disagrees with its measurements fails loudly
saved = slurp.FIVE_DAY_RECEIPT_COVERAGE
slurp.FIVE_DAY_RECEIPT_COVERAGE = (0.9, 0.8, 0.95)
try:
    slurp.release_month_coverage('2026-07-15', '2026-07')
except AssertionError:
    pass
else:
    raise AssertionError('release_month_coverage accepted a triple outside its measurements')
slurp.FIVE_DAY_RECEIPT_COVERAGE = saved

def report(entity, rid, incident, submission, report_type='5-Day'):
    return {
        'Reporting Entity': entity,
        'Driver / Operator Type': 'None',
        'Report ID': rid,
        'Report Version': '1',
        'Same Incident ID': rid,
        'Incident Date': incident,
        'Report Submission Date': submission,
        'Report Type': report_type,
    }

# pooled incident coverage: scale-free in the receipt coverage (the product
# receipt * best is invariant while obs/expected stays below the 1.0 clamp —
# eight reference incidents per fleet keep this fixture well inside that
# regime), one factor for every fleet with VMT; consumer/no-new rows leave it
# alone, while a Monthly row in the cutoff month IS a counted incident (it
# raises the observed count; main()'s submission-month guard is what rejects
# filings submitted after the cutoff)
base_rows = []
for entity in ['Waymo LLC', 'Tesla, Inc.']:
    for i in range(8):
        base_rows.append(report(entity, f'{entity}-ref-{i}', 'JUN-2026', 'JUN-2026'))
    base_rows.append(report(entity, f'{entity}-last', 'JUL-2026', 'JUL-2026'))
vmt = {
    ('Waymo', '2026-06'): 100, ('Waymo', '2026-07'): 100,
    ('Tesla', '2026-06'): 100, ('Tesla', '2026-07'): 100,
}
baseline = slurp.incident_coverage(base_rows, '2026-07', 0.32, vmt)
assert set(baseline) == {('Waymo', '2026-07'), ('Tesla', '2026-07')}
alt = slurp.incident_coverage(base_rows, '2026-07', 0.48, vmt)
for key in baseline:
    assert baseline[key][0] < 1 and alt[key][0] < 1, (baseline[key], alt[key])
    assert abs(baseline[key][0] * 0.32 - alt[key][0] * 0.48) < 1e-3, (baseline[key], alt[key])
tesla_monthly = report('Tesla, Inc.', 'tesla-monthly', 'JUL-2026', 'AUG-2026', 'Monthly')
consumer = report('Tesla, Inc.', 'tesla-consumer', 'JUL-2026', 'AUG-2026', 'Monthly')
consumer['Driver / Operator Type'] = 'Consumer'
no_new = report('Waymo LLC', '', '', 'AUG-2026', 'No New or Updated Incident Reports')
no_new['Report Version'] = ''
no_new['Same Incident ID'] = ''
no_new['Driver / Operator Type'] = ''
for addition in [consumer, no_new]:
    assert slurp.incident_coverage(base_rows + [addition], '2026-07', 0.32, vmt) == baseline
with_monthly = slurp.incident_coverage(base_rows + [tesla_monthly], '2026-07', 0.32, vmt)
assert set(with_monthly) == set(baseline)
for key in baseline:
    assert with_monthly[key][0] > baseline[key][0], (with_monthly[key], baseline[key])
try:
    slurp.incident_coverage([], '2026-07', 0.32, {('Waymo', '2026-06'): 100, ('Waymo', '2026-07'): 100})
except AssertionError:
    pass
else:
    raise AssertionError('zero-history helmer with VMT silently defaulted to full coverage')

# (2) + byte-identical offline regeneration from the newest snapshots
current = sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1]
archive = sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1]
rows = []
for path, is_archive in [(current, False), (archive, True)]:
    with open(path, newline='') as handle:
        for row in csv.DictReader(handle):
            if is_archive:
                slurp._normalize_archive_row(row)
            rows.append(row)
incident_original = pathlib.Path('data/incidents.js').read_text()
vmt_original = pathlib.Path('data/vmt.js').read_text()

def segment(text, start, end):
    begin = text.index(start) + len(start)
    finish = text.index(end, begin)
    return text[begin:finish]

modified = segment(incident_original, '/* NHTSA_MODIFIED_DATE_START */', '/* NHTSA_MODIFIED_DATE_END */').strip('"')
last_modified = format_datetime(datetime.datetime.fromisoformat(modified + 'T12:00:00+00:00'), usegmt=True)
headers = {slurp.NHTSA_ADS_CSV_URL: (last_modified, None), slurp.NHTSA_ADS_ARCHIVE_URL: (last_modified, None)}
slurp.sync_fault_csvs = lambda master_rows: None

def regenerate(all_rows):
    slurp.fetch_nhtsa_csv = lambda stamp: (list(all_rows), headers)
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = pathlib.Path(temp_dir)
        (temp / 'incidents.js').write_text(incident_original)
        (temp / 'vmt.js').write_text(vmt_original)
        slurp.INCIDENT_JS = temp / 'incidents.js'
        slurp.VMT_JS = temp / 'vmt.js'
        slurp.main()
        return (temp / 'incidents.js').read_text(), (temp / 'vmt.js').read_text()

inc_regen, vmt_regen = regenerate(rows)
for start, end in [
    ('/* NHTSA_MODIFIED_DATE_START */', '/* NHTSA_MODIFIED_DATE_END */'),
    ('/* NHTSA_DATA_THROUGH_DATE_START */', '/* NHTSA_DATA_THROUGH_DATE_END */'),
    ('/* INCIDENT_DATA_START */', '/* INCIDENT_DATA_END */'),
]:
    assert segment(incident_original, start, end) == segment(inc_regen, start, end), start
assert segment(vmt_original, '/* VMT_CSV_START */', '/* VMT_CSV_END */') == segment(vmt_regen, '/* VMT_CSV_START */', '/* VMT_CSV_END */')

# (2) a filing for the data-through month SUBMITTED in a later month means the
# reviewed cutoff no longer describes the file: ingestion must stop (the
# submission-month guard), not recompute coverage. A Monthly filing submitted
# within the incident month (Tesla files some early) is consistent with the
# cutoff and must pass — the pre-2026-09-04 guard wrongly rejected it.
last_iso = slurp.NHTSA_DATA_THROUGH_DATE[:7]
last_date = datetime.date.fromisoformat(slurp.NHTSA_DATA_THROUGH_DATE)
last_label = last_date.strftime('%b-%Y').upper()
next_label = (last_date.replace(day=1) + datetime.timedelta(days=32)).strftime('%b-%Y').upper()
template = next(r for r in rows if r['Reporting Entity'] == 'Waymo LLC' and r['Report Type'].strip() == '5-Day' and r['Incident Date'].strip() == last_label)
early_monthly = dict(template)
early_monthly['Report ID'] = 'synthetic-early-monthly'
early_monthly['Same Incident ID'] = 'synthetic-early-monthly'
early_monthly['Report Type'] = 'Monthly'
early_monthly['Report Submission Date'] = last_label
regenerate(rows + [early_monthly])  # must not raise
late_monthly = dict(early_monthly)
late_monthly['Report ID'] = 'synthetic-late-monthly'
late_monthly['Same Incident ID'] = 'synthetic-late-monthly'
late_monthly['Report Submission Date'] = next_label
try:
    regenerate(rows + [late_monthly])
except AssertionError as exc:
    assert 'submission month' in str(exc), exc
else:
    raise AssertionError('slurp accepted a filing submitted after the data-through month')

# (5) each release must add the receipt observation for the month that just
# became final (its second normal release), or list it as excluded with a
# reason: a cutoff one month past the table's last observation must stop.
try:
    slurp.release_month_coverage('2026-09-15', '2026-09')
except AssertionError as exc:
    assert 'receipt' in str(exc).lower(), exc
else:
    raise AssertionError('release_month_coverage accepted a cutoff with no receipt observation for the month that just became final')
assert '2026-04' in slurp.RECEIPT_MONTHS_EXCLUDED, 'the truncated May-15-2026 release month is the documented exclusion'

# (6) a Same-Incident version tie between two Report IDs is broken by the
# later Report Submission Date, and an exact tie stops the run. The one real
# pair, 6f2cffa37c36b66 = 30270-1583 (v1, NOV-2021 re-filing) and 30270-1535
# (v1, OCT-2021), resolves to 30270-1583 by that rule, not by CSV row order.
assert '"reportId": "30270-1583"' in inc_regen and '"reportId": "30270-1535"' not in inc_regen
tie = dict(template)
tie['Report ID'] = 'synthetic-tie'
tie['Report Submission Date'] = template['Report Submission Date']
try:
    regenerate(rows + [tie])
except AssertionError as exc:
    assert 'tie' in str(exc).lower(), exc
else:
    raise AssertionError('slurp accepted two Report IDs at the same version and submission month for one Same Incident ID')

# (7) the archive's crash-partner airbag column is required, not defaulted:
# without it 19 archive-era CP-only deployments would silently revert.
arch_row = next(r for r in csv.DictReader(open(archive, newline='')) if r['Same Incident ID'].strip())
arch_copy = dict(arch_row); del arch_copy['CP Any Air Bags Deployed?']
try:
    slurp._normalize_archive_row(arch_copy)
except AssertionError as exc:
    assert 'airbag' in str(exc).lower(), exc
else:
    raise AssertionError('_normalize_archive_row accepted an archive row without the CP airbag column')
`;
const run = spawnSync("python3", ["-c", py], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});

assert.equal(run.status, 0,
  `Replicata: exercise slurp.py's release-frontier handling offline.
Expectata: the reviewed cutoff is month-checked and content-guarded, the receipt-coverage triple matches its measurements, no header/byte pins exist, and regeneration from the newest snapshots reproduces the committed payloads byte for byte.
Resultata: exit ${run.status}; stderr ${run.stderr.slice(-2000)}.`);

console.log("qual pass: NHTSA release frontier is reviewed by month, content-guarded, receipt-coverage-measured, and regenerates offline byte for byte");

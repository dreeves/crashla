import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// data/slurp.py's handling of NHTSA's release frontier. Each NHTSA CSV holds
// reports RECEIVED through the reviewed NHTSA_DATA_THROUGH_DATE (the 15th of
// the month before the release, or the next business day when the 15th falls
// on a weekend or holiday; quals/nhtsa-cutoff-date.qual.mjs). The reviewed cutoff must (1) match the data
// by month, (2) be guarded by content (the newest submission month must be
// the cutoff month; early Monthly filings inside it are legitimate), and (4)
// never be enforced by pinning the CSV's HTTP headers or
// bytes — a narrative correction (Aug 27, 2026: NHTSA replaced the wrong
// narrative on Stack AV 34952-11803 v1) must not break ingestion. Offline regeneration from the newest snapshots must
// reproduce the committed payloads byte for byte: the counted and the pending
// incidents and the Roadway Type classes (data/incidents.js; the classes,
// ROADWAY_CLASS, since 2026-11-21) and the analysis and the second segment of
// data/vmt.js.
//
// Until 2026-11-21 it also (3) estimated the data-through month's five-day
// receipt coverage from the release (observed / expected, its high edge the
// reviewed FIVE_DAY_RECEIPT_COVERAGE_MAX at or above every measured
// first-release share) and pooled an incident coverage over the companies,
// and (5) required each release to add the receipt observation of the month
// that had just become final. The human dropped the estimate that day (the
// data-through month is pending for a company with no dated list:
// quals/pending-months.qual.mjs), and this qual's checks of the estimate, of
// the pooled coverage's properties and of the receipt table's upkeep went
// with it; the month check (1) is now check_data_through_month()'s, which
// release_month_coverage() held until then.

const py = String.raw`
import collections, csv, glob, importlib.util, pathlib, tempfile
from email.utils import format_datetime
import datetime

spec = importlib.util.spec_from_file_location('slurp_offline', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slurp)
src = pathlib.Path('data/slurp.py').read_text()

# (4) no byte/header pins
for banned in ('NHTSA_EXPECTED_ETAG', 'NHTSA_EXPECTED_LAST_MODIFIED', 'validate_nhtsa_headers'):
    assert banned not in src, banned

month = slurp.NHTSA_DATA_THROUGH_DATE[:7]
newest_rows = slurp.newest_snapshot_rows()

# (1) the reviewed cutoff's month is the data's newest month: accepted as it
# is, and a release whose months have moved past it (or a cutoff ahead of the
# data) fails loudly
slurp.check_data_through_month(slurp.NHTSA_DATA_THROUGH_DATE, month)
for stale in ('2026-06', '2026-08', '2027-01'):
    try:
        slurp.check_data_through_month('2026-07-15', stale)
    except AssertionError:
        pass
    else:
        raise AssertionError('check_data_through_month accepted a cutoff month that disagrees with the data')

# (2) + byte-identical offline regeneration from the newest snapshots
current = sorted(glob.glob('data/snapshots/nhtsa-current-*.csv'))[-1]
archive = sorted(glob.glob('data/snapshots/nhtsa-archive-*.csv'))[-1]
rows = newest_rows
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

fault_original = pathlib.Path('data/faultfrac.csv').read_text()
saved_fault_input = slurp.FAULT_INPUT
def regenerate(all_rows, fault_lines=()):
    # fault_lines: data/faultfrac.csv rows for synthetic reports (slurp stops
    # on an unrated in-scope incident since 2026-10-31, decision #4)
    slurp.fetch_nhtsa_csv = lambda stamp: (list(all_rows), headers)
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = pathlib.Path(temp_dir)
        (temp / 'incidents.js').write_text(incident_original)
        (temp / 'vmt.js').write_text(vmt_original)
        (temp / 'faultfrac.csv').write_text(fault_original.rstrip('\n') + ''.join('\n' + line for line in fault_lines) + '\n')
        slurp.INCIDENT_JS = temp / 'incidents.js'
        slurp.VMT_JS = temp / 'vmt.js'
        slurp.FAULT_INPUT = temp / 'faultfrac.csv'
        try:
            slurp.main()
        finally:
            slurp.FAULT_INPUT = saved_fault_input
        return (temp / 'incidents.js').read_text(), (temp / 'vmt.js').read_text()

inc_regen, vmt_regen = regenerate(rows)
for start, end in [
    ('/* NHTSA_MODIFIED_DATE_START */', '/* NHTSA_MODIFIED_DATE_END */'),
    ('/* NHTSA_DATA_THROUGH_DATE_START */', '/* NHTSA_DATA_THROUGH_DATE_END */'),
    ('/* ROADWAY_CLASS_START */', '/* ROADWAY_CLASS_END */'),
    ('/* INCIDENT_DATA_START */', '/* INCIDENT_DATA_END */'),
    ('/* PENDING_INCIDENT_DATA_START */', '/* PENDING_INCIDENT_DATA_END */'),
]:
    assert segment(incident_original, start, end) == segment(inc_regen, start, end), start
for start, end in [('/* VMT_CSV_START */', '/* VMT_CSV_END */'), ('/* GHOST_VMT_CSV_START */', '/* GHOST_VMT_CSV_END */')]:
    assert segment(vmt_original, start, end) == segment(vmt_regen, start, end), start

# (2) a filing for the data-through month SUBMITTED in a later month means the
# reviewed cutoff no longer describes the file: ingestion must stop (the
# submission-month guard). A Monthly filing submitted
# within the incident month (Tesla files some early) is consistent with the
# cutoff and must pass — the pre-2026-09-04 guard wrongly rejected it.
last_iso = slurp.NHTSA_DATA_THROUGH_DATE[:7]
last_date = datetime.date.fromisoformat(slurp.NHTSA_DATA_THROUGH_DATE)
last_label = last_date.strftime('%b-%Y').upper()
next_label = (last_date.replace(day=1) + datetime.timedelta(days=32)).strftime('%b-%Y').upper()
# The clones below copy a template row under new IDs, so the template must be
# a row slurp takes in scope on its own (its month is pending since
# 2026-11-21, which changes nothing here: a pending incident is validated,
# deduplicated and rated as a counted one is): a driverless ("None") Waymo
# 5-Day filing of the data-through month that needs no reviewed entry (none keyed by its
# Report ID, which every reviewed table is keyed by since 2026-10-31, a filed
# city and state, and no narrative tripwire firing once its Report ID is
# new), filed once (its Report ID has one version and its Same Incident ID one
# report, so the tie clone meets it).
# The smallest such Report ID, so NHTSA's row order cannot pick a template
# whose clone stops the run for another reason (until 2026-10-04 the first
# listed row was used: second audit, #58).
filed_rows = slurp.filed_incident_rows(rows)
versions = collections.Counter(r['Report ID'] for r in filed_rows)
reports = collections.Counter(r['Same Incident ID'] for r in filed_rows)
reviewed_rids = (set(slurp.OPERATOR_TYPE_OVERRIDE) | set(slurp.TELEOP_DRIVEN_REPORTS)
                 | set(slurp.REMOTE_LANGUAGE_ADS_DRIVEN) | set(slurp.SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN)
                 | set(slurp.PASSENGER_OVERRIDE) | set(slurp.OCCUPANCY_LANGUAGE_REVIEWED)
                 | slurp.SPLIT_SAME_INCIDENT_REPORTS | set(slurp.SUPERSEDED_REPORTS)
                 | set(slurp.SUPERSEDED_REPORTS.values()) | set(slurp.LOCATION_OVERRIDE)
                 | set(slurp.SEVERITY_OVERRIDE) | set(slurp.AIRBAG_OVERRIDE) | set(slurp.AIRBAG_LANGUAGE_REVIEWED)
                 | set(slurp.VEHICLES_INVOLVED)
                 | set(slurp.SECOND_INVOLVEMENTS) | set(slurp.SECOND_AV_REVIEWED)
                 | set(slurp.MISFILED_ADS_REPORTS) | set(slurp.NON_ADS_FILE_EXCLUDED))
def trips_unlisted(r):
    probe = dict(r, **{'Report ID': 'synthetic-probe'})
    for check in (slurp.check_teleop_classified, slurp.check_safety_driver_classified,
                  slurp.check_occupancy_classified, slurp.check_second_av_classified,
                  lambda row: slurp.check_airbag_classified(row, row['Report ID'])):
        try: check(probe)
        except AssertionError: return True
    return False
eligible = [r for r in filed_rows
            if r['Reporting Entity'] == 'Waymo LLC' and r['Report Type'].strip() == '5-Day'
            and r['Incident Date'].strip() == last_label
            and r['Driver / Operator Type'].strip() == 'None' and slurp.is_public_service_incident(r)
            and r['City'].strip() and r['State'].strip()
            and versions[r['Report ID']] == 1 and reports[r['Same Incident ID']] == 1
            and r['Report ID'] not in reviewed_rids
            and not trips_unlisted(r)]
assert eligible, 'no Waymo 5-Day filing of the data-through month can serve as a clone template'
template = min(eligible, key=lambda r: r['Report ID'])
early_monthly = dict(template)
early_monthly['Report ID'] = 'synthetic-early-monthly'
early_monthly['Same Incident ID'] = 'synthetic-early-monthly'
early_monthly['Report Type'] = 'Monthly'
early_monthly['Report Submission Date'] = last_label
# rated, as every in-scope incident must be (a copy of the template's row)
template_fault = next(line for line in fault_original.split('\n') if line.startswith(template['Report ID'] + ','))
regenerate(rows + [early_monthly], [template_fault.replace(template['Report ID'], 'synthetic-early-monthly', 1)])  # must not raise
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

# (6) two in-scope Report IDs under one Same Incident ID stop the run until a
# reviewed table says which stands (since 2026-10-31; until then the higher
# Report Version won, then the later Report Submission Date, and only an exact
# tie stopped it: quals/same-incident-dedup.qual.mjs). The one real pair,
# 6f2cffa37c36b66 = 30270-1583 (v1, NOV-2021 re-filing) and 30270-1535 (v1,
# OCT-2021), resolves to 30270-1583 by its SUPERSEDED_REPORTS entry, not by
# CSV row order; a second report at the template's own version and
# submission month stops the run.
assert '"reportId": "30270-1583"' in inc_regen and '"reportId": "30270-1535"' not in inc_regen
tie = dict(template)
tie['Report ID'] = 'synthetic-tie'
tie['Report Submission Date'] = template['Report Submission Date']
try:
    regenerate(rows + [tie])
except AssertionError as exc:
    assert 'Same Incident ID' in str(exc) and 'synthetic-tie' in str(exc), exc
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
Expectata: the reviewed cutoff is month-checked and content-guarded, no header/byte pins exist, and regeneration from the newest snapshots reproduces the committed payloads (counted and pending incidents, analysis and second VMT segments) byte for byte.
Resultata: exit ${run.status}; stderr ${run.stderr.slice(-2000)}.`);

console.log("qual pass: NHTSA release frontier is reviewed by month, content-guarded, and regenerates offline byte for byte (counted and pending incidents, the Roadway Type classes, both VMT segments)");

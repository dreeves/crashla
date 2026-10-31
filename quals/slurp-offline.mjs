// A Python prelude for quals that run data/slurp.py's main() offline on the
// newest snapshots, as quals/slurp-release-metadata.qual.mjs does: NHTSA is
// never fetched, and the run reads and writes temporary copies of
// data/incidents.js, data/vmt.js and data/faultfrac.csv (slurp's own fault
// sync included, so a qual can tell which files a stopped run rewrote).
//
//   ROWS                the newest snapshots' rows, parsed as a live fetch is
//   run_main(extra=(), fault_text=None, **patch)
//                       main() on ROWS + extra, with the copy of
//                       data/faultfrac.csv replaced by fault_text if given and
//                       the slurp module attributes in patch set for the run;
//                       returns {'stop': the AssertionError's text or '',
//                       'changed': the copies the run rewrote, 'incidents':
//                       the INCIDENT_DATA it wrote, or None}
//   template(month)     a driverless Waymo 5-Day filing of <month> that slurp
//                       counts on its own and that nothing reviewed names, so
//                       a copy under new IDs is an ordinary new report
//   clone(row, rid, **fields)
//                       that copy, with Report ID and Same Incident ID rid
export const SLURP_OFFLINE_PY = String.raw`
import collections, csv, datetime, importlib.util, io, json, pathlib, tempfile
from email.utils import format_datetime
spec = importlib.util.spec_from_file_location('slurp_offline', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
ROWS = slurp.newest_snapshot_rows()
TEXT = {name: pathlib.Path('data', name).read_text() for name in ('incidents.js', 'vmt.js', 'faultfrac.csv')}
def _segment(text, start, end):
    b = text.index(start) + len(start)
    return text[b:text.index(end, b)]
_modified = _segment(TEXT['incidents.js'], '/* NHTSA_MODIFIED_DATE_START */', '/* NHTSA_MODIFIED_DATE_END */').strip('"')
_lm = format_datetime(datetime.datetime.fromisoformat(_modified + 'T12:00:00+00:00'), usegmt=True)
HEADERS = {slurp.NHTSA_ADS_CSV_URL: (_lm, None), slurp.NHTSA_ADS_ARCHIVE_URL: (_lm, None)}
def run_main(extra=(), fault_text=None, **patch):
    names = ('fetch_nhtsa_csv', 'INCIDENT_JS', 'VMT_JS', 'FAULT_INPUT', *patch)
    saved = {k: getattr(slurp, k, None) for k in names}
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        start = {'incidents.js': TEXT['incidents.js'], 'vmt.js': TEXT['vmt.js'],
                 'faultfrac.csv': TEXT['faultfrac.csv'] if fault_text is None else fault_text}
        for name, text in start.items(): (d / name).write_text(text)
        slurp.fetch_nhtsa_csv = lambda stamp: (list(ROWS) + list(extra), HEADERS)
        slurp.INCIDENT_JS, slurp.VMT_JS, slurp.FAULT_INPUT = d / 'incidents.js', d / 'vmt.js', d / 'faultfrac.csv'
        for k, v in patch.items(): setattr(slurp, k, v)
        try:
            slurp.main(); stop = ''
        except AssertionError as e:
            stop = str(e)
        finally:
            for k, v in saved.items(): setattr(slurp, k, v)
        changed = sorted(name for name, text in start.items() if (d / name).read_text() != text)
        incidents = json.loads(_segment((d / 'incidents.js').read_text(), '/* INCIDENT_DATA_START */', '/* INCIDENT_DATA_END */')) if stop == '' else None
    return {'stop': stop, 'changed': changed, 'incidents': incidents}
_filed = slurp.filed_incident_rows(ROWS)
_versions = collections.Counter(r['Report ID'] for r in _filed)
_reports = collections.Counter(r['Same Incident ID'] for r in _filed)
_REVIEWED = set()
for _name in ('OPERATOR_TYPE_OVERRIDE', 'TELEOP_DRIVEN_REPORTS', 'REMOTE_LANGUAGE_ADS_DRIVEN',
              'SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN', 'PASSENGER_OVERRIDE', 'OCCUPANCY_LANGUAGE_REVIEWED',
              'SPLIT_SAME_INCIDENT_REPORTS', 'SUPERSEDED_REPORTS', 'LOCATION_OVERRIDE', 'SEVERITY_OVERRIDE',
              'AIRBAG_OVERRIDE', 'VEHICLES_INVOLVED'):
    _REVIEWED |= set(getattr(slurp, _name, ()))
def _trips(r):
    probe = dict(r, **{'Report ID': 'synthetic-probe'})
    for check in (slurp.check_teleop_classified, slurp.check_safety_driver_classified, slurp.check_occupancy_classified):
        try: check(probe)
        except AssertionError: return True
    return False
def template(month):
    label = datetime.date.fromisoformat(month + '-01').strftime('%b-%Y').upper()
    eligible = [r for r in _filed
                if r['Reporting Entity'] == 'Waymo LLC' and r['Report Type'].strip() == '5-Day'
                and r['Incident Date'].strip() == label and r['Driver / Operator Type'].strip() == 'None'
                and slurp.is_public_service_incident(r) and r['City'].strip() and r['State'].strip()
                and r['Highest Injury Severity Alleged'].strip() != 'Unknown'
                and _versions[r['Report ID']] == 1 and _reports[r['Same Incident ID']] == 1
                and r['Report ID'] not in _REVIEWED and r['Same Incident ID'] not in _REVIEWED
                and not _trips(r)]
    assert eligible, ('no template filing for', month)
    return min(eligible, key=lambda r: r['Report ID'])
def clone(row, rid, **fields):
    c = dict(row)
    c.update({'Report ID': rid, 'Same Incident ID': rid})
    c.update(fields)
    return c
`;

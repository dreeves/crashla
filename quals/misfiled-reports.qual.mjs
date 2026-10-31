// Reports an ADS drove that NHTSA filed outside its ADS file (decision of
// 2026-10-31, open question 1: "Reviewed list + tripwire"). NHTSA files each
// report by its latest version's "Automation System Engaged?": ADS reports in
// the ADS file, Level 2 (ADAS) reports in the ADAS file, and reports whose
// automation system was not reported in the OTHER file (NHTSA's SGO page,
// https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting,
// read 2026-10-31). Waymo 30270-14303 (San Francisco, MAR-2026, a Monthly
// report submitted APR-2026) is coded "ADAS" though its narrative says the
// Level 4 ADS was driving, so it sat only in the ADAS file, which slurp did not
// read: the one report on Waymo's own crash list (hub CSV2, through Jun 2026)
// that the page lacked.
//
// Spec: slurp fetches and snapshots NHTSA's current ADAS and OTHER files with
// the ADS files and reads from them only the reports MISFILED_ADS_REPORTS
// lists (with their reviewed operator type, automation system and the
// narrative's words saying an ADS drove), contact areas moved to their true
// labels as in the current ADS file. It stops on any other Waymo, Tesla or
// Zoox report in those files coded "None", "Remote (Commercial / Test)",
// "Other, see Narrative" or "Unknown" that neither MISFILED_ADS_REPORTS nor
// NON_ADS_FILE_EXCLUDED lists, and on a listed report that has left its file,
// is also in the ADS files, or whose latest filing no longer carries the
// reviewed values or words. The admitted rows then meet every check an ADS-file
// row meets. 30270-14303 is rated 0.1, the value the fault corpus gives a
// stopped AV whose own passenger opened a door into a passing vehicle.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { parseCsv } from "./csv-parse.mjs";

const REVIEW_TYPES = ["None", "Remote (Commercial / Test)", "Other, see Narrative", "Unknown"];
const py = String.raw`
import csv, glob, importlib.util, io, json, pathlib
spec = importlib.util.spec_from_file_location('slurp_misfiled', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
REVIEW_TYPES = set(json.loads(__import__('sys').argv[1]))
out = {'urls': [getattr(slurp, 'NHTSA_ADAS_CSV_URL', None), getattr(slurp, 'NHTSA_OTHER_CSV_URL', None)],
       'sources': [list(s) for s in getattr(slurp, 'NON_ADS_SOURCES', ())],
       'misfiled': {k: list(v) for k, v in getattr(slurp, 'MISFILED_ADS_REPORTS', {}).items()},
       'excluded': {k: list(v) for k, v in getattr(slurp, 'NON_ADS_FILE_EXCLUDED', {}).items()}}
snap = pathlib.Path('data/snapshots')
texts = {p: (sorted(snap.glob(p + '-*.csv')) or [None])[-1] for p in ('nhtsa-adas', 'nhtsa-other')}
out['snapshots'] = {p: (path.name if path else None) for p, path in texts.items()}
texts = {p: path.read_text(encoding='utf-8') for p, path in texts.items() if path}
# this qual's own tripwire recount over the two newest snapshots
need = []
for p, text in texts.items():
    latest = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r['Report ID'].strip() and r['Report Version'].strip():
            if r['Report ID'] not in latest or int(r['Report Version']) > int(latest[r['Report ID']]['Report Version']):
                latest[r['Report ID']] = r
    need += [[p, rid, r['Reporting Entity'], r['Driver / Operator Type'].strip()] for rid, r in latest.items()
             if r['Reporting Entity'].strip() in slurp.HELMER_SHORT
             and r['Driver / Operator Type'].strip() in REVIEW_TYPES]
out['need'] = need
rows = slurp.newest_snapshot_rows()
ads = [r for _u, p, parse in slurp.NHTSA_SOURCES for r in parse(open(slurp.latest_snapshot_path(p), newline='', encoding='utf-8').read())]
out['adsCount'] = len(ads)
out['extra'] = [{k: r[k] for k in ('Report ID', 'Report Version', 'Driver / Operator Type', 'Automation System Engaged?',
                                    'CP Contact Area - Front Left', 'CP Contact Area - Front', 'SV Contact Area - Right')}
                for r in rows[len(ads):]]
out['adsPrefix'] = rows[:len(ads)] == ads
admit = getattr(slurp, 'misfiled_ads_rows', None)
def stops(ads_rows, non_ads):
    if admit is None: return 'slurp.py has no misfiled_ads_rows'
    try: admit(ads_rows, non_ads); return ''
    except AssertionError as e: return str(e)
def with_rows(text, change):
    rdr = list(csv.DictReader(io.StringIO(text)))
    fields = list(rdr[0].keys())
    rdr = change(rdr)
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=fields, lineterminator='\n'); w.writeheader(); w.writerows(rdr)
    return buf.getvalue()
if len(texts) == 2:
    adas = texts['nhtsa-adas']
    tmpl = next(r for r in csv.DictReader(io.StringIO(adas)) if r['Report ID'] == '30270-14303')
    def add(row):
        return lambda rs: rs + [dict(tmpl, **row)]
    out['stop'] = {
      'baseline': stops(ads, texts),
      'unlistedWaymo': stops(ads, dict(texts, **{'nhtsa-adas': with_rows(adas, add({'Report ID': '30270-99001', 'Same Incident ID': 'synthetic-99001'}))})),
      'unlistedZooxOther': stops(ads, dict(texts, **{'nhtsa-other': with_rows(texts['nhtsa-other'], add({'Report ID': '30610-99002', 'Same Incident ID': 'synthetic-99002', 'Reporting Entity': 'Zoox, Inc.', 'Driver / Operator Type': 'Unknown', 'Automation System Engaged?': 'Unknown'}))})),
      'teslaConsumer': stops(ads, dict(texts, **{'nhtsa-adas': with_rows(adas, add({'Report ID': '13781-99003', 'Same Incident ID': 'synthetic-99003', 'Reporting Entity': 'Tesla, Inc.', 'Driver / Operator Type': 'Consumer'}))})),
      'operatorChanged': stops(ads, dict(texts, **{'nhtsa-adas': with_rows(adas, add({'Report Version': '2', 'Report Type': 'Update', 'Driver / Operator Type': 'In-Vehicle (Commercial / Test)'}))})),
      'movedToAds': stops(ads + [dict(tmpl, **{'Automation System Engaged?': 'ADS'})], texts),
      'gone': stops(ads, dict(texts, **{'nhtsa-adas': with_rows(adas, lambda rs: [r for r in rs if r['Report ID'] != '30270-14303'])})),
      'unquoted': stops(ads, dict(texts, **{'nhtsa-adas': with_rows(adas, add({'Report Version': '2', 'Report Type': 'Update', 'Narrative': 'The Waymo AV was stopped and a passenger opened its door.'}))})),
    }
# fetch_nhtsa_csv: four files fetched and snapshotted, the same rows as the snapshots give
class Resp:
    def __init__(self, body): self.body = body; self.headers = {'Last-Modified': 'Thu, 15 Oct 2026 12:30:00 GMT', 'ETag': None}
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self.body
urls = {slurp.NHTSA_ADS_CSV_URL: 'nhtsa-current', slurp.NHTSA_ADS_ARCHIVE_URL: 'nhtsa-archive'}
urls.update({u: p for u, p in getattr(slurp, 'NON_ADS_SOURCES', ())})
bodies = {u: open(slurp.latest_snapshot_path(p), 'rb').read() for u, p in urls.items() if slurp.latest_snapshot_path(p)}
fetched, saved = [], []
slurp.urllib.request.urlopen = lambda url, timeout=60: (fetched.append(url), Resp(bodies[url]))[1]
slurp.snapshot_csv_if_changed = lambda prefix, text, stamp: saved.append(prefix)
import contextlib
try:
    with contextlib.redirect_stdout(io.StringIO()):
        got, headers = slurp.fetch_nhtsa_csv('qual')
    out['fetch'] = {'urls': sorted(fetched), 'saved': sorted(saved), 'sameRows': got == rows, 'headers': sorted(headers)}
except Exception as e:
    out['fetch'] = {'error': repr(e)}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py, JSON.stringify(REVIEW_TYPES)], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: read data/slurp.py's non-ADS-file tables and loaders on the newest snapshots.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));
const BASE = "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Incident_Reports_";

assert.deepEqual([S.urls, S.sources], [[BASE + "ADAS.csv", BASE + "OTHER.csv"], [[BASE + "ADAS.csv", "nhtsa-adas"], [BASE + "OTHER.csv", "nhtsa-other"]]],
  `Replicata: read NHTSA_ADAS_CSV_URL, NHTSA_OTHER_CSV_URL and NON_ADS_SOURCES in data/slurp.py.
Expectata: NHTSA's current ADAS and OTHER files, snapshotted as nhtsa-adas-* and nhtsa-other-*.
Resultata: ${JSON.stringify([S.urls, S.sources])}.`);
assert.ok(S.snapshots["nhtsa-adas"] && S.snapshots["nhtsa-other"],
  `Replicata: list data/snapshots for the newest nhtsa-adas-* and nhtsa-other-* files.
Expectata: both exist (the release's two non-ADS files, read with the ADS files).
Resultata: ${JSON.stringify(S.snapshots)}.`);
assert.deepEqual(Object.keys(S.misfiled), ["30270-14303"],
  `Replicata: list MISFILED_ADS_REPORTS in data/slurp.py.
Expectata: exactly 30270-14303, the one report in NHTSA's non-ADS files that a Waymo, Tesla or Zoox ADS drove.
Resultata: ${JSON.stringify(Object.keys(S.misfiled))}.`);
const listed = new Set([...Object.keys(S.misfiled), ...Object.keys(S.excluded)]);
const unlisted = S.need.filter(([, rid]) => !listed.has(rid));
assert.deepEqual(unlisted, [],
  `Replicata: list every Waymo, Tesla or Zoox report in the newest nhtsa-adas and nhtsa-other snapshots whose latest operator type is ${REVIEW_TYPES.join(", ")}.
Expectata: each is in MISFILED_ADS_REPORTS or NON_ADS_FILE_EXCLUDED.
Resultata: unlisted ${JSON.stringify(unlisted)}.`);
assert.ok(S.adsPrefix && S.extra.length === 1 && S.extra[0]["Report ID"] === "30270-14303"
  && S.extra[0]["Automation System Engaged?"] === "ADAS" && S.extra[0]["CP Contact Area - Front Left"] === "Y"
  && S.extra[0]["CP Contact Area - Front"] !== "Y" && S.extra[0]["SV Contact Area - Right"] === "Y",
  `Replicata: compare slurp.newest_snapshot_rows() with the newest ADS current and archive snapshots' rows.
Expectata: the ADS rows, then 30270-14303's one row from the ADAS file, its contact areas under their true labels (the crash partner's front left, published under "Front": "the front left side of the passenger car made contact").
Resultata: ADS rows first ${S.adsPrefix}; rows after them ${JSON.stringify(S.extra)}.`);
const st = S.stop || {};
assert.equal(st.baseline, "",
  `Replicata: call slurp.misfiled_ads_rows on the newest snapshots. Expectata: it returns the listed rows. Resultata: ${JSON.stringify(st.baseline)}.`);
const want = { unlistedWaymo: /30270-99001/, unlistedZooxOther: /30610-99002/, operatorChanged: /30270-14303/, movedToAds: /30270-14303/, gone: /30270-14303/, unquoted: /30270-14303/ };
const quiet = Object.entries(want).filter(([k, re]) => !(re.test(st[k] || "") && /MISFILED_ADS_REPORTS/.test(st[k] || ""))).map(([k]) => [k, (st[k] || "").slice(0, 200)]);
assert.deepEqual(quiet, [],
  `Replicata: call slurp.misfiled_ads_rows on the newest snapshots changed one way each: an unlisted driverless Waymo report in the ADAS file, an unlisted Zoox report coded Unknown in the OTHER file, 30270-14303 re-filed as "In-Vehicle (Commercial / Test)", 30270-14303 also in the ADS rows, 30270-14303 gone from the ADAS file, and 30270-14303 re-filed without the words saying its ADS drove.
Expectata: each stops, naming the report and MISFILED_ADS_REPORTS.
Resultata: ${JSON.stringify(quiet)}.`);
assert.equal(st.teslaConsumer, "",
  `Replicata: call slurp.misfiled_ads_rows with an added Tesla "Consumer" report in the ADAS file (a Level 2 crash of a customer's car).
Expectata: no stop: a consumer at the wheel is not an ADS-driven robotaxi.
Resultata: ${JSON.stringify((st.teslaConsumer || "").slice(0, 200))}.`);
assert.ok(S.fetch && !S.fetch.error && S.fetch.sameRows
  && JSON.stringify(S.fetch.urls) === JSON.stringify([BASE + "ADAS.csv", BASE + "ADS.csv", BASE + "OTHER.csv", "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADS.csv"].sort())
  && JSON.stringify(S.fetch.saved) === JSON.stringify(["nhtsa-adas", "nhtsa-archive", "nhtsa-current", "nhtsa-other"]),
  `Replicata: call slurp.fetch_nhtsa_csv with NHTSA served from the newest snapshots.
Expectata: it fetches and snapshots the ADS current and archive files and the current ADAS and OTHER files, and returns the rows slurp.newest_snapshot_rows() gives.
Resultata: ${JSON.stringify(S.fetch)}.`);

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx);
const rec = vm.runInContext("INCIDENT_DATA", ctx).find(r => r.reportId === "30270-14303");
const [header, ...rows] = parseCsv(fs.readFileSync("data/faultfrac.csv", "utf8"));
const row = rows.find(r => r[header.indexOf("reportID")] === "30270-14303");
const got = rec && { helmer: rec.helmer, date: rec.date, city: rec.city, speed: rec.speed, svHit: rec.svHit, cpHit: rec.cpHit,
  faultfrac: rec.fault?.faultfrac, csv: row ? Number(row[header.indexOf("faultfrac")]) : null };
assert.deepEqual(got, { helmer: "Waymo", date: "MAR-2026", city: "San Francisco", speed: 0, svHit: "right", cpHit: "front left", faultfrac: 0.1, csv: 0.1 },
  `Replicata: look up 30270-14303 in data/incidents.js and data/faultfrac.csv.
Expectata: the Waymo crash of MAR-2026 in San Francisco, stopped (0 mph), its right side struck by the passing car's front left, rated 0.1 in both files.
Resultata: ${JSON.stringify(got)}.`);

console.log("qual pass: slurp reads NHTSA's ADAS and OTHER files for the one ADS-driven report filed there, 30270-14303, and stops on any unreviewed Waymo, Tesla or Zoox report in them that an ADS could have driven");

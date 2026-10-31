// The data-through month's five-day receipt coverage is observed / expected
// (2026-10-30, D6: the human asked for "the most careful conservative or
// exquisitely correct thing"). A release holds the reports received through
// its cutoff, which cover only part of the data-through month's crashes; the
// share present had been taken from earlier months' first-release shares (the
// median of FIVE_DAY_RECEIPT_OBSERVATIONS, 0.28 [0.20, 0.52]), which is right
// only if that share holds steady, and it fell from 0.50 in February 2026 to
// 0.21 in August, while September's own count, 7, was the lowest yet. Now,
// parallel to the pooled Monthly-track incident coverage (incident_coverage):
//   observed = the month's in-scope five-day-track incidents in this release
//     (an incident's track is its first filing's Report Type, REPORT_TRACK);
//   expected = each company's five-day-track count in its most recent month
//     before the data-through month (final at this, its second normal
//     release) with >= 3 such incidents and VMT, scaled by the VMT ratio,
//     pooled over the companies with VMT in the month (a company with no such
//     month stays out of the pool, as in incident_coverage);
//   best = observed / expected; lo = best x exp(-1.96 sqrt(1/observed +
//     1/reference)), on the log scale as incident_coverage computes it;
//   hi = FIVE_DAY_RECEIPT_COVERAGE_MAX, the highest first-release share on
//     record padded (0.52 against February's 0.50): the reading in which the
//     month's low count is real rather than lagging.
// FIVE_DAY_RECEIPT_OBSERVATIONS stays (quals/receipt-observations.qual.mjs
// recounts it) and sets the high edge. The Monthly-track metrics' effective
// exposure does not move: incident_coverage is conditional on the receipt
// best, so the product receipt best x incident coverage is the month's
// all-incident observed / expected whatever the receipt best is.
//
// This qual pins: the estimator on a synthetic world and its stops; on the
// Oct-15-2026 release, the one D6 was decided on, the counts the September
// 2026 estimate rests on, which no revision of the miles moves (September's
// 7, all Waymo; the reference months Waymo's August, 46, and Zoox's June, 4;
// Tesla, with no month of 3, out of the pool), and slurp's estimate against
// the one those counts and data/vmt.csv's miles give (0.1356 on the miles of
// 2026-10-31, D6's "September best ~0.13-0.15"); and on the newest
// snapshots, whatever release they hold, the estimate's shape (0 < lo < best
// <= hi = FIVE_DAY_RECEIPT_COVERAGE_MAX), this qual's own recount of it,
// data/vmt.js carrying it, and the Monthly-track product. Its first version
// (2026-10-31) pinned September's best, 0.13-0.15, on the newest snapshots,
// which the next release (data-through October) would have turned red, and
// recounted with slurp's own deduplication; both were fixed after review the
// same day.
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";

const py = String.raw`
import collections, importlib.util, json, math
spec = importlib.util.spec_from_file_location('slurp_receipt_cov', 'data/slurp.py')
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
iso = slurp.nhtsa_month_to_iso
out = {'max': slurp.FIVE_DAY_RECEIPT_COVERAGE_MAX, 'dataThrough': slurp.NHTSA_DATA_THROUGH_DATE}

# --- 1. a synthetic world (data-through month 2031-06) ----------------------
def counts_of(five_day):
    c = collections.Counter()
    for (h, m), n in five_day.items(): c[(h, m, 'five_day')] = n
    c[('Waymo', '2031-05', 'monthly')] = 30   # Monthly-track counts never enter
    return c
W_FIVE = {('Waymo', '2031-04'): 40, ('Waymo', '2031-05'): 50, ('Waymo', '2031-06'): 8,
          ('Zoox', '2031-04'): 4, ('Zoox', '2031-05'): 2, ('Zoox', '2031-06'): 1,
          ('Tesla', '2031-05'): 1}
W_VMT = {('Waymo', '2031-04'): 90, ('Waymo', '2031-05'): 100, ('Waymo', '2031-06'): 110,
         ('Zoox', '2031-04'): 10, ('Zoox', '2031-05'): 11, ('Zoox', '2031-06'): 12,
         ('Tesla', '2031-05'): 5, ('Tesla', '2031-06'): 6}
def call(date='2031-06-16', month='2031-06', five=W_FIVE, vmt=W_VMT, **patch):
    tables = {'FIVE_DAY_RECEIPT_OBSERVATIONS': {'2031-05': (12, 40)}, 'RECEIPT_MONTHS_EXCLUDED': {}, **patch}
    saved = {k: getattr(slurp, k) for k in tables}
    for k, v in tables.items(): setattr(slurp, k, v)
    try:
        return list(slurp.release_month_coverage(date, month, counts_of(five), vmt))
    except AssertionError as e:
        return str(e)[:300]
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
out['synthetic'] = {
    'baseline': call(),
    # no five-day-track incident of the data-through month at all
    'zero': call(five={**W_FIVE, ('Waymo', '2031-06'): 0, ('Zoox', '2031-06'): 0}),
    # more present than the highest share on record allows
    'aboveMax': call(five={**W_FIVE, ('Waymo', '2031-06'): 40}),
    # the high edge below an observed first-release share
    'maxBelowObserved': call(FIVE_DAY_RECEIPT_COVERAGE_MAX=0.25),
    # a cutoff month that is not the newest incident month
    'cutoff': call(date='2031-05-15'),
    # the month that just became final has no observation
    'due': call(FIVE_DAY_RECEIPT_OBSERVATIONS={'2031-04': (12, 40)}),
}

# --- This qual's own count of in-scope incidents per (company, month) -------
# all of them, and the five-day track (first filing 1-Day or 5-Day,
# REPORT_TRACK); deduplicated as main() does, by this code: each Report ID's
# highest version, slurp's scope (is_public_service_incident) less the reports
# a re-filing in the same rows replaced (SUPERSEDED_REPORTS: an earlier
# release's rows, from before the re-filing, keep the original), one report
# per Same Incident ID (per Report ID for SPLIT_SAME_INCIDENT_REPORTS).
def own_counts(rows):
    filed = [r for r in rows if r['Report ID'].strip() and r['Report Version'].strip()
             and r['Same Incident ID'].strip() and r['Incident Date'].strip()]
    first_type = {r['Report ID']: r['Report Type'].strip() for r in filed if int(r['Report Version']) == 1}
    latest = {}
    for r in filed:
        if r['Report ID'] not in latest or int(r['Report Version']) > int(latest[r['Report ID']]['Report Version']):
            latest[r['Report ID']] = r
    replaced = {old for old, new in slurp.SUPERSEDED_REPORTS.items() if new in latest}
    by_inc = {}
    for rid, r in latest.items():
        if not slurp.is_public_service_incident(r) or rid in replaced: continue
        key = rid if rid in slurp.SPLIT_SAME_INCIDENT_REPORTS else r['Same Incident ID']
        assert key not in by_inc, ('two in-scope reports under one Same Incident ID', key, rid, by_inc[key]['Report ID'])
        by_inc[key] = r
    every, five = collections.Counter(), collections.Counter()
    for r in by_inc.values():
        k = (slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip()))
        every[k] += 1
        if first_type[r['Report ID']] in ('1-Day', '5-Day'): five[k] += 1
    return every, five
def mshift(m, n):
    y, mo = divmod(int(m[:4]) * 12 + int(m[5:]) - 1 + n, 12)
    return f"{y}-{mo + 1:02d}"
COMPANIES = sorted(set(slurp.HELMER_SHORT.values()))
def pooled(counts, D, through, vmt):
    obs = exp = ref = 0
    pool = {}
    for h in COMPANIES:
        if vmt.get((h, D), 0) <= 0: continue
        months = sorted((m for (c, m), n in counts.items() if c == h and m <= through[h] and n >= 3 and vmt.get((c, m), 0) > 0), reverse=True)
        if not months: pool[h] = None; continue
        m = months[0]
        pool[h] = [m, counts[(h, m)], counts[(h, D)]]
        obs += counts[(h, D)]; exp += counts[(h, m)] * vmt[(h, D)] / vmt[(h, m)]; ref += counts[(h, m)]
    return obs, exp, ref, pool
def triple(obs, exp, ref):
    best = obs / exp
    return [round(best, 4), round(best * math.exp(-1.96 * math.sqrt(1 / obs + 1 / ref)), 4), slurp.FIVE_DAY_RECEIPT_COVERAGE_MAX]
def keyed(counter):
    return {f"{h} {m}": n for (h, m), n in sorted(counter.items()) if n}
def tracks(counts, wanted):
    out = collections.Counter()
    for (h, m, track), n in counts.items():
        if track in wanted: out[(h, m)] += n
    return keyed(out)
def disagreement(a, b):
    return {k: [a.get(k, 0), b.get(k, 0)] for k in sorted(set(a) | set(b)) if a.get(k, 0) != b.get(k, 0)}
vmt = slurp.parse_vmt_values(slurp.read_vmt_master())

# --- 2. the newest snapshots, whatever release they hold ---------------------
rows = slurp.newest_snapshot_rows()
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
counts = slurp.monthly_track_counts(rows)
out['release'] = list(slurp.release_month_coverage(slurp.NHTSA_DATA_THROUGH_DATE, D, counts, vmt))
every, five = own_counts(rows)
obs, exp, ref, pool = pooled(five, D, {h: mshift(D, -1) for h in COMPANIES}, vmt)
out['recount'] = {'observed': obs, 'expected': exp, 'reference': ref, 'pool': pool, 'triple': triple(obs, exp, ref)}
out['countsDisagree'] = {'fiveDay': disagreement(tracks(counts, {'five_day'}), keyed(five)),
                         'all': disagreement(tracks(counts, {'five_day', 'monthly'}), keyed(every))}
# The Monthly-track product: the month's all-incident observed / expected,
# each company's reference month outside its Monthly-report lag.
a_obs, a_exp, _a_ref, _a_pool = pooled(every, D, {h: mshift(D, -1 - lag) for h, lag in slurp.MONTHLY_ARRIVAL_LAG.items()}, vmt)
out['allIncidentRatio'] = a_obs / a_exp

# --- 2b. the Oct-15-2026 release (data-through 2026-09-15), pinned -----------
# Its two files as that release read them: the Oct-15 current snapshot and
# the archive, unchanged since the Mar-27-2026 snapshot.
OCT15 = {'nhtsa-current': 'nhtsa-current-20261015T110551.csv', 'nhtsa-archive': 'nhtsa-archive-20260327T081858.csv'}
oct_rows = []
for _url, prefix, parse in slurp.NHTSA_SOURCES:
    with open(slurp.SNAPSHOT_DIR / OCT15[prefix], newline='', encoding='utf-8') as f:
        oct_rows += parse(f.read())
oct_counts = slurp.monthly_track_counts(oct_rows)
_oct_every, oct_five = own_counts(oct_rows)
out['oct15'] = {
    'countsDisagree': disagreement(tracks(oct_counts, {'five_day'}), keyed(oct_five)),
    'pool': pooled(oct_five, '2026-09', {h: '2026-08' for h in COMPANIES}, vmt)[3],
    'vmt': {f"{h} {m}": vmt[(h, m)] for h, m in (('Waymo', '2026-08'), ('Waymo', '2026-09'), ('Zoox', '2026-06'), ('Zoox', '2026-09'))},
    'triple': list(slurp.release_month_coverage('2026-09-15', '2026-09', oct_counts, vmt)),
}
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: call data/slurp.py's release_month_coverage on a synthetic world, on the newest snapshots and on the Oct-15-2026 release, and recount the five-day-track incidents.
Expectata: release_month_coverage(data_through_date, last_month, counts, vmt) and FIVE_DAY_RECEIPT_COVERAGE_MAX exist and run.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const r = JSON.parse(run.stdout.trim().split("\n").at(-1));

// 1. The synthetic world: Waymo's reference is 2031-05 (50 incidents, VMT 100
// -> 110: 55 expected), Zoox's 2031-04 (4 incidents, its newest month with at
// least 3; VMT 10 -> 12: 4.8), Tesla has no month with 3 and stays out of the
// pool; observed 8 + 1 = 9 of 59.8, reference 54.
const best = 9 / 59.8, lo = best * Math.exp(-1.96 * Math.sqrt(1 / 9 + 1 / 54));
const round4 = x => Math.round(x * 1e4) / 1e4;
assert.deepEqual(r.synthetic.baseline, [round4(best), round4(lo), r.max],
  `Replicata: release_month_coverage on a synthetic world (data-through month 2031-06; Waymo 50 five-day-track incidents in 2031-05 at VMT 100 and 8 in 2031-06 at VMT 110; Zoox 4 in 2031-04 at VMT 10, 2 in 2031-05 and 1 in 2031-06 at VMT 12; Tesla 1 in 2031-05).
Expectata: [${round4(best)}, ${round4(lo)}, ${r.max}]: 9 observed over 59.8 expected (Waymo's reference 2031-05, Zoox's 2031-04, Tesla out of the pool), the low edge on the log scale over 9 observed and 54 reference incidents, the high edge FIVE_DAY_RECEIPT_COVERAGE_MAX.
Resultata: ${JSON.stringify(r.synthetic.baseline)}.`);
const stops = {
  zero: /five-day-track incident/,
  aboveMax: /FIVE_DAY_RECEIPT_COVERAGE_MAX/,
  maxBelowObserved: /FIVE_DAY_RECEIPT_COVERAGE_MAX/,
  cutoff: /NHTSA_DATA_THROUGH_DATE/,
  due: /FIVE_DAY_RECEIPT_OBSERVATIONS/,
};
for (const [name, re] of Object.entries(stops)) {
  assert.ok(typeof r.synthetic[name] === "string" && re.test(r.synthetic[name]),
    `Replicata: release_month_coverage on the synthetic world with "${name}" (${{zero: "no five-day-track incident in the data-through month", aboveMax: "40 Waymo incidents in 2031-06, a share above the high edge", maxBelowObserved: "FIVE_DAY_RECEIPT_COVERAGE_MAX 0.25, below the observed 12/40", cutoff: "a 2031-05 cutoff with 2031-06 incidents", due: "no observation for 2031-05, the month that just became final"}[name]}).
Expectata: it stops, naming what to edit (${re}).
Resultata: ${JSON.stringify(r.synthetic[name])}.`);
}

// 2. The newest snapshots, whatever release they hold: the estimate's shape,
// and slurp's triple equal to this qual's own recount. Nothing here is
// specific to one release.
const [rb, rl, rh] = r.release;
assert.ok(0 < rl && rl < rb && rb <= rh && rh === r.max && r.max <= 1,
  `Replicata: release_month_coverage on the newest snapshots (data-through ${r.dataThrough}).
Expectata: 0 < lo < best <= hi = FIVE_DAY_RECEIPT_COVERAGE_MAX (${r.max}) <= 1.
Resultata: ${JSON.stringify(r.release)}.`);
assert.deepEqual(r.countsDisagree, { fiveDay: {}, all: {} },
  `Replicata: count the in-scope incidents of the newest snapshots per company and month with slurp's monthly_track_counts and with this qual's own deduplication (each Report ID's highest version, slurp's scope less the reports a re-filing in the same rows replaced (SUPERSEDED_REPORTS), one report per Same Incident ID or per Report ID for SPLIT_SAME_INCIDENT_REPORTS).
Expectata: the two agree, five-day track and all incidents.
Resultata: {"company month": [slurp, this qual]} ${JSON.stringify(r.countsDisagree)}.`);
assert.deepEqual(r.release, r.recount.triple,
  `Replicata: pool the data-through month's five-day-track incidents of the newest snapshots, counted by this qual, over each company's reference month (its most recent earlier month with at least 3 and miles; a company with none stays out).
Expectata: slurp's triple equals the recount (${JSON.stringify(r.recount)}).
Resultata: slurp ${JSON.stringify(r.release)}.`);

// 2b. The Oct-15-2026 release (data-through 2026-09-15), the release D6 was
// decided on, read from its own snapshots: the counts September 2026's
// estimate rests on, which no revision of the miles moves, and the estimate
// those counts give at data/vmt.csv's miles (0.1356 on the miles of
// 2026-10-31).
const o = r.oct15;
assert.deepEqual(o.countsDisagree, {},
  `Replicata: count the five-day-track incidents of the Oct-15-2026 release (nhtsa-current-20261015T110551.csv and nhtsa-archive-20260327T081858.csv) per company and month with slurp's monthly_track_counts and with this qual's own deduplication.
Expectata: the two agree.
Resultata: {"company month": [slurp, this qual]} ${JSON.stringify(o.countsDisagree)}.`);
const OCT15_POOL = { Tesla: null, Waymo: ["2026-08", 46, 7], Zoox: ["2026-06", 4, 0] };
assert.deepEqual(o.pool, OCT15_POOL,
  `Replicata: in the Oct-15-2026 release, find each company's reference month for September 2026's five-day receipt coverage (its most recent month through August with at least 3 five-day-track incidents and miles) and its September count.
Expectata: {company: [reference month, its count, September's count]} ${JSON.stringify(OCT15_POOL)}: 7 observed, all Waymo, over 46 + 4 = 50 reference incidents; Tesla, with no month of 3, out of the pool.
Resultata: ${JSON.stringify(o.pool)}.`);
const octExpected = 46 * o.vmt["Waymo 2026-09"] / o.vmt["Waymo 2026-08"] + 4 * o.vmt["Zoox 2026-09"] / o.vmt["Zoox 2026-06"];
const octBest = 7 / octExpected, octLo = octBest * Math.exp(-1.96 * Math.sqrt(1 / 7 + 1 / 50));
assert.deepEqual(o.triple, [round4(octBest), round4(octLo), r.max],
  `Replicata: release_month_coverage("2026-09-15", "2026-09", ...) on the Oct-15-2026 release, with data/vmt.csv's miles (${JSON.stringify(o.vmt)}).
Expectata: [${round4(octBest)}, ${round4(octLo)}, ${r.max}]: 7 observed over 46 x Waymo's September miles / its August miles + 4 x Zoox's September miles / its June miles = ${octExpected.toFixed(2)} expected, the low edge on the log scale over 7 observed and 50 reference incidents, the high edge FIVE_DAY_RECEIPT_COVERAGE_MAX.
Resultata: ${JSON.stringify(o.triple)}.`);

// 3. data/vmt.js carries that triple in the data-through month, for every
// line, and (1, 1, 1) elsewhere; the Monthly-track product is unchanged.
const ctx = vm.createContext({ console, Math, Number,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } } });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const rows = JSON.parse(vm.runInContext(`JSON.stringify(parseVmtCsv(VMT_CSV_TEXT).map(x => ({
  helmer: x.helmer, month: x.month, rec: [x.coverage, x.coverageMin, x.coverageMax], inc: [x.incCov, x.incCovMin, x.incCovMax]})))`, ctx));
const D = r.dataThrough.slice(0, 7);
const wrong = rows.filter(x => JSON.stringify(x.rec) !== JSON.stringify(x.month === D ? r.release : [1, 1, 1]));
assert.deepEqual(wrong, [],
  `Replicata: read every line's receipt coverage from data/vmt.js.
Expectata: ${JSON.stringify(r.release)} in the data-through month ${D}, [1, 1, 1] in every other month.
Resultata: ${JSON.stringify(wrong.slice(0, 6))}.`);
const dRows = rows.filter(x => x.month === D);
const products = dRows.map(x => x.rec[0] * x.inc[0]);
assert.ok(dRows.length >= 3 && products.every(p => Math.abs(p - r.allIncidentRatio) <= 5e-5 * r.release[0] + 1e-12),
  `Replicata: multiply each line's receipt coverage best by its incident coverage best in ${D} (data/vmt.js).
Expectata: the month's all-incident observed / expected, ${r.allIncidentRatio} (recounted here), within the 4-decimal rounding of the incident coverage: the Monthly-track metrics' exposure does not depend on the receipt estimate.
Resultata: ${JSON.stringify(products)}.`);

console.log(`qual pass: the data-through month's five-day receipt coverage is observed / expected (${D}: ${r.recount.observed} of ${r.recount.expected.toFixed(1)}, ${JSON.stringify(r.release)}), recounted by this qual, carried by data/vmt.js, and the Monthly-track product stays the all-incident ratio ${r.allIncidentRatio}; on the Oct-15-2026 release September's 7 of ${octExpected.toFixed(1)} give ${JSON.stringify(o.triple)}`);

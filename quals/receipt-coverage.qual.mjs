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
// This qual pins: the estimator on a synthetic world, its stops, the
// September 2026 value on the newest snapshots (best 0.13-0.15), an
// independent recompute of it, data/vmt.js carrying it, and the Monthly-track
// product.
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

# --- 2. the newest snapshots, through slurp and recounted here -------------
rows = slurp.newest_snapshot_rows()
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
vmt = slurp.parse_vmt_values(slurp.read_vmt_master())
out['release'] = list(slurp.release_month_coverage(slurp.NHTSA_DATA_THROUGH_DATE, D, slurp.monthly_track_counts(rows), vmt))
# Independent recount: in-scope incidents, deduplicated as main() does, by
# their first filing's Report Type, then the pooled estimate.
filed = [r for r in rows if r['Report ID'].strip() and r['Report Version'].strip()
         and r['Same Incident ID'].strip() and r['Incident Date'].strip()]
first_type = {r['Report ID']: r['Report Type'].strip() for r in filed if int(r['Report Version']) == 1}
five = collections.Counter()
for r in slurp.public_service_incidents(filed).values():
    if first_type[r['Report ID']] in ('1-Day', '5-Day'):
        five[(slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip()))] += 1
def mshift(m, n):
    y, mo = divmod(int(m[:4]) * 12 + int(m[5:]) - 1 + n, 12)
    return f"{y}-{mo + 1:02d}"
every = collections.Counter()
for r in slurp.public_service_incidents(filed).values():
    every[(slurp.HELMER_SHORT[r['Reporting Entity'].strip()], iso(r['Incident Date'].strip()))] += 1
def pooled(counts, through):
    obs = exp = ref = 0
    pool = {}
    for h in sorted(set(slurp.HELMER_SHORT.values())):
        if vmt.get((h, D), 0) <= 0: continue
        months = sorted((m for (c, m), n in counts.items() if c == h and m <= through[h] and n >= 3 and vmt.get((c, m), 0) > 0), reverse=True)
        if not months: pool[h] = None; continue
        m = months[0]
        pool[h] = [m, counts[(h, m)], counts[(h, D)]]
        obs += counts[(h, D)]; exp += counts[(h, m)] * vmt[(h, D)] / vmt[(h, m)]; ref += counts[(h, m)]
    return obs, exp, ref, pool
obs, exp, ref, pool = pooled(five, {h: mshift(D, -1) for h in slurp.MONTHLY_ARRIVAL_LAG})
best = obs / exp
out['recount'] = {'observed': obs, 'expected': exp, 'reference': ref, 'pool': pool,
                  'triple': [round(best, 4), round(best * math.exp(-1.96 * math.sqrt(1 / obs + 1 / ref)), 4), slurp.FIVE_DAY_RECEIPT_COVERAGE_MAX]}
# The Monthly-track product: the month's all-incident observed / expected,
# each company's reference month outside its Monthly-report lag.
a_obs, a_exp, _a_ref, _a_pool = pooled(every, {h: mshift(D, -1 - lag) for h, lag in slurp.MONTHLY_ARRIVAL_LAG.items()})
out['allIncidentRatio'] = a_obs / a_exp
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
assert.equal(run.status, 0,
  `Replicata: call data/slurp.py's release_month_coverage on a synthetic world and on the newest snapshots, and recount the data-through month's five-day-track incidents.
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

// 2. The newest snapshots: September 2026's 7 in-scope five-day-track
// incidents (all Waymo) over ~51.6 expected.
const [rb, rl, rh] = r.release;
assert.ok(rb >= 0.13 && rb <= 0.15 && 0 < rl && rl < rb && rh === r.max && r.max <= 1,
  `Replicata: release_month_coverage on the newest snapshots (data-through ${r.dataThrough}).
Expectata: best 0.13-0.15 (observed over expected), 0 < lo < best, hi = FIVE_DAY_RECEIPT_COVERAGE_MAX (${r.max}).
Resultata: ${JSON.stringify(r.release)}.`);
assert.deepEqual(r.release, r.recount.triple,
  `Replicata: recount the data-through month's in-scope five-day-track incidents from the newest snapshots with this qual's own code and pool them over each company's reference month.
Expectata: slurp's triple equals the recount (${JSON.stringify(r.recount)}).
Resultata: slurp ${JSON.stringify(r.release)}.`);

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

console.log(`qual pass: the data-through month's five-day receipt coverage is observed / expected (${r.recount.observed} of ${r.recount.expected.toFixed(1)}: ${JSON.stringify(r.release)}), recounted independently, carried by data/vmt.js, and the Monthly-track product stays the all-incident ratio ${r.allIncidentRatio}`);

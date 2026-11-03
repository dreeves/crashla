// A re-filing under a new Report ID keeps its crash's track (2026-11-02, the
// human's answer to open question 26(a)). An incident's track (REPORT_TRACK in
// data/slurp.py) is the Report Type of its crash's first filing: 1-Day or
// 5-Day (SGO Request No. 1) or Monthly (Request No. 2). The receipt and
// Monthly-arrival tables count each month's crashes by track in the month's
// first release and again in the newest file (monthly_track_counts), so a
// crash must keep one track from release to release. Until 2026-11-02 the
// track was the surviving report's own version-1 Report Type, so a crash a
// company re-filed under a new Report ID (SUPERSEDED_REPORTS) took the
// re-filing's: a re-filing whose version 1 is typed "Update" stopped
// monthly_track_counts with a message that named no checklist step, and a
// Monthly re-filing of a 5-Day report moved its crash from the five-day track
// in the month's first release to the Monthly track in the newest file. Now a
// re-filing takes the track of the report it replaced (that report's
// version-1 filing), and an in-scope report whose first filing is of no track
// (a re-filing nobody has listed) stops the run naming the step that lists it.
//
// Replicata: a driverless Waymo 5-Day filing of the data-through month in the
// newest snapshots, re-filed under a new Report ID and the same Same Incident
// ID, the re-filing listed in SUPERSEDED_REPORTS as replacing it; once with
// the re-filing's version 1 typed "Update", once typed "Monthly". And a copy
// of that filing under its own Report ID and Same Incident ID whose version 1
// is typed "Update", listed nowhere.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

const py = SLURP_OFFLINE_PY + String.raw`
D = slurp.NHTSA_DATA_THROUGH_DATE[:7]
t = template(D)
O = t['Report ID']
def counts(extra=(), **patch):
    saved = {k: getattr(slurp, k) for k in patch}
    for k, v in patch.items(): setattr(slurp, k, v)
    try:
        c = slurp.monthly_track_counts(list(ROWS) + list(extra))
        return {'counts': {'|'.join(k): n for k, n in sorted(c.items())}, 'stop': ''}
    except AssertionError as e:
        return {'counts': None, 'stop': str(e)[:600]}
    finally:
        for k, v in saved.items(): setattr(slurp, k, v)
def refiling(rid, report_type):
    return clone(t, rid, **{'Same Incident ID': t['Same Incident ID'], 'Report Version': '1',
                            'Report Type': report_type})
def listed(new):
    return {**slurp.SUPERSEDED_REPORTS, O: new}
out = {'original': O, 'originalType': t['Report Type'], 'month': D, 'helmer': slurp.HELMER_SHORT[t['Reporting Entity'].strip()]}
out['base'] = counts()
out['update'] = counts([refiling('synthetic-refiling-u', 'Update')], SUPERSEDED_REPORTS=listed('synthetic-refiling-u'))
out['monthly'] = counts([refiling('synthetic-refiling-m', 'Monthly')], SUPERSEDED_REPORTS=listed('synthetic-refiling-m'))
out['unlisted'] = counts([clone(t, 'synthetic-unlisted', **{'Report Version': '1', 'Report Type': 'Update'})])
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: call data/slurp.py's monthly_track_counts on the newest snapshots, with and without synthetic re-filings.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-1500)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));
const key = `${S.helmer}|${S.month}|five_day`;
assert.ok(S.base.stop === "" && S.base.counts[key] >= 1 && S.originalType === "5-Day",
  `Replicata: call slurp.monthly_track_counts on the newest snapshots' rows.
Expectata: it counts the in-scope incidents by track, ${S.original} (a ${S.originalType} filing) among ${key}.
Resultata: ${S.base.stop || JSON.stringify(S.base.counts[key])}.`);
for (const [name, type] of [["update", "Update"], ["monthly", "Monthly"]]) {
  const s = S[name];
  assert.ok(s.stop === "" && JSON.stringify(s.counts) === JSON.stringify(S.base.counts),
    `Replicata: re-file ${S.original} (${S.month}, a 5-Day filing, in scope) under a new Report ID and its Same Incident ID, the re-filing's version 1 typed "${type}", list the re-filing in SUPERSEDED_REPORTS as replacing it, and call slurp.monthly_track_counts on the newest snapshots' rows plus the re-filing.
Expectata: the counts are the counts without the re-filing (the month's first release, from before it): the crash keeps the five-day track of the report it replaced.
Resultata: ${s.stop ? `stopped: ${JSON.stringify(s.stop.slice(0, 300))}` : `${key} ${s.counts[key]} against ${S.base.counts[key]}; ${S.helmer}|${S.month}|monthly ${s.counts[`${S.helmer}|${S.month}|monthly`]} against ${S.base.counts[`${S.helmer}|${S.month}|monthly`]}`}.`);
}
assert.ok(S.unlisted.stop.includes("synthetic-unlisted") && /SUPERSEDED_REPORTS/.test(S.unlisted.stop)
  && /data\/README\.md, Each NHTSA release, step 6/.test(S.unlisted.stop),
  `Replicata: add to the newest snapshots' rows an in-scope copy of ${S.original} under a Report ID and Same Incident ID of its own whose version 1 is typed "Update" (a re-filing nobody has listed), and call slurp.monthly_track_counts.
Expectata: it stops naming the report, SUPERSEDED_REPORTS (where a re-filing is listed with the report it replaced) and the checklist step that covers it (data/README.md, Each NHTSA release, step 6).
Resultata: ${S.unlisted.stop ? JSON.stringify(S.unlisted.stop.slice(0, 400)) : "completed"}.`);
console.log(`qual pass: a re-filing under a new Report ID keeps the track of the report it replaced (an "Update"- or "Monthly"-typed re-filing of ${S.original} leaves every count as it was), and an unlisted report with no first filing of a known track stops slurp naming step 6`);

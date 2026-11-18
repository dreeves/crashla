import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// The VMT master (data/vmt.csv) is a per-helmer monthly ledger: each helmer's
// months are contiguous from its first row to its last, and
// helmer_cumulative_vmt is the exact running sum of the monthly vmt column.
// The ledger must also stay ahead of NHTSA: slurp.py aborts if NHTSA reports
// an incident in a month with no VMT row, so each monthly cycle adds the next
// month's rows BEFORE the ~mid-month data drop: every line runs through at
// least the month after the data-through month, read from data/slurp.py's
// NHTSA_DATA_THROUGH_DATE (the ghost month, quals/ghost-month.qual.mjs).
// Until 2026-11-17 that month was a literal here, FRESH_THROUGH, moved by hand
// at each release.
//
// Sanity ranges (since 2026-11-17). Until then this qual pinned each line's
// newest cumulative (CUME_PINS), a figure copied from the file it checks and
// re-pinned whenever a row was restated; the human: "maybe they should be
// sanity checks, like only failing on insane numbers, not merely mildly
// surprising numbers?", then "sure, convert outcome pins to sanity check
// ranges". The running sums are still exact, and each line's rows are
// recomputed or held to their sources elsewhere (waymo-vmt-model,
// zoox-vmt-model, tesla-vmt-provenance, tesla-unsupervised-floor,
// tesla-no-monitor, tesla-camera-miles, vmt-rationale-text). What a slip of
// a digit would break is checked here:
//   - a month's miles lie within a factor of the month before's: JUMP.mature
//     once the month before reached RAMP_BELOW miles (the most seen on
//     2026-11-17: x2.28, Tesla's no-monitor line in October 2026), JUMP.ramp
//     below it, where a line is starting up (the most seen: x12.6, Tesla's
//     second month);
//   - each band edge lies within BAND of the month's miles (seen: x0.29 to
//     x3.51, Tesla's first month).

// teslanomonitor (2026-10-23) is a second Tesla line, not a company: the miles
// Tesla counts as driven with no safety monitor aboard (Jan 2026 on).
const HELMERS = ["waymo", "tesla", "zoox", "teslanomonitor"];
const RAMP_BELOW = 100000;
const JUMP = { ramp: 20, mature: 4 };
const BAND = [0.1, 10];
const cutoff = /^NHTSA_DATA_THROUGH_DATE = "(\d{4}-\d{2})-\d{2}"$/m.exec(fs.readFileSync("data/slurp.py", "utf8"));
assert.ok(cutoff !== null,
  `Replicata: read NHTSA_DATA_THROUGH_DATE from data/slurp.py.
Expectata: a line NHTSA_DATA_THROUGH_DATE = "YYYY-MM-DD".
Resultata: none.`);

// Quote-aware CSV parse (quals/csv-parse.mjs): a naive comma split can't tell
// a column boundary from a comma inside an unquoted rationale, and slurp.py's
// row[8] read would silently truncate such a rationale at its first comma.
// Parsing properly and demanding exactly 9 fields per row makes that
// corruption loud.

const parsed = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const rows = parsed.slice(1).map(p => {
  assert.equal(p.length, 9,
    `Replicata: parse the data/vmt.csv row starting ${JSON.stringify(p.slice(0, 2).join(","))} with a quote-aware CSV parser.
Expectata: exactly 9 fields (a rationale containing commas must be double-quoted, or slurp truncates it at the first comma).
Resultata: ${p.length} fields.`);
  return { helmer: p[0], month: p[1], vmt: +p[2], cume: +p[3], vmin: +p[6], vmax: +p[7] };
});

const nextMonth = m => {
  const [y, mo] = m.split("-").map(Number);
  return `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}`;
};

const state = {}; // helmer -> { month, cume, vmt }
for (const r of rows) {
  assert.ok(HELMERS.includes(r.helmer),
    `Replicata: parse a data/vmt.csv line as a row.
Expectata: every row's helmer is one of ${HELMERS.join("/")} (a stray line — e.g. an embedded newline in a rationale — must fail loudly).
Resultata: helmer ${JSON.stringify(r.helmer)}.`);
  assert.ok(/^\d{4}-\d{2}$/.test(r.month),
    `Replicata: read the month field of a ${r.helmer} row.
Expectata: zero-padded ISO month (YYYY-MM) so lexicographic order is chronological order.
Resultata: ${JSON.stringify(r.month)}.`);
  assert.ok(Number.isFinite(r.vmt) && Number.isFinite(r.cume),
    `Replicata: parse vmt and helmer_cumulative_vmt for ${r.helmer} ${r.month}.
Expectata: finite numbers.
Resultata: vmt ${r.vmt}, cume ${r.cume}.`);
  assert.ok(Number.isFinite(r.vmin) && Number.isFinite(r.vmax) && r.vmin > 0 && r.vmin <= r.vmt && r.vmt <= r.vmax,
    `Replicata: check ${r.helmer} ${r.month}'s monthly band.
Expectata: 0 < vmt_min <= vmt <= vmt_max (the app asserts band ordering only for months already active in vmt.js; future rows awaiting incident data need the guard here).
Resultata: [${r.vmin}, ${r.vmax}] around ${r.vmt}.`);
  assert.ok(r.vmin >= BAND[0] * r.vmt && r.vmax <= BAND[1] * r.vmt,
    `Replicata: compare ${r.helmer} ${r.month}'s band edges with its miles.
Expectata: each edge within x${BAND[0]} to x${BAND[1]} of the month's miles (a sanity range: an edge outside it has a digit too many or too few, or the range needs widening with the human).
Resultata: [${r.vmin}, ${r.vmax}] around ${r.vmt}: x${(r.vmin / r.vmt).toFixed(3)} to x${(r.vmax / r.vmt).toFixed(2)}.`);
  const prev = state[r.helmer];
  if (prev === undefined) {
    assert.equal(r.cume, r.vmt,
      `Replicata: read ${r.helmer}'s first row (${r.month}).
Expectata: no prior miles, so helmer_cumulative_vmt equals vmt.
Resultata: vmt ${r.vmt}, cume ${r.cume}.`);
  } else {
    assert.equal(r.month, nextMonth(prev.month),
      `Replicata: step from ${r.helmer} ${prev.month} to the next row.
Expectata: months are contiguous (next row is ${nextMonth(prev.month)}).
Resultata: ${r.month}.`);
    assert.equal(r.cume, prev.cume + r.vmt,
      `Replicata: add ${r.helmer} ${r.month}'s vmt (${r.vmt}) to the prior cumulative (${prev.cume}).
Expectata: helmer_cumulative_vmt is the exact running sum (${prev.cume + r.vmt}).
Resultata: ${r.cume}.`);
    const factor = prev.vmt < RAMP_BELOW ? JUMP.ramp : JUMP.mature;
    assert.ok(r.vmt <= factor * prev.vmt && prev.vmt <= factor * r.vmt,
      `Replicata: compare ${r.helmer} ${r.month}'s miles (${r.vmt}) with the month before's (${prev.vmt}).
Expectata: within a factor of ${factor} (${JUMP.mature} once the month before reached ${RAMP_BELOW} miles, ${JUMP.ramp} below it, where a line is starting up): a sanity range, so a month outside it has a digit too many or too few, or is news that needs the range widened with the human.
Resultata: a factor of ${(Math.max(r.vmt / prev.vmt, prev.vmt / r.vmt)).toFixed(2)}.`);
  }
  state[r.helmer] = { month: r.month, cume: r.cume, vmt: r.vmt };
}

const ghostMonth = nextMonth(cutoff[1]);
for (const h of HELMERS) {
  assert.ok(state[h] !== undefined && state[h].month >= ghostMonth,
    `Replicata: find ${h}'s latest row in data/vmt.csv.
Expectata: rows through at least ${ghostMonth}, the month after the data-through month of data/slurp.py's NHTSA_DATA_THROUGH_DATE (${cutoff[1]}), added ahead of that month's NHTSA data.
Resultata: latest ${h} month is ${state[h]?.month}.`);
}

console.log(`qual pass: vmt.csv ledger is contiguous with exact running sums through ${Object.values(state).map(s => s.month).join("/")} (at least ${ghostMonth}, the month after the data-through month), each month within a factor of ${JUMP.mature} of the month before (${JUMP.ramp} while a line is under ${RAMP_BELOW} miles a month) and each band edge within x${BAND[0]} to x${BAND[1]} of its month's miles`);

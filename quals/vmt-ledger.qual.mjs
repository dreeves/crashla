import assert from "node:assert/strict";
import fs from "node:fs";

// The VMT master (data/vmt.csv) is a per-helmer monthly ledger: each helmer's
// months are contiguous from its first row to its last, and
// helmer_cumulative_vmt is the exact running sum of the monthly vmt column.
// The ledger must also stay ahead of NHTSA: slurp.py aborts if NHTSA reports
// an incident in a month with no VMT row, so each monthly cycle adds the next
// month's rows BEFORE the ~mid-month data drop. The freshness pin below
// advances with each cycle (2026-08-04 cycle: rows through 2026-07).

const HELMERS = ["waymo", "tesla", "zoox"];
const FRESH_THROUGH = "2026-07";

// Regression pins for the latest estimate rows (authored values, not external
// anchors — external anchors live in the *-vmt-provenance quals). A silent
// edit or a running-sum slip on the newest rows trips these.
const CUME_PINS = {
  "waymo|2026-07": 301450000,
  "tesla|2026-07": 2610000,
  "zoox|2026-07": 3051000,
};

// Quote-aware CSV parse: a naive comma split can't tell a column boundary
// from a comma inside an unquoted rationale, and slurp.py's row[8] read would
// silently truncate such a rationale at its first comma. Parsing properly and
// demanding exactly 9 fields per row makes that corruption loud.
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0].trim() !== "");
}

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

const state = {}; // helmer -> { month, cume }
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
  }
  state[r.helmer] = { month: r.month, cume: r.cume };
}

for (const h of HELMERS) {
  assert.ok(state[h] !== undefined && state[h].month >= FRESH_THROUGH,
    `Replicata: find ${h}'s latest row in data/vmt.csv.
Expectata: rows extend through at least ${FRESH_THROUGH} (added ahead of the NHTSA data drop for that month).
Resultata: latest ${h} month is ${state[h]?.month}.`);
}

for (const [key, cume] of Object.entries(CUME_PINS)) {
  const [h, month] = key.split("|");
  const row = rows.find(r => r.helmer === h && r.month === month);
  assert.ok(row !== undefined && row.cume === cume,
    `Replicata: read the ${h} ${month} row.
Expectata: helmer_cumulative_vmt pinned at ${cume}.
Resultata: ${row === undefined ? "row missing" : row.cume}.`);
}

console.log(`qual pass: vmt.csv ledger is contiguous with exact running sums through ${Object.values(state).map(s => s.month).join("/")}`);

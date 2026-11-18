// A new Fatality incident must stop the run once, so that a person reads its
// narrative before the fatality metric moves. The reason is the metric, not
// any copy: it divides each death by vehiclesInvolved (Koopman/Piper
// fractional-death attribution), and data/slurp.py DEFAULTS that field to 2,
// so a fatality whose narrative reveals a pileup would take the wrong share
// unless someone counts the vehicles and records the count in
// VEHICLES_INVOLVED. Nothing else in the pipeline asks for that read. So:
// every fatality's crash has a VEHICLES_INVOLVED entry (the count and the
// narrative's words that give it, the default 2 included), and the page's
// data carries that count.
//
// Until 2026-11-17 this qual also pinned outcomes copied from the data:
// exactly 3 fatalities, all of them Waymo's, each fault value at most 0.05,
// and its own copy of the three vehicle counts (EXPECTED_VEHICLES). A fourth
// fatality, a first Tesla or Zoox one, or a blind rater's 0.1 would each
// have turned it red after the entry above was written, with nothing left to
// do but re-pin. The human, 2026-11-17: "maybe they should be sanity checks,
// like only failing on insane numbers, not merely mildly surprising
// numbers?", then "sure, convert outcome pins to sanity check ranges". What
// is left of them is sanity: a vehicle count is a whole number from 1 to
// MOST_VEHICLES, and each fatality's fault value is rated and lies in [0, 1].
// The pass line reports how many fatalities there are and whose.
//
// Historical note: until 2026-09-15 this qual also guarded a hard-coded
// parenthetical in the "Severity breakdown" section that described each
// fatality's speed. That sentence was removed — it restated, less reliably, what
// the incident browser already shows per row (fault value plus the full
// narrative), and it described the whole dataset while sitting above a windowed
// table, so it read as wrong whenever a fatality fell outside the selected
// range. The speed assertion went with it; speeds were only ever pinned to keep
// that sentence honest.
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { appScript, dataScript } from "./load-app.mjs";

const MOST_VEHICLES = 50;

const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// Each fatality with its crash: a second AV's record (secondOf) shares the
// crash, and the count, of the report it rides on.
const fatalities = JSON.parse(JSON.stringify(vm.runInContext(
  `INCIDENT_DATA.filter(r => r.severity === "Fatality")
     .map(r => ({reportId: r.reportId, crash: r.secondOf ?? r.reportId, helmer: r.helmer, city: r.city, date: r.date,
       fault: r.fault === null ? null : Number(r.fault.faultfrac), vehiclesInvolved: r.vehiclesInvolved}))`,
  ctx)));

const SEEN = JSON.stringify(fatalities);
const FIX = `=> A Fatality incident was added or changed. Read its narrative, count the vehicles involved, and record the count in VEHICLES_INVOLVED in data/slurp.py as (count, the narrative's words that give it), the default 2 included; then run slurp.`;

// The reviewed counts: {report: count}.
const reviewed = JSON.parse(execFileSync("python3", ["-c",
  `import json, sys\nsys.path.insert(0, "data")\nimport slurp\nprint(json.dumps({rid: count for rid, (count, _words) in slurp.VEHICLES_INVOLVED.items()}))`],
  { encoding: "utf8" }).trim().split("\n").at(-1));

const unreviewed = fatalities.filter(f => reviewed[f.crash] === undefined).map(f => f.crash);
assert.deepEqual(unreviewed, [],
  `Replicata: list each fatality's report and look it up in VEHICLES_INVOLVED in data/slurp.py.\nExpectata: every fatality has an entry (count, the narrative's words that give it), even when the count is the default 2.\nResultata: no entry for ${JSON.stringify(unreviewed)} — ${SEEN}.\n${FIX}`);

const miscounted = fatalities.filter(f => f.vehiclesInvolved !== reviewed[f.crash]);
assert.deepEqual(miscounted, [],
  `Replicata: compare each fatality's vehiclesInvolved in data/incidents.js with its VEHICLES_INVOLVED entry in data/slurp.py (${JSON.stringify(reviewed)}).\nExpectata: the same count: each death is divided by the count a person read from its narrative.\nResultata: ${JSON.stringify(miscounted)}.\n${FIX}`);

const insane = fatalities.filter(f => !(Number.isInteger(f.vehiclesInvolved) && f.vehiclesInvolved >= 1 && f.vehiclesInvolved <= MOST_VEHICLES));
assert.deepEqual(insane, [],
  `Replicata: read each fatality's vehicle count.\nExpectata: a whole number from 1 to ${MOST_VEHICLES} (a sanity range).\nResultata: ${JSON.stringify(insane)}.`);

// A fatality with no fault value yet (fault null: its rating has not run) must
// fail HERE with a message, not crash the map above with a TypeError before
// any message prints (as it did until 2026-09-26).
const unrated = fatalities.filter(f => !(f.fault !== null && Number.isFinite(f.fault) && f.fault >= 0 && f.fault <= 1));
assert.deepEqual(unrated, [],
  `Replicata: read each fatality's fault value.\nExpectata: rated, a number in [0, 1] (python3 data/faultrate.py rates an unrated incident).\nResultata: ${JSON.stringify(unrated)}.`);

const byHelmer = Object.entries(fatalities.reduce((n, f) => ({ ...n, [f.helmer]: (n[f.helmer] ?? 0) + 1 }), {})).map(([h, n]) => `${h} ${n}`).join(", ");
console.log(`qual pass: ${fatalities.length} fatalities (${byHelmer}), each death divided by a vehicle count a person read from its narrative (VEHICLES_INVOLVED), each fault value rated (${SEEN})`);

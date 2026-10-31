// A narrative that counts the vehicles in its crash ("All three vehicles
// sustained damage", "all four vehicles involved") carries that count in the
// incident's vehiclesInvolved (data/slurp.py VEHICLES_INVOLVED; decision of
// 2026-10-31 on open question 11, "(b)": the 2026-08-22 audit inventory added
// 56 such counts, and 11 Jul-Aug 2026 reports since then lacked theirs). The
// field's default is 2, and only the fatality metric reads it (the
// fractional-death divisor; quals/fatality-guard.qual.mjs forces a human count
// for each fatality), so these nonfatal counts move no displayed number: they
// keep the field true where the narrative is explicit. Narratives that number
// vehicles less directly ("a third passenger car", bystander crashes the AV
// was not part of) keep the default, as the 2026-08-22 entry left six.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const N = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const COUNT = /\ball\s+(three|four|five|six|seven|eight)\s+vehicles\b/i;
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx);
const records = [...vm.runInContext("INCIDENT_DATA", ctx)];   // a main-realm array, so assert's deepEqual compares like with like
// One record per crash: a second AV's record (secondOf) repeats its report's narrative.
const stated = records.filter(r => r.secondOf === undefined)
  .map(r => [r, (r.narrative.match(COUNT) || [])[1]]).filter(([, n]) => n !== undefined);
const wrong = stated.filter(([r, n]) => r.vehiclesInvolved !== N[n.toLowerCase()])
  .map(([r, n]) => `${r.reportId}: "all ${n} vehicles", vehiclesInvolved ${r.vehiclesInvolved}`);
assert.deepEqual(wrong, [],
  `Replicata: read every incident's narrative in data/incidents.js for "all <N> vehicles" ("All three vehicles sustained damage", "all four vehicles involved sustained damage") and its vehiclesInvolved.
Expectata: vehiclesInvolved is N wherever the narrative says so (VEHICLES_INVOLVED in data/slurp.py).
Resultata: ${wrong.length} differ: ${JSON.stringify(wrong, null, 1)}.`);
const fatal = stated.filter(([r]) => r.severity === "Fatality").map(([r]) => r.reportId);
const app = fs.readFileSync("crashla.js", "utf8");
const reads = (app.match(/\bvehiclesInvolved\b/g) || []).length;
assert.ok(fatal.length === 0 && /rec\.fatality \+= Number\(inc\.severity === "Fatality"\) \/ inc\.vehiclesInvolved;/.test(app),
  `Replicata: list the counted incidents that are fatal, and find where crashla.js reads vehiclesInvolved (${reads} mentions).
Expectata: none is fatal, and the fatality metric's divisor is where the page uses the field, so these counts move nothing it displays.
Resultata: fatal ${JSON.stringify(fatal)}.`);
console.log(`qual pass: all ${stated.length} narratives that say "all N vehicles" carry N in vehiclesInvolved`);

import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  Number,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

const counts = vm.runInContext(`
  (() => {
    const byMonth = {};
    for (const inc of INCIDENT_DATA) {
      byMonth[inc.date] = (byMonth[inc.date] || 0) + 1;
    }
    return byMonth;
  })()
`, ctx);

const june = counts["JUN-2025"] || 0;
const july = counts["JUL-2025"] || 0;

assert.ok(
  june >= 50,
  `Replicata: count JUN-2025 incidents in INCIDENT_DATA.
Expectata: at least 50 incidents (a half-month would yield ~28-30).
Resultata: found ${june}.`);

assert.ok(
  june >= july * 0.5 && june <= july * 2,
  `Replicata: compare JUN-2025 incident count to JUL-2025 (a known full month).
Expectata: June count is within 0.5x-2x of July count (both are full months).
Resultata: June=${june}, July=${july}, ratio=${(june / july).toFixed(2)}.`);

console.log("qual pass: June 2025 incident count is consistent with a full month");

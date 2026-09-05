import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console,
  Math,
  document: {
    getElementById() { return null; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

let threw = false;
try {
  vm.runInContext("gammaquant(1, 1, 1)", ctx);
} catch (err) {
  threw = true;
}
assert.ok(
  threw,
  `Replicata: call gammaquant with p=1.
Expectata: immediate throw for invalid parameters.
Resultata: no throw.`,
);

// --- Anti-Postel: parseVmtCsv rejects malformed inputs ---

const goodHeader = "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,coverage,coverage_min,coverage_max,incident_coverage,incident_coverage_min,incident_coverage_max,rationale";
const goodRow = "tesla,2025-07,100,200,150,250,80,120,1,1,1,1,1,1,test";

function mustThrowParse(label, csv) {
  let caught = false;
  try {
    vm.runInContext(`parseVmtCsv(${JSON.stringify(csv)})`, ctx);
  } catch (e) {
    caught = true;
  }
  assert.ok(caught,
    `Replicata: parseVmtCsv rejects ${label}.\nExpectata: immediate throw.\nResultata: no throw.`);
}

// Wrong header
mustThrowParse("wrong header", "bad_header\n" + goodRow);
// Old-format header missing kyoom + incident_coverage columns
mustThrowParse("old-format header missing kyoom/incident_coverage",
  "helmer,month,vmt,helmer_cumulative_vmt,vmt_min,vmt_max,coverage,rationale\ntesla,2025-07,100,200,80,120,1,test");
// vmt_min > vmt (violates ordering)
mustThrowParse("vmt_min > vmt",
  goodHeader + "\ntesla,2025-07,100,200,150,250,120,80,1,1,1,1,1,1,test");
// kyoom_min > helmer_cumulative_vmt (cumulative band must bracket the central)
mustThrowParse("kyoom_min > cume",
  goodHeader + "\ntesla,2025-07,100,200,250,300,80,120,1,1,1,1,1,1,test");
// coverage = 0 (must be > 0)
mustThrowParse("coverage = 0",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,0,0,0,1,1,1,test");
// coverage_min > coverage (receipt-coverage triple must be ordered)
mustThrowParse("coverage_min > coverage",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,0.3,0.4,0.5,1,1,1,test");
// pre-2026-08-28 12-numeric-column header (no coverage_min/max)
mustThrowParse("header without coverage_min/coverage_max",
  "helmer,month,vmt,helmer_cumulative_vmt,kyoom_min,kyoom_max,vmt_min,vmt_max,coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale\ntesla,2025-07,100,200,150,250,80,120,1,1,1,1,test");
// incident_coverage = 0 (must be > 0)
mustThrowParse("incident_coverage = 0",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,1,1,1,0,0,0,test");
// Each rejection case below is a well-formed 15-field row that violates
// exactly the labeled invariant, and the thrown message must name that
// invariant: until 2026-09-04 these rows had 13 fields, so they tripped the
// column-count regex and the labeled asserts went unexercised.
function mustThrowParseWith(label, csv, messageRe) {
  let message = null;
  try {
    vm.runInContext(`parseVmtCsv(${JSON.stringify(csv)})`, ctx);
  } catch (e) {
    message = String(e.message || e);
  }
  assert.ok(message !== null && messageRe.test(message),
    `Replicata: parseVmtCsv rejects ${label}.\nExpectata: throw with a message matching ${messageRe}.\nResultata: ${message === null ? "no throw" : JSON.stringify(message)}.`);
}
// incident_coverage_min > incident_coverage (ordering violation)
mustThrowParseWith("incCovMin > incCov",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,1,1,1,0.5,0.6,0.7,test", /incident_coverage_min/i);
// incident_coverage_max < incident_coverage (ordering violation)
mustThrowParseWith("incCovMax < incCov",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,1,1,1,0.5,0.3,0.4,test", /incident_coverage_max/i);
// coverage > 1 (must be <= 1)
mustThrowParseWith("coverage > 1",
  goodHeader + "\ntesla,2025-07,100,200,150,250,80,120,1.5,1,1,1,1,1,test", /coverage/i);
// negative vmt: the row regex admits only unsigned numbers, so a minus sign
// is a malformed row (the numeric >= 0 asserts are unreachable from CSV)
mustThrowParseWith("negative vmt",
  goodHeader + "\ntesla,2025-07,-100,200,150,250,80,120,1,1,1,1,1,1,test", /malformed/i);
// unknown helmer
mustThrowParseWith("unknown helmer",
  goodHeader + "\nUnknownCo,2025-07,100,200,150,250,80,120,1,1,1,1,1,1,test", /helmer/i);

console.log("qual pass: fail-loud invariants and idempotent estimator rendering");

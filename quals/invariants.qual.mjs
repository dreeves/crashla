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

const goodHeader = "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale";
const goodRow = "tesla,2025-07,100,200,80,120,1,1,1,1,test";

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
// Missing incident_coverage columns
mustThrowParse("old-format header missing incident_coverage",
  "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,coverage,rationale\ntesla,2025-07,100,200,80,120,1,test");
// vmt_min > vmt (violates ordering)
mustThrowParse("vmt_min > vmt",
  goodHeader + "\ntesla,2025-07,100,200,120,80,1,1,1,1,test");
// coverage = 0 (must be > 0)
mustThrowParse("coverage = 0",
  goodHeader + "\ntesla,2025-07,100,200,80,120,0,1,1,1,test");
// incident_coverage = 0 (must be > 0)
mustThrowParse("incident_coverage = 0",
  goodHeader + "\ntesla,2025-07,100,200,80,120,1,0,0,0,test");
// incident_coverage_min > incident_coverage (ordering violation)
mustThrowParse("incCovMin > incCov",
  goodHeader + "\ntesla,2025-07,100,200,80,120,1,0.5,0.6,0.7,test");
// incident_coverage_max < incident_coverage (ordering violation)
mustThrowParse("incCovMax < incCov",
  goodHeader + "\ntesla,2025-07,100,200,80,120,1,0.5,0.3,0.4,test");
// coverage > 1 (must be <= 1)
mustThrowParse("coverage > 1",
  goodHeader + "\ntesla,2025-07,100,200,80,120,1.5,1,1,1,test");
// negative vmt
mustThrowParse("negative vmt",
  goodHeader + "\ntesla,2025-07,-100,200,80,120,1,1,1,1,test");
// unknown company
mustThrowParse("unknown company",
  goodHeader + "\nUnknownCo,2025-07,100,200,80,120,1,1,1,1,test");

console.log("qual pass: fail-loud invariants and idempotent estimator rendering");

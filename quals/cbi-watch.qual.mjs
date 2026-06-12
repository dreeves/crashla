import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// The app's "Narrative redaction" table (and its assertions in
// sanity-values/sanity-checks quals) were commented out on 2026-06-11
// because every narrative in the dataset is un-redacted: Tesla, which
// once redacted nearly everything as CBI, un-redacted via update reports.
// This qual watches for redaction coming back. If it fires, don't weaken
// it — re-enable the table in crashla.js buildSanityChecks and the
// commented qual blocks instead.

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx, { filename: "incidents.js" });
const incidents = vm.runInContext("INCIDENT_DATA", ctx);

const redacted = incidents.filter(r => r.narrativeCbi === "Y");
assert.equal(
  redacted.length, 0,
  `Replicata: count incidents with narrativeCbi === "Y" in data/incidents.js.
Expectata: zero — the Narrative redaction table was commented out (2026-06-11) on the premise that no current narrative is CBI-redacted.
Resultata: ${redacted.length} redacted narrative(s), e.g. ${JSON.stringify(redacted.slice(0, 3).map(r => r.reportId))}. Re-enable the redaction table in crashla.js buildSanityChecks and the commented blocks in sanity-values/sanity-checks quals.`,
);

console.log("qual pass: no CBI-redacted narratives (redaction table stays commented out)");

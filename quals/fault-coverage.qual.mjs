import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Every incident in data/incidents.js must have a fault assessment row in
// data/faultfrac.csv. Fail loudly when any are missing so backfill work is
// surfaced rather than buried.

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx, { filename: "incidents.js" });
const incidents = vm.runInContext("INCIDENT_DATA", ctx);

const csv = fs.readFileSync("data/faultfrac.csv", "utf8").trim().split("\n");
const header = csv[0].split(",");
const ridIdx = header.indexOf("reportID");
assert.ok(ridIdx >= 0, "faultfrac.csv missing reportID column");
const rated = new Set(csv.slice(1).map(line => line.split(",")[ridIdx]));

const MONTH_NUM = {
  JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6,
  JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12,
};
const monthKey = mmmYYYY => {
  const [mmm, yyyy] = mmmYYYY.split("-");
  return Number(yyyy) * 12 + MONTH_NUM[mmm];
};

const byDriver = {};
for (const r of incidents) {
  const d = byDriver[r.driver] ??= {};
  const m = d[r.date] ??= { total: 0, missing: 0, missingIds: [] };
  m.total += 1;
  if (!rated.has(r.reportId)) {
    m.missing += 1;
    m.missingIds.push(r.reportId);
  }
}

const summary = Object.entries(byDriver).map(([driver, months]) => {
  const ordered = Object.entries(months).sort(
    ([a], [b]) => monthKey(a) - monthKey(b),
  );
  const gaps = ordered
    .filter(([, m]) => m.missing > 0)
    .map(([month, m]) => `${month} ${m.missing}/${m.total}`);
  const totalMissing = ordered.reduce((s, [, m]) => s + m.missing, 0);
  return { driver, totalMissing, gaps };
});

for (const { driver, totalMissing, gaps } of summary) {
  assert.equal(
    totalMissing, 0,
    `Replicata: scan ${driver} incidents in data/incidents.js for reportIds absent from data/faultfrac.csv.
Expectata: every incident has a fault assessment row.
Resultata: ${totalMissing} unrated incident(s) in ${driver}; gaps by month: ${gaps.join(", ")}.`,
  );
}

console.log("qual pass: every incident has a fault assessment row");

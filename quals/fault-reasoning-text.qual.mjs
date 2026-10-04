// Fault reasonings are page text (2026-10-03, audit finding #43). The incident
// browser's Fault tooltip shows data/faultfrac.csv's reasoning verbatim, so a
// reasoning states the crash facts behind its value in plain sentence-case
// prose. It carries no adjudication bookkeeping the page never defines: rule
// labels ("Rule B:"), tier, band, anchor or map names, "aligned to" or
// "matches ... 0.1" calibration notes, "= floor", precedent report IDs, or
// revision dates. Those notes live in the AGENTS.md ledger.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

const [header, ...rows] = parseCsv(fs.readFileSync("data/faultfrac.csv", "utf8"));
const iId = header.indexOf("reportID"), iReason = header.indexOf("reasoning");
assert.ok(iId >= 0 && iReason >= 0, `Replicata: read data/faultfrac.csv's header.\nExpectata: reportID and reasoning columns.\nResultata: ${JSON.stringify(header)}.`);

const JARGON = [
  /\brule [ab]\b/i,            // "Rule A:" / "Rule B:" / "Rule b:"
  /\btier\b/i,                 // "pothole-or-speedbump tier 0.5"
  /\bband\b/i,                 // "band default", "band floor", "band tops at 0.4"
  /\banchor\b/i,               // "rear-end anchor 0"
  /\bprecedent\b/i,            // "(precedent 13781-11687)"
  /\baligned to\b/i,           // "aligned to tire-debris tier 0.1"
  /\bmatches\b[^;]*\b[01]\.\d/i, // "matches Waymo lot-exit 0.1"
  /= ?floor\b/i,               // "wire in headlights = floor"
  /\bmap\b/i,                  // "map closing-gate 0.6 holds"
  /\d{4}-\d{2}-\d{2}/,         // "(2026-09-04)"
  /\b\d{4,5}(?:-\d{3,5})?\b/,  // report IDs: "as 11467", "15468/14627/14492"
];
const bad = [];
for (const r of rows) {
  const text = r[iReason];
  const hits = JARGON.filter(re => re.test(text)).map(re => text.match(re)[0]);
  if (hits.length > 0) bad.push(`${r[iId]}: ${JSON.stringify(hits)} in ${JSON.stringify(text)}`);
  if (!/^[A-Z0-9]/.test(text)) bad.push(`${r[iId]}: starts lowercase ${JSON.stringify(text)}`);
}
assert.deepEqual(bad, [],
  `Replicata: scan every data/faultfrac.csv reasoning (the incident browser's Fault tooltip text).
Expectata: plain crash facts in sentence case: no rule labels, tier/band/anchor/map names, calibration notes, precedent IDs or revision dates.
Resultata: ${bad.length} problems: ${JSON.stringify(bad, null, 1)}.`);

console.log(`qual pass: all ${rows.length} fault reasonings are plain sentence-case crash facts`);

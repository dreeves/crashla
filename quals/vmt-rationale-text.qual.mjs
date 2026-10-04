import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// The sanity section's "VMT sources" table shows every data/vmt.csv rationale
// verbatim (the September rows join it at the ~Oct 15 release), so the
// rationales are page text. Added 2026-10-03 for the 2026-10-02 audit
// findings #38, #39, #47 and #76-#80:
//   (1) every document a rationale cites resolves: it names the file
//       (data/README.md or IGNOREME.md; a bare "README" is ambiguous) and a
//       section heading that exists in it;
//   (2) no repo-internal column name or shorthand (kyoom, vmt_min/vmt_max,
//       TotalVMTZEV, "hub + E", "E lo/hi", "D/H"), none of which the page
//       defines (rule 13);
//   (3) every cumulative value a rationale states for a row is the value the
//       rows carry: a Waymo "<x>M end-<Mon>-<YYYY>" (the form the rationales
//       use for the series' own cumulative anchors) equals that month's
//       cumulative, and a published milestone listed as an "exact central
//       minus ~0.15M" equals that month's cumulative plus 0.15M, each to the
//       stated precision; the Zoox Dec-2025 knot and Tesla's Aug-2026 floor
//       state the band edges their rows carry;
//   (4) the specific facts the audit corrected stay corrected.

const raw = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
const rows = raw.slice(1).map(p => ({
  helmer: p[0], month: p[1], cume: +p[3], kmin: +p[4], kmax: +p[5], rationale: p[8],
}));
const cumeOf = (helmer, month) => rows.find(r => r.helmer === helmer && r.month === month)?.cume;
const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
// Half a unit of the last stated decimal, in miles ("174.26M" -> 5,000), plus
// one mile of float slack.
const halfUnit = num => 0.5 * 10 ** (6 - (num.split(".")[1] || "").length) + 1;
const fmt = n => n.toLocaleString("en-US");

// (1) citations resolve
const headingsOf = path => fs.readFileSync(path, "utf8").split("\n")
  .filter(l => /^#+ /.test(l)).map(l => l.replace(/^#+ /, "").replace(/^\[AI TEXT\] /, "").trim());
const HEADINGS = { "data/README.md": headingsOf("data/README.md"), "IGNOREME.md": headingsOf("IGNOREME.md") };
const badCites = [];
for (const r of rows) {
  for (const m of r.rationale.matchAll(/(data\/README\.md|IGNOREME\.md|README)(?:, ([^;)]+))?/g)) {
    const [whole, file, section] = m;
    if (!(file in HEADINGS) || section === undefined || !HEADINGS[file].includes(section.trim())) {
      badCites.push(`${r.helmer} ${r.month}: ${JSON.stringify(whole)}`);
    }
  }
}

// (2) no internal column names or undefined shorthand
const BANNED = [/\bkyoom/i, /\bvmt_(min|max)\b/, /TotalVMTZEV/, /\bhub ?\+ ?E\b/, /\+ E \d/, /\bE (lo|hi|best)\b/, /\bD\/H\b/];
const jargon = [];
for (const r of rows) for (const re of BANNED) {
  const m = r.rationale.match(re);
  if (m) jargon.push(`${r.helmer} ${r.month}: ${JSON.stringify(m[0])}`);
}

// (3a) Waymo anchors as stated equal the rows' cumulatives
const anchorErrors = [];
for (const r of rows.filter(x => x.helmer === "waymo")) {
  for (const m of r.rationale.matchAll(/(\d+(?:\.\d+)?)M end-([A-Z][a-z]{2})-(\d{4})/g)) {
    const month = `${m[3]}-${MON[m[2]]}`;
    const cume = cumeOf("waymo", month);
    if (cume === undefined || Math.abs(cume - Number(m[1]) * 1e6) > halfUnit(m[1])) {
      anchorErrors.push(`${r.month}: "${m[0]}" vs cumulative ${cume}`);
    }
  }
  // (3b) milestones claimed as exact centrals minus the ~0.15M pre-series miles
  for (const list of r.rationale.matchAll(/\(([^()]*)\) are exact centrals minus ~0\.15M/g)) {
    for (const m of list[1].matchAll(/(\d+(?:\.\d+)?)M (?:end-(\d{4})|([A-Z][a-z]{2})-(\d{4}))/g)) {
      const month = m[2] ? `${m[2]}-12` : `${m[4]}-${MON[m[3]]}`;
      const cume = cumeOf("waymo", month);
      if (cume === undefined || Math.abs(cume + 150000 - Number(m[1]) * 1e6) > halfUnit(m[1])) {
        anchorErrors.push(`${r.month}: milestone "${m[0]}" as an exact central vs cumulative ${cume} + 0.15M`);
      }
    }
  }
}

// (3c) knot and floor rows state the band edges they carry
const unstated = [];
for (const [helmer, month, edges] of [["zoox", "2025-12", ["kmin", "kmax"]], ["tesla", "2026-08", ["kmin"]]]) {
  const r = rows.find(x => x.helmer === helmer && x.month === month);
  for (const e of edges) if (!r.rationale.includes(fmt(r[e]))) unstated.push(`${helmer} ${month}: ${fmt(r[e])}`);
}

// (4) the audit's specific corrections
const FACTS = [
  // #76: a band note runs into the next sentence without a stop
  [r => /±\d+% [A-Z]/.test(r.rationale), "a band note joined to the next sentence ('±25% Re-chained')"],
  // #39: Waymo's 'more than 4,000 vehicles' (TechCrunch, Sep 1) is a fleet figure measured after June
  [r => /fleet figure measured after Jun 2026/.test(r.rationale), "claims no post-June Waymo fleet figure exists"],
  // #77: Q2-2026's monthly estimates ran ~1.4-2.9x high; 28% is the end-Q2 cumulative
  [r => /~28% high for Q2/.test(r.rationale), "states Q2's miss as the cumulative's 28%"],
  // #78: NTA's Sub 5 order is dated Aug 28, 2026
  [r => /Sub 5/.test(r.rationale) && !/Aug 28/.test(r.rationale), "dates Sub 5 other than Aug 28"],
  // #79: the Oct-Dec 2025 bridge was x1.0653 before the 2026-08-28 move
  [r => /x1\.0688/.test(r.rationale), "gives x1.0688 as the prior bridge factor"],
  // #80: Waymo's corrected CSV4 v2 is not yet linked from the hub
  [r => /CSV4 v2/.test(r.rationale) && !/not yet linked/.test(r.rationale), "cites CSV4 v2 without saying it is not yet linked"],
];
const factErrors = [];
for (const r of rows) for (const [bad, what] of FACTS) if (bad(r)) factErrors.push(`${r.helmer} ${r.month}: ${what}`);
const problems = {
  unresolvedCitations: [...new Set(badCites)],
  internalShorthand: jargon,
  anchorsNotTheRows: [...new Set(anchorErrors)],
  bandEdgesNotStated: unstated,
  correctedFactsRecur: factErrors,
};
const failing = Object.fromEntries(Object.entries(problems).filter(([, v]) => v.length > 0));
assert.deepEqual(failing, {},
  `Replicata: read every data/vmt.csv rationale (shown verbatim in the page's VMT sources table) and check (1) citations, (2) internal shorthand, (3) stated anchors and band edges against the rows, (4) the audit's corrected facts.
Expectata: (1) each citation names data/README.md or IGNOREME.md and a section heading that exists there; (2) no kyoom, vmt_min/vmt_max, TotalVMTZEV, "hub + E", "E lo/hi" or "D/H"; (3) each Waymo "<x>M end-<Mon>-<YYYY>" and exact-central milestone equals the rows' cumulative to its stated precision, and the Zoox Dec-2025 knot and Tesla Aug-2026 floor state the band edges their rows carry; (4) none of the corrected statements recurs.
Resultata: ${JSON.stringify(failing, null, 1)}.`);

console.log(`qual pass: ${rows.length} VMT rationales cite resolvable sections, use no internal shorthand, and state the anchors their rows carry`);

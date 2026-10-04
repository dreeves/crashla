import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BOILERPLATE = "Summary: This updated report does not report a new incident or make any material changes to the factual record. It only removes confidential or personally identifying information to make the incident narrative publicly available. ";

// Two Tesla narrative boilerplate patterns must be stripped by slurp.py at
// ingestion: (1) the redacted-update disclaimer prefix and (2) the airbag/tow
// correction addendum (any MM/DD/YYYY date). Once the structured fields are
// corrected, the prose note is just edit history and adds nothing.
const py = `
import json, sys
sys.path.insert(0, "data")
import slurp, inspect
print(json.dumps({
  "constant": slurp.NARRATIVE_BOILERPLATE,
  "airbag_pattern": slurp.NARRATIVE_AIRBAG_CORRECTION.pattern,
  "mojibake_keys": list(slurp.NARRATIVE_MOJIBAKE.keys()),
  "typo_keys": list(slurp.NARRATIVE_TYPOS.keys()),
  "preamble_pattern": slurp.NARRATIVE_UNCHANGED_PREAMBLE.pattern,
  "preamble_probe": {
    "dated": slurp.NARRATIVE_UNCHANGED_PREAMBLE.sub("", "The content of this report is unchanged from the initial report submitted on June 5, 2025 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION]. \\nOn June [XXX], 2025 a Waymo AV", count=1),
    "redacted_date": slurp.NARRATIVE_UNCHANGED_PREAMBLE.sub("", "The content of this report is unchanged from the initial report submitted on February[XXX], 2025 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION]\\nOn February", count=1),
    "with_facts": slurp.NARRATIVE_UNCHANGED_PREAMBLE.sub("", "Other than the updated Speed Limit field, the content of this report is unchanged from the initial report submitted on December 5, 2022 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION].  On December", count=1),
    "mid_text": slurp.NARRATIVE_UNCHANGED_PREAMBLE.sub("", "On June 5 a Waymo AV stopped. The content of this report is unchanged from the initial report submitted on June 5, 2025 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION].", count=1),
  },
  "source": inspect.getsource(slurp),
}))
`;
const out = JSON.parse(
  execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split("\n").at(-1)
);

assert.equal(
  out.constant,
  BOILERPLATE,
  `Replicata: import data/slurp.py and read NARRATIVE_BOILERPLATE.
Expectata: it equals the exact Tesla redacted-update disclaimer including the trailing space.
Resultata: got ${JSON.stringify(out.constant)}.`,
);

assert.ok(
  out.source.includes('removeprefix(NARRATIVE_BOILERPLATE)'),
  `Replicata: inspect data/slurp.py source.
Expectata: the narrative field is normalized with .removeprefix(NARRATIVE_BOILERPLATE) during record building.
Resultata: no such call found in slurp.py.`,
);

assert.ok(
  out.source.includes('NARRATIVE_AIRBAG_CORRECTION.sub'),
  `Replicata: inspect data/slurp.py source.
Expectata: the narrative field is normalized with NARRATIVE_AIRBAG_CORRECTION.sub(...) during record building.
Resultata: no such call found in slurp.py.`,
);

// The committed artifact must be clean of both boilerplate patterns.
const incidentsJs = fs.readFileSync("data/incidents.js", "utf8");

const prefixResidual = incidentsJs.split(BOILERPLATE).length - 1;
assert.equal(
  prefixResidual,
  0,
  `Replicata: grep data/incidents.js for the Tesla redacted-update boilerplate prefix.
Expectata: zero occurrences (slurp strips it at ingestion; the committed artifact must match).
Resultata: found ${prefixResidual} occurrence(s).`,
);

// Distinctive substring from the addendum; appears nowhere else in the corpus.
const AIRBAG_FINGERPRINT = "while submitting this report and removing confidential or personally identifying information";
const airbagResidual = incidentsJs.split(AIRBAG_FINGERPRINT).length - 1;
assert.equal(
  airbagResidual,
  0,
  `Replicata: grep data/incidents.js for the Tesla airbag/tow-correction addendum fingerprint.
Expectata: zero occurrences (slurp strips it at ingestion; the committed artifact must match).
Resultata: found ${airbagResidual} occurrence(s).`,
);

// NHTSA-side mojibake: upstream double-encodes various characters. Each entry
// of NARRATIVE_MOJIBAKE is a known corrupt sequence that slurp normalizes.
// Assert every such sequence is absent from the committed artifact.
assert.ok(
  out.mojibake_keys.length >= 1,
  `Replicata: inspect data/slurp.py NARRATIVE_MOJIBAKE.
Expectata: at least one mojibake pattern is defined.
Resultata: got ${out.mojibake_keys.length} entries.`,
);

for (const badSeq of out.mojibake_keys) {
  const residual = incidentsJs.split(badSeq).length - 1;
  const hex = [...badSeq].map(c => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
  assert.equal(
    residual,
    0,
    `Replicata: grep data/incidents.js for the NHTSA mojibake sequence ${hex}.
Expectata: zero occurrences (slurp normalizes it at ingestion via NARRATIVE_MOJIBAKE).
Resultata: found ${residual} occurrence(s).`,
  );
}

assert.ok(
  out.source.includes('NARRATIVE_MOJIBAKE'),
  `Replicata: inspect data/slurp.py source.
Expectata: NARRATIVE_MOJIBAKE is defined and used to normalize narratives at ingestion.
Resultata: NARRATIVE_MOJIBAKE not referenced in slurp.py.`,
);

// Redaction-marker typo variants ({XXX}, ]XXX], [XXX[, [XX]) are normalized
// to the dominant [XXX] form at ingestion; none may survive in the artifact.
for (const badSeq of out.typo_keys) {
  const residual = incidentsJs.split(badSeq).length - 1;
  assert.equal(
    residual,
    0,
    `Replicata: grep data/incidents.js for the redaction-marker variant ${JSON.stringify(badSeq)}.
Expectata: zero occurrences (slurp normalizes it at ingestion via NARRATIVE_TYPOS).
Resultata: found ${residual} occurrence(s).`,
  );
}

// Tesla's filing template artifacts: a contentless "Summary:" label (and one
// filing wrapped in "[Summary: ...]" brackets) are stripped at ingestion, so
// no narrative in the artifact may open with either.
for (const badOpen of ['"narrative": "Summary:', '"narrative": "[Summary:']) {
  const residual = incidentsJs.split(badOpen).length - 1;
  assert.equal(
    residual,
    0,
    `Replicata: grep data/incidents.js for narratives opening with ${JSON.stringify(badOpen)}.
Expectata: zero occurrences (slurp strips the Summary label / bracket wrapper).
Resultata: found ${residual} occurrence(s).`,
  );
}

// Waymo's no-fact filing preamble (2026-10-03, audit finding #91): 62
// narratives opened "The content of this report is unchanged from the initial
// report submitted on <date> [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS
// INFORMATION]." so the one-line preview showed only that. slurp strips that
// exact preamble with an anchored pattern (NARRATIVE_UNCHANGED_PREAMBLE);
// preambles that carry facts ("Other than the updated Speed Limit field, ...")
// and later sentences are left as filed.
assert.deepEqual(out.preamble_probe, {
  dated: "On June [XXX], 2025 a Waymo AV",
  redacted_date: "On February",
  with_facts: "Other than the updated Speed Limit field, the content of this report is unchanged from the initial report submitted on December 5, 2022 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION].  On December",
  mid_text: "On June 5 a Waymo AV stopped. The content of this report is unchanged from the initial report submitted on June 5, 2025 [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION].",
}, `Replicata: apply slurp.py's NARRATIVE_UNCHANGED_PREAMBLE to four probe narratives.
Expectata: it removes the exact no-fact preamble (and the whitespace after it) only at the start of a narrative, with a dated or redacted date, and leaves fact-carrying preambles and mid-text sentences alone.
Resultata: ${JSON.stringify(out.preamble_probe)}.`);
assert.ok(out.preamble_pattern.startsWith("^") && out.source.includes("NARRATIVE_UNCHANGED_PREAMBLE.sub("),
  `Replicata: inspect data/slurp.py's NARRATIVE_UNCHANGED_PREAMBLE and its use.
Expectata: the pattern is anchored at the start (^) and applied during record building.
Resultata: pattern ${JSON.stringify(out.preamble_pattern.slice(0, 40))}, applied: ${out.source.includes("NARRATIVE_UNCHANGED_PREAMBLE.sub(")}.`);
{
  const vm = await import("node:vm");
  const ctx = vm.createContext({});
  vm.runInContext(incidentsJs, ctx);
  const narratives = JSON.parse(vm.runInContext("JSON.stringify(INCIDENT_DATA.map(r => [r.reportId, r.narrative]))", ctx));
  const opening = narratives.filter(([, n]) => /^The content of this report is unchanged from the initial report submitted on [^\n]*?\[REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION\]/.test(n)).map(([id]) => id);
  assert.deepEqual(opening, [],
    `Replicata: list data/incidents.js narratives that open with Waymo's "The content of this report is unchanged from the initial report submitted on <date> [REDACTED, ...]" preamble.
Expectata: none (slurp strips it at ingestion; the committed artifact must match).
Resultata: ${opening.length} narratives: ${JSON.stringify(opening.slice(0, 10))}${opening.length > 10 ? " ..." : ""}.`);
}

console.log("qual pass: Tesla redacted-update boilerplate and Waymo's no-fact filing preamble are stripped from narratives");

// --- No narrative in incidents.js starts or ends with whitespace -----------
// slurp's "Summary:" strip ran before the mojibake pass, so a narrative that
// began "Summary:Â The ..." kept a leading space (13781-14630, the
// one such record until 2026-09-26).
{
  const vm = await import("node:vm");
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync("data/incidents.js", "utf8"), ctx);
  const padded = JSON.parse(vm.runInContext(`JSON.stringify(INCIDENT_DATA.filter(r => r.narrative !== r.narrative.trim()).map(r => r.reportId))`, ctx));
  assert.deepEqual(padded, [],
    `Replicata: compare every incidents.js narrative with its trimmed form.
Expectata: identical (the cleanup passes run mojibake -> prefix strip -> typos, then strip).
Resultata: padded ${JSON.stringify(padded)}.`);
}

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

console.log("qual pass: Tesla redacted-update boilerplate is stripped from narratives");

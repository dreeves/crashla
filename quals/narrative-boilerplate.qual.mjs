import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BOILERPLATE = "Summary: This updated report does not report a new incident or make any material changes to the factual record. It only removes confidential or personally identifying information to make the incident narrative publicly available. ";

// Slurp must expose the constant and use removeprefix on the narrative field,
// so future fetches strip the Tesla disclaimer at ingestion time.
const py = `
import json, sys
sys.path.insert(0, "data")
import slurp, inspect
print(json.dumps({
  "constant": slurp.NARRATIVE_BOILERPLATE,
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

// The committed artifact must already be clean: zero residual boilerplate.
const incidentsJs = fs.readFileSync("data/incidents.js", "utf8");
const residual = incidentsJs.split(BOILERPLATE).length - 1;
assert.equal(
  residual,
  0,
  `Replicata: grep data/incidents.js for the Tesla redacted-update boilerplate prefix.
Expectata: zero occurrences (slurp strips it at ingestion; the committed artifact must match).
Resultata: found ${residual} occurrence(s).`,
);

console.log("qual pass: Tesla redacted-update boilerplate is stripped from narratives");

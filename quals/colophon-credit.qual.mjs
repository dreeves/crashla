import assert from "node:assert/strict";
import fs from "node:fs";

// The footer carries the design credit. Its exact wording is the human's, so
// this qual pins the characters, not a paraphrase of them.

const CREDIT = "design inspired by nicky case";

const js = fs.readFileSync("crashla.js", "utf8");

const assignment = js.match(/byId\("colophon"\)\.innerHTML\s*=([\s\S]*?);\n/);
assert.ok(
  assignment,
  `Replicata: grep crashla.js for byId("colophon").innerHTML.
Expectata: one assignment builds the footer's markup.
Resultata: no such assignment found.`,
);

// What the reader sees, not what the source spells: the credit is allowed to
// carry a link, so compare against the markup with its tags taken out.
const rendered = assignment[1].replace(/<[^>]*>/g, "");

assert.ok(
  rendered.includes(CREDIT),
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js and
strip its HTML tags.
Expectata: the footer reads ${JSON.stringify(CREDIT)}.
Resultata: it reads ${JSON.stringify(rendered.trim())}.`,
);

assert.ok(
  /https:\/\/ncase\.me/.test(assignment[1]),
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js.
Expectata: the credit links to https://ncase.me so the attribution is followable.
Resultata: no ncase.me link in the footer markup.`,
);

console.log("qual pass: footer carries the nicky case design credit");

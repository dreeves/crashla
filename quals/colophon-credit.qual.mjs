import assert from "node:assert/strict";
import fs from "node:fs";

// The footer carries the design credit. Its exact wording is the human's, so
// this qual pins the characters, not a paraphrase of them.

const CREDIT = "design inspired by nicky case";
const LINKED_CREDIT = CREDIT.replace(
  "nicky case",
  '<a href="https://ncase.me">nicky case</a>',
);

const js = fs.readFileSync("crashla.js", "utf8");

const assignments = [...js.matchAll(/byId\("colophon"\)\.innerHTML\s*=([\s\S]*?);\n/g)];
assert.equal(
  assignments.length,
  1,
  `Replicata: grep crashla.js for byId("colophon").innerHTML.
Expectata: one assignment builds the footer's markup.
Resultata: found ${assignments.length}.`,
);
const assignment = assignments[0];

assert.ok(
  assignment[1].includes(LINKED_CREDIT),
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js.
Expectata: the exact human-supplied credit surrounds one linked "nicky case".
Resultata: assignment was ${JSON.stringify(assignment[1].trim())}.`,
);

const links = [...assignment[1].matchAll(/<a\s+href="([^"]+)">([^<]+)<\/a>/g)]
  .map(([, href, text]) => ({href, text}))
  .filter(link => link.text === "nicky case");
assert.deepEqual(
  links,
  [{href: "https://ncase.me", text: "nicky case"}],
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js.
Expectata: exactly one "nicky case" anchor links to the exact ncase.me origin.
Resultata: matching anchors were ${JSON.stringify(links)}.`,
);

console.log("qual pass: footer carries the nicky case design credit");

import assert from "node:assert/strict";
import fs from "node:fs";

// The footer carries the design credit, one link to ncase.me, and shows the
// NHTSA report-receipt cutoff date. The words around them are the human's and
// are not pinned (2026-10-28, human-approved: a qual pinning the human's own
// wording went red on each of the human's edits and caught no agent's; the
// human reviews every diff). Until then this qual pinned "design inspired by
// nicky case" and "NHTSA report-receipt cutoff:" to the character.

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

// The cutoff date reaches the footer: in the assignment itself or in a
// constant it interpolates.
const interpolated = [...assignment[1].matchAll(/\$\{(\w+)\}/g)].map(m => m[1]);
const definitions = interpolated.map(name => (new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(js) || [, ""])[1]);
assert.ok(
  [assignment[1], ...definitions].some(text => text.includes("${NHTSA_DATA_THROUGH_DATE}")),
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js and the constants it interpolates (${interpolated.join(", ")}).
Expectata: one of them displays NHTSA_DATA_THROUGH_DATE, the report-receipt cutoff.
Resultata: none does.`,
);

const links = [...assignment[1].matchAll(/<a\s+href="([^"]+)">([^<]+)<\/a>/g)]
  .map(([, href, text]) => ({href, text}))
  .filter(link => link.href === "https://ncase.me");
assert.ok(
  links.length === 1 && links[0].text.trim() !== "",
  `Replicata: read the byId("colophon").innerHTML assignment in crashla.js.
Expectata: exactly one anchor links to the ncase.me origin, with text.
Resultata: ncase.me anchors were ${JSON.stringify(links)}.`,
);

console.log("qual pass: footer carries the nicky case design credit and the report-receipt cutoff");

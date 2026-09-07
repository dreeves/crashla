import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules } from "./css-parse.mjs";

// No web font. The page renders in the platform's own face, so nothing is
// fetched, preloaded or swapped; this pins the 2026-09-07 retirement of the
// handwriting face so it cannot creep back in one @font-face at a time.

const html = fs.readFileSync("index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "");
const css = stripComments(fs.readFileSync("style.css", "utf8"));

assert.ok(!/<link\b[^>]*rel="preload"/.test(html),
  `Replicata: grep index.html for rel="preload".
Expectata: none -- there is no font to preload.
Resultata: a preload link is present.`);
const faces = rules(css).filter(r => r.sel.toLowerCase() === "@font-face");
assert.deepEqual(faces, [],
  `Replicata: grep style.css for @font-face.
Expectata: none -- the page uses the platform face only.
Resultata: ${faces.length} @font-face block(s).`);
assert.ok(!/font-display|unicode-range|Patrick Hand/.test(css),
  "no font-loading descriptors and no reference to the retired face");
assert.ok(!fs.existsSync("fonts"),
  `Replicata: ls the repo root.
Expectata: no fonts/ directory -- the woff2 files and licence left with the face.
Resultata: fonts/ still exists.`);

console.log("qual pass: no web font is loaded; the page renders in the platform face");

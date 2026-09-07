import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, selectors } from "./css-parse.mjs";

// A stylesheet whose selectors no longer match anything on the page lies
// about the page: the 2026-08-21 legend-label rule sat unused while the real
// legend drifted onto another face. Every class and id style.css names must
// be produced by index.html or crashla.js.

const css = stripComments(fs.readFileSync("style.css", "utf8"));
const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("crashla.js", "utf8");
const haystack = html + "\n" + js;

const names = { class: new Set(), id: new Set() };
for (const rule of rules(css)) {
  if (rule.sel.startsWith("@")) continue;
  for (const sel of selectors(rule)) {
    for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) names.class.add(m[1]);
    for (const m of sel.matchAll(/#([A-Za-z_][\w-]*)/g)) names.id.add(m[1]);
  }
}
const missing = [];
for (const [kind, set] of Object.entries(names)) {
  for (const name of set) {
    const pattern = new RegExp(`(^|[^\\w-])${name}(?![\\w-])`);
    if (!pattern.test(haystack)) missing.push(`${kind === "id" ? "#" : "."}${name}`);
  }
}
assert.deepEqual(
  missing.sort(),
  [],
  `Replicata: for each class/id selector in style.css, grep index.html and
crashla.js for the name.
Expectata: every one is produced by the markup or the renderer.
Resultata: no consumer for ${missing.sort().join(", ")}.`,
);

console.log(`qual pass: all ${names.class.size} classes and ${names.id.size} ids in style.css have a consumer`);

import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, onlyDecl } from "./css-parse.mjs";

// Chart marks paint from the palette, not from literals the CSS qual cannot
// see: dot halos take --card through the .month-dot class, and the monthly
// axes emit no hidden gridline elements.

const js = fs.readFileSync("crashla.js", "utf8");
const css = stripComments(fs.readFileSync("style.css", "utf8"));
const parsed = rules(css);

for (const literal of ["stroke:#fff", "fill:#fff"]) {
  assert.ok(!js.includes(literal),
    `Replicata: grep crashla.js for ${literal}.
Expectata: none -- #fff equals --card only by coincidence; the halo comes from
the .month-dot class.
Resultata: an inline ${literal} remains.`);
}
const dot = parsed.find(r => r.sel === ".month-dot" && r.context.length === 0);
assert.ok(dot, "a .month-dot rule exists");
assert.equal(onlyDecl(dot.body, "stroke", ".month-dot"), "var(--card)");
assert.equal(onlyDecl(dot.body, "stroke-width", ".month-dot"), "1.5");

const gridSites = (js.match(/class="month-grid"/g) || []).length;
assert.equal(gridSites, 2,
  `Replicata: grep crashla.js for class="month-grid".
Expectata: exactly two sites -- the distribution and fleet-forecast charts draw
visible gridlines through the class; the monthly axes emit none (they used to
emit one hidden line per tick).
Resultata: ${gridSites} sites.`);
assert.ok(!js.includes("#e0e4ef"),
  "gridline colour comes from the palette (decision 3), not a pre-skin literal");
const grid = parsed.find(r => r.sel === ".month-grid" && r.context.length === 0);
assert.ok(grid, "a .month-grid rule exists");
assert.equal(onlyDecl(grid.body, "stroke", ".month-grid"), "var(--wash-deep)");
assert.equal(onlyDecl(grid.body, "stroke-width", ".month-grid"), "0.5");

for (const literal of ["fill:#555", "font-weight:bold"]) {
  assert.ok(!js.includes(literal),
    `the k = 0 '?' marker takes the tick style (decision 4), not an inline ${literal}`);
}
assert.ok(js.includes('<text class="month-tick" x="${(x + 7).toFixed(2)}"'),
  "the '?' marker is a .month-tick text");

console.log("qual pass: chart marks paint from the palette and emit no hidden gridlines");

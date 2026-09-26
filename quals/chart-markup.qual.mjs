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
assert.equal(gridSites, 1,
  `Replicata: grep crashla.js for class="month-grid".
Expectata: exactly one site -- drawLogXTicks, the shared log x axis that both
the distribution and fleet-forecast charts draw through (quals/axis-ticks.qual.mjs
pins that both call it, and that the ladder lives in one place); the monthly axes
emit none (they used to emit one hidden line per tick). This read two until
2026-09-15, when the two charts' duplicated axis blocks collapsed into the
helper -- the count is a duplication pin, so one is the tighter claim.
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
assert.equal((js.match(/<text class="month-tick"[^>]*>\?<\/text>/g) || []).length, 1,
  "the '?' marker is one .month-tick text template");
assert.ok(!js.includes('r="12" fill="none" data-tip') && js.includes('r="8" fill="none" data-tip'),
  "MPI-chart dot hit circles are r=8 (r=12 discs stacked over neighbouring helmers' dots and stole their tooltips)");
for (const sel of [".month-err", ".month-axis"]) {
  const rule = parsed.find(r => r.sel === sel && r.context.length === 0);
  assert.ok(rule, `a ${sel} rule exists`);
  assert.equal(onlyDecl(rule.body, "pointer-events", sel), "none",
    `${sel} is not a tooltip target, so it must not cover one (error bars and the x axis sat on top of markers)`);
}

console.log("qual pass: chart marks paint from the palette and emit no hidden gridlines");

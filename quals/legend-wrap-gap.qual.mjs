import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, decls } from "./css-parse.mjs";

// `.month-legend` is a wrapping row of chips. Its base rule sets one `gap`,
// which CSS applies to BOTH axes: between items along the row, and between
// rows when the legend wraps. Those two distances want different values — the
// horizontal one separates sibling chips, the vertical one separates rows of a
// single control — so a rule that widens the horizontal spacing with the `gap`
// shorthand silently widens the vertical spacing by the same amount.
//
// That shipped. `#month-legend-mpi-helmers { gap: 1.5rem }` was written on
// 2026-02-24 when the page ran in Patrick Hand, a narrow face, and all six
// helmer chips fitted one row. The 2026-09-07 face change to system-ui left
// the font SIZE alone but made the same six chips 17% wider (717px -> 837px,
// measured), so they no longer fitted: Zoox wrapped alone onto a second row,
// and the 1.5rem meant for the horizontal axis became 24px of dead vertical
// space above it — nearly a full chip height.
//
// So: a wrapping legend may tune the distance between its items, but never the
// distance between its rows. Only `column-gap` can say that. A container laid
// out in `flex-direction: column` is exempt: there `gap` IS the main-axis
// spacing between items, which is exactly what it means to tune.
const css = fs.readFileSync("style.css", "utf8");
const parsed = rules(stripComments(css));
const top = parsed.filter(r => r.context.length === 0);

const BASE = ".month-legend";
const base = top.filter(r => r.sel === BASE);
assert.equal(base.length, 1,
  `Replicata: count top-level rules for ${BASE} in style.css.
Expectata: exactly 1 — the shared legend layout the overrides refine.
Resultata: ${base.length}.`);

// Every rule that refines a legend container: a selector naming an element
// that carries .month-legend. Those live in index.html as #month-legend-*.
const legendIds = [...fs.readFileSync("index.html", "utf8")
  .matchAll(/id="(month-legend-[\w-]+)"/g)].map(m => m[1]);
assert.ok(legendIds.length >= 2,
  `Replicata: grep index.html for month-legend-* element ids.
Expectata: at least 2 legend containers to check.
Resultata: ${JSON.stringify(legendIds)}.`);

const offenders = [];
for (const id of legendIds) {
  for (const rule of top.filter(r => r.sel === `#${id}`)) {
    const column = decls(rule.body, "flex-direction").some(v => v.trim() === "column");
    if (column) continue; // main-axis gap; tuning it is the point
    for (const property of ["gap", "row-gap"]) {
      for (const value of decls(rule.body, property)) {
        offenders.push(`#${id} { ${property}: ${value.trim()} }`);
      }
    }
  }
}

assert.deepEqual(offenders, [],
  `Replicata: read every top-level rule in style.css targeting a #month-legend-* container that is NOT flex-direction: column, and list its "gap" or "row-gap" declarations.
Expectata: none — a wrapping legend tunes the space between ITEMS with "column-gap", leaving the row gap to the shared ${BASE} rule. "gap" sets both axes, so it inflates the space between wrapped rows too, which is never what the author meant.
Resultata: ${JSON.stringify(offenders)}.
=> Replace the shorthand with column-gap, or drop the override and inherit the shared spacing.`);

console.log(`qual pass: ${legendIds.length} legend containers; none widens its wrapped-row gap via the "gap" shorthand`);

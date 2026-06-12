import assert from "node:assert/strict";
import fs from "node:fs";

// The incident table once declared position:sticky on its headers while an
// overflow-x:auto wrapper silently defeated it (sticky only sticks within the
// nearest scroll container, and that wrapper never scrolled vertically). The
// fix is a wrapper that is a real scroll container: overflow plus max-height.
// This qual pins all three ingredients together.

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("style.css", "utf8");

assert.match(
  html,
  /<div class="table-scroll">\s*<table>/,
  `Replicata: open index.html and find the incident table's wrapper div.
Expectata: the table sits inside <div class="table-scroll">.
Resultata: no such wrapper around the incident table.`,
);

const scrollRule = css.match(/\.table-scroll\s*\{([^}]*)\}/);
assert.ok(
  scrollRule && /overflow:\s*auto/.test(scrollRule[1]) &&
    /max-height:/.test(scrollRule[1]),
  `Replicata: open style.css and find the .table-scroll rule.
Expectata: it declares overflow: auto and a max-height, making it a scroll
container the sticky header can stick to.
Resultata: rule was ${JSON.stringify(scrollRule && scrollRule[1])}.`,
);

const thRules = [...css.matchAll(/(?:^|\n)th\s*\{([^}]*)\}/g)].map(m => m[1]);
assert.ok(
  thRules.some(body => /position:\s*sticky/.test(body) && /top:\s*0/.test(body)),
  `Replicata: open style.css and find the bare th rule.
Expectata: table headers declare position: sticky with top: 0.
Resultata: th rules were ${JSON.stringify(thRules)}.`,
);

console.log("qual pass: incident table headers stick inside a real scroll container");

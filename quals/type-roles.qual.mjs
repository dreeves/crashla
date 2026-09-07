import assert from "node:assert/strict";
import fs from "node:fs";
import { stripComments, rules, decls, onlyDecl, selectors } from "./css-parse.mjs";

// The 2026-09-07 CSS pass collapsed the type system to one family, the
// platform's own UI face (--sans); the handwriting face was retired the same
// day. Sizes come from a six-step scale, emphasis is one weight declared
// once (headings included), and figures are tabular wherever they stack.
// Every one of those is a single rule, and single rules rot by accretion:
// this qual pins each of them.

const css = fs.readFileSync("style.css", "utf8");
const bare = stripComments(css);
const parsed = rules(bare);
const top = parsed.filter(r => r.context.length === 0);
const byExactSel = sel => parsed.filter(r => r.sel === sel && r.context.length === 0);
const has = (rule, property) => decls(rule.body, property).length > 0;
const notFontFace = r => r.sel.toLowerCase() !== "@font-face";

// --- 1. Six-step scale and two leadings, tokenized in :root -------------

const root = byExactSel(":root");
assert.equal(root.length, 1, `expected one top-level :root; found ${root.length}`);
const SCALE = {
  "--fs-xs": "0.75rem", "--fs-sm": "0.85rem", "--fs-base": "1.0625rem",
  "--fs-lg": "1.2rem", "--fs-xl": "1.6rem", "--fs-2xl": "2.4rem",
  "--lh-body": "1.6", "--lh-tight": "1.2", "--lh-dense": "1.45",
};
for (const [token, value] of Object.entries(SCALE)) {
  assert.equal(
    onlyDecl(root[0].body, token, ":root"),
    value,
    `Replicata: open style.css and read ${token} in :root.
Expectata: ${value} -- the scale is six sizes and two leadings, nothing between.
Resultata: ${token} is missing or holds another value.`,
  );
}
const narrowRoot = parsed.filter(r => r.sel === ":root" && r.context.length === 1 &&
  /^@media\s*\(\s*max-width\s*:\s*760px\s*\)$/i.test(r.context[0]));
assert.equal(narrowRoot.length, 1, "the narrow heading sizes live in one :root override inside @media (max-width: 760px)");
assert.equal(onlyDecl(narrowRoot[0].body, "--fs-2xl", "narrow :root"), "1.9rem");
assert.equal(onlyDecl(narrowRoot[0].body, "--fs-xl", "narrow :root"), "1.45rem");
const narrowHeadings = parsed.filter(r => r.context.length > 0 && /^h[12]$/.test(r.sel));
assert.deepEqual(
  narrowHeadings,
  [],
  `Replicata: read the @media (max-width: 760px) block in style.css.
Expectata: no h1/h2 rule there -- the narrow sizes are token overrides, so the
h1 and h2 rules exist once each.
Resultata: ${JSON.stringify(narrowHeadings.map(r => r.sel))}.`,
);

// --- 2. Every font-size is a scale token; chart text stays in SVG px ----

const PX_ONLY = new Set([".month-tick", ".month-label"]);
// The control reset (section 4) inherits; everything else names a step.
for (const rule of parsed.filter(notFontFace)) {
  if (rule.sel === ":root" || rule.sel === "button, select") continue;
  for (const value of decls(rule.body, "font-size")) {
    if (PX_ONLY.has(rule.sel)) {
      assert.match(value, /^\d+px$/, `${rule.sel} chart text is sized in SVG user units (px); found ${value}`);
      continue;
    }
    assert.match(
      value,
      /^var\(--fs-(xs|sm|base|lg|xl|2xl)\)$/,
      `Replicata: grep style.css for font-size.
Expectata: every value outside :root is a --fs-* token, except the .month-tick
and .month-label SVG rules, which are in viewBox px.
Resultata: ${JSON.stringify(rule.sel)} declares font-size: ${value}.`,
    );
  }
}

// --- 3. One family, declared in one place ---------------------------------

const familyRules = parsed.filter(notFontFace).filter(r => has(r, "font-family"));
const familyMap = Object.fromEntries(familyRules.map(r => [r.sel, decls(r.body, "font-family")]));
assert.deepEqual(
  familyMap,
  {
    "button, select": ["inherit"],
    "body": ["var(--sans)"],
  },
  `Replicata: list every rule in style.css that declares font-family.
Expectata: exactly two -- the control reset (inherit) and body (--sans).
Nothing else names a face; there is no second family.
Resultata: ${JSON.stringify(familyMap)}.`,
);
assert.ok(!/--hand\b|Patrick Hand|@font-face/.test(bare),
  "the handwriting face was retired 2026-09-07: no --hand token, no @font-face");
assert.ok(!/--mono\b|monospace/i.test(bare),
  `Replicata: grep style.css for --mono or monospace.
Expectata: none -- odds and volumes align with text-align + tabular figures.
Resultata: a monospace family is still declared.`);
const sans = onlyDecl(root[0].body, "--sans", ":root");
assert.match(sans, /^system-ui\s*,/, "--sans leads with the system-ui generic");
assert.doesNotMatch(sans, /-apple-system/, "-apple-system after system-ui is unreachable; drop it");

// --- 4. Controls inherit typography from their container -----------------

const reset = byExactSel("button, select");
assert.equal(reset.length, 1, "one `button, select` reset rule");
for (const property of ["font-family", "font-size", "color"]) {
  assert.equal(onlyDecl(reset[0].body, property, "button, select"), "inherit");
}
assert.ok(parsed.every(r => decls(r.body, "font").length === 0),
  "no `font:` shorthand anywhere -- it would drag body's line-height into controls");
for (const sel of [".filters button", "#month-metric-select"]) {
  for (const rule of byExactSel(sel)) {
    for (const property of ["font-family", "font-size", "color"]) {
      assert.ok(!has(rule, property),
        `${sel} must not declare ${property}; the pill takes it from its container`);
    }
  }
}

// --- 5. Emphasis: one real weight, declared once; no fake bold ------------

const shadowRules = parsed.filter(r => has(r, "text-shadow"));
assert.deepEqual(shadowRules.map(r => r.sel), [],
  `Replicata: grep style.css for text-shadow.
Expectata: none -- the fake-bold shadow existed for a single-weight face that
is gone; the platform face has a real 600.
Resultata: ${JSON.stringify(shadowRules.map(r => r.sel))}.`);
const weights = parsed.filter(notFontFace).flatMap(r => decls(r.body, "font-weight").map(v => [r.sel, v]));
assert.ok(weights.every(([, v]) => v === "400" || v === "600"),
  `Replicata: grep style.css for font-weight.
Expectata: only 400 and 600 -- the reading face has one emphasis weight.
Resultata: ${JSON.stringify(weights)}.`);
const emphasis = weights.filter(([, v]) => v === "600");
assert.equal(emphasis.length, 1, `600 is declared once; found ${JSON.stringify(emphasis)}`);
assert.deepEqual(selectors({ sel: emphasis[0][0] }),
  ["h1", "h2", "h3", ".mpi-card-helmer", "b", "strong", "th", ".mpi-card-mpi", ".mpi-card-mult", ".stress-badge", ".pm-card-odds"]);

// --- 6. Tabular figures wherever figures stack ---------------------------

const tabular = parsed.filter(r => has(r, "font-variant-numeric"));
assert.equal(tabular.length, 1, `font-variant-numeric is declared once; found ${tabular.map(r => r.sel)}`);
for (const sel of ["table", ".mpi-card", ".predmarket-grid", ".chart-tip", ".month-svg", "#date-range-controls"]) {
  assert.ok(selectors(tabular[0]).includes(sel), `the tabular-figures rule covers ${sel}`);
}

// --- 7. Two leadings, roles as single rules -------------------------------

const leading = parsed.filter(r => has(r, "line-height")).map(r => [r.sel, decls(r.body, "line-height")]);
assert.deepEqual(leading, [
  ["body", ["var(--lh-body)"]],
  ["h1, h2, h3, .mpi-card-helmer", ["var(--lh-tight)"]],
  [".mpi-card, .predmarket-grid, .chart-tip", ["var(--lh-dense)"]],
], `Replicata: grep style.css for line-height.
Expectata: body at --lh-body, the display group at --lh-tight, and the dense
data blocks (cards, market rows, tooltip) at --lh-dense; nothing else.
Resultata: ${JSON.stringify(leading)}.`);
const display = byExactSel("h1, h2, h3, .mpi-card-helmer");
assert.equal(display.length, 1, "one display-tier rule (leading + balanced wraps)");
assert.equal(onlyDecl(display[0].body, "text-wrap", "display group"), "balance");
assert.ok(!has(display[0], "font-weight") && !has(display[0], "font-family"), "the display group carries geometry only");
const pretty = parsed.filter(r => decls(r.body, "text-wrap").includes("pretty"));
assert.deepEqual(pretty.map(r => r.sel), ["p, li, .colophon"], "running text gets text-wrap: pretty in one rule");

const captions = byExactSel(".abstract-links, .incident-count, .month-note, .predmarket-loading, .colophon");
assert.equal(captions.length, 1, "one caption rule for the notes, counts and credits");
assert.equal(onlyDecl(captions[0].body, "font-size", "captions"), "var(--fs-sm)");
assert.equal(onlyDecl(captions[0].body, "color", "captions"), "var(--ink-soft)");
for (const sel of [".colophon", ".incident-count", ".month-note", ".abstract-links"]) {
  for (const rule of byExactSel(sel)) {
    assert.ok(!has(rule, "font-size") && !has(rule, "color"), `${sel} keeps only its own geometry`);
  }
}
assert.equal(byExactSel(".predmarket-loading").length, 0, ".predmarket-loading has no rule of its own");

// Legends inherit the body size (2026-09-07 decision 10): no legend rule names one.
for (const sel of [".month-legend", ".metric-select", ".month-helmer-toggle"]) {
  for (const rule of byExactSel(sel)) assert.ok(!has(rule, "font-size"), `${sel} inherits its size`);
}

const th = top.filter(r => r.sel === "th");
assert.equal(th.length, 1, "one bare th rule");
assert.deepEqual(
  [...th[0].body.matchAll(/([a-z-]+)\s*:/g)].map(m => m[1]).sort(),
  ["background", "position", "top"],
  "the bare th rule is the sticky-header rule and nothing typographic",
);

// --- 8. Chrome: tokens, focus, motion, selection, text sizing -------------

assert.equal(onlyDecl(root[0].body, "--line", ":root"), "var(--ink)", "--line IS ink, by construction");
const tip = byExactSel(".chart-tip");
assert.equal(tip.length, 1);
assert.ok(!has(tip[0], "font-family"), ".chart-tip is appended to body and inherits --sans");
assert.match(onlyDecl(byExactSel("body")[0].body, "max-width", "body"), /rem$/, "body width follows the root size");
const html = byExactSel("html");
assert.equal(html.length, 1);
assert.equal(onlyDecl(html[0].body, "text-size-adjust", "html"), "100%");
assert.equal(onlyDecl(html[0].body, "-webkit-text-size-adjust", "html"), "100%");

const focus = parsed.filter(r => decls(r.body, "outline-offset").includes("2px"));
assert.equal(focus.length, 1, "one focus ring for the custom controls outside scroll containers");
for (const sel of [".filters button:focus-visible", "#month-metric-select:focus-visible", ".pm-refresh:focus-visible"]) {
  assert.ok(selectors(focus[0]).includes(sel), `the focus ring covers ${sel}`);
}

const reduced = parsed.filter(r => r.context.some(c => /prefers-reduced-motion\s*:\s*reduce/i.test(c)));
assert.ok(reduced.some(r => decls(r.body, "transition-duration").includes("0s")),
  "under prefers-reduced-motion every transition is instantaneous");
const lift = reduced.find(r => selectors(r).includes(".filters button:not(.active):hover"));
assert.ok(lift && decls(lift.body, "transform").includes("none"),
  "the hover lift is suppressed with a selector that out-specifies the lift rule (`:not(.active)` included)");

const selectRules = parsed.filter(r => has(r, "user-select"));
assert.equal(selectRules.length, 1, "user-select: none is declared once");
assert.equal(onlyDecl(selectRules[0].body, "-webkit-user-select", "user-select rule"), "none",
  "Safari honours only the prefixed form");

// --- 9. Ink, links and measure (the 2026-09-07 A/B decisions) -------------

const faintText = parsed.filter(r => decls(r.body, "color").some(v => /--ink-faint/.test(v)));
assert.deepEqual(faintText.map(r => r.sel), [],
  `Replicata: grep style.css for color: var(--ink-faint).
Expectata: none -- #8f887f sits under AA on every ground, so it paints chrome
(the section chevron) and never text (decision 1).
Resultata: ${JSON.stringify(faintText.map(r => r.sel))}.`);
const noneDeco = parsed.filter(r => decls(r.body, "text-decoration").some(v => /^none/.test(v)));
assert.deepEqual(noneDeco.map(r => r.sel), [],
  "every link keeps its underline (decision 5); lists of links differ only in colour");
const linkLists = byExactSel(".pm-card-question a, .mpi-card-vmt a, .mpi-card-sources a");
assert.equal(linkLists.length, 1, "one rule for links inside lists of links (market questions, card citations)");
assert.equal(onlyDecl(linkLists[0].body, "color", "link lists"), "var(--ink-soft)");
assert.equal(onlyDecl(linkLists[0].body, "text-decoration-color", "link lists"), "var(--line-soft)");
const measure = parsed.filter(r => decls(r.body, "max-width").includes("70ch"));
assert.deepEqual(measure.map(r => r.sel), [".abstract, #sanity-checks p, .month-note"],
  "prose blocks share one 70ch measure (decision 9); tables and charts keep the full width");

console.log("qual pass: one type family, one scale, one emphasis weight, one rule per role");

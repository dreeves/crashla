import assert from "node:assert/strict";
import fs from "node:fs";

// The stylesheet emulates Nicky Case's faux-hand-sketched look (ncase.me):
// a self-hosted handwriting face, wobbly asymmetric border-radii, and masked
// vector rules. Each can silently rot -- a missing font source, a prefixed-only
// mask, or a filter on a layout ancestor -- so this qual pins those hazards.

const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("crashla.js", "utf8");

// Comment-free CSS, so /* ... */ text can never satisfy a match below.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
const bareHtml = html.replace(/<!--[\s\S]*?-->/g, "");

// Split the stylesheet into (selector, body) pairs. Descend through conditional
// at-rules so a mobile-only body rule is still reported as `body`.
function rules(text, context = []) {
  const out = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) break;
    const sel = text.slice(cursor, open).trim();
    let close = open + 1;
    let depth = 1;
    let quote = null;
    for (; close < text.length && depth > 0; close++) {
      const ch = text[close];
      if (quote !== null) {
        if (ch === "\\") close++;
        else if (ch === quote) quote = null;
      } else if (ch === "\"" || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
    }
    assert.equal(depth, 0, `unbalanced CSS block beginning ${JSON.stringify(sel)}`);
    const body = text.slice(open + 1, close - 1);
    if (/^@(media|supports|container|layer|scope|document)\b/i.test(sel)) {
      out.push(...rules(body, [...context, sel]));
    } else {
      out.push({ sel, body, context });
    }
    cursor = close;
  }
  return out;
}
assert.doesNotMatch(
  bare,
  /@(charset|import|namespace|layer)\b[^{};]*;/i,
  "statement at-rules are unsupported by this qual parser",
);
const parsed = rules(bare);

function decls(body, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...body.matchAll(
    new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "gi"),
  )].map(match => match[1].trim());
}

function onlyDecl(body, property, owner) {
  const values = decls(body, property);
  assert.equal(
    values.length,
    1,
    `${owner} must declare ${property} exactly once; found ${JSON.stringify(values)}`,
  );
  return values[0];
}

assert.deepEqual(
  decls("filter:none; FILTER:URL(#rough)", "filter"),
  ["none", "URL(#rough)"],
  "declaration scanning must be case-insensitive and retain duplicates",
);

// --- 1. The handwriting face is self-hosted -----------------------------

const faces = parsed.filter(r => r.sel.toLowerCase() === "@font-face").map(r => r.body);
assert.ok(
  faces.length > 0,
  `Replicata: open style.css and look for @font-face.
Expectata: at least one @font-face declares the handwriting face.
Resultata: no @font-face rule in the stylesheet.`,
);
const families = faces.map((face, i) => onlyDecl(face, "font-family", `@font-face ${i + 1}`));
assert.ok(
  families.includes('"Patrick Hand"'),
  `Replicata: read every @font-face block in style.css.
Expectata: one of them declares font-family: "Patrick Hand".
Resultata: families were ${JSON.stringify(families)}.`,
);
for (const [i, face] of faces.entries()) {
  const source = onlyDecl(face, "src", `@font-face ${i + 1}`);
  const urls = [...source.matchAll(/url\s*\(([^)]+)\)/gi)];
  assert.ok(
    urls.length > 0,
    `Replicata: read the src declaration in each @font-face block.
Expectata: at least one url(...) points to the checked-in font.
Resultata: src was ${JSON.stringify(source.trim())}.`,
  );
  for (const [, raw] of urls) {
    const url = raw.trim().replace(/^["']|["']$/g, "");
    assert.ok(
      !/^(https?:)?\/\//.test(url),
      `Replicata: read the src: url(...) values in style.css's @font-face blocks.
Expectata: every font is served from this repo -- the page has no third-party
requests and must keep it that way.
Resultata: ${url} points off-site.`,
    );
    assert.ok(
      fs.existsSync(url) && fs.statSync(url).isFile(),
      `Replicata: resolve each @font-face src: url(...) against the repo root.
Expectata: the font is a checked-in regular file.
Resultata: ${url} is missing or is not a regular file.`,
    );
    assert.equal(
      fs.readFileSync(url).subarray(0, 4).toString("ascii"),
      "wOF2",
      `Replicata: inspect the first four bytes of ${url}.
Expectata: the wOF2 signature of a WOFF2 font.
Resultata: the source is not WOFF2 data.`,
    );
  }
}

// --- 2. Two type roles, both tokenized ----------------------------------

const rootRules = parsed.filter(r => r.sel === ":root" && r.context.length === 0);
assert.equal(rootRules.length, 1, `expected one top-level :root rule; found ${rootRules.length}`);
const root = rootRules[0].body;
assert.match(
  onlyDecl(root, "--hand", ":root"),
  /^["']Patrick Hand["']\s*,/,
  "--hand must use the self-hosted Patrick Hand face first",
);
for (const token of ["--hand", "--sans"]) {
  assert.ok(
    new RegExp(`\\${token}\\s*:`).test(root),
    `Replicata: open style.css and read the :root block.
Expectata: ${token} is defined there -- the handwriting and the reading face are
each named once so the whole app agrees which is which.
Resultata: no ${token} in :root.`,
  );
  assert.ok(
    new RegExp(`var\\(\\${token}\\)`).test(bare),
    `Replicata: grep style.css for var(${token}).
Expectata: the token is actually used.
Resultata: ${token} is defined but never referenced.`,
  );
}

// --- 3. Wobbly corners are tokenized and used ---------------------------

const wobbles = [...root.matchAll(/(--wobble[\w-]*)\s*:/g)].map(m => m[1]);
assert.ok(
  wobbles.length >= 2,
  `Replicata: open style.css and read the :root block.
Expectata: at least two --wobble* radii, so repeated boxes are not all warped
into the identical shape (which reads as a graphic, not as a hand).
Resultata: found ${JSON.stringify(wobbles)}.`,
);
for (const w of wobbles) {
  assert.ok(
    new RegExp(`border-radius:\\s*var\\(\\${w}\\)`).test(bare),
    `Replicata: grep style.css for border-radius: var(${w}).
Expectata: every wobble token is applied to some box.
Resultata: ${w} is defined but no border-radius uses it.`,
  );
}

// --- 4. No stroke is roughened by displacement --------------------------

// feDisplacementMap resamples the source with nearest-neighbour sampling and
// offsets by whole device pixels, so a 2.5px stroke moves in whole-pixel steps
// with no partial coverage between them: every step is a hard, un-antialiased
// jog. On a hairline that reads as a chewed, blocky line, not as a drawn one.
// Reproduced identically in Chromium, Firefox and WebKit at 2x, so it is the
// primitive, not a browser. The hand-drawn line is a real vector path now
// (see 4b) and the boxes get their wobble from border-radius, which the
// rasteriser antialiases properly.
assert.ok(
  !/feDisplacementMap/i.test(bareHtml),
  `Replicata: grep index.html for feDisplacementMap.
Expectata: none. Displacing a stroke quantises it to whole device pixels and
the line comes out visibly blocky at 2x.
Resultata: index.html still defines a displacement filter.`,
);
const urlFilters = parsed.flatMap(rule =>
  decls(rule.body, "filter")
    .filter(value => /\burl\s*\(/i.test(value))
    .map(value => ({sel: rule.sel, value})),
);
assert.deepEqual(
  urlFilters,
  [],
  `Replicata: grep style.css for filter: url(.
Expectata: none, for the same reason -- and a referenced-but-missing filter id
silently renders nothing, with no console error to catch it.
Resultata: ${JSON.stringify(urlFilters.slice(0, 4))}.`,
);

// --- 4b. The drawn rule is a masked vector path -------------------------

const drawn = onlyDecl(root, "--drawn-rule", ":root");
// `<` may be literal or percent-encoded inside the data URI; both are the
// same shape, and the encoded form is the one that survives every parser.
const dataUri = (drawn.match(/^url\((["'])(data:image\/svg\+xml,.*)\1\)$/i) || [])[2];
const svgSource = dataUri && decodeURIComponent(dataUri.slice("data:image/svg+xml,".length));
assert.ok(
  svgSource && /<svg/.test(svgSource) && /<path/.test(svgSource),
  `Replicata: open style.css and read --drawn-rule in :root.
Expectata: an inline SVG data URI holding the hand-drawn wave that stands in
for the machined 1px border under each heading.
Resultata: ${JSON.stringify(drawn && drawn.trim().slice(0, 80))}.`,
);
const pathMatch = svgSource.match(/<path\s[^>]*\bd=(["'])(.*?)\1/);
const pathData = pathMatch?.[2] || "";
const pathSegments = [...pathData.matchAll(/([A-Za-z])([^A-Za-z]*)/g)];
assert.deepEqual(
  pathSegments.map(segment => segment[1]),
  ["M", "C", "C", "C"],
  `Replicata: decode --drawn-rule and read its path coordinates.
Expectata: one absolute move followed by three absolute cubic segments.
Resultata: path was ${JSON.stringify(pathData)}.`,
);
const segmentPoints = pathSegments.map(segment =>
  (segment[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number),
);
assert.deepEqual(
  segmentPoints.map(points => points.length),
  [2, 6, 6, 6],
  `Replicata: decode --drawn-rule and count each path command's coordinates.
Expectata: M has two; each C has six.
Resultata: counts were ${JSON.stringify(segmentPoints.map(points => points.length))}.`,
);
const points = segmentPoints.flat();
const startSlope = (points[3] - points[1]) / (points[2] - points[0]);
const endSlope = (points[19] - points[17]) / (points[18] - points[16]);
assert.ok(
  points[0] === 0 && points[18] === 198 && points[1] === points[19] &&
    Math.abs(startSlope - endSlope) < 0.002,
  `Replicata: tile --drawn-rule horizontally and inspect each 198px join.
Expectata: x endpoints 0 and 198, with matching heights and tangents.
Resultata: start slope ${startSlope.toFixed(4)}, end slope ${endSlope.toFixed(4)}, ` +
  `endpoints (${points[0]}, ${points[1]}) and (${points[18]}, ${points[19]}).`,
);
const MASK_DECLARATIONS = [
  ["mask-image", "var(--drawn-rule)"],
  ["-webkit-mask-image", "var(--drawn-rule)"],
  ["mask-repeat", "repeat-x"],
  ["-webkit-mask-repeat", "repeat-x"],
  ["mask-size", "198px 8px"],
  ["-webkit-mask-size", "198px 8px"],
];
for (const sel of ["h2::after", ".colophon::before"]) {
  const matching = parsed.filter(rule => rule.sel.split(",")
    .some(selector => selector.trim().endsWith(sel)) &&
    MASK_DECLARATIONS.some(([property]) => decls(rule.body, property).length > 0));
  assert.equal(
    matching.length,
    1,
    `${sel} mask declarations must live in one rule; found ${JSON.stringify(matching)}`,
  );
  assert.equal(matching[0].sel, sel, `${sel} must not be overridden by a stronger selector`);
  const rule = matching[0];
  for (const [property, value] of MASK_DECLARATIONS) {
    assert.equal(
      onlyDecl(rule.body, property, sel),
      value,
      `${sel} must declare ${property}: ${value}`,
    );
  }
  assert.match(
    onlyDecl(rule.body, "background", sel),
    /^var\(--/,
    `${sel} must paint the mask with a tokenized background`,
  );
}

// --- 5. No filter on a layout ancestor ----------------------------------

// A `filter` makes an element a containing block for its fixed-position
// descendants and a scroll-clipping boundary for sticky ones. Put one on the
// page shell and .chart-tip (position:fixed) lands in the wrong place while
// the incident table's sticky <th> quietly stops sticking.
const FRAGILE = ["body", "section", ".collapsible", ".sec-body", ".table-scroll",
                 ".month-panel", ".month-chart", ".predmarket-panel"];
for (const { sel, body } of parsed) {
  const filters = decls(body, "filter");
  assert.ok(
    filters.length <= 1,
    `${sel} must declare filter at most once; found ${JSON.stringify(filters)}`,
  );
  if (filters.length === 0 || /^none(?:\s*!important)?$/i.test(filters[0])) continue;
  const compounds = sel.split(",").map(s => s.trim())
    .map(s => s.split(/\s+|\s*[>+~]\s*/).filter(Boolean).at(-1));
  for (const frag of FRAGILE) {
    const name = frag.slice(1);
    const token = frag.startsWith(".")
      ? new RegExp(`\\${frag}(?=[.#:\\[),]|$)`)
      : new RegExp(`(?:^|[(:])${frag}(?=[.#:\\[),]|$)`);
    const attribute = frag.startsWith(".")
      ? new RegExp(`\\[class(?:[~|^$*]?=)["'][^"']*\\b${name}\\b[^"']*["']\\]`)
      : /$a/;
    const hit = compounds.some(compound => token.test(compound) || attribute.test(compound));
    assert.ok(
      !hit,
      `Replicata: open style.css and find the rule for ${JSON.stringify(sel)}.
Expectata: no filter on an element matching ${frag} -- it would become a
containing block and break .chart-tip's position:fixed or the sticky <th>.
Resultata: that rule declares ${JSON.stringify(body.trim())}.`,
    );
  }
}

// --- 6. The tooltip stays out of the flow -------------------------------

const tipRules = parsed.filter(rule => rule.sel.split(",")
  .some(selector => selector.trim().endsWith(".chart-tip")) &&
  decls(rule.body, "position").length > 0);
assert.equal(
  tipRules.length,
  1,
  `.chart-tip position must live in one rule; found ${JSON.stringify(tipRules)}`,
);
assert.equal(
  tipRules[0].sel,
  ".chart-tip",
  ".chart-tip position must not be overridden by a stronger selector",
);
const tip = tipRules[0];
assert.ok(
  tip && onlyDecl(tip.body, "position", ".chart-tip") === "fixed",
  `Replicata: open style.css and find the .chart-tip rule.
Expectata: position: fixed -- the tooltip is positioned from viewport
coordinates by initTooltips().
Resultata: rule was ${JSON.stringify(tip && tip.body.trim())}.`,
);

// --- 6b. Error bars keep their established visual hierarchy --------------

const errorBarRules = parsed.filter(rule => rule.sel.split(",")
  .some(selector => selector.trim().endsWith(".month-err")) &&
  decls(rule.body, "stroke-width").length > 0);
assert.equal(
  errorBarRules.length,
  1,
  `.month-err stroke width must live in one rule; found ${JSON.stringify(errorBarRules)}`,
);
assert.equal(
  errorBarRules[0].sel,
  ".month-err",
  ".month-err stroke width must not be overridden by a stronger selector",
);
const errorBars = errorBarRules[0];
assert.equal(
  errorBars && onlyDecl(errorBars.body, "stroke-width", ".month-err"),
  "1",
  `Replicata: open style.css and find the .month-err rule.
Expectata: stroke-width: 1 -- the 2026-06-12 error-bar de-emphasis decision
keeps uncertainty visible without competing with the data series.
Resultata: rule was ${JSON.stringify(errorBars && errorBars.body.trim())}.`,
);

const chartLabelRules = parsed.filter(rule => rule.sel.split(",")
  .some(selector => selector.trim().endsWith(".month-label")) &&
  decls(rule.body, "font-size").length > 0);
assert.equal(
  chartLabelRules.length,
  2,
  `expected one base and one narrow .month-label rule; found ${chartLabelRules.length}`,
);
const baseChartLabel = chartLabelRules.find(rule => rule.context.length === 0);
const narrowChartLabel = chartLabelRules.find(rule =>
  rule.context.length === 1 &&
  /^@media\s*\(\s*max-width\s*:\s*760px\s*\)$/i.test(rule.context[0]),
);
assert.ok(
  chartLabelRules.every(rule => rule.sel === ".month-label"),
  ".month-label font size must not be overridden by a stronger selector",
);
const chartLabelSizes = [
  baseChartLabel && onlyDecl(baseChartLabel.body, "font-size", "base .month-label"),
  narrowChartLabel && onlyDecl(narrowChartLabel.body, "font-size", "narrow .month-label"),
];
assert.deepEqual(
  chartLabelSizes,
  ["11px", "12px"],
  `Replicata: render any vertical .month-label from 320px through 1000px wide.
Expectata: the established 11px base and 12px narrow size fit the fixed x=18
SVG margin without clipping the left edge.
Resultata: declared sizes were ${JSON.stringify(chartLabelSizes)}.`,
);
const verticalLabelAnchors = [...js.matchAll(
  /<text class="month-label" x="(\d+)"[^>]*transform="rotate\(-90 \1 /g,
)].map(match => Number(match[1]));
assert.deepEqual(
  verticalLabelAnchors,
  [18, 18, 18],
  `Replicata: render every vertical .month-label at devicePixelRatio 2.
Expectata: each of the three templates anchors at x=18, leaving six pixels for
Patrick Hand's left overhang inside the SVG viewport.
Resultata: anchors were ${JSON.stringify(verticalLabelAnchors)}.`,
);

for (const sel of [
  '.date-range-input:focus-visible::-webkit-slider-thumb',
  '.date-range-input:focus-visible::-moz-range-thumb',
]) {
  const matching = parsed.filter(rule => rule.sel.split(",")
    .some(selector => selector.trim().endsWith(sel)) &&
    decls(rule.body, "box-shadow").length > 0);
  assert.equal(
    matching.length,
    1,
    `${sel} focus ring must live in one rule; found ${JSON.stringify(matching)}`,
  );
  assert.equal(matching[0].sel, sel, `${sel} must not be overridden by a stronger selector`);
  const rule = matching[0];
  assert.equal(
    onlyDecl(rule.body, "box-shadow", sel),
    "0 0 0 3px var(--accent)",
    `Replicata: focus either date-range thumb with the keyboard.
Expectata: a 3px accent ring provides a visible focus indicator outside the thumb.
Resultata: ${JSON.stringify(sel)} declares ${JSON.stringify(rule?.body.trim())}.`,
  );
}

// --- 7. Palette literals live in :root and nowhere else -----------------

// The 2026-07-01 de-vibe-coding pass consolidated every scattered gray/blue
// onto :root tokens. Re-skinning is exactly when that discipline slips.
const strays = [];
for (const { sel, body } of parsed) {
  if (sel === ":root") continue;
  const withoutUrls = body.replace(/url\((?:"[^"]*"|'[^']*'|[^)])*\)/g, "");
  const withoutStrings = withoutUrls.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    "",
  );
  const literals = [
    ...withoutStrings.matchAll(/(#[0-9a-fA-F]{3,8})\b/g),
    ...withoutStrings.matchAll(/\b((?:rgb|hsl)a?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi),
  ];
  for (const literal of literals) strays.push(`${sel} { ... ${literal[0]} }`);
}
assert.deepEqual(
  strays,
  [],
  `Replicata: inspect style.css for hexadecimal or functional color literals
outside the :root block.
Expectata: none -- palette literals come from design tokens, so colors have one
place to change. URL fragments such as url(#fade) do not count as colors.
Resultata: ${strays.join("; ")}.`,
);

// --- 8. Meaning-bearing ink clears WCAG AA on every ground --------------

// ncase.me's link red is #ff4040, which measures 3.4:1 on white. Re-skinning
// is exactly when a palette drifts under the line, so the tokens that carry
// meaning are measured here rather than eyeballed. --ink-faint is deliberately
// absent: it is the de-emphasised meta text (VMT parentheticals, source
// footnotes) and has always sat under AA by design.
const CARRIES_MEANING = ["--accent", "--accent-ink", "--safer", "--worse", "--iffy",
                         "--ai-ink", "--ink", "--ink-soft"];
const GROUNDS = ["--paper", "--card", "--wash"];

const hexOf = name => {
  const value = onlyDecl(root, name, ":root");
  const m = value.match(/^(#[0-9a-fA-F]{6})$/);
  assert.ok(m, `Replicata: read ${name} in :root.
Expectata: a 6-digit hex so its contrast can be measured.
Resultata: no such token, or not a plain hex.`);
  return m[1];
};
const channel = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const luminance = hex => {
  const [r, g, b] = hex.match(/\w\w/g).map(h => parseInt(h, 16)).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const ink of CARRIES_MEANING) {
  for (const ground of GROUNDS) {
    const ratio = contrast(hexOf(ink), hexOf(ground));
    assert.ok(
      ratio >= 4.5,
      `Replicata: read ${ink} and ${ground} in style.css's :root and compute
their WCAG contrast ratio.
Expectata: at least 4.5:1 -- ${ink} carries meaning in body-sized text, so it
has to clear AA on every surface the app paints it on.
Resultata: ${hexOf(ink)} on ${hexOf(ground)} is ${ratio.toFixed(2)}:1.`,
    );
  }
}

console.log("qual pass: sketch styling is self-hosted, tokenized, artifact-free, and clears AA");

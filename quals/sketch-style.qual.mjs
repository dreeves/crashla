import assert from "node:assert/strict";
import fs from "node:fs";

// The stylesheet emulates Nicky Case's faux-hand-sketched look (ncase.me):
// a self-hosted handwriting face, wobbly asymmetric border-radii, and an SVG
// turbulence filter that roughens strokes. Each of those has a way to silently
// rot -- a CDN font URL, a dangling filter id, a filter on a layout ancestor --
// so this qual pins the parts that a browser will not complain about.

const css = fs.readFileSync("style.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// Comment-free CSS, so /* ... */ text can never satisfy a match below.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

// Split the stylesheet into (selector, body) pairs, descending into @media.
// A regex cannot do this: @media nests, and every rule inside one would be
// invisible to a flat /([^{}]+)\{([^{}]*)\}/ scan.
function rules(text) {
  const out = [];
  let depth = 0, start = 0, selStart = 0;
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      stack.push(text.slice(selStart, i).trim());
      depth++;
      start = i + 1;
    } else if (text[i] === "}") {
      const sel = stack.pop();
      const body = text.slice(start, i);
      if (!body.includes("{")) out.push({ sel, body });
      depth--;
      selStart = i + 1;
    } else if (depth === 0 && text[i] === ";") {
      selStart = i + 1;
    }
  }
  return out;
}
const parsed = rules(bare);

// --- 1. The handwriting face is self-hosted -----------------------------

const faces = [...bare.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
assert.ok(
  faces.length > 0,
  `Replicata: open style.css and look for @font-face.
Expectata: at least one @font-face declares the handwriting face.
Resultata: no @font-face rule in the stylesheet.`,
);
assert.ok(
  faces.some(f => /font-family:\s*["']Patrick Hand["']/.test(f)),
  `Replicata: read every @font-face block in style.css.
Expectata: one of them declares font-family: "Patrick Hand".
Resultata: families were ${JSON.stringify(faces.map(f => (f.match(/font-family:([^;]*)/) || [])[1]))}.`,
);
for (const face of faces) {
  for (const [, raw] of face.matchAll(/url\(([^)]+)\)/g)) {
    const url = raw.trim().replace(/^["']|["']$/g, "");
    assert.ok(
      !/^(https?:)?\/\//.test(url),
      `Replicata: read the src: url(...) values in style.css's @font-face blocks.
Expectata: every font is served from this repo -- the page has no third-party
requests and must keep it that way.
Resultata: ${url} points off-site.`,
    );
    assert.ok(
      fs.existsSync(url),
      `Replicata: resolve each @font-face src: url(...) against the repo root.
Expectata: the font file is checked in.
Resultata: ${url} does not exist.`,
    );
  }
}

// --- 2. Two type roles, both tokenized ----------------------------------

const root = (bare.match(/:root\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
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
  !/feDisplacementMap/.test(html),
  `Replicata: grep index.html for feDisplacementMap.
Expectata: none. Displacing a stroke quantises it to whole device pixels and
the line comes out visibly blocky at 2x.
Resultata: index.html still defines a displacement filter.`,
);
assert.ok(
  !/filter:\s*url\(/.test(bare),
  `Replicata: grep style.css for filter: url(.
Expectata: none, for the same reason -- and a referenced-but-missing filter id
silently renders nothing, with no console error to catch it.
Resultata: ${JSON.stringify((bare.match(/filter:\s*url\([^)]*\)/g) || []).slice(0, 4))}.`,
);

// --- 4b. The drawn rule is a masked vector path -------------------------

const drawn = (root.match(/--drawn-rule\s*:([\s\S]*?);\n/) || [])[1];
// `<` may be literal or percent-encoded inside the data URI; both are the
// same shape, and the encoded form is the one that survives every parser.
const svgSource = drawn && decodeURIComponent(drawn);
assert.ok(
  svgSource && /<svg/.test(svgSource) && /<path/.test(svgSource),
  `Replicata: open style.css and read --drawn-rule in :root.
Expectata: an inline SVG data URI holding the hand-drawn wave that stands in
for the machined 1px border under each heading.
Resultata: ${JSON.stringify(drawn && drawn.trim().slice(0, 80))}.`,
);
const masked = parsed.filter(r => /mask-image:\s*var\(--drawn-rule\)/.test(r.body));
assert.ok(
  masked.length > 0,
  `Replicata: grep style.css for mask-image: var(--drawn-rule).
Expectata: at least one rule paints through the wave.
Resultata: the token is defined but nothing masks with it.`,
);
for (const { sel, body } of masked) {
  assert.ok(
    /-webkit-mask-image:\s*var\(--drawn-rule\)/.test(body),
    `Replicata: open style.css and find the rule for ${JSON.stringify(sel)}.
Expectata: -webkit-mask-image alongside mask-image -- older Safari only knows
the prefixed property, and without it the rule renders as a solid bar.
Resultata: that rule declares ${JSON.stringify(body.trim())}.`,
  );
  assert.ok(
    /background:\s*var\(--/.test(body),
    `Replicata: open style.css and find the rule for ${JSON.stringify(sel)}.
Expectata: the wave is a MASK over a tokenized background, not a coloured
image -- a colour baked into the data URI could not follow the palette.
Resultata: that rule declares ${JSON.stringify(body.trim())}.`,
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
  if (!/(^|[;\s])filter:/.test(body)) continue;
  for (const frag of FRAGILE) {
    const hit = sel.split(",").map(s => s.trim())
      .some(s => s === frag || s.startsWith(frag + " ") ||
                 s.startsWith(frag + ":") || s.startsWith(frag + "."));
    assert.ok(
      !hit,
      `Replicata: open style.css and find the rule for ${JSON.stringify(sel)}.
Expectata: no filter on ${frag} or on a bare descendant of it -- it would become
a containing block and break .chart-tip's position:fixed and the sticky <th>.
Resultata: that rule declares ${JSON.stringify(body.trim())}.`,
    );
  }
}

// --- 6. The tooltip stays out of the flow -------------------------------

const tip = parsed.find(r => r.sel === ".chart-tip");
assert.ok(
  tip && /position:\s*fixed/.test(tip.body),
  `Replicata: open style.css and find the .chart-tip rule.
Expectata: position: fixed -- the tooltip is positioned from viewport
coordinates by initTooltips().
Resultata: rule was ${JSON.stringify(tip && tip.body.trim())}.`,
);

// --- 7. Colors live in :root and nowhere else ---------------------------

// The 2026-07-01 de-vibe-coding pass consolidated every scattered gray/blue
// onto :root tokens. Re-skinning is exactly when that discipline slips.
const strays = [];
for (const { sel, body } of parsed) {
  if (sel.startsWith(":root")) continue;
  for (const [, hex] of body.matchAll(/(#[0-9a-fA-F]{3,8})\b/g)) strays.push(`${sel} { ... ${hex} }`);
}
assert.deepEqual(
  strays,
  [],
  `Replicata: grep style.css for hex colors outside the :root block.
Expectata: none -- every color comes from a design token so the palette has one
place to change.
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
  const m = root.match(new RegExp(`\\${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
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

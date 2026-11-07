import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";
import { holdsPercent, MARKUP_TEXT } from "./page-text.mjs";
import { parseCsv } from "./csv-parse.mjs";

// renderFleetForecastChart and the mixture helpers touch no DOM, so a thin stub
// context suffices (matching the distribution-chart qual's setup).
const ctx = vm.createContext({
  console, Math, Number, Float64Array, Map, Object,
  document: {
    getElementById() { return { textContent: "", innerHTML: "" }; },
    createElement() { return { textContent: "", innerHTML: "" }; },
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
// The "miles" metric reads vmtRows (repo VMT master), so populate it like init does.
vm.runInContext("vmtRows = parseVmtCsv(VMT_CSV_TEXT);", ctx);
// A helmer's entry of a forecast table, read, never assumed (since
// 2026-11-07; until then six reads took .components of the first match, so a
// table without the helmer stopped this qual on a TypeError naming nothing).
// assert is crashla.js's, which throws its message with the details appended.
vm.runInContext(`globalThis.__entry = (table, name, helmer) => {
  const entry = table.find(f => f.helmer === helmer);
  assert(entry !== undefined, "Replicata: read the forecast table " + name + " and find " + helmer + "'s entry.\\nExpectata: one, its components the lanes this qual reads.\\nResultata: none; the table's helmers are", table.map(f => f.helmer));
  return entry;
};`, ctx);

// The elements of an SVG or HTML text, in document order, each with its tag
// name in lower case (name: HTML reads a tag name in either case, so <PATH>
// is a path and <clippath> a clipPath); its start tag's attributes by name,
// in lower case too (attrs), read in any order, each value quoted with either
// quote (a quoted value may hold ">") or unquoted, an attribute given twice
// taking its first value, as HTML's tokenizer does; the text right after its
// start tag (text: a <text> element's label); where its start tag begins (at)
// and ends (tagEnd); where it ends (end: just past the end tag closing it, or
// its tagEnd when it has none, being closed by "/>" or an HTML void element),
// so an element written after it begins at or past its end; its chain: its
// ancestors, outermost first, and then itself; and where it was read (where:
// the text's name in this qual's messages). A comment reads as nothing. Each
// end tag must close the innermost open element, of its name in either case,
// and every element be closed by the text's end (an HTML element whose end
// tag HTML implies, a <p> left open, fails here). Every element this qual
// reads is read through it. Until 2026-11-04 each read named its element's
// attributes in the order the chart writes them, so the same element written
// in another order went unread: a median marker with its class before its cx
// (as renderDot writes its dots) read as no marker at all ("[] of 0"). Until
// later that day (the sixth fix run's second review) the reads did not nest
// the elements (only each clip group's end was found, by counting <g> tags),
// so no mark's ancestors were read (drawnPaint, below). Until that run's
// third review names were read as written, so the same chart with a tag or
// an attribute named in upper case (<PATH>, CLASS, CLIPPATHUNITS) or an end
// tag in another case than its start tag (</clippath>) read as missing marks
// or as markup that does not nest; an attribute given twice took its last
// value; and the messages of these asserts named no chart.
const VOID = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];
// A start or end tag as HTML's tokenizer reads it (since 2026-11-07; until
// then two regexes that split a tag at JavaScript's white space, a no-break
// space among it, and skipped what they could not read, so a tag the browser
// reads otherwise read as the chart's: an attribute after a no-break space,
// which HTML reads as part of the attribute's name, read as a style, and a
// tag name followed by one read as a path). HTML's white space is tab, line
// feed, form feed, carriage return and space (the classes below). A tag name runs from
// its first letter to white space, "/" or ">"; an attribute's name from its
// first character to white space, "/", ">" or "=" (its first may be "="),
// lower case taken for ASCII upper case; after it, white space, then "=",
// white space and a value: quoted with either quote (holding ">" and white
// space), or unquoted to white space or ">"; a quoted value may be followed
// by the next attribute's name with no white space between (a parse error
// HTML recovers from), and a "/" not before ">" reads as white space. The
// tag ends at the first ">" outside a quoted value. Each reader returns the
// tag's parts and where it ends.
const sticky = re => new RegExp(re, "y");
const TAG_NAME = sticky("[a-zA-Z][^\\t\\n\\f\\r />]*"), ATTR_NAME = sticky("[^\\t\\n\\f\\r />][^\\t\\n\\f\\r />=]*");
const SPACE = sticky("[\\t\\n\\f\\r ]*"), QUOTED = sticky(`"([^"]*)"|'([^']*)'`), UNQUOTED = sticky("[^\\t\\n\\f\\r >]*");
const scan = (re, t, i) => { re.lastIndex = i; return re.exec(t); };
const lower = s => s.replace(/[A-Z]+/g, c => c.toLowerCase());
const startTag = (t, i) => {
  const name = scan(TAG_NAME, t, i + 1)[0];
  const pairs = [];
  let k = i + 1 + name.length, selfClosing = false;
  for (;;) {
    k += scan(SPACE, t, k)[0].length;
    if (k >= t.length || t[k] === ">") break;
    if (t[k] === "/") {
      selfClosing = t[k + 1] === ">";
      k += 1;
      continue;
    }
    const attr = scan(ATTR_NAME, t, k)[0];
    k += attr.length;
    const eq = scan(sticky("[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*"), t, k);
    let value = "";
    if (eq !== null) {
      k += eq[0].length;
      const q = scan(QUOTED, t, k);
      const v = q ?? scan(UNQUOTED, t, k);
      value = q === null ? v[0] : q[1] ?? q[2];
      k += v[0].length;
    }
    pairs.push([lower(attr), value]);
  }
  return {name: lower(name), written: name, pairs, end: k + 1, selfClosing};
};
const endTag = (t, i) => {
  const name = scan(TAG_NAME, t, i + 2)[0];
  return {name: lower(name), written: name, end: t.indexOf(">", i) + 1};
};
// An element's text, to the next tag (MARKUP_TEXT: a "<" that opens no tag is
// text; until the second final review of the sixth fix run, 2026-11-07, the
// text ran to the first "<", so an axis title holding one, "Fleet size (<1M
// cars)", read as "Fleet size (", and its check went red).
const LABEL = new RegExp(MARKUP_TEXT, "y");
const parse = (text, where) => {
  // The text with each comment blanked out, every other character where it was.
  const t = text.replace(/<!--[\s\S]*?-->/g, c => " ".repeat(c.length));
  const root = {name: "none", at: "none", chain: []}, open = [root], els = [];
  // Each "<" that opens a start tag (a letter after it) or an end tag ("/"
  // and a letter), past the last tag read (pos: a "<" inside a quoted value
  // is that tag's); any other "<" is text.
  let pos = 0;
  for (const m of t.matchAll(/<\/?(?=[a-zA-Z])/g)) {
    if (m.index < pos) continue;
    if (m[0] === "</") {
      const tag = endTag(t, m.index);
      const inner = open.pop();
      assert.ok(inner !== root && inner.name === tag.name && tag.end > 0,
        `Replicata: read ${where}'s markup (parse), nesting each element in the innermost one open where its start tag stands.
Expectata: each end tag closes the innermost open element, of its name (in either case).
Resultata: </${tag.written}> at ${m.index}, where the innermost open element is ${inner.name} (its start tag at ${inner.at}).`);
      inner.end = tag.end;
      pos = tag.end;
    } else {
      const tag = startTag(t, m.index);
      LABEL.lastIndex = tag.end;
      const el = {name: tag.name, at: m.index, tagEnd: tag.end, end: tag.end, text: LABEL.exec(t)[0], where,
        attrs: Object.fromEntries(tag.pairs.filter(([attr], k) => tag.pairs.findIndex(([other]) => other === attr) === k))};
      el.chain = [...open.at(-1).chain, el];
      els.push(el);
      pos = tag.end;
      if (!tag.selfClosing && !VOID.includes(tag.name)) open.push(el);
    }
  }
  assert.ok(open.length === 1,
    `Replicata: read ${where}'s markup (parse), nesting each element in the innermost one open where its start tag stands.
Expectata: every element closed by the text's end.
Resultata: open at the text's end: ${open.slice(1).map(el => `<${el.name}> (its start tag at ${el.at})`).join(", ")}.`);
  return els;
};

// A text as JSON, every character outside printable ASCII written as its
// \u escape (JSON.stringify leaves a no-break space a space to the eye).
const printable = s => JSON.stringify(s).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

// The precision of the coordinates the chart writes: toFixed(2)'s rounding,
// plus float slack.
const ROUNDING = 0.005 + 1e-9;
const near = (a, b) => Math.abs(a - b) <= ROUNDING;
const num = v => Number(v.toFixed(4));

// HTML's, CSS's and SVG's white space (space, tab, line feed, carriage
// return and form feed), the white space every value this qual reads is
// split or trimmed at: JavaScript's \s and trim() take in more (a no-break
// space among it), so a value the browser ignores, "#d13b2d" and a no-break
// space say, would read as valid.
const WS = "[ \\t\\n\\r\\f]";
const trimWS = s => s.replace(new RegExp(`^${WS}+|${WS}+$`, "g"), "");

// Whether an element's class attribute lists the class name, among any
// others. Until later on 2026-11-04 (the sixth fix run's first review) the
// reads compared the whole attribute with one name, so a median marker, an
// axis line or the axis title given a second class read as missing (the app
// already draws month-dot circles with a second class, " month-ghost").
const hasClass = (el, name) => Object.entries(el.attrs).some(([attr, value]) => attr === "class" && trimWS(value).split(new RegExp(`${WS}+`)).includes(name));

// The presentation properties this qual reads.
const PAINT = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "display", "visibility", "clip-path", "color", "transform"];
// Properties whose values keep their letter case: a clip path's url (its id)
// and a path's data (its commands).
const CASED = ["clip-path", "d"];
// An element's own properties among `names`, by name: its attributes of those
// names, overridden by its style attribute's declarations, each split at its
// first ":", a later declaration of a property overriding an earlier one, as
// in CSS; each property's value trimmed (of WS) and in lower case (CSS keywords and
// hex digits are case-insensitive) but for those in CASED. A trailing
// "!important" is dropped from a declaration, and an attribute whose value
// carries one is left out, as the browser ignores it (a presentation
// attribute takes no "!important"). Geometry is read the same way where a
// style declaration can give it (Chromium draws a rect's x, y, width, height,
// rx and ry, a circle's cx, cy and r and a path's d from CSS as well). A
// property a stylesheet (style.css) sets is not read. Since later on
// 2026-11-04 (the sixth fix run's first review) every mark's paint is read by
// property: until then a mark was told a stroke or a fill, and its colour
// read, by the first declaration of its style, so the same mark written with
// its declarations in another order (a stroke's "fill:none" first), with a
// space after a colon, or with presentation attributes read as no stroke, no
// fill or another colour, and a later declaration repainting a stroke went
// unread. Until that run's second review (the same day) a property written in
// upper case, or a value in upper case or marked "!important", read as another
// (a stroke drawn with "fill:NONE" or "fill:none !important" read as a fill).
// Until its third review a presentation attribute marked "!important" was
// read as if valid, so strokes whose fill:none the browser ignored (filling
// them black) read as strokes, and an ignored opacity="0 !important" as a
// mark not drawn; and geometry was read from attributes alone.
const props = (el, names) => Object.fromEntries([
  ...Object.entries(el.attrs).filter(([attr, value]) => names.includes(attr) && !new RegExp(`!${WS}*important`, "i").test(value)),
  ...Object.entries(el.attrs).filter(([attr]) => attr === "style").flatMap(([, style]) => style.split(";"))
    .filter(d => d.includes(":")).map(d => [trimWS(d.slice(0, d.indexOf(":"))).toLowerCase(), d.slice(d.indexOf(":") + 1).replace(new RegExp(`!${WS}*important${WS}*$`, "i"), "")])
    .filter(([prop]) => names.includes(prop)),
].map(([prop, value]) => [prop, trimWS(value)])
  .map(([prop, value]) => [prop, CASED.includes(prop) ? value : value.toLowerCase()]));
const paint = el => props(el, PAINT);
// A number as CSS and SVG write one, and a length as user units: a value
// that, trimmed of white space (WS), is a number or a number in px (an svg's
// px are its user units), read as that number; any other (another unit, a
// percentage, a value holding another character, a no-break space or a hex
// number say, or none given) reads as NaN, as the browser draws such a
// length as 0 or not at all. Until 2026-11-07 Number read it, which trims a
// no-break space and reads hex ("0x10"), so a radius, a clip width or an
// axis end the browser reads as 0 read as the number, and the axes' ends were
// read with Number alone, so one written in px read as NaN.
const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";
const LENGTH = new RegExp(`^(${NUMBER})(?:px)?$`, "i");
const userUnits = v => Number((LENGTH.exec(trimWS(`${v}`)) ?? [, NaN])[1]);
// A fraction (an opacity) as CSS writes one: a number, or a percentage of 1
// (since 2026-11-07; until then a percentage stopped this qual as a value it
// does not read, though the browser draws opacity 12% as 0.12).
const FRACTION = new RegExp(`^(${NUMBER})(%?)$`);
const fraction = v => {
  const m = FRACTION.exec(`${v}`);
  return Number(m[1]) * 0.01 ** m[2].length;
};
// SVG's comma-wsp, the separator of a list's numbers: white space and at
// most one comma, or a comma and white space (since 2026-11-07; until then
// any run of commas and white space, so a dash list "6,,4", which the browser
// rejects and draws solid, read as dashed).
const COMMA_WSP = "(?:[ \\t\\n\\r\\f]+,?[ \\t\\n\\r\\f]*|,[ \\t\\n\\r\\f]*)";

// The numeric paint properties, each with the form of value this qual reads:
// a number (a stroke-width also in px; an opacity also a percentage), and a
// dash array of none or numbers (each also in px or %) apart by comma-wsp.
const NUMERIC = {
  "stroke-width": new RegExp(`^${NUMBER}(?:px)?$`),
  opacity: FRACTION,
  "fill-opacity": FRACTION,
  "stroke-opacity": FRACTION,
  "stroke-dasharray": new RegExp(`^(?:none|${NUMBER}(?:px|%)?(?:${COMMA_WSP}${NUMBER}(?:px|%)?)*)$`),
};

// The properties an element is drawn with, read from its chain (its
// ancestors and itself): each property in INHERITED (those SVG inherits) from
// the nearest of them that gives it, a fill or stroke of currentcolor read as
// the color so given (left as currentcolor where none gives one); opacity,
// the product of the opacities they give (1 where none does); displayNone,
// whether any of them has display none; transforms, the transforms they give
// (a transform of none, or empty, aside: neither moves anything); and
// clipped, whether any of them is clipped by the fleet-clip clip path (its
// clip-path, an attribute or a style declaration, url(#fleet-clip), quoted or
// not, url in either case). Every numeric paint value in the chain must be of
// a form NUMERIC reads, else this fails, naming it: a var() or calc() is not
// read. Since the sixth fix run's second review (2026-11-04) every mark is
// read as drawn: until then only its own attributes were read, so paint given
// on a group around the marks went unread (the strokes' shared "fill:none" on
// a group read as eight fills, the conditional lane's dash on a group around
// its stroke as drawn solid), a group's opacity 0, display none,
// stroke-opacity 0, visibility hidden or transform passed, and a stroke drawn
// in currentColor read as that colour. Until that run's third review a
// transform="" read as a transform, URL(#fleet-clip) as no clip, and a
// numeric value parseFloat cannot read (a var() or calc()) as SVG's default:
// the mark shown, its opacity left out of the product, its dash read as none.
const INHERITED = ["fill", "stroke", "stroke-width", "stroke-dasharray", "fill-opacity", "stroke-opacity", "visibility", "color"];
const FLEET_CLIP_URL = /^[uU][rR][lL]\(\s*(["']?)#fleet-clip\1\s*\)$/;
const drawnPaint = el => {
  const own = el.chain.map(paint);
  const unread = el.chain.flatMap((a, k) => Object.entries(NUMERIC).filter(([prop, form]) => prop in own[k] && !form.test(own[k][prop]))
    .map(([prop]) => `<${a.name}> (its start tag at ${a.at}) ${prop}: ${printable(own[k][prop])}`));
  assert.ok(unread.length === 0,
    `Replicata: read the paint ${el.where}'s <${el.name}> (its start tag at ${el.at}) is drawn with, from its own and its ancestors' attributes and styles.
Expectata: each stroke-width, opacity, fill-opacity, stroke-opacity and stroke-dasharray among them a value this qual reads: a number (a stroke-width also in px; an opacity also a percentage), and a dash array none or numbers (each also in px or %) apart by SVG's comma-wsp (white space and at most one comma, or a comma and white space).
Resultata: ${unread.join("; ")}.`);
  const inherited = Object.assign({}, ...own.map(p => Object.fromEntries(Object.entries(p).filter(([prop]) => INHERITED.includes(prop)))));
  return {...inherited,
    ...Object.fromEntries(["fill", "stroke"].filter(prop => inherited[prop] === "currentcolor" && "color" in inherited).map(prop => [prop, inherited.color])),
    opacity: own.filter(p => "opacity" in p).map(p => fraction(p.opacity)).reduce((a, b) => a * b, 1),
    displayNone: own.some(p => p.display === "none"),
    transforms: own.map(p => p.transform).filter(t => ![undefined, "none", ""].includes(t)),
    clipped: own.some(p => FLEET_CLIP_URL.test(`${p["clip-path"]}`)),
  };
};

// A colour as #rrggbb where it is written #rgb, #rrggbb or rgb() of three
// integers (one over 255 read as 255), any other as written, so that the same
// colour in those notations, in either letter case, compares equal. Until the
// sixth fix run's second review (2026-11-04) colours were compared as
// written, letter case aside, so a stroke written rgb(209, 59, 45) read as
// another colour than its lane's #d13b2d.
// The channels of rgb() are apart by commas throughout or by white space
// throughout (since 2026-11-07; until then either at each gap, so a colour
// the browser rejects, "rgb(209, 59 45)", read as #d13b2d).
const colour = c => `${c}`.toLowerCase()
  .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3")
  .replace(new RegExp(`^rgb\\(${WS}*(\\d+)(?:${WS}*,${WS}*(\\d+)${WS}*,${WS}*|${WS}+(\\d+)${WS}+)(\\d+)${WS}*\\)$`),
    (_, r, g1, g2, b) => `#${[r, g1 ?? g2, b].map(v => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("")}`);

// Whether a mark's drawn paint (drawnPaint) shows it: each of the properties
// named positive where given (one not given takes SVG's default, which shows
// the mark: parseFloat reads it as NaN, which is not "<= 0"), no element of
// its chain with display none, and its visibility not hidden or collapse.
const shows = (p, props) => props.every(prop => !(parseFloat(p[prop]) <= 0)) && !p.displayNone && !["hidden", "collapse"].includes(p.visibility);

// The chart renderFleetForecastChart drew, in a text: its own <svg> (the
// innermost one around its one <clipPath id="fleet-clip">), that svg's
// elements, the legend and anything else outside it aside, and that clip
// path. Each section reads the chart's marks from it. Until the sixth fix
// run's third review (2026-11-04) the marks were read from the whole text, so
// a legend whose swatches were drawn as small paths in the lanes' colours
// read as more strokes, and one whose swatches were small svgs with a viewBox
// of their own gave section 1 the first swatch's height for the chart's.
const chartOf = (text, chart) => {
  const els = parse(text, chart);
  const clipPaths = els.filter(el => el.name === "clippath" && el.attrs.id === "fleet-clip");
  const svgs = clipPaths.map(cp => cp.chain.filter(a => a.name === "svg").at(-1));
  assert.ok(clipPaths.length === 1 && svgs[0] !== undefined,
    `Replicata: render ${chart} and find its fleet-clip clip path and the <svg> around it.
Expectata: one <clipPath id="fleet-clip">, inside an <svg>.
Resultata: ${clipPaths.length} clip paths with that id, each inside ${JSON.stringify(clipPaths.map(cp => cp.chain.map(a => a.name).join(" > ")))}.`);
  return {svg: svgs[0], els: els.filter(el => el.chain.includes(svgs[0])), clipPath: clipPaths[0]};
};

// The fleet-clip clip path's rectangle in a chart renderFleetForecastChart
// drew (chartOf), as numbers: the one <rect> among the clip path's children
// (any other child only adds to the clip, whose part the rectangle is: so
// the rectangle alone must contain the frame), its x, y, width and height
// read by property (props); the clip path in user space (its clipPathUnits
// absent or userSpaceOnUse); the rectangle with square corners (its rx and ry
// absent or 0), drawn into the clip (its own display not none, its
// visibility, inherited, not hidden or collapse: a rectangle so hidden adds
// nothing, and the clip then hides every curve), under no transform (on it,
// its clip path or an ancestor: this qual applies none), and neither it nor
// its clip path clipped by a clip path of its own (this qual reads none). A
// display none on the clip path or an ancestor does not fail here: Chromium
// then applies no clip at all (the picture of a clip far wider than the
// frame, CLIP_HUGE's), and the SVG spec still clips. Until 2026-11-04 section
// 1b read the rectangle with a match that threw a TypeError naming nothing
// when it was missing, and 4e read it through a fallback to no rectangle; and
// until then a second clip path with the id (an id the document then holds
// twice, the first of them clipping) was not read. Until the sixth fix run's
// second review (the same day) a transform on the rectangle or its clip path
// was not read; until its third review neither were the clip path's units,
// the rectangle's corners and visibility, a rectangle nested in a group (which
// clips nothing) or the clip path's own clip, so a clip in object-bounding-box
// units, a hidden rectangle, or one nested in a <g>, each hiding every curve,
// passed.
const fleetClip = (chart, {els, clipPath}) => {
  const children = els.filter(el => el.chain.at(-2) === clipPath);
  const rects = children.filter(el => el.name === "rect");
  const geometry = rects.map(el => props(el, ["x", "y", "width", "height", "rx", "ry"]));
  const boxes = geometry.map(g => ({x: userUnits(g.x), y: userUnits(g.y), width: userUnits(g.width), height: userUnits(g.height)}));
  const rounded = geometry.filter(g => ["rx", "ry"].some(k => k in g && userUnits(g[k]) !== 0));
  const drawn = rects.map(el => ({display: paint(el).display, ...drawnPaint(el)}));
  const hidden = drawn.filter(p => p.display === "none" || ["hidden", "collapse"].includes(p.visibility));
  const moved = drawn.flatMap(p => p.transforms);
  const ownClips = [clipPath, ...rects].map(el => paint(el)["clip-path"]).filter(c => ![undefined, "none"].includes(c));
  assert.ok(rects.length === 1 && boxes.every(box => Object.values(box).every(Number.isFinite)) && rounded.length === 0
    && [undefined, "userSpaceOnUse"].includes(clipPath.attrs.clippathunits) && hidden.length === 0 && moved.length === 0 && ownClips.length === 0,
    `Replicata: render ${chart} and read its fleet-clip clip path.
Expectata: in user space (its clipPathUnits absent or userSpaceOnUse), one <rect> among its children (any other child only adds to the clip), with numeric x, y, width and height and square corners (rx and ry absent or 0), each read as an attribute overridden by a style declaration; the rect drawn into the clip (its display not none, its visibility, inherited, not hidden or collapse), under no transform (on it, its clip path or an ancestor: this qual applies none), and neither it nor its clip path clipped by a clip path of its own (this qual reads none).
Resultata: the clip path's attributes ${JSON.stringify(clipPath.attrs)}, its children ${JSON.stringify(children.map(el => el.name))}; its rects' geometry ${JSON.stringify(geometry)}, drawn with ${JSON.stringify(drawn)}; the clip paths on it and its rects ${JSON.stringify(ownClips)}.`);
  return boxes[0];
};

// The plot frame of a chart renderFleetForecastChart drew, from its two
// month-axis lines (among the chart's elements, chartOf), the lines mapX and
// mapY span: the y axis (vertical), the frame's left edge from its top to its
// bottom, and the x axis (horizontal), along the frame's bottom from its left
// edge to its right edge, the two meeting at its bottom-left corner (the x
// axis at the y axis's lower end, starting at its x), to the path's 0.01
// rounding; each drawn to be seen and under no transform (its own and its
// ancestors' paint, drawnPaint: its stroke not none or transparent where the
// chart's markup gives it; the stroke style.css gives the axes is not read).
// A frame drawn otherwise (its axes as a path, a third month-axis line, an
// axis running past the corner) fails here. Until later on 2026-11-04 (the
// sixth fix run's first review) the corner was not read, so an x axis drawn
// off the frame's bottom, or starting off its left edge, passed, and a y axis
// running past the x axis read as a clip cutting the frame. Until that run's
// second review (the same day) the axes' paint was not read, so a hidden x
// axis framed the chart (and a line of another class drawn elsewhere passed
// for it); until its third review their stroke was not, so an x axis given
// stroke none in its markup did.
const plotFrame = (chart, els) => {
  const lines = els.filter(el => el.name === "line" && hasClass(el, "month-axis"));
  const axes = lines.map(el => ({x1: userUnits(el.attrs.x1), y1: userUnits(el.attrs.y1), x2: userUnits(el.attrs.x2), y2: userUnits(el.attrs.y2)}));
  const yAxes = axes.filter(a => a.x1 === a.x2 && a.y1 !== a.y2), xAxes = axes.filter(a => a.y1 === a.y2 && a.x1 !== a.x2);
  assert.ok(axes.length === 2 && yAxes.length === 1 && xAxes.length === 1,
    `Replicata: render ${chart} and read its month-axis lines (the lines mapX and mapY span).
Expectata: two: one vertical (the y axis) and one horizontal (the x axis).
Resultata: the month-axis lines ${JSON.stringify(axes)}, of them ${yAxes.length} vertical and ${xAxes.length} horizontal.`);
  const unseen = lines.map(el => ({line: el.attrs, paint: drawnPaint(el)}))
    .filter(a => !shows(a.paint, ["opacity", "stroke-opacity", "stroke-width"]) || ["none", "transparent"].includes(a.paint.stroke) || a.paint.transforms.length > 0);
  assert.ok(unseen.length === 0,
    `Replicata: render ${chart} and read the paint its month-axis lines are drawn with (their own and their ancestors' attributes and styles).
Expectata: each drawn to be seen (its opacity, the product of its chain's, its stroke-opacity and stroke-width positive where given, its stroke not none or transparent where given, display not none, visibility not hidden or collapse) and under no transform (this qual applies none).
Resultata: ${unseen.map(a => `the line ${JSON.stringify(a.line)}, drawn with ${JSON.stringify(a.paint)}`).join("; ")}.`);
  const [yAxis, xAxis] = [yAxes[0], xAxes[0]];
  const frame = {left: yAxis.x1, top: Math.min(yAxis.y1, yAxis.y2), bottom: Math.max(yAxis.y1, yAxis.y2), right: Math.max(xAxis.x1, xAxis.x2)};
  // Where the x axis starts, and its height.
  const xStart = Math.min(xAxis.x1, xAxis.x2), xHeight = xAxis.y1;
  assert.ok(frame.left < frame.right && frame.top < frame.bottom && near(xStart, frame.left) && near(xHeight, frame.bottom),
    `Replicata: render ${chart} and read its month-axis lines (the lines mapX and mapY span).
Expectata: the y axis the frame's left edge, from its top to its bottom, and the x axis along the frame's bottom from its left edge to its right edge, right of the y axis: the two meeting at the frame's bottom-left corner (the x axis at the y axis's lower end, starting at its x), to the path's 0.01 rounding.
Resultata: the y axis at x ${frame.left} from y ${frame.top} down to y ${frame.bottom}, the x axis at y ${xHeight} from x ${xStart} to x ${frame.right}.`);
  return frame;
};

// The fleet-clip rectangle clips the fills and strokes, so it must contain
// the whole frame, to the path's 0.01 rounding. Each section reads it before
// anything it checks against the frame, so a clip that cuts the frame is
// reported as such: until later on 2026-11-04 (the sixth fix run's first
// review) section 1b took its frame from the rectangle, so a clip cutting the
// frame's top read there as the tallest lane's median marker off the frame.
const clipHoldsFrame = (chart, drawing, frame) => {
  const clip = fleetClip(chart, drawing);
  const cuts = Object.entries({left: clip.x - frame.left, top: clip.y - frame.top, right: frame.right - (clip.x + clip.width), bottom: frame.bottom - (clip.y + clip.height)})
    .filter(([, by]) => !(by <= ROUNDING));
  assert.ok(cuts.length === 0,
    `Replicata: render ${chart} and compare its fleet-clip rectangle, the clip of its fills and strokes, with its frame (its month-axis lines).
Expectata: the rectangle contains the frame (left ${frame.left}, top ${frame.top}, right ${frame.right}, bottom ${frame.bottom}), to the path's 0.01 rounding.
Resultata: the rectangle (x ${clip.x}, y ${clip.y}, width ${clip.width}, height ${clip.height}) cuts the frame ${cuts.map(([side, by]) => `at its ${side} by ${num(by)}`).join(", ")}.`);
};

// --- 1. The chart renders an SVG with all four curves + median markers ---
// Four curves: Waymo, Zoox, and Tesla split into its two scopes (robotaxi + the
// conditional all-HW4-ADS scenario, drawn in its own colour).

const html = vm.runInContext("renderFleetForecastChart()", ctx);
const fleetChart = "the fleet forecast's fleet chart (renderFleetForecastChart)";

assert.ok(
  html.includes("<svg") && html.includes("fleet-clip"),
  `Replicata: call renderFleetForecastChart.
Expectata: output is an SVG using the fleet-clip clip-path.
Resultata: no <svg / fleet-clip found.`,
);

// The SVG's height and the bottom label are read, never assumed (until
// 2026-11-04 a chart without a viewBox, or without its axis title among its
// tick texts, read the inset as NaN, reported as "... was inset NaN"); both
// from the chart's own svg (chartOf), since the sixth fix run's third review
// (until then the first svg of the fragment with a viewBox, a legend
// swatch's say, and the tick texts of the whole fragment).
const fleetDrawing = chartOf(html, fleetChart);
const viewBox = /^0 0 [\d.]+ ([\d.]+)$/.exec(fleetDrawing.svg.attrs.viewbox);
assert.ok(viewBox !== null,
  `Replicata: call renderFleetForecastChart and read its chart's SVG's viewBox.
Expectata: "0 0 <width> <height>".
Resultata: the chart's <svg> viewBox ${JSON.stringify(fleetDrawing.svg.attrs.viewbox)}.`);
const svgHeight = Number(viewBox[1]);
const tickLabels = fleetDrawing.els.filter(el => el.name === "text" && hasClass(el, "month-tick"));
// The axis title, read from the app (no wording pins in quals, 2026-10-28).
const fleetTitle = vm.runInContext('growthMetricSpec("fleet").yLabel', ctx);
const bottomLabel = tickLabels.find(el => el.text === fleetTitle);
assert.ok(bottomLabel !== undefined,
  `Replicata: call renderFleetForecastChart and find its axis title (growthMetricSpec("fleet").yLabel, ${JSON.stringify(fleetTitle)}) among its month-tick texts.
Expectata: one, the bottom label.
Resultata: the month-tick texts ${JSON.stringify(tickLabels.map(el => el.text))}.`);
const bottomLabelInset = svgHeight - Number(bottomLabel.attrs.y);
assert.equal(
  bottomLabelInset,
  9,
  `Replicata: render the fleet forecast at 320px through 1000px wide.
Expectata: the bottom label's baseline is inset nine SVG units, keeping the
label's descenders inside the viewport in Chromium, Firefox, and WebKit.
Resultata: ${JSON.stringify(bottomLabel.text)} (y ${JSON.stringify(bottomLabel.attrs.y)}) was inset ${bottomLabelInset}.`,
);

for (const [label, color] of [["Tesla robotaxi", "#d13b2d"], ["Tesla HW4", "#e08a2e"],
  ["Waymo", "#2060c0"], ["Zoox", "#2a8f57"]]) {
  assert.ok(
    html.includes(color),
    `Replicata: render the fleet forecast chart.
Expectata: ${label}'s curve colour ${color} appears.
Resultata: colour not found.`,
  );
}

// Both Tesla scopes are labeled with their scenario probability, computed here
// from FLEET_FORECAST's weights; the names come from the app (FLEET_LANE_META)
// and are not pinned (no wording pins, 2026-10-28). A label is read as one of
// the chart's texts (its legend chips' among them) holding the scope's name
// and its share as a whole percent, in any words and form (until the main
// agent's pass after the sixth fix run's third final review, 2026-11-07, the
// chart had to hold "<name> (~<n>%)", so a legend written "Tesla robotaxi,
// ~93%" turned this qual red). The conditional HW4 curve
// is dashed: here only a dashed stroke is looked for; since later on
// 2026-11-04 (the sixth fix run's first review) section 4e reads, on every
// metric, that each lane's stroke is dashed exactly when its lane is
// conditional (until then no check read which lane was dashed, though this
// section's message said it did).
{
  const scopes = JSON.parse(vm.runInContext(`JSON.stringify({meta: FLEET_LANE_META,
    weights: __entry(FLEET_FORECAST, "FLEET_FORECAST", "Tesla").components.map(c => ({scope: c.scope, weight: c.weight}))})`, ctx));
  const want = ["robotaxi", "hw4"].map(k => [scopes.meta[k].label, Math.round(100 * scopes.weights.filter(w => w.scope === k).reduce((t, w) => t + w.weight, 0))]);
  const decodeText = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const texts = [...html.matchAll(new RegExp(`>(${MARKUP_TEXT})(?=<\\/?[a-zA-Z]|$)`, "g"))].map(m => decodeText(m[1]).trim()).filter(t => t !== "");
  const missing = want.filter(([label, pct]) => !texts.some(t => t.includes(label) && holdsPercent(t, pct)));
  assert.ok(missing.length === 0,
    `Replicata: read the fleet chart's texts, its legend's among them.
Expectata: Tesla's two scopes labeled with their scenario shares from the weights, each a text holding the scope's name and its share as a whole percent: ${JSON.stringify(want.map(([label, pct]) => `${label}, ${pct}%`))}.
Resultata: none for ${JSON.stringify(missing.map(([label, pct]) => `${label}, ${pct}%`))}; the texts holding a Tesla scope's name are ${JSON.stringify(texts.filter(t => want.some(([label]) => t.includes(label))))}.`,
  );
}
assert.ok(
  html.includes("stroke-dasharray"),
  `Replicata: inspect the fleet chart strokes.
Expectata: a dashed stroke (stroke-dasharray) among them, the conditional HW4 curve's (section 4e reads which), in the chart's markup (this qual reads no stylesheet: a dash style.css gives a class is not read).
Resultata: no stroke-dasharray found in the chart's markup.`,
);

// One median marker per curve (4), each with one tooltip target: since
// 2026-10-03 (audit #28) an invisible hit circle over the visible dot. The
// markers and targets are read from the chart's svg, the tooltips from the
// whole fragment.
const chartCircles = fleetDrawing.els.filter(el => el.name === "circle");
const markerCount = chartCircles.filter(el => hasClass(el, "month-dot")).length;
const tipCount = chartCircles.filter(el => drawnPaint(el).fill === "none" && "data-tip" in el.attrs).length;
const tippedCount = parse(html, fleetChart).filter(el => "data-tip" in el.attrs).length;
assert.ok(
  markerCount === 4 && tipCount === 4 && tippedCount === 4,
  `Replicata: count median markers and tooltips in the fleet chart.
Expectata: one median dot with one tooltip target per curve (4 each), and no other tooltip.
Resultata: ${markerCount} dots, ${tipCount} targets, ${tippedCount} elements with a tooltip.`,
);

// --- 1b. Median markers are drawn whole (2026-10-03, audit #25) -------------
// The y scale topped out at the tallest sampled density and the markers sat
// inside the clip-path group, so Waymo's median marker (near its curve's peak)
// lost its top 1.5-2.3 units on every metric. Markers now draw outside the
// clip group, and the scale leaves headroom above the tallest marker and
// sample. Since 2026-11-04 the fleet-clip rectangle is asserted found: until
// then a missing rectangle threw a TypeError naming nothing. A marker
// coordinate that is not a number counts as off the frame (until then it had
// to be digits to be read at all). Since later that day (the sixth fix run's
// first review) the frame is the chart's month-axis lines (plotFrame), which
// the fleet-clip rectangle must contain (clipHoldsFrame), as in section 4e.
// Since that run's second review the markers and their hit circles are read
// by how the elements nest (parse, drawnPaint): each marker must be clipped
// by nothing fleet-clip clips (neither it nor an ancestor carries clip-path
// url(#fleet-clip)), and each hit circle clipped by nothing and drawn after
// every marker, over the visible dots, which would otherwise take its
// pointer. Each marker must also be drawn over every stroke and fill its disc
// meets: section 4e reads that, from the curves' geometry. The marks are read
// from the chart's own svg (chartOf), its geometry by property (props).
// Until that run's third review each marker had to be drawn after every path,
// so markers each drawn right after their own lane's stroke, over every curve
// they meet (the same picture), went red; and until its second review the
// curves had to be clipped in at least one group (<g>) clipped by fleet-clip,
// each ended at the </g> closing it, with the markers drawn outside every
// such group and the hit circles after the last, so curves each clipped by
// their own clip-path and no group (the same picture) went red; and before
// that run's first review, in exactly one such group, found by its attribute
// text alone and ended at the first </g> after it.
for (const key of ["fleet", "rides", "miles"]) {
  const svg = vm.runInContext(`selectedGrowthMetric = ${JSON.stringify(key)}; renderFleetForecastChart()`, ctx);
  const chart = `the fleet forecast's ${key} chart`;
  const drawing = chartOf(svg, chart);
  const frame = plotFrame(chart, drawing.els);
  clipHoldsFrame(chart, drawing, frame);
  const circles = drawing.els.filter(el => el.name === "circle");
  // The visible dots (class month-dot), each with whether it is clipped and
  // its centre and radius; then, where the last dot ends, and the hit
  // circles, each with whether it is clipped and whether it begins where the
  // last dot ends or later.
  const dots = circles.filter(el => hasClass(el, "month-dot")).map(el => ({el, geometry: props(el, ["cx", "cy", "r"])}))
    .map(({el, geometry}) => ({at: el.at, end: el.end, clipped: drawnPaint(el).clipped, cx: userUnits(geometry.cx), cy: userUnits(geometry.cy), r: userUnits(geometry.r)}));
  const dotsEnd = Math.max(...dots.map(d => d.end));
  const hits = circles.filter(el => drawnPaint(el).fill === "none" && "data-tip" in el.attrs)
    .map(el => ({at: el.at, clipped: drawnPaint(el).clipped, afterDots: el.at >= dotsEnd}));
  const bad = dots.filter(c => c.clipped || !(c.cy - c.r - 0.75 >= frame.top && c.cx >= frame.left && c.cx <= frame.right));
  const badHits = hits.filter(h => h.clipped || !h.afterDots);
  assert.ok(dots.length === 4 && bad.length === 0 && hits.length === 4 && badHits.length === 0,
    `Replicata: render ${chart} and locate its four median markers and their hit circles.
Expectata: each marker clipped by nothing fleet-clip clips (neither it nor an ancestor carrying clip-path url(#fleet-clip)), its centre inside the frame (x ${frame.left} to ${frame.right}) and its disc (r plus the 0.75 halo) at or below the frame's top edge (y ${frame.top}); and four hit circles, each clipped by nothing and drawn after every marker (the last marker ending at ${dotsEnd}).
Resultata: ${dots.length} markers (month-dot circles), of them clipped or off the frame ${JSON.stringify(bad)}; ${hits.length} hit circles, of them clipped or drawn before a marker's end ${JSON.stringify(badHits)}.`);
}
vm.runInContext(`selectedGrowthMetric = "fleet";`, ctx);

// --- 2. The chart container exists in index.html (init has a render target) ---

const indexHtml = fs.readFileSync("index.html", "utf8");
assert.ok(
  indexHtml.includes('id="chart-fleet-forecast"'),
  `Replicata: search index.html for the fleet chart container.
Expectata: a #chart-fleet-forecast element exists for the init render.
Resultata: not found.`,
);

// --- 3. Each curve is a normalized density; there are four of them ---

const stats = vm.runInContext(`
(() => {
  const curves = fleetForecastCurves();
  const integ = densFn => {
    const n = 12000, L0 = Math.log(1), L1 = Math.log(1e9), st = (L1 - L0) / (n - 1);
    let mass = 0;
    for (let i = 0; i < n; i++) mass += densFn(Math.exp(L0 + st * i)) * st;
    return mass;
  };
  // Slope-sign changes across each curve's probe extent: 1 = unimodal, >1 = multimodal.
  const signChanges = c => {
    const N = 600, a = Math.log(c.xMin), b = Math.log(c.xMax), ys = [];
    for (let i = 0; i < N; i++) ys.push(c.densityFn(Math.exp(a + (b - a) * i / (N - 1))));
    const pk = Math.max(...ys);
    let sc = 0, prev = 0;
    for (let i = 1; i < N; i++) {
      const dd = ys[i] - ys[i - 1];
      const s = Math.abs(dd) < pk * 1e-6 ? prev : Math.sign(dd);
      if (s !== 0 && s !== prev && prev !== 0) sc++;
      if (s !== 0) prev = s;
    }
    return sc;
  };
  return curves.map(c => ({
    key: c.key, mainline: c.mainline, scenarioProb: c.scenarioProb, mass: integ(c.densityFn),
    lo90: c.lo90, median: c.median, hi90: c.hi90, signChanges: signChanges(c),
  }));
})()
`, ctx);

assert.equal(
  stats.length, 4,
  `Replicata: build the fleet forecast curves.
Expectata: four curves (Waymo, Zoox, Tesla robotaxi, Tesla HW4).
Resultata: ${stats.length} curves.`,
);

for (const s of stats) {
  assert.ok(
    Math.abs(s.mass - 1) < 0.02,
    `Replicata: integrate the ${s.key} fleet density over a wide log grid.
Expectata: a normalized density (integral ~1 within 2%).
Resultata: mass was ${s.mass}.`,
  );
  assert.ok(
    s.lo90 < s.median && s.median < s.hi90,
    `Replicata: read the ${s.key} 5th/50th/95th fleet-size quantiles.
Expectata: strictly ordered lo90 < median < hi90.
Resultata: ${s.lo90} / ${s.median} / ${s.hi90}.`,
  );
}

// --- 4. The forecast's qualitative shape is the authored one ---

const byKey = Object.fromEntries(stats.map(s => [s.key, s]));

// Re-pinned 2026-10-29 for the Jan 1, 2028 forecast (the human moved the
// date; the re-pin was part of that choice). Until then: Waymo ~6,000
// (5,000-7,000) with a tail past 8,000; Zoox ~150 (100-220); Tesla robotaxi
// 200-2,000 at ~95%; Tesla HW4 at ~5%.
//
// Waymo carries a base + plan mode: one unimodal curve (the plan toward
// Semafor's reported 20,000 is a fat right shoulder, not a second peak),
// central ~12,000 with a tail past 18,000.
assert.ok(
  byKey.Waymo.median > 9000 && byKey.Waymo.median < 15000 &&
    byKey.Waymo.hi90 > 18000 && byKey.Waymo.signChanges === 1,
  `Replicata: inspect Waymo's fleet forecast.
Expectata: unimodal, median ~12,000 (9,000-15,000), with a tail past 18,000.
Resultata: median=${byKey.Waymo.median}, hi90=${byKey.Waymo.hi90}, signChanges=${byKey.Waymo.signChanges}.`,
);

assert.ok(
  byKey.Zoox.median > 250 && byKey.Zoox.median < 600 && byKey.Zoox.signChanges === 1,
  `Replicata: inspect Zoox's fleet forecast.
Expectata: a unimodal distribution with median ~400 (250-600).
Resultata: median=${byKey.Zoox.median}, signChanges=${byKey.Zoox.signChanges}.`,
);

// Tesla robotaxi (mainline, the large majority of Tesla's mass): the
// apples-to-apples fleet in car-equivalents, a mixture of A and B, its tail
// in robotaxi territory (no HW4 blow-up). Its median's band was 100-600 until
// 2026-10-23 and 200-2,000 until 2026-10-29. Until 2026-10-29 the curve also
// had to be bimodal (B a second hump); the 2028 scenarios' bands overlap
// (A 900-8,000, B 5,000-40,000), so B is a fat right shoulder.
assert.ok(
  byKey.robotaxi.mainline && byKey.robotaxi.scenarioProb > 0.8 &&
    byKey.robotaxi.median > 1000 && byKey.robotaxi.median < 10000 &&
    byKey.robotaxi.hi90 < 50000,
  `Replicata: inspect Tesla's robotaxi-scope curve.
Expectata: mainline, over 80% of Tesla's weight, median 1,000-10,000, 95th percentile under 50k (no HW4 tail).
Resultata: mainline=${byKey.robotaxi.mainline}, prob=${byKey.robotaxi.scenarioProb}, median=${byKey.robotaxi.median}, hi90=${byKey.robotaxi.hi90}, signChanges=${byKey.robotaxi.signChanges}.`,
);

// Tesla all-HW4 ADS (conditional, a small share): the broad scenario, drawn
// as its own unimodal curve, in car-equivalents like Tesla's line (the
// human's choice, 2026-10-30: its ADS miles a day / TESLA_MILES_PER_CAR_DAY),
// so tens of thousands to hundreds of thousands. Until 2026-10-31 it counted
// distinct customer cars, and this pinned a six-figure median and a tail past
// 1M.
assert.ok(
  !byKey.hw4.mainline && byKey.hw4.scenarioProb < 0.2 &&
    byKey.hw4.median > 10000 && byKey.hw4.hi90 > 100000 && byKey.hw4.signChanges === 1,
  `Replicata: inspect Tesla's HW4-scope curve.
Expectata: conditional (not mainline), under 20% of Tesla's weight, median past 10,000 car-equivalents, tail past 100,000, unimodal.
Resultata: mainline=${byKey.hw4.mainline}, prob=${byKey.hw4.scenarioProb}, median=${byKey.hw4.median}, hi90=${byKey.hw4.hi90}, signChanges=${byKey.hw4.signChanges}.`,
);

// --- 4b. Miles/rides curves: scenario mixtures with honest quantiles. Tesla's
// miles/rides mirror the FLEET_FORECAST scenario structure (same A/B/C weights,
// same robotaxi-vs-HW4 scope split into two lanes), so every metric draws four
// curves. Each displayed median/CI must be a real quantile of the drawn
// density — the single two-piece curve this replaced put its 8M "Median" dot
// at the 14th percentile of its own curve, and a one-humped band can't
// represent three weighted futures (slow, aggressive, HW4) at all. ---

const quantileStats = vm.runInContext(`
(() => {
  const out = [];
  for (const metric of ["miles", "rides"]) {
    const curves = fleetDistributionCurves(metric);
    for (const c of curves) {
      const cdfAt = xq => {
        const a = Math.log(c.lo90) - 8, b = Math.log(c.hi90) + 8, n = 20000;
        const st = (b - a) / (n - 1);
        let cum = 0;
        for (let i = 0; i < n; i++) {
          const x = Math.exp(a + st * i);
          if (x > xq) break;
          cum += c.densityFn(x) * st;
        }
        return cum;
      };
      out.push({metric, key: c.key, count: curves.length, legendLabel: c.legendLabel,
        dashed: c.dashed, median: c.median, lo90: c.lo90, hi90: c.hi90,
        cdfMedian: cdfAt(c.median), cdfLo: cdfAt(c.lo90), cdfHi: cdfAt(c.hi90)});
    }
  }
  return out;
})()
`, ctx);

for (const q of quantileStats) {
  assert.equal(q.count, 4,
    `Replicata: build the ${q.metric} distribution curves.
Expectata: four curves (Waymo, Zoox, Tesla robotaxi, Tesla HW4) — same scope split as the fleet metric.
Resultata: ${q.count}.`);
  assert.ok(
    Math.abs(q.cdfMedian - 0.5) < 0.03 && Math.abs(q.cdfLo - 0.05) < 0.02 && Math.abs(q.cdfHi - 0.95) < 0.02,
    `Replicata: integrate the drawn ${q.metric}/${q.key} density up to its stated median and CI endpoints.
Expectata: CDF(median) ~ 0.5, CDF(lo90) ~ 0.05, CDF(hi90) ~ 0.95 — displayed numbers are quantiles of the drawn curve.
Resultata: CDF(median=${q.median}) = ${q.cdfMedian.toFixed(3)}, CDF(lo90) = ${q.cdfLo.toFixed(3)}, CDF(hi90) = ${q.cdfHi.toFixed(3)}.`,
  );
}

// The scenario mixture restores the property that motivated it: Tesla's
// robotaxi-scope miles median sits with scenario A's mass (most of Tesla's
// weight), not in the no-man's-land (~32M) the single fat-tailed curve
// produced; the HW4 lane is dashed/conditional in the hundreds of millions.
// The band is read from MILES_FORECAST A itself (2026-09-26): the hardcoded
// [3.4M, 6.5M] of 2026-07-22 went stale when A was re-based on 2026-09-04
// and the median sat 3% under its ceiling with no regression. Since
// 2026-11-04 each component holds its parts (crashla.js, above
// TESLA_ROBOTAXI_SCENARIOS), A's one: its band.
const milesAComponent = JSON.parse(vm.runInContext(`JSON.stringify(__entry(MILES_FORECAST, "MILES_FORECAST", "Tesla").components.find(c => c.weight > 0.5))`, ctx));
assert.ok(Array.isArray(milesAComponent.parts) && milesAComponent.parts.length === 1,
  `Replicata: read Tesla's scenario-A component of MILES_FORECAST (the one weighing over 0.5).
Expectata: one part, A's band of cumulative miles.
Resultata: ${JSON.stringify(milesAComponent)}.`);
const milesA = {weight: milesAComponent.weight, ...milesAComponent.parts[0]};
const milesByKey = Object.fromEntries(quantileStats.filter(q => q.metric === "miles").map(q => [q.key, q]));
assert.ok(milesByKey.robotaxi.median > milesA.lo && milesByKey.robotaxi.median < milesA.hi && !milesByKey.robotaxi.dashed,
  `Replicata: read Tesla's robotaxi-scope cumulative-miles median.
Expectata: inside scenario A's band [${milesA.lo}, ${milesA.hi}] (A carries weight ${milesA.weight} of Tesla's mass) and drawn solid.
Resultata: ${JSON.stringify(milesByKey.robotaxi)}.`);

// (Sections 4c and 4d, Tesla's all-HW4 lane at or above its robotaxi lane at
// the three printed percentiles and at every whole percentile from the 5th to
// the 95th, are read by 4f since 2026-11-04.)

// --- 4e. Every lane is drawn as its own density, and each drawn from one
// band is drawn with one peak (2026-11-04) ----------------------------------
// The distribution chart (renderFleetForecastChart) samples each lane's
// density on one grid of points evenly spaced in ln x and draws the samples as
// a stroke, a fill under it and a median marker, in the frame its two
// month-axis lines draw. The chart's densities are read by keeping the curves
// each of its calls of fleetDistributionCurves builds (the builder wrapped for
// this check and restored after it, as selectedGrowthMetric is to the metric
// it held before the check), each lane's density wrapped to record the points
// the chart asks it for. The lanes are the curves of the last call whose
// curves the chart samples (each curve holding its ys, an array or a typed
// array; a call made for anything else, its legend say, holds none); the grid
// is the points every lane is asked for (each lane is also asked for its
// density at its median, for the scale and its marker), in ascending order,
// read against a reference lane, the lane at whose points the most lanes'
// samples are taken (the first such lane on a tie). The marks are read from
// the chart's own svg (chartOf: its legend aside), each as drawn (drawnPaint,
// above: its own and its ancestors' attributes and styles) and its geometry
// by property (props): the lanes' marks are the paths painted in a lane's
// colour (their stroke or their fill), a stroke a path drawn with no fill
// (its fill none or transparent) and a fill a path drawn with a fill, and a
// median marker a circle of class month-dot. Then, on every metric:
//   - each path painted in a lane's colour is clipped by fleet-clip (it or an
//     ancestor carrying clip-path url(#fleet-clip)) or by nothing (the
//     curves stay inside the frame by their scale, so a clip containing the
//     frame draws the picture no clip draws), never by another clip path;
//   - the chart draws one stroke, one fill and one median marker per lane;
//   - each stroke's path data is "M x y" and then "L x y" for each further
//     vertex (absolute commands, or a first "m", which SVG reads as
//     absolute; the two numbers of a vertex apart by SVG's comma-wsp, white
//     space (space, tab, line feed, carriage return or form feed), a comma,
//     or both, one comma at most), and each fill's the same, closed or not by
//     "Z";
//   - the frame is its month-axis lines (plotFrame), drawn to be seen and
//     under no transform, which the fleet-clip rectangle contains
//     (clipHoldsFrame, fleetClip); and no stroke, fill or median marker is
//     drawn under a transform;
//   - the grid has more than one point, as many as each stroke's points and
//     each lane's samples (a lane asked for fewer of the reference lane's
//     points than it holds samples is named), evenly spaced in ln x, and its
//     two ends lie past every lane's 5th and 95th percentiles (the chart
//     frames the lanes' 90% intervals, with a margin);
// and for every lane:
//   - its samples are its own density, as fleetDistributionCurves built it,
//     at the grid's points;
//   - with x mapped evenly in ln x from the grid's first point at the frame's
//     left edge to its last at the frame's right edge, and y linearly from 0
//     at the frame's bottom to DENSITY_HEADROOM times the tallest of every
//     lane's samples and densities at their medians at its top (the scale the
//     chart's comment states), each point of its stroke is its own density at
//     its grid point, to the path's 0.01 rounding; its fill is the polygon of
//     its stroke's points closed by the frame's bottom below the last of them
//     and below the first, its vertices read from any of them and in either
//     direction, a vertex written twice in a row read once, each to the same
//     rounding; and its median marker sits at its median and its density
//     there, to the same rounding;
//   - its stroke, fill and median marker come in the order of the lanes, each
//     in the lane's colour (the stroke's stroke, the fill's and the marker's
//     fill; colour, above) and drawn to be seen (shows, above: its opacity,
//     the product of its chain's, the stroke's stroke-opacity and
//     stroke-width and the fill's and the marker's fill-opacity positive
//     where given, no element of its chain with display none, its visibility
//     not hidden or collapse, and the marker's r positive), its stroke's
//     width given in the chart's markup where the stroke is drawn after a
//     median marker (whether it covers the marker is read from it), and its
//     fill drawn with no outline (no stroke, or one of width or opacity 0);
//   - its stroke is dashed (a stroke-dasharray whose lengths are none
//     negative and one positive) exactly when the lane is, and the lane is
//     dashed exactly when it is conditional (not mainline), as section 1's
//     HW4 curve is;
// and the marks are drawn in an order that leaves the picture the base
// draws: each stroke after every fill (two lanes' densities, each integrating
// to 1, cannot have one at or above the other wherever the other is positive
// unless they are the same density, so each lane's stroke runs inside every
// lane's fill somewhere, its own fill along its edge: a stroke drawn before a
// fill is drawn under it there), and each median marker after every stroke
// and fill its disc
// (r plus the 0.75 of its outline, style.css's .month-dot stroke-width 1.5)
// meets: a stroke when the marker's centre lies within that and half the
// stroke's width of the stroke's line (its points, read above), a fill when
// its centre lies inside the fill's polygon (even-odd) or within that of its
// edge.
// These checks read what the bullets above name, from the chart's markup
// alone, its tags read as HTML's tokenizer reads them (parse), its lengths a
// number or a number in px (userUnits), its opacities a number or a
// percentage, a path's data from its d attribute or a CSS d of path("..."),
// its dash lists apart by SVG's comma-wsp, and rgb() apart by commas
// throughout or white space throughout. Among what they do not read: what a
// stylesheet (style.css) sets (a stroke whose fill:none moves into a class
// there reads as a fill; the message says so);
// paint properties outside PAINT (a mask, a filter, a clip path other than
// fleet-clip, the paint order) and the clip path's children other than its
// rectangle; a CSS-wide keyword (inherit, initial, unset, revert) as a
// value other than a number's (a colour, a visibility); a colour in another
// notation (a name, hsl(), percentages, an alpha), compared as written; a fill or stroke of currentColor when no
// element of the chart gives a color; an <svg> nested in the chart, or a
// <use>; anything drawn over the marks; a median marker's outline (taken as
// style.css's) and a stroke's joins, caps and dashes in where it meets a
// marker (read as a band of its width along its line). Any transform fails
// here, even one that moves nothing, translate(0 0) say (this qual applies
// none; a transform of none, or an empty one, is read as none); so does a
// numeric paint value in a form NUMERIC does not read (a var(), a calc());
// path data in another syntax (relative commands, H, V, curves, numbers run
// together) fails as such; a path fleet-clip clips that is no lane's mark (a
// gridline drawn as a path inside the clip group) reads as an extra stroke or
// fill; and a stroke written from its right end to its left reads as off its
// density.
//
// Until the fifth fix run (2026-11-04) 4e read only the samples, matched each
// lane to its stroke by their point counts, and caught only a fault that
// changed the sign of a slope, so a stroke point drawn off its sample (the
// review's mutant STROKEY, Waymo's fleet point 125 drawn at half its sample)
// passed this qual and growth-charts, chart-targets, axis-ticks,
// fleet-timeseries and density-charts; so did a sample off its density that
// left the slope's signs as they were (WAYFLEET2, a 3% dent on the rising side
// of Waymo's fleet lane), and any sample fault on a lane 4e did not read for
// shape. From then until the sixth fix run (the same day) the drawing checks
// took the frame from the fleet-clip rectangle, compared each fill with one
// path string and read a marker's colour up to the closing quote, so three
// charts drawn correctly went red, each with a fault that was not there: a
// clip one unit wider than the plot (CLIP_WIDE), read as every lane's stroke,
// fill and median marker off the chart's scale; the fill's polygon written
// from another vertex (FILL_OTHERWAY); and a marker outlined in its own colour
// (MARK_OUTLINE). A clip that cuts the curves (CLIP_NARROW) read as stroke
// points off their densities, and a lane sampled off the others' grid
// (ZOOX_XSHIFT, the rides Zoox lane sampled at 1.005 times each point) as "0
// grid points from undefined to undefined" with every lane unframed. Until
// the sixth fix run's first review a mark was told a stroke or a fill, and its
// colour read, by the first declaration of its style, so the same marks with
// their declarations in another order, a space after a colon, or presentation
// attributes read as missing or in another colour, and a later declaration
// painting every stroke black passed; a fill closed by an explicit segment
// back to its first vertex read as another polygon; a chart that called
// fleetDistributionCurves a second time (for its legend, say) read as drawing
// curves without samples; and no check read the strokes' dashes, the marks'
// visibility, the clipping of the strokes and fills or the axes' meeting at
// the frame's corner (every lane dashed, or the dashes swapped, passed). In
// that run, before its review, a lane was named off the grid by its stroke's
// point count, so a stroke with one point too many named three lanes sampled
// on the grid, and the grid followed the first lane, so a first lane sampled
// off the others' points named the other three. Until its second review each
// mark's paint was read from its own attributes alone (drawnPaint, above); a
// path's vertices were read by splitting its data at spaces, keeping each
// vertex's first two numbers, so a stroke closed by " Z" (a segment from its
// last point back to its first) passed; the grid followed the order of the
// calls, so a chart that evaluated each density from the grid's right end to
// its left read as an uneven grid framing no lane; samples kept in a typed
// array read as no samples; a fill's outline, the axes' paint and the
// transforms on the marks were not read; and a dash array with a negative
// length (invalid, so drawn solid) read as dashed. Until its third review
// every path of the fragment was a lane's stroke or fill, so gridlines drawn
// as paths, or a legend with path swatches, read as more fills or strokes;
// every stroke and fill had to be clipped, where an unclipped path in a
// lane's colour is now named as such; a vertex's two numbers could be apart
// by any run of commas and white space, JavaScript's (a no-break space among
// it), so strokes the browser does not draw ("x,,y") passed; a first "m"
// read as malformed; the strokes' width and the order of fills, strokes and
// markers were not read here (section 1b required every marker after every
// path, which a marker drawn right after its own lane's stroke, over every
// curve it meets, broke), so fills drawn lane by lane over the earlier lanes'
// strokes passed.
//
// And each lane drawn from one band must rise then fall on the chart's grid:
// its slope changes sign once, from up to down, a step under a millionth of
// the lane's peak carrying the sign before it, as in section 3's count of
// sign changes (which runs on each lane's own grid of 600 points). One
// two-piece band has one peak; today the lanes drawn from one band are
// Waymo's rides and miles lanes and Zoox's on all three metrics. A lane drawn
// from several bands (Tesla's robotaxi lanes, A and B; its all-HW4 lanes, C
// on A and C on B; Waymo's fleet lane, base and plan) has the peaks its
// authored bands and weights give, so its shape is not read here: an
// authoring choice giving one of them a second hump is a correct forecast,
// as with the fleet's robotaxi lane, whose second hump section 4 stopped
// requiring on 2026-10-29 (the human's re-pin, B then a shoulder). Section 4
// still requires one sign change of the fleet's Waymo, Zoox and all-HW4
// lanes, on each lane's own grid. On today's tables (by the sign of each
// mixture's slope, however shallow the second hump) the robotaxi lanes have a
// second hump only for B's share of the lane (0.16 today) from about 0.34 to
// 0.63 on the fleet metric and from about 0.38 to 0.68 on miles, none on
// rides at any share up to 0.95, and the all-HW4 lanes none at any share from
// 0 to 0.95 (each C component the comonotonic sum of its two parts since
// later on 2026-11-04, as with the bands through their summed edges before;
// today's peaks near 58,200 car-equivalents, 481M miles and 24.2M rides). A
// lane's bands are its components' parts, counted (since that change; until
// then its components). On 2026-11-04 this first required one sign change of
// every drawn lane; later that day it read only the lanes drawn from one
// band, which left out Waymo's fleet lane, then those and the fleet lanes
// section 4 requires one peak of, then those and Tesla's rides and miles
// all-HW4 lanes, and since the sixth fix run only the lanes drawn from one
// band again.
let onePeakLanes;
{
  const drawn = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const build = fleetDistributionCurves;
    const shown = selectedGrowthMetric;
    let builds = [];
    fleetDistributionCurves = metric => {
      const curves = build(metric).map(c => {
        const own = c.densityFn, calls = [];
        return {...c, own, calls, densityFn: x => { calls.push(x); return own(x); }};
      });
      builds.push(curves);
      return curves;
    };
    try {
      return ["fleet", "rides", "miles"].map(metric => {
        selectedGrowthMetric = metric;
        builds = [];
        const svg = renderFleetForecastChart();
        return {metric, svg, builds: builds.map(curves => curves.map(c => ({label: c.legendLabel, color: c.color,
          dashed: c.dashed, mainline: c.mainline, bands: c.components.reduce((n, k) => n + k.parts.length, 0), median: c.median, lo90: c.lo90, hi90: c.hi90,
          ys: ArrayBuffer.isView(c.ys) ? Array.from(c.ys) : c.ys, calls: c.calls, ownAtCalls: c.calls.map(x => c.own(x)), ownAtMedian: c.own(c.median)})))};
      });
    } finally {
      fleetDistributionCurves = build;
      selectedGrowthMetric = shown;
    }
  })())`, ctx));
  const HEADROOM = vm.runInContext("DENSITY_HEADROOM", ctx);
  // A number as a path's data may write it, SVG's white space and comma-wsp,
  // and the path data this qual reads: "M x y" (or a first "m": SVG reads a
  // path's first moveto as absolute) and then "L x y" for each further
  // vertex, the two numbers of a vertex apart by comma-wsp, white space or
  // none around a command, a fill's closed or not by "Z" (or "z"); and a
  // path's vertices, each [x, y], read from data of that form.
  const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
  const SEP = `(?:${WS}+,?${WS}*|,${WS}*)`;
  const VERTICES = `${WS}*[Mm]${WS}*${NUM}${SEP}${NUM}(?:${WS}*L${WS}*${NUM}${SEP}${NUM})*`;
  const STROKE_D = new RegExp(`^${VERTICES}${WS}*$`), FILL_D = new RegExp(`^${VERTICES}(?:${WS}*[Zz])?${WS}*$`);
  // A path's data as drawn: a CSS d declaration in its style, path("<data>")
  // with either quote, which Chromium draws over the attribute, or else its d
  // attribute (a CSS d of another form the browser drops, as it does an
  // invalid declaration). Since 2026-11-07; until then the merged property
  // was read, so a stroke given its data as path("...") read as malformed.
  const CSS_PATH = new RegExp(`^path\\(${WS}*(["'])([^"']*)\\1${WS}*\\)$`);
  const pathData = el => {
    const css = props({attrs: Object.fromEntries(Object.entries(el.attrs).filter(([attr]) => attr === "style"))}, ["d"]).d;
    const m = css === undefined ? null : CSS_PATH.exec(css);
    return m === null ? `${el.attrs.d}` : m[2];
  };
  const vertices = d => {
    const vs = [...d.matchAll(new RegExp(NUM, "g"))].map(m => Number(m[0]));
    return Array.from({length: vs.length / 2}, (_, k) => [vs[2 * k], vs[2 * k + 1]]);
  };
  // A polygon's vertices with each one that sits on the next (cyclically)
  // left out, to the path's rounding, so a vertex written twice in a row (a
  // closing segment back to the first vertex, or a corner on the stroke's own
  // end point) is read once. Both sides of the comparison are the chart's
  // rounded coordinates (the fill's vertices, and the stroke's points with the
  // frame's bottom), so the same vertices merge on both.
  const merged = vs => vs.filter((v, k) => !(near(v[0], vs[(k + 1) % vs.length][0]) && near(v[1], vs[(k + 1) % vs.length][1])));
  // Whether the vertices got are the closed polygon want, read from any of
  // its vertices and in either direction, each coordinate to the path's
  // rounding.
  const sameCycle = (got, want) => got.length === want.length && [want, [...want].reverse()].some(w =>
    w.some((_, s) => got.every((p, k) => near(p[0], w[(s + k) % w.length][0]) && near(p[1], w[(s + k) % w.length][1]))));
  // Whether a stroke's drawn paint dashes it: a stroke-dasharray whose lengths
  // are none negative and one positive (a negative length makes the array
  // invalid, so the stroke is drawn solid, as with "none" or none given).
  const dashes = p => Object.entries(p).some(([prop, value]) => prop === "stroke-dasharray"
    && value.split(/[ \t\n\r\f,]+/).every(v => parseFloat(v) >= 0) && value.split(/[ \t\n\r\f,]+/).some(v => parseFloat(v) > 0));
  // Whether a fill's drawn paint outlines it: a stroke not none (nor
  // transparent), of width and opacity not 0.
  const outlines = p => !["none", "transparent", undefined].includes(p.stroke)
    && !(parseFloat(p["stroke-width"]) <= 0) && !(parseFloat(p["stroke-opacity"]) <= 0);
  // The segments of a polyline, each [from, to]; the distance from a point to
  // a segment (no segment here has length 0: a stroke's points step along x,
  // and a merged polygon's vertices each differ from the next); its distance
  // to the nearest of some segments; and whether a point lies inside the
  // polygon those segments close, by the even-odd rule (a ray from it to the
  // right crosses its edges an odd number of times).
  const segments = vs => vs.slice(1).map((v, k) => [vs[k], v]);
  const toSegment = ([x, y], [[ax, ay], [bx, by]]) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const distance = (p, segs) => Math.min(...segs.map(s => toSegment(p, s)));
  const inside = ([x, y], segs) => segs.filter(([[ax, ay], [bx, by]]) => (ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)).length % 2 === 1;
  // A median marker's outline beyond its radius: style.css's .month-dot
  // stroke-width 1.5, half of it outside.
  const HALO = 0.75;
  const DRAWN = {true: "dashed", false: "solid"}, SCOPE = {true: "mainline", false: "conditional"};
  const sampledLanes = [];
  for (const {metric, svg, builds} of drawn) {
    const chart = `the ${metric} distribution chart (renderFleetForecastChart)`;
    const drawing = chartOf(svg, chart);
    const paths = drawing.els.filter(el => el.name === "path").map(el => ({...el, paint: drawnPaint(el)}));
    const circles = drawing.els.filter(el => el.name === "circle");
    // The calls whose curves the chart sampled, each curve holding its ys (a
    // call made for anything else, its legend say, holds none); every call
    // builds the same curves, and the lanes are the last sampled call's.
    const sampled = builds.filter(curves => curves.length > 0 && curves.every(c => Array.isArray(c.ys)));
    assert.ok(sampled.length > 0,
      `Replicata: render ${chart} and keep the curves each of its calls of fleetDistributionCurves builds.
Expectata: a call whose curves all hold their samples (their ys, an array or a typed array): the lanes the chart draws.
Resultata: calls of fleetDistributionCurves: ${builds.length}, building ${JSON.stringify(builds.map(curves => curves.length))} curves, of them without samples ${JSON.stringify(builds.map(curves => curves.filter(c => !Array.isArray(c.ys)).map(c => c.label)))}.`);
    const lanes = sampled.at(-1);
    sampledLanes.push({metric, lanes});
    // The lanes' marks: the paths painted in a lane's colour (their stroke or
    // their fill), each clipped by fleet-clip (it or an ancestor carrying
    // clip-path url(#fleet-clip)) or by nothing: the curves stay inside the
    // frame by their scale (read below), so a clip that contains the frame
    // draws the same picture as none. A clip other than fleet-clip on one of
    // them, which this qual does not read, fails. Since 2026-11-07; until then
    // each had to be clipped by fleet-clip, so curves drawn with no clip at
    // all, pixel for pixel the picture of a clip one unit wider than the plot
    // (CLIP_WIDE, accepted), were red.
    const laneColours = lanes.map(l => colour(l.color));
    const curves = paths.filter(el => [el.paint.stroke, el.paint.fill].some(c => laneColours.includes(colour(c))));
    const otherClips = curves.filter(el => el.chain.some(a => ![undefined, "none"].includes(paint(a)["clip-path"]) && !FLEET_CLIP_URL.test(paint(a)["clip-path"])));
    assert.ok(otherClips.length === 0,
      `Replicata: render ${chart} and find what clips each path in its svg painted in a lane's colour (${JSON.stringify(lanes.map(l => l.color))}).
Expectata: each clipped by fleet-clip (it or an ancestor carrying clip-path url(#fleet-clip)) or by nothing (this qual reads no other clip).
Resultata: clipped otherwise: ${otherClips.map(el => `the path at ${el.at} (its data from ${printable(pathData(el).slice(0, 24))}), under ${JSON.stringify(el.chain.map(a => paint(a)["clip-path"]).filter(c => ![undefined, "none"].includes(c)))}`).join("; ")}.`);
    const strokes = curves.filter(el => ["none", "transparent"].includes(el.paint.fill)).map(el => ({...el, color: el.paint.stroke}));
    const fills = curves.filter(el => !["none", "transparent"].includes(el.paint.fill)).map(el => ({...el, color: el.paint.fill}));
    const markers = circles.filter(el => hasClass(el, "month-dot")).map(el => ({...el, paint: drawnPaint(el), geometry: props(el, ["cx", "cy", "r"])}))
      .map(el => ({...el, color: el.paint.fill, cx: userUnits(el.geometry.cx), cy: userUnits(el.geometry.cy), r: userUnits(el.geometry.r)}));
    assert.ok([strokes, fills, markers].every(marks => marks.length === lanes.length),
      `Replicata: render ${chart} and read its strokes, fills and median markers, each as drawn (its own and its ancestors' attributes and styles).
Expectata: among the paths painted in a lane's colour, one stroke (a path drawn with no fill: none or transparent) and one fill (a path drawn with a fill), and one median marker (a circle of class month-dot), for each of its ${lanes.length} lanes. This qual reads paint from the chart's markup alone (its attributes and styles): a fill, stroke or width a stylesheet (style.css) gives is not read, so a stroke whose fill:none a stylesheet gives reads here as a fill.
Resultata: of the ${paths.length} paths in its svg, ${curves.length} in a lane's colour: ${strokes.length} strokes and ${fills.length} fills; of the ${circles.length} circles, ${markers.length} markers.`);
    const malformed = [...strokes.map((el, i) => [`stroke ${i + 1}`, el, STROKE_D]), ...fills.map((el, i) => [`fill ${i + 1}`, el, FILL_D])]
      .filter(([, el, form]) => !form.test(pathData(el)));
    assert.ok(malformed.length === 0,
      `Replicata: render ${chart} and read its strokes' and fills' path data.
Expectata: "M x y" (or a first "m", absolute) and then "L x y" for each further vertex (absolute commands, the two numbers of a vertex apart by SVG's comma-wsp: white space (space, tab, line feed, carriage return, form feed), a comma, or both, one comma at most), a fill's closed or not by "Z" (or "z") and a stroke's not (a stroke closed by Z draws a segment from its last point back to its first).
Resultata: ${malformed.map(([what, el]) => `${what}'s, from ${printable(pathData(el).slice(0, 32))} to ${printable(pathData(el).slice(-32))}`).join("; ")}.`);
    const points = strokes.map(el => vertices(pathData(el))), fillVertices = fills.map(el => vertices(pathData(el)));
    const frame = plotFrame(chart, drawing.els);
    clipHoldsFrame(chart, drawing, frame);
    const {left, top, right, bottom} = frame;
    const width = right - left, height = bottom - top;
    const moved = [...strokes.map((el, i) => [`stroke ${i + 1}`, el]), ...fills.map((el, i) => [`fill ${i + 1}`, el]), ...markers.map((el, i) => [`marker ${i + 1}`, el])]
      .filter(([, el]) => el.paint.transforms.length > 0);
    assert.ok(moved.length === 0,
      `Replicata: render ${chart} and read the transforms on its strokes, fills and median markers and on their ancestors.
Expectata: none (this qual reads each mark's coordinates as written, applying no transform).
Resultata: ${moved.map(([what, el]) => `${what} under ${JSON.stringify(el.paint.transforms)}`).join("; ")}.`);
    // The grid: the points every lane's density was asked for, in ascending
    // order, read against the reference lane, the lane at whose points the
    // most lanes' samples were taken (the first such lane on a tie).
    // shared[r][i] is how many of the points lane r was asked for lane i was
    // also asked for; a lane's samples were taken at lane r's points when it
    // shares at least as many of them as it holds samples.
    const asked = lanes.map(l => new Set(l.calls));
    const shared = asked.map(r => asked.map(s => [...r].filter(x => s.has(x)).length));
    const holding = shared.map(row => row.filter((k, i) => k >= lanes[i].ys.length).length);
    const ref = holding.indexOf(Math.max(...holding));
    const grid = [...asked[ref]].filter(x => asked.every(s => s.has(x))).sort((a, b) => a - b);
    const n = grid.length;
    const offGrid = lanes.map((l, i) => [l.label, shared[ref][i], l.ys.length]).filter(([, k, samples]) => k < samples);
    assert.ok(n > 1 && offGrid.length === 0 && points.every(p => p.length === n) && lanes.every(l => l.ys.length === n),
      `Replicata: render ${chart} and record the points it asks each lane's density for.
Expectata: a grid (the points every lane is asked for) of more than one point, as many as each stroke's points and each lane's samples: no lane asked for fewer of the reference lane's points (the lane at whose points the most lanes are sampled) than it holds samples.
Resultata: ${n} grid points; stroke points ${JSON.stringify(points.map(p => p.length))}; samples ${JSON.stringify(lanes.map(l => l.ys.length))}; the reference lane ${lanes[ref].label}, asked for ${asked[ref].size} points, at which the samples of ${holding[ref]} of the ${lanes.length} lanes were taken; the lanes sampled off its points, each as [lane, how many of those points the lane was asked for, the lane's samples]: ${JSON.stringify(offGrid)}.`);
    const span = Math.log(grid[n - 1]) - Math.log(grid[0]), step = span / (n - 1);
    const uneven = grid.slice(1).map((x, i) => i).filter(i => !(Math.abs(Math.log(grid[i + 1]) - Math.log(grid[i]) - step) <= 1e-9 * step));
    const unframed = lanes.filter(l => !(grid[0] < l.lo90 && l.hi90 < grid[n - 1]));
    // Not finite: a sample, or the lane's own density at a point it was asked for or at its median.
    const nonFinite = lanes.filter(l => ![...l.ys, ...l.ownAtCalls, l.ownAtMedian].every(Number.isFinite));
    assert.ok(uneven.length === 0 && unframed.length === 0 && nonFinite.length === 0,
      `Replicata: render ${chart} and record the points it asks each lane's density for.
Expectata: the grid (the points every lane is asked for, in ascending order) evenly spaced in ln x, its ends past every lane's 5th and 95th percentiles; every sample, and each lane's own density at each point it was asked for and at its median, finite.
Resultata: ${n} grid points from ${grid[0]} to ${grid[n - 1]}; uneven steps after points ${JSON.stringify(uneven.slice(0, 10))}; lanes whose 5th-95th percentiles reach past the grid ${JSON.stringify(unframed.map(l => [l.label, l.lo90, l.hi90]))}; lanes with a value not finite ${JSON.stringify(nonFinite.map(l => l.label))}.`);
    // Each lane's own density at the grid's points, from its recorded calls.
    const own = lanes.map(l => grid.map(x => l.ownAtCalls[l.calls.indexOf(x)]));
    const yMax = Math.max(...lanes.flatMap((l, i) => [...own[i], l.ownAtMedian]));
    const mapX = x => left + (Math.log(x) - Math.log(grid[0])) / span * width;
    const mapY = y => top + height * (1 - y / (yMax * HEADROOM));
    // Each fill's polygon as the checks below read it: its stroke's points
    // closed by the frame's bottom below the last of them and below the first.
    const polygons = points.map(pts => [...pts, [pts[n - 1][0], bottom], [pts[0][0], bottom]]);
    const problems = [];
    lanes.forEach((l, i) => {
      const peak = Math.max(...own[i]);
      const offSamples = own[i].map((y, j) => j).filter(j => !(Math.abs(l.ys[j] - own[i][j]) <= 1e-9 * Math.abs(own[i][j]) + 1e-15 * peak));
      if (offSamples.length > 0) problems.push(`${l.label}: samples off its density at grid points ${JSON.stringify(offSamples.slice(0, 5))} (first: ${l.ys[offSamples[0]]} against ${own[i][offSamples[0]]})`);
      const stroke = strokes[i], fill = fills[i], marker = markers[i], pts = points[i];
      for (const [what, mark, positive] of [["stroke", stroke, ["opacity", "stroke-opacity", "stroke-width"]],
        ["fill", fill, ["opacity", "fill-opacity"]], ["marker", marker, ["opacity", "fill-opacity"]]]) {
        if (colour(mark.color) !== colour(l.color)) problems.push(`${l.label}: ${what} ${i + 1} in ${mark.color}, the lane's colour ${l.color}`);
        if (!shows(mark.paint, positive)) problems.push(`${l.label}: ${what} ${i + 1} not drawn to be seen (drawn with ${JSON.stringify(mark.paint)})`);
      }
      // A stroke drawn after a median marker needs its width in the markup:
      // whether it covers the marker is read from it (this qual reads no
      // stylesheet). Since 2026-11-07; until then every stroke needed one, so
      // a width style.css gives every stroke, drawn the same, was red.
      if (!("stroke-width" in stroke.paint) && markers.some(m => m.at < stroke.end))
        problems.push(`${l.label}: stroke ${i + 1}, drawn after a median marker, given no stroke-width in the chart's markup (this qual reads none from a stylesheet; whether it covers the marker is read from it)`);
      if (outlines(fill.paint)) problems.push(`${l.label}: fill ${i + 1} outlined (its stroke ${JSON.stringify({stroke: fill.paint.stroke, "stroke-width": fill.paint["stroke-width"], "stroke-opacity": fill.paint["stroke-opacity"]})})`);
      if (!(marker.r > 0)) problems.push(`${l.label}: marker ${i + 1} of radius ${marker.r}`);
      if (dashes(stroke.paint) !== l.dashed) problems.push(`${l.label}: stroke ${i + 1} drawn ${DRAWN[dashes(stroke.paint)]} by the chart's markup (a dash a stylesheet gives is not read), the lane ${DRAWN[l.dashed]}`);
      if (l.dashed === l.mainline) problems.push(`${l.label}: a ${SCOPE[l.mainline]} lane, ${DRAWN[l.dashed]}`);
      const offPoints = pts.map((p, j) => j).filter(j => !(near(pts[j][0], mapX(grid[j])) && near(pts[j][1], mapY(own[i][j]))));
      if (offPoints.length > 0) {
        const j = offPoints[0];
        problems.push(`${l.label}: stroke points ${JSON.stringify(offPoints.slice(0, 5))} off the lane's density (first: (${pts[j].join(", ")}) against (${num(mapX(grid[j]))}, ${num(mapY(own[i][j]))}))`);
      }
      const got = merged(fillVertices[i]), want = merged(polygons[i]);
      if (!sameCycle(got, want)) {
        problems.push(`${l.label}: its fill's ${fillVertices[i].length} vertices (${got.length} with each written twice in a row read once; the first (${fillVertices[i][0].join(", ")})) are not, from any of them in either direction, its stroke's ${n} points closed by (${polygons[i][n].join(", ")}) and (${polygons[i][n + 1].join(", ")}) on the frame's bottom (${want.length} vertices, read the same way)`);
      }
      if (!(near(marker.cx, mapX(l.median)) && near(marker.cy, mapY(l.ownAtMedian)))) {
        problems.push(`${l.label}: median marker at (${marker.cx}, ${marker.cy}) against its median and its density there (${num(mapX(l.median))}, ${num(mapY(l.ownAtMedian))})`);
      }
    });
    assert.ok(problems.length === 0,
      `Replicata: render ${chart}, keep the curves it builds and record the points it asks each lane's density for, then compare each lane's samples, stroke, fill and median marker with its own density.
Expectata: for every lane, its samples are its own density at the grid's points, and, with x evenly in ln x from the grid's first point at the frame's left edge (${left}) to its last at the right edge (${right}) and y linear from 0 at the frame's bottom (${bottom}) to DENSITY_HEADROOM (${HEADROOM}) times the tallest sample or median density of any lane (${yMax}) at its top (${top}), its stroke's points are its density at the grid points, its fill is the polygon of its stroke's points closed by the frame's bottom below the last and the first (its vertices read from any of them in either direction, a vertex written twice in a row read once), and its median marker sits at its median and its density there, each to the path's 0.01 rounding; strokes, fills and markers in the order of the lanes, each in its lane's colour (#rgb, #rrggbb and rgb() alike, letter case aside) and drawn to be seen (as drawn, from its own and its ancestors' attributes and styles: opacity, the product of its chain's, and stroke-opacity, stroke-width and fill-opacity positive where given, no display none in its chain, visibility not hidden or collapse, a marker's r positive), each stroke's width given in the chart's markup, each fill drawn with no outline; each stroke dashed (a dash array of no negative length and one positive) exactly when its lane is, and each lane dashed exactly when it is conditional (not mainline).
Resultata: ${problems.join("; ")}.`);
    // The order the marks are drawn in: each stroke after every fill, and
    // each median marker after every stroke and fill its disc meets, read on
    // the geometry the checks above have read (each stroke's line its points;
    // each fill's polygon those closed by the frame's bottom, merged).
    const lines = points.map(segments);
    const edges = polygons.map(merged).map(vs => segments([...vs, vs[0]]));
    const halfWidths = strokes.map(el => userUnits(el.paint["stroke-width"]) / 2);
    const underFills = strokes.flatMap((s, k) => fills.map((f, j) => [j, f]).filter(([, f]) => s.at < f.end)
      .map(([j]) => `stroke ${k + 1} (${lanes[k].label}) drawn before fill ${j + 1} (${lanes[j].label}) ends`));
    const underCurves = markers.flatMap((m, i) => [
      ...strokes.map((s, k) => [`stroke ${k + 1} (${lanes[k].label})`, s, distance([m.cx, m.cy], lines[k]) < m.r + HALO + halfWidths[k]]),
      ...fills.map((f, j) => [`fill ${j + 1} (${lanes[j].label})`, f, inside([m.cx, m.cy], edges[j]) || distance([m.cx, m.cy], edges[j]) < m.r + HALO]),
    ].filter(([, el, meets]) => meets && m.at < el.end).map(([what]) => `marker ${i + 1} (${lanes[i].label}) drawn before ${what} ends, which its disc meets`));
    assert.ok(underFills.length === 0 && underCurves.length === 0,
      `Replicata: render ${chart} and read the order its markup draws its strokes, fills and median markers in (the order SVG paints them in), with the curves' geometry read above.
Expectata: each stroke drawn after every fill (each stroke runs inside every fill somewhere, so a stroke drawn first lies under that fill there), and each median marker after every stroke and fill its disc (r plus the 0.75 of its outline) meets: a stroke whose line passes within that and half the stroke's width of its centre, a fill whose polygon holds its centre or whose edge passes within that of it.
Resultata: ${[...underFills, ...underCurves].join("; ")}.`);
  }
  // The slope's runs on the grid: a new run starts where a step's sign
  // differs from the run before it; a step under a millionth of the lane's
  // peak carries the run before it.
  const slopeRuns = ys => {
    const peak = Math.max(...ys);
    const runs = [];
    for (let i = 1; i < ys.length; i++) {
      const step = ys[i] - ys[i - 1];
      if (Math.abs(step) < peak * 1e-6) continue;
      if (runs.length === 0 || runs.at(-1).sign !== Math.sign(step)) runs.push({sign: Math.sign(step), from: i});
    }
    return runs;
  };
  const SLOPE = {"1": "up", "-1": "down", "0": "flat"};
  const all = sampledLanes.flatMap(({metric, lanes}) => lanes.map(lane => ({metric, label: lane.label, bands: lane.bands, ys: lane.ys})));
  const read = all.filter(l => l.bands === 1).map(l => ({...l, points: l.ys.length, runs: slopeRuns(l.ys)}));
  const skipped = all.filter(l => l.bands !== 1);
  onePeakLanes = read.length;
  const failing = read.filter(l => !(l.runs.length === 2 && l.runs[0].sign === 1 && l.runs[1].sign === -1));
  assert.ok(failing.length === 0,
    `Replicata: render the growth section's distribution chart (renderFleetForecastChart) for the fleet, rides and miles metrics, and read each drawn lane's density on the chart's grid (the curves the chart builds).
Expectata: each of the ${read.length} lanes drawn from one band (${read.map(l => `${l.metric} ${l.label}`).join(", ")}) rises then falls on that grid: its slope changes sign once, from up to down, a step under a millionth of the lane's peak carrying the sign before it. The ${skipped.length} other lanes (${skipped.map(l => `${l.metric} ${l.label}`).join(", ")}), each drawn from several bands, are not read for shape.
Resultata: ${failing.map(l => `${l.metric} ${l.label}: ${l.runs.map(r => `${SLOPE[r.sign]} from grid point ${r.from}`).join(", ")} (of ${l.points})`).join("; ")}.`);
}

// --- 4f. Tesla's all-HW4 lane contains its robotaxi lane at every tenth of
// a percentile (2026-10-30; exactly since 2026-11-04) -----------------------
// Scenario C is Tesla's whole ADS service in that world: the robotaxi's own
// cars, miles and rides plus eyes-off driving on customer HW4 cars (the
// human's decision, 2026-10-30, which the comments' own definitions require),
// on the robotaxi lane's own A/B mix since 2026-11-03, and since 2026-11-04
// each C component the comonotonic sum of its robotaxi scenario's band and
// the eyes-off band (the human's "Hold exactly"; crashla.js, above
// TESLA_ROBOTAXI_SCENARIOS; quals/forecast-sum.qual.mjs checks the sum). So
// each C component's quantiles sit above its scenario's at every level, and
// the two lanes share the scenarios' weights: the all-HW4 lane, drawn as a
// fork from Tesla's own history line, must sit at or above the robotaxi lane
// at every tenth of a percentile from the 0.1st to the 99.9th on every
// metric, by the quantile function the charts use (bandMixtureQuantiles),
// with no allowance; each lane's printed 5th percentile, median and 95th
// percentile (fleetDistributionCurves' lo90, median and hi90) must be its
// quantiles there, within a billionth (relative), so the printed figures are
// among those read; and the all-HW4 lane's printed figures must sit at or
// above the robotaxi lane's, with no allowance. The printed figures come
// from a call of bandMixtureQuantiles at those three levels, the quantiles
// read here from one at 999, and each is solved to within 1e-12 of ln x's
// scale, 1 + |ln x|, of the root (crashla.js, solveIncreasing), at most
// about 2.3e-11 relative here (the farthest of the printed figures from an
// mpmath computation, 1.8e-11 at the sixth fix run's first review,
// 2026-11-04, and 1.3e-11 since its second, 2026-11-05), so a correct
// solver may reach them by different paths, its last bits apart (the first
// review found a warm-started solve 1.8e-11 apart, an exact tie red on it);
// a printed figure read at another level, 0.9500001 for 0.95, is 1e-6
// apart.
// Until 2026-11-04 three sections read the rule, each C component then one
// two-piece band through its two parts' summed edges, whose low side ran
// under the robotaxi lane's below about the 3rd percentile (miles 2.8%,
// rides 2.7%, the fleet under 0.001%): 4c at the three printed percentiles,
// 4d at every whole percentile from the 5th to the 95th, and 4f at every
// tenth of one from the 4th to the 99.9th. Until 2026-10-31 the all-HW4 lane
// sat under the robotaxi lane at the printed percentiles, for rides (median
// 16.7M against 20.0M, 5th percentile 2.08M against 7.33M) and miles (5th
// percentile 16.8M against 60.2M): its rides had kept the Jan-1-2027
// forecast's numbers, and its miles counted customer cars alone.
{
  const ps = Array.from({length: 999}, (_, i) => (i + 1) / 1000);
  const PRINTED = [[0.05, "lo90"], [0.5, "median"], [0.95, "hi90"]];
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(["fleet", "rides", "miles"].map(metric => ({metric,
    lanes: Object.fromEntries(fleetDistributionCurves(metric).filter(c => c.historyHelmer === "Tesla")
      .map(c => [c.key, {lo90: c.lo90, median: c.median, hi90: c.hi90, q: bandMixtureQuantiles(c.components, ${JSON.stringify(ps)})}]))})))`, ctx));
  const pct = p => `${(100 * p).toFixed(1)}%`;
  // Runs of consecutive grid points, printed as their spans of percentiles.
  const spans = idx => idx.reduce((runs, i) => {
    if (runs.length > 0 && runs.at(-1)[1] === i - 1) runs.at(-1)[1] = i;
    else runs.push([i, i]);
    return runs;
  }, []).map(([a, b]) => `${pct(ps[a])} to ${pct(ps[b])}`).join(", ");
  const TIE = 1e-9; // a printed figure's distance from its quantile, relative
  const below = [], unprinted = [];
  for (const {metric, lanes: tesla} of lanes) {
    assert.ok(["robotaxi", "hw4"].every(key => key in tesla && tesla[key].q.length === ps.length),
      `Replicata: build Tesla's ${metric} forecast lanes and read their quantiles at ${ps.length} percentiles (bandMixtureQuantiles).
Expectata: a robotaxi lane and an all-HW4 lane, ${ps.length} quantiles each.
Resultata: quantiles per lane ${JSON.stringify(Object.fromEntries(Object.entries(tesla).map(([key, l]) => [key, l.q.length])))}.`);
    const {robotaxi, hw4} = tesla;
    for (const [key, lane] of [["robotaxi", robotaxi], ["hw4", hw4]]) {
      for (const [p, field] of PRINTED) {
        const q = lane.q[ps.indexOf(p)];
        if (!(Math.abs(lane[field] / q - 1) <= TIE)) unprinted.push(`${metric} ${key}: printed ${field} ${lane[field]} against its quantile at ${p}, ${q} (x${lane[field] / q})`);
      }
    }
    for (const [p, field] of PRINTED) {
      if (!(hw4[field] >= robotaxi[field])) below.push(`${metric}: printed ${field} (${pct(p)}), all-HW4 ${hw4[field]} against robotaxi ${robotaxi[field]}`);
    }
    const under = ps.map((_, i) => i).filter(i => !(hw4.q[i] >= robotaxi.q[i]));
    if (under.length > 0) {
      const farthest = under.reduce((a, i) => (hw4.q[i] / robotaxi.q[i] < hw4.q[a] / robotaxi.q[a] ? i : a));
      below.push(`${metric}: under at ${under.length} of ${ps.length} percentiles (${spans(under)}), farthest at ${pct(ps[farthest])}: all-HW4 ${Math.round(hw4.q[farthest]).toLocaleString("en-US")} against robotaxi ${Math.round(robotaxi.q[farthest]).toLocaleString("en-US")}`);
    }
  }
  assert.ok(below.length === 0 && unprinted.length === 0,
    `Replicata: build Tesla's robotaxi and all-HW4 lanes for the fleet, rides and miles forecasts and read each lane's quantiles at every tenth of a percentile from the 0.1st to the 99.9th (bandMixtureQuantiles), and its printed 5th percentile, median and 95th percentile (fleetDistributionCurves).
Expectata: at each, the all-HW4 lane's at or above the robotaxi lane's, with no allowance; each lane's printed figures its quantiles at 0.05, 0.5 and 0.95 within ${TIE} (relative); and the all-HW4 lane's printed figures at or above the robotaxi lane's, with no allowance.
Resultata: ${[...below, ...unprinted].join("; ")}.`);
}

// No FLEET lane may put 5% of its mass below the LAST OBSERVED floor of its
// helmer, nor its median below the last observed best.
// Tesla's robotaxi lane broke this until 2026-09-26: FLEET_HISTORY's 2026-08
// row (150 [90, 220]) re-based the miles scenarios on 2026-09-04 but not the
// fleet scenario A, which still sat on the mid-2026 ~25-28-car anchor (median
// 180, 5th percentile 79 < 90). The rule held for Tesla alone until
// 2026-10-03, when Zoox's June setting (median 150, sigma 0.45) still put its
// 5th percentile at 72 under a fleet observed at 100 [80, 130] (audit #19).
// Every lane is checked, Tesla's all-HW4 fork against Tesla's history.
{
  const forecastDate = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
  const lanes = JSON.parse(vm.runInContext(`JSON.stringify(fleetDistributionCurves("fleet").map(c => ({
    label: c.legendLabel, helmer: c.historyHelmer, lo90: c.lo90, median: c.median,
    last: FLEET_HISTORY[c.historyHelmer].at(-1)})))`, ctx));
  const below = lanes.filter(l => !(l.lo90 >= l.last.lo && l.median >= l.last.best));
  assert.ok(lanes.length === 4 && below.length === 0,
    `Replicata: compare each fleet lane's forecast for ${forecastDate} with its helmer's latest FLEET_HISTORY observation.
Expectata: in all 4 lanes, 5th percentile >= the observed low edge and median >= the observed best.
Resultata: ${below.map(l => `${l.label}: lo90 ${Math.round(l.lo90)}, median ${Math.round(l.median)} vs ${l.last.month} ${l.last.best} [${l.last.lo}, ${l.last.hi}]`).join("; ")}.`);
}

// Each fleet history runs as far as the evidence the repo holds (audit #87,
// #19): Waymo said "more than 4,000 vehicles" on Sep 1, 2026 (TechCrunch;
// data/vmt.csv's 2026-07..09 Waymo rationales), and Zoox had "about 100
// custom-built robotaxis ... spread across four U.S. cities" on Sep 17, 2026
// (TechCrunch), after recall 26E044000 covered 105 units, its whole deployed
// driverless fleet, on Jul 10. Until 2026-10-03 the histories stopped at
// 2026-05 (Waymo, 3,750) and 2026-06 (Zoox, 100). A stock counted on Sep 1
// or Sep 17 sits at the 2026-09 step, as the fleet forecast sits at its
// date's month (GROWTH_FORECAST_DATE's).
{
  const hist = JSON.parse(vm.runInContext(`JSON.stringify(FLEET_HISTORY)`, ctx));
  const at = (helmer, month) => hist[helmer].find(r => r.month === month);
  const waymo = at("Waymo", "2026-09"), zoox = at("Zoox", "2026-09");
  const problems = [];
  if (!(waymo && waymo.lo >= 4000)) problems.push(`Waymo 2026-09: ${JSON.stringify(waymo)}, want a row whose low edge is at least 4,000 ("more than 4,000 vehicles")`);
  if (!(zoox && zoox.lo <= 100 && 105 <= zoox.hi)) problems.push(`Zoox 2026-09: ${JSON.stringify(zoox)}, want a row whose range holds "about 100" and the Jul-10 recall's 105`);
  for (const helmer of ["Waymo", "Zoox"]) {
    if (hist[helmer].at(-1).month < "2026-09") problems.push(`${helmer}'s history ends at ${hist[helmer].at(-1).month}`);
  }
  assert.ok(problems.length === 0,
    `Replicata: read FLEET_HISTORY's last Waymo and Zoox rows.
Expectata: both run through 2026-09, on the Sep-1 Waymo and Sep-17 Zoox fleet statements.
Resultata: ${problems.join("; ")}.`);
}
assert.ok(milesByKey.hw4.median > 150000000 && milesByKey.hw4.dashed,
  `Replicata: read Tesla's HW4-scope cumulative-miles curve.
Expectata: median past 150M and drawn dashed (conditional scenario).
Resultata: ${JSON.stringify(milesByKey.hw4)}.`);

// The trajectory chart's miles/rides forecast endpoints must carry the same
// computed quantiles (its tooltip also says "Median:").
const laneEnds = vm.runInContext(`
(() => {
  const out = [];
  for (const metric of ["miles", "rides"]) {
    const curves = Object.fromEntries(fleetDistributionCurves(metric).map(c => [c.legendLabel, c]));
    for (const lane of growthMetricSpec(metric).lanes()) {
      const fc = lane.points[lane.points.length - 1];
      const c = curves[lane.label];
      out.push({metric, label: lane.label, fcBest: fc.best, fcLo: fc.lo, fcHi: fc.hi,
        median: c.median, lo90: c.lo90, hi90: c.hi90});
    }
  }
  return out;
})()
`, ctx);

for (const l of laneEnds) {
  assert.ok(
    l.fcBest === l.median && l.fcLo === l.lo90 && l.fcHi === l.hi90,
    `Replicata: compare the ${l.metric}/${l.label} trajectory forecast endpoint to the distribution curve's quantiles.
Expectata: identical (both charts show the same median + 90% CI).
Resultata: endpoint {${l.fcBest}, ${l.fcLo}, ${l.fcHi}} vs quantiles {${l.median}, ${l.lo90}, ${l.hi90}}.`,
  );
}

// --- 5. Anti-Postel: malformed forecast weights crash loudly, not silently ---

let threw = false;
try {
  vm.runInContext(`
    const saved = FLEET_FORECAST[1].components[0].weight;
    FLEET_FORECAST[1].components[0].weight = 0.9; // Waymo no longer sums to 1
    try { fleetForecastCurves(); } finally { FLEET_FORECAST[1].components[0].weight = saved; }
  `, ctx);
} catch (_e) {
  threw = true;
}
assert.ok(
  threw,
  `Replicata: corrupt a helmer's mixture weights so they no longer sum to 1, then build the curves.
Expectata: immediate throw (the weights are a hard invariant).
Resultata: no throw.`,
);

console.log(`qual pass: fleet forecast draws four normalized curves; Tesla split into its robotaxi and all-HW4-ADS scopes; on every metric every lane is drawn as its own density on the chart's grid and scale (its samples, stroke, fill and median marker, each in its lane's colour and, as its own and its ancestors' attributes and styles paint it, drawn to be seen and under no transform, its fill unoutlined and its stroke dashed exactly when the lane is conditional) in the frame of its month-axis lines, which meet at its corner and which its clip rectangle contains, its strokes and fills clipped by it or by nothing, each stroke drawn over every fill and each median marker, unclipped, over every stroke and fill it meets, and its hit circles over the markers, and the ${onePeakLanes} lanes drawn from one band rise then fall on that grid; Tesla's all-HW4 lane sits at or above its robotaxi lane at every tenth of a percentile from the 0.1st to the 99.9th and at its printed percentiles, each lane's printed percentiles its quantiles to a billionth`);

// --- Tesla's rides scenarios are the miles scenarios over the ride corridor -
// RIDES_FORECAST Tesla A stayed at the 2026-07-22 miles figures when
// MILES_FORECAST A was re-based on 2026-09-04; the two tables are now tied in
// code, so a miles re-base moves rides with it. Since 2026-11-04 each
// component holds its parts, a robotaxi component one: its band.
{
  const d = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const m = __entry(MILES_FORECAST, "MILES_FORECAST", "Tesla").components.filter(c => c.scope === "robotaxi");
    const r = __entry(RIDES_FORECAST, "RIDES_FORECAST", "Tesla").components.filter(c => c.scope === "robotaxi");
    return {m, r, corridor: TESLA_MILES_PER_RIDE};
  })())`, ctx));
  assert.ok(d.m.length === 2 && d.r.length === 2 && [...d.m, ...d.r].every(c => Array.isArray(c.parts) && c.parts.length === 1),
    `Replicata: read the robotaxi-scope Tesla components of MILES_FORECAST and RIDES_FORECAST.
Expectata: two each (A and B), each of one part, its band.
Resultata: ${JSON.stringify(d.m)} / ${JSON.stringify(d.r)}.`);
  d.m.map(c => ({weight: c.weight, ...c.parts[0]})).forEach((mc, i) => {
    const rc = {weight: d.r[i].weight, ...d.r[i].parts[0]};
    const want = { best: mc.best / d.corridor.best, lo: mc.lo / d.corridor.hi, hi: mc.hi / d.corridor.lo };
    assert.ok(rc.weight === mc.weight && ["best", "lo", "hi"].every(k => Math.abs(rc[k] - want[k]) / want[k] < 1e-9),
      `Replicata: divide Tesla miles scenario ${i === 0 ? "A" : "B"} {${mc.best}, ${mc.lo}, ${mc.hi}} by the [${d.corridor.lo}, ${d.corridor.best}, ${d.corridor.hi}] miles-per-ride corridor.
Expectata: the rides scenario {${want.best}, ${want.lo}, ${want.hi}} with the same weight.
Resultata: {${rc.best}, ${rc.lo}, ${rc.hi}} weight ${rc.weight}.`);
  });
}

// --- Tesla's scenario C is the robotaxi lane's own mix plus eyes-off driving ---
// (the human's decisions, 2026-10-30, 2026-11-03 and 2026-11-04.) C is
// Tesla's whole ADS service in that world: the robotaxi lane's own scenarios,
// A or B at their relative weights, each plus eyes-off driving on customer
// HW4 cars (crashla.js TESLA_EYES_OFF), quantile by quantile: the
// comonotonic sum of the two, taken as moving together (the human's "Hold
// exactly", 2026-11-04; quals/forecast-sum.qual.mjs checks the sum's
// quantiles). Every forecast component holds its parts, the two-piece bands
// it is the comonotonic sum of. So each table's Tesla components are its
// robotaxi components, each of one part, its scenario's band in the table's
// unit, and one C component (scope "hw4") per robotaxi scenario, weighted
// TESLA_EYES_OFF.weight times that scenario's share of the robotaxi weights,
// whose two parts are that scenario's own robotaxi band in the same table and
// the eyes-off band (in either order): C contains the robotaxi lane by
// construction. The fleet table's robotaxi bands are
// TESLA_ROBOTAXI_SCENARIOS' daily miles over TESLA_MILES_PER_CAR_DAY
// (car-equivalents, the unit of Tesla's line), the miles table's their
// cumulative miles on teslaCumulativeMiles' path and the rides table's those
// over the corridor (teslaRidesBand; until 2026-11-04 this read the fleet
// table's alone), and the fleet's eyes-off band the eyes-off cars times their
// miles a car-day over the same rate; the miles table's eyes-off band is the
// customer cars' cumulative eyes-off miles, the rides table's the
// Tesla-Network rides on them (cumulative x TESLA_EYES_OFF.ridesPerMile).
// From 2026-11-03 to 2026-11-04 each C
// component was one band, its scenario's robotaxi band plus the eyes-off band
// edge by edge, and this read each C component less the eyes-off band as a
// distinct robotaxi scenario's band; from 2026-10-31 to 2026-11-03 C was one
// component per table, scenario A's robotaxi band alone plus the eyes-off
// part (open question 30); until 2026-10-31 C counted distinct customer cars,
// its miles left out the robotaxi's, and its rides kept the Jan-1-2027
// forecast's.
{
  const d = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const comps = (t, name) => __entry(t, name, "Tesla").components;
    return {fleet: comps(FLEET_FORECAST, "FLEET_FORECAST"), miles: comps(MILES_FORECAST, "MILES_FORECAST"), rides: comps(RIDES_FORECAST, "RIDES_FORECAST"),
      daily: TESLA_ROBOTAXI_SCENARIOS, eyesOff: TESLA_EYES_OFF, perCarDay: TESLA_MILES_PER_CAR_DAY,
      // Each robotaxi scenario's band in each table's unit: the fleet's its
      // daily miles over TESLA_MILES_PER_CAR_DAY, the miles' its cumulative
      // miles on teslaCumulativeMiles' path, the rides' those over the
      // corridor (teslaRidesBand).
      want: {
        fleet: TESLA_ROBOTAXI_SCENARIOS.map(s => ({best: s.best / TESLA_MILES_PER_CAR_DAY, lo: s.lo / TESLA_MILES_PER_CAR_DAY, hi: s.hi / TESLA_MILES_PER_CAR_DAY})),
        miles: TESLA_ROBOTAXI_SCENARIOS.map(s => teslaCumulativeMiles(s)),
        rides: TESLA_ROBOTAXI_SCENARIOS.map(s => teslaRidesBand(teslaCumulativeMiles(s))),
      }};
  })())`, ctx));
  const EDGES = ["best", "lo", "hi"];
  const close = (x, y) => Math.abs(x - y) <= 1e-9 * Math.abs(y);
  const sameBand = (a, b) => EDGES.every(k => close(a[k], b[k]));
  const eyesOffBand = {
    fleet: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cars[k] * d.eyesOff.milesPerCarDay[k] / d.perCarDay])),
    miles: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cumulative[k]])),
    rides: Object.fromEntries(EDGES.map(k => [k, d.eyesOff.cumulative[k] * d.eyesOff.ridesPerMile])),
  };
  const problems = [];
  // The eyes-off band is a band of positive figures, so each C component's
  // quantiles sit above its robotaxi band's at every level.
  for (const metric of ["fleet", "miles", "rides"]) {
    const e = eyesOffBand[metric];
    if (!(0 < e.lo && e.lo <= e.best && e.best <= e.hi)) problems.push(`${metric}: the eyes-off band ${JSON.stringify(e)} is not 0 < lo <= best <= hi`);
  }
  for (const metric of ["fleet", "miles", "rides"]) {
    const robotaxi = d[metric].filter(c => c.scope === "robotaxi"), cs = d[metric].filter(c => c.scope === "hw4");
    const partless = [...robotaxi, ...cs].filter(c => !Array.isArray(c.parts));
    if (partless.length > 0) {
      problems.push(`${metric}: components with no parts ${JSON.stringify(partless)}`);
      continue;
    }
    // The robotaxi components, one per scenario in TESLA_ROBOTAXI_SCENARIOS'
    // order at its weight, each of one part, the scenario's band in the
    // table's unit.
    if (robotaxi.length !== d.daily.length || d.daily.some((s, i) => robotaxi[i].weight !== s.weight
      || robotaxi[i].parts.length !== 1 || !sameBand(robotaxi[i].parts[0], d.want[metric][i])))
      problems.push(`${metric}: robotaxi components ${JSON.stringify(robotaxi)}; want one of one part per scenario of TESLA_ROBOTAXI_SCENARIOS ${JSON.stringify(d.daily)}, at its weight, its band ${JSON.stringify(d.want[metric])}`);
    const robotaxiBands = robotaxi.map(c => c.parts[0]);
    const robotaxiWeight = robotaxi.reduce((s, c) => s + c.weight, 0);
    if (cs.length !== robotaxi.length) problems.push(`${metric}: ${cs.length} C components for ${robotaxi.length} robotaxi scenarios`);
    const matched = new Set();
    for (const c of cs) {
      // Its two parts: the eyes-off band and, the other, a robotaxi
      // scenario's band no other C component holds.
      const e = c.parts.findIndex(part => sameBand(part, eyesOffBand[metric]));
      const other = c.parts.filter((_, j) => j !== e);
      const i = other.length === 1 ? robotaxiBands.findIndex((r, j) => !matched.has(j) && sameBand(other[0], r)) : -1;
      if (c.parts.length !== 2 || e < 0 || i < 0) {
        problems.push(`${metric}: C component ${JSON.stringify(c)} is not of two parts, the eyes-off band ${JSON.stringify(eyesOffBand[metric])} and a robotaxi scenario's band not yet matched (${JSON.stringify(robotaxiBands)})`);
        continue;
      }
      matched.add(i);
      const wantWeight = d.eyesOff.weight * robotaxi[i].weight / robotaxiWeight;
      if (!(Math.abs(c.weight - wantWeight) <= 1e-12)) problems.push(`${metric}: C component on robotaxi scenario ${i} weighs ${c.weight}; want TESLA_EYES_OFF.weight ${d.eyesOff.weight} x ${robotaxi[i].weight} / ${robotaxiWeight} = ${wantWeight}`);
    }
  }
  assert.ok(problems.length === 0,
    `Replicata: read Tesla's components in FLEET_FORECAST, MILES_FORECAST and RIDES_FORECAST (scope "robotaxi" and scope "hw4", scenario C), with TESLA_ROBOTAXI_SCENARIOS, TESLA_EYES_OFF and TESLA_MILES_PER_CAR_DAY.
Expectata: every component holding its parts; in every table one robotaxi component per scenario of TESLA_ROBOTAXI_SCENARIOS, at its weight, of one part, the scenario's band in the table's unit (the fleet's its daily miles over TESLA_MILES_PER_CAR_DAY, the miles' its cumulative on teslaCumulativeMiles' path, the rides' those over the corridor, teslaRidesBand); and one C component per robotaxi scenario, of two parts, the scenario's own robotaxi band in that table and the eyes-off band (positive, 0 < lo <= best <= hi; fleet: the eyes-off cars x their miles a car-day / TESLA_MILES_PER_CAR_DAY; miles: TESLA_EYES_OFF.cumulative; rides: TESLA_EYES_OFF.cumulative x TESLA_EYES_OFF.ridesPerMile), weighted TESLA_EYES_OFF.weight x the scenario's weight / the robotaxi weights' sum.
Resultata: ${problems.join("; ")}.`);
}

// --- Waymo's and Zoox's miles low edges hold their newest month flat ---
// MILES_FORECAST's Waymo and Zoox comments set each low edge by one rule: the
// line's newest data/vmt.csv month held flat, that month's miles a day from
// the next day through the day before GROWTH_FORECAST_DATE on top of its
// cumulative, at three significant figures (on October 2026's rows, 426
// days: Waymo 667M; Zoox 7.86M on the rows of 2026-10-31 and 8.01M on the
// joint path of 2026-11-03). Until 2026-11-03 no qual checked the rule and
// each edge was re-derived by hand; this re-derives both from data/vmt.csv,
// so a new month or a revised row moves the edge it sets.
{
  const forecastDate = vm.runInContext("GROWTH_FORECAST_DATE", ctx);
  const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8"));
  // Each component's parts' low edges (since 2026-11-04 every component
  // holds its parts; each of Waymo's and Zoox's miles one band).
  const lows = JSON.parse(vm.runInContext(`JSON.stringify(Object.fromEntries(["Waymo", "Zoox"].map(h => [h,
    __entry(MILES_FORECAST, "MILES_FORECAST", h).components.flatMap(c => c.parts.map(b => b.lo))])))`, ctx));
  const problems = [];
  for (const helmer of ["Waymo", "Zoox"]) {
    const own = rows.filter(r => r[0] === helmer.toLowerCase());
    assert.ok(own.length > 0,
      `Replicata: read data/vmt.csv's ${helmer} rows.
Expectata: at least one (the line's newest month sets its forecast's low edge).
Resultata: none.`);
    const newest = own.reduce((a, r) => (r[1] > a[1] ? r : a));
    const [year, month] = newest[1].split("-").map(Number);
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const heldDays = (Date.parse(forecastDate) - Date.UTC(year, month, 1)) / 86400000;
    const flat = Number(newest[3]) + Number(newest[2]) / monthDays * heldDays;
    const want = Number(flat.toPrecision(3));
    if (lows[helmer].length !== 1 || lows[helmer][0] !== want)
      problems.push(`${helmer}: MILES_FORECAST's low edge ${JSON.stringify(lows[helmer])}; want ${want.toLocaleString("en-US")}, ${newest[1]}'s cumulative ${Number(newest[3]).toLocaleString("en-US")} plus its ${Number(newest[2]).toLocaleString("en-US")} miles over its ${monthDays} days held flat for the ${heldDays} days to ${forecastDate} (${Math.round(flat).toLocaleString("en-US")}) at three significant figures`);
  }
  assert.ok(problems.length === 0,
    `Replicata: read MILES_FORECAST's Waymo and Zoox low edges, and each line's newest data/vmt.csv month (its miles and cumulative).
Expectata: each low edge is that month's cumulative plus its miles a day held flat from the next day through the day before ${forecastDate}, at three significant figures.
Resultata: ${problems.join("; ")}.`);
}

console.log("qual pass: Tesla's scenario C is the robotaxi lane's own A/B mix, each of its components the comonotonic sum of a robotaxi scenario's band and the eyes-off band, and Waymo's and Zoox's miles low edges hold their newest month flat");

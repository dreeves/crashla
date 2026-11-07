// A link inside AI text (since 2026-11-05 the VMT sources table's links to
// data/README.md's sections, the human's "ok, go with links" of 2026-11-04)
// keeps the AI text's ink and reads as a link by its underline, as Chromium,
// Firefox and WebKit draw it:
//  - at rest and while hovered, its computed colour is that of the AI text
//    around it (its nearest .ai-text ancestor), the AI ink (--ai-ink,
//    resolved on a probe element), its text is painted in that colour too
//    (its computed -webkit-text-fill-color, which paints over the colour when
//    set), and its own text decoration is a solid underline, where the AI
//    text around it is underlined dotted;
//  - what the site's rule for every link sets, it keeps as a link outside AI
//    text (a reference link appended to the same table's label cell, read
//    the same way at rest and hovered) has it: its opacity, its underline's
//    thickness, its underline drawn in its own colour where the reference's
//    is (else in the reference's), and its computed top (an underline made
//    transparent, faded, of another colour or a hairline would hide what
//    marks it as a link). Until 2026-11-07 these were fixed values (opacity
//    1, an underline in its own colour, at least 1px thick, a top of 0px at
//    rest, the reference unlifted at rest), which the site's rule for every
//    link sets, so a correct change of that rule (dropping the hover lift, a
//    soft underline colour, a thickness of 0.06em, drawn as 1px) was red;
//  - hovered, it moves as a link outside AI text does: a reference link
//    appended to the same table's label cell is hovered the same way, and
//    each link's computed top equals the reference's, and the distance its
//    box is drawn from where it rests (its document position, read before
//    and while hovered) equals the reference's within a quarter pixel
//    (WebKit lays boxes out in 1/64 px), with the page's motion and with
//    reduced motion (emulated); a computed top alone would pass a link that
//    is not positioned, which top does not move. No lift is pinned, nor that
//    links lift at all (the site's reduced-motion rule takes every lift off,
//    and a design may drop it). That the drawn distance is read at all is
//    checked on one more link, outside AI text, which a rule this qual adds
//    gives its own lift: drawn 3px up when hovered, within a quarter pixel;
//  - in forced colours (emulated, which each engine must report through
//    matchMedia), its own underline is still solid and the AI text's still
//    dotted; the browser repaints the colours there, which are not compared
//    (Chromium reports the link's colour as LinkText and its underline's as
//    the AI ink; ai-derivation-colors.qual likewise compares none).
// Each hovered link is read once its transitions have finished (a frame, then
// its animations' finished promises), so no transition's length is assumed;
// an animation that never ends, or one still running after 5 s, is a
// problem, not a wait. Every link inside the VMT sources table's AI text is
// checked, and one more link, appended to an AI-text cell of that table, so
// the checks never run on an empty set: no qual may require the rationales
// to hold a link, their wording being free (the human's rule of 2026-11-03).
// No words are checked.
import assert from "node:assert/strict";
import { ENGINES, serveRepo, openPage } from "./browser.mjs";

const DEF = "?f=All&s=-&a=1&c=HumansAV.Tesla.Waymo&m=atfault";
const AI_LINKS = "#sanity-vmt-sources .ai-text a";
const REFERENCE = "#sanity-vmt-sources a[data-qual-reference]";
const LIFTER = "#sanity-vmt-sources a[data-qual-lifter]";
const LIFTER_LIFT = -3;
// Every link in the table's AI text: its colour, its underline's colour,
// thickness and opacity and its AI-text container's colour, both
// decorations, its top offset, and whether it matches :hover.
const read = () => {
  const probe = document.createElement("span");
  probe.style.color = "var(--ai-ink)";
  document.body.appendChild(probe);
  const aiInk = getComputedStyle(probe).color;
  probe.remove();
  const links = [...document.querySelectorAll("#sanity-vmt-sources .ai-text a")];
  return { aiInk, forced: matchMedia("(forced-colors: active)").matches, links: links.map((a, i) => {
    const s = getComputedStyle(a), box = a.closest(".ai-text"), b = getComputedStyle(box);
    return { i, text: a.textContent.slice(0, 40), synthetic: a.hasAttribute("data-qual-probe"), hovered: a.matches(":hover"),
      color: s.color, fill: s.getPropertyValue("-webkit-text-fill-color"), decoColor: s.textDecorationColor, boxColor: b.color,
      opacity: s.opacity, thickness: s.textDecorationThickness,
      line: s.textDecorationLine, style: s.textDecorationStyle, boxLine: b.textDecorationLine, boxStyle: b.textDecorationStyle,
      top: s.top, y: a.getBoundingClientRect().top + scrollY };
  }) };
};
// The reference link's own properties, the ones the site's rule for every
// link sets.
const readRef = () => {
  const s = getComputedStyle(document.querySelector("#sanity-vmt-sources a[data-qual-reference]"));
  return { color: s.color, decoColor: s.textDecorationColor, opacity: s.opacity, thickness: s.textDecorationThickness, top: s.top };
};
// An element's document position: the top of its box plus the scroll.
const docTop = loc => loc.evaluate(a => a.getBoundingClientRect().top + scrollY);
const px = n => `${Math.round(n * 100) / 100}px`;
// Once the hovered element's style has caught up (a frame) and its
// transitions have run out: null, or what kept them from running out.
const settle = loc => loc.evaluate(async el => {
  await new Promise(done => requestAnimationFrame(() => done()));
  const animations = el.getAnimations();
  const endless = animations.filter(a => a.effect.getTiming().iterations === Infinity).length;
  if (endless > 0) return `${endless} animations that never end`;
  const late = await Promise.race([Promise.all(animations.map(a => a.finished)).then(() => false),
    new Promise(done => setTimeout(() => done(true), 5000))]);
  return late ? `${animations.length} animations still running after 5 s` : null;
});
// Hover an element and read it once it has settled; a problem if it does not.
const hoverSettled = async (loc, tag, problems) => {
  await loc.hover();
  const unsettled = await settle(loc);
  if (unsettled !== null) problems.push(`${tag}: hovered, ${unsettled}`);
};
const marks = (tag, l) => {
  const out = [];
  if (!(/\bunderline\b/.test(l.line) && l.style === "solid")) out.push(`${tag}: its own decoration is "${l.line} ${l.style}", want a solid underline`);
  if (!(/\bunderline\b/.test(l.boxLine) && l.boxStyle === "dotted")) out.push(`${tag}: the AI text around it is decorated "${l.boxLine} ${l.boxStyle}", want a dotted underline`);
  return out;
};
// The page's own colours, and what the site's rule for every link sets: the
// link and the AI text around it in the AI ink, the link's text painted in
// the link's colour; its underline drawn as the reference link draws its own
// (in its own colour where the reference's is, else in the reference's), and
// as thick, and the link as opaque as the reference.
const colours = (tag, l, aiInk, ref) => [
  ...(l.color === l.boxColor && l.color === aiInk ? [] : [`${tag}: drawn ${l.color}, the AI text around it ${l.boxColor}; want both the AI ink, ${aiInk}`]),
  ...(l.fill === l.color ? [] : [`${tag}: its text is painted in ${l.fill} (-webkit-text-fill-color), its colour ${l.color}; want it painted in its colour`]),
  ...((ref.decoColor === ref.color ? l.decoColor === l.color : l.decoColor === ref.decoColor) ? [] : [`${tag}: its underline is drawn in ${l.decoColor}, its text in ${l.color}; want it drawn as a link outside AI text draws its own (${ref.decoColor}, its text ${ref.color})`]),
  ...(l.thickness === ref.thickness ? [] : [`${tag}: its underline is ${l.thickness} thick, want ${ref.thickness}, a link outside AI text's`]),
  ...(l.opacity === ref.opacity ? [] : [`${tag}: opacity ${l.opacity}, want ${ref.opacity}, a link outside AI text's`]),
];

const server = await serveRepo();
const problems = [], counts = [];
for (const [engine, launcher] of Object.entries(ENGINES)) {
  const browser = await launcher.launch();
  const page = await openPage(browser, server.url + DEF, { viewport: { width: 1200, height: 900 } });
  // The appended links: inside the table's first AI-text cell, a link of the
  // rationales' form; in its first label cell, outside AI text, the
  // reference link, whose hover every link's must match; and in its second,
  // the lifter, which a rule added here lifts 3px when hovered.
  await page.evaluate(lift => {
    const link = (attr, cell) => {
      const a = document.createElement("a");
      a.href = "data/#ghost-months";
      a.textContent = "data/README.md, Ghost months";
      a.setAttribute(attr, "");
      cell.append(" (", a, ")");
    };
    const labels = document.querySelectorAll("#sanity-vmt-sources td:not(.ai-text)");
    link("data-qual-probe", document.querySelector("#sanity-vmt-sources td.ai-text"));
    link("data-qual-reference", labels[0]);
    link("data-qual-lifter", labels[1]);
    const rule = document.createElement("style");
    rule.textContent = `a[data-qual-lifter] { position: relative; } a[data-qual-lifter]:hover { top: ${lift}px; }`;
    document.head.appendChild(rule);
  }, LIFTER_LIFT);
  const rest = await page.evaluate(read);
  if (rest.forced) problems.push(`[${engine}] the page is in forced colours before any emulation`);
  if (!rest.links.some(l => l.synthetic)) problems.push(`[${engine}] the appended link is not among the VMT sources table's AI-text links (${rest.links.length} found)`);
  const ref = page.locator(REFERENCE), lifter = page.locator(LIFTER);
  if (await ref.evaluate(a => a.closest(".ai-text") !== null))
    problems.push(`[${engine}] the reference link is inside AI text`);
  const refRest = await page.evaluate(readRef);
  for (const l of rest.links) {
    const tag = `[${engine}] link ${l.i} ${JSON.stringify(l.text)}${l.synthetic ? " (appended)" : ""}, at rest`;
    problems.push(...marks(tag, l), ...colours(tag, l, rest.aiInk, refRest));
    if (l.top !== refRest.top) problems.push(`${tag}: top ${l.top}, want ${refRest.top}, a link outside AI text's at rest`);
  }
  // The lifter, then the reference link's lift (its computed top and the
  // distance it is drawn from where it rests), then each AI-text link's,
  // hovered one at a time; with the page's motion, then with reduced motion.
  const lifts = [];
  for (const motion of ["no-preference", "reduce"]) {
    await page.mouse.move(0, 0);
    await page.emulateMedia({ reducedMotion: motion });
    const mode = `[${engine}, motion ${motion}]`;
    const lifterRest = await docTop(lifter);
    await hoverSettled(lifter, `${mode} the lifter`, problems);
    const lifterDrawn = await docTop(lifter) - lifterRest;
    if (Math.abs(lifterDrawn - LIFTER_LIFT) > 0.25) problems.push(`${mode} the lifter, which this qual's rule lifts ${LIFTER_LIFT}px when hovered, is drawn ${px(lifterDrawn)} from where it rests: the drawn distance is not read`);
    await page.mouse.move(0, 0);
    const refRest = await docTop(ref);
    await hoverSettled(ref, `${mode} the reference link`, problems);
    const refHover = await page.evaluate(readRef);
    const lift = refHover.top;
    const drawnLift = await docTop(ref) - refRest;
    lifts.push(`${motion} ${px(drawnLift)}`);
    for (const l of rest.links) {
      const loc = page.locator(AI_LINKS).nth(l.i);
      const tag = `${mode} link ${l.i} ${JSON.stringify(l.text)}${l.synthetic ? " (appended)" : ""}, hovered`;
      await page.mouse.move(0, 0);
      const y0 = await docTop(loc);
      await hoverSettled(loc, tag, problems);
      const h = (await page.evaluate(read)).links[l.i];
      if (!h.hovered) problems.push(`${tag}: the pointer is on it but it does not match :hover`);
      problems.push(...marks(tag, h), ...colours(tag, h, rest.aiInk, refHover));
      if (h.top !== lift) problems.push(`${tag}: top ${h.top}, want ${lift}, the top of a link outside AI text hovered the same way`);
      if (Math.abs(h.y - y0 - drawnLift) > 0.25) problems.push(`${tag}: drawn ${px(h.y - y0)} from where it rests, want ${px(drawnLift)}, the distance of a link outside AI text hovered the same way`);
    }
  }
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  const forced = await page.evaluate(read);
  if (!forced.forced) problems.push(`[${engine}, forced colours] matchMedia does not report forced colours after emulateMedia({forcedColors: "active"})`);
  for (const l of forced.links) problems.push(...marks(`[${engine}, forced colours] link ${l.i} ${JSON.stringify(l.text)}`, l));
  for (const e of page.errors) problems.push(`[${engine}] page error: ${e}`);
  counts.push(`${engine} ${rest.links.length - 1} (drawn on hover: ${lifts.join(", ")})`);
  await browser.close();
}
await server.close();

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load the default view in Chromium, Firefox and WebKit, append a link to an AI-text cell of the VMT sources table (id sanity-vmt-sources), a reference link to a label cell and a link this qual's rule lifts 3px on hover to another, and read each link in that table's AI text at rest and hovered (each read once its transitions have finished), and the reference link and the lifter hovered, with the page's motion and with reduced motion (emulated); then emulate forced colours and read them again.
Expectata: each link's colour is the AI text's around it, the AI ink (--ai-ink), at rest and hovered, its text painted in that colour; its own decoration is a solid underline and the AI text's a dotted one; its underline drawn as the reference link draws its own (in its own colour where the reference's is), as thick as the reference's, and the link as opaque, at rest and hovered; at rest its top is the reference's; hovered, its top is the reference link's hovered top and it is drawn as far from where it rests as the reference is, within 0.25px, with either motion; the lifter is drawn 3px up, within 0.25px; every hovered link settles (no endless animation, none running after 5 s); in forced colours the same two underlines; no page errors.
Resultata: ${problems.length} problems, e.g.
${problems.slice(0, 10).join("\n")}`);
console.log(`qual pass: links in AI text (the rationales' links, by engine: ${counts.join(", ")}; and one appended) keep the AI ink at rest and hovered, painted in it and underlined solid, where the text around them has a dotted underline, keep the opacity and underline a link outside AI text has, and move on hover as such a link does, as computed and as drawn, with the page's motion and with reduced motion; the same solid and dotted underlines in forced colours`);

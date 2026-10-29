import assert from "node:assert/strict";
import fs from "node:fs";

// With JavaScript off the page showed its h1, the abstract and the section
// headings over empty bodies, plus a "Loading…" under Prediction Markets that
// never resolved, and nothing said the page needs JavaScript (audit #102).
// Spec: one <noscript> notice in the body, ahead of the abstract, a paragraph
// of text (its words are the human's, committed 2026-10-04 in b068a10, and
// not pinned since 2026-10-28, human-approved: a qual pinning the human's own
// wording went red on each of the human's edits and caught no agent's); and a
// <noscript><style> in the head that hides the static "Loading…" paragraph, so
// the markup's own text stays as written.

const html = fs.readFileSync("index.html", "utf8");
const headEnd = html.indexOf("</head>");
const bodyStart = html.indexOf("<body>");
assert.ok(headEnd > 0 && bodyStart > headEnd, "index.html has a head and then a body");
const head = html.slice(0, headEnd);
const body = html.slice(bodyStart);
const noscripts = text => [...text.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(m => m[1]);

assert.ok(
  noscripts(head).some(inner =>
    /^\s*<style>\s*\.predmarket-loading\s*\{\s*display:\s*none;?\s*\}\s*<\/style>\s*$/.test(inner)),
  `Replicata: read index.html's head for a <noscript> block.
Expectata: <noscript><style>.predmarket-loading { display: none; }</style></noscript>, so a page
without JavaScript does not claim to be loading.
Resultata: head noscript blocks: ${JSON.stringify(noscripts(head))}.`,
);

assert.ok(
  /<p class="predmarket-loading">[^<]*\S[^<]*<\/p>/.test(html),
  `Replicata: read index.html's Prediction Markets section.
Expectata: the static loading paragraph (class predmarket-loading) is still there with its text (only hidden without JavaScript).
Resultata: not found.`,
);

const notices = noscripts(body);
assert.equal(notices.length, 1,
  `Replicata: count <noscript> blocks in index.html's body.
Expectata: exactly one, the notice that the page needs JavaScript.
Resultata: ${notices.length}: ${JSON.stringify(notices)}.`);
// HTML comments are not shown, so they are dropped before the block is read.
const notice = /^\s*<p\b[^>]*>([^<]*)<\/p>\s*$/.exec(notices[0].replace(/<!--[\s\S]*?-->/g, ""));
assert.ok(notice !== null && notice[1].trim() !== "",
  `Replicata: read the body's <noscript> block.
Expectata: one paragraph of text, the notice.
Resultata: ${JSON.stringify(notices[0])}.`);
assert.ok(body.indexOf("<noscript>") < body.indexOf('<div class="abstract">'),
  `Replicata: find the body's <noscript> notice and the abstract in index.html.
Expectata: the notice comes first, so a reader without JavaScript meets it before the conclusions.
Resultata: notice at ${body.indexOf("<noscript>")}, abstract at ${body.indexOf('<div class="abstract">')}.`);

console.log("qual pass: without JavaScript the page says so, and hides its static Loading…");

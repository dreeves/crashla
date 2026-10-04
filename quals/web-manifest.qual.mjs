import assert from "node:assert/strict";
import fs from "node:fs";

// The web app manifest names the app a phone installs from "Add to Home
// screen". It said "Crashla", the repo's codename, while the page's <title>
// is the human's "Teslapologetics" (audit #97). Spec: the manifest's name and
// short_name are the <title> text exactly, so the installed app carries the
// site's own name and the two cannot drift apart silently.

const html = fs.readFileSync("index.html", "utf8");
const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map(m => m[1]);
assert.equal(titles.length, 1,
  `Replicata: count <title> elements in index.html.
Expectata: exactly one, the site's name.
Resultata: ${JSON.stringify(titles)}.`);
const title = titles[0];
assert.ok(title.trim() === title && title.length > 0,
  `Replicata: read index.html's <title>.
Expectata: a non-empty name with no surrounding whitespace.
Resultata: ${JSON.stringify(title)}.`);

const links = [...html.matchAll(/<link rel="manifest" href="([^"]+)">/g)].map(m => m[1]);
assert.deepEqual(links, ["site.webmanifest"],
  `Replicata: read index.html's <link rel="manifest">.
Expectata: one link, to site.webmanifest.
Resultata: ${JSON.stringify(links)}.`);

const manifest = JSON.parse(fs.readFileSync("site.webmanifest", "utf8"));
for (const field of ["name", "short_name"]) {
  assert.equal(manifest[field], title,
    `Replicata: install the site from Chrome on Android (Add to Home screen), or read site.webmanifest's "${field}".
Expectata: "${title}", the page's <title>, so the installed app has the site's name.
Resultata: ${JSON.stringify(manifest[field])}.`);
}

console.log("qual pass: the web app manifest names the app by the page's <title>");

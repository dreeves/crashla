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

// One app, started at the default view (audit 2026-10-04 #74). With no
// start_url and no id, a browser takes both from the page the app is
// installed from, so a link with a query (?f=Waymo&...&x=browser) installed
// an app that always opened that view, and every such URL was a separate app.
// "./" resolves against the manifest's own URL (the site root, where it sits).
for (const field of ["start_url", "id"]) {
  assert.equal(manifest[field], "./",
    `Replicata: install the site from a link with a query, e.g. ?f=Waymo&s=speed&a=0&c=Waymo&m=injury&d=2025-01.2025-06&x=browser, or read site.webmanifest's "${field}".
Expectata: "./", the site root, so the installed app opens the default view and is one app whatever URL it was installed from.
Resultata: ${JSON.stringify(manifest[field])} (absent: the browser uses the install page's own URL).`);
}

console.log("qual pass: the web app manifest names the app by the page's <title> and starts it at the site root");

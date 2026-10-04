// A prediction-market card says whether its odds are live (2026-10-03,
// audit #21, #85).
//  - #21: a market that has resolved, or stopped trading, is grayed and
//    labelled (Latin until the human's English: "resolved: <outcome>",
//    "closed"). Until 2026-10-03 neither fetcher read closed / resolved /
//    closeTime, so a market that resolved YES on 2026-07-10 kept showing its
//    last price, 94%, as live odds under a fresh green dot. The state rides in
//    the same fields in the snapshot and in both fetchers' output, so one
//    render path serves both; data/refresh-predmarkets.mjs writes those fields
//    and warns when a market has closed (its closeTime passed), resolved, or
//    resolved an answer.
//    A resolution the cards cannot name fails that market's fetch (the
//    script refuses to write it), so it stays grayed instead of breaking the
//    panel's render.
//  - #85: a card whose odds did not come from this page load's fetch (the
//    snapshot's, because the fetch failed or has not finished) is grayed; the
//    footer's dot and age carry a tooltip saying what they mean; the
//    markets are fetched at once (one after another, the stale first paint
//    lasted ~8.7 s in Firefox).
// Driven in a vm with a DOM stub and a scripted fetch, plus one offline run of
// the refresh script and one layout check in the three browser engines (an
// empty state label must take no room).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { appScript, dataScript } from "./load-app.mjs";

const NOW = Date.UTC(2026, 9, 5); // 2026-10-05, after the snapshot, before any curated market closes
const DAY = 86400000;

// --- A DOM stub that keeps classes, attributes and the element tree ---------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {};
    this.classes = new Set(); this.listeners = {}; this._html = ""; this._text = ""; this.title = "";
  }
  get className() { return [...this.classes].join(" "); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this.classes;
    return {
      add: (...c) => c.forEach(x => s.add(x)),
      remove: (...c) => c.forEach(x => s.delete(x)),
      contains: c => s.has(c),
      toggle: (c, on) => { const want = on === undefined ? !s.has(c) : Boolean(on); if (want) s.add(c); else s.delete(c); return want; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(g => g !== f); }
  set textContent(v) { this._text = String(v); this._html = esc(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  set innerHTML(v) { this._html = String(v); this._text = ""; this.children = []; }
  get innerHTML() { return this._html; }
  get firstElementChild() { return this._first ||= new El("span"); }
  querySelector(sel) {
    const cls = sel.replace(/^\./, "");
    for (const c of this.children) {
      if (c.classes.has(cls)) return c;
      const hit = c.querySelector(sel);
      if (hit) return hit;
    }
    return null;
  }
}
const nodes = new Map();
const errors = [];
let fetchImpl = () => { throw new Error("no fetch scripted"); };
const ctx = vm.createContext({
  console: { log: console.log, warn: console.warn, error: (...a) => errors.push(a.map(String).join(" ")) },
  setInterval: () => 1, clearInterval: () => {},
  fetch: url => fetchImpl(url),
  document: {
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new El("div")); return nodes.get(id); },
    createElement: tag => new El(tag),
    activeElement: { getAttribute: () => null },
    querySelector: () => null,
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(fs.readFileSync("data/predmarkets.js", "utf8"), ctx, { filename: "predmarkets.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`Date.now = () => ${NOW};`, ctx);

const problems = [];
const snap = JSON.parse(vm.runInContext("JSON.stringify({p: POLYMARKET_SNAPSHOT, m: MANIFOLD_SNAPSHOT, d: PREDMARKET_SNAPSHOT_DATE})", ctx));
const enabled = list => list.filter(e => e.enabled !== false);

// The labels, read from the app so the qual follows the human's English.
let L = null;
try {
  L = JSON.parse(vm.runInContext("JSON.stringify({resolved: RESOLVED_LABEL, closed: CLOSED_LABEL, cancelled: CANCELLED_LABEL})", ctx));
} catch (err) {
  problems.push(`crashla.js defines no RESOLVED_LABEL / CLOSED_LABEL / CANCELLED_LABEL (${err.message})`);
}

// The rendered panel as rows: question (or outcome) text, faded, state label.
const decode = s => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function readPanel() {
  const panel = nodes.get("predmarket-panel");
  const grid = panel.children[0];
  return {
    cards: grid.children.map(card => ({
      text: decode((/<a [^>]*>(?:<b>)?([^<]*)/.exec(card.innerHTML) || [, "?"])[1]),
      header: card.innerHTML.includes("<b>"),
      sub: card.classes.has("pm-subcard"),
      faded: card.classes.has("pm-faded"),
      state: decode((/<span class="pm-card-state">([^<]*)<\/span>/.exec(card.innerHTML) || [, null])[1] ?? "(no state span)"),
    })),
    footer: panel.children[1],
  };
}

// --- 1. The snapshot carries the state fields the live fetch carries --------
// Manifold: closeTime (ms) on every market; resolution and
// resolutionProbability on a binary market and on every answer (null while
// open). Polymarket: closed, endDate and umaResolutionStatus on every curated
// sub-market.
for (const m of snap.m) {
  const outcomes = m.answers || [m];
  if (!Number.isFinite(m.closeTime)) problems.push(`snapshot ${m.slug}: closeTime ${JSON.stringify(m.closeTime)}, want a time in ms`);
  for (const o of outcomes) {
    if (!("resolution" in o) || !("resolutionProbability" in o)) problems.push(`snapshot ${m.slug}${o === m ? "" : ` answer ${o.label}`}: no resolution / resolutionProbability field`);
  }
}
for (const ev of snap.p) {
  for (const mk of ev.markets) {
    if (typeof mk.closed !== "boolean" || Number.isNaN(Date.parse(mk.endDate)) || !("umaResolutionStatus" in mk)) problems.push(`snapshot ${ev.slug}: market ${JSON.stringify(mk.question)} lacks closed / endDate / umaResolutionStatus`);
  }
}

// --- 2. First paint: the snapshot's odds are grayed; every market is fetched at once
const calls = [];
fetchImpl = url => { calls.push(url); return new Promise(() => {}); }; // the refresh stays in flight
vm.runInContext("loadPredmarketData()", ctx);
const total = enabled(snap.p).length + enabled(snap.m).length;
if (calls.length !== total) problems.push(`loadPredmarketData issued ${calls.length} fetches before the first answered; want all ${total} at once`);
const first = readPanel();
const notFaded = first.cards.filter(c => !c.faded).map(c => c.text);
if (first.cards.length === 0 || notFaded.length > 0) problems.push(`first paint: ${notFaded.length} of ${first.cards.length} snapshot cards not grayed (${JSON.stringify(notFaded.slice(0, 4))})`);

// --- 3. A refresh: resolved, closed and failed markets are marked -----------
const open = m => ({ id: m.slug, question: m.question, slug: m.slug, url: m.url, volume: m.volume,
  isResolved: false, closeTime: NOW + 90 * DAY,
  ...(m.answers
    ? { outcomeType: "DATE", mechanism: "cpmm-multi-1", answers: m.answers.map((a, i) => ({ id: `a${i}`, index: i, text: a.label, probability: a.prob })) }
    : { outcomeType: "BINARY", mechanism: "cpmm-1", probability: m.probability }) });
// Markets are picked by role from whatever the snapshot curates, so a
// curation change does not break the qual: the first five binary Manifold
// markets resolve YES, close unresolved, resolve CANCEL, resolve MKT and fail
// to fetch; the first multi-answer one resolves its first answer; the first
// Polymarket event resolves Yes.
const binaries = enabled(snap.m).filter(m => !m.answers), multis = enabled(snap.m).filter(m => m.answers);
assert.ok(binaries.length >= 5 && multis.length >= 1 && enabled(snap.p).length >= 1,
  `the snapshot curates ${binaries.length} binary and ${multis.length} multi-answer Manifold markets and ${enabled(snap.p).length} Polymarket events; this qual needs at least 5, 1 and 1`);
const [YES_M, CLOSED_M, CANCEL_M, MKT_M, FAILING_M] = binaries, MULTI_M = multis[0], POLY = enabled(snap.p)[0];
const FAILING = FAILING_M.slug;
const manifoldReply = {
  ...Object.fromEntries(snap.m.map(m => [m.slug, open(m)])),
  // The real shape of a resolved market (tesla-robotaxi-service-atfault-acci,
  // resolved YES 2026-07-10 at a last price of 0.9373).
  [YES_M.slug]: { ...open(YES_M), isResolved: true, resolution: "YES",
    resolutionTime: NOW - 2 * DAY, resolutionProbability: 0.9373, probability: 0.9373, closeTime: NOW - 2 * DAY },
  [CLOSED_M.slug]: { ...open(CLOSED_M), closeTime: NOW - 3600000 },
  [CANCEL_M.slug]: { ...open(CANCEL_M), isResolved: true, resolution: "CANCEL",
    resolutionProbability: 0.06, probability: 0.06, closeTime: NOW - DAY },
  // Manifold's MKT settles at resolutionProbability, not the last price.
  [MKT_M.slug]: { ...open(MKT_M), isResolved: true, resolution: "MKT",
    resolutionProbability: 0.46, probability: 0.34, closeTime: NOW - DAY },
};
// An independent-answers market resolves one answer while the rest trade.
manifoldReply[MULTI_M.slug].answers[0] = { ...manifoldReply[MULTI_M.slug].answers[0],
  resolution: "NO", resolutionProbability: 0.05, resolutionTime: NOW - DAY };
const polymarketReply = [{ id: "79049", slug: POLY.slug, title: POLY.title, active: true, closed: true,
  endDate: "2027-01-01T04:59:00Z", volume: 17475.9,
  markets: POLY.markets.map(mk => ({ question: mk.question, outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"1\", \"0\"]", volume: "17475.9",
    active: true, closed: true, endDate: "2027-01-01T04:59:00Z", umaResolutionStatus: "resolved" })) }];
const reply = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
fetchImpl = url => {
  if (url.includes("gamma-api.polymarket.com")) return reply(polymarketReply);
  const slug = decodeURIComponent(url.split("/v0/slug/")[1]);
  if (slug === FAILING) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  return reply(manifoldReply[slug]);
};
errors.length = 0;
await vm.runInContext("refreshPredmarkets()", ctx);
const after = readPanel();
if (L !== null) {
  const want = new Map([
    ...POLY.markets.map(mk => [POLY.markets.length === 1 ? POLY.title : mk.question, { faded: true, state: `${L.resolved} Yes` }]),
    [YES_M.question, { faded: true, state: `${L.resolved} YES` }],
    [CLOSED_M.question, { faded: true, state: L.closed }],
    [CANCEL_M.question, { faded: true, state: `${L.resolved} ${L.cancelled}` }],
    [MKT_M.question, { faded: true, state: `${L.resolved} 46%` }],
    [MULTI_M.answers[0].label, { faded: true, state: `${L.resolved} NO` }],
    [FAILING_M.question, { faded: true, state: "" }],
  ]);
  for (const c of after.cards) {
    const w = want.get(c.text) ?? { faded: false, state: "" };
    if (c.faded !== w.faded || c.state !== w.state) problems.push(`after the refresh: ${JSON.stringify(c.text)} reads faded ${c.faded}, state ${JSON.stringify(c.state)}; want faded ${w.faded}, state ${JSON.stringify(w.state)}`);
  }
  const missing = [...want.keys()].filter(t => !after.cards.some(c => c.text === t));
  if (missing.length > 0) problems.push(`after the refresh: no card for ${JSON.stringify(missing)}`);
}
if (!errors.some(e => e.includes(FAILING))) problems.push(`the failed fetch of ${FAILING} was not reported on the console (got ${JSON.stringify(errors)})`);

// --- 3b. A resolution the cards cannot name fails that market's fetch ------
// (an unknown Manifold code, a 50-50 Polymarket resolution with no outcome
// priced 1, an MKT resolution without the probability it settled at, which
// fmtPct would otherwise print as "0%"): the refresh still completes, and
// those cards stay grayed on the snapshot's odds with the failure on the
// console, rather than the render throwing and leaving the panel
// mid-refresh.
{
  const { resolutionProbability: _settled, ...mktUnsettled } = manifoldReply[MKT_M.slug];
  const odd = { ...manifoldReply, [YES_M.slug]: { ...manifoldReply[YES_M.slug], resolution: "PARTIAL" }, [MKT_M.slug]: mktUnsettled };
  const fiftyFifty = JSON.parse(JSON.stringify(polymarketReply));
  for (const mk of fiftyFifty[0].markets) mk.outcomePrices = "[\"0.5\", \"0.5\"]";
  fetchImpl = url => url.includes("gamma-api.polymarket.com") ? reply(fiftyFifty) : reply(odd[decodeURIComponent(url.split("/v0/slug/")[1])]);
  errors.length = 0;
  let threw = null;
  try { await vm.runInContext("refreshPredmarkets()", ctx); } catch (err) { threw = err.message; }
  const odds = readPanel();
  const card = text => odds.cards.find(c => c.text === text);
  const polyTitle = POLY.markets.length === 1 ? POLY.title : POLY.markets[0].question;
  const busy = nodes.get("predmarket-panel").querySelector(".pm-refresh").getAttribute("aria-disabled");
  if (threw !== null || busy === "true") problems.push(`an unnameable resolution broke the refresh: threw ${JSON.stringify(threw)}, button aria-disabled ${busy}`);
  for (const [text, slug] of [[YES_M.question, YES_M.slug], [MKT_M.question, MKT_M.slug], [polyTitle, POLY.slug]]) {
    const c = card(text);
    if (!c || !c.faded || c.state !== "") problems.push(`an unnameable resolution: ${JSON.stringify(text)} reads ${JSON.stringify(c)}; want grayed with no state label`);
    if (!errors.some(e => e.includes(slug))) problems.push(`an unnameable resolution of ${slug} was not reported on the console`);
  }
}

// --- 3c. ...nor a Polymarket resolution with no outcome name at the price of 1
// (its outcomes list shorter than its prices), which would read
// "<RESOLVED_LABEL> undefined" (reviewer, 2026-10-03).
{
  const nameless = JSON.parse(JSON.stringify(polymarketReply));
  for (const mk of nameless[0].markets) { mk.outcomes = "[\"Yes\"]"; mk.outcomePrices = "[\"0\", \"1\"]"; }
  fetchImpl = url => url.includes("gamma-api.polymarket.com") ? reply(nameless) : reply(manifoldReply[decodeURIComponent(url.split("/v0/slug/")[1])]);
  errors.length = 0;
  await vm.runInContext("refreshPredmarkets()", ctx);
  const polyTitle = POLY.markets.length === 1 ? POLY.title : POLY.markets[0].question;
  const c = readPanel().cards.find(card => card.text === polyTitle);
  if (!c || !c.faded || c.state !== "") problems.push(`a nameless Polymarket resolution: ${JSON.stringify(polyTitle)} reads ${JSON.stringify(c)}; want grayed with no state label`);
  if (!errors.some(e => e.includes(POLY.slug))) problems.push(`a nameless Polymarket resolution of ${POLY.slug} was not reported on the console`);
}

// --- 4. The footer's dot and age explain themselves -------------------------
{
  const status = after.footer && after.footer.children.find(c => c.classes.has("pm-status"));
  const tip = status && status.getAttribute("data-tip");
  const kids = status ? status.children.map(c => c.className) : [];
  const has = cls => status.children.some(c => c.classes.has(cls));
  const hidden = status ? status.children.filter(c => c.classes.has("visually-hidden")) : [];
  if (!status || !tip || status.getAttribute("tabindex") !== "0" || !has("pm-dot") || !has("pm-age")
    || hidden.length !== 1 || hidden[0].textContent !== tip || !tip.includes(snap.d.slice(0, 10)))
    problems.push(`the footer's status: ${JSON.stringify({ found: Boolean(status), tip, tabindex: status && status.getAttribute("tabindex"), kids, hidden: hidden.map(h => h.textContent) })}; want a Tab stop (tabindex 0) holding the dot and the age, whose data-tip names the snapshot date ${snap.d.slice(0, 10)} and is also its one visually hidden child`);
}

// --- 5. The fetchers' output has the snapshot's shape -----------------------
// (so the render path needs no case for either source).
{
  fetchImpl = url => url.includes("gamma-api.polymarket.com") ? reply(polymarketReply) : reply(manifoldReply[decodeURIComponent(url.split("/v0/slug/")[1])]);
  const keys = o => Object.keys(JSON.parse(JSON.stringify(o))).sort().join(",");
  for (const e of enabled(snap.m)) {
    const got = await vm.runInContext(`fetchManifoldMarket(${JSON.stringify(e)})`, ctx);
    if (keys(got) !== keys(e)) problems.push(`fetchManifoldMarket(${e.slug}) keys ${keys(got)}; the snapshot entry's ${keys(e)}`);
    (got.answers || []).forEach((a, i) => { if (keys(a) !== keys(e.answers[i])) problems.push(`fetchManifoldMarket(${e.slug}) answer keys ${keys(a)}; the snapshot's ${keys(e.answers[i])}`); });
  }
  const ev = await vm.runInContext(`fetchPolymarketEvent(${JSON.stringify(POLY.slug)}, ${JSON.stringify(POLY)})`, ctx);
  if (keys(ev) !== keys(POLY) || keys(ev.markets[0]) !== keys(POLY.markets[0])) problems.push(`fetchPolymarketEvent keys ${keys(ev)} / ${keys(ev.markets[0])}; the snapshot's ${keys(POLY)} / ${keys(POLY.markets[0])}`);
}

// --- 6. Rule 7: the new copy is Latin with a TODO recap directly above it ----
{
  const src = fs.readFileSync("crashla.js", "utf8").split("\n");
  for (const re of [/^const RESOLVED_LABEL = /, /^const CLOSED_LABEL = /, /^const CANCELLED_LABEL = /, /^function predmarketStatusTip\(/]) {
    const line = src.findIndex(l => re.test(l));
    let j = line - 1;
    while (j >= 0 && /^\s*\/\//.test(src[j])) j--;
    if (line < 0 || !/\/\/ TODO/.test(src.slice(j + 1, line).join("\n"))) problems.push(`crashla.js: ${re.source} has no TODO recap directly above it`);
  }
  const css = fs.readFileSync("style.css", "utf8");
  if (!/\.pm-card\.pm-faded\s*\{[^}]*opacity:\s*0?\.\d+/.test(css)) problems.push("style.css: no .pm-card.pm-faded rule with an opacity below 1");
}

// --- 7. The refresh script writes the state and warns about it -------------
// Run offline on a copy: a preloaded fetch answers from fixtures.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "market-state-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.copyFileSync("data/refresh-predmarkets.mjs", path.join(dir, "data/refresh-predmarkets.mjs"));
  fs.copyFileSync("data/predmarkets.js", path.join(dir, "data/predmarkets.js"));
  const now = Date.now(); // the script runs on the real clock
  const fixtures = {
    // An open Polymarket market carries no umaResolutionStatus at all.
    polymarket: [{ ...polymarketReply[0], closed: false, markets: polymarketReply[0].markets.map(mk => Object.fromEntries(Object.entries({ ...mk, closed: false,
      outcomePrices: "[\"0.032\", \"0.968\"]", endDate: new Date(now + 90 * DAY).toISOString() }).filter(([k]) => k !== "umaResolutionStatus"))) }],
    manifold: Object.fromEntries(snap.m.map(m => [m.slug, { ...open(m), closeTime: now + 90 * DAY }])),
  };
  fixtures.manifold[YES_M.slug].closeTime = now - DAY; // closed, not yet resolved
  fixtures.manifold[MULTI_M.slug].answers[0] = { ...fixtures.manifold[MULTI_M.slug].answers[0],
    resolution: "NO", resolutionProbability: 0.05, resolutionTime: now - DAY };
  fs.writeFileSync(path.join(dir, "fixtures.json"), JSON.stringify(fixtures));
  fs.writeFileSync(path.join(dir, "stub.mjs"), `
import fs from "node:fs";
const fx = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, "fixtures.json"))}, "utf8"));
globalThis.fetch = async url => ({ ok: true, status: 200, json: async () =>
  url.includes("gamma-api.polymarket.com") ? fx.polymarket : fx.manifold[decodeURIComponent(url.split("/v0/slug/")[1])] });
`);
  let out = "";
  try {
    out = execFileSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "stub.mjs")).href, path.join(dir, "data/refresh-predmarkets.mjs")], { encoding: "utf8" });
  } catch (err) {
    problems.push(`the refresh script failed offline: ${err.message.split("\n")[0]}`);
  }
  const warnings = out.split("\n").filter(l => l.startsWith("WARNING"));
  const warned = slug => warnings.some(w => w.includes(slug));
  if (!warned(YES_M.slug)) problems.push(`refresh script: no warning that ${YES_M.slug} closed (closeTime passed); warnings ${JSON.stringify(warnings)}`);
  if (!warned(MULTI_M.slug)) problems.push(`refresh script: no warning that an answer of ${MULTI_M.slug} resolved; warnings ${JSON.stringify(warnings)}`);
  const quiet = snap.m.map(m => m.slug).filter(s => s !== YES_M.slug && s !== MULTI_M.slug).filter(warned);
  if (quiet.length > 0 || snap.p.some(ev => warned(ev.slug))) problems.push(`refresh script: warnings for open markets ${JSON.stringify(quiet)} (${JSON.stringify(warnings)})`);
  // What it wrote has the page fetchers' shape, entry by entry.
  const c2 = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(dir, "data/predmarkets.js"), "utf8"), c2);
  const written = JSON.parse(vm.runInContext("JSON.stringify({p: POLYMARKET_SNAPSHOT, m: MANIFOLD_SNAPSHOT})", c2));
  fetchImpl = url => url.includes("gamma-api.polymarket.com") ? reply(fixtures.polymarket) : reply(fixtures.manifold[decodeURIComponent(url.split("/v0/slug/")[1])]);
  const keys = o => Object.keys(JSON.parse(JSON.stringify(o))).sort().join(",");
  for (const e of written.m) {
    const page = await vm.runInContext(`fetchManifoldMarket(${JSON.stringify(e)})`, ctx);
    if (JSON.stringify(page) !== JSON.stringify(e)) problems.push(`refresh script vs fetchManifoldMarket for ${e.slug}: ${JSON.stringify(e).slice(0, 160)} vs ${JSON.stringify(page).slice(0, 160)}`);
  }
  const pageEv = await vm.runInContext(`fetchPolymarketEvent(${JSON.stringify(written.p[0].slug)}, ${JSON.stringify(written.p[0])})`, ctx);
  if (JSON.stringify(pageEv) !== JSON.stringify(written.p[0])) problems.push(`refresh script vs fetchPolymarketEvent: ${JSON.stringify(written.p[0])} vs ${JSON.stringify(pageEv)}`);
  // A resolution the page cannot name stops the script before it writes.
  const before = fs.readFileSync(path.join(dir, "data/predmarkets.js"), "utf8");
  fixtures.manifold[MULTI_M.slug].answers[0].resolution = "PARTIAL";
  fs.writeFileSync(path.join(dir, "fixtures.json"), JSON.stringify(fixtures));
  let stopped = false;
  try {
    execFileSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "stub.mjs")).href, path.join(dir, "data/refresh-predmarkets.mjs")], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    stopped = /PARTIAL/.test(String(err.stderr));
  }
  if (!stopped || fs.readFileSync(path.join(dir, "data/predmarkets.js"), "utf8") !== before) problems.push(`refresh script: an unnameable resolution ("PARTIAL") did not stop it before writing (stopped ${stopped})`);
  // So does an MKT resolution without the probability it settled at: written,
  // it would make the page's first paint assert (or print "0%").
  fixtures.manifold[MULTI_M.slug].answers[0].resolution = "MKT";
  delete fixtures.manifold[MULTI_M.slug].answers[0].resolutionProbability;
  fs.writeFileSync(path.join(dir, "fixtures.json"), JSON.stringify(fixtures));
  let stoppedMkt = false;
  try {
    execFileSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "stub.mjs")).href, path.join(dir, "data/refresh-predmarkets.mjs")], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    stoppedMkt = /MKT/.test(String(err.stderr));
  }
  if (!stoppedMkt || fs.readFileSync(path.join(dir, "data/predmarkets.js"), "utf8") !== before) problems.push(`refresh script: an MKT resolution without its settled probability did not stop it before writing (stopped ${stoppedMkt})`);
  // ...and a Polymarket resolution with no outcome name at the price of 1.
  fixtures.manifold[MULTI_M.slug].answers[0].resolutionProbability = 0.05;
  for (const mk of fixtures.polymarket[0].markets) Object.assign(mk, { umaResolutionStatus: "resolved", outcomes: "[\"Yes\"]", outcomePrices: "[\"0\", \"1\"]" });
  fs.writeFileSync(path.join(dir, "fixtures.json"), JSON.stringify(fixtures));
  let stoppedName = false;
  try {
    execFileSync(process.execPath, ["--import", pathToFileURL(path.join(dir, "stub.mjs")).href, path.join(dir, "data/refresh-predmarkets.mjs")], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    stoppedName = /outcome name/.test(String(err.stderr));
  }
  if (!stoppedName || fs.readFileSync(path.join(dir, "data/predmarkets.js"), "utf8") !== before) problems.push(`refresh script: a Polymarket resolution with no outcome name at the price of 1 did not stop it before writing (stopped ${stoppedName})`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 8. An empty state label takes no room ---------------------------------
// The label span is always present, empty while a market trades. An empty
// inline box still lays out its horizontal margin, so until the reviewer's
// fix (2026-10-03) the label's margin wrapped some trading markets' questions
// onto an extra line in Firefox and WebKit (at 320 and 375 CSS px). Checked
// on the snapshot's cards (openPage refuses the refresh, so the panel keeps
// the snapshot) across phone widths: removing every empty label changes no
// card's height.
{
  const { ENGINES, openPage, serveRepo } = await import("./browser.mjs");
  const server = await serveRepo();
  try {
    for (const [engineName, engine] of Object.entries(ENGINES)) {
      const browser = await engine.launch();
      try {
        const page = await openPage(browser, server.url, { viewport: { width: 400, height: 900 } });
        for (let width = 320; width <= 400; width += 5) {
          await page.setViewportSize({ width, height: 900 });
          const grown = await page.evaluate(() => {
            const cards = [...document.querySelectorAll("#predmarket-panel .pm-card")];
            const empty = [...document.querySelectorAll("#predmarket-panel .pm-card-state:empty")]
              .map(span => ({ span, parent: span.parentNode, next: span.nextSibling }));
            const before = cards.map(c => c.getBoundingClientRect().height);
            for (const e of empty) e.span.remove();
            const after = cards.map(c => c.getBoundingClientRect().height);
            for (const e of empty) e.parent.insertBefore(e.span, e.next);
            return cards.map((c, i) => ({ text: (c.querySelector("a")?.textContent || "").slice(0, 60), before: before[i], after: after[i] }))
              .filter(r => Math.abs(r.before - r.after) > 0.5);
          });
          for (const g of grown) problems.push(`${engineName} ${width}px: an empty state label makes ${JSON.stringify(g.text)} ${g.before.toFixed(1)}px tall, ${g.after.toFixed(1)}px without it`);
        }
        if (page.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(page.errors)}`);
        await page.context().close();
        // The status is a Tab stop the refresh's re-render replaces, so it
        // carries data-focus-key like the refresh button (rerenderKeepingFocus):
        // focused while a refresh is in flight, it keeps focus when the panel
        // redraws (until the reviewer's fix, 2026-10-03, focus fell to <body>).
        const held = await openPage(browser, server.url, { viewport: { width: 1200, height: 900 } }, 1000);
        await held.click(".pm-refresh");
        await held.focus(".pm-status");
        await held.waitForFunction(() => document.querySelector(".pm-refresh").getAttribute("aria-disabled") !== "true");
        const focused = await held.evaluate(() => document.activeElement.className || document.activeElement.tagName);
        if (focused !== "pm-status") problems.push(`${engineName}: the market status, focused during a refresh, lost focus to ${JSON.stringify(focused)} when the panel redrew`);
        if (held.errors.length > 0) problems.push(`${engineName}: page errors ${JSON.stringify(held.errors)}`);
        await held.context().close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
}

for (const p of problems) console.error(p);
assert.ok(problems.length === 0,
  `Replicata: load data/predmarkets.js and crashla.js in a vm on 2026-10-05, paint the snapshot, then refresh with scripted API replies (Polymarket's event resolved Yes; Manifold's Portland market resolved YES at 0.9373, one market past its closeTime, one CANCELled, one MKT at 46%, one answer of the vision-only market resolved NO, one fetch failing with HTTP 500); read the cards and the footer; compare the fetchers' output with the snapshot; run data/refresh-predmarkets.mjs offline on fixtures.
Expectata: (#21) the snapshot and both fetchers carry closeTime / resolution / resolutionProbability (Manifold) and closed / endDate / umaResolutionStatus (Polymarket) in one shape; a resolved card is grayed (pm-faded) and reads RESOLVED_LABEL and its outcome (Polymarket's outcome name, YES / NO, MKT's settled percentage, CANCEL as CANCELLED_LABEL), a closed one CLOSED_LABEL, the rest of a market's answers keep trading; a resolution the cards cannot name (an unknown Manifold code, a 50-50 Polymarket resolution, an MKT one without its settled probability) fails only that market's fetch, which stays grayed with the failure on the console; the refresh script writes the page fetchers' shape, warns about a passed closeTime and a resolved answer and about nothing else, and stops before writing on an unnameable resolution (an unknown code, an MKT one without its settled probability); (#85) every snapshot card is grayed until its fetch lands and stays grayed if the fetch fails, all ${total} fetches start at once, and the footer's dot and age sit in one Tab stop whose tooltip (also visually hidden text) explains them and names the snapshot date; the new Latin has TODO recaps; an empty state label takes no room (no card changes height without it, 320-400 px, three engines).
Resultata: ${problems.length} problems:
${problems.slice(0, 14).join("\n")}`);
console.log("qual pass: market cards gray when not live, mark resolved and closed markets, the footer explains its dot and age, and the refresh script carries and warns on market state");

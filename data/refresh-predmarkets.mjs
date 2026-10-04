#!/usr/bin/env node
// Regenerates data/predmarkets.js in place: refetches every snapshot market's
// live prices, volumes and state (same shaping as crashla.js's
// fetchPolymarketEvent / fetchManifoldMarket, which quals/market-state.qual.mjs
// checks field for field), preserves each entry's slug/enabled curation and
// the header comment, and bumps PREDMARKET_SNAPSHOT_DATE. Markets that have
// CLOSED (their closeTime / endDate passed, or Polymarket closed them),
// RESOLVED, or resolved one of their answers are not dropped automatically —
// the script warns so a human can disable or replace them (curation is a
// human call); until then the page grays them and says so.
//
// Usage: node data/refresh-predmarkets.mjs

import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "predmarkets.js");
const src = fs.readFileSync(FILE, "utf8");

const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const oldPoly = vm.runInContext("POLYMARKET_SNAPSHOT", ctx);
const oldManifold = vm.runInContext("MANIFOLD_SNAPSHOT", ctx);

// The header comment block (everything between the date line and the first
// snapshot const) is curation documentation — carried over verbatim.
const header = src.slice(src.indexOf("\n") + 1, src.indexOf("const POLYMARKET_SNAPSHOT"));

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} for ${url}`);
  return resp.json();
}

const warnings = [];

function must(ok, message) {
  if (!ok) throw new Error(message);
}

// A market stops being a live price when it closes (its close time passes,
// or Polymarket closes it) or resolves; the page grays it from then on.
async function freshPolymarket(entry) {
  const events = await fetchJson(
    "https://gamma-api.polymarket.com/events?slug=" + encodeURIComponent(entry.slug));
  must(events.length > 0, "no events for slug " + entry.slug);
  const ev = events[0];
  const kept = new Set(entry.markets.map(m => m.question));
  const markets = (ev.markets || []).filter(m => kept.has(m.question)).map(m => {
    // Polymarket leaves umaResolutionStatus off a market until a resolution
    // is proposed; it is written as null.
    const uma = m.umaResolutionStatus ?? null;
    must(typeof m.closed === "boolean" && !Number.isNaN(Date.parse(m.endDate)) &&
      (uma === null || typeof uma === "string"),
      `polymarket ${entry.slug}: ${JSON.stringify(m.question)} lacks closed / endDate, or has an odd umaResolutionStatus`);
    return {
      question: m.question,
      outcomes: m.outcomes,
      outcomePrices: m.outcomePrices,
      volume: m.volume || "0",
      closed: m.closed,
      endDate: m.endDate,
      umaResolutionStatus: uma,
    };
  });
  must(markets.length === entry.markets.length,
    `polymarket ${entry.slug}: the curated sub-market questions no longer match`);
  // The page names a resolved market's outcome by the one it prices at 1; a
  // resolution it cannot name (e.g. 50-50) must not reach the snapshot.
  for (const m of markets) {
    const prices = JSON.parse(m.outcomePrices).map(Number);
    must(m.umaResolutionStatus !== "resolved" || prices.filter(p => p === 1).length === 1,
      `polymarket ${entry.slug}: resolved without exactly one outcome priced 1 (${m.outcomePrices}); the page cannot name its outcome`);
    const name = JSON.parse(m.outcomes)[prices.indexOf(1)];
    must(m.umaResolutionStatus !== "resolved" || (typeof name === "string" && name !== ""),
      `polymarket ${entry.slug}: resolved, but no outcome name sits at the price of 1 (${m.outcomes}); the page cannot name its outcome`);
  }
  for (const m of markets) {
    if (m.umaResolutionStatus === "resolved") warnings.push(`RESOLVED: polymarket ${entry.slug} (${m.question}) — disable or replace it`);
    else if (m.closed || Date.parse(m.endDate) <= Date.now()) warnings.push(`CLOSED: polymarket ${entry.slug} (${m.question}) stopped trading (closed, or past its endDate ${m.endDate}) — disable or replace it`);
  }
  return {
    title: ev.title,
    slug: entry.slug,
    enabled: entry.enabled,
    volume: parseFloat(ev.volume) || 0,
    markets,
  };
}

// Manifold leaves the resolution fields off a market or answer until it
// resolves; they are written as null.
async function freshManifold(entry) {
  const m = await fetchJson(
    "https://api.manifold.markets/v0/slug/" + encodeURIComponent(entry.slug));
  const binary = m.outcomeType === "BINARY";
  must(binary || Array.isArray(m.answers), `manifold ${entry.slug}: neither binary nor an answers list`);
  must(Number.isFinite(m.closeTime), `manifold ${entry.slug}: no closeTime`);
  const out = { question: m.question, slug: entry.slug, url: m.url, enabled: entry.enabled, closeTime: m.closeTime };
  if (binary) {
    out.probability = m.probability;
    out.resolution = m.resolution ?? null;
    out.resolutionProbability = m.resolutionProbability ?? null;
  } else out.answers = m.answers
    .slice().sort((a, b) => a.index - b.index)
    .map(a => ({ label: a.text, prob: a.probability, resolution: a.resolution ?? null, resolutionProbability: a.resolutionProbability ?? null }));
  out.volume = m.volume || 0;
  // The page names the resolutions YES, NO, MKT (by the probability it
  // settled at, so that must be present) and CANCEL.
  for (const o of out.answers || [out]) {
    must(o.resolution === null || ["YES", "NO", "MKT", "CANCEL"].includes(o.resolution),
      `manifold ${entry.slug}: resolution ${JSON.stringify(o.resolution)} is one the page cannot name`);
    must(o.resolution !== "MKT" || (Number.isFinite(o.resolutionProbability) && o.resolutionProbability >= 0 && o.resolutionProbability <= 1),
      `manifold ${entry.slug}: resolution MKT without the probability it settled at (${JSON.stringify(o.resolutionProbability)}); the page cannot name its outcome`);
  }
  if (m.isResolved) warnings.push(`RESOLVED: manifold ${entry.slug} — disable or replace it`);
  else if (m.closeTime <= Date.now()) warnings.push(`CLOSED: manifold ${entry.slug} stopped trading at its closeTime ${new Date(m.closeTime).toISOString()} — disable or replace it`);
  for (const a of out.answers || []) {
    if (a.resolution !== null) warnings.push(`ANSWER RESOLVED: manifold ${entry.slug} answer ${JSON.stringify(a.label)} resolved ${a.resolution} — the page grays it; keep, disable or replace the market`);
  }
  return out;
}

// Serialize matching the file's existing layout: JSON.stringify-style
// two-space indenting, except `answers` entries stay one line each.
function printEntry(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => {
    if (k === "answers") {
      const rows = v.map(a => `${pad}    {${Object.entries(a).map(([ak, av]) => `${JSON.stringify(ak)}: ${JSON.stringify(av)}`).join(", ")}}`);
      return `${pad}  "answers": [\n${rows.join(",\n")}\n${pad}  ]`;
    }
    if (k === "markets") {
      const rows = v.map(m => printEntry(m, indent + 4));
      return `${pad}  "markets": [\n${rows.join(",\n")}\n${pad}  ]`;
    }
    return `${pad}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `${pad}{\n${lines.join(",\n")}\n${pad}}`;
}
function printSnapshot(name, arr) {
  return `const ${name} = [\n${arr.map(e => printEntry(e, 2)).join(",\n")}\n];\n`;
}

const poly = [];
for (const entry of oldPoly) poly.push(await freshPolymarket(entry));
const manifold = [];
for (const entry of oldManifold) manifold.push(await freshManifold(entry));

const out =
  `const PREDMARKET_SNAPSHOT_DATE = ${JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, "Z"))};\n` +
  header +
  printSnapshot("POLYMARKET_SNAPSHOT", poly) + "\n" +
  printSnapshot("MANIFOLD_SNAPSHOT", manifold);

fs.writeFileSync(FILE, out);
console.log(`refreshed ${poly.length} polymarket + ${manifold.length} manifold markets`);
for (const w of warnings) console.log("WARNING: " + w);

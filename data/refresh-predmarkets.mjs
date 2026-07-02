#!/usr/bin/env node
// Regenerates data/predmarkets.js in place: refetches every snapshot market's
// live prices/volumes (same shaping as crashla.js's fetchPolymarketEvent /
// fetchManifoldMarket), preserves each entry's slug/enabled curation and the
// header comment, and bumps PREDMARKET_SNAPSHOT_DATE. Markets that have
// RESOLVED are not dropped automatically — the script warns so a human can
// disable or replace them (curation is a human call).
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

async function freshPolymarket(entry) {
  const events = await fetchJson(
    "https://gamma-api.polymarket.com/events?slug=" + encodeURIComponent(entry.slug));
  if (events.length === 0) throw new Error("no events for slug " + entry.slug);
  const ev = events[0];
  if (ev.closed) warnings.push(`RESOLVED/CLOSED: polymarket ${entry.slug} — disable or replace it`);
  const kept = new Set(entry.markets.map(m => m.question));
  return {
    title: ev.title,
    slug: entry.slug,
    enabled: entry.enabled,
    volume: parseFloat(ev.volume) || 0,
    markets: (ev.markets || []).filter(m => kept.has(m.question)).map(m => ({
      question: m.question,
      outcomes: m.outcomes,
      outcomePrices: m.outcomePrices,
      volume: m.volume || "0",
    })),
  };
}

async function freshManifold(entry) {
  const m = await fetchJson(
    "https://api.manifold.markets/v0/slug/" + encodeURIComponent(entry.slug));
  if (m.isResolved) warnings.push(`RESOLVED: manifold ${entry.slug} — disable or replace it`);
  const binary = m.outcomeType === "BINARY";
  const out = { question: m.question, slug: entry.slug, url: m.url, enabled: entry.enabled };
  if (binary) out.probability = m.probability;
  else out.answers = m.answers
    .slice().sort((a, b) => a.index - b.index)
    .map(a => ({ label: a.text, prob: a.probability }));
  out.volume = m.volume || 0;
  return out;
}

// Serialize matching the file's existing layout: JSON.stringify-style
// two-space indenting, except `answers` entries stay one line each.
function printEntry(obj, indent) {
  const pad = " ".repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => {
    if (k === "answers") {
      const rows = v.map(a => `${pad}    {"label": ${JSON.stringify(a.label)}, "prob": ${JSON.stringify(a.prob)}}`);
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

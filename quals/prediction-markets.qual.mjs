import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const marketScript = fs.readFileSync("data/predmarkets.js", "utf8");

class ElementStub {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.listeners = {};
    this._innerHTML = "";
    this.style = {};
    this.classList = { toggle() {}, add() {} };
  }

  appendChild(child) { this.children.push(child); return child; }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] || []), fn];
  }

  append(...nodes) { this.children.push(...nodes); }

  querySelector() { return null; }

  set textContent(v) {
    this._innerHTML = String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    this.children = [];
  }

  get textContent() { return this._innerHTML; }

  set innerHTML(v) { this._innerHTML = v; this.children = []; }

  get innerHTML() { return this._innerHTML; }
}

const nodeById = new Map();
const ctx = vm.createContext({
  console,
  Math,
  Number,
  setInterval: () => 1,
  clearInterval: () => {},
  document: {
    getElementById: id => {
      if (!nodeById.has(id)) nodeById.set(id, new ElementStub("div"));
      return nodeById.get(id);
    },
    createElement: tag => new ElementStub(tag),
  },
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(marketScript, ctx, { filename: "predmarkets.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// --- 1. Snapshot integrity ---

const snap = JSON.parse(JSON.stringify(vm.runInContext(
  `({pm: POLYMARKET_SNAPSHOT, mani: MANIFOLD_SNAPSHOT, date: PREDMARKET_SNAPSHOT_DATE})`, ctx)));

assert.ok(
  snap.pm.length > 0 && snap.mani.length > 0 && !Number.isNaN(Date.parse(snap.date)),
  `Replicata: load data/predmarkets.js snapshots.
Expectata: non-empty Polymarket and Manifold snapshots with a parseable date.
Resultata: pm=${snap.pm.length}, mani=${snap.mani.length}, date=${snap.date}.`,
);

for (const ev of snap.pm) {
  for (const m of ev.markets) {
    const outcomes = JSON.parse(m.outcomes);
    const prices = JSON.parse(m.outcomePrices).map(Number);
    assert.ok(
      outcomes.length === prices.length && prices.every(p => p >= 0 && p <= 1),
      `Replicata: parse outcomes/outcomePrices for Polymarket market ${JSON.stringify(m.question)}.
Expectata: matching lengths and prices in [0, 1].
Resultata: outcomes=${JSON.stringify(outcomes)}, prices=${JSON.stringify(prices)}.`,
    );
  }
}

for (const m of snap.mani) {
  // Binary markets carry one probability; multi-answer markets an answers list.
  const outcomes = m.answers || [{label: "Yes", prob: m.probability}];
  assert.ok(
    m.url.startsWith("https://manifold.markets/") && m.volume >= 0 &&
      outcomes.length > 0 &&
      outcomes.every(o => typeof o.label === "string" && o.prob > 0 && o.prob < 1),
    `Replicata: inspect Manifold snapshot entry ${JSON.stringify(m.slug)}.
Expectata: manifold.markets URL, non-negative volume, every outcome a labeled probability strictly inside (0, 1).
Resultata: url=${m.url}, outcomes=${JSON.stringify(outcomes)}, volume=${m.volume}.`,
  );
}

// --- 2. fmtMana boundaries ---

const mana = JSON.parse(JSON.stringify(vm.runInContext(
  `[fmtMana(500), fmtMana(863571), fmtMana(1500000)]`, ctx)));
assert.deepEqual(
  mana,
  ["Ṁ500", "Ṁ864K", "Ṁ1.5M"],
  `Replicata: format Manifold volumes 500, 863571, 1500000.
Expectata: mana-denominated strings Ṁ500 / Ṁ864K / Ṁ1.5M.
Resultata: ${JSON.stringify(mana)}.`,
);

// --- 3. Panel renders one card per enabled market from both sources ---

const panelStats = JSON.parse(JSON.stringify(vm.runInContext(`
(() => {
  renderPredmarketsPanel(POLYMARKET_SNAPSHOT, MANIFOLD_SNAPSHOT, PREDMARKET_SNAPSHOT_DATE);
  const panel = document.getElementById("predmarket-panel");
  const grid = panel.children[0];
  const cardHtml = grid.children.map(c => c.innerHTML);
  // A single-outcome market is 1 card; a multi-outcome market is a header card
  // plus one subcard per outcome.
  const polyCards = ev => ev.markets.length > 1 ? ev.markets.length + 1 : 1;
  const maniCards = m => m.answers ? m.answers.length + 1 : 1;
  const polys = POLYMARKET_SNAPSHOT.filter(e => e.enabled !== false);
  const manis = MANIFOLD_SNAPSHOT.filter(m => m.enabled !== false);
  return {
    nCards: grid.children.length,
    expected: polys.reduce((s, ev) => s + polyCards(ev), 0)
            + manis.reduce((s, m) => s + maniCards(m), 0),
    manifoldCards: cardHtml.filter(h => h.includes("manifold.markets")).length,
    expectedManifoldCards: manis.reduce((s, m) => s + maniCards(m), 0),
    manaCards: cardHtml.filter(h => h.includes("Ṁ")).length,
    enabledManifold: manis.length,
    headerCards: cardHtml.filter(h => h.includes("<b>")).length,
    expectedHeaders: polys.filter(ev => ev.markets.length > 1).length
                   + manis.filter(m => m.answers).length,
  };
})()
`, ctx)));

assert.equal(
  panelStats.nCards,
  panelStats.expected,
  `Replicata: render the prediction markets panel from both snapshots.
Expectata: one card per single-outcome market, plus a header + one subcard per outcome for each multi-outcome market.
Resultata: ${panelStats.nCards} cards, expected ${panelStats.expected}.`,
);

assert.ok(
  panelStats.manifoldCards === panelStats.expectedManifoldCards &&
    panelStats.manaCards === panelStats.enabledManifold,
  `Replicata: inspect rendered Manifold cards.
Expectata: every Manifold card (single, header, or subcard) links to manifold.markets, and each market shows exactly one Ṁ volume (on its single card or header, never its subcards).
Resultata: ${panelStats.manifoldCards} manifold links (expected ${panelStats.expectedManifoldCards}), ${panelStats.manaCards} mana volumes, ${panelStats.enabledManifold} enabled.`,
);

assert.equal(
  panelStats.headerCards,
  panelStats.expectedHeaders,
  `Replicata: count the bold header cards rendered for multi-outcome markets (e.g. the Manifold "what year" date markets).
Expectata: one header per multi-outcome market and none for single-outcome markets.
Resultata: ${panelStats.headerCards} headers, expected ${panelStats.expectedHeaders}.`,
);

// --- 4. Refresh path regressions (source-level: the network calls themselves
// can't run in quals, which is how the dead proxy went unnoticed) ---

assert.ok(
  !appScript.includes("codetabs"),
  `Replicata: search crashla.js for the dead CORS proxy.
Expectata: gamma-api is fetched directly (it serves access-control-allow-origin: *); no codetabs proxy.
Resultata: codetabs proxy still referenced.`,
);

assert.ok(
  appScript.includes("void refreshPredmarkets()"),
  `Replicata: inspect loadPredmarketData source.
Expectata: live prices auto-refresh on page load (not only via the refresh button).
Resultata: no auto-refresh call found.`,
);

assert.ok(
  appScript.includes("api.manifold.markets/v0/slug/"),
  `Replicata: inspect the Manifold fetch path.
Expectata: refresh fetches Manifold markets by slug from the v0 API.
Resultata: Manifold API call missing.`,
);

console.log("qual pass: prediction markets render and refresh from both Polymarket and Manifold");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

const marketScript = fs.readFileSync("data/polymarket.js", "utf8");

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
vm.runInContext(marketScript, ctx, { filename: "polymarket.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// --- 1. Snapshot integrity ---

const snap = JSON.parse(JSON.stringify(vm.runInContext(
  `({pm: POLYMARKET_SNAPSHOT, mani: MANIFOLD_SNAPSHOT, date: POLYMARKET_SNAPSHOT_DATE})`, ctx)));

assert.ok(
  snap.pm.length > 0 && snap.mani.length > 0 && !Number.isNaN(Date.parse(snap.date)),
  `Replicata: load data/polymarket.js snapshots.
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
  assert.ok(
    m.url.startsWith("https://manifold.markets/") &&
      m.probability > 0 && m.probability < 1 && m.volume >= 0,
    `Replicata: inspect Manifold snapshot entry ${JSON.stringify(m.slug)}.
Expectata: manifold.markets URL and probability strictly inside (0, 1).
Resultata: url=${m.url}, p=${m.probability}, volume=${m.volume}.`,
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
  renderPolymarketPanel(POLYMARKET_SNAPSHOT, MANIFOLD_SNAPSHOT, POLYMARKET_SNAPSHOT_DATE);
  const panel = document.getElementById("polymarket-panel");
  const grid = panel.children[0];
  const cardHtml = grid.children.map(c => c.innerHTML);
  const expected = POLYMARKET_SNAPSHOT.filter(e => e.enabled !== false)
    .reduce((sum, ev) => sum + (ev.multi && ev.markets.length > 1
      ? ev.markets.length + 1 : 1), 0)
    + MANIFOLD_SNAPSHOT.filter(m => m.enabled !== false).length;
  return {
    nCards: grid.children.length,
    expected,
    manifoldCards: cardHtml.filter(h => h.includes("manifold.markets")).length,
    manaCards: cardHtml.filter(h => h.includes("Ṁ")).length,
    enabledManifold: MANIFOLD_SNAPSHOT.filter(m => m.enabled !== false).length,
  };
})()
`, ctx)));

assert.equal(
  panelStats.nCards,
  panelStats.expected,
  `Replicata: render the prediction markets panel from both snapshots.
Expectata: one card per enabled market (plus one header per multi event).
Resultata: ${panelStats.nCards} cards, expected ${panelStats.expected}.`,
);

assert.ok(
  panelStats.manifoldCards === panelStats.enabledManifold &&
    panelStats.manaCards === panelStats.enabledManifold,
  `Replicata: inspect rendered Manifold cards.
Expectata: every enabled Manifold market renders one card linking to manifold.markets with a Ṁ volume.
Resultata: ${panelStats.manifoldCards} manifold links, ${panelStats.manaCards} mana volumes, ${panelStats.enabledManifold} enabled.`,
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
  appScript.includes("void refreshPolymarket()"),
  `Replicata: inspect loadPolymarketData source.
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

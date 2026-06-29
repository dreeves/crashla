// Prediction-market cards render market `question`/title (as link text) and
// `url` (as an href). Those are live-fetched from Manifold/Polymarket and are
// creator-editable (a Manifold market's title and url come straight off the API
// in fetchManifoldMarket), so they're untrusted: a hostile title like
// `<img src=x onerror=…>` or a url with a quote-breakout must NOT survive into
// the DOM. This pins the escaping so nobody can quietly drop the escHtml/escAttr
// wrappers in renderMarketCard / appendMarketGroup.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Minimal element so the escaping helpers run (escHtml/escAttr both go through
// document.createElement: set textContent, read innerHTML). textContent→innerHTML
// escapes & < > like a real browser but NOT quotes — which is exactly why an
// href value needs escAttr (escHtml + quote-escaping) on top.
function makeEl() {
  let html = "";
  return {
    className: "",
    classList: { add() {} },
    set textContent(v) {
      html = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    set innerHTML(v) { html = String(v); },
    get innerHTML() { return html; },
    appendChild() {},
  };
}
const documentStub = { createElement: () => makeEl() };

const ctx = vm.createContext({
  console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date,
  document: documentStub,
});
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

// A hostile title + url, as could arrive from a live (creator-editable) fetch.
const XSS_Q = `<img src=x onerror=alert(1)>`;
const XSS_URL = `https://x.test/" onmouseover="alert(1)`;

const html = vm.runInContext(
  `renderMarketCard(${JSON.stringify(XSS_Q)}, ${JSON.stringify(XSS_URL)}, 0.5, "$1M").innerHTML`,
  ctx);

// 1. Hostile title must be escaped as text, not parsed as an <img> element.
assert.ok(!/<img/i.test(html) && html.includes("&lt;img"),
  `Replicata: render a market card whose question is ${JSON.stringify(XSS_Q)}.
Expectata: the literal "<img" never appears (escaped to "&lt;img") so no element is injected.
Resultata: ${html}`);

// 2. Hostile url must not break out of the href: its embedded double-quote has
//    to become &quot;, so the "<quote> onmouseover=" breakout sequence can't form.
assert.ok(!html.includes('" onmouseover') && html.includes("&quot;"),
  `Replicata: render a market card whose url is ${JSON.stringify(XSS_URL)}.
Expectata: the url's double-quote is escaped to "&quot;" so no bare onmouseover= attribute can be injected.
Resultata: ${html}`);

console.log("qual pass: prediction-market card escapes hostile question (link text) and url (href attribute)");

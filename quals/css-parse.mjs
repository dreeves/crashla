// Shared helper: split a stylesheet into (selector, body, context) rules and
// read declarations out of a rule body. Same shape as the parser inside
// sketch-style.qual.mjs, factored out for the quals written after it.
import assert from "node:assert/strict";

// Comment-free CSS, so /* ... */ text can never satisfy a match.
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Descend through conditional at-rules so a mobile-only rule is still
// reported under its own selector, with the at-rule chain in `context`.
export function rules(text, context = []) {
  const out = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open === -1) break;
    const sel = text.slice(cursor, open).trim();
    let close = open + 1;
    let depth = 1;
    let quote = null;
    for (; close < text.length && depth > 0; close++) {
      const ch = text[close];
      if (quote !== null) {
        if (ch === "\\") close++;
        else if (ch === quote) quote = null;
      } else if (ch === "\"" || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
    }
    assert.equal(depth, 0, `unbalanced CSS block beginning ${JSON.stringify(sel)}`);
    const body = text.slice(open + 1, close - 1);
    if (/^@(media|supports|container|layer|scope|document)\b/i.test(sel)) {
      out.push(...rules(body, [...context, sel]));
    } else {
      out.push({ sel, body, context });
    }
    cursor = close;
  }
  return out;
}

export function decls(body, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...body.matchAll(
    new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "gi"),
  )].map(match => match[1].trim());
}

export function onlyDecl(body, property, owner) {
  const values = decls(body, property);
  assert.equal(
    values.length,
    1,
    `${owner} must declare ${property} exactly once; found ${JSON.stringify(values)}`,
  );
  return values[0];
}

// Selector list as trimmed compound selectors.
export function selectors(rule) {
  return rule.sel.split(",").map(s => s.trim()).filter(Boolean);
}

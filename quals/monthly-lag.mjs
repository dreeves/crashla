// Shared helper: the helmer-months inside data/slurp.py's MONTHLY_ARRIVAL_LAG
// (each helmer's extra Monthly-report lag, in releases), i.e. the lag's months
// just before the NHTSA data-through month, whose Monthly-track reports have
// not reached the public file yet. Returned as a Set of "Helmer|YYYY-MM" keys.
// Read from the literal, so the quals that check which months are partially
// received follow a release's re-measured lag without a re-pin.
import assert from "node:assert/strict";
import fs from "node:fs";

export function monthlyLagKeys(dataThroughMonth) {
  const src = fs.readFileSync("data/slurp.py", "utf8");
  const hit = src.match(/^MONTHLY_ARRIVAL_LAG = (\{[^}\n]*\})$/m);
  assert.ok(hit, "data/slurp.py: MONTHLY_ARRIVAL_LAG is not a one-line dict literal");
  const shift = (month, n) => {
    const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
    return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
  };
  return new Set(Object.entries(JSON.parse(hit[1])).flatMap(([helmer, lag]) =>
    Array.from({ length: lag }, (_, i) => `${helmer}|${shift(dataThroughMonth, i - lag)}`)));
}

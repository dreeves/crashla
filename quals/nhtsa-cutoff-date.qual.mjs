// NHTSA_DATA_THROUGH_DATE must be the receipt cutoff NHTSA itself states.
// NHTSA's SGO data-dictionary change log labels each release "Data release of
// reports received through <date>", and that date is the 15th of the month
// before the release rolled forward to the next business day: Nov 15 2025
// (Sat) -> Nov 17; Feb 15 2026 (Sun, then Presidents' Day) -> Feb 17; Mar 15
// 2026 (Sun) -> Mar 16; Aug 15 2026 (Sat) -> Aug 17 ("9/15/2026 Data release
// of reports received through August 17, 2026"). The only federal holidays
// that can fall on the 15th-17th are MLK Day (3rd Monday of January) and
// Washington's Birthday (3rd Monday of February). If NHTSA ever departs from
// this rule, this qual fails and a human reads the change log.
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../data/slurp.py", import.meta.url), "utf8");
const m = src.match(/^NHTSA_DATA_THROUGH_DATE = "(\d{4})-(\d{2})-(\d{2})"$/m);
assert.ok(m, "Replicata: read NHTSA_DATA_THROUGH_DATE from data/slurp.py.\nExpectata: an ISO date literal.\nResultata: not found.");
const [year, month] = [Number(m[1]), Number(m[2])];

const thirdMonday = mon => {
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  return 1 + ((8 - firstDow) % 7) + 14;
};
const holidays = new Set([`1-${thirdMonday(1)}`, `2-${thirdMonday(2)}`]);
const isBusinessDay = d => {
  const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(`${month}-${d}`);
};
const day = [15, 16, 17, 18, 19].find(isBusinessDay);
const want = `${m[1]}-${m[2]}-${String(day).padStart(2, "0")}`;
const have = `${m[1]}-${m[2]}-${m[3]}`;
assert.equal(have, want,
  `Replicata: compare data/slurp.py's NHTSA_DATA_THROUGH_DATE with NHTSA's receipt-cutoff rule for ${m[1]}-${m[2]}.
Expectata: ${want} (the 15th, rolled forward past weekends and MLK/Presidents' Day, as NHTSA's change log states each release).
Resultata: ${have}.`);

console.log(`qual pass: NHTSA_DATA_THROUGH_DATE ${have} is NHTSA's stated receipt cutoff`);

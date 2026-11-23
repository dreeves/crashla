// Tesla's every-mode line in the months it is built from the no-monitor line
// (July 2026 on: Tesla's chart of miles from every mode ended with its
// Q2-2026 deck), shared by quals/tesla-unsupervised-floor.qual.mjs (July to
// September 2026) and quals/tesla-camera-miles.qual.mjs (October 2026 on).
// The month's miles are the no-monitor miles plus the monitor-aboard miles,
// which Tesla does not publish; the two parts' errors are taken as
// independent and their ranges combined in quadrature, on both edges (the
// human, 2026-11-23, "ok fine", after the two errors were found to be close
// to unrelated: the main unknown in the monitor-aboard miles, how much
// monitor-aboard driving continued after June, has nothing to do with Tesla's
// page):
//   central = the no-monitor central + MONITOR_ABOARD, June 2026's measured
//     monitor-aboard remainder (the Q2-2026 deck's 157,000 paid miles less the
//     page's 123,823 no-monitor miles), held flat;
//   floor = central x e^-sqrt(ln(no-monitor central / no-monitor floor)^2 +
//     ln(central / no-monitor central)^2), the second term the monitor-aboard
//     miles falling to none;
//   top = central x e^sqrt(ln(no-monitor top / no-monitor central)^2 +
//     ln(MONITOR_ABOARD_CAP x no-monitor central / central)^2), the second
//     term a monitor-aboard share at June's 21% (1 / (1 - 0.21), about 1.27).
// Until 2026-11-23 the top alone took this rule; the floor was the no-monitor
// floor for October and November 2026, and the lower of Tesla's two
// no-monitor readings for July to September (2026-11-20 spec finding (c)).
import assert from "node:assert/strict";

// Declared plainly and exported below, so that quals/assumptions-list.qual.mjs
// reads them as it reads any qual's top-level consts.
const MONITOR_ABOARD = 33000;
const MONITOR_ABOARD_CAP = 1.27;

function everyMode({ c, lo, hi }) {
  assert.ok(Number.isFinite(lo) && Number.isFinite(c) && Number.isFinite(hi) && 0 < lo && lo <= c && c <= hi,
    `everyMode: the no-monitor band must hold 0 < floor <= central <= top; got ${JSON.stringify({ lo, c, hi })}`);
  const C = c + MONITOR_ABOARD;
  return {
    c: C,
    lo: C * Math.exp(-Math.hypot(Math.log(c / lo), Math.log(C / c))),
    hi: C * Math.exp(Math.hypot(Math.log(hi / c), Math.log(MONITOR_ABOARD_CAP * c / C))),
  };
}

export { MONITOR_ABOARD, MONITOR_ABOARD_CAP, everyMode };

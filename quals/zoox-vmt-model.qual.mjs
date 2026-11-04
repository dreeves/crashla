import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv } from "./csv-parse.mjs";

// Zoox's rows from June 2025 on follow one model (data/README.md, Zoox
// anchors), which this qual recomputes from its inputs.
//
// The miles (2026-11-03, the human's answer to open question 29, "All four as
// ranges"; from 2026-11-02 until then the smooth path ran through 2025 only,
// the 2026 rows holding the March and August statements at their midpoints
// between the path's Dec-31 lifetime and each other; until 2026-11-02 a
// constant tilt put the 1M crossing on Dec 4 and held Dec 31 at exactly 1.3M,
// a December spike):
//   - California: June-November 2025, the CA DMV's driverless miles (permit
//     AVDT004); December 2025, in no DMV report yet, November's times CPUC's
//     December/November ratio, its range CPUC's December (a floor) to that
//     figure over 0.6 (the 60% pilot-share reading); from January 2026,
//     CPUC's driverless pilot miles (TCP 0038380-P) x 1.19 for the
//     DMV-reported driverless miles CPUC misses (an assumption: the midpoint
//     of 1.05-1.33, the DMV/CPUC ratio having fallen from 3.97 to 1.33 over
//     Apr-Nov 2025), measured through June and grown e^0.05 a calendar month
//     after it.
//   - The rest, mostly Las Vegas: one rate per Las Vegas driving day each
//     month (January 2026's outage, Jan 22-26, taken as 5 days without Las
//     Vegas driving), on the smoothest path, the one whose rates change least
//     from month to month (the least sum of squared month-to-month changes in
//     their logarithm), from May 2025 (fixed: the early rows' rule, Las Vegas
//     = California) through the series' last month, ghost months included,
//     that keeps all four of Zoox's cumulative statements within their ranges
//     and the end-July floor below, lifetime being the series plus the 40,080
//     pre-series driverless miles and each month's miles counting as spread
//     evenly over its days:
//       the 1M lifetime mark crossed during Dec 1-7, 2025 (Fortune, Dec 8,
//         2025: "just last week");
//       "approximately 1.3 million driverless autonomous miles" at Dec 31,
//         2025 (letter to NHTSA, Jan 28, 2026), read as [1.25M, 1.35M];
//       "nearly two million autonomous miles" at Mar 24, 2026, read as
//         [1.88M, 2.00M];
//       "more than 3 million miles on public roads" at Aug 5, 2026, read as
//         [3.00M, 3.20M].
//     No statement comes after Aug 5, so the path holds August's rate from
//     then on (the old rule, "held flat after Aug 5", now a consequence).
//     The binding statements are listed (BINDING below) and checked: the qual
//     solves the path with them held as equalities and checks that this is a
//     strict local minimum of the whole problem (every other statement holds
//     strictly, each binding one's multiplier is positive, and the
//     Lagrangian's Hessian is positive definite on the directions that keep
//     them), which a wrong list fails. (On 2026-11-03 a general constrained
//     solver from 60 random starts found no smoother path.)
//   - Rounding: 2025's months to whole miles, December absorbing the residue;
//     2026's to 10,000 (the statements are rounded by 3-7%).
//   - Bands, June-December 2025: California plus half to twice the Las Vegas
//     share (the allowance the early rows give an unmeasured Las Vegas
//     split), within what the statements allow: each month inside the
//     difference of its lifetime cumulative bands, swept from May's lifetime
//     band (its series band plus the pre-series miles' band) with knots at
//     November (the crossing: not before Dec 1, by the end of Dec 7 with
//     December's miles at most its California high plus twice its Las Vegas
//     share) and December (the 1.3M statement). Edges round outward.
//   - The three earlier shapes stay inside the June-December bands, the
//     10e2343 rows, the 2026-10-31 reshape and the 2026-11-02 smooth path
//     (2025's statements only), except December's 10e2343 value, which the
//     statements rule out (at least 250,000: 1.25M at Dec 31 less 1M at Nov
//     30). (Until 2026-11-03 this held the first two only.)
//   - Bands, 2026: vmt x e^(-1.96 sigma) to vmt x e^(1.96 sigma'), sigma =
//     sqrt(0.065^2 + 0.07^2 h + 0.09^2) (statement rounding, drift, month
//     noise), h = months from the midpoint of the stretch between the
//     statements around the month (January-March: Jan 1-Mar 24; April on:
//     Mar 25-Aug 5) to the month's; sigma' adds 0.10 in quadrature from
//     October, when fleet growth was announced but not quantified (the NTA's
//     100-vehicle cap expired Sep 25). Edges round to 1,000.
//
// Cumulative bands: one sweep over the whole series from its exact zero
// (May 2024), forward with the monthly bands and back from each knot: the
// November 2025 crossing and the December 2025 knot (above), a knot at
// end-March and a floor at end-July from the March and August statements
// (each read as of up to a week before its date, less the 40,080 pre-series
// driverless miles at their own band, 30,127.3 to 59,986.6, then carried to
// the month's end at 0.7x-1.3x the model's daily miles, rounded outward).
// The July bound is a floor only: "more than" sets no ceiling, and Zoox's own
// "more than one million autonomous miles" of Mar 11, 2026 came when the
// series stood near 1.84M. The early rows' monthly bands (May 2024-May 2025,
// the 2026-10-03 rule) are read from the master.

const rows = parseCsv(fs.readFileSync("data/vmt.csv", "utf8")).slice(1)
  .filter(p => p[0] === "zoox")
  .map(p => ({ month: p[1], vmt: +p[2], cume: +p[3], kmin: +p[4], kmax: +p[5], vmin: +p[6], vmax: +p[7] }));
const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));
const nextMonth = m => { const n = +m.slice(0, 4) * 12 + +m.slice(5, 7); return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; };
assert.ok(rows.length > 0 && rows[0].month === "2024-05" && rows.every((r, i) => i === 0 || r.month === nextMonth(rows[i - 1].month)),
  `Replicata: list data/vmt.csv's zoox months.
Expectata: consecutive months starting at 2024-05.
Resultata: ${JSON.stringify(rows.map(r => r.month))}.`);
const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const monthNo = m => +m.slice(0, 4) * 12 + +m.slice(5, 7);
const round = (x, unit) => Math.round(x / unit) * unit;

const PRE = [20174.2 + 0.5 * 19906.2, 20174.2 + 2 * 19906.2]; // pre-series driverless miles' band
const PRE_C = 40080; // its central, as the series counts it (20,174.2 + 19,906.2)
const S0 = [1250000, 1350000];
const S1 = [1880000, 2000000];
const S2 = [3000000, 3200000];
const CROSS = 1000000;

// --- Inputs ---------------------------------------------------------------------
// California: the CA DMV's driverless miles (permit AVDT004) June-November
// 2025, December from CPUC's December/November ratio; CPUC's driverless
// miles x 1.19 from January 2026, measured through June, then June's daily
// rate grown e^GROWTH a calendar month.
const CA_DMV = { "2025-06": 22507.9, "2025-07": 26629.5, "2025-08": 36071.5, "2025-09": 35016.9, "2025-10": 42285.5, "2025-11": 56274.8 };
const CPUC_NOV_2025 = 42347.31, CPUC_DEC_2025 = 36481.55;
const CA_2025 = { ...CA_DMV, "2025-12": CA_DMV["2025-11"] * CPUC_DEC_2025 / CPUC_NOV_2025 };
const CA_2025_LO = { ...CA_DMV, "2025-12": CPUC_DEC_2025 };
const CA_2025_HI = { ...CA_DMV, "2025-12": CPUC_DEC_2025 / 0.6 };
const CPUC = {
  "2026-01": 31996.94, "2026-02": 38162.55, "2026-03": 51137.72,
  "2026-04": 47322.83, "2026-05": 65708.40, "2026-06": 67922.81,
};
const DMV_FACTOR = 1.19;
const GROWTH = 0.05;
const caDay = m => m <= "2026-06" ? CPUC[m] / daysIn(m)
  : CPUC["2026-06"] / 30 * Math.exp(GROWTH * (monthNo(m) - monthNo("2026-06")));
// Days without Las Vegas driving: January 2026's passenger outage, Jan 22-26.
const LV_PAUSE = { "2026-01": 5 };
const may = byMonth["2025-05"];
assert.ok(may !== undefined, "Replicata: find zoox 2025-05 in data/vmt.csv. Expectata: present. Resultata: missing.");
const LV_MAY_RATE = may.vmt / 2 / daysIn("2025-05"); // the early rows' rule: Las Vegas = California

// The path's months: every zoox row from June 2025 on, ghost months included
// (until 2026-10-31 the 2026 list was fixed, ending at 2026-10, so the
// November row each release adds went unchecked: audit 2026-10-30, QT-10 and
// R8).
const M = rows.map(r => r.month).filter(m => m >= "2025-06");
assert.ok(M[0] === "2025-06" && M.includes("2026-08"),
  `Replicata: list data/vmt.csv's zoox months from 2025-06 on.
Expectata: consecutive months from 2025-06 through at least 2026-08 (the last statement's month).
Resultata: ${JSON.stringify(M)}.`);
const N = M.length;
const CA = M.map(m => CA_2025[m] ?? DMV_FACTOR * caDay(m) * daysIn(m));
const LV_DAYS = M.map(m => daysIn(m) - (LV_PAUSE[m] ?? 0));

// --- The path ---------------------------------------------------------------------
// Every quantity a statement bounds is linear in the monthly Las Vegas rates
// x (miles a Las Vegas driving day): a form {a, c} stands for a + sum c_k x_k.
const lin = (a, c = new Array(N).fill(0)) => ({ a, c });
const add = (...fs) => lin(fs.reduce((s, f) => s + f.a, 0), M.map((_, k) => fs.reduce((s, f) => s + f.c[k], 0)));
const scale = (f, s) => lin(s * f.a, f.c.map(v => s * v));
const value = (f, x) => f.a + f.c.reduce((s, v, k) => s + v * x[k], 0);
const monthMiles = m => { const c = new Array(N).fill(0); c[M.indexOf(m)] = LV_DAYS[M.indexOf(m)]; return lin(CA[M.indexOf(m)], c); };
// The lifetime at the end of day d of month m.
const lifetimeAt = (m, d) => add(lin(may.cume + PRE_C), ...M.slice(0, M.indexOf(m)).map(monthMiles), scale(monthMiles(m), d / daysIn(m)));
// The end-July floor (Cumulative bands, below): 3.00M less the pre-series
// miles' high edge and up to 1.3x the model's miles for Aug 1-5.
const JULY_FLOOR = add(lin(S2[0] - PRE[1]), scale(monthMiles("2026-08"), -1.3 * 5 / daysIn("2026-08")));
// Each statement as h >= 0, h a form.
const atLeast = (f, v) => add(f, lin(-v));
const atMost = (f, v) => add(lin(v), scale(f, -1));
const CONSTRAINTS = {
  "1M not crossed before Dec 1, 2025": atMost(lifetimeAt("2025-11", 30), CROSS),
  "1M crossed by the end of Dec 7, 2025": atLeast(lifetimeAt("2025-12", 7), CROSS),
  "Dec 31, 2025 at least 1.25M": atLeast(lifetimeAt("2025-12", 31), S0[0]),
  "Dec 31, 2025 at most 1.35M": atMost(lifetimeAt("2025-12", 31), S0[1]),
  "Mar 24, 2026 at least 1.88M": atLeast(lifetimeAt("2026-03", 24), S1[0]),
  "Mar 24, 2026 at most 2.00M": atMost(lifetimeAt("2026-03", 24), S1[1]),
  "Aug 5, 2026 at least 3.00M": atLeast(lifetimeAt("2026-08", 5), S2[0]),
  "Aug 5, 2026 at most 3.20M": atMost(lifetimeAt("2026-08", 5), S2[1]),
  "end-July 2026 series at least its floor": add(lifetimeAt("2026-07", 31), lin(-PRE_C), scale(JULY_FLOOR, -1)),
};
const BINDING = ["1M not crossed before Dec 1, 2025", "Dec 31, 2025 at least 1.25M"];

// Roughness: the sum of squared month-to-month changes in ln x from May 2025.
const U_MAY = Math.log(LV_MAY_RATE);
const roughness = u => u.reduce((s, v, k) => s + (v - (k === 0 ? U_MAY : u[k - 1])) ** 2, 0);
const gradR = u => u.map((v, k) => 2 * (v - (k === 0 ? U_MAY : u[k - 1])) - 2 * ((k < N - 1 ? u[k + 1] : v) - v));
const hessR = M.map((_, k) => M.map((_, l) => k === l ? (k < N - 1 ? 4 : 2) : Math.abs(k - l) === 1 ? -2 : 0));
function solveLinear(A, b) {
  const n = b.length, X = A.map((row, r) => [...row, b[r]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(X[r][c]) > Math.abs(X[p][c])) p = r;
    [X[c], X[p]] = [X[p], X[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = X[r][c] / X[c][c];
      for (let cc = c; cc <= n; cc++) X[r][cc] -= f * X[c][cc];
    }
  }
  return X.map((row, r) => row[n] / row[r]);
}
// Newton on the Lagrange conditions grad R = sum_i lambda_i grad h_i, h_i = 0
// (i in BINDING), from a flat path at 5,000 a day. In u = ln x each h_i is
// a + sum_k c_k e^(u_k), so its gradient and its Hessian's diagonal are the
// same vector, c_k x_k, and so are their multiplier-weighted sums (pull).
const B = BINDING.map(name => CONSTRAINTS[name]);
let u = M.map(() => Math.log(5000)), lambda = B.map(() => 0);
const pull = x => M.map((_, k) => B.reduce((s, f, i) => s + lambda[i] * f.c[k] * x[k], 0));
const lagrangeHess = x => { const p = pull(x); return hessR.map((row, k) => row.map((h, l) => h - (k === l ? p[k] : 0))); };
for (let it = 0; it < 100; it++) {
  const x = u.map(Math.exp), g = gradR(u), p = pull(x);
  const J = [...lagrangeHess(x).map((row, k) => [...row, ...B.map(f => -f.c[k] * x[k])]),
    ...B.map(f => [...f.c.map((c, l) => c * x[l]), ...B.map(() => 0)])];
  const d = solveLinear(J, [...g.map((v, k) => p[k] - v), ...B.map(f => -value(f, x))]);
  u = u.map((v, k) => v + d[k]);
  lambda = lambda.map((v, i) => v + d[N + i]);
  if (Math.max(...d.slice(0, N).map(Math.abs)) < 1e-13) break;
}
const x = u.map(Math.exp);
// The strict-local-minimum checks: (a) the binding statements hold exactly,
// (b) every other one strictly, (c) each binding one's multiplier is
// positive (with it dropped, a smoother path would break it), (d) the
// Lagrangian's Hessian is positive definite on the directions that keep the
// binding statements (Cholesky on an orthonormal basis of their gradients'
// null space).
const slack = Object.fromEntries(Object.entries(CONSTRAINTS).map(([name, f]) => [name, value(f, x)]));
const minPivot = (() => {
  const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
  const H = lagrangeHess(x);
  const basis = [];
  for (const v0 of [...B.map(f => f.c.map((c, k) => c * x[k])), ...M.map((_, k) => M.map((_, l) => k === l ? 1 : 0))]) {
    const v = basis.reduce((w, b) => w.map((wk, k) => wk - dot(w, b) * b[k]), v0);
    const n = Math.sqrt(dot(v, v));
    if (n > 1e-9 * Math.sqrt(dot(v0, v0))) basis.push(v.map(vk => vk / n));
  }
  const Z = basis.slice(B.length);
  assert.equal(Z.length, N - B.length,
    `Replicata: take the binding statements' gradients at the path. Expectata: linearly independent (${B.length} of them). Resultata: they span ${N - Z.length} dimensions.`);
  const R = Z.map(z => Z.map(w => dot(z, H.map(row => dot(row, w)))));
  const L = R.map(() => new Array(R.length).fill(0));
  const pivots = [];
  for (let i = 0; i < R.length; i++) for (let j = 0; j <= i; j++) {
    const s = R[i][j] - L[i].slice(0, j).reduce((t, v, k) => t + v * L[j][k], 0);
    if (i === j) { pivots.push(s); L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return pivots.find(s => !(s > 1e-9)) ?? Math.min(...pivots);
})();
const problems = [
  ...BINDING.filter(name => Math.abs(slack[name]) > 1e-3).map(name => `(a) ${name} off by ${slack[name]}`),
  ...Object.keys(CONSTRAINTS).filter(name => !BINDING.includes(name) && !(slack[name] > 0)).map(name => `(b) ${name} broken by ${-slack[name]}`),
  ...BINDING.filter((name, i) => !(lambda[i] > 0)).map(name => `(c) ${name}'s multiplier ${lambda[BINDING.indexOf(name)]}`),
  ...(minPivot > 1e-9 ? [] : [`(d) a Cholesky pivot of ${minPivot}`]),
];
assert.deepEqual(problems, [],
  `Replicata: solve Zoox's smoothest Las Vegas path (one rate per driving day per month, June 2025 through ${M[N - 1]}) with BINDING (${BINDING.join("; ")}) held as equalities.
Expectata: a strict local minimum of the whole problem: (a) the binding statements hold exactly, (b) every other statement and the end-July floor strictly (else add it to BINDING), (c) each binding statement's multiplier positive (else drop it from BINDING), (d) the Lagrangian's Hessian positive definite on the directions that keep the binding statements.
Resultata: ${problems.join("; ")}.`);

// --- Rows -------------------------------------------------------------------------
const T = M.map(m => value(monthMiles(m), x));
const M25 = M.filter(m => m <= "2025-12");
const decCume = Math.round(value(lifetimeAt("2025-12", 31), x) - PRE_C);
const want25 = M25.map((m, k) => Math.round(T[k]));
want25[6] += decCume - may.cume - want25.reduce((a, b) => a + b, 0);
const novCume = may.cume + want25.slice(0, 6).reduce((a, b) => a + b, 0);
const crossingDay = daysIn("2025-12") * (CROSS - PRE_C - novCume) / want25[6];
assert.ok(crossingDay > 0 && crossingDay <= 7 && decCume + PRE_C >= S0[0] && decCume + PRE_C <= S0[1],
  `Replicata: take the rows' 1M crossing and Dec-31 lifetime (the path's months rounded to whole miles, December absorbing the residue).
Expectata: the crossing during Dec 1-7, 2025 and the Dec-31 lifetime in [${S0}], the statements' ranges, as the path holds them.
Resultata: crossing on Dec ${crossingDay.toFixed(4)}, Dec-31 lifetime ${decCume + PRE_C}.`);

// Bands: California plus half to twice the Las Vegas share, within what the
// statements allow on the lifetime basis.
const LV = M25.map((m, k) => LV_DAYS[k] * x[k]);
const band0 = M25.map((m, k) => [CA_2025_LO[m] + 0.5 * LV[k], CA_2025_HI[m] + 2 * LV[k]]);
const crossLo = CROSS - 7 / 31 * band0[6][1];
const knotLife = {"2025-11": [crossLo, CROSS], "2025-12": S0};
const life = [[may.kmin + PRE[0], may.kmax + PRE[1]], ...M25.map(m => knotLife[m] ?? [-Infinity, Infinity])];
for (let j = 1; j <= 7; j++) life[j] = [Math.max(life[j][0], life[j - 1][0] + band0[j - 1][0]), Math.min(life[j][1], life[j - 1][1] + band0[j - 1][1])];
for (let j = 7; j > 0; j--) life[j - 1] = [Math.max(life[j - 1][0], life[j][0] - band0[j - 1][1]), Math.min(life[j - 1][1], life[j][1] - band0[j - 1][0])];
assert.ok(life[0][0] === may.kmin + PRE[0] && life[0][1] === may.kmax + PRE[1],
  `Replicata: sweep Zoox's lifetime cumulative band from end-May 2025 through the November and December 2025 knots.
Expectata: May 2025's band, its series band plus the pre-series miles' band, is not narrowed (the early rows keep their running-sum bands).
Resultata: [${life[0]}] vs [${may.kmin + PRE[0]}, ${may.kmax + PRE[1]}].`);
const expected = {};
M25.forEach((m, k) => {
  expected[m] = {
    vmt: want25[k],
    vmin: Math.floor(Math.max(band0[k][0], life[k + 1][0] - life[k][1])),
    vmax: Math.ceil(Math.min(band0[k][1], life[k + 1][1] - life[k][0])),
  };
});

// The earlier shapes, which the bands must hold unless a statement rules one
// out, each described beside its figures (the assert below lists the
// descriptions from here, so a shape added here is described there too;
// until 2026-11-04 its message wrote out three of them).
const SHAPES = {
  // Crossing about Nov 22, before the Fortune statement allows.
  "10e2343": { what: "the 10e2343 rows",
    vals: [68653, 86733, 109852, 136097, 166865, 204599, 245852] },
  // Crossing Dec 4, Dec 31 at 1.3M; the first fix run, AGENTS.md ledger
  // 2026-11-01.
  "2026-10-31": { what: "the 2026-10-31 reshape",
    vals: [40616, 56015, 81014, 111730, 160082, 231013, 338181] },
  // The least-rough path through 2025's statements only, the 2026 rows then
  // holding the March and August statements at their midpoints (9a8f81e's
  // rows; the second fix run, AGENTS.md ledger 2026-11-02 (later 2)).
  "2026-11-02": { what: "the 2026-11-02 smooth path through 2025's statements",
    vals: [45892, 64849, 95252, 120825, 168940, 219441, 253452] },
};
// Each shape a description and one finite value for each June-December 2025
// month (rule 12: a short entry would compare undefined against its month's
// band, false both ways, and pass silently). The message writes NaN and the
// infinities by name (JSON.stringify alone writes them as null).
for (const [name, shape] of Object.entries(SHAPES)) {
  assert.ok(typeof shape.what === "string" && shape.what !== "" && Array.isArray(shape.vals) &&
    shape.vals.length === M25.length && shape.vals.every(Number.isFinite),
    `Replicata: read SHAPES' entry ${JSON.stringify(name)}.
Expectata: a non-empty "what" and ${M25.length} finite values, one for each of ${M25.join(", ")}.
Resultata: ${JSON.stringify(shape, (key, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v))}.`);
}
const decMin = S0[0] - CROSS; // December at least 1.25M at Dec 31 less 1M at Nov 30
const outside = [];
for (const [name, { vals }] of Object.entries(SHAPES)) {
  M25.forEach((m, k) => {
    const r = byMonth[m];
    const ruledOut = m === "2025-12" && vals[k] < decMin;
    if (!ruledOut && (vals[k] < r.vmin || vals[k] > r.vmax)) outside.push(`${m} ${name} ${vals[k]} outside [${r.vmin}, ${r.vmax}]`);
  });
}
assert.deepEqual(outside, [],
  `Replicata: compare Zoox's June-December 2025 monthly bands with the ${Object.keys(SHAPES).length} earlier shapes of those months (${Object.entries(SHAPES).map(([name, shape]) => `${name}: ${shape.what}`).join("; ")}).
Expectata: every value inside its month's band unless the statements rule it out (December below ${decMin}).
Resultata: ${outside.join("; ")}.`);
assert.ok(byMonth["2025-12"].vmin >= decMin,
  `Replicata: read Zoox's December 2025 band floor.
Expectata: at least ${decMin} (1.25M at Dec 31 less 1M at Nov 30: the statements' least December).
Resultata: ${byMonth["2025-12"].vmin}.`);

// 2026 on: each month rounds to 10,000, its band from the formula above.
// Day of year of each 2026 month's first day, and of its mean day (Jan 16).
const M26 = M.filter(m => m >= "2026-01");
const FIRST = {};
{ let d = 1; for (const m of M26) { FIRST[m] = d; d += daysIn(m); } }
const monthMid = m => FIRST[m] + (daysIn(m) - 1) / 2;
const Q1 = { first: 1, last: 83 };   // Jan 1 - Mar 24
const W2 = { first: 84, last: 217 }; // Mar 25 - Aug 5
const winMid = w => (w.first + w.last) / 2;
for (const m of M26) {
  const vmt = round(T[M.indexOf(m)], 10000);
  const h = Math.abs(monthMid(m) - winMid(m <= "2026-03" ? Q1 : W2)) / 30.44;
  const sigma = Math.sqrt(0.065 ** 2 + 0.07 ** 2 * h + 0.09 ** 2);
  const sigmaUp = m >= "2026-10" ? Math.sqrt(sigma ** 2 + 0.10 ** 2) : sigma;
  expected[m] = {
    vmt,
    vmin: round(vmt * Math.exp(-1.96 * sigma), 1000),
    vmax: round(vmt * Math.exp(1.96 * sigmaUp), 1000),
  };
}

// --- Cumulative bands ------------------------------------------------------------
const perDay = m => T[M.indexOf(m)] / daysIn(m); // the model's miles a day
const knots = {
  "2025-11": [Math.floor(crossLo - PRE[1]), Math.ceil(CROSS - PRE[0])],
  "2025-12": [Math.floor(S0[0] - PRE[1]), Math.ceil(S0[1] - PRE[0])],
  "2026-03": [
    Math.floor(S1[0] - PRE[1] + 0.7 * 7 * perDay("2026-03")),
    Math.ceil(S1[1] - PRE[0] + 1.3 * 14 * perDay("2026-03")),
  ],
  "2026-07": [Math.floor(value(JULY_FLOOR, x)), Infinity],
};
const bandOf = m => expected[m] ?? byMonth[m];
const chain = rows.map(() => ({}));
rows.forEach((r, i) => {
  const prev = i === 0 ? {kmin: 0, kmax: 0} : chain[i - 1];
  const [lo, hi] = knots[r.month] ?? [-Infinity, Infinity];
  chain[i] = {kmin: Math.max(prev.kmin + bandOf(r.month).vmin, lo), kmax: Math.min(prev.kmax + bandOf(r.month).vmax, hi)};
});
for (let i = rows.length - 1; i > 0; i--) {
  chain[i - 1].kmin = Math.max(chain[i - 1].kmin, chain[i].kmin - bandOf(rows[i].month).vmax);
  chain[i - 1].kmax = Math.min(chain[i - 1].kmax, chain[i].kmax - bandOf(rows[i].month).vmin);
}
assert.ok(chain[0].kmin - bandOf(rows[0].month).vmax <= 0 && chain[0].kmax - bandOf(rows[0].month).vmin >= 0,
  `Replicata: sweep Zoox's cumulative bands back to the series start.
Expectata: the start stays exactly zero (no knot contradicts the monthly bands).
Resultata: first month's band [${chain[0].kmin}, ${chain[0].kmax}].`);
const iDec = rows.findIndex(r => r.month === "2025-12");
assert.ok(chain[iDec].kmin === knots["2025-12"][0] && chain[iDec].kmax === knots["2025-12"][1],
  `Replicata: sweep Zoox's cumulative bands forward and back through every knot.
Expectata: December 2025's band is the Dec-2025 knot itself (the other knots agree with it).
Resultata: [${chain[iDec].kmin}, ${chain[iDec].kmax}] vs the knot [${knots["2025-12"]}].`);

const mismatches = [];
let cume = 0;
rows.forEach((r, i) => {
  cume += (expected[r.month] ?? r).vmt;
  const want = {...(expected[r.month] ?? {vmt: r.vmt, vmin: r.vmin, vmax: r.vmax}), cume, kmin: chain[i].kmin, kmax: chain[i].kmax};
  for (const k of ["vmt", "vmin", "vmax", "cume", "kmin", "kmax"]) {
    if (r[k] !== want[k]) mismatches.push(`${r.month} ${k}: ${r[k]} (model ${want[k]})`);
  }
});
assert.deepEqual(mismatches, [],
  `Replicata: recompute Zoox's rows from June 2025 (the one smooth path through all four statements, one cumulative sweep) from its statements and California's miles (this file's header; data/README.md, Zoox anchors).
Expectata: each month's miles, band, cumulative and cumulative band equal the model's.
Resultata: ${mismatches.join("; ")}.`);

const fmt = v => Math.round(v).toLocaleString("en-US");
console.log(`qual pass: Zoox's rows from June 2025 follow the model: the smoothest path through all four statements (roughness ${roughness(u).toFixed(7)}; binding ${BINDING.join(", ")}; Mar 24 at ${fmt(slack["Mar 24, 2026 at least 1.88M"] + S1[0])}, Aug 5 at ${fmt(slack["Aug 5, 2026 at least 3.00M"] + S2[0])}; Las Vegas ${x.slice(0, 7).map(fmt).join(" / ")} a driving day June-December 2025, then ${fmt(x[N - 1])}), the 1M crossing on Dec ${crossingDay.toFixed(4)}, December ${want25[6]}, bands holding the ${Object.keys(SHAPES).length} earlier shapes, knots at end-November [${knots["2025-11"]}], end-December [${knots["2025-12"]}] and end-March [${knots["2026-03"]}], a floor at end-July (${knots["2026-07"][0]})`);

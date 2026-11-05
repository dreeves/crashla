// The standard normal quantile function, normalQuantile (crashla.js), that
// the growth forecasts' two-piece bands take their quantiles from (since
// 2026-11-04, when scenario C became the comonotonic sum of its parts: each
// C component's p-quantile is the sum of its parts' p-quantiles). It is
// algorithm AS 241 (Wichura 1988, PPND16), three rational functions: p within
// 0.425 of one half, and the tails with r = sqrt(-ln(min(p, 1 - p))) at most 5
// and beyond. Checked here against reference values from mpmath at 60 digits
// (each p the double written; each reference rounded to the nearest double),
// with points on both sides of each region's boundary (p = 0.075 and 0.925,
// where |p - 1/2| = 0.425; p = e^-25 = 1.3887943864964021e-11, where r = 5)
// and in both tails; for its 45 coefficients, each the double nearest AS
// 241's published value, the published table itself checked against the hash
// sums Wichura printed for checking transcription; for exact symmetry where
// 1 - p is exact; for strict increase over a dense grid of p; and for a loud
// failure outside (0, 1).
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({
  console, Math, Number, Object, JSON,
  document: { getElementById() { return null; }, createElement() { return { textContent: "", innerHTML: "" }; } },
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
assert.equal(vm.runInContext("typeof normalQuantile", ctx), "function",
  `Replicata: load crashla.js and look up normalQuantile.
Expectata: a function (the standard normal quantile the growth forecasts' bands use).
Resultata: ${vm.runInContext("typeof normalQuantile", ctx)}.`);
const normalQuantile = p => vm.runInContext(`normalQuantile(${p})`, ctx);

// [p, the standard normal quantile at p] (mpmath, 60 digits).
const REFERENCES = [
  [1e-300, -37.0470962993612],
  [1e-100, -21.273453560965326],
  [1e-20, -9.262340089798407],
  [1.3889332659350517e-11, -6.657889942627787], // e^-25 x 1.0001: r just under 5
  [1.3886555209443076e-11, -6.6579193443432825], // e^-25 / 1.0001: r just over 5
  [1e-10, -6.361340902404057],
  [1e-5, -4.264890793922825],
  [0.001, -3.0902323061678136],
  [0.01, -2.326347874040841],
  [0.025, -1.9599639845400543],
  [0.05, -1.6448536269514726],
  [0.0749, -1.4402382675279637],
  [0.075, -1.439531470938456],
  [0.0751, -1.43882539275254],
  [0.1, -1.2815515655446004],
  [0.25, -0.6744897501960817],
  [0.4, -0.2533471031357997],
  [0.5, 0],
  [0.6, 0.2533471031357997],
  [0.75, 0.6744897501960817],
  [0.9, 1.2815515655446006],
  [0.9249, 1.4388253927525403],
  [0.925, 1.4395314709384561],
  [0.9251, 1.440238267527964],
  [0.95, 1.6448536269514722],
  [0.975, 1.9599639845400538],
  [0.99, 2.3263478740408408],
  [0.999, 3.090232306167813],
  [0.99999, 4.264890793923841],
  [0.9999999999, 6.361340889697422],
  [0.999999999999999, 7.941444487415978],
];
// AS 241 is accurate to about one part in 1e16; this allows a few units in
// the last place.
const TOLERANCE = 4e-15;
const off = REFERENCES.map(([p, want]) => ({p, want, got: normalQuantile(p)}))
  .filter(({want, got}) => !(Math.abs(got - want) <= TOLERANCE * Math.max(1, Math.abs(want))));
assert.ok(off.length === 0,
  `Replicata: evaluate normalQuantile (crashla.js) at ${REFERENCES.length} reference points from 1e-300 to 1 - 1e-15.
Expectata: each within ${TOLERANCE} (relative, or absolute under 1) of the standard normal quantile computed by mpmath at 60 digits.
Resultata: ${off.map(({p, want, got}) => `at ${p}: ${got} against ${want}`).join("; ")}.`);

// AS 241's coefficients as published (StatLib,
// https://lib.stat.cmu.edu/apstat/241, PPND16), each as its mantissa and power
// of ten, by region: the numerator's from its constant term up, the
// denominator's from its first term (its constant term is 1), with the hash sum
// the source prints for the region ("the sums of the mantissas of the
// coefficients. They are included for use in checking transcription"). Each
// region's mantissas, summed exactly at their published digits, must make its
// hash sum, which checks this table's own transcription; and each of
// NORMAL_QUANTILE's coefficients must be the double nearest its published
// value, each denominator's constant term 1, and the tails' offsets AS 241's
// CONST2 (1.6) and SPLIT2 (5). Until the sixth fix run's first review
// (2026-11-04) the central denominator's last coefficient (B7) read
// 5226.495278852545925 where the source prints 5.22649 52788 52854 5610D+3, off
// from its 14th significant digit on, by 5.9e-14 relative, which the reference
// values above, each within 4e-15 of normalQuantile, did not see.
const PUBLISHED = {
  central: {hash: "55.8831928806149014439",
    num: [["3.3871328727963666080", 0], ["1.3314166789178437745", 2], ["1.9715909503065514427", 3], ["1.3731693765509461125", 4], ["4.5921953931549871457", 4], ["6.7265770927008700853", 4], ["3.3430575583588128105", 4], ["2.5090809287301226727", 3]],
    den: [["4.2313330701600911252", 1], ["6.8718700749205790830", 2], ["5.3941960214247511077", 3], ["2.1213794301586595867", 4], ["3.9307895800092710610", 4], ["2.8729085735721942674", 4], ["5.2264952788528545610", 3]]},
  near: {hash: "49.33206503301610289036", from: 1.6,
    num: [["1.42343711074968357734", 0], ["4.63033784615654529590", 0], ["5.76949722146069140550", 0], ["3.64784832476320460504", 0], ["1.27045825245236838258", 0], ["2.41780725177450611770", -1], ["2.27238449892691845833", -2], ["7.74545014278341407640", -4]],
    den: [["2.05319162663775882187", 0], ["1.67638483018380384940", 0], ["6.89767334985100004550", -1], ["1.48103976427480074590", -1], ["1.51986665636164571966", -2], ["5.47593808499534494600", -4], ["1.05075007164441684324", -9]]},
  far: {hash: "47.52583317549289671629", from: 5,
    num: [["6.65790464350110377720", 0], ["5.46378491116411436990", 0], ["1.78482653991729133580", 0], ["2.96560571828504891230", -1], ["2.65321895265761230930", -2], ["1.24266094738807843860", -3], ["2.71155556874348757815", -5], ["2.01033439929228813265", -7]],
    den: [["5.99832206555887937690", -1], ["1.36929880922735805310", -1], ["1.48753612908506148525", -2], ["7.86869131145613259100", -4], ["1.84631831751005468180", -5], ["1.42151175831644588870", -7], ["2.04426310338993978564", -15]]},
};
{
  const places = s => s.split(".")[1].length;
  // A decimal written with a point, as an integer count of 10^-n.
  const scaled = (s, n) => {
    const [whole, fraction] = s.split(".");
    return BigInt(whole + fraction.padEnd(n, "0"));
  };
  const written = (v, n) => `${v / 10n ** BigInt(n)}.${(v % 10n ** BigInt(n)).toString().padStart(n, "0")}`;
  assert.equal(vm.runInContext("typeof NORMAL_QUANTILE", ctx), "object",
    `Replicata: load crashla.js and look up NORMAL_QUANTILE.
Expectata: an object, AS 241's coefficients by region.
Resultata: ${vm.runInContext("typeof NORMAL_QUANTILE", ctx)}.`);
  const nq = JSON.parse(vm.runInContext("JSON.stringify(NORMAL_QUANTILE)", ctx));
  const missing = Object.keys(PUBLISHED).filter(region => !(nq[region] instanceof Object && ["num", "den"].every(side => Array.isArray(nq[region][side]))));
  assert.ok(missing.length === 0,
    `Replicata: read crashla.js's NORMAL_QUANTILE.
Expectata: a region for each of AS 241's three rational functions (${Object.keys(PUBLISHED).join(", ")}), each holding its numerator's coefficients (num) and its denominator's (den), each a list.
Resultata: no such region, or no such lists, for ${missing.join(", ")}; NORMAL_QUANTILE's regions: ${Object.keys(nq).join(", ")}.`);
  const problems = [];
  for (const [region, {hash, num, den, from}] of Object.entries(PUBLISHED)) {
    const n = Math.max(places(hash), ...[...num, ...den].map(([m]) => places(m)));
    const sum = [...num, ...den].reduce((s, [m]) => s + scaled(m, n), 0n);
    if (sum !== scaled(hash, n)) problems.push(`${region}: this qual's table's mantissas sum to ${written(sum, n)}, not the published hash sum ${hash}`);
    const code = nq[region];
    // Each coefficient as published, written as it reads in the source.
    const written10 = ([m, e]) => `${m}e${e}`;
    const want = {num: num.map(written10), den: ["1", ...den.map(written10)]};
    for (const side of ["num", "den"]) {
      if (code[side].length !== want[side].length) problems.push(`${region}.${side}: ${code[side].length} coefficients, not ${want[side].length}`);
      want[side].forEach((published, i) => {
        if (code[side][i] !== Number(published)) problems.push(`${region}.${side}[${i}]: ${code[side][i]}, not ${Number(published)}, the double nearest the published ${published}`);
      });
    }
    if (code.from !== from) problems.push(`${region}.from: ${code.from}, not ${from}`);
  }
  assert.ok(problems.length === 0,
    `Replicata: read crashla.js's NORMAL_QUANTILE, and sum each region of this qual's table of AS 241's published coefficients exactly.
Expectata: each region's mantissas summing to the hash sum AS 241 prints for it (55.88319 28806 14901 4439, 49.33206 50330 16102 89036, 47.52583 31754 92896 71629); each coefficient the double nearest its published value, each denominator's constant term 1, and the near and far tails' offsets 1.6 and 5.
Resultata: ${problems.join("; ")}.`);
}

// Exact symmetry where 1 - p is exact (p a multiple of 2^-10), and strict
// increase over a grid of distinct points dense in both tails.
const asymmetric = Array.from({length: 511}, (_, i) => (i + 1) / 1024)
  .filter(p => normalQuantile(1 - p) !== -normalQuantile(p));
assert.ok(asymmetric.length === 0,
  `Replicata: evaluate normalQuantile at p = k / 1024 and at 1 - p, for k = 1 to 511 (1 - p exact).
Expectata: normalQuantile(1 - p) = -normalQuantile(p) exactly.
Resultata: not so at p = ${asymmetric.slice(0, 10).join(", ")}${asymmetric.length > 10 ? ", ..." : ""}.`);
const grid = [...new Set([...Array.from({length: 300}, (_, i) => 10 ** (-300 + i)), ...Array.from({length: 9999}, (_, i) => (i + 1) / 10000),
  ...Array.from({length: 15}, (_, i) => 1 - 10 ** (-1 - i))])].sort((a, b) => a - b);
const zs = grid.map(normalQuantile);
const notIncreasing = grid.slice(1).map((p, i) => [grid[i], p]).filter((_, i) => !(zs[i + 1] > zs[i]));
assert.ok(notIncreasing.length === 0,
  `Replicata: evaluate normalQuantile on ${grid.length} points from 1e-300 to 1 - 1e-15, in increasing order.
Expectata: strictly increasing.
Resultata: not increasing from ${notIncreasing.slice(0, 5).map(([a, b]) => `${a} to ${b}`).join("; ")}.`);

// Outside (0, 1) it fails loudly (anti-Postel), as must NaN.
const quiet = [0, 1, -0.5, 1.5, NaN].filter(p => {
  try { normalQuantile(p); return true; } catch (_e) { return false; }
});
assert.ok(quiet.length === 0,
  `Replicata: evaluate normalQuantile at 0, 1, -0.5, 1.5 and NaN.
Expectata: a throw at each (the quantile is defined for 0 < p < 1).
Resultata: no throw at ${quiet.join(", ")}.`);

console.log(`qual pass: normalQuantile matches ${REFERENCES.length} mpmath references within ${TOLERANCE} from 1e-300 to 1 - 1e-15, its coefficients are AS 241's as published (the table summing to Wichura's hash sums), and it is exactly antisymmetric about 1/2, strictly increasing, and fails outside (0, 1)`);

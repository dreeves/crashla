import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Calibration evidence from measured California, independent of the authored
// US monthly profile; the allowance being evaluated comes from its builder.
// Hide California's individual monthly miles, retain only each block's total,
// and reconstruct its months from neighboring block-average daily rates.
// This checks whether a proposed allocation allowance is plausible on measured
// data; California is a surrogate for the unmeasured remainder, not its truth.
//
// Jan-2024..Jun-2026 contains only 30 observations. The different alignments
// overlap, and months inside a block share its total, so the 58/84/108/130/150
// predictions below are NOT that many independent observations. Their coverage
// at log half-width 0.20*sqrt((n-1)/2), for n=2..6 months, was respectively
// 96.55%, 97.62%, 96.30%, 95.38%, 94.00% on 2026-10-27. Requiring >=90% catches
// substantial undercoverage; it neither certifies nor fits exact 95% coverage.
//
// Aligned quarter blocks: smooth log RMSE 0.0814 versus flat 0.1274. June
// 2025's shutdown remains outside the smooth +/-0.20 log band (error -0.3021).
// The actual model observes California directly, so that local shutdown does
// not need to be predicted or copied onto other cities. The formula's widths
// are calibrated up to six months; past that they undercover (12 months:
// 85.7%), so since 2026-10-31 the builder gives a longer interval (2022's
// twelve months, before California's monthly series) the series' old early
// allowance, ln 2 (half to twice the month's miles), and every such width
// must pass the same guard at its own length (12 months: 156/168, 92.9%).
// Until 2026-10-31 the model began in July 2024 and the nine-month 2023
// interval, which failed this calibration, kept its older wide allowances.

const lines = fs.readFileSync("data/waymo-ca.csv", "utf8").trim().split("\n");
assert.equal(lines.shift(), "month,deployment,pilot,total,deployment_source,pilot_source",
  "Replicata: read the California mileage source.\nExpectata: the documented six-column schema.\nResultata: the header differs.");
const cents = x => Math.round(Number(x) * 100);
const ca = lines.map((line, i) => {
  const p = line.split(",");
  assert.equal(p.length, 6,
    `Replicata: read California source row ${i + 2}.\nExpectata: six fields.\nResultata: ${p.length}.`);
  const [month, deployment, pilot, total] = p;
  assert.match(month, /^\d{4}-\d{2}$/,
    `Replicata: read California source row ${i + 2}.\nExpectata: an ISO month.\nResultata: ${month}.`);
  const [y, m] = month.split("-").map(Number);
  assert.equal(y * 12 + m, 2022 * 12 + 12 + i,
    `Replicata: order California's monthly source.\nExpectata: contiguous months from December 2022.\nResultata: row ${i + 2} is ${month}.`);
  assert.ok([deployment, pilot, total].every(x => /^\d+\.\d{2}$/.test(x)),
    `Replicata: inspect California ${month}'s mileage fields.\nExpectata: nonnegative numbers at source precision, two decimal places.\nResultata: ${p.slice(1, 4)}.`);
  assert.equal(cents(deployment) + cents(pilot), cents(total),
    `Replicata: add California ${month}'s deployment and pilot miles.\nExpectata: the published combined total.\nResultata: ${deployment} + ${pilot} versus ${total}.`);
  const first = Date.UTC(y, m - 1, 1) / 86400000;
  const next = Date.UTC(y, m, 1) / 86400000;
  return {month, deployment: Number(deployment), pilot: Number(pilot),
    miles: Number(total), days: next - first, mid: (first + next) / 2};
});
const byMonth = Object.fromEntries(ca.map(r => [r.month, r]));

// Independent raw-file sentinels: first deployment, a material pilot share,
// both sides of the California shutdown, and the recent pilot expansion.
for (const [month, deployment, pilot] of [
  ["2023-08", 101313.48, 38937.52],
  ["2024-01", 426807.62, 58665.99],
  ["2025-05", 5336125.61, 18838.88],
  ["2025-06", 3567131.71, 14818.41],
  ["2026-06", 9023791.29, 660876.68],
]) {
  assert.deepEqual([byMonth[month]?.deployment, byMonth[month]?.pilot], [deployment, pilot],
    `Replicata: compare California ${month} to its CPUC driverless deployment and pilot files.\nExpectata: ${deployment} and ${pilot} miles.\nResultata: ${JSON.stringify(byMonth[month])}.`);
}

const sum = xs => xs.reduce((s, x) => s + x, 0);
const smoothRate = (x, knots, rates) => {
  const i = Math.max(0, Math.min(knots.length - 2, knots.filter(t => t <= x).length - 1));
  const w = Math.max(0, Math.min(1, (x - knots[i]) / (knots[i + 1] - knots[i])));
  return rates[i] * (1 - w) + rates[i + 1] * w;
};
const flatRate = (x, knots, rates, i) => rates[i];

function reconstruct(rows, n, rateAt) {
  assert.ok(rows.length >= 2 * n && rows.length % n === 0,
    `Replicata: mask ${rows.length} months in blocks of ${n}.\nExpectata: at least two complete blocks.\nResultata: an invalid block partition.`);
  const blocks = Array.from({length: rows.length / n}, (_, i) => rows.slice(i * n, (i + 1) * n));
  const days = blocks.map(b => sum(b.map(r => r.days)));
  const totals = blocks.map(b => sum(b.map(r => r.miles)));
  const knots = blocks.map((b, i) => sum(b.map(r => r.mid * r.days)) / days[i]);
  const rates = totals.map((total, i) => total / days[i]);
  return blocks.flatMap((block, i) => {
    const raw = block.map(r => r.days * rateAt(r.mid, knots, rates, i));
    const factor = totals[i] / sum(raw);
    const predicted = raw.map(x => x * factor);
    assert.ok(Math.abs(sum(predicted) - totals[i]) < 1e-6,
      `Replicata: reconstruct ${block[0].month}'s masked ${n}-month block.\nExpectata: preserve its observed total ${totals[i]}.\nResultata: ${sum(predicted)}.`);
    return block.map((r, j) => ({month: r.month, error: Math.log(r.miles / predicted[j])}));
  });
}

const sample = ca.filter(r => "2024-01" <= r.month && r.month <= "2026-06");
assert.equal(sample.length, 30,
  `Replicata: select the calibration period January 2024 through June 2026.\nExpectata: all 30 measured months.\nResultata: ${sample.length}.`);

// Read the actual authoring model's allowance; a constant here would leave
// this calibration green if the production allowance were silently reduced.
// Only widths enter from the model. Predictions and source observations above
// remain independent of its generated monthly profile.
const produced = JSON.parse(execFileSync("python3", ["data/waymo_vmt.py"], {encoding: "utf8"}));
const monthNumber = month => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m;
};
const span = row => monthNumber(row.anchor_end) - monthNumber(row.anchor_start);
const quarters = produced.filter(r => span(r) === 3);
assert.ok(quarters.length > 0,
  "Replicata: read the authoring model's allocation widths.\nExpectata: a three-month interval supplies the calibrated allowance.\nResultata: no such interval.");
const quarterWidth = quarters[0].allocation_log_halfwidth;
assert.ok(Number.isFinite(quarterWidth) && quarterWidth > 0,
  `Replicata: read the three-month allocation allowance.\nExpectata: a positive finite log half-width.\nResultata: ${quarterWidth}.`);
const CALIBRATED_MONTHS = 6;
for (const row of produced.filter(r => span(r) <= CALIBRATED_MONTHS)) {
  const expectedWidth = quarterWidth * Math.sqrt((span(row) - 1) / 2);
  assert.ok(Math.abs(row.allocation_log_halfwidth - expectedWidth) < 1e-12,
    `Replicata: inspect the authoring model's ${span(row)}-month allowance at ${row.month}.\nExpectata: the calibrated interval-length scaling, ${expectedWidth}.\nResultata: ${row.allocation_log_halfwidth}.`);
}

// Masked-month coverage at block length n and log half-width w, over every
// alignment that holds at least two whole blocks.
function guard(n, width) {
  const predictions = Array.from({length: n}, (_, offset) => {
    const count = Math.floor((sample.length - offset) / n) * n;
    return count >= 2 * n ? reconstruct(sample.slice(offset, offset + count), n, smoothRate) : [];
  }).flat();
  const hits = predictions.filter(r => Math.abs(r.error) <= width).length;
  const coverage = hits / predictions.length;
  assert.ok(coverage >= 0.90,
    `Replicata: mask California in ${n}-month blocks under every alignment, reconstruct its months, and apply log half-width ${width}.\nExpectata: at least 90% empirical coverage, a coarse calibration guard.\nResultata: ${hits}/${predictions.length} (${(100 * coverage).toFixed(2)}%).`);
}
for (const n of [2, 3, 4, 5, 6]) guard(n, quarterWidth * Math.sqrt((n - 1) / 2));
// Every width the model uses past the calibrated lengths passes the guard at
// its own length.
for (const row of produced.filter(r => span(r) > CALIBRATED_MONTHS)) guard(span(row), row.allocation_log_halfwidth);

const smooth = reconstruct(sample, 3, smoothRate);
const flat = reconstruct(sample, 3, flatRate);
const rmse = rows => Math.sqrt(sum(rows.map(r => r.error ** 2)) / rows.length);
assert.ok(rmse(smooth) < rmse(flat),
  `Replicata: reconstruct measured California months from calendar-quarter totals.\nExpectata: the neighboring-rate interpolation improves on uniform daily allocation.\nResultata: log RMSE ${rmse(smooth)} versus ${rmse(flat)}.`);
const shutdown = smooth.find(r => r.month === "2025-06");
assert.ok(shutdown.error < -0.20,
  `Replicata: hide June 2025's California miles inside its quarter total.\nExpectata: the smooth allocation misses the local shutdown below its 0.20 log allowance.\nResultata: log error ${shutdown.error}.`);

console.log("qual pass: Waymo allocation allowance checked against masked CPUC months");

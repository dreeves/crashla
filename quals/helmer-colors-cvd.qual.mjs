// "Humans (US average)" must stay distinguishable from every series it can be
// drawn with, for readers with colour-vision deficiency: colour is the only
// cue that tells the six series apart. Until 2026-10-03 its #8a7400 and
// Tesla's #d13b2d both simulated to the same olive under deuteranopia
// (CIEDE2000 2.9, against 37 with normal vision; audit #35).
//
// Method: simulate each colour as a dichromat sees it (Machado, Oliveira &
// Fernandes 2009, severity 1.0, applied in linear RGB -- the model Chromium's
// vision-deficiency emulation agrees with), then take the CIEDE2000
// difference (Sharma, Wu & Dalal 2005, checked against their published test
// pairs below). ΔE2000 >= 10 is the target; about 2.3 is a just-noticeable
// difference, so 10 is several steps apart, not merely different.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

const ctx = vm.createContext({ console, Math, Number, document: { getElementById() { return null; } } });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
const COLORS = JSON.parse(JSON.stringify(vm.runInContext("HELMER_COLORS", ctx)));
const paper = /--paper:\s*(#[0-9a-f]{6})/i.exec(fs.readFileSync("style.css", "utf8"))[1];

const MACHADO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = c => { const x = Math.min(1, Math.max(0, c)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const simulate = (c, kind) => kind === "normal" ? c
  : MACHADO[kind].map(row => toGamma(row.reduce((s, m, i) => s + m * toLinear(c[i]), 0)));
const XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];
const WHITE = XYZ.map(row => row.reduce((a, b) => a + b, 0));
function lab(c) {
  const lin = c.map(toLinear);
  const f = XYZ.map((row, j) => {
    const t = row.reduce((s, m, i) => s + m * lin[i], 0) / WHITE[j];
    return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
function de2000([L1, a1, b1], [L2, a2, b2]) {
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360, h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (C1p * C2p === 0) dhp = 0; else if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? hbp / 2 : hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * 30 * Math.exp(-(((hbp - 275) / 25) ** 2)))) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
// Sharma, Wu & Dalal (2005), Table 1: pairs 1, 2, 7, 13, 17, 25, 29, 31, 32.
for (const [p, q, want] of [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 0, 0], [50, -1, 2], 2.3669], [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.5, 0], [73, 25, -18], 27.1492], [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441], [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
]) assert.ok(Math.abs(de2000(p, q) - want) < 5e-4, `CIEDE2000 test pair ${JSON.stringify([p, q])}: got ${de2000(p, q)}, want ${want}`);

const TARGET = 10;
const KINDS = ["normal", "deuteranopia", "protanopia", "tritanopia"];
const table = [];
for (const kind of KINDS) {
  const us = lab(simulate(rgb(COLORS.HumansUS), kind));
  for (const [helmer, hex] of Object.entries(COLORS)) {
    if (helmer === "HumansUS") continue;
    table.push({ kind, helmer, dE: +de2000(us, lab(simulate(rgb(hex), kind))).toFixed(1) });
  }
}
const close = table.filter(r => r.dE < TARGET);
assert.deepEqual(close, [],
  `Replicata: simulate HELMER_COLORS under deuteranopia, protanopia and tritanopia and compare Humans (US average)
(${COLORS.HumansUS}) with every other series.
Expectata: CIEDE2000 >= ${TARGET} from each of them, under normal vision and under each deficiency.
Resultata: too close: ${JSON.stringify(close)}.`);

const luminance = c => c.map(toLinear).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v, 0);
const contrast = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };
const usContrast = contrast(rgb(COLORS.HumansUS), rgb(paper));
assert.ok(usContrast >= 3,
  `Replicata: compute the contrast of Humans (US average) ${COLORS.HumansUS} against the page (--paper ${paper}).
Expectata: at least 3:1, the WCAG 1.4.11 floor for a line or a legend chip.
Resultata: ${usContrast.toFixed(2)}:1.`);

console.log(`qual pass: Humans (US average) ${COLORS.HumansUS} stays >= ${TARGET} CIEDE2000 from every series under normal vision and three deficiencies (closest ${Math.min(...table.map(r => r.dE))}); ${usContrast.toFixed(1)}:1 on the page`);

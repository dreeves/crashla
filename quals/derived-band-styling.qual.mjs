// The HumansRideshare NONFATAL bands are modeled proxies — derived from the
// AV-cities band by the RIDESHARE_WORST/RIDESHARE_BEST loop, not measured —
// while its fatality band is sourced (Uber/Lyft safety reports). A modeled
// proxy must not render with the same visual grammar as sourced data: its
// curve/line strokes draw dashed (reusing the app's existing "not event
// data" dash idiom from k=0 prior-only curves), while the sourced fatality
// band stays solid.
import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript, dataScript } from "./load-app.mjs";

// Minimal DOM stub: escHtml() round-trips textContent -> innerHTML, so the
// stub must actually escape or every escAttr()'d data-tip renders empty.
const document = {
  getElementById() { return null; },
  createElement() {
    return {
      _html: "",
      set textContent(v) {
        this._html = String(v)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      },
      get innerHTML() { return this._html; },
    };
  },
};
const ctx = vm.createContext({ console, Math, Number, Object, JSON, Array, Set, Map, isFinite, parseFloat, parseInt, Date, document });
vm.runInContext(dataScript, ctx, { filename: "data.js" });
vm.runInContext(appScript, ctx, { filename: "crashla.js" });
vm.runInContext(`
  incidents = INCIDENT_DATA;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
`, ctx);

// --- 1. The derivation loop marks generated bands, and only those ---
const flags = vm.runInContext(`
  Object.fromEntries(METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI.HumansRideshare)
    .map(m => [m.key, m.humanMPI.HumansRideshare.derived === true]))
`, ctx);
assert.equal(flags.fatality, false,
  `Replicata: check the HumansRideshare fatality band's derived flag.
Expectata: false/absent — it is sourced (Uber/Lyft safety reports), not derived.
Resultata: ${flags.fatality}.`);
for (const [key, derived] of Object.entries(flags)) {
  if (key === "fatality") continue;
  assert.equal(derived, true,
    `Replicata: check the HumansRideshare ${key} band's derived flag.
Expectata: true — every nonfatal rideshare band comes from the derivation loop.
Resultata: ${derived}.`);
}

// --- 2. Distribution chart: derived curve dashed, sourced curve solid ---
const distDashes = vm.runInContext(`
  (() => {
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
    monthHelmerEnabled.HumansRideshare = true;
    const series = monthSeriesData();
    const count = key => {
      selectedMetricKey = key;
      return (renderDistributionChart(series).match(/stroke-dasharray/g) || []).length;
    };
    return { injury: count("injury"), fatality: count("fatality") };
  })()
`, ctx);
assert.ok(distDashes.injury === 1 && distDashes.fatality === 0,
  `Replicata: render the distribution chart with only Humans (Uber/Lyft)
enabled, on the injury metric (derived band) then the fatality metric
(sourced band), counting stroke-dasharray occurrences.
Expectata: 1 dashed stroke for injury (modeled proxy), 0 for fatality (sourced).
Resultata: injury=${distDashes.injury}, fatality=${distDashes.fatality}.`);

// --- 3. Monthly MPI chart: derived line dashed, sourced line solid ---
const lineDashes = vm.runInContext(`
  (() => {
    for (const d of ALL_HELMERS) monthHelmerEnabled[d] = false;
    monthHelmerEnabled.HumansRideshare = true;
    const series = monthSeriesData();
    const dashedLines = key => {
      selectedMetricKey = key;
      const html = renderAllHelmersMpiChart(series);
      return (html.match(/month-mpi-all-line[^>]*stroke-dasharray/g) || []).length;
    };
    return { injury: dashedLines("injury"), fatality: dashedLines("fatality") };
  })()
`, ctx);
assert.ok(lineDashes.injury === 1 && lineDashes.fatality === 0,
  `Replicata: render the cross-helmer MPI chart with only Humans (Uber/Lyft)
enabled, injury vs fatality metric, counting dashed month-mpi-all-line paths.
Expectata: the injury line (modeled proxy) is dashed, the fatality line
(sourced) is solid.
Resultata: injury=${lineDashes.injury}, fatality=${lineDashes.fatality}.`);

console.log("qual pass: modeled-proxy Humans (Uber/Lyft) bands render dashed; the sourced fatality band renders solid");

"use strict";

function fail(msg, details) {
  const suffix = details === undefined ? "" : " " + JSON.stringify(details);
  throw new Error(msg + suffix);
}

function must(cond, msg, details) {
  cond || fail(msg, details);
}

function byId(id) {
  const node = document.getElementById(id);
  must(node !== null, "Missing required DOM node", {id});
  return node;
}

// --- Gamma distribution math ---

// Log-gamma via Lanczos approximation (g=7, n=9)
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + 7.5; // g + 0.5
  for (let i = 1; i < 9; i++) a += LANCZOS_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Lower regularized incomplete gamma function P(a, x)
// Series expansion for x < a + 1, continued fraction otherwise
function gammainc(a, x) {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series: P(a,x) = e^{-x} x^a sum_{n=0}^{inf} x^n / Gamma(a+n+1)
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  // Continued fraction for upper gamma Q(a,x) = 1 - P(a,x)
  // Using modified Lentz's method
  let f = x - a + 1;
  if (Math.abs(f) < 1e-30) f = 1e-30;
  let c = f;
  let d = 0;
  for (let n = 1; n < 200; n++) {
    const an = n * (a - n);
    const bn = x - a + 1 + 2 * n;
    d = bn + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = bn + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lgamma(a)) / f;
  return 1 - q;
}

// Gamma quantile: find x such that P(a, x*b) = p, where Gamma(a, b) has rate b
// Returns x (the quantile of Gamma(shape=a, rate=b))
function gammaquant(a, b, p) {
  must(a > 0 && b > 0 && p > 0 && p < 1,
    "gammaquant: invalid params", {a, b, p});
  // Initial guess via Wilson-Hilferty approximation on chi-squared
  const nu = 2 * a;
  // Normal quantile approximation (Abramowitz & Stegun 26.2.23)
  const t = p < 0.5 ? p : 1 - p;
  const s = Math.sqrt(-2 * Math.log(t));
  let zabs = s - (2.515517 + 0.802853*s + 0.010328*s*s) /
                   (1 + 1.432788*s + 0.189269*s*s + 0.001308*s*s*s);
  const z = p < 0.5 ? -zabs : zabs;
  // Wilson-Hilferty
  const wh = 1 - 2/(9*nu) + z * Math.sqrt(2/(9*nu));
  let x = (nu / 2) * Math.max(wh * wh * wh, 0.001) / b;
  // Newton's method to refine
  for (let i = 0; i < 50; i++) {
    const cdf = gammainc(a, x * b);
    const err = cdf - p;
    if (Math.abs(err) < 1e-12) break;
    // PDF of Gamma(a, b): b^a x^{a-1} e^{-bx} / Gamma(a)
    const logpdf = a * Math.log(b) + (a-1) * Math.log(x) - b*x - lgamma(a);
    const pdf = Math.exp(logpdf);
    if (pdf < 1e-100) break; // avoid division by ~0
    const step = err / pdf;
    x = Math.max(x - step, x / 10); // don't go negative or overshoot
  }
  return x;
}

// Compute miles-per-incident estimate with credible interval.
// k = incident count, m = miles driven, massFrac = CI mass (e.g., 0.95)
function estimateMpi(k, m, massFrac) {
  const a = k + 0.5; // posterior shape (Jeffreys prior)
  const tail = (1 - massFrac) / 2;
  return {
    median: 1 / gammaquant(a, m, 0.5),
    lo:     1 / gammaquant(a, m, 1 - tail),
    hi:     1 / gammaquant(a, m, tail),
  };
}

// DOM-dependent wrapper used by the (currently commented-out) estimator panel
function estimateRate(k, m) {
  return estimateMpi(k, m, ciMass());
}

// --- Data and UI ---

let incidents = [];
let vmtRows = [];
let faultData = {}; // reportId -> {claude, codex, gemini, rclaude, rcodex, rgemini}
const DEFAULT_FAULT_WEIGHTS = {claude: 3, codex: 3, gemini: 3};
let faultWeightState = {...DEFAULT_FAULT_WEIGHTS};
let monthCompanyEnabled = {Tesla: true, Waymo: true, Zoox: true};
const MONTH_METRIC_DEFS = [
  {key: "all", label: "Miles per incident", marker: "solid-circle"},
  {key: "nonstationary", label: "Miles per nonstationary incident", marker: "hollow-circle"},
  {key: "roadwayNonstationary", label: "Miles per nonstationary non-parking-lot incident", marker: "hollow-square"},
  {key: "atfault", label: "Miles per at-fault incident", marker: "hollow-triangle"},
];
let monthMetricEnabled = {all: true, nonstationary: false, roadwayNonstationary: false, atfault: false};


const LINE_STYLE = {
  all:                {width: 2.5, opacity: 1},
  nonstationary:      {width: 1.5, opacity: 0.55},
  roadwayNonstationary: {width: 1.2, opacity: 0.8},
  atfault:            {width: 1,   opacity: 0.3},
};

function metricLineStyle(company, metricKey) {
  const s = LINE_STYLE[metricKey];
  const color = MONTHLY_COMPANY_COLORS[company];
  let style = `stroke:${color};stroke-width:${s.width}`;
  if (s.opacity < 1) style += `;opacity:${s.opacity}`;
  return style;
}

function metricMarkerColor(company, metricKey) {
  return MONTHLY_COMPANY_COLORS[company];
}

function metricMarkerScale(metricKey) {
  return 1;
}

function metricErrStyle(company, metricKey) {
  const s = LINE_STYLE[metricKey];
  const color = MONTHLY_COMPANY_COLORS[company];
  let style = `stroke:${color}`;
  if (s.opacity < 1) style += `;opacity:${s.opacity}`;
  return style;
}
const CI_MASS_MIN_PCT = 50;
const CI_MASS_MAX_PCT = 99.9;
const CI_MASS_STEP_PCT = 0.1;
const CI_MASS_DEFAULT_PCT = 95;
const COMPANY_COLORS = {
  Tesla: "#d13b2d",
  Waymo: "#2a8f57",
  Zoox: "#b7771a",
  Humans: "#5b6475",
};
const COMPANY_ORDER = ["Tesla", "Waymo", "Zoox", "Humans"];
const INCIDENT_MODEL_COMPANIES = ["Tesla", "Waymo", "Zoox"];
const AXIS_MIN_DEFAULT_PCT = 0;
const AXIS_MAX_DEFAULT_PCT = 100;
const AXIS_MIN_LABEL = "X-axis min";
const AXIS_MAX_LABEL = "X-axis max";
const AXIS_MIN_TIP = "Lower x-axis bound for this graph.";
const AXIS_MAX_TIP = "Upper x-axis bound for this graph.";
// Tesla pre-Sep-1 miles (all empty driver's seat)
const TESLA_PRE_SEP_MILES = 93849;
const ADS_COMPANIES = ["Tesla", "Waymo", "Zoox"];
const MONTHLY_COMPANY_COLORS = {
  Tesla: "#d13b2d",
  Waymo: "#2060c0",
  Zoox: "#2a8f57",
};
const SPEED_BINS = ["unknown", "31+", "11-30", "1-10", "0"];
const SPEED_LABELS = {
  "31+": "31+ mph",
  "11-30": "11-30 mph",
  "1-10": "1-10 mph",
  unknown: "unknown",
  "0": "0 mph",
};
const SPEED_BIN_COLORS = {
  Tesla: {
    unknown: "#383c46",
    "31+": "#d13b2d",
    "11-30": "#e06f66",
    "1-10": "#efaaa4",
    "0": "#d9d9d9",
  },
  Waymo: {
    unknown: "#383c46",
    "31+": "#2060c0",
    "11-30": "#5a87d1",
    "1-10": "#99b4e5",
    "0": "#d9d9d9",
  },
  Zoox: {
    unknown: "#383c46",
    "31+": "#2a8f57",
    "11-30": "#5ead7e",
    "1-10": "#98ccb0",
    "0": "#d9d9d9",
  },
};
const MONTH_TOKENS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const YM_RE = /^(\d{4})-(\d{2})$/;

function pct(v) {
  return v / 100;
}

function ciMassPct() {
  const raw = byId("ci-mass").value;
  const massPct = raw === "" ? CI_MASS_DEFAULT_PCT : Number(raw);
  must(Number.isFinite(massPct), "ci mass percent must be finite", {raw});
  must(massPct >= CI_MASS_MIN_PCT && massPct <= CI_MASS_MAX_PCT,
    "ci mass percent out of range", {massPct});
  return massPct;
}

function ciMass() {
  return ciMassPct() / 100;
}

function renderCiMassValue() {
  byId("ci-mass-val").textContent = ciMassPct().toFixed(1) + "%";
}

function initCiMassControl() {
  const input = byId("ci-mass");
  input.min = String(CI_MASS_MIN_PCT);
  input.max = String(CI_MASS_MAX_PCT);
  input.step = String(CI_MASS_STEP_PCT);
  input.value = String(CI_MASS_DEFAULT_PCT);
  renderCiMassValue();
  input.addEventListener("input", () => {
    renderCiMassValue();
    updateAllEstimates();
  });
}

function deadheadMultiplier(deadheadPct) {
  const deadheadFrac = pct(deadheadPct);
  must(deadheadFrac >= 0 && deadheadFrac < 1,
    "deadhead share out of range", {deadheadPct});
  return 1 / (1 - deadheadFrac);
}

function factorizedParts(baseMiles, deadheadPct) {
  const baseNoneMiles = baseMiles;
  const mDeadhead = deadheadMultiplier(deadheadPct);
  return {
    baseMiles,
    baseNoneMiles,
    deadheadPct,
    deadheadMultiplier: mDeadhead,
    miles: baseNoneMiles * mDeadhead,
  };
}

function scaleEstimate(est, factor) {
  return {
    median: est.median * factor,
    lo: est.lo * factor,
    hi: est.hi * factor,
  };
}

function axisInputId(company, edge) {
  return `x-${edge}-${company}`;
}

function axisValueId(company, edge) {
  return `x-${edge}-${company}-val`;
}

// Company configs: incident count from data, slider definitions
const COMPANIES = {
  Tesla: {
    sliders: [
      {
        id: "tesla-miles",
        label: "Total robotaxi miles",
        tip: "Base robotaxi miles in this window before applying deadhead adjustment.",
        min: 94000, max: 600000, step: 1000, value: 450000,
        fmt: v => v.toLocaleString(),
      },
      {
        id: "tesla-frac",
        label: "% post-Sep-1 without driver",
        tip: "Share of post-Sep-1 miles where the driver seat is empty.",
        min: 0, max: 100, step: 1, value: 70,
        fmt: v => v + "%",
      },
      {
        id: "tesla-deadhead",
        label: "Deadhead fraction",
        tip: "Share of ADS miles with no passenger in the car; used for the deadhead multiplier.",
        min: 0, max: 40, step: 1, value: 20,
        fmt: v => v + "%",
      },
    ],
    getParts: vals => {
      const baseMiles = vals["tesla-miles"];
      must(baseMiles >= TESLA_PRE_SEP_MILES,
        "tesla base miles below pre-Sep-1 miles", {baseMiles});
      const nonePostPct = vals["tesla-frac"];
      const postSepMiles = baseMiles - TESLA_PRE_SEP_MILES;
      const baseNoneMiles = TESLA_PRE_SEP_MILES + pct(nonePostPct) * postSepMiles;
      const deadheadPct = vals["tesla-deadhead"];
      const mDeadhead = deadheadMultiplier(deadheadPct);
      return {
        baseMiles,
        baseNoneMiles,
        deadheadPct,
        deadheadMultiplier: mDeadhead,
        miles: baseNoneMiles * mDeadhead,
      };
    },
  },
  Waymo: {
    sliders: [
      {
        id: "waymo-miles",
        label: "Driverless miles",
        tip: "Waymo base miles in this window before deadhead adjustment.",
        min: 57000000, max: 66000000, step: 1000000, value: 61000000,
        fmt: v => (v / 1e6).toFixed(0) + "M",
      },
      {
        id: "waymo-deadhead",
        label: "Deadhead fraction",
        tip: "Share of ADS miles with no passenger in the car; used for the deadhead multiplier.",
        min: 0, max: 50, step: 1, value: 0,
        fmt: v => v + "%",
      },
    ],
    getParts: vals => factorizedParts(
      vals["waymo-miles"],
      vals["waymo-deadhead"],
    ),
  },
  Zoox: {
    sliders: [
      {
        id: "zoox-miles",
        label: "Driverless miles",
        tip: "Zoox base miles in this window before deadhead adjustment.",
        min: 50000, max: 1000000, step: 25000, value: 300000,
        fmt: v => v.toLocaleString(),
      },
      {
        id: "zoox-deadhead",
        label: "Deadhead fraction",
        tip: "Share of ADS miles with no passenger; converts non-deadhead miles to total Vehicle Miles Traveled (VMT).",
        min: 0, max: 40, step: 1, value: 20,
        fmt: v => v + "%",
      },
    ],
    getParts: vals => factorizedParts(
      vals["zoox-miles"],
      vals["zoox-deadhead"],
    ),
  },
  Humans: {
    sliders: [
      {
        id: "humans-waymo-divisor",
        label: "Humans as 1/x of Waymo miles per incident",
        tip: "Set humans to one-over-x of Waymo miles per incident; range is 1/2 to 1/10.",
        min: 2, max: 10, step: 0.1, value: 5,
        fmt: v => "1/" + Number(v).toFixed(1).replace(/\.0$/, "") + "x",
      },
    ],
  },
};

// Count incidents per company from loaded data
function countByCompany(rows = incidents) {
  const counts = {};
  for (const inc of rows) {
    counts[inc.company] = (counts[inc.company] || 0) + 1;
  }
  return counts;
}

function incidentsInVmtWindow(rows = incidents) {
  must(vmtRows.length > 0, "incident browser requires vmtRows");
  const monthSet = new Set(vmtRows.map(row => row.month));
  return rows.filter(inc => monthSet.has(monthKeyFromIncidentLabel(inc.date)));
}

function primarySliderBounds(cfg, vals) {
  const primary = cfg.sliders[0];
  must(primary !== undefined, "missing primary slider for bounds");
  const loVals = {...vals, [primary.id]: primary.min};
  const hiVals = {...vals, [primary.id]: primary.max};
  const lo = cfg.getParts(loVals).miles;
  const hi = cfg.getParts(hiVals).miles;
  return {
    min: Math.min(lo, hi),
    max: Math.max(lo, hi),
  };
}

function scaleLinear(v, d0, d1, r0, r1) {
  const span = (d1 - d0) || 1;
  return r0 + (v - d0) * (r1 - r0) / span;
}

function sampledEstimates(estAtMiles, xMin, xMax, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = xMin + (xMax - xMin) * i / n;
    out.push({x, est: estAtMiles(x)});
  }
  return out;
}

function medianPath(samples, mapX, mapY) {
  let d = "";
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    d += `${i ? " L " : "M "}${mapX(s.x).toFixed(2)} ${mapY(s.est.median).toFixed(2)}`;
  }
  return d;
}

function bandPath(samples, mapX, mapY) {
  let d = "";
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    d += `${i ? " L " : "M "}${mapX(s.x).toFixed(2)} ${mapY(s.est.hi).toFixed(2)}`;
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    d += ` L ${mapX(s.x).toFixed(2)} ${mapY(s.est.lo).toFixed(2)}`;
  }
  return d + " Z";
}

function layoutRefLabels(peers, mapY, top, height) {
  const minGap = 12;
  const yMin = top + 10;
  const yMax = top + height - 4;
  const laid = peers
    .map(peer => ({
      ...peer,
      lineY: mapY(peer.est.median),
      labelY: 0,
    }))
    .sort((a, b) => a.lineY - b.lineY)
    .map(peer => ({
      ...peer,
      labelY: Math.min(Math.max(peer.lineY - 4, yMin), yMax),
    }));

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < laid.length; i++) {
      laid[i].labelY = Math.max(laid[i].labelY, laid[i - 1].labelY + minGap);
    }
    for (let i = laid.length - 2; i >= 0; i--) {
      laid[i].labelY = Math.min(laid[i].labelY, laid[i + 1].labelY - minGap);
    }
    for (const peer of laid) {
      peer.labelY = Math.min(Math.max(peer.labelY, yMin), yMax);
    }
  }

  return peers.map(peer => {
    const hit = laid.find(candidate => candidate.company === peer.company);
    must(hit !== undefined, "missing laid-out peer label", {company: peer.company});
    return hit;
  });
}

function axisWindow(company, bounds) {
  const minRaw = byId(axisInputId(company, "min")).value;
  const maxRaw = byId(axisInputId(company, "max")).value;
  const minPct = minRaw === "" ? AXIS_MIN_DEFAULT_PCT : Number(minRaw);
  const maxPct = maxRaw === "" ? AXIS_MAX_DEFAULT_PCT : Number(maxRaw);
  must(Number.isFinite(minPct) && Number.isFinite(maxPct),
    "axis slider values must be finite", {company, minRaw, maxRaw});
  must(minPct >= 0 && minPct <= 99 && maxPct >= 1 && maxPct <= 100,
    "axis slider values out of range", {company, minPct, maxPct});
  must(minPct < maxPct,
    "axis min must be lower than axis max", {company, minPct, maxPct});
  const span = bounds.max - bounds.min;
  return {
    minPct,
    maxPct,
    xMin: bounds.min + span * (minPct / 100),
    xMax: bounds.min + span * (maxPct / 100),
  };
}

function syncAxisSliderBounds(company) {
  const minInput = byId(axisInputId(company, "min"));
  const maxInput = byId(axisInputId(company, "max"));
  const minPct = minInput.value === "" ? AXIS_MIN_DEFAULT_PCT : Number(minInput.value);
  const maxPct = maxInput.value === "" ? AXIS_MAX_DEFAULT_PCT : Number(maxInput.value);
  must(Number.isFinite(minPct) && Number.isFinite(maxPct),
    "axis slider values must be finite", {company, minPct, maxPct});
  must(minPct < maxPct,
    "axis min must be lower than axis max", {company, minPct, maxPct});
  minInput.max = String(maxPct - 1);
  maxInput.min = String(minPct + 1);
}

function sliderVals(cfg) {
  const vals = {};
  for (const s of cfg.sliders) {
    const raw = byId(s.id).value;
    const parsed = raw === "" ? s.value : Number(raw);
    must(Number.isFinite(parsed), "slider value must be finite", {id: s.id, raw});
    vals[s.id] = parsed;
  }
  return vals;
}

function summaryFromIncidentModel(company, counts, valsByCompany) {
  const cfg = COMPANIES[company];
  const vals = valsByCompany[company];
  const miles = cfg.getParts(vals).miles;
  const k = counts[company] || 0;
  const estAtMiles = x => estimateRate(k, x);
  return {
    company,
    k,
    miles,
    est: estAtMiles(miles),
    estAtMiles,
    bounds: primarySliderBounds(cfg, vals),
  };
}

function companySummaries(counts) {
  const valsByCompany = {};
  for (const company of COMPANY_ORDER) {
    valsByCompany[company] = sliderVals(COMPANIES[company]);
  }

  const summaries = {};
  for (const company of INCIDENT_MODEL_COMPANIES) {
    summaries[company] = summaryFromIncidentModel(company, counts, valsByCompany);
  }

  const waymo = summaries.Waymo;
  must(waymo !== undefined, "Humans summary requires Waymo summary");
  const waymoDivisor = valsByCompany.Humans["humans-waymo-divisor"];
  must(waymoDivisor >= 2 && waymoDivisor <= 10,
    "Humans/Waymo divisor out of range", {waymoDivisor});
  const humanFactor = 1 / waymoDivisor;
  const estAtMiles = miles => scaleEstimate(waymo.estAtMiles(miles), humanFactor);
  summaries.Humans = {
    company: "Humans",
    k: waymo.k,
    miles: waymo.miles,
    est: estAtMiles(waymo.miles),
    estAtMiles,
    bounds: waymo.bounds,
    waymoDivisor,
  };
  return summaries;
}

function fmtDivisor(divisor) {
  return "1/" + Number(divisor).toFixed(1).replace(/\.0$/, "");
}

function summaryHeader(summary) {
  const formatters = {
    Tesla: s =>
      `${s.company}: ${s.k} incidents in ${Math.round(s.miles).toLocaleString()} miles ⇒ ${fmtMiles(s.est.median)} miles per incident`,
    Waymo: s =>
      `${s.company}: ${s.k} incidents in ${Math.round(s.miles).toLocaleString()} miles ⇒ ${fmtMiles(s.est.median)} miles per incident`,
    Zoox: s =>
      `${s.company}: ${s.k} incidents in ${Math.round(s.miles).toLocaleString()} miles ⇒ ${fmtMiles(s.est.median)} miles per incident`,
    Humans: s =>
      `Humans: ${fmtMiles(s.est.median)} miles per incident (${fmtDivisor(s.waymoDivisor)} of Waymo)`,
  };
  const fn = formatters[summary.company];
  must(typeof fn === "function", "Missing summary header formatter", {company: summary.company});
  return fn(summary);
}

function updateAllEstimates() {
  for (const company of COMPANY_ORDER) updateEstimate(company);
}

function buildEstimator() {
  const container = byId("estimator");
  container.replaceChildren();
  const counts = countByCompany();

  for (const company of COMPANY_ORDER) {
    const cfg = COMPANIES[company];
    const k = counts[company] || 0;
    const panel = document.createElement("div");
    panel.className = "company-panel";
    panel.dataset.company = company;

    let html = `<h3 id="header-stats-${company}">${company}: ${k} incidents in 0 miles ⇒ ? miles per incident</h3>`;

    for (const s of cfg.sliders) {
      must(typeof s.tip === "string" && s.tip.length > 0,
        "slider missing tooltip", {company, sliderId: s.id});
      const tip = escAttr(s.tip);
      html += `
        <div class="slider-row">
          <label for="${s.id}" title="${tip}">${s.label}</label>
          <input type="range" id="${s.id}" min="${s.min}" max="${s.max}"
                 step="${s.step}" value="${s.value}" title="${tip}">
          <span class="val" id="${s.id}-val">${s.fmt(s.value)}</span>
        </div>`;
    }

    const axisMinTip = escAttr(AXIS_MIN_TIP);
    const axisMaxTip = escAttr(AXIS_MAX_TIP);
    const axisMinInput = axisInputId(company, "min");
    const axisMaxInput = axisInputId(company, "max");
    const axisMinValue = axisValueId(company, "min");
    const axisMaxValue = axisValueId(company, "max");
    html += `
      <div class="slider-row">
        <label for="${axisMinInput}" title="${axisMinTip}">${AXIS_MIN_LABEL}</label>
        <input type="range" id="${axisMinInput}" min="0" max="99" step="1"
               value="${AXIS_MIN_DEFAULT_PCT}" title="${axisMinTip}">
        <span class="val" id="${axisMinValue}">0</span>
      </div>
      <div class="slider-row">
        <label for="${axisMaxInput}" title="${axisMaxTip}">${AXIS_MAX_LABEL}</label>
        <input type="range" id="${axisMaxInput}" min="1" max="100" step="1"
               value="${AXIS_MAX_DEFAULT_PCT}" title="${axisMaxTip}">
        <span class="val" id="${axisMaxValue}">0</span>
      </div>`;

    html += `<div class="result-box" id="result-${company}"></div>`;
    panel.innerHTML = html;
    container.appendChild(panel);

    // Attach slider listeners
    for (const s of cfg.sliders) {
      const input = byId(s.id);
      const valSpan = byId(s.id + "-val");
      input.addEventListener("input", () => {
        valSpan.textContent = s.fmt(Number(input.value));
        updateAllEstimates();
      });
    }
    const axisMinNode = byId(axisInputId(company, "min"));
    const axisMaxNode = byId(axisInputId(company, "max"));
    syncAxisSliderBounds(company);
    axisMinNode.addEventListener("input", () => {
      syncAxisSliderBounds(company);
      updateAllEstimates();
    });
    axisMaxNode.addEventListener("input", () => {
      syncAxisSliderBounds(company);
      updateAllEstimates();
    });
  }
  updateAllEstimates();
}

function updateEstimate(company) {
  const cfg = COMPANIES[company];
  must(cfg !== undefined, "Unknown company config", {company});
  const counts = countByCompany();
  const summaries = companySummaries(counts);
  const thisSummary = summaries[company];
  must(thisSummary !== undefined, "Missing summary for company", {company});
  const peers = COMPANY_ORDER.filter(name => name !== company).map(name => summaries[name]);
  const miles = thisSummary.miles;
  const est = thisSummary.est;
  byId("header-stats-" + company).textContent = summaryHeader(thisSummary);

  const box = byId("result-" + company);
  const axis = axisWindow(company, thisSummary.bounds);
  const xMin = axis.xMin;
  const xMax = axis.xMax;
  byId(axisValueId(company, "min")).textContent = Math.round(xMin).toLocaleString();
  byId(axisValueId(company, "max")).textContent = Math.round(xMax).toLocaleString();
  const samples = sampledEstimates(thisSummary.estAtMiles, xMin, xMax, 40);
  const yMin = Math.min(...samples.map(s => s.est.lo), ...peers.map(p => p.est.median));
  const yMax = Math.max(...samples.map(s => s.est.hi), ...peers.map(p => p.est.median));
  const svgW = 520;
  const svgH = 220;
  const mLeft = 56;
  const mRight = 12;
  const mTop = 10;
  const mBot = 40;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const mapX = x => scaleLinear(x, xMin, xMax, mLeft, mLeft + pW);
  const mapY = y => scaleLinear(y, yMin, yMax, mTop + pH, mTop);
  const pointX = mapX(miles);
  const pointY = mapY(est.median);
  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const xTickAnchors = ["start", "middle", "end"];
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const band = bandPath(samples, mapX, mapY);
  const path = medianPath(samples, mapX, mapY);
  const peerLabels = layoutRefLabels(peers, mapY, mTop, pH);

  box.innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${svgW} ${svgH}">
      ${xTicks.map((x, i) => `
        <line class="graph-grid" x1="${mapX(x)}" y1="${mTop}" x2="${mapX(x)}" y2="${mTop + pH}"></line>
        <text class="graph-tick" x="${mapX(x)}" y="${svgH - 16}" text-anchor="${xTickAnchors[i]}">${Math.round(x).toLocaleString()}</text>
      `).join("")}
      ${yTicks.map(y => `
        <line class="graph-grid" x1="${mLeft}" y1="${mapY(y)}" x2="${mLeft + pW}" y2="${mapY(y)}"></line>
        <text class="graph-tick" x="${mLeft - 8}" y="${mapY(y) + 4}" text-anchor="end">${fmtMiles(y)}</text>
      `).join("")}
      <line class="graph-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${mTop + pH}"></line>
      <line class="graph-axis" x1="${mLeft}" y1="${mTop + pH}" x2="${mLeft + pW}" y2="${mTop + pH}"></line>
      <path class="graph-band" d="${band}"></path>
      <path class="graph-line" d="${path}"></path>
      ${peerLabels.map(p => `
        <line class="graph-refline" x1="${mLeft}" y1="${p.lineY}" x2="${mLeft + pW}" y2="${p.lineY}" style="stroke:${COMPANY_COLORS[p.company]}"></line>
        <text class="graph-reflabel" x="${mLeft + pW - 4}" y="${p.labelY}" text-anchor="end" style="fill:${COMPANY_COLORS[p.company]}">${p.company}: ${fmtMiles(p.est.median)}</text>
      `).join("")}
      <circle class="graph-point" cx="${pointX}" cy="${pointY}" r="5"></circle>
      <text class="graph-label" x="${mLeft + pW / 2}" y="${svgH - 2}" text-anchor="middle">Total Autonomous Miles</text>
      <text class="graph-label" x="12" y="${mTop + pH / 2}" transform="rotate(-90 12 ${mTop + pH / 2})" text-anchor="middle">Miles per incident</text>
    </svg>
  `;
}

function fmtMiles(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString();
}

function csvUnquote(field) {
  const quoted = field.startsWith("\"") && field.endsWith("\"");
  return quoted ? field.slice(1, -1).replace(/""/g, "\"") : field;
}

function parseVmtCsv(text) {
  const lines = text.split(/\r?\n/).map(line => line.trimEnd());
  must(lines.length > 1, "VMT sheet CSV must include header and rows");
  must(lines[0] === "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,coverage,rationale",
    "VMT sheet CSV header mismatch", {header: lines[0]});
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const hit = /^([^,]+),(\d{4}-\d{2}),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(.*)$/.exec(line);
    must(hit !== null, "Malformed VMT sheet CSV row", {lineNo: i + 1, line});
    const companyRaw = hit[1].trim();
    const company = ADS_COMPANIES.find(c => c.toLowerCase() === companyRaw.toLowerCase());
    must(company !== undefined, "VMT sheet CSV has unknown company", {companyRaw});
    const vmtBest = Number(hit[3]);
    const vmtCume = Number(hit[4]);
    const vmtMin = Number(hit[5]);
    const vmtMax = Number(hit[6]);
    const coverage = Number(hit[7]); // fraction of month in NHTSA window
    must(Number.isFinite(vmtBest) && vmtBest >= 0, "vmt must be non-negative number",
      {lineNo: i + 1, vmtBest});
    must(Number.isFinite(vmtCume) && vmtCume >= 0,
      "company_cumulative_vmt must be non-negative number", {lineNo: i + 1, vmtCume});
    must(Number.isFinite(vmtMin) && vmtMin >= 0, "vmt_min must be non-negative number",
      {lineNo: i + 1, vmtMin});
    must(Number.isFinite(vmtMax) && vmtMax >= 0, "vmt_max must be non-negative number",
      {lineNo: i + 1, vmtMax});
    must(vmtMin <= vmtBest && vmtBest <= vmtMax,
      "expected vmt_min <= vmt <= vmt_max", {lineNo: i + 1, vmtMin, vmtBest, vmtMax});
    must(coverage > 0 && coverage <= 1, "coverage must be in (0, 1]",
      {lineNo: i + 1, coverage});
    rows.push({
      company,
      month: hit[2],
      vmtMin,
      vmtBest,
      vmtMax,
      vmtCume,
      coverage,
      rationale: csvUnquote(hit[8]),
    });
  }
  must(rows.length > 0, "VMT sheet CSV has no data rows");
  return rows;
}


function monthKeyFromIncidentLabel(label) {
  const hit = /^([A-Z]{3})-(\d{4})$/.exec(label);
  must(hit !== null, "Invalid incident month label", {label});
  const month = MONTH_TOKENS[hit[1]];
  must(month !== undefined, "Unknown incident month token", {label});
  return `${hit[2]}-${String(month).padStart(2, "0")}`;
}

function speedBinForIncident(speed) {
  if (speed === null) return "unknown";
  if (speed === 0) return "0";
  if (speed <= 10) return "1-10";
  if (speed <= 30) return "11-30";
  return "31+";
}

function emptySpeedBins() {
  return {"31+": 0, "11-30": 0, "1-10": 0, unknown: 0, "0": 0};
}

function linearTicks(min, max, count) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    out.push(min + (max - min) * i / count);
  }
  return out;
}

function nonstationaryIncidentCount(speeds) {
  return speeds["unknown"] + speeds["1-10"] + speeds["11-30"] + speeds["31+"];
}

function roadwayNonstationaryIncidentCount(rec) {
  return rec.incidents.roadwayNonstationary;
}

function fmtCount(n) {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return rounded.toLocaleString();
  return rounded.toFixed(1);
}

function monthCompanyToggleId(company) {
  return "month-company-toggle-" + company.toLowerCase();
}

function includedAdsCompanies() {
  return ADS_COMPANIES.filter(company => monthCompanyEnabled[company]);
}

function monthMetricToggleId(metric) {
  return "month-metric-toggle-" + metric;
}

function includedMonthMetrics() {
  return MONTH_METRIC_DEFS.filter(metric => monthMetricEnabled[metric.key]);
}

function fmtWhole(n) {
  return Math.round(n).toLocaleString();
}

function companyMonthRows(series, company) {
  return series.points.map(point => point.companies[company]);
}

function monthlySummaryRows(series) {
  return ADS_COMPANIES.map(company => {
    const rows = companyMonthRows(series, company);
    const vmtMin = rows.reduce((sum, row) => sum + row.vmtMin, 0);
    const vmtBest = rows.reduce((sum, row) => sum + row.vmtBest, 0);
    const vmtMax = rows.reduce((sum, row) => sum + row.vmtMax, 0);
    const incTotal = rows.reduce((sum, row) => sum + row.incidents.total, 0);
    const incNonstationary = rows.reduce(
      (sum, row) => sum + nonstationaryIncidentCount(row.incidents.speeds), 0);
    const incRoadwayNonstationary = rows.reduce(
      (sum, row) => sum + roadwayNonstationaryIncidentCount(row), 0);
    must(incTotal > 0, "summary total incidents must be positive", {company, incTotal});
    must(incNonstationary > 0,
      "summary nonstationary incidents must be positive", {company, incNonstationary});
    must(incRoadwayNonstationary > 0,
      "summary roadway nonstationary incidents must be positive", {company, incRoadwayNonstationary});
    return {
      company,
      vmtMin,
      vmtBest,
      vmtMax,
      incTotal,
      incNonstationary,
      incRoadwayNonstationary,
      milesPerIncident: vmtBest / incTotal,
      milesPerNonstationaryIncident: vmtBest / incNonstationary,
      milesPerRoadwayNonstationaryIncident: vmtBest / incRoadwayNonstationary,
    };
  });
}

function monthSeriesData() {
  must(vmtRows.length > 0, "month series requires vmtRows");
  const monthSet = new Set();
  const vmtByKey = {};
  for (const row of vmtRows) {
    const key = row.company + "|" + row.month;
    must(vmtByKey[key] === undefined, "Duplicate VMT row for company-month", {key});
    vmtByKey[key] = row;
    monthSet.add(row.month);
  }

  const incidentsByKey = {};
  const weights = faultWeights();
  for (const inc of incidents) {
    must(ADS_COMPANIES.includes(inc.company), "inline incident data has unknown ADS company", {company: inc.company});
    const month = monthKeyFromIncidentLabel(inc.date);
    if (!monthSet.has(month)) continue;
    const key = inc.company + "|" + month;
    let rec = incidentsByKey[key];
    if (rec === undefined) {
      rec = {total: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0};
      incidentsByKey[key] = rec;
    }
    rec.total += 1;
    const bin = speedBinForIncident(inc.speed);
    rec.speeds[bin] += 1;
    must(typeof inc.road === "string", "incident road must be string", {reportId: inc.reportId, road: inc.road});
    rec.roadwayNonstationary += Number(
      bin !== "0" && inc.road !== "Parking Lot",
    );
    must(inc.fault !== null && typeof inc.fault === "object",
      "incident missing fault object for monthly series", {reportId: inc.reportId});
    const atFaultFrac = weightedFaultFromValues(
      inc.fault.claude, inc.fault.codex, inc.fault.gemini, weights,
    );
    must(atFaultFrac === null || (atFaultFrac >= 0 && atFaultFrac <= 1),
      "monthly at-fault fraction out of range", {reportId: inc.reportId, atFaultFrac});
    rec.atFault += atFaultFrac || 0;
  }

  const months = [...monthSet].sort();
  must(months.length > 0, "No months to render");
  const points = [];
  for (const month of months) {
    const companies = {};
    for (const company of ADS_COMPANIES) {
      const key = company + "|" + month;
      const vmt = vmtByKey[key];
      must(vmt !== undefined, "Missing VMT for company-month", {company, month});
      must(vmt.vmtMin > 0, "vmt_min must be positive", {company, month, vmtMin: vmt.vmtMin});
      must(vmt.vmtBest > 0, "vmt must be positive", {company, month, vmtBest: vmt.vmtBest});
      must(vmt.vmtMax > 0, "vmt_max must be positive", {company, month, vmtMax: vmt.vmtMax});
      const inc = incidentsByKey[key] || {total: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0};
      const c = vmt.coverage; // pro-rate VMT to match the incident observation window
      companies[company] = {
        vmtMin: vmt.vmtMin * c,
        vmtBest: vmt.vmtBest * c,
        vmtMax: vmt.vmtMax * c,
        vmtCume: vmt.vmtCume,
        incidents: inc,
      };
    }
    points.push({month, companies});
  }
  return {months, points};
}

function drawSingleMonthAxes(
  months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, yFmt, yLabel,
) {
  const axisY = mTop + pH;
  return `
    ${months.map((month, i) => `
      <line class="month-grid" x1="${mapX(i)}" y1="${mTop}" x2="${mapX(i)}" y2="${axisY}"></line>
      <text class="month-tick" x="${mapX(i)}" y="${svgH - 16}" text-anchor="middle">${month}</text>
    `).join("")}
    ${yTicks.map(y => `
      <line class="month-grid" x1="${mLeft}" y1="${mapY(y)}" x2="${mLeft + pW}" y2="${mapY(y)}"></line>
      <text class="month-tick" x="${mLeft - 8}" y="${mapY(y) + 4}" text-anchor="end">${yFmt(y)}</text>
    `).join("")}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${axisY}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${axisY}" x2="${mLeft + pW}" y2="${axisY}"></line>
    <text class="month-label" x="12" y="${mTop + pH / 2}" transform="rotate(-90 12 ${mTop + pH / 2})" text-anchor="middle">${yLabel}</text>
  `;
}

function renderAllCompaniesMpiChart(series) {
  const svgW = 900;
  const svgH = 520;
  const mLeft = 68;
  const mRight = 16;
  const mTop = 14;
  const mBot = 40;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const countByMetric = {
    all: rec => rec.incidents.total,
    nonstationary: rec => nonstationaryIncidentCount(rec.incidents.speeds),
    roadwayNonstationary: rec => roadwayNonstationaryIncidentCount(rec),
    atfault: rec => rec.incidents.atFault,
  };
  const markerRenderer = {
    "solid-circle": (x, y, color, s) => {
      const r = 3.1 * s;
      return `<circle class="month-dot" cx="${x}" cy="${y}" r="${r}" style="fill:${color};stroke:${color}"></circle>`;
    },
    "hollow-circle": (x, y, color, s) => {
      const r = 3.1 * s;
      return `<circle class="month-dot" cx="${x}" cy="${y}" r="${r}" style="fill:#fff;stroke:${color}"></circle>`;
    },
    "hollow-square": (x, y, color, s) => {
      const r = 3.1 * s;
      const d = 2 * r;
      return `<rect class="month-dot" x="${(x - r).toFixed(2)}" y="${(y - r).toFixed(2)}" width="${d.toFixed(2)}" height="${d.toFixed(2)}" style="fill:#fff;stroke:${color}"></rect>`;
    },
    "hollow-triangle": (x, y, color, s) => {
      const h = 3.8 * s;
      const w = 3.4 * s;
      return `<path class="month-mark-tri" d="M ${x} ${y - h} L ${x - w} ${y + (h * 0.74)} L ${x + w} ${y + (h * 0.74)} Z" style="fill:#fff;stroke:${color}"></path>`;
    },
  };

  const seriesRows = [];
  let yMax = 1;
  for (const company of includedAdsCompanies()) {
    const rows = companyMonthRows(series, company);
    for (const metric of includedMonthMetrics()) {
      const countFn = countByMetric[metric.key];
      must(typeof countFn === "function", "missing count fn for metric", {metric: metric.key});
      const vals = rows.map(row => {
        const k = countFn(row);
        const massFrac = CI_MASS_DEFAULT_PCT / 100;
        const mpiBest = estimateMpi(k, row.vmtBest, massFrac).median;
        const mpiMin = k > 0 ? row.vmtMin / k : mpiBest;
        const mpiMax = k > 0 ? row.vmtMax / k : mpiBest;
        const a = k + 0.5;
        const tail = (1 - massFrac) / 2;
        const ciLo = 1 / gammaquant(a, row.vmtMin, 1 - tail);
        const ciHi = 1 / gammaquant(a, row.vmtMax, tail);
        yMax = Math.max(yMax, mpiMax);
        return {
          mpiMin, mpiBest, mpiMax, ciLo, ciHi, incidentCount: k,
          vmtMonth: row.vmtBest,
          vmtCume: row.vmtCume,
        };
      });
      seriesRows.push({company, metric, vals});
    }
  }

  const yTicks = linearTicks(0, yMax, 4);
  const xPad = 28;
  const mapX = idx => scaleLinear(
    idx, 0, series.months.length - 1, mLeft + xPad, mLeft + pW - xPad,
  );
  const mapY = y => scaleLinear(y, 0, yMax, mTop + pH, mTop);

  const lines = seriesRows.map(row => {
    let d = "";
    let penDown = false;
    for (let i = 0; i < row.vals.length; i++) {
      const mpi = row.vals[i];
      if (mpi === null) {
        penDown = false;
        continue;
      }
      d += `${penDown ? " L " : "M "}${mapX(i).toFixed(2)} ${mapY(mpi.mpiBest).toFixed(2)}`;
      penDown = true;
    }
    return `<path class="month-mpi-all-line" d="${d}" style="${metricLineStyle(row.company, row.metric.key)}"></path>`;
  }).join("");

  const errs = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi === null) return "";
      const x = mapX(i);
      const yLo = mapY(mpi.mpiMin);
      const yHi = mapY(mpi.mpiMax);
      const errStyle = metricErrStyle(row.company, row.metric.key);
      return `
        <line class="month-err" x1="${x.toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${x.toFixed(2)}" y2="${yHi.toFixed(2)}" style="${errStyle}"></line>
        <line class="month-err" x1="${(x - 3).toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${(x + 3).toFixed(2)}" y2="${yLo.toFixed(2)}" style="${errStyle}"></line>
        <line class="month-err" x1="${(x - 3).toFixed(2)}" y1="${yHi.toFixed(2)}" x2="${(x + 3).toFixed(2)}" y2="${yHi.toFixed(2)}" style="${errStyle}"></line>
      `;
    }).join("")
  ).join("");

  const marks = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      const x = mapX(i);
      const y = mapY(mpi.mpiBest);
      const color = metricMarkerColor(row.company, row.metric.key);
      const scale = metricMarkerScale(row.metric.key);
      const marker = markerRenderer[row.metric.marker];
      must(typeof marker === "function", "missing marker renderer", {marker: row.metric.marker});
      const k = mpi.incidentCount;
      const kFmt = Number.isInteger(k) ? String(k) : k.toFixed(1);
      // TO-DO: Human vet new tooltip mileage labels below.
      const tip = `${row.company} ${series.months[i]} (${row.metric.label})\nMPI: ${fmtMiles(mpi.mpiBest)} (${kFmt} incident${k === 1 ? "" : "s"})\n95% CI: ${fmtMiles(mpi.ciLo)} \u2013 ${fmtMiles(mpi.ciHi)}\nMonthly VMT: ${fmtWhole(mpi.vmtMonth)}\nCumulative VMT: ${fmtWhole(mpi.vmtCume)}`;
      return `<g>${marker(x, y, color, scale)}<circle cx="${x}" cy="${y}" r="12" fill="none" pointer-events="all" style="cursor:pointer"><title>${escHtml(tip)}</title></circle></g>`;
    }).join("")
  ).join("");

  // Bayesian CI bands (clipped to plot area since bounds can be extreme)
  const bands = seriesRows.map(row => {
    const segments = [];
    let seg = [];
    for (let i = 0; i < row.vals.length; i++) {
      if (row.vals[i] === null) {
        if (seg.length > 0) segments.push(seg);
        seg = [];
      } else {
        seg.push({i, val: row.vals[i]});
      }
    }
    if (seg.length > 0) segments.push(seg);
    const color = metricMarkerColor(row.company, row.metric.key);
    const metricOpacity = LINE_STYLE[row.metric.key].opacity;
    const bandOpacity = (0.12 * metricOpacity).toFixed(3);
    return segments.map(seg => {
      let d = "";
      for (const pt of seg) {
        d += `${d ? " L " : "M "}${mapX(pt.i).toFixed(2)} ${mapY(pt.val.ciHi).toFixed(2)}`;
      }
      for (let j = seg.length - 1; j >= 0; j--) {
        d += ` L ${mapX(seg[j].i).toFixed(2)} ${mapY(seg[j].val.ciLo).toFixed(2)}`;
      }
      d += " Z";
      return `<path d="${d}" style="fill:${color};opacity:${bandOpacity}" clip-path="url(#mpi-clip)"></path>`;
    }).join("");
  }).join("");

  return `
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}">
      <defs><clipPath id="mpi-clip"><rect x="${mLeft}" y="${mTop}" width="${pW}" height="${pH}"></rect></clipPath></defs>
      ${drawSingleMonthAxes(
        series.months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, fmtMiles, "Miles Per Incident (MPI)",
      )}
      ${bands}
      ${lines}
      ${errs}
      ${marks}
    </svg>
  `;
}

function drawDualMonthAxes(
  months, svgW, svgH, mLeft, mTop, pW, pH, mapX,
  leftTicks, mapLeftY, leftFmt, leftLabel,
) {
  const axisY = mTop + pH;
  const rightX = mLeft + pW;
  const midY = mTop + pH / 2;
  return `
    ${months.map((month, i) => `
      <line class="month-grid" x1="${mapX(i)}" y1="${mTop}" x2="${mapX(i)}" y2="${axisY}"></line>
      <text class="month-tick" x="${mapX(i)}" y="${svgH - 16}" text-anchor="middle">${month}</text>
    `).join("")}
    ${leftTicks.map(y => `
      <line class="month-grid" x1="${mLeft}" y1="${mapLeftY(y)}" x2="${rightX}" y2="${mapLeftY(y)}"></line>
      <text class="month-tick" x="${mLeft - 8}" y="${mapLeftY(y) + 4}" text-anchor="end">${leftFmt(y)}</text>
    `).join("")}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${axisY}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${axisY}" x2="${rightX}" y2="${axisY}"></line>
    <text class="month-label" x="12" y="${midY}" transform="rotate(-90 12 ${midY})" text-anchor="middle">${leftLabel}</text>
  `;
}

function renderCompanyMonthlyChart(series, company) {
  const svgW = 900;
  const svgH = 250;
  const mLeft = 68;
  const mRight = 24;
  const mTop = 14;
  const mBot = 48;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const rows = companyMonthRows(series, company);
  const vmtMax = Math.max(1, ...rows.map(row => row.vmtMax));
  const incidentMax = Math.max(1, ...rows.map(row => row.incidents.total));
  const leftTicks = linearTicks(0, vmtMax, 4);
  const monthStep = pW / ((series.months.length - 1) || 1);
  const barW = Math.min(30, monthStep * 0.56);
  const xPad = barW / 2 + 2; // inset so edge bars don't overlap axes
  const mapX = idx => scaleLinear(idx, 0, series.months.length - 1, mLeft + xPad, mLeft + pW - xPad);
  const mapVmtY = y => scaleLinear(y, 0, vmtMax, mTop + pH, mTop);
  const mapIncidentY = y => scaleLinear(y, 0, incidentMax, mTop + pH, mTop);
  const vmtColor = MONTHLY_COMPANY_COLORS[company];

  const bars = [];
  const barCounts = [];
  const barTotals = [];
  const errs = [];
  // TO-DO: Human vet new lower-chart tooltip labels below.
  for (let i = 0; i < series.points.length; i++) {
    const row = rows[i];
    const month = series.months[i];
    const x = mapX(i) - barW / 2;
    const rec = row.incidents;
    const monthVmtBest = fmtWhole(row.vmtBest);
    const monthVmtCume = fmtWhole(row.vmtCume);
    let stack = 0;
    for (const bin of SPEED_BINS) {
      const count = rec.speeds[bin];
      const next = stack + count;
      const y0 = mapIncidentY(stack);
      const y1 = mapIncidentY(next);
      const h = y0 - y1;
      stack = next;
      if (h <= 0) continue;
      const barTip = `${company} ${month} (${SPEED_LABELS[bin]})\nIncidents in bin: ${fmtCount(count)}\nIncidents total: ${fmtCount(rec.total)}\nMonthly VMT (best): ${monthVmtBest}\nCumulative VMT: ${monthVmtCume}`;
      bars.push(`
        <rect class="month-inc-bar" x="${x.toFixed(2)}" y="${y1.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}"
              fill="${SPEED_BIN_COLORS[company][bin]}" stroke="${vmtColor}" stroke-width="0.8"><title>${escHtml(barTip)}</title></rect>
      `);
      const centerY = y1 + h / 2;
      barCounts.push(`
        <text class="month-inc-count" x="${(x + barW / 2).toFixed(2)}" y="${centerY.toFixed(2)}">${fmtCount(count)}</text>
      `);
    }
    if (rec.total > 0) {
      const labelX = x + barW / 2;
      const labelY = Math.max(mapIncidentY(rec.total) - 7, mTop + 7);
      barTotals.push(`<text class="month-inc-total" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${fmtCount(rec.total)}</text>`);
    }
    const cx = mapX(i);
    const yLo = mapVmtY(row.vmtMin);
    const yHi = mapVmtY(row.vmtMax);
    const vmtTip = `${company} ${month} (VMT)\nMonthly VMT (best): ${fmtWhole(row.vmtBest)}\nMonthly VMT range: ${fmtWhole(row.vmtMin)} - ${fmtWhole(row.vmtMax)}\nCumulative VMT: ${fmtWhole(row.vmtCume)}\nIncidents total: ${fmtCount(rec.total)}`;
    errs.push(`
      <line class="month-err" x1="${cx.toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}"><title>${escHtml(vmtTip)}</title></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yLo.toFixed(2)}" style="stroke:${vmtColor}"></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yHi.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}"></line>
    `);
  }

  let vmtPath = "";
  for (let i = 0; i < series.points.length; i++) {
    const y = mapVmtY(rows[i].vmtBest);
    vmtPath += `${i ? " L " : "M "}${mapX(i).toFixed(2)} ${y.toFixed(2)}`;
  }

  const vmtMarks = rows.map((row, i) => {
    const x = mapX(i);
    const y = mapVmtY(row.vmtBest);
    const rec = row.incidents;
    const vmtTip = `${company} ${series.months[i]} (VMT)\nMonthly VMT (best): ${fmtWhole(row.vmtBest)}\nMonthly VMT range: ${fmtWhole(row.vmtMin)} - ${fmtWhole(row.vmtMax)}\nCumulative VMT: ${fmtWhole(row.vmtCume)}\nIncidents total: ${fmtCount(rec.total)}`;
    return `<circle class="month-dot" cx="${x}" cy="${y}" r="3.3" style="fill:${vmtColor}"><title>${escHtml(vmtTip)}</title></circle>`;
  }).join("");

  return `
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}">
      ${bars.join("")}
      ${barCounts.join("")}
      ${barTotals.join("")}
      ${errs.join("")}
      <path class="month-vmt-line" d="${vmtPath}" style="stroke:${vmtColor}"></path>
      ${vmtMarks}
      ${drawDualMonthAxes(
        series.months, svgW, svgH, mLeft, mTop, pW, pH, mapX, leftTicks, mapVmtY, fmtMiles,
        "Vehicle Miles Traveled (VMT)",
      )}
    </svg>
  `;
}

// TO-DO: Human vet all end-user labels in these summary cards.
function renderMpiSummaryCards(series) {
  const rows = monthlySummaryRows(series);
  const massFrac = CI_MASS_DEFAULT_PCT / 100;
  const metrics = [
    {label: "All incidents",                 inc: "incTotal",                primary: true},
    {label: "Nonstationary",                 inc: "incNonstationary",        primary: false},
    {label: "Nonstationary non-parking-lot", inc: "incRoadwayNonstationary", primary: false},
  ];
  return rows.map(row => `
    <div class="mpi-card" style="border-left-color:${MONTHLY_COMPANY_COLORS[row.company]}">
      <div class="mpi-card-company">${row.company}</div>
      <div class="mpi-card-vmt">VMT: ${fmtWhole(row.vmtBest)}${row.vmtMin !== row.vmtBest || row.vmtMax !== row.vmtBest ? ` (${fmtWhole(row.vmtMin)} \u2013 ${fmtWhole(row.vmtMax)})` : ""}</div>
      ${metrics.map(m => {
        const k = row[m.inc];
        const a = k + 0.5;
        const tail = (1 - massFrac) / 2;
        const ciLo = 1 / gammaquant(a, row.vmtMin, 1 - tail);
        const ciHi = 1 / gammaquant(a, row.vmtMax, tail);
        const median = 1 / gammaquant(a, row.vmtBest, 0.5);
        return `
        <div class="mpi-card-metric${m.primary ? " primary" : ""}">
          <div>${m.label}: ${fmtCount(k)} incidents \u2192 <span class="mpi-card-mpi">${fmtWhole(median)} MPI</span></div>
          <div class="mpi-card-ci">95% CI: ${fmtWhole(ciLo)} \u2013 ${fmtWhole(ciHi)}</div>
        </div>`;
      }).join("")}
    </div>
  `).join("");
}

function renderMonthlyLegends() {
  byId("month-legend-mpi-companies").innerHTML = ADS_COMPANIES.map(company => `
    <label class="month-legend-item month-company-toggle" for="${monthCompanyToggleId(company)}">
      <input type="checkbox" id="${monthCompanyToggleId(company)}" ${monthCompanyEnabled[company] ? "checked" : ""}>
      <span class="month-chip" style="background:${MONTHLY_COMPANY_COLORS[company]}"></span>${company}
    </label>
  `).join("");
  for (const company of ADS_COMPANIES) {
    const input = byId(monthCompanyToggleId(company));
    input.addEventListener("change", () => {
      monthCompanyEnabled[company] = input.checked;
      buildMonthlyViews();
    });
  }

  byId("month-legend-mpi-lines").innerHTML = `
    ${MONTH_METRIC_DEFS.map(metric => {
      const s = LINE_STYLE[metric.key];
      const color = "#4a5264";
      let keyStyle = `width:22px;height:0;display:inline-block;border-top:${s.width}px solid ${color}`;
      if (s.opacity < 1) keyStyle += `;opacity:${s.opacity}`;
      return `
      <label class="month-legend-item month-company-toggle" for="${monthMetricToggleId(metric.key)}">
        <input type="checkbox" id="${monthMetricToggleId(metric.key)}" ${monthMetricEnabled[metric.key] ? "checked" : ""}>
        <span style="${keyStyle}"></span>${metric.label}
      </label>`;
    }).join("")}
  `;
  for (const metric of MONTH_METRIC_DEFS) {
    const input = byId(monthMetricToggleId(metric.key));
    input.addEventListener("change", () => {
      monthMetricEnabled[metric.key] = input.checked;
      buildMonthlyViews();
    });
  }

  byId("month-legend-lines").innerHTML = `
    <span class="month-legend-item">
      <span class="month-linekey solid"></span>VMT (best)
    </span>
    <span class="month-legend-item">
      <span class="month-chip" style="background:#a6adbb"></span>Incidents (stacked)
    </span>
  `;

  const speedLegendColor = {
    unknown: "#383c46",
    "31+": "#707070",
    "11-30": "#989898",
    "1-10": "#bbbbbb",
    "0": "#d9d9d9",
  };
  byId("month-legend-speed").innerHTML = SPEED_BINS.map(bin => `
    <span class="month-legend-item">
      <span class="month-chip" style="background:${speedLegendColor[bin]}"></span>${SPEED_LABELS[bin]}
    </span>
  `).join("");
}

function buildMonthlyViews() {
  const series = monthSeriesData();
  byId("chart-mpi-all").innerHTML = renderAllCompaniesMpiChart(series);
  byId("mpi-summary-cards").innerHTML = `<div class="mpi-cards">${renderMpiSummaryCards(series)}</div>`;
  byId("chart-company-series").innerHTML = ADS_COMPANIES.map(company => `
    <div class="month-chart">
      <h3>${company}</h3>
      ${renderCompanyMonthlyChart(series, company)}
    </div>
  `).join("");
  renderMonthlyLegends();
}

// --- Fault fraction data ---

function buildFaultDataFromIncidents(rows) {
  const data = {};
  for (const row of rows) {
    must(typeof row.reportId === "string" && row.reportId !== "",
      "incident missing reportId for fault mapping");
    must(row.fault !== null && typeof row.fault === "object",
      "incident missing fault object", {reportId: row.reportId});
    const claude = Number(row.fault.claude);
    const codex = Number(row.fault.codex);
    const gemini = Number(row.fault.gemini);
    must(Number.isFinite(claude) && claude >= 0 && claude <= 1,
      "incident fault.claude out of range", {reportId: row.reportId, val: row.fault.claude});
    must(Number.isFinite(codex) && codex >= 0 && codex <= 1,
      "incident fault.codex out of range", {reportId: row.reportId, val: row.fault.codex});
    must(Number.isFinite(gemini) && gemini >= 0 && gemini <= 1,
      "incident fault.gemini out of range", {reportId: row.reportId, val: row.fault.gemini});
    must(typeof row.fault.rclaude === "string",
      "incident fault.rclaude invalid", {reportId: row.reportId});
    must(typeof row.fault.rcodex === "string",
      "incident fault.rcodex invalid", {reportId: row.reportId});
    must(typeof row.fault.rgemini === "string",
      "incident fault.rgemini invalid", {reportId: row.reportId});
    must(data[row.reportId] === undefined, "duplicate reportId in incidents", {reportId: row.reportId});
    data[row.reportId] = {
      claude,
      codex,
      gemini,
      rclaude: row.fault.rclaude,
      rcodex: row.fault.rcodex,
      rgemini: row.fault.rgemini,
    };
  }
  return data;
}

function faultWeights() {
  return {...faultWeightState};
}

function setFaultWeight(model, rawValue) {
  const value = Number(rawValue);
  must(Number.isFinite(value) && value >= 0,
    "fault weight must be a non-negative number", {model, rawValue});
  faultWeightState[model] = value;
}

function weightedFaultFromValues(claude, codex, gemini, weights) {
  const c = Number(claude);
  const o = Number(codex);
  const g = Number(gemini);
  must(Number.isFinite(c) && c >= 0 && c <= 1, "fault claude out of range", {claude});
  must(Number.isFinite(o) && o >= 0 && o <= 1, "fault codex out of range", {codex});
  must(Number.isFinite(g) && g >= 0 && g <= 1, "fault gemini out of range", {gemini});
  const total = weights.claude + weights.codex + weights.gemini;
  return total === 0 ? null : (weights.claude * c + weights.codex * o + weights.gemini * g) / total;
}

function weightedFault(reportId) {
  const fd = faultData[reportId];
  if (!fd) return null;
  return weightedFaultFromValues(fd.claude, fd.codex, fd.gemini, faultWeights());
}

function faultColor(frac) {
  // Green (0) -> Yellow (0.5) -> Red (1)
  if (frac <= 0.5) {
    const r = Math.round(255 * (frac / 0.5));
    return `rgb(${r}, 180, 60)`;
  }
  const g = Math.round(180 * (1 - (frac - 0.5) / 0.5));
  return `rgb(220, ${g}, 50)`;
}

function faultTooltip(reportId) {
  const fd = faultData[reportId];
  if (!fd) return "";
  return `Claude: ${fd.claude.toFixed(2)} — ${fd.rclaude}\nCodex: ${fd.codex.toFixed(2)} — ${fd.rcodex}\nGemini: ${fd.gemini.toFixed(2)} — ${fd.rgemini}`;
}

function initWeightSliders() {
  for (const model of ["claude", "codex", "gemini"]) {
    const input = byId("w-" + model);
    const valSpan = byId("w-" + model + "-val");
    setFaultWeight(model, input.value);
    input.addEventListener("input", () => {
      setFaultWeight(model, input.value);
      valSpan.textContent = input.value;
      buildMonthlyViews();
      renderTable();
    });
  }
}

// --- Incident Browser ---

let activeFilter = "All";
let sortCol = null;   // column key or null
let sortAsc = true;

const SORT_COLUMNS = [
  {key: "company",  val: r => r.company},
  {key: "date",     val: r => r.date},
  {key: "location", val: r => (r.city + ", " + r.state)},
  {key: "crashWith",val: r => r.crashWith},
  {key: "speed",    val: r => r.speed !== null ? r.speed : -1},
  {key: "fault",    val: r => { const f = weightedFault(r.reportId); return f !== null ? f : -1; }},
  {key: "severity", val: r => r.severity || ""},
  {key: "narrative", val: r => r.narrative || ""},
];

const HEADER_LABELS = ["Company", "Date", "Location", "Crash with", "Speed (mph)", "Fault", "Severity", "Narrative"];

function buildBrowser() {
  const rows = incidentsInVmtWindow();
  const counts = countByCompany(rows);
  const filterDiv = byId("filters");
  filterDiv.replaceChildren();
  const companies = ["All", ...ADS_COMPANIES];
  for (const c of companies) {
    const btn = document.createElement("button");
    const n = c === "All" ? rows.length : (counts[c] || 0);
    btn.textContent = `${c} (${n})`;
    btn.className = c === activeFilter ? "active" : "";
    btn.addEventListener("click", () => {
      activeFilter = c;
      buildBrowser();
    });
    filterDiv.appendChild(btn);
  }
  renderHeaders();
  renderTable();
}

function renderHeaders() {
  const thead = byId("incidents-head");
  const tr = document.createElement("tr");
  for (let i = 0; i < HEADER_LABELS.length; i++) {
    const th = document.createElement("th");
    const col = SORT_COLUMNS[i];
    let label = HEADER_LABELS[i];
    if (sortCol === col.key) {
      label += sortAsc ? " \u25B2" : " \u25BC";
    }
    th.textContent = label;
    th.addEventListener("click", () => {
      if (sortCol === col.key) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col.key;
        sortAsc = true;
      }
      renderHeaders();
      renderTable();
    });
    tr.appendChild(th);
  }
  thead.replaceChildren(tr);
}

function renderTable() {
  const tbody = byId("incidents-body");
  const rows = incidentsInVmtWindow();
  let filtered = activeFilter === "All"
    ? [...rows]
    : rows.filter(r => r.company === activeFilter);

  if (sortCol !== null) {
    const colDef = SORT_COLUMNS.find(c => c.key === sortCol);
    if (colDef) {
      filtered.sort((a, b) => {
        const va = colDef.val(a);
        const vb = colDef.val(b);
        let cmp = 0;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        return sortAsc ? cmp : -cmp;
      });
    }
  }

  byId("incident-count").textContent =
    `${filtered.length} incidents`;

  tbody.innerHTML = "";
  for (const r of filtered) {
    const tr = document.createElement("tr");
    const isCbi = r.narrativeCbi === "Y";
    const narrativeText = isCbi
      ? "[\"Confidential Business Information\"]"
      : (r.narrative || "");
    const narrativeClass = isCbi ? "narrative-cell cbi" : "narrative-cell";

    const fault = weightedFault(r.reportId);
    const faultHtml = fault !== null
      ? `<span class="fault-bar" style="width:${Math.round(fault * 40)}px;background:${faultColor(fault)}"></span>${fault.toFixed(2)}`
      : "—";
    const faultTip = escAttr(faultTooltip(r.reportId));

    tr.innerHTML = `
      <td>${escHtml(r.company)}</td>
      <td>${escHtml(r.date)}</td>
      <td>${escHtml(r.city)}, ${escHtml(r.state)}</td>
      <td>${escHtml(r.crashWith)}</td>
      <td>${escHtml(r.speed !== null ? String(r.speed) : "?")}</td>
      <td class="fault-cell" title="${faultTip}">${faultHtml}</td>
      <td>${escHtml(shortenSeverity(r.severity))}</td>
      <td class="${narrativeClass}">${escHtml(narrativeText)}</td>
    `;
    // Click to expand/collapse narrative
    const narrativeTd = tr.querySelector(".narrative-cell");
    must(narrativeTd !== null, "Missing narrative cell");
    narrativeTd.addEventListener("click", () => {
      narrativeTd.classList.toggle("expanded");
    });
    tbody.appendChild(tr);
  }
}

function shortenSeverity(s) {
  const rules = [
    ["No Injured", "No injury"],
    ["Minor W/O", "Minor injury"],
    ["Minor W/", "Minor injury (hosp.)"],
    ["Serious", "Serious"],
    ["Fatal", "Fatal"],
    ["Property", "Property only"],
  ];
  const hit = (s || "") && rules.find(([needle]) => s.includes(needle));
  return hit ? hit[1] : (s || "?");
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}

// --- Init ---

{
  const incidentData = INCIDENT_DATA;
  must(Array.isArray(incidentData), "INCIDENT_DATA must be an array");
  for (const inc of incidentData) {
    must(inc !== null && typeof inc === "object", "incident must be an object");
    must(typeof inc.company === "string", "incident missing company");
    must(COMPANIES[inc.company] !== undefined,
      "inline incident data has unknown company", {company: inc.company});
  }
  incidents = incidentData;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(incidentData);
  if (document.getElementById("ci-mass")) {
    initCiMassControl();
    buildEstimator();
  }
  initWeightSliders();
  buildMonthlyViews();
  buildBrowser();
}

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
let monthCompanyEnabled = {Tesla: true, Waymo: true, Zoox: true, Humans: true};
// Unified metric definitions. Each entry fully specifies one MPI variant:
// label (chart legend), cardLabel (summary card), line style, human benchmark,
// count function, and whether it's enabled by default.
//
// To add a new MPI variant, just add one entry here and (if needed) add the
// corresponding incident field accumulation in monthSeriesData().
//
// Human reference MPI ranges from Kusano/Scanlon methodology
// (surface streets, passenger vehicles, Blincoe underreporting adjustment)
// and FARS/NHTSA. We show ranges because the exact apples-to-apples
// correction is uncertain. The true value should lie within [lo, hi].
//
// lo = most SGO-comparable (Blincoe-adjusted, surface streets, higher rate)
// hi = most conservative (police-reported or observed, lower rate)
//
// Sources:
//   Kusano/Scanlon 7.1M-mi paper (arxiv 2312.12675, Table 3):
//     All crashes: Blincoe-adj 9.67 IPMM, police-reported 4.68 IPMM
//     Any-injury:  Blincoe-adj 2.80 IPMM, observed 1.91 IPMM
//   Waymo safety impact page (waymo.com/safety/impact, 127M mi, Sep 2025):
//     Any-injury 3.97 IPMM, airbag deploy 1.66 IPMM, SSI+ 0.23 IPMM
//   FARS 2023: national 1.26 fatalities/100M VMT; urban ~0.7-1.15/100M VMT
//
// Derived metrics use the subset-bounding approach: if metric B is a subset
// of metric A, then MPI-B >= MPI-A. The true value is bounded by neighbors.
//
// Note: all benchmarks are for surface streets in AV operating areas, which
// have higher crash rates than the nationwide average. This is more
// apples-to-apples than the raw national numbers.
const METRIC_DEFS = [
  { key: "all",
    label: "Miles per incident",
    cardLabel: "All incidents",
    incField: "incTotal",
    marker: "solid-circle",
    lineWidth: 2.5, lineOpacity: 1,
    defaultEnabled: true, primary: true,
    countFn: rec => rec.incidents.total,
    humanMPI: {lo: 103000, hi: 214000,
      // Kusano Blincoe-adj (9.67 IPMM) to police-reported (4.68 IPMM)
      src: 'lo: 1M/9.67 Blincoe-adj IPMM; hi: 1M/4.68 police-reported IPMM',
      srcLinks: [
        {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
      ]},
  },
  { key: "nonstationary",
    label: "Miles per nonstationary incident",
    cardLabel: "Nonstationary",
    incField: "incNonstationary",
    marker: "hollow-circle",
    lineWidth: 1.5, lineOpacity: 0.55,
    defaultEnabled: false, primary: false,
    countFn: rec => nonstationaryIncidentCount(rec.incidents.speeds),
    // ~95-97% of all crashes are nonstationary (excl hit-while-parked)
    humanMPI: {lo: 106000, hi: 225000,
      src: 'All-crash range adjusted for ~3\u20135% hit-while-parked share (CRSS)',
      srcLinks: [
        {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
      ]},
  },
  { key: "roadwayNonstationary",
    label: "Miles per nonstationary non-parking-lot incident",
    cardLabel: "Nonstationary non-parking-lot",
    incField: "incRoadwayNonstationary",
    marker: "hollow-square",
    lineWidth: 1.2, lineOpacity: 0.8,
    defaultEnabled: false, primary: false,
    countFn: rec => roadwayNonstationaryIncidentCount(rec),
    // CRSS is already trafficway-only ≈ non-parking-lot; ~same ratio
    humanMPI: {lo: 108000, hi: 228000,
      src: 'CRSS trafficway-only rates \u2248 non-parking-lot; similar ratio',
      srcLinks: [
        {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
      ]},
  },
  { key: "atfault",
    label: "Miles per at-fault incident",
    cardLabel: "At-fault",
    incField: "incAtFault",
    marker: "hollow-triangle",
    lineWidth: 1, lineOpacity: 0.3,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.atFault,
    // ~50-65% of crash involvements are at-fault (single-vehicle 100%,
    // multi-vehicle ~50%; weighted mix gives 50-65%)
    humanMPI: {lo: 160000, hi: 430000,
      src: '50\u201365% at-fault share (single-vehicle 100%, multi ~50%)',
      srcLinks: [
        {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
      ]},
  },
  { key: "atfaultInjury",
    label: "Miles per at-fault injury crash",
    cardLabel: "At-fault injury",
    incField: "incAtFaultInjury",
    marker: "hollow-triangle",
    lineWidth: 1, lineOpacity: 0.4,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.atFaultInjury,
    // At-fault injury: intersection of at-fault and injury crashes.
    // lo: injury lo (252k) / ~85% at-fault share in injury crashes ≈ 300k
    // hi: national injury-crash MPI (~1.91M) as ceiling
    humanMPI: {lo: 300000, hi: 1900000,
      src: 'lo: injury lo (252k) / ~85% at-fault share in injury crashes; hi: national injury-crash MPI (~1.91M) as ceiling',
      srcLinks: [
        {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
        {label: 'Waymo safety impact (127M mi)', url: 'https://waymo.com/safety/impact/'},
        {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        {label: 'NHTSA critical reason (94%)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115'},
      ]},
  },
  { key: "injury",
    label: "Miles per injury crash",
    cardLabel: "Injury",
    incField: "incInjury",
    marker: "solid-circle",
    lineWidth: 2, lineOpacity: 0.9,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.injury,
    // Waymo safety page benchmark (3.97 IPMM) to Kusano observed (1.91)
    humanMPI: {lo: 252000, hi: 524000,
      src: 'lo: 1M/3.97 Waymo benchmark IPMM; hi: 1M/1.91 Kusano observed IPMM',
      srcLinks: [
        {label: 'Waymo safety impact (127M mi)', url: 'https://waymo.com/safety/impact/'},
        {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
      ]},
  },
  { key: "hospitalization",
    label: "Miles per hospitalization crash",
    cardLabel: "Hospitalization",
    incField: "incHospitalization",
    marker: "solid-circle",
    lineWidth: 1.5, lineOpacity: 0.7,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.hospitalization,
    // Between airbag-deployment proxy (1.66 IPMM ≈ crashes with enough
    // force to likely send someone to ER) and SSI+ (0.23 IPMM = KABCO
    // A+K). SGO "W/ Hospitalization" = transported to hospital (incl ER
    // visits for minor injuries — 16/19 Waymo hosp are "Minor W/ Hosp").
    humanMPI: {lo: 600000, hi: 4350000,
      src: 'lo: 1M/1.66 airbag-deploy IPMM; hi: 1M/0.23 SSI+ IPMM',
      srcLinks: [
        {label: 'Waymo safety impact (127M mi)', url: 'https://waymo.com/safety/impact/'},
      ]},
  },
  { key: "airbag",
    label: "Miles per airbag-deploying crash",
    cardLabel: "Airbag deployment",
    incField: "incAirbag",
    marker: "solid-circle",
    lineWidth: 1.2, lineOpacity: 0.6,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.airbag,
    // Airbag deployment in any vehicle. Waymo safety impact page: human
    // benchmark 1.66 IPMM (police-reported, AV operating counties, no
    // underreporting adjustment — airbag deployments are mechanically
    // triggered and rarely underreported). Range accounts for modest
    // geographic/methodological variation.
    humanMPI: {lo: 500000, hi: 700000,
      src: 'Waymo safety impact: 1.66 IPMM police-reported airbag-deploy rate in AV operating counties',
      srcLinks: [
        {label: 'Waymo safety impact (127M mi)', url: 'https://waymo.com/safety/impact/'},
      ]},
  },
  { key: "seriousInjury",
    label: "Miles per serious injury crash",
    cardLabel: "Serious injury (SSI+)",
    incField: "incSeriousInjury",
    marker: "solid-circle",
    lineWidth: 1.2, lineOpacity: 0.55,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.seriousInjury,
    // SSI+ (KABCO A+K): Moderate W/ Hospitalization + Fatality.
    // Waymo safety impact page: 0.23 IPMM. Range: 0.30 IPMM (broader
    // definition, SGO "Moderate" may include some KABCO B cases) to
    // 0.15 IPMM (narrower, only most severe subset).
    humanMPI: {lo: 3300000, hi: 6700000,
      src: 'Waymo safety impact SSI+ 0.23 IPMM; range 0.15\u20130.30 for definitional uncertainty',
      srcLinks: [
        {label: 'Waymo safety impact (127M mi)', url: 'https://waymo.com/safety/impact/'},
      ]},
  },
  { key: "fatality",
    label: "Miles per fatal crash",
    cardLabel: "Fatality",
    incField: "incFatality",
    marker: "solid-circle",
    lineWidth: 1.2, lineOpacity: 0.5,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.fatality,
    // FARS national per-vehicle-adjusted (75M) to urban surface-street
    // estimate (~130M, using urban fatality rate ~0.7-1.15 per 100M VMT)
    humanMPI: {lo: 75000000, hi: 130000000,
      src: 'lo: FARS national 1.33/100M VMT; hi: urban surface-street ~0.77/100M VMT',
      srcLinks: [
        {label: 'NHTSA FARS 2023', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        {label: 'IIHS urban/rural comparison', url: 'https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison'},
      ]},
  },
];

// Derived accessors — consumed by rendering code throughout
const MONTH_METRIC_DEFS = METRIC_DEFS;
const LINE_STYLE = Object.fromEntries(
  METRIC_DEFS.map(m => [m.key, {width: m.lineWidth, opacity: m.lineOpacity}]));
const KNOWN_HUMAN_MPI = Object.fromEntries(
  METRIC_DEFS.filter(m => m.humanMPI).map(m => [m.key, m.humanMPI]));
let monthMetricEnabled = Object.fromEntries(
  METRIC_DEFS.map(m => [m.key, m.defaultEnabled]));

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
const CI_FAN_LEVELS = [0.50, 0.80, 0.95]; // nested CI bands from tight to wide
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
  Humans: "#888",
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
// Movement-based partition of total incidents (sums to total)
// TO-DO: Human vet segment labels below.
const MOVEMENT_SEGMENTS = [
  {key: "roadwayNonstationary", label: "Non-parking-lot nonstationary", mpiKey: "roadwayNonstationary"},
  {key: "parkingLotNonstationary", label: "Parking-lot nonstationary", mpiKey: "nonstationary"},
  {key: "stationary",           label: "Stationary",               mpiKey: "all"},
];
// Severity-based partition of total incidents (sums to total)
const SEVERITY_SEGMENTS = [
  {key: "fatality",             label: "Fatality",                 mpiKey: "fatality"},
  {key: "hospitalizationOnly",  label: "Hospitalization (non-fatal)", mpiKey: "hospitalization"},
  {key: "injuryOnly",           label: "Injury (non-hosp.)",       mpiKey: "injury"},
  {key: "noInjury",             label: "No injury",                mpiKey: "all"},
];
// Colors for movement segments (darkest = most relevant to MPI)
const MOVEMENT_COLORS = {
  Tesla: {roadwayNonstationary: "#d13b2d", parkingLotNonstationary: "#e06f66", stationary: "#d9d9d9"},
  Waymo: {roadwayNonstationary: "#2060c0", parkingLotNonstationary: "#5a87d1", stationary: "#d9d9d9"},
  Zoox:  {roadwayNonstationary: "#2a8f57", parkingLotNonstationary: "#5ead7e", stationary: "#d9d9d9"},
};
// Colors for severity segments (darkest = most severe)
const SEVERITY_COLORS = {
  Tesla: {fatality: "#8b1a10", hospitalizationOnly: "#d13b2d", injuryOnly: "#e06f66", noInjury: "#efaaa4"},
  Waymo: {fatality: "#0e3870", hospitalizationOnly: "#2060c0", injuryOnly: "#5a87d1", noInjury: "#99b4e5"},
  Zoox:  {fatality: "#14553a", hospitalizationOnly: "#2a8f57", injuryOnly: "#5ead7e", noInjury: "#98ccb0"},
};
// Legend colors (company-neutral)
const MOVEMENT_LEGEND_COLORS = {
  roadwayNonstationary: "#505050", parkingLotNonstationary: "#909090", stationary: "#d0d0d0",
};
const SEVERITY_LEGEND_COLORS = {
  fatality: "#383c46", hospitalizationOnly: "#606060", injuryOnly: "#909090", noInjury: "#c8c8c8",
};

// Compute movement and severity segment counts from an incident record
function movementSegmentCounts(rec) {
  const nonstationary = nonstationaryIncidentCount(rec.speeds);
  return {
    roadwayNonstationary: rec.roadwayNonstationary,
    parkingLotNonstationary: nonstationary - rec.roadwayNonstationary,
    stationary: rec.total - nonstationary,
  };
}
function severitySegmentCounts(rec) {
  return {
    fatality: rec.fatality,
    hospitalizationOnly: rec.hospitalization - rec.fatality,
    injuryOnly: rec.injury - rec.hospitalization,
    noInjury: rec.total - rec.injury,
  };
}

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
  for (const inc of rows) {
    must(monthSet.has(monthKeyFromIncidentLabel(inc.date)),
      "incident date outside VMT window",
      {reportId: inc.reportId, company: inc.company, date: inc.date});
  }
  return rows;
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
        <line class="graph-refline" x1="${mLeft}" y1="${p.lineY}" x2="${mLeft + pW}" y2="${p.lineY}" style="stroke:${MONTHLY_COMPANY_COLORS[p.company]}"></line>
        <text class="graph-reflabel" x="${mLeft + pW - 4}" y="${p.labelY}" text-anchor="end" style="fill:${MONTHLY_COMPANY_COLORS[p.company]}">${p.company}: ${fmtMiles(p.est.median)}</text>
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
  must(lines[0] === "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale",
    "VMT sheet CSV header mismatch", {header: lines[0]});
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const N = "\\d+(?:\\.\\d+)?"; // number pattern
    const re = new RegExp(
      `^([^,]+),(\\d{4}-\\d{2}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(${N}),(.*)$`
    );
    const hit = re.exec(line);
    must(hit !== null, "Malformed VMT sheet CSV row", {lineNo: i + 1, line});
    const companyRaw = hit[1].trim();
    const company = ADS_COMPANIES.find(c => c.toLowerCase() === companyRaw.toLowerCase());
    must(company !== undefined, "VMT sheet CSV has unknown company", {companyRaw});
    const vmtBest = Number(hit[3]);
    const vmtCume = Number(hit[4]);
    const vmtMin = Number(hit[5]);
    const vmtMax = Number(hit[6]);
    const coverage = Number(hit[7]); // fraction of month in NHTSA window
    // Incident reporting completeness (Poisson thinning factor).
    // When Monthly reports are structurally absent for the last month, this
    // is the historical 5-Day fraction for the company.  Multiplied into
    // effective VMT so the Gamma posterior reflects the thinned observation.
    const incCov     = Number(hit[8]);  // best estimate
    const incCovMin  = Number(hit[9]);  // most pessimistic (smallest p)
    const incCovMax  = Number(hit[10]); // most optimistic (largest p)
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
    must(incCov > 0 && incCov <= 1, "incident_coverage must be in (0, 1]",
      {lineNo: i + 1, incCov});
    must(incCovMin > 0 && incCovMin <= incCov,
      "incident_coverage_min must be in (0, incident_coverage]",
      {lineNo: i + 1, incCovMin, incCov});
    must(incCovMax >= incCov && incCovMax <= 1,
      "incident_coverage_max must be in [incident_coverage, 1]",
      {lineNo: i + 1, incCovMax, incCov});
    rows.push({
      company,
      month: hit[2],
      vmtMin,
      vmtBest,
      vmtMax,
      vmtCume,
      coverage,
      incCov,
      incCovMin,
      incCovMax,
      rationale: csvUnquote(hit[11]),
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

// Severity classification for SGO data
const INJURY_SEVERITIES = new Set([
  "Minor W/O Hospitalization",
  "Minor W/ Hospitalization",
  "Moderate W/O Hospitalization",
  "Moderate W/ Hospitalization",
  "Fatality",
]);
const HOSPITALIZATION_SEVERITIES = new Set([
  "Minor W/ Hospitalization",
  "Moderate W/ Hospitalization",
  "Fatality",
]);
// SSI+ (KABCO A+K): suspected serious injury or worse
const SERIOUS_INJURY_SEVERITIES = new Set([
  "Moderate W/ Hospitalization",
  "Fatality",
]);

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
    // Auto-generate inc fields from METRIC_DEFS
    const incFields = Object.fromEntries(
      METRIC_DEFS.map(m => [m.incField, rows.reduce((sum, row) => sum + m.countFn(row), 0)]));
    must(incFields.incTotal > 0, "summary total incidents must be positive", {company, incTotal: incFields.incTotal});
    must(incFields.incNonstationary > 0,
      "summary nonstationary incidents must be positive", {company, incNonstationary: incFields.incNonstationary});
    must(incFields.incRoadwayNonstationary > 0,
      "summary roadway nonstationary incidents must be positive", {company, incRoadwayNonstationary: incFields.incRoadwayNonstationary});
    return {
      company,
      vmtMin,
      vmtBest,
      vmtMax,
      ...incFields,
      milesPerIncident: vmtBest / incFields.incTotal,
      milesPerNonstationaryIncident: vmtBest / incFields.incNonstationary,
      milesPerRoadwayNonstationaryIncident: vmtBest / incFields.incRoadwayNonstationary,
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
    must(monthSet.has(month), "incident date outside VMT window",
      {reportId: inc.reportId, company: inc.company, date: inc.date, month});
    const key = inc.company + "|" + month;
    let rec = incidentsByKey[key];
    if (rec === undefined) {
      rec = {total: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0,
             atFaultInjury: 0, injury: 0, hospitalization: 0, airbag: 0,
             seriousInjury: 0, fatality: 0};
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
    rec.atFaultInjury += (atFaultFrac || 0) * Number(INJURY_SEVERITIES.has(inc.severity));
    rec.injury += Number(INJURY_SEVERITIES.has(inc.severity));
    rec.hospitalization += Number(HOSPITALIZATION_SEVERITIES.has(inc.severity));
    rec.airbag += Number(inc.airbagAny === true);
    rec.seriousInjury += Number(SERIOUS_INJURY_SEVERITIES.has(inc.severity));
    // Per-vehicle fatality: divide by number of vehicles involved to match
    // fleet-wide fatality rate methodology (see theargumentmag.com article).
    // vehiclesInvolved defaults to 2; overridden in preprocess.py when the
    // narrative reveals more vehicles (e.g., 3 for the Tempe fatality).
    rec.fatality += Number(inc.severity === "Fatality") / inc.vehiclesInvolved;
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
      const inc = incidentsByKey[key] || {total: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0, atFaultInjury: 0, injury: 0, hospitalization: 0, airbag: 0, seriousInjury: 0, fatality: 0};
      const c = vmt.coverage; // pro-rate VMT to match the incident observation window
      // Incident coverage: when Monthly reports are absent for the last month,
      // the observed 5-Day count is a Poisson-thinned subset.  Scaling VMT by
      // the thinning probability p gives the correct posterior Gamma(k+0.5, m*p).
      // incCovMin (smallest p) pairs with vmtMin for the most pessimistic MPI;
      // incCovMax (largest p) pairs with vmtMax for the most optimistic MPI.
      companies[company] = {
        // Effective VMT: used for MPI computation (Poisson rate estimation)
        vmtMin: vmt.vmtMin * c * vmt.incCovMin,
        vmtBest: vmt.vmtBest * c * vmt.incCov,
        vmtMax: vmt.vmtMax * c * vmt.incCovMax,
        // Raw VMT: used for fleet trend visualization on lower charts
        vmtRawMin: vmt.vmtMin * c,
        vmtRawBest: vmt.vmtBest * c,
        vmtRawMax: vmt.vmtMax * c,
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
  const countByMetric = Object.fromEntries(
    METRIC_DEFS.map(m => [m.key, m.countFn]));
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
        const mpiMin = estimateMpi(k, row.vmtMin, massFrac).median;
        const mpiMax = estimateMpi(k, row.vmtMax, massFrac).median;
        const a = k + 0.5;
        // Fan chart: nested CI bands at 50%, 80%, 95%
        const bands = CI_FAN_LEVELS.map(level => {
          const t = (1 - level) / 2;
          return {
            lo: 1 / gammaquant(a, row.vmtMin, 1 - t),
            hi: 1 / gammaquant(a, row.vmtMax, t),
          };
        });
        if (k > 0) yMax = Math.max(yMax, mpiBest, mpiMax);
        return {
          mpiMin, mpiBest, mpiMax, bands, incidentCount: k,
          vmtMonth: row.vmtRawBest,
          vmtMonthEff: row.vmtBest,
          vmtCume: row.vmtCume,
        };
      });
      seriesRows.push({company, metric, vals});
    }
  }

  // Human reference bands always render (no toggle)
  const humanRefLines = [];
  for (const metric of includedMonthMetrics()) {
    if (KNOWN_HUMAN_MPI[metric.key] === undefined) continue;
    const range = KNOWN_HUMAN_MPI[metric.key];
    humanRefLines.push({metric, lo: range.lo, hi: range.hi});
    yMax = Math.max(yMax, range.hi);
  }
  // Subset metrics must have higher MPI (rarer events = more miles between).
  const humanLoByKey = Object.fromEntries(
    humanRefLines.map(r => [r.metric.key, r.lo]));
  const subsetChains = [
    ["all", "nonstationary", "roadwayNonstationary"],
    ["all", "atfault", "atfaultInjury"],
    ["all", "injury", "atfaultInjury"],
    ["injury", "hospitalization", "fatality"],
  ];
  for (const chain of subsetChains) {
    for (let i = 1; i < chain.length; i++) {
      if (humanLoByKey[chain[i-1]] === undefined) continue;
      if (humanLoByKey[chain[i]]   === undefined) continue;
      must(humanLoByKey[chain[i-1]] <= humanLoByKey[chain[i]],
        "human MPI ordering violated", {
          lesser: chain[i-1], lesserMpi: humanLoByKey[chain[i-1]],
          greater: chain[i], greaterMpi: humanLoByKey[chain[i]],
        });
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
      if (mpi.incidentCount === 0) {
        penDown = false;
        continue;
      }
      d += `${penDown ? " L " : "M "}${mapX(i).toFixed(2)} ${mapY(mpi.mpiBest).toFixed(2)}`;
      penDown = true;
    }
    return `<path class="month-mpi-all-line" d="${d}" style="${metricLineStyle(row.company, row.metric.key)}"></path>`;
  }).join("");

  const errs = `<g clip-path="url(#mpi-clip)">` + seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi.incidentCount === 0) return "";
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
  ).join("") + `</g>`;

  const marks = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi.incidentCount === 0) return "";
      const x = mapX(i);
      const y = mapY(mpi.mpiBest);
      const color = metricMarkerColor(row.company, row.metric.key);
      const marker = markerRenderer[row.metric.marker];
      must(typeof marker === "function", "missing marker renderer", {marker: row.metric.marker});
      const k = mpi.incidentCount;
      const kFmt = Number.isInteger(k) ? String(k) : k.toFixed(1);
      // TO-DO: Human vet new tooltip mileage labels below.
      const ci95 = mpi.bands[mpi.bands.length - 1];
      const tip = `${row.company} ${series.months[i]} (${row.metric.label})\nMPI: ${fmtMiles(mpi.mpiBest)} (${kFmt} incident${k === 1 ? "" : "s"})\n95% CI: ${fmtMiles(ci95.lo)} \u2013 ${fmtMiles(ci95.hi)}\nMonthly VMT: ${fmtWhole(mpi.vmtMonth)}\nEffective VMT for MPI: ${fmtWhole(mpi.vmtMonthEff)}\nCumulative VMT: ${fmtWhole(mpi.vmtCume)}`;
      return `<g>${marker(x, y, color, 1)}<circle cx="${x}" cy="${y}" r="12" fill="none" pointer-events="all" style="cursor:pointer" data-tip="${escAttr(tip)}"></circle></g>`;
    }).join("")
  ).join("");

  // Fan chart: nested CI bands at 50%, 80%, 95% with decreasing opacity.
  // Bands are always continuous — even months with k=0 have a valid posterior
  // (Gamma(0.5, m)), just with very high MPI and wide uncertainty.
  // Clamp to plot range so SVG coordinates stay reasonable.
  const clampY = v => Math.max(mTop, Math.min(mTop + pH, mapY(v)));
  const bands = seriesRows.map(row => {
    const color = metricMarkerColor(row.company, row.metric.key);
    const metricOpacity = LINE_STYLE[row.metric.key].opacity;
    // Draw widest band first (95%), then 80%, then 50% on top
    return CI_FAN_LEVELS.slice().reverse().map((_level, li) => {
      const bandIdx = CI_FAN_LEVELS.length - 1 - li; // index into bands array
      const bandOpacity = (0.10 * metricOpacity * (1 + li * 0.5)).toFixed(3);
      let d = "";
      for (let i = 0; i < row.vals.length; i++) {
        d += `${d ? " L " : "M "}${mapX(i).toFixed(2)} ${clampY(row.vals[i].bands[bandIdx].hi).toFixed(2)}`;
      }
      for (let i = row.vals.length - 1; i >= 0; i--) {
        d += ` L ${mapX(i).toFixed(2)} ${clampY(row.vals[i].bands[bandIdx].lo).toFixed(2)}`;
      }
      d += " Z";
      return `<path d="${d}" style="fill:${color};opacity:${bandOpacity}"></path>`;
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
      <g clip-path="url(#mpi-clip)">${humanRefLines.map(ref => {
        const yLo = clampY(ref.lo);
        const yHi = clampY(ref.hi);
        const yMid = clampY(Math.sqrt(ref.lo * ref.hi)); // geometric mean
        const s = LINE_STYLE[ref.metric.key];
        const metricOpacity = s.opacity < 1 ? s.opacity : 1;
        // Shaded band between lo and hi
        const bandH = Math.abs(yLo - yHi);
        const bandTop = Math.min(yLo, yHi);
        return `
          <rect x="${mLeft}" y="${bandTop.toFixed(2)}" width="${pW}" height="${bandH.toFixed(2)}"
            style="fill:#888;opacity:${(0.10 * metricOpacity).toFixed(3)}"></rect>
          <line x1="${mLeft}" y1="${yMid.toFixed(2)}" x2="${mLeft + pW}" y2="${yMid.toFixed(2)}"
            style="stroke:#888;stroke-width:${s.width};stroke-dasharray:6 4;opacity:${(0.5 * metricOpacity).toFixed(3)}"></line>
          <text x="${mLeft + pW - 4}" y="${(Math.min(yLo, yHi) - 3).toFixed(2)}" text-anchor="end"
            style="fill:#888;font-size:9px;opacity:${(0.7 * metricOpacity).toFixed(3)}">${fmtMiles(ref.lo)}\u2013${fmtMiles(ref.hi)}</text>`;
      }).join("")}</g>
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
  const vmtMax = Math.max(1, ...rows.map(row => row.vmtRawMax));
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
  const halfBar = (barW - 1) / 2; // 1px gap between the two bars
  const massFrac = CI_MASS_DEFAULT_PCT / 100;
  // TO-DO: Human vet new lower-chart tooltip labels below.
  for (let i = 0; i < series.points.length; i++) {
    const row = rows[i];
    const month = series.months[i];
    const cx = mapX(i);
    const rec = row.incidents;
    const monthVmtBest = fmtWhole(row.vmtRawBest);
    const monthVmtCume = fmtWhole(row.vmtCume);
    const monthVmtEff = fmtWhole(row.vmtBest);

    // MPI for each variant (used in hover text)
    const nonstationary = nonstationaryIncidentCount(rec.speeds);
    const mpiByKey = {};
    const variantCounts = {
      all: rec.total, nonstationary, roadwayNonstationary: rec.roadwayNonstationary,
      atfault: rec.atFault, atfaultInjury: rec.atFaultInjury, injury: rec.injury, hospitalization: rec.hospitalization,
      fatality: rec.fatality,
    };
    for (const [vk, vk_count] of Object.entries(variantCounts)) {
      mpiByKey[vk] = fmtMiles(estimateMpi(vk_count, row.vmtBest, massFrac).median);
    }

    // Render one stacked bar column
    const renderBar = (xLeft, w, segments, colors, counts) => {
      let stack = 0;
      for (const seg of segments) {
        const count = counts[seg.key];
        const next = stack + count;
        const y0 = mapIncidentY(stack);
        const y1 = mapIncidentY(next);
        const h = y0 - y1;
        stack = next;
        if (h <= 0) continue;
        const mpiLabel = `MPI (${seg.label.toLowerCase()}): ${mpiByKey[seg.mpiKey]}`;
        const barTip = `${company} ${month} \u2014 ${seg.label}\nSegment: ${fmtCount(count)} incidents\nTotal: ${fmtCount(rec.total)} incidents\n${mpiLabel}\nMonthly VMT: ${monthVmtBest}\nEffective VMT for MPI: ${monthVmtEff}\nCumulative VMT: ${monthVmtCume}`;
        bars.push(`
          <rect class="month-inc-bar" x="${xLeft.toFixed(2)}" y="${y1.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"
                fill="${colors[seg.key]}" stroke="${vmtColor}" stroke-width="0.8" data-tip="${escAttr(barTip)}"></rect>
        `);
        const centerY = y1 + h / 2;
        barCounts.push(`
          <text class="month-inc-count" x="${(xLeft + w / 2).toFixed(2)}" y="${centerY.toFixed(2)}">${fmtCount(count)}</text>
        `);
      }
    };

    // Left bar: movement partition
    const moveCounts = movementSegmentCounts(rec);
    renderBar(cx - barW / 2, halfBar, MOVEMENT_SEGMENTS, MOVEMENT_COLORS[company], moveCounts);

    // Right bar: severity partition
    const sevCounts = severitySegmentCounts(rec);
    renderBar(cx - barW / 2 + halfBar + 1, halfBar, SEVERITY_SEGMENTS, SEVERITY_COLORS[company], sevCounts);

    if (rec.total > 0) {
      const labelX = cx;
      const labelY = Math.max(mapIncidentY(rec.total) - 7, mTop + 7);
      barTotals.push(`<text class="month-inc-total" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${fmtCount(rec.total)}</text>`);
    }
    const yLo = mapVmtY(row.vmtRawMin);
    const yHi = mapVmtY(row.vmtRawMax);
    const vmtTip = `${company} ${month} (VMT)\nMonthly VMT (best): ${fmtWhole(row.vmtRawBest)}\nMonthly VMT range: ${fmtWhole(row.vmtRawMin)} \u2013 ${fmtWhole(row.vmtRawMax)}\nEffective VMT for MPI: ${fmtWhole(row.vmtBest)}\nCumulative VMT: ${fmtWhole(row.vmtCume)}\nIncidents total: ${fmtCount(rec.total)}`;
    errs.push(`
      <line class="month-err" x1="${cx.toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}" data-tip="${escAttr(vmtTip)}"></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yLo.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yLo.toFixed(2)}" style="stroke:${vmtColor}"></line>
      <line class="month-err" x1="${(cx - 4).toFixed(2)}" y1="${yHi.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${yHi.toFixed(2)}" style="stroke:${vmtColor}"></line>
    `);
  }

  let vmtPath = "";
  for (let i = 0; i < series.points.length; i++) {
    const y = mapVmtY(rows[i].vmtRawBest);
    vmtPath += `${i ? " L " : "M "}${mapX(i).toFixed(2)} ${y.toFixed(2)}`;
  }

  const vmtMarks = rows.map((row, i) => {
    const x = mapX(i);
    const y = mapVmtY(row.vmtRawBest);
    const rec = row.incidents;
    const vmtTip = `${company} ${series.months[i]} (VMT)\nMonthly VMT (best): ${fmtWhole(row.vmtRawBest)}\nMonthly VMT range: ${fmtWhole(row.vmtRawMin)} \u2013 ${fmtWhole(row.vmtRawMax)}\nEffective VMT for MPI: ${fmtWhole(row.vmtBest)}\nCumulative VMT: ${fmtWhole(row.vmtCume)}\nIncidents total: ${fmtCount(rec.total)}`;
    return `<circle class="month-dot" cx="${x}" cy="${y}" r="3.3" style="fill:${vmtColor}" data-tip="${escAttr(vmtTip)}"></circle>`;
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
const CARD_METRICS = METRIC_DEFS.map(m => ({
  label: m.cardLabel, inc: m.incField, metricKey: m.key, primary: m.primary,
}));

function renderMpiSummaryCards(series) {
  const rows = monthlySummaryRows(series);
  const massFrac = CI_MASS_DEFAULT_PCT / 100;
  const adsCards = rows.map(row => `
    <div class="mpi-card" style="border-left-color:${MONTHLY_COMPANY_COLORS[row.company]}">
      <div class="mpi-card-company">${row.company}</div>
      <div class="mpi-card-vmt">VMT: ${fmtWhole(row.vmtBest)}${row.vmtMin !== row.vmtBest || row.vmtMax !== row.vmtBest ? ` (${fmtWhole(row.vmtMin)} \u2013 ${fmtWhole(row.vmtMax)})` : ""}</div>
      ${CARD_METRICS.map(m => {
        const k = row[m.inc];
        const a = k + 0.5;
        const tail = (1 - massFrac) / 2;
        const ciLo = 1 / gammaquant(a, row.vmtMin, 1 - tail);
        const ciHi = 1 / gammaquant(a, row.vmtMax, tail);
        const median = 1 / gammaquant(a, row.vmtBest, 0.5);
        const hl = monthMetricEnabled[m.metricKey] ? " highlighted" : "";
        const humanRange = KNOWN_HUMAN_MPI[m.metricKey];
        const humanGeo = humanRange ? Math.sqrt(humanRange.lo * humanRange.hi) : null;
        const mult = humanGeo ? median / humanGeo : null;
        const multStr = mult !== null
          ? ` <span class="mpi-card-mult ${mult >= 1 ? "safer" : "worse"}">${mult >= 10 ? fmtWhole(mult) : mult.toFixed(1)}x</span>`
          : "";
        return `
        <div class="mpi-card-metric${m.primary ? " primary" : ""}${hl}" data-metric="${m.metricKey}">
          <div>${m.label}: ${fmtCount(k)} incidents \u2192 <span class="mpi-card-mpi">${fmtWhole(median)} MPI</span>${multStr}</div>
          <div class="mpi-card-ci">95% CI: ${fmtWhole(ciLo)} \u2013 ${fmtWhole(ciHi)}</div>
        </div>`;
      }).join("")}
    </div>
  `).join("");

  const humanCard = `
    <div class="mpi-card" style="border-left-color:${MONTHLY_COMPANY_COLORS.Humans}">
      <div class="mpi-card-company">Humans</div>
      <div class="mpi-card-vmt">Benchmarks: <a href="https://arxiv.org/abs/2312.12675">Kusano/Scanlon 2024</a>, <a href="https://waymo.com/safety/impact/">Waymo safety impact</a>, <a href="https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705">FARS 2023</a></div>
      ${CARD_METRICS.map(m => {
        const range = KNOWN_HUMAN_MPI[m.metricKey];
        if (!range) return "";
        const geoMean = Math.sqrt(range.lo * range.hi);
        const hl = monthMetricEnabled[m.metricKey] ? " highlighted" : "";
        const srcLine = range.srcLinks
          ? range.srcLinks.map(s => `<a href="${s.url}">${s.label}</a>`).join(", ")
          : "";
        return `
        <div class="mpi-card-metric${m.primary ? " primary" : ""}${hl}" data-metric="${m.metricKey}">
          <div>${m.label}: <span class="mpi-card-mpi">${fmtWhole(geoMean)} MPI</span></div>
          <div class="mpi-card-ci">Range: ${fmtWhole(range.lo)} \u2013 ${fmtWhole(range.hi)}${range.src ? ` <span class="mpi-card-src" title="${range.src}">[?]</span>` : ""}</div>
          ${srcLine ? `<div class="mpi-card-sources">${srcLine}</div>` : ""}
        </div>`;
      }).join("")}
    </div>
  `;

  return adsCards + humanCard;
}

function renderMonthlyLegends() {
  // Human benchmark bands always render (no toggle); only ADS companies get checkboxes
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

  // CI fan legend: multi-stripe swatches showing each company's color at the
  // band's rendered opacity level for each CI width (50%, 80%, 95%).
  // TO-DO: Human vet legend labels below.
  const fanCompanies = includedAdsCompanies();
  const fanLevels = CI_FAN_LEVELS.map((level, i) => {
    // Match the band rendering: reversed index li maps to bandOpacity =
    // 0.10 * metricOpacity * (1 + li * 0.5). Use metricOpacity = 1 for legend.
    const li = CI_FAN_LEVELS.length - 1 - i;
    const opacity = (0.10 * (1 + li * 0.5)).toFixed(3);
    const pct = Math.round(level * 100);
    // Build vertical stripe gradient from company colors
    const stripeW = 100 / fanCompanies.length;
    const stops = fanCompanies.map((c, j) => {
      const color = MONTHLY_COMPANY_COLORS[c];
      return `${color} ${(j * stripeW).toFixed(1)}% ${((j + 1) * stripeW).toFixed(1)}%`;
    }).join(", ");
    const grad = `linear-gradient(to right, ${stops})`;
    return `
      <span class="month-legend-item">
        <span class="ci-fan-swatch" style="background:${grad};opacity:${opacity}"></span>${pct}% CI
      </span>`;
  });
  byId("month-legend-ci-fan").innerHTML = fanLevels.join("");

  byId("month-legend-lines").innerHTML = `
    <span class="month-legend-item">
      <span class="month-linekey solid"></span>VMT (best)
    </span>
  `;

  // TO-DO: Human vet bar segment legend labels below.
  byId("month-legend-speed").innerHTML = `
    <span class="month-legend-label">Left bar (movement):</span>
    ${MOVEMENT_SEGMENTS.map(seg => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${MOVEMENT_LEGEND_COLORS[seg.key]}"></span>${seg.label}
      </span>
    `).join("")}
    <span class="month-legend-label">Right bar (severity):</span>
    ${SEVERITY_SEGMENTS.map(seg => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${SEVERITY_LEGEND_COLORS[seg.key]}"></span>${seg.label}
      </span>
    `).join("")}
  `;
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

function weightedFaultVarianceFromValues(claude, codex, gemini, weights) {
  const c = Number(claude);
  const o = Number(codex);
  const g = Number(gemini);
  must(Number.isFinite(c) && c >= 0 && c <= 1, "fault claude out of range", {claude});
  must(Number.isFinite(o) && o >= 0 && o <= 1, "fault codex out of range", {codex});
  must(Number.isFinite(g) && g >= 0 && g <= 1, "fault gemini out of range", {gemini});
  const total = weights.claude + weights.codex + weights.gemini;
  const mean = total === 0 ? null : (weights.claude * c + weights.codex * o + weights.gemini * g) / total;
  return mean === null ? null : (
    weights.claude * (c - mean) * (c - mean) +
    weights.codex * (o - mean) * (o - mean) +
    weights.gemini * (g - mean) * (g - mean)
  ) / total;
}

function weightedFaultVariance(reportId) {
  const fd = faultData[reportId];
  return fd ? weightedFaultVarianceFromValues(fd.claude, fd.codex, fd.gemini, faultWeights()) : null;
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
  {key: "faultVariance", val: r => {
    const v = weightedFaultVariance(r.reportId);
    return v !== null ? v : -1;
  }},
  {key: "severity", val: r => r.severity || ""},
  {key: "narrative", val: r => r.narrative || ""},
];

const HEADER_LABELS = ["Company", "Date", "Location", "Crash with", "Speed (mph)", "Fault", "Fault variance", "Severity", "Narrative"];

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
    const faultVariance = weightedFaultVariance(r.reportId);
    const faultVarianceHtml = faultVariance !== null ? faultVariance.toFixed(3) : "—";
    const faultTip = escAttr(faultTooltip(r.reportId));

    tr.innerHTML = `
      <td>${escHtml(r.company)}</td>
      <td>${escHtml(r.date)}</td>
      <td>${escHtml(r.city)}, ${escHtml(r.state)}</td>
      <td>${escHtml(r.crashWith)}</td>
      <td>${escHtml(r.speed !== null ? String(r.speed) : "?")}</td>
      <td class="fault-cell" data-tip="${faultTip}">${faultHtml}</td>
      <td class="fault-var-cell">${faultVarianceHtml}</td>
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
    ["Moderate W/O", "Moderate injury"],
    ["Moderate W/", "Moderate injury (hosp.)"],
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

// --- Floating tooltip (works on mobile tap + desktop hover) ---

function initTooltips() {
  const tip = document.createElement("div");
  tip.id = "chart-tip";
  tip.className = "chart-tip";
  document.body.appendChild(tip);

  let pinned = false; // true when user tapped/clicked to pin the tooltip

  function show(el, evt) {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    tip.textContent = text;
    tip.style.display = "block";
    position(evt);
  }

  function position(evt) {
    // Position near the pointer/touch, clamped to viewport
    const x = evt.clientX || (evt.touches && evt.touches[0].clientX) || 0;
    const y = evt.clientY || (evt.touches && evt.touches[0].clientY) || 0;
    const pad = 12;
    const rect = tip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - pad) {
      left = x - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = y - rect.height - pad;
    }
    tip.style.left = Math.max(pad, left) + "px";
    tip.style.top = Math.max(pad, top) + "px";
  }

  function hide() {
    if (!pinned) {
      tip.style.display = "none";
    }
  }

  function findTipTarget(el) {
    // Walk up from event target to find nearest [data-tip]
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute("data-tip")) return el;
      el = el.parentNode;
    }
    return null;
  }

  // Desktop hover
  document.addEventListener("pointerenter", (evt) => {
    if (pinned) return;
    const target = findTipTarget(evt.target);
    if (target) show(target, evt);
  }, true);

  document.addEventListener("pointerleave", (evt) => {
    if (pinned) return;
    const target = findTipTarget(evt.target);
    if (target) hide();
  }, true);

  document.addEventListener("pointermove", (evt) => {
    if (pinned) return;
    if (tip.style.display === "block") position(evt);
  }, true);

  // Click/tap to pin tooltip (mobile-friendly)
  document.addEventListener("click", (evt) => {
    const target = findTipTarget(evt.target);
    if (target) {
      if (pinned && tip.style.display === "block") {
        // Already showing pinned tooltip — if same target, dismiss
        pinned = false;
        tip.style.display = "none";
      } else {
        pinned = true;
        show(target, evt);
      }
    } else {
      // Clicked elsewhere — dismiss pinned tooltip
      pinned = false;
      tip.style.display = "none";
    }
  }, true);
}

// --- Init ---

{
  const incidentData = INCIDENT_DATA;
  must(Array.isArray(incidentData), "INCIDENT_DATA must be an array");
  must(incidentData.length > 0, "INCIDENT_DATA must not be empty");
  const DATE_RE = /^[A-Z]{3}-\d{4}$/;
  for (const inc of incidentData) {
    must(inc !== null && typeof inc === "object", "incident must be an object");
    must(typeof inc.company === "string", "incident missing company");
    must(COMPANIES[inc.company] !== undefined,
      "inline incident data has unknown company", {company: inc.company});
    must(typeof inc.reportId === "string" && inc.reportId.length > 0,
      "incident missing reportId", {company: inc.company});
    must(typeof inc.date === "string" && DATE_RE.test(inc.date),
      "incident date must match MMM-YYYY format", {reportId: inc.reportId, date: inc.date});
    must(inc.speed === null || (typeof inc.speed === "number" && Number.isFinite(inc.speed) && inc.speed >= 0),
      "incident speed must be null or non-negative number", {reportId: inc.reportId, speed: inc.speed});
    must(typeof inc.road === "string" && inc.road.length > 0,
      "incident missing road type", {reportId: inc.reportId});
    must(typeof inc.severity === "string" && inc.severity.length > 0,
      "incident missing severity", {reportId: inc.reportId});
    must(inc.fault !== null && typeof inc.fault === "object",
      "incident missing fault object", {reportId: inc.reportId});
    must(typeof inc.vehiclesInvolved === "number" && inc.vehiclesInvolved >= 1,
      "incident vehiclesInvolved must be >= 1", {reportId: inc.reportId});
    for (const model of ["claude", "codex", "gemini"]) {
      const f = inc.fault[model];
      must(typeof f === "number" && f >= 0 && f <= 1,
        `incident fault.${model} must be number in [0, 1]`,
        {reportId: inc.reportId, value: f});
    }
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
  const modifiedPart = NHTSA_MODIFIED_DATE
    ? ` NHTSA data last modified ${NHTSA_MODIFIED_DATE}.`
    : "";
  byId("colophon").textContent =
    `Incident data fetched from NHTSA on ${NHTSA_FETCH_DATE}.${modifiedPart}`;
  initTooltips();
}

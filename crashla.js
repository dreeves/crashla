"use strict";

function fail(msg, details) {
  const suffix = details === undefined ? "" : " " + JSON.stringify(details);
  throw new Error(msg + suffix);
}

function assert(cond, msg, details) {
  cond || fail(msg, details);
}

function byId(id) {
  const node = document.getElementById(id);
  assert(node !== null, "Missing required DOM node", {id});
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
  assert(a > 0 && b > 0 && p > 0 && p < 1,
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

// Inverse-gamma density w.r.t. log(x): f(x)·x where f is the InvGamma PDF.
// If λ ~ Gamma(α, β) then MPI = 1/λ ~ InvGamma(α, β).
// log(f(x)·x) = α·ln(β) − lnΓ(α) − α·ln(x) − β/x
function invGammaLogDensity(x, alpha, beta) {
  return Math.exp(alpha * Math.log(beta) - lgamma(alpha) - alpha * Math.log(x) - beta / x);
}

// Log-normal density w.r.t. log(x): if ln(X) ~ N(μ, σ²) then this is
// the density on a log-scaled axis, i.e., the normal PDF in log-space.
function logNormalLogDensity(x, mu, sigma) {
  assert(sigma > 0, "logNormalLogDensity: sigma must be positive", {sigma});
  const z = (Math.log(x) - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
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

// --- Data and UI ---

let incidents = [];
let vmtRows = [];
let faultData = {}; // reportId -> {faultfrac, reasoning}
let monthHelmerEnabled = {HumansAV: true, HumansUS: false, HumansRideshare: false, Tesla: true, Waymo: true, Zoox: false};
// Collapsible page sections (each <section class="collapsible" id="sec-<id>">).
// Collapsed set is shareable via the URL so a link can foreground one section.
const SECTION_IDS = ["controls", "mpi", "dist", "summary", "vmt", "browser", "markets", "sanity"];
let sectionCollapsed = Object.fromEntries(SECTION_IDS.map(id => [id, false]));
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
//   Waymo safety impact page (waymo.com/safety/impact, 170.7M mi, Dec 2025):
//     Any-injury 3.90 IPMM, airbag deploy 1.63 IPMM, SSI+ 0.22 IPMM
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

    defaultEnabled: false, primary: true,
    countFn: rec => rec.incidents.total,
    humanMPI: {
      HumansAV: {lo: 103000, hi: 214000,
        // Kusano Blincoe-adj (9.67 IPMM) to police-reported (4.68 IPMM)
        src: 'lo: 1M/9.67 Blincoe-adj IPMM; hi: 1M/4.68 police-reported IPMM',
        srcLinks: [
          {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
        ]},
      // CRSS 2022/2023: ~6M police-reported crashes/yr, ~1.77 vehicles per
      // crash, ~3.2T VMT -> ~3.3 crashed vehicles per M mi. Blincoe
      // underreporting (~60% of property-damage-only and ~25-32% of injury
      // crashes unreported) roughly doubles that -> ~7.1 per M mi.
      HumansUS: {lo: 140000, hi: 300000,
        src: 'lo: ~7.1 IPMM Blincoe-adjusted crashed-vehicle rate; hi: ~3.3 IPMM police-reported (CRSS national, all road types)',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
          {label: 'Blincoe 2015 (underreporting)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013'},
        ]},
    },
  },
  { key: "nonstationary",
    label: "Miles per nonstationary incident",
    cardLabel: "Nonstationary",
    incField: "incNonstationary",

    defaultEnabled: false, primary: false,
    countFn: rec => nonstationaryIncidentCount(rec.incidents.speeds),
    // ~95-97% of all crashes are nonstationary (excl hit-while-parked)
    humanMPI: {
      HumansAV: {lo: 106000, hi: 225000,
        src: 'All-crash range adjusted for ~3\u20135% hit-while-parked share (CRSS)',
        srcLinks: [
          {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
        ]},
      HumansUS: {lo: 144000, hi: 310000,
        src: 'US-average all-crash range adjusted for ~3\u20135% hit-while-parked share (CRSS)',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        ]},
    },
  },
  { key: "roadwayNonstationary",
    label: "Miles per nonstationary non-parking-lot incident",
    cardLabel: "Nonstationary non-parking-lot",
    incField: "incRoadwayNonstationary",

    defaultEnabled: false, primary: false,
    countFn: rec => roadwayNonstationaryIncidentCount(rec),
    // CRSS is already trafficway-only ≈ non-parking-lot; ~same ratio
    humanMPI: {
      HumansAV: {lo: 108000, hi: 228000,
        src: 'CRSS trafficway-only rates \u2248 non-parking-lot; similar ratio',
        srcLinks: [
          {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
        ]},
      HumansUS: {lo: 147000, hi: 315000,
        src: 'CRSS trafficway-only rates \u2248 non-parking-lot; similar ratio applied to US-average range',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        ]},
    },
  },
  { key: "atfault",
    label: "Miles per at-fault incident",
    cardLabel: "At-fault",
    incField: "incAtFault",

    needsFault: true,
    defaultEnabled: true, primary: false,
    countFn: rec => rec.incidents.atFault,
    // At-fault MPI = all-crash MPI / at-fault share, where the share must
    // match the universe of the anchor it divides. Police-reported universe:
    // ~50-65% of involvements are at-fault (single-vehicle 100%,
    // multi-vehicle ~50%). Any-property-damage universe (what SGO captures):
    // the marginal unreported/sub-threshold contacts are predominantly
    // single-vehicle/self-inflicted (curb strikes, fixed objects), so the
    // share rises toward ~1 and the lo anchor collapses to the all-crash lo.
    humanMPI: {
      HumansAV: {lo: 103000, hi: 430000,
        src: 'lo: all-crash lo (at-fault share \u2192 ~1 at any-property-damage severity; marginal unreported contacts are mostly self-inflicted); hi: all-crash hi / 50% police-reported-universe share',
        srcLinks: [
          {label: 'Kusano & Scanlon 2024', url: 'https://arxiv.org/abs/2312.12675'},
          {label: 'Blincoe 2015 (underreporting)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013'},
        ]},
      HumansUS: {lo: 140000, hi: 600000,
        src: 'lo: US-average all-crash lo (at-fault share \u2192 ~1 at any-property-damage severity); hi: US-average all-crash hi / 50% police-reported-universe share',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
          {label: 'Blincoe 2015 (underreporting)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013'},
        ]},
    },
  },
  { key: "injury",
    label: "Miles per injury crash",
    cardLabel: "Injury",
    incField: "incInjury",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.injury,
    // Waymo safety page benchmark (3.90 IPMM) to Kusano observed (1.91)
    humanMPI: {
      HumansAV: {lo: 256000, hi: 524000,
        src: 'lo: 1M/3.90 Waymo benchmark IPMM; hi: 1M/1.91 Kusano observed IPMM',
        srcLinks: [
          {label: 'Waymo safety impact (170.7M mi)', url: 'https://waymo.com/safety/impact/'},
          {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
        ]},
      // CRSS national: ~1.66M injury crashes/yr * ~1.77 vehicles / ~3.2T VMT
      // -> ~0.92 injury-crashed vehicles per M mi police-reported; Blincoe
      // (~25-32% of injury crashes unreported) -> ~1.28 per M mi.
      HumansUS: {lo: 780000, hi: 1090000,
        src: 'lo: ~1.28 IPMM Blincoe-adjusted injury crashed-vehicle rate; hi: ~0.92 IPMM police-reported (CRSS national)',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
          {label: 'Blincoe 2015 (underreporting)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812013'},
        ]},
    },
  },
  { key: "atfaultInjury",
    label: "Miles per at-fault injury crash",
    cardLabel: "At-fault injury",
    incField: "incAtFaultInjury",

    needsFault: true,
    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.atFaultInjury,
    // At-fault injury: intersection of at-fault and injury crashes.
    // Shares use the expert-avoidability standard to match the faultfrac
    // criterion (P(expert human avoids)), not legal allocation:
    // lo: injury lo (256k) / ~94% share (NHTSA critical reason: driver error
    //   in ~94% of crashes; an expert avoids at least those) ≈ 272k
    // hi: injury hi (524k) / 50% share ≈ 1,050k
    //   50% = legal-allocation floor (single-vehicle 100%, multi ~50%);
    //   expert-avoidability can't be lower. Cross-check: 524k/214k × atfault
    //   hi (430k) ≈ 1,053k.
    humanMPI: {
      HumansAV: {lo: 272000, hi: 1050000,
        src: 'lo: injury lo (256k) / ~94% expert-avoidability share (NHTSA critical reason); hi: injury hi (524k) / 50% legal-allocation floor',
        srcLinks: [
          {label: 'Kusano & Scanlon 2024, Table 3', url: 'https://arxiv.org/abs/2312.12675'},
          {label: 'Waymo safety impact (170.7M mi)', url: 'https://waymo.com/safety/impact/'},
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
          {label: 'NHTSA critical reason (94%)', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/812115'},
        ]},
      HumansUS: {lo: 830000, hi: 2180000,
        src: 'lo: US injury lo (780k) / ~94% expert-avoidability share (NHTSA critical reason); hi: US injury hi (1.09M) / 50% legal-allocation floor',
        srcLinks: [
          {label: 'NHTSA 2023 crash summary', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        ]},
    },
  },
  { key: "hospitalization",
    label: "Miles per hospitalization crash",
    cardLabel: "Hospitalization",
    incField: "incHospitalization",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.hospitalization,
    // Between airbag-deployment proxy (1.63 IPMM ≈ crashes with enough
    // force to likely send someone to ER) and SSI+ (0.22 IPMM = KABCO
    // A+K). SGO "W/ Hospitalization" = transported to hospital (incl ER
    // visits for minor injuries — 16/19 Waymo hosp are "Minor W/ Hosp").
    humanMPI: {
      // AV-cities cohort only: SGO's hospitalization definition has no
      // national-statistics equivalent.
      HumansAV: {lo: 613000, hi: 4545000,
        src: 'lo: 1M/1.63 airbag-deploy IPMM; hi: 1M/0.22 SSI+ IPMM',
        srcLinks: [
          {label: 'Waymo safety impact (170.7M mi)', url: 'https://waymo.com/safety/impact/'},
        ]},
    },
  },
  { key: "airbag",
    label: "Miles per airbag-deploying crash",
    cardLabel: "Airbag deployment",
    incField: "incAirbag",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.airbag,
    // Airbag deployment in any vehicle. Waymo safety impact page: human
    // benchmark 1.63 IPMM (police-reported, AV operating counties, no
    // underreporting adjustment — airbag deployments are mechanically
    // triggered and rarely underreported). Range accounts for modest
    // geographic/methodological variation.
    humanMPI: {
      // AV-cities cohort only: no national airbag-deployment rate published.
      HumansAV: {lo: 500000, hi: 700000,
        src: 'Waymo safety impact: 1.63 IPMM police-reported airbag-deploy rate in AV operating counties',
        srcLinks: [
          {label: 'Waymo safety impact (170.7M mi)', url: 'https://waymo.com/safety/impact/'},
        ]},
    },
  },
  { key: "seriousInjury",
    label: "Miles per serious injury crash",
    cardLabel: "Serious injury (SSI+)",
    incField: "incSeriousInjury",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.seriousInjury,
    // SSI+ (KABCO A+K): Moderate W/ Hospitalization + Fatality.
    // Waymo safety impact page: 0.22 IPMM. Range: 0.30 IPMM (broader
    // definition, SGO "Moderate" may include some KABCO B cases) to
    // 0.15 IPMM (narrower, only most severe subset).
    humanMPI: {
      // AV-cities cohort only: SSI+ definition is tied to the SGO severity
      // scale; no clean national equivalent.
      HumansAV: {lo: 3300000, hi: 6700000,
        src: 'Waymo safety impact SSI+ 0.22 IPMM; range 0.15\u20130.30 for definitional uncertainty',
        srcLinks: [
          {label: 'Waymo safety impact (170.7M mi)', url: 'https://waymo.com/safety/impact/'},
        ]},
    },
  },
  { key: "fatality",
    label: "Miles per fatal crash",
    cardLabel: "Fatality",
    incField: "incFatality",

    defaultEnabled: false, primary: false,
    countFn: rec => rec.incidents.fatality,
    // FARS national per-vehicle-adjusted (75M) to urban surface-street
    // estimate (~130M, using urban fatality rate ~0.7-1.15 per 100M VMT)
    humanMPI: {
      HumansAV: {lo: 87000000, hi: 130000000,
        src: 'urban surface-street fatality rate ~0.77\u20131.15 per 100M VMT',
        srcLinks: [
          {label: 'IIHS urban/rural comparison', url: 'https://www.iihs.org/topics/fatality-statistics/detail/urban-rural-comparison'},
        ]},
      HumansUS: {lo: 61000000, hi: 83000000,
        src: 'FARS national: ~1.65/100M VMT per crashed vehicle to ~1.2/100M VMT per fatal crash',
        srcLinks: [
          {label: 'NHTSA FARS 2023', url: 'https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813705'},
        ]},
      // The one rideshare-specific per-mile rate that is published (the
      // safety reports otherwise cover only fatalities and assaults).
      HumansRideshare: {lo: 106000000, hi: 161000000,
        src: 'Uber & Lyft US Safety Reports: 0.62–0.94 fatalities per 100M VMT (2019–2022)',
        srcLinks: [
          {label: 'Uber US Safety Report', url: 'https://www.uber.com/us/en/safety/usr/'},
          {label: 'Lyft Safety Transparency Report', url: 'https://www.lyft.com/safety-transparency-report'},
        ]},
    },
  },
];

// Humans (Uber/Lyft): a rideshare driver is NOT the generic AV-cities human
// driver. On fatalities — the one published rideshare per-mile rate (set
// explicitly above) — they run ~1.2x safer, because they're sober, working,
// rated, and in inspected vehicles. No rideshare rate exists for non-fatal
// crashes, so for the general crash metrics we lean the AV-cities band safer
// with a wide range: as bad as ~1.2x worse (heavy low-speed urban exposure and
// in-app distraction can raise minor-crash frequency) up to ~1.5x safer (the
// driver self-selection seen in the fatality data). Severity-tail metrics
// (hospitalization/airbag/serious-injury) have no rideshare or national
// source, so they're omitted — same coverage as Humans (US average), which is
// why the derivation keys off metrics that also carry a HumansUS band.
const RIDESHARE_WORST = 1.2; // band floor: up to 1.2x MORE crashes than AV cities
const RIDESHARE_BEST = 1.5;  // band ceiling: up to 1.5x FEWER
const sig2 = x => { const p = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.round(x / p) * p; };
for (const m of METRIC_DEFS) {
  const h = m.humanMPI;
  if (h && h.HumansAV && h.HumansUS && !h.HumansRideshare) {
    h.HumansRideshare = {
      lo: sig2(h.HumansAV.lo / RIDESHARE_WORST),
      hi: sig2(h.HumansAV.hi * RIDESHARE_BEST),
      src: 'Leaned off the AV-cities human rate (~1.2× worse to ~1.5× safer): sober/professional drivers vs heavy urban exposure & in-app distraction; no rideshare-specific non-fatal rate published',
      srcLinks: h.HumansAV.srcLinks,
    };
  }
}

// Derived accessors — consumed by rendering code throughout
const METRIC_KEYS = METRIC_DEFS.map(m => m.key);
const METRIC_BY_KEY = Object.fromEntries(
  METRIC_DEFS.map(m => [m.key, m]));
const STRESS_VERDICT_META = {
  safer: {label: "robustly safer", className: "safer"},
  worse: {label: "robustly worse", className: "worse"},
  ambiguous: {label: "ambiguous", className: "ambiguous"},
};
let selectedMetricKey = METRIC_DEFS.find(m => m.defaultEnabled).key;
const DEFAULT_START_MONTH = "2025-06"; // default slider start (NHTSA analysis window)
let monthRangeStart = -1; // -1 = use DEFAULT_START_MONTH
let monthRangeEnd = Infinity;
let fullMonthSeries = null;
let activeSeries = null;

function metricLineStyle(helmer) {
  return `stroke:${HELMER_COLORS[helmer]};stroke-width:2`;
}

function metricMarkerColor(helmer) {
  return HELMER_COLORS[helmer];
}


function metricErrStyle(helmer) {
  return `stroke:${HELMER_COLORS[helmer]}`;
}
const CI_MASS_DEFAULT_PCT = 95;
const CI_FAN_LEVELS = [0.50, 0.80, 0.95]; // nested CI bands from tight to wide
const ADS_HELMERS = ["Tesla", "Waymo", "Zoox"];
// Human benchmark cohorts: HumansAV = drivers on surface streets in AV
// operating cities (Kusano/Scanlon + Waymo safety hub); HumansUS = the
// nationwide average (CRSS/FARS, all road types). Same "driver", two
// reference populations.
// HumansRideshare = a rider's typical alternative to an AV (human-driven
// Uber/Lyft). Same urban surface streets as the AVs; see the humanMPI proxy
// derivation below the metric defs.
const HUMAN_HELMERS = ["HumansAV", "HumansUS", "HumansRideshare"];
const ALL_HELMERS = [...HUMAN_HELMERS, ...ADS_HELMERS];
const HELMER_LABELS = {
  HumansAV: "Humans (AV cities)",
  HumansUS: "Humans (US average)",
  HumansRideshare: "Humans (Uber/Lyft)",
  Tesla: "Tesla",
  Waymo: "Waymo",
  Zoox: "Zoox",
};
function helmerLabel(helmer) {
  const label = HELMER_LABELS[helmer];
  assert(label !== undefined, "Unknown helmer", {helmer});
  return label;
}
const HELMER_COLORS = {
  HumansAV: "#c9a800",
  HumansUS: "#8a7400",
  HumansRideshare: "#cc7a00",
  Tesla: "#d13b2d",
  Waymo: "#2060c0",
  Zoox: "#2a8f57",
};
// Movement-based partition of total incidents (sums to total)
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
// Legend colors (helmer-neutral)
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

// Count incidents per helmer from loaded data
function countByHelmer(rows = incidents) {
  const counts = {};
  for (const inc of rows) {
    counts[inc.helmer] = (counts[inc.helmer] || 0) + 1;
  }
  return counts;
}

function incidentsInVmtWindow(rows = incidents) {
  assert(vmtRows.length > 0, "incident browser requires vmtRows");
  const monthSet = new Set(vmtRows.map(row => row.month));
  for (const inc of rows) {
    assert(monthSet.has(monthKeyFromIncidentLabel(inc.date)),
      "incident date outside VMT window",
      {reportId: inc.reportId, helmer: inc.helmer, date: inc.date});
  }
  return rows;
}

function activeIncidents() {
  const all = incidentsInVmtWindow();
  const months = new Set(activeSeries.months);
  return all.filter(inc => months.has(monthKeyFromIncidentLabel(inc.date)));
}

function activeVmt() {
  const months = new Set(activeSeries.months);
  return vmtRows.filter(r => months.has(r.month));
}

function scaleLinear(v, d0, d1, r0, r1) {
  const span = (d1 - d0) || 1;
  return r0 + (v - d0) * (r1 - r0) / span;
}

function fmtMiles(n) {
  assert(Number.isFinite(n) && n >= 0, "fmtMiles: invalid input", {n});
  const suffixes = ["", "K", "M", "B", "T"];
  let tier = 0;
  let val = n;
  // 999.95 is where toFixed(1) would roll over to "1000.0"; bump tier instead
  while (val >= 999.95 && tier < suffixes.length - 1) {
    val /= 1000;
    tier++;
  }
  return tier === 0 ? Math.round(n).toLocaleString() : val.toFixed(1) + suffixes[tier];
}

function csvUnquote(field) {
  const quoted = field.startsWith("\"") && field.endsWith("\"");
  return quoted ? field.slice(1, -1).replace(/""/g, "\"") : field;
}

function parseVmtCsv(text) {
  const lines = text.split(/\r?\n/).map(line => line.trimEnd());
  assert(lines.length > 1, "VMT sheet CSV must include header and rows");
  assert(lines[0] === "helmer,month,vmt,helmer_cumulative_vmt,vmt_min,vmt_max,coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale",
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
    assert(hit !== null, "Malformed VMT sheet CSV row", {lineNo: i + 1, line});
    const helmerRaw = hit[1].trim();
    const helmer = ADS_HELMERS.find(c => c.toLowerCase() === helmerRaw.toLowerCase());
    assert(helmer !== undefined, "VMT sheet CSV has unknown helmer", {helmerRaw});
    const vmtBest = Number(hit[3]);
    const vmtCume = Number(hit[4]);
    const vmtMin = Number(hit[5]);
    const vmtMax = Number(hit[6]);
    const coverage = Number(hit[7]); // fraction of month in NHTSA window
    // Incident reporting completeness (Poisson thinning factor).
    // When Monthly reports are structurally absent for the last month, this
    // is the historical 5-Day fraction for the helmer.  Multiplied into
    // effective VMT so the Gamma posterior reflects the thinned observation.
    const incCov     = Number(hit[8]);  // best estimate
    const incCovMin  = Number(hit[9]);  // most pessimistic (smallest p)
    const incCovMax  = Number(hit[10]); // most optimistic (largest p)
    assert(Number.isFinite(vmtBest) && vmtBest >= 0, "vmt must be non-negative number",
      {lineNo: i + 1, vmtBest});
    assert(Number.isFinite(vmtCume) && vmtCume >= 0,
      "helmer_cumulative_vmt must be non-negative number", {lineNo: i + 1, vmtCume});
    assert(Number.isFinite(vmtMin) && vmtMin >= 0, "vmt_min must be non-negative number",
      {lineNo: i + 1, vmtMin});
    assert(Number.isFinite(vmtMax) && vmtMax >= 0, "vmt_max must be non-negative number",
      {lineNo: i + 1, vmtMax});
    assert(vmtMin <= vmtBest && vmtBest <= vmtMax,
      "expected vmt_min <= vmt <= vmt_max", {lineNo: i + 1, vmtMin, vmtBest, vmtMax});
    assert(coverage > 0 && coverage <= 1, "coverage must be in (0, 1]",
      {lineNo: i + 1, coverage});
    assert(incCov > 0 && incCov <= 1, "incident_coverage must be in (0, 1]",
      {lineNo: i + 1, incCov});
    assert(incCovMin > 0 && incCovMin <= incCov,
      "incident_coverage_min must be in (0, incident_coverage]",
      {lineNo: i + 1, incCovMin, incCov});
    assert(incCovMax >= incCov && incCovMax <= 1,
      "incident_coverage_max must be in [incident_coverage, 1]",
      {lineNo: i + 1, incCovMax, incCov});
    rows.push({
      helmer,
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
  assert(rows.length > 0, "VMT sheet CSV has no data rows");
  return rows;
}


function monthKeyFromIncidentLabel(label) {
  const hit = /^([A-Z]{3})-(\d{4})$/.exec(label);
  assert(hit !== null, "Invalid incident month label", {label});
  const month = MONTH_TOKENS[hit[1]];
  assert(month !== undefined, "Unknown incident month token", {label});
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
  "Moderate",
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

// Ordinal ranking for sorting: higher = more severe
const SEVERITY_RANK = {
  "No Injuries Reported": 0,
  "No Injured Reported": 0,
  "Property Damage. No Injured Reported": 0,
  "Minor": 1,
  "Minor W/O Hospitalization": 1,
  "Minor W/ Hospitalization": 2,
  "Moderate": 3,
  "Moderate W/O Hospitalization": 3,
  "Moderate W/ Hospitalization": 4,
  "Serious": 5,
  "Fatality": 6,
};

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
  assert(Number.isFinite(n) && n >= 0, "fmtCount: invalid input", {n});
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return rounded.toLocaleString();
  return rounded.toFixed(1);
}

function monthHelmerToggleId(helmer) {
  return "month-helmer-toggle-" + helmer.toLowerCase();
}

function includedHelmers() {
  return ALL_HELMERS.filter(helmer => monthHelmerEnabled[helmer]);
}

function monthMetricToggleId(metric) {
  return "month-metric-toggle-" + metric;
}

function selectedMonthMetric() {
  const metric = METRIC_BY_KEY[selectedMetricKey];
  assert(metric !== undefined, "Missing selected metric", {selectedMetricKey});
  return metric;
}

function seriesMonthBounds(series) {
  assert(series.months.length > 0, "Missing series months");
  return {
    start: series.months[0],
    end: series.months[series.months.length - 1],
  };
}

function fmtWhole(n) {
  assert(Number.isFinite(n), "fmtWhole: invalid input", {n});
  return Math.round(n).toLocaleString();
}

function vmtTooltip(helmer, month, row, rec) {
  return `${helmer} ${month} (VMT)\nMonthly VMT (central estimate): ${fmtWhole(row.vmtRawBest)}\nMonthly VMT range: ${fmtWhole(row.vmtRawMin)} \u2013 ${fmtWhole(row.vmtRawMax)}\nCoverage-adjusted VMT for MPI: ${fmtWhole(row.vmtBest)}\nCumulative VMT: ${fmtWhole(row.vmtCume)}\nTotal incidents: ${fmtCount(rec.total)}`;
}

function helmerMonthRows(series, helmer) {
  return series.points.map(point => point.helmers[helmer]);
}

function monthlySummaryRows(series) {
  return ALL_HELMERS.map(helmer => {
    const rows = series.points
      .filter(p => p.helmers[helmer] !== null)
      .map(p => p.helmers[helmer]);
    const vmtMin = rows.reduce((sum, row) => sum + row.vmtMin, 0);
    const vmtBest = rows.reduce((sum, row) => sum + row.vmtBest, 0);
    const vmtMax = rows.reduce((sum, row) => sum + row.vmtMax, 0);
    const metricRowsByKey = Object.fromEntries(
      METRIC_DEFS.map(m => [m.key, rows.filter(row => row.mpiByMetric[m.key] !== null)]));
    // Auto-generate inc fields from METRIC_DEFS
    const incFields = Object.fromEntries(
      METRIC_DEFS.map(m => [m.incField, metricRowsByKey[m.key].reduce((sum, row) => sum + m.countFn(row), 0)]));

    const vmtRationales = [...new Set(rows.map(r => r.rationale).filter(Boolean))];
    // Pre-compute MPI estimates for each metric (consumed by cards + distribution).
    // vmtBest > 0: Bayesian Gamma posterior from observed incidents + VMT.
    // vmtBest === 0: log-normal from literature CI (humanMPI on METRIC_DEFS).
    const mpiEstimates = Object.fromEntries(METRIC_DEFS.map(m => {
      const metricRows = metricRowsByKey[m.key];
      const metricVmtMin = metricRows.reduce((sum, row) => sum + row.vmtMin, 0);
      const metricVmtBest = metricRows.reduce((sum, row) => sum + row.vmtBest, 0);
      const metricVmtMax = metricRows.reduce((sum, row) => sum + row.vmtMax, 0);
      if (metricVmtBest > 0) {
        const k = incFields[m.incField];
        const alpha = k + 0.5;
        const beta = metricVmtBest;
        const est = estimateMpiWindow(k, metricVmtMin, metricVmtBest, metricVmtMax);
        return [m.key, {
          ...est,
          densityFn: x => invGammaLogDensity(x, alpha, beta),
          xMin: 1 / gammaquant(alpha, beta, 0.999),
          xMax: 1 / gammaquant(alpha, beta, 0.001),
        }];
      }
      if (vmtBest > 0) return [m.key, null];
      const h = m.humanMPI && m.humanMPI[helmer];
      if (!h) return [m.key, null];
      const geo = Math.sqrt(h.lo * h.hi);
      const mu = (Math.log(h.lo) + Math.log(h.hi)) / 2;
      const sigma = (Math.log(h.hi) - Math.log(h.lo)) / (2 * 1.96);
      return [m.key, {
        median: geo, lo: h.lo, hi: h.hi, k: null,
        densityFn: x => logNormalLogDensity(x, mu, sigma),
        xMin: Math.exp(mu - 3.09 * sigma),
        xMax: Math.exp(mu + 3.09 * sigma),
      }];
    }));
    return {
      helmer,
      vmtMin, vmtBest, vmtMax,
      vmtRationales,
      ...incFields,
      mpiEstimates,
    };
  });
}

function estimateMpiWindow(k, vmtMin, vmtBest, vmtMax, massFrac = CI_MASS_DEFAULT_PCT / 100) {
  const a = k + 0.5;
  const tail = (1 - massFrac) / 2;
  return {
    k, vmtMin, vmtBest, vmtMax,
    median: 1 / gammaquant(a, vmtBest, 0.5),
    lo: 1 / gammaquant(a, vmtMin, 1 - tail),
    hi: 1 / gammaquant(a, vmtMax, tail),
  };
}

// Faultfrac sensitivity: the faultfracs are Claude's judgments from
// company-written narratives, so ask how undercounted the true at-fault mass
// would have to be to change the stress verdict. Returns the smallest
// multiplier s > 1 on the judged mass at which the verdict (vs the AV-cities
// band) changes, plus the verdict it changes to; null when k = 0 (scaling
// zero mass changes nothing); mult Infinity when no s <= 10^4 flips it.
function faultFlipMultiplier(est, human) {
  if (est.k === 0) return null;
  const verdictAt = s => {
    const scaled = estimateMpiWindow(est.k * s, est.vmtMin, est.vmtBest, est.vmtMax);
    return scaled.lo / human.hi > 1 ? "safer" : scaled.hi / human.lo < 1 ? "worse" : "ambiguous";
  };
  const base = verdictAt(1);
  let lo = 1;
  let hi = null;
  for (let e = 1; e <= 80; e++) {
    const s = Math.pow(10, e / 20);
    if (verdictAt(s) !== base) { hi = s; break; }
    lo = s;
  }
  if (hi === null) return {mult: Infinity, flipped: null};
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(lo * hi);
    if (verdictAt(mid) === base) lo = mid; else hi = mid;
  }
  return {mult: hi, flipped: verdictAt(hi)};
}

function fmtRatio(n) {
  assert(Number.isFinite(n), "fmtRatio: invalid input", {n});
  // 99.95 and 9.995: thresholds where toFixed would roll over to next tier
  return n >= 99.95 ? fmtWhole(n) : n >= 9.995 ? n.toFixed(1) : n.toFixed(2);
}

function helmerHumanStress(row, metricKey) {
  const metric = METRIC_BY_KEY[metricKey];
  // Stress comparisons use the AV-cities cohort: same road mix as the
  // robotaxis, so it's the apples-to-apples human baseline.
  const human = metric && metric.humanMPI && metric.humanMPI.HumansAV;
  assert(metric !== undefined && human !== undefined, "Missing stress metric inputs", {metricKey});
  const av = row.mpiEstimates[metricKey];
  assert(av != null, "Missing AV stress estimate", {helmer: row.helmer, metricKey});
  const ratioLo = av.lo / human.hi;
  const ratioHi = av.hi / human.lo;
  const verdictKey = ratioLo > 1 ? "safer" : ratioHi < 1 ? "worse" : "ambiguous";
  return {
    metric,
    human,
    av,
    ratioLo,
    ratioHi,
    verdictKey,
    ...STRESS_VERDICT_META[verdictKey],
  };
}

function monthSeriesData() {
  assert(vmtRows.length > 0, "month series requires vmtRows");
  const monthSet = new Set();
  const vmtByKey = {};
  for (const row of vmtRows) {
    const key = row.helmer + "|" + row.month;
    assert(vmtByKey[key] === undefined, "Duplicate VMT row for helmer-month", {key});
    vmtByKey[key] = row;
    monthSet.add(row.month);
  }

  const incidentsByKey = {};
  for (const inc of incidents) {
    assert(ADS_HELMERS.includes(inc.helmer), "inline incident data has unknown ADS helmer", {helmer: inc.helmer});
    const month = monthKeyFromIncidentLabel(inc.date);
    assert(monthSet.has(month), "incident date outside VMT window",
      {reportId: inc.reportId, helmer: inc.helmer, date: inc.date, month});
    const key = inc.helmer + "|" + month;
    let rec = incidentsByKey[key];
    if (rec === undefined) {
      rec = {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0,
             atFaultInjury: 0, injury: 0, hospitalization: 0, airbag: 0,
             seriousInjury: 0, fatality: 0};
      incidentsByKey[key] = rec;
    }
    rec.total += 1;
    const bin = speedBinForIncident(inc.speed);
    rec.speeds[bin] += 1;
    assert(typeof inc.road === "string", "incident road must be string", {reportId: inc.reportId, road: inc.road});
    rec.roadwayNonstationary += Number(
      bin !== "0" && inc.road !== "Parking Lot",
    );
    let atFaultFrac = null;
    if (inc.fault !== null) {
      assert(typeof inc.fault === "object",
        "incident fault must be null or object", {reportId: inc.reportId});
      atFaultFrac = Number(inc.fault.faultfrac);
      assert(Number.isFinite(atFaultFrac) && atFaultFrac >= 0 && atFaultFrac <= 1,
        "monthly at-fault fraction out of range", {reportId: inc.reportId, atFaultFrac});
    }
    rec.faultKnown += Number(atFaultFrac !== null);
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

  // Shared human entries: same reference in every month (literature-based
  // MPI), one per benchmark cohort (see HUMAN_HELMERS).
  const humanEntryFor = cohort => ({
    vmtMin: 0, vmtBest: 0, vmtMax: 0,
    vmtRawMin: 0, vmtRawBest: 0, vmtRawMax: 0,
    vmtCume: 0, rationale: null,
    incidents: {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0,
                atFaultInjury: 0, injury: 0, hospitalization: 0, airbag: 0,
                seriousInjury: 0, fatality: 0},
    mpiByMetric: Object.fromEntries(
      METRIC_DEFS.filter(m => m.humanMPI && m.humanMPI[cohort]).map(m => {
        const h = m.humanMPI[cohort];
        const geo = Math.sqrt(h.lo * h.hi);
        return [m.key, {
          mpiMin: h.lo, mpiBest: geo, mpiMax: h.hi,
          incidentCount: null,
          bands: CI_FAN_LEVELS.map(() => ({lo: h.lo, hi: h.hi})),
        }];
      })),
  });
  const humanEntries = Object.fromEntries(
    HUMAN_HELMERS.map(hh => [hh, humanEntryFor(hh)]));

  const months = [...monthSet].sort();
  assert(months.length > 0, "No months to render");
  const points = [];
  for (const month of months) {
    const helmers = {...humanEntries};
    for (const helmer of ADS_HELMERS) {
      const key = helmer + "|" + month;
      const vmt = vmtByKey[key];
      if (vmt === undefined) {
        helmers[helmer] = null;
        continue;
      }
      assert(vmt.vmtMin > 0, "vmt_min must be positive", {helmer, month, vmtMin: vmt.vmtMin});
      assert(vmt.vmtBest > 0, "vmt must be positive", {helmer, month, vmtBest: vmt.vmtBest});
      assert(vmt.vmtMax > 0, "vmt_max must be positive", {helmer, month, vmtMax: vmt.vmtMax});
      const inc = incidentsByKey[key] || {total: 0, faultKnown: 0, speeds: emptySpeedBins(), roadwayNonstationary: 0, atFault: 0, atFaultInjury: 0, injury: 0, hospitalization: 0, airbag: 0, seriousInjury: 0, fatality: 0};
      const c = vmt.coverage; // pro-rate VMT to match the incident observation window
      // Incident coverage: for the last month, not all incidents may have been
      // reported yet.  Scaling VMT by the coverage fraction f gives the
      // posterior Gamma(k+0.5, VMT*f).  Since f is itself uncertain,
      // incCovMin (smallest f) pairs with vmtMin for the most pessimistic MPI;
      // incCovMax (= 1.0, all incidents could be in) pairs with vmtMax for
      // the most optimistic.  The CI thus reflects ignorance about f.
      const entry = {
        // Effective VMT: used for MPI computation (Poisson rate estimation)
        vmtMin: vmt.vmtMin * c * vmt.incCovMin,
        vmtBest: vmt.vmtBest * c * vmt.incCov,
        vmtMax: vmt.vmtMax * c * vmt.incCovMax,
        // Raw VMT: used for fleet trend visualization on lower charts
        vmtRawMin: vmt.vmtMin * c,
        vmtRawBest: vmt.vmtBest * c,
        vmtRawMax: vmt.vmtMax * c,
        vmtCume: vmt.vmtCume,
        rationale: vmt.rationale,
        incidents: inc,
      };
      // Pre-compute MPI estimates for each metric (consumed by MPI chart)
      entry.mpiByMetric = Object.fromEntries(METRIC_DEFS.map(m => {
        if (m.needsFault === true && entry.incidents.faultKnown !== entry.incidents.total) {
          return [m.key, null];
        }
        const k = m.countFn(entry);
        const a = k + 0.5;
        return [m.key, {
          mpiMin:  1 / gammaquant(a, entry.vmtMin,  0.5),
          mpiBest: 1 / gammaquant(a, entry.vmtBest, 0.5),
          mpiMax:  1 / gammaquant(a, entry.vmtMax,  0.5),
          incidentCount: k,
          bands: CI_FAN_LEVELS.map(level => {
            const t = (1 - level) / 2;
            return {
              lo: 1 / gammaquant(a, entry.vmtMin, 1 - t),
              hi: 1 / gammaquant(a, entry.vmtMax, t),
            };
          }),
        }];
      }));
      helmers[helmer] = entry;
    }
    // incidentObservable: all ADS helmers have VMT data = the NHTSA incident window
    const incidentObservable = ADS_HELMERS.every(d => helmers[d] !== null);
    points.push({month, helmers, incidentObservable});
  }
  return {months, points};
}

function sliceSeries(series, startIdx, endIdx) {
  const months = series.months.slice(startIdx, endIdx + 1);
  const points = series.points.slice(startIdx, endIdx + 1).map(point => {
    const helmers = {};
    for (const helmer of ALL_HELMERS) {
      const orig = point.helmers[helmer];
      if (orig === null) { helmers[helmer] = null; continue; }
      helmers[helmer] = {...orig, incidents: {...orig.incidents, speeds: {...orig.incidents.speeds}},
        mpiByMetric: {...orig.mpiByMetric}};
    }
    return {month: point.month, helmers, incidentObservable: point.incidentObservable};
  });
  for (const helmer of ALL_HELMERS) {
    let cume = 0;
    for (const point of points) {
      if (point.helmers[helmer] === null) continue;
      cume += point.helmers[helmer].vmtRawBest;
      point.helmers[helmer].vmtCume = cume;
    }
  }
  return {months, points};
}

function drawSingleMonthAxes(
  months, svgH, mLeft, mTop, pW, pH, mapX, yTicks, mapY, yFmt, yLabel,
) {
  const axisY = mTop + pH;
  const labelStep = months.length <= 12 ? 1 : months.length <= 24 ? 2 : 3;
  return `
    ${months.map((month, i) => `
      <line class="month-grid" x1="${mapX(i)}" y1="${mTop}" x2="${mapX(i)}" y2="${axisY}"${i % labelStep !== 0 ? ' style="opacity:0.3"' : ""}></line>
      ${i % labelStep === 0 || i === months.length - 1 ? `<text class="month-tick" x="${mapX(i)}" y="${svgH - 16}" text-anchor="middle">${month}</text>` : ""}
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

// Chip legend for a chart: one entry per helmer that actually renders there
function helmerChipLegend(helmers) {
  return `
    <div class="month-legend">
      ${helmers.map(helmer => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${HELMER_COLORS[helmer]}"></span>${helmerLabel(helmer)}
      </span>`).join("")}
    </div>`;
}

function renderAllHelmersMpiChart(series) {
  const metric = selectedMonthMetric();
  const svgW = 900;
  const svgH = 520;
  const mLeft = 68;
  const mRight = 16;
  const mTop = 14;
  const mBot = 40;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const renderDot = (x, y, color, s) => {
    const r = 3.1 * s;
    return `<circle class="month-dot" cx="${x}" cy="${y}" r="${r}" style="fill:${color};stroke:${color}"></circle>`;
  };

  const seriesRows = [];
  let yMax = 1;
  for (const helmer of includedHelmers()) {
    const rows = helmerMonthRows(series, helmer);
    const vals = rows.map(row => {
      if (row === null) return null;
      const mpi = row.mpiByMetric[metric.key];
      if (!mpi) return null;
      const k = mpi.incidentCount;
      // covRatio: how much of this month's incident coverage is known (1 = 
      // fully reported, <1 = NHTSA monthly reports still pending). Drives dot
      // opacity so incomplete months are visually demoted without a separate
      // code path.
      const covRatio = row.vmtRawMin > 0 ? row.vmtMin / row.vmtRawMin : 1;
      // The single y-range decision: every plotted point contributes at least
      // its median, so dots are always on-scale (an axis can never exclude
      // the data it draws). Informative points (k ≠ 0 and fully reported;
      // humans' k=null counts) also contribute their VMT-uncertainty spread.
      // Prior-driven k=0 medians and partial months can't blow up the axis.
      yMax = Math.max(yMax, k !== 0 && covRatio > 0.99 ? mpi.mpiMax : mpi.mpiBest);
      return {...mpi, vmtMonth: row.vmtRawBest, vmtMonthEff: row.vmtBest, vmtCume: row.vmtCume, covRatio};
    });
    seriesRows.push({helmer, metric, vals});
  }

  // Subset metrics must have higher MPI (rarer events = more miles between).
  for (const cohort of HUMAN_HELMERS) {
    const humanMpi = helmerMonthRows(series, cohort)[0];
    if (!humanMpi) continue;
    const subsetChains = [
      ["all", "nonstationary", "roadwayNonstationary"],
      ["all", "atfault", "atfaultInjury"],
      ["all", "injury", "atfaultInjury"],
      ["injury", "hospitalization", "fatality"],
    ];
    for (const chain of subsetChains) {
      for (let i = 1; i < chain.length; i++) {
        const a = humanMpi.mpiByMetric[chain[i-1]];
        const b = humanMpi.mpiByMetric[chain[i]];
        if (!a || !b) continue;
        assert(a.mpiMin <= b.mpiMin,
          "human MPI ordering violated", {
            cohort,
            lesser: chain[i-1], lesserMpi: a.mpiMin,
            greater: chain[i], greaterMpi: b.mpiMin,
          });
      }
    }
  }

  const yTicks = linearTicks(0, yMax, 4);
  const xPad = 28;
  const mapX = idx => scaleLinear(
    idx, 0, series.months.length - 1, mLeft + xPad, mLeft + pW - xPad,
  );
  const mapY = y => scaleLinear(y, 0, yMax, mTop + pH, mTop);
  const clampY = v => Math.max(mTop, Math.min(mTop + pH, mapY(v)));

  const lines = seriesRows.map(row => {
    let d = "";
    let penDown = false;
    for (let i = 0; i < row.vals.length; i++) {
      const mpi = row.vals[i];
      if (mpi === null) {
        penDown = false;
        continue;
      }
      d += `${penDown ? " L " : "M "}${mapX(i).toFixed(2)} ${clampY(mpi.mpiBest).toFixed(2)}`;
      penDown = true;
    }
    return `<path class="month-mpi-all-line" d="${d}" style="${metricLineStyle(row.helmer)}"></path>`;
  }).join("");

  // Error bars: the 95% credible interval (same quantity as the widest fan
  // level and the tooltip's "Range" line), clamped to the plot like every
  // other layer. Capless: a cap at a clamped endpoint would assert a CI
  // boundary that isn't there. Bar opacity matches the dot's coverage fade.
  const errs = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi === null) return "";
      const x = mapX(i);
      const ci95 = mpi.bands[mpi.bands.length - 1];
      const barOpacity = (0.35 + 0.65 * mpi.covRatio).toFixed(3);
      return `
        <line class="month-err" x1="${x.toFixed(2)}" y1="${clampY(ci95.lo).toFixed(2)}" x2="${x.toFixed(2)}" y2="${clampY(ci95.hi).toFixed(2)}" style="${metricErrStyle(row.helmer)};opacity:${barOpacity}"></line>
      `;
    }).join("")
  ).join("");

  const marks = seriesRows.map(row =>
    row.vals.map((mpi, i) => {
      if (mpi === null) return "";
      const x = mapX(i);
      const color = metricMarkerColor(row.helmer);
      const k = mpi.incidentCount;
      const ci95 = mpi.bands[mpi.bands.length - 1];
      const kLine = k !== null ? ` (${Number.isInteger(k) ? String(k) : k.toFixed(1)} incident${k === 1 ? "" : "s"})` : "";
      const vmtLines = mpi.vmtMonth > 0
        ? `\nMonthly VMT: ${fmtWhole(mpi.vmtMonth)}\nCoverage-adjusted VMT for MPI: ${fmtWhole(mpi.vmtMonthEff)}\nCumulative VMT: ${fmtWhole(mpi.vmtCume)}`
        : "";
      const incompleteNote = mpi.covRatio < 0.999
        ? `\nEstimated ${(mpi.covRatio * 100).toFixed(0)}% incident coverage so VMT scaled to ${fmtWhole(mpi.vmtMonthEff)}`
        : "";
      const tip = `${helmerLabel(row.helmer)} ${series.months[i]} (${row.metric.label})\nMPI: ${fmtMiles(mpi.mpiBest)}${kLine}\nRange: ${fmtMiles(ci95.lo)} \u2013 ${fmtMiles(ci95.hi)}${vmtLines}${incompleteNote}`;
      const yc = clampY(mpi.mpiBest);
      const dotOpacity = (0.35 + 0.65 * mpi.covRatio).toFixed(3);
      const qOpacity = (1 - mpi.covRatio).toFixed(3);
      const dot = renderDot(x, yc, color, 1);
      const qmark = `<text x="${(x + 7).toFixed(2)}" y="${(yc - 3).toFixed(2)}" text-anchor="middle" style="font-size:13px;font-weight:bold;fill:#555;opacity:${qOpacity};pointer-events:none">?</text>`;
      return `<g opacity="${dotOpacity}">${dot}</g>${qmark}<circle cx="${x}" cy="${yc}" r="12" fill="none" pointer-events="all" style="cursor:pointer" data-tip="${escAttr(tip)}"></circle>`;
    }).join("")
  ).join("");

  // Fan chart: nested CI bands at 50%, 80%, 95% with decreasing opacity.
  // Bands are always continuous — even months with k=0 have a valid posterior
  // (Gamma(0.5, m)), just with very high MPI and wide uncertainty.
  // Clamp to plot range so SVG coordinates stay reasonable.
  const bands = seriesRows.map(row => {
    const color = metricMarkerColor(row.helmer);
    // Draw widest band first (95%), then 80%, then 50% on top
    return CI_FAN_LEVELS.slice().reverse().map((_level, li) => {
      const bandIdx = CI_FAN_LEVELS.length - 1 - li; // index into bands array
      const bandOpacity = (0.10 * (1 + li * 0.5)).toFixed(3);
      // Split into contiguous segments (skip null vals)
      const segments = [];
      let seg = [];
      for (let i = 0; i < row.vals.length; i++) {
        if (row.vals[i] !== null) { seg.push(i); }
        else { if (seg.length > 0) { segments.push(seg); seg = []; } }
      }
      if (seg.length > 0) segments.push(seg);
      return segments.map(indices => {
        let d = "";
        for (const i of indices) {
          d += `${d ? " L " : "M "}${mapX(i).toFixed(2)} ${clampY(row.vals[i].bands[bandIdx].hi).toFixed(2)}`;
        }
        for (let j = indices.length - 1; j >= 0; j--) {
          d += ` L ${mapX(indices[j]).toFixed(2)} ${clampY(row.vals[indices[j]].bands[bandIdx].lo).toFixed(2)}`;
        }
        d += " Z";
        return `<path d="${d}" style="fill:${color};opacity:${bandOpacity}"></path>`;
      }).join("");
    }).join("");
  }).join("");

  // Title lives in the collapsible section header (#mpi-heading), set by
  // renderWindowedViews, so it stays visible when the section is collapsed.
  return `
    ${helmerChipLegend(seriesRows.filter(row => row.vals.some(v => v !== null)).map(row => row.helmer))}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}">
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

function renderDistributionChart(series) {
  const metric = selectedMonthMetric();
  const {start, end} = seriesMonthBounds(series);
  const summaryRows = monthlySummaryRows(series);
  const curves = [];
  for (const row of summaryRows) {
    if (!monthHelmerEnabled[row.helmer]) continue;
    const est = row.mpiEstimates[metric.key];
    if (!est) continue;
    curves.push({
      helmer: row.helmer, metric, est,
      densityFn: est.densityFn,
      xMin: est.xMin, xMax: est.xMax,
    });
  }
  if (curves.length === 0) return "";

  // X-axis range from all curves' density extents
  let xMin = Infinity, xMax = 0;
  for (const c of curves) {
    xMin = Math.min(xMin, c.xMin);
    xMax = Math.max(xMax, c.xMax);
  }
  assert(xMin < xMax, "distribution chart: degenerate x range", {xMin, xMax});

  // Sample on log-uniform grid
  const nPts = 250;
  const logMin = Math.log(xMin);
  const logMax = Math.log(xMax);
  const logStep = (logMax - logMin) / (nPts - 1);
  const xs = [];
  for (let i = 0; i < nPts; i++) xs.push(Math.exp(logMin + logStep * i));

  let yMax = 0;
  for (const c of curves) {
    c.ys = xs.map(x => c.densityFn(x));
    const peakIdx = c.ys.reduce((best, y, i) => y > c.ys[best] ? i : best, 0);
    c.peakX = xs[peakIdx];
    c.peakY = c.ys[peakIdx];
    yMax = Math.max(yMax, c.peakY);
  }
  if (yMax === 0) return "";

  const svgW = 900, svgH = 280;
  const mLeft = 68, mRight = 16, mTop = 14, mBot = 40;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const baseline = mTop + pH;
  const mapX = x => mLeft + (Math.log(x) - logMin) / (logMax - logMin) * pW;
  const mapY = y => mTop + pH * (1 - y / yMax);

  // Log-scale x-axis ticks
  const ticks = [];
  const e0 = Math.floor(Math.log10(xMin));
  const e1 = Math.ceil(Math.log10(xMax));
  for (let e = e0; e <= e1; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= xMin && v <= xMax) ticks.push(v);
    }
  }

  const axes = `
    ${ticks.map(v => `
      <line x1="${mapX(v).toFixed(2)}" y1="${mTop}" x2="${mapX(v).toFixed(2)}" y2="${baseline}"
        style="stroke:#e0e4ef;stroke-width:0.5"></line>
      <text class="month-tick" x="${mapX(v).toFixed(2)}" y="${svgH - 16}" text-anchor="middle">${fmtMiles(v)}</text>
    `).join("")}
    <line class="month-axis" x1="${mLeft}" y1="${mTop}" x2="${mLeft}" y2="${baseline}"></line>
    <line class="month-axis" x1="${mLeft}" y1="${baseline}" x2="${mLeft + pW}" y2="${baseline}"></line>
    <text class="month-label" x="12" y="${mTop + pH / 2}" transform="rotate(-90 12 ${mTop + pH / 2})" text-anchor="middle">Probability Density for True MPI</text>
  `;

  // Curve fills (low opacity) and strokes — unified for all helmers
  const fills = curves.map(c => {
    const color = HELMER_COLORS[c.helmer];
    let d = `M ${mapX(xs[0]).toFixed(2)} ${baseline.toFixed(2)}`;
    for (let i = 0; i < nPts; i++) {
      d += ` L ${mapX(xs[i]).toFixed(2)} ${mapY(c.ys[i]).toFixed(2)}`;
    }
    d += ` L ${mapX(xs[nPts - 1]).toFixed(2)} ${baseline.toFixed(2)} Z`;
    return `<path d="${d}" style="fill:${color};opacity:0.120"></path>`;
  }).join("");

  const strokes = curves.map(c => {
    let d = "";
    for (let i = 0; i < nPts; i++) {
      d += `${i === 0 ? "M " : " L "}${mapX(xs[i]).toFixed(2)} ${mapY(c.ys[i]).toFixed(2)}`;
    }
    return `<path d="${d}" style="${metricLineStyle(c.helmer)};fill:none"></path>`;
  }).join("");

  // Peak markers with tooltips
  const markers = curves.map(c => {
    const color = HELMER_COLORS[c.helmer];
    const x = mapX(c.peakX);
    const y = mapY(c.peakY);
    const kLine = c.est.k !== null
      ? `\n${Number.isInteger(c.est.k) ? String(c.est.k) : c.est.k.toFixed(1)} incident${c.est.k === 1 ? "" : "s"}`
      : "";
    const tip = `${helmerLabel(c.helmer)} (${c.metric.cardLabel})\nMPI: ${fmtMiles(c.est.median)}\nRange: ${fmtMiles(c.est.lo)} \u2013 ${fmtMiles(c.est.hi)}${kLine}`;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" style="fill:${color};stroke:#fff;stroke-width:1.5" data-tip="${escAttr(tip)}"></circle>`;
  }).join("");

  // Title lives in the collapsible section header (#dist-heading), set by
  // renderWindowedViews, so it stays visible when the section is collapsed.
  return `
    ${helmerChipLegend(curves.map(c => c.helmer))}
    <svg class="month-svg" viewBox="0 0 ${svgW} ${svgH}">
      <defs><clipPath id="dist-clip"><rect x="${mLeft}" y="${mTop}" width="${pW}" height="${pH}"></rect></clipPath></defs>
      ${axes}
      <g clip-path="url(#dist-clip)">
      ${fills}
      ${strokes}
      ${markers}
      </g>
    </svg>
  `;
}

function drawDualMonthAxes(
  months, svgH, mLeft, mTop, pW, pH, mapX,
  leftTicks, mapLeftY, leftFmt, leftLabel,
) {
  const axisY = mTop + pH;
  const rightX = mLeft + pW;
  const midY = mTop + pH / 2;
  const labelStep = months.length <= 12 ? 1 : months.length <= 24 ? 2 : 3;
  return `
    ${months.map((month, i) => `
      <line class="month-grid" x1="${mapX(i)}" y1="${mTop}" x2="${mapX(i)}" y2="${axisY}"${i % labelStep !== 0 ? ' style="opacity:0.3"' : ""}></line>
      ${i % labelStep === 0 || i === months.length - 1 ? `<text class="month-tick" x="${mapX(i)}" y="${svgH - 16}" text-anchor="middle">${month}</text>` : ""}
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

function renderHelmerMonthlyChart(globalSeries, helmer) {
  // Filter to months where this helmer has VMT data
  const presentIndices = [];
  for (let i = 0; i < globalSeries.points.length; i++) {
    if (globalSeries.points[i].helmers[helmer] !== null) presentIndices.push(i);
  }
  if (presentIndices.length === 0) return "";
  const series = {
    months: presentIndices.map(i => globalSeries.months[i]),
    points: presentIndices.map(i => globalSeries.points[i]),
  };
  const svgW = 900;
  const svgH = 250;
  const mLeft = 68;
  const mRight = 24;
  const mTop = 14;
  const mBot = 48;
  const pW = svgW - mLeft - mRight;
  const pH = svgH - mTop - mBot;
  const rows = helmerMonthRows(series, helmer);
  const vmtMax = Math.max(1, ...rows.map(row => row.vmtRawMax));
  const incidentMax = Math.max(1, ...rows.map(row => row.incidents.total));
  const leftTicks = linearTicks(0, vmtMax, 4);
  const monthStep = pW / ((series.months.length - 1) || 1);
  const barW = Math.min(30, monthStep * 0.56);
  const xPad = barW / 2 + 2; // inset so edge bars don't overlap axes
  const mapX = idx => scaleLinear(idx, 0, series.months.length - 1, mLeft + xPad, mLeft + pW - xPad);
  const mapVmtY = y => scaleLinear(y, 0, vmtMax, mTop + pH, mTop);
  const mapIncidentY = y => scaleLinear(y, 0, incidentMax, mTop + pH, mTop);
  const vmtColor = HELMER_COLORS[helmer];

  const bars = [];
  const barCounts = [];
  const barTotals = [];
  const errs = [];
  const halfBar = (barW - 1) / 2; // 1px gap between the two bars
  for (let i = 0; i < series.points.length; i++) {
    const row = rows[i];
    const month = series.months[i];
    const cx = mapX(i);
    const rec = row.incidents;
    const monthVmtBest = fmtWhole(row.vmtRawBest);
    const monthVmtCume = fmtWhole(row.vmtCume);
    const monthVmtEff = fmtWhole(row.vmtBest);

    // MPI for each variant (used in hover text) — read pre-computed values
    const mpiByKey = Object.fromEntries(
      Object.entries(row.mpiByMetric)
        .filter(([, est]) => est !== null)
        .map(([key, est]) => [key, fmtMiles(est.mpiBest)]));

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
        const mpiLabel = `Miles per incident (MPI, ${seg.label.toLowerCase()}): ${mpiByKey[seg.mpiKey]}`;
        const barTip = `${helmer} ${month} \u2014 ${seg.label}\nSegment: ${fmtCount(count)} incidents\nTotal: ${fmtCount(rec.total)} incidents\n${mpiLabel}\nMonthly VMT: ${monthVmtBest}\nCoverage-adjusted VMT for MPI: ${monthVmtEff}\nCumulative VMT: ${monthVmtCume}`;
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
    renderBar(cx - barW / 2, halfBar, MOVEMENT_SEGMENTS, MOVEMENT_COLORS[helmer], moveCounts);

    // Right bar: severity partition
    const sevCounts = severitySegmentCounts(rec);
    renderBar(cx - barW / 2 + halfBar + 1, halfBar, SEVERITY_SEGMENTS, SEVERITY_COLORS[helmer], sevCounts);

    if (rec.total > 0) {
      const labelX = cx;
      const labelY = Math.max(mapIncidentY(rec.total) - 7, mTop + 7);
      barTotals.push(`<text class="month-inc-total" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${fmtCount(rec.total)}</text>`);
    }
    const yLo = mapVmtY(row.vmtRawMin);
    const yHi = mapVmtY(row.vmtRawMax);
    const vmtTip = vmtTooltip(helmer, month, row, rec);
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
    const vmtTip = vmtTooltip(helmer, series.months[i], row, row.incidents);
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
        series.months, svgH, mLeft, mTop, pW, pH, mapX, leftTicks, mapVmtY, fmtMiles,
        "Vehicle Miles Traveled (VMT)",
      )}
    </svg>
  `;
}

function renderMpiSummaryCards(series) {
  const rows = monthlySummaryRows(series);
  return rows.map(row => {
    const vmtLine = row.vmtBest > 0
      ? `<div class="mpi-card-vmt" data-tip="${escAttr(row.vmtRationales.join('\n'))}">VMT: ${fmtWhole(row.vmtBest)}${row.vmtMin !== row.vmtBest || row.vmtMax !== row.vmtBest ? ` (${fmtWhole(row.vmtMin)} \u2013 ${fmtWhole(row.vmtMax)})` : ""}</div>`
      : `<div class="mpi-card-vmt">Benchmarks: ${[...new Set(METRIC_DEFS.map(m => m.humanMPI && m.humanMPI[row.helmer]).filter(Boolean).flatMap(h => h.srcLinks || []).map(s => `<a href="${s.url}">${s.label}</a>`))].join(", ")}</div>`;
    const stressLine = row.vmtBest > 0
      ? (() => { const stress = helmerHumanStress(row, "all"); return `<div class="mpi-card-stress">Overall: <span class="stress-badge ${stress.className}">${stress.label}</span> ${fmtRatio(stress.ratioLo)}x \u2013 ${fmtRatio(stress.ratioHi)}x</div>`; })()
      : "";
    return `
      <div class="mpi-card" style="border-left-color:${HELMER_COLORS[row.helmer]}">
        <div class="mpi-card-helmer">${helmerLabel(row.helmer)}</div>
        ${vmtLine}
        ${stressLine}
        ${METRIC_DEFS.map(m => {
          const est = row.mpiEstimates[m.key];
          if (!est) return "";
          const hl = m.key === selectedMetricKey ? " highlighted" : "";
          const humanBench = m.humanMPI && m.humanMPI[row.helmer]; // this row's cohort (human cards)
          const humanRef = m.humanMPI && m.humanMPI.HumansAV; // ADS "Nx vs humans" baseline
          const humanGeo = humanRef ? Math.sqrt(humanRef.lo * humanRef.hi) : null;
          const mult = (humanGeo && est.k !== null) ? est.median / humanGeo : null;
          const multStr = mult !== null
            ? ` <span class="mpi-card-mult ${mult >= 1 ? "safer" : "worse"}">${mult >= 10 ? fmtWhole(mult) : mult.toFixed(1)}x</span>`
            : "";
          const kLine = est.k !== null ? `${fmtCount(est.k)} incidents \u2192 ` : "";
          const ciLabel = est.k !== null ? "95% CI" : "Range";
          const srcLine = (est.k === null && humanBench && humanBench.srcLinks)
            ? `<div class="mpi-card-sources">${humanBench.srcLinks.map(s => `<a href="${s.url}">${s.label}</a>`).join(", ")}</div>`
            : "";
          const srcHint = (est.k === null && humanBench && humanBench.src)
            ? ` <span class="mpi-card-src" title="${humanBench.src}">[?]</span>`
            : "";
          return `
          <div class="mpi-card-metric${m.primary ? " primary" : ""}${hl}" data-metric="${m.key}">
            <div>${m.cardLabel}: ${kLine}<span class="mpi-card-mpi">${fmtWhole(est.median)} MPI</span>${multStr}</div>
            <div class="mpi-card-ci">${ciLabel}: ${fmtWhole(est.lo)} \u2013 ${fmtWhole(est.hi)}${srcHint}</div>
            ${srcLine}
          </div>`;
        }).join("")}
      </div>
    `;
  }).join("");
}

function renderStressTestTable(series) {
  const rows = monthlySummaryRows(series).filter(r => r.vmtBest > 0);
  const body = rows.flatMap(row =>
    METRIC_KEYS.filter(metricKey => row.mpiEstimates[metricKey] !== null).map(metricKey => {
      const stress = helmerHumanStress(row, metricKey);
      return `<tr>
        <td>${escHtml(row.helmer)}</td>
        <td>${escHtml(stress.metric.cardLabel)}</td>
        <td>${fmtCount(stress.av.k)}</td>
        <td>${fmtWhole(stress.av.median)}; ${fmtWhole(stress.av.lo)} \u2013 ${fmtWhole(stress.av.hi)}</td>
        <td>${fmtWhole(stress.human.lo)} \u2013 ${fmtWhole(stress.human.hi)}</td>
        <td>${fmtRatio(stress.ratioLo)}x \u2013 ${fmtRatio(stress.ratioHi)}x</td>
        <td><span class="stress-badge ${stress.className}">${stress.label}</span></td>
      </tr>`;
    })
  ).join("");
  // Faultfrac sensitivity sub-table.
  const faultRows = rows
    .filter(row => row.mpiEstimates.atfault !== null)
    .map(row => {
      const stress = helmerHumanStress(row, "atfault");
      const flip = faultFlipMultiplier(stress.av, stress.human);
      const multCell = flip === null ? "—"
        : flip.mult === Infinity ? "∞"
        : `${fmtRatio(flip.mult)}x`;
      const flippedCell = flip === null || flip.flipped === null ? "—"
        : `<span class="stress-badge ${STRESS_VERDICT_META[flip.flipped].className}">${STRESS_VERDICT_META[flip.flipped].label}</span>`;
      return `<tr>
        <td>${escHtml(row.helmer)}</td>
        <td>${fmtCount(stress.av.k)}</td>
        <td><span class="stress-badge ${stress.className}">${stress.label}</span></td>
        <td>${multCell}</td>
        <td>${flippedCell}</td>
      </tr>`;
    }).join("");
  const faultSensitivity = `
    <p>
How wrong Claude's fault judgments would have to be to change the verdicts.
The multiplier is the smallest factor that the true at-fault fraction would need to exceed the judged at-fault fraction before changing the at-fault verdict.
    </p>
    <table class="source-table stress-table">
      <thead><tr><th>Company</th><th>Judged fault</th><th>Current verdict</th><th>Flip multiplier</th><th>Verdict after flip</th></tr></thead>
      <tbody>${faultRows}</tbody>
    </table>`;
  return `
    <h3>Sensitivity analysis</h3>
    <p>
The "AV/human ratio" column gives the possible range for that ratio based on the confidence intervals.
If the whole range is above 1, we call that "robustly safer".
    </p>
    <table class="source-table stress-table">
      <thead><tr><th>Company</th><th>Metric</th><th>k</th><th>MPI AV (median; 95%)</th><th>Human MPI (AV cities)</th><th>AV/human ratio</th><th>Verdict</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${faultSensitivity}`;
}

function renderHumanBenchmarkTable() {
  const rows = HUMAN_HELMERS.flatMap(hh => METRIC_DEFS
    .filter(m => m.humanMPI && m.humanMPI[hh])
    .map(m => {
      const h = m.humanMPI[hh];
      const links = (h.srcLinks || [])
        .map(s => `<a href="${s.url}">${escHtml(s.label)}</a>`).join(", ");
      const derivation = escHtml(h.src) + (links ? ` (${links})` : "");
      return `<tr><td>${escHtml(helmerLabel(hh))}</td><td>${escHtml(m.cardLabel)}</td><td>${fmtMiles(h.lo)}</td><td>${fmtMiles(h.hi)}</td><td>${derivation}</td></tr>`;
    })).join("");
  return `
    <h3>Specific human benchmark derivations</h3>
    <p>
Sources: Kusano & Scanlon, Waymo's safety impact page, FARS.
This differs from Waymo's location-adjusted safety-impact methodology.
The all-incidents comparison is broader than Waymo's surface-street, injury-focused framing.
    </p>
    <table class="source-table">
      <thead><tr><th>Cohort</th><th>Metric</th><th>Low MPI</th><th>High MPI</th><th>Derivation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderMonthlyLegends() {
  byId("month-legend-mpi-helmers").innerHTML = ALL_HELMERS.map(helmer => `
    <label class="month-legend-item month-helmer-toggle" for="${monthHelmerToggleId(helmer)}">
      <input type="checkbox" id="${monthHelmerToggleId(helmer)}" ${monthHelmerEnabled[helmer] ? "checked" : ""}>
      <span class="month-chip" style="background:${HELMER_COLORS[helmer]}"></span>${helmerLabel(helmer)}
    </label>
  `).join("");
  for (const helmer of ALL_HELMERS) {
    const input = byId(monthHelmerToggleId(helmer));
    input.addEventListener("change", () => {
      monthHelmerEnabled[helmer] = input.checked;
      buildMonthlyViews();
    });
  }

  byId("month-legend-mpi-lines").innerHTML = `
    ${METRIC_DEFS.map(metric => {
      return `
      <label class="month-legend-item month-helmer-toggle" for="${monthMetricToggleId(metric.key)}">
        <input type="radio" name="month-metric" id="${monthMetricToggleId(metric.key)}" ${metric.key === selectedMetricKey ? "checked" : ""}>
        ${metric.label}
      </label>`;
    }).join("")}
  `;
  for (const metric of METRIC_DEFS) {
    const input = byId(monthMetricToggleId(metric.key));
    input.addEventListener("change", () => {
      selectedMetricKey = metric.key;
      buildMonthlyViews();
    });
  }

  // CI fan legend: multi-stripe swatches showing each helmer's color at the
  // band's rendered opacity level for each CI width (50%, 80%, 95%).
  const fanHelmers = includedHelmers();
  const fanLevels = CI_FAN_LEVELS.map((level, i) => {
    // Match the band rendering: reversed index li maps to bandOpacity =
    // 0.10 * metricOpacity * (1 + li * 0.5). Use metricOpacity = 1 for legend.
    const li = CI_FAN_LEVELS.length - 1 - i;
    const opacity = (0.10 * (1 + li * 0.5)).toFixed(3);
    const pct = Math.round(level * 100);
    // Build vertical stripe gradient from helmer colors
    const stripeW = 100 / fanHelmers.length;
    const stops = fanHelmers.map((c, j) => {
      const color = HELMER_COLORS[c];
      return `${color} ${(j * stripeW).toFixed(1)}% ${((j + 1) * stripeW).toFixed(1)}%`;
    }).join(", ");
    const grad = `linear-gradient(to right, ${stops})`;
    // The error bars draw the widest CI level, so its legend item also gets
    // the bar glyph.
    const barKey = i === CI_FAN_LEVELS.length - 1 ? '<span class="errbar-key"></span>' : "";
    return `
      <span class="month-legend-item">
        <span class="ci-fan-swatch" style="background:${grad};opacity:${opacity}"></span>${barKey}${pct}% CI
      </span>`;
  });
  byId("month-legend-ci-fan").innerHTML = fanLevels.join("");

  byId("month-legend-lines").innerHTML = `
    <span class="month-legend-item">
      <span class="month-linekey solid"></span>VMT (central estimate)
    </span>
  `;

  byId("month-legend-speed").innerHTML = `
    <span class="month-legend-label">Left bar (movement):</span>
    ${MOVEMENT_SEGMENTS.map(seg => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${MOVEMENT_LEGEND_COLORS[seg.key]}"></span>${seg.label}
      </span>
    `).join("")}
    <span class="month-legend-break" aria-hidden="true"></span>
    <span class="month-legend-label">Right bar (severity):</span>
    ${SEVERITY_SEGMENTS.map(seg => `
      <span class="month-legend-item">
        <span class="month-chip" style="background:${SEVERITY_LEGEND_COLORS[seg.key]}"></span>${seg.label}
      </span>
    `).join("")}
  `;
}

function renderDateRangeControls() {
  const container = byId("date-range-controls");
  const months = fullMonthSeries.months;
  const maxIdx = months.length - 1;
  const endIdx = Math.min(
    monthRangeEnd === Infinity ? maxIdx : monthRangeEnd, maxIdx);
  const startIdx = Math.min(monthRangeStart, endIdx);
  const lo = maxIdx > 0 ? (startIdx / maxIdx) * 100 : 0;
  const w = maxIdx > 0 ? ((endIdx - startIdx) / maxIdx) * 100 : 100;
  const rangeLabel = startIdx === endIdx
    ? months[startIdx]
    : `${months[startIdx]} \u2014 ${months[endIdx]}`;
  // Tick mark at DEFAULT_START_MONTH (when Tesla+Zoox VMT begins)
  const defIdx = months.indexOf(DEFAULT_START_MONTH);
  // Range thumb is 16px wide so its center travels from 8px to (width-8px).
  // Use calc() to map the percentage into that inset region.
  const defFrac = defIdx >= 0 && maxIdx > 0 ? defIdx / maxIdx : -1;
  container.innerHTML = `
    <div class="date-range-header">
      <span class="date-range-label">${rangeLabel}</span>
    </div>
    <div class="date-range-slider">
      <div class="date-range-track"></div>
      <div class="date-range-fill" id="date-range-fill" style="left:${lo.toFixed(2)}%;width:${w.toFixed(2)}%"></div>
      ${defFrac >= 0 ? `<div class="date-range-tick" style="left:calc(8px + (100% - 16px) * ${defFrac.toFixed(4)})">
        <div class="date-range-tick-line"></div>
        <div class="date-range-tick-label">${DEFAULT_START_MONTH}</div>
      </div>` : ""}
      <span class="date-range-end-label min">${months[0]}</span>
      <span class="date-range-end-label max">${months[maxIdx]}</span>
      <input type="range" class="date-range-input date-range-input-min" id="date-range-min"
             min="0" max="${maxIdx}" value="${startIdx}" step="1"
             aria-label="Start month">
      <input type="range" class="date-range-input date-range-input-max" id="date-range-max"
             min="0" max="${maxIdx}" value="${endIdx}" step="1"
             aria-label="End month">
    </div>
  `;
  const minInput = byId("date-range-min");
  const maxInput = byId("date-range-max");
  const fill = byId("date-range-fill");
  const label = container.querySelector(".date-range-label");
  let rangeRafPending = false;
  const rangeRaf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame : (fn) => fn();
  // Live drag: update the slider visuals immediately and re-render the
  // window-dependent charts on the next frame (coalescing rapid input events).
  // The slider DOM, incident table, sanity checks, and URL are left untouched
  // so the drag isn't interrupted; those commit on release (the change event).
  function updateLive() {
    const a = Math.min(Number(minInput.value), Number(maxInput.value));
    const b = Math.max(Number(minInput.value), Number(maxInput.value));
    monthRangeStart = a;
    monthRangeEnd = b;
    const fLeft = maxIdx > 0 ? (a / maxIdx) * 100 : 0;
    const fWidth = maxIdx > 0 ? ((b - a) / maxIdx) * 100 : 100;
    fill.style.left = fLeft.toFixed(2) + "%";
    fill.style.width = fWidth.toFixed(2) + "%";
    label.textContent = a === b ? months[a] : `${months[a]} \u2014 ${months[b]}`;
    if (!rangeRafPending) {
      rangeRafPending = true;
      rangeRaf(() => { rangeRafPending = false; renderWindowedViews(); });
    }
  }
  minInput.addEventListener("input", updateLive);
  maxInput.addEventListener("input", updateLive);
  function commitRange() {
    monthRangeStart = Math.min(Number(minInput.value), Number(maxInput.value));
    monthRangeEnd = Math.max(Number(minInput.value), Number(maxInput.value));
    renderWindowedViews();
    syncUrlState();
    buildSanityChecks();
    buildBrowser();
  }
  minInput.addEventListener("change", commitRange);
  maxInput.addEventListener("change", commitRange);
}

// Renders only the views that depend on the selected date window. Used both by
// the full rebuild and by the live slider drag, which re-slices the
// already-computed fullMonthSeries without rebuilding the slider, incident
// table, or URL (so an in-progress drag isn't interrupted).
function renderWindowedViews() {
  if (monthRangeStart === -1) { // resolve default start month on first build
    const idx = fullMonthSeries.months.indexOf(DEFAULT_START_MONTH);
    monthRangeStart = idx >= 0 ? idx : 0;
  }
  const maxIdx = fullMonthSeries.months.length - 1;
  const endIdx = Math.min(
    monthRangeEnd === Infinity ? maxIdx : monthRangeEnd, maxIdx);
  const startIdx = Math.min(monthRangeStart, endIdx);
  const isFullRange = startIdx === 0 && endIdx === maxIdx;
  byId("month-panel").classList.toggle("date-filtered", !isFullRange);
  activeSeries = isFullRange
    ? fullMonthSeries
    : sliceSeries(fullMonthSeries, startIdx, endIdx);
  // Section headers carry the (dynamic) chart titles so they stay visible when
  // a section is collapsed. Exact strings preserved from the former chart h3s.
  const metric = selectedMonthMetric();
  const {start, end} = seriesMonthBounds(activeSeries);
  byId("mpi-heading").textContent = `${metric.label} over time`;
  byId("dist-heading").textContent = `${metric.label} using data from ${start} to ${end}`;
  byId("chart-mpi-all").innerHTML = renderAllHelmersMpiChart(activeSeries);
  // Pools the slider-selected window; narrow the date range to weight recent
  // data. The monthly chart above shows how the rate moves over time.
  byId("chart-distributions").innerHTML = renderDistributionChart(activeSeries);
  byId("mpi-summary-cards").innerHTML = `<div class="mpi-cards">${renderMpiSummaryCards(activeSeries)}</div>`;
  byId("chart-helmer-series").innerHTML = ADS_HELMERS.map(helmer => `
    <div class="month-chart">
      <h3>${helmer}</h3>
      ${renderHelmerMonthlyChart(activeSeries, helmer)}
    </div>
  `).join("");
}

function buildMonthlyViews() {
  fullMonthSeries = monthSeriesData();
  const fullSummary = monthlySummaryRows(fullMonthSeries);
  for (const row of fullSummary) {
    if (row.vmtBest === 0) continue; // helmer has no data in incident window
    assert(row.incTotal > 0, "full-series total incidents must be positive", {helmer: row.helmer});
    assert(row.incNonstationary > 0, "full-series nonstationary incidents must be positive", {helmer: row.helmer});
    assert(row.incRoadwayNonstationary > 0, "full-series roadway nonstationary incidents must be positive", {helmer: row.helmer});
  }
  renderWindowedViews();
  renderMonthlyLegends();
  renderDateRangeControls();
  syncUrlState();
  buildSanityChecks();
  buildBrowser();
}

// --- Fault fraction data ---

function buildFaultDataFromIncidents(rows) {
  const data = {};
  for (const row of rows) {
    assert(typeof row.reportId === "string" && row.reportId !== "",
      "incident missing reportId for fault mapping");
    if (row.fault === null) continue; // pre-analysis-window incidents lack fault data
    assert(typeof row.fault === "object",
      "incident fault must be null or object", {reportId: row.reportId});
    const faultfrac = Number(row.fault.faultfrac);
    assert(Number.isFinite(faultfrac) && faultfrac >= 0 && faultfrac <= 1,
      "incident faultfrac out of range", {reportId: row.reportId, faultfrac});
    assert(typeof row.fault.reasoning === "string",
      "incident fault reasoning invalid", {reportId: row.reportId});
    assert(data[row.reportId] === undefined, "duplicate reportId in incidents", {reportId: row.reportId});
    data[row.reportId] = {faultfrac, reasoning: row.fault.reasoning};
  }
  return data;
}

function faultFrac(reportId) {
  const fd = faultData[reportId];
  return fd ? fd.faultfrac : null;
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

function faultTooltip(inc) {
  const fd = faultData[inc.reportId];
  if (!fd) return "";
  const lines = [`${fd.faultfrac.toFixed(2)} — ${fd.reasoning}`];
  if (inc.svHit || inc.cpHit) {
    lines.push(`${inc.svHit || "n/a"} \u{1F4A5} ${inc.cpHit || "n/a"}`);
  }
  return lines.join("\n");
}


// --- Incident Browser ---

let activeFilter = "All";
let sortCol = null;   // column key or null
let sortAsc = true;

const SORT_COLUMNS = [
  {key: "helmer",  val: r => r.helmer},
  {key: "date",     val: r => monthKeyFromIncidentLabel(r.date)},
  {key: "location", val: r => (r.city + ", " + r.state)},
  {key: "crashWith",val: r => r.crashWith},
  {key: "speed",    val: r => r.speed !== null ? r.speed : -1},
  {key: "fault",    val: r => { const f = faultFrac(r.reportId); return f !== null ? f : -1; }},
  {key: "severity", val: r => SEVERITY_RANK[r.severity] ?? -1},
  {key: "narrative", val: r => r.narrative || ""},
];
const SORT_COLUMN_KEYS = SORT_COLUMNS.map(col => col.key);
const URL_STATE_KEYS = {
  filter: "f",
  sort: "s",
  asc: "a",
  helmers: "c",
  metrics: "m",
  dateRange: "d",
  collapsed: "x",
};
const URL_STATE_REQUIRED = ["f", "s", "a", "c", "m"];
const URL_STATE_SORT_NONE = "-";

function enabledKeyString(enabledByKey, orderedKeys) {
  return orderedKeys.filter(key => enabledByKey[key]).join(".");
}

function parseEnabledKeyString(raw, orderedKeys, label) {
  const keys = raw === "" ? [] : raw.split(".");
  const allowed = new Set(orderedKeys);
  const unique = new Set(keys);
  assert(unique.size === keys.length, "Duplicate URL state key", {label, raw});
  for (const key of keys) {
    assert(allowed.has(key), "Unknown URL state key value", {label, key, raw});
  }
  return Object.fromEntries(orderedKeys.map(key => [key, unique.has(key)]));
}

function encodeUiStateQuery() {
  const params = new URLSearchParams();
  params.set(URL_STATE_KEYS.filter, activeFilter);
  params.set(URL_STATE_KEYS.sort, sortCol === null ? URL_STATE_SORT_NONE : sortCol);
  params.set(URL_STATE_KEYS.asc, sortAsc ? "1" : "0");
  params.set(URL_STATE_KEYS.helmers, enabledKeyString(monthHelmerEnabled, ALL_HELMERS));
  params.set(URL_STATE_KEYS.metrics, selectedMetricKey);
  const fullLen = fullMonthSeries ? fullMonthSeries.months.length : 0;
  const defaultStartIdx = fullMonthSeries
    ? Math.max(0, fullMonthSeries.months.indexOf(DEFAULT_START_MONTH))
    : 0;
  const isDefaultRange = (monthRangeStart === -1 || monthRangeStart === defaultStartIdx) &&
    (monthRangeEnd === Infinity || (fullLen > 0 && monthRangeEnd >= fullLen - 1));
  if (!isDefaultRange) {
    const endClamped = fullLen > 0
      ? Math.min(monthRangeEnd === Infinity ? fullLen - 1 : monthRangeEnd, fullLen - 1)
      : monthRangeEnd;
    params.set(URL_STATE_KEYS.dateRange, `${monthRangeStart}-${endClamped}`);
  }
  const collapsed = enabledKeyString(sectionCollapsed, SECTION_IDS);
  if (collapsed !== "") params.set(URL_STATE_KEYS.collapsed, collapsed);
  return params.toString();
}

function applyUiStateQuery(queryString) {
  const raw = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  if (raw === "") return;
  const params = new URLSearchParams(raw);
  const expectedKeys = Object.values(URL_STATE_KEYS);
  const expectedSet = new Set(expectedKeys);
  const seenKeys = new Set();

  for (const key of params.keys()) {
    assert(!seenKeys.has(key), "Duplicate URL state key", {key, raw});
    seenKeys.add(key);
    assert(expectedSet.has(key), "Unexpected URL state key", {key, raw});
  }
  for (const key of URL_STATE_REQUIRED) {
    assert(params.has(key), "Missing URL state key", {key, raw});
  }

  const filterVal = params.get(URL_STATE_KEYS.filter);
  assert(filterVal !== null, "Missing filter URL state", {raw});
  assert(["All", ...ADS_HELMERS].includes(filterVal), "Invalid filter URL state", {filterVal, raw});
  activeFilter = filterVal;

  const sortVal = params.get(URL_STATE_KEYS.sort);
  assert(sortVal !== null, "Missing sort URL state", {raw});
  sortCol = sortVal === URL_STATE_SORT_NONE ? null : sortVal;
  assert(sortCol === null || SORT_COLUMN_KEYS.includes(sortCol), "Invalid sort URL state", {sortVal, raw});

  const ascVal = params.get(URL_STATE_KEYS.asc);
  assert(ascVal === "0" || ascVal === "1", "Invalid sort direction URL state", {ascVal, raw});
  sortAsc = ascVal === "1";

  const helmersVal = params.get(URL_STATE_KEYS.helmers);
  assert(helmersVal !== null, "Missing helmers URL state", {raw});
  monthHelmerEnabled = {
    ...monthHelmerEnabled,
    ...parseEnabledKeyString(helmersVal, ALL_HELMERS, "helmers"),
  };

  const metricsVal = params.get(URL_STATE_KEYS.metrics);
  assert(metricsVal !== null, "Missing metrics URL state", {raw});
  if (METRIC_KEYS.includes(metricsVal)) {
    selectedMetricKey = metricsVal;
  } else {
    // Fall back: try parsing old multi-key format, pick first enabled
    const parsed = parseEnabledKeyString(metricsVal, METRIC_KEYS, "metrics");
    const firstEnabled = METRIC_KEYS.find(k => parsed[k]);
    if (firstEnabled) selectedMetricKey = firstEnabled;
  }

  if (params.has(URL_STATE_KEYS.dateRange)) {
    const drVal = params.get(URL_STATE_KEYS.dateRange);
    const drHit = /^(\d+)-(\d+)$/.exec(drVal);
    assert(drHit !== null, "Invalid date range URL state format", {drVal});
    const drStart = Number(drHit[1]);
    const drEnd = Number(drHit[2]);
    assert(drStart >= 0 && drEnd >= drStart,
      "Invalid date range URL state values", {drStart, drEnd});
    monthRangeStart = drStart;
    monthRangeEnd = drEnd;
  }

  if (params.has(URL_STATE_KEYS.collapsed)) {
    sectionCollapsed = {
      ...sectionCollapsed,
      ...parseEnabledKeyString(params.get(URL_STATE_KEYS.collapsed), SECTION_IDS, "collapsed"),
    };
  }
}

function canSyncUrlState() {
  return typeof window === "object" &&
    window !== null &&
    window.location !== undefined &&
    typeof window.location.search === "string" &&
    typeof window.location.pathname === "string" &&
    window.history !== undefined &&
    typeof window.history.replaceState === "function" &&
    typeof URLSearchParams === "function";
}

function loadUiStateFromLocation() {
  if (!canSyncUrlState()) return;
  applyUiStateQuery(window.location.search);
}

function syncUrlState() {
  if (!canSyncUrlState()) return;
  window.history.replaceState(null, "", `${window.location.pathname}?${encodeUiStateQuery()}`);
}

function applyCollapsedState() {
  for (const id of SECTION_IDS) {
    const sec = byId("sec-" + id);
    if (sec) sec.classList.toggle("collapsed", sectionCollapsed[id]);
  }
}

function initCollapsibles() {
  for (const id of SECTION_IDS) {
    const sec = byId("sec-" + id);
    if (sec === null) continue;
    const head = sec.querySelector(".sec-head");
    head.addEventListener("click", () => {
      sectionCollapsed[id] = !sectionCollapsed[id];
      sec.classList.toggle("collapsed", sectionCollapsed[id]);
      syncUrlState();
    });
  }
  applyCollapsedState();
}

const HEADER_LABELS = ["Company", "Date", "Location", "Crash with", "Speed (mph)", "Fault", "Severity", "Narrative"];

function buildBrowser() {
  const {start, end} = seriesMonthBounds(activeSeries);
  const rows = activeIncidents();
  const counts = countByHelmer(rows);
  byId("incident-browser-heading").textContent =
    `Incident browser using data from ${start} to ${end}`;
  const filterDiv = byId("filters");
  filterDiv.replaceChildren();
  const allHelmers = ["All", ...ADS_HELMERS];
  for (const label of allHelmers) {
    const btn = document.createElement("button");
    const n = label === "All" ? rows.length : (counts[label] || 0);
    btn.textContent = `${label} (${n})`;
    btn.className = label === activeFilter ? "active" : "";
    btn.addEventListener("click", () => {
      activeFilter = label;
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
    th.tabIndex = 0;
    if (sortCol === col.key) {
      th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
    }
    const sortBy = () => {
      if (sortCol === col.key) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col.key;
        sortAsc = true;
      }
      renderHeaders();
      renderTable();
    };
    th.addEventListener("click", sortBy);
    th.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      sortBy();
    });
    tr.appendChild(th);
  }
  thead.replaceChildren(tr);
}

function renderTable() {
  const tbody = byId("incidents-body");
  const rows = activeIncidents();
  let filtered = activeFilter === "All"
    ? [...rows]
    : rows.filter(r => r.helmer === activeFilter);

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

    const fault = faultFrac(r.reportId);
    const faultHtml = fault !== null
      ? `<span class="fault-bar" style="width:${Math.round(fault * 40)}px;background:${faultColor(fault)}"></span>${fault.toFixed(2)}`
      : "—";
    const faultTip = escAttr(faultTooltip(r));

    tr.innerHTML = `
      <td>${escHtml(r.helmer)}</td>
      <td>${escHtml(r.date)}</td>
      <td>${escHtml(r.city)}, ${escHtml(r.state)}</td>
      <td>${escHtml(r.crashWith)}</td>
      <td>${escHtml(r.speed !== null ? String(r.speed) : "?")}</td>
      <td class="fault-cell" data-tip="${faultTip}">${faultHtml}</td>
      <td>${escHtml(shortenSeverity(r.severity))}</td>
      <td class="${narrativeClass}">${escHtml(narrativeText)}</td>
    `;
    // Click to expand/collapse narrative
    const narrativeTd = tr.querySelector(".narrative-cell");
    assert(narrativeTd !== null, "Missing narrative cell");
    narrativeTd.addEventListener("click", () => {
      narrativeTd.classList.toggle("expanded");
    });
    tbody.appendChild(tr);
  }
  syncUrlState();
}

function shortenSeverity(s) {
  const rules = [
    ["Property", "Property only"],
    ["No Injur", "No injury"],
    ["Minor W/O", "Minor injury"],
    ["Minor W/", "Minor injury (hosp.)"],
    ["Moderate W/O", "Moderate injury"],
    ["Moderate W/", "Moderate injury (hosp.)"],
    ["Serious", "Serious"],
    ["Fatal", "Fatal"],
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

// --- Sanity Checks ---

function buildSanityChecks() {
  const rows = activeIncidents();
  const vmt = activeVmt();
  const series = activeSeries || monthSeriesData();
  const sections = [];

  // --- 1. Passenger presence (existing) ---
  // [FIGURE VINTAGE] The "~56% of VMT is revenue (P3) miles" and "44.3%"
  // deadhead figures below are CPUC data through Sep 2025 (deadhead share
  // has been falling: 51.5% in Jan 2024 -> 44.3% in Sep 2025). Refresh from
  // the CPUC quarterly filings (or Driverless Digest's CPUC analyses) when
  // new quarters land.
  const paxTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) continue;
    const withPax = helmerRows.filter(r =>
      r.belted !== "Subject Vehicle - No Passenger In Vehicle" &&
      r.belted !== "Unknown" && r.belted !== "").length;
    const noPax = helmerRows.filter(r =>
      r.belted === "Subject Vehicle - No Passenger In Vehicle").length;
    const unk = n - withPax - noPax;
    // Range: low assumes all unknowns had no passenger, high assumes all did
    const pctLo = Math.round(100 * withPax / n);
    const pctHi = Math.round(100 * (withPax + unk) / n);
    const pctStr = pctLo === pctHi
      ? `${pctLo}%`
      : `${pctLo}\u2013${pctHi}%`;
    paxTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${withPax}</td>
      <td>${noPax}</td>
      <td>${unk}</td>
      <td>${n}</td>
      <td>${pctStr}</td>
    </tr>`);
  }
  sections.push(`
<h3>Passenger presence</h3>
<p>
Note that Waymo's advertised "rider-only miles" includes so-called deadhead miles, where the car is completely empty.
Per CPUC California data, ~56% of rider-only miles have a passenger, the other ~44% being deadhead.
For our purposes, we don't care about that breakdown.
All miles without a human driver count towards Vehicle Miles Traveled (VMT) and thus towards the Miles Per Incident (MPI) denominator.
</p>
<p>
Caveat:
If the passenger-seat safety monitor (present in almost all Tesla robotaxi rides so far) is able to intervene to prevent incidents, then the true unsupervised miles per incident (MPI) for Tesla would be lower (worse) than what these graphs and data show.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>With passenger</th>
        <th>No passenger</th>
        <th>Unknown</th>
        <th>Total</th>
        <th>% with passenger</th>
      </tr></thead>
      <tbody>${paxTableRows.join("")}</tbody>
    </table>`);

  // --- 2. Narrative redaction (CBI) ---
/* 
No redactions currently, so don't need this section; leaving it here commented
out just in case.
  const cbiTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) continue;
    const cbiCount = helmerRows.filter(r => r.narrativeCbi === "Y").length;
    const pct = Math.round(100 * cbiCount / n);
    cbiTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${cbiCount}</td>
      <td>${n - cbiCount}</td>
      <td>${n}</td>
      <td>${pct}%</td>
    </tr>`);
  }

  sections.push(`
<h3>Narrative redaction</h3>
<p>
Companies are allowed to redact details of incidents by calling them 
Confidential Business Information (CBI).
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Redacted (CBI)</th>
        <th>Full narrative</th>
        <th>Total</th>
        <th>% redacted</th>
      </tr></thead>
      <tbody>${cbiTableRows.join("")}</tbody>
    </table>`);
*/

  // --- 3. Severity breakdown ---
  // [COPY CURRENT AS OF 2026-06-11] The parenthetical note below assumes the
  // dataset's only fatalities are the two Waymo ones (SF JAN-2025,
  // stationary, faultfrac 0; Tempe SEP-2025, right turn at 8 mph,
  // faultfrac 0). Verified true today. If a new severity === "Fatality"
  // incident appears in data/incidents.js, this sentence must be rewritten
  // before it silently becomes wrong.
  const sevTableRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) continue;
    const propDmg = helmerRows.filter(r =>
      !INJURY_SEVERITIES.has(r.severity)).length;
    const injOnly = helmerRows.filter(r =>
      INJURY_SEVERITIES.has(r.severity) &&
      !HOSPITALIZATION_SEVERITIES.has(r.severity)).length;
    const hospOnly = helmerRows.filter(r =>
      HOSPITALIZATION_SEVERITIES.has(r.severity) &&
      r.severity !== "Fatality").length;
    const fatal = helmerRows.filter(r => r.severity === "Fatality").length;
    sevTableRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${propDmg} (${Math.round(100 * propDmg / n)}%)</td>
      <td>${injOnly} (${Math.round(100 * injOnly / n)}%)</td>
      <td>${hospOnly} (${Math.round(100 * hospOnly / n)}%)</td>
      <td>${fatal} (${Math.round(100 * fatal / n)}%)</td>
      <td>${n}</td>
    </tr>`);
  }
  sections.push(`
<h3>Severity breakdown</h3>
<p>
(Note that in one fatality the AV was stationary and in the other the AV was turning at 8 mph; in both cases the AI fault estimates are near zero.)
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Property damage only</th>
        <th>Injury (no hosp.)</th>
        <th>Hospitalization</th>
        <th>Fatality</th>
        <th>Total</th>
      </tr></thead>
      <tbody>${sevTableRows.join("")}</tbody>
    </table>`);

  // --- 4. VMT uncertainty ---
  // Restrict to incidentObservable months for like-for-like comparison
  const obsMonths = new Set(series.points.filter(p => p.incidentObservable).map(p => p.month));
  const vmtUncRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer && obsMonths.has(r.month));
    if (helmerVmt.length === 0) continue;
    const totalMin = helmerVmt.reduce((s, r) => s + r.vmtMin * r.coverage, 0);
    const totalBest = helmerVmt.reduce((s, r) => s + r.vmtBest * r.coverage, 0);
    const totalMax = helmerVmt.reduce((s, r) => s + r.vmtMax * r.coverage, 0);
    const ratio = (totalMax / totalMin).toFixed(1);
    vmtUncRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${fmtMiles(totalMin)}</td>
      <td>${fmtMiles(totalBest)}</td>
      <td>${fmtMiles(totalMax)}</td>
      <td>${ratio}x</td>
    </tr>`);
  }
  sections.push(`
<h3>VMT uncertainty</h3>
<p>
Below is the total adjusted Vehicle Miles Traveled (VMT) for each company across the NHTSA window, showing low/central/high estimates.
The "range ratio" (max &divide; min) is a measure of uncertainty in the VMT numbers.
For example, if this ratio is 2, it means the Miles Per Incident (MPI) could be off by up to a factor of 2.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>VMT low</th>
        <th>VMT central</th>
        <th>VMT high</th>
        <th>Range ratio</th>
      </tr></thead>
      <tbody>${vmtUncRows.join("")}</tbody>
    </table>`);

  // --- 5. Poisson dispersion (VMT-normalized) ---
  // Pearson chi-squared dispersion test: X² = Σ(k_i - λ̂·m_i)² / (λ̂·m_i)
  // where λ̂ = Σk_i / Σm_i is the MLE rate and m_i is monthly VMT.
  // Under the Poisson model, X²/(n-1) ≈ 1.
  const dispRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer && obsMonths.has(r.month));
    const monthData = [];
    for (const vmtRow of helmerVmt) {
      const count = rows.filter(r =>
        r.helmer === helmer &&
        monthKeyFromIncidentLabel(r.date) === vmtRow.month).length;
      // Use effective VMT (calendar coverage * incident reporting completeness)
      // to match the MPI calculation's Poisson rate estimation
      monthData.push({count, vmt: vmtRow.vmtBest * vmtRow.coverage * vmtRow.incCov});
    }
    if (monthData.length < 3) continue;
    const totalK = monthData.reduce((s, d) => s + d.count, 0);
    const totalM = monthData.reduce((s, d) => s + d.vmt, 0);
    const lambdaHat = totalK / totalM;
    let chiSq = 0;
    for (const d of monthData) {
      const expected = lambdaHat * d.vmt;
      if (expected > 0) chiSq += (d.count - expected) ** 2 / expected;
    }
    const df = monthData.length - 1;
    const dispIdx = chiSq / df;
    const rates = monthData.map(r =>
      r.vmt > 0 ? (r.count / r.vmt * 1e6).toFixed(1) : "\u2014");
    // With few total incidents the test has no power; flag that
    const verdict = totalK < 20 ? "too few incidents to tell"
      : dispIdx < 0.5 ? "underdispersed"
      : dispIdx < 2 ? "consistent with Poisson"
      : dispIdx < 5 ? "mildly overdispersed"
      : "overdispersed";
    dispRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${rates.join(", ")}</td>
      <td>${(lambdaHat * 1e6).toFixed(1)}</td>
      <td>${dispIdx.toFixed(2)}</td>
      <td>${verdict}</td>
    </tr>`);
  }
  sections.push(`
<h3>Poisson dispersion</h3>
<p>
For confidence bands we use a statistical model that assumes a Poisson process where incidents occur at a constant rate per mile.
(Also, apologies that this is all miles. That's the data we have and it would be messier to convert it all.)
Here we check that assumption using a Pearson chi-squared dispersion test normalized by monthly VMT.
A dispersion index near 1 supports the Poisson model; values much greater than 1 suggest that either something's awry or the robotaxis are getting better or worse.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Monthly rate (per M mi)</th>
        <th>Overall rate</th>
        <th>Dispersion index</th>
        <th>Assessment</th>
      </tr></thead>
      <tbody>${dispRows.join("")}</tbody>
    </table>`);

  // --- 6. Reporting threshold asymmetry ---
  const rptRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const n = helmerRows.length;
    if (n === 0) continue;
    const zeroMph = helmerRows.filter(r => r.speed === 0).length;
    const stopped = helmerRows.filter(r => r.svMovement === "Stopped").length;
    const propDmgOnly = helmerRows.filter(r =>
      !INJURY_SEVERITIES.has(r.severity)).length;
    rptRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${zeroMph} (${Math.round(100 * zeroMph / n)}%)</td>
      <td>${stopped} (${Math.round(100 * stopped / n)}%)</td>
      <td>${propDmgOnly} (${Math.round(100 * propDmgOnly / n)}%)</td>
      <td>${n}</td>
    </tr>`);
  }
  sections.push(`
<h3>Reporting threshold disparities</h3>
<p>
It's possible that, as a totally arbitrary example, Waymo is more fastidious in what it reports to NHTSA.
Certainly all these companies are reporting more incidents than human drivers do.
A high fraction of 0-mph incidents suggests a company reports more minor events
This inflates the company's raw incident count relative to others and relative to the human baseline.
The "nonstationary" MPI metric filters these out.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Speed = 0 mph</th>
        <th>AV stopped</th>
        <th>Property damage only</th>
        <th>Total</th>
      </tr></thead>
      <tbody>${rptRows.join("")}</tbody>
    </table>`);

  // --- 7. Geographic scope ---
  const geoByHelmer = {};
  for (const helmer of ADS_HELMERS) {
    const helmerRows = rows.filter(r => r.helmer === helmer);
    const cities = {};
    for (const r of helmerRows) {
      const loc = r.city && r.state ? (r.city + ", " + r.state) : "Unknown";
      cities[loc] = (cities[loc] || 0) + 1;
    }
    const sorted = Object.entries(cities).sort((a, b) => b[1] - a[1]);
    geoByHelmer[helmer] = sorted;
  }
  const geoRows = [];
  for (const helmer of ADS_HELMERS) {
    const locs = geoByHelmer[helmer];
    if (locs.length === 0) continue;
    const cityList = locs.map(([loc, cnt]) =>
      `${escHtml(loc)}\u00a0(${cnt})`).join(", ");
    geoRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${locs.length}</td>
      <td>${cityList}</td>
    </tr>`);
  }
  sections.push(`
<h3>Geography</h3>
<p>
Human crash rates vary by city, presumably.
Maybe that affects AVs too?
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th># cities</th>
        <th>Cities (incident count)</th>
      </tr></thead>
      <tbody>${geoRows.join("")}</tbody>
    </table>`);

  // --- 8. VMT sources ---
  const vmtSrcRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer);
    if (helmerVmt.length === 0) continue;
    // Use the rationale from the first row (they're all the same per helmer)
    const rationales = [...new Set(helmerVmt.map(r => r.rationale).filter(Boolean))];
    const ratStr = rationales.map(r => escHtml(r)).join("<br>");
    vmtSrcRows.push(`<tr>
      <td>${escHtml(helmer)}</td>
      <td>${ratStr}</td>
    </tr>`);
  }
  sections.push(`
<h3>VMT sources</h3>
<p>
Where the Vehicle Miles Traveled (VMT) estimates come from for each company.
These are the denominators in every miles per incident (MPI) calculation, so any errors here matter a lot.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Source and methodology</th>
      </tr></thead>
      <tbody>${vmtSrcRows.join("")}</tbody>
    </table>`);

  // --- 9. Incident coverage for partial months ---
  const icRows = [];
  for (const helmer of ADS_HELMERS) {
    const helmerVmt = vmt.filter(r => r.helmer === helmer);
    const partial = helmerVmt.filter(r => r.incCov < 1);
    if (partial.length === 0) {
      icRows.push(`<tr>
        <td>${escHtml(helmer)}</td>
        <td colspan="4">All months have full incident coverage</td>
      </tr>`);
      continue;
    }
    for (const row of partial) {
      icRows.push(`<tr>
        <td>${escHtml(helmer)}</td>
        <td>${escHtml(row.month)}</td>
        <td>${(row.incCov * 100).toFixed(1)}%</td>
        <td>${(row.incCovMin * 100).toFixed(1)}%\u2013${(row.incCovMax * 100).toFixed(1)}%</td>
        <td>${(row.coverage * 100).toFixed(1)}%</td>
      </tr>`);
    }
  }
  sections.push(`
<h3>Incident coverage for partial months</h3>
<p>
"Calendar coverage" is the fraction of the month in the window (e.g., 15/31 &approx; 48%).
"Incident coverage" estimates what fraction of incidents from that period have actually been reported.
Claude notes: 
NHTSA has two reporting tracks: "5-Day" (filed within 5 days of becoming aware) and "Monthly" (filed monthly in arrears).
When Monthly reports aren't yet available, the effective VMT is scaled down by the incident coverage factor so the Poisson model accounts for missing reports.
</p>
    <table>
      <thead><tr>
        <th>Company</th>
        <th>Month</th>
        <th>Incident coverage (best)</th>
        <th>Range</th>
        <th>Calendar coverage</th>
      </tr></thead>
      <tbody>${icRows.join("")}</tbody>
    </table>`);

  // --- 10. Human benchmark derivations ---
  sections.push(renderHumanBenchmarkTable());

  // --- 11. Skeptical stress test of conclusions ---
  sections.push(renderStressTestTable(series));

  byId("sanity-checks").innerHTML = sections.join("");
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

// --- Prediction markets (Polymarket + Manifold) ---

let predmarketsAgeTimer = null;

function polymarketUrl(slug) {
  return "https://polymarket.com/event/" + slug;
}

function oddsClass(p) {
  return p >= 0.6 ? "high" : p >= 0.3 ? "mid" : "low";
}

function fmtPct(p) { return Math.round(p * 100) + "%"; }

function fmtVol(v) {
  return v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M"
       : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K"
       :            "$" + Math.round(v);
}

// Format elapsed time as compact string like "2d5h3m" or "<1m".
// cls: fresh (<1h), stale (1h-7d), rotten (>7d).
function fmtAge(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return {text: "<1m", cls: "fresh"};
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (!d || m) parts.push(m + "m"); // skip minutes when showing days+hours
  const text = parts.join("");
  const cls = mins < 60 ? "fresh" : d <= 7 ? "stale" : "rotten";
  return {text, cls};
}

function yesProbability(market) {
  const prices = JSON.parse(market.outcomePrices || "[]");
  const outcomes = JSON.parse(market.outcomes || "[]");
  let idx = outcomes.indexOf("Yes");
  if (idx < 0) idx = 0;
  return parseFloat(prices[idx]) || 0;
}

// Manifold volume is play-money mana (Ṁ), not USD
function fmtMana(v) {
  return "Ṁ" + (v >= 1e6 ? (v / 1e6).toFixed(1) + "M"
       : v >= 1e3 ? Math.round(v / 1e3) + "K"
       :            String(Math.round(v)));
}

function renderMarketCard(question, url, prob, volText) {
  const card = document.createElement("div");
  card.className = "pm-card";
  card.innerHTML =
    `<span class="pm-card-question"><a href="${url}" ` +
    `target="_blank" rel="noopener">${question}</a></span>` +
    `<span class="pm-card-odds ${oddsClass(prob)}">${fmtPct(prob)}</span>` +
    `<span class="pm-card-vol">${volText}</span>`;
  return card;
}

function renderPolymarketCard(market, eventSlug) {
  return renderMarketCard(market.question, polymarketUrl(eventSlug),
    yesProbability(market), fmtVol(parseFloat(market.volume) || 0));
}

function renderPredmarketsPanel(config, manifold, isoDate) {
  const panel = byId("predmarket-panel");
  const grid = document.createElement("div");
  grid.className = "predmarket-grid";

  for (const ev of config) {
    if (ev.enabled === false) continue; // skip disabled events
    const markets = ev.markets || [];
    if (!markets.length) continue;

    if (ev.multi && markets.length > 1) {
      const header = document.createElement("div");
      header.className = "pm-card";
      const totalVol = parseFloat(ev.volume) || 0;
      header.innerHTML =
        `<span class="pm-card-question"><a href="${polymarketUrl(ev.slug)}" ` +
        `target="_blank" rel="noopener"><b>${ev.title}</b></a></span>` +
        `<span class="pm-card-vol">${fmtVol(totalVol)}</span>`;
      grid.appendChild(header);

      const sorted = markets.slice().sort((a, b) =>
        yesProbability(b) - yesProbability(a));
      for (const m of sorted) {
        const card = renderPolymarketCard(m, ev.slug);
        card.classList.add("pm-subcard");
        grid.appendChild(card);
      }
    } else {
      grid.appendChild(renderPolymarketCard(markets[0], ev.slug));
    }
  }

  for (const m of manifold) {
    if (m.enabled === false) continue; // skip disabled markets
    grid.appendChild(renderMarketCard(m.question, m.url, m.probability, fmtMana(m.volume)));
  }

  panel.textContent = "";
  panel.appendChild(grid);

  const footer = document.createElement("div");
  footer.className = "pm-footer";

  const dot = document.createElement("span");
  dot.className = "pm-dot";
  const ageSpan = document.createElement("span");
  ageSpan.className = "pm-age";
  function tickAge() {
    const {text, cls} = fmtAge(isoDate);
    ageSpan.textContent = text;
    dot.className = "pm-dot " + cls;
  }
  tickAge();
  if (predmarketsAgeTimer) clearInterval(predmarketsAgeTimer);
  predmarketsAgeTimer = setInterval(tickAge, 60000);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "pm-refresh";
  refreshBtn.title = "Refetch prediction market data";
  refreshBtn.textContent = "\u21bb";
  refreshBtn.addEventListener("click", refreshPredmarkets);

  const srcLink = document.createElement("a");
  srcLink.href = "https://polymarket.com";
  srcLink.target = "_blank";
  srcLink.rel = "noopener";
  srcLink.textContent = "Polymarket";

  footer.append(dot, ageSpan, /* srcLink, */ refreshBtn);
  panel.appendChild(footer);
}

// Fetch fresh data for a single slug, returning the event object with the
// same shape as our snapshot entries. (gamma-api serves
// access-control-allow-origin: * as of 2026-06, so no CORS proxy is needed;
// the third-party proxy this used to go through is dead.)
async function fetchPolymarketEvent(slug, templateEntry) {
  const apiUrl = "https://gamma-api.polymarket.com/events?slug=" +
    encodeURIComponent(slug);
  const resp = await fetch(apiUrl);
  assert(resp.ok, "Polymarket API request failed", {status: resp.status, slug});
  const events = await resp.json();
  assert(events.length > 0, "No events returned for slug", {slug});
  const ev = events[0];
  // Only keep sub-markets that are in the curated snapshot.
  const kept = new Set(templateEntry.markets.map(m => m.question));
  const freshMarkets = (ev.markets || [])
    .filter(m => kept.has(m.question))
    .map(m => ({
      question: m.question,
      outcomes: m.outcomes,
      outcomePrices: m.outcomePrices,
      volume: m.volume || "0",
    }));
  return {
    title: ev.title,
    slug: ev.slug,
    enabled: templateEntry.enabled,
    multi: templateEntry.multi || false,
    volume: ev.volume || 0,
    markets: freshMarkets,
  };
}

// Fetch fresh data for a single Manifold market (binary only).
async function fetchManifoldMarket(templateEntry) {
  const resp = await fetch("https://api.manifold.markets/v0/slug/" +
    encodeURIComponent(templateEntry.slug));
  assert(resp.ok, "Manifold API request failed",
    {status: resp.status, slug: templateEntry.slug});
  const m = await resp.json();
  assert(m.outcomeType === "BINARY", "Manifold market must be binary",
    {slug: templateEntry.slug, outcomeType: m.outcomeType});
  return {
    question: m.question,
    slug: templateEntry.slug,
    url: m.url,
    enabled: templateEntry.enabled,
    probability: m.probability,
    volume: m.volume || 0,
  };
}

async function refreshPredmarkets() {
  const panel = byId("predmarket-panel");
  const btn = panel.querySelector(".pm-refresh");
  if (btn) { btn.disabled = true; btn.textContent = "\u231b"; }

  let failures = 0;
  const fetchOrKeep = async (entry, fetcher) => {
    try {
      return await fetcher(entry);
    } catch (err) {
      failures++;
      console.error("prediction market refresh failed", entry.slug, err);
      return entry; // keep snapshot data for this one
    }
  };
  const fresh = [];
  for (const entry of POLYMARKET_SNAPSHOT.filter(e => e.enabled !== false)) {
    fresh.push(await fetchOrKeep(entry, e => fetchPolymarketEvent(e.slug, e)));
  }
  const freshManifold = [];
  for (const entry of MANIFOLD_SNAPSHOT.filter(e => e.enabled !== false)) {
    freshManifold.push(await fetchOrKeep(entry, fetchManifoldMarket));
  }
  // The age label advances only when every market refreshed; any failure
  // keeps the snapshot date so the staleness dot stays honest.
  const dateLabel = failures === 0
    ? new Date().toISOString()
    : PREDMARKET_SNAPSHOT_DATE;
  renderPredmarketsPanel(fresh, freshManifold, dateLabel);
}

function loadPredmarketData() {
  assert(Array.isArray(POLYMARKET_SNAPSHOT), "POLYMARKET_SNAPSHOT must be an array");
  assert(Array.isArray(MANIFOLD_SNAPSHOT), "MANIFOLD_SNAPSHOT must be an array");
  assert(typeof PREDMARKET_SNAPSHOT_DATE === "string",
    "PREDMARKET_SNAPSHOT_DATE must be a string");
  renderPredmarketsPanel(POLYMARKET_SNAPSHOT, MANIFOLD_SNAPSHOT, PREDMARKET_SNAPSHOT_DATE);
  // Snapshot renders instantly; live prices replace it without a click.
  void refreshPredmarkets();
}

// --- Init ---

{
  const incidentData = INCIDENT_DATA;
  assert(Array.isArray(incidentData), "INCIDENT_DATA must be an array");
  assert(incidentData.length > 0, "INCIDENT_DATA must not be empty");
  const DATE_RE = /^[A-Z]{3}-\d{4}$/;
  for (const inc of incidentData) {
    assert(inc !== null && typeof inc === "object", "incident must be an object");
    assert(typeof inc.helmer === "string", "incident missing helmer");
    assert(ADS_HELMERS.includes(inc.helmer),
      "inline incident data has unknown helmer", {helmer: inc.helmer});
    assert(typeof inc.reportId === "string" && inc.reportId.length > 0,
      "incident missing reportId", {helmer: inc.helmer});
    assert(typeof inc.date === "string" && DATE_RE.test(inc.date),
      "incident date must match MMM-YYYY format", {reportId: inc.reportId, date: inc.date});
    assert(inc.speed === null || (typeof inc.speed === "number" && Number.isFinite(inc.speed) && inc.speed >= 0),
      "incident speed must be null or non-negative number", {reportId: inc.reportId, speed: inc.speed});
    assert(typeof inc.road === "string" && inc.road.length > 0,
      "incident missing road type", {reportId: inc.reportId});
    assert(typeof inc.severity === "string" && inc.severity.length > 0,
      "incident missing severity", {reportId: inc.reportId});
    assert(inc.fault === null || typeof inc.fault === "object",
      "incident fault must be null or object", {reportId: inc.reportId});
    assert(typeof inc.vehiclesInvolved === "number" && inc.vehiclesInvolved >= 1,
      "incident vehiclesInvolved must be >= 1", {reportId: inc.reportId});
    assert(typeof inc.svHit === "string",
      "incident missing svHit", {reportId: inc.reportId});
    assert(typeof inc.cpHit === "string",
      "incident missing cpHit", {reportId: inc.reportId});
    if (inc.fault !== null) {
      const f = inc.fault.faultfrac;
      assert(typeof f === "number" && f >= 0 && f <= 1,
        "incident fault.faultfrac must be a number in [0, 1]",
        {reportId: inc.reportId, value: f});
      assert(typeof inc.fault.reasoning === "string",
        "incident fault.reasoning must be a string", {reportId: inc.reportId});
    }
  }
  incidents = incidentData;
  vmtRows = parseVmtCsv(VMT_CSV_TEXT);
  faultData = buildFaultDataFromIncidents(incidentData);
  loadUiStateFromLocation();
  buildMonthlyViews();
  const modifiedPart = NHTSA_MODIFIED_DATE
    ? ` NHTSA data last modified ${NHTSA_MODIFIED_DATE}`
    : "";
  byId("colophon").textContent =
    `Incident data fetched from NHTSA on ${NHTSA_FETCH_DATE}.${modifiedPart}`;
  initTooltips();
  initCollapsibles();
  loadPredmarketData();
}

const PREDMARKET_SNAPSHOT_DATE = "2026-06-19T17:57:40Z";
// [SNAPSHOT VINTAGE] This checked-in snapshot is frozen at the date above and
// applies to both POLYMARKET_SNAPSHOT and MANIFOLD_SNAPSHOT; the page renders
// it instantly, then auto-refetches live prices on load (and via the refresh
// button; never persisted). To update the snapshot: for each Polymarket slug
// fetch
//   https://gamma-api.polymarket.com/events?slug=<slug>
// and refresh outcomePrices/volume; for each Manifold slug fetch
//   https://api.manifold.markets/v0/slug/<slug>
// and refresh probability/volume (mana). Bump PREDMARKET_SNAPSHOT_DATE. Drop
// or disable (enabled: false) any market that has resolved.
// To show/hide a market, set enabled to true/false.
// A multi-outcome market renders as a header card plus one subcard per outcome:
// a Polymarket event with several curated sub-markets, or a Manifold market with
// an `answers` list (non-binary outcomeType, e.g. the "what year" DATE markets).
// Single-outcome markets render as one inline card. Multi-ness is derived from
// the outcome count, so there is no separate flag.
const POLYMARKET_SNAPSHOT = [
  {
    "title": "Musk out as Tesla CEO before 2027?",
    "slug": "musk-out-as-tesla-ceo-before-2027",
    "enabled": true,
    "volume": 16527.522495000005,
    "markets": [
      {
        "question": "Musk out as Tesla CEO before 2027?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.052\", \"0.948\"]",
        "volume": "16527.522495000005"
      }
    ]
  }
];

const MANIFOLD_SNAPSHOT = [
  {
    "question": "Tesla has more fully autonomous rides than Waymo in 2026?",
    "slug": "tesla-serves-more-fully-autonomous",
    "url": "https://manifold.markets/JamesGrugett/tesla-serves-more-fully-autonomous",
    "enabled": true,
    "probability": 0.10172384739683804,
    "volume": 866095.7675712603
  },
  {
    "question": "Will we conclude Tesla launched level 4 robotaxis in summer 2025?",
    "slug": "will-tesla-count-as-a-waymo-competi",
    "url": "https://manifold.markets/dreev/will-tesla-count-as-a-waymo-competi",
    "enabled": true,
    "probability": 0.15677045326069744,
    "volume": 70128.2640814766
  },
  {
    "question": "Tesla Robotaxi Service at-fault accident or non-fully-autonomous by 2026?",
    "slug": "tesla-robotaxi-service-atfault-acci",
    "url": "https://manifold.markets/AffineTyped/tesla-robotaxi-service-atfault-acci",
    "enabled": true,
    "probability": 0.9373223446552837,
    "volume": 484.17647454312794
  },
  {
    "question": "Waymo in Portland in 2026?",
    "slug": "waymo-in-portland-in-2026",
    "url": "https://manifold.markets/dreev/waymo-in-portland-in-2026",
    "enabled": true,
    "probability": 0.4894381393385762,
    "volume": 313
  },
  {
    "question": "Will Tesla have more autonomous vehicles providing ridehailing than  Waymo on Jan 2nd 2027",
    "slug": "will-tesla-have-more-autonomous-veh",
    "url": "https://manifold.markets/NathanpmYoung/will-tesla-have-more-autonomous-veh",
    "enabled": true,
    "probability": 0.23,
    "volume": 25280.820797455206
  },
  {
    "question": "Waymo reaches 2 billion miles with three or fewer at-fault fatalities?",
    "slug": "waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "url": "https://manifold.markets/DavidFWatson/waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "enabled": true,
    "probability": 0.7487979840392234,
    "volume": 5394.034232083005
  },
  {
    "question": "When will I first be able to read a book while driving a private car?",
    "slug": "when-will-i-be-able-to-read-a-book",
    "url": "https://manifold.markets/dreev/when-will-i-be-able-to-read-a-book",
    "enabled": true,
    "answers": [
      {"label": "2025", "prob": 0.01},
      {"label": "2026", "prob": 0.08229182510629546},
      {"label": "2027", "prob": 0.3811519443609275},
      {"label": "2028", "prob": 0.22235869928305887},
      {"label": "2029", "prob": 0.10629840373983164},
      {"label": "2030", "prob": 0.06836151520747683},
      {"label": "2031+", "prob": 0.12953761230241007}
    ],
    "volume": 5009.3400361697
  },
  {
    "question": "When will vision-only level 4 self-driving be widely deployed?",
    "slug": "when-will-visiononly-level-4-selfdr",
    "url": "https://manifold.markets/dreev/when-will-visiononly-level-4-selfdr",
    "enabled": true,
    "answers": [
      {"label": "Before 2027", "prob": 0.3},
      {"label": "Before 2028", "prob": 0.4964280121983124},
      {"label": "Before 2029", "prob": 0.5544804119168469},
      {"label": "Before 2030", "prob": 0.6209824135839903},
      {"label": "Before 2031", "prob": 0.6600000000000001},
      {"label": "Before 2032", "prob": 0.71},
      {"label": "Before 2033", "prob": 0.7479227228125743}
    ],
    "volume": 873.2762361715597
  },
  {
    "question": "Will Comma.ai let me read a book while driving before Tesla does?",
    "slug": "will-commaai-let-me-read-a-book-whi",
    "url": "https://manifold.markets/dreev/will-commaai-let-me-read-a-book-whi",
    "enabled": true,
    "probability": 0.09485589226806404,
    "volume": 1061.2764766229511
  },
  {
    "question": "Will fully autonomous (level 5) self-driving cars be available in a major US city before 2030?",
    "slug": "will-fully-autonomous-level-5-selfd",
    "url": "https://manifold.markets/dreev/will-fully-autonomous-level-5-selfd",
    "enabled": true,
    "probability": 0.7843131967585396,
    "volume": 22815.161394955863
  },
  {
    "question": "Millions of Teslas at level 3 autonomy in 2026?",
    "slug": "millions-of-teslas-at-level-3-auton",
    "url": "https://manifold.markets/dreev/millions-of-teslas-at-level-3-auton",
    "enabled": true,
    "probability": 0.04306361388812842,
    "volume": 859.5981875390044
  },
  {
    "question": "Musk v Mosk: Is Tesla an Enron-style fraud?",
    "slug": "musk-v-mosk-is-tesla-an-enronstyle",
    "url": "https://manifold.markets/dreev/musk-v-mosk-is-tesla-an-enronstyle",
    "enabled": true,
    "probability": 0.040985675810674416,
    "volume": 7361.859393137889
  }
];

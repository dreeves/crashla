const PREDMARKET_SNAPSHOT_DATE = "2026-10-04T01:33:27Z";
// [SNAPSHOT VINTAGE] This checked-in snapshot is frozen at the date above and
// applies to both POLYMARKET_SNAPSHOT and MANIFOLD_SNAPSHOT; the page renders
// it instantly, then auto-refetches live prices on load (and via the refresh
// button; never persisted). To update the snapshot run
//   node data/refresh-predmarkets.mjs
// which refetches every slug's prices, volumes and state in place, bumps
// PREDMARKET_SNAPSHOT_DATE, and warns about any market that has closed,
// resolved, or resolved one of its answers — those are a human call: drop or
// disable (enabled: false) them. The state fields (Manifold closeTime,
// resolution, resolutionProbability; Polymarket closed, endDate,
// umaResolutionStatus) are the API's own, and the page grays a market once
// it has closed or resolved, as it grays odds it has not fetched live.
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
    "volume": 17475.932927,
    "markets": [
      {
        "question": "Musk out as Tesla CEO before 2027?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.032\", \"0.968\"]",
        "volume": "17475.932927",
        "closed": false,
        "endDate": "2027-01-01T04:59:00Z",
        "umaResolutionStatus": null
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
    "closeTime": 1798761540000,
    "probability": 0.048966729404115145,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 1052411.328061702
  },
  {
    "question": "Will we conclude Tesla launched level 4 robotaxis in summer 2025?",
    "slug": "will-tesla-count-as-a-waymo-competi",
    "url": "https://manifold.markets/dreev/will-tesla-count-as-a-waymo-competi",
    "enabled": true,
    "closeTime": 1798765140000,
    "probability": 0.18634589848847202,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 107130.6877395212
  },
  {
    "question": "Waymo in Portland in 2026?",
    "slug": "waymo-in-portland-in-2026",
    "url": "https://manifold.markets/dreev/waymo-in-portland-in-2026",
    "enabled": true,
    "closeTime": 1798761540000,
    "probability": 0.08047072526897368,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 1836.3881585804988
  },
  {
    "question": "Will Tesla have more autonomous vehicles providing ridehailing than  Waymo on Jan 2nd 2027",
    "slug": "will-tesla-have-more-autonomous-veh",
    "url": "https://manifold.markets/NathanpmYoung/will-tesla-have-more-autonomous-veh",
    "enabled": true,
    "closeTime": 1798934340000,
    "probability": 0.06363940836486504,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 82317.31731669077
  },
  {
    "question": "Waymo reaches 2 billion miles with three or fewer at-fault fatalities?",
    "slug": "waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "url": "https://manifold.markets/DavidFWatson/waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "enabled": true,
    "closeTime": 2209082880000,
    "probability": 0.7593748521673012,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 5444.034232083005
  },
  {
    "question": "When will I first be able to read a book while driving a private car?",
    "slug": "when-will-i-be-able-to-read-a-book",
    "url": "https://manifold.markets/dreev/when-will-i-be-able-to-read-a-book",
    "enabled": true,
    "closeTime": 1924991940000,
    "answers": [
      {"label": "2025", "prob": 0.010524071049773067, "resolution": null, "resolutionProbability": null},
      {"label": "2026", "prob": 0.04143381484311694, "resolution": null, "resolutionProbability": null},
      {"label": "2027", "prob": 0.3058098427631404, "resolution": null, "resolutionProbability": null},
      {"label": "2028", "prob": 0.26255161763161655, "resolution": null, "resolutionProbability": null},
      {"label": "2029", "prob": 0.15143394184694206, "resolution": null, "resolutionProbability": null},
      {"label": "2030", "prob": 0.07733247226225429, "resolution": null, "resolutionProbability": null},
      {"label": "2031+", "prob": 0.15091423960315684, "resolution": null, "resolutionProbability": null}
    ],
    "volume": 5480.046718376078
  },
  {
    "question": "When will vision-only level 4 self-driving be widely deployed?",
    "slug": "when-will-visiononly-level-4-selfdr",
    "url": "https://manifold.markets/dreev/when-will-visiononly-level-4-selfdr",
    "enabled": true,
    "closeTime": 2019715140000,
    "answers": [
      {"label": "Before 2027", "prob": 0.05069072543373908, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2028", "prob": 0.4964280121983124, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2029", "prob": 0.5544804119168469, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2030", "prob": 0.6209824135839903, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2031", "prob": 0.6752768082683342, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2032", "prob": 0.7590099254021008, "resolution": null, "resolutionProbability": null},
      {"label": "Before 2033", "prob": 0.7762332890078101, "resolution": null, "resolutionProbability": null}
    ],
    "volume": 1386.3045209212826
  },
  {
    "question": "Will Comma.ai let me read a book while driving before Tesla does?",
    "slug": "will-commaai-let-me-read-a-book-whi",
    "url": "https://manifold.markets/dreev/will-commaai-let-me-read-a-book-whi",
    "enabled": true,
    "closeTime": 4102473540000,
    "probability": 0.05995050683992138,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 1811.2764766229511
  },
  {
    "question": "Will fully autonomous (level 5) self-driving cars be available in a major US city before 2030?",
    "slug": "will-fully-autonomous-level-5-selfd",
    "url": "https://manifold.markets/dreev/will-fully-autonomous-level-5-selfd",
    "enabled": true,
    "closeTime": 1893484740000,
    "probability": 0.7888284388818848,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 23740.48970350034
  },
  {
    "question": "Millions of Teslas at level 3 autonomy in 2026?",
    "slug": "millions-of-teslas-at-level-3-auton",
    "url": "https://manifold.markets/dreev/millions-of-teslas-at-level-3-auton",
    "enabled": true,
    "closeTime": 1798761540000,
    "probability": 0.03914565525152744,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 903.5592713775942
  },
  {
    "question": "Musk v Mosk: Is Tesla an Enron-style fraud?",
    "slug": "musk-v-mosk-is-tesla-an-enronstyle",
    "url": "https://manifold.markets/dreev/musk-v-mosk-is-tesla-an-enronstyle",
    "enabled": true,
    "closeTime": 1798790340000,
    "probability": 0.040985675810674416,
    "resolution": null,
    "resolutionProbability": null,
    "volume": 7361.859393137889
  }
];

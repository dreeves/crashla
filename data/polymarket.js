const POLYMARKET_SNAPSHOT_DATE = "2026-06-12T21:56:36Z";
// [SNAPSHOT VINTAGE] This checked-in snapshot is frozen at the date above and
// applies to both POLYMARKET_SNAPSHOT and MANIFOLD_SNAPSHOT; the page renders
// it instantly, then auto-refetches live prices on load (and via the refresh
// button; never persisted). To update the snapshot: for each Polymarket slug
// fetch
//   https://gamma-api.polymarket.com/events?slug=<slug>
// and refresh outcomePrices/volume; for each Manifold slug fetch
//   https://api.manifold.markets/v0/slug/<slug>
// and refresh probability/volume (mana). Bump POLYMARKET_SNAPSHOT_DATE. Drop
// or disable (enabled: false) any market that has resolved.
// To show/hide a market, set enabled to true/false.
// To expand a multi-outcome Polymarket event into subcards, set multi to true.
const POLYMARKET_SNAPSHOT = [
  {
    "title": "Will Tesla launch robotaxis in California by June 30?",
    "slug": "will-tesla-launch-robotaxis-in-california-by-june-30",
    "enabled": true,
    "volume": 108395.19204699983,
    "markets": [
      {
        "question": "Will Tesla launch robotaxis in California by June 30?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.045\", \"0.955\"]",
        "volume": "108395.19204699983"
      }
    ]
  },
  {
    "title": "How many cities will Waymo operate in by June 30?",
    "slug": "how-many-cities-will-waymo-operate-in-by-june-30-2026",
    "enabled": true,
    "multi": true,
    "volume": 178267.02851499995,
    "markets": [
      {
        "question": "Will Waymo operate in 12 or more cities on June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0105\", \"0.9895\"]",
        "volume": "24815.414324999965"
      }
    ]
  },
  {
    "title": "Which cities will Waymo launch in by June 30?",
    "slug": "which-cities-will-waymo-launch-in-by-june-30",
    "enabled": true,
    "multi": true,
    "volume": 250022.05945600063,
    "markets": [
      {
        "question": "Will Waymo launch in New York City by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0335\", \"0.9665\"]",
        "volume": "15846.251386999998"
      },
      {
        "question": "Will Waymo launch in Detroit by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0135\", \"0.9865\"]",
        "volume": "17979.52068800001"
      },
      {
        "question": "Will Waymo launch in Washington DC by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.018\", \"0.982\"]",
        "volume": "13194.729532999996"
      },
      {
        "question": "Will Waymo launch in Denver by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.059\", \"0.941\"]",
        "volume": "10710.738303999999"
      },
      {
        "question": "Will Waymo launch in London by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0115\", \"0.9885\"]",
        "volume": "8127.995862"
      }
    ]
  },
  {
    "title": "Musk out as Tesla CEO before 2027?",
    "slug": "musk-out-as-tesla-ceo-before-2027",
    "enabled": true,
    "volume": 16494.982495000007,
    "markets": [
      {
        "question": "Musk out as Tesla CEO before 2027?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.073\", \"0.927\"]",
        "volume": "16494.982495000007"
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
    "probability": 0.09174082846015205,
    "volume": 863571.0268458511
  },
  {
    "question": "Will we conclude Tesla launched level 4 robotaxis in summer 2025?",
    "slug": "will-tesla-count-as-a-waymo-competi",
    "url": "https://manifold.markets/dreev/will-tesla-count-as-a-waymo-competi",
    "enabled": true,
    "probability": 0.16211045403794877,
    "volume": 70078.2640814766
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
    "question": "Will a Waymo self-driving car be involved in a fatal accident before July 1, 2026?",
    "slug": "will-a-waymo-selfdriving-car-be-inv",
    "url": "https://manifold.markets/JaimeM/will-a-waymo-selfdriving-car-be-inv",
    "enabled": true,
    "probability": 0.14782785142383092,
    "volume": 506.916709702358
  },
  {
    "question": "Waymo in Portland in 2026?",
    "slug": "waymo-in-portland-in-2026",
    "url": "https://manifold.markets/dreev/waymo-in-portland-in-2026",
    "enabled": true,
    "probability": 0.7,
    "volume": 0
  }
];

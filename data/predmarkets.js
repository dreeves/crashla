const PREDMARKET_SNAPSHOT_DATE = "2026-06-16T22:37:02Z";
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
// To expand a multi-outcome Polymarket event into subcards, set multi to true.
const POLYMARKET_SNAPSHOT = [
  {
    "title": "Musk out as Tesla CEO before 2027?",
    "slug": "musk-out-as-tesla-ceo-before-2027",
    "enabled": true,
    "volume": 16520.742495000006,
    "markets": [
      {
        "question": "Musk out as Tesla CEO before 2027?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0685\", \"0.9315\"]",
        "volume": "16520.742495000006"
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
    "probability": 0.10359197424672076,
    "volume": 865795.7675712603
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
    "probability": 0.7014941269836819,
    "volume": 5
  },
  {
    "question": "Will Tesla have more autonomous vehicles providing ridehailing than  Waymo on Jan 2nd 2027",
    "slug": "will-tesla-have-more-autonomous-veh",
    "url": "https://manifold.markets/NathanpmYoung/will-tesla-have-more-autonomous-veh",
    "enabled": true,
    "probability": 0.2951399892851505,
    "volume": 23948.233113713675
  },
  {
    "question": "Waymo reaches 2 billion miles with three or fewer at-fault fatalities?",
    "slug": "waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "url": "https://manifold.markets/DavidFWatson/waymo-reaches-2-billion-miles-with-y2yyN2C5Pz",
    "enabled": true,
    "probability": 0.7487979840392234,
    "volume": 5394.034232083005
  }
];

const POLYMARKET_SNAPSHOT_DATE = "2026-04-04T12:00:00Z";
// [SNAPSHOT VINTAGE] This checked-in snapshot is frozen at the date above;
// the page's age dot shows it as stale and the user-facing refresh button
// refetches live prices at runtime (not persisted). To update the snapshot:
// for each slug below, fetch
//   https://gamma-api.polymarket.com/events?slug=<slug>
// and refresh outcomePrices/volume (and POLYMARKET_SNAPSHOT_DATE). Drop or
// disable (enabled: false) any market whose resolution date has passed.
// To show/hide a market, set enabled to true/false.
// To expand a multi-outcome event into subcards, set multi to true.
const POLYMARKET_SNAPSHOT = [
  {
    "title": "Will Tesla launch robotaxis in California by June 30?",
    "slug": "will-tesla-launch-robotaxis-in-california-by-june-30",
    "enabled": true,
    "volume": 78583.92187199993,
    "markets": [
      {
        "question": "Will Tesla launch robotaxis in California by June 30?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.125\", \"0.875\"]",
        "volume": "78583.92187199993"
      }
    ]
  },
  {
    "title": "How many cities will Waymo operate in by June 30?",
    "slug": "how-many-cities-will-waymo-operate-in-by-june-30-2026",
    "enabled": true,
    "multi": true,
    "volume": 133155.64023499997,
    "markets": [
      {
        "question": "Will Waymo operate in 12 or more cities on June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.485\", \"0.515\"]",
        "volume": "19170.11731099997"
      }
    ]
  },
  {
    "title": "Which cities will Waymo launch in by June 30?",
    "slug": "which-cities-will-waymo-launch-in-by-june-30",
    "enabled": true,
    "multi": true,
    "volume": 188224.30280000006,
    "markets": [
      {
        "question": "Will Waymo launch in New York City by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.07\", \"0.93\"]",
        "volume": "10320.532629999996"
      },
      {
        "question": "Will Waymo launch in Detroit by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.2215\", \"0.7785\"]",
        "volume": "0"
      },
      {
        "question": "Will Waymo launch in Washington DC by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.0775\", \"0.9225\"]",
        "volume": "11317.212601"
      },
      {
        "question": "Will Waymo launch in Denver by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.225\", \"0.775\"]",
        "volume": "10150.179654999998"
      },
      {
        "question": "Will Waymo launch in London by June 30 2026?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.2165\", \"0.7835\"]",
        "volume": "5150.073199"
      }
    ]
  },
  {
    "title": "Musk out as Tesla CEO before 2027?",
    "slug": "musk-out-as-tesla-ceo-before-2027",
    "enabled": true,
    "volume": 6023.679712,
    "markets": [
      {
        "question": "Musk out as Tesla CEO before 2027?",
        "outcomes": "[\"Yes\", \"No\"]",
        "outcomePrices": "[\"0.115\", \"0.885\"]",
        "volume": "6023.679712"
      }
    ]
  }
];

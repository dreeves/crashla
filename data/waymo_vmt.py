"""Reproduce Waymo's July 2024–March 2026 VMT rows; print JSON, edit nothing.

California is measured (waymo-ca.csv, with ZIP/member provenance in
waymo-ca-sources.json). The residual is the anchored US increment less those
California miles: other states plus miles outside CPUC's California scope.
Only that residual needs monthly allocation. See data/README.md, Waymo monthly
allocation, for calibration, source precision, and the retained anchor centrals.
"""
import bisect
import calendar
import csv
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Month, cumulative central, low, high. The 150,000-mile pre-series offset
# remains the same fixed convention at every knot and cancels in differences.
# Historical rounding envelopes contain the reviewed central as well as the
# more precise source: CSV1 +/-2,000 plus <=5,500 missing Mountain View miles;
# Jan-2025 paper +/-500 plus <=9,250 Mountain View/Atlanta miles. Later knots
# retain their existing explicit unbenchmarked-city allowances.
KNOTS = [
    ("2024-06", 21850000, 21850000, 22056500),
    ("2024-07", 24850000, 24850000, 25165500),
    # An additional measured knot, not a replacement of a reviewed anchor:
    # CSV1's four depots sum to 33.103M through September 2024.
    ("2024-09", 32953000, 32951000, 32960500),
    # Keep the original rounded 50M milestone in the envelope too: the central
    # carries a one-mile ledger rounding residue.
    ("2024-12", 49850001, 49850000, 49940500),
    ("2025-01", 56550001, 56549500, 56559750),
    ("2025-03", 71470000, 71470000, 71470000),
    ("2025-06", 96515000, 96215000, 97115000),
    ("2025-09", 129008000, 128308000, 130108000),
    ("2025-12", 174262000, 173562000, 175162000),
    ("2026-03", 222463000, 221663000, 223763000),
    # Context for the final interval's slope; Q2's authored rows stay intact.
    ("2026-06", 277829761, 275179379, 281379379),
]
ALLOC = 0.20  # Three-month residual log half-width; proxy calibration, not US truth.
# TODO: Explain the refined June cumulative boundary while retaining its
# existing monthly central and the same 150,000-mile pre-series convention.
BOUNDARY_NOTE = ("Summa centralis Iunii 2024 servata; limites cumulati ex "
                 "22.199M milibus passuum publicatis, rotundatione et milibus "
                 "Mountain View omissis, summa centrali priore inclusa. "
                 "Limites mensis cum summis cumulatis conciliati "
                 "(data/README.md, Waymo monthly allocation).")


def month_info(month):
    year, mon = map(int, month.split("-"))
    days = calendar.monthrange(year, mon)[1]
    return days, dt.date(year, mon, 1).toordinal() + days / 2


def linear(x, xs, ys):
    """Linear daily-rate interpolation, constant outside the midpoint range."""
    j = min(max(bisect.bisect_right(xs, x), 1), len(xs) - 1)
    f = min(1, max(0, (x - xs[j-1]) / (xs[j] - xs[j-1])))
    return ys[j-1] * (1-f) + ys[j] * f


def model():
    with (ROOT / "waymo-ca.csv").open() as f:
        source = list(csv.DictReader(f))
    ca = {r["month"]: float(r["total"]) for r in source}
    assert len(ca) == len(source)
    assert all(abs(float(r["deployment"]) + float(r["pilot"]) - float(r["total"])) < 1e-7
               for r in source)
    months = [m for m in sorted(ca) if KNOTS[0][0] < m <= KNOTS[-1][0]]
    assert len(months) == 24 and months[0] == "2024-07" and months[-1] == "2026-06"
    blocks = []
    for before, after in zip(KNOTS, KNOTS[1:]):
        ms = [m for m in months if before[0] < m <= after[0]]
        days = sum(month_info(m)[0] for m in ms)
        observed = sum(ca[m] for m in ms)
        residual = after[1] - before[1] - observed
        low, high = after[2] - before[3] - observed, after[3] - before[2] - observed
        assert 0 < low <= residual <= high, (before, after)
        center = sum(month_info(m)[0] * month_info(m)[1] for m in ms) / days
        blocks.append(dict(before=before, after=after, months=ms, residual=residual,
                           low=low, high=high, center=center, rate=residual/days))
    xs, ys = [b["center"] for b in blocks], [b["rate"] for b in blocks]
    rows = []
    for b in blocks[:-1]:
        ms = b["months"]
        raw = [month_info(m)[0] * linear(month_info(m)[1], xs, ys) for m in ms]
        weights = [w / sum(raw) for w in raw]
        width = ALLOC * math.sqrt((len(ms)-1)/2)
        values = [round(ca[m] + b["residual"] * w) for m, w in zip(ms, weights)]
        # Integer rounding must not move a published cumulative anchor.
        values[-1] += b["after"][1] - b["before"][1] - sum(values)
        for m, w, value in zip(ms, weights, values):
            lo = math.floor(ca[m] + b["low"] * w * math.exp(-width))
            hi = math.ceil(ca[m] + b["high"] * w * math.exp(width))
            assert 0 < lo <= value <= hi, (m, lo, value, hi)
            # TODO: Explain the measured California part, the allocation of the
            # remaining miles between cumulative anchors, and the modeled band.
            rationale = (f"Aestimatio US: California (CPUC) {ca[m]:,.2f} milia passuum mensa; "
                         f"reliqua {value-ca[m]:,.2f} inter {b['before'][0]} et {b['after'][0]} "
                         "ex summis cumulatis distributa, celeritatibus diurnis lineariter "
                         "interpolatis et summa intervalli servata. Incertitudo allocationis "
                         "solis reliquis milibus applicatur; limites mensium et summarum "
                         "inter se cohaerent. Limites sunt aestimationes exemplaris, non "
                         "mensurae probabilitatis US comprobatae (data/README.md, Waymo monthly allocation).")
            rows.append(dict(month=m, vmt=value, vmt_min=lo, vmt_max=hi,
                             measured_ca=ca[m], residual=value-ca[m],
                             anchor_start=b["before"][0], anchor_end=b["after"][0],
                             allocation_log_halfwidth=width, rationale=rationale))

    # Interval arithmetic, not a fitted joint probability distribution: carry
    # monthly ranges forward, then constrain them backward from measured knots.
    # Unpinned cumulative limits start at [0, infinity]. One forward/backward
    # sweep on this chain, then the adjacent difference, reaches closure.
    limits = {r["month"]: (0, math.inf) for r in rows}
    limits.update({m: (lo, hi) for m, _, lo, hi in KNOTS})
    low = [KNOTS[0][2]] + [limits[r["month"]][0] for r in rows]
    high = [KNOTS[0][3]] + [limits[r["month"]][1] for r in rows]
    for j, r in enumerate(rows, 1):
        low[j] = max(low[j], low[j-1] + r["vmt_min"])
        high[j] = min(high[j], high[j-1] + r["vmt_max"])
    for j in range(len(rows), 0, -1):
        r = rows[j-1]
        low[j-1] = max(low[j-1], low[j] - r["vmt_max"])
        high[j-1] = min(high[j-1], high[j] - r["vmt_min"])
    cume = KNOTS[0][1]
    for j, r in enumerate(rows, 1):
        r["vmt_min"] = max(r["vmt_min"], low[j] - high[j-1])
        r["vmt_max"] = min(r["vmt_max"], high[j] - low[j-1])
        cume += r["vmt"]
        r.update(helmer_cumulative_vmt=cume, kyoom_min=low[j], kyoom_max=high[j])
        assert low[j] <= cume <= high[j] and r["vmt_min"] <= r["vmt"] <= r["vmt_max"], r
        assert low[j] >= low[j-1] + r["vmt_min"] and high[j] <= high[j-1] + r["vmt_max"], r
    by_month = {r["month"]: r for r in rows}
    assert (low[0], high[0]) == KNOTS[0][2:]
    for m, best, lo, hi in KNOTS[1:-1]:
        r = by_month[m]
        assert (r["helmer_cumulative_vmt"], r["kyoom_min"], r["kyoom_max"]) == (best, lo, hi), r
    return rows


if __name__ == "__main__":
    print(json.dumps(model(), indent=2, ensure_ascii=False))

"""Reproduce Waymo's July 2021–March 2026 VMT rows; print JSON, edit nothing.

California is measured (waymo-ca.csv, with ZIP/member provenance in
waymo-ca-sources.json; it starts December 2022). The residual is the anchored
US increment less those California miles: other states plus miles outside
CPUC's California scope. Only that residual needs monthly allocation. See
data/README.md, Waymo monthly allocation, for calibration, source precision
and the knots, and Waymo anchors for the pre-series offset.
"""
import bisect
import calendar
import csv
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# The series starts in July 2021 (NHTSA's SGO reporting floor), so every
# lifetime figure Waymo publishes includes the rider-only miles driven before
# it: the pre-series offset, central 150,000 (the series' convention since
# 2026-07-01), range 150,000-260,000 since 2026-10-31 (decision #49b, on
# Waymo's own figures). Kusano et al. 2025, Table 2 (arXiv 2505.01515, pp.
# 10-11) puts 94,400 rider-only miles in 2019-2020 and 328,000 in 2021;
# Schwall et al. 2020 (arXiv 2011.00038) puts 65,000 in Jan 2019-Sep 2020, so
# Q4 2020 ran about 29,400 (320 a day). January-June 2021 then held between
# that daily rate (57,800 miles) and half of 2021 (164,000, a year without a
# decline): 152,200-258,400 in all, rounded outward.
OFFSET = (150000, 150000, 260000)  # central, low, high
# Lifetime knots on Waymo's published figures: month, central, low, high, the
# value at the month's end. The first is the series start, whose lifetime
# value is the offset; every series value is the lifetime value less the
# offset (central less central; low less the offset's high; high less its low).
# Bounds hold the figure's displayed precision and explicitly missing miles:
# Table 2 rounds each city-year to three significant figures; each 2024 CSV1
# total sums four values rounded to 1,000 miles (+/-2,000) and omits at most
# 5,500 Mountain View miles; the Jan-2025 paper total is +/-500 with at most
# 9,250 Mountain View and Atlanta miles; later knots carry the hub figure plus
# the explicit estimate for metros the hub did not count (data/README.md,
# Waymo anchors).
def jan_2023():
    # Victor et al. 2023 (Waymo, "Safety Performance of the Waymo Rider-Only
    # Automated Driving System at One Million Miles", p. 8): the first million
    # rider-only miles on January 21, 2023, i.e. 1,000,000 to 1,002,600 by
    # that day's end (up to one more day's miles). January's central holds
    # Jan 1-21's daily rate from Table 2's end-2022 lifetime for the whole
    # month; its bounds take Jan 22-31 at half to twice that rate.
    rate = (1000000 - 946400) / 21
    rate_lo, rate_hi = (1000000 - 947550) / 21, (1002600 - 945250) / 21
    return (round(946400 + 31 * rate), math.floor(1000000 + 10 * 0.5 * rate_lo),
            math.ceil(1002600 + 10 * 2 * rate_hi))
KNOTS = [
    ("2021-06", *OFFSET),
    ("2021-12", 422400, 421800, 423000),       # Table 2 through 2021
    ("2022-12", 946400, 945250, 947550),       # Table 2 through 2022
    ("2023-01", *jan_2023()),
    # Di Lillo et al. 2023 (Swiss Re, arXiv 2309.01206): 3,868,506 rider-only
    # miles in Phoenix and San Francisco "from 1/1/2018 to 8/1/2023" (Los
    # Angeles's came later in 2023: 46,700 through October); low edge one
    # more day of August's average.
    ("2023-07", 3868506, 3868506 - 35560, 3868506),
    # Kusano et al. 2024 (arXiv 2312.12675): "over 7.14 million RO miles
    # through the end of October 2023".
    ("2023-10", 7140000, 7140000, 7150000),
    ("2023-12", 10066400, 10054750, 10078050),  # Table 2 through 2023
    ("2024-06", 22199000, 22197000, 22206500),  # hub CSV1 totals from here
    ("2024-07", 25308000, 25306000, 25315500),
    ("2024-09", 33103000, 33101000, 33110500),
    ("2024-12", 50083000, 50081000, 50090500),
    # The paper's 56.7M; the central keeps the series' one-mile ledger
    # residue, so no later cumulative moves.
    ("2025-01", 56700001, 56699500, 56709750),
    ("2025-03", 71620000, 71620000, 71620000),
    ("2025-06", 96665000, 96365000, 97265000),
    ("2025-09", 129158000, 128458000, 130258000),
    ("2025-12", 174412000, 173712000, 175312000),
    ("2026-03", 222613000, 221813000, 223913000),
    # Context for the final interval's slope; Q2's authored rows stay intact.
    ("2026-06", 277979761, 275329379, 281529379),
]
# Lifetime floors inside an interval: they bound its months' cumulative ranges
# without splitting the interval. Waymo on X, Jun 18, 2024: "Over 14.8M
# rider-only miles driven through the end of March".
FLOORS = [("2024-03", 14800000)]
ALLOC = 0.20  # Three-month residual log half-width; proxy calibration, not US truth.
# The allowance is calibrated on intervals of up to six months
# (quals/waymo-allocation.qual.mjs); a longer interval keeps the series' old
# early allowance, half to twice the month's miles, which passes the same
# masked-month guard at twelve months (2022, the one such interval).
CALIBRATED_MONTHS = 6
LONG_INTERVAL_WIDTH = math.log(2)
# Every allocated month's rationale from February 2023: one text, so the
# page's VMT sources table shows those months as one entry (until 2026-10-30
# each month restated it around its own California and remaining miles; those
# figures are in data/waymo-ca.csv and model()'s output).
ALLOCATION_NOTE = ("US est.: each month's California part is CPUC's measured driverless "
                   "miles (data/waymo-ca.csv); the rest (other states, and California "
                   "miles outside CPUC's scope) is allocated between Waymo's published "
                   "cumulative totals, with daily rates interpolated linearly and each "
                   "interval's total kept. Only the rest carries allocation uncertainty, "
                   "and the monthly and cumulative bands agree with each other. The bands "
                   "are model estimates, not validated US probability intervals "
                   "(data/README.md, Waymo monthly allocation).")
# July 2021-January 2023, before CPUC's monthly California series (December
# 2022 on, which counts in its month). English: the human's rule for
# AI-labeled text (2026-10-30).
EARLY_NOTE = ("US est.: Waymo's rider-only miles by calendar year (Kusano et al. 2025, "
              "Table 2, from its Safety Impact hub: 328,000 in 2021, 524,000 in 2022) and "
              "its first million rider-only miles on Jan 21, 2023 (Waymo's one-million-mile "
              "paper), spread over the months with daily rates interpolated linearly "
              "between those totals; January 2023 keeps Jan 1-21's daily rate for the whole "
              "month. The series starts in July 2021, so the miles driven before it, "
              "150,000 (range 150,000-260,000), come off; July-December 2021's bands and "
              "every cumulative band carry that range, and each month's band an allowance "
              "for the monthly split, half to twice a month's miles in 2022 (data/README.md, "
              "Waymo anchors; data/README.md, Waymo monthly allocation).")


def month_info(month):
    year, mon = map(int, month.split("-"))
    days = calendar.monthrange(year, mon)[1]
    return days, dt.date(year, mon, 1).toordinal() + days / 2


def next_month(month):
    year, mon = map(int, month.split("-"))
    return f"{year + mon // 12}-{mon % 12 + 1:02d}"


def linear(x, xs, ys):
    """Linear daily-rate interpolation, constant outside the midpoint range."""
    j = min(max(bisect.bisect_right(xs, x), 1), len(xs) - 1)
    f = min(1, max(0, (x - xs[j-1]) / (xs[j] - xs[j-1])))
    return ys[j-1] * (1-f) + ys[j] * f


def sweep(rows, limits, start):
    """Interval arithmetic, not a fitted joint probability distribution:
    carry monthly ranges forward from the start, then constrain them backward
    from the knots and floors. Unpinned cumulative limits start at
    [0, infinity]. One forward/backward sweep on this chain reaches closure."""
    low = [start[0]] + [limits.get(r["month"], (0, math.inf))[0] for r in rows]
    high = [start[1]] + [limits.get(r["month"], (0, math.inf))[1] for r in rows]
    for j, r in enumerate(rows, 1):
        low[j] = max(low[j], low[j-1] + r["vmt_min"])
        high[j] = min(high[j], high[j-1] + r["vmt_max"])
    for j in range(len(rows), 0, -1):
        r = rows[j-1]
        low[j-1] = max(low[j-1], low[j] - r["vmt_max"])
        high[j-1] = min(high[j-1], high[j] - r["vmt_min"])
    return low, high


def model():
    with (ROOT / "waymo-ca.csv").open() as f:
        source = list(csv.DictReader(f))
    ca = {r["month"]: float(r["total"]) for r in source}
    assert len(ca) == len(source)
    assert all(abs(float(r["deployment"]) + float(r["pilot"]) - float(r["total"])) < 1e-7
               for r in source)
    months = [next_month(KNOTS[0][0])]
    while months[-1] < KNOTS[-1][0]:
        months.append(next_month(months[-1]))
    assert len(months) == 60 and months[0] == "2021-07" and months[-1] == "2026-06"
    # No California series before its first month: those months' miles are
    # all residual.
    assert min(ca) == "2022-12" and all(m in ca for m in months if m >= "2022-12")
    measured = {m: ca.get(m, 0.0) for m in months}
    blocks = []
    for before, after in zip(KNOTS, KNOTS[1:]):
        ms = [m for m in months if before[0] < m <= after[0]]
        days = sum(month_info(m)[0] for m in ms)
        observed = sum(measured[m] for m in ms)
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
        width = (ALLOC * math.sqrt((len(ms)-1)/2) if len(ms) <= CALIBRATED_MONTHS
                 else LONG_INTERVAL_WIDTH)
        values = [round(measured[m] + b["residual"] * w) for m, w in zip(ms, weights)]
        # Integer rounding must not move a published cumulative anchor.
        values[-1] += b["after"][1] - b["before"][1] - sum(values)
        for m, w, value in zip(ms, weights, values):
            lo = math.floor(measured[m] + b["low"] * w * math.exp(-width))
            hi = math.ceil(measured[m] + b["high"] * w * math.exp(width))
            assert 0 < lo <= value <= hi, (m, lo, value, hi)
            rows.append(dict(month=m, vmt=value, vmt_min=lo, vmt_max=hi,
                             measured_ca=measured[m], residual=value-measured[m],
                             anchor_start=b["before"][0], anchor_end=b["after"][0],
                             allocation_log_halfwidth=width,
                             rationale=EARLY_NOTE if m <= "2023-01" else ALLOCATION_NOTE))

    # Monthly ranges on the lifetime basis, where the offset is a knot of its
    # own (the series start) and cancels between any two later knots, so no
    # month after 2021 carries its uncertainty: constrain each month by the
    # difference of its adjacent cumulative ranges.
    limits = {m: (lo, hi) for m, _, lo, hi in KNOTS[1:]}
    limits.update({m: (floor, math.inf) for m, floor in FLOORS})
    low, high = sweep(rows, limits, KNOTS[0][2:])
    for j, r in enumerate(rows, 1):
        r["vmt_min"] = max(r["vmt_min"], low[j] - high[j-1])
        r["vmt_max"] = min(r["vmt_max"], high[j] - low[j-1])
    # Cumulative ranges on the series basis, which starts at exactly zero:
    # every knot and floor less the offset, so each carries its range.
    central, off_lo, off_hi = OFFSET
    limits = {m: (lo - off_hi, hi - off_lo) for m, _, lo, hi in KNOTS[1:]}
    limits.update({m: (floor - off_hi, math.inf) for m, floor in FLOORS})
    low, high = sweep(rows, limits, (0, 0))
    cume = 0
    for j, r in enumerate(rows, 1):
        cume += r["vmt"]
        r.update(helmer_cumulative_vmt=cume, kyoom_min=low[j], kyoom_max=high[j])
        assert low[j] <= cume <= high[j] and r["vmt_min"] <= r["vmt"] <= r["vmt_max"], r
        assert low[j] >= low[j-1] + r["vmt_min"] and high[j] <= high[j-1] + r["vmt_max"], r
        assert r["vmt_min"] >= low[j] - high[j-1] and r["vmt_max"] <= high[j] - low[j-1], r
    by_month = {r["month"]: r for r in rows}
    assert (low[0], high[0]) == (0, 0)
    for m, best, lo, hi in KNOTS[1:-1]:
        r = by_month[m]
        assert (r["helmer_cumulative_vmt"], r["kyoom_min"], r["kyoom_max"]) == (best - central, lo - off_hi, hi - off_lo), r
    for m, floor in FLOORS:
        assert by_month[m]["helmer_cumulative_vmt"] + central >= floor, m
    return rows


if __name__ == "__main__":
    print(json.dumps(model(), indent=2, ensure_ascii=False))

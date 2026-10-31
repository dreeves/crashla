Early VMT estimates from the golems:

ChatGPT:
* Waymo: 53M - 96M (~80M)
* Tesla: 0.30M - 0.55M (~0.39M)
* Zoox: 0.05M - 0.60M (~0.25M)
ChatGPT Revised:
* Waymo 57M - 66M (~61M) [confidence 0.7]
* Tesla 0.094M - 0.60M (~0.45M) [confidence 0.35]
* Zoox 0.05M - 1.0M (~0.30M) [confidence 0.2]

Claude:
* Waymo 60M - 80M (~70M)
* Tesla 150k - 450k (~300k)
* Zoox 200k - 550k (~350k)
Claude Revised:
* Waymo 50M - 65M (~57M) [confidence high]
* Tesla 94,000 - 456,000 (~250,000) [confidence low]
* Zoox 250,000 - 550,000 (~400,000) [confidence low]

Gemini:
* Waymo 50M - 60M
* Tesla 0.5M - 3M
* Zoox 0.8M - 1.2M
Gemini Revised:
* Waymo 80M - 120M
* Tesla 300,000 - 500,000
* Zoox 0.8M - 1.0M

For Vehicle Miles Traveled (VMT) we also need to include miles traveled with no customer in the car (deadhead miles).

Zoox mileage in California from CPUC data:
https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting
* Jun 2025: 4,232.30 (multiply by 16/30 for Jun 15+)
* Jul: 7,685.90
* Aug: 16,533.52
* Sep: 21,392.90
* Oct: 27,854.76
* Nov: 42,347.31
* Dec 2025: 36,481.55 (multiply by 15/31 to end at Dec 15)
Total VMT (Jun 15 - Dec 15, 2025) ≈ 135,723.98 miles

Zoox mileage in Nevada:
https://techcrunch.com/2025/09/10/zoox-opens-its-las-vegas-robotaxi-service-to-the-public/
https://apnews.com/article/amazon-zoox-robotaxis-las-vegas-bd5cb24602fb16243efcba05c7fe518f

I think we can conclude from the following that the robotaxi numbers in Tesla's Q4 report do not include Bay Area miles:
https://www.fool.com/earnings/call-transcripts/2025/10/22/tesla-tsla-q3-2025-earnings-call-transcript/


## [AI TEXT] Explanatory Note

This page aims to compare "miles per incident" across Tesla, Waymo, and Zoox using [NHTSA SGO](https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting) incident reports. The analysis window rolls forward as NHTSA publishes new data: the default view starts with June 2025 (a full calendar month — SGO incident dates are month-granular, so the original June-15 framing can't be applied to incidents, and the June VMT rows are full-month to match) and extends through the most recent month NHTSA has published (the date slider reaches back to July 2021 for Waymo). Incident data comes from both the current and [archive](https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADS.csv) NHTSA CSVs so that June 2025 has full incident coverage.

Context:
[agifriday.substack.com/crashla](https://agifriday.substack.com/crashla/) and
[agifriday.substack.com/crashla2](https://agifriday.substack.com/crashla2/)

VMT master data: `data/vmt.csv` in this repo. (Formerly maintained in a [Google Sheet](https://docs.google.com/spreadsheets/d/1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w/edit?gid=844581871#gid=844581871), migrated verbatim into the repo 2026-06-11; the sheet is now retired.)

- Jargon: the code calls the entity at the wheel a "helmer" (Tesla, Waymo, Zoox, or one of three human benchmark cohorts); the user-facing label is "Company" (the "helmsbeing" coinage never reached the UI).
- Top chart: lines differentiated by thickness show MPI for each selected metric. Shaded fan bands show 50%/80%/95% Bayesian credible intervals; the error bar at each point is that month's 95% credible interval (the same quantity as the widest fan level and the tooltip's "Range" line), clamped to the plot area when it extends past the y-axis range.
- Three company charts: VMT line (with error bars) and incident bars by speed bucket, where darker sections indicate higher or unknown speed.
- Tesla mileage is anchored to Tesla's own disclosures: the "Cumulative Paid Robotaxi Miles" chart in the quarterly update decks, with monthly values vector-extracted from the Q4-2025, Q1-2026, and Q2-2026 deck PDFs (the decks' overlapping months agree within ~8k miles; 658k end-2025, 1.717M end-Mar-2026, 2.440M end-Jun-2026). The paid series ends at Jun-2026: from its Q3-2026 update Tesla publishes only miles driven with no safety monitor in the vehicle (its Robotaxi Safety Report page, tesla.com/robotaxi/safety, weekly by city, and the deck's "Cumulative Unsupervised Robotaxi Miles" chart), a subset of this scope, so from Jul-2026 each month's floor is the lower of those two readings, the central adds June's measured monitor-aboard remainder (33k: the June deck's paid miles less June's no-monitor miles), and the top keeps the monitor-aboard share at or below June's 21%; the trackers no longer publish a mileage model (robotaxitracker.com dropped its own in Aug 2026), and fleet-count methods were retired after they over-predicted Q2 1.4–2.9x. Dallas/Houston service (unsupervised launch Apr 18, 2026) is included from 2026-04 onward; the Bay Area is excluded — Tesla itself tracks it as a separate supervised series (Q3-2025 call: Bay Area has "crossed more than a million miles" with a driver-seat safety driver, vs the Austin fleet's "more than a quarter million"), outside the SGO driverless scope. The disclosed series reads as fleet service miles including deadhead — the same figures are described on the Q3-2025 call as miles the fleet has "covered", and the trackers' ~115 mi/vehicle/day model equates them to fleet-wide miles — but if "paid" is literally passenger-on-board miles the true denominator is higher, so the cumulative band carries one-directional upside (~15%). Scope note (resolved 2026-06-12): the disclosures are fleet-wide with no breakdown by monitor seating, so the denominator includes the post-Sep-2025 highway rides with the safety monitor in the driver's seat — which matches the incident numerator (Driver/Operator Type "None" plus Tesla's "In-Vehicle (Commercial / Test)" and "Remote (Commercial / Test)"). (Historical: until 2026-07-22 the rows were tracker-interpolated between sparse verbal anchors, which left Aug-Sep 2025 ~3.8x high and end-Q1-2026 9% low vs the deck chart.)
- Tesla's no-monitor line (added 2026-10-24, off by default): beside the every-mode Tesla line, the page plots Tesla's driving with no safety monitor in the vehicle from January 2026, the service's start: its miles are Tesla's own no-monitor miles (safety page, with the Q3-2026 deck as the second reading) and its crashes the in-scope reports on Tesla's own list of no-monitor SGO reports (data/README.md, "Tesla's no-monitor line").
- Waymo VMT combines measured [California CPUC driverless VMT](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (deployment + pilot, including deadhead) with US cumulative milestones. Rebuilt 2026-10-27, July 2024–March 2026 fixes the California part and allocates only the remaining miles between anchors; the old uniform +/-25–30% bands are replaced by residual-allocation uncertainty and source-specific cumulative bounds (data/README.md, Waymo monthly allocation). Every reviewed cumulative central is retained. April–June 2026 retains its measured-Q2 construction and roughly −9%/+11% bands; July–September 2026 remains extrapolated at roughly −19%/+22% to −23%/+27%, and October is a whole-month projection (data/README.md, Ghost months). Earlier history retains its existing estimates, apart from the June 2024 boundary bounds; the conflicting December 2023 source is an open issue below. Domestic-scope caveat: every anchor to date is US-only (the per-city breakdowns list only US cities), matching the US-only NHTSA SGO numerator — but Waymo began London operations in Apr 2026, so before recalibrating against any future cumulative-miles anchor, verify it hasn't started folding in international miles.
- Zoox VMT estimates draw on [CPUC quarterly reports](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (California-only miles of Zoox's fare-free driverless pilot) and [Las Vegas operations](https://techcrunch.com/2025/09/10/zoox-opens-its-las-vegas-robotaxi-service-to-the-public/), with the cumulative series anchored to three company milestones — 1.3M driverless public-road miles as of Dec 31, 2025 (Zoox's own letter to NHTSA, Jan 28, 2026, docket NHTSA-2025-0523-0004 p.22, superseding the earlier ~1M-late-2025 press floor), ~2M by late March 2026 (>350k riders), and >3M stated Aug 5, 2026, the middle one corroborated across multiple outlets ([Electrek](https://electrek.co/2026/03/24/zoox-expands-current-service-area-and-is-bringing-its-purpose-built-robotaxi-to-two-new-cities/), [The Robot Report](https://www.therobotreport.com/zoox-sets-geographic-milestones-product-features-robotaxi/)). Error bands were tightened from 0.5x-2x to 0.7x-1.3x in Jun 2026, once those milestones bracketed the series; the rebuilds below have replaced them, except on the Jun-Dec 2025 rows' Las Vegas share, which keeps 0.7x-1.3x. California DMV drivered testing miles are out of scope; its driverless-testing miles (Zoox permit AVDT004, all of Zoox's California driverless miles) are a hard floor under each month they cover (published through Nov 2025) and, rebuilt 2026-10-03, set the California part of 2024-05..2025-11 (Las Vegas assumed equal to California before Jun 2025, band 1.5x-3x California; the 40,080 driverless miles before the series' May-2024 start come off the 1.3M), and the cumulative band at Dec 2025 is that disclosure's own uncertainty, 1,190,013-1,319,873 (knot added 2026-10-03). Since 2026-10-27 the 2026 rows are the per-day rate between consecutive statements (California from CPUC's driverless miles × 1.19, the rest flat within each interval), with bands symmetric on a log scale from statement rounding, drift and month noise (wider above from October, when growth was announced but not quantified), and the March statement is a knot too, the August one a floor: both count driverless miles, since a count with Zoox's California safety-driver test miles (1,213,646 in Dec 2024-Nov 2025 alone) would have passed 2.5M by Dec 31, 2025 (data/README.md, Zoox anchors).

### Statistical Method

- The colored band around each MPI line is a 95% Bayesian credible interval. Model: incidents ~ Poisson(lambda * m), where lambda is the rate (incidents per mile) and m is VMT. Jeffreys prior: lambda ~ Gamma(0.5, 0) (improper). Posterior after observing k incidents in m miles: lambda | k, m ~ Gamma(k + 0.5, m). MPI = 1/lambda; quantiles are inverted via a monotone decreasing transformation.
- The credible interval combines uncertainty from incident counts (Gamma-Poisson) and from VMT by marginalizing the posterior over a two-piece (split) log-normal VMT prior with its mode at vmt and exactly 95% of its mass inside [vmt_min, vmt_max] (tail mass split in proportion to the side sigmas; degenerates to the symmetric log-normal when the band is log-symmetric — see splitPriorSigmas in crashla.js): the displayed lo/hi are the exact 2.5%/97.5% quantiles of that marginal — the same distribution the probability-distribution chart draws. (Until 2026-08-21 the bounds were instead a conservative worst-case pairing — vmt_min with the upper lambda quantile and vice versa — which held 97.9-99.4% of the posterior rather than 95%.)
- The VMT data carries a receipt-coverage triple (`coverage`, `coverage_min`, `coverage_max`) for the NHTSA data-through month — the release holds reports received through the 15th of the prior month, rolled forward to the next business day (August 17, 2026 for the Sep-15 file), which cover only the first part of that month's five-day-track crashes. The triple is estimated from the release itself, the month's five-day-track incidents present over the count expected at each company's rate in its most recent earlier month with at least 3 of them (a company with no such month left out), the high edge being the largest share a first release has held, padded (for September 2026, 0.1356, band 0.0615–0.52; until 2026-10-31 the median of earlier months' first-release shares, 0.28, band 0.20–0.52), not a fraction of days; every earlier month is 1.0, June 2025 included. The Monthly-track metrics additionally apply the pooled incident-coverage factor for that month, because their NHTSA filings are not due until the 15th of the following month; the five-day-track metrics (fatality, hospitalization, airbag, serious injury+) use the receipt-scaled VMT alone (see the "incident coverage" sanity check on the page).
- A company whose Monthly-track reports reach NHTSA's file a release late (`MONTHLY_ARRIVAL_LAG` in `data/slurp.py`, measured from snapshot history; every Zoox Monthly report for Feb-Jul 2026 arrived a release late, and no company has lagged since the Oct 15, 2026 file) has the months inside that lag thinned for the Monthly-track metrics by its measured 5-Day share, its receipt coverage staying 1: on the Sep-15 file, Zoox's July 2026 was at 0.63 (band 0.25–1.0).
- The point estimate shown in the line is the median of that same marginal posterior over 1/lambda, not the simple ratio m/k. For small k (especially Tesla), the prior pulls the estimate slightly downward; for large k (Waymo), the difference is negligible.
- Fault-weighted incidents (thin line): each incident contributes its fault fraction (Claude's at-fault estimate) instead of one full count. Since the fractions are probabilities, the true at-fault count K is a Poisson-binomial random variable, and the posterior is the corresponding mixture over Gamma(K + 0.5, m) — reducing exactly to the plain posterior when every fraction is 0 or 1. (Fatality's 1/vehiclesInvolved fractions are deterministic allocations, not probabilities, and stay on the plain path.)
- **Tesla safety-monitor caveat:** Most Tesla robotaxi rides include a passenger-seat safety monitor. Tesla classifies these as unsupervised (no operator) for NHTSA reporting, but the monitors may intervene to prevent incidents. If so, Tesla's true unsupervised MPI would be lower (worse) than shown.

### Human Comparison Methodology

Human baselines are shown as shaded bands (range of plausible values) rather than single lines, and since 2026-06-11 come in three cohorts displayed as separate "helmers" (two shades of gold, plus orange for the default-off **Humans (Uber/Lyft)** proxy — the rider's alternative: the sourced Uber/Lyft fatality rate, and elsewhere a band derived from the AV-cities one): **Humans (AV cities)** — the bands described below, surface streets in AV operating areas — and **Humans (US average)** — nationwide CRSS/FARS crashed-vehicle rates across all road types, Blincoe-adjusted at the low end. The US-average cohort's airbag and serious-injury bands are wide log-interpolations between the national injury and fatality anchors (CRSS 2024 also measures both directly, airbag 0.740 and A+K 0.086 per M mi, each inside its band; re-deriving them from those is not yet done), its hospitalization band is CRSS 2024's measured national transport rate (since 2026-10-03; see below), and the stress test plus the "Nx vs humans" card multipliers compare against the AV-cities cohort, the more apples-to-apples baseline. For injury, airbag, and serious-injury+, the AV-cities bands are set directly from [the live Waymo Safety Impact hub's per-city benchmarks](https://waymo.com/safety/impact/) (five areas, data through Jun 2026 as of the Sep 24, 2026 hub update, in the corrected files of Waymo's Oct 2, 2026 release notes; superseding [Kusano et al.'s 56.7M-mile paper](https://arxiv.org/abs/2505.01515)) (the surface-street human rates Waymo/Piper cite): each spans the per-city range (Phoenix-to-SF for injury and serious+, LA-to-Atlanta for airbag) with its geometric center — the value the "Nx vs humans" cards divide by — near the mileage-blended value (any-injury 3.77, airbag 1.61, serious+ 0.213 IPMM; the centers sit 4% below it for injury, 5% below it for serious+ and 15% above it for airbag, whose high-rate edge is Atlanta), so for these three the cohort tracks the location-weighted benchmark rather than estimating it independently. The all-crashes band remains our own synthesis of [Kusano et al. (2024)](https://arxiv.org/abs/2312.12675) observed-to-Blincoe-adjusted rates (surface streets, passenger vehicles, underreporting-corrected; see also [this analysis](https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos)). We still don't reproduce Waymo's full pipeline (its dynamic intra-city weighting and exact outcome definitions), and [Waymo's own safety page](https://waymo.com/safety/impact/) concurs with these anchors. Note also that the app's default metric (fault-weighted "at-fault" incidents, any severity, as of 2026-06-12) is broader than Waymo's surface-street, injury-focused framing — it includes minor property-damage contacts that injury-based comparisons exclude, which is why its human band's low anchor collapses to the all-crash low anchor (see the at-fault derivation note in `crashla.js`).

- **Band interpretation:** For injury/airbag/serious-injury+, the band spans the hub's per-city human-rate range (the highest-rate city at the low-MPI end — SF for injury/serious+, Atlanta for airbag — and the lowest-rate city at the high-MPI end), with its geometric center near the mileage-blended value — it reflects how much the comparable human rate varies by where Waymo drives. For all-crashes, the band spans observed-to-Blincoe-adjusted rates (the ~60%-minor-crash underreporting range). For hospitalization+ (since 2026-10-03), AV cities applies CRSS 2024's ratios of hospital-transport (or serious/fatal) crash involvements to injury-crash (0.543) and airbag-crash (0.657) involvements (urban non-interstate passenger vehicles) to the hub's per-area police-reported injury and airbag rates (the observed injury rates, without the hub's 32% Blincoe correction) and spans the per-area extremes of both routes (SF Bay Area to Phoenix, both on the injury route: 402k–1.38M); US average spans CRSS 2024's police-reported national rate (0.512 per M mi) to that rate raised for Blincoe et al. 2023's 31.9% unreported injury-crash vehicles (1.33M–1.95M). The nonstationary bands are the all-crash bands minus CRSS 2024's share of crashed in-transport vehicles stopped in the roadway (14.6% for urban non-interstate passenger vehicles in AV cities, 12.9% for all vehicles nationally), matching the AV side's removal of its 0-mph incidents (parked vehicles were never in the in-transport benchmarks), and the non-parking-lot bands equal them, since CRSS, the state police data behind Kusano et al.'s benchmark and Blincoe et al. 2023's underreporting estimate all exclude parking-lot crashes. The true apples-to-apples MPI should fall within each band.
- **Scope by cohort and metric:** the AV-cities crash-frequency benchmarks (all / nonstationary / injury / hospitalization+ / airbag / serious-injury+) are surface-street rates in AV operating areas (higher crash rates than the national average), following the Kusano et al. and Waymo-hub approach, with the hospitalization+ and nonstationary adjustments taken from CRSS's urban non-interstate crashes; the AV-cities fatality band is all urban roads (freeway-inclusive, matching the AV side's all-roads scope); the US-average cohort is nationwide, all road types.
- **Hospitalization band:** The SGO's "W/ Hospitalization" (transported to hospital, incl. ER visits for minor injuries) matches CRSS's transport field (person.csv HOSPITAL 1–6: transported for treatment by EMS, law enforcement or other means); with "Serious" and "Fatality" it is the page's Hospitalization+, whose human analog is a crash in which anyone was transported or had an A or K injury (see the band interpretation above). Until 2026-10-03 this bullet said the SGO category had no direct human equivalent; the AV-cities band was bracketed between the airbag and serious-injury+ benchmarks and the US band log-interpolated, which put both centers ~2x too safe.

---

## [AI TEXT] Comparison with Kelsey Piper's Waymo Safety Claims

Kelsey Piper's article (Jan 16, 2026) argues Waymo is clearly safer than human drivers:
https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos

Her claims, sourced from Waymo's own safety page and the Kusano/Scanlon paper:
* 2x safer for any crash ("half as likely to report any crash")
* 5x safer for any-injury crash (Waymo 0.74 IPMM vs human 3.97 IPMM)
* 5x for airbag deployments (Waymo 0.31 vs human 1.66 IPMM)
* 10x for serious injuries (Waymo 0.02 vs human 0.23 IPMM)
* "over 200 million miles" total for Waymo

**Update — Waymo Safety Impact, [Jun 24, 2026](https://waymo.com/blog/shorts/safetydata-june26/) (220.6M rider-only miles through Mar 2026):** the same rate comparison now reads any-injury 0.71 vs 3.91 IPMM (82% fewer), airbag-in-any-vehicle 0.30 vs 1.68 (82% fewer), and serious/fatal 0.01 vs 0.23 (94% fewer) — each slightly stronger for Waymo than the figures Piper cited. New vulnerable-road-user breakdowns: 93% fewer pedestrian, 84% fewer cyclist, 84% fewer motorcyclist injury crashes. **Sep 24, 2026 update, on the corrected files of Waymo's Oct 2 release notes** (271.3M rider-only miles through Jun 2026): any-injury 0.67 vs 3.77 IPMM (82% fewer), airbag-in-any-vehicle 0.29 vs 1.61 (82% fewer), serious/fatal 0.01 vs 0.21 (95% fewer); 93% fewer pedestrian, 86% fewer cyclist and 82% fewer motorcyclist injury crashes.

How our data compares:

1. **Default view roughly agrees with her multiples (since 2026-06-12).** Our default metric is now at-fault MPI, where Waymo shows roughly an order of magnitude more at-fault miles per incident than the AV-cities human geometric-mean benchmark; stress-testing against the band edges, the robust range stays well above parity at its low edge and reaches into the tens at its high edge. That sits at the upper end of Piper's 5–10x serious-crash multiples, though measured on a different construct (fault-weighted incidents of any severity vs injury severity tiers). The raw "all incidents" view, formerly the default, hovers around parity (roughly half-x to a couple-x across the band), reflecting reporting-threshold mismatch more than safety. (Live figures are on the page; we keep prose qualitative here because the exact multiples drift with each data refresh.)

2. **Miles are compatible — and now confirmed well past 200M.** Piper said "over 200 million" for Waymo total; that milestone was confirmed Feb 23, 2026 (https://www.benzinga.com/markets/tech/26/03/50953948), and Waymo's Safety Impact updates report 220.6M rider-only miles through end of March 2026 (Jun 24, 2026; per-city: Phoenix 80.6M, SF Bay 67.1M, LA 51.8M, Austin 15.8M, Atlanta 5.4M) and 271.3M through end of June 2026 (Sep 24, 2026; Phoenix 92.1M, SF Bay 82.4M, LA 67.1M, Austin 21.1M, Atlanta 8.6M). Earlier snapshots: 127M through Sep 2025, 170.7M through Dec 2025. Waymo defines "rider-only miles" as miles without a human driver in cities where it operates; we treat that as including deadhead and overhead, matching the CPUC `TotalVMTZEV` definition — an assumption our VMT estimates depend on but that the Waymo page alone does not establish. Our Waymo VMT series is anchored to land on hub + E by construction: 220.6M + 2.0M − 0.15M = 222.46M through Mar 2026 and 271.3M + 6.65M − 0.15M = 277.83M through Jun 2026 (the hub counts only benchmarked metros, so E adds the estimate for Miami, Dallas, Houston, San Antonio, Orlando and Nashville; the 0.15M is the pre-series slice — see the anchor table and notes in data/README.md). Before the Mar-2026 recalibration the series estimated 225.2M (~2% high), confirming the methodology was well-calibrated.

3. **Reporting asymmetry.** Piper acknowledges Waymo may report more crashes due to better reporting but doesn't quantify this. Our human baselines explicitly address it: Kusano/Scanlon provide both Blincoe-adjusted rates (catching underreported human crashes) and police-reported rates. The lo–hi range in our human MPI benchmarks spans this uncertainty. Additionally, 43% of Waymo collisions involve <1 mph delta-V per Waymo's safety page — incidents that would almost never be police-reported for human drivers.

4. **Fault attribution.** Piper doesn't discuss who's at fault. Our AI fault-fraction analysis shows most of Waymo's incidents (1,981 full-history as of the 2026-08-17 fetch) were caused by other drivers. Fault-weighting makes Waymo look even safer than the raw incident count suggests.

5. **Scope.** Piper's article is Waymo-only. Our tool adds Tesla and Zoox to the comparison, which is where the more contested conclusions live.

Sources:
* Waymo Safety Impact update (220.6M mi through Mar 2026; Atlanta added; per-city breakdown), Jun 24, 2026: https://waymo.com/blog/shorts/safetydata-june26/
* Waymo Safety Impact hub (live page; historical snapshots 127M through Sep 2025, 170.7M through Dec 2025): https://waymo.com/safety/impact/
* Kusano & Scanlon (56.7M mi): https://pubmed.ncbi.nlm.nih.gov/40378124/
* Waymo 200M milestone ("nearly 200M" Feb 6; "over 200M" Feb 23, 2026): https://www.benzinga.com/markets/tech/26/03/50953948

---

## [AI TEXT] June and the Different Datasets

The NHTSA Standing General Order (SGO) analysis window starts **June 2025** (the default view) and rolls forward as NHTSA publishes new data, always extending through the most recent published month.
June 2025 is included as a full calendar month: SGO incident dates are month-granular, so a mid-month cutoff can't be applied to incidents, and the June 2025 VMT rows are full-month to match (the june-coverage qual checks the incident count is consistent with a full month).
coverage=1.0 in the VMT data means "VMT and incidents are already aligned" — no pro-rating needed; only the NHTSA data-through month carries a smaller (measured) receipt-coverage value.
(Historical: the window was originally framed as June 15 – December 15, 2025, matching the first data pull; that framing survives in older notes above but the data has been full-June ever since the archive merge gave June full incident coverage.)
For the data-through month (reports received through the 15th of the prior month, or the next business day), receipt coverage scales every metric's VMT to the share of the month's five-day-track crashes that its first release actually contains (estimated from the release itself: about 14% for September 2026), and the Monthly-track metrics are additionally thinned by the pooled incident-coverage factor because their filings are not due until the following month (see the "Incident coverage for partial months" sanity check on the page). The cutoff itself is a reviewed constant in `data/slurp.py` guarded by content asserts; it is not inferred from the file's modification date, which runs a month later.

### The three datasets combined here

1. **NHTSA SGO incident reports** (the numerator).
   Two CSVs — a "current" one and an "archive" for 2021–2025 — are fetched and merged by `data/slurp.py`.
   Archival raw fetch snapshots live under `data/snapshots/`.
   The archive is needed because some June incidents were filed late and ended up in the archive rather than the current CSV.
   After deduplication (the highest Report Version of each Report ID, then one report per Same Incident ID, a reviewed table saying which stands when a crash was re-filed under a new Report ID) and filtering to the operator modes whose miles are in each company's denominator (Driver/Operator Type = "None" or "Remote (Commercial / Test)" for all three, plus "In-Vehicle (Commercial / Test)" for Tesla; a few "Other, see Narrative" reports classified from their narratives) and dropping the five Tesla crashes in which a remote human was driving, we get 2,214 incidents as of the 2026-10-15 release: 2,129 Waymo, 31 Tesla (14 of them on Tesla's no-monitor list), 54 Zoox. These counts grow with each slurp run.

2. **Vehicle Miles Traveled (VMT)** (the denominator).
   Maintained in `data/vmt.csv` (the in-repo master) and embedded in `data/vmt.js` by `data/slurp.py`.
   Each company's mileage comes from different public sources:
   - **Tesla**: Tesla's own quarterly-deck "Cumulative Paid Robotaxi Miles" chart, monthly values vector-extracted from the deck PDFs (Texas service: Austin, plus Dallas/Houston from their Apr 2026 unsupervised launch; Bay Area excluded — Tesla tracks it as a separate supervised series, outside the public-service scope); from Jul-2026, when Tesla began publishing only miles with no safety monitor in the vehicle, each month's floor is those miles (Tesla's safety page and Q3-2026 deck) and the central adds June's measured monitor-aboard remainder. Tesla's no-monitor line uses the no-monitor miles alone, from January 2026.
   - **Waymo**: See "Waymo VMT Methodology" section below.
   - **Zoox**: US estimates anchored to three company milestones (1.3M driverless public-road miles as of Dec 31, 2025 — Zoox's letter to NHTSA, docket NHTSA-2025-0523-0004; ~2M by late March 2026; >3M stated Aug 5, 2026), with monthly detail from California DMV driverless-testing mileage (permit AVDT004) through 2025, CPUC's driverless miles × 1.19 from Jan 2026, and Las Vegas operations (error bands 1.5×–3× California's miles through May 2025, then California plus 0.7×–1.3× of the Las Vegas share through Dec 2025); California drivered testing miles are out of scope, and the cumulative band is pinned to each statement's own uncertainty (Dec 2025, and since 2026-10-27 Mar 2026 and, as a floor, Jul 2026, when the 2026 rows moved to the per-day rate between consecutive statements).

3. **AI fault-fraction estimates** (for fault-weighted MPI).
   Claude estimated how at-fault the AV was for every incident, on a 0–1 scale.
   Stored in `data/faultfrac.csv`.
   These are used to compute fault-weighted incident counts.
   Passenger-caused incidents (e.g., passenger opened door into traffic) are scored 0 — only the AV driving system's fault counts.

---

## [AI TEXT] Waymo VMT Methodology

### Data sources

Waymo's US monthly VMT is estimated by combining two data sources:

1. **CPUC quarterly filings** (California driverless VMT, exact):
   The California Public Utilities Commission requires quarterly data reports from AV operators.
   Downloadable as ZIP archives from [cpuc.ca.gov](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting).
   Deployment filings and pilot filings from Q2 2025 contain a month-level CSV with monthly VMT broken into three periods; earlier pilot filings use a `Fleetwide Data` table with monthly passenger-service miles:
   - `TotalVMTPeriod1`: idle/repositioning miles after a trip, before the next assignment
   - `TotalVMTPeriod2`: deadhead miles (en route to pickup)
   - `TotalVMTPeriod3`: miles with a passenger aboard
   - `TotalVMTZEV`: sum of all three = total driverless CA VMT

   (Period numbering follows the CPUC/TNC convention: P3 is the passenger-aboard
   period. P1+P2 — Waymo's deadheading — was 44.3% of CA driverless VMT in
   Sep 2025, down from 51.5% in Jan 2024, per Driverless Digest's CPUC analysis.)

   These include deadhead, not just passenger-aboard miles, but CPUC's passenger-service scope does not establish that they cover every California rider-only mile. The hub's measured California increments exceed CPUC totals by 4.0% in Q1 2026 and 5.8% in Q2. The July 2024–March 2026 model puts any such difference in the residual alongside the other states' miles.
   Waymo files under two programs: **deployment** (commercial, fare-charging) and **pilot** (no fares).
   Both are included; driverless deployment miles first appear in August 2023. Pilot miles fell below 1% in mid-2024 but rose to 6.8% in June 2026 and remain included. The extracted monthly data and ZIP/member provenance are `data/waymo-ca.csv` and `data/waymo-ca-sources.json`.

2. **Waymo cumulative milestones** (for the US total):
   Published rider-only totals, supplemented by the explicit excluded-metro estimates below, anchor the US series. Hub totals alone do not cover every US city. This table lists the retained central anchors; the more precise 2024 source values now inform their bounds (data/README.md, Waymo monthly allocation).

   | Date | Cumulative US Driverless Miles | Source |
   |------|------------------------------:|--------|
   | ~Jan 2023 | ~1M (first crossed) | Waymo blog |
   | End Oct 2023 | 7.14M | Waymo safety paper (NHTSA SGO data) |
   | End 2023 | ~9.3M | Driverless Digest / Waymo |
   | End Jun 2024 | 22M | Waymo Safety Hub |
   | End Jul 2024 | 25M | Waymo Safety Hub update |
   | End Dec 2024 | 50M | Year-in-review |
   | End Jan 2025 | 56.7M | Academic paper (Traffic Injury Prevention) |
   | End Mar 2025 | 71.43M + 0.19M | Waymo Safety Hub CSV1 (Jun 12, 2025 release; Atlanta 0.056M and Mountain View 0.132M listed but excluded from the blended total) |
   | End Jun 2025 | 95.97M + E 0.7M [0.4, 1.3] | Waymo Safety Hub CSV1 (PHX/SF/LA/ATX; Atlanta and Santa Clara not counted) |
   | End Sep 2025 | 127.16M + E 2.0M [1.3, 3.1] | Waymo Safety Hub geographic breakdown (Atlanta and Santa Clara not counted) |
   | End Dec 2025 | 170.71M + E 3.7M [3.0, 4.6] | Waymo Safety Impact (Mar 19, 2026 release; county basis, Santa Clara newly counted; Atlanta ~3.5M, Miami and the four Dec-2025 metros not counted) |
   | ~Feb 14, 2026 | ~200M | Waymo X post ("nearly 200M" Feb 6; "over 200M" Feb 23) |
   | End Mar 2026 | 220.61M + E 2.0M [1.2, 3.3] | Waymo Safety Impact update (Jun 24, 2026); per-city PHX 80.6M / SF 67.1M / LA 51.8M / ATX 15.8M / ATL 5.4M (Atlanta now counted, whole); Miami-Dade, Dallas, Harris, Bexar, Orange, Davidson not counted |
   | End Jun 2026 | 271.33M + E 6.65M [4.0, 10.2] | Waymo Safety Impact update (Sep 24, 2026); per-city PHX 92.1M / SF Bay 82.4M / LA 67.1M / ATX 21.1M / ATL 8.6M; same eight counties, so the same metros stay in E |

   Note: Waymo defines "rider-only miles" as miles with no human driver in cities where Waymo operates. We treat this as including deadhead and overhead — i.e., all driverless VMT, the CPUC `TotalVMTZEV` definition — which is an assumption of this methodology; the Waymo page alone does not establish that equivalence.

   Note (2026-08-28): a hub "All Locations" total counts benchmarked locations only (release notes, Jun 12, 2025). E is the explicit estimate of rider-only miles in the then-unbenchmarked metros — the repo's incident numerator already contains those metros' crashes, so leaving E out would mismatch numerator and denominator. Before this, the 170.7M→220.6M step had absorbed Atlanta's whole 2025 history as Q1-2026 growth (partly offset by the new-metro exclusion), and the 127M→170.7M step ~1-2M of Santa Clara's. The E table with sources lives in data/README.md and is pinned by quals/waymo-vmt-provenance.qual.

   Note (2026-09-29): from 2026-09-25 to 2026-09-29 the anchors also subtracted D, Atlanta miles the hub appeared to count twice (its per-cell detail file, CSV4, listed ~85 Fulton/DeKalb S2 cells twice, and the county totals matched the sums that count both copies). Waymo replied that the duplicates came from a processing error in its Atlanta benchmark data and that county miles come from a separate process, and on Sep 28 posted corrected CSV3/CSV4 files ("_v2") that list each cell once and still sum to the published totals. The published figures stand; D is gone.

   Note: the reviewed anchors (plus E where shown) remain exact *central* estimates, minus the fixed ~0.15M pre-series convention. Their bands express source precision and scope allowances. The 2026-10-27 rebuild retains those centrals even where the precise source differs: CSV1 gives 22.199M through June 2024, 25.308M through July and 50.083M through December, so each new band envelopes the retained central and the source-supported range. The common pre-series offset cancels between anchors. The July 2026 re-baseline removed an old ~2.8M level offset; that repaired the cumulative totals but did not validate the monthly allocation, which this rebuild replaces. `quals/waymo-vmt-provenance.qual.mjs` pins the reviewed milestones.

   Open source conflict, outside this rebuild: Table 2 of [Kusano et al. (2025)](https://arxiv.org/pdf/2505.01515) sums to about 10.066M lifetime miles through December 2023, whereas the retained anchor is 9.3M and its existing band excludes that figure. The earlier anchor remains unchanged pending resolution.

### Scaling methodology

Since 2026-10-27, July 2024–March 2026 is reproduced by `python3 data/waymo_vmt.py`. For each interval between reviewed cumulative anchors, the model subtracts measured California miles from the US increment. The residual includes the other states and California miles outside CPUC's reporting scope. Its daily rates are interpolated between neighboring intervals, then the monthly residuals are rescaled to preserve the interval total exactly. Measured California miles are added back; integer rounding cannot move an anchor. June 2024 supplies the starting cumulative boundary and keeps its monthly central. The April–June 2026 interval supplies the final slope while retaining its existing monthly rows.

This replaces the old claim that the US series was proportional to monthly California mileage. The old rows did not consistently implement that claim: California miles fell 33.1% in June 2025 but the US estimate fell only 4.4%; November–December 2025 California miles were flat while the US estimate rose 14.3%. The new method carries measured California changes directly and smooths only the unmeasured residual. It does not assume California's shutdowns occur nationally.

The earlier July 2021–June 2024 monthly centrals remain the existing ramp and allocations. Their source limitations and the December 2023 conflict above remain open. April–June 2026 keeps the bottom-up construction below; later months remain extrapolations. The full formula, calibration limitations, cumulative precision table and source links are in data/README.md, Waymo monthly allocation.

### Uncertainty bands

All authored `vmt_min`/`vmt_max` bands — whatever the ±X% shorthand in a row's rationale — are read by the app as the **exact 95% interval** (mode at `vmt`) of the two-piece log-normal VMT prior, per the S1 decision of 2026-08-21 (see splitPriorSigmas in crashla.js and the Statistical Method bullet above). So "±30%" means "the 95% band was authored at ±30%", not a hard bound or a 1-sigma band.

- **Jul 2021–Jan 2023** (0.5x–2x): The retained early monthly estimates are an exponential ramp fit to the ~1M rider-only milestone (first crossed Jan 2023, Waymo blog Feb 2023), informed by the Oct 2020 Phoenix rider-only launch (~0) and the tens of thousands of first-year Phoenix rider-only trips (KTAR, Oct 2021). The newly extracted California series begins December 2022; it has not been used to revise this earlier ramp. The window starts at July 2021 because that is the NHTSA SGO reporting floor (the earliest incident in the dataset); earlier Waymo miles (~0.15M) exist but have no reportable-incident numerator and are excluded from the series (published lifetime milestones are pinned minus that pre-series slice). Bands are the widest in the series. (A previous version of this ramp overshot the ~1M milestone ~4x, seeding a constant ~2.8M level offset carried through Sep 2025; re-baselined Jul 2026 — see the milestone-table note.)
- **Feb–Nov 2023** (±50%): The earlier sparse-milestone estimates and bands are retained. The Feb–Oct 2023 monthly profile is the previous allocation ×1.093, bridging the re-baselined early ramp to the 7.14M-through-Oct-2023 milestone; it has not been rebuilt from the newly extracted CPUC series.
- **Dec 2023–Jun 2024**: The earlier monthly centrals and ±35% allowances are retained, except that June's monthly bounds are constrained to agree with its refined cumulative boundary. The December 2023 source conflict above prevents treating all earlier anchors as settled.
- **Jul 2024–Mar 2026**: The 21 rebuilt months replace the uniform ±25–30% allowances with uncertainty on only the residual. Its log half-width is `0.20 * sqrt((n - 1) / 2)` for an `n`-month anchor interval; a single-month interval has no allocation uncertainty. Anchor uncertainty is included separately, with precision-based envelopes at June/July/December 2024 and January 2025, an additional measured September 2024 knot, and the existing explicit excluded-metro ranges at later knots. Forward and backward interval constraints reconcile the monthly and cumulative bounds. Calibration uses 30 California proxy months, January 2024–June 2026, with their monthly values masked and reconstructed from block totals; it does not validate national 95% coverage. The width is a fixed modeling prior, and the app interprets the final authored edges as its 95% prior interval. The formula and exact bounds are in data/README.md, Waymo monthly allocation.
- **Apr–Jun 2026** (≈ −9%/+11%): Built bottom-up on the hub's measured Q2 (Sep 24, 2026 update; re-chained 2026-09-25): CPUC Q2-2026 CA driverless actuals (posted Aug 18, 2026; deployment + pilot, TotalVMTZEV) × 1.058, the ratio of the hub's four CA counties to CPUC in Q2 (1.040 in Q1; ±3%) + the hub's measured Q2 increments for Maricopa (11.57M) and Travis (5.28M) split by the prior monthly shape (±10%) + the hub's measured Q2 Atlanta increment (3.25M) + the excluded-metro estimate (1.4M/1.45M/1.8M; ±40-50%). Rows: 18.03 / 18.51 / 18.83M (the 2026-08-28 build had 17.4 / 17.85 / 18.1M on Q1 run-rates; the pre-rebuild rows, 19.0/20.5/20.5M, had assumed the CA share falling to ~47-50%). Cross-check: June ≈ 4.4M mi/wk vs Waymo's Jun 24, 2026 "more than 4 million miles every week". Jun held ~flat for the May-21-to-end-June US freeway-ride suspension. **Jul–Sep 2026** (≈ −19%/+22% to −23%/+27%): same construction extended (CA on the CPUC basis ±10-15%, × 1.058 [1.040, 1.076]; Maricopa/Travis/Atlanta ±25%; the excluded metros grow to 2.0/2.3/2.85M as Dallas opened to all Aug 4, Houston Aug 20, Denver/San Diego/Tampa Sep 1, Las Vegas Sep 14, and San Antonio resumed Sep 17): 19.48 / 20.76 / 21.43M (September less ~0.1M for the Phoenix weather pauses of Sep 16-18 and Sep 29). Freeway rides resumed Jul 29 from Phoenix, LA/SF Bay ~first week of Aug, Austin Sep 22; Ojai open to all riders Aug 19-20. To be re-pinned from CPUC Q3 (~mid-Nov) and the hub update with data through Sep 2026 (~mid/late Dec).

### Notable events

- **Jun 2025 dip**: CPUC deployment + pilot data shows a 33.1% drop in CA VMT (from 5.355M in May to 3.582M in June); the rebuilt US estimate falls 16.3%, from 9.081M to 7.604M. This is explained by anti-ICE protests on June 8–9, 2025, during which protesters vandalized and set fire to Waymo vehicles in LA and SF. Waymo suspended service across both California markets for a significant portion of June, including expanded suspensions ahead of "No Kings" protests on June 14.

- **Pilot→deployment transition**: Waymo obtained its CPUC driverless deployment permit in Aug 2023, and deployment miles appear in that month's filing. In Dec 2023–Feb 2024, pilot VMT added ~12–16% on top of deployment. Pilot fell below 1% of the total in mid-2024 but rose to 6.8% in June 2026; both programs remain included.

- **Jun 2026 freeway recall**: Waymo recalled ~3,900 vehicles after its software failed to detect closed freeway construction zones in Arizona and California, driving into active work sites at speed (its sixth voluntary recall in ~2 years); freeway service was suspended pending a software fix, then resumed Jul 29, 2026, starting with Phoenix ([report](https://www.hngn.com/articles/271685/20260623/tesla-autopilot-crash-kills-texas-woman-waymo-recalls-3900-robotaxis-over-safety-failures.htm)). The current VMT series covers this: the suspension began May 21, 2026, and the Jun–Jul rows are held ~flat against it (freeway rides resumed Jul 29, Phoenix first). It remains a counterpoint to the headline 220.6M-mile safety framing — the Safety Impact comparisons are surface-street-weighted and do not capture this failure mode.

### Cross-references

- CPUC quarterly reports: https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting
- Waymo Safety Impact Hub: https://waymo.com/safety/impact/
- Kusano & Scanlon 56.7M-mile paper: https://pubmed.ncbi.nlm.nih.gov/40378124/
- Driverless Digest analysis: https://www.thedriverlessdigest.com/p/waymo-stats-2025-funding-growth-coverage
- Driverless Digest CPUC deadheading: https://www.thedriverlessdigest.com/p/what-cpuc-data-reveals-about-waymos



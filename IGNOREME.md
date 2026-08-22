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

- Jargon: the code calls the entity at the wheel a "helmer" (Tesla, Waymo, Zoox, or one of two human benchmark cohorts); the user-facing label for it is "helmsbeing". Or just "Company" if human drivers aren't included.
- Top chart: lines differentiated by thickness show MPI for each selected metric. Shaded fan bands show 50%/80%/95% Bayesian credible intervals; the error bar at each point is that month's 95% credible interval (the same quantity as the widest fan level and the tooltip's "Range" line), clamped to the plot area when it extends past the y-axis range.
- Three company charts: VMT line (with error bars) and incident bars by speed bucket, where darker sections indicate higher or unknown speed.
- Tesla mileage is anchored to Tesla's own disclosures: the "Cumulative Paid Robotaxi Miles" chart in the quarterly update decks, with monthly values vector-extracted from the Q4-2025, Q1-2026, and Q2-2026 deck PDFs (the decks' overlapping months agree within ~8k miles; 658k end-2025, 1.717M end-Mar-2026, 2.440M end-Jun-2026). Beyond the last deck anchor, months are extended by tracker activity ratios ([robotaxitracker.com](https://robotaxitracker.com/), [robotaxi-safety-tracker.com](https://robotaxi-safety-tracker.com/)) and re-pinned each earnings quarter. Dallas/Houston service (unsupervised launch Apr 18, 2026) is included from 2026-04 onward; the Bay Area is excluded — Tesla itself tracks it as a separate supervised series (Q3-2025 call: Bay Area has "crossed more than a million miles" with a driver-seat safety driver, vs the Austin fleet's "more than a quarter million"), outside the SGO driverless scope. The disclosed series reads as fleet service miles including deadhead — the same figures are described on the Q3-2025 call as miles the fleet has "covered", and the trackers' ~115 mi/vehicle/day model equates them to fleet-wide miles — but if "paid" is literally passenger-on-board miles the true denominator is higher, so the cumulative band carries one-directional upside (~15%). Scope note (resolved 2026-06-12): the disclosures are fleet-wide with no breakdown by monitor seating, so the denominator includes the post-Sep-2025 highway rides with the safety monitor in the driver's seat — which matches the incident numerator (Driver/Operator Type "None" plus Tesla's "In-Vehicle (Commercial / Test)"). (Historical: until 2026-07-22 the rows were tracker-interpolated between sparse verbal anchors, which left Aug-Sep 2025 ~3.8x high and end-Q1-2026 9% low vs the deck chart.)
- Waymo VMT is estimated by scaling [California CPUC driverless VMT](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (including deadhead) to all US cities using Waymo cumulative milestones. For Jul 2024 through Sep 2025 the error band is +/-25%; Oct-Dec 2025 use +/-30%; Jan-Mar 2026 are calibrated to Waymo's 220.6M-rider-only-mile cumulative through March 2026 (Safety Impact update, Jun 24, 2026), bridging from the 170.7M end-Dec-2025 anchor and consistent with the reported >4M rider-only miles/week (late Mar 2026), with +/-25% bands; later months extrapolate that rate with +/-30% bands. (Earlier months have wider bands; see the Waymo VMT Methodology section below.) Domestic-scope caveat: every anchor to date is US-only (the per-city breakdowns list only US cities), matching the US-only NHTSA SGO numerator — but Waymo began London operations in Apr 2026, so before recalibrating against any future cumulative-miles anchor, verify it hasn't started folding in international miles.
- Zoox VMT estimates draw on [CPUC quarterly reports](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (California-only paid miles) and [Las Vegas operations](https://techcrunch.com/2025/09/10/zoox-opens-its-las-vegas-robotaxi-service-to-the-public/), with the cumulative series anchored to three company milestones — 1.3M driverless public-road miles as of Dec 31, 2025 (Zoox's own letter to NHTSA, Jan 28, 2026, docket NHTSA-2025-0523-0004 p.22, superseding the earlier ~1M-late-2025 press floor), ~2M by late March 2026 (>350k riders), and >3M announced Aug 6, 2026, the middle one corroborated across multiple outlets ([Electrek](https://electrek.co/2026/03/09/zoox-expands-robotaxi-testing-phoenix-dallas-autonomous/), [The Robot Report](https://www.therobotreport.com/zoox-sets-geographic-milestones-product-features-robotaxi/)). Error bands were tightened from 0.5x-2x to 0.7x-1.3x (Jun 2026) now that those milestones bracket the series; the residual band reflects monthly-allocation uncertainty, scope ambiguity (company "autonomous miles" vs the NHTSA SGO public-road driverless scope), and milestone rounding. California DMV 2025 testing miles (~1.2M, mostly drivered) are out of scope and excluded.

### Statistical Method

- The colored band around each MPI line is a 95% Bayesian credible interval. Model: incidents ~ Poisson(lambda * m), where lambda is the rate (incidents per mile) and m is VMT. Jeffreys prior: lambda ~ Gamma(0.5, 0) (improper). Posterior after observing k incidents in m miles: lambda | k, m ~ Gamma(k + 0.5, m). MPI = 1/lambda; quantiles are inverted via a monotone decreasing transformation.
- The credible interval combines uncertainty from incident counts (Gamma-Poisson) and from VMT by marginalizing the posterior over a log-normal VMT prior whose 95% interval is [vmt_min, vmt_max] (median vmt): the displayed lo/hi are the exact 2.5%/97.5% quantiles of that marginal — the same distribution the probability-distribution chart draws. (Until 2026-08-21 the bounds were instead a conservative worst-case pairing — vmt_min with the upper lambda quantile and vice versa — which held 97.9-99.4% of the posterior rather than 95%.)
- The VMT data carries a calendar-coverage fraction for pro-rating partial months; currently every month is full (coverage = 1.0), June 2025 included. For the latest month, incident coverage is adjusted instead, because Monthly-track NHTSA reports may not yet be available (see the "incident coverage" sanity check on the page).
- The point estimate shown in the line is the median of that same marginal posterior over 1/lambda, not the simple ratio m/k. For small k (especially Tesla), the prior pulls the estimate slightly downward; for large k (Waymo), the difference is negligible.
- Fault-weighted incidents (thin line): each incident contributes its fault fraction (Claude's at-fault estimate) instead of one full count. Since the fractions are probabilities, the true at-fault count K is a Poisson-binomial random variable, and the posterior is the corresponding mixture over Gamma(K + 0.5, m) — reducing exactly to the plain posterior when every fraction is 0 or 1. (Fatality's 1/vehiclesInvolved fractions are deterministic allocations, not probabilities, and stay on the plain path.)
- **Tesla safety-monitor caveat:** Most Tesla robotaxi rides include a passenger-seat safety monitor. Tesla classifies these as unsupervised (no operator) for NHTSA reporting, but the monitors may intervene to prevent incidents. If so, Tesla's true unsupervised MPI would be lower (worse) than shown.

### Human Comparison Methodology

Human baselines are shown as shaded bands (range of plausible values) rather than single lines, and since 2026-06-11 come in two cohorts displayed as separate "helmers" (two shades of gold): **Humans (AV cities)** — the bands described below, surface streets in AV operating areas — and **Humans (US average)** — nationwide CRSS/FARS crashed-vehicle rates across all road types, Blincoe-adjusted at the low end. The US-average cohort has no bands for the hospitalization, airbag, and serious-injury metrics (no clean national equivalents exist), and the stress test plus the "Nx vs humans" card multipliers compare against the AV-cities cohort, the more apples-to-apples baseline. For injury, airbag, and serious-injury+, the AV-cities bands are set directly from [Kusano & Scanlon's 56.7M-mile location-weighted benchmarks](https://arxiv.org/abs/2505.01515) (the surface-street human rates Waymo/Piper cite): each spans the per-city range (Phoenix lowest to San Francisco highest) and is geometrically centered on the mileage-blended value (any-injury 4.04, airbag 1.69, serious+ 0.24 IPMM), so for these three the cohort *is* the location-weighted benchmark, not an approximation. The all-crashes band remains our own synthesis of [Kusano & Scanlon (2024)](https://arxiv.org/abs/2312.12675) observed-to-Blincoe-adjusted rates (surface streets, passenger vehicles, underreporting-corrected; see also [this analysis](https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos)). We still don't reproduce Waymo's full pipeline (its dynamic intra-city weighting and exact outcome definitions), and [Waymo's own safety page](https://waymo.com/safety/impact/) concurs with these anchors. Note also that the app's default metric (fault-weighted "at-fault" incidents, any severity, as of 2026-06-12) is broader than Waymo's surface-street, injury-focused framing — it includes minor property-damage contacts that injury-based comparisons exclude, which is why its human band's low anchor collapses to the all-crash low anchor (see the at-fault derivation note in `crashla.js`).

- **Band interpretation:** For injury/airbag/serious-injury+, the band spans the per-city human-rate range from Kusano 56.7M (San Francisco at the low-MPI end, Phoenix at the high-MPI end), centered on the mileage-blended value — it reflects how much the comparable human rate varies by where Waymo drives. For all-crashes, the band spans observed-to-Blincoe-adjusted rates (the ~60%-minor-crash underreporting range). The true apples-to-apples MPI should fall within each band.
- **Surface streets, not nationwide:** Human benchmarks are restricted to surface streets in AV operating areas (higher crash rates, lower fatality rates than the national average), following the Kusano/Scanlon approach.
- **Hospitalization band is wide:** The SGO's "W/ Hospitalization" (transported to hospital, incl. ER visits for minor injuries) has no direct human equivalent. The band spans from the airbag-deployment benchmark (crashes with significant impact) to the suspected-serious-injury+ benchmark.

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

**Update — Waymo Safety Impact, [Jun 24, 2026](https://waymo.com/blog/shorts/safetydata-june26/) (220.6M rider-only miles through Mar 2026):** the same rate comparison now reads any-injury 0.71 vs 3.91 IPMM (82% fewer), airbag-in-any-vehicle 0.30 vs 1.68 (82% fewer), and serious/fatal 0.01 vs 0.23 (94% fewer) — each slightly stronger for Waymo than the figures Piper cited. New vulnerable-road-user breakdowns: 93% fewer pedestrian, 84% fewer cyclist, 84% fewer motorcyclist injury crashes.

How our data compares:

1. **Default view roughly agrees with her multiples (since 2026-06-12).** Our default metric is now at-fault MPI, where Waymo shows roughly an order of magnitude more at-fault miles per incident than the AV-cities human geometric-mean benchmark; stress-testing against the band edges, the robust range stays well above parity at its low edge and reaches into the tens at its high edge. That sits at the upper end of Piper's 5–10x serious-crash multiples, though measured on a different construct (fault-weighted incidents of any severity vs injury severity tiers). The raw "all incidents" view, formerly the default, hovers around parity (roughly half-x to a couple-x across the band), reflecting reporting-threshold mismatch more than safety. (Live figures are on the page; we keep prose qualitative here because the exact multiples drift with each data refresh.)

2. **Miles are compatible — and now confirmed well past 200M.** Piper said "over 200 million" for Waymo total; that milestone was confirmed Feb 23, 2026 (https://www.benzinga.com/markets/tech/26/03/50953948), and Waymo's Jun 24, 2026 Safety Impact update reports 220.6M rider-only miles through end of March 2026 (per-city: Phoenix 80.6M, SF Bay 67.1M, LA 51.8M, Austin 15.8M, Atlanta 5.4M). Earlier snapshots: 127M through Sep 2025, 170.7M through Dec 2025. Waymo defines "rider-only miles" as miles without a human driver in cities where it operates; we treat that as including deadhead and overhead, matching the CPUC `TotalVMTZEV` definition — an assumption our VMT estimates depend on but that the Waymo page alone does not establish. Our Waymo VMT series is now anchored to land on 220.6M cumulative through Mar 2026 by construction; before this recalibration it estimated 225.2M (~2% high), confirming the methodology was well-calibrated.

3. **Reporting asymmetry.** Piper acknowledges Waymo may report more crashes due to better reporting but doesn't quantify this. Our human baselines explicitly address it: Kusano/Scanlon provide both Blincoe-adjusted rates (catching underreported human crashes) and police-reported rates. The lo–hi range in our human MPI benchmarks spans this uncertainty. Additionally, 43% of Waymo collisions involve <1 mph delta-V per Waymo's safety page — incidents that would almost never be police-reported for human drivers.

4. **Fault attribution.** Piper doesn't discuss who's at fault. Our AI fault-fraction analysis shows many of Waymo's ~503 incidents were caused by other drivers. Fault-weighting makes Waymo look even safer than the raw incident count suggests.

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
coverage=1.0 in the VMT data means "VMT and incidents are already aligned" — no pro-rating needed.
(Historical: the window was originally framed as June 15 – December 15, 2025, matching the first data pull; that framing survives in older notes above but the data has been full-June ever since the archive merge gave June full incident coverage.)
For the latest month, NHTSA's Monthly-track reports may not all be filed yet, so an incident-coverage factor thins the effective VMT instead (see the "Incident coverage for partial months" sanity check on the page).

### The three datasets combined here

1. **NHTSA SGO incident reports** (the numerator).
   Two CSVs — a "current" one and an "archive" for 2021–2025 — are fetched and merged by `data/slurp.py`.
   Archival raw fetch snapshots live under `data/snapshots/`.
   The archive is needed because some June incidents were filed late and ended up in the archive rather than the current CSV.
   After deduplication (keeping highest Report Version per Same Incident ID) and filtering to each company's public robotaxi service (Driver/Operator Type = "None", plus "In-Vehicle (Commercial / Test)" and "Remote (Commercial / Test)" for Tesla), we get 2,049 incidents as of the latest fetch (2026-08-17): 1,981 Waymo, 24 Tesla, 44 Zoox. These counts grow with each slurp run.

2. **Vehicle Miles Traveled (VMT)** (the denominator).
   Maintained in `data/vmt.csv` (the in-repo master) and embedded in `data/vmt.js` by `data/slurp.py`.
   Each company's mileage comes from different public sources:
   - **Tesla**: Tesla's own quarterly-deck "Cumulative Paid Robotaxi Miles" chart, monthly values vector-extracted from the deck PDFs (Texas service: Austin, plus Dallas/Houston from their Apr 2026 unsupervised launch; Bay Area excluded — Tesla tracks it as a separate supervised series, outside the public-service scope); robotaxitracker.com activity ratios extend the months past the last deck anchor.
   - **Waymo**: See "Waymo VMT Methodology" section below.
   - **Zoox**: US estimates anchored to two company milestones (~1M autonomous miles by late 2025, ~2M by late March 2026; 0.7×–1.3× error band), with monthly detail interpolated from California CPUC and Las Vegas operations. California DMV testing miles are out of scope.

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
   Each filing contains a `Month-Level` CSV with monthly VMT broken into three periods:
   - `TotalVMTPeriod1`: idle/repositioning miles after a trip, before the next assignment
   - `TotalVMTPeriod2`: deadhead miles (en route to pickup)
   - `TotalVMTPeriod3`: miles with a passenger aboard
   - `TotalVMTZEV`: sum of all three = total driverless CA VMT

   (Period numbering follows the CPUC/TNC convention: P3 is the passenger-aboard
   period. P1+P2 — Waymo's deadheading — was 44.3% of CA driverless VMT in
   Sep 2025, down from 51.5% in Jan 2024, per Driverless Digest's CPUC analysis.)

   This is exactly the right denominator for MPI: all driverless miles, not just revenue miles.
   Waymo files under two programs: **deployment** (commercial, fare-charging) and **pilot** (no fares).
   Both are included. Before Dec 2023, all CA driverless VMT was pilot-only.
   By mid-2024, pilot VMT dropped below 1% of total and is negligible.

2. **Waymo cumulative US milestones** (for CA→US scaling):
   Waymo periodically publishes cumulative all-time rider-only miles (all driverless VMT, all US cities).
   These are used to anchor the CA→US scaling factor.

   | Date | Cumulative US Driverless Miles | Source |
   |------|------------------------------:|--------|
   | ~Jan 2023 | ~1M (first crossed) | Waymo blog |
   | End Oct 2023 | 7.14M | Waymo safety paper (NHTSA SGO data) |
   | End 2023 | ~9.3M | Driverless Digest / Waymo |
   | End Jun 2024 | 22M | Waymo Safety Hub |
   | End Jul 2024 | 25M | Waymo Safety Hub update |
   | End Dec 2024 | 50M | Year-in-review |
   | End Jan 2025 | 56.7M | Academic paper (Traffic Injury Prevention) |
   | End Mar 2025 | ~71M | Driverless Digest |
   | End Jun 2025 | 96M | Waymo Safety Hub |
   | End Sep 2025 | 127M | Waymo Safety Hub geographic breakdown |
   | ~Feb 14, 2026 | ~200M | Waymo X post ("nearly 200M" Feb 6; "over 200M" Feb 23) |
   | End Mar 2026 | 220.6M | Waymo Safety Impact update (Jun 24, 2026); per-city PHX 80.6M / SF 67.1M / LA 51.8M / ATX 15.8M / ATL 5.4M |

   Note: Waymo defines "rider-only miles" as miles with no human driver in cities where Waymo operates. We treat this as including deadhead and overhead — i.e., all driverless VMT, the CPUC `TotalVMTZEV` definition — which is an assumption of this methodology; the Waymo page alone does not establish that equivalence.

   Note: every published figure above is pinned as an exact *central* estimate, minus ~0.15M pre-series miles (driverless miles before the series' Jul-2021 SGO start), with the `kyoom_min`/`kyoom_max` band expressing the milestone's rounding/timing uncertainty. Historical note: through Jul 2026 these figures were instead encoded as lower-bound *floors* with the best-estimate cumulative running a constant ~2.8M above them — a level offset seeded by an early-ramp interpolation that overshot the ~1M-Jan-2023 milestone ~4x. The re-baseline (Jul 2026) subtracted that constant, which landed every milestone month at exactly (published − 0.15M) — confirming the CPUC-scaled monthly *profile* had been well-calibrated all along — and raised the default-window (Jun-2025+) Waymo VMT ~1.7%, since the old offset was absorbed back to zero by the exact Dec-2025 pin inside the window. quals/waymo-vmt-provenance.qual pins all of these milestones.

### Scaling methodology

For each interval between consecutive US milestones:
1. Sum the monthly CA driverless VMT (pilot + deployment) across all months in the interval.
2. The total US VMT for that interval = difference between the two milestones.
3. Distribute the US VMT proportionally to each month's share of the CA total.

This assumes the CA share of US miles is approximately constant within each milestone interval.
In practice, the CA share evolved over time as Waymo expanded:

| Period | Implied CA share | Notes |
|--------|----------------:|-------|
| Jun–Oct 2023 | ~14% | SF pilot only; Phoenix dominant |
| Nov–Dec 2023 | ~24% | Deployment program launches in Dec |
| Jan–Jun 2024 | ~32% | LA launching; Phoenix still dominant |
| Jul 2024 | ~48% | LA ramping up |
| Aug–Dec 2024 | ~52% | LA fully ramped |
| Jan–Sep 2025 | ~55% | Stable |
| Oct–Dec 2025 | ~56% | CPUC Q4-2025 actuals (24.74M CA) vs the milestone-bridged 43.85M US |
| Jan–Mar 2026 | ~53% | CPUC Q1-2026 actuals (26.41M CA incl. pilot) vs the milestone-bridged 49.9M US; Austin/Atlanta expansion |

Geographic breakdown through Sep 2025 (from Waymo Safety Hub):
Phoenix 44.5%, San Francisco 30.6%, Los Angeles 20.1%, Austin 5.0%.

Updated cumulative breakdown through Mar 2026 (Waymo Safety Impact update, Jun 24, 2026; 220.6M total):
Phoenix 80.6M (36.5%), San Francisco Bay Area 67.1M (30.4%), Los Angeles 51.8M (23.5%), Austin 15.8M (7.2%), Atlanta 5.4M (2.4%, new). California markets (SF + LA) = 53.9% of cumulative miles, consistent with the ~51–55% CA-share assumption.

### Uncertainty bands

- **Jul 2021–Jan 2023** (0.5x–2x): Pre-CPUC pilot era, before the CPUC-scaled anchors begin. No monthly CA driverless VMT exists to scale from, so monthly all-driverless miles are an exponential ramp fit to the ~1M rider-only milestone (first crossed Jan 2023, Waymo blog Feb 2023), informed by the Oct 2020 Phoenix rider-only launch (~0) and the tens of thousands of first-year Phoenix rider-only trips (KTAR, Oct 2021). The window starts at July 2021 because that is the NHTSA SGO reporting floor (the earliest incident in the dataset); earlier Waymo miles (~0.15M) exist but have no reportable-incident numerator and are excluded from the series (published lifetime milestones are pinned minus that pre-series slice). Bands are the widest in the series. (A previous version of this ramp overshot the ~1M milestone ~4x, seeding a constant ~2.8M level offset carried through Sep 2025; re-baselined Jul 2026 — see the milestone-table note.)
- **Feb–Nov 2023** (±50%): Sparse milestones, pilot era. Pilot-only CA VMT is very small (17K–255K/month). The CA share is uncertain (~14%) and the proportional distribution within milestone intervals may not capture intra-interval growth patterns. The Feb–Oct 2023 monthly profile is the CPUC-scaled original ×1.093, bridging the re-baselined early ramp to the 7.14M-through-Oct-2023 milestone.
- **Dec 2023–Jun 2024** (±35%): First deployment period. CA share was shifting as LA launched (~24% → ~33%). Cumulative milestone endpoints are known but monthly allocation is approximate.
- **Jul 2024–Sep 2025** (±25%): Tight milestone brackets. CA share is stable (~52–55%).
- **Oct–Dec 2025** (±30%): Bridges Waymo's published cumulative anchors — 127M end-Sep to the exact 170.7M end-Dec 2025 pin (the CPUC-shaped monthly profile ×1.069, since the pre-re-baseline series had absorbed its level offset across this interval); CPUC CA VMT plateaued at ~8.4M/month (Q4-2025 actuals: Oct 7.90M, Nov 8.41M, Dec 8.42M) while US VMT grew modestly as Austin expanded; implied average CA share 56.4% (24.74M CA / 43.85M US).
- **Jan–Mar 2026** (±25%): Anchored to Waymo's 220.6M rider-only miles through March 2026 (Safety Impact update, Jun 24, 2026), bridging from the 170.7M end-Dec-2025 anchor; the implied ~17.7M March (~4.1M/week) matches the co-CEO's >4M rider-only miles/week at ~500k paid trips/week (late Mar 2026). The lower band at March is floored at the confirmed 220M milestone. Out-of-sample check (2026-07-24): CPUC Q1-2026 actuals (CA driverless 9.09M/8.19M/9.11M Jan/Feb/Mar, deployment + ~20k/mo pilot) imply a 52.9% CA share and match this series' monthly shape within ~4%.
- **Apr–May 2026** (±30%): Extrapolated from the 220.6M end-Mar-2026 anchor at the late-Mar weekly rate with modest growth (~3,600-3,750 vehicles).

### Notable events

- **Jun 2025 dip**: CPUC data shows a ~33% drop in CA VMT (from 5.34M in May to 3.57M in June). This is explained by anti-ICE protests on June 8–9, 2025, during which protesters vandalized and set fire to Waymo vehicles in LA and SF. Waymo suspended service across both California markets for a significant portion of June, including expanded suspensions ahead of "No Kings" protests on June 14.

- **Pilot→deployment transition**: Waymo obtained its CPUC driverless deployment permit in Aug 2023. Before Dec 2023, all CA driverless VMT was under the pilot program. In Dec 2023–Feb 2024, pilot VMT added ~12–15% on top of deployment. By mid-2024, pilot dropped below 1%.

- **Jun 2026 freeway recall**: Waymo recalled ~3,900 vehicles after its software failed to detect closed freeway construction zones in Arizona and California, driving into active work sites at speed (its sixth voluntary recall in ~2 years); freeway service was suspended pending a software fix, then resumed Jul 29, 2026, starting with Phoenix ([report](https://www.hngn.com/articles/271685/20260623/tesla-autopilot-crash-kills-texas-woman-waymo-recalls-3900-robotaxis-over-safety-failures.htm)). This post-dates the May 2026 window so it does not affect the current VMT series, but it will dampen Waymo's June-onward freeway miles and is a counterpoint to the headline 220.6M-mile safety framing — the Safety Impact comparisons are surface-street-weighted and do not capture this failure mode.

### Cross-references

- CPUC quarterly reports: https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting
- Waymo Safety Impact Hub: https://waymo.com/safety/impact/
- Kusano & Scanlon 56.7M-mile paper: https://pubmed.ncbi.nlm.nih.gov/40378124/
- Driverless Digest analysis: https://www.thedriverlessdigest.com/p/waymo-stats-2025-funding-growth-coverage
- Driverless Digest CPUC deadheading: https://www.thedriverlessdigest.com/p/what-cpuc-data-reveals-about-waymos



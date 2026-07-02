Other name ideas:

* Via et Veritas
* Bayes Against the Machine


# How safe are robotaxis?

https://agifriday.substack.com/p/crashla
https://agifriday.substack.com/p/crashla2

We know Waymos are much safer than human drivers:
https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos

What about Tesla robotaxis and Zooxes?

Electrek claims Tesla robotaxis crash more than human drivers:
https://electrek.co/2026/01/29/teslas-own-robotaxi-data-confirms-crash-rate-3x-worse-than-humans-even-with-monitor/

NHTSA data source:
https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting
(2025 June 15 through 2025 December 15) [AI note: the window now rolls forward as NHTSA publishes data — it always runs through the most recent month available, with no fixed window-end constant in the code.]
https://docs.google.com/spreadsheets/d/1r4hEVKOzE9sLLWmbB0Tzwzpo7aoUadmhxDY1imd5tb8/edit?usp=sharing
518 incidents after deduping and filtering to operator=none

https://www.austintexas.gov/page/autonomous-vehicles

Key dates for Tesla robotaxi 
* 2025-06-27: Launch in Austin with empty driver's seat
* 2025-09-01: Highway rides added (with safety monitor moved to driver's seat)

Crowdsourced robotaxi trackers:
* https://robotaxitracker.com/
* https://teslafsdtracker.com

According to robotaxitracker.com:
Tesla robotaxi miles prior to Sep 1: 93,849
Tesla robotaxi miles prior to Dec 16: 456,099
UNKNOWN: fraction of the Sep 1+ rides with empty driver's seat.

(Note: We're not worrying about the distinction between rides with a passenger-seat safety monitor and the unsupervised rides with no safety monitor in the car at all. As long as the driver's seat is empty, those miles count for the denominator we want for determining how often robotaxis have incidents in the NHTSA database.)


## Finding the Denominators

For each of these self-driving car companies, we need a lower bound and upper bound on the total miles they drove in the US at SAE level 3+ from 2025-06-15 thru 2025-12-15: [AI note: window now rolls forward monthly as NHTSA publishes new data]

1. Waymo
2. Tesla
3. Zoox

Tesla is a very unusual case. They've had in-car supervision for most rides with their passenger-seat safety monitors. But, per the NHTSA incident database, Tesla is averring to NHTSA that those rides have no operator, ie, that they count as SAE level 3+. So that's what we're going with here. That means we need to estimate Tesla's robotaxi mileage for the subset of rides that had an empty driver's seat. Whether a human was in the passenger seat is not relevant here.

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

For Vehicle Miles Traveled (VMT) we also need to include miles traveled with no customer in the car.
But if we're consistent about paid miles for all companies, that's hopefully an apples-to-apples comparison, scaling the true VMT by the same amount for everyone.

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

# Spec

Inspiration for this tool:
https://www.aifuturesmodel.com/forecast/

We want something similar to that but for answering the question about how safe Teslas, Waymos, and Zooxes are.

For each company, we want sliders for the uncertain parameters and then we want to estimate, with confidence intervals, the number of miles between incidents.

Having a nice way to browse the data would also be nice.

We need to carefully de-dup/consolidate the incidents. 
Sometime an entry is actually an update to a previous entry. 
For example, there are 10 entries for Tesla corresponding to 9 distinct incidents.

Note that we only care about incidents in this dataset where the "Driver / Operator Type" field is "None".

All 9 of the Tesla incidents have this designation, so Tesla is averring to NHTSA that their passenger-seat safety monitors do not count as supervised autonomy, and same for any tele-operation they may have. We'll give Tesla the benefit of the doubt on this, even though they have not exactly earned it.
For the denominator mileage we need justifiable lower and upper bounds on the mileage for which there was no driver/operator.

---

i've just added vmt.csv for the denominators. i'm thinking we start with a time series with all the data we have (red for tesla, blue for waymo, and green for zoox) on one graph. mileage with error bars as a line graph. and the incidents as bars -- red/green/blue side-by-side for each month. and how about a stacked bar chart with brighter sections for higher speeds. any 0mph incidents are shown as the topmost layer of each bar and appear mostly grayed out. is that all making sense? any other ideas for capturing all this data visually in order to get a sense of the miles-per-incident for each company?

ps, here's the prompt i used to get Deep Research to estimate the VMTs:

In the NHTSA database of ADS incidents from June 15 to January 15, 2026, if we de-duplicate and filter down to those incidents with no human operator, we have these numbers: 
* Tesla: 14 incidents 
* Zoox: 12 incidents 
* Waymo: 492 incidents (note one incident from april which we filter out for not being in range for the rest of the data)
We're working on comparing the safety of these 3 robotaxi companies, -- incidents per mile. So we need to estimate those denominators. This takes very careful research. For example, Tesla publishes mileage that includes robotaxi rides with a safety driver in the driver's seat. That needs to be excluded since Tesla only reports incidents in the ADS data set when the driver's seat is empty. (Passenger seat monitors don't count, according to Tesla, and we're accepting that.) Likewise, Waymo publishes *paid* miles but their incident reports include unpaid miles so we need to estimate paid and unpaid unsupervised Waymo miles. 

Please give your best estimates of the unsupervised mileage in that time frame for each of the three companies, along with a lower bound and upper bound for each. And do keep the big picture in mind, that we need an apples-to-apples comparison across these companies.

---

can you make a file called faultfrac.csv that, for every Report ID in data/snapshots/nhtsa-2025-jun-2026-jan.csv for which Operator=None, gives an estimated fraction at-fault for the AV? make sure to use the latest version of each incident. it should have the following columns:

* reportID [from the NHTSA dataset; must be unique]
* speed [mph of subject vehicle]
* crashwith [eg, "SUV" or "fixed object"]
* svhit [what part of the subject vehicle made contact with crash partner]
* cphit [what part of the crash partner (see crashwith) made contact with subject vehicle]
* severity [eg, "minor injury"]
* faultfrac [fractional/probalistic blame we subjectively assign to the AI driver specifically; AV passenger fault does not count, nor mechanical failures like the wheels falling off the car; sensor failures do count as the fault of the artificial driver]
* reasoning [short blurb explaining why we're assigning that faultfrac]

---

## [AI TEXT] Explanatory Note

This page aims to compare "miles per incident" across Tesla, Waymo, and Zoox using [NHTSA SGO](https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting) incident reports. The analysis window rolls forward as NHTSA publishes new data: the default view starts June 15, 2025 and extends through the most recent month NHTSA has published (the date slider reaches back to July 2021 for Waymo). Incident data comes from both the current and [archive](https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADS.csv) NHTSA CSVs so that June 2025 (starting June 15) has full incident coverage.

Context:
[agifriday.substack.com/crashla](https://agifriday.substack.com/crashla/) and
[agifriday.substack.com/crashla2](https://agifriday.substack.com/crashla2/)

VMT master data: `data/vmt.csv` in this repo. (Formerly maintained in a [Google Sheet](https://docs.google.com/spreadsheets/d/1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w/edit?gid=844581871#gid=844581871), migrated verbatim into the repo 2026-06-11; the sheet is now retired.)

- Jargon: the code calls the entity at the wheel a "helmer" (Tesla, Waymo, Zoox, or one of two human benchmark cohorts); the user-facing label for it is "helmsbeing". Or just "Company" if human drivers aren't included.
- Top chart: lines differentiated by thickness show MPI for each selected metric. Shaded fan bands show 50%/80%/95% Bayesian credible intervals; the error bar at each point is that month's 95% credible interval (the same quantity as the widest fan level and the tooltip's "Range" line), clamped to the plot area when it extends past the y-axis range.
- Three company charts: VMT line (with error bars) and incident bars by speed bucket, where darker sections indicate higher or unknown speed.
- Tesla mileage assumptions are anchored to tracker sources ([robotaxitracker.com](https://robotaxitracker.com/) and [robotaxi-safety-tracker.com](https://robotaxi-safety-tracker.com/)) and then aligned to this same NHTSA window for apples-to-apples comparison. Dallas/Houston service (unsupervised launch Apr 18, 2026) is included from 2026-04 onward. Scope note (resolved 2026-06-12): both trackers anchor to Tesla's fleet-wide disclosures (e.g. ~115 mi/vehicle/day across the whole Austin fleet, per Tesla's Q3 2025 earnings) with no breakdown by monitor seating, so the denominator includes the post-Sep-2025 highway rides with the safety monitor in the driver's seat — which matches the incident numerator (Driver/Operator Type "None" plus Tesla's "In-Vehicle (Commercial / Test)"). An earlier rationale in `data/vmt.csv` wrongly described these miles as "netted to empty driver-seat miles".
- Waymo VMT is estimated by scaling [California CPUC driverless VMT](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (including deadhead) to all US cities using Waymo cumulative milestones. For Jul 2024 through Sep 2025 the error band is +/-25%; Oct-Dec 2025 use +/-30%; Jan-Mar 2026 are calibrated to Waymo's 220.6M-rider-only-mile cumulative through March 2026 (Safety Impact update, Jun 24, 2026), bridging from the 170.7M end-Dec-2025 anchor and consistent with the reported >4M rider-only miles/week (late Mar 2026), with +/-25% bands; later months extrapolate that rate with +/-30% bands. (Earlier months have wider bands; see the Waymo VMT Methodology section below.)
- Zoox VMT estimates draw on [CPUC quarterly reports](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (California-only paid miles) and [Las Vegas operations](https://techcrunch.com/2025/09/10/zoox-opens-its-las-vegas-robotaxi-service-to-the-public/), with the cumulative series anchored to two company milestones — ~1M autonomous miles by late 2025 (>300k riders) and ~2M by late March 2026 (>350k riders), each corroborated across multiple outlets ([Electrek](https://electrek.co/2026/03/09/zoox-expands-robotaxi-testing-phoenix-dallas-autonomous/), [The Robot Report](https://www.therobotreport.com/zoox-sets-geographic-milestones-product-features-robotaxi/)). Error bands were tightened from 0.5x-2x to 0.7x-1.3x (Jun 2026) now that those milestones bracket the series; the residual band reflects monthly-allocation uncertainty, scope ambiguity (company "autonomous miles" vs the NHTSA SGO public-road driverless scope), and milestone rounding. California DMV 2025 testing miles (~1.2M, mostly drivered) are out of scope and excluded.

### Statistical Method

- The colored band around each MPI line is a 95% Bayesian credible interval. Model: incidents ~ Poisson(lambda * m), where lambda is the rate (incidents per mile) and m is VMT. Jeffreys prior: lambda ~ Gamma(0.5, 0) (improper). Posterior after observing k incidents in m miles: lambda | k, m ~ Gamma(k + 0.5, m). MPI = 1/lambda; quantiles are inverted via a monotone decreasing transformation.
- The credible interval combines uncertainty from incident counts (Gamma-Poisson) and from VMT (vmt_min/vmt_max) conservatively: the lower MPI bound uses vmt_min with the upper lambda quantile, and the upper MPI bound uses vmt_max with the lower lambda quantile. This yields the widest possible band.
- For partial months (June 15–30 and January 1–15), VMT is pro-rated by the calendar coverage fraction. For January, incident coverage is also adjusted because Monthly-track NHTSA reports may not yet be available (see the "incident coverage" sanity check on the page).
- The point estimate shown in the line is the Bayesian posterior median of 1/lambda, not the simple ratio m/k. For small k (especially Tesla), the prior pulls the estimate slightly downward; for large k (Waymo), the difference is negligible.
- Fault-weighted incidents (thin line): each incident contributes its fault fraction (Claude's at-fault estimate) instead of one full count. The sum of fractions is treated as a pseudo-Poisson count; this is a heuristic but reasonable approximation.
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

The NHTSA Standing General Order (SGO) analysis window starts **June 15, 2025** (the default view) and rolls forward as NHTSA publishes new data, always extending through the most recent published month.
June 2025 is therefore a partial month (June 15–30 only).
Its VMT figure is pre-adjusted to match that partial window, so coverage=1.0 in the VMT data means "VMT and incidents are already aligned" — no further pro-rating needed.
For the latest month, NHTSA's Monthly-track reports may not all be filed yet, so an incident-coverage factor thins the effective VMT instead (see the "Incident coverage for partial months" sanity check on the page).

### The three datasets combined here

1. **NHTSA SGO incident reports** (the numerator).
   Two CSVs — a "current" one and an "archive" for 2021–2025 — are fetched and merged by `data/slurp.py`.
   Archival raw fetch snapshots live under `data/snapshots/`.
   The archive is needed because some June incidents were filed late and ended up in the archive rather than the current CSV.
   After deduplication (keeping highest Report Version per Same Incident ID) and filtering to each company's public robotaxi service (Driver/Operator Type = "None", plus "In-Vehicle (Commercial / Test)" for Tesla's monitored Austin service), we get 1,836 incidents as of the latest fetch: 1,783 Waymo, 18 Tesla, 35 Zoox. These counts grow with each slurp run.

2. **Vehicle Miles Traveled (VMT)** (the denominator).
   Maintained in `data/vmt.csv` (the in-repo master) and embedded in `data/vmt.js` by `data/slurp.py`.
   Each company's mileage comes from different public sources:
   - **Tesla**: robotaxitracker.com cumulative deltas (Austin only; Bay Area excluded per Tesla's Q3 earnings call).
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
| Oct 2025–Mar 2026 | ~51% | Calibrated from the 200M and 220.6M milestones; Austin/Atlanta expansion |

Geographic breakdown through Sep 2025 (from Waymo Safety Hub):
Phoenix 44.5%, San Francisco 30.6%, Los Angeles 20.1%, Austin 5.0%.

Updated cumulative breakdown through Mar 2026 (Waymo Safety Impact update, Jun 24, 2026; 220.6M total):
Phoenix 80.6M (36.5%), San Francisco Bay Area 67.1M (30.4%), Los Angeles 51.8M (23.5%), Austin 15.8M (7.2%), Atlanta 5.4M (2.4%, new). California markets (SF + LA) = 53.9% of cumulative miles, consistent with the ~51–55% CA-share assumption.

### Uncertainty bands

- **Jul 2021–Jan 2023** (0.5x–2x): Pre-CPUC pilot era, before the CPUC-scaled anchors begin. No monthly CA driverless VMT exists to scale from, so monthly all-driverless miles are an exponential ramp fit to the ~1M rider-only milestone (first crossed Jan 2023, Waymo blog Feb 2023), informed by the Oct 2020 Phoenix rider-only launch (~0) and the tens of thousands of first-year Phoenix rider-only trips (KTAR, Oct 2021). The window starts at July 2021 because that is the NHTSA SGO reporting floor (the earliest incident in the dataset); earlier Waymo miles (~0.15M) exist but have no reportable-incident numerator and are excluded from the series (published lifetime milestones are pinned minus that pre-series slice). Bands are the widest in the series. (A previous version of this ramp overshot the ~1M milestone ~4x, seeding a constant ~2.8M level offset carried through Sep 2025; re-baselined Jul 2026 — see the milestone-table note.)
- **Feb–Nov 2023** (±50%): Sparse milestones, pilot era. Pilot-only CA VMT is very small (17K–255K/month). The CA share is uncertain (~14%) and the proportional distribution within milestone intervals may not capture intra-interval growth patterns. The Feb–Oct 2023 monthly profile is the CPUC-scaled original ×1.093, bridging the re-baselined early ramp to the 7.14M-through-Oct-2023 milestone.
- **Dec 2023–Jun 2024** (±35%): First deployment period. CA share was shifting as LA launched (~24% → ~33%). Cumulative milestone endpoints are known but monthly allocation is approximate.
- **Jul 2024–Sep 2025** (±25%): Tight milestone brackets. CA share is stable (~52–55%).
- **Oct–Dec 2025** (±30%): Bridges Waymo's published cumulative anchors — 127M end-Sep to the exact 170.7M end-Dec 2025 pin (the CPUC-shaped monthly profile ×1.069, since the pre-re-baseline series had absorbed its level offset across this interval); CPUC CA VMT plateaued at ~8.4M/month while US VMT grew modestly as Austin expanded; average CA share ~51%, down from ~55% in Q3.
- **Jan–Mar 2026** (±25%): Anchored to Waymo's 220.6M rider-only miles through March 2026 (Safety Impact update, Jun 24, 2026), bridging from the 170.7M end-Dec-2025 anchor; the implied ~17.7M March (~4.1M/week) matches the co-CEO's >4M rider-only miles/week at ~500k paid trips/week (late Mar 2026). The lower band at March is floored at the confirmed 220M milestone.
- **Apr–May 2026** (±30%): Extrapolated from the 220.6M end-Mar-2026 anchor at the late-Mar weekly rate with modest growth (~3,000 vehicles).

### Notable events

- **Jun 2025 dip**: CPUC data shows a ~33% drop in CA VMT (from 5.34M in May to 3.57M in June). This is explained by anti-ICE protests on June 8–9, 2025, during which protesters vandalized and set fire to Waymo vehicles in LA and SF. Waymo suspended service across both California markets for a significant portion of June, including expanded suspensions ahead of "No Kings" protests on June 14.

- **Pilot→deployment transition**: Waymo obtained its CPUC driverless deployment permit in Aug 2023. Before Dec 2023, all CA driverless VMT was under the pilot program. In Dec 2023–Feb 2024, pilot VMT added ~12–15% on top of deployment. By mid-2024, pilot dropped below 1%.

- **Jun 2026 freeway recall**: Waymo recalled ~3,900 vehicles after its software failed to detect closed freeway construction zones in Arizona and California, driving into active work sites at speed (its sixth voluntary recall in ~2 years); freeway service was suspended pending a software fix ([report](https://www.hngn.com/articles/271685/20260623/tesla-autopilot-crash-kills-texas-woman-waymo-recalls-3900-robotaxis-over-safety-failures.htm)). This post-dates the May 2026 window so it does not affect the current VMT series, but it will dampen Waymo's June-onward freeway miles and is a counterpoint to the headline 220.6M-mile safety framing — the Safety Impact comparisons are surface-street-weighted and do not capture this failure mode.

### Cross-references

- CPUC quarterly reports: https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting
- Waymo Safety Impact Hub: https://waymo.com/safety/impact/
- Kusano & Scanlon 56.7M-mile paper: https://pubmed.ncbi.nlm.nih.gov/40378124/
- Driverless Digest analysis: https://www.thedriverlessdigest.com/p/waymo-stats-2025-funding-growth-coverage
- Driverless Digest CPUC deadheading: https://www.thedriverlessdigest.com/p/what-cpuc-data-reveals-about-waymos



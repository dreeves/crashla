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
(2025 June 15 through 2025 December 15) [AI note: the window now rolls forward as NHTSA publishes data; incidents currently run through 2026-04. There is no longer a fixed window-end constant in the code.]
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

For each of these self-driving car companies, we need a lower bound and upper bound on the total miles they drove in the US at SAE level 3+ from 2025-06-15 thru 2025-12-15: [AI note: window now rolls forward monthly; currently through 2026-04]

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

This page aims to compare "miles per incident" across Tesla, Waymo, and Zoox using [NHTSA SGO](https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting) incident reports. The analysis window rolls forward as NHTSA publishes new data: the default view starts June 15, 2025 and currently extends through April 2026 (the date slider reaches back to November 2022 for Waymo). Incident data comes from both the current and [archive](https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/SGO-2021-01_Incident_Reports_ADS.csv) NHTSA CSVs so that June 2025 (starting June 15) has full incident coverage.

Context:
[agifriday.substack.com/crashla](https://agifriday.substack.com/crashla/) and
[agifriday.substack.com/crashla2](https://agifriday.substack.com/crashla2/)

VMT master data: `data/vmt.csv` in this repo. (Formerly maintained in a [Google Sheet](https://docs.google.com/spreadsheets/d/1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w/edit?gid=844581871#gid=844581871), migrated verbatim into the repo 2026-06-11; the sheet is now retired.)

- Top chart: lines differentiated by thickness show MPI for each selected metric. Shaded fan bands show 50%/80%/95% Bayesian credible intervals; error bars show the effect of VMT uncertainty (`vmt_min`/`vmt_max`) on the posterior median.
- Three company charts: VMT line (with error bars) and incident bars by speed bucket, where darker sections indicate higher or unknown speed.
- Tesla mileage assumptions are anchored to tracker sources ([robotaxitracker.com](https://robotaxitracker.com/) and [robotaxi-safety-tracker.com](https://robotaxi-safety-tracker.com/)) and then aligned to this same NHTSA window for apples-to-apples comparison. Dallas/Houston service (unsupervised launch Apr 18, 2026) is included from 2026-04 onward.
- Waymo VMT is estimated by scaling [California CPUC driverless VMT](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (including deadhead) to all US cities using Waymo cumulative milestones. For Jul 2024 through Sep 2025 the error band is +/-25%; Oct-Dec 2025 use +/-30%; Jan-Mar 2026 are calibrated to the 200M-mile milestone (crossed between Feb 6 and Feb 23, 2026) and Waymo's reported >4M rider-only miles/week (late Mar 2026) with +/-25% bands; later months extrapolate that rate with +/-30% bands. (Earlier months have wider bands; see the Waymo VMT Methodology section below.)
- Zoox VMT uses rough estimates based on limited public data from [CPUC quarterly reports](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting) (California-only paid miles) plus [Las Vegas operations](https://techcrunch.com/2025/09/10/zoox-opens-its-las-vegas-robotaxi-service-to-the-public/). Error bands are 0.5x-2x because no month-level public VMT series exists. Zoox's statement of ~2M cumulative autonomous miles (late Mar 2026) corroborates the series' scale.

### Statistical Method

- The colored band around each MPI line is a 95% Bayesian credible interval. Model: incidents ~ Poisson(lambda * m), where lambda is the rate (incidents per mile) and m is VMT. Jeffreys prior: lambda ~ Gamma(0.5, 0) (improper). Posterior after observing k incidents in m miles: lambda | k, m ~ Gamma(k + 0.5, m). MPI = 1/lambda; quantiles are inverted via a monotone decreasing transformation.
- The credible interval combines uncertainty from incident counts (Gamma-Poisson) and from VMT (vmt_min/vmt_max) conservatively: the lower MPI bound uses vmt_min with the upper lambda quantile, and the upper MPI bound uses vmt_max with the lower lambda quantile. This yields the widest possible band.
- For partial months (June 15–30 and January 1–15), VMT is pro-rated by the calendar coverage fraction. For January, incident coverage is also adjusted because Monthly-track NHTSA reports may not yet be available (see the "incident coverage" sanity check on the page).
- The point estimate shown in the line is the Bayesian posterior median of 1/lambda, not the simple ratio m/k. For small k (especially Tesla), the prior pulls the estimate slightly downward; for large k (Waymo), the difference is negligible.
- Fault-weighted incidents (thin line): each incident contributes its fault fraction (Claude's at-fault estimate) instead of one full count. The sum of fractions is treated as a pseudo-Poisson count; this is a heuristic but reasonable approximation.
- **Tesla safety-monitor caveat:** Most Tesla robotaxi rides include a passenger-seat safety monitor. Tesla classifies these as unsupervised (no operator) for NHTSA reporting, but the monitors may intervene to prevent incidents. If so, Tesla's true unsupervised MPI would be lower (worse) than shown.

### Human Comparison Methodology

Human baselines are shown as shaded bands (range of plausible values) rather than single lines. The bands are our own synthesis of published sources: [Kusano & Scanlon (2024)](https://arxiv.org/abs/2312.12675), as discussed in [this analysis](https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos) (surface streets only, passenger vehicles only, Blincoe-adjusted for underreporting), plus benchmarks from [Waymo's safety impact page](https://waymo.com/safety/impact/) (170.7M rider-only miles through Dec 2025). They are not a reproduction of Waymo's safety-impact methodology: Waymo's current comparisons use a location-based dynamic benchmark tied to where Waymo actually drives, which we do not implement. Note also that the app's default metric ("all incidents") is broader than Waymo's surface-street, injury-focused framing.

- **Band interpretation:** The low end uses Blincoe-adjusted rates (correcting for ~60% underreporting of minor crashes); the high end uses police-reported or observed rates. The true apples-to-apples MPI should fall within each band.
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

How our data compares:

1. **Default view understates Waymo's advantage.** Our default metric is "all incidents" where Waymo's MPI vs the human baseline shows roughly 1–2.5x safer. Piper's headline "80–90% lower risk" refers to serious crashes, not all incidents. The dramatic 5–10x safety multiples only appear in our injury/serious-injury/airbag metrics, which aren't the default view.

2. **Miles are compatible.** Piper says "over 200 million" for Waymo total. Waymo's safety hub showed 127M rider-only miles through Sep 2025 (a historical snapshot; the live page now shows 170.7M through Dec 2025); the 200M all-time milestone was confirmed Feb 23, 2026 (https://www.benzinga.com/markets/tech/26/03/50953948). Waymo defines "rider-only miles" as miles without a human driver in cities where it operates; we treat that as including deadhead and overhead, matching the CPUC `TotalVMTZEV` definition — an assumption our VMT estimates depend on but that the Waymo page alone does not establish. Our ~66M for the Oct 2025–Jan 2026 portion of the window is consistent with the ~73M implied by the 127M→200M milestone gap (Oct through mid-Feb).

3. **Reporting asymmetry.** Piper acknowledges Waymo may report more crashes due to better reporting but doesn't quantify this. Our human baselines explicitly address it: Kusano/Scanlon provide both Blincoe-adjusted rates (catching underreported human crashes) and police-reported rates. The lo–hi range in our human MPI benchmarks spans this uncertainty. Additionally, 43% of Waymo collisions involve <1 mph delta-V per Waymo's safety page — incidents that would almost never be police-reported for human drivers.

4. **Fault attribution.** Piper doesn't discuss who's at fault. Our AI fault-fraction analysis shows many of Waymo's ~503 incidents were caused by other drivers. Fault-weighting makes Waymo look even safer than the raw incident count suggests.

5. **Scope.** Piper's article is Waymo-only. Our tool adds Tesla and Zoox to the comparison, which is where the more contested conclusions live.

Sources:
* Waymo Safety Impact hub (historical snapshot: 127M mi through Sep 2025; the live page now shows 170.7M mi through Dec 2025): https://waymo.com/safety/impact/
* Kusano & Scanlon (56.7M mi): https://pubmed.ncbi.nlm.nih.gov/40378124/
* Waymo 200M milestone ("nearly 200M" Feb 6; "over 200M" Feb 23, 2026): https://www.benzinga.com/markets/tech/26/03/50953948

---

## [AI TEXT] June and the Different Datasets

The NHTSA Standing General Order (SGO) analysis window starts **June 15, 2025** (the default view) and rolls forward as NHTSA publishes new data; it currently extends through **April 2026**.
June 2025 is therefore a partial month (June 15–30 only).
Its VMT figure is pre-adjusted to match that partial window, so coverage=1.0 in the VMT data means "VMT and incidents are already aligned" — no further pro-rating needed.
For the latest month, NHTSA's Monthly-track reports may not all be filed yet, so an incident-coverage factor thins the effective VMT instead (see the "Incident coverage for partial months" sanity check on the page).

### The three datasets combined here

1. **NHTSA SGO incident reports** (the numerator).
   Two CSVs — a "current" one and an "archive" for 2021–2025 — are fetched and merged by `data/slurp.py`.
   Archival raw fetch snapshots live under `data/snapshots/`.
   The archive is needed because some June incidents were filed late and ended up in the archive rather than the current CSV.
   After deduplication (keeping highest Report Version per Same Incident ID) and filtering to each company's public robotaxi service (Driver/Operator Type = "None", plus "In-Vehicle (Commercial / Test)" for Tesla's monitored Austin service), we get 1,641 incidents as of the 2026-06-10 fetch: 1,593 Waymo, 17 Tesla, 31 Zoox. These counts grow with each slurp run.

2. **Vehicle Miles Traveled (VMT)** (the denominator).
   Maintained in `data/vmt.csv` (the in-repo master) and embedded in `data/vmt.js` by `data/slurp.py`.
   Each company's mileage comes from different public sources:
   - **Tesla**: robotaxitracker.com cumulative deltas (Austin only; Bay Area excluded per Tesla's Q3 earnings call).
   - **Waymo**: See "Waymo VMT Methodology" section below.
   - **Zoox**: Rough US estimates based on limited public data from California CPUC and Las Vegas operations (0.5×–2× error band).

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
   - `TotalVMTPeriod1`: miles with a passenger aboard
   - `TotalVMTPeriod2`: deadhead miles (driving to pickup)
   - `TotalVMTPeriod3`: overhead miles (repositioning, charging, etc.)
   - `TotalVMTZEV`: sum of all three = total driverless CA VMT

   This is exactly the right denominator for MPI: all driverless miles, not just revenue miles.
   Waymo files under two programs: **deployment** (commercial, fare-charging) and **pilot** (no fares).
   Both are included. Before Dec 2023, all CA driverless VMT was pilot-only.
   By mid-2024, pilot VMT dropped below 1% of total and is negligible.

2. **Waymo cumulative US milestones** (for CA→US scaling):
   Waymo periodically publishes cumulative all-time rider-only miles (all driverless VMT, all US cities).
   These are used to anchor the CA→US scaling factor.

   | Date | Cumulative US Driverless Miles | Source |
   |------|------------------------------:|--------|
   | End 2022 | ~1M | Waymo blog |
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

   Note: Waymo defines "rider-only miles" as miles with no human driver in cities where Waymo operates. We treat this as including deadhead and overhead — i.e., all driverless VMT, the CPUC `TotalVMTZEV` definition — which is an assumption of this methodology; the Waymo page alone does not establish that equivalence.

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
| Oct 2025–Feb 2026 | ~51% | Calibrated from 200M milestone; Austin expansion |

Geographic breakdown through Sep 2025 (from Waymo Safety Hub):
Phoenix 44.5%, San Francisco 30.6%, Los Angeles 20.1%, Austin 5.0%.

### Uncertainty bands

- **Nov 2022–Nov 2023** (±50%): Sparse milestones, pilot era. Pilot-only CA VMT is very small (17K–255K/month). The CA share is uncertain (~14%) and the proportional distribution within milestone intervals may not capture intra-interval growth patterns.
- **Dec 2023–Jun 2024** (±35%): First deployment period. CA share was shifting as LA launched (~24% → ~33%). Cumulative milestone endpoints are known but monthly allocation is approximate.
- **Jul 2024–Sep 2025** (±25%): Tight milestone brackets. CA share is stable (~52–55%).
- **Oct–Dec 2025** (±30%): 4.5-month interval from the Sep 127M milestone toward the 200M milestone; growth shape uncertain. CA VMT (from CPUC) plateaued at ~8.4M/month while US VMT continued growing modestly as Austin expanded; average CA share ~51%, down from ~55% in Q3.
- **Jan–Mar 2026** (±25%): Anchored to the 200M cumulative milestone (crossed between Feb 6 and Feb 23, 2026 per Waymo's posts) and the co-CEO's >4M rider-only miles/week at ~500k paid trips/week (late Mar 2026).
- **Apr–May 2026** (±30%): Extrapolated from the late-Mar weekly rate with modest growth (~3,000 vehicles).

### Notable events

- **Jun 2025 dip**: CPUC data shows a ~33% drop in CA VMT (from 5.34M in May to 3.57M in June). This is explained by anti-ICE protests on June 8–9, 2025, during which protesters vandalized and set fire to Waymo vehicles in LA and SF. Waymo suspended service across both California markets for a significant portion of June, including expanded suspensions ahead of "No Kings" protests on June 14.

- **Pilot→deployment transition**: Waymo obtained its CPUC driverless deployment permit in Aug 2023. Before Dec 2023, all CA driverless VMT was under the pilot program. In Dec 2023–Feb 2024, pilot VMT added ~12–15% on top of deployment. By mid-2024, pilot dropped below 1%.

### Cross-references

- CPUC quarterly reports: https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting
- Waymo Safety Impact Hub: https://waymo.com/safety/impact/
- Kusano & Scanlon 56.7M-mile paper: https://pubmed.ncbi.nlm.nih.gov/40378124/
- Driverless Digest analysis: https://www.thedriverlessdigest.com/p/waymo-stats-2025-funding-growth-coverage
- Driverless Digest CPUC deadheading: https://www.thedriverlessdigest.com/p/what-cpuc-data-reveals-about-waymos


## SCRATCH AREA

Old VMT data replaced on 2026-05-22:

tesla	2025-06	1806	1806	1625.4	1986.6	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-07	16715.5	18521.5	12650	20781	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-08	68200	86721.5	57970	78430	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-09	90202	176923.5	88550	91854	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-10	80061	256984.5	67965	92157	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-11	103800	360784.5	88230	119370	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2025-12	146870.5	507655	111351	182390	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
tesla	2026-01	164845	672500	92690	237000	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.

tesla	2026-02	185000	857500	120000	260000	Austin only: robotaxitracker end-of-month cumulative delta; assume already netted to empty driver-seat miles.
zoox	2026-02	230000	1575000	115000	460000	US rough est.: no month-level public VMT series; placeholder based on limited public ops; 0.5x–2x band.
waymo	2026-02	20000000	211072456	14000000	26000000	US est.: smooth interpolation of cumulative milestones; growth shape uncertain; ±30%
tesla	2026-03	210000	857500	120000	260000	GPT-5.5 guesses
zoox	2026-03	500000	2075000	250000	1000000	GPT-5.5 guesses
waymo	2026-03	22,000,000	233,072,456	15,400,000	28,600,000	GPT-5.5 guesses
tesla	2026-04	235,000	1,302,500	140,000	340,000	GPT-5.5 guesses
zoox	2026-04	600,000	2,675,000	300,000	1,200,000	GPT-5.5 guesses
waymo	2026-04	24,000,000	284,587,646	16,800,000	31,200,000	GPT-5.5 guesses
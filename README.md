Other name ideas:

* Teslapologetics
* Via et Veritas
* Bayes Against the Machine

VMT discrepancy in Waymo data (2026-09-25):

Subject:
possible double-counted Atlanta miles in Safety Impact hub data

In "CSV4 - Miles and Benchmark Crashes for Dynamic Benchmark 202009-202606-2022benchmark.csv", 67 Fulton and 18 DeKalb S2 cells appear twice within every Outcome. Each pair has the same S2 Cell ID, Waymo RO Miles and HPMS Yearly VMT, but a different crash count. No other county has repeated cells. Same patten in the 202603 files (54 Fulton, 14 DeKalb).

Replicata:
Within one Outcome (e.g. "ka"), sum Waymo RO Miles by county, (a) over all rows and (b) counting each S2 cell once.
Expected: (a) = (b).
Actual: (a) Fulton 7.860M, DeKalb 0.764M, matching CSV1 exactly; (b) Fulton 5.143M, DeKalb 0.640M.

If that's indeed an error, the headline 271.329 mile number includes ~2.84M double-counted Atlanta miles (1.79M in the March release) and the Atlanta crash rates would be understated.

Thanks for being amazing, saving lives, and for all the transparency!
Daniel Reeves


Another discrepancy in Waymo's data (2026-10-27):

Subject: seeming contradiction: ego-vehicle airbag > any-vehicle airbag

New thing I (aka my robominions) spotted:

In "CSV3 - Collision Counts and Comparison to Benchmarks 202009-202606-2022benchmark_v2.csv" note the following two fields:
(a) "Ego Vehicle Airbag Deployment (non-Dynamic)" 
(b) "Any Airbag Deployment (non-Dynamic)"

Presumably it doesn't make sense for (a) to ever exceed (b)? There are 19 rows in which it does:

  Santa Clara, V2V Head-on     ego 0.0395 [0.0350, 0.0445]  any 0.0151 [0.0122, 0.0185]  2.62x
  San Mateo, V2V Head-on       ego 0.0480 [0.0393, 0.0581]  any 0.0233 [0.0162, 0.0326]  2.06x
  Los Angeles, Pedestrian      ego 0.0046 [0.0039, 0.0053]  any 0.0023 [0.0018, 0.0028]  2.03x
  Los Angeles, V2V Head-on     ego 0.0407 [0.0387, 0.0427]  any 0.0229 [0.0215, 0.0244]  1.77x
  Travis, Single Vehicle       ego 0.2428 [0.2322, 0.2538]  any 0.1947 [0.1876, 0.2021]  1.25x
  Los Angeles, Single Vehicle  ego 0.2041 [0.1996, 0.2086]  any 0.1756 [0.1716, 0.1796]  1.16x

Thanks again for the treasure trove of data here!
Daniel Reeves

PS: Claude typed the following, so I'm less sure it's useful but just in case:

[begin Claude]
1. The hub's CSV3 link still serves the Sep 24 file ("...202606-2022benchmark.csv", Last-Modified Sep 24, ETag 4fe9ac65...). The page shows the v2 rates, the CSV4 link already points to _v2, and the Oct 2 release notes say the new files replace the Sep 24 ones. So a downloaded CSV3 doesn't match the page.

2. The Oct 2 notes say the duplicated cells "only affected the Atlanta area" and that the benchmark-year error "did not affect the calculated rates in CSV3". Yet v2's Dynamic benchmarks moved in every area, e.g. any-injury: Los Angeles -2.6%, Santa Clara -6.0%, SF Bay Area +1.0%, Atlanta Area -2.2%. The non-Dynamic rows are unchanged. Is that expected?

3. The unsuffixed "Any Fatal" rows behave as non-Dynamic: they are unchanged between the two files, like every "(non-Dynamic)" row. "Any Fatal (Dynamic)" behaves as Dynamic. That is the reverse of the other outcomes' labels. Intended?

4. Texas: which Prsn_Airbag_ID values count as a deployment? The CRIS extract's IDs differ from the CR-3 form's codes (in CRIS, 2 = NOT DEPLOYED and 3, 4, 7, 8 = deployed front, side, rear, multiple; on the form, 2 = Deployed, Front). Kusano et al. 2025 (Table A3) names only the field.

5. Georgia: does the Atlanta benchmark include crashes coded as occurring on private property (DOT-523 item 89, code 16)? Georgia's GOHS crash totals exclude them. Atlanta's non-Dynamic police-reported rate is 15.2 per million miles, against 3.4-5.4 in the other areas. Nearly all of the excess is in vehicle-to-vehicle types: rear-end 4.59 vs 0.56-1.08, lateral 2.35 vs 0.30-0.63, backing 0.41 vs 0.03-0.11.
[end Claude]


## How safe are robotaxis?

* https://agifriday.substack.com/p/crashla
* https://agifriday.substack.com/p/crashla2
* https://agifriday.substack.com/p/teslapologetics
* etc

We've known for a long time that Waymos are much safer than human drivers:
https://www.theargumentmag.com/p/we-absolutely-do-know-that-waymos

What about Tesla robotaxis and Zooxes?

NHTSA data source:
https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting
(the SGO program started June 2021; our analysis window starts 2025 June 15) 

Key dates for Tesla robotaxi:
* 2025-06-22: Launch in Austin with empty driver's seat
* 2025-09-01: Highway rides added (with safety monitor moved to driver's seat)
* 2026-01-22: First public Tesla robotaxi rides without passenger-seat safety monitor

## Related Links

* https://www.austintexas.gov/page/autonomous-vehicles
* https://robotaxitracker.com/ (crowd-sourced)
* https://teslafsdtracker.com (crowd-sourced)

According to robotaxitracker.com:
* Tesla robotaxi miles prior to Sep 1: 93,849
* Tesla robotaxi miles prior to Dec 16: 456,099
* UNKNOWN: fraction of the Sep 1+ rides with empty driver's seat.

## Finding the Denominators

For each of these self-driving car companies, we need a lower bound and upper bound on the total miles they drove in the US at SAE level 3+ since 2025-06-15.

1. Waymo
2. Tesla
3. Zoox

Tesla is a very unusual case. 
They've had in-car supervision for most rides with their passenger-seat safety monitors. 
But, per the NHTSA incident database, Tesla is averring to NHTSA that those rides have no operator, ie, that they count as SAE level 3+. 
So that's what we're going with here. 
That means we need to estimate Tesla's robotaxi mileage for the subset of rides that had an empty driver's seat. 
Whether a human was in the passenger seat is not relevant here.

## Original Spec and Notes

Original inspiration for this tool:
https://www.aifuturesmodel.com/forecast/

We want something similar to that but for answering the question about how safe Teslas, Waymos, and Zooxes are.

Ultimately we're tallying incidents (carefully de-duplicating and consolidating them) and estimating Vehicle Miles Traveled (VMT) to compute Miles Per Incident (MPI) for various incident types -- from any collision all the way up to fatalities.

Notes about the NHTSA data:
* Some rows in the NHTSA data are just updates to previous entries and refer to the same incident.
* We only care about incidents where the "Driver / Operator Type" field means *unsupervised* self-driving. We want to know unsupervised miles per incident.

Tesla is averring to NHTSA that their passenger-seat safety monitors do not count as supervised autonomy, and same for any tele-operation they're employing.
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


[This file is by and for humans only. For notes from the golems, see IGNOREME.md]
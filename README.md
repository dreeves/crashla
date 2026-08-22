Other name ideas:

* Teslapologetics
* Via et Veritas
* Bayes Against the Machine


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
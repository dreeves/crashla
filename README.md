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
(2025 June 15 through 2025 December 15) [AI note: window now extends to 2026 January 15; code uses NHTSA_WINDOW_END = "2026-01-15"]
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

For each of these self-driving car companies, we need a lower bound and upper bound on the total miles they drove in the US at SAE level 3+ from 2025-06-15 thru 2025-12-15: [AI note: window now extends to 2026-01-15]

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

can you make a file called faultfrac-MODEL.csv that, for every Report ID in nhtsa-2025-jun-2026-jan.csv for which Operator=None, gives an estimated fraction at-fault for the AV? make sure to use the latest version of each incident. you can format it like so:

Report ID,faultfrac,reasoning
54321-12345,0.5,"AV and other vehicle merged into each other"
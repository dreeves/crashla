# Are Tesla Robotaxis Subhumanly Safe?

Electrek claims Tesla robotaxis crash more than human drivers:
https://electrek.co/2026/01/29/teslas-own-robotaxi-data-confirms-crash-rate-3x-worse-than-humans-even-with-monitor/

NHTSA data source:
https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting
(2025 June 15 through 2025 December 15)

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

Here's what I've learned from the NHTSA data:

* Tesla reported 9 robotaxi incidents in the period for which NHTSA provides data (2025 Jun 16 to Dec 15)
* For 4 of those, the robotaxi was going 2mph or less
* Only 1 involved injuries (minor)

Here are what I believe to be the most complete characterizations of the incidents we can get from the NHTSA data:

1. July, daytime, an SUV’s front right side contacted the robotaxi’s rear right side with the robotaxi going 2mph while both cars were making a right turn in an intersection; property damage, no injuries
2. July, daytime, robotaxi hit a fixed object with its front right side on a normal street at 8mph; had to be towed and passenger had minor injuries, no hospitalization
3. July, nighttime, in a construction zone, an SUV going straight had its front right side contact the stationary robotaxi’s rear right side; property damage, no injuries
4. September, nighttime, a robotaxi making a left turn in a parking lot at 6mph hit a fixed object with the front ride side of the car, no injuries
5. September, nighttime, a passenger car backing up in an intersection had its rear right side contact the right side of a robotaxi, with the robotaxi going straight at 6mph; no injuries
6. September, nighttime, a cyclist traveling alongside the roadway contacted the right side of a stopped robotaxi; property damage, no injuries
7.  September, daytime, a stopped robotaxi traveling 27mph [sic!] hit an animal with the robotaxi’s front left side, no injuries [presumably “stopped” is a data entry error]
8. October, nighttime, the front right side of an unknown entity contacted the robotaxi’s right side with the robotaxi traveling 18mph under unusual roadway conditions; no injuries
9. November, nighttime, front right of an unknown entity contacted the rear left and rear right of a stopped robotaxi; no injuries

All the other details are redacted. I guess Tesla feel like they have a lot to hide? The law allows them to redact details by calling them “confidential business information” and they’re the only company doing that, out of roughly 10 of them. Typically the details are things like this from Avride:

> Our car was stopped at the intersection of [XXX] and [XXX], behind a red Ford Fusion. The Fusion suddenly reversed, struck our front bumper, and then left the scene in a hit-and-run.

I.e., explaining why it totally wasn’t their fault, with only things that could conceivably be confidential, like the exact location, redacted. So I don’t think Tesla deserves the benefit of the doubt here but if I try to give it anyway, here are my guesses on severity and fault:

1.  Minor fender bender, 30% Tesla’s fault (2mph)
2.  Egregious fender bender, 100% Tesla’s fault (8mph)
3.  Fender bender, 0% Tesla’s fault (0mph)
4.  Minor fender bender, 100% Tesla’s fault (6mph)
5.  Minor fender bender, 20% Tesla’s fault (6mph)
6.  Fender bender, 10% Tesla’s fault (0mph)
7.  Sad or dead animal, 30% Tesla’s fault (27mph)
8.  Fender bender, 50% Tesla’s fault (18mph)
9.  Fender bender, 5% Tesla’s fault (0mph)

Those guesses, especially the fault percents, are pulled out of my butt. Except the collisions with stationary objects, which are necessarily 100% Tesla’s fault. But if we run with those guesses, that’s 3.45 at-fault accidents. Over how many miles? More guessing required! I believe that for a while, all Tesla robotaxi rides had an empty driver’s seat. But starting in September, Tesla added back driver’s-seat safety drivers for rides involving highways. Or more than just those? We have no idea. We do know of cases of Tesla putting the safety driver back when the weather was questionable. In any case, only accidents without a safety driver in the driver’s seat are included in this dataset, so we do need to subtract those miles when estimating Tesla’s incident rate.


# Spec

Inspiration for this tool:
https://www.aifuturesmodel.com/forecast/

We want something similar to that but for answering the question about how safe Teslas, Waymos, and Zooxes are.

For each company, we want sliders for the uncertain parameters and then we want to estimate, with confidence intervals, the number of miles between incidents.

Having a nice way to browse the data would also be nice.

Note that we only care about incidents in this dataset where the "Driver / Operator Type" field is "None".

Note: be careful to de-dup/consolidate the incidents. Sometime an entry is actually an update to a previous entry. For example, there are 10 entries for Tesla corresponding to 9 distinct incidents.

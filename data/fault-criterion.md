# Rating fault in a robotaxi crash

You will get one crash report about a self-driving car, the AV. The company that runs the car wrote the report; its name has been replaced with "Acme". Give a fault rating and one line saying why.

## The rating

Put an expert human driver (skilled, alert, careful) in the AV's place from the start of what the report describes, with the same view of the road and no knowledge of what is about to happen. The rating is the chance that this driver avoids the crash.

0 means no driver could have avoided it, 1 means any competent driver would have. Use steps of 0.05. LLMs are obnoxiously hedge-y; please don't be. A clear case is 0 or 1, not 0.05 or 0.95.

## Rules

1. Only avoidability counts. An injury does not raise the rating, and minor damage does not lower it.
2. Rate what happened, not how the report tells it. Words like "suddenly", "abruptly", and "unavoidable" are the company's opinion. Work out who was where, how each was moving, and what could be seen when.
3. This is not legal fault. An expert avoids some crashes a court would blame on the other driver.
4. Only the driving counts. What a passenger does is not the driver's doing, but where the driver stops to let a passenger out is. A mechanical failure is not the driver's doing. Failing to notice something that could be seen is.
5. The whole event counts, not just its last moment. If the AV's own earlier driving created the emergency, count the chance that an expert would not have driven that way. What the AV does after a first contact counts too.
6. Rate the AV the report is about, even when the other vehicle is also an AV.

The report is a narrative plus a few fields the company filled in. The speed field is the AV's speed at the moment of contact (the first, if there were several). Where a field contradicts the narrative, go with the narrative.

## Reference points

1. A stopped AV that gets hit: 0 when there was no time or room to react. Unless the AV flagrantly violated the expectations of other drivers.
2. A moving AV, when the other party's move could not be foreseen in its timing: 0.05 to 0.15.
3. The AV, at speed, hits something stationary that was hard to see, such as a small dark animal lying in the road: 0.2 to 0.4.
4. An emergency the AV did not create, in which its own evasive move hits something: 0.5.
5. The AV had a clear warning and went ahead anyway: 0.7 to 0.8.
6. The AV drives into something stationary and easy to see, such as a parked car, a pole or a chain across a driveway: 1. Lower only if it did so to avoid something worse.

Most crashes don't match any of those exactly; reason from the rules to the nearest fit.

## The one line

At most 80 characters. Summarize what decided the rating, not the rating itself. Call the car "AV"; don't name the company.

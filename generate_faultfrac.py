import csv
import re
from collections import defaultdict

def estimate_fault(narrative):
    if not narrative or narrative.strip() == "" or "REDACTED" in narrative:
        return 0.0, "Narrative redacted/missing"
    
    narrative_lower = narrative.lower()
    
    # AV hit stationary object/debris/animal/pavement/wire
    if re.search(r'av made contact with.*(debris|speed bump|fallen|animal|dog|deer|pole|gate|barrier|cone|sign|pavement|wire)', narrative_lower) or re.search(r'striking.*wire', narrative_lower):
        return 1.0, "AV hit a stationary object/debris/animal/pavement/wire"
        
    # Object rolled into AV
    if re.search(r'(basketball|ball|object).*rolled into.*av', narrative_lower) or re.search(r'(basketball|ball|object).*made contact with.*av', narrative_lower):
        return 0.0, "Object rolled into AV"
        
    # Passenger exited moving AV
    if re.search(r'passenger.*exited.*moving', narrative_lower) or re.search(r'passenger.*exited.*while.*motion', narrative_lower) or re.search(r'passenger.*exited.*slowing', narrative_lower):
        return 0.0, "Passenger exited moving AV"
        
    # AV is stationary/stopped and gets hit
    if re.search(r'av was (stationary|stopped|parked)', narrative_lower) and re.search(r'(rear ended|struck|made contact with|hit).*av', narrative_lower):
        return 0.0, "AV was stationary and was struck by another vehicle"
        
    if re.search(r'av was (stationary|stopped|parked)', narrative_lower):
        return 0.0, "AV was stationary/stopped"
        
    # AV rear-ended someone
    if re.search(r'av (rear ended|struck the rear of)', narrative_lower):
        return 1.0, "AV rear-ended another vehicle"
        
    # AV was rear-ended
    if re.search(r'(rear ended|struck the rear of).*av', narrative_lower) or re.search(r'av was rear ended', narrative_lower) or re.search(r'av.*was rear-ended', narrative_lower):
        return 0.0, "AV was rear-ended by another vehicle"
        
    # Other vehicle ran red light / stop sign
    if re.search(r'(ran|disregarded) a red light', narrative_lower) or re.search(r'(ran|disregarded) a stop sign', narrative_lower):
        if re.search(r'av (ran|disregarded)', narrative_lower):
            return 1.0, "AV ran a red light/stop sign"
        else:
            return 0.0, "Other vehicle ran a red light/stop sign"
            
    # Other vehicle reversed into AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv).*revers(ed|ing).*av', narrative_lower) or re.search(r'backed into.*av', narrative_lower):
        return 0.0, "Other vehicle reversed into AV"
        
    # AV reversed into something
    if re.search(r'av.*revers(ed|ing)', narrative_lower) or re.search(r'av.*backed into', narrative_lower):
        return 1.0, "AV reversed into another vehicle/object"
        
    # Other vehicle changed lanes into AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv).*(changed lanes|merged).*into.*av', narrative_lower):
        return 0.0, "Other vehicle changed lanes/merged into AV"
        
    # AV changed lanes into something
    if re.search(r'av.*(changed lanes|merged).*into', narrative_lower):
        return 1.0, "AV changed lanes/merged into another vehicle"
        
    # Other vehicle turned into AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv).*(turned|turning).*into.*av', narrative_lower):
        return 0.0, "Other vehicle turned into AV"
        
    # AV turned into something
    if re.search(r'av.*(turned|turning).*into', narrative_lower):
        return 1.0, "AV turned into another vehicle"
        
    # Other vehicle made contact with AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv|motorcycle|bus|bicycle|pedestrian|gate).*made contact with.*av', narrative_lower):
        return 0.0, "Other vehicle/object made contact with AV"
        
    # Other vehicle clipped AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv|motorcycle|bus|bicycle|pedestrian).*clipped.*av', narrative_lower):
        return 0.0, "Other vehicle clipped AV"
        
    # Other vehicle struck AV
    if re.search(r'(other vehicle|vehicle 2|truck|car|van|suv|motorcycle|bus|bicycle|pedestrian).*struck.*av', narrative_lower):
        return 0.0, "Other vehicle struck AV"
        
    # Sideswipe
    if 'sideswipe' in narrative_lower:
        return 0.5, "Vehicles sideswiped each other"
        
    # Default fallback
    if 'av made contact' in narrative_lower:
        return 0.5, "AV made contact with another vehicle/object"
    elif 'made contact with the av' in narrative_lower or 'made contact with the waymo' in narrative_lower or 'made contact with the zoox' in narrative_lower:
        return 0.0, "Another vehicle made contact with the AV"
        
    return 0.5, "Ambiguous interaction based on narrative"

with open("nhtsa-2025-jun-2026-jan.csv", "r") as f:
    reader = csv.DictReader(f)
    incidents = defaultdict(list)
    for row in reader:
        if row.get("Driver / Operator Type") == "None":
            incidents[row["Same Incident ID"]].append(row)

latest_incidents = []
for inc_id, rows in incidents.items():
    latest = max(rows, key=lambda r: int(r["Report Version"]))
    latest_incidents.append(latest)

with open("faultfrac-gemini.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["Report ID", "faultfrac", "reasoning"])
    
    for row in latest_incidents:
        report_id = row["Report ID"]
        narrative = row.get("Narrative", "")
        
        # Replace specific company names with AV for easier regex matching
        narrative_norm = narrative.replace("Waymo AV", "AV").replace("Zoox vehicle", "AV").replace("Cruise AV", "AV")
        
        faultfrac, reasoning = estimate_fault(narrative_norm)
        writer.writerow([report_id, faultfrac, reasoning])

print("Done generating faultfrac-gemini.csv")

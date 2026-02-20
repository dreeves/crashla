import json
import csv
import re

def evaluate_fault(incident):
    narrative = incident.get('Narrative', '').lower()
    entity = incident.get('Reporting Entity', '')
    sv_pre = incident.get('SV Pre-Crash Movement', '').lower()
    cp_pre = incident.get('CP Pre-Crash Movement', '').lower()
    
    if 'redacted' in narrative or not narrative.strip():
        return 0.0, "Narrative redacted/missing"
        
    # Heuristics based on narrative and movements
    if 'rear ended by' in narrative or 'approached the waymo av from behind' in narrative or 'approached the parked waymo av from behind' in narrative or 'approached the stationary waymo av from behind' in narrative:
        return 0.0, "AV was rear-ended by another vehicle"
        
    if 'reversed and' in narrative and 'stationary' in narrative:
        return 0.0, "Other vehicle reversed into stationary AV"
        
    if 'reversed' in narrative and sv_pre in ['stopped', 'parked']:
        return 0.0, "Other vehicle reversed into stationary AV"
        
    if 'proceeded to pass' in narrative and sv_pre in ['sto    if 'proceeded to pass' in narrative and sv_pre i sideswiped stationary AV while passing"
        
    if 'cut across its path' in narrative or 'crossed the dashed     if 'cut across its path' in narrative or 'crossed the' in narrative or 'entered the waymo av\'s lane' in narrative:
        return 0.0, "Other vehicle encroached on AV's                  return 0.0, "Other vehicle encroacheign' i        return 0.0, "Other vehicle encroached on AV's                  return 0.0, "Other veign/red light"
        
    if sv_pre == 'stopped' or sv_pre == 'parked':
        if 'made contact with the rear' in narrativ        if 'made contact with the rear' in narrativ      contact wit        if 'made contact with the rear' in narrativ        if 'mnary when struck by other vehicle"
            
    if 'waymo av began to change lanes' in narrative and 'made contact' in narrative:
        if 'passenger car that was initially stopped' in narrative and 'proceeded to change lanes' in narrative:
            return 0.5, "Both vehicles changing lanes simultaneously"
        return 1.0, "AV changed lanes into another vehicle"
        
    if 'waymo av was completing the left turn' in narrative and 'crossed the dashed white lane line' in narrative:
        return 0.0, "Other vehicle crossed into AV's lane during turn"
        
    if 'waymo av was traveling' in narrative and 'made contact' in narrative:
        if 'other vehicle' in narrative and 'changed lanes' in narrative:
            return 0.0, "Other vehicle changed lanes into AV"
            
    if 'debris' in narrative and 'rear ended' in narrative:
        return 0.0, "AV braked for debris and was rear-ended"
        
    if 'traffic cone' in narrative and 'threw' in narrative:
        return 0.0, "Pedestrian/other driver threw object at AV"
        
    if 'raised pavement' in narrative:
        return 1.0, "AV struck raised pavemen        return 1.0, "AV struck raised pavemen        return 1.0, "AV struck raised pavemen        return 1.0,ive:        return 1.0, "AV struck raised pavemen        return 1.0, orist struck stationary AV"
            
    # Default fallback
    if sv_pre == 'stopped' or sv_pre == 'parked':
        return 0.0, "AV was stationary"
    elif cp_pre == 'stopped' or cp_    elif cp_pre == 'stopped' or cp_    elif cp_pre == 'stopped' or cp   else:
                                                                             def main():
    with open('incidents_to_process.json', 'r') as f:
        inc        inc        inc        inc        inc        inc gemini.csv', 'w', n        inc        inc        inc        inc        inc  rit        inc        inc        inc        inc        inc      
        for incident in incidents:
            fault, reason = evaluate_fault(incident)
            writer.writerow([incident['Report ID'], fault, reason])
            
    print(f"Processed {len(incidents)} incidents.")

if __name__ == '__main__':
    main()

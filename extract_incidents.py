import csv
import json
from collections import defaultdict

incidents = defaultdict(list)

with open('nhtsa-2025-jun-2026-jan.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['Driver / Operator Type'] == 'None':
            incidents[row['Same Incident ID']].append(row)

latest_incidents = []
for incident_id, rows in incidents.items():
    # Sort by Report Version descending
    rows.sort(key=lambda x: int(x['Report Version']), reverse=True)
    latest_row = rows[0]
    latest_incidents.append({
        'Report ID': latest_row['Report ID'],
        'Reporting Entity': latest_row['Reporting Entity'],
        'Narrative': latest_row['Narrative'],
        'Crash With': latest_row['Crash With'],
        'SV Pre-Crash Movement': latest_row['SV Pre-Crash Movement'],
        'CP Pre-Crash Movement': latest_row['CP Pre-Crash Movement']
    })

with open('incidents_to_process.json', 'w', encoding='utf-8') as f:
    json.dump(latest_incidents, f, indent=2)

print(f"Extracted {len(latest_incidents)} incidents.")

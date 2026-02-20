import json
import sys

chunk_size = 50
chunk_idx = int(sys.argv[1])

with open('incidents_to_process.json', 'r') as f:
    data = json.load(f)

start = chunk_idx * chunk_size
end = min(start + chunk_size, len(data))

for i in range(start, end):
    item = data[i]
    print(f"--- ID: {item['Report ID']} ---")
    print(f"Entity: {item['Reporting Entity']}")
    print(f"Narrative: {item['Narrative']}")
    print()

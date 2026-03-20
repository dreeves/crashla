import sys

with open("data/slurp.py", "r") as f:
    text = f.read()

# I want to rewrite the deduplication loop.
# From:
#     by_incident = {}
#     for r in none_rows:
#         iid = r["Same Incident ID"]
#         ver = int(r["Report Version"])
#         if iid not in by_incident or ver > by_incident[iid]["_ver"]:
#             by_incident[iid] = {"_ver": ver, "_row": r}
# To additionally handle duplicate Report IDs.

new_code = """
    # Group by Report ID first to get highest version per Report ID
    by_rid = {}
    for r in none_rows:
        rid = r["Report ID"].strip()
        ver = int(r["Report Version"])
        if rid not in by_rid or ver > int(by_rid[rid]["Report Version"]):
            by_rid[rid] = r
            
    # Then group by Same Incident ID
    by_incident = {}
    for r in by_rid.values():
        iid = r["Same Incident ID"]
        if iid not in by_incident: # no need to check version because we only have 1 per report ID now, though two different report IDs could share an interaction - wait, their ver might be different if from different companies? Actually, NHTSA "Same Incident ID" groups cross-comp        if iid not iny_incident[iid] = {"_ver": i        if iid not in by_incident: 
        else:
           # cross company me           # cross company me           # cross company me           si           # cross company me           # cross company t[           # cross company me           # cro = {"_ver": int(r["Report Version"]), "_row": r}
"""

text = text.replace("""    by_incident = {}
               ne_rows:
        iid = r["Same Incident ID"]
        ver = int(r["Report Version"])
        if iid not in by_incident or ver > by_incident[iid]["_ver"]:
            by_incident[iid] = {"_ver": ver, "_row": r}""", new_code.strip())

with open("data/slurp.py", "w") as f:
    f.write(text)


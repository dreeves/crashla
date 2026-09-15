#!/usr/bin/env python3
"""Slurp live NHTSA SGO crash data into inline data for the web tool.

Fetches current + archive ADS incident CSVs from NHTSA, deduplicates by
Report ID (keeping the highest Report Version) and then by Same Incident ID
(with the SPLIT_SAME_INCIDENT_REPORTS exemption), filters to each entity's
public robotaxi service (Driver / Operator Type "None", plus Tesla's
"In-Vehicle (Commercial / Test)" and "Remote (Commercial / Test)" modes — see
PUBLIC_SERVICE_OPERATOR_TYPES), joins in the in-repo VMT master
(data/vmt.csv) and fault inputs (data/faultfrac.csv), and injects the data
into data/incidents.js and data/vmt.js (between marker comments).
"""

import csv
import datetime
import statistics
import io
import json
import math
import re
import urllib.request
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
ROOT_DIR = DATA_DIR.parent
SNAPSHOT_DIR = DATA_DIR / "snapshots"
LEGACY_SNAPSHOT_PATHS = {
    "nhtsa-current": [
        SNAPSHOT_DIR / "nhtsa-2025-jun-dec.csv",
        SNAPSHOT_DIR / "nhtsa-2025-jun-2026-jan.csv",
    ],
}

NHTSA_ADS_CSV_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/"
    "SGO-2021-01_Incident_Reports_ADS.csv"
)
NHTSA_ADS_ARCHIVE_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/"
    "SGO-2021-01_Incident_Reports_ADS.csv"
)
# NHTSA's canonical SGO page labels each release "through <date>": reports
# RECEIVED through that date, which has been the 15th of the month before the
# release for every release on record (verified from data/snapshots history:
# each release's newest incident month holds almost only five-day-track
# filings and grows ~6x in the next release; the second-newest month never
# grows again).
# https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting
# That page 403s scripted fetches, so the reviewed cutoff is recorded here —
# one edit per release — and guarded by content asserts in main(): the cutoff
# month must equal both the newest incident month and the newest submission
# month (a report received after the cutoff carries a later Report Submission
# Date, so a stale cutoff trips there). Monthly filings submitted within the
# incident month itself are rare but real (Tesla files early; the Feb-2026
# release held four JAN-2026 ones) and are consistent with the cutoff.
NHTSA_DATA_THROUGH_DATE = "2026-08-15"
# Receipt coverage of the data-through month. Reports received through the
# 15th cover only crashes from roughly the first third of that month: the
# five-day clock runs from the company's notice, plus NHTSA processing. It is
# measured, not assumed, from data/snapshots history: (five-day-type
# public-service Waymo/Tesla/Zoox incidents of month M present in the first
# release containing M) / (M's eventual five-day-type total), deduplicated by
# Same Incident ID. Re-measure and re-review on each release.
# Re-measured 2026-09-04 (the 2026-08-28 table read 18/38, 25/69, 16/57,
# 17/60 — a transcription slip; every filter variant reproduces the counts
# below, e.g. the Feb numerator includes Zoox 30610-14026).
# A month's denominator is final at its second NORMAL release: verified across
# every release snapshot (Feb 19->38 then flat x5; Apr 3->57 flat; May 16->58
# flat; Jun 17->61 flat). The one exception proves the rule — Mar ran 25->53->72
# because its second release WAS the truncated May-15 one.
FIVE_DAY_RECEIPT_OBSERVATIONS = {
    "2026-02": (19, 38),   # Mar-16-2026 release vs the Aug-17-2026 file
    "2026-03": (25, 72),   # Apr-15-2026 release
    "2026-05": (16, 58),   # Jun-15-2026 release
    "2026-06": (17, 61),   # Jul-15-2026 release
    "2026-07": (12, 58),   # Aug-17-2026 release vs the Sep-15-2026 file
    # 2026-04 excluded: the May-15-2026 release was cut early (3 April
    # incidents / 19 April submissions vs ~17 / ~90 in every other release).
}
# (best, lo, hi): best = median of the observed fractions (0.279); lo/hi pad
# the observed range [0.21, 0.50]. release_month_coverage() asserts both.
# Added 2026-07 on the 2026-09-15 release: 0.207 is a new low, so lo fell
# 0.25 -> 0.20 and the median moved 0.313 -> 0.279.
FIVE_DAY_RECEIPT_COVERAGE = (0.28, 0.20, 0.52)
INCIDENT_JS = DATA_DIR / "incidents.js"
VMT_JS      = DATA_DIR / "vmt.js"
# In-repo master for the VMT estimates (one row per helmer-month).
# Formerly a Google Sheet; moved into the repo 2026-06-11 so edits happen
# here and git history is the archive.
VMT_MASTER = DATA_DIR / "vmt.csv"
FAULT_INPUT = DATA_DIR / "faultfrac.csv"
FAULT_CSV_FIELDS = [
    "reportID", "speed", "crashwith", "svhit", "cphit", "severity",
    "faultfrac", "reasoning",
]
FAULT_MASTER_FIELDS = FAULT_CSV_FIELDS[:-2]

# Fields to extract for each incident
FIELDS = [
    "Report ID",
    "Report Version",
    "Reporting Entity",
    "Incident Date",
    "Incident Time (24:00)",
    "Same Incident ID",
    "City",
    "State",
    "Roadway Type",
    "Crash With",
    "Highest Injury Severity Alleged",
    "SV Precrash Speed (MPH)",
    "SV Pre-Crash Movement",
    "CP Pre-Crash Movement",
    "Narrative",
    "Narrative - CBI?",
    "Any Air Bags Deployed?",
    "Weather - Clear",
    "Weather - Rain",
    "Weather - Cloudy",
    "Weather - Partly Cloudy",
    "Were All Passengers Belted?",
]

# Shorter keys for the JSON output (greppable, pronounceable jargon)
KEY_MAP = {
    "Report ID":                     "reportId",
    "Report Version":                "version",
    "Reporting Entity":              "helmer",
    "Incident Date":                 "date",
    "Incident Time (24:00)":         "time",
    "Same Incident ID":              "incidentId",
    "City":                          "city",
    "State":                         "state",
    "Roadway Type":                  "road",
    "Crash With":                    "crashWith",
    "Highest Injury Severity Alleged": "severity",
    "SV Precrash Speed (MPH)":       "speed",
    "SV Pre-Crash Movement":         "svMovement",
    "CP Pre-Crash Movement":         "cpMovement",
    "Narrative":                     "narrative",
    "Narrative - CBI?":              "narrativeCbi",
    "Any Air Bags Deployed?":        "airbagAny",
    "Weather - Clear":               "wxClear",
    "Weather - Rain":                "wxRain",
    "Weather - Cloudy":              "wxCloudy",
    "Weather - Partly Cloudy":       "wxPartlyCloudy",
    "Were All Passengers Belted?":   "belted",
}

# Contact area boolean columns in the NHTSA CSV.
# Each Y-valued column contributes its short label to a compact hit summary.
CONTACT_AREA_LABELS = [
    "Front Left", "Front", "Front Right",
    "Left", "Top", "Right",
    "Rear Left", "Rear", "Rear Right",
    "Bottom", "Unknown",
]

def _contact_areas(row, prefix):
    """Compact contact area string from NHTSA boolean columns, e.g., 'front left+rear'."""
    parts = []
    for label in CONTACT_AREA_LABELS:
        if row.get(f"{prefix} - {label}", "").strip() == "Y":
            parts.append(label.lower())
    return " + ".join(parts)


# Canonical short names for helmers (reporting entities). "Helmer" is our
# jargon for who/what is at the helm: Tesla, Waymo, Zoox, or humans.
HELMER_SHORT = {
    "Waymo LLC":    "Waymo",
    "Tesla, Inc.":  "Tesla",
    "Zoox, Inc.":   "Zoox",
}

# Reports that share a "Same Incident ID" but describe DISTINCT crashes: the
# by-incident dedup would silently drop all but one, so key these by Report ID
# instead. 30270-10320 (MAR-2025 LA, 12:44): a car passing the queue in the
# opposing lane sideswiped the stationary Waymo; 13 minutes later an SUV
# clipped the same (now parked-with-hazards) Waymo "due to a prior collision",
# filed as 30270-10321 under the same Same Incident ID 77ba86fa433a2c4.
SPLIT_SAME_INCIDENT_REPORTS = {"30270-10320"}

# Manual overrides for number of vehicles involved, keyed by Same Incident ID.
# The NHTSA CSV's "Crash With" field is singular and doesn't capture multi-
# vehicle pileups. Default is 2 (the AV + one crash partner). Only the
# fatality metric reads this field (fractional-death divisor) and
# fatality-guard.qual forces a human count for each new fatality; the
# narrative-verified nonfatal counts below are data hygiene so the field is
# true where narratives are explicit (2026-08-22 audit inventory).
VEHICLES_INVOLVED = {
    # Waymo JAN-2025 SF fatality (report 30270-9724): chain collision — AV +
    # car stopped behind it + speeding SUV + a fourth car the AV rotated into,
    # plus "at least two other vehicles" per SFPD ("the other three vehicles",
    # "five passengers in four of the vehicles" injured) = 6 vehicles.
    "4409b059e33b146": 6,
    # Waymo SEP-2025 Tempe fatality: AV + motorcycle + hit-and-run passenger car
    "dc166aecd5b4265": 3,
    # Batch below added 2026-08-22 (human-approved hygiene): narrative-verified
    # 3+-vehicle counts for NONFATAL incidents from the audit inventory (e.g.
    # "All three vehicles sustained damage"). Zero displayed-number change by
    # construction — only the fatality metric reads this field — recorded so
    # the field is true where the narrative is explicit. Six bystander/
    # no-AV-contact rows with murky involvement semantics keep the default.
    "2c723ba2d4b98e0": 3,  # 30270-6579
    "2abc9b4faef00d9": 3,  # 30270-8968
    "3f40494138fe83f": 4,  # 30270-13817
    "20d6da83946bc6a": 5,  # 30270-13955
    "d9ab087a84f0cd4": 5,  # 30270-14986
    "04975f9cbbbb0e2": 4,  # 30270-15301
    "bdce5fc66f1168e": 3,  # 30270-13605
    "57077729fff8e86": 3,  # 30270-13192
    "fc8edb9a7204402": 3,  # 30270-15246
    "c0746bba88135cc": 4,  # 30270-15192
    "ceedaf1e659d839": 3,  # 30270-11791
    "1024682219a18ca": 3,  # 30270-14708
    "7bf2bd79eaff634": 4,  # 30270-10695
    "b18bcaba77a754d": 3,  # 30270-9060
    "19a716eeeeaa926": 3,  # 30270-13399
    "4efc9981e611aef": 3,  # 30270-13877
    "62a06417fd0e440": 3,  # 30270-5997
    "e5600c859fc110c": 3,  # 30270-6906
    "f3e5d2d35b79a77": 4,  # 30270-9761
    "5e05dd39035930e": 3,  # 30270-13195
    "8304b13e00692a8": 3,  # 30270-13585
    "ff7cbbd8a71abe7": 3,  # 30270-14265
    "8c47e2c871cfdd5": 3,  # 30270-15105
    "41439f705214d5b": 4,  # 30270-7158
    "705af0c07826a64": 3,  # 30270-8620
    "f615c017d4c3424": 3,  # 30270-8927
    "1f2bee64088ae54": 3,  # 30270-8982
    "bbb0e2252e1f4dc": 3,  # 30270-9214
    "daa10713b34a31e": 3,  # 30270-9791
    "b80af11c02f6289": 3,  # 30270-9806
    "11e9a791b2b6ea6": 3,  # 30270-10360
    "f2792c77e77c962": 3,  # 30270-10833
    "4bc8fd3b1c7fa4c": 3,  # 30270-10899
    "7ed218ffbe82b26": 3,  # 30270-11874
    "338c89efb1b5863": 3,  # 30270-11929
    "39e914432c9731f": 4,  # 30270-13064
    "06d315f5d5b5e61": 3,  # 30270-13092
    "64f79f6cea38760": 3,  # 30270-13303
    "0d2954a0b45051c": 3,  # 30270-13369
    "f5fd54d443a806a": 3,  # 30270-13575
    "320556479411209": 3,  # 30270-13860
    "1fa562685e928aa": 3,  # 30270-13949
    "94a54c1adb3bcb1": 3,  # 30270-13985
    "3db73b95cac1387": 3,  # 30270-13998
    "6ed4ec06551d417": 3,  # 30270-14271
    "3dadbcf335da06a": 3,  # 30270-14383
    "f714f368c260da3": 3,  # 30270-14586
    "bae2cf6c304a1ed": 3,  # 30270-14804
    "31b153f9cce89b8": 3,  # 30270-14905
    "d5de757e0e3708a": 3,  # 30270-14944
    "7d6d4942edb67c8": 3,  # 30270-15106
    "3aa771b54ce5693": 3,  # 30270-15251
    "06da8374e99eb68": 3,  # 30270-15346
    "025397c44a5648d": 3,  # 30270-15393
    "f16394ad5598be9": 3,  # 30270-15659
    "339bff8c25c90c8": 3,  # 30270-15723
}

# Tesla appends this disclaimer to the front of every redacted-update narrative.
# It conveys no incident facts; strip it so the narrative cell shows the actual
# story. Trailing space is intentional: it sits between the boilerplate and the
# real narrative in the source CSV.
NARRATIVE_BOILERPLATE = (
    "Summary: This updated report does not report a new incident or make any "
    "material changes to the factual record. It only removes confidential or "
    "personally identifying information to make the incident narrative "
    "publicly available. "
)

# NHTSA's published CSV bytes contain several mojibake patterns where the
# source intended common characters (NBSP, curly quotes). Looks like Latin-1
# / Windows-1252 / UTF-8 double-encoding upstream that they then republished
# as UTF-8, preserving the corruption. Normalize each known pattern to its
# intended character. Keyed by codepoint to survive editor mangling.
NARRATIVE_MOJIBAKE = {
    "Â ": " ",                                  # was NBSP (U+00A0)
    "¢ÂÂ": "“",                       # was left curly quote U+201C
    "Ã¢ÂÂ": "”",                      # was right curly quote U+201D
    # Single-mis-decoded variants (UTF-8 bytes read as Latin-1), as \u escapes
    # so the invisible C1 controls survive editors. Full 3-char sequences
    # first so the bare C1 fallback below can't strand a leading "â".
    "\u00e2\u0080\u009c": "\u201c",  # was left curly quote U+201C
    "\u00e2\u0080\u009d": "\u201d",  # was right curly quote U+201D
    "\u00e2\u0080\u0099": "\u2019",  # was apostrophe U+2019
    "\u0080\u009c": "\u201c",  # was left curly quote, leading byte lost upstream
}

# Redaction markers in the source narratives are mostly "[XXX]" but a few
# arrive typo'd ("{XXX}", "]XXX]", "[XXX[", "[XXX}", "{XXX]"), short ("[XX]")
# or long ("[XXXX]"). Normalize to the dominant form so redactions read
# uniformly. Exact-keyed, anti-Postel: only these observed variants are
# rewritten. (None of the keys can match inside a well-formed "[XXX]", so the
# blanket replace is safe.) Two bracket-less variants remain as filed —
# 30270-8827 "September XXX]," and 30270-11190 "[XXX at" — because a
# substring rewrite there would need report-specific handling.
NARRATIVE_TYPOS = {
    "{XXX}": "[XXX]",
    "]XXX]": "[XXX]",
    "[XXX[": "[XXX]",
    "[XXX}": "[XXX]",
    "{XXX]": "[XXX]",
    "[XX]":  "[XXX]",
    "[XXXX]": "[XXX]",
}

# Tesla also appends a meta-correction note when an earlier filing had wrong
# airbag/tow flags. Once the structured fields are corrected, the prose note
# is just edit history and adds nothing for a reader of the narrative. Strip
# it. Captures any MM/DD/YYYY date and any AV name (Tesla/Waymo/Zoox).
NARRATIVE_AIRBAG_CORRECTION = re.compile(
    r"\s*On \d{2}/\d{2}/\d{4}, while submitting this report and removing "
    r"confidential or personally identifying information, the report was "
    r"submitted in error indicating airbag deployment and tow for the "
    r"subject vehicle\. This is in error and the reports were updated to "
    r"reflect that no airbags were deployed and no tow of the "
    r"(?:Tesla|Waymo|Zoox) vehicle was conducted\.\s*$"
)

# Manual severity overrides keyed by Same Incident ID. The NHTSA field
# "Highest Injury Severity Alleged" is sometimes "Unknown"; we resolve it
# from the narrative, counting only human injuries (not animal).
SEVERITY_OVERRIDE = {
    # Detached object from pickup; Waymo passenger alleged unspecified injury
    "3aaa6f68cd36c6a": "Minor W/O Hospitalization",
    # Hit a cat; only animal injured, no human injury
    "4ff19a5f7f16d32": "Property Damage. No Injured Reported",
    # Waymo stopped on US-101; pickup went off bridge; minor injuries in pickup
    "9dd54dcd7afd557": "Minor W/O Hospitalization",
    # Waymo stopped; two SUVs collided behind it; no injuries mentioned
    "7ef0a8cc1427085": "Property Damage. No Injured Reported",
    # Waymo parked; rear-ended by SUV; passengers alleged unknown injuries
    "4ef86957b945a92": "Minor W/O Hospitalization",
    # Waymo stopped at red; rear-ended; other driver transported to hospital
    "2908275d904dec6": "Minor W/ Hospitalization",
    # Waymo slow at stop sign; rear-ended; Waymo passenger transported to hospital
    "bb1ec8d2c85745a": "Minor W/ Hospitalization",
    # Batch below added 2026-07-15: resolved every remaining "Unknown" from
    # its narrative. Transport to hospital -> Minor W/ Hospitalization;
    # alleged/unspecified injury without transport -> Minor W/O; no human
    # injury mentioned -> Property Damage.
    # Waymo rear-ended at red light; an individual transported to hospital
    "04bce80be566c1b": "Minor W/ Hospitalization",
    # Two cars collided behind braking Waymo, no AV contact; no injuries mentioned
    "2e94dccbdb96501": "Property Damage. No Injured Reported",
    # Red-running SUV hit Waymo and fled; towed; no injuries mentioned
    "566bb10e6506178": "Property Damage. No Injured Reported",
    # Passing SUV clipped Waymo; SUV passengers claimed unspecified injuries
    "1856b0e9c61d103": "Minor W/O Hospitalization",
    # Batch below added 2026-08-22 (human-approved): extends the override
    # convention beyond "Unknown" resolution to rows whose AFFIRMATIVE field
    # value flatly contradicts the filing's own narrative — injury claims the
    # field never carried, stated hospital transports on W/O or archive-era
    # bare tiers (no W/-Hospitalization split existed pre-Jun-2025).
    # Trailer clipped stopped Waymo; passenger later alleged unspecified injury, no transport
    "bdb04d1fc17d560": "Minor W/O Hospitalization",
    # "transported from the scene to a hospital" stated as the SGO trigger; archive bare Minor
    "ddd7ca810af9fd2": "Minor W/ Hospitalization",
    # Same transport-trigger sentence; archive bare Minor
    "a2ed9f0f8198649": "Minor W/ Hospitalization",
    # Doored cyclist transported by ambulance; archive bare Moderate
    "45b81f06862d85c": "Moderate W/ Hospitalization",
    # Waymo passenger and other driver transported to hospital; archive bare Moderate
    "a44c6cf951c17dc": "Moderate W/ Hospitalization",
    # Three Waymo passengers transported to a hospital; archive bare Moderate
    "0dc79525eecc923": "Moderate W/ Hospitalization",
    # SUV driver transported (stated as SGO trigger); field said W/O Hospitalization
    "95004cd5904030e": "Moderate W/ Hospitalization",
    # Zoox v2 filed to add V2 driver's soft-tissue injury claim; severity field never updated
    "f0252c0264b68ef": "Minor W/O Hospitalization",
    # (End of the 2026-08-22 batch; the 2026-07-15 Unknown-resolution batch
    # resumes below.)
    # Alleged involvement only, no AV contact; cars behind collided; no injuries
    "8288654b083d6f8": "Property Damage. No Injured Reported",
    # Waymo rear-ended at red; Waymo passenger reported unspecified injury
    "bcd03512755eab2": "Minor W/O Hospitalization",
    # Waymo rear-ended slowing at red arrow; other car alleged unspecified injuries
    "acc8936090bcd7f": "Minor W/O Hospitalization",
    # SUV passed queue via bike lane into turning Waymo; alleged unspecified injuries
    "84ff2f9ead1afe1": "Minor W/O Hospitalization",
    # Waymo rear-ended at speed; transport to hospital, airbags, both towed
    "45c8cddbfd6f959": "Minor W/ Hospitalization",
    # Oncoming pickup crossed yellow into Waymo; its driver transported to hospital
    "9c9d2411ca10891": "Minor W/ Hospitalization",
    # Passenger doored cyclist; cyclist sought urgent care independently, no transport
    "df322c129346f66": "Minor W/O Hospitalization",
    # Waymo deflected crate into scooterist who fell; no injuries mentioned
    "0fa98029f8f1cef": "Property Damage. No Injured Reported",
    # Red-runner chain crash into stopped Waymo; occupant transported to hospital
    "3f40494138fe83f": "Minor W/ Hospitalization",
    # Freeway chain shoved car into Waymo; driver transported, AV passenger minor
    "20d6da83946bc6a": "Minor W/ Hospitalization",
    # Driver doored passing Zoox; hurt hand/neck per media, declined hospital
    "a15c4298c796428": "Minor W/O Hospitalization",
    # ROW-violating SUV hit Zoox; passengers later alleged injuries, no transport
    "b5c5bcbc744b458": "Minor W/O Hospitalization",
    # Waymo rear-ended slowing to turn; other car's passenger transported to hospital
    "dd01fd65edccaf7": "Minor W/ Hospitalization",
    # Speeding SUV rear-ended Waymo; Waymo passenger transported to hospital
    "c02f6672ec1a420": "Minor W/ Hospitalization",
    # SUV lane-change hit motorcycle, shoved into Waymo; rider transported to hospital
    "04975f9cbbbb0e2": "Minor W/ Hospitalization",
    # Car rear-ended hard-braking Zoox; driver bruised, no transport
    "4928b95109f3309": "Minor W/O Hospitalization",
    # Batch below added 2026-08-17 (Aug NHTSA drop), same convention.
    # Oncoming van crossed double yellow into stopped Waymo; van driver transported
    "6f1e8cc59e2ea27": "Minor W/ Hospitalization",
    # Passenger exited slowing Waymo mid-motion, struck by rear tire; transported
    "9fc806cd1d491d5": "Minor W/ Hospitalization",
    # Cyclist ran stop sign, lost control into stopped Zoox; cyclist transported
    "4366476607eca89": "Minor W/ Hospitalization",
    # Speeding SUV clipped Waymo passing on left; driver "unknown injuries", no transport
    "eeafa92b2068aa7": "Minor W/O Hospitalization",
}

# Known-erroneous upstream location fields, keyed by Same Incident ID: the
# SGO row for 30270-7054 (JAN-2024) says City "Phoenix", State "CA" while its
# own narrative reads "operating in Phoenix, Arizona" — an NHTSA data-entry
# error that renders a phantom "Phoenix, CA" city in the Geography table.
STATE_OVERRIDE = {
    "f4e66fc9d21a5b9": "AZ",  # 30270-7054: narrative says Phoenix, Arizona
}

# Airbag deployments the SGO structured columns cannot record, keyed by Same
# Incident ID (added 2026-08-22, human-approved): narratives assert deployment
# — including Waymo's own "because of airbag deployment" reporting-trigger
# sentences — but the SV/CP columns say No or Unknown (third-vehicle
# deployments in chain crashes, and one column-vs-narrative contradiction;
# 30270-6542's CP column is Unknown). airbagAny is defined as
# any-vehicle deployment (matching the Kusano human benchmark), so these are
# forced true. (Distinct from the archive CP-column merge in
# _normalize_archive_row, which already ORs the recorded columns.)
AIRBAG_OVERRIDE = {
    # 30270-9767: filed "because of airbag deployment"; SV/CP columns both No
    "f53d5bab3d70bf4": True,
    # 30270-10174: same trigger sentence; chain crash, third vehicle
    "92953b8c28a4f6c": True,
    # 30270-10573: "the SUV's airbag deployed" (third vehicle)
    "7d57ae266c261bc": True,
    # 30270-13877: "the airbag of the second passenger car deploying"
    "4efc9981e611aef": True,
    # 30270-6542: "video appears to show that airbags deployed in the striking vehicle"
    "2e94dccbdb96501": True,
}


def must(cond, msg, **ctx):
    if not cond:
        raise AssertionError(f"{msg}: {ctx}")


# The archive CSV uses different column names for some fields.
# Map archive names to the current-CSV names used by FIELDS.
ARCHIVE_COLUMN_MAP = {
    "SV Any Air Bags Deployed?":   "Any Air Bags Deployed?",
    "SV Was Vehicle Towed?":       "Was Any Vehicle Towed?",
    "SV Were All Passengers Belted?": "Were All Passengers Belted?",
    "Weather - Fog/Smoke":         "Weather - Fog/Smoke/Haze",
    "Weather - Unknown":           "Weather - Unk - See Narrative",
}


# Current-schema columns the archive CSV never had. They are filled with ""
# explicitly here (one documented place) so the strict field lookup in main()
# can fail loudly on any OTHER missing column.
ARCHIVE_ABSENT_COLUMNS = {"Weather - Partly Cloudy"}


def _normalize_archive_row(row):
    """Add missing current-schema keys to an archive row using column map."""
    for archive_key, current_key in ARCHIVE_COLUMN_MAP.items():
        if current_key not in row and archive_key in row:
            row[current_key] = row[archive_key]
    for absent_key in ARCHIVE_ABSENT_COLUMNS:
        must(absent_key not in row, "archive row unexpectedly carries a column "
             "listed in ARCHIVE_ABSENT_COLUMNS", column=absent_key)
        row[absent_key] = ""
    # The current CSV's single "Any Air Bags Deployed?" means ANY involved
    # vehicle; the archive splits it into SV + CP and ARCHIVE_COLUMN_MAP copies
    # only SV. OR in the crash-partner column so archive-era airbag deployments
    # in the OTHER vehicle aren't dropped (airbagAny is defined as any-vehicle).
    if "Yes" in (row.get("CP Any Air Bags Deployed?") or ""):
        row["Any Air Bags Deployed?"] = "Yes"
    return row


def relpath(path):
    path = Path(path).resolve()
    try:
        return str(path.relative_to(ROOT_DIR))
    except ValueError:
        return str(path)


def latest_snapshot_path(prefix):
    paths = sorted(SNAPSHOT_DIR.glob(f"{prefix}-*.csv"))
    if paths:
        return paths[-1]
    legacy = [path for path in LEGACY_SNAPSHOT_PATHS.get(prefix, [])
              if path.exists()]
    return legacy[-1] if legacy else None


def snapshot_csv_if_changed(prefix, text, stamp):
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    latest = latest_snapshot_path(prefix)
    if latest is not None and latest.read_bytes().decode("utf-8") == text:
        print(f"  Snapshot unchanged: {relpath(latest)}")
        return latest
    base = SNAPSHOT_DIR / f"{prefix}-{stamp}.csv"
    path = base
    i = 2
    while path.exists():
        path = SNAPSHOT_DIR / f"{prefix}-{stamp}-{i}.csv"
        i += 1
    path.write_text(text)
    print(f"  Snapshot saved: {relpath(path)}")
    return path


def fetch_nhtsa_csv(stamp):
    """Fetch ADS incident reports from both current and archive CSVs.

    Returns (rows, headers_by_url), retaining the reviewed HTTP headers for
    both ingested CSVs.
    """
    all_rows = []
    headers_by_url = {}
    snapshot_prefix = {
        NHTSA_ADS_CSV_URL: "nhtsa-current",
        NHTSA_ADS_ARCHIVE_URL: "nhtsa-archive",
    }
    for url in [NHTSA_ADS_CSV_URL, NHTSA_ADS_ARCHIVE_URL]:
        print(f"Fetching NHTSA ADS CSV from {url} ...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            lm = resp.headers.get("Last-Modified")
            etag = resp.headers.get("ETag")
            payload = resp.read()
        headers_by_url[url] = (lm, etag)
        text = payload.decode("utf-8")
        snapshot_csv_if_changed(snapshot_prefix[url], text, stamp)
        is_archive = url == NHTSA_ADS_ARCHIVE_URL
        for row in csv.DictReader(io.StringIO(text)):
            if is_archive:
                _normalize_archive_row(row)
            all_rows.append(row)
    return all_rows, headers_by_url


def modified_date_from_last_modified(last_modified):
    """ISO date of the current CSV's HTTP Last-Modified header."""
    must(last_modified is not None, "NHTSA CSV response lacks a Last-Modified header")
    from email.utils import parsedate_to_datetime
    return parsedate_to_datetime(last_modified).date().isoformat()


def release_month_coverage(data_through_date, last_month):
    """Return the (best, lo, hi) receipt coverage of the data-through month.

    Fails loudly if the reviewed NHTSA_DATA_THROUGH_DATE month is not the
    newest incident month (a new release without a reviewed cutoff), or if
    FIVE_DAY_RECEIPT_COVERAGE disagrees with FIVE_DAY_RECEIPT_OBSERVATIONS.
    """
    data_through_month = datetime.date.fromisoformat(
        data_through_date).strftime("%Y-%m")
    must(data_through_month == last_month,
         "reviewed NHTSA cutoff month must match the latest incident month",
         data_through=data_through_date, last_month=last_month)
    fracs = sorted(n / d for n, d in FIVE_DAY_RECEIPT_OBSERVATIONS.values())
    best, lo, hi = FIVE_DAY_RECEIPT_COVERAGE
    median = statistics.median(fracs)
    must(abs(best - median) < 0.02 and lo <= fracs[0] and fracs[-1] <= hi
         and 0 < lo <= best <= hi <= 1,
         "five-day receipt-coverage constants disagree with their measurements",
         best=best, lo=lo, hi=hi, median=median, observed=fracs)
    return best, lo, hi


def parse_fault_csv(path):
    rows = read_fault_csv_rows(path)
    must(len(rows) > 0, "fault csv has no rows", path=path)
    data = {}
    for row in rows:
        rid = row["reportID"].strip()
        must(rid != "", "fault row missing Report ID", path=path)
        faultfrac = float(row["faultfrac"])
        must(math.isfinite(faultfrac), "faultfrac not finite", path=path, reportId=rid, faultfrac=row["faultfrac"])
        must(0.0 <= faultfrac <= 1.0, "faultfrac out of range", path=path, reportId=rid, faultfrac=faultfrac)
        reasoning = row["reasoning"].strip()
        item = {"faultfrac": faultfrac, "reasoning": reasoning}
        if rid in data:
            must(data[rid] == item, "duplicate Report ID with conflicting fault row", path=path, reportId=rid)
            continue
        data[rid] = item
    return data


def load_fault_data():
    data = parse_fault_csv(FAULT_INPUT)
    return data, set(data)


def read_fault_csv_rows(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        must(reader.fieldnames == FAULT_CSV_FIELDS,
             "fault csv header mismatch", path=path,
             header=reader.fieldnames, expected=FAULT_CSV_FIELDS)
        return list(reader)


def load_fault_report_ids():
    rows = read_fault_csv_rows(FAULT_INPUT)
    must(len(rows) > 0, "fault csv has no rows", path=FAULT_INPUT)
    return {row["reportID"].strip() for row in rows}


def fault_master_row(row):
    return {
        "reportID": row["Report ID"].strip(),
        "speed": row["SV Precrash Speed (MPH)"].strip(),
        "crashwith": row["Crash With"].strip(),
        "svhit": _contact_areas(row, "SV Contact Area"),
        "cphit": _contact_areas(row, "CP Contact Area"),
        "severity": row["Highest Injury Severity Alleged"].strip(),
    }


def build_fault_master_rows(rows, target_ids):
    master_rows = {}
    for row in rows:
        master = fault_master_row(row)
        rid = master["reportID"]
        if rid not in target_ids:
            continue
        prev = master_rows.setdefault(rid, master)
        must(prev == master,
             "conflicting NHTSA master rows for fault report", reportId=rid,
             first=prev, second=master)
    missing = target_ids - set(master_rows)
    must(len(missing) == 0, "fault csv reports missing from NHTSA master",
         missing=sorted(missing)[:5])
    return master_rows


def sync_fault_csv(path, master_rows):
    rows = read_fault_csv_rows(path)
    must(len(rows) > 0, "fault csv has no rows", path=path)

    synced = []
    changed = 0
    for row in rows:
        rid = row["reportID"].strip()
        must(rid in master_rows, "fault csv report missing from NHTSA master",
             path=path, reportId=rid)
        merged = dict(master_rows[rid])
        merged["faultfrac"] = row["faultfrac"]
        merged["reasoning"] = row["reasoning"]
        changed += sum(row[field] != merged[field] for field in FAULT_MASTER_FIELDS)
        synced.append(merged)

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FAULT_CSV_FIELDS,
                                lineterminator="\n")
        writer.writeheader()
        writer.writerows(synced)
    print(f"  Synced {relpath(path)} from NHTSA master data ({changed} field updates)")


def sync_fault_csvs(master_rows):
    sync_fault_csv(FAULT_INPUT, master_rows)


# Month labels in the NHTSA CSV use "JAN-2026"; VMT CSV uses "2026-01".
MONTH_ABBR_TO_NUM = {
    "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
}

def nhtsa_month_to_iso(label):
    """Convert 'JAN-2026' to '2026-01'."""
    abbr, year = label.split("-")
    return f"{year}-{MONTH_ABBR_TO_NUM[abbr]}"


def _vmt_data_rows(raw_text):
    """Yield non-empty VMT data rows (header skipped) as field lists.

    Uses a real CSV parser so quoted fields containing commas — e.g. a
    thousands-separated "22,000,000" — survive intact instead of being
    shredded by a naive line.split(",").
    """
    rows = csv.reader(io.StringIO(raw_text))
    next(rows, None)  # skip header
    for row in rows:
        if any(cell.strip() for cell in row):
            yield row


def _vmt_number(cell):
    """Parse a VMT numeric cell, tolerating thousands-separator commas."""
    return float(cell.strip().replace(",", ""))


def _canonical_helmer(helmer_raw):
    """Map a VMT-master helmer label ("tesla") to the canonical short name.

    Exact case-insensitive match against the short names only: a blank or
    abbreviated label used to prefix-match the first HELMER_SHORT key ("" ->
    Waymo) and silently key another helmer's VMT.
    """
    wanted = helmer_raw.strip().lower()
    hits = [v for v in HELMER_SHORT.values() if v.lower() == wanted]
    must(len(hits) == 1, "VMT master helmer label is not a canonical short name",
         helmer=helmer_raw, allowed=sorted(set(HELMER_SHORT.values())))
    return hits[0]


def parse_vmt_values(raw_text):
    """Extract per-helmer-month best VMT estimates from the raw VMT CSV."""
    result = {}  # (helmer, month) -> vmt_best
    for row in _vmt_data_rows(raw_text):
        result[(_canonical_helmer(row[0].strip()), row[1].strip())] = \
            _vmt_number(row[2])
    return result


def incident_coverage(nhtsa_rows, last_month, receipt_coverage, vmt):
    """Compute conditional pooled incident coverage for the last month.

    The best estimate is a pooled rate-ratio: observed incidents in the
    cutoff month vs the count expected from each helmer's most recent usable
    earlier reference month (VMT-scaled), clamped to (0, 1].  This is a
    stationary-rate heuristic; it does not prove the reference month complete.
    Assuming
    f = 1.0 instead would assert "these are all the incidents" and
    overstate the month's safety.  The lo bound is p_best * exp(-1.96 SE) (log-scale normal
    approximation to the rate ratio); the hi bound is 1.0 (all incidents
    may already be in).  The CI thus spans our ignorance about the true
    conditional incident-coverage fraction f.

    last_month: ISO month string (e.g. "2026-02") — the latest month with
    any incident data.  Derived from the data, not hardcoded.
    receipt_coverage: best-estimate fraction of that month's five-day-track
    incidents present in the release (FIVE_DAY_RECEIPT_COVERAGE[0]). The
    returned fractions are conditional on that receipt frontier; the product
    receipt_coverage * best is invariant to the choice of receipt_coverage.
    vmt: dict from parse_vmt_values(), mapping (helmer, iso_month) to VMT.

    Returns {(helmer, iso_month): (best, lo, hi)} where best/lo/hi are the
    conditional incident-coverage fractions.
    """
    # Count incidents per helmer-month, deduplicated exactly like the main
    # ingestion path: by Report ID first (to safely handle when "Same
    # Incident ID" changes between versions), then by Same Incident ID (with
    # the same split-report override).
    # Version dedup runs over every filed row BEFORE the public-service
    # filter, so a later version that moves a report out of scope retires it
    # (main() does the same; see the 30270-8403 note there).
    filed_rows = [
        r for r in nhtsa_rows
        if r["Report ID"].strip() and r["Report Version"].strip() and
        r["Same Incident ID"].strip() and r["Incident Date"].strip()
    ]
    by_rid = {}  # rid -> {ver, row}
    for r in filed_rows:
        rid = r["Report ID"]
        ver = int(r["Report Version"])
        if rid not in by_rid or ver > by_rid[rid]["ver"]:
            by_rid[rid] = {"ver": ver, "row": r}
    by_incident = {}  # iid -> {ver, helmer, month}
    for entry in by_rid.values():
        r = entry["row"]
        if not is_public_service_incident(r):
            continue
        rid = r["Report ID"]
        iid = rid if rid in SPLIT_SAME_INCIDENT_REPORTS else r["Same Incident ID"]
        ver = int(r["Report Version"])
        helmer = HELMER_SHORT.get(r["Reporting Entity"].strip(),
                                   r["Reporting Entity"].strip())
        month = nhtsa_month_to_iso(r["Incident Date"].strip())
        if iid not in by_incident or ver > by_incident[iid]["ver"]:
            by_incident[iid] = {"ver": ver, "helmer": helmer, "month": month}

    counts = {}  # (helmer, month) -> count
    for rec in by_incident.values():
        key = (rec["helmer"], rec["month"])
        counts[key] = counts.get(key, 0) + 1

    import math
    last_month_helmers = sorted({
        helmer for (helmer, month), miles in vmt.items()
        if month == last_month and miles > 0
    })
    must(last_month_helmers,
         "pooled incident coverage requires positive cutoff-month VMT",
         last_month=last_month)

    # Every fleet with cutoff-month VMT shares ONE pooled coverage value.
    # Request No. 2 requires a report per qualifying crash; one Monthly row
    # cannot certify that a company's entire cycle is complete. Per-fleet
    # counts are too noisy to justify different factors.
    pooled_obs = 0.0   # observed incidents in the incomplete month
    pooled_exp = 0.0   # expected through the cutoff at the reference rate
    pooled_ref = 0.0   # reference-month incidents (for the pooled lower bound)
    for helmer in last_month_helmers:
        last_key = (helmer, last_month)
        last_count = counts.get(last_key, 0)
        last_vmt = vmt[last_key]
        # NOTE: helmers with VMT but ZERO observed incidents in the incomplete
        # month stay in the pool: observing 0 where the reference predicts >0
        # is exactly the "not yet reported" evidence the pooled rate-ratio is
        # designed to capture (excluding them would one-directionally overstate
        # the month's conditional incident coverage).
        # Reference: most recent earlier month with >= 3 incidents and VMT.
        ref = None
        for (drv, mo), c in sorted(counts.items(), key=lambda x: x[0][1],
                                    reverse=True):
            if drv == helmer and mo < last_month and c >= 3:
                ref_vmt = vmt.get((drv, mo), 0)
                if ref_vmt > 0:
                    ref = (mo, c, ref_vmt)
                    break
        if ref is None:
            continue
        ref_mo, ref_count, ref_vmt = ref
        pooled_obs += last_count
        pooled_exp += ref_count * (last_vmt * receipt_coverage / ref_vmt)
        pooled_ref += ref_count

    must(pooled_exp > 0 and pooled_ref > 0,
         "pooled incident coverage requires a usable reference month",
         helmers=last_month_helmers, last_month=last_month)
    result = {}
    # Pooled rate-ratio point estimate (clamped to (0, 1]); using 1.0 would
    # assert "these are all the incidents", overstating the month's safety.
    p_best = max(0.01, min(1.0, pooled_obs / pooled_exp))
    # Lower bound on the log scale: sqrt(1/obs + 1/ref) is the SE of
    # log(rate ratio), and at obs = 12 the linear Wald interval it was used
    # in until 2026-09-04 was skewed (0.134 vs 0.183) and could go negative
    # (hidden by a clamp). The bound is positive by construction.
    log_se = math.sqrt(1 / max(pooled_obs, 1) + 1 / pooled_ref)
    p_lo = p_best * math.exp(-1.96 * log_se)
    must(0 < p_lo <= p_best, "pooled incident-coverage bound out of range",
         p_lo=p_lo, p_best=p_best)
    for helmer in last_month_helmers:
        last_key = (helmer, last_month)
        result[last_key] = (round(p_best, 4), round(p_lo, 4), 1.0)
    print(f"  {last_month} pooled incident_coverage: best={p_best:.4f}"
          f" lo={p_lo:.4f} (observed {int(pooled_obs)} / expected {pooled_exp:.1f})")

    return result


def read_vmt_master():
    """Read raw VMT CSV text from the in-repo master (data/vmt.csv)."""
    return VMT_MASTER.read_text()


def parse_vmt_months(raw_text):
    """Parse the set of ISO months from the raw VMT CSV text."""
    return {row[1].strip() for row in _vmt_data_rows(raw_text)}


def build_vmt_csv(raw_text, inc_cov, coverage_by_month, active_months):
    """Add coverage + incident_coverage columns to the raw VMT CSV text.

    inc_cov: dict from incident_coverage(), mapping (helmer, iso_month) to
    (best, lo, hi) tuples.  Missing keys default to (1, 1, 1).
    coverage_by_month: {iso_month: (best, lo, hi)} receipt coverage of the
    data-through month (release_month_coverage()). Missing months default to
    (1, 1, 1).
    active_months: set of ISO months to include — every master month at or
    before the latest incident month (strictly-future master months are
    excluded; months with VMT but no incidents stay in).
    """
    rows = list(csv.reader(io.StringIO(raw_text)))
    must(len(rows) > 1, "VMT master CSV must include header and rows")
    expected_header = ["helmer", "month", "vmt", "helmer_cumulative_vmt",
                       "kyoom_min", "kyoom_max", "vmt_min", "vmt_max",
                       "rationale"]
    must(rows[0] == expected_header,
         "VMT master CSV header mismatch", header=rows[0])
    out_buf = io.StringIO()
    writer = csv.writer(out_buf, lineterminator="\n")
    writer.writerow(["helmer", "month", "vmt", "helmer_cumulative_vmt",
                     "kyoom_min", "kyoom_max", "vmt_min", "vmt_max",
                     "coverage", "coverage_min", "coverage_max",
                     "incident_coverage", "incident_coverage_min",
                     "incident_coverage_max", "rationale"])
    for row in rows[1:]:
        if not any(cell.strip() for cell in row):
            continue
        month = row[1].strip()
        if month not in active_months:
            continue
        ic_best, ic_lo, ic_hi = inc_cov.get(
            (_canonical_helmer(row[0].strip()), month), (1, 1, 1))
        cov_best, cov_lo, cov_hi = coverage_by_month.get(month, (1, 1, 1))
        # Normalize the six numeric columns to plain integers: a
        # thousands-separated "22,000,000" entered in the master CSV becomes
        # 22000000, matching the plain-integer convention of the rest of
        # the data and keeping the emitted CSV safe for naive parsers.
        nums = [cell.strip().replace(",", "") for cell in row[2:8]]
        # Exactly nine cells: a rationale with an unquoted comma would
        # otherwise be truncated at that comma without a word.
        must(len(row) == 9, "VMT master row must have exactly 9 cells",
             helmer=row[0], month=month, cells=len(row))
        rationale = row[8]
        writer.writerow([row[0], row[1], *nums, cov_best, cov_lo, cov_hi,
                         ic_best, ic_lo, ic_hi, rationale])
    return out_buf.getvalue().rstrip("\n")


def js_template_literal(text):
    return text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


EXPECTED_REPORT_TYPES = {
    "1-Day", "5-Day", "10-Day Update", "Monthly", "Update",
    "No New or Updated Incident Reports",
}
EXPECTED_DRIVER_TYPES = {
    "",
    "Consumer",
    "In-Vehicle (Commercial / Test)",
    "In-Vehicle and Remote (Commercial / Test)",
    "None",
    "Other, see Narrative",
    "Remote (Commercial / Test)",
    "Unknown",
}
# NHTSA "Highest Injury Severity Alleged" values across current + archive CSVs.
# Anti-Postel: a new severity string must crash here so a human classifies it.
# The app-side counterpart is SEVERITY_INFO in crashla.js (which drives the
# injury/hospitalization/serious-injury metrics); "" never survives into the
# kept robotaxi incidents. Keep the two in sync when NHTSA adds a value.
EXPECTED_SEVERITIES = {
    "",
    "No Injuries Reported",
    "No Injured Reported",
    "Property Damage. No Injured Reported",
    "Unknown",
    "Minor",
    "Minor W/O Hospitalization",
    "Minor W/ Hospitalization",
    "Moderate",
    "Moderate W/O Hospitalization",
    "Moderate W/ Hospitalization",
    "Serious",
    "Serious W/ Hospitalization",
    "Fatality",
}
# All reporting entities in the NHTSA ADS CSV (current + archive).
# Anti-Postel: if NHTSA adds a new reporting entity, we want to crash and review.
# Being listed here only means "known to NHTSA and classified by a human" -- it
# does NOT put the entity in scope; scope is HELMER_SHORT (Waymo/Tesla/Zoox).
# MOIA America LLC (added 2026-09-15 release): Volkswagen's ID. Buzz AD
# subsidiary, filing separately from "Volkswagen Group of America, Inc.";
# first report 35021-16268 is a JUL-2026 Beverly Hills, CA test drive with a
# safety driver in the driver's seat (ADS disengaged 9 s before contact).
# Out of scope: no public driverless service, so no VMT denominator.
EXPECTED_HELMERS = {
    "Ambarella",
    "Apollo Autonomous Driving USA",
    "Apple Inc.",
    "Argo AI",
    "Aurora Operations, Inc.",
    "AutoX Technologies Inc",
    "Avride Inc.",
    "Beep, Inc.",
    "Chrysler (FCA US, LLC)",
    "Cruise LLC",
    "Daimler Trucks North America, LLC",
    "Easymile Inc.",
    "First Transit",
    "Ford Motor Company",
    "Gatik AI Inc.",
    "General Motors, LLC",
    "Ghost Autonomy Inc.",
    "Hyundai Motor America",
    "Kia America, Inc.",
    "Kodiak Robotics",
    "Local Motors Industries",
    "Lucid USA, Inc.",
    "MOIA America LLC",
    "May Mobility",
    "Mercedes-Benz USA, LLC",
    "Mobileye Vision Technologies",
    "Motional",
    "NAVYA Inc.",
    "NVIDIA CORP",
    "Navistar, Inc.",
    "Nuro",
    "Ohmio, Inc.",
    "Oxbotica",
    "PACCAR Incorporated",
    "PlusAI Inc",
    "Pony.ai",
    "Robert Bosch, LLC",
    "Robotic Research",
    "Stack AV",
    "TORC Robotics, Inc.",
    "Tesla, Inc.",
    "Toyota Motor Engineering & Manufacturing",
    "Transdev Alternative Services",
    "TuSimple",
    "VinFast Auto, LLC",
    "Volkswagen Group of America, Inc.",
    "Volvo Car USA, LLC",
    "Waymo LLC",
    "WeRide Corp",
    "Zoox, Inc.",
}
# NHTSA's "Driver / Operator Type" values that count as a reporting entity's
# public robotaxi service -- the service whose mileage the VMT master tracks,
# which keeps incident counts matched to that denominator. Every operator's
# public service runs driverless ("None"). Tesla's Austin robotaxi also
# carries an in-vehicle safety monitor, which NHTSA files as "In-Vehicle
# (Commercial / Test)", so that mode counts as public service for Tesla too.
# Tesla additionally files remote-assistance maneuvers as "Remote (Commercial
# / Test)" (one report so far: 13781-15395, the Houston tree-stump recovery).
# Included per human decision 2026-08-19: those vehicles' miles are already in
# the VMT denominator, so their crashes belong in the numerator; fault is
# judged 0 when a remote human, not the ADS, was driving (same convention as
# passenger-caused incidents). For entities configured here the set must stay
# EXHAUSTIVE over the operator types they file -- main() must()s that, so a
# novel mode crashes the run for a human to classify instead of silently
# dropping out of scope (which is how 13781-15395 went unnoticed for a month).
PUBLIC_SERVICE_OPERATOR_TYPES = {
    "Tesla, Inc.": {"None", "In-Vehicle (Commercial / Test)",
                    "Remote (Commercial / Test)"},
}
must(set(PUBLIC_SERVICE_OPERATOR_TYPES) <= EXPECTED_HELMERS,
     "PUBLIC_SERVICE_OPERATOR_TYPES names an unknown reporting entity",
     unknown=set(PUBLIC_SERVICE_OPERATOR_TYPES) - EXPECTED_HELMERS)
must(all(types <= EXPECTED_DRIVER_TYPES
         for types in PUBLIC_SERVICE_OPERATOR_TYPES.values()),
     "PUBLIC_SERVICE_OPERATOR_TYPES names an unknown Driver / Operator Type")


def is_public_service_incident(row):
    """True if <row> is an incident from the reporting entity's public
    robotaxi service (the service the VMT master measures)."""
    counted = PUBLIC_SERVICE_OPERATOR_TYPES.get(
        row["Reporting Entity"].strip(), {"None"})
    return row["Driver / Operator Type"].strip() in counted


INCIDENT_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")
SUBMISSION_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")


def main():
    run_stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    rows, nhtsa_headers = fetch_nhtsa_csv(run_stamp)
    must(len(rows) > 0, "NHTSA CSV has no rows")
    release_rows = rows
    nhtsa_last_modified, _etag = nhtsa_headers[NHTSA_ADS_CSV_URL]
    nhtsa_modified_date = modified_date_from_last_modified(nhtsa_last_modified)

    # Anti-Postel: fail loud on unexpected field values.
    # Skip placeholder rows (empty incident ID or date) from archive.
    valid_rows = []
    for i, r in enumerate(rows):
        iid = r["Same Incident ID"].strip()
        idate = r["Incident Date"].strip()
        if not iid or not idate:
            continue  # Placeholder rows (e.g., "No New or Updated" entries)
        rt = r["Report Type"].strip()
        must(rt in EXPECTED_REPORT_TYPES,
             "unexpected Report Type", row=i, value=rt,
             expected=sorted(EXPECTED_REPORT_TYPES))
        dt = r["Driver / Operator Type"].strip()
        must(dt in EXPECTED_DRIVER_TYPES,
             "unexpected Driver / Operator Type", row=i, value=dt,
             expected=sorted(EXPECTED_DRIVER_TYPES))
        driver = r["Reporting Entity"].strip()
        must(driver in EXPECTED_HELMERS,
             "unexpected Reporting Entity", row=i, value=driver,
             expected=sorted(EXPECTED_HELMERS))
        counted = PUBLIC_SERVICE_OPERATOR_TYPES.get(driver)
        if counted is not None:
            must(dt in counted,
                 "operator type outside the configured public-service set "
                 "(classify this mode: add it to PUBLIC_SERVICE_OPERATOR_TYPES "
                 "or record an explicit exclusion)",
                 row=i, entity=driver, value=dt, counted=sorted(counted))
        sev = r["Highest Injury Severity Alleged"].strip()
        must(sev in EXPECTED_SEVERITIES,
             "unexpected Highest Injury Severity Alleged", row=i, value=sev,
             expected=sorted(EXPECTED_SEVERITIES))
        must(INCIDENT_DATE_RE.match(idate),
             "unexpected Incident Date format", row=i, value=idate)
        abbr = idate.split("-")[0]
        must(abbr in MONTH_ABBR_TO_NUM,
             "unknown month abbreviation in Incident Date", row=i, value=idate)
        sub = r["Report Submission Date"].strip()
        if sub:
            must(SUBMISSION_DATE_RE.match(sub),
                 "unexpected Report Submission Date format", row=i, value=sub)
            sub_abbr = sub.split("-")[0]
            must(sub_abbr in MONTH_ABBR_TO_NUM,
                 "unknown month abbreviation in Submission Date", row=i,
                 value=sub)
        ver = r["Report Version"].strip()
        must(ver.isdigit() and int(ver) >= 1,
             "Report Version must be positive integer", row=i, value=ver)
        valid_rows.append(r)
    rows = valid_rows

    # Dedup by Report ID first, over EVERY filed row, keeping the highest
    # Report Version. Grouping by Report ID safely handles a "Same Incident
    # ID" that changes between versions, and running it before the
    # public-service filter lets a later version retire a report from scope:
    # 30270-8403 v2 (Waymo, JUL-2024) reclassified the crash as
    # "In-Vehicle and Remote (Commercial / Test)" — "a test driver was
    # present" — so v1's "None" must not survive (it did until 2026-09-04).
    by_rid = {}
    for r in rows:
        rid = r["Report ID"]
        ver = int(r["Report Version"])
        if rid not in by_rid or ver > by_rid[rid]["_ver"]:
            by_rid[rid] = {"_ver": ver, "_row": r}

    # Then filter the surviving versions to each entity's public-service
    # operator types (see PUBLIC_SERVICE_OPERATOR_TYPES) and deduplicate by
    # Same Incident ID (except the known distinct-crash reports, which keep
    # their own Report ID as the key)
    by_incident = {}
    for entry in by_rid.values():
        r = entry["_row"]
        if not is_public_service_incident(r):
            continue
        rid = r["Report ID"]
        iid = rid if rid in SPLIT_SAME_INCIDENT_REPORTS else r["Same Incident ID"]
        ver = int(r["Report Version"])
        if iid not in by_incident or ver > by_incident[iid]["_ver"]:
            by_incident[iid] = {"_ver": ver, "_row": r}

    # Load VMT data up front so we can fail fast on stale VMT before any
    # file writes (fault CSV sync below).
    # The archive includes years of data; we only need months with VMT.
    vmt_raw = read_vmt_master()
    vmt_months = parse_vmt_months(vmt_raw)

    # Guard against stale VMT data. Incidents older than the VMT history are
    # expected (the NHTSA archive goes back years) and get dropped quietly
    # below. Incidents *newer* than the latest VMT month are different: NHTSA
    # has published crashes the VMT master hasn't caught up to, and silently
    # dropping them hides real data. Abort loudly so data/vmt.csv gets
    # updated instead.
    vmt_latest = max(vmt_months)
    stale = {}
    for entry in by_incident.values():
        m = nhtsa_month_to_iso(entry["_row"]["Incident Date"].strip())
        if m > vmt_latest:
            stale.setdefault(m, []).append(entry["_row"]["Report ID"])
    must(not stale,
         "data/vmt.csv is out of date: NHTSA reports incidents in months with "
         f"no VMT data (latest VMT month is {vmt_latest}). Add VMT rows "
         "covering these months to data/vmt.csv, then re-run slurp.py.",
         stale_months={m: sorted(rids) for m, rids in sorted(stale.items())})

    fault_target_ids = load_fault_report_ids()
    fault_master_rows = build_fault_master_rows(
        (entry["_row"] for entry in by_incident.values()),
        fault_target_ids,
    )

    sync_fault_csvs(fault_master_rows)
    fault_data, fault_ids = load_fault_data()

    # Filter to months that have VMT data for any helmer.
    # Derive last_month from the data: latest incident month that also has VMT.
    # Months with VMT but no incidents yet (beyond the NHTSA reporting frontier)
    # are excluded so we don't show 0-incident months with full VMT.
    incident_months_with_vmt = set()
    for entry in by_incident.values():
        m = nhtsa_month_to_iso(entry["_row"]["Incident Date"].strip())
        if m in vmt_months:
            incident_months_with_vmt.add(m)
    last_month = max(incident_months_with_vmt)
    vmt_months = {m for m in vmt_months if m <= last_month}
    print(f"Last incident month: {last_month}")
    submission_months = {
        nhtsa_month_to_iso(r["Report Submission Date"].strip())
        for r in release_rows if r["Report Submission Date"].strip()
    }
    must(submission_months, "NHTSA data has no report-submission months")
    must(max(submission_months) == last_month,
         "latest report-submission month must match the incident frontier",
         submission_month=max(submission_months), last_month=last_month)
    last_month_coverage = release_month_coverage(
        NHTSA_DATA_THROUGH_DATE, last_month)
    coverage_by_month = {last_month: last_month_coverage}
    # The data-through month must hold public-service filings at all (a
    # release whose newest month is empty for our fleets would make the
    # receipt-coverage scaling meaningless). Until 2026-09-04 a further guard
    # rejected ANY Monthly filing in this month on the premise that none can
    # exist before the 15th of the following month; that premise was false
    # (Tesla files some Monthly reports within the incident month — the
    # Feb-2026 release held four JAN-2026 ones) and the case it meant to
    # catch, a Monthly report received after the cutoff, is already caught by
    # the submission-month guard above (such a report carries a later
    # Report Submission Date).
    last_month_rows = [
        r for r in release_rows
        if r["Incident Date"].strip() and is_public_service_incident(r) and
        nhtsa_month_to_iso(r["Incident Date"].strip()) == last_month
    ]
    must(last_month_rows, "data-through month has no public-service filings",
         last_month=last_month)

    window_by_incident = {}
    excluded_count = 0
    for iid, entry in by_incident.items():
        month_iso = nhtsa_month_to_iso(entry["_row"]["Incident Date"].strip())
        if month_iso not in vmt_months:
            excluded_count += 1
            continue
        window_by_incident[iid] = entry
    if excluded_count > 0:
        print(f"Excluded {excluded_count} incidents outside VMT window")

    incidents = []
    for iid, entry in window_by_incident.items():
        r = entry["_row"]
        rec = {}
        for csv_field in FIELDS:
            key = KEY_MAP[csv_field]
            # Strict lookup: a FIELDS column missing from a source CSV fails
            # here instead of blanking silently (the archive's absent columns
            # are filled explicitly in _normalize_archive_row).
            val = r[csv_field].strip().replace("\r\n", "\n").replace("\r", "\n")
            rec[key] = val
        # Shorten helmer name
        rec["helmer"] = HELMER_SHORT.get(rec["helmer"], rec["helmer"])
        # Parse speed as number
        try:
            rec["speed"] = int(rec["speed"])
        except (ValueError, TypeError):
            rec["speed"] = None
        # Convert airbag field to boolean (any vehicle deployment)
        rec["airbagAny"] = "Yes" in rec["airbagAny"]
        nar = rec["narrative"]
        # One Tesla filing (13781-15342) arrived wrapped in "[Summary: ...]"
        # brackets; unwrap before the prefix strips below can match.
        if nar.startswith("[Summary:") and nar.endswith("]"):
            nar = nar[1:-1]
        nar = NARRATIVE_AIRBAG_CORRECTION.sub(
            "", nar.removeprefix(NARRATIVE_BOILERPLATE))
        # Tesla's filing template opens with a contentless "Summary:" label
        # (other helmers have none); drop it so blurbs read uniformly.
        nar = nar.removeprefix("Summary:").lstrip()
        for bad, good in NARRATIVE_MOJIBAKE.items():
            nar = nar.replace(bad, good)
        for bad, good in NARRATIVE_TYPOS.items():
            nar = nar.replace(bad, good)
        rec["narrative"] = nar
        # Compact contact area summaries from NHTSA boolean columns
        rec["svHit"] = _contact_areas(r, "SV Contact Area")
        rec["cpHit"] = _contact_areas(r, "CP Contact Area")
        rid = rec["reportId"]
        if rid in fault_ids:
            rec["fault"] = {
                "faultfrac": fault_data[rid]["faultfrac"],
                "reasoning": fault_data[rid]["reasoning"],
            }
        else:
            rec["fault"] = None
        iid_short = rec["incidentId"]
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(iid_short, 2)
        if iid_short in SEVERITY_OVERRIDE:
            rec["severity"] = SEVERITY_OVERRIDE[iid_short]
        if iid_short in AIRBAG_OVERRIDE:
            rec["airbagAny"] = AIRBAG_OVERRIDE[iid_short]
        if iid_short in STATE_OVERRIDE:
            rec["state"] = STATE_OVERRIDE[iid_short]
        incidents.append(rec)

    # Sort by helmer then date (ISO month sorts lexicographically)
    incidents.sort(key=lambda r: (
        r["helmer"],
        nhtsa_month_to_iso(r["date"]),
        r["time"],
    ))

    # Compute conditional pooled incident coverage before building VMT CSV.
    # Compare last month's observed rate to the reference month's rate.
    window_rows = [
        r for r in release_rows
        if not r.get("Incident Date", "").strip() or
        nhtsa_month_to_iso(r["Incident Date"].strip()) in vmt_months
    ]
    vmt_values = parse_vmt_values(vmt_raw)
    inc_cov = incident_coverage(
        window_rows, last_month, last_month_coverage[0], vmt_values)

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(incidents, indent=2) + "\n"
    vmt_text = build_vmt_csv(
        vmt_raw, inc_cov, coverage_by_month, vmt_months,
    ).replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    vmt_template = "\n`" + js_template_literal(vmt_text) + "\n`\n"

    def inject(source, start_marker, end_marker, payload):
        """Replace content between marker comments with payload."""
        si = source.index(start_marker)
        ei = source.index(end_marker, si)
        return source[:si] + start_marker + payload + source[ei:]

    fetch_date = datetime.date.today().isoformat()

    # Compute BOTH injected texts before writing EITHER file, so a missing
    # marker in the second file cannot leave the pair half-updated.
    with open(INCIDENT_JS) as f:
        inc_js = f.read()
    inc_js = inject(inc_js,
                    "/* NHTSA_FETCH_DATE_START */", "/* NHTSA_FETCH_DATE_END */",
                    f'"{fetch_date}"')
    inc_js = inject(inc_js,
                    "/* NHTSA_MODIFIED_DATE_START */", "/* NHTSA_MODIFIED_DATE_END */",
                    f'"{nhtsa_modified_date}"')
    inc_js = inject(inc_js,
                    "/* NHTSA_DATA_THROUGH_DATE_START */", "/* NHTSA_DATA_THROUGH_DATE_END */",
                    f'"{NHTSA_DATA_THROUGH_DATE}"')
    inc_js = inject(inc_js,
                    "/* INCIDENT_DATA_START */", "/* INCIDENT_DATA_END */",
                    incident_json)
    with open(VMT_JS) as f:
        vmt_js = f.read()
    vmt_js = inject(vmt_js,
                    "/* VMT_CSV_START */", "/* VMT_CSV_END */",
                    vmt_template)
    with open(INCIDENT_JS, "w") as f:
        f.write(inc_js)
    with open(VMT_JS, "w") as f:
        f.write(vmt_js)

    # Summary
    counts = Counter(r["helmer"] for r in incidents)
    total = len(incidents)
    print(f"NHTSA file last modified: {nhtsa_modified_date}")
    print(f"NHTSA incident data through: {NHTSA_DATA_THROUGH_DATE}")
    print(f"Updated {relpath(INCIDENT_JS)} and {relpath(VMT_JS)}")
    print(f"Total incidents: {total}")
    for helmer, n in counts.most_common():
        print(f"  {helmer}: {n}")

    # Passenger occupancy summary per helmer
    print("\nPassenger occupancy at time of incident:")
    for helmer in sorted(counts):
        co_incidents = [r for r in incidents if r["helmer"] == helmer]
        n = len(co_incidents)
        # Same three classes as crashla.js PAX_NONE / PAX_UNKNOWN / PAX_PRESENT
        # (both no-passenger encodings count as no passenger).
        pax_none = {"Subject Vehicle - No Passenger In Vehicle",
                    "No Passengers in Vehicle"}
        pax_unknown = {"Unknown", ""}
        with_pax = sum(1 for r in co_incidents
                       if r["belted"] not in pax_none | pax_unknown)
        no_pax = sum(1 for r in co_incidents if r["belted"] in pax_none)
        unk = n - with_pax - no_pax
        pct = f"{100*with_pax/n:.0f}%" if n else "n/a"
        print(f"  {helmer}: {with_pax}/{n} with passenger ({pct})"
              f"  [no passenger: {no_pax}, unknown: {unk}]")


if __name__ == "__main__":
    main()

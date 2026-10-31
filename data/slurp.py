#!/usr/bin/env python3
"""Slurp live NHTSA SGO crash data into inline data for the web tool.

Fetches current + archive ADS incident CSVs from NHTSA, deduplicates by
Report ID (keeping the highest Report Version), keeps the crashes in which
each helmer's ADS was driving in a mode whose miles are in its VMT
denominator (PUBLIC_SERVICE_OPERATOR_TYPES / EXCLUDED_OPERATOR_TYPES,
OPERATOR_TYPE_OVERRIDE, TELEOP_DRIVEN_REPORTS, and the narrative tripwires
beside them), keeps one report per Same Incident ID (a reviewed table says
which when two are filed: SUPERSEDED_REPORTS, SPLIT_SAME_INCIDENT_REPORTS),
joins in the in-repo VMT master (data/vmt.csv) and fault inputs
(data/faultfrac.csv), and injects the data into data/incidents.js and
data/vmt.js (between marker comments). Every check runs before any of
data/incidents.js, data/vmt.js and data/faultfrac.csv is written, so a run
that stops writes only the NHTSA snapshots it fetched (data/README.md, Each
NHTSA release).
"""

import csv
import datetime
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
# RECEIVED through that date, which is the 15th of the month before the
# release rolled forward to the next business day when the 15th falls on a
# weekend or federal holiday (NHTSA's data-dictionary change log, Table 1 of
# https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Data_Element_Definitions.pdf,
# republished with each release and fetchable by script: "10/15/2026 Data
# release of reports received through September 15, 2026"; "9/15/2026 Data
# release of reports received through August 17, 2026"; likewise Nov 17
# 2025, Feb 17 and Mar 16 2026; quals/nhtsa-cutoff-date pins the rule)
# (verified from data/snapshots history:
# each release's newest incident month holds almost only five-day-track
# filings and grows ~6x in the next release; the second-newest month's
# five-day-track count never grows again, though a Monthly report can still
# arrive a release late: MONTHLY_ARRIVAL_LAG).
# https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting
# That page 403s scripted fetches, so the reviewed cutoff is recorded here —
# one edit per release — and guarded by content asserts in main(): the cutoff
# month must equal both the newest incident month and the newest submission
# month (a report received after the cutoff carries a later Report Submission
# Date, so a stale cutoff trips there). Monthly filings submitted within the
# incident month itself are rare but real (Tesla files early; the Feb-2026
# release held four JAN-2026 ones) and are consistent with the cutoff.
NHTSA_DATA_THROUGH_DATE = "2026-09-15"
# Receipt coverage of the data-through month. Reports received through the
# cutoff cover only crashes from the first part of that month: the five-day
# clock runs from the company's notice, plus NHTSA processing. Since
# 2026-10-31 (decision D6 of 2026-10-30) the share present is estimated from
# the month itself, observed / expected, as incident_coverage() estimates the
# Monthly track's (release_month_coverage()). Until then it was the median of
# earlier months' first-release shares (FIVE_DAY_RECEIPT_COVERAGE = (0.28,
# 0.20, 0.52): the median, and the observed range padded), which is right only
# if that share holds steady; it fell from 0.50 in February 2026 to 0.21 in
# August, and September's 7 five-day-track incidents in the Oct-15-2026 file,
# the fewest yet, give 0.136 by observed / expected.
#
# FIVE_DAY_RECEIPT_OBSERVATIONS records those first-release shares, measured
# from data/snapshots history: (five-day-type public-service Waymo/Tesla/Zoox
# incidents of month M present in the first release containing M) / (M's
# eventual five-day-type total), deduplicated as main() does. An incident's
# type is its first filing's Report Type (REPORT_TRACK), so a later Update
# leaves it in the count (2026-08's 30270-16286, a 5-Day report whose v2 is an
# Update, first entered as 47). They set the band's high edge
# (FIVE_DAY_RECEIPT_COVERAGE_MAX). Re-measure and re-review on each release;
# quals/receipt-observations.qual.mjs recounts the table from data/snapshots.
# Re-measured 2026-09-04 (the 2026-08-28 table read 18/38, 25/69, 16/57,
# 17/60 — a transcription slip; every filter variant reproduces the counts
# below, e.g. the Feb numerator includes Zoox 30610-14026).
# A month's denominator is final at its second NORMAL release: verified across
# every release snapshot (Feb 19->38 then flat x6; Apr 3->58 flat; May 16->58
# flat; Jun 17->61 flat; Jul 12->58 flat). The one exception proves the rule — Mar ran 25->53->72
# because its second release WAS the truncated May-15 one.
FIVE_DAY_RECEIPT_OBSERVATIONS = {
    "2026-02": (19, 38),   # Mar-16-2026 release vs the Aug-17-2026 file
    "2026-03": (25, 72),   # Apr-15-2026 release
    "2026-05": (16, 58),   # Jun-15-2026 release
    "2026-06": (17, 61),   # Jul-15-2026 release
    "2026-07": (12, 58),   # Aug-17-2026 release vs the Sep-15-2026 file
    "2026-08": (10, 48),   # Sep-15-2026 release vs the Oct-15-2026 file
    # 2026-04 excluded: the May-15-2026 release was cut early (3 April
    # incidents / 19 April submissions vs ~17 / ~90 in every other release).
}
# The receipt band's high edge: the highest first-release share on record
# (February 2026's 19/38 = 0.50), padded, the reading in which the month's low
# count is real rather than lagging. release_month_coverage() stops when an
# observation exceeds it, or when the data-through month's own observed /
# expected does: raise it then, if the observation stands (data/README.md,
# Each NHTSA release, step 2).
FIVE_DAY_RECEIPT_COVERAGE_MAX = 0.52
# Months with no usable first-release observation, with the reason; every
# other month from the first observation on must be measured (see
# release_month_coverage).
RECEIPT_MONTHS_EXCLUDED = {
    "2026-04": "its first release (May 15, 2026) was truncated: 3 April "
               "incidents of an eventual 58, 19 April submissions",
}
# Monthly-track report arrival, per helmer (modeled 2026-10-03, human
# decision). SGO Request No. 2 (Monthly) reports for incident month M are due
# by the 15th of M+1, so they normally reach the public file at the release
# whose data-through month is M+1 (M's second release), and from then on the
# app treats M as complete. A helmer whose Monthly reports land later leaves
# months that look complete but are not: every in-scope Zoox Monthly-track
# report of January-July 2026 reached the file one release late, so the
# Sep-15-2026 file held only Zoox's one July 5-Day report (30610-15722).
# MONTHLY_ARRIVAL_LAG is each helmer's extra lag, in releases. The months
# inside it (the ones just before the data-through month) get a Monthly-track
# incident coverage of the helmer's in-scope 5-Day share instead of 1
# (monthly_lag_coverage()); five-day-track metrics are unaffected, because
# the 5-Day reports arrive on the normal schedule.
#
# MONTHLY_ARRIVAL_OBSERVATIONS: for each helmer and incident month M, its
# in-scope Monthly-track incidents (deduplicated as main() does, in the newest
# file; an incident's track is its surviving report's version-1 Report Type)
# counted by the release at which that report first appeared, as (by the
# release whose data-through month is M+1, one release later, ...). Measured
# from data/snapshots history; a month enters at the release whose
# data-through month is M+2, when an arrival one release late is visible
# (monthly_lag_coverage() requires it then). A lagged helmer's lagged month
# that already holds a Monthly-track report enters one release early, at M+1,
# with its on-time count (monthly_lag_coverage() stops until it does), and is
# re-measured at M+2 like any other month: 2026-08 entered so on the
# Oct-15-2026 release, which already held Tesla's 7 and Zoox's 3 in-scope
# August Monthly reports (and Waymo's 20). The recipe and its independent
# recompute are in quals/monthly-arrival-lag.qual.mjs; re-measure on each
# release with FIVE_DAY_RECEIPT_OBSERVATIONS. Measurable from Dec 2025 (the
# oldest snapshot release holds data through Dec 2025), where Zoox's two
# Monthly reports (30610-13660, -13661) arrived on time: the late pattern
# holds for every 2026 month, and the table starts there.
MONTHLY_ARRIVAL_OBSERVATIONS = {
    "Waymo": {"2026-01": (30, 0), "2026-02": (34, 1), "2026-04": (53, 1),
              "2026-05": (42, 0), "2026-06": (46, 0), "2026-07": (31, 0),
              "2026-08": (20,)},
    "Tesla": {"2026-01": (4, 0), "2026-02": (0, 0), "2026-04": (1, 0),
              "2026-05": (2, 0), "2026-06": (2, 0), "2026-07": (1, 1),
              "2026-08": (7,)},
    "Zoox": {"2026-01": (0, 0), "2026-02": (0, 3), "2026-04": (0, 3),
             "2026-05": (0, 0), "2026-06": (0, 2), "2026-07": (0, 2),
             "2026-08": (3,)},
}
# Months whose arrivals cannot be measured, with the reason; every other month
# from the first observation on must be observed (monthly_lag_coverage()).
MONTHLY_ARRIVAL_MONTHS_EXCLUDED = {
    "2026-03": "its second release (May 15, 2026) was truncated, so its "
               "Monthly reports reached the file one release late for "
               "Waymo too (all 44 in scope; Tesla 2 of 2 on time, Zoox 0 of 2)",
}
# Each helmer's lag is the extra lag of the majority of its newest observed
# month with any Monthly-track incident (ties count as late), which
# monthly_lag_coverage() checks. Zoox's was 1 from 2026-10-03 until the
# Oct-15-2026 release, where its August reports arrived on time; there
# Tesla's July tie (13781-16255 on time; 13781-16294, submitted in August,
# first in the Oct-15-2026 file) would have made Tesla's 1 too, but its August
# reports had arrived on time as well.
MONTHLY_ARRIVAL_LAG = {"Waymo": 0, "Tesla": 0, "Zoox": 0}
# For each helmer with a lag: (in-scope 5-Day-track incidents, all in-scope
# incidents) per incident month, deduplicated as main() does and counted in
# the newest file (monthly_lag_coverage() checks them against it), from
# 2026-01 through the newest month that is final for the helmer (data-through
# month - 1 - lag). Its lagged months' Monthly-track incident coverage is
# (pooled share, lowest monthly share, 1.0): Zoox Jan-Jun 2026 = 17/27 =
# 0.6296, February's 1/4 = 0.25 the lowest (on the Sep-15-2026 release; its
# rows, with July's (1, 3), left the table when its lag returned to 0). A
# month with share 0 would put the band's low edge at 0, which the app cannot
# use: it stops the run for a decision (most of Tesla's 2026 months have no
# 5-Day-track incident, so a Tesla lag would stop there).
FIVE_DAY_SHARE_OBSERVATIONS = {}
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


# NHTSA publishes the CURRENT file's SV and CP contact-area columns under
# rotated labels (found 2026-10-23; AGENTS.md ledger, 2026-10-23 entries):
# the box a reporter checked as front left sits in the column headed
# "Front", front in "Front Right", front right in "Front Left", and the
# same within the rear row.
# Tesla's own SGO spreadsheet for its robotaxi (Robotaxi-SGO-Report_10_18_2026
# .xlsx, linked from tesla.com/robotaxi/safety) agrees with every narrative
# that names a side and, after this move, with all 17 reports it shares with
# NHTSA's file; Waymo, Zoox, Avride and Nuro narratives agree the same way.
# Left, Right, Top, Bottom, Unknown and every archive-file column are labeled
# right. _normalize_current_row moves each value under its true label, and
# check_contact_area_labels stops the run if the narratives stop agreeing
# (e.g., NHTSA fixes its export: then empty this map).
CURRENT_FILE_CONTACT_LABEL = {   # published label -> true label
    "Front": "Front Left", "Front Right": "Front", "Front Left": "Front Right",
    "Rear": "Rear Left", "Rear Right": "Rear", "Rear Left": "Rear Right",
}

# Narratives that name one box of a vehicle, the contact columns that box
# belongs to, and the true label most matching rows must carry. Calibrated on
# the Oct-15-2026 current file (all reporters, all versions): after the move
# 86-99% of matches agree (front right lowest, 47 of 55); read as published,
# 0-6% do. The last test is the crash partner of a rear-ending: its front.
_AV = r"(?:waymo|ads|av|zoox|tesla)"
CONTACT_AREA_NARRATIVE_TESTS = (
    (re.compile(rf"\brear (?:bumper )?of the {_AV}\b", re.I), "SV Contact Area", "Rear"),
    (re.compile(rf"\b(?:rear left|left rear)(?: side| bumper| corner)? of the {_AV}\b", re.I), "SV Contact Area", "Rear Left"),
    (re.compile(rf"\b(?:rear right|right rear)(?: side| bumper| corner)? of the {_AV}\b", re.I), "SV Contact Area", "Rear Right"),
    (re.compile(rf"\b(?:front left|left front)(?: side| bumper| corner)? of the {_AV}\b", re.I), "SV Contact Area", "Front Left"),
    (re.compile(rf"\b(?:front right|right front)(?: side| bumper| corner)? of the {_AV}\b", re.I), "SV Contact Area", "Front Right"),
    (re.compile(rf"^(?!.*\b(?:revers|backed|backing))(?=.*\brear (?:bumper )?of the {_AV}\b)", re.I | re.S), "CP Contact Area", "Front"),
)
CONTACT_AREA_MIN_MATCHES = 20
CONTACT_AREA_MIN_AGREEMENT = 0.75


# Canonical short names for helmers (reporting entities). "Helmer" is our
# jargon for who/what is at the helm: Tesla, Waymo, Zoox, or humans.
HELMER_SHORT = {
    "Waymo LLC":    "Waymo",
    "Tesla, Inc.":  "Tesla",
    "Zoox, Inc.":   "Zoox",
}

# Reports that share a "Same Incident ID" but are not filings of one AV's
# crash (distinct crashes, or another vehicle in the same one): the
# by-incident dedup would stop the run on them (public_service_incidents()),
# so key these by Report ID instead, and an out-of-scope one may share an
# in-scope crash's Same Incident ID. 30270-10320 (MAR-2025 LA, 12:44): a car
# passing the queue in the opposing lane sideswiped the stationary Waymo; 13
# minutes later an SUV clipped the same (now parked-with-hazards) Waymo "due
# to a prior collision", filed as 30270-10321 under the same Same Incident ID
# 77ba86fa433a2c4.
SPLIT_SAME_INCIDENT_REPORTS = {"30270-10320"}

# Reports a re-filing under a new Report ID replaced: {replaced Report ID: the
# re-filing's Report ID} (added 2026-10-31, audit 2026-10-30). Two in-scope
# reports under one Same Incident ID stop the run until a human says which
# stands, here (or in SPLIT_SAME_INCIDENT_REPORTS when they are distinct
# crashes or vehicles), and so does an out-of-scope filing of a helmer under
# an in-scope crash's Same Incident ID, which may be a re-filing that moved
# the crash out of scope (public_service_incidents()). A replaced report is
# dropped, whatever its scope, from rows that hold its re-filing; an earlier
# release's rows, from before the re-filing, keep it (the receipt and
# arrival recounts read those with this table: dropping it everywhere, as
# the first version of the table did, took the crash out of the first
# release of its month). main() stops on an entry whose two reports are not
# both filed under one Same Incident ID. Until 2026-10-31 the dedup
# picked the higher Report Version, then the later submission month, but the
# versions of different Report IDs share no scale (Waymo's re-filings under a
# new ID came as v1 and as v2), so a newer re-filing under a new ID lost to
# the original's later version, and an out-of-scope re-filing left the
# original counted (30270-7598, "In-Vehicle (Commercial / Test)", re-filed
# 30270-4881, which stayed counted until an OPERATOR_TYPE_OVERRIDE took it out
# on 2026-09-26).
SUPERSEDED_REPORTS = {
    # 30270-1583 (v1, NOV-2021): "Other than the addition of the zip code in
    # which the incident occurred, the content of this report is unchanged
    # from the initial report submitted on October [XXX], 2021 [Report ID #
    # 30270-1535-1]" (Chandler, OCT-2021, Same Incident ID 6f2cffa37c36b66)
    "30270-1535": "30270-1583",
}

# Manual overrides for number of vehicles involved, keyed by Report ID (by
# Same Incident ID until 2026-10-31: a filing's Same Incident ID can change
# between versions, as 12 Waymo reports' did with VIN or Incident Date
# corrections, which left an entry applying to nothing without a word;
# check_overrides_apply() stops the run on an entry that names no in-scope
# incident of the analysis window). The NHTSA CSV's "Crash With" field is
# singular and doesn't capture multi-vehicle pileups, and no field counts
# the vehicles, so these entries have no filed value to re-check on a
# re-filing, unlike the severity, airbag and location overrides. Default is 2
# (the AV + one crash partner). Only the
# fatality metric reads this field (fractional-death divisor) and
# fatality-guard.qual forces a human count for each new fatality; the
# narrative-verified nonfatal counts below are data hygiene so the field is
# true where narratives are explicit (2026-08-22 audit inventory).
VEHICLES_INVOLVED = {
    # Waymo JAN-2025 SF fatality (report 30270-9724): chain collision — AV +
    # car stopped behind it + speeding SUV + a fourth car the AV rotated into,
    # plus "at least two other vehicles" per SFPD ("the other three vehicles",
    # "five passengers in four of the vehicles" injured) = 6 vehicles.
    "30270-9724": 6,
    # Waymo SEP-2025 Tempe fatality: AV + motorcycle + hit-and-run passenger car
    "30270-11713": 3,
    # Batch below added 2026-08-22 (human-approved hygiene): narrative-verified
    # 3+-vehicle counts for NONFATAL incidents from the audit inventory (e.g.
    # "All three vehicles sustained damage"). Zero displayed-number change by
    # construction — only the fatality metric reads this field — recorded so
    # the field is true where the narrative is explicit. Six bystander/
    # no-AV-contact rows with murky involvement semantics keep the default.
    "30270-6579": 3,
    "30270-8968": 3,
    "30270-13817": 4,
    "30270-13955": 5,
    "30270-14986": 5,
    "30270-15301": 4,
    "30270-13605": 3,
    "30270-13192": 3,
    "30270-15246": 3,
    "30270-15192": 4,
    "30270-11791": 3,
    "30270-14708": 3,
    "30270-10695": 4,
    "30270-9060": 3,
    "30270-13399": 3,
    "30270-13877": 3,
    "30270-5997": 3,
    "30270-6906": 3,
    "30270-9761": 4,
    "30270-13195": 3,
    "30270-13585": 3,
    "30270-14265": 3,
    "30270-15105": 3,
    "30270-7158": 4,
    "30270-8620": 3,
    "30270-8927": 3,
    "30270-8982": 3,
    "30270-9214": 3,
    "30270-9791": 3,
    "30270-9806": 3,
    "30270-10360": 3,
    "30270-10833": 3,
    "30270-10899": 3,
    "30270-11874": 3,
    "30270-11929": 3,
    "30270-13064": 4,
    "30270-13092": 3,
    "30270-13303": 3,
    "30270-13369": 3,
    "30270-13575": 3,
    "30270-13860": 3,
    "30270-13949": 3,
    "30270-13985": 3,
    "30270-13998": 3,
    "30270-14271": 3,
    "30270-14383": 3,
    "30270-14586": 3,
    "30270-14804": 3,
    "30270-14905": 3,
    "30270-14944": 3,
    "30270-15106": 3,
    "30270-15251": 3,
    "30270-15346": 3,
    "30270-15393": 3,
    "30270-15659": 3,
    "30270-15723": 3,
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

# Waymo opens some updated filings with a fact-free preamble ("The content of
# this report is unchanged from the initial report submitted on June 5, 2025
# [REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION]."), so the
# narrative preview showed only that (62 narratives; added 2026-10-03, audit
# finding #91). Strip exactly that preamble, anchored at the start of the
# narrative: the date may be written out ("December 12th, 2024") or redacted
# ("February [XXX], 2025", "[XXX], 2023"), with or without the final period.
# Preambles that carry facts ("Other than the updated Speed Limit field, the
# content of this report ...", or the prior report IDs it repeats) stay as
# filed. Applied after the redaction-marker typo pass, so "[XXX]" is uniform.
NARRATIVE_UNCHANGED_PREAMBLE = re.compile(
    r"^The content of this report is unchanged from the initial report "
    r"submitted on (?:[A-Z][a-z]+ ?)?(?:\d{1,2}(?:st|nd|rd|th)?|\[XXX\]), "
    r"\d{4} \[REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION\]\.?\s*")

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

# Manual severity overrides keyed by Report ID: (the filed "Highest Injury
# Severity Alleged" the review read, the severity to store). The NHTSA field
# is sometimes "Unknown"; we resolve it from the narrative, counting only
# human injuries (not animal). main() stops the run on an in-scope incident
# left "Unknown" (the app counts it as no injury) until an entry here
# resolves it, and on an entry whose filed severity has changed since the
# review (a re-filing must be re-read; until 2026-10-31 the stored value hid
# it), and check_overrides_apply() on an entry that names no in-scope incident
# of the analysis window. Until 2026-10-31 (open question 10; audit
# 2026-10-30) the table was keyed by Same Incident ID and held the stored
# value only; each entry's reviewed value is its report's filed severity on
# that day, which matches what every entry's note says the field read.
SEVERITY_OVERRIDE = {
    # Detached object from pickup; Waymo passenger alleged unspecified injury
    "30270-11361": ("Unknown", "Minor W/O Hospitalization"),
    # Hit a cat; only animal injured, no human injury
    "30270-11840": ("Unknown", "Property Damage. No Injured Reported"),
    # Waymo stopped on US-101; pickup went off bridge; minor injuries in pickup
    "30270-11997": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo stopped; two SUVs collided behind it; no injuries mentioned
    "30270-13056": ("Unknown", "Property Damage. No Injured Reported"),
    # Waymo parked; rear-ended by SUV; passengers alleged unknown injuries
    "30270-11849": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo stopped at red; rear-ended; other driver transported to hospital
    "30270-13198": ("Unknown", "Minor W/ Hospitalization"),
    # Waymo slow at stop sign; rear-ended; Waymo passenger transported to hospital
    "30270-13167": ("Unknown", "Minor W/ Hospitalization"),
    # Batch below added 2026-07-15: resolved every remaining "Unknown" from
    # its narrative. Transport to hospital -> Minor W/ Hospitalization;
    # alleged/unspecified injury without transport -> Minor W/O; no human
    # injury mentioned -> Property Damage.
    # Waymo rear-ended at red light; an individual transported to hospital
    "30270-6149": ("Unknown", "Minor W/ Hospitalization"),
    # Two cars collided behind braking Waymo, no AV contact; no injuries mentioned
    "30270-6542": ("Unknown", "Property Damage. No Injured Reported"),
    # Red-running SUV hit Waymo and fled; towed; no injuries mentioned
    "30270-6932": ("Unknown", "Property Damage. No Injured Reported"),
    # Passing SUV clipped Waymo; SUV passengers claimed unspecified injuries
    "30270-7157": ("Unknown", "Minor W/O Hospitalization"),
    # Batch below added 2026-08-22 (human-approved): extends the override
    # convention beyond "Unknown" resolution to rows whose AFFIRMATIVE field
    # value flatly contradicts the filing's own narrative — injury claims the
    # field never carried, stated hospital transports on W/O or archive-era
    # bare tiers (no W/-Hospitalization split existed pre-Jun-2025).
    # Trailer clipped stopped Waymo; passenger later alleged unspecified injury, no transport
    "30270-11565": ("Property Damage. No Injured Reported",
                    "Minor W/O Hospitalization"),
    # "transported from the scene to a hospital" stated as the SGO trigger; archive bare Minor
    "30270-9789": ("Minor", "Minor W/ Hospitalization"),
    # Same transport-trigger sentence; archive bare Minor
    "30270-10892": ("Minor", "Minor W/ Hospitalization"),
    # Doored cyclist transported by ambulance; archive bare Moderate
    "30270-9987": ("Moderate", "Moderate W/ Hospitalization"),
    # Waymo passenger and other driver transported to hospital; archive bare Moderate
    "30270-9992": ("Moderate", "Moderate W/ Hospitalization"),
    # Three Waymo passengers transported to a hospital; archive bare Moderate
    "30270-9860": ("Moderate", "Moderate W/ Hospitalization"),
    # SUV driver transported (stated as SGO trigger); field said W/O Hospitalization
    "30270-11450": ("Moderate W/O Hospitalization",
                    "Moderate W/ Hospitalization"),
    # Zoox v2 filed to add V2 driver's soft-tissue injury claim; severity field never updated
    "30610-10473": ("No Injuries Reported", "Minor W/O Hospitalization"),
    # (End of the 2026-08-22 batch; the 2026-07-15 Unknown-resolution batch
    # resumes below.)
    # Alleged involvement only, no AV contact; cars behind collided; no injuries
    "30270-7160": ("Unknown", "Property Damage. No Injured Reported"),
    # Waymo rear-ended at red; Waymo passenger reported unspecified injury
    "30270-7316": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo rear-ended slowing at red arrow; other car alleged unspecified injuries
    "30270-7945": ("Unknown", "Minor W/O Hospitalization"),
    # SUV passed queue via bike lane into turning Waymo; alleged unspecified injuries
    "30270-7637": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo rear-ended at speed; transport to hospital, airbags, both towed
    "30270-8243": ("Unknown", "Minor W/ Hospitalization"),
    # Oncoming pickup crossed yellow into Waymo; its driver transported to hospital
    "30270-8217": ("Unknown", "Minor W/ Hospitalization"),
    # Passenger doored cyclist; cyclist sought urgent care independently, no transport
    "30270-8685": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo deflected crate into scooterist who fell; no injuries mentioned
    "30270-9287": ("Unknown", "Property Damage. No Injured Reported"),
    # Red-runner chain crash into stopped Waymo; occupant transported to
    # hospital. Was Minor W/ until Waymo's Sep-24-2026 hub release notes quoted
    # a police General Offense Report: the other driver "was treated at a
    # hospital for injuries described as life threatening" (30270-13817)
    "30270-13817": ("Unknown", "Serious W/ Hospitalization"),
    # Freeway chain shoved car into Waymo; driver transported, AV passenger minor
    "30270-13955": ("Unknown", "Minor W/ Hospitalization"),
    # Driver doored passing Zoox; hurt hand/neck per media, declined hospital
    "30610-13818": ("Unknown", "Minor W/O Hospitalization"),
    # ROW-violating SUV hit Zoox; passengers later alleged injuries, no transport
    "30610-14341": ("Unknown", "Minor W/O Hospitalization"),
    # Waymo rear-ended slowing to turn; other car's passenger transported to hospital
    "30270-15022": ("Unknown", "Minor W/ Hospitalization"),
    # Speeding SUV rear-ended Waymo; Waymo passenger transported to hospital
    "30270-15096": ("Unknown", "Minor W/ Hospitalization"),
    # SUV lane-change hit motorcycle, shoved into Waymo; rider transported to hospital
    "30270-15301": ("Unknown", "Minor W/ Hospitalization"),
    # Car rear-ended hard-braking Zoox; driver bruised, no transport
    "30610-15295": ("Unknown", "Minor W/O Hospitalization"),
    # Batch below added 2026-08-17 (Aug NHTSA drop), same convention.
    # Oncoming van crossed double yellow into stopped Waymo; van driver transported
    "30270-15468": ("Unknown", "Minor W/ Hospitalization"),
    # Passenger exited slowing Waymo mid-motion, struck by rear tire; transported
    "30270-15636": ("Unknown", "Minor W/ Hospitalization"),
    # Cyclist ran stop sign, lost control into stopped Zoox; cyclist transported
    "30610-15707": ("Unknown", "Minor W/ Hospitalization"),
    # Speeding SUV clipped Waymo passing on left; driver "unknown injuries", no transport
    "30270-15669": ("Unknown", "Minor W/O Hospitalization"),
    # Batch below added 2026-10-16 (Oct-15 NHTSA release), same convention.
    # Waymo pulled from a cancelled dropoff into a passing car; its driver transported
    "30270-16278": ("Unknown", "Minor W/ Hospitalization"),
    # Zoox stopped for an emergency vehicle and was rear-ended; no injuries mentioned
    "30610-16451": ("Unknown", "Property Damage. No Injured Reported"),
    # Added 2026-10-03 (audit finding #44), the 2026-08-22 convention for an
    # affirmative field the narrative contradicts: Zoox 30610-15722 (JUL-2026
    # Austin), field "Property Damage. No Injured Reported"; rear-ended while
    # stopped, the passenger "reported feeling \"dazed\" and \"kind of woozy\"
    # and requested emergency services", no transport stated
    "30610-15722": ("Property Damage. No Injured Reported",
                    "Minor W/O Hospitalization"),
}

# Known-erroneous or missing upstream location fields, keyed by Report ID (by
# Same Incident ID until 2026-10-31): ((the filed City, State the review
# read), (the City, State to store)).
# The SGO row for 30270-7054 (JAN-2024) says City "Phoenix", State "CA" while
# its own narrative reads "operating in Phoenix, Arizona" — an NHTSA
# data-entry error that rendered a phantom "Phoenix, CA" city in the Geography
# table. 30270-11302 (JUL-2025) arrived with blank City, State and Address
# (latitude/longitude PII-redacted) while its narrative says "operating in Los
# Angeles, California"; it rendered as a bare ", " in the incident browser
# (added 2026-10-03, audit finding #52, which also folded the old
# STATE_OVERRIDE into this one mechanism). main() must()s that each filed
# location still equals the reviewed one (a re-filing stops the run for a
# re-read) and that every incident ends with a non-empty city and state.
# Five Waymo rows filed a neighbouring city's name where the narrative and
# Waymo's own crash list (Safety Impact hub CSV2, data through Jun 2026, its
# "Location Address / Description" and county) both name another (added
# 2026-10-04, second audit #46): 30270-13811 "operating in Daly City", hub
# "John Daly Boulevard near Lake Merced Boulevard", San Mateo County (its hub
# zip, 94105, is San Francisco's); 30270-15662 "North Miami", "NE 123rd Street
# at Sans Souci Boulevard", 33181; 30270-10112 "Chandler", "N Dobson Rd and W
# Flint Street", 85224; 30270-10141 "Tempe", "Parking lot near 1810 E Apache
# Boulevard", 85281; 30270-9763 "West Hollywood", "Parking lot near 8280 Santa
# Monica Boulevard", 90046.
LOCATION_OVERRIDE = {
    "30270-7054": (("Phoenix", "CA"), ("Phoenix", "AZ")),
    "30270-11302": (("", ""), ("Los Angeles", "CA")),
    "30270-13811": (("San Francisco", "CA"), ("Daly City", "CA")),
    "30270-15662": (("Miami", "FL"), ("North Miami", "FL")),
    "30270-10112": (("Phoenix", "AZ"), ("Chandler", "AZ")),
    "30270-10141": (("Phoenix", "AZ"), ("Tempe", "AZ")),
    "30270-9763": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
}

# Airbag deployments the SGO structured columns cannot record, keyed by Report
# ID (by Same Incident ID until 2026-10-31; added 2026-08-22, human-approved):
# narratives assert deployment
# — including Waymo's own "because of airbag deployment" reporting-trigger
# sentences — but the SV/CP columns say No or Unknown (third-vehicle
# deployments in chain crashes, and one column-vs-narrative contradiction;
# 30270-6542's CP column is Unknown). airbagAny is defined as
# any-vehicle deployment (matching the Kusano human benchmark), so these are
# forced true. Each entry is (the filed "Any Air Bags Deployed?" the review
# read, the value to store); main() stops the run when the filed value has
# changed since (since 2026-10-31; open question 10). (Distinct from the
# archive CP-column merge in _normalize_archive_row, which already ORs the
# recorded columns.)
AIRBAG_OVERRIDE = {
    # 30270-9767: filed "because of airbag deployment"; SV/CP columns both No
    "30270-9767": ("No", True),
    # 30270-10174: same trigger sentence; chain crash, third vehicle
    "30270-10174": ("No", True),
    # 30270-10573: "the SUV's airbag deployed" (third vehicle)
    "30270-10573": ("No", True),
    # 30270-13877: "the airbag of the second passenger car deploying"
    "30270-13877": ("No Subject Vehicle, No Crash Partner", True),
    # 30270-6542: "video appears to show that airbags deployed in the striking vehicle"
    "30270-6542": ("No", True),
}

# Reviewed passenger codes, keyed by Report ID: (the filed "Were All
# Passengers Belted?" value the review read, the value to store), for reports
# whose filed code disagrees with their own narrative about whether anyone was
# aboard (the sanity section's Passenger presence table counts riders, as
# against deadhead). reviewed_belted() must()s that the filed value is
# unchanged (a re-filing stops the run for a re-read), and
# check_passengers_reviewed() that every entry is an in-scope report.
#
# Tesla files its in-car safety monitor as a passenger: a ride with only the
# monitor aboard carries "Subject Vehicle - All Belted" (or "Unknown"), so the
# field cannot tell a rider from the monitor, and Passenger presence read
# 61-87% for Tesla where the narratives give 8 of 23. Tesla's narratives say
# whether a passenger (since August 2026 also "rider") was aboard, so EVERY
# in-scope Tesla report carries an entry (added 2026-10-03, audit finding
# #10), and check_passengers_reviewed() stops the run on a Tesla report
# without one until its narrative is read. Not every Tesla narrative does:
# 13781-16941's (on Tesla's Oct-18-2026 list, not yet in NHTSA's file) says
# nothing about who was aboard, and what to store for such a report is for a
# human to decide (audit 2026-10-30, R3).
#
# Waymo and Zoox carry no in-car monitor, and their codes agree with their
# narratives except where an entry below says otherwise; the occupancy
# tripwire (OCCUPANCY_PATTERN, check_occupancy_classified()) stops the run on
# a new disagreement. Generalized from TESLA_PASSENGER_OVERRIDE 2026-10-04
# (second audit, #33) for the first such report, Zoox 30610-15826.
PAX_NO = "Subject Vehicle - No Passenger In Vehicle"
PAX_BELTED = "Subject Vehicle - All Belted"
# The repo's own code for a passenger the narrative states without saying
# whether they were belted (NHTSA's list has no such value); crashla.js
# PAX_PRESENT counts it as a passenger.
PAX_BELT_UNSTATED = "Subject Vehicle - Passenger In Vehicle, Belt Use Not Stated"
# How crashla.js classifies a passenger code: its PAX_NONE, PAX_PRESENT and
# PAX_UNKNOWN sets, mirrored exactly (quals/passenger-classification.qual.mjs
# pins the mirror). Both no-passenger encodings are no passenger. A code in
# none of them stops the run (check_occupancy_classified reads every in-scope
# incident's code through this map), since crashla.js would count it in the
# Unknown remainder, and a default to "with passenger" is the bug class that
# once miscounted 485 no-passenger incidents.
PAX_CLASS = {PAX_NO: "none", "No Passengers in Vehicle": "none",
             PAX_BELTED: "present",
             "Subject Vehicle - Not Belted - see Narrative": "present",
             "Yes": "present", "No, see Narrative": "present",
             PAX_BELT_UNSTATED: "present",
             "Unknown": "unknown", "": "unknown"}
PASSENGER_OVERRIDE = {
    # Zoox, JUN-2026 San Francisco, filed no passenger: "An occupied Zoox
    # autonomous vehicle was stopped at a traffic light"; belt use not stated
    "30610-15826": (PAX_NO, PAX_BELT_UNSTATED),
    # Tesla: every in-scope report (the monitor is not a passenger)
    "13781-11375": (PAX_BELTED, PAX_NO),   # "a safety monitor present with no passengers"
    "13781-11507": ("Unknown", PAX_NO),    # "no passengers were inside the vehicle"
    "13781-11687": (PAX_BELTED, PAX_BELTED),  # "a safety monitor present with one passenger"
    "13781-11784": ("Unknown", PAX_NO),    # "no passengers were inside the vehicle"
    "13781-11786": (PAX_BELTED, PAX_NO),   # "no passengers were inside the vehicle"
    "13781-11787": (PAX_BELTED, PAX_NO),   # "no passengers were inside the vehicle"
    "13781-11986": (PAX_BELTED, PAX_NO),   # "no passengers were inside the vehicle"
    "13781-13237": ("Unknown", PAX_BELT_UNSTATED),  # "Safety monitor and passenger were present"
    "13781-13644": ("Unknown", PAX_BELT_UNSTATED),  # "Safety monitor and one passenger were present"
    "13781-13645": (PAX_BELTED, PAX_NO),   # "no passengers were inside the vehicle"
    "13781-13646": (PAX_BELTED, PAX_NO),   # "no passengers were inside the vehicle"
    "13781-13647": (PAX_BELTED, PAX_BELTED),  # "Safety monitor and a passenger were present"
    "13781-13648": (PAX_BELTED, PAX_BELTED),  # "Safety monitor and two passengers were present"
    "13781-14630": (PAX_BELTED, PAX_BELTED),  # "a safety monitor present ... with one passenger"
    "13781-14631": (PAX_BELTED, PAX_NO),   # "a safety monitor present ... with no passengers"
    "13781-15017": (PAX_BELTED, PAX_NO),   # "a safety monitor present ... with no passengers"
    "13781-15342": (PAX_BELTED, PAX_BELTED),  # "had one passenger present"
    "13781-15399": (PAX_NO, PAX_NO),       # "did not have any passenger present"
    "13781-15400": (PAX_NO, PAX_NO),       # "did not have any passenger present"
    "13781-15808": ("Unknown", PAX_NO),    # "There were no passengers."
    "13781-15809": ("Unknown", PAX_NO),    # "There were no passengers."
    "13781-16255": (PAX_BELTED, PAX_BELTED),  # "had two passengers present"
    "13781-16256": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16294": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16671": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16672": (PAX_BELTED, PAX_NO),   # "a safety monitor present in the vehicle with no passengers"
    "13781-16673": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16674": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16675": (PAX_NO, PAX_NO),       # "had no passengers present"
    "13781-16676": (PAX_BELTED, PAX_BELTED),  # "had three passengers in the vehicle"
    "13781-16677": (PAX_NO, PAX_NO),       # "had no passengers present"
}

# Narrative wording that says whether anyone was aboard the AV itself, named by
# what it says ("none" or "present"; second audit, 2026-10-04, #33).
# Calibrated on every in-scope Waymo and Zoox narrative, all versions, of the
# Sep-15-2026 file (2,192 Waymo and 52 Zoox rows): Zoox opens nearly every
# narrative with "An occupied Zoox autonomous vehicle" or "An unoccupied Zoox
# (autonomous) vehicle" (47 rows of 43 reports, 30610-15826 the only one its
# code contradicts), and Waymo says it once, "The Waymo AV, which had no
# occupants" (both versions of 30270-9724, agreeing). Waymo's "occupied"
# describes lanes and parking stalls ("the lane occupied by the Waymo AV"),
# and its usual passenger wording ("the passenger in the Waymo AV", "one of
# the passengers in the vehicle", ...) is left out: of the 221 reports that
# use it, 2 describe a rider who got out before the crash
# (30270-8877, 30270-13578, both coded no passenger), so it does not say who
# was aboard at impact. Tesla's wording is read report by report (every Tesla
# report has a PASSENGER_OVERRIDE entry).
OCCUPANCY_PATTERN = re.compile(
    r"\b(?P<none>unoccupied\s+(?:Zoox|Waymo)|had\s+no\s+occupants)\b|"
    r"\b(?P<present>occupied\s+(?:Zoox|Waymo))\b", re.I)
# In-scope reports whose narrative trips OCCUPANCY_PATTERN against their filed
# code but whose filed code stands, keyed by Report ID with the narrative's
# words that show why (none so far).
OCCUPANCY_LANGUAGE_REVIEWED = {}


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
    must("CP Any Air Bags Deployed?" in row,
         "archive row lacks the CP airbag column (19 archive-era crash-partner "
         "deployments would silently revert to airbagAny false)")
    if "Yes" in row["CP Any Air Bags Deployed?"]:
        row["Any Air Bags Deployed?"] = "Yes"
    return row


def _normalize_current_row(row):
    """Move the current file's rotated contact-area values under their true labels."""
    for prefix in ("SV Contact Area", "CP Contact Area"):
        published = {label: row[f"{prefix} - {label}"]
                     for label in CURRENT_FILE_CONTACT_LABEL}
        for label, value in published.items():
            row[f"{prefix} - {CURRENT_FILE_CONTACT_LABEL[label]}"] = value
    return row


must(sorted(CURRENT_FILE_CONTACT_LABEL) == sorted(CURRENT_FILE_CONTACT_LABEL.values()),
     "CURRENT_FILE_CONTACT_LABEL must permute its labels (a value moved onto "
     "a label must have left that label's own value somewhere)")


def check_contact_area_labels(rows):
    """Stop unless current-file contact areas, after the move, match narratives."""
    for pattern, prefix, label in CONTACT_AREA_NARRATIVE_TESTS:
        matches = [r for r in rows if pattern.search(r["Narrative"])]
        agree = sum(1 for r in matches if r[f"{prefix} - {label}"].strip() == "Y")
        must(len(matches) >= CONTACT_AREA_MIN_MATCHES and
             agree >= CONTACT_AREA_MIN_AGREEMENT * len(matches),
             "current-file contact areas no longer match the narratives after "
             "CURRENT_FILE_CONTACT_LABEL moves them (has NHTSA fixed or changed "
             "its column labels? re-measure, then update or empty the map: "
             "data/README.md, Each NHTSA release, step 6)",
             pattern=pattern.pattern, label=f"{prefix} - {label}",
             matches=len(matches), agree=agree)


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


def current_csv_rows(text):
    """Rows of NHTSA's current ADS CSV, contact areas under their true labels."""
    rows = [_normalize_current_row(row) for row in csv.DictReader(io.StringIO(text))]
    check_contact_area_labels(rows)
    return rows


def archive_csv_rows(text):
    """Rows of NHTSA's archive ADS CSV, mapped onto the current schema."""
    return [_normalize_archive_row(row) for row in csv.DictReader(io.StringIO(text))]


# Each NHTSA file: its URL, its snapshot prefix, and its loader. A live fetch
# (fetch_nhtsa_csv) and every offline regeneration (newest_snapshot_rows, used
# by the quals) parse through these, so both see the same rows.
NHTSA_SOURCES = (
    (NHTSA_ADS_CSV_URL, "nhtsa-current", current_csv_rows),
    (NHTSA_ADS_ARCHIVE_URL, "nhtsa-archive", archive_csv_rows),
)


def newest_snapshot_rows():
    """Rows of the newest current and archive snapshots, parsed as a live fetch is."""
    rows = []
    for _url, prefix, parse in NHTSA_SOURCES:
        with open(latest_snapshot_path(prefix), newline="", encoding="utf-8") as f:
            rows += parse(f.read())
    return rows


def fetch_nhtsa_csv(stamp):
    """Fetch ADS incident reports from both current and archive CSVs.

    Returns (rows, headers_by_url), retaining the reviewed HTTP headers for
    both ingested CSVs.
    """
    all_rows = []
    headers_by_url = {}
    for url, prefix, parse in NHTSA_SOURCES:
        print(f"Fetching NHTSA ADS CSV from {url} ...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            lm = resp.headers.get("Last-Modified")
            etag = resp.headers.get("ETag")
            payload = resp.read()
        headers_by_url[url] = (lm, etag)
        text = payload.decode("utf-8")
        snapshot_csv_if_changed(prefix, text, stamp)
        all_rows += parse(text)
    return all_rows, headers_by_url


def modified_date_from_last_modified(last_modified):
    """ISO date of the current CSV's HTTP Last-Modified header."""
    must(last_modified is not None, "NHTSA CSV response lacks a Last-Modified header")
    from email.utils import parsedate_to_datetime
    return parsedate_to_datetime(last_modified).date().isoformat()


def month_shift(month, n):
    """The ISO month <n> months after <month> (before it, for negative n)."""
    y, m = divmod(int(month[:4]) * 12 + int(month[5:]) - 1 + n, 12)
    return f"{y}-{m + 1:02d}"


def release_month_coverage(data_through_date, last_month, counts, vmt):
    """Return the (best, lo, hi) receipt coverage of the data-through month:
    the share of its in-scope five-day-track incidents that this release
    holds, observed / expected (2026-10-31, decision D6), as
    incident_coverage() estimates the Monthly track's. <counts> is
    monthly_track_counts() of this release, <vmt> parse_vmt_values().

    observed: the month's five-day-track incidents in this release; expected:
    each company's five-day-track incidents in its reference month, the most
    recent month before the data-through month (final at this, its second
    normal release) with at least 3 of them and VMT, scaled by the VMT ratio
    (pooled_reference_rate()). best = observed / expected; lo = best x
    exp(-1.96 SE) with SE = sqrt(1/observed + 1/reference), the log-scale
    bound incident_coverage() uses; hi = FIVE_DAY_RECEIPT_COVERAGE_MAX, the
    reading in which the month's low count is real rather than lagging.

    Fails loudly if the reviewed NHTSA_DATA_THROUGH_DATE month is not the
    newest incident month (a new release without a reviewed cutoff), if a
    month that became final has no FIVE_DAY_RECEIPT_OBSERVATIONS row, if an
    observation exceeds FIVE_DAY_RECEIPT_COVERAGE_MAX, if the month has no
    five-day-track incident, or if its observed / expected does.
    """
    data_through_month = datetime.date.fromisoformat(
        data_through_date).strftime("%Y-%m")
    must(data_through_month == last_month,
         "reviewed NHTSA cutoff month must match the latest incident month "
         "(set NHTSA_DATA_THROUGH_DATE in data/slurp.py to the new release's "
         "cutoff: data/README.md, Each NHTSA release, step 1)",
         data_through=data_through_date, last_month=last_month)
    # Every month from the first observation through the month that just
    # became final (the one before the data-through month: its second normal
    # release is this one) must be observed or explicitly excluded, so the
    # "re-measure on each release" step cannot be skipped silently.
    due = month_shift(data_through_month, -1)
    month = min(FIVE_DAY_RECEIPT_OBSERVATIONS)
    while month <= due:
        must(month in FIVE_DAY_RECEIPT_OBSERVATIONS
             or month in RECEIPT_MONTHS_EXCLUDED,
             "no five-day receipt observation for a month that is now final "
             "(measure it from the snapshots and add it to "
             "FIVE_DAY_RECEIPT_OBSERVATIONS in data/slurp.py, or exclude it "
             "with a reason in RECEIPT_MONTHS_EXCLUDED: data/README.md, Each "
             "NHTSA release, step 2)",
             month=month, data_through=data_through_date)
        month = month_shift(month, 1)
    fracs = sorted(n / d for n, d in FIVE_DAY_RECEIPT_OBSERVATIONS.values())
    must(fracs[-1] <= FIVE_DAY_RECEIPT_COVERAGE_MAX <= 1,
         "FIVE_DAY_RECEIPT_COVERAGE_MAX in data/slurp.py must be at or above "
         "every observed first-release share and at most 1 (raise it to cover "
         "the new observation: data/README.md, Each NHTSA release, step 2)",
         max=FIVE_DAY_RECEIPT_COVERAGE_MAX, observed=fracs)
    five_day = {(helmer, month): n for (helmer, month, track), n in counts.items()
                if track == "five_day"}
    observed, expected, reference = pooled_reference_rate(
        five_day, last_month, vmt,
        {helmer: month_shift(last_month, -1) for helmer in set(HELMER_SHORT.values())})
    must(observed > 0,
         "the data-through month has no in-scope five-day-track incident in "
         "this release, so its receipt coverage would be 0 (was the release "
         "truncated, as May 15, 2026's was? check the file before going on: "
         "data/README.md, Each NHTSA release, step 2)",
         last_month=last_month, expected=round(expected, 1))
    best = observed / expected
    lo = best * math.exp(-1.96 * math.sqrt(1 / observed + 1 / reference))
    must(best <= FIVE_DAY_RECEIPT_COVERAGE_MAX,
         "the data-through month's observed share of its five-day-track "
         "incidents exceeds FIVE_DAY_RECEIPT_COVERAGE_MAX in data/slurp.py "
         "(check the counts; raise the constant if they stand: data/README.md, "
         "Each NHTSA release, step 2)",
         best=round(best, 4), observed=observed, expected=round(expected, 1),
         max=FIVE_DAY_RECEIPT_COVERAGE_MAX)
    print(f"  {last_month} five-day receipt coverage: best={best:.4f} lo={lo:.4f}"
          f" (observed {observed} / expected {expected:.1f})")
    return round(best, 4), round(lo, 4), FIVE_DAY_RECEIPT_COVERAGE_MAX


def pooled_reference_rate(counts, last_month, vmt, complete_through):
    """(observed, expected, reference) incidents, pooled over the companies
    with VMT in <last_month>. <counts> maps (company, iso_month) to
    incidents. observed: the companies' counts in <last_month>; expected:
    each company's count in its reference month, the most recent month
    through complete_through[company] with at least 3 incidents and VMT,
    times the VMT ratio of <last_month> to that month; reference: the sum of
    those reference months' counts. A company with no reference month stays
    out of the pool. This is a stationary-rate heuristic; it does not prove
    a reference month complete. The receipt coverage and the pooled
    Monthly-track incident coverage both use it."""
    companies = sorted(helmer for helmer in set(HELMER_SHORT.values())
                       if vmt.get((helmer, last_month), 0) > 0)
    must(companies,
         "pooled coverage requires positive cutoff-month VMT",
         last_month=last_month)
    observed = expected = reference = 0
    for helmer in companies:
        refs = sorted((month for (company, month), n in counts.items()
                       if company == helmer and month <= complete_through[helmer]
                       and n >= 3 and vmt.get((helmer, month), 0) > 0),
                      reverse=True)
        if not refs:
            continue
        ref_count = counts[(helmer, refs[0])]
        # NOTE: a company with VMT but ZERO observed incidents in the month
        # stays in the pool: observing 0 where the reference predicts >0 is
        # exactly the "not yet reported" evidence the rate ratio captures.
        observed += counts.get((helmer, last_month), 0)
        expected += ref_count * vmt[(helmer, last_month)] / vmt[(helmer, refs[0])]
        reference += ref_count
    must(expected > 0 and reference > 0,
         "pooled coverage requires a usable reference month",
         companies=companies, last_month=last_month)
    return observed, expected, reference


# Fault values sit on a 0.05 grid (0, 0.05, ..., 1): crashla.js faultSum sums
# them in twentieths and refuses an off-grid value during init, which leaves
# the page blank, so parse_fault_csv() stops on one here instead (second
# audit, 2026-10-04, #6; quals/fault-grid.qual.mjs).
FAULT_GRID = 20


def parse_fault_csv(path):
    rows = read_fault_csv_rows(path)
    must(len(rows) > 0, "fault csv has no rows", path=path)
    data = {}
    for row in rows:
        rid = row["reportID"].strip()
        must(rid != "", "fault row missing Report ID", path=path)
        faultfrac = float(row["faultfrac"])
        must(math.isfinite(faultfrac), "faultfrac not finite", path=path, reportId=rid, faultfrac=row["faultfrac"])
        must(0.0 <= faultfrac <= 1.0, "faultfrac out of range (data/README.md, Each NHTSA release, step 5)", path=path, reportId=rid, faultfrac=faultfrac)
        must(abs(faultfrac * FAULT_GRID - round(faultfrac * FAULT_GRID)) < 1e-9,
             "faultfrac off the 0.05 grid (the page refuses it: data/README.md, Each NHTSA release, step 5)", path=path,
             reportId=rid, faultfrac=faultfrac)
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
    must(len(missing) == 0,
         "data/faultfrac.csv rows for reports that are no longer in-scope "
         "incidents (a later filing re-coded or retired the report, or a "
         "re-filing replaced it): find out why from the newest snapshot, then "
         "delete each one's row from data/faultfrac.csv, as for 30270-8403, "
         "-14625 and -4881 (data/README.md, Each NHTSA release, step 5)",
         missing=sorted(missing))
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
    """Map a VMT-master helmer label ("tesla", "teslanomonitor") to its line,
    a SERIES_COMPANY key: a company's short name or a derived line.

    Exact case-insensitive match against those names only: a blank or
    abbreviated label used to prefix-match the first HELMER_SHORT key ("" ->
    Waymo) and silently key another helmer's VMT.
    """
    wanted = helmer_raw.strip().lower()
    hits = [v for v in SERIES_COMPANY if v.lower() == wanted]
    must(len(hits) == 1, "VMT master helmer label is not a line SERIES_COMPANY names",
         helmer=helmer_raw, allowed=sorted(SERIES_COMPANY))
    return hits[0]


def parse_vmt_values(raw_text):
    """Extract per-helmer-month best VMT estimates from the raw VMT CSV."""
    result = {}  # (helmer, month) -> vmt_best
    for row in _vmt_data_rows(raw_text):
        result[(_canonical_helmer(row[0].strip()), row[1].strip())] = \
            _vmt_number(row[2])
    return result


def filed_incident_rows(rows):
    """The rows of <rows> that file an incident: placeholder rows (e.g. "No
    New or Updated Incident Reports") have no Report ID, Report Version,
    Same Incident ID or Incident Date."""
    return [r for r in rows
            if r["Report ID"].strip() and r["Report Version"].strip() and
            r["Same Incident ID"].strip() and r["Incident Date"].strip()]


def latest_filings(rows):
    """{Report ID: its highest Report Version's row} over the filed rows <rows>."""
    by_rid = {}
    for r in rows:
        rid = r["Report ID"]
        ver = int(r["Report Version"])
        if rid not in by_rid or ver > by_rid[rid][0]:
            by_rid[rid] = (ver, r)
    return {rid: r for rid, (_ver, r) in by_rid.items()}


def public_service_incidents(rows):
    """{incident key: surviving row} for the in-scope incidents of <rows>, the
    one deduplication every count uses. First by Report ID over EVERY filed
    row, keeping the highest Report Version (latest_filings()): grouping by
    Report ID handles a "Same Incident ID" that changes between versions, and
    running before the public-service filter lets a later version retire a
    report from scope (30270-8403 v2, Waymo JUL-2024, reclassified the crash
    as "In-Vehicle and Remote (Commercial / Test)" -- "a test driver was
    present" -- so v1's "None" must not survive; it did until 2026-09-04).
    Then the surviving versions are filtered to each entity's public-service
    operator types (is_public_service_incident), less the reports a re-filing
    in <rows> replaced (SUPERSEDED_REPORTS: an earlier release's rows, from
    before the re-filing, keep the original), and keyed by Same Incident ID,
    or by Report ID for SPLIT_SAME_INCIDENT_REPORTS. Two in-scope reports
    under one key stop the run, and so does an out-of-scope filing of a
    helmer under an in-scope report's Same Incident ID (a re-filing that may
    have moved the crash out of scope), until a human records which report
    stands (2026-10-31; until then the higher Report Version won, compared
    across Report IDs, whose versions share no scale). Other entities'
    filings are never in scope, so a duplicate one files (Transdev, Waymo's
    fleet operator, shares 139 Same Incident IDs with Waymo) can neither
    displace nor retire a helmer's report."""
    latest = latest_filings(rows)
    replaced = {old for old, new in SUPERSEDED_REPORTS.items() if new in latest}
    by_incident = {}
    for r in latest.values():
        rid = r["Report ID"]
        if not is_public_service_incident(r) or rid in replaced:
            continue
        iid = rid if rid in SPLIT_SAME_INCIDENT_REPORTS else r["Same Incident ID"]
        incumbent = by_incident.setdefault(iid, r)
        must(incumbent is r,
             "two in-scope reports share one Same Incident ID (read both: if "
             "one is a re-filing of the other, list the replaced one in "
             "SUPERSEDED_REPORTS in data/slurp.py with the report that stands; "
             "if they are distinct crashes or vehicles, list one in "
             "SPLIT_SAME_INCIDENT_REPORTS: data/README.md, Each NHTSA release, "
             "step 6)",
             reports=sorted([rid, incumbent["Report ID"]]), sameIncidentId=iid)
    in_scope_ids = {r["Same Incident ID"] for r in by_incident.values()}
    # A report listed as replaced has been read, whether or not these rows
    # hold its re-filing yet
    retiring = [r for r in latest.values()
                if r["Reporting Entity"].strip() in HELMER_SHORT
                and not is_public_service_incident(r)
                and r["Report ID"] not in SPLIT_SAME_INCIDENT_REPORTS
                and r["Report ID"] not in SUPERSEDED_REPORTS
                and r["Same Incident ID"] in in_scope_ids]
    retiring_ids = {r["Same Incident ID"] for r in retiring}
    must(not retiring,
         "an out-of-scope filing shares an in-scope report's Same Incident ID "
         "(a re-filing may have moved the crash out of scope: read both; list "
         "the in-scope report in SUPERSEDED_REPORTS in data/slurp.py with the "
         "re-filing that replaced it, or the out-of-scope one in "
         "SPLIT_SAME_INCIDENT_REPORTS if it is another crash or vehicle: "
         "data/README.md, Each NHTSA release, step 6)",
         outOfScope=sorted(r["Report ID"] for r in retiring),
         inScope=sorted(r["Report ID"] for r in by_incident.values()
                        if r["Same Incident ID"] in retiring_ids))
    return by_incident


def incident_coverage(nhtsa_rows, last_month, receipt_coverage, vmt):
    """Compute conditional pooled incident coverage for the last month.

    The best estimate is a pooled rate-ratio: observed incidents in the
    cutoff month vs the count expected from each helmer's most recent usable
    reference month that is complete for it (before the cutoff month and
    outside its MONTHLY_ARRIVAL_LAG; VMT-scaled), clamped to (0, 1].  This is a
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
    incidents present in the release (release_month_coverage()'s best). The
    returned fractions are conditional on that receipt frontier; the product
    receipt_coverage * best is invariant to the choice of receipt_coverage.
    vmt: dict from parse_vmt_values(), mapping (helmer, iso_month) to VMT.

    Returns {(helmer, iso_month): (best, lo, hi)} where best/lo/hi are the
    conditional incident-coverage fractions.
    """
    # Count incidents per helmer-month, deduplicated exactly like the main
    # ingestion path (public_service_incidents()).
    counts = Counter(
        (HELMER_SHORT[r["Reporting Entity"].strip()],
         nhtsa_month_to_iso(r["Incident Date"].strip()))
        for r in public_service_incidents(filed_incident_rows(nhtsa_rows)).values())

    # Companies only: a derived line (SERIES_COMPANY) is a subset of its
    # company's miles and incidents and takes the company's coverage.
    last_month_helmers = sorted(
        helmer for helmer in set(HELMER_SHORT.values())
        if vmt.get((helmer, last_month), 0) > 0)

    # Every fleet with cutoff-month VMT shares ONE pooled coverage value.
    # Request No. 2 requires a report per qualifying crash; one Monthly row
    # cannot certify that a company's entire cycle is complete. Per-fleet
    # counts are too noisy to justify different factors. Each company's
    # reference month is complete for it: before the cutoff month and outside
    # its extra Monthly-report lag (MONTHLY_ARRIVAL_LAG; a lagged month still
    # lacks its Monthly reports, so its count would understate the rate).
    pooled_obs, expected, pooled_ref = pooled_reference_rate(
        counts, last_month, vmt,
        {helmer: month_shift(last_month, -1 - lag)
         for helmer, lag in MONTHLY_ARRIVAL_LAG.items()})
    # Expected through the cutoff at the reference rate.
    pooled_exp = expected * receipt_coverage
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


# An incident's track is the Report Type of its first filing: 1-Day or 5-Day
# (the prompt reports of SGO Request No. 1) or Monthly (Request No. 2).
REPORT_TRACK = {"1-Day": "five_day", "5-Day": "five_day", "Monthly": "monthly"}


def monthly_track_counts(rows):
    """Counter {(helmer, iso_month, track): incidents} over the in-scope
    incidents of <rows> (public_service_incidents()), by the track of the
    surviving report's version-1 filing (REPORT_TRACK)."""
    filed = filed_incident_rows(rows)
    first_type = {r["Report ID"]: r["Report Type"].strip()
                  for r in filed if int(r["Report Version"]) == 1}
    counts = Counter()
    for r in public_service_incidents(filed).values():
        first = first_type.get(r["Report ID"])
        must(first in REPORT_TRACK,
             "in-scope report has no version-1 filing of a known track",
             reportId=r["Report ID"], firstReportType=first)
        counts[(HELMER_SHORT[r["Reporting Entity"].strip()],
                nhtsa_month_to_iso(r["Incident Date"].strip()),
                REPORT_TRACK[first])] += 1
    return counts


def monthly_lag_coverage(counts, last_month):
    """The Monthly-track incident coverage of the months inside each helmer's
    extra Monthly-report lag (MONTHLY_ARRIVAL_LAG): {(helmer, iso_month):
    (best, lo, 1.0)} for the lag's months just before the data-through month
    <last_month>, best = the helmer's pooled in-scope 5-Day share and lo its
    lowest monthly share (FIVE_DAY_SHARE_OBSERVATIONS); the high edge 1.0 says
    the month may have no Monthly-track crash at all. <counts> is
    monthly_track_counts() of this release.

    Stops the run unless the tables cover the helmers they must, each lag is
    what its observations say, every month that is now measurable is observed
    (or excluded with a reason), the observations agree with this release, and
    no lagged month already holds a Monthly-track report (which would mean
    the helmer's Monthly reports are no longer late)."""
    helmers = set(HELMER_SHORT.values())
    must(set(MONTHLY_ARRIVAL_LAG) == helmers == set(MONTHLY_ARRIVAL_OBSERVATIONS),
         "MONTHLY_ARRIVAL_LAG and MONTHLY_ARRIVAL_OBSERVATIONS must cover "
         "every helmer (data/README.md, Each NHTSA release, step 3)", helmers=sorted(helmers),
         lag=sorted(MONTHLY_ARRIVAL_LAG),
         observations=sorted(MONTHLY_ARRIVAL_OBSERVATIONS))
    must(all(isinstance(lag, int) and lag >= 0
             for lag in MONTHLY_ARRIVAL_LAG.values()),
         "MONTHLY_ARRIVAL_LAG values must be whole numbers of releases",
         lag=MONTHLY_ARRIVAL_LAG)
    observed = {tuple(sorted(table)) for table in
                MONTHLY_ARRIVAL_OBSERVATIONS.values()}
    must(len(observed) == 1,
         "every helmer's MONTHLY_ARRIVAL_OBSERVATIONS must cover the same "
         "months (data/README.md, Each NHTSA release, step 3)", months={h: sorted(t) for h, t in
                           MONTHLY_ARRIVAL_OBSERVATIONS.items()})
    months = set(next(iter(observed)))
    must(not months & set(MONTHLY_ARRIVAL_MONTHS_EXCLUDED),
         "a month is both observed and excluded (data/README.md, Each NHTSA release, step 3)",
         months=sorted(months & set(MONTHLY_ARRIVAL_MONTHS_EXCLUDED)))
    # The month whose third release is this one is now measurable: it must be
    # observed or excluded, so the per-release re-measurement cannot be
    # skipped. The data-through month itself cannot be observed. This runs
    # before the lag check below: with the measurable month missing, a
    # helmer's newest observed month can be an older tie (Tesla's 2026-07 on
    # the Nov-2026 release) that would read as a lag disagreement (audit
    # 2026-10-30, R2).
    due = month_shift(last_month, -2)
    month = min(months)
    while month <= due:
        must(month in months or month in MONTHLY_ARRIVAL_MONTHS_EXCLUDED,
             "no Monthly-report arrival observation for a month that is now "
             "measurable (its third release is this one: measure it from the "
             "snapshots and add it to MONTHLY_ARRIVAL_OBSERVATIONS in "
             "data/slurp.py, or exclude it with a reason in "
             "MONTHLY_ARRIVAL_MONTHS_EXCLUDED: data/README.md, Each NHTSA "
             "release, step 3)", month=month, last_month=last_month)
        month = month_shift(month, 1)
    # Each lag is the extra lag of the majority of its helmer's newest
    # observed month with any Monthly-track incident (ties count as late).
    for helmer, table in MONTHLY_ARRIVAL_OBSERVATIONS.items():
        newest = max((m for m, c in table.items() if sum(c) > 0), default=None)
        must(newest is not None,
             "a helmer's MONTHLY_ARRIVAL_OBSERVATIONS hold no Monthly-track "
             "incident (data/README.md, Each NHTSA release, step 3)", helmer=helmer)
        arrived = table[newest]
        majority = next(j for j in range(len(arrived))
                        if 2 * sum(arrived[:j + 1]) > sum(arrived))
        must(majority == MONTHLY_ARRIVAL_LAG[helmer],
             "a helmer's MONTHLY_ARRIVAL_LAG disagrees with its observations "
             "(the extra lag of the majority of its newest observed month "
             "with any Monthly-track incident; ties count as late: set "
             "MONTHLY_ARRIVAL_LAG in data/slurp.py, data/README.md, Each NHTSA "
             "release, step 3)",
             helmer=helmer, lag=MONTHLY_ARRIVAL_LAG[helmer], month=newest,
             observed=arrived)
    must(max(months) < last_month,
         "an arrival observation for the data-through month or later "
         "(data/README.md, Each NHTSA release, step 3)",
         month=max(months), last_month=last_month)
    for helmer, table in MONTHLY_ARRIVAL_OBSERVATIONS.items():
        for month, arrived in table.items():
            release = counts[(helmer, month, "monthly")]
            must(sum(arrived) == release,
                 "MONTHLY_ARRIVAL_OBSERVATIONS disagree with this release "
                 "(a row must total its month's in-scope Monthly-track "
                 "incidents in the newest file: re-measure, data/README.md, Each NHTSA release, step 3)",
                 helmer=helmer, month=month, observed=arrived, release=release)
    lagged = {h for h, lag in MONTHLY_ARRIVAL_LAG.items() if lag > 0}
    # A lagged month that already holds an in-scope Monthly-track report
    # contradicts the lag itself, so this stop runs before the share tables'
    # checks: on the Oct-15-2026 release the zero-share stop below fired first
    # and asked for a coverage model when the lag was what had to change.
    for helmer in sorted(lagged):
        lag = MONTHLY_ARRIVAL_LAG[helmer]
        for i in range(lag):
            month = month_shift(last_month, i - lag)
            must(counts[(helmer, month, "monthly")] == 0,
                 "a lagged month already holds an in-scope Monthly-track "
                 "report in the newest file, so this helmer's Monthly reports "
                 "are no longer late (re-measure: record the month's on-time "
                 "count in MONTHLY_ARRIVAL_OBSERVATIONS and set its "
                 "MONTHLY_ARRIVAL_LAG: data/README.md, Each NHTSA release, step 3)", helmer=helmer, month=month,
                 monthly=counts[(helmer, month, "monthly")])
    must(set(FIVE_DAY_SHARE_OBSERVATIONS) == lagged,
         "FIVE_DAY_SHARE_OBSERVATIONS must cover exactly the lagged helmers "
         "(data/README.md, Each NHTSA release, step 3)",
         shares=sorted(FIVE_DAY_SHARE_OBSERVATIONS), lagged=sorted(lagged))
    result = {}
    for helmer, table in FIVE_DAY_SHARE_OBSERVATIONS.items():
        lag = MONTHLY_ARRIVAL_LAG[helmer]
        final = month_shift(last_month, -1 - lag)
        span = [min(table)]
        while span[-1] < final:
            span.append(month_shift(span[-1], 1))
        must(span[-1] == final and sorted(table) == span,
             "a lagged helmer's FIVE_DAY_SHARE_OBSERVATIONS must hold every "
             "month from its first through the newest month final for it "
             "(data-through month - 1 - lag; data/README.md, Each NHTSA release, step 3)", helmer=helmer,
             months=sorted(table), want=span)
        for month, (five_day, total) in table.items():
            release = (counts[(helmer, month, "five_day")],
                       counts[(helmer, month, "five_day")]
                       + counts[(helmer, month, "monthly")])
            must((five_day, total) == release,
                 "FIVE_DAY_SHARE_OBSERVATIONS disagree with this release "
                 "(a row is the month's in-scope 5-Day-track and all in-scope "
                 "incidents in the newest file: re-measure, data/README.md, Each NHTSA release, step 3)",
                 helmer=helmer, month=month, observed=(five_day, total),
                 release=release)
        shares = [n / d for n, d in table.values() if d > 0]
        must(shares and min(shares) > 0,
             "a lagged helmer's lowest monthly 5-Day share is 0 (or it has no "
             "incidents), so its lagged months' coverage band would reach 0: "
             "decide how to bound it: data/README.md, Each NHTSA release, step 3", helmer=helmer, observations=table)
        best = round(sum(n for n, _ in table.values())
                     / sum(d for _, d in table.values()), 4)
        lo = round(min(shares), 4)
        for i in range(lag):
            month = month_shift(last_month, i - lag)
            result[(helmer, month)] = (best, lo, 1.0)
            print(f"  {month} {helmer} Monthly-track coverage (Monthly-report "
                  f"lag {lag}): best={best} lo={lo}")
    return result


def read_vmt_master():
    """Read raw VMT CSV text from the in-repo master (data/vmt.csv)."""
    return VMT_MASTER.read_text()


def parse_vmt_months(raw_text):
    """Parse the set of ISO months from the raw VMT CSV text."""
    return {row[1].strip() for row in _vmt_data_rows(raw_text)}


def build_vmt_csv(raw_text, inc_cov, coverage_by_month, active_months):
    """Add coverage + incident_coverage columns to the raw VMT CSV text.

    inc_cov: dict from incident_coverage() and monthly_lag_coverage(),
    mapping (helmer, iso_month) to (best, lo, hi) tuples.  Missing keys
    default to (1, 1, 1).
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
            (SERIES_COMPANY[_canonical_helmer(row[0].strip())], month), (1, 1, 1))
        cov_best, cov_lo, cov_hi = coverage_by_month.get(month, (1, 1, 1))
        nums, rationale = _vmt_master_cells(row)
        writer.writerow([row[0], row[1], *nums, cov_best, cov_lo, cov_hi,
                         ic_best, ic_lo, ic_hi, rationale])
    return out_buf.getvalue().rstrip("\n")


def _vmt_master_cells(row):
    """A master row's six numbers as plain integer strings, and its rationale.

    A thousands-separated "22,000,000" entered in the master CSV becomes
    22000000, matching the plain-integer convention of the rest of the data
    and keeping the emitted CSV safe for naive parsers. Exactly nine cells: a
    rationale with an unquoted comma would otherwise be truncated at that
    comma without a word.
    """
    nums = [cell.strip().replace(",", "") for cell in row[2:8]]
    must(len(row) == 9, "VMT master row must have exactly 9 cells",
         helmer=row[0], month=row[1].strip(), cells=len(row))
    return nums, row[8]


def ghost_vmt_csv(raw_text, last_month, run_month):
    """The master rows of the ghost months, as CSV text for data/vmt.js.

    A ghost month is a month after the data-through month (last_month) for
    which the master holds rows: the month in progress, or a finished month
    no NHTSA release has reached. The VMT charts draw these rows faded; no
    rate uses them until a release brings the month's incidents. The master
    must hold the month after last_month (so each release brings the next
    month's estimate), each ghost month must carry a row for every line with
    a row in last_month, and no row may be for a month after run_month, the
    month slurp runs in: a VMT row records miles already driven, estimated
    or measured (forecasts live in crashla.js's MILES_FORECAST).
    """
    rows = [r for r in csv.reader(io.StringIO(raw_text))
            if any(cell.strip() for cell in r)]
    header, body = rows[0], rows[1:]
    later = sorted({r[1].strip() for r in body if r[1].strip() > run_month})
    must(not later,
         "data/vmt.csv has rows for months that have not begun (a VMT row "
         "records miles already driven; a forecast belongs in "
         "MILES_FORECAST: data/README.md, Each NHTSA release, step 4)", run_month=run_month, months=later)
    ghost = [r for r in body if r[1].strip() > last_month]
    months = sorted({r[1].strip() for r in ghost})
    must(months and months[0] == month_shift(last_month, 1),
         "data/vmt.csv has no rows for the month after NHTSA's data-through "
         "month: add every line's estimate for it (its ghost month, drawn "
         "faded on the VMT charts), then re-run slurp.py (data/README.md, Each NHTSA release, step 4)",
         data_through=last_month, want=month_shift(last_month, 1),
         ghost_months=months)
    lines = {r[0].strip() for r in body if r[1].strip() == last_month}
    for i, month in enumerate(months):
        must(i == 0 or month == month_shift(months[i - 1], 1),
             "ghost months must be consecutive (data/README.md, Each NHTSA release, step 4)", months=months)
        have = {r[0].strip() for r in ghost if r[1].strip() == month}
        must(have == lines,
             "a ghost month must have a row for every line that has one in "
             "the data-through month (data/README.md, Each NHTSA release, step 4)", month=month,
             missing=sorted(lines - have), extra=sorted(have - lines))
    out_buf = io.StringIO()
    writer = csv.writer(out_buf, lineterminator="\n")
    writer.writerow(header)
    for row in ghost:
        nums, rationale = _vmt_master_cells(row)
        writer.writerow([row[0], row[1], *nums, rationale])
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
    "Waabi",
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
# / Test)" (three reports so far: 13781-15395, the Houston tree-stump
# recovery, and 13781-16678 and -16679, AUG-2026 Dallas and Austin). The code
# itself counts for Tesla -- a remote operator can be involved while the ADS
# drives -- but crashes in which the remote human was DRIVING, all three among
# them, leave every metric via TELEOP_DRIVEN_REPORTS below
# (human decision 2026-09-26, reversing the 2026-08-19 inclusion).
# Waymo and Zoox (made explicit 2026-09-25, human-approved): their VMT
# denominators are driverless miles only (Waymo hub rider-only miles, Zoox
# driverless miles), so "None" and "Remote (Commercial / Test)" (a driverless
# car with a remote operator involved -- both such reports so far say the ADS
# was engaged) count, and every mode with a safety driver aboard is excluded
# whatever the ADS was doing: those miles are not in the denominator.
# "Other, see Narrative" is excluded by type and classified per report via
# OPERATOR_TYPE_OVERRIDE below. Every helmer has both a counted and an excluded
# set, and together they must stay EXHAUSTIVE over the operator types it files
# -- main() must()s that, so a novel mode crashes the run for a human to
# classify instead of silently dropping out of scope (which is how 13781-15395
# went unnoticed for a month). Other reporting entities never count.
PUBLIC_SERVICE_OPERATOR_TYPES = {
    "Tesla, Inc.": {"None", "In-Vehicle (Commercial / Test)",
                    "Remote (Commercial / Test)"},
    "Waymo LLC": {"None", "Remote (Commercial / Test)"},
    "Zoox, Inc.": {"None", "Remote (Commercial / Test)"},
}
EXCLUDED_OPERATOR_TYPES = {
    "Tesla, Inc.": set(),
    "Waymo LLC": {"In-Vehicle (Commercial / Test)",
                  "In-Vehicle and Remote (Commercial / Test)",
                  "Other, see Narrative"},
    "Zoox, Inc.": {"In-Vehicle (Commercial / Test)", "Other, see Narrative"},
}
must(set(PUBLIC_SERVICE_OPERATOR_TYPES) == set(HELMER_SHORT) ==
     set(EXCLUDED_OPERATOR_TYPES),
     "operator scope must be configured for exactly the helmers",
     counted=sorted(PUBLIC_SERVICE_OPERATOR_TYPES),
     excluded=sorted(EXCLUDED_OPERATOR_TYPES), helmers=sorted(HELMER_SHORT))
must(all(PUBLIC_SERVICE_OPERATOR_TYPES[e] | EXCLUDED_OPERATOR_TYPES[e]
         <= EXPECTED_DRIVER_TYPES for e in HELMER_SHORT),
     "operator scope names an unknown Driver / Operator Type")
must(all(not PUBLIC_SERVICE_OPERATOR_TYPES[e] & EXCLUDED_OPERATOR_TYPES[e]
         for e in HELMER_SHORT),
     "an operator type is both counted and excluded")

# Operator types the SGO field gets wrong, keyed by Report ID (added
# 2026-09-25, human-approved). 30270-14625 (Waymo, Washington DC, MAR-2026) is
# coded "None", but its narrative says "a test driver was present (in the
# driver's seating position)" -- the situation 30270-8403's v2 filing
# corrected upstream. DC is a Waymo testing market with no rider-only miles in
# data/vmt.csv, and Waymo's own safety hub leaves the crash out of its
# rider-only set.
# 30270-8750 (Waymo, Tempe, SEP-2024) is coded "Other, see Narrative"; its
# narrative names no test driver (Waymo's filings say "a test driver was
# present" when one is) and it is on Waymo's own rider-only crash list (hub
# CSV2), so it is a driverless-service crash. Deliberately NOT overridden:
# Zoox 30610-9578 ("Other", "in autonomy", no operator named) -- 51 of Zoox's
# 110 safety-driver narratives never mention the driver either, so silence
# cannot show the car was driverless.
# Each entry is (the raw Driver / Operator Type the review judged, the type to
# apply). operator_in_scope() must()s that the filed value still equals the
# reviewed one, so an upstream re-filing (a v2 that changes the code, as
# 30270-8403's did) stops the run for a re-review instead of being overridden.
# 30270-4881 (Waymo, San Francisco, JAN-2023) is coded "None" with the same
# narrative sentence as 30270-14625 ("a test driver was present (in the
# drivers seating position)"); Waymo's own rider-only crash list (hub CSV2)
# leaves it out. Found 2026-09-26 by the safety-driver tripwire below. Waymo
# also re-filed it under a new Report ID, 30270-7598 (v1, APR-2024, same Same
# Incident ID 5bb5073dab94bae), coded "In-Vehicle (Commercial / Test)": "This
# is an update to the previously submitted report 30270-7257 submitted on
# 2/15/2023, which had incorrectly provided the DRIVER / OPERATOR TYPE as
# "None and the MILEAGE as 22991." (4881 was submitted then; 7257 is another
# report). Both are out of scope, so the dedup has no choice to make.
OPERATOR_TYPE_OVERRIDE = {
    "30270-14625": ("None", "In-Vehicle (Commercial / Test)"),
    "30270-4881": ("None", "In-Vehicle (Commercial / Test)"),
    "30270-8750": ("Other, see Narrative", "None"),
}
must(all(len(v) == 2 and set(v) <= EXPECTED_DRIVER_TYPES
         for v in OPERATOR_TYPE_OVERRIDE.values()),
     "OPERATOR_TYPE_OVERRIDE entries must be (reviewed raw type, applied type)")
must(all(len(v) == 2 and set(v) <= EXPECTED_SEVERITIES and v[1] != "Unknown"
         for v in SEVERITY_OVERRIDE.values()),
     "SEVERITY_OVERRIDE entries must be (reviewed filed severity, severity to "
     "store), both NHTSA values and the stored one not Unknown")
must(all(len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], bool)
         for v in AIRBAG_OVERRIDE.values()),
     "AIRBAG_OVERRIDE entries must be (reviewed filed value, deployed)")
must(not set(SUPERSEDED_REPORTS) & (set(SUPERSEDED_REPORTS.values())
                                    | SPLIT_SAME_INCIDENT_REPORTS),
     "a replaced report (SUPERSEDED_REPORTS) cannot stand for another or be "
     "split")

# Crashes in which a remote human, not the ADS, was driving, keyed by Report
# ID with the narrative's own words (2026-09-26, human decision: the metrics
# assess the self-driving software, so a crash counts only when the ADS was
# driving -- the same line that keeps Waymo/Zoox safety-driver crashes out).
# Excluded from every metric. Their miles stay in Tesla's denominator (Tesla
# does not split them out), but they are walking-pace recoveries, so dropping
# the crash while keeping those miles is nearly exact. The operator code cannot
# find these -- two are coded "None" -- hence the narrative tripwire below.
TELEOP_DRIVEN_REPORTS = {
    "13781-11459": "The teleoperator took over vehicle control and gradually increased vehicle speed",
    "13781-14043": "took over vehicle control when the ADS was stopped and proceeded straight on the street",
    "13781-15395": "As the remote assistance operator continued to recover the vehicle, they made contact with a hidden tree stump",
    "13781-16678": "The remote support operator remotely took control and while moving forward",
    "13781-16679": "The remote support operator was in control of the vehicle",
}
# In-scope reports that trip the tripwire below (remote-human language, or
# the "Remote (Commercial / Test)" code itself) but in which the ADS was
# driving at impact, keyed by Report ID with the reason.
REMOTE_LANGUAGE_ADS_DRIVEN = {
    # coded Remote; "Level 4 ADS was engaged in autonomous mode": stationary,
    # yielding in a crosswalk, when a cyclist ran the red into it
    "30270-13378": "ADS engaged; stationary AV struck by a red-running cyclist",
    # coded Remote; "an unoccupied Zoox autonomous vehicle ... gradually slowed
    # to a stop when it was rear ended"
    "30610-11752": "ADS engaged; unoccupied AV slowing to a stop, rear-ended",
}
# Language saying a remote human may have been driving. Calibrated 2026-09-26
# on every in-scope narrative (all versions), when it matched exactly the
# three TELEOP_DRIVEN_REPORTS of the time and not "remote controlled" toys or
# a "fleet response team" arriving on scene; widened the same day to cover
# wording seen elsewhere in the SGO corpus (Cruise 30412-6179: "A remote
# assistance advisor ... shifted the AV out of park"), "remote driver/pilot",
# and any whitespace between words; widened on the Oct-15-2026 release for
# Tesla's "remote support operator" and "remotely took control" (13781-16678,
# -16679). Re-checked then on every in-scope narrative of the newest files:
# it matches exactly the five TELEOP_DRIVEN_REPORTS. Neither
# REMOTE_LANGUAGE_ADS_DRIVEN entry matches it; their "Remote (Commercial /
# Test)" code is what makes them trip check_teleop_classified().
TELEOP_PATTERN = re.compile(
    r"tele-?operat|remote\s+assist\w*|remote\s+(support\s+)?(operator|driver|pilot)|"
    r"supported\s+remotely|"
    r"remotely\s+(driven|operated|controlled|piloted|assisted|supported)|"
    r"remotely\s+took\s+(over\s+)?(the\s+)?(vehicle\s+)?control|"
    r"took\s+over\s+(the\s+)?(vehicle\s+)?control", re.I)
must(not set(TELEOP_DRIVEN_REPORTS) & set(REMOTE_LANGUAGE_ADS_DRIVEN),
     "a report is classified both teleoperator-driven and ADS-driven")
must(not set(PASSENGER_OVERRIDE) & set(OCCUPANCY_LANGUAGE_REVIEWED),
     "a report's passenger code is both re-coded and kept as filed")
must(all(len(v) == 2 and v[1] in PAX_CLASS for v in PASSENGER_OVERRIDE.values()),
     "PASSENGER_OVERRIDE entries must be (reviewed filed value, value to "
     "store), the stored value a code PAX_CLASS classifies")


# Tesla's no-monitor line (2026-10-23): beside Tesla's every-mode line the page
# plots Tesla's driving with no safety monitor in the vehicle. Tesla's robotaxi
# safety page (tesla.com/robotaxi/safety) lists, under "Download all SGO
# reportable events" (Robotaxi-SGO-Report_10_18_2026.xlsx, Last-Modified Oct
# 20, 2026), every collision Tesla reported to NHTSA "while Robotaxi is driving
# autonomously with no safety monitor in the vehicle, including when a remote
# operator is assisting or has taken control": these 32 reports, May 23 to Oct
# 18, 2026, 15 of them newer than NHTSA's Oct-15 file. Its fields and
# narratives match NHTSA's (2026-10-23 cross-check). Re-read the spreadsheet
# at every release: an in-scope Tesla report from TESLA_NO_MONITOR_FROM on
# stops the run (incident_series) until it is here or in
# TESLA_MONITOR_ABOARD_REPORTS.
TESLA_NO_MONITOR_REPORTS = frozenset({
    "13781-15399", "13781-15400", "13781-15395", "13781-15342", "13781-15809",
    "13781-15808", "13781-16255", "13781-16294", "13781-16256", "13781-16679",
    "13781-16678", "13781-16677", "13781-16676", "13781-16675", "13781-16674",
    "13781-16673", "13781-17193", "13781-16671", "13781-17191", "13781-17179",
    "13781-17178", "13781-16941", "13781-16733", "13781-17015", "13781-17300",
    "13781-17301", "13781-17302", "13781-17203", "13781-17303", "13781-17299",
    "13781-17304", "13781-17305",
})
# In-scope Tesla reports from TESLA_NO_MONITOR_FROM on with a safety monitor
# aboard: each narrative says so ("a safety monitor present in the vehicle",
# "Safety monitor was present"), and none is on Tesla's list.
TESLA_MONITOR_ABOARD_REPORTS = frozenset({
    "13781-13644", "13781-13645", "13781-13646", "13781-13648", "13781-14630",
    "13781-14631", "13781-15017", "13781-16672",
})
# Tesla's no-monitor service began Jan 22, 2026; its safety page counts miles
# and crashes from that day, so no report before this month is on the line.
TESLA_NO_MONITOR_FROM = "2026-01"
# Each line the page plots and the company whose reports and coverage it uses:
# each company is its own; TeslaNoMonitor is Tesla's subset. Its data/vmt.csv
# rows ("teslanomonitor") carry Tesla's no-monitor miles; build_vmt_csv gives
# them Tesla's coverage, and the pooled incident coverage counts companies only.
SERIES_COMPANY = {"Waymo": "Waymo", "Tesla": "Tesla", "Zoox": "Zoox",
                  "TeslaNoMonitor": "Tesla"}
# A derived line's member reports: (company, reviewed Report IDs).
DERIVED_SERIES_REPORTS = {"TeslaNoMonitor": ("Tesla", TESLA_NO_MONITOR_REPORTS)}
must(not TESLA_NO_MONITOR_REPORTS & TESLA_MONITOR_ABOARD_REPORTS,
     "a Tesla report cannot be both on Tesla's no-monitor list and monitor-aboard")
must(set(SERIES_COMPANY.values()) == set(HELMER_SHORT.values()) and
     set(HELMER_SHORT.values()) <= set(SERIES_COMPANY) and
     set(DERIVED_SERIES_REPORTS) == set(SERIES_COMPANY) - set(HELMER_SHORT.values()),
     "SERIES_COMPANY must map every company to itself and every derived line "
     "(each with a DERIVED_SERIES_REPORTS entry) to a company")


def check_series_have_vmt(incidents, vmt):
    """Stop unless every line an incident counts toward (its `series`) has a
    data/vmt.csv row for the incident's month: the page refuses an incident
    with no denominator ("orphan incident(s)"), and the stale-VMT check above
    looks only at the newest month across all lines."""
    missing = sorted({(series, nhtsa_month_to_iso(rec["date"]))
                      for rec in incidents for series in rec["series"]} - set(vmt))
    must(not missing, "in-scope incidents on a line with no data/vmt.csv row "
         "for their month: add those rows (data/README.md, Each NHTSA release, step 4)", missing=missing)


def incident_series(helmer, rid, month):
    """The lines an in-scope incident counts toward: its company, plus every
    derived line (DERIVED_SERIES_REPORTS) of that company listing the report.
    Stops on a Tesla report from TESLA_NO_MONITOR_FROM on that has no monitor
    classification, and on a listed report dated before that month."""
    must(rid not in TESLA_NO_MONITOR_REPORTS or month >= TESLA_NO_MONITOR_FROM,
         "a report on Tesla's no-monitor list predates that service "
         "(TESLA_NO_MONITOR_FROM; data/README.md, Each NHTSA release, step 6)", reportId=rid, month=month)
    must(helmer != "Tesla" or month < TESLA_NO_MONITOR_FROM or
         rid in TESLA_NO_MONITOR_REPORTS or rid in TESLA_MONITOR_ABOARD_REPORTS,
         "in-scope Tesla report with no monitor classification: add it to "
         "TESLA_NO_MONITOR_REPORTS if Tesla's latest no-monitor list "
         "(tesla.com/robotaxi/safety) has it, else to "
         "TESLA_MONITOR_ABOARD_REPORTS once its narrative or Tesla puts a "
         "monitor aboard: data/README.md, Each NHTSA release, step 6", reportId=rid, month=month)
    return [helmer] + [series for series, (company, rids) in DERIVED_SERIES_REPORTS.items()
                       if company == helmer and rid in rids]


def operator_in_scope(row):
    """True if <row>'s operator type is one whose miles are in the reporting
    entity's VMT denominator (the service the VMT master measures)."""
    counted = PUBLIC_SERVICE_OPERATOR_TYPES.get(
        row["Reporting Entity"].strip(), set())
    filed = row["Driver / Operator Type"].strip()
    reviewed, applied = OPERATOR_TYPE_OVERRIDE.get(row["Report ID"], (filed, filed))
    must(reviewed == filed,
         "OPERATOR_TYPE_OVERRIDE was reviewed against a different Driver / "
         "Operator Type (the report was re-filed; re-review it: data/README.md, Each NHTSA release, step 6)",
         reportId=row["Report ID"], reviewed=reviewed, filed=filed)
    return applied in counted


def is_public_service_incident(row):
    """True if <row> counts: an in-scope operator type, with the ADS (not a
    remote human) driving."""
    return operator_in_scope(row) and row["Report ID"] not in TELEOP_DRIVEN_REPORTS


# Language saying a human was in the driver's seat. For Waymo and Zoox the
# operator code is supposed to carry this ("In-Vehicle ..."), and their
# denominators hold driverless miles only, so an in-scope narrative that says
# otherwise must be classified: re-coded in OPERATOR_TYPE_OVERRIDE, or listed
# below as ADS-driven at impact with the reason. Tesla's monitor-aboard mode
# is in scope by design (its deck miles include it), so Tesla is exempt.
# Calibrated 2026-09-26 on every in-scope Waymo/Zoox narrative, all versions:
# exactly 30270-4881 (re-coded above) and 30270-7075 (below).
SAFETY_DRIVER_PATTERN = re.compile(
    r"test driver|safety driver|safety operator|vehicle operator|"
    r"driver'?s seat|seating position|behind the wheel|manual mode|in manual",
    re.I)
SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN = {
    # "returned to the depot in manual mode" -- after the crash; the AV was
    # driverless at impact (a cyclist struck it)
    "30270-7075": "manual mode only for the return to the depot after the crash",
}
SAFETY_DRIVER_EXEMPT_ENTITIES = {"Tesla, Inc."}


def check_safety_driver_classified(row):
    """Stop the run on an in-scope Waymo/Zoox report whose narrative says a
    human was in the driver's seat, until a human classifies it."""
    rid = row["Report ID"]
    flagged = (operator_in_scope(row)
               and row["Reporting Entity"].strip() not in SAFETY_DRIVER_EXEMPT_ENTITIES
               and SAFETY_DRIVER_PATTERN.search(row["Narrative"]) is not None)
    must(not flagged or rid in SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN,
         "a safety driver may have been aboard (read the narrative; re-code the "
         "report in OPERATOR_TYPE_OVERRIDE if a human was in the driver's seat, "
         "else list it in SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN: data/README.md, Each NHTSA release, step 6)",
         reportId=rid, operator=row["Driver / Operator Type"].strip(),
         narrative=row["Narrative"][:300])


def check_teleop_classified(row):
    """Stop the run on an in-scope report that says a remote human may have
    been driving -- by its narrative (TELEOP_PATTERN) or by its operator code
    ("Remote (Commercial / Test)") -- until a human classifies it."""
    rid = row["Report ID"]
    flagged = operator_in_scope(row) and (
        TELEOP_PATTERN.search(row["Narrative"]) is not None or
        row["Driver / Operator Type"].strip() == "Remote (Commercial / Test)")
    must(not flagged or rid in TELEOP_DRIVEN_REPORTS
         or rid in REMOTE_LANGUAGE_ADS_DRIVEN,
         "a remote human may have been driving (read the narrative; add the "
         "report to TELEOP_DRIVEN_REPORTS if a remote human was driving at "
         "impact, else to REMOTE_LANGUAGE_ADS_DRIVEN: data/README.md, Each NHTSA release, step 6)",
         reportId=rid, operator=row["Driver / Operator Type"].strip(),
         narrative=row["Narrative"][:300])


def reviewed_belted(rid, filed):
    """The passenger code to store for report <rid>, whose filing says
    <filed>: its PASSENGER_OVERRIDE entry if it has one, else <filed>."""
    reviewed, applied = PASSENGER_OVERRIDE.get(rid, (filed, filed))
    must(reviewed == filed,
         "PASSENGER_OVERRIDE was reviewed against a different filed "
         "passenger value (the report was re-filed; re-read its narrative: "
         "data/README.md, Each NHTSA release, step 6)",
         reportId=rid, reviewed=reviewed, filed=filed)
    return applied


def check_passengers_reviewed(incidents):
    """Stop the run unless every in-scope Tesla report has a
    PASSENGER_OVERRIDE entry, so a new Tesla report's narrative gets read for
    whether a passenger, and not only the safety monitor, was aboard, and
    unless every entry is an in-scope report (an entry whose report left
    scope is stale)."""
    stored = {r["reportId"] for r in incidents}
    tesla = {r["reportId"] for r in incidents if r["helmer"] == "Tesla"}
    reviewed = set(PASSENGER_OVERRIDE)
    must(tesla <= reviewed and reviewed <= stored,
         "PASSENGER_OVERRIDE must cover every in-scope Tesla report and list "
         "only in-scope reports (read each new Tesla report's narrative and "
         "add whether a passenger, not just the safety monitor, was aboard; "
         "drop entries for reports no longer in scope: data/README.md, Each NHTSA release, step 6)",
         unreviewed=sorted(tesla - reviewed), stale=sorted(reviewed - stored))


def check_occupancy_classified(row):
    """Stop the run on an in-scope report whose narrative says whether anyone
    was aboard the AV (OCCUPANCY_PATTERN) where its filed passenger code says
    otherwise, until a human classifies it: a PASSENGER_OVERRIDE entry storing
    the narrative's answer, or OCCUPANCY_LANGUAGE_REVIEWED with the words that
    show the filed code stands. <row> is the report's surviving (latest)
    filing. It also stops on a filed passenger code PAX_CLASS does not list."""
    rid = row["Report ID"]
    stated = {m.lastgroup for m in OCCUPANCY_PATTERN.finditer(row["Narrative"])}
    filed = row["Were All Passengers Belted?"].strip()
    must(filed in PAX_CLASS,
         "unexpected passenger code (classify it in PAX_CLASS and in "
         "crashla.js's PAX_NONE, PAX_PRESENT or PAX_UNKNOWN: data/README.md, Each NHTSA release, step 6)",
         reportId=rid, filed=filed)
    flagged = (operator_in_scope(row) and len(stated) > 0
               and stated != {PAX_CLASS[filed]})
    must(not flagged or rid in PASSENGER_OVERRIDE
         or rid in OCCUPANCY_LANGUAGE_REVIEWED,
         "the narrative says who was aboard and the filed passenger code "
         "disagrees (read the narrative; add a PASSENGER_OVERRIDE entry with "
         "the code it supports, else list the report in "
         "OCCUPANCY_LANGUAGE_REVIEWED with the words that show the filed code "
         "stands: data/README.md, Each NHTSA release, step 6)", reportId=rid, filed=filed, stated=sorted(stated),
         narrative=row["Narrative"][:300])


def check_superseded_reviewed(rows):
    """Stop the run unless each SUPERSEDED_REPORTS entry names two reports
    filed in <rows> whose latest filings share a Same Incident ID (an entry
    applies only to rows that hold its re-filing, so one whose re-filing is
    missing would stop applying without a word, and the replaced report
    would count again)."""
    latest = latest_filings(rows)
    bad = sorted((old, new) for old, new in SUPERSEDED_REPORTS.items()
                 if old not in latest or new not in latest
                 or latest[old]["Same Incident ID"] != latest[new]["Same Incident ID"])
    must(not bad,
         "a SUPERSEDED_REPORTS entry in data/slurp.py does not pair two filed "
         "reports under one Same Incident ID (re-read both reports and fix or "
         "drop the entry: data/README.md, Each NHTSA release, step 6)",
         entries=bad)


def check_teleop_quotes(rows):
    """Stop the run unless each TELEOP_DRIVEN_REPORTS entry's quote is in its
    report's latest filed narrative (<rows>): the exclusion rests on those
    words, so a re-filing that drops them must be re-read before the crash
    stays out of every metric (since 2026-10-31: open question 10's
    reviewed-value rule, for the reviewed table that takes reports out of
    scope)."""
    latest = latest_filings(rows)
    changed = sorted(rid for rid, quote in TELEOP_DRIVEN_REPORTS.items()
                     if rid not in latest or quote not in latest[rid]["Narrative"])
    must(not changed,
         "a TELEOP_DRIVEN_REPORTS entry's quote is not in its report's latest "
         "filed narrative (the report was re-filed or is gone: re-read it and "
         "update or drop the entry in data/slurp.py: data/README.md, Each "
         "NHTSA release, step 6)",
         reports=changed)


def check_overrides_apply(incidents):
    """Stop the run unless every entry of the field overrides keyed by Report
    ID names an in-scope incident of the analysis window (<incidents>, the
    records being written): an entry whose report left scope or the window,
    or was replaced by a re-filing under another Report ID, would stop
    applying without a word (audit 2026-10-30)."""
    stored = {r["reportId"] for r in incidents}
    stale = {name: sorted(set(table) - stored) for name, table in (
        ("SEVERITY_OVERRIDE", SEVERITY_OVERRIDE),
        ("AIRBAG_OVERRIDE", AIRBAG_OVERRIDE),
        ("LOCATION_OVERRIDE", LOCATION_OVERRIDE),
        ("VEHICLES_INVOLVED", VEHICLES_INVOLVED))}
    must(not any(stale.values()),
         "a field override in data/slurp.py names a report that is not an "
         "in-scope incident of the analysis window (find out why from the "
         "newest snapshot; move the entry to the report that stands, or drop "
         "it: data/README.md, Each NHTSA release, step 6)",
         stale=stale)


def unrated_reports(rows, vmt_months, fault_ids):
    """The filings, sorted by Report ID, among <rows> (in-scope surviving
    filings, public_service_incidents()) of the incidents in the analysis
    window (months in <vmt_months>) that have no data/faultfrac.csv row
    (Report IDs <fault_ids>): what the fault batch rates when slurp stops on
    them (data/README.md, Each NHTSA release, step 5)."""
    return sorted((r for r in rows
                   if nhtsa_month_to_iso(r["Incident Date"].strip()) in vmt_months
                   and r["Report ID"] not in fault_ids),
                  key=lambda r: r["Report ID"])


INCIDENT_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")
SUBMISSION_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")


def main():
    run_stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    # The run's one write before its checks: each fetched NHTSA CSV that
    # differs from its newest snapshot is saved (snapshot_csv_if_changed), so
    # a run that stops leaves the release in data/snapshots, where the fault
    # batch and the reviews read it. data/incidents.js, data/vmt.js and
    # data/faultfrac.csv are written at the end, once every check has passed.
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
             "unexpected Report Type (classify it in EXPECTED_REPORT_TYPES in "
             "data/slurp.py: data/README.md, Each NHTSA release, step 6)",
             row=i, value=rt, expected=sorted(EXPECTED_REPORT_TYPES))
        dt = r["Driver / Operator Type"].strip()
        must(dt in EXPECTED_DRIVER_TYPES,
             "unexpected Driver / Operator Type (classify it in "
             "EXPECTED_DRIVER_TYPES in data/slurp.py: data/README.md, Each "
             "NHTSA release, step 6)",
             row=i, value=dt, expected=sorted(EXPECTED_DRIVER_TYPES))
        driver = r["Reporting Entity"].strip()
        must(driver in EXPECTED_HELMERS,
             "unexpected Reporting Entity (classify it in EXPECTED_HELMERS in "
             "data/slurp.py: data/README.md, Each NHTSA release, step 6)",
             row=i, value=driver, expected=sorted(EXPECTED_HELMERS))
        must(driver not in HELMER_SHORT or
             dt in PUBLIC_SERVICE_OPERATOR_TYPES[driver] |
             EXCLUDED_OPERATOR_TYPES[driver],
             "operator type outside the configured public-service set "
             "(classify this mode: add it to PUBLIC_SERVICE_OPERATOR_TYPES "
             "or EXCLUDED_OPERATOR_TYPES in data/slurp.py: data/README.md, "
             "Each NHTSA release, step 6)",
             row=i, entity=driver, value=dt)
        check_teleop_classified(r)
        check_safety_driver_classified(r)
        sev = r["Highest Injury Severity Alleged"].strip()
        must(sev in EXPECTED_SEVERITIES,
             "unexpected Highest Injury Severity Alleged (classify it in "
             "EXPECTED_SEVERITIES in data/slurp.py and in crashla.js's "
             "SEVERITY_INFO: data/README.md, Each NHTSA release, step 6)",
             row=i, value=sev, expected=sorted(EXPECTED_SEVERITIES))
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
    check_superseded_reviewed(rows)
    check_teleop_quotes(rows)

    # Deduplicate by Report ID over every filed row, filter the surviving
    # versions to each entity's public-service operator types (see
    # PUBLIC_SERVICE_OPERATOR_TYPES), then keep one report per Same Incident
    # ID: public_service_incidents(), the one deduplication every count uses.
    by_incident = {iid: {"_row": r}
                   for iid, r in public_service_incidents(rows).items()}

    # The VMT master. The archive includes years of data; we only need
    # months with VMT.
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
         "covering these months to data/vmt.csv, then re-run slurp.py "
         "(data/README.md, Each NHTSA release, step 4).",
         stale_months={m: sorted(rids) for m, rids in sorted(stale.items())})

    # The ghost months' rows (ghost_vmt_csv): the master's months after
    # NHTSA's data-through month; release_month_coverage below checks that
    # the reviewed date's month is the data's.
    run_month = f"{run_stamp[:4]}-{run_stamp[4:6]}"
    ghost_text = ghost_vmt_csv(vmt_raw, NHTSA_DATA_THROUGH_DATE[:7], run_month)

    # The fault judgments: their values (on the 0.05 grid, in range) and that
    # every row is still an in-scope incident, checked now; data/faultfrac.csv
    # takes the NHTSA rows' six mirrored columns only at the end, once every
    # check has passed (until 2026-10-31 that sync ran here, so a typical
    # release stop left the file rewritten and data/incidents.js not: code
    # review, audit 2026-10-30, CRV-M1).
    fault_data, fault_ids = load_fault_data()
    fault_master_rows = build_fault_master_rows(
        (entry["_row"] for entry in by_incident.values()), fault_ids)

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
         "latest report-submission month must match the incident frontier "
         "(a filing received after the reviewed cutoff: check "
         "NHTSA_DATA_THROUGH_DATE in data/slurp.py against NHTSA's statement "
         "of the release's cutoff: data/README.md, Each NHTSA release, step 1)",
         submission_month=max(submission_months), last_month=last_month)
    vmt_values = parse_vmt_values(vmt_raw)
    track_counts = monthly_track_counts(rows)
    last_month_coverage = release_month_coverage(
        NHTSA_DATA_THROUGH_DATE, last_month, track_counts, vmt_values)
    coverage_by_month = {last_month: last_month_coverage}
    # The months inside a helmer's extra Monthly-report lag, checked against
    # this release (MONTHLY_ARRIVAL_LAG).
    lag_coverage = monthly_lag_coverage(track_counts, last_month)

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
        rid = rec["reportId"]
        # Shorten helmer name
        rec["helmer"] = HELMER_SHORT.get(rec["helmer"], rec["helmer"])
        # Parse speed as number
        try:
            rec["speed"] = int(rec["speed"])
        except (ValueError, TypeError):
            rec["speed"] = None
        # Convert airbag field to boolean (any vehicle deployment), or store
        # the reviewed AIRBAG_OVERRIDE value
        filed_airbag = rec["airbagAny"]
        reviewed_airbag, rec["airbagAny"] = AIRBAG_OVERRIDE.get(
            rid, (filed_airbag, "Yes" in filed_airbag))
        must(reviewed_airbag == filed_airbag,
             "AIRBAG_OVERRIDE was reviewed against a different filed Any Air "
             "Bags Deployed? (the report was re-filed; re-read its narrative "
             "and update the entry in data/slurp.py: data/README.md, Each "
             "NHTSA release, step 6)",
             reportId=rid, reviewed=reviewed_airbag, filed=filed_airbag)
        nar = rec["narrative"]
        # One Tesla filing (13781-15342) arrived wrapped in "[Summary: ...]"
        # brackets; unwrap before the prefix strips below can match.
        if nar.startswith("[Summary:") and nar.endswith("]"):
            nar = nar[1:-1]
        nar = NARRATIVE_AIRBAG_CORRECTION.sub(
            "", nar.removeprefix(NARRATIVE_BOILERPLATE))
        # Tesla's filing template opens with a contentless "Summary:" label
        # (other helmers have none); drop it so blurbs read uniformly.
        # Mojibake first: "Summary:\u00c2\u00a0The ..." only loses its prefix
        # once the "\u00c2\u00a0" is a plain space (13781-14630 kept a leading
        # space until 2026-09-26); then the prefix, then typos, then a final
        # strip so no narrative starts or ends with whitespace.
        for bad, good in NARRATIVE_MOJIBAKE.items():
            nar = nar.replace(bad, good)
        nar = nar.removeprefix("Summary:").lstrip()
        for bad, good in NARRATIVE_TYPOS.items():
            nar = nar.replace(bad, good)
        nar = NARRATIVE_UNCHANGED_PREAMBLE.sub("", nar, count=1)
        rec["narrative"] = nar.strip()
        # Compact contact area summaries from NHTSA boolean columns
        rec["svHit"] = _contact_areas(r, "SV Contact Area")
        rec["cpHit"] = _contact_areas(r, "CP Contact Area")
        # None for an unrated incident: the unrated stop below lists them all
        # before anything is written.
        rec["fault"] = fault_data.get(rid)
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(rid, 2)
        filed_severity = rec["severity"]
        reviewed_severity, rec["severity"] = SEVERITY_OVERRIDE.get(
            rid, (filed_severity, filed_severity))
        must(reviewed_severity == filed_severity,
             "SEVERITY_OVERRIDE was reviewed against a different filed Highest "
             "Injury Severity Alleged (the report was re-filed; re-read its "
             "narrative and update the entry in data/slurp.py: data/README.md, "
             "Each NHTSA release, step 6)",
             reportId=rid, reviewed=reviewed_severity, filed=filed_severity)
        must(rec["severity"] != "Unknown",
             "in-scope incident with severity Unknown, which the app counts as "
             "no injury (read its narrative and add a SEVERITY_OVERRIDE entry "
             "in data/slurp.py with the severity it supports, the 2026-07-15 "
             "convention: a hospital transport is Minor W/ Hospitalization, an "
             "injury without one Minor W/O Hospitalization, none mentioned "
             "Property Damage: data/README.md, Each NHTSA release, step 6)",
             reportId=rid, narrative=rec["narrative"][:300])
        filed_loc = (rec["city"], rec["state"])
        reviewed_loc, (rec["city"], rec["state"]) = LOCATION_OVERRIDE.get(
            rid, (filed_loc, filed_loc))
        must(reviewed_loc == filed_loc,
             "LOCATION_OVERRIDE was reviewed against a different filed City / "
             "State (the report was re-filed; re-read its narrative and update "
             "the entry in data/slurp.py: data/README.md, Each NHTSA release, "
             "step 6)",
             reportId=rid, reviewed=reviewed_loc, filed=filed_loc)
        must(rec["city"] and rec["state"],
             "incident has no city or state (read its narrative and add a "
             "LOCATION_OVERRIDE entry in data/slurp.py with the place it "
             "names: data/README.md, Each NHTSA release, step 6)",
             reportId=rid, filed=filed_loc)
        check_occupancy_classified(r)
        rec["belted"] = reviewed_belted(rid, rec["belted"])
        rec["series"] = incident_series(rec["helmer"], rid, nhtsa_month_to_iso(rec["date"]))
        incidents.append(rec)
    check_passengers_reviewed(incidents)
    check_overrides_apply(incidents)
    # Every in-scope incident of the window must be rated (decision #4,
    # 2026-10-04: "slurp stops"; until 2026-10-31 an unrated one was written
    # with fault null, and the app then drops its whole month, miles
    # included, from every at-fault number). This comes after the narrative
    # reviews above, which a release's fault batch does not wait on: the
    # batch reads these filings from the newest snapshot, which this run has
    # saved (unrated_reports()).
    unrated = unrated_reports(
        (entry["_row"] for entry in window_by_incident.values()),
        vmt_months, fault_ids)
    must(not unrated,
         "in-scope incidents with no data/faultfrac.csv row (rate each under "
         "the fault criterion and add its row; slurp.unrated_reports() lists "
         "their filings from the newest snapshot: data/README.md, Each NHTSA "
         "release, step 5)",
         count=len(unrated), reports=[r["Report ID"] for r in unrated])

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
    check_series_have_vmt(incidents, vmt_values)
    inc_cov = incident_coverage(
        window_rows, last_month, last_month_coverage[0], vmt_values)
    must(not set(inc_cov) & set(lag_coverage),
         "a helmer-month has both the pooled and the Monthly-lag coverage",
         both=sorted(set(inc_cov) & set(lag_coverage)))
    inc_cov = {**inc_cov, **lag_coverage}

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(incidents, indent=2) + "\n"
    vmt_text = build_vmt_csv(
        vmt_raw, inc_cov, coverage_by_month, vmt_months,
    ).replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    vmt_template = "\n`" + js_template_literal(vmt_text) + "\n`\n"
    ghost_template = "\n`" + js_template_literal(ghost_text) + "\n`\n"

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
    vmt_js = inject(vmt_js,
                    "/* GHOST_VMT_CSV_START */", "/* GHOST_VMT_CSV_END */",
                    ghost_template)
    # Every check has passed: write data/faultfrac.csv's mirrored columns
    # (sync_fault_csvs re-runs the coverage check build_fault_master_rows
    # passed above, on the same file), then the two .js files.
    sync_fault_csvs(fault_master_rows)
    with open(INCIDENT_JS, "w") as f:
        f.write(inc_js)
    with open(VMT_JS, "w") as f:
        f.write(vmt_js)

    # Summary
    counts = Counter(r["helmer"] for r in incidents)
    total = len(incidents)
    print(f"NHTSA file last modified: {nhtsa_modified_date}")
    print(f"NHTSA incident data through: {NHTSA_DATA_THROUGH_DATE}")
    ghost_months = sorted({r[1] for r in csv.reader(io.StringIO(ghost_text))} - {"month"})
    print(f"Ghost months (VMT drawn faded, in no rate): {', '.join(ghost_months)}")
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
        # (PAX_CLASS; both no-passenger encodings count as no passenger).
        classes = Counter(PAX_CLASS[r["belted"]] for r in co_incidents)
        with_pax, no_pax = classes["present"], classes["none"]
        unk = n - with_pax - no_pax
        pct = f"{100*with_pax/n:.0f}%" if n else "n/a"
        print(f"  {helmer}: {with_pax}/{n} with passenger ({pct})"
              f"  [no passenger: {no_pax}, unknown: {unk}]")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Slurp live NHTSA SGO crash data into inline data for the web tool.

Fetches current + archive ADS incident CSVs from NHTSA, and its current ADAS
and OTHER CSVs for the reports an ADS drove that NHTSA filed there
(MISFILED_ADS_REPORTS), deduplicates by
Report ID (keeping the highest Report Version), keeps the crashes in which
each helmer's ADS was driving in a mode whose miles are in its VMT
denominator (PUBLIC_SERVICE_OPERATOR_TYPES / EXCLUDED_OPERATOR_TYPES,
OPERATOR_TYPE_OVERRIDE, TELEOP_DRIVEN_REPORTS, and the narrative tripwires
beside them), keeps one report per Same Incident ID (a reviewed table says
which when two are filed: SUPERSEDED_REPORTS, SPLIT_SAME_INCIDENT_REPORTS),
adds a record for the second AV of each crash one report files for two of a
helmer's AVs (SECOND_INVOLVEMENTS), reads beside NHTSA's files the reports a
company has published that NHTSA's files do not hold yet (preprints:
PREPRINT_LIST),
joins in the in-repo VMT master (data/vmt.csv) and fault inputs
(data/faultfrac.csv), and injects the data into data/incidents.js and
data/vmt.js (between marker comments). A line's month enters the rates only
when NHTSA's file is complete for it or the company's own dated list covers
it; every other month at or before NHTSA's data-through month is pending: its
VMT row goes with the ghost months in data/vmt.js's second segment and its
incidents in data/incidents.js's second array, which nothing counts
(month_sources(), record_counted()). Every check runs before any of
data/incidents.js, data/vmt.js and data/faultfrac.csv is written, so a run
that stops writes only the NHTSA snapshots it fetched (data/README.md, Each
NHTSA release). After main(), a run saves Robotaxi Tracker's camera table
(camera_table_step(), which asks the person at the terminal first); a stop
there comes after main() has written those three files, and leaves only the
camera table unsaved.
"""

import csv
import datetime
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree
import zipfile
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
# NHTSA's two other current SGO files: Level 2 (ADAS) reports, and reports
# whose automation system was not reported ("OTHER"). NHTSA files each report
# by its latest version's "Automation System Engaged?" (ADS, ADAS or
# Unknown; NHTSA's SGO page, https://www.nhtsa.gov/laws-regulations/
# standing-general-order-crash-reporting, read 2026-10-31: "For some
# incidents, the type of automation system engaged at the time of the
# incident (ADS or Level 2 ADAS) was not reported and data for those
# incidents are listed in the Other data file"; "When multiple versions of a
# report exist from a specific entity, the values from the latest report are
# used"), so a crash an ADS drove lands outside the ADS file when its company
# codes that field wrong. slurp fetches and snapshots both with the ADS files
# and reads from them only the reports MISFILED_ADS_REPORTS lists
# (misfiled_ads_rows(); decision of 2026-10-31, open question 1). Their
# archives (2021-2025, closed since JUN-2025) are not read: a 2026-10-31 sweep
# of them found no report a Waymo, Tesla or Zoox ADS drove.
NHTSA_ADAS_CSV_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/"
    "SGO-2021-01_Incident_Reports_ADAS.csv"
)
NHTSA_OTHER_CSV_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/"
    "SGO-2021-01_Incident_Reports_OTHER.csv"
)
# Preprints (2026-11-18; the human: "can we add the new incidents, style them
# in a clear way to show they're not official yet, and incorporate them in a
# fully principled way?"). A preprint is a crash report as its company has
# published it, for a report NHTSA's files do not hold yet. Tesla's robotaxi
# safety page (tesla.com/robotaxi/safety, "Download all SGO reportable
# events") links a spreadsheet of every collision it reported to NHTSA "while
# Robotaxi is driving autonomously with no safety monitor in the vehicle,
# including when a remote operator is assisting or has taken control", under
# NHTSA's Report IDs: the list. data/snapshots holds the file as Tesla serves
# it, named for the date the list runs through (tesla-list-YYYYMMDD.xlsx;
# data/README.md, Each NHTSA release, step 7, says how to refresh it). slurp
# reads it beside NHTSA's files (list_rows() maps its rows onto NHTSA's
# columns): a row whose report NHTSA's files hold is dropped, NHTSA's row
# standing, and the rest are the preprints (preprint_rows()). A preprint goes
# through every check an NHTSA row does and its record in data/incidents.js
# carries `preprint: true`; at the release that publishes its report, NHTSA's
# row takes its place with no further code. The Monthly-report arrival
# counts read NHTSA's rows only. quals/preprints.qual.mjs holds the list
# to its record against NHTSA: every list row NHTSA has published agrees with
# one of that report's filed versions (24 of 24 on 2026-11-18).
#   entity   the company, as NHTSA's Reporting Entity names it
#   prefix   its snapshots' prefix in data/snapshots
#   url      where Tesla serves the file (the page that links it answers 403
#            to a script; this address does not)
#   through  the date the list runs through (the safety page's "As of")
#   miles    the company's no-monitor miles of that date's month through that
#            date, the exposure the list's crashes of that month belong to
#            (preprint_coverage()): Oct 1-18, 2026 on Tesla's safety page, the
#            measured part of data/vmt.csv's teslanomonitor 2026-10 row
PREPRINT_LIST = {
    "entity": "Tesla, Inc.",
    "prefix": "tesla-list",
    "url": "https://digitalassets.tesla.com/tesla-contents/raw/upload/"
           "Robotaxi-SGO-Report_10_18_2026.xlsx",
    "through": "2026-10-18",
    "miles": 1179333,
}
# What a list row carries where an NHTSA row carries its filing's type,
# version and operator type, none of which the list gives. The type marks the
# row as a preprint (no REPORT_TRACK entry: a preprint has no place in the
# counts of NHTSA's arrivals). The version is the report's first: NHTSA's row
# replaces a list row whatever its version (preprint_rows()). The operator
# type is the list's own definition, no safety monitor in the vehicle; a
# remote operator who drove is named in the narrative, which
# check_teleop_classified() reads.
PREPRINT_REPORT_TYPE = "Preprint"
PREPRINT_REPORT_VERSION = "1"
PREPRINT_OPERATOR_TYPE = "None"
# Robotaxi Tracker's Camera watch (https://robotaxitracker.com/cameras; credit
# Robotaxi Tracker, https://robotaxitracker.com, by name with a link and the
# visible address, as its llms.txt asks): Cybercabs, and other companies'
# cars, per 1,000 vehicles on Austin's public traffic cameras each UTC day.
# Tesla's miles for the days its own safety page has not measured rest on the
# daily Cybercab rate (quals/tesla-camera-miles.qual.mjs; data/README.md,
# Ghost months). The site's terms forbid scraping and its robots.txt
# automated harvesting, so no script fetches it (AGENTS.md's standing rule):
# a person copies the page's "Show data" table from a browser, and at the end
# of a run in a terminal camera_table_step() asks that person, opens the page
# in their own browser once they press Enter, reads the copy from the
# clipboard and saves it in data/snapshots, named for the local date it was
# saved (robotaxitracker-cameras-YYYYMMDD.tsv; the human, 2026-11-20: "can you
# remember to prompt me with that command line? actually can we make it part
# of slurp.py?", the tables published with the repo by the human's choice).
# camera_table_days() reads a table, stopping on any text that is not one, and
# camera_week_means() averages its whole weeks; the quals read the newest
# saved table through both (quals/camera-table.mjs).
#   url          the page, which the step opens and nothing here fetches
#   prefix       the saved tables' prefix in data/snapshots
#   instruction  what the person does on the page (as the command line the
#                human ran on 2026-11-20 printed it)
#   header       the table's first line: its columns, tab-separated
#   caption      its last line, after the days
#   dash         a day's value before its column's detector started
#   rate         the column Tesla's estimate reads
#   locale       the locale pbpaste reads the clipboard in (its output's
#                encoding follows the locale; the tables are UTF-8)
#   weekdays, months  the names in a day's label ("Thu, Nov 19 (UTC)")
CAMERA_TABLE = {
    "url": "https://robotaxitracker.com/cameras",
    "prefix": "robotaxitracker-cameras",
    "instruction": 'Press "Show data" under "Over time", select the table, Cmd-C, then press Enter here.',
    "header": ("Day (UTC)", "Waymo", "Cybercab", "Robotaxi Model Y (est.)", "Zoox", "Avride"),
    "caption": "A line starts the day its detector did.",
    "dash": "\u2014",   # an em dash
    "rate": "Cybercab",
    "locale": "en_US.UTF-8",
    "weekdays": ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"),
    "months": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
}
# NHTSA's canonical SGO page labels each release "through <date>": reports
# RECEIVED through that date, which is the 15th of the month before the
# release rolled forward to the next business day when the 15th falls on a
# weekend or federal holiday (NHTSA's data-dictionary change log, Table 1 of
# https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Data_Element_Definitions.pdf,
# republished with each release and fetchable by script: "11/16/2026 Data
# release of reports received through October 15, 2026"; "10/15/2026 Data
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
NHTSA_DATA_THROUGH_DATE = "2026-10-15"
# Which months count (2026-11-21; the human, on the partly reported newest
# month: "maximum conservativeness, don't show things when they involve
# arbitrary guesses", and, restated: "if we know when a helmer's crash reports
# end then we compute the exact VMT for the crashes. if not, we don't try to
# guess."). Reports received through the cutoff cover only crashes from the
# first part of the data-through month (the five-day clock runs from the
# company's notice, plus NHTSA processing, and Monthly reports are due the
# 15th of the next month), so that month is only partly reported. A line's
# month at or before the data-through month T enters the rates (an analysis
# row of data/vmt.js, its incidents in INCIDENT_DATA) only when
#   (a) NHTSA's file is complete for the line's company and month: the month
#       is before T and outside the company's Monthly-report lag (month <=
#       T - 1 - MONTHLY_ARRIVAL_LAG[company]); or
#   (b) the company's own dated list covers it (PREPRINT_LIST: each line of
#       the list's company, in the list's month): the list's crashes through
#       its date, over the list's miles (preprint_coverage()).
# Every other line-month at or before T is PENDING (a provisional name: its
# reports are still arriving): its data/vmt.csv row goes with the ghost
# months in data/vmt.js's second segment, which the page draws faded and no
# rate uses, and its in-scope incidents go, checked and rated as counted ones
# are, in data/incidents.js's second array, PENDING_INCIDENT_DATA, which the
# incident browser lists and nothing counts. So do the crashes of a
# list-covered month that the list lacks: only crashes inside a known span
# count (month_sources(), record_counted()).
#
# (a) rests on two premises about when a month's reports reach NHTSA's file.
# A month's five-day-track reports are complete at the release after its
# first, measured across every release snapshot (the five-day-track count of
# a month at its first release, then at every later one: Dec 2025 13->55
# then flat; Jan 2026 21->63 then flat; Feb 19->38 then flat x6; Apr 3->58
# flat; May 16->58 flat; Jun 17->61 flat; Jul 12->58 flat; Aug 10->48 flat;
# Sep 7->61; Mar ran 25->53->72 because its second release was the truncated
# May-15-2026 one). And its Monthly-track reports, due the 15th of the next
# month, arrive by that same release unless the company's lag says otherwise
# (below).
#
# Until 2026-11-21 the data-through month counted too, at an estimated share
# of its miles: the share of its five-day-track incidents the release held
# (observed over the count expected at each company's rate in an earlier
# month; before 2026-10-31 the median of earlier months' first-release
# shares), and for Monthly-track metrics the share of its incidents of every
# kind, with ranges (FIVE_DAY_RECEIPT_OBSERVATIONS, FIVE_DAY_RECEIPT_COVERAGE_MAX,
# release_month_coverage(), incident_coverage()); and a lagged company's
# lagged months counted at its five-day share of incidents
# (FIVE_DAY_SHARE_OBSERVATIONS). Over nine first releases what eventually
# arrived ran from 0.70 to 1.68 times the five-day share's estimate (AGENTS.md
# ledger, 2026-11-20 (later 6)), and the human dropped the estimate.
#
# Monthly-track report arrival, per helmer (measured since 2026-10-03). SGO
# Request No. 2 (Monthly) reports for incident month M are due by the 15th of
# M+1, so they normally reach the public file at the release whose
# data-through month is M+1 (M's second release), and from then on M is
# complete. A helmer whose Monthly reports land later leaves months that look
# complete but are not: every in-scope Zoox Monthly-track report of
# January-July 2026 reached the file one release late, so the Sep-15-2026
# file held only Zoox's one July 5-Day report (30610-15722).
# MONTHLY_ARRIVAL_LAG is each helmer's extra lag, in releases: the months
# inside it (the ones just before the data-through month) are pending for
# that helmer's lines, as the data-through month is.
#
# MONTHLY_ARRIVAL_OBSERVATIONS: for each helmer and incident month M, its
# in-scope Monthly-track incidents (deduplicated as main() does, in the newest
# file; an incident's track is its crash's first filing's Report Type,
# REPORT_TRACK)
# counted by the release at which that report first appeared, as (by the
# release whose data-through month is M+1, one release later, ...). Measured
# from data/snapshots history; a month enters at the release whose
# data-through month is M+2, when an arrival one release late is visible
# (check_monthly_arrivals() requires it then). A lagged helmer's lagged month
# that already holds a Monthly-track report enters one release early, at M+1,
# with its on-time count (check_monthly_arrivals() stops until it does), and is
# re-measured at M+2 like any other month, when its row takes its second
# count, the reports that arrived a release late, a 0 included
# (check_monthly_arrivals() stops on a row still on-time-only then, since
# 2026-11-21, and on a second count entered before then): 2026-08 entered so on the
# Oct-15-2026 release, which already held Tesla's 7 and Zoox's 3 in-scope
# August Monthly reports (and Waymo's 20). Re-measured on the Nov-16-2026
# release, August gained 23 Waymo reports a release late (22 submitted
# SEP-2026, one OCT-2026) and Tesla's 13781-17193 (submitted OCT-2026); and
# 2026-09 entered early in turn, because Waymo's August (20 on time, 23 late)
# reads as a lag of 1 by the majority rule below while September already held
# 62 Waymo Monthly-track reports (Tesla 3, Zoox 10). The recipe and its independent
# recompute are in quals/monthly-arrival-lag.qual.mjs; re-measure on each
# release. Measurable from Dec 2025 (the
# oldest snapshot release holds data through Dec 2025), where Zoox's two
# Monthly reports (30610-13660, -13661) arrived on time: the late pattern
# holds for every 2026 month, and the table starts there. The table also
# gives the list's allowance: the share of the list's company's Monthly
# reports that arrived on time, over the months with both counts
# (preprint_coverage()).
MONTHLY_ARRIVAL_OBSERVATIONS = {
    "Waymo": {"2026-01": (30, 0), "2026-02": (34, 1), "2026-04": (53, 1),
              "2026-05": (42, 0), "2026-06": (46, 0), "2026-07": (31, 0),
              "2026-08": (20, 23), "2026-09": (62,)},
    "Tesla": {"2026-01": (4, 0), "2026-02": (0, 0), "2026-04": (1, 0),
              "2026-05": (2, 0), "2026-06": (2, 0), "2026-07": (1, 1),
              "2026-08": (7, 1), "2026-09": (3,)},
    "Zoox": {"2026-01": (0, 0), "2026-02": (0, 3), "2026-04": (0, 3),
             "2026-05": (0, 0), "2026-06": (0, 2), "2026-07": (0, 2),
             "2026-08": (3, 0), "2026-09": (10,)},
}
# Months whose arrivals cannot be measured, with the reason; every other month
# from the first observation on must be observed (check_monthly_arrivals()).
MONTHLY_ARRIVAL_MONTHS_EXCLUDED = {
    "2026-03": "its second release (May 15, 2026) was truncated, so its "
               "Monthly reports reached the file one release late for "
               "Waymo too (all 44 in scope in the ADS file; the 45th, "
               "30270-14303, is in NHTSA's ADAS file, MISFILED_ADS_REPORTS, "
               "which data/snapshots holds only from the Oct-15-2026 release; "
               "Tesla 2 of 2 on time, Zoox 0 of 2)",
}
# Each helmer's lag is the extra lag of the majority of its newest observed
# month with any Monthly-track incident (ties count as late), which
# check_monthly_arrivals() checks. Zoox's was 1 from 2026-10-03 until the
# Oct-15-2026 release, where its August reports arrived on time; there
# Tesla's July tie (13781-16255 on time; 13781-16294, submitted in August,
# first in the Oct-15-2026 file) would have made Tesla's 1 too, but seven
# August reports of its own had arrived on time as well (an eighth,
# 13781-17193, came a release late). On the Nov-16-2026 release Waymo's
# August (20 on time, 23 a release late: the first Waymo month with more than
# one late report) would have made Waymo's 1, but September's 62 Monthly-track
# reports, more than any month's total since June 2025 (April 2026's 54 the
# most), had arrived, so every lag stays 0. A month whose Monthly reports
# arrive partly late has no model here: the lag is all or nothing, and
# Waymo's August was counted 23 incidents short of its 89 for one release
# (AGENTS.md, open question 36).
MONTHLY_ARRIVAL_LAG = {"Waymo": 0, "Tesla": 0, "Zoox": 0}
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
# the vehicles, so each entry is (the count, the narrative's words that give
# it, verbatim): those words are what the review read, and
# check_reviewed_quotes() stops the run when the report's latest filing no
# longer holds them, so a re-filing is re-counted (since 2026-11-02, open
# question 26(c); until then an entry was a bare count with nothing to
# re-check, unlike the severity, airbag and location overrides). Where the
# narrative does not number the vehicles, the words are a run of it that names
# each of them, and the AV, where they leave it out, is one more.
# Default is 2 (the AV + one crash partner). Only the
# fatality metric reads this field (fractional-death divisor) and
# fatality-guard.qual forces a human count for each new fatality; the
# narrative-verified nonfatal counts below are data hygiene so the field is
# true where narratives are explicit (2026-08-22 audit inventory).
VEHICLES_INVOLVED = {
    # Waymo JAN-2025 SF fatality (report 30270-9724): chain collision — AV +
    # car stopped behind it + speeding SUV + a fourth car the AV rotated into,
    # plus "at least two other vehicles" per SFPD ("five passengers in four of
    # the vehicles" injured) = 6 vehicles: the three with severe damage and
    # "the other three vehicles". The narrative's count is a floor ("at
    # least"): firefighters, by CBS San Francisco, KTVU and ABC7, counted 7,
    # as Koopman does. The 6 stays (the human, 2026-11-21): no count is taken
    # from outside NHTSA's data, since outside reporting reaches some crashes
    # more than others (audit finding A13 of 2026-11-20).
    "30270-9724": (6, "The Waymo AV, the passenger vehicle behind the Waymo "
                      "AV, and the SUV sustained severe damage. The extent of "
                      "the damage to the other three vehicles is currently "
                      "unknown."),
    # Waymo SEP-2025 Tempe fatality: AV + motorcycle + hit-and-run passenger car
    "30270-11713": (3, "The Waymo AV and the motorcycle sustained damage. The "
                       "extent of the damage to the passenger car that left "
                       "the scene is unknown at this time."),
    # Waymo AUG-2026 Dallas fatality: AV + the SUV that struck the pedestrian
    # (the decedent, not a vehicle) = 2, the default, an entry so that a
    # re-filing that changes the count is re-read (since 2026-11-02)
    "30270-16196": (2, 'a Waymo Autonomous Vehicle ("Waymo AV") operating in '
                       'Dallas, Texas was in a collision involving a '
                       'pedestrian and an SUV'),
    # Batch below added 2026-08-22 (human-approved hygiene): narrative-verified
    # 3+-vehicle counts for NONFATAL incidents from the audit inventory (e.g.
    # "All three vehicles sustained damage"). Zero displayed-number change by
    # construction — only the fatality metric reads this field — recorded so
    # the field is true where the narrative is explicit. Six bystander/
    # no-AV-contact rows with murky involvement semantics keep the default.
    "30270-6579": (3, "All three vehicles sustained damage"),
    "30270-8968": (3, "All three vehicles sustained damage"),
    # both Waymo AVs (the second, 30270-13817-B) and the two passenger cars
    "30270-13817": (4, "both Waymo AVs' Level 4 ADS were engaged in "
                       "autonomous mode. The two passenger cars and the "
                       "initial Waymo AV (VIN [XXX]) sustained damage."),
    # the two passenger cars, the SUV, the Waymo AV and the heavy truck
    "30270-13955": (5, "The second passenger car continued forward and made "
                       "contact with an SUV stopped in the queue of traffic "
                       "in the second from the left lane. As a result of the "
                       "initial contact with the second passenger car, the "
                       "first passenger car was pushed east across two lanes "
                       "of travel, and entered the Waymo AV's lane of travel. "
                       "The Waymo AV slowed and maneuvered to the right to "
                       "avoid the oncoming passenger car and the front left "
                       "side of the passenger car made contact with the left "
                       "side of the Waymo AV. The Waymo AV rotated to the "
                       "left and came to rest facing southwest in the second "
                       "and third from the left lanes. During two subsequent "
                       "maneuvers in which the Waymo AV pulled forward and to "
                       "the right in an attempt to navigate off the freeway, "
                       "the front left corner of the Waymo AV made contact "
                       "with an \"Oversized Load\" sign attached to a heavy "
                       "truck"),
    "30270-14986": (5, "All five vehicles sustained damage"),
    "30270-15301": (4, "the front right of the SUV made contact with the rear "
                       "of the motorcycle, and the front left of the SUV made "
                       "contact with the right side of a passenger car that "
                       "was stopped behind the Waymo AV."),
    "30270-13605": (3, "All three vehicles sustained damage"),
    "30270-13192": (3, "All three vehicles sustained damage"),
    "30270-15246": (3, "All three vehicles sustained damage"),
    "30270-15192": (4, "Both passenger cars and the SUV sustained damage."),
    "30270-11791": (3, "The Waymo AV, the first passenger car, and the second "
                       "passenger car sustained damage."),
    "30270-14708": (3, "The two passenger cars sustained damage."),
    "30270-10695": (4, "The front of an SUV traveling directly behind the "
                       "Waymo AV then made contact with the right rear of the "
                       "stationary Waymo AV. A passenger car then braked to a "
                       "stop behind the Waymo and to the left of the SUV. A "
                       "second passenger car then made contact with the SUV "
                       "and the first passenger car."),
    "30270-9060": (3, "All three vehicles sustained damage"),
    "30270-13399": (3, "All three vehicles sustained damage"),
    "30270-13877": (3, "All three vehicles sustained damage"),
    "30270-5997": (3, "a passenger vehicle behind the Waymo made contact with "
                      "the rear of the Waymo AV. Moments later, an SUV behind "
                      "the passenger vehicle made contact with the rear of "
                      "the passenger vehicle."),
    "30270-6906": (3, "All three involved vehicles sustained damage"),
    "30270-9761": (4, "A motorcycle was stopped behind the Waymo AV, and a "
                      "pickup truck was stopped behind the motorcycle. A "
                      "passenger car approached the queue of stopped traffic "
                      "from behind and made contact with the stopped pickup "
                      "truck"),
    "30270-13195": (3, "All three vehicles sustained damage"),
    "30270-13585": (3, "All three vehicles sustained damage"),
    "30270-14265": (3, "All three vehicles sustained damage"),
    "30270-15105": (3, "All three vehicles sustained damage"),
    "30270-7158": (4, "The three other vehicles sustained damage, but the "
                      "Waymo AV did not."),
    "30270-8620": (3, "The SUV following behind the Waymo AV slowed as it "
                      "approached the queue of traffic, when it was rear "
                      "ended by a pickup truck following behind the SUV that "
                      "did not stop."),
    "30270-8927": (3, "All three vehicles sustained damage"),
    "30270-8982": (3, "All three vehicles sustained damage"),
    "30270-9214": (3, "All three vehicles sustained damage"),
    "30270-9791": (3, "The front left side of the passenger car that had been "
                      "behind the Waymo AV made contact with the right side "
                      "of the other passenger car and then made contact with "
                      "the left part of the rear of the stationary Waymo AV."),
    "30270-9806": (3, "The Waymo AV sustained damage from the wheel "
                      "separation. The passenger car and the motorcycle "
                      "sustained damage from contact with the separated wheel."),
    "30270-10360": (3, "All three vehicles sustained damage"),
    "30270-10833": (3, "While the Waymo AV and the passenger car remained "
                       "stopped, a second passenger car traveling southbound "
                       "on [XXX] approached the passenger car from behind"),
    "30270-10899": (3, "The Waymo AV was parked on the curb on [XXX] facing "
                       "southwest with a pickup truck parked directly behind. "
                       "A pickup truck traveling southeast on [XXX] made a "
                       "right turn onto [XXX] and the front of the pickup "
                       "truck made contact with the rear driver side of the "
                       "parked pickup truck"),
    "30270-11874": (3, "All three vehicles sustained damage"),
    "30270-11929": (3, "The Waymo AV, the first passenger car, and the second "
                       "passenger car sustained damage."),
    "30270-13064": (4, "The front right side of the Waymo AV then made "
                       "contact with the front right side of an SUV that was "
                       "stopped facing southeast on [XXX], and the front "
                       "right side of the passenger car made contact with the "
                       "rear left side of a pickup truck stopped facing "
                       "southwest at the north curb of [XXX]."),
    "30270-13092": (3, "All three vehicles sustained damage"),
    "30270-13303": (3, "All three vehicles sustained damage"),
    "30270-13369": (3, "All three vehicles sustained damage"),
    "30270-13575": (3, "All three vehicles sustained damage"),
    "30270-13860": (3, "All three vehicles sustained damage"),
    "30270-13949": (3, "All three vehicles sustained damage"),
    "30270-13985": (3, "All three vehicles sustained damage"),
    "30270-13998": (3, "All three vehicles sustained damage"),
    "30270-14271": (3, "All three vehicles sustained damage"),
    "30270-14383": (3, "All three vehicles sustained damage"),
    "30270-14586": (3, "All three vehicles sustained damage"),
    "30270-14804": (3, "All three vehicles sustained damage"),
    "30270-14905": (3, "All three vehicles sustained damage"),
    "30270-14944": (3, "All three vehicles sustained damage"),
    "30270-15106": (3, "a passenger car traveling westbound in the left lane "
                       "on [XXX] approached the Waymo AV from behind and "
                       "slowed, and a second passenger car traveling "
                       "westbound in the left lane on [XXX] approached the "
                       "slowing passenger car from behind"),
    "30270-15251": (3, "All three vehicles sustained damage"),
    "30270-15346": (3, "All three vehicles sustained damage"),
    "30270-15393": (3, "All three vehicles sustained damage"),
    "30270-15659": (3, "All three vehicles sustained damage"),
    "30270-15723": (3, "All three vehicles sustained damage"),
    # Batch below added 2026-10-31 (decision of that day on open question 11,
    # "(b)"): the nonfatal Jul-Aug 2026 reports whose narratives count their
    # vehicles; the six murky bystander rows of 2026-08-22 keep the default
    # (quals/vehicles-involved.qual.mjs).
    "30270-15832": (3, "All three vehicles involved sustained damage"),
    "30270-15894": (3, "All three vehicles sustained damage"),
    "30270-16165": (3, "All three vehicles involved sustained damage"),
    "30270-16202": (3, "All three vehicles sustained damage"),
    "30270-16261": (3, "All three vehicles sustained damage"),
    "30270-16278": (4, "All four vehicles involved sustained damage"),
    "30270-16300": (4, "All four vehicles sustained damage"),
    "30270-16325": (3, "All three vehicles sustained damage"),
    "30270-16345": (3, "All three vehicles involved sustained damage"),
    "30270-16452": (3, "all three vehicles involved sustained damage"),
    "30270-16493": (3, "All three vehicles sustained damage"),
    # The Nov-16-2026 release's narratives that count their vehicles.
    "30270-16708": (3, "All three vehicles sustained damage"),
    "30270-16803": (3, "All three vehicles involved sustained damage"),
    "30270-17027": (3, "All three vehicles sustained damage"),
    "30270-17066": (3, "All three vehicles involved sustained damage"),
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
# The sources are NHTSA's field and the report's own narrative, for every
# company (the human, 2026-11-21: "consistently respect the NHTSA data"): a
# company's own published crash list is not one (data/README.md, pipeline
# step 9, has the comparison with Waymo's). And a hospital transport the
# narrative states counts whatever its cause (30270-8940, below).
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
    # Batch below added 2026-11-16 (Nov-16 NHTSA release), same convention.
    # Zoox moving slowly after a fresh green, rear-ended by a fast SUV; "The
    # driver of Vehicle 2 was transported by ambulance from the scene"
    "30610-16953": ("Unknown", "Minor W/ Hospitalization"),
    # Waymo slowed on a freeway; a pickup two cars back swerved to the shoulder
    # and hit the median barrier and another car (no contact with the Waymo);
    # no injuries mentioned
    "30270-16932": ("Unknown", "Property Damage. No Injured Reported"),
    # Waymo stopped at a stop sign, rear-ended by a pickup; "The passengers in
    # the Waymo AV were transported from the scene to a hospital"
    "30270-16736": ("Unknown", "Minor W/ Hospitalization"),
    # Added 2026-11-18 from Tesla's list (a preprint: PREPRINT_LIST), same
    # convention. Tesla stopped at a stop sign; an SUV hit by a crossing car
    # was pushed into it; "The driver of the passenger vehicle from the
    # original collision was transported to the hospital for unknown reason."
    "13781-17203": ("Unknown", "Minor W/ Hospitalization"),
    # Added 2026-10-03 (audit finding #44), the 2026-08-22 convention for an
    # affirmative field the narrative contradicts: Zoox 30610-15722 (JUL-2026
    # Austin), field "Property Damage. No Injured Reported"; rear-ended while
    # stopped, the passenger "reported feeling \"dazed\" and \"kind of woozy\"
    # and requested emergency services", no transport stated
    "30610-15722": ("Property Damage. No Injured Reported",
                    "Minor W/O Hospitalization"),
    # Added 2026-11-21 (audit finding A38 of 2026-11-20): Waymo 30270-8940
    # (OCT-2024, San Francisco), field "No Injuries Reported"; stopped in a
    # queue at a red light, crept into from behind by a passenger car;
    # "Law enforcement communicated to Waymo that the driver of the passenger
    # car was experiencing a medical emergency and was transported from the
    # scene in an ambulance". The rule (the human, 2026-11-21): a transport
    # the narrative states counts, whatever its cause, as the human benchmark
    # counts anyone transported (CRSS's transport codes); counting it applies
    # the page's one rule again, where leaving it out would add a second
    # rule, about why a person was taken. So the 2026-07-15 convention's
    # value for a stated transport, Minor W/ Hospitalization
    "30270-8940": ("No Injuries Reported", "Minor W/ Hospitalization"),
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
# Five more of West Hollywood's, by the same rule (added 2026-11-21, audit
# finding A39 of 2026-11-20): 30270-13369 (DEC-2025), -13556 and -13550
# (JAN-2026), -14586 (APR-2026) and -15285 (MAY-2026), each filed "Los
# Angeles" under a narrative that opens "operating in West Hollywood,
# California" (re-read at this build); the audit read the hub's address for
# each in West Hollywood, zip 90046 (the hub was not re-read at this build,
# which ran without the network).
LOCATION_OVERRIDE = {
    "30270-7054": (("Phoenix", "CA"), ("Phoenix", "AZ")),
    "30270-11302": (("", ""), ("Los Angeles", "CA")),
    "30270-13811": (("San Francisco", "CA"), ("Daly City", "CA")),
    "30270-15662": (("Miami", "FL"), ("North Miami", "FL")),
    "30270-10112": (("Phoenix", "AZ"), ("Chandler", "AZ")),
    "30270-10141": (("Phoenix", "AZ"), ("Tempe", "AZ")),
    "30270-9763": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
    "30270-13369": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
    "30270-13556": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
    "30270-13550": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
    "30270-14586": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
    "30270-15285": (("Los Angeles", "CA"), ("West Hollywood", "CA")),
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
    # 30270-17130 (OCT-2026, Austin; added 2026-11-21, audit finding A7 of
    # 2026-11-20): "Waymo is reporting this crash under Request No. 1 of
    # Standing General Order 2021-01 because a vehicle involved was towed away
    # and because of airbag deployment"; the column marks no deployment in
    # either vehicle. The same sentence as 30270-9767's, a two-vehicle crash too
    "30270-17130": ("No Subject Vehicle, No Crash Partner", True),
}
# The airbag tripwire (2026-11-21, audit finding A7): an in-scope incident
# whose narrative mentions an airbag while its filed "Any Air Bags Deployed?"
# marks no deployment (it holds no "Yes") stops the run
# (check_airbag_classified()) until a human reads it: an AIRBAG_OVERRIDE entry
# if the narrative says an airbag deployed, in any vehicle, else an entry
# below with the narrative's words that show the filed value stands. Until
# then nothing read a new narrative for this: 30270-17130 came in with
# 30270-9767's sentence and was stored with no airbag. The sources stay
# NHTSA's field and the report's own narrative, for every company (the human,
# 2026-11-21). Calibrated 2026-11-21 on every filing of an in-scope report in
# every file of data/snapshots (3,077 distinct filings, 2,546 versions of
# 2,392 reports) and on the 32 rows of Tesla's list: the corpus writes
# "airbag", "airbags" and "air bags" (191 times over every company's
# narratives); 52 in-scope versions of 47 reports mention one, and the field
# marks a deployment in every mentioning version of 38 of those reports. The
# other nine are the six AIRBAG_OVERRIDE reports, the two below, and
# 13781-11459, whose v3 carries the same correction as 13781-11687's and which
# is out of every metric (TELEOP_DRIVEN_REPORTS), so its record is never
# written and the tripwire never reads it. Of the 2,394 in-scope incidents a
# run writes today (their latest filings, the preprints among them), 47
# mention an airbag and the field marks a deployment on 39; the list's one
# mention, 13781-17203's, is marked.
AIRBAG_PATTERN = re.compile(r"air\s*-?\s*bag", re.I)
# In-scope reports whose narrative mentions an airbag while the filed value
# marks no deployment, and whose filed value stands, keyed by Report ID with
# the narrative's words that show why, verbatim; check_reviewed_quotes() stops
# the run when the report's latest filing no longer holds the words.
AIRBAG_LANGUAGE_REVIEWED = {
    # Tesla's v3 filing (MAR-2026) takes back the airbag and tow flags its v2
    # had set in error
    "13781-11687": "This is in error and the reports were updated to reflect "
                   "that no airbags were deployed",
    # Waymo slowed on a freeway and two vehicles behind it collided (no
    # contact with the Waymo); the field is Unknown and the narrative knows no
    # more, so no deployment is counted
    "30270-16932": "Airbag deployment and tow status are unknown for both "
                   "vehicles.",
}

# Reviewed passenger codes, keyed by Report ID: (the filed "Were All
# Passengers Belted?" value the review read, the value to store), for reports
# whose filed code disagrees with their own narrative about whether anyone was
# aboard (the sanity section's Passenger presence table counts riders, as
# against deadhead). check_passenger_reviews() must()s that each filed value
# is the one its entry was reviewed against (a re-filing, or NHTSA's row
# taking a preprint's place, stops the run for a re-read, one stop listing
# every such entry), and check_passengers_reviewed() that every entry is an
# in-scope report.
#
# Tesla files its in-car safety monitor as a passenger: a ride with only the
# monitor aboard carries "Subject Vehicle - All Belted" (or "Unknown"), so the
# field cannot tell a rider from the monitor, and Passenger presence read
# 61-87% for Tesla where the narratives give 8 of 23. Tesla's narratives say
# whether a passenger (since August 2026 also "rider") was aboard, so EVERY
# in-scope Tesla report carries an entry (added 2026-10-03, audit finding
# #10), and check_passengers_reviewed() stops the run on a Tesla report
# without one until its narrative is read. Not every Tesla narrative does:
# 13781-16941's (on Tesla's Oct-18-2026 list; in NHTSA's file since its Nov
# 16, 2026 release, filed no passenger) says nothing about who was aboard, and
# such a report is stored as (filed code, "Unknown") (audit 2026-10-30, R3;
# the human, 2026-11-02, open question 18).
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
    # Waymo, SEP-2026 Austin, filed no passenger (added 2026-11-21, audit
    # finding A40 of 2026-11-20): stopped for a dropoff, clipped by a passing
    # pickup; "The passenger in the Waymo AV was not belted at the time of
    # the collision as they were preparing to exit the vehicle"
    "30270-16828": (PAX_NO, "Subject Vehicle - Not Belted - see Narrative"),
    # Tesla: every in-scope report (the monitor is not a passenger); a
    # narrative that says nothing about who was aboard is stored as
    # (filed code, "Unknown") (the human, 2026-11-02, open question 18)
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
    # Added 2026-11-16 (Nov-16 NHTSA release)
    "13781-16733": (PAX_NO, PAX_NO),       # "had no passengers present in the vehicle"
    "13781-16941": (PAX_NO, "Unknown"),    # the narrative does not say who was aboard
    "13781-17015": (PAX_BELTED, PAX_BELTED),  # "had two riders present in the vehicle"
    "13781-17178": (PAX_BELTED, PAX_BELTED),  # "had one rider present in the vehicle"
    "13781-17179": (PAX_BELTED, PAX_BELTED),  # "had one rider in the vehicle"
    "13781-17191": (PAX_NO, PAX_NO),       # "had no riders in the vehicle"
    "13781-17193": (PAX_NO, PAX_NO),       # "had no riders in the vehicle"
    # Added 2026-11-18: the preprints of Tesla's Oct-18-2026 list
    # (PREPRINT_LIST). The list has no belt field, so each entry's filed value
    # is blank; when NHTSA's file holds the report, its filed code stops the
    # run here for a re-read (data/README.md, Each NHTSA release, step 7).
    "13781-17203": ("", PAX_BELT_UNSTATED),  # "had one rider present in the vehicle"
    "13781-17299": ("", PAX_BELT_UNSTATED),  # "had two passengers in the vehicle"
    "13781-17300": ("", PAX_BELT_UNSTATED),  # "had three passengers in the vehicle"
    "13781-17301": ("", PAX_BELT_UNSTATED),  # "had two passengers in the vehicle"
    # "had two passengers in the vehicle. The right passenger was unbuckled"
    "13781-17302": ("", "Subject Vehicle - Not Belted - see Narrative"),
    "13781-17303": ("", PAX_NO),           # "had no passengers in the vehicle"
    "13781-17304": ("", PAX_NO),           # "had no passengers in the vehicle"
    "13781-17305": ("", PAX_NO),           # "There were no passengers in the vehicle"
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
# Widened 2026-11-21 (audit finding A40 of 2026-11-20) to a narrative that
# says a passenger was not belted, which puts one aboard: "not belted" (Waymo:
# "The passenger in the Waymo AV was not belted at the time of the
# collision"), "unbelted", "not wearing a seat belt". Calibrated on every
# filing of an in-scope Waymo or Zoox report in every file of data/snapshots
# (2,481 versions of 2,349 reports): 165 versions of 158 Waymo reports say
# so, each filed with a passenger code but 30270-16828 (filed no passenger:
# its PASSENGER_OVERRIDE entry), so the widened tripwire flags that report and
# 30610-15826 and no other. Other seat-belt wording (a passenger who
# "unbuckled their seatbelt shortly before the moment of impact", six
# reports; 177 reports use some seat-belt word) is filed with a passenger
# code everywhere too, and stays out of the pattern.
OCCUPANCY_PATTERN = re.compile(
    r"\b(?P<none>unoccupied\s+(?:Zoox|Waymo)|had\s+no\s+occupants)\b|"
    r"\b(?P<present>occupied\s+(?:Zoox|Waymo)|not\s+belted|unbelted|"
    r"not\s+wearing\s+(?:a\s+)?seat\s*-?\s*belts?)\b", re.I)
# In-scope reports whose narrative trips OCCUPANCY_PATTERN against their filed
# code but whose filed code stands, keyed by Report ID with the narrative's
# words that show why, verbatim, and the reason as a comment (none so far);
# check_reviewed_quotes() stops the run when the report's latest filing no
# longer holds the words (since 2026-11-02, open question 26(b)).
OCCUPANCY_LANGUAGE_REVIEWED = {}

# Crashes one report files for two of a helmer's AVs (decision #47, the
# human's answer of 2026-10-04, "Each AV involved"; added 2026-10-31): every AV
# involved counts once, like the crashed-vehicle human benchmarks and Waymo's
# own crash list (Safety Impact hub CSV2, https://waymo.com/safety/impact/,
# data through Jun 2026, read 2026-10-31, lists each report below twice but
# 30270-11224, which it lists once: counted since 2026-11-02, the human's
# answer to open question 19, since the benchmarks count crashed vehicles,
# each carrying the crash's outcome, so every AV a narrative shows struck
# counts). Two AVs that each filed a report
# (30270-16207 and -16174, Atlanta, AUG-2026) already counted twice. Keyed by
# Report ID: the narrative's words naming the second AV ("quote"), and that
# AV's own fields as the narrative gives them, under NHTSA's column names (a
# contact area as the tuple of its boxes, "Unknown" passengers where the
# narrative does not say; where the two AVs struck each other, the report's
# contact areas swapped).
# second_involvement_rows() makes the second AV's row: the report's latest
# filing with these fields and the Report ID + SECOND_INVOLVEMENT_SUFFIX; its
# record takes the crash's fields and their overrides (severity, airbag,
# place, vehicles involved) from the report, adds `secondOf` naming it, and
# needs its own data/faultfrac.csv row.
SECOND_INVOLVEMENT_SUFFIX = "-B"
SECOND_INVOLVEMENTS = {
    # FEB-2025 San Francisco: parked for its own dropoff beside the reporting
    # Waymo, whose passenger doored a cyclist passing between the two
    "30270-9987": {
        "quote": "The cyclist then fell into the passenger side of the second Waymo AV.",
        "SV Precrash Speed (MPH)": "0", "SV Pre-Crash Movement": "Parked",
        "CP Pre-Crash Movement": "Proceeding Straight",
        "Crash With": "Non-Motorist: Cyclist", "Were All Passengers Belted?": "Unknown",
        "SV Contact Area": ("Right",), "CP Contact Area": ()},
    # JUN-2025 Mesa: stopped in the street as the reporting Waymo passed to
    # its left, whose rider opened the front passenger door into this
    # Waymo's driver side mirror (both Waymos' ADS engaged, both damaged)
    "30270-11224": {
        "quote": "While the first Waymo AV was passing the stopped Waymo AV, the "
                 "passenger in the moving Waymo AV opened the front passenger "
                 "side door, which then made contact with the driver side mirror "
                 "of the stopped Waymo AV.",
        "SV Precrash Speed (MPH)": "0", "SV Pre-Crash Movement": "Stopped",
        "CP Pre-Crash Movement": "Passing",
        "Crash With": "SUV", "Were All Passengers Belted?": "Unknown",
        "SV Contact Area": ("Left",), "CP Contact Area": ("Front Right", "Right")},
    # JUL-2025 Phoenix (airport lot): reversing out of its stall, speed not
    # stated, when the reporting Waymo pulled forward into its right side
    "30270-11424": {
        "quote": "While the second Waymo AV was reversing, the initial Waymo AV "
                 "proceeded forward and the front left of the Waymo AV made "
                 "contact with the right side of the second Waymo AV.",
        "SV Precrash Speed (MPH)": "", "SV Pre-Crash Movement": "Backing",
        "CP Pre-Crash Movement": "Proceeding Straight",
        "Crash With": "SUV", "Were All Passengers Belted?": "Unknown",
        "SV Contact Area": ("Right",), "CP Contact Area": ("Front Left",)},
    # JAN-2026 Tempe: stopped in the red-light queue behind the reporting
    # Waymo; the red-runner careening off its first crash hit it (where on the
    # Waymo, not stated)
    "30270-13817": {
        "quote": "the left side of the passenger car then made contact with an "
                 "additional Waymo AV (VIN [XXX]) that was stopped behind the "
                 "initial Waymo AV in traffic.",
        "SV Precrash Speed (MPH)": "0", "SV Pre-Crash Movement": "Stopped",
        "CP Pre-Crash Movement": "Other, see Narrative",
        "Crash With": "Passenger Car", "Were All Passengers Belted?": "Unknown",
        "SV Contact Area": ("Unknown",), "CP Contact Area": ("Left",)},
    # MAY-2026 Phoenix: parked, partly in-lane with hazards on; its own
    # passenger opened its rear left door into the passing reporting Waymo
    "30270-14890": {
        "quote": "The front right side of the Waymo AV made contact with the "
                 "open rear left door of the Parked Waymo AV.",
        "SV Precrash Speed (MPH)": "0", "SV Pre-Crash Movement": "Parked",
        "CP Pre-Crash Movement": "Passing",
        "Crash With": "SUV", "Were All Passengers Belted?": PAX_BELT_UNSTATED,
        "SV Contact Area": ("Rear Left",), "CP Contact Area": ("Front Right",)},
    # JUN-2026 San Francisco: stopped, yielding behind the first collision,
    # when the driverless SUV rolled backwards into its front left
    "30270-15346": {
        "quote": "the rear right side of the SUV made contact with the front "
                 "left side of a second stationary Waymo AV ([XXX]) that was "
                 "facing south, yielded in-lane behind the initial collision "
                 "with the first Waymo AV.",
        "SV Precrash Speed (MPH)": "0", "SV Pre-Crash Movement": "Stopped",
        "CP Pre-Crash Movement": "Other, see Narrative",
        "Crash With": "SUV", "Were All Passengers Belted?": "Unknown",
        "SV Contact Area": ("Front Left",), "CP Contact Area": ("Rear Right",)},
}
# Narrative words naming a second AV of the reporting company: "two",
# "second", "another", "different", "additional", "first" or "initial" before
# the company's name, "the Level 4 ADS of both", or the defined terms "Parked
# Waymo AV" and "Second Waymo AV" (case-sensitive: lowercase, "the parked
# Waymo AV" names the reporting AV, in 69 other in-scope narratives, and
# "stopped" or "parked Waymo AV" in either case in 161). Calibrated 2026-10-31
# on every in-scope narrative of the newest files, all three companies: it
# matches exactly the 17 reports of the two tables (the six above, the two
# Atlanta reports, and nine that name an AV that was not in the collision).
# check_second_av_classified() stops the run on any other.
SECOND_AV_PATTERN = re.compile(
    r"(?i:\b(?:second|another|different|additional|third|two|both|first|initial)\s+"
    r"(?:Waymo|Zoox|Tesla|robotaxi|Cybercab|ADS)\b|\bLevel\s+4\s+ADS\s+of\s+both\b)|"
    r"\b(?:Parked|Second)\s+Waymo\s+AV\b")
# In-scope reports whose narrative trips SECOND_AV_PATTERN but that get no
# second record, keyed by Report ID with the reason.
SECOND_AV_REVIEWED = {
    "30270-16207": "the two Waymos of this AUG-2026 Atlanta crash each filed a report (30270-16174 is the other)",
    "30270-16174": "the two Waymos of this AUG-2026 Atlanta crash each filed a report (30270-16207 is the other)",
    "30270-6878": "another Waymo struck the same towed pickup minutes earlier, its own crash and report (30270-7013)",
    "30270-8933": "a second Waymo was stopped nearby; the van struck only the reporting Waymo",
    "30270-9111": "another Waymo passed in the traffic; only the reporting Waymo was struck",
    "30270-9534": "the reporting Waymo passed a second, stopped Waymo; the passing car struck only the reporting one",
    "30270-9897": "a different Waymo was stopped ahead; the passing car struck only the reporting Waymo",
    "30270-10640": "a second Waymo stopped in front of the SUV, which reversed into the reporting Waymo only",
    "30270-11715": "another Waymo stopped beside the truck, which reversed into the reporting Waymo only",
    "30270-14355": "the reporting Waymo yielded to a second Waymo ahead; a car rear-ended the reporting one only",
    "30270-14075": "\"the two Waymo AV passengers\": one Waymo",
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


# The reports NHTSA filed outside its ADS file that an ADS drove (decision of
# 2026-10-31, open question 1: "Reviewed list + tripwire"), keyed by Report
# ID: (the snapshot prefix of the file that holds it, the filed "Driver /
# Operator Type" and "Automation System Engaged?" the review read, the
# narrative's words saying an ADS drove). misfiled_ads_rows() reads these
# reports' rows with the ADS files' rows, and every check after applies to
# them as to any other.
MISFILED_ADS_REPORTS = {
    # Waymo, MAR-2026 San Francisco (a Monthly report submitted APR-2026):
    # stopped for a dropoff, its passenger opened the rear right door into a
    # car passing on the right. Coded "ADAS", so in the Level 2 file only; on
    # Waymo's own crash list (Safety Impact hub CSV2,
    # https://waymo.com/safety/impact/, data through Jun 2026, read
    # 2026-10-31), the one report of that list the ADS file lacked.
    "30270-14303": ("nhtsa-adas", "None", "ADAS",
                    "At the time of the impact, the Waymo AV's Level 4 ADS was "
                    "engaged in autonomous mode."),
}
# Waymo, Tesla and Zoox reports in those files whose latest operator type is
# one an ADS could have been driving in (NON_ADS_FILE_REVIEW_TYPES) but that
# no ADS drove, keyed by Report ID: (the snapshot prefix, the filed operator
# type and "Automation System Engaged?" the review read, why it stays out).
NON_ADS_FILE_EXCLUDED = {
    # JUL-2025 Flowery Branch GA, 46 mph on a rural road, ADAS verified
    # engaged, Operating Entity "Tesla - Internal Fleet Loaner", narrative
    # redacted: an employee's loaner on Level 2, in a state with no Tesla
    # robotaxi service
    "13781-11293": ("nhtsa-adas", "Other, see Narrative", "ADAS",
                    "a Level 2 crash of a Tesla employee loaner in Georgia"),
}
# Operator types a Waymo, Tesla or Zoox report in a non-ADS file must be
# listed for (misfiled_ads_rows()): the two an ADS drives in, and the two that
# do not say who drove. "Consumer" and the in-vehicle modes put a human at the
# wheel.
NON_ADS_FILE_REVIEW_TYPES = {"None", "Remote (Commercial / Test)",
                             "Other, see Narrative", "Unknown"}


def misfiled_ads_rows(ads_rows, non_ads_texts):
    """The rows of the MISFILED_ADS_REPORTS in NHTSA's non-ADS files
    (<non_ads_texts>: {snapshot prefix: CSV text}, the current ADAS and OTHER
    files), contact areas under their true labels as in the current ADS file
    (the ADAS file's are rotated the same way: 30270-14303's crash partner's
    "front left side" is published under "Front"). <ads_rows> are the ADS
    files' rows.

    Stops on a Waymo, Tesla or Zoox report in those files whose latest
    operator type is in NON_ADS_FILE_REVIEW_TYPES and that neither
    MISFILED_ADS_REPORTS nor NON_ADS_FILE_EXCLUDED lists, and on a listed
    report that is not in its file, is also in the ADS files, or whose latest
    filing no longer has the reviewed operator type, automation system and
    (if admitted) words (a correction that moves it to the ADS file stops the
    run until its entry is dropped)."""
    rows = {prefix: list(csv.DictReader(io.StringIO(text)))
            for prefix, text in non_ads_texts.items()}
    # Every report, by its latest version: one filed with a blank Same
    # Incident ID or Incident Date too (main() stops on such a helmer report)
    latest = {prefix: latest_filings([r for r in file_rows if r["Report ID"].strip()])
              for prefix, file_rows in rows.items()}
    reviewed = {**MISFILED_ADS_REPORTS, **NON_ADS_FILE_EXCLUDED}
    unlisted = sorted(rid for by_rid in latest.values() for rid, r in by_rid.items()
                      if r["Reporting Entity"].strip() in HELMER_SHORT
                      and r["Driver / Operator Type"].strip() in NON_ADS_FILE_REVIEW_TYPES
                      and rid not in reviewed)
    must(not unlisted,
         "a Waymo, Tesla or Zoox report in NHTSA's ADAS or OTHER file has an "
         "operator type an ADS could have been driving in (read its narrative: "
         "if an ADS drove, list it in MISFILED_ADS_REPORTS in data/slurp.py and "
         "rate it in data/faultfrac.csv, else in NON_ADS_FILE_EXCLUDED with the "
         "reason: data/README.md, Each NHTSA release, step 6)",
         reports=unlisted)
    ads_ids = {r["Report ID"] for r in ads_rows}
    changed = sorted(rid for rid, (prefix, operator, engaged, *_why) in reviewed.items()
                     if rid not in latest[prefix] or rid in ads_ids
                     or latest[prefix][rid]["Driver / Operator Type"].strip() != operator
                     or latest[prefix][rid]["Automation System Engaged?"].strip() != engaged)
    changed += sorted(rid for rid, (prefix, *_values, quote) in MISFILED_ADS_REPORTS.items()
                      if rid in latest[prefix] and quote not in latest[prefix][rid]["Narrative"])
    must(not changed,
         "a MISFILED_ADS_REPORTS or NON_ADS_FILE_EXCLUDED entry in data/slurp.py "
         "no longer matches NHTSA's files: its report has left the file the "
         "entry names, is in the ADS file too, or was re-filed with another "
         "operator type, automation system or narrative (re-read it; drop the "
         "entry if NHTSA now files it as ADS, else update it: data/README.md, "
         "Each NHTSA release, step 6)",
         reports=sorted(set(changed)))
    return [_normalize_current_row(r) for rid, (prefix, *_values) in MISFILED_ADS_REPORTS.items()
            for r in rows[prefix] if r["Report ID"] == rid]


# Each ADS file: its URL, its snapshot prefix, and its loader; and each
# non-ADS file (NON_ADS_SOURCES), read through misfiled_ads_rows(). A live
# fetch (fetch_nhtsa_csv) and every offline regeneration (newest_snapshot_rows,
# used by the quals) parse through these (nhtsa_rows), so both see the same
# rows.
NHTSA_SOURCES = (
    (NHTSA_ADS_CSV_URL, "nhtsa-current", current_csv_rows),
    (NHTSA_ADS_ARCHIVE_URL, "nhtsa-archive", archive_csv_rows),
)
NON_ADS_SOURCES = (
    (NHTSA_ADAS_CSV_URL, "nhtsa-adas"),
    (NHTSA_OTHER_CSV_URL, "nhtsa-other"),
)
must(all(prefix in {p for _u, p in NON_ADS_SOURCES}
         for prefix, *_values in [*MISFILED_ADS_REPORTS.values(), *NON_ADS_FILE_EXCLUDED.values()]),
     "a MISFILED_ADS_REPORTS or NON_ADS_FILE_EXCLUDED entry must name a "
     "NON_ADS_SOURCES snapshot prefix")
must(not set(MISFILED_ADS_REPORTS) & set(NON_ADS_FILE_EXCLUDED),
     "a non-ADS-file report is both admitted and excluded")


def nhtsa_rows(texts):
    """The rows slurp reads from NHTSA's files (<texts>: {snapshot prefix: CSV
    text} for every NHTSA_SOURCES and NON_ADS_SOURCES file): every row of the
    ADS files, then the MISFILED_ADS_REPORTS rows of the others."""
    ads = [row for _url, prefix, parse in NHTSA_SOURCES for row in parse(texts[prefix])]
    return ads + misfiled_ads_rows(ads, {prefix: texts[prefix] for _url, prefix in NON_ADS_SOURCES})


def newest_snapshot_rows():
    """Rows of the newest snapshot of each NHTSA file, parsed as a live fetch is."""
    texts = {}
    for prefix in [p for _url, p, _parse in NHTSA_SOURCES] + [p for _url, p in NON_ADS_SOURCES]:
        path = latest_snapshot_path(prefix)
        must(path is not None,
             "no snapshot of this NHTSA file to read (a live run fetches and snapshots it)",
             prefix=prefix, pattern=f"{prefix}-*.csv", directory=relpath(SNAPSHOT_DIR))
        with open(path, newline="", encoding="utf-8") as f:
            texts[prefix] = f.read()
    return nhtsa_rows(texts)


def fetch_nhtsa_csv(stamp):
    """Fetch NHTSA's ADS incident report CSVs (current and archive) and its
    current ADAS and OTHER CSVs, saving each that differs from its newest
    snapshot before any is parsed (a run that stops has saved the release).

    Returns (rows, headers_by_url): nhtsa_rows() of the four, and the HTTP
    headers of each fetched CSV.
    """
    texts = {}
    headers_by_url = {}
    for url, prefix in [(u, p) for u, p, _parse in NHTSA_SOURCES] + list(NON_ADS_SOURCES):
        print(f"Fetching NHTSA SGO CSV from {url} ...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            lm = resp.headers.get("Last-Modified")
            etag = resp.headers.get("ETag")
            payload = resp.read()
        headers_by_url[url] = (lm, etag)
        texts[prefix] = payload.decode("utf-8")
        snapshot_csv_if_changed(prefix, texts[prefix], stamp)
    return nhtsa_rows(texts), headers_by_url


# The company list's columns (its spreadsheet's header row), in order, and
# the columns FIELDS reads from an NHTSA row that the list does not give,
# blank in a list row (list_row()).
LIST_COLUMNS = (
    "report_id", "incident_date_local", "city", "state", "roadway_type",
    "weather", "crash_with", "highest_injury_severity_alleged",
    "subject_vehicle_pre_crash_speed (MPH)", "subject_vehicle_damage_area",
    "crash_partner_damage_area", "air_bags_deployed", "narrative",
)
LIST_ABSENT_COLUMNS = (
    "Incident Time (24:00)", "SV Pre-Crash Movement", "CP Pre-Crash Movement",
    "Were All Passengers Belted?", "Report Submission Date", "Narrative - CBI?",
)
LIST_NO_CONTACT_AREA = "N/A"   # a damage-area cell with no area to name
XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
XLSX_EPOCH = datetime.date(1899, 12, 30)   # day 0 of a spreadsheet's date serials


def latest_list_path():
    """The newest snapshot of the company list (PREPRINT_LIST)."""
    paths = sorted(SNAPSHOT_DIR.glob(f"{PREPRINT_LIST['prefix']}-*.xlsx"))
    must(paths,
         "no snapshot of the company list to read (save the file PREPRINT_LIST "
         "names: data/README.md, Each NHTSA release, step 7)",
         pattern=f"{PREPRINT_LIST['prefix']}-*.xlsx", directory=relpath(SNAPSHOT_DIR))
    return paths[-1]


def read_list_cells(path):
    """The rows of the spreadsheet at <path> as {column header: cell text}, in
    the header's order: its one sheet, whose first row holds the headers. A
    cell is a shared string or a number, as Tesla's file writes them; any
    other kind stops the run."""
    with zipfile.ZipFile(path) as book:
        names = book.namelist()
        sheets = sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        must(len(sheets) == 1 and "xl/sharedStrings.xml" in names,
             "the company list's spreadsheet must hold one sheet and its "
             "shared strings (data/README.md, Each NHTSA release, step 7)",
             file=relpath(path), sheets=sheets)
        strings = ["".join(t.text or "" for t in si.iter(XLSX_NS + "t"))
                   for si in xml.etree.ElementTree.fromstring(
                       book.read("xl/sharedStrings.xml")).iter(XLSX_NS + "si")]
        sheet = xml.etree.ElementTree.fromstring(book.read(sheets[0]))
    grid = []
    for row in sheet.iter(XLSX_NS + "row"):
        cells = {}
        for cell in row.iter(XLSX_NS + "c"):
            kind, value = cell.get("t"), cell.find(XLSX_NS + "v")
            must(kind in (None, "n", "s") and value is not None,
                 "a cell of the company list is neither a shared string nor a "
                 "number (data/README.md, Each NHTSA release, step 7)",
                 file=relpath(path), cell=cell.get("r"), kind=kind)
            column = re.match(r"[A-Z]+", cell.get("r")).group()
            cells[column] = strings[int(value.text)] if kind == "s" else value.text
        grid.append(cells)
    must(len(grid) > 1, "the company list's spreadsheet has no rows under its "
         "header (data/README.md, Each NHTSA release, step 7)",
         file=relpath(path), rows=len(grid))
    header = grid[0]
    must(all(set(cells) <= set(header) for cells in grid[1:]),
         "a row of the company list has a cell in a column with no header "
         "(data/README.md, Each NHTSA release, step 7)",
         file=relpath(path), header=header)
    return [{header[column]: cells.get(column, "") for column in header}
            for cells in grid[1:]]


def list_row(cells):
    """One row of the company list (<cells>: a read_list_cells() row) as a row
    in NHTSA's columns: what the list gives under NHTSA's names, as the list
    writes it (main() strips cells as it does NHTSA's); its date's month as
    the Incident Date; its weather as the one matching "Weather - ..." column
    and its damage areas as NHTSA's Y columns; blanks for LIST_ABSENT_COLUMNS;
    and the PREPRINT_* values where the list gives no filing type, version or
    operator type. Its Same Incident ID is its Report ID: the list gives none,
    and its row is alone under its Report ID until NHTSA's replaces it.

    Stops on a row that is not as described: other columns, a date that is no
    whole day or is after the date the list runs through, a speed that is no
    whole number, a weather value FIELDS has no column for, a damage area
    CONTACT_AREA_LABELS lacks."""
    must(tuple(cells) == LIST_COLUMNS,
         "the company list's columns are not the ones list_row() maps "
         "(compare the spreadsheet's header with LIST_COLUMNS in data/slurp.py "
         "and map what changed: data/README.md, Each NHTSA release, step 7)",
         columns=list(cells), expected=list(LIST_COLUMNS))
    rid = cells["report_id"]
    serial = float(cells["incident_date_local"])
    must(serial.is_integer(), "a company-list date is not a whole day "
         "(data/README.md, Each NHTSA release, step 7)",
         reportId=rid, value=cells["incident_date_local"])
    day = XLSX_EPOCH + datetime.timedelta(days=int(serial))
    must(day.isoformat() <= PREPRINT_LIST["through"],
         "a crash on the company list is dated after the date the list runs "
         "through (PREPRINT_LIST's through in data/slurp.py is the list's own "
         "\"As of\" date: data/README.md, Each NHTSA release, step 7)",
         reportId=rid, date=day.isoformat(), through=PREPRINT_LIST["through"])
    speed = float(cells["subject_vehicle_pre_crash_speed (MPH)"])
    must(speed.is_integer() and speed >= 0,
         "a company-list speed is not a whole number of miles per hour "
         "(data/README.md, Each NHTSA release, step 7)",
         reportId=rid, value=cells["subject_vehicle_pre_crash_speed (MPH)"])
    weather_columns = [f for f in FIELDS if f.startswith("Weather - ")]
    weather = f"Weather - {cells['weather']}"
    must(weather in weather_columns,
         "a company-list weather value has no \"Weather - ...\" column among "
         "FIELDS in data/slurp.py (data/README.md, Each NHTSA release, step 7)",
         reportId=rid, value=cells["weather"], columns=weather_columns)
    row = {column: "" for column in LIST_ABSENT_COLUMNS}
    row.update({column: "Y" if column == weather else "" for column in weather_columns})
    for cell, prefix in (("subject_vehicle_damage_area", "SV Contact Area"),
                         ("crash_partner_damage_area", "CP Contact Area")):
        areas = [area.strip() for area in cells[cell].split(",")
                 if area.strip() != LIST_NO_CONTACT_AREA]
        must(set(areas) <= set(CONTACT_AREA_LABELS) and len(set(areas)) == len(areas),
             "a company-list contact area is not one of CONTACT_AREA_LABELS in "
             "data/slurp.py, or is named twice (data/README.md, Each NHTSA release, step 7)",
             reportId=rid, column=cell, value=cells[cell])
        row.update({f"{prefix} - {label}": "Y" if label in areas else ""
                    for label in CONTACT_AREA_LABELS})
    month_abbr = {num: abbr for abbr, num in MONTH_ABBR_TO_NUM.items()}
    row.update({
        "Report ID": rid,
        "Report Version": PREPRINT_REPORT_VERSION,
        "Report Type": PREPRINT_REPORT_TYPE,
        "Reporting Entity": PREPRINT_LIST["entity"],
        "Same Incident ID": rid,
        "Driver / Operator Type": PREPRINT_OPERATOR_TYPE,
        "Incident Date": f"{month_abbr[f'{day.month:02d}']}-{day.year}",
        "City": cells["city"],
        "State": cells["state"],
        "Roadway Type": cells["roadway_type"],
        "Crash With": cells["crash_with"],
        "Highest Injury Severity Alleged": cells["highest_injury_severity_alleged"],
        "SV Precrash Speed (MPH)": str(int(speed)),
        "Any Air Bags Deployed?": cells["air_bags_deployed"],
        "Narrative": cells["narrative"],
    })
    return row


def list_rows(path):
    """Every row of the company-list snapshot at <path> in NHTSA's columns
    (list_row()). Stops unless the file is the one named for the date the
    list runs through, no Report ID is on it twice, it holds no report a
    review classified when no list held it (TESLA_NO_MONITOR_ADDITIONS, which
    then moves into TESLA_NO_MONITOR_REPORTS; TESLA_MONITOR_ABOARD_REPORTS,
    which it contradicts), and its Report IDs are TESLA_NO_MONITOR_REPORTS
    (the list is the no-monitor line's definition, the additions aside; a new
    list changes both)."""
    wanted = f"{PREPRINT_LIST['prefix']}-{PREPRINT_LIST['through'].replace('-', '')}.xlsx"
    must(path.name == wanted,
         "the newest company-list snapshot is not named for the date the list "
         "runs through (PREPRINT_LIST's through in data/slurp.py and the "
         "file's name must be the list's own \"As of\" date: data/README.md, "
         "Each NHTSA release, step 7)", file=path.name, expected=wanted)
    rows = [list_row(cells) for cells in read_list_cells(path)]
    ids = [r["Report ID"] for r in rows]
    must(len(set(ids)) == len(ids), "the company list names a Report ID twice "
         "(data/README.md, Each NHTSA release, step 7)",
         reports=sorted(rid for rid, n in Counter(ids).items() if n > 1))
    must(not set(ids) & set(TESLA_NO_MONITOR_ADDITIONS),
         "the company list now holds reviewed no-monitor additions: move each "
         "from TESLA_NO_MONITOR_ADDITIONS into TESLA_NO_MONITOR_REPORTS in "
         "data/slurp.py (data/README.md, Each NHTSA release, step 7)",
         reports=sorted(set(ids) & set(TESLA_NO_MONITOR_ADDITIONS)))
    must(not set(ids) & set(TESLA_MONITOR_ABOARD_REPORTS),
         "the company list holds reports reviewed as monitor-aboard "
         "(TESLA_MONITOR_ABOARD_REPORTS in data/slurp.py): the list and the "
         "narratives disagree (re-read each and ask the human: data/README.md, "
         "Each NHTSA release, step 7)",
         reports=sorted(set(ids) & set(TESLA_MONITOR_ABOARD_REPORTS)))
    must(set(ids) == TESLA_NO_MONITOR_REPORTS,
         "the company list's Report IDs are not TESLA_NO_MONITOR_REPORTS (the "
         "list has changed: bring the set in data/slurp.py in line with it: "
         "data/README.md, Each NHTSA release, step 7)",
         onlyOnList=sorted(set(ids) - TESLA_NO_MONITOR_REPORTS),
         onlyInSet=sorted(TESLA_NO_MONITOR_REPORTS - set(ids)))
    return rows


def preprint_rows(nhtsa):
    """The preprints: the rows of the company list (its newest snapshot) whose
    Report ID none of NHTSA's rows <nhtsa> has. Stops on one dated after
    NHTSA's data-through month: the analysis ends at that month, and a month
    only a list covers has no rule yet."""
    held = {r["Report ID"] for r in nhtsa}
    preprints = [r for r in list_rows(latest_list_path()) if r["Report ID"] not in held]
    later = sorted(r["Report ID"] for r in preprints
                   if nhtsa_month_to_iso(r["Incident Date"]) > NHTSA_DATA_THROUGH_DATE[:7])
    must(not later,
         "a preprint is dated after NHTSA's data-through month (the company "
         "list reaches a month NHTSA's file has not begun; how to count a month "
         "only a list covers is undecided: ask the human; data/README.md, Each NHTSA release, step 7)",
         reports=later, dataThrough=NHTSA_DATA_THROUGH_DATE)
    return preprints


def newest_report_rows():
    """The rows every incident count reads, from the newest snapshots:
    NHTSA's (newest_snapshot_rows()) and the preprints, as main() reads them
    after a live fetch."""
    nhtsa = newest_snapshot_rows()
    return nhtsa + preprint_rows(nhtsa)


def modified_date_from_last_modified(last_modified):
    """ISO date of the current CSV's HTTP Last-Modified header."""
    must(last_modified is not None, "NHTSA CSV response lacks a Last-Modified header")
    from email.utils import parsedate_to_datetime
    return parsedate_to_datetime(last_modified).date().isoformat()


def month_shift(month, n):
    """The ISO month <n> months after <month> (before it, for negative n)."""
    y, m = divmod(int(month[:4]) * 12 + int(month[5:]) - 1 + n, 12)
    return f"{y}-{m + 1:02d}"


def check_data_through_month(data_through_date, last_month):
    """Stop the run unless the reviewed NHTSA_DATA_THROUGH_DATE's month is the
    newest incident month <last_month>: a new release without a reviewed
    cutoff, or a cutoff the data has not reached. (Until 2026-11-21 this was
    the first check of release_month_coverage(), which went on to estimate
    the share of that month's five-day-track incidents the release holds; the
    month is pending now, with no estimate: month_sources().)"""
    data_through_month = datetime.date.fromisoformat(
        data_through_date).strftime("%Y-%m")
    must(data_through_month == last_month,
         "reviewed NHTSA cutoff month must match the latest incident month "
         "(set NHTSA_DATA_THROUGH_DATE in data/slurp.py to the new release's "
         "cutoff: data/README.md, Each NHTSA release, step 1)",
         data_through=data_through_date, last_month=last_month)


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
    must(len(hits) == 1, "VMT master helmer label is not a line SERIES_COMPANY names "
         "(data/README.md, Each NHTSA release, step 4)",
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


# An incident's track is the Report Type of its crash's first filing: 1-Day
# or 5-Day (the prompt reports of SGO Request No. 1) or Monthly (Request No.
# 2). A re-filing under a new Report ID (SUPERSEDED_REPORTS) takes the track
# of the report it replaced, that report's version-1 filing (since
# 2026-11-02, the human's answer to open question 26(a)): the arrival table
# counts a month's crashes by track in the release they first appeared in,
# from before the re-filing, and again in the newest file, so a crash keeps
# one track. Until then the track was the surviving report's own version 1, so an
# "Update"-typed re-filing stopped the run and a Monthly re-filing of a 5-Day
# report moved its crash between tracks (quals/refiling-track.qual.mjs).
REPORT_TRACK = {"1-Day": "five_day", "5-Day": "five_day", "Monthly": "monthly"}


def monthly_track_counts(rows):
    """Counter {(helmer, iso_month, track): incidents} over the in-scope
    incidents of <rows> (public_service_incidents()), by the track of the
    crash's first report's version-1 filing (REPORT_TRACK): the report a
    re-filing under a new Report ID replaced (SUPERSEDED_REPORTS), else the
    surviving report itself."""
    filed = filed_incident_rows(rows)
    first_type = {r["Report ID"]: r["Report Type"].strip()
                  for r in filed if int(r["Report Version"]) == 1}
    replaced_by = {new: old for old, new in SUPERSEDED_REPORTS.items()}
    counts = Counter()
    for r in public_service_incidents(filed).values():
        first_report = replaced_by.get(r["Report ID"], r["Report ID"])
        first = first_type.get(first_report)
        must(first in REPORT_TRACK,
             "in-scope report whose crash's first filing is of no known track "
             "(its version 1 is not a 1-Day, 5-Day or Monthly report: if it "
             "re-files another report under a new Report ID, list that report "
             "in SUPERSEDED_REPORTS in data/slurp.py with the re-filing, so the "
             "crash keeps that report's track: data/README.md, Each NHTSA "
             "release, step 6)",
             reportId=r["Report ID"], firstReport=first_report,
             firstReportType=first)
        counts[(HELMER_SHORT[r["Reporting Entity"].strip()],
                nhtsa_month_to_iso(r["Incident Date"].strip()),
                REPORT_TRACK[first])] += 1
    return counts


def check_monthly_arrivals(counts, last_month):
    """Stop the run unless the Monthly-report arrival tables
    (MONTHLY_ARRIVAL_OBSERVATIONS, MONTHLY_ARRIVAL_MONTHS_EXCLUDED,
    MONTHLY_ARRIVAL_LAG) are measured through this release, whose data-through
    month is <last_month>: the tables cover the helmers they must, each lag is
    what its observations say, every month that is now measurable is observed
    (or excluded with a reason), the observations agree with this release
    (<counts>: monthly_track_counts() of it), and no lagged month already
    holds a Monthly-track report (which would mean the helmer's Monthly
    reports are no longer late). The lag decides which months are complete
    (month_sources()), and the list's company's on-time share is the list's
    allowance for late-filed crashes (preprint_coverage()). (Until 2026-11-21
    this was monthly_lag_coverage(), which also gave a lagged month an
    estimated Monthly-track incident coverage, the helmer's five-day share of
    incidents; a lagged month is pending now.) Each row holds what can have
    been measured: through the month whose third release this is, its on-time
    count and the count that arrived a release late; after it, its on-time
    count alone."""
    helmers = set(HELMER_SHORT.values())
    must(set(MONTHLY_ARRIVAL_LAG) == helmers == set(MONTHLY_ARRIVAL_OBSERVATIONS),
         "MONTHLY_ARRIVAL_LAG and MONTHLY_ARRIVAL_OBSERVATIONS must cover "
         "every helmer (data/README.md, Each NHTSA release, step 3)", helmers=sorted(helmers),
         lag=sorted(MONTHLY_ARRIVAL_LAG),
         observations=sorted(MONTHLY_ARRIVAL_OBSERVATIONS))
    must(all(isinstance(lag, int) and lag >= 0
             for lag in MONTHLY_ARRIVAL_LAG.values()),
         "MONTHLY_ARRIVAL_LAG values must be whole numbers of releases "
         "(data/README.md, Each NHTSA release, step 3)",
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
    # A row holds the counts its releases have shown. A month through the due
    # month has had its third release, so its row holds the reports that
    # arrived a release late too, a 0 included: a row entered early with its
    # on-time count alone is re-measured then. Until 2026-11-21 nothing
    # required it, so a row stayed on-time-only whenever no report had
    # arrived late, and preprint_coverage(), which reads the rows with both
    # counts, left its month out of the list's allowance (audit 2026-11-20,
    # A45). A month after the due month has had two releases: its late count
    # cannot be measured yet, and a second count there would enter the
    # allowance unmeasured. Both run before the lag check: a row short of its
    # late count reads as on time whatever arrived late.
    held = sorted((helmer, month, arrived)
                  for helmer, table in MONTHLY_ARRIVAL_OBSERVATIONS.items()
                  for month, arrived in table.items())
    on_time_only = [row for row in held if row[1] <= due and len(row[2]) < 2]
    must(not on_time_only,
         "a Monthly-report arrival row for a month whose third release has "
         "come holds its on-time count only (re-measure the month from the "
         "snapshots and give its row its second count, the in-scope "
         "Monthly-track incidents that arrived a release late, 0 if none, in "
         "MONTHLY_ARRIVAL_OBSERVATIONS in data/slurp.py: data/README.md, Each "
         "NHTSA release, step 3)",
         rows=on_time_only, due=due, last_month=last_month)
    unmeasured = [row for row in held if row[1] > due and len(row[2]) != 1]
    must(not unmeasured,
         "a Monthly-report arrival row for a month whose third release has "
         "not come holds more than its on-time count (the reports that arrive "
         "a release late show only at its third release: keep the on-time "
         "count alone until then, in MONTHLY_ARRIVAL_OBSERVATIONS in "
         "data/slurp.py: data/README.md, Each NHTSA release, step 3)",
         rows=unmeasured, due=due, last_month=last_month)
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
    # contradicts the lag itself.
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


def read_vmt_master():
    """Read raw VMT CSV text from the in-repo master (data/vmt.csv)."""
    return VMT_MASTER.read_text()


def parse_vmt_months(raw_text):
    """Parse the set of ISO months from the raw VMT CSV text."""
    return {row[1].strip() for row in _vmt_data_rows(raw_text)}


def preprint_coverage(vmt):
    """The coverage the company list (PREPRINT_LIST) gives each line of its
    company for the month the list runs through: {(line, iso_month): (receipt
    coverage triple, Monthly-track incident coverage triple, the list's
    date)}, the coverage columns of a list-covered row of data/vmt.js
    (month_sources(), build_vmt_csv()). <vmt> is parse_vmt_values().

    Receipt coverage: the list holds every crash of the month through its
    date and none after, so it covers the list's miles (the company's
    no-monitor miles of the month through that date) out of the row's miles,
    best, low and high alike. On the all-modes line the row's other miles
    (a safety monitor aboard, which the list leaves out) count as uncovered.

    Incident coverage: a list can lack a crash its company files late. Its
    best value is the share of the company's Monthly-track reports that
    reached NHTSA on time, over MONTHLY_ARRIVAL_OBSERVATIONS' months with
    both counts measured; its low edge that share's Wilson 95% lower bound;
    its high edge 1 (the list may be complete). The five-day track takes no
    such factor: no five-day report of the company has arrived late.

    Stops if the list's miles exceed a line's miles for the month."""
    company = HELMER_SHORT[PREPRINT_LIST["entity"]]
    month = PREPRINT_LIST["through"][:7]
    measured = [counts for counts in MONTHLY_ARRIVAL_OBSERVATIONS[company].values()
                if len(counts) > 1]
    on_time = sum(counts[0] for counts in measured)
    filed = sum(sum(counts) for counts in measured)
    must(filed > 0, "no measured Monthly-report arrivals for the company "
         "whose list this is (MONTHLY_ARRIVAL_OBSERVATIONS: data/README.md, "
         "Each NHTSA release, step 3)", company=company)
    share = on_time / filed
    z = 1.96
    low = ((share + z * z / (2 * filed)
            - z * math.sqrt(share * (1 - share) / filed + z * z / (4 * filed * filed)))
           / (1 + z * z / filed))
    incident = (round(share, 4), round(low, 4), 1.0)
    result = {}
    for line in sorted(s for s, c in SERIES_COMPANY.items() if c == company):
        must((line, month) in vmt,
             "a line of the company list's company has no data/vmt.csv row "
             "for the month the list runs through (data/README.md, Each NHTSA "
             "release, steps 4 and 7)", line=line, month=month)
        covered = round(PREPRINT_LIST["miles"] / vmt[(line, month)], 4)
        must(0 < covered <= 1,
             "the company list's miles exceed a line's miles for the month "
             "the list runs through (PREPRINT_LIST's miles in data/slurp.py "
             "against that data/vmt.csv row: data/README.md, Each NHTSA release, step 7)",
             line=line, month=month,
             listMiles=PREPRINT_LIST["miles"], rowMiles=vmt[(line, month)])
        result[(line, month)] = ((covered, covered, covered), incident,
                                 PREPRINT_LIST["through"])
    return result


# What a complete row's coverage columns say: every incident of the month is
# in NHTSA's file (receipt coverage triple, Monthly-track incident coverage
# triple).
COMPLETE_COVERAGE = ((1, 1, 1), (1, 1, 1))


def month_sources(vmt, last_month, list_cov):
    """What makes each line's crashes of a month a known set with known miles:
    {(line, iso_month): "nhtsa" or "list"} for the line-months of <vmt>
    (parse_vmt_values()) that enter the rates; every other line-month at or
    before the data-through month <last_month> is pending, and the months
    after it are ghost months.
      "nhtsa"  NHTSA's file is complete for the line's company and month: the
               month is before the data-through month and outside the
               company's Monthly-report lag (month <= last_month - 1 -
               MONTHLY_ARRIVAL_LAG[company]);
      "list"   else, the company's own dated list covers it (<list_cov>,
               preprint_coverage(): each line of the list's company, in the
               list's month): the list's crashes through its date, over the
               list's miles.
    Stops on a list that runs through a month after <last_month> (a month
    only a list covers has no rule), and on a line with a pending month
    before a counted one (a lag that leaves a month pending before the month
    a list covers: the page takes a line's counted months as one run, and
    how to count such a month has no rule)."""
    later = sorted({month for _line, month in list_cov if month > last_month})
    must(not later,
         "the company list runs through a month after NHTSA's data-through "
         "month (how to count a month only a list covers is undecided: ask the "
         "human; data/README.md, Each NHTSA release, step 7)",
         listMonths=later, dataThrough=last_month, listThrough=PREPRINT_LIST["through"])
    sources = {key: "list" for key in list_cov}
    sources.update({(line, month): "nhtsa" for line, month in vmt
                    if month <= month_shift(last_month, -1 - MONTHLY_ARRIVAL_LAG[SERIES_COMPANY[line]])})
    counted_after_pending = sorted(
        (line, pending, counted) for line, counted in sources
        for other, pending in vmt
        if other == line and pending < counted and (line, pending) not in sources)
    must(not counted_after_pending,
         "a line has a pending month before a month that counts (its "
         "company's Monthly-report lag leaves the earlier month pending while "
         "the company list covers the later one; how to count the earlier "
         "month is undecided: ask the human; data/README.md, Each NHTSA "
         "release, steps 3 and 7)",
         lines=[{"line": line, "pending": pending, "counted": counted}
                for line, pending, counted in counted_after_pending],
         lag=MONTHLY_ARRIVAL_LAG, listThrough=PREPRINT_LIST["through"])
    return sources


def record_counted(rec, sources):
    """Whether the lines a record names (<rec>, an in-scope incident's record:
    its `series`) count it, under <sources> (month_sources()): on a line whose
    month NHTSA's file completes, every in-scope incident counts; on a
    list-covered line-month, only the list's own crashes (its Report IDs,
    TESLA_NO_MONITOR_REPORTS: list_rows()), since only crashes inside a known
    span count (a reviewed no-monitor addition, or a monitor-aboard report on
    the every-mode line, is outside it; until 2026-11-21 such a crash stopped
    the run, check_list_covered_rows(), the case then undecided); on a pending
    line-month, none. Stops on a record counted on one line and pending on
    another: a record is counted on every line it names, or it is pending."""
    month = nhtsa_month_to_iso(rec["date"])
    source = {line: sources.get((line, month)) for line in rec["series"]}
    counted = {line: s == "nhtsa" or (s == "list" and rec["reportId"] in TESLA_NO_MONITOR_REPORTS)
               for line, s in source.items()}
    must(len(set(counted.values())) == 1,
         "an incident is counted on one of its lines and pending on another "
         "(a record counts on every line it names, or on none: ask the human)",
         reportId=rec["reportId"], month=month, sources=source, counted=counted)
    return all(counted.values())


def build_vmt_csv(raw_text, sources, list_cov):
    """data/vmt.js's analysis rows, as CSV text: the rows of the raw VMT CSV
    text whose line-month enters the rates (<sources>, month_sources()), each
    with its coverage columns and incidents_through.

    A row NHTSA's file completes ("nhtsa") is complete: its six coverage
    values are 1 (COMPLETE_COVERAGE) and its incidents run through NHTSA's
    receipt cutoff. A row the company list covers ("list") takes the list's
    coverage and date (<list_cov>, preprint_coverage()). Every other master
    row (a pending line-month's, a ghost month's) is written by
    ghost_vmt_csv(). (Until 2026-11-21 every row at or before the
    data-through month was written here, the data-through month's and a
    lagged month's with an estimated coverage, and a row took the list's
    coverage only where that covered more of the month than NHTSA's
    estimate did.)
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
                     "incident_coverage_max", "incidents_through", "rationale"])
    for row in rows[1:]:
        if not any(cell.strip() for cell in row):
            continue
        key = (_canonical_helmer(row[0].strip()), row[1].strip())
        if key not in sources:
            continue
        (cov_best, cov_lo, cov_hi), (ic_best, ic_lo, ic_hi), through = (
            list_cov[key] if sources[key] == "list" else (*COMPLETE_COVERAGE, NHTSA_DATA_THROUGH_DATE))
        nums, rationale = _vmt_master_cells(row)
        writer.writerow([row[0], row[1], *nums, cov_best, cov_lo, cov_hi,
                         ic_best, ic_lo, ic_hi, through, rationale])
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
    must(len(row) == 9, "VMT master row must have exactly 9 cells "
         "(data/README.md, Each NHTSA release, step 4)",
         helmer=row[0], month=row[1].strip(), cells=len(row))
    return nums, row[8]


def ghost_vmt_csv(raw_text, last_month, run_month, analysis):
    """The master rows data/vmt.js's second segment holds, as CSV text: every
    row that is not an analysis row (<analysis>: the (line, month)s
    build_vmt_csv() writes, month_sources()'s keys), as it stands in the
    master. They are the pending line-months' rows (months at or before the
    data-through month <last_month> whose reports are still arriving and that
    no dated list covers) and the ghost months'.

    A ghost month is a month after last_month for which the master holds
    rows: the month in progress, or a finished month no NHTSA release has
    reached. The VMT charts draw both kinds of row faded; no rate uses a
    month's miles until its reports are complete or a list covers it. The
    master must hold the month after last_month (so each release brings the
    next month's estimate), each ghost month must carry a row for every line
    with a row in last_month, and no row may be for a month after run_month,
    the month slurp runs in: a VMT row records miles already driven,
    estimated or measured (forecasts live in crashla.js's MILES_FORECAST).
    (Until 2026-11-21 the segment held the ghost months only.)
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
    must(all(month <= last_month for _line, month in analysis),
         "an analysis row is for a month after the data-through month",
         months=sorted({month for _line, month in analysis if month > last_month}))
    out_buf = io.StringIO()
    writer = csv.writer(out_buf, lineterminator="\n")
    writer.writerow(header)
    for row in body:
        if (_canonical_helmer(row[0].strip()), row[1].strip()) in analysis:
            continue
        nums, rationale = _vmt_master_cells(row)
        writer.writerow([row[0], row[1], *nums, rationale])
    return out_buf.getvalue().rstrip("\n")


def js_template_literal(text):
    return text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


EXPECTED_REPORT_TYPES = {
    "1-Day", "5-Day", "10-Day Update", "Monthly", "Update",
    "No New or Updated Incident Reports", "Monthly - No Incident",
    # not NHTSA's: what list_row() gives a company list's row
    PREPRINT_REPORT_TYPE,
}
# The Report Types that file no crash: a reporting entity's statement that it
# has none to report, "No New or Updated Incident Reports" (in older files
# "Monthly - No Incident"). main() skips these rows by their type; until
# 2026-10-31 it skipped every row with a blank Same Incident ID or Incident
# Date instead, which would have dropped a helmer's crash report filed with
# either field blank without a word (decision of 2026-10-31, open question 1).
NEGATIVE_FILING_TYPES = {"No New or Updated Incident Reports", "Monthly - No Incident"}
must(NEGATIVE_FILING_TYPES <= EXPECTED_REPORT_TYPES,
     "NEGATIVE_FILING_TYPES must be EXPECTED_REPORT_TYPES")
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
# Each Roadway Type's class, "road" or "parking" (a parking facility): the one
# reviewed table of them (2026-11-21; audit A11 of 2026-11-20, the human's "ok
# on all 3"). It lists every Roadway Type on a row that passes main()'s
# validation loop in any file of data/snapshots (Waymo's, Tesla's and Zoox's
# in-scope crashes have filed seven of them; "Rural Road" and "Unpaved Road"
# are on other rows the loop validates: VinFast 33257-8867, and Waymo
# 30270-16201, filed with a test driver aboard). main() stops on a value it
# lacks, as on a new severity, and writes the table into data/incidents.js
# (ROADWAY_CLASS there), where crashla.js reads it: a moving crash counts in
# the nonstationary non-parking-lot metric when its Roadway Type's class is
# "road", and the page refuses a record whose type the table lacks. The
# metric's human bands cover roadway crashes only (crashla.js METRIC_DEFS,
# roadwayNonstationary), so a parking facility's crashes stay out on the AV
# side too. Until 2026-11-21 the page left out only the literal "Parking Lot"
# and nothing listed the values: "Parking Garage", new in NHTSA's Oct-15-2026
# file (one out-of-scope row; five rows on Nov 16), entered the metric as a
# road without a word (in scope: 30270-16350, AUG-2026, a garage entrance's
# barrier arm at 1 mph, and three 0-mph crashes that no nonstationary metric
# counts, 30270-17031, 30610-17186 and 30610-17187).
# The filed value is taken as it is (data/README.md, pipeline step 9: no
# Roadway Type is overridden); this table only classes it.
ROADWAY_CLASS = {
    "Street": "road",
    "Intersection": "road",
    "Highway / Freeway": "road",
    "Traffic Circle": "road",
    "Rural Road": "road",
    "Unpaved Road": "road",
    # A crash whose road type NHTSA's row leaves unknown counts as a road
    # crash, the cautious reading (the human, 2026-11-21): on the
    # non-parking-lot metric it can only add an incident, so it can only lower
    # an AV's miles per incident. In scope today: 30270-9420 (NOV-2024, 3 mph,
    # a passenger drop-off lane), which the metric counts, and 30270-15631
    # (JUN-2026, parked in a hotel loading zone, 0 mph), which no
    # nonstationary metric does.
    "Unknown": "road",
    "Parking Lot": "parking",
    "Parking Garage": "parking",
}
must(set(ROADWAY_CLASS.values()) == {"road", "parking"},
     "ROADWAY_CLASS must give each Roadway Type the class road or parking",
     classes=sorted(set(ROADWAY_CLASS.values())))
# All reporting entities in the NHTSA ADS CSV (current + archive).
# Anti-Postel: if NHTSA adds a new reporting entity, we want to crash and review.
# Being listed here only means "known to NHTSA and classified by a human" -- it
# does NOT put the entity in scope; scope is HELMER_SHORT (Waymo/Tesla/Zoox).
# MOIA America LLC (added 2026-09-15 release): Volkswagen's ID. Buzz AD
# subsidiary, filing separately from "Volkswagen Group of America, Inc.";
# first report 35021-16268 is a JUL-2026 Beverly Hills, CA test drive with a
# safety driver in the driver's seat (ADS disengaged 9 s before contact).
# Out of scope: no public driverless service, so no VMT denominator.
# Bot Auto (added 2026-11-16 release): a Houston autonomous-trucking company
# (retrofitted Freightliner tractors). Its first report, 34966-17064, is a
# SEP-2026 Houston freeway contact at 61 mph: a plastic chair fell off another
# vehicle into the truck's path; an operator was aboard ("In-Vehicle
# (Commercial / Test)"; "driver took control disengaging autonomy system
# following the chair contact"). Out of scope: freight, no public robotaxi
# service, so no VMT denominator.
# quals/reporting-entity.qual.mjs pins the list against the newest snapshots
# and the stop on a name it lacks (2026-11-16: the human asked whether to
# relax that stop; kept, because scope is an exact match on HELMER_SHORT's
# three names, so a helmer filing under a new name would otherwise leave
# every count without a message).
EXPECTED_HELMERS = {
    "Ambarella",
    "Apollo Autonomous Driving USA",
    "Apple Inc.",
    "Argo AI",
    "Aurora Operations, Inc.",
    "AutoX Technologies Inc",
    "Avride Inc.",
    "Beep, Inc.",
    "Bot Auto",
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
must(not set(AIRBAG_OVERRIDE) & set(AIRBAG_LANGUAGE_REVIEWED),
     "a report's airbag value is both overridden and kept as filed")
must(not set(SUPERSEDED_REPORTS) & (set(SUPERSEDED_REPORTS.values())
                                    | SPLIT_SAME_INCIDENT_REPORTS),
     "a replaced report (SUPERSEDED_REPORTS) cannot stand for another or be "
     "split")
must(len(set(SUPERSEDED_REPORTS.values())) == len(SUPERSEDED_REPORTS),
     "a re-filing (SUPERSEDED_REPORTS) replaces one report: its crash takes "
     "that report's track (monthly_track_counts)")

# Crashes in which a remote human, not the ADS, was driving, keyed by Report
# ID with the narrative's own words (2026-09-26, human decision: the metrics
# assess the self-driving software, so a crash counts only when the ADS was
# driving -- the same line that keeps Waymo/Zoox safety-driver crashes out).
# Excluded from every metric. Their miles stay in Tesla's denominator (Tesla
# does not split them out), but they are walking-pace recoveries, so dropping
# the crash while keeping those miles is nearly exact. The operator code cannot
# find these -- two are coded "None" -- hence the narrative tripwire below.
# check_reviewed_quotes() stops the run when a report's latest filing no
# longer holds its entry's words (since 2026-10-31).
TELEOP_DRIVEN_REPORTS = {
    "13781-11459": "The teleoperator took over vehicle control and gradually increased vehicle speed",
    "13781-14043": "took over vehicle control when the ADS was stopped and proceeded straight on the street",
    "13781-15395": "As the remote assistance operator continued to recover the vehicle, they made contact with a hidden tree stump",
    "13781-16678": "The remote support operator remotely took control and while moving forward",
    "13781-16679": "The remote support operator was in control of the vehicle",
}
# In-scope reports that trip the tripwire below (remote-human language, or
# the "Remote (Commercial / Test)" code itself) but in which the ADS was
# driving at impact, keyed by Report ID with the narrative's words the review
# rests on, verbatim, and the reason as a comment (until 2026-11-02 the entry
# held the reason; open question 26(b)): check_reviewed_quotes() stops the
# run when the report's latest filing no longer holds the words, so a
# re-filing is re-read before it stays in scope.
REMOTE_LANGUAGE_ADS_DRIVEN = {
    # coded Remote; the ADS engaged: stationary, yielding in a crosswalk, when
    # a cyclist ran the red into it
    "30270-13378": "As the cyclist entered the crosswalk, the front tire of the "
                   "bicycle made contact with the right side of the stationary "
                   "Waymo AV and the cyclist fell to the ground. At the time of "
                   "the impact, the Waymo AV's Level 4 ADS was engaged in "
                   "autonomous mode.",
    # coded Remote; the ADS engaged: an unoccupied AV slowing to a stop,
    # rear-ended
    "30610-11752": "An unoccupied Zoox autonomous vehicle was operating at a "
                   "reduced speed in lane #5 on westbound [XXX] towards Las "
                   "Vegas Boulevard in Las Vegas, with a sedan (Vehicle 2) "
                   "directly behind. The Zoox vehicle gradually slowed to a stop "
                   "when it was rear ended by Vehicle 2.",
    # coded None; "operating under teleguidance support" (the first narrative
    # of any company to use the word; Nov-16-2026 release): remote guidance
    # was involved, but the vehicle was stopped at a red signal when a passing
    # motorcyclist swiped it, so no remote human was driving it at impact
    "30610-17194": "An unoccupied Zoox autonomous vehicle, operating under "
                   "teleguidance support, was stopped at a red traffic signal",
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
# it matches exactly the five TELEOP_DRIVEN_REPORTS. The two Remote-coded
# REMOTE_LANGUAGE_ADS_DRIVEN entries do not match it; their "Remote
# (Commercial / Test)" code is what makes them trip check_teleop_classified().
# Widened on the Nov-16-2026 release for Zoox's "teleguidance" (30610-17194,
# the one report version in data/snapshots that uses the word; listed in
# REMOTE_LANGUAGE_ADS_DRIVEN).
TELEOP_PATTERN = re.compile(
    r"tele-?operat|tele-?guid|remote\s+assist\w*|remote\s+(support\s+)?(operator|driver|pilot)|"
    r"supported\s+remotely|"
    r"remotely\s+(driven|operated|controlled|piloted|assisted|supported)|"
    r"remotely\s+took\s+(over\s+)?(the\s+)?(vehicle\s+)?control|"
    r"took\s+over\s+(the\s+)?(vehicle\s+)?control", re.I)
must(not set(TELEOP_DRIVEN_REPORTS) & set(REMOTE_LANGUAGE_ADS_DRIVEN),
     "a report is classified both teleoperator-driven and ADS-driven")
must(not set(PASSENGER_OVERRIDE) & set(OCCUPANCY_LANGUAGE_REVIEWED),
     "a report's passenger code is both re-coded and kept as filed")
# The NHTSA columns a SECOND_INVOLVEMENTS entry gives for its AV, besides its
# quote and its two contact areas (second_involvement_rows()); every other
# column is the report's.
SECOND_INVOLVEMENT_COLUMNS = ("SV Precrash Speed (MPH)", "SV Pre-Crash Movement",
                              "CP Pre-Crash Movement", "Crash With",
                              "Were All Passengers Belted?")
SECOND_INVOLVEMENT_CONTACTS = ("SV Contact Area", "CP Contact Area")
must(all(set(e) == {"quote", *SECOND_INVOLVEMENT_COLUMNS, *SECOND_INVOLVEMENT_CONTACTS}
         and all(set(e[p]) <= set(CONTACT_AREA_LABELS) for p in SECOND_INVOLVEMENT_CONTACTS)
         and e["Were All Passengers Belted?"] in PAX_CLASS
         for e in SECOND_INVOLVEMENTS.values()),
     "a SECOND_INVOLVEMENTS entry must give its quote, exactly the columns "
     "SECOND_INVOLVEMENT_COLUMNS names, its two contact areas as tuples of "
     "CONTACT_AREA_LABELS, and a passenger code PAX_CLASS classifies")
must(not set(SECOND_INVOLVEMENTS) & set(SECOND_AV_REVIEWED),
     "a report is classified both as filing a second AV and as naming one that "
     "was not in the collision")
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
# narratives match NHTSA's (2026-10-23 cross-check). Since 2026-11-18 slurp
# reads that spreadsheet itself (PREPRINT_LIST) and list_rows() stops unless
# its Report IDs are exactly this set, so a newer list changes both. Every
# in-scope Tesla report from TESLA_NO_MONITOR_FROM on is here, in
# TESLA_NO_MONITOR_ADDITIONS or in TESLA_MONITOR_ABOARD_REPORTS, or the run
# stops (check_monitor_reviewed()).
TESLA_NO_MONITOR_REPORTS = frozenset({
    "13781-15399", "13781-15400", "13781-15395", "13781-15342", "13781-15809",
    "13781-15808", "13781-16255", "13781-16294", "13781-16256", "13781-16679",
    "13781-16678", "13781-16677", "13781-16676", "13781-16675", "13781-16674",
    "13781-16673", "13781-17193", "13781-16671", "13781-17191", "13781-17179",
    "13781-17178", "13781-16941", "13781-16733", "13781-17015", "13781-17300",
    "13781-17301", "13781-17302", "13781-17203", "13781-17303", "13781-17299",
    "13781-17304", "13781-17305",
})
# Tesla reports that Tesla's latest list does not hold, classified from their
# narratives (since 2026-11-20, audit finding A1; the human: "ok", to "At each
# release, every Tesla report newer than Tesla's latest list gets a reviewed
# entry (no-monitor or monitor-aboard), quoting the narrative's words, like
# the passenger table. The run stops if Tesla's next list disagrees with any
# entry."). NHTSA's release after a list holds Tesla's reports of the days
# after the list's date, and of crashes Tesla filed after drawing it up. The
# narrative test: Tesla's narratives name a safety monitor when one is aboard
# ("The ADS had a safety monitor present in the vehicle with no passengers"),
# and of Tesla's 30 in-scope crashes from May 2026 to Oct 18, 2026, the one
# whose narrative names a monitor (13781-16672) is the one its list leaves
# out; the other 29 are on it. Each table is keyed by Report ID and holds the
# narrative's words the review read, verbatim (check_reviewed_quotes() stops
# the run when the report's latest filing no longer holds them), and
# check_monitor_reviewed() holds every entry to the narrative test
# (SAFETY_MONITOR_PATTERN): a re-filing that names a monitor in an addition's
# narrative, or none in a monitor-aboard report's, stops the run for a
# re-read.
#
# TESLA_NO_MONITOR_ADDITIONS: no safety monitor aboard. Each entry is (the
# words, the receipt cutoff of the release whose review added it, that
# release's NHTSA_DATA_THROUGH_DATE: NHTSA's file held the report by then).
# The words are the narrative's sentence that says who was aboard, the
# sentence in which Tesla names a monitor when one is aboard ("The ADS had no
# riders in the vehicle"), or the whole narrative where no sentence says. An
# addition counts on the no-monitor line until a list holds it; then
# list_rows() stops until it moves into TESLA_NO_MONITOR_REPORTS.
# check_monitor_reviewed() stops the run on one that Tesla's latest list
# should hold and lacks: one Tesla had filed by the list's date, by that
# cutoff or by the end of the month of its first filing. A list holds the
# no-monitor crashes Tesla had reported by its date (each row carries its
# filing's Report ID), so a crash Tesla files after that date is on no list
# of that date, whatever the crash's own date: Tesla files some late
# (13781-17193, an Aug 22 crash, in October).
TESLA_NO_MONITOR_ADDITIONS = {}
# TESLA_MONITOR_ABOARD_REPORTS: a safety monitor aboard (in-scope Tesla
# reports from TESLA_NO_MONITOR_FROM on); the words name the monitor. None is
# on Tesla's list, and list_rows() stops on a list that holds one. (Until
# 2026-11-20, a set of these Report IDs.)
TESLA_MONITOR_ABOARD_REPORTS = {
    "13781-13644": "Safety monitor and one passenger were present",
    "13781-13645": "Safety monitor was present and no passengers were inside the vehicle",
    "13781-13646": "Safety monitor was present and no passengers were inside the vehicle",
    "13781-13648": "Safety monitor and two passengers were present",
    "13781-14630": "The ADS had a safety monitor present in the vehicle with one passenger",
    "13781-14631": "The ADS had a safety monitor present in the vehicle with no passengers",
    "13781-15017": "The ADS had a safety monitor present in the vehicle with no passengers",
    "13781-16672": "The ADS had a safety monitor present in the vehicle with no passengers",
}
# The narrative test's words: a Tesla narrative names the safety monitor this
# way when one is aboard (every in-scope Tesla report from
# TESLA_NO_MONITOR_FROM on, 37 on 2026-11-20, names one exactly when it is in
# TESLA_MONITOR_ABOARD_REPORTS). A narrative that negates it ("no safety
# monitor") would read as naming one, and stop the run on an addition: no
# Tesla narrative has done so, and how to read one is undecided (ask the
# human).
SAFETY_MONITOR_PATTERN = re.compile(r"\bsafety\s+monitor\b", re.I)
must(all(isinstance(entry, tuple) and len(entry) == 2
         and isinstance(entry[1], str)
         and re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry[1]) is not None
         for entry in TESLA_NO_MONITOR_ADDITIONS.values()),
     "TESLA_NO_MONITOR_ADDITIONS entries must be (the narrative's words, the "
     "receipt cutoff of the release whose review added the entry, as "
     "YYYY-MM-DD: data/README.md, Each NHTSA release, step 7)")
# Tesla's no-monitor service began Jan 22, 2026; its safety page counts miles
# and crashes from that day, so no report before this month is on the line.
TESLA_NO_MONITOR_FROM = "2026-01"
# Each line the page plots and the company whose reports it uses: each company
# is its own; TeslaNoMonitor is Tesla's subset. Its data/vmt.csv rows
# ("teslanomonitor") carry Tesla's no-monitor miles, and its months count when
# Tesla's do: when NHTSA's file is complete for Tesla, or Tesla's list covers
# the month (month_sources()).
SERIES_COMPANY = {"Waymo": "Waymo", "Tesla": "Tesla", "Zoox": "Zoox",
                  "TeslaNoMonitor": "Tesla"}
# A derived line's member reports: (company, a function giving its reviewed
# Report IDs from the tables that hold them, read at each call, so the line
# holds no copy of them). The no-monitor line's are those on Tesla's latest
# list and the reviewed additions. (Until 2026-11-20 the second item was a
# set, TESLA_NO_MONITOR_REPORTS.)
DERIVED_SERIES_REPORTS = {"TeslaNoMonitor": (
    "Tesla", lambda: TESLA_NO_MONITOR_REPORTS | set(TESLA_NO_MONITOR_ADDITIONS))}
must(not (TESLA_NO_MONITOR_REPORTS & set(TESLA_NO_MONITOR_ADDITIONS)
          or TESLA_NO_MONITOR_REPORTS & set(TESLA_MONITOR_ABOARD_REPORTS)
          or set(TESLA_NO_MONITOR_ADDITIONS) & set(TESLA_MONITOR_ABOARD_REPORTS)),
     "a Tesla report is in two of TESLA_NO_MONITOR_REPORTS (Tesla's list), "
     "TESLA_NO_MONITOR_ADDITIONS and TESLA_MONITOR_ABOARD_REPORTS")
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
    Stops on a listed report dated before TESLA_NO_MONITOR_FROM;
    check_monitor_reviewed() stops on a Tesla report from that month on that
    no table classifies (until 2026-11-20 this function did, one report at a
    time)."""
    must(rid not in TESLA_NO_MONITOR_REPORTS or month >= TESLA_NO_MONITOR_FROM,
         "a report on Tesla's no-monitor list predates that service "
         "(TESLA_NO_MONITOR_FROM; data/README.md, Each NHTSA release, step 7)", reportId=rid, month=month)
    return [helmer] + [series for series, (company, members) in DERIVED_SERIES_REPORTS.items()
                       if company == helmer and rid in members()]


def check_monitor_reviewed(incidents, rows):
    """Stop the run unless every in-scope Tesla report from
    TESLA_NO_MONITOR_FROM on among <incidents> (the records being written) is
    on Tesla's latest list (TESLA_NO_MONITOR_REPORTS) or reviewed
    (TESLA_NO_MONITOR_ADDITIONS, TESLA_MONITOR_ABOARD_REPORTS), every reviewed
    entry names such a report, each reviewed report's narrative passes the
    narrative test (an addition's names no safety monitor, a monitor-aboard
    report's names one: SAFETY_MONITOR_PATTERN), and Tesla's latest list
    (PREPRINT_LIST) holds every addition Tesla had filed by the list's date.
    Tesla had filed an addition by the earlier of its entry's receipt cutoff
    (NHTSA's file held it then) and the end of the month of its first filing
    among <rows> (the validated rows: Report Version 1's Report Submission
    Date, which NHTSA gives as a month). Stops too on an entry whose cutoff is
    after this release's, or before the month of the report's first filing.
    A crash's own month says nothing here: Tesla files some crashes late
    (13781-17193, an Aug 22 crash, in October), and a list dated before the
    filing lacks them."""
    tesla = {r["reportId"]: r for r in incidents
             if r["helmer"] == "Tesla" and nhtsa_month_to_iso(r["date"]) >= TESLA_NO_MONITOR_FROM}
    reviewed = set(TESLA_NO_MONITOR_ADDITIONS) | set(TESLA_MONITOR_ABOARD_REPORTS)
    must(set(tesla) <= TESLA_NO_MONITOR_REPORTS | reviewed and reviewed <= set(tesla),
         "in-scope Tesla reports from TESLA_NO_MONITOR_FROM on that are neither "
         "on Tesla's latest list (TESLA_NO_MONITOR_REPORTS) nor reviewed (read "
         "each narrative and add the report, with the words that say who was "
         "aboard, to TESLA_NO_MONITOR_ADDITIONS with this release's "
         "NHTSA_DATA_THROUGH_DATE if it names no safety monitor, else to "
         "TESLA_MONITOR_ABOARD_REPORTS; a second Tesla robotaxi's record, the "
         "Report ID + \"-B\", has no rule yet: ask the human), or reviewed "
         "entries that name no such report (drop them): data/README.md, Each "
         "NHTSA release, step 7",
         unreviewed=sorted(set(tesla) - TESLA_NO_MONITOR_REPORTS - reviewed),
         stale=sorted(reviewed - set(tesla)))
    misread = sorted(rid for rid in reviewed
                     if (SAFETY_MONITOR_PATTERN.search(tesla[rid]["narrative"]) is not None)
                     != (rid in TESLA_MONITOR_ABOARD_REPORTS))
    must(not misread,
         "reviewed Tesla reports whose narrative fails the narrative test: an "
         "entry of TESLA_NO_MONITOR_ADDITIONS whose narrative names a safety "
         "monitor, or one of TESLA_MONITOR_ABOARD_REPORTS whose narrative names "
         "none (the report was re-filed or misread: re-read it and move or fix "
         "the entry in data/slurp.py; a narrative that names a monitor only to "
         "say none was aboard has no rule yet: ask the human: data/README.md, "
         "Each NHTSA release, step 7)",
         reports=misread)
    first = {r["Report ID"]: r["Report Submission Date"].strip() for r in rows
             if int(r["Report Version"]) == 1}
    unfiled = sorted(rid for rid in TESLA_NO_MONITOR_ADDITIONS if not first.get(rid))
    must(not unfiled,
         "a TESLA_NO_MONITOR_ADDITIONS entry's report has no first filing "
         "(Report Version 1) with a Report Submission Date in NHTSA's file "
         "(read the report in the newest snapshot and ask the human: "
         "data/README.md, Each NHTSA release, step 7)",
         reports=unfiled)
    misdated = sorted(rid for rid, (_words, received) in TESLA_NO_MONITOR_ADDITIONS.items()
                      if not nhtsa_month_to_iso(first[rid]) <= received[:7]
                      or received > NHTSA_DATA_THROUGH_DATE)
    must(not misdated,
         "a TESLA_NO_MONITOR_ADDITIONS entry's receipt cutoff is after this "
         "release's (NHTSA_DATA_THROUGH_DATE) or before the month of its "
         "report's first filing (the cutoff is that of the release whose review "
         "added the entry: data/README.md, Each NHTSA release, step 7)",
         reports=misdated, dataThrough=NHTSA_DATA_THROUGH_DATE)
    through = PREPRINT_LIST["through"]

    def month_end(month):
        """The ISO date of <month>'s last day."""
        return (datetime.date.fromisoformat(month_shift(month, 1) + "-01")
                - datetime.timedelta(days=1)).isoformat()
    filed_by = {rid: min(received, month_end(nhtsa_month_to_iso(first[rid])))
                for rid, (_words, received) in TESLA_NO_MONITOR_ADDITIONS.items()}
    held = sorted(rid for rid, day in filed_by.items() if day <= through)
    must(not held,
         "TESLA_NO_MONITOR_ADDITIONS entries that Tesla's latest list should "
         "hold and does not (Tesla had filed each by the list's date: by its "
         "entry's receipt cutoff or by the end of its first filing's month): "
         "Tesla's list and the review disagree (re-read each narrative and ask "
         "the human: data/README.md, Each NHTSA release, step 7)",
         reports=held, filedBy={rid: filed_by[rid] for rid in held},
         listThrough=through)


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
# below as ADS-driven at impact, with the narrative's words the review rests
# on. Tesla's monitor-aboard mode
# is in scope by design (its deck miles include it), so Tesla is exempt.
# Calibrated 2026-09-26 on every in-scope Waymo/Zoox narrative, all versions:
# exactly 30270-4881 (re-coded above) and 30270-7075 (below).
SAFETY_DRIVER_PATTERN = re.compile(
    r"test driver|safety driver|safety operator|vehicle operator|"
    r"driver'?s seat|seating position|behind the wheel|manual mode|in manual",
    re.I)
# Keyed by Report ID with the narrative's words the review rests on,
# verbatim, and the reason as a comment (until 2026-11-02 the entry held the
# reason; open question 26(b)); check_reviewed_quotes() stops the run when the
# report's latest filing no longer holds the words.
SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN = {
    # manual mode only for the return to the depot after the crash; the AV was
    # driverless at impact (a cyclist struck it)
    "30270-7075": "The Waymo AV did not require towing and was returned to the "
                  "depot in manual mode.",
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


def check_passenger_reviews(filed):
    """Stop the run unless each PASSENGER_OVERRIDE entry among <filed>
    ({Report ID: the "Were All Passengers Belted?" value its report's latest
    filing gives}) was reviewed against that value: a re-filing must be
    re-read, and so must a preprint once NHTSA's row has taken its place (its
    entry was reviewed against the list's blank, the list having no belt
    field). One stop lists every such entry (since 2026-11-21, audit finding
    A46 of 2026-11-20; until then reviewed_belted() stopped on the first, a
    run for each report, and its message named a re-filing only, though at
    the release that publishes the preprints the cause is step 7's)."""
    changed = [{"reportId": rid, "reviewed": PASSENGER_OVERRIDE[rid][0], "filed": value}
               for rid, value in sorted(filed.items())
               if rid in PASSENGER_OVERRIDE and PASSENGER_OVERRIDE[rid][0] != value]
    must(not changed,
         "PASSENGER_OVERRIDE was reviewed against a different filed "
         "passenger value (the report was re-filed, or NHTSA's row has "
         "replaced a preprint, whose entry was reviewed against the list's "
         "blank; re-read its narrative: "
         "data/README.md, Each NHTSA release, step 6, or step 7 for a "
         "replaced preprint)",
         reports=changed)


def reviewed_belted(rid, filed):
    """The passenger code to store for report <rid>, whose filing says
    <filed>: its PASSENGER_OVERRIDE entry if it has one, else <filed>. Stops
    on an entry reviewed against another filed value
    (check_passenger_reviews(), which main() first runs over every incident
    at once)."""
    check_passenger_reviews({rid: filed})
    return PASSENGER_OVERRIDE.get(rid, (filed, filed))[1]


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


def check_airbag_classified(row, crash):
    """Stop the run on an in-scope incident whose narrative mentions an airbag
    (AIRBAG_PATTERN) while its filed "Any Air Bags Deployed?" marks no
    deployment (it holds no "Yes"), until a human classifies its crash's
    report <crash> (the row's own Report ID; for a second AV's row, the report
    that files it, as for the field overrides): an AIRBAG_OVERRIDE entry if
    the narrative says an airbag deployed, else AIRBAG_LANGUAGE_REVIEWED with
    the words that show the filed value stands. <row> is the incident's
    surviving (latest) filing."""
    mentions = [row["Narrative"][max(0, m.start() - 200):m.end() + 100]
                for m in AIRBAG_PATTERN.finditer(row["Narrative"])]
    flagged = len(mentions) > 0 and "Yes" not in row["Any Air Bags Deployed?"]
    must(not flagged or crash in AIRBAG_OVERRIDE or crash in AIRBAG_LANGUAGE_REVIEWED,
         "the narrative mentions an airbag and the filed Any Air Bags Deployed? "
         "marks no deployment (read the narrative; if it says an airbag "
         "deployed, in any vehicle, add an AIRBAG_OVERRIDE entry in "
         "data/slurp.py, else list the report in AIRBAG_LANGUAGE_REVIEWED with "
         "the words that show the filed value stands: data/README.md, Each "
         "NHTSA release, step 6)",
         reportId=crash, filed=row["Any Air Bags Deployed?"].strip(), mentions=mentions)


def check_second_av_classified(row):
    """Stop the run on an in-scope report whose narrative names a second AV
    of its company (SECOND_AV_PATTERN) until a human classifies it: a
    SECOND_INVOLVEMENTS entry if that AV was in the collision, else
    SECOND_AV_REVIEWED with the reason."""
    rid = row["Report ID"]
    flagged = (operator_in_scope(row)
               and SECOND_AV_PATTERN.search(row["Narrative"]) is not None)
    must(not flagged or rid in SECOND_INVOLVEMENTS or rid in SECOND_AV_REVIEWED,
         "the narrative names a second AV of the reporting company (read it: if "
         "that AV was in the collision, add a SECOND_INVOLVEMENTS entry in "
         "data/slurp.py with the words naming it and its own fields, and rate "
         "its record in data/faultfrac.csv under the report's Report ID + "
         f"{SECOND_INVOLVEMENT_SUFFIX!r}; else list the report in "
         "SECOND_AV_REVIEWED with the reason: data/README.md, Each NHTSA "
         "release, step 6)",
         reportId=rid, narrative=row["Narrative"][:300])


def second_involvement_rows(incidents):
    """{Report ID: the second AV's row} for each SECOND_INVOLVEMENTS report
    among <incidents> (public_service_incidents()' surviving filings): the
    report's row with the entry's fields, its contact areas spelled out in
    NHTSA's Y columns, and its own Report ID (the report's +
    SECOND_INVOLVEMENT_SUFFIX). Stops unless every entry names one of
    <incidents> whose narrative holds the entry's quote, and every
    SECOND_AV_REVIEWED entry one whose narrative trips SECOND_AV_PATTERN (an
    entry whose report left scope or whose words changed must be re-read)."""
    by_rid = {r["Report ID"]: r for r in incidents}
    stale = sorted(rid for rid, entry in SECOND_INVOLVEMENTS.items()
                   if rid not in by_rid or entry["quote"] not in by_rid[rid]["Narrative"])
    stale += sorted(rid for rid in SECOND_AV_REVIEWED
                    if rid not in by_rid or not SECOND_AV_PATTERN.search(by_rid[rid]["Narrative"]))
    must(not stale,
         "a SECOND_INVOLVEMENTS or SECOND_AV_REVIEWED entry in data/slurp.py "
         "names a report that is not in scope, or whose latest narrative no "
         "longer holds the entry's words (re-read the report and update or "
         "drop the entry: data/README.md, Each NHTSA release, step 6)",
         reports=stale)
    rows = {}
    for rid, entry in SECOND_INVOLVEMENTS.items():
        second = dict(by_rid[rid])
        second.update((column, entry[column]) for column in SECOND_INVOLVEMENT_COLUMNS)
        second.update((f"{prefix} - {label}", "Y" if label in entry[prefix] else "")
                      for prefix in SECOND_INVOLVEMENT_CONTACTS for label in CONTACT_AREA_LABELS)
        second["Report ID"] = rid + SECOND_INVOLVEMENT_SUFFIX
        rows[rid] = second
    return rows


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


def reviewed_quotes():
    """{table name: {Report ID: the narrative words the entry quotes}} for the
    reviewed tables whose entries rest on a report's own words: which reports
    a remote human drove (TELEOP_DRIVEN_REPORTS), which ones the ADS drove
    though their narrative trips a tripwire (REMOTE_LANGUAGE_ADS_DRIVEN,
    SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN), whose filed passenger code stands
    against their narrative (OCCUPANCY_LANGUAGE_REVIEWED), how many
    vehicles a crash involved (VEHICLES_INVOLVED, the words of its (count,
    words) entries), whether a Tesla report Tesla's latest list does not
    hold had a safety monitor aboard (TESLA_NO_MONITOR_ADDITIONS,
    TESLA_MONITOR_ABOARD_REPORTS; since 2026-11-20), and whose filed airbag
    value stands though their narrative mentions an airbag
    (AIRBAG_LANGUAGE_REVIEWED; since 2026-11-21)."""
    return {"TELEOP_DRIVEN_REPORTS": TELEOP_DRIVEN_REPORTS,
            "REMOTE_LANGUAGE_ADS_DRIVEN": REMOTE_LANGUAGE_ADS_DRIVEN,
            "SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN": SAFETY_DRIVER_LANGUAGE_ADS_DRIVEN,
            "OCCUPANCY_LANGUAGE_REVIEWED": OCCUPANCY_LANGUAGE_REVIEWED,
            "VEHICLES_INVOLVED": {rid: words for rid, (_count, words)
                                  in VEHICLES_INVOLVED.items()},
            "TESLA_NO_MONITOR_ADDITIONS": {rid: words for rid, (words, _received)
                                           in TESLA_NO_MONITOR_ADDITIONS.items()},
            "TESLA_MONITOR_ABOARD_REPORTS": TESLA_MONITOR_ABOARD_REPORTS,
            "AIRBAG_LANGUAGE_REVIEWED": AIRBAG_LANGUAGE_REVIEWED}


must(all(isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], int)
         and v[0] >= 1 for v in VEHICLES_INVOLVED.values()),
     "VEHICLES_INVOLVED entries must be (the vehicles involved, the "
     "narrative's words that give the count)")
must(all(isinstance(words, str) and words
         for table in reviewed_quotes().values() for words in table.values()),
     "a reviewed entry must quote its report's narrative words (a non-empty "
     "string: an empty one is in every narrative)")


def check_reviewed_quotes(rows):
    """Stop the run unless each entry of the reviewed tables that rest on a
    report's words (reviewed_quotes()) quotes words that are in its report's
    latest filed narrative (<rows>): the review rests on those words, so a
    re-filing that drops them must be re-read before the entry applies again
    (TELEOP_DRIVEN_REPORTS since 2026-10-31, open question 10's
    reviewed-value rule for the table that takes reports out of scope; the
    next three and VEHICLES_INVOLVED since 2026-11-02, open question 26(b)
    and (c); the two Tesla monitor tables since 2026-11-20, audit finding A1;
    AIRBAG_LANGUAGE_REVIEWED since 2026-11-21, audit finding A7)."""
    latest = latest_filings(rows)
    stale = {name: sorted(rid for rid, words in table.items()
                          if rid not in latest or words not in latest[rid]["Narrative"])
             for name, table in reviewed_quotes().items()}
    must(not any(stale.values()),
         "a reviewed entry's quoted words are not in its report's latest filed "
         "narrative (the report was re-filed or is gone: re-read it and "
         "update or drop the entry in data/slurp.py: data/README.md, Each "
         "NHTSA release, step 6, or step 7 for TESLA_NO_MONITOR_ADDITIONS and "
         "TESLA_MONITOR_ABOARD_REPORTS)",
         stale=stale)


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


def camera_day_label(day):
    """A day's label in a Camera watch table (CAMERA_TABLE): "Thu, Nov 19 (UTC)"."""
    return (f"{CAMERA_TABLE['weekdays'][day.weekday()]}, "
            f"{CAMERA_TABLE['months'][day.month - 1]} {day.day} (UTC)")


def camera_table_days(text, saved_on, source):
    """The days of a Camera watch table (CAMERA_TABLE) that a person copied on
    the local date <saved_on>, newest first: [(date, {column: its value, or
    None where the table shows CAMERA_TABLE's dash})]. <source> names the text
    in a stop. Stops, saying what is wrong, unless <text> is exactly such a
    table: the header line; one line per UTC day, newest first, with no day
    missing or repeated and a cell for each column; the newest day on or
    before <saved_on> and less than a year before it (which gives its year,
    and so every day's: each label's weekday is checked against it); each
    value a plain decimal (digits, then a point and digits or nothing) or the
    dash, a column's dashes only on its oldest days (its days before its
    detector started, as the caption says: a dash after a day with a value,
    a detector that stopped or a day the site left out, has no rule here);
    and the caption as the last line, with nothing after it (not even a line
    end). A table read from a file keeps its bytes: a carriage return is no
    line end."""
    t = CAMERA_TABLE
    lines = text.split("\n")
    must(lines[0] == "\t".join(t["header"]),
         f"{source}: its first line is not the camera table's header (if Robotaxi "
         "Tracker has changed its table, CAMERA_TABLE in data/slurp.py and the "
         "quals that read it change with the human)",
         line=lines[0], header="\t".join(t["header"]))
    must(len(lines) > 2 and lines[-1] == t["caption"],
         f"{source}: its last line is not the camera table's caption, or no day "
         "stands between the header and the caption",
         last=lines[-1], caption=t["caption"], lines=len(lines))
    rows = [line.split("\t") for line in lines[1:-1]]
    for i, row in enumerate(rows):
        must(len(row) == len(t["header"]),
             f"{source}: a day's line does not hold one cell per column",
             line=i + 2, day=row[0], cells=len(row), columns=len(t["header"]))
    # The newest day: the one day on or before the save date, less than a year
    # before it, whose label is the first line's (a label comes back only a
    # year later, and then with another weekday).
    recent = {camera_day_label(saved_on - datetime.timedelta(days=k)):
              saved_on - datetime.timedelta(days=k) for k in range(365)}
    newest = recent.get(rows[0][0])
    must(newest is not None,
         f"{source}: its newest day is no day on or before the save date and less "
         "than a year before it, with that weekday",
         day=rows[0][0], saved_on=saved_on.isoformat())
    days = []
    for i, row in enumerate(rows):
        day = newest - datetime.timedelta(days=i)
        must(row[0] == camera_day_label(day),
             f"{source}: its days do not run back one at a time from the newest "
             "(a day out of order, missing or repeated, or a wrong weekday)",
             line=i + 2, day=row[0], expected=camera_day_label(day))
        cells = dict(zip(t["header"][1:], row[1:]))
        for column, cell in cells.items():
            must(cell == t["dash"] or re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", cell),
                 f"{source}: a value is neither a plain decimal nor {t['dash']}",
                 line=i + 2, day=row[0], column=column, value=cell)
        days.append((day, {column: None if cell == t["dash"] else float(cell)
                           for column, cell in cells.items()}))
    # Newest first, a column's days with a value come before its dashes, and
    # none after them.
    for column in t["header"][1:]:
        valued = [values[column] is not None for _day, values in days]
        must(valued == sorted(valued, reverse=True),
             f"{source}: a {t['dash']} in its {column} column comes after a day with "
             f"a value (a column's {t['dash']} marks its days before its detector "
             "started, its oldest)",
             column=column, dashes=[day.isoformat() for day, values in days if values[column] is None])
    return days


def camera_week_means(days):
    """CAMERA_TABLE's rate column averaged over each whole Monday-Sunday week of
    <days> (camera_table_days()), one with a value on all seven of its days,
    rounded to four decimals: {its Monday (ISO): (mean, days averaged)}. A week
    the table holds only part of, or with a day before the detector started
    (only a table's oldest days can be such), is left out."""
    weeks = {}
    for day, values in sorted(days, key=lambda d: d[0]):
        weeks.setdefault(day - datetime.timedelta(days=day.weekday()), []).append(
            values[CAMERA_TABLE["rate"]])
    return {monday.isoformat(): (round(sum(rates) / len(rates), 4), len(rates))
            for monday, rates in weeks.items() if len(rates) == 7 and None not in rates}


def newest_camera_table():
    """The newest Camera watch table saved in data/snapshots, by the date in its
    name: (its path, that date, its text, its days: camera_table_days()).
    Stops on a saved table whose name is not <prefix>-YYYYMMDD.tsv."""
    paths = sorted(SNAPSHOT_DIR.glob(f"{CAMERA_TABLE['prefix']}-*.tsv"))
    must(paths,
         "no camera table saved in data/snapshots (data/README.md, Snapshot "
         "storage policy)",
         pattern=f"{CAMERA_TABLE['prefix']}-*.tsv", directory=relpath(SNAPSHOT_DIR))
    named = re.compile(rf"{re.escape(CAMERA_TABLE['prefix'])}-([0-9]{{8}})\.tsv")
    odd = [path.name for path in paths if not named.fullmatch(path.name)]
    must(not odd,
         "a saved camera table is not named for the date it was saved "
         f"({CAMERA_TABLE['prefix']}-YYYYMMDD.tsv), so which is the newest is not "
         "known", names=odd)
    path = paths[-1]
    saved_on = datetime.datetime.strptime(named.fullmatch(path.name)[1], "%Y%m%d").date()
    text = path.read_bytes().decode("utf-8")
    return path, saved_on, text, camera_table_days(text, saved_on, relpath(path))


def camera_table_step(terminal, run, ask, which, today):
    """Save Robotaxi Tracker's newest Camera watch table (CAMERA_TABLE), which a
    person copies from the page in their own browser. It runs at the end of a
    slurp run (the __main__ block), after main() has written its files, never
    inside main(), which the quals run; a stop here leaves only the table
    unsaved. <terminal>: whether stdin and stdout are both terminals, a person
    running slurp by hand; <run>, <ask>, <which>: subprocess.run, input and
    shutil.which; <today>: the local date, which names the saved file. When
    stdin or stdout is not a terminal (an agent's or a script's run) it prints
    how a person saves the table, and opens, reads and writes nothing. In a
    terminal it checks that open and pbpaste exist and that a table is saved,
    then asks before it opens anything: Enter goes on, "skip" opens, reads and
    saves nothing, and any other answer stops (so a terminal no person types
    into, an agent's, stops at the question, or waits there, before any
    request). It then opens the page with macOS's open, waits for Enter once
    the person has copied the table (any other answer stops), reads the
    clipboard with pbpaste in CAMERA_TABLE's locale, checks it (UTF-8, and
    camera_table_days()) and saves its bytes as
    data/snapshots/<prefix>-YYYYMMDD.tsv only when they differ from the newest
    saved table, and never over a saved table (a different copy the same day
    stops). It then prints the days whose values changed or that are gone,
    and the whole weeks whose mean is new, changed or gone: Tesla's
    camera-estimated rows in data/vmt.csv rest on those means."""
    t = CAMERA_TABLE
    target = SNAPSHOT_DIR / f"{t['prefix']}-{today:%Y%m%d}.tsv"
    print(f"\nRobotaxi Tracker's camera table ({t['url']}; data/README.md, Ghost months):")
    if not terminal:
        print("  Not run in a terminal (stdin or stdout is not one), so nothing was "
              "opened, read or saved. A person saves the table, never a script or an "
              "agent (the site's terms forbid scraping): run python3 data/slurp.py in "
              "a terminal, or at the repo's root run")
        print(f"  (set -C && echo 'Press Enter to open {t['url']} in your browser.' && read && "
              f"open {t['url']} && echo '{t['instruction']}' && read && "
              f"LC_ALL={t['locale']} pbpaste > {relpath(SNAPSHOT_DIR)}/{t['prefix']}-$(date +%Y%m%d).tsv)")
        return
    missing = [name for name in ("open", "pbpaste") if which(name) is None]
    must(not missing,
         "the camera step needs macOS's open and pbpaste, to open the page in your "
         "browser and read the table you copy; nothing was opened or saved",
         missing=missing)
    previous, _previous_on, previous_text, previous_days = newest_camera_table()
    answer = ask(f"  Press Enter to open {t['url']} in your browser and save its table, "
                 "or type skip and press Enter to save nothing: ")
    must(answer in ("", "skip"),
         "answer the camera step with Enter or skip; nothing was opened, read or saved",
         answer=answer)
    if answer == "skip":
        print("  Skipped: nothing was opened, read or saved.")
        return
    run(["open", t["url"]], check=True)
    answer = ask(f"  The page is open in your browser. {t['instruction']} ")
    must(answer == "",
         "answer the camera step's second question with Enter once the table is "
         "copied; nothing was read or saved",
         answer=answer)
    raw = run(["pbpaste"], capture_output=True, check=True,
              env={**os.environ, "LC_ALL": t["locale"]}).stdout
    # "replace" only lets the check below say what is wrong: a byte that is not
    # UTF-8 comes back from the round trip as another.
    text = raw.decode("utf-8", "replace")
    must(text.encode("utf-8") == raw,
         f"the clipboard's text is not UTF-8 (pbpaste reads it in LC_ALL={t['locale']}); "
         "nothing was saved",
         clipboard=raw[:120])
    days = camera_table_days(text, today, "the clipboard's camera table (nothing was saved)")
    if text == previous_text:
        print(f"  Unchanged since {relpath(previous)}: nothing saved.")
        return
    must(days[0][0] >= previous_days[0][0],
         "the clipboard's camera table ends before the newest saved one (an older "
         "copy?); nothing was saved",
         clipboard_newest=days[0][0].isoformat(),
         saved_newest=previous_days[0][0].isoformat(), saved=relpath(previous))
    must(target.name > previous.name,
         "a camera table is saved for today or a later date already, and a saved "
         "table is never replaced (copy the table again another day); nothing was "
         "saved",
         today=today.isoformat(), saved=relpath(previous))
    target.write_bytes(raw)
    # What moved: each day of the saved table whose line differs in the new one
    # (the site can reprocess its days) or is gone from it, and each whole week
    # whose mean is new, changed or gone.
    old_lines = {line.split("\t")[0]: line for line in previous_text.split("\n")[1:-1]}
    new_lines = {line.split("\t")[0]: line for line in text.split("\n")[1:-1]}
    changed = [f"{old_lines[day]} -> {new_lines.get(day, '(no longer in the table)')}".replace("\t", "  ")
               for day in old_lines if new_lines.get(day) != old_lines[day]]
    old_weeks, new_weeks = camera_week_means(previous_days), camera_week_means(days)

    def mean(weeks, monday):
        return f"{weeks[monday][0]:.4f}" if monday in weeks else "none"
    weeks = [f"week of {monday}: {mean(old_weeks, monday)} -> {mean(new_weeks, monday)}"
             for monday in sorted(set(old_weeks) | set(new_weeks))
             if old_weeks.get(monday) != new_weeks.get(monday)]
    print(f"  Saved {relpath(target)} ({days[-1][0]} to {days[0][0]}), against "
          f"{relpath(previous)} ({previous_days[-1][0]} to {previous_days[0][0]}).")
    print("  Days whose values changed: " + ("".join("\n    " + line for line in changed) or "none"))
    print(f"  Whole Monday-Sunday weeks whose {t['rate']} mean is new, changed or gone: "
          + ("; ".join(weeks) or "none"))
    print("  Tesla's camera-estimated rows in data/vmt.csv rest on these weekly means: "
          "redo the rows they move (data/README.md, Ghost months, the Tesla bullet). "
          "quals/tesla-camera-miles.qual.mjs recomputes every camera-estimated Tesla "
          "row (the months in its MONTHS, which must name each) and fails until they "
          "match; quals/assumptions-list.qual.mjs reads the newest table too "
          "(crashla.js ASSUMPTIONS' camera entries).")


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
    # The preprints: the company list's rows NHTSA's files do not hold
    # (PREPRINT_LIST). They take every check below as NHTSA's rows do;
    # release_rows, from which the newest submission month is read, stays
    # NHTSA's alone, and so do the Monthly-report arrival counts.
    preprints = preprint_rows(rows)
    nhtsa_last_modified, _etag = nhtsa_headers[NHTSA_ADS_CSV_URL]
    nhtsa_modified_date = modified_date_from_last_modified(nhtsa_last_modified)

    # Anti-Postel: fail loud on unexpected field values.
    valid_rows = []
    for i, r in enumerate(rows + preprints):
        rt = r["Report Type"].strip()
        must(rt in EXPECTED_REPORT_TYPES,
             "unexpected Report Type (classify it in EXPECTED_REPORT_TYPES in "
             "data/slurp.py: data/README.md, Each NHTSA release, step 6)",
             row=i, value=rt, expected=sorted(EXPECTED_REPORT_TYPES))
        if rt in NEGATIVE_FILING_TYPES:
            continue  # a filing that reports no crash
        iid = r["Same Incident ID"].strip()
        idate = r["Incident Date"].strip()
        driver = r["Reporting Entity"].strip()
        must(driver not in HELMER_SHORT or (iid and idate),
             "a Waymo, Tesla or Zoox crash report with no Same Incident ID or "
             "Incident Date (it would count nowhere: read it in the newest "
             "snapshot and ask what NHTSA's file is missing before going on: "
             "data/README.md, Each NHTSA release, step 6)",
             row=i, reportId=r["Report ID"], version=r["Report Version"],
             sameIncidentId=iid, incidentDate=idate)
        if not iid or not idate:
            # Another company's crash report missing either field (12 in the
            # archive file, among them Mobileye 33175-9303 to -9307): never in
            # scope, so it stays out
            continue
        dt = r["Driver / Operator Type"].strip()
        must(dt in EXPECTED_DRIVER_TYPES,
             "unexpected Driver / Operator Type (classify it in "
             "EXPECTED_DRIVER_TYPES in data/slurp.py: data/README.md, Each "
             "NHTSA release, step 6)",
             row=i, value=dt, expected=sorted(EXPECTED_DRIVER_TYPES))
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
        check_second_av_classified(r)
        sev = r["Highest Injury Severity Alleged"].strip()
        must(sev in EXPECTED_SEVERITIES,
             "unexpected Highest Injury Severity Alleged (classify it in "
             "EXPECTED_SEVERITIES in data/slurp.py and in crashla.js's "
             "SEVERITY_INFO: data/README.md, Each NHTSA release, step 6)",
             row=i, value=sev, expected=sorted(EXPECTED_SEVERITIES))
        road = r["Roadway Type"].strip()
        must(road in ROADWAY_CLASS,
             "unexpected Roadway Type (read the reports that file it and give "
             "it its class, road or parking, in ROADWAY_CLASS in "
             "data/slurp.py: data/README.md, Each NHTSA release, step 6)",
             row=i, reportId=r["Report ID"], value=road,
             expected=sorted(ROADWAY_CLASS))
        must(INCIDENT_DATE_RE.match(idate),
             "unexpected Incident Date format (data/README.md, Each NHTSA release, step 6)",
             row=i, value=idate)
        abbr = idate.split("-")[0]
        must(abbr in MONTH_ABBR_TO_NUM,
             "unknown month abbreviation in Incident Date (data/README.md, Each NHTSA release, step 6)",
             row=i, value=idate)
        sub = r["Report Submission Date"].strip()
        if sub:
            must(SUBMISSION_DATE_RE.match(sub),
                 "unexpected Report Submission Date format (data/README.md, Each NHTSA release, step 6)",
                 row=i, value=sub)
            sub_abbr = sub.split("-")[0]
            must(sub_abbr in MONTH_ABBR_TO_NUM,
                 "unknown month abbreviation in Submission Date (data/README.md, Each NHTSA release, step 6)",
                 row=i, value=sub)
        ver = r["Report Version"].strip()
        must(ver.isdigit() and int(ver) >= 1,
             "Report Version must be positive integer (data/README.md, Each NHTSA release, step 6)",
             row=i, value=ver)
        valid_rows.append(r)
    rows = valid_rows
    check_superseded_reviewed(rows)
    check_reviewed_quotes(rows)

    # Deduplicate by Report ID over every filed row, filter the surviving
    # versions to each entity's public-service operator types (see
    # PUBLIC_SERVICE_OPERATOR_TYPES), then keep one report per Same Incident
    # ID: public_service_incidents(), the one deduplication every count uses.
    # Then every AV involved, keyed by Report ID: each incident's surviving
    # filing, and the second AV of each crash one report files for two
    # (SECOND_INVOLVEMENTS; decision #47). An entry's "_crash" is the report
    # whose crash-level fields and overrides its record takes, its "_fields"
    # what the record adds: `preprint` on a company list's row (PREPRINT_LIST),
    # `secondOf` on a second AV. The Monthly-report arrival counts read
    # NHTSA's filings themselves (they measure when reports arrive).
    in_scope = public_service_incidents(rows)
    by_incident = {r["Report ID"]: {
        "_row": r, "_crash": r["Report ID"],
        "_fields": {"preprint": True} if r["Report Type"].strip() == PREPRINT_REPORT_TYPE else {}}
        for r in in_scope.values()}
    for rid, second in second_involvement_rows(in_scope.values()).items():
        by_incident[second["Report ID"]] = {"_row": second, "_crash": rid,
                                            "_fields": {"secondOf": rid}}

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
    check_data_through_month(NHTSA_DATA_THROUGH_DATE, last_month)
    # The Monthly-report arrival tables, checked against this release: each
    # helmer's lag decides which of its months are complete (month_sources()).
    check_monthly_arrivals(
        monthly_track_counts([r for r in rows if r["Report Type"].strip() != PREPRINT_REPORT_TYPE]),
        last_month)
    # Which line-months enter the rates: those NHTSA's file completes and
    # those the company list covers; the rest at or before the data-through
    # month are pending. Their rows go in data/vmt.js's two segments: the
    # analysis rows, and the pending rows with the ghost months' (the master's
    # months after the data-through month, which ghost_vmt_csv() checks).
    list_cov = preprint_coverage(vmt_values)
    sources = month_sources(vmt_values, last_month, list_cov)
    run_month = f"{run_stamp[:4]}-{run_stamp[4:6]}"
    ghost_text = ghost_vmt_csv(vmt_raw, last_month, run_month, set(sources))

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

    # Every PASSENGER_OVERRIDE entry reviewed against another filed value, in
    # one stop, before the loop below reads each incident's (reviewed_belted()).
    check_passenger_reviews({entry["_row"]["Report ID"].strip():
                             entry["_row"]["Were All Passengers Belted?"].strip()
                             for entry in window_by_incident.values()})
    incidents = []
    for iid, entry in window_by_incident.items():
        r = entry["_row"]
        # The report whose crash this is: the crash-level overrides (airbag,
        # severity, place, vehicles involved) are keyed by it
        crash = entry["_crash"]
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
        # The speed as a number, None where the filing gives none (the page's
        # "unknown" bin, which counts as nonstationary). Any other value
        # stops the run: until 2026-11-21 it was stored as None too, so a
        # stopped AV's speed filed as "0.0" would have entered both
        # nonstationary metrics (audit finding A23 of 2026-11-20). No row of
        # any file in data/snapshots, of any company, files one (every speed
        # there is blank or a whole number), and list_row() holds a company
        # list's speed to a whole number already.
        must(re.fullmatch(r"[0-9]*", rec["speed"]) is not None,
             "SV Precrash Speed (MPH) is neither blank nor a whole number of "
             "miles per hour (the page reads a missing speed as unknown, which "
             "counts as nonstationary: read the report in the newest snapshot "
             "and ask the human how to store its speed: data/README.md, Each "
             "NHTSA release, step 6)",
             reportId=rid, value=rec["speed"])
        rec["speed"] = None if rec["speed"] == "" else int(rec["speed"])
        # Convert airbag field to boolean (any vehicle deployment), or store
        # the reviewed AIRBAG_OVERRIDE value
        filed_airbag = rec["airbagAny"]
        reviewed_airbag, rec["airbagAny"] = AIRBAG_OVERRIDE.get(
            crash, (filed_airbag, "Yes" in filed_airbag))
        must(reviewed_airbag == filed_airbag,
             "AIRBAG_OVERRIDE was reviewed against a different filed Any Air "
             "Bags Deployed? (the report was re-filed; re-read its narrative "
             "and update the entry in data/slurp.py: data/README.md, Each "
             "NHTSA release, step 6)",
             reportId=rid, reviewed=reviewed_airbag, filed=filed_airbag)
        check_airbag_classified(r, crash)
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
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(crash, (2, None))[0]
        filed_severity = rec["severity"]
        reviewed_severity, rec["severity"] = SEVERITY_OVERRIDE.get(
            crash, (filed_severity, filed_severity))
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
            crash, (filed_loc, filed_loc))
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
        # A severity and a narrative too (since 2026-11-21, audit finding A23
        # of 2026-11-20): the page refuses a record with no severity, so one
        # written here left it showing only its error banner, and a blank
        # narrative passes every narrative review above unread. (A blank
        # Roadway Type stops the validation loop: ROADWAY_CLASS.) No in-scope
        # filing in data/snapshots has either blank.
        must(rec["severity"] and rec["narrative"],
             "in-scope incident with a blank severity or narrative (the page "
             "refuses a record with no severity, and a blank narrative passes "
             "every narrative review unread: read the report in the newest "
             "snapshot; a blank severity takes a SEVERITY_OVERRIDE entry in "
             "data/slurp.py from its narrative, as an Unknown one does; a "
             "blank narrative has no rule: ask the human: data/README.md, "
             "Each NHTSA release, step 6)",
             reportId=rid, severity=rec["severity"], narrative=rec["narrative"][:300])
        # The occupancy tripwire reads the crash's own report: its narrative
        # against its filed code. A second AV's record (SECOND_INVOLVEMENTS)
        # carries that report's narrative, which speaks of the reporting AV's
        # passengers (30270-11224: "The passenger in the moving Waymo AV was
        # not belted", the stopped Waymo's own code Unknown), under the
        # passenger code its reviewed entry gives, so its report is read again
        # here, not its own row (since 2026-11-21, when the tripwire took in
        # "not belted"; until then no second AV's narrative tripped it).
        check_occupancy_classified(by_incident[crash]["_row"])
        rec["belted"] = reviewed_belted(rid, rec["belted"])
        rec["series"] = incident_series(rec["helmer"], rid, nhtsa_month_to_iso(rec["date"]))
        rec.update(entry["_fields"])
        incidents.append(rec)
    check_passengers_reviewed(incidents)
    check_monitor_reviewed(incidents, rows)
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
         "in-scope incidents with no data/faultfrac.csv row (run python3 "
         "data/faultrate.py, which has the blind raters rate each from the "
         "newest snapshot and writes its row: data/README.md, Each NHTSA "
         "release, step 5)",
         count=len(unrated), reports=[r["Report ID"] for r in unrated])

    # Sort by helmer then date (ISO month sorts lexicographically)
    incidents.sort(key=lambda r: (
        r["helmer"],
        nhtsa_month_to_iso(r["date"]),
        r["time"],
    ))

    check_series_have_vmt(incidents, vmt_values)
    # The records the rates count, and the pending ones: the in-scope
    # incidents of pending line-months, and the crashes of a list-covered
    # month that the list lacks (record_counted()). Both arrays are written:
    # the pending records have had every check and rating above, so nothing
    # changes for them at the release that completes their month.
    counted = [rec for rec in incidents if record_counted(rec, sources)]
    pending = [rec for rec in incidents if not record_counted(rec, sources)]

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(counted, indent=2) + "\n"
    pending_json = "\n" + json.dumps(pending, indent=2) + "\n"
    vmt_text = build_vmt_csv(
        vmt_raw, sources, list_cov,
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
    # The page's copy of ROADWAY_CLASS, each Roadway Type's class.
    inc_js = inject(inc_js,
                    "/* ROADWAY_CLASS_START */", "/* ROADWAY_CLASS_END */",
                    "\n" + json.dumps(ROADWAY_CLASS, indent=2) + "\n")
    inc_js = inject(inc_js,
                    "/* INCIDENT_DATA_START */", "/* INCIDENT_DATA_END */",
                    incident_json)
    inc_js = inject(inc_js,
                    "/* PENDING_INCIDENT_DATA_START */", "/* PENDING_INCIDENT_DATA_END */",
                    pending_json)
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
    counts = Counter(r["helmer"] for r in counted)
    total = len(counted)
    print(f"NHTSA file last modified: {nhtsa_modified_date}")
    print(f"NHTSA incident data through: {NHTSA_DATA_THROUGH_DATE}")
    pending_months = sorted(f"{line} {month}" for line, month in vmt_values
                            if month <= last_month and (line, month) not in sources)
    print(f"Pending line-months (reports still arriving; VMT drawn faded, in no rate): {', '.join(pending_months) or 'none'}")
    listed_months = sorted(f"{line} {month}" for (line, month), source in sources.items() if source == "list")
    print(f"Line-months the company list covers (through {PREPRINT_LIST['through']}): {', '.join(listed_months) or 'none'}")
    ghost_months = sorted({month for _line, month in vmt_values if month > last_month})
    print(f"Ghost months (VMT drawn faded, in no rate): {', '.join(ghost_months)}")
    print(f"Updated {relpath(INCIDENT_JS)} and {relpath(VMT_JS)}")
    print(f"Total incidents: {total}")
    for helmer, n in counts.most_common():
        print(f"  {helmer}: {n}")
    print(f"Pending incidents (listed, counted on no line): {len(pending)}")
    for helmer, n in Counter(r["helmer"] for r in pending).most_common():
        print(f"  {helmer}: {n}")

    # Passenger occupancy summary per helmer
    print("\nPassenger occupancy at time of incident:")
    for helmer in sorted(counts):
        co_incidents = [r for r in counted if r["helmer"] == helmer]
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
    # After main(), never inside it (the quals run main() offline): a person
    # running slurp by hand saves Robotaxi Tracker's newest camera table once
    # they answer the step's first question, and any other run only says how
    # (CAMERA_TABLE).
    camera_table_step(terminal=sys.stdin.isatty() and sys.stdout.isatty(),
                      run=subprocess.run, ask=input, which=shutil.which,
                      today=datetime.date.today())

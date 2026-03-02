#!/usr/bin/env python3
"""Preprocess NHTSA SGO crash data CSV into inline data for the web tool.

Fetches the ADS incident CSV from NHTSA, filters to Driver/Operator Type =
"None", deduplicates by Same Incident ID (keeping highest Report Version), and
injects the data into incidents.js and vmt.js (between marker comments).
"""

import csv
import datetime
import io
import json
import math
import urllib.request
from collections import Counter

NHTSA_ADS_CSV_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/"
    "SGO-2021-01_Incident_Reports_ADS.csv"
)
NHTSA_ADS_ARCHIVE_URL = (
    "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/Archive-2021-2025/"
    "SGO-2021-01_Incident_Reports_ADS.csv"
)
INCIDENT_JS = "incidents.js"
VMT_JS      = "vmt.js"
VMT_SHEET_ID = "1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w"
VMT_SHEET_GID = "844581871"
VMT_SHEET_URL = (
    f"https://docs.google.com/spreadsheets/d/{VMT_SHEET_ID}/export"
    f"?format=csv&gid={VMT_SHEET_GID}"
)
FAULT_INPUTS = {
    "claude": "faultfrac-claude.csv",
    "codex": "faultfrac-codex.csv",
    "gemini": "faultfrac-gemini.csv",
}

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
]

# Shorter keys for the JSON output (greppable, pronounceable jargon)
KEY_MAP = {
    "Report ID":                     "reportId",
    "Report Version":                "version",
    "Reporting Entity":              "company",
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
}

# Canonical short names for companies
COMPANY_SHORT = {
    "Waymo LLC":    "Waymo",
    "Tesla, Inc.":  "Tesla",
    "Zoox, Inc.":   "Zoox",
}

# Manual overrides for number of vehicles involved, keyed by Same Incident ID.
# The NHTSA CSV's "Crash With" field is singular and doesn't capture multi-
# vehicle pileups. Default is 2 (the AV + one crash partner). Override here
# when the narrative reveals more vehicles were involved.
VEHICLES_INVOLVED = {
    # Waymo SEP-2025 Tempe fatality: AV + motorcycle + hit-and-run passenger car
    "dc166aecd5b4265": 3,
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


def _normalize_archive_row(row):
    """Add missing current-schema keys to an archive row using column map."""
    for archive_key, current_key in ARCHIVE_COLUMN_MAP.items():
        if current_key not in row and archive_key in row:
            row[current_key] = row[archive_key]
    return row


def fetch_nhtsa_csv():
    """Fetch ADS incident reports from both current and archive CSVs.

    Returns (rows, last_modified_date) where last_modified_date is an
    ISO date string from the HTTP Last-Modified header of the current
    CSV, or None.
    """
    all_rows = []
    lm_date = None
    for url in [NHTSA_ADS_CSV_URL, NHTSA_ADS_ARCHIVE_URL]:
        print(f"Fetching NHTSA ADS CSV from {url} ...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            lm = resp.headers.get("Last-Modified")
            payload = resp.read()
        text = payload.decode("utf-8")
        is_archive = url == NHTSA_ADS_ARCHIVE_URL
        for row in csv.DictReader(io.StringIO(text)):
            if is_archive:
                _normalize_archive_row(row)
            all_rows.append(row)
        if lm and lm_date is None:
            from email.utils import parsedate_to_datetime
            lm_date = parsedate_to_datetime(lm).date().isoformat()
    return all_rows, lm_date


def parse_fault_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    must(len(rows) > 0, "fault csv has no rows", path=path)
    keys = set(rows[0].keys())
    must({"reportID", "faultfrac", "reasoning"} <= keys,
         "fault csv header mismatch", path=path, header=list(keys))
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


def load_fault_models():
    models = {}
    for model, path in FAULT_INPUTS.items():
        models[model] = parse_fault_csv(path)
    ids = set(models["claude"])
    for model in ("codex", "gemini"):
        must(set(models[model]) == ids, "fault model ID sets must match", model=model)
    return models, ids


NHTSA_WINDOW_END   = "2026-01-15"

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


def month_coverage(month_str):
    """Fraction of the month inside the NHTSA observation window.

    Both endpoints are partial: June 15–30 and January 1–15.  VMT is
    pro-rated so that incident counts and miles cover the same window.
    """
    year, mon = int(month_str[:4]), int(month_str[5:7])
    import calendar
    days_in_month = calendar.monthrange(year, mon)[1]
    if month_str == "2026-01":
        return 15 / days_in_month              # Jan 1–15
    return 1.0


def incident_coverage(nhtsa_rows):
    """Compute incident reporting completeness per company-month.

    Under the NHTSA SGO, 5-Day reports are filed within 5 days; Monthly
    reports are due by the 15th of the following month.  If the dataset
    doesn't include submissions from the month AFTER a given incident month,
    Monthly reports for that month are structurally absent.  By Poisson
    thinning, the observed 5-Day count is Poisson(lambda * p * m) where p is
    the fraction of incidents that generate 5-Day reports.  The posterior for
    the full rate uses effective VMT = VMT * p.

    Returns {(company, iso_month): (best, lo, hi)} where best/lo/hi are the
    incident coverage fractions (1.0 for complete months).
    """
    # Determine which submission months are present in the dataset
    submission_months = set()
    for r in nhtsa_rows:
        sub = r["Report Submission Date"].strip()
        if sub:
            submission_months.add(nhtsa_month_to_iso(sub))

    # The last month in the NHTSA window
    end_year, end_mon = int(NHTSA_WINDOW_END[:4]), int(NHTSA_WINDOW_END[5:7])
    last_month = f"{end_year}-{end_mon:02d}"
    # Monthly reports for the last month are due the following month
    next_mon = end_mon + 1
    next_year = end_year
    if next_mon > 12:
        next_mon = 1
        next_year += 1
    monthly_deadline_month = f"{next_year}-{next_mon:02d}"
    # If submissions from the deadline month are absent, Monthly reports for
    # the last month are structurally missing.
    last_month_incomplete = monthly_deadline_month not in submission_months

    if not last_month_incomplete:
        return {}  # all months complete, no adjustments needed

    # Count 5-Day vs total incidents per company-month (post-dedup)
    # We need pre-dedup Report Type info, so work from raw rows filtered to
    # Driver/Operator Type = "None".
    none_rows = [r for r in nhtsa_rows
                 if r["Driver / Operator Type"] == "None"]
    # Dedup: keep highest Report Version per Same Incident ID.
    # For report_type, use the ORIGINAL (v1) classification, since later
    # versions of 5-Day reports have type "Update" but should still count
    # as 5-Day for computing the historical 5-Day fraction.
    by_incident = {}  # iid -> {ver, min_ver, company, month, report_type}
    for r in none_rows:
        iid = r["Same Incident ID"]
        ver = int(r["Report Version"])
        company = COMPANY_SHORT.get(r["Reporting Entity"].strip(),
                                    r["Reporting Entity"].strip())
        month = nhtsa_month_to_iso(r["Incident Date"].strip())
        report_type = r["Report Type"].strip()
        if iid not in by_incident:
            by_incident[iid] = {
                "ver": ver, "min_ver": ver,
                "company": company, "month": month,
                "report_type": report_type,
            }
        else:
            rec = by_incident[iid]
            if ver > rec["ver"]:
                rec["ver"] = ver
                rec["company"] = company
                rec["month"] = month
            if ver < rec["min_ver"]:
                rec["min_ver"] = ver
                rec["report_type"] = report_type

    # Tally 5-Day fraction per company-month
    counts = {}  # (company, month) -> {"five": n, "total": n}
    for rec in by_incident.values():
        # The original (v1) report type must be 5-Day or Monthly.
        # "Update" should only appear on later versions, never on v1.
        # Classify as 5-Day-like (quick) vs Monthly. "Update" and
        # "10-Day Update" appear as v1 in the archive when the original
        # filing predates the archive boundary; treat as quick reports.
        QUICK_TYPES = {"1-Day", "5-Day", "Update", "10-Day Update"}
        is_quick = rec["report_type"] in QUICK_TYPES
        is_monthly = rec["report_type"] == "Monthly"
        must(is_quick or is_monthly,
             "unexpected original report type",
             iid=rec.get("company"), month=rec["month"],
             report_type=rec["report_type"])
        key = (rec["company"], rec["month"])
        if key not in counts:
            counts[key] = {"five": 0, "total": 0}
        counts[key]["total"] += 1
        if is_quick:
            counts[key]["five"] += 1

    # For each company, compute historical 5-Day fraction from complete months
    # (months where Monthly reports are present, i.e., not the last month)
    companies = sorted(set(k[0] for k in counts))
    five_day_fracs = {}  # company -> [frac, ...]
    for company in companies:
        fracs = []
        for (co, mo), c in counts.items():
            if co != company or mo == last_month:
                continue
            has_monthly = c["total"] > c["five"]
            # Only use months with Monthly reports and enough data
            if has_monthly and c["total"] >= 3:
                fracs.append(c["five"] / c["total"])
        five_day_fracs[company] = fracs

    # Only adjust companies whose last-month data is actually missing Monthly
    # reports.  Some companies (e.g., Tesla) file Monthly reports early, so
    # their last-month data may already be approximately complete.
    last_month_has_monthly = {}
    for (co, mo), c in counts.items():
        if mo == last_month:
            last_month_has_monthly[co] = c["total"] > c["five"]

    result = {}
    for company in companies:
        key = (company, last_month)
        if last_month_has_monthly.get(company, False):
            # Company filed Monthly reports for the last month (early filer);
            # treat data as complete.
            result[key] = (1.0, 1.0, 1.0)
            print(f"  {company} {last_month} incident_coverage: 1.0"
                  f" (Monthly reports present)")
            continue
        fracs = five_day_fracs[company]
        if not fracs:
            # No historical data to estimate 5-Day fraction; assume complete
            result[key] = (1.0, 1.0, 1.0)
            print(f"  {company} {last_month} incident_coverage: 1.0"
                  f" (no historical data)")
            continue
        p_best = sum(fracs) / len(fracs)
        p_lo = min(fracs)
        p_hi = max(fracs)
        must(0 < p_lo <= p_best <= p_hi <= 1,
             "5-Day fraction out of range", company=company,
             p_best=p_best, p_lo=p_lo, p_hi=p_hi)
        # incident_coverage = p (the 5-Day fraction); this scales VMT down
        # so the Gamma posterior correctly reflects the thinned observation.
        # lo pairs with vmtMin (pessimistic MPI), hi pairs with vmtMax
        # (optimistic MPI).
        result[key] = (round(p_best, 4), round(p_lo, 4), round(p_hi, 4))
        print(f"  {company} {last_month} incident_coverage:"
              f" best={p_best:.3f} lo={p_lo:.3f} hi={p_hi:.3f}"
              f" (from {len(fracs)} complete months)")

    return result


def fetch_vmt_sheet_csv(inc_cov):
    """Fetch VMT CSV from Google Sheets and add coverage + incident_coverage.

    inc_cov: dict from incident_coverage(), mapping (company, iso_month) to
    (best, lo, hi) tuples.  Missing keys default to (1, 1, 1).
    """
    with urllib.request.urlopen(VMT_SHEET_URL, timeout=30) as resp:
        payload = resp.read()
    text = payload.decode("utf-8")
    lines = text.splitlines()
    must(len(lines) > 1, "VMT sheet CSV must include header and rows")
    must(lines[0] == "company,month,vmt,company_cumulative_vmt,vmt_min,vmt_max,rationale",
         "VMT sheet CSV header mismatch", header=lines[0])
    new_header = lines[0].replace(
        ",rationale",
        ",coverage,incident_coverage,incident_coverage_min,incident_coverage_max,rationale",
    )
    out = [new_header]
    for line in lines[1:]:
        if not line.strip():
            continue
        parts = line.split(",", 6)  # company,month,vmt,cum,min,max,rationale
        company_raw = parts[0].strip()
        company = next(
            (v for k, v in COMPANY_SHORT.items()
             if k.lower().startswith(company_raw.lower())
             or v.lower() == company_raw.lower()),
            company_raw,
        )
        month = parts[1]
        cov = month_coverage(month)
        cov_str = str(round(cov, 3))
        ic_best, ic_lo, ic_hi = inc_cov.get((company, month), (1, 1, 1))
        parts.insert(6, cov_str)
        parts.insert(7, str(ic_best))
        parts.insert(8, str(ic_lo))
        parts.insert(9, str(ic_hi))
        out.append(",".join(parts))
    return "\n".join(out)


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
# All reporting entities in the NHTSA ADS CSV (current + archive).
# Anti-Postel: if NHTSA adds a new company, we want to crash and review.
EXPECTED_COMPANIES = {
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
    "General Motors, LLC",
    "Ghost Autonomy Inc.",
    "Hyundai Motor America",
    "Kia America, Inc.",
    "Kodiak Robotics",
    "Local Motors Industries",
    "Lucid USA, Inc.",
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
INCIDENT_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")
SUBMISSION_DATE_RE = __import__("re").compile(r"^[A-Z]{3}-\d{4}$")


def main():
    rows, nhtsa_modified_date = fetch_nhtsa_csv()
    must(len(rows) > 0, "NHTSA CSV has no rows")

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
        company = r["Reporting Entity"].strip()
        must(company in EXPECTED_COMPANIES,
             "unexpected Reporting Entity", row=i, value=company,
             expected=sorted(EXPECTED_COMPANIES))
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

    fault_models, fault_ids = load_fault_models()

    # Filter to driverless incidents only
    none_rows = [r for r in rows if r["Driver / Operator Type"] == "None"]

    # Dedup: group by Same Incident ID, keep highest Report Version
    by_incident = {}
    for r in none_rows:
        iid = r["Same Incident ID"]
        ver = int(r["Report Version"])
        if iid not in by_incident or ver > by_incident[iid]["_ver"]:
            by_incident[iid] = {"_ver": ver, "_row": r}

    # Filter to VMT window before looking up fault fractions.
    # The archive includes years of data; we only need the analysis window.
    VMT_MONTHS = {
        "JUN-2025", "JUL-2025", "AUG-2025", "SEP-2025",
        "OCT-2025", "NOV-2025", "DEC-2025", "JAN-2026",
    }
    window_by_incident = {}
    excluded_count = 0
    for iid, entry in by_incident.items():
        month = nhtsa_month_to_iso(entry["_row"]["Incident Date"].strip())
        nhtsa_month = entry["_row"]["Incident Date"].strip()
        if nhtsa_month not in VMT_MONTHS:
            excluded_count += 1
            continue
        window_by_incident[iid] = entry
    if excluded_count > 0:
        print(f"  Excluded {excluded_count} incidents outside VMT window")

    incidents = []
    for iid, entry in window_by_incident.items():
        r = entry["_row"]
        rec = {}
        for csv_field in FIELDS:
            key = KEY_MAP[csv_field]
            val = r.get(csv_field, "").strip()
            rec[key] = val
        # Shorten company name
        rec["company"] = COMPANY_SHORT.get(rec["company"], rec["company"])
        # Parse speed as number
        try:
            rec["speed"] = int(rec["speed"])
        except (ValueError, TypeError):
            rec["speed"] = None
        # Convert airbag field to boolean (any vehicle deployment)
        rec["airbagAny"] = "Yes" in rec["airbagAny"]
        rid = rec["reportId"]
        must(rid in fault_ids, "missing fault estimates for report", reportId=rid)
        rec["fault"] = {
            "claude": fault_models["claude"][rid]["faultfrac"],
            "codex": fault_models["codex"][rid]["faultfrac"],
            "gemini": fault_models["gemini"][rid]["faultfrac"],
            "rclaude": fault_models["claude"][rid]["reasoning"],
            "rcodex": fault_models["codex"][rid]["reasoning"],
            "rgemini": fault_models["gemini"][rid]["reasoning"],
        }
        iid_short = rec["incidentId"]
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(iid_short, 2)
        incidents.append(rec)

    incident_ids = {r["reportId"] for r in incidents}
    # Fault CSVs may contain entries for incidents outside the VMT window
    # (e.g., APR-2025). Only check that every incident has fault data.
    missing_fault = incident_ids - fault_ids
    must(len(missing_fault) == 0, "incidents missing fault estimates",
         missing=sorted(missing_fault)[:5])

    # Sort by company then date
    month_order = {
        "JUN-2025": 1, "JUL-2025": 2, "AUG-2025": 3, "SEP-2025": 4,
        "OCT-2025": 5, "NOV-2025": 6, "DEC-2025": 7, "JAN-2026": 8,
    }
    incidents.sort(key=lambda r: (
        r["company"],
        month_order.get(r["date"], 99),
        r["time"],
    ))

    # Compute incident reporting completeness before building VMT CSV.
    # Only use rows from the VMT window to avoid archive history skewing
    # the 5-Day fraction estimates.
    VMT_NHTSA_MONTHS = {"JUN-2025", "JUL-2025", "AUG-2025", "SEP-2025",
                        "OCT-2025", "NOV-2025", "DEC-2025", "JAN-2026"}
    window_rows = [r for r in rows
                   if r.get("Incident Date", "").strip() in VMT_NHTSA_MONTHS]
    inc_cov = incident_coverage(window_rows)

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(incidents, indent=2) + "\n"
    vmt_text = fetch_vmt_sheet_csv(inc_cov).replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    vmt_template = "\n`" + js_template_literal(vmt_text) + "\n`\n"

    def inject(source, start_marker, end_marker, payload):
        """Replace content between marker comments with payload."""
        si = source.index(start_marker)
        ei = source.index(end_marker, si)
        return source[:si] + start_marker + payload + source[ei:]

    fetch_date = datetime.date.today().isoformat()

    with open(INCIDENT_JS) as f:
        inc_js = f.read()
    inc_js = inject(inc_js,
                    "/* NHTSA_FETCH_DATE_START */", "/* NHTSA_FETCH_DATE_END */",
                    f'"{fetch_date}"')
    modified_val = f'"{nhtsa_modified_date}"' if nhtsa_modified_date else "null"
    inc_js = inject(inc_js,
                    "/* NHTSA_MODIFIED_DATE_START */", "/* NHTSA_MODIFIED_DATE_END */",
                    modified_val)
    inc_js = inject(inc_js,
                    "/* INCIDENT_DATA_START */", "/* INCIDENT_DATA_END */",
                    incident_json)
    with open(INCIDENT_JS, "w") as f:
        f.write(inc_js)

    with open(VMT_JS) as f:
        vmt_js = f.read()
    vmt_js = inject(vmt_js,
                    "/* VMT_CSV_START */", "/* VMT_CSV_END */",
                    vmt_template)
    with open(VMT_JS, "w") as f:
        f.write(vmt_js)

    # Summary
    counts = Counter(r["company"] for r in incidents)
    total = len(incidents)
    if nhtsa_modified_date:
        print(f"NHTSA file last modified: {nhtsa_modified_date}")
    print(f"Injected {total} incidents into {INCIDENT_JS} and VMT into {VMT_JS}")
    for company, n in counts.most_common():
        print(f"  {company}: {n}")


if __name__ == "__main__":
    main()

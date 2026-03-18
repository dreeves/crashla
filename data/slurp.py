#!/usr/bin/env python3
"""Slurp live NHTSA SGO crash data into inline data for the web tool.

Fetches current + archive ADS incident CSVs from NHTSA, filters to Driver /
Operator Type = "None", deduplicates by Same Incident ID (keeping highest
Report Version), and injects the data into data/incidents.js and data/vmt.js
(between marker comments).
"""

import csv
import datetime
import io
import json
import math
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
INCIDENT_JS = DATA_DIR / "incidents.js"
VMT_JS      = DATA_DIR / "vmt.js"
VMT_SHEET_ID = "1VX87LYQYDP2YnRzxt_dCHfBq8Y1iVKpk_rBi--JY44w"
VMT_SHEET_GID = "844581871"
VMT_SHEET_URL = (
    f"https://docs.google.com/spreadsheets/d/{VMT_SHEET_ID}/export"
    f"?format=csv&gid={VMT_SHEET_GID}"
)
FAULT_INPUTS = {
    "claude": DATA_DIR / "faultfrac-claude.csv",
    "codex": DATA_DIR / "faultfrac-codex.csv",
    "gemini": DATA_DIR / "faultfrac-gemini.csv",
}
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
    return "+".join(parts)


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

    Returns (rows, last_modified_date) where last_modified_date is an
    ISO date string from the HTTP Last-Modified header of the current
    CSV, or None.
    """
    all_rows = []
    lm_date = None
    snapshot_prefix = {
        NHTSA_ADS_CSV_URL: "nhtsa-current",
        NHTSA_ADS_ARCHIVE_URL: "nhtsa-archive",
    }
    for url in [NHTSA_ADS_CSV_URL, NHTSA_ADS_ARCHIVE_URL]:
        print(f"Fetching NHTSA ADS CSV from {url} ...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            lm = resp.headers.get("Last-Modified")
            payload = resp.read()
        text = payload.decode("utf-8")
        snapshot_csv_if_changed(snapshot_prefix[url], text, stamp)
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


def load_fault_models():
    models = {}
    for model, path in FAULT_INPUTS.items():
        models[model] = parse_fault_csv(path)
    # Union of all model IDs — models may have different sets
    ids = set()
    for model in models:
        ids |= set(models[model])
    return models, ids


def read_fault_csv_rows(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        must(reader.fieldnames == FAULT_CSV_FIELDS,
             "fault csv header mismatch", path=path,
             header=reader.fieldnames, expected=FAULT_CSV_FIELDS)
        return list(reader)


def load_fault_report_ids():
    ids = set()
    for path in FAULT_INPUTS.values():
        rows = read_fault_csv_rows(path)
        must(len(rows) > 0, "fault csv has no rows", path=path)
        ids.update(row["reportID"].strip() for row in rows)
    return ids


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
    for path in FAULT_INPUTS.values():
        sync_fault_csv(path, master_rows)


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


def incident_coverage(nhtsa_rows, last_month):
    """Compute incident reporting completeness per company-month.

    Under the NHTSA SGO, 5-Day reports are filed within 5 days; Monthly
    reports are due by the 15th of the following month.  If the dataset
    doesn't include submissions from the month AFTER a given incident month,
    Monthly reports for that month are structurally absent.  By Poisson
    thinning, the observed 5-Day count is Poisson(lambda * p * m) where p is
    the fraction of incidents that generate 5-Day reports.  The posterior for
    the full rate uses effective VMT = VMT * p.

    last_month: ISO month string (e.g. "2026-02") — the latest month with
    any incident data.  Derived from the data, not hardcoded.

    Returns {(company, iso_month): (best, lo, hi)} where best/lo/hi are the
    incident coverage fractions (1.0 for complete months).
    """
    # Determine which submission months are present in the dataset
    submission_months = set()
    for r in nhtsa_rows:
        sub = r["Report Submission Date"].strip()
        if sub:
            submission_months.add(nhtsa_month_to_iso(sub))

    # Monthly reports for the last month are due the following month
    end_year, end_mon = int(last_month[:4]), int(last_month[5:7])
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

    # For each company, estimate the 5-Day fraction from the single most
    # recent complete month (has Monthly reports, total >= 3).  The fraction
    # trends over time, so older months would bias the estimate.  Wilson
    # score 95% CI gives lo/hi.
    import math
    def wilson_ci(k, n, z=1.96):
        """Wilson score 95% CI for binomial proportion k/n."""
        p_hat = k / n
        denom = 1 + z * z / n
        centre = (p_hat + z * z / (2 * n)) / denom
        spread = z * math.sqrt(
            (p_hat * (1 - p_hat) + z * z / (4 * n)) / n) / denom
        return (round(p_hat, 4),
                round(max(centre - spread, 0.01), 4),
                round(min(centre + spread, 1.0), 4))

    companies = sorted(set(k[0] for k in counts))
    # Find last complete reference month per company
    ref_month = {}  # company -> (month, five, total)
    for company in companies:
        for (co, mo), c in sorted(counts.items(), reverse=True):
            if co != company or mo >= last_month:
                continue
            if c["total"] > c["five"] and c["total"] >= 3:
                ref_month[company] = (mo, c["five"], c["total"])
                break

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
            result[key] = (1.0, 1.0, 1.0)
            print(f"  {company} {last_month} incident_coverage: 1.0"
                  f" (Monthly reports present)")
            continue
        if company not in ref_month:
            result[key] = (1.0, 1.0, 1.0)
            print(f"  {company} {last_month} incident_coverage: 1.0"
                  f" (no reference month)")
            continue
        mo, five, total = ref_month[company]
        p_best, p_lo, p_hi = wilson_ci(five, total)
        # If the company files ~0% as 5-Day (e.g., Tesla), the last month
        # is unobservable via 5-Day reports; treat as complete — the 0
        # observed incidents will produce a wide Gamma posterior naturally.
        if p_best == 0:
            result[key] = (1.0, 1.0, 1.0)
            print(f"  {company} {last_month} incident_coverage: 1.0"
                  f" (0% 5-Day in ref month {mo}: {five}/{total})")
            continue
        must(0 < p_lo <= p_best <= p_hi <= 1,
             "5-Day fraction out of range", company=company,
             p_best=p_best, p_lo=p_lo, p_hi=p_hi)
        result[key] = (p_best, p_lo, p_hi)
        print(f"  {company} {last_month} incident_coverage:"
              f" best={p_best:.3f} lo={p_lo:.3f} hi={p_hi:.3f}"
              f" (from {mo}: {five}/{total})")

    return result


def fetch_vmt_sheet_raw(stamp):
    """Fetch raw VMT CSV text from Google Sheets (and snapshot it)."""
    with urllib.request.urlopen(VMT_SHEET_URL, timeout=30) as resp:
        payload = resp.read()
    text = payload.decode("utf-8")
    snapshot_csv_if_changed("vmt-sheet", text, stamp)
    return text


def parse_vmt_months(raw_text):
    """Parse the set of ISO months from the raw VMT CSV text."""
    months = set()
    for line in raw_text.splitlines()[1:]:  # skip header
        if not line.strip():
            continue
        parts = line.split(",", 2)
        months.add(parts[1].strip())
    return months


def build_vmt_csv(raw_text, inc_cov, active_months):
    """Add coverage + incident_coverage columns to the raw VMT CSV text.

    inc_cov: dict from incident_coverage(), mapping (company, iso_month) to
    (best, lo, hi) tuples.  Missing keys default to (1, 1, 1).
    active_months: set of ISO months to include (months with incident data).
    """
    lines = raw_text.splitlines()
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
        month = parts[1].strip()
        if month not in active_months:
            continue
        cov_str = "1.0"
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
    run_stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    rows, nhtsa_modified_date = fetch_nhtsa_csv(run_stamp)
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

    # Filter to driverless incidents only
    none_rows = [r for r in rows if r["Driver / Operator Type"] == "None"]

    # Dedup: group by Same Incident ID, keep highest Report Version
    by_incident = {}
    for r in none_rows:
        iid = r["Same Incident ID"]
        ver = int(r["Report Version"])
        if iid not in by_incident or ver > by_incident[iid]["_ver"]:
            by_incident[iid] = {"_ver": ver, "_row": r}

    fault_target_ids = load_fault_report_ids()
    fault_master_rows = build_fault_master_rows(
        (entry["_row"] for entry in by_incident.values()),
        fault_target_ids,
    )

    sync_fault_csvs(fault_master_rows)
    fault_models, fault_ids = load_fault_models()

    # Filter to months that have VMT data for any company.
    # The archive includes years of data; we only need months with VMT.
    vmt_raw = fetch_vmt_sheet_raw(run_stamp)
    vmt_months = parse_vmt_months(vmt_raw)

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
    print(f"  Last incident month: {last_month}")

    window_by_incident = {}
    excluded_count = 0
    for iid, entry in by_incident.items():
        month_iso = nhtsa_month_to_iso(entry["_row"]["Incident Date"].strip())
        if month_iso not in vmt_months:
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
        # Compact contact area summaries from NHTSA boolean columns
        rec["svHit"] = _contact_areas(r, "SV Contact Area")
        rec["cpHit"] = _contact_areas(r, "CP Contact Area")
        rid = rec["reportId"]
        if rid in fault_ids:
            rec["fault"] = {
                "claude": fault_models["claude"][rid]["faultfrac"] if rid in fault_models["claude"] else None,
                "codex": fault_models["codex"][rid]["faultfrac"] if rid in fault_models["codex"] else None,
                "gemini": fault_models["gemini"][rid]["faultfrac"] if rid in fault_models["gemini"] else None,
                "rclaude": fault_models["claude"][rid]["reasoning"] if rid in fault_models["claude"] else None,
                "rcodex": fault_models["codex"][rid]["reasoning"] if rid in fault_models["codex"] else None,
                "rgemini": fault_models["gemini"][rid]["reasoning"] if rid in fault_models["gemini"] else None,
            }
        else:
            rec["fault"] = None
        iid_short = rec["incidentId"]
        rec["vehiclesInvolved"] = VEHICLES_INVOLVED.get(iid_short, 2)
        if iid_short in SEVERITY_OVERRIDE:
            rec["severity"] = SEVERITY_OVERRIDE[iid_short]
        incidents.append(rec)

    incident_ids = {r["reportId"] for r in incidents}
    # Every incident with fault data should be in the VMT window.
    # Incidents without fault data (pre-analysis-window) have fault=None.
    incidents_with_fault = {r["reportId"] for r in incidents if r["fault"] is not None}
    missing_fault = incidents_with_fault - fault_ids
    must(len(missing_fault) == 0, "incidents with fault missing from fault CSVs",
         missing=sorted(missing_fault)[:5])

    # Sort by company then date (ISO month sorts lexicographically)
    incidents.sort(key=lambda r: (
        r["company"],
        nhtsa_month_to_iso(r["date"]),
        r["time"],
    ))

    # Compute incident reporting completeness before building VMT CSV.
    # Use rows from vmt_months to estimate 5-Day fraction from recent history.
    window_rows = [r for r in rows
                   if nhtsa_month_to_iso(r.get("Incident Date", "").strip())
                   in vmt_months]
    inc_cov = incident_coverage(window_rows, last_month)

    # Inject data into separate JS files
    incident_json = "\n" + json.dumps(incidents, indent=2) + "\n"
    vmt_text = build_vmt_csv(vmt_raw, inc_cov, vmt_months).replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
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
    print(f"Injected {total} incidents into {relpath(INCIDENT_JS)} and VMT into {relpath(VMT_JS)}")
    for company, n in counts.most_common():
        print(f"  {company}: {n}")

    # Passenger occupancy summary per company
    print("\nPassenger occupancy at time of crash:")
    for company in sorted(counts):
        co_incidents = [r for r in incidents if r["company"] == company]
        n = len(co_incidents)
        with_pax = sum(1 for r in co_incidents
                       if r["belted"] not in
                       ("Subject Vehicle - No Passenger In Vehicle",
                        "Unknown", ""))
        no_pax = sum(1 for r in co_incidents
                     if r["belted"] ==
                     "Subject Vehicle - No Passenger In Vehicle")
        unk = n - with_pax - no_pax
        pct = f"{100*with_pax/n:.0f}%" if n else "n/a"
        print(f"  {company}: {with_pax}/{n} with passenger ({pct})"
              f"  [no passenger: {no_pax}, unknown: {unk}]")


if __name__ == "__main__":
    main()

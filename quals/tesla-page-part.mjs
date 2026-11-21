// Tesla's safety page (https://www.tesla.com/robotaxi/safety), for a month it
// had measured only in part when its figures were last read: the page's "As
// of" date and Tesla's no-safety-monitor miles from the 1st of that month
// through that date (the page's city sums through its last complete week, the
// week that starts in the month before interpolated linearly).
//
// The one place for that figure (2026-11-21, audit finding A17 of
// 2026-11-20). Until then four quals each held their own copy and none
// compared it with data/slurp.py's, so PREPRINT_LIST's miles, the figure that
// sets the coverage of the month Tesla's list covers, was checked against no
// source: a list moved to a new date with the old miles passed every qual.
// Read here by:
//   quals/preprints.qual.mjs             PREPRINT_LIST's through and miles must
//                                        be the entry of the list's month
//   quals/tesla-camera-miles.qual.mjs    the measured part of a month whose
//                                        other days the camera estimates
//   quals/tesla-unsupervised-floor.qual.mjs  both Tesla lines' rows for the
//                                        month sit at or above the figure
//   quals/growth-ghost-month.qual.mjs    the first stretch of the month that
//                                        TESLA_PATH_START's rate leaves out
//   quals/tesla-forecast-floor.qual.mjs  the cumulative through Oct 18, 2026
//   quals/assumptions-list.qual.mjs      the tesla-camera-ratio entry's
//                                        pageThrough
//
// A new list of Tesla's (data/README.md, Each NHTSA release, step 7) takes an
// entry here for its month, and data/slurp.py's PREPRINT_LIST the same date
// and miles. A month has one entry: a newer list dated in the same month
// replaces it (quals/tesla-forecast-floor.qual.mjs, whose floor starts from
// Oct 18, 2026, then stops until that floor is restated). An entry stays when
// the page later measures its month whole: it is what the page showed on
// that date.
//
// Oct 1-18, 2026: 1,179,333 (the page as of Oct 18, read from the Wayback
// captures of Oct 21 to Oct 26, which hold identical data: 4 days of the week
// of Sep 28, then two whole weeks).
export const TESLA_PAGE_PART = { "2026-10": { through: "2026-10-18", miles: 1179333 } };

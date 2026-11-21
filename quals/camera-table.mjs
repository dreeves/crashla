// The newest of Robotaxi Tracker's Camera watch tables saved in data/snapshots
// (robotaxitracker-cameras-YYYYMMDD.tsv; credit Robotaxi Tracker,
// https://robotaxitracker.com, the page https://robotaxitracker.com/cameras),
// for the quals that read it: quals/tesla-camera-miles.qual.mjs (its weekly
// rates) and quals/assumptions-list.qual.mjs (the camera entries' figures). A
// person copies each table from the page in a browser and data/slurp.py's
// camera step saves it; no script fetches the site. The table is read through
// data/slurp.py's own reader, newest_camera_table() and camera_table_days(),
// which stop on a file that is not such a table, and its whole weeks through
// camera_week_means(), so the quals and the step read one table one way. One
// python3 run, at import:
//   path     the table's path from the repo's root
//   savedOn  the local date its name gives, the day it was saved (YYYY-MM-DD)
//   days     its days, newest first: {day: YYYY-MM-DD, values: {column: a
//            number, or null before the column's detector started}}
//   weeks    each whole Monday-Sunday week's mean Cybercab rate, to four
//            decimals: {its Monday: {mean, days: the count of days averaged}}
// The path is checked here against a listing of data/snapshots of its own: the
// last robotaxitracker-cameras-*.tsv by name, the newest by the date in it.
// (Until 2026-11-20, when the tables entered data/snapshots, the camera qual
// held the weekly means, copied by hand, and the assumptions qual pinned the
// figures of the week in progress.)
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const PY = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("slurp_camera_table", "data/slurp.py")
slurp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(slurp)
path, saved_on, _text, days = slurp.newest_camera_table()
json.dump({"path": slurp.relpath(path), "savedOn": saved_on.isoformat(),
           "days": [{"day": day.isoformat(), "values": values} for day, values in days],
           "weeks": {monday: {"mean": mean, "days": n} for monday, (mean, n) in slurp.camera_week_means(days).items()}},
          sys.stdout)
`;

export const NEWEST_CAMERA_TABLE = JSON.parse(execFileSync("python3", ["-B", "-c", PY],
  { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 24 }));

const saved = fs.readdirSync(new URL("../data/snapshots/", import.meta.url)).filter(name => /^robotaxitracker-cameras-.*\.tsv$/.test(name)).sort();
assert.equal(NEWEST_CAMERA_TABLE.path, `data/snapshots/${saved.at(-1)}`,
  `Replicata: read the newest saved camera table through data/slurp.py's newest_camera_table() (quals/camera-table.mjs), and list data/snapshots' robotaxitracker-cameras-*.tsv files.
Expectata: the table read is the last of them by name, the newest by the date in its name.
Resultata: read ${NEWEST_CAMERA_TABLE.path}; the files, by name: ${JSON.stringify(saved)}.`);

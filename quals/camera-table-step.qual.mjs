// Robotaxi Tracker's Camera watch tables, saved by data/slurp.py (the human,
// 2026-11-20: "can you remember to prompt me with that command line? actually
// can we make it part of slurp.py?"; asked where slurp should save the tables,
// the human chose data/snapshots, published with the repo). Tesla's miles for
// the days its safety page has not measured rest on the table's daily
// Cybercab rate (quals/tesla-camera-miles.qual.mjs). The site's terms forbid
// scraping and its robots.txt automated harvesting, so no script fetches it:
// a person copies the table from the page in their own browser, and
// slurp.camera_table_step() saves the copy (data/README.md, Ghost months).
//
// Spec, driven with every process stubbed (open, pbpaste, input, which) and a
// temporary snapshots directory, never data/snapshots; a guard makes any real
// process, browser or network call stop this qual (and is itself checked on a
// call to a closed port of this machine, which it stops before any socket):
//  1. The reader (camera_table_days) accepts the first saved table,
//     data/snapshots/robotaxitracker-cameras-20261120.tsv (the bytes the human
//     saved on 2026-11-20, sha256 d448dffb...a384): its 66 days, Nov 19 back to
//     Sep 15, 2026, each value a number or, for "—", none; and its whole
//     Monday-Sunday weeks' Cybercab means (camera_week_means) are the eight the
//     camera qual held by hand until 2026-11-20, each from seven days. It
//     accepts the same table saved on its newest day and 364 days after it. A
//     table across a year's end reads its days' years right, and a whole week
//     with a day before its rate's detector started is no whole week of rates.
//  2. It rejects, with an AssertionError naming what is wrong: a changed
//     header, a column missing or added, a line short of a cell or with one
//     more, days out of order, a gap, a day twice, a blank line or the header
//     again between days, text before the header, a wrong weekday (on the
//     newest day and on another), a newest day after the save date or 365 days
//     or more before it, a value that is not a plain decimal or "—", a "—"
//     after a day with a value in its column (a column's dashes are its first
//     days, before its detector started), text after the caption (a newline
//     included), a changed or missing caption, CRLF line ends, an empty text
//     and a table with no day.
//  3. newest_camera_table() reads the newest saved table by the date in its
//     name, whatever order the files were written in, and stops, naming it,
//     on a saved table whose name is not robotaxitracker-cameras-YYYYMMDD.tsv.
//  4. Without a terminal (stdin or stdout not one: an agent's or a script's
//     run) the step prints how a person saves the table (python3
//     data/slurp.py in a terminal, or a one-line command that reads a line
//     before it opens the page and never writes over a saved file) and calls
//     nothing (no open, pbpaste, input or which) and writes nothing.
//  5. In a terminal it checks that open and pbpaste exist and that a saved
//     table exists, then asks before it opens anything: Enter goes on, "skip"
//     opens, reads and saves nothing, any other answer, or no answer (end of
//     input), stops with nothing opened. Then it calls open with exactly
//     https://robotaxitracker.com/cameras (check=True) and asks again: Enter
//     reads the clipboard once (pbpaste, check=True, in the en_US.UTF-8
//     locale whatever the caller's), any other answer stops with nothing read.
//     It saves the clipboard's bytes as robotaxitracker-cameras-YYYYMMDD.tsv
//     (the step's date) only when they differ from the newest saved table,
//     never over a saved table: a different copy the same day stops. After
//     saving it prints the days whose values changed or are gone (any
//     column's value) and the whole weeks whose Cybercab mean is new, changed
//     or gone, with data/vmt.csv's Tesla rows and the camera qual named as
//     what they move. A rejected table (2), a table that ends before the
//     newest saved one, a saved table dated today or later, a clipboard that
//     is not UTF-8, or open or pbpaste missing stops with nothing written.
//  6. main() never calls the step: data/slurp.py's `if __name__ ==
//     "__main__":` block runs main() and then the step, wired to the real
//     terminal test, subprocess.run, input, shutil.which and today's date;
//     nothing else names the step; and slurp.main() run offline with the step
//     replaced by one that stops completes.
// Replicata/Expectata/Resultata are in each assertion's message.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { SLURP_OFFLINE_PY } from "./slurp-offline.mjs";

// Installed before data/slurp.py loads: every way this Python run could start
// a process, open a browser or reach a server stops it instead, so a step that
// bypassed its stubs would fail this qual rather than open or fetch the site.
const GUARD = String.raw`
import os as _os, socket as _socket, subprocess as _sp, urllib.request as _ur, webbrowser as _wb
STARTED = []
def _no_process(*a, **k):
    STARTED.append(repr(a)[:200])
    raise AssertionError('the qual guard: a real process, browser or network call ' + repr(a)[:200])
for _n in ('run', 'Popen', 'call', 'check_call', 'check_output', 'getoutput', 'getstatusoutput'):
    setattr(_sp, _n, _no_process)
for _n in ('system', 'popen', 'execv', 'execvp', 'execvpe', 'spawnv', 'spawnvp', 'posix_spawn', 'posix_spawnp'):
    setattr(_os, _n, _no_process)
for _n in ('open', 'open_new', 'open_new_tab'):
    setattr(_wb, _n, _no_process)
for _n in ('create_connection', 'getaddrinfo'):
    setattr(_socket, _n, _no_process)
for _n in ('connect', 'connect_ex'):
    setattr(_socket.socket, _n, _no_process)
_ur.urlopen = _no_process
# The guard on itself: a request to a closed port of this machine (never the
# site) and a socket to it, each stopped before it reaches a socket.
GUARD_TEST = []
for _call in (lambda: _ur.urlopen('http://127.0.0.1:9/', timeout=1), lambda: _socket.create_connection(('127.0.0.1', 9), timeout=1),
              lambda: _socket.socket().connect(('127.0.0.1', 9))):
    try:
        _call(); GUARD_TEST.append('went out')
    except AssertionError as _e:
        GUARD_TEST.append('stopped' if str(_e).startswith('the qual guard') else 'other: ' + str(_e)[:100])
    except Exception as _e:
        GUARD_TEST.append('went out: ' + type(_e).__name__)
STARTED.clear()
`;

const py = GUARD + SLURP_OFFLINE_PY + String.raw`
import ast, contextlib, hashlib, os
out = {'guardTest': GUARD_TEST}
NEEDED = ('CAMERA_TABLE', 'camera_day_label', 'camera_table_days', 'camera_week_means', 'newest_camera_table', 'camera_table_step')
out['missing'] = [n for n in NEEDED if not hasattr(slurp, n)]
FIRST = pathlib.Path('data/snapshots/robotaxitracker-cameras-20261120.tsv')
out['firstHash'] = hashlib.sha256(FIRST.read_bytes()).hexdigest() if FIRST.exists() else None
if out['missing'] or out['firstHash'] is None:
    print(json.dumps(out)); raise SystemExit(0)

D = datetime.date
T0 = FIRST.read_bytes().decode('utf-8')
L = T0.split('\n')
HEAD, DAYS, CAP = L[0], L[1:-1], L[-1]
COLS = HEAD.split('\t')
def table(rows, head=HEAD, cap=CAP): return '\n'.join([head, *rows, cap])
def edit(rows, label, column, value):
    rows = list(rows)
    i = next(i for i, r in enumerate(rows) if r.startswith(label + '\t'))
    cells = rows[i].split('\t'); cells[COLS.index(column)] = value; rows[i] = '\t'.join(cells)
    return rows
# This qual's own day labels ("Thu, Nov 19 (UTC)"), apart from slurp's.
WD = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
MO = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
def label(d): return f'{WD[d.weekday()]}, {MO[d.month - 1]} {d.day} (UTC)'
def read(text, saved):
    days = slurp.camera_table_days(text, D.fromisoformat(saved), 'a qual fixture')
    return {'n': len(days), 'newest': days[0][0].isoformat(), 'oldest': days[-1][0].isoformat(),
            'first': days[0][1], 'last': days[-1][1], 'weeks': {w: list(x) for w, x in slurp.camera_week_means(days).items()}}

# 1. Accepted tables
out['url'] = slurp.CAMERA_TABLE['url']
out['labels'] = [slurp.camera_day_label(D(2026, 11, 19)), slurp.camera_day_label(D(2027, 1, 1))]
out['accept'] = read(T0, '2026-11-20')
out['acceptOnItsDay'] = read(T0, '2026-11-19')
out['accept364'] = read(T0, '2027-11-18')
YEAR_END = [label(D(2027, 1, 2) - datetime.timedelta(days=i)) + '\t1.0\t2.0\t—\t0.1\t0.2' for i in range(6)]
out['yearEnd'] = read(table(YEAR_END), '2027-01-03')
# Mon Nov 2 to Sun Nov 15, 2026, the Cybercab detector starting on Thu Nov 5:
# the week of Nov 2 is in the table whole, with three days before its rate.
START = [label(D(2026, 11, 15) - datetime.timedelta(days=i)) + '\t3.0\t' + ('—' if i >= 11 else f'{2.6 - i / 10:.1f}') + '\t—\t0.1\t0.2' for i in range(14)]
out['detectorStart'] = read(table(START), '2026-11-16')

# 2. Rejected tables: [text, save date, what the stop must name]
BAD = {
    'a header renamed': [table(DAYS, head=HEAD.replace('Cybercab', 'Cybercabs')), '2026-11-20', 'Cybercabs'],
    'a column missing': ['\n'.join(['\t'.join(x.split('\t')[:-1]) for x in L[:-1]] + [CAP]), '2026-11-20', None],
    'a column added': ['\n'.join([x + '\tMay' for x in L[:-1]] + [CAP]), '2026-11-20', None],
    'a line short of a cell': [table(DAYS[:3] + ['\t'.join(DAYS[3].split('\t')[:-1])] + DAYS[4:]), '2026-11-20', DAYS[3].split('\t')[0]],
    'a line with a cell more': [table(DAYS[:3] + [DAYS[3] + '\t0.5'] + DAYS[4:]), '2026-11-20', DAYS[3].split('\t')[0]],
    'days out of order': [table(DAYS[:1] + [DAYS[2], DAYS[1]] + DAYS[3:]), '2026-11-20', 'Tue, Nov 17 (UTC)'],
    'a gap': [table([r for r in DAYS if not r.startswith('Tue, Nov 10 (UTC)')]), '2026-11-20', 'Mon, Nov 9 (UTC)'],
    'a day twice': [table(DAYS[:6] + DAYS[5:]), '2026-11-20', DAYS[5].split('\t')[0]],
    'a blank line between days': [table(DAYS[:4] + [''] + DAYS[4:]), '2026-11-20', "'line': 6"],
    'the header again between days': [table(DAYS[:4] + [HEAD] + DAYS[4:]), '2026-11-20', "'day': 'Day (UTC)'"],
    'text before the header': ['Over time\n' + T0, '2026-11-20', 'Over time'],
    'a wrong weekday on the newest day': [table([DAYS[0].replace('Thu, Nov 19', 'Fri, Nov 19')] + DAYS[1:]), '2026-11-20', 'Fri, Nov 19 (UTC)'],
    'a wrong weekday on another day': [table(DAYS[:8] + [DAYS[8].replace('Wed, Nov 11', 'Tue, Nov 11')] + DAYS[9:]), '2026-11-20', 'Tue, Nov 11 (UTC)'],
    'a newest day after the save date': [T0, '2026-11-18', 'Thu, Nov 19 (UTC)'],
    'a newest day 365 days before the save date': [T0, '2027-11-19', 'Thu, Nov 19 (UTC)'],
    'a newest day more than a year before the save date': [T0, '2027-11-25', 'Thu, Nov 19 (UTC)'],
    'a value with a letter': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Cybercab', '3.32x')), '2026-11-20', '3.32x'],
    'a hyphen for the dash': [table(edit(DAYS, 'Sun, Nov 8 (UTC)', 'Robotaxi Model Y (est.)', '-')), '2026-11-20', 'Sun, Nov 8 (UTC)'],
    'an empty cell': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Zoox', '')), '2026-11-20', 'Sun, Nov 15 (UTC)'],
    'a thousands comma': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Waymo', '1,234')), '2026-11-20', '1,234'],
    'a sign': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Waymo', '-1.5')), '2026-11-20', '-1.5'],
    'a space': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Waymo', ' 3.89')), '2026-11-20', ' 3.89'],
    'an exponent': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Waymo', '3.89e0')), '2026-11-20', '3.89e0'],
    'no leading digit': [table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Zoox', '.007')), '2026-11-20', '.007'],
    'a dash after a day with a value': [table(edit(DAYS, 'Wed, Nov 11 (UTC)', 'Cybercab', '—')), '2026-11-20', '2026-11-11'],
    'text after the caption': [T0 + '\nSee the map', '2026-11-20', 'See the map'],
    'a newline after the caption': [T0 + '\n', '2026-11-20', None],
    'a changed caption': [table(DAYS, cap=CAP.rstrip('.')), '2026-11-20', CAP.rstrip('.')],
    'no caption': ['\n'.join(L[:-1]), '2026-11-20', None],
    'CRLF line ends': [T0.replace('\n', '\r\n'), '2026-11-20', None],
    'an empty text': ['', '2026-11-20', None],
    'no day': [HEAD + '\n' + CAP, '2026-11-20', None],
}
out['bad'] = {}
for name, (text, saved, names) in BAD.items():
    try:
        read(text, saved); out['bad'][name] = {'raised': None, 'names': names}
    except Exception as e:
        out['bad'][name] = {'raised': type(e).__name__, 'message': str(e)[:600], 'names': names}

T_OLD = table(DAYS[7:])                                     # Thu, Nov 12 back
T_OLDER = table(DAYS[14:])                                  # Thu, Nov 5 back
def in_dir(seed, f):
    # f() with slurp's snapshots directory a temporary one holding <seed>, its
    # files written in the seed's order; returns (f's result or None, its stop
    # or '', the files left).
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        for name, text in seed.items(): (d / name).write_bytes(text if isinstance(text, bytes) else text.encode('utf-8'))
        saved_dir, result, stop = slurp.SNAPSHOT_DIR, None, ''
        slurp.SNAPSHOT_DIR = d
        try:
            result = f(d)
        except Exception as e:
            stop = type(e).__name__ + ': ' + str(e)[:600]
        finally:
            slurp.SNAPSHOT_DIR = saved_dir
        return result, stop, {p.name: p.read_bytes().decode('utf-8', 'replace') for p in sorted(d.iterdir())}

# 3. The newest saved table
def newest(seed):
    def f(d):
        path, saved_on, _text, days = slurp.newest_camera_table()
        return {'name': path.name, 'savedOn': saved_on.isoformat(), 'n': len(days), 'newest': days[0][0].isoformat()}
    result, stop, _files = in_dir(seed, f)
    return {'result': result, 'stop': stop}
out['newest'] = {
    'three, written out of order': newest({'robotaxitracker-cameras-20261113.tsv': T_OLD, 'robotaxitracker-cameras-20261120.tsv': T0,
                                           'robotaxitracker-cameras-20261106.tsv': T_OLDER}),
    'a name with no date': newest({'robotaxitracker-cameras-20261120.tsv': T0, 'robotaxitracker-cameras-2026-11-23.tsv': T0}),
}

# 4-5. The step, its processes stubbed, in a temporary snapshots directory
FIRST_NAME = FIRST.name
T_EDIT = table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Cybercab', '3.33'))
NEW_ROWS = [label(D(2026, 11, 22)) + '\t3.12\t2.71\t1.02\t0.061\t0.61',
            label(D(2026, 11, 21)) + '\t3.25\t2.88\t1.11\t0.044\t0.58',
            label(D(2026, 11, 20)) + '\t3.03\t2.47\t0.95\t0.052\t0.55']
T_NEW = table(NEW_ROWS + edit(DAYS, 'Sun, Nov 15 (UTC)', 'Cybercab', '3.33'))
T_WAYMO = table(edit(DAYS, 'Sun, Nov 15 (UTC)', 'Waymo', '3.91'))
T_SHORT = table(DAYS[:-10])                                  # Fri, Sep 25 the oldest day
class Stubs:
    # answers: the person's answers in order, None for the end of input
    def __init__(self, clipboard, answers, missing):
        self.clipboard, self.answers, self.missing = clipboard, list(answers), set(missing)
        self.calls, self.prompts, self.whiches = [], [], []
    def run(self, args, **kw):
        kw = dict(kw)
        env = kw.pop('env', None)
        if env is not None:
            kw['env'] = {'LC_ALL': env.get('LC_ALL'),
                         'restIsEnviron': {k: v for k, v in env.items() if k != 'LC_ALL'} == {k: v for k, v in os.environ.items() if k != 'LC_ALL'}}
        self.calls.append([list(args), {k: kw[k] for k in sorted(kw)}])
        stdout = self.clipboard if isinstance(self.clipboard, bytes) else self.clipboard.encode('utf-8')
        return subprocess.CompletedProcess(list(args), 0, stdout=stdout if list(args) == ['pbpaste'] else None, stderr=None)
    def ask(self, prompt):
        self.prompts.append(prompt)
        answer = self.answers[len(self.prompts) - 1]          # an IndexError: asked more than the case answers
        if answer is None:
            raise EOFError('the qual stub: end of input')
        return answer
    def which(self, name):
        self.whiches.append(name)
        return None if name in self.missing else '/usr/bin/' + name
import subprocess
def step(seed, clipboard, today, terminal=True, answers=('', ''), missing=()):
    s, printed = Stubs(clipboard, answers, missing), io.StringIO()
    def f(d):
        with contextlib.redirect_stdout(printed):
            slurp.camera_table_step(terminal=terminal, run=s.run, ask=s.ask, which=s.which, today=D.fromisoformat(today))
        return slurp.relpath(d)
    where, stop, files = in_dir(seed, f)
    return {'stop': stop, 'printed': printed.getvalue(), 'calls': s.calls, 'prompts': len(s.prompts),
            'whiches': s.whiches, 'files': files, 'seed': seed}
S1 = {FIRST_NAME: T0}
S2 = {FIRST_NAME: T0, 'robotaxitracker-cameras-20261113.tsv': T_OLD}
with tempfile.TemporaryDirectory() as _d:
    out['tempPrefix'] = str(pathlib.Path(_d).resolve().parent)
out['steps'] = {
    'no terminal': step(S1, T_NEW, '2026-11-23', terminal=False),
    'unchanged': step(S1, T0, '2026-11-21'),
    'two saved, the newest copied again': step(S2, T0, '2026-11-21'),
    'two saved, the older copied again': step(S2, T_OLD, '2026-11-21'),
    'from an older table': step({'robotaxitracker-cameras-20261113.tsv': T_OLD}, T0, '2026-11-20'),
    'changed': step(S1, T_NEW, '2026-11-23'),
    'only a Waymo value changed': step(S1, T_WAYMO, '2026-11-21'),
    'the oldest days gone': step(S1, T_SHORT, '2026-11-21'),
    'the same day': step(S1, T_EDIT, '2026-11-20'),
    'skip': step(S1, T_NEW, '2026-11-23', answers=('skip',)),
    'another answer': step(S1, T_NEW, '2026-11-23', answers=('y',)),
    'no answer': step(S1, T_NEW, '2026-11-23', answers=(None,)),
    'another answer after opening': step(S1, T_NEW, '2026-11-23', answers=('', 'y')),
    'no answer after opening': step(S1, T_NEW, '2026-11-23', answers=('', None)),
    'pbpaste missing': step(S1, T_NEW, '2026-11-23', missing=('pbpaste',)),
    'open missing': step(S1, T_NEW, '2026-11-23', missing=('open',)),
    'no saved table': step({}, T0, '2026-11-20'),
    'older than the newest saved': step(S1, T_OLD, '2026-11-21'),
    'a saved table dated after today': step({'robotaxitracker-cameras-20261125.tsv': T0}, T_NEW, '2026-11-23'),
    # the em dash as Mac Roman writes it (0xD1), the form pbpaste gives under a non-UTF-8 locale
    'not UTF-8': step(S1, T0.encode('utf-8').replace('—'.encode('utf-8'), b'\xd1'), '2026-11-21'),
}
out['badSteps'] = {name: step(S1, text, saved) for name, (text, saved, _n) in BAD.items()}
out['expect'] = {'T0': T0, 'T_OLD': T_OLD, 'T_EDIT': T_EDIT, 'T_NEW': T_NEW, 'T_WAYMO': T_WAYMO, 'T_SHORT': T_SHORT, 'FIRST': FIRST_NAME}

# 6. main() never calls the step
src = pathlib.Path('data/slurp.py').read_text()
mod = ast.parse(src)
blocks = [n for n in mod.body if isinstance(n, ast.If) and ast.unparse(n.test) == "__name__ == '__main__'"]
out['mainBlocks'] = len(blocks)
out['mainBody'] = [ast.unparse(s) for s in blocks[0].body] if blocks else []
calls = [s.value for s in (blocks[0].body if blocks else []) if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call)]
out['stepKeywords'] = {k.arg: ast.unparse(k.value) for c in calls if ast.unparse(c.func) == 'camera_table_step' for k in c.keywords}
inside = {id(n) for b in blocks for n in ast.walk(b)}
out['otherNames'] = sorted({f'line {n.lineno}' for n in ast.walk(mod) if id(n) not in inside and
                            ((isinstance(n, ast.Name) and n.id == 'camera_table_step') or (isinstance(n, ast.Attribute) and n.attr == 'camera_table_step'))})
def _stopping_step(**kw): raise AssertionError('camera_table_step was called from main()')
out['mainRun'] = run_main(camera_table_step=_stopping_step)['stop'][:600]
out['started'] = STARTED
print(json.dumps(out))
`;
const run = spawnSync("python3", ["-B", "-c", py], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 1 << 28 });
assert.equal(run.status, 0,
  `Replicata: drive data/slurp.py's camera table functions and its camera step with stubbed processes in a temporary directory, and run its main() offline.
Expectata: python exits 0.
Resultata: exit ${run.status}; ${run.stderr.slice(-2000)}`);
const S = JSON.parse(run.stdout.trim().split("\n").at(-1));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

assert.deepEqual(S.guardTest, ["stopped", "stopped", "stopped"],
  `Replicata: with this qual's guard installed, make a request (urllib) and open sockets (socket.create_connection, socket.connect) to a closed port of this machine, 127.0.0.1:9.
Expectata: the guard stops each before it reaches a socket.
Resultata: ${JSON.stringify(S.guardTest)}.`);
assert.ok(S.missing.length === 0 && S.firstHash === "d448dffba9a55ac0a00e465e595d569f350ffd2aa649457b7020b42fc732a384",
  `Replicata: read data/slurp.py's camera table names and data/snapshots/robotaxitracker-cameras-20261120.tsv.
Expectata: data/slurp.py defines CAMERA_TABLE, camera_day_label, camera_table_days, camera_week_means, newest_camera_table and camera_table_step, and the first table is the bytes the human saved on 2026-11-20 (sha256 d448dffb...a384).
Resultata: missing ${JSON.stringify(S.missing)}; the first table's sha256 ${S.firstHash === null ? "(no such file)" : S.firstHash}.`);

// The guard caught nothing: no stub was bypassed.
assert.deepEqual(S.started, [],
  `Replicata: drive the camera table step with open, pbpaste, input and which stubbed, a guard on every real process, browser and network call.
Expectata: no real process, browser or network call.
Resultata: ${JSON.stringify(S.started)}.`);

// --- 1. Accepted tables ------------------------------------------------------
const EIGHT = { "2026-09-21": 0.9747, "2026-09-28": 1.3873, "2026-10-05": 1.7286, "2026-10-12": 1.9714,
                "2026-10-19": 2.0757, "2026-10-26": 2.2286, "2026-11-02": 2.4129, "2026-11-09": 3.1343 };
const sevens = weeks => Object.fromEntries(Object.entries(weeks).map(([w, m]) => [w, [m, 7]]));
assert.equal(S.url, "https://robotaxitracker.com/cameras",
  `Replicata: read data/slurp.py CAMERA_TABLE's url. Expectata: exactly https://robotaxitracker.com/cameras, the page the step opens. Resultata: ${JSON.stringify(S.url)}.`);
assert.deepEqual(S.labels, ["Thu, Nov 19 (UTC)", "Fri, Jan 1 (UTC)"],
  `Replicata: label Nov 19, 2026 and Jan 1, 2027 with camera_day_label. Expectata: the table's own form, "Thu, Nov 19 (UTC)" and "Fri, Jan 1 (UTC)". Resultata: ${JSON.stringify(S.labels)}.`);
const ACCEPT = {
  n: 66, newest: "2026-11-19", oldest: "2026-09-15",
  first: { "Waymo": 2.96, "Cybercab": 2.52, "Robotaxi Model Y (est.)": 0.962, "Zoox": 0.037, "Avride": 0.631 },
  last: { "Waymo": 1.54, "Cybercab": 0.246, "Robotaxi Model Y (est.)": null, "Zoox": null, "Avride": null },
  weeks: sevens(EIGHT),
};
assert.deepEqual(S.accept, ACCEPT, `Replicata: read the first saved table (data/snapshots/robotaxitracker-cameras-20261120.tsv, saved 2026-11-20) with camera_table_days and camera_week_means.
Expectata: 66 days, Nov 19 back to Sep 15, 2026, values as numbers and "—" as none; the whole Monday-Sunday weeks' Cybercab means, to four decimals, the eight the camera qual held by hand until 2026-11-20 (Sep 21-Nov 15), each from seven days, the weeks of Sep 14 (six days in the table) and Nov 16 (four) left out.
Resultata: ${JSON.stringify(S.accept)}.`);
assert.ok(same(S.acceptOnItsDay, ACCEPT) && same(S.accept364, ACCEPT),
  `Replicata: read the first table as if saved on Nov 19, 2026, its newest day (a copy after 00:00 UTC that day, in the evening in Austin), and on Nov 18, 2027, 364 days after it.
Expectata: both read as when saved on Nov 20, 2026.
Resultata: ${JSON.stringify([S.acceptOnItsDay, S.accept364]).slice(0, 1500)}.`);
assert.ok(S.yearEnd.newest === "2027-01-02" && S.yearEnd.oldest === "2026-12-28" && S.yearEnd.n === 6,
  `Replicata: read a table of Jan 2, 2027 back to Dec 28, 2026, saved Jan 3, 2027. Expectata: its days' years read right across the year's end. Resultata: ${JSON.stringify(S.yearEnd)}.`);
assert.deepEqual(S.detectorStart.weeks, { "2026-11-09": [2.3, 7] },
  `Replicata: read a table of Nov 15 back to Nov 2, 2026 whose Cybercab column starts on Thu Nov 5 (a "—" on Nov 2-4).
Expectata: the week of Nov 9 (rates 2.0 to 2.6, mean 2.3, seven days) its one whole week of rates; the week of Nov 2, in the table whole but with three days before the detector, left out.
Resultata: ${JSON.stringify(S.detectorStart.weeks)}.`);

// --- 2. Rejected tables -----------------------------------------------------
const badDirect = Object.entries(S.bad).filter(([, r]) => !(r.raised === "AssertionError" && (r.names === null || r.message.includes(r.names))));
assert.deepEqual(badDirect, [],
  `Replicata: read each malformed copy of the first table with camera_table_days (its save date as given).
Expectata: each stops with an AssertionError that names what is wrong (its line's day, its line, the value or the text in question) where the case gives it.
Resultata: ${JSON.stringify(badDirect, null, 1).slice(0, 3000)}.`);

// --- 3. The newest saved table ------------------------------------------------
{
  const three = S.newest["three, written out of order"], odd = S.newest["a name with no date"];
  assert.ok(three.stop === "" && same(three.result, { name: "robotaxitracker-cameras-20261120.tsv", savedOn: "2026-11-20", n: 66, newest: "2026-11-19" }) &&
    /^AssertionError/.test(odd.stop) && odd.stop.includes("robotaxitracker-cameras-2026-11-23.tsv"),
    `Replicata: call newest_camera_table with the snapshots directory a temporary one holding (a) tables saved 2026-11-13, 2026-11-20 and 2026-11-06, written in that order, and (b) the first table beside a copy named robotaxitracker-cameras-2026-11-23.tsv.
Expectata: (a) the table of 2026-11-20 (66 days, newest 2026-11-19), the newest by the date in its name; (b) a stop naming robotaxitracker-cameras-2026-11-23.tsv, a name that is not prefix-YYYYMMDD.tsv.
Resultata: (a) ${JSON.stringify(three)}; (b) ${JSON.stringify(odd)}.`);
}

// --- 4-5. The step ------------------------------------------------------------
const { T0, T_OLD, T_EDIT, T_NEW, T_WAYMO, T_SHORT, FIRST } = S.expect;
const OPEN = [["open", "https://robotaxitracker.com/cameras"], { check: true }];
const PASTE = [["pbpaste"], { capture_output: true, check: true, env: { LC_ALL: "en_US.UTF-8", restIsEnviron: true } }];
const st = S.steps;
const show = r => JSON.stringify({ stop: r.stop, calls: r.calls, prompts: r.prompts, whiches: r.whiches, files: Object.keys(r.files), printed: r.printed.slice(0, 1500) });
const problems = [];
const want = (name, ok, what) => { if (!ok) problems.push(`${name}: want ${what}; got ${show(st[name])}`); };
const stops = (r, ...words) => /^AssertionError/.test(r.stop) && words.every(w => r.stop.includes(w));
// The files left are the seed's, whatever order the seed wrote them in.
const byName = files => Object.keys(files).sort().map(name => [name, files[name]]);
const kept = r => same(byName(r.files), byName(r.seed));

{
  const r = st["no terminal"];
  const command = (r.printed.split("\n").find(line => line.includes("pbpaste")) ?? "").trim();
  const target = /pbpaste > (\S+)\/robotaxitracker-cameras-\$\(date \+%Y%m%d\)\.tsv\)?$/.exec(command);
  // The command's steps, split at "&&": a read comes before the open.
  const steps = command.replace(/^\(|\)$/g, "").split("&&").map(s => s.trim());
  const firstRead = steps.indexOf("read"), firstOpen = steps.indexOf("open https://robotaxitracker.com/cameras");
  want("no terminal", r.stop === "" && r.calls.length === 0 && r.prompts === 0 && r.whiches.length === 0 && kept(r) &&
    r.printed.includes("python3 data/slurp.py") && steps[0] === "set -C" && command.includes("LC_ALL=en_US.UTF-8 pbpaste") &&
    firstRead >= 0 && firstOpen > firstRead && target !== null && target[1].startsWith(S.tempPrefix),
    "no call to open, pbpaste, input or which, nothing written, and a reminder naming python3 data/slurp.py and a one-line command that reads a line (read) before it opens https://robotaxitracker.com/cameras, refuses to write over a file (set -C), reads the clipboard as UTF-8 (LC_ALL=en_US.UTF-8 pbpaste) and saves it in the snapshots directory as robotaxitracker-cameras-$(date +%Y%m%d).tsv");
}
want("unchanged", st.unchanged.stop === "" && same(st.unchanged.calls, [OPEN, PASTE]) && st.unchanged.prompts === 2 &&
  same(st.unchanged.whiches.slice().sort(), ["open", "pbpaste"]) && kept(st.unchanged) && st.unchanged.printed.includes(FIRST),
  `a question, then open (exactly the page, check=True), a second question, pbpaste once (check=True, in en_US.UTF-8), nothing written, the newest saved table (${FIRST}) named as unchanged`);
want("two saved, the newest copied again", st["two saved, the newest copied again"].stop === "" && kept(st["two saved, the newest copied again"]) &&
  st["two saved, the newest copied again"].printed.includes(FIRST),
  `nothing written and the newest saved table by name (${FIRST}, written first) named as unchanged`);
want("two saved, the older copied again", stops(st["two saved, the older copied again"], "2026-11-12", FIRST) && kept(st["two saved, the older copied again"]),
  `a stop naming the clipboard's newest day (2026-11-12) and the newest saved table (${FIRST}), nothing written`);
{
  const r = st["from an older table"];
  want("from an older table", r.stop === "" && same(r.calls, [OPEN, PASTE]) && same(r.files, { "robotaxitracker-cameras-20261113.tsv": T_OLD, "robotaxitracker-cameras-20261120.tsv": T0 }) &&
    r.printed.includes("2026-11-09") && r.printed.includes("3.1343"),
    "the clipboard's bytes saved as robotaxitracker-cameras-20261120.tsv beside the older table, and the week of Nov 9 (3.1343) named as new");
}
{
  const r = st.changed;
  const newWeek = Math.round((2.4 + 2.22 + 2.32 + 2.52 + 2.47 + 2.88 + 2.71) / 7 * 1e4) / 1e4;
  want("changed", r.stop === "" && same(r.calls, [OPEN, PASTE]) && same(r.files, { [FIRST]: T0, "robotaxitracker-cameras-20261123.tsv": T_NEW }) &&
    ["Sun, Nov 15 (UTC)", "3.32", "3.33", "2026-11-09", "3.1343", "3.1357", "2026-11-16", String(newWeek), "data/vmt.csv", "quals/tesla-camera-miles.qual.mjs"].every(x => r.printed.includes(x)) &&
    !r.printed.includes("Sat, Nov 14 (UTC)"),
    `the table saved as robotaxitracker-cameras-20261123.tsv; printed: the changed day (Sun, Nov 15 (UTC), Cybercab 3.32 to 3.33) and no unchanged one (Sat, Nov 14), the week of Nov 9 changed (3.1343 to 3.1357) and the week of Nov 16 new (${newWeek}), data/vmt.csv's Tesla rows and quals/tesla-camera-miles.qual.mjs named`);
}
{
  const r = st["only a Waymo value changed"];
  want("only a Waymo value changed", r.stop === "" && same(r.files, { [FIRST]: T0, "robotaxitracker-cameras-20261121.tsv": T_WAYMO }) &&
    r.printed.includes("Sun, Nov 15 (UTC)") && r.printed.includes("3.89") && r.printed.includes("3.91") && !r.printed.includes("3.1343"),
    "the table saved as robotaxitracker-cameras-20261121.tsv, Sun, Nov 15 (UTC) named as changed (Waymo 3.89 to 3.91) and no week's Cybercab mean named");
}
{
  const r = st["the oldest days gone"];
  want("the oldest days gone", r.stop === "" && same(r.files, { [FIRST]: T0, "robotaxitracker-cameras-20261121.tsv": T_SHORT }) &&
    ["Tue, Sep 15 (UTC)", "Thu, Sep 24 (UTC)", "2026-09-21", "0.9747"].every(x => r.printed.includes(x)) && !r.printed.includes("Fri, Sep 25 (UTC)"),
    "the table saved as robotaxitracker-cameras-20261121.tsv, the ten days it no longer holds (Sep 15-24) named as gone and Sep 25 not, and the week of Sep 21 (0.9747) named as gone");
}
want("the same day", stops(st["the same day"], FIRST) && kept(st["the same day"]) && same(st["the same day"].calls, [OPEN, PASTE]),
  `a stop naming the table already saved that day (${FIRST}) after the clipboard is read, nothing written: a saved table is never replaced`);
want("skip", st.skip.stop === "" && st.skip.calls.length === 0 && st.skip.prompts === 1 && kept(st.skip),
  "one question, then nothing opened, read or written");
want("another answer", stops(st["another answer"], "'y'") && st["another answer"].calls.length === 0 && kept(st["another answer"]),
  "a stop naming the answer 'y', before open is called, nothing written");
want("no answer", /^EOFError/.test(st["no answer"].stop) && st["no answer"].calls.length === 0 && kept(st["no answer"]),
  "the end of input stopping the step at its first question, before open is called, nothing written");
want("another answer after opening", stops(st["another answer after opening"], "'y'") && same(st["another answer after opening"].calls, [OPEN]) && kept(st["another answer after opening"]),
  "a stop naming the answer 'y' after open, before pbpaste, nothing written");
want("no answer after opening", /^EOFError/.test(st["no answer after opening"].stop) && same(st["no answer after opening"].calls, [OPEN]) && kept(st["no answer after opening"]),
  "the end of input stopping the step at its second question, before pbpaste, nothing written");
for (const [name, program] of [["pbpaste missing", "pbpaste"], ["open missing", "open"]])
  want(name, stops(st[name], program) && st[name].calls.length === 0 && st[name].prompts === 0 && kept(st[name]),
    `a stop naming ${program}, before any question or call, nothing written`);
want("no saved table", /^AssertionError/.test(st["no saved table"].stop) && st["no saved table"].calls.length === 0 && st["no saved table"].prompts === 0 && same(st["no saved table"].files, {}),
  "a stop before any question or call, nothing written");
want("older than the newest saved", stops(st["older than the newest saved"], "2026-11-12") && kept(st["older than the newest saved"]),
  "a stop naming the clipboard's newest day (2026-11-12), before the newest saved one's, nothing written");
want("a saved table dated after today", stops(st["a saved table dated after today"], "robotaxitracker-cameras-20261125.tsv") && kept(st["a saved table dated after today"]),
  "a stop naming the later-dated table, nothing written");
want("not UTF-8", stops(st["not UTF-8"], "UTF-8", "nothing was saved") && kept(st["not UTF-8"]),
  "a stop saying the clipboard is not UTF-8 and nothing was saved, nothing written");
for (const [name, r] of Object.entries(S.badSteps))
  if (!(/^AssertionError/.test(r.stop) && kept(r) && same(r.calls, [OPEN, PASTE])))
    problems.push(`a clipboard with ${name}: want a stop after open and one pbpaste, nothing written; got ${show(r)}`);
assert.deepEqual(problems, [],
  `Replicata: run slurp.camera_table_step with open, pbpaste, input and which stubbed and a temporary snapshots directory seeded with the first table (or as each case says): with no terminal; in a terminal with the clipboard unchanged, newer, a Waymo value changed, its oldest days gone, edited the same day, older; with two tables saved, written newest first; answering skip, y or nothing (end of input) at either question; with open or pbpaste missing; with no table saved, a table dated after the step's date; a clipboard that is not UTF-8; and every malformed table of section 2.
Expectata: as this qual's header (4, 5) says.
Resultata:\n  ${problems.join("\n  ")}`);

// --- 6. main() never calls the step -------------------------------------------
// The block first sets print_stop as the run's excepthook (since 2026-11-23,
// the human: "can you make that error nice and clear and not spew junk all
// over the screen?"; until then it held main() and the step alone).
assert.ok(S.mainBlocks === 1 && same(S.mainBody.slice(0, 2), ["sys.excepthook = print_stop", "main()"]) && S.mainBody.length === 3 && /^camera_table_step\(/.test(S.mainBody[2]) &&
  same(S.stepKeywords, { terminal: "sys.stdin.isatty() and sys.stdout.isatty()", run: "subprocess.run", ask: "input", which: "shutil.which", today: "datetime.date.today()" }) &&
  S.otherNames.length === 0,
  `Replicata: read data/slurp.py's syntax tree: its if __name__ == "__main__": block, and every name camera_table_step outside it.
Expectata: one such block, holding sys.excepthook = print_stop, main() and then camera_table_step(terminal=sys.stdin.isatty() and sys.stdout.isatty(), run=subprocess.run, ask=input, which=shutil.which, today=datetime.date.today()), and the step named nowhere else but its own def.
Resultata: ${S.mainBlocks} blocks, body ${JSON.stringify(S.mainBody)}, keywords ${JSON.stringify(S.stepKeywords)}, other uses at ${JSON.stringify(S.otherNames)}.`);

// --- 6b. A stop in a run by hand prints plainly --------------------------------
// With print_stop as the excepthook, a stop (must()'s AssertionError) ends the
// run with exit status 1 and prints its message and each figure it names, one
// to a line, with no traceback; any other exception, a fault in the script,
// still prints Python's traceback. Each case runs in its own python3, the hook
// set as the __main__ block sets it.
{
  const hooked = body => spawnSync("python3", ["-B", "-c", String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location("slurp", "data/slurp.py")
slurp = importlib.util.module_from_spec(spec); spec.loader.exec_module(slurp)
sys.excepthook = slurp.print_stop
${body}`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const stop = hooked(`slurp.must(False, "a test stop (nothing was saved)", last="Tue, Sep 15 (UTC)\\t1.54", lines=71)`);
  const fault = hooked(`raise ValueError("a fault")`);
  const bare = hooked(`raise AssertionError("a bare assert")`);
  const problems = [];
  if (stop.status !== 1) problems.push(`a stop exits ${stop.status}, not 1`);
  if (/Traceback/.test(stop.stderr)) problems.push(`a stop prints a traceback: ${JSON.stringify(stop.stderr.slice(0, 400))}`);
  if (!stop.stderr.includes("a test stop (nothing was saved)")) problems.push(`a stop does not print its message: ${JSON.stringify(stop.stderr.slice(0, 400))}`);
  for (const line of ["last: Tue, Sep 15 (UTC)\t1.54", "lines: 71"])
    if (!stop.stderr.split("\n").some(l => l.trim() === line)) problems.push(`a stop does not print the figure ${JSON.stringify(line)} on a line of its own: ${JSON.stringify(stop.stderr.slice(0, 400))}`);
  if (fault.status !== 1 || !/Traceback \(most recent call last\)/.test(fault.stderr) || !fault.stderr.includes("ValueError: a fault"))
    problems.push(`a fault (ValueError) exits ${fault.status} and prints ${JSON.stringify(fault.stderr.slice(-300))}, not Python's traceback`);
  if (bare.status !== 1 || /Traceback/.test(bare.stderr) || !bare.stderr.includes("a bare assert"))
    problems.push(`an AssertionError that is no must() exits ${bare.status} and prints ${JSON.stringify(bare.stderr.slice(0, 300))}, not its message plainly`);
  assert.deepEqual(problems, [],
    `Replicata: in python3, load data/slurp.py, set sys.excepthook = slurp.print_stop as its __main__ block does, then raise a stop (slurp.must(False, msg, last=..., lines=71)), a ValueError, and an AssertionError that is no must().
Expectata: the stop and the AssertionError exit 1 and print their message plainly, with no traceback, the stop each figure it names on a line of its own; the ValueError exits 1 with Python's traceback.
Resultata:\n  ${problems.join("\n  ")}`);
}
assert.equal(S.mainRun, "",
  `Replicata: run slurp.main() offline on the newest snapshots (quals/slurp-offline.mjs) with camera_table_step replaced by one that stops, under this qual's guard.
Expectata: main() completes (it never calls the step, and reaches no process, browser or server).
Resultata: stopped: ${JSON.stringify(S.mainRun)}.`);

console.log(`qual pass: data/slurp.py reads the first camera table (66 days, the eight weekly means) and rejects ${Object.keys(S.bad).length} malformed forms; newest_camera_table reads the newest by name; the step, with every process stubbed, opens nothing and reads nothing without a terminal, and in one asks before it opens ${S.url}, reads the clipboard once and saves only a changed table, never over a saved one, naming changed days and weeks; main() never calls it`);

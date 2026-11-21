// A stop that a release can bring names its step (2026-11-21, audit finding
// A55 of 2026-11-20). data/README.md, "Each NHTSA release", is the checklist a
// person follows while data/slurp.py stops, and each stop's message is where
// that person learns which step it belongs to. The README said every stop
// names its step; 76 of 145 did not, among them stops only a release or a new
// list of Tesla's can bring (a list's date, speed, weather and contact-area
// forms; a preprint dated after NHTSA's data-through month; the date forms of
// NHTSA's rows).
//
// The rule, read from data/slurp.py's syntax tree: every must() call's
// message names a step of the checklist ("Each NHTSA release, step N", "steps
// M and N", "step M, or step N for ..."), unless the call is one NO_STEP
// allows, by the function it sits in: functions whose stops no release's
// rows, list, data/vmt.csv row or arrival-table entry can bring (all of
// theirs are allowed), and functions that also hold such a stop (that many
// are allowed, so one more without a step is red). Every step a message
// names is a numbered step of the README's section.
//
// A stop's words are not read: only its step numbers, a citation in a fixed
// form, as a rationale's link is (quals/vmt-source-links.qual.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// The must() calls whose message names no step, by function: ALL where none
// of the function's stops comes from what a release brings, a count where
// that many of them do not. Each with the reason no step covers it.
const ALL = "all";
const NO_STEP = {
  // the tables' own form, checked when slurp.py is loaded, before any row is read
  "<module>": ALL,
  // the camera step, after main() has written its files (the README's step 8 says how it runs)
  camera_table_days: ALL, newest_camera_table: ALL, camera_table_step: ALL,
  // a file that is not in its own form: the archive file's columns, a missing
  // snapshot (an offline read), a response with no Last-Modified header
  _normalize_archive_row: ALL, newest_snapshot_rows: ALL, modified_date_from_last_modified: ALL,
  // data/faultfrac.csv's form (data/faultrate.py writes it; nobody edits it):
  // its header, an empty file, a row with no Report ID, a value that is no
  // number, two rows for one report; a row slurp's own rows do not hold
  read_fault_csv_rows: ALL, sync_fault_csv: ALL, build_fault_master_rows: ALL, parse_fault_csv: 4,
  // data/vmt.csv's header and an empty file (a row's label and cell count name step 4)
  build_vmt_csv: ALL,
  // the code's own bookkeeping: a record counted on one of its lines and
  // pending on another; an analysis row after the data-through month
  record_counted: ALL, ghost_vmt_csv: 1,
  // a fetched file with no rows, or with no report-submission month
  main: 2,
};

const PY = String.raw`
import ast, json, re
src = open('data/slurp.py').read()
def text(node):
    # a message's literal text: the parts of an f-string between its fields
    # count, the fields do not
    if isinstance(node, ast.Constant) and isinstance(node.value, str): return node.value
    if isinstance(node, ast.JoinedStr): return ''.join(v.value if isinstance(v, ast.Constant) else '{}' for v in node.values)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add): return text(node.left) + text(node.right)
    raise AssertionError(('a must() message that is no string literal', ast.dump(node)[:200]))
calls = []
class Visitor(ast.NodeVisitor):
    def __init__(self): self.stack = []
    def visit_FunctionDef(self, node):
        self.stack.append(node.name); self.generic_visit(node); self.stack.pop()
    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id == 'must':
            assert len(node.args) == 2, ('must(condition, message, **details)', node.lineno)
            calls.append({'line': node.lineno, 'function': self.stack[0] if self.stack else '<module>', 'message': text(node.args[1])})
        self.generic_visit(node)
Visitor().visit(ast.parse(src))
print(json.dumps(calls))
`;
const run = spawnSync("python3", ["-B", "-c", PY], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.equal(run.status, 0,
  `Replicata: read every must() call of data/slurp.py from its syntax tree.
Expectata: each call must(condition, message, **details) with a string-literal message.
Resultata: exit ${run.status}; ${run.stderr.slice(-800)}`);
const calls = JSON.parse(run.stdout.trim().split("\n").at(-1));

// The checklist's numbered steps: the lines "N. " of the README's section.
const readme = fs.readFileSync("data/README.md", "utf8");
const start = readme.indexOf("\n## Each NHTSA release\n");
assert.ok(start >= 0, `Replicata: find the section "Each NHTSA release" in data/README.md. Expectata: one. Resultata: none.`);
const section = readme.slice(start + 1, readme.indexOf("\n## ", start + 1));
const steps = [...section.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]));
assert.ok(steps.length >= 2 && steps.every((n, i) => n === i + 1),
  `Replicata: list the numbered steps of data/README.md's "Each NHTSA release".
Expectata: steps 1, 2, 3, ... in order.
Resultata: ${JSON.stringify(steps)}.`);

// The steps a message names: after "Each NHTSA release, step" or "steps", the
// numbers up to the message's end.
const stepsOf = message => {
  const at = message.search(/Each\s+NHTSA\s+release,\s+steps?\s+\d/);
  return at < 0 ? [] : [...message.slice(at).matchAll(/\bsteps?\s+(\d+)(?:\s+and\s+(\d+))?/g)].flatMap(m => [m[1], m[2]].filter(x => x !== undefined).map(Number));
};
assert.ok(calls.length > 100, `Replicata: count data/slurp.py's must() calls. Expectata: over a hundred. Resultata: ${calls.length}.`);
const problems = [];
const named = calls.map(c => ({ ...c, steps: stepsOf(c.message) }));
for (const c of named) {
  for (const n of c.steps.filter(n => !steps.includes(n))) problems.push(`line ${c.line} (${c.function}): names step ${n}, which the checklist lacks: ${JSON.stringify(c.message.slice(0, 120))}`);
}
const functions = [...new Set(named.map(c => c.function))];
for (const fn of functions) {
  const bare = named.filter(c => c.function === fn && c.steps.length === 0);
  const allowed = NO_STEP[fn] ?? 0;
  if (allowed === ALL || bare.length === allowed) continue;
  problems.push(`${fn}: ${bare.length} of its stops name no step, ${allowed} allowed (lines ${bare.map(c => c.line).join(", ")}): ${bare.map(c => JSON.stringify(c.message.slice(0, 90))).join("; ")}`);
}
for (const fn of Object.keys(NO_STEP).filter(fn => !functions.includes(fn))) problems.push(`NO_STEP lists ${fn}, which holds no must() call`);
assert.deepEqual(problems, [],
  `Replicata: read each must() call of data/slurp.py (${calls.length}) with the function it sits in and the steps of data/README.md's "Each NHTSA release" its message names.
Expectata: every message names a step, each one of the checklist's (${steps.join(", ")}), but in the functions this qual's NO_STEP lists: all of a function's stops where none comes from what a release brings, or the number given (give a new stop its step in its message, as "...: data/README.md, Each NHTSA release, step N"; where no step covers it, raise that function's number here with the reason).
Resultata: ${problems.length} problems:\n${problems.join("\n")}`);

const withStep = named.filter(c => c.steps.length > 0).length;
console.log(`qual pass: ${withStep} of data/slurp.py's ${calls.length} stops name their step of the release checklist (steps ${steps[0]}-${steps.at(-1)}), and the ${calls.length - withStep} that name none are the ones no release's rows can bring (table and file forms, the camera step, the code's own bookkeeping)`);

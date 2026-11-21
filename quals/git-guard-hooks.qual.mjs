// The git hooks of .githooks/ refuse git changes made from an agent's
// process, however git was started (AGENTS.md rule 15: git is human-only).
//
// Why hooks: the other guards read a command line (.claude/settings.json's
// deny list, ~/.claude/hooks/git-guard.py, Codex's rules), so git run from
// inside a script in any language passes them. A hook runs inside git itself.
//   reference-transaction  git runs it whenever a command is about to change
//                          a ref (commit, reset to another commit, branch,
//                          tag, merge, rebase, cherry-pick, stash, pull,
//                          fetch); a non-zero exit while the change is being
//                          prepared aborts it, and --no-verify does not skip
//                          it. Its exit status is ignored once the change is
//                          committed or aborted.
//   pre-push               git runs it before a push; non-zero aborts.
// Whose process: Claude Code sets CLAUDE_CODE_CHILD_SESSION=1 in the
// processes it spawns (its Bash tool, and so every script that tool starts)
// and, by its documentation, not in a person's own terminal, where its IDE
// extensions set only CLAUDECODE=1. So the hooks key on the first and must
// let the second through.
// Not covered, and no hook can cover it: staging (git add) and commands that
// only rewrite working files (restore, clean, reset --hard to the same
// commit); git has no hook for them.
//
// The hooks act only once the human has run, once per clone,
//   git config core.hooksPath .githooks
// which this qual cannot check (the scratch copies quals run in have no
// .git) and no agent may run (it changes git's configuration).
//
// This qual runs the hook files themselves, never git.
// Replicata/Expectata/Resultata are in each assertion's message.
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOOKS = ".githooks";
const MARKER = "CLAUDE_CODE_CHILD_SESSION";
// A hook's environment here: PATH and what a case adds, so this process's own
// marker (the qual runs under an agent as often as not) does not leak in.
const run = (hook, args, extra) =>
  spawnSync(path.join(root, HOOKS, hook), args, {
    env: { PATH: process.env.PATH, ...extra }, input: "", encoding: "utf8", timeout: 20000,
  });

const problems = [];
const expect = (ok, replicata, expectata, resultata) => {
  if (!ok) problems.push(`Replicata: ${replicata}.\nExpectata: ${expectata}.\nResultata: ${resultata}.`);
};

// 1. Both hooks exist, are executable (git ignores a hook that is not) and
//    are plain sh scripts.
for (const hook of ["reference-transaction", "pre-push"]) {
  const file = path.join(root, HOOKS, hook);
  const exists = fs.existsSync(file);
  expect(exists, `look for ${HOOKS}/${hook}`, "the hook file exists", "no such file");
  assert.ok(exists, problems.join("\n\n"));
  const mode = fs.statSync(file).mode;
  expect((mode & 0o111) === 0o111, `stat ${HOOKS}/${hook}`, "executable by user, group and others (git skips a hook that is not executable)", `mode ${(mode & 0o777).toString(8)}`);
  const first = fs.readFileSync(file, "utf8").split("\n")[0];
  expect(first === "#!/bin/sh", `read the first line of ${HOOKS}/${hook}`, "#!/bin/sh", JSON.stringify(first));
}
assert.equal(problems.length, 0, problems.join("\n\n"));

// 2. A person's process: every call passes without a word, in every state,
//    with CLAUDECODE=1 alone (a person's terminal inside an IDE extension)
//    and with the marker at any value but 1.
const PERSON = [{}, { CLAUDECODE: "1" }, { [MARKER]: "" }, { [MARKER]: "0" }, { CLAUDECODE: "1", [MARKER]: "0" }];
const CALLS = [
  ["reference-transaction", ["preparing"]], ["reference-transaction", ["prepared"]],
  ["reference-transaction", ["committed"]], ["reference-transaction", ["aborted"]],
  ["pre-push", ["origin", "https://example.invalid/repo.git"]],
];
for (const env of PERSON) {
  for (const [hook, args] of CALLS) {
    const r = run(hook, args, env);
    expect(r.status === 0 && r.stderr === "" && r.stdout === "",
      `run ${HOOKS}/${hook} ${args.join(" ")} with the environment ${JSON.stringify(env)}`,
      "exit 0 and no output: a person's git is never touched",
      `exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}${r.error ? `, ${r.error}` : ""}`);
  }
}

// 3. An agent's process (the marker is 1): a ref change is refused while it
//    can still be stopped (every state but "committed" and "aborted", so a
//    state a later git adds is refused too), with a reason on stderr; a push
//    is refused; and the two states whose exit status git ignores pass in
//    silence (a second copy of the reason would be noise).
const AGENT = [{ [MARKER]: "1" }, { CLAUDECODE: "1", [MARKER]: "1" }];
for (const env of AGENT) {
  for (const [hook, args] of [["reference-transaction", ["preparing"]], ["reference-transaction", ["prepared"]],
    ["reference-transaction", ["some-later-state"]], ["reference-transaction", []],
    ["pre-push", ["origin", "https://example.invalid/repo.git"]]]) {
    const r = run(hook, args, env);
    expect(r.status !== 0 && r.status !== null && r.stderr.trim().length > 20 && r.stdout === "",
      `run ${HOOKS}/${hook} ${args.join(" ")} with the environment ${JSON.stringify(env)}`,
      "a non-zero exit and a reason on stderr: an agent's process may not change git",
      `exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}${r.error ? `, ${r.error}` : ""}`);
  }
  for (const state of ["committed", "aborted"]) {
    const r = run("reference-transaction", [state], env);
    expect(r.status === 0 && r.stderr === "" && r.stdout === "",
      `run ${HOOKS}/reference-transaction ${state} with the environment ${JSON.stringify(env)}`,
      "exit 0 and no output (git ignores the status in this state)",
      `exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);
  }
}

// 4. The hooks read no file and start no program but the shell's own: a hook
//    that can break is a hook that can stop the human's commit. (A plain
//    source check: no command substitution, no pipe, no other program.)
//    Words inside quotes are text, not commands, so the command scan reads
//    the code with each quoted string emptied (since 2026-11-21, when the
//    human's message "...human-only; see AGENTS.md rule 15." put a ";"
//    inside a string and the scan read "see" as a command); the scan for a
//    command substitution reads the code as written, since "$(...)" runs
//    inside double quotes too.
for (const hook of ["reference-transaction", "pre-push"]) {
  const code = fs.readFileSync(path.join(root, HOOKS, hook), "utf8").split("\n").filter(line => !/^\s*(#|$)/.test(line)).join("\n");
  const unquoted = code.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  const words = [...unquoted.matchAll(/(?:^|[;&|]|\bthen\b|\belse\b|\bdo\b)\s*([A-Za-z_][\w-]*)/gm)].map(m => m[1]);
  const allowed = new Set(["case", "esac", "echo", "exit", "if", "fi", "then", "else", "printf"]);
  const other = [...new Set(words.filter(w => !allowed.has(w)))];
  expect(other.length === 0 && !/[`$]\(|`/.test(code),
    `read ${HOOKS}/${hook}'s commands`,
    "only the shell's own words (case, echo, exit, test brackets): nothing that can be missing or fail",
    `other commands ${JSON.stringify(other)}${/[`$]\(|`/.test(code) ? ", and a command substitution" : ""}`);
}

assert.equal(problems.length, 0, `${problems.length} problem(s):\n\n${problems.join("\n\n")}`);
console.log(`qual pass: ${HOOKS}/reference-transaction and ${HOOKS}/pre-push let a person's git through in silence (${PERSON.length} environments x ${CALLS.length} calls), refuse an agent's ref changes and pushes with a reason (${AGENT.length} environments), and run nothing but the shell`);

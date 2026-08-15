// The PREWORK phase of task execution (task-prework DESIGN §3): the
// deterministic first phase, run as a SUBPROCESS before the agentic phase (when
// there is one) — code work, Action-side, over the one sanctioned non-MCP
// surface (the Action GITHUB_TOKEN, inherited in `env`). Prework and agentic
// work are similar, consecutive parts of one task execution; neither may decide
// to skip the run — that decision belongs to the precondition alone.
//
// The subprocess is the scheduler's child, so its `prework_timeout`
// is a HARD kill: a manual timer SIGKILLs an overrun and the run is reported
// failed. Its cwd is the TASK directory, so a declared `node worker.mjs` resolves
// to the script beside task.mjs (the containment the contract enforces); the repo
// root and slot context are handed in via CLAUDINITE_* env so the worker can act
// on the whole repo. Nothing the subprocess prints is threaded into the agent —
// prework communicates only through the repository (DESIGN §3).
//
// THE LOG IS NOT THAT CHANNEL. The child's output is ECHOED to the scheduler's own
// stdout/stderr as it arrives, so the Action log carries what the worker actually
// did. That is an observability decision, not a data channel: no agent reads the
// log, and §3's "communicate only through the repository" is untouched. It is echoed
// LIVE rather than dumped at exit for the case that needs it most — a worker SIGKILLed
// at its timeout, whose buffered output would otherwise die with it. Before this,
// a failed worker surfaced as a bare `preprocessing exited 1` plus a three-line
// stderr tail in an issue, and diagnosing one meant reproducing it by hand.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Run `command` as a subprocess bounded by `timeoutSeconds`. Resolves (never
// rejects) with { ok, timedOut, code, signal, stdout, stderr }: `ok` is a clean
// zero exit that did not time out. `taskDir` is the cwd; `env` is the full
// environment the child inherits (the caller injects GITHUB_TOKEN + CLAUDINITE_*).
// `echo` (default on) mirrors the child's output to this process as it arrives —
// injected rather than hardcoded so a test can capture it instead of polluting the
// test runner's own output.
export function runPrework(command, {
  taskDir, env, timeoutSeconds,
  echo = (chunk, stream) => (stream === 'stderr' ? process.stderr : process.stdout).write(chunk),
}) {
  return new Promise((resolve) => {
    // `detached` puts the shell and everything it spawns in their OWN process
    // group, which is what makes the kill below reach the worker: `shell: true`
    // means the direct child is `sh -c`, and signalling it alone leaves the
    // worker running — still acting on the repo, past a bound the scheduler has
    // already reported as enforced — while `close` waits on the stdio pipes the
    // survivor still holds.
    const child = spawn(command, { cwd: taskDir, env, shell: true, detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // Echo is best-effort: a worker's output must never be the thing that fails the
    // run, so a broken sink is swallowed rather than propagated.
    const mirror = (chunk, stream) => { try { echo?.(String(chunk), stream); } catch { /* the run matters, the echo does not */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      // The hard kill — no grace period past the declared bound. Negative pid is
      // the whole group; if the group is already gone, so is the worker.
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutSeconds * 1000);

    child.stdout?.on('data', (d) => { stdout += d; mirror(d, 'stdout'); });
    child.stderr?.on('data', (d) => { stderr += d; mirror(d, 'stderr'); });
    // A spawn error (command not found, etc.) is a failure, not a throw.
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut, code: null, signal: null, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, timedOut, code, signal, stdout, stderr });
    });
  });
}

// The conditional-handoff signal (task-prework DESIGN §3, E4). A task with
// BOTH prework AND a non-`none` agent_model hands off to the agent
// ONLY when its worker requests it — so a task can absorb its work into
// prework and be AGENTLESS on the quiet nights. The scheduler hands the
// worker this path via CLAUDINITE_REQUEST_AGENT and files `ready-for-agent` iff
// the worker created it. It is a pure control signal: the worker communicates
// DATA to the agent only through the repository, never through this file (DESIGN
// §3, "no code→agent data channel"). The hand-off condition must name work
// prework COULD not do — never re-check whether the run should have happened;
// the precondition already decided that.
export function agentRequestPath({ pack, task, slotId }) {
  return join(tmpdir(), `claudinite-request-agent-${pack}-${task}-${slotId}`);
}
export function clearAgentRequest(path) { try { rmSync(path, { force: true }); } catch { /* nothing to clear */ } }
export function agentRequested(path) { return existsSync(path); }

// …AND the artifacts that request refers to, plus why it was made. A worker writes
// JSON `{ delivered: { branch, pr, merged }, reason: { code, detail } }`, and the
// scheduler records both in the dispatch issue, which is where the agent reads them.
//
// This is the one thing that crosses the code→agent boundary as data (§3's named
// exception): identifiers for what this run created — a PR number, a branch ref — and
// the NAME of the condition that woke the agent. Never findings and never instructions:
// `reason.detail` says which gate fired and how many of what, and the findings
// themselves stay in the repo for the agent to re-run. Everything else still travels
// through the repository.
//
// Both keys are optional and their ABSENCE is meaningful, which is also what keeps an
// older vendored worker (one that predates a key) working: a worker that created
// nothing writes no `delivered` and the issue names none; a worker that does not know
// about `reason` writes none and the issue explains nothing, rather than asserting
// something false about why the agent is there.
export function readAgentRequest(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  // A bare marker line (no payload) requests the agent and names no artifacts.
  try { return JSON.parse(raw); } catch { return {}; }
}

// A one-line reason for the job summary / an issue comment when prework
// fails — distinguishing a timeout kill from a non-zero exit.
export function preworkFailure(result) {
  if (result.timedOut) return 'prework exceeded its prework_timeout and was killed';
  if (result.code !== null) return `prework exited ${result.code}`;
  return `prework could not run: ${result.stderr.trim().split('\n').pop() || 'unknown error'}`;
}

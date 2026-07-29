// The one SessionEnd command a consumer's .claude/settings.json wires. Like its
// siblings the address is the stable contract (#385: the settings file changes as
// seldom as possible), and like the SessionStart orchestrator it is a RUNNER, not a
// step: it invokes each ACTIVE pack's own `session-end.mjs`, discovered structurally
// exactly as tasks, prose and skills are. Core never names the pack whose step it
// runs, and never learns what one does — a session-end step is pack content, and the
// engine's whole part is "invoke it, once, when the session ends"
// (skill-usage-metrics DESIGN §3.3).
//
// SessionEnd, not Stop. Stop fires at every turn end (and already runs the
// conformance checks); a step that writes anything per-session would fire once per
// TURN there. SessionEnd fires once, when the session ends.
//
// BEST EFFORT, and that is enough. A container reclaimed by timeout never fires
// this hook at all, so nothing may depend on it having run: every firing strictly
// enriches the record, every miss leaves exactly the prior behaviour.
//
// FAIL-SOFT, absolutely. A session must never fail to end because of this hook, so
// every error — a step that throws, a step that hangs, a broken pack registry — is
// swallowed, recorded via hooklog, and exited 0. The per-step bound is a hard kill;
// nothing here can wedge a session.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooklog } from '../checks/helpers/hook-log.mjs';

// The step file an active pack contributes, if it ships one.
export const STEP_FILE = 'session-end.mjs';

// A step gets this long before it is killed. Generous — a capture step pushes to a
// remote — but finite: a hung step must not hold the session open.
const STEP_TIMEOUT_MS = 120_000;

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const engineRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Claude Code passes the hook's input JSON on stdin: { session_id, transcript_path,
// reason, … }. A manual run (TTY, or nothing parseable) simply hands the steps
// nothing and they fall back to their own discovery.
function hookInput() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function main() {
  const input = hookInput();
  const configPath = join(projectRoot, '.claudinite-checks.json');
  let config = { packs: [] };
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* no declaration — no active packs */ }

  const { loadPacks, isActive } = await import(join(engineRoot, 'pack_loader', 'pack-registry.mjs'));
  const steps = (await loadPacks({ localRoot: projectRoot }))
    .filter((p) => isActive(p, config))
    .map((p) => ({ pack: p.id, step: join(p.dir, STEP_FILE) }))
    .filter((s) => existsSync(s.step));
  if (!steps.length) return; // nothing declared contributes a session-end step

  for (const { pack, step } of steps) {
    hooklog('SessionEnd', `start ${pack}`);
    const run = spawnSync(process.execPath, [step], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: STEP_TIMEOUT_MS,
      env: {
        ...process.env,
        // What the harness told US about this session, handed on so a step never has
        // to re-derive it. Named for the engine, not for any one step's CLI flags.
        ...(input.session_id ? { CLAUDINITE_SESSION_ID: String(input.session_id) } : {}),
        ...(input.transcript_path ? { CLAUDINITE_TRANSCRIPT: String(input.transcript_path) } : {}),
      },
    });
    const tail = (run.stdout || run.stderr || '').trim().split('\n').pop() || '';
    hooklog('SessionEnd', run.status === 0
      ? `done exit=0 ${pack}${tail ? `: ${tail}` : ''}`
      : `done exit=0 ${pack} step failed (${run.signal ? `killed ${run.signal}` : `exit ${run.status}`})${tail ? `: ${tail}` : ''}`);
  }
}

main().catch((e) => { hooklog('SessionEnd', `done exit=0 runner error: ${e.message}`); })
  .finally(() => process.exit(0)); // never block a session from ending

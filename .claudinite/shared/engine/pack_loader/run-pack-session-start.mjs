#!/usr/bin/env node
// SessionStart step: run every ACTIVE pack's own `session-start.mjs` and forward
// what it prints into the session context.
//
// THE SYMMETRIC HALF OF THE SessionEnd RUNNER (engine/hooks/session-end-command.mjs),
// on the same terms: a step is discovered STRUCTURALLY — a pack ships the file or it
// doesn't — activation-gated by the repo's declaration, bounded, and fail-soft. Core
// never names the pack whose step it runs and never learns what one does. The one
// difference is the direction the output travels: a session-end step's output is a
// log line, and a session-start step's output IS the contribution, so it is forwarded
// to stdout (which SessionStart adds to the session context).
//
// WHY IT EXISTS AT ALL, given pack prose already loads every session: prose is a
// FILE, fixed at vendor time and identical for every repo and every person that
// mounts it. Some pack content can only be known when the session starts — content
// that lives outside this repo, or that is keyed to the person in front of it. A
// pack that needs that has, until now, had nowhere to put it: its choices were a
// static file that cannot say the thing, or a core step that names the pack, which
// is the coupling the pack system exists to prevent. This closes that gap once,
// generically, rather than growing a bespoke core step per pack.
//
// THE COST IT IMPOSES, and the two bounds that keep it honest. A step is a
// subprocess on the session-start path, and its output lands in a finite context
// window. So: every step is killed at CLAUDINITE_PACK_STEP_TIMEOUT_MS, and its
// contribution is capped at CLAUDINITE_PACK_STEP_MAX_BYTES with the truncation
// stated in the injected text. Neither is a knob a pack can raise — they are the
// engine's terms for lending out the session's start.
//
// PLAIN TEXT ONLY, like every other step: one hook's stdout must never mix JSON and
// prose, and nothing here may emit a halt directive on a step's behalf. A step that
// fails, hangs, or exits non-zero yields one note naming the pack, and the session
// proceeds — exit 0, always, because a non-zero exit makes Claude Code discard the
// orchestrator's whole stdout, including the steps that did work.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The file an active pack contributes, if it ships one. Named for when it runs, and
// deliberately the mirror of the session-end runner's STEP_FILE.
export const STEP_FILE = 'session-start.mjs';

// Bounds, overridable only for tests (the env names are the engine's, not a pack's).
const TIMEOUT_MS = Number(process.env.CLAUDINITE_PACK_STEP_TIMEOUT_MS) || 20_000;
const MAX_BYTES = Number(process.env.CLAUDINITE_PACK_STEP_MAX_BYTES) || 32_768;

const note = (s) => process.stdout.write(`PACK STEP: ${s}\n`);

async function main() {
  const loaderDir = dirname(fileURLToPath(import.meta.url)); // <corpus>/engine/pack_loader
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let config = { packs: [] };
  const configPath = join(projectRoot, '.claudinite-checks.json');
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { return; } // unparsable settings are the world runner's finding
  }

  const { loadPacks, isActive, packEntryId } = await import(join(loaderDir, 'pack-registry.mjs'));
  const packs = (await loadPacks({ localRoot: projectRoot })).filter((p) => isActive(p, config));
  if (!packs.length) return; // this repo runs no Claudinite, or declares nothing — say nothing

  // Each entry's own `config`, keyed by bare pack id: a step is handed its pack's
  // parameters rather than re-reading and re-normalizing the declaration itself.
  // Read here, from the raw file, because the step runs before anything else has
  // loaded the settings — and because one reader beats one per pack.
  const entryConfig = new Map();
  for (const entry of Array.isArray(config.packs) ? config.packs : []) {
    if (entry && typeof entry === 'object' && entry.config) entryConfig.set(packEntryId(entry), entry.config);
  }

  for (const pack of packs) {
    const step = join(pack.dir, STEP_FILE);
    if (!existsSync(step)) continue;

    const run = spawnSync(process.execPath, [step], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES * 4, // room to notice an over-cap step rather than erroring on it
      env: {
        ...process.env,
        // What the pack declared about itself, verbatim. `{}` and not undefined: a
        // step should branch on what its config SAYS, never on whether the engine
        // remembered to hand it one.
        CLAUDINITE_PACK_CONFIG: JSON.stringify(entryConfig.get(pack.id) ?? {}),
        CLAUDINITE_PACK_DIR: pack.dir,
      },
    });

    // A step that outran the read buffer is OVER CAP, not broken: it is the cap's
    // case, so it is truncated like any other over-cap step rather than reported as
    // a failure — and the buffer is set above the cap precisely so this branch means
    // "far too much", never "slightly over". Decided FIRST, because overrunning the
    // buffer also kills the child, which would otherwise read as a timeout.
    const overflowed = run.error?.code === 'ENOBUFS';
    if (!overflowed && (run.error?.code === 'ETIMEDOUT' || run.signal)) {
      note(`the "${pack.id}" pack's ${STEP_FILE} did not finish in ${Math.round(TIMEOUT_MS / 1000)}s and was stopped — continuing without what it would have said.`);
      continue;
    }
    if (!overflowed && run.status !== 0) {
      // Its output is not injected: a step that exited non-zero has said something
      // unfinished, and half a contribution read as a whole one is worse than none.
      const why = (run.stderr || '').trim().split('\n').pop() || `exit ${run.status}`;
      note(`the "${pack.id}" pack's ${STEP_FILE} failed (${why}) — continuing without what it would have said.`);
      continue;
    }

    let text = (run.stdout || '').trim();
    if (!text) continue; // nothing to say is a legitimate answer, and gets no marker
    if (overflowed || Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
      text = `${Buffer.from(text, 'utf8').subarray(0, MAX_BYTES).toString('utf8')}\n\n[truncated at ${MAX_BYTES} bytes — the "${pack.id}" pack's ${STEP_FILE} produced more session context than a step may contribute]`;
    }
    // The same marker the prose injector uses, so a reader can tell which pack is
    // talking whether the text came from a file or from a step.
    process.stdout.write(`<!-- pack:${pack.id} -->\n${text}\n\n`);
  }
}

// Fail-soft to the end: a broken registry, an unreadable pack tree, anything —
// one note, exit 0.
main()
  .catch((e) => note(`the pack session-start runner could not complete (${e.message}) — continuing.`))
  .finally(() => process.exit(0));

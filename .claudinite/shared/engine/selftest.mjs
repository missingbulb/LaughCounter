#!/usr/bin/env node
// The Claudinite SELF-TEST — "can Claudinite run here?", and nothing else.
//
// Deliberately NOT a conformance check. `check_the_world` judges the repo's
// CONTENT against the rules; this judges whether the MACHINERY that would run
// those rules is intact. A repo can be perfectly conformant and still have a
// broken mount, a hook pointing at a file that no longer exists, or a pack whose
// manifest the loader silently drops — and every one of those is invisible to a
// content check, because a rule that never runs reports nothing.
//
// WHY IT EXISTS. Every fleet-wide failure this corpus has had was of that shape:
//
//   #397  inject-pack-prose imported a module that did not exist, so every
//         active pack's RULES.md was silently un-injected, fleet-wide, for days
//   #518  loadConfig dropped the mount stamp, so baselining self-skipped
//         everywhere and no run ever said so
//   #555  a required manifest field landed with no migration; consumer packs
//         stopped validating, and (because normalizeManifest rebuilds `rules`
//         from the scoped lists) their checks stopped running silently
//   #424  five mounted skill links dangled on main, unnoticed
//
// None was caught by canon CI, because the canon's own tree is always already
// correct. All four are assertions below, and each would have fired on the first
// session after the change — on the member, where the damage was.
//
// CONTRACT. Fast (no network, no clone), read-only, and it never throws: a probe
// that cannot run is a FAILED probe with the reason attached, never a crash that
// takes the session-start orchestrator down with it.
//
// Pure core + thin I/O shell, the corpus idiom: `report()` takes plain probe
// results and decides the outcome, so the whole decision surface is testable
// without a repo on disk.

import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MOUNT = '.claudinite/shared';
export const CHECKS = '.claudinite-checks.json';
export const SETTINGS = '.claude/settings.json';
export const SCHEDULER = '.github/workflows/claudinite-scheduler.yml';

// A probe result. `ok: null` means NOT APPLICABLE — the thing this probe would
// judge is legitimately absent (no scheduler in a repo that never cut over, no
// local packs declared). Not-applicable is never a failure; conflating the two
// is how a check earns its reputation for crying wolf.
export const pass = (id) => ({ id, ok: true });
export const skip = (id, why) => ({ id, ok: null, detail: why });
export const fail = (id, detail, fix) => ({ id, ok: false, detail, fix });

// The verdict over a probe set. Exit code is the caller's business — this only
// says what happened, so both callers (a session-start step that must never
// block, and a strict CI/bootstrap run that must) read the same result.
export function report(probes) {
  const failures = probes.filter((p) => p.ok === false);
  const ran = probes.filter((p) => p.ok !== null).length;
  return {
    ok: failures.length === 0,
    ran,
    skipped: probes.length - ran,
    failures,
    summary: failures.length
      ? `Claudinite self-test: ${failures.length} of ${ran} probes FAILED — ${failures.map((f) => f.id).join(', ')}`
      : `Claudinite self-test: ${ran} probes passed.`,
  };
}

// --- the probes ------------------------------------------------------------
// Each takes an injected `io` ({ exists, read, dirs, resolves }) so the whole
// set runs against an in-memory tree in tests. No probe imports another's
// result: a broken mount must not cascade into eight confusing failures, so
// each says one true thing about the repo in front of it.

export function probeMount(io) {
  if (!io.exists(MOUNT)) return skip('mount', 'no vendored mount — this is the canon itself, or a repo that has not adopted');
  if (!io.exists(`${MOUNT}/engine/checks/check_the_world.mjs`)) {
    return fail('mount', `${MOUNT} exists but carries no engine`, 're-run baselining, or bootstrap this repo — the mount is incomplete');
  }
  return pass('mount');
}

export function probeStamp(io) {
  const raw = io.read(CHECKS);
  if (raw === null) return fail('stamp', `${CHECKS} is missing`, 'run bootstrap --init to write the declaration');
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) {
    return fail('stamp', `${CHECKS} is not valid JSON: ${e.message}`, 'fix the JSON syntax — nothing can read the declaration until it parses');
  }
  if (!io.exists(MOUNT)) return skip('stamp', 'no vendored mount to stamp');
  const s = cfg.claudinite;
  if (!s || typeof s.updated !== 'string' || !s.updated) {
    return fail('stamp', 'the mount is present but carries no claudinite.updated stamp',
      'baselining reads this to decide whether to run and which migration notes apply — a missing stamp makes it self-skip forever (#518)');
  }
  return pass('stamp');
}

// The #555 probe. A manifest the loader rejects means that pack's rules never
// run — silently, because normalizeManifest rebuilds `rules` from the scoped
// lists and an unvalidated manifest contributes none.
export function probePackManifests(loaded) {
  if (!loaded) return skip('pack-manifests', 'the pack loader could not be reached from here');
  if (loaded.errors?.length) {
    const first = loaded.errors[0];
    return fail('pack-manifests', `${loaded.errors.length} pack(s) failed to load or validate — first: ${first.what ?? first}`,
      first.fix ?? 'fix the manifest — a pack that does not validate contributes no rules, so its checks stop running with no other symptom');
  }
  if (!loaded.packs?.length) return fail('pack-manifests', 'no packs were discovered at all', 'check the mount and the declaration — a session with no packs enforces nothing');
  return pass('pack-manifests');
}

export function probeHookTargets(io) {
  const raw = io.read(SETTINGS);
  if (raw === null) return skip('hook-targets', 'no .claude/settings.json');
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) {
    return fail('hook-targets', `${SETTINGS} is not valid JSON: ${e.message}`, 'fix the JSON — the harness silently runs no hooks when its settings will not parse');
  }
  const missing = [];
  for (const entries of Object.values(cfg.hooks ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const hook of entry.hooks ?? []) {
        const cmd = String(hook.command ?? '');
        // The path inside the command, with the harness's variable resolved.
        const m = cmd.match(/\$CLAUDE_PROJECT_DIR\/(\S+)/);
        if (m && !io.exists(m[1])) missing.push(m[1]);
      }
    }
  }
  if (missing.length) {
    return fail('hook-targets', `${missing.length} hook command(s) point at files that do not exist: ${missing.join(', ')}`,
      're-run baselining to converge the wiring — a hook whose target is missing fails silently every session (#397)');
  }
  return pass('hook-targets');
}

export function probeSkillLinks(io) {
  const root = '.claude/skills';
  if (!io.exists(root)) return skip('skill-links', 'no mounted skills');
  const dangling = io.dangling(root);
  if (dangling.length) {
    return fail('skill-links', `${dangling.length} mounted skill link(s) dangle: ${dangling.slice(0, 5).join(', ')}`,
      're-run the skill mount (baselining does it) — a dangling link is a skill the session cannot load (#424)');
  }
  return pass('skill-links');
}

export function probeScheduler(io) {
  const text = io.read(SCHEDULER);
  if (text === null) return skip('scheduler', 'no vendored scheduler workflow — this repo has not cut over to per-project scheduling');
  const crons = [...text.matchAll(/cron:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1].trim());
  if (crons.length !== 1) {
    return fail('scheduler', `the scheduler declares ${crons.length} cron schedules, expected exactly one`, 'keep a single hourly cron — the scheduler is the repo\'s only cron');
  }
  const parts = crons[0].split(/\s+/);
  if (parts.length !== 5 || !Number.isInteger(Number(parts[0]))) {
    return fail('scheduler', `the scheduler cron "${crons[0]}" does not parse as a 5-field expression with a fixed minute`,
      'set "<minute> * * * *" with the repo-hashed minute — an unparseable cron means the repo never runs a task again');
  }
  return pass('scheduler');
}

export function probeMigrations(migrations) {
  if (migrations === null) return skip('migrations', 'no migrations registry reachable from here');
  if (migrations instanceof Error) {
    return fail('migrations', `the migrations registry failed to load: ${migrations.message}`,
      'a malformed record aborts every baselining run — fix or remove it');
  }
  return pass('migrations');
}

// --- the I/O shell ---------------------------------------------------------

function makeIo(root) {
  const abs = (p) => join(root, p);
  return {
    exists: (p) => existsSync(abs(p)),
    read: (p) => { try { return readFileSync(abs(p), 'utf8'); } catch { return null; } },
    // Symlinks under a directory whose targets do not resolve.
    dangling: (rel) => {
      const out = [];
      const walk = (dir) => {
        let entries = [];
        try { entries = readdirSync(abs(dir), { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = `${dir}/${e.name}`;
          if (e.isSymbolicLink()) {
            try { realpathSync(abs(p)); } catch { out.push(p); }
          } else if (e.isDirectory()) walk(p);
        }
      };
      walk(rel);
      return out;
    },
    lstat: (p) => { try { return lstatSync(abs(p)); } catch { return null; } },
  };
}

// Load the pack set and the migrations registry from whichever corpus this file
// is running out of — the canon root, or a consumer's vendored mount. Both are
// best-effort: a failure to reach them is a probe result, never a throw.
async function loadCorpus(root) {
  const corpus = dirname(dirname(fileURLToPath(import.meta.url))); // <corpus>/engine/ -> <corpus>
  let loaded = null;
  try {
    const { discoverPacks } = await import(pathToFileURL(join(corpus, 'engine/pack_loader/pack-registry.mjs')).href);
    loaded = await discoverPacks({ localRoot: root });
  } catch (e) { loaded = { packs: [], errors: [{ what: `the pack loader itself failed: ${e.message}`, fix: 'the engine is broken or half-vendored — re-run baselining' }] }; }

  let migrations = null;
  // The registry moved under the engine with the engine/pack split; a mount that
  // has not converged since still carries the flat path, and probing it as absent
  // would report a HEALTHY-looking skip on a repo whose registry is right there.
  const regPath = [join(corpus, 'engine/migrations/registry.mjs'), join(corpus, 'migrations/registry.mjs')]
    .find((p) => existsSync(p));
  if (regPath) {
    try {
      const reg = await import(pathToFileURL(regPath).href);
      await reg.loadMigrations();
      migrations = true;
    } catch (e) { migrations = e; }
  }
  return { loaded, migrations };
}

export async function runSelfTest(root) {
  const io = makeIo(root);
  const { loaded, migrations } = await loadCorpus(root);
  return report([
    probeMount(io),
    probeStamp(io),
    probePackManifests(loaded),
    probeHookTargets(io),
    probeSkillLinks(io),
    probeScheduler(io),
    probeMigrations(migrations),
  ]);
}

// CLI. Default is REPORT-ONLY (exit 0) because the SessionStart orchestrator
// discards a hook's stdout on a non-zero exit — failing loudly there would
// destroy the very message it is trying to deliver. `--strict` exits 1 on
// failure, for bootstrap and for baselining's prework, where a broken
// mechanism must stop the run rather than be reported into a void.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const strict = process.argv.includes('--strict');
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = await runSelfTest(root);
  console.log(result.summary);
  for (const f of result.failures) console.log(`  - ${f.id}: ${f.detail}\n    fix: ${f.fix}`);
  process.exit(strict && !result.ok ? 1 : 0);
}

#!/usr/bin/env node
// SessionStart step: state, in one line, WHAT ACTUALLY LOADED this session —
// the active packs, the checks they arm, the token weight of the prose injected,
// the skills mounted, plus whatever facet an active pack contributes about
// itself. Its stdout becomes session context, and it carries the directive that
// makes the session open with the line, so the person in front of it sees the
// load stated back rather than having to trust that it happened.
//
// WHY IT IS NOT THE ORCHESTRATOR'S FOOTER. That footer reports the MACHINERY:
// which steps ran and which crashed. This reports the VOLUME: how much guidance
// is in the window and how much of it is armed as checks. The two answer
// different questions and neither substitutes for the other — a session where
// every step ran and nothing was declared looks identical from the footer alone.
//
// RUNS LAST, after the steps whose work it counts (the skill mount), so it describes
// the session that exists rather than the one about to. The prose it weighs no longer
// arrives through this hook at all — it rides CLAUDE.md since #807 — but the weight is
// still this line's to state, because the cost lands in the same context window and a
// session that cannot see it has no way to notice the corpus growing.
//
// Core names no pack to get a pack-specific facet. A pack that has one states it
// on the FACET CHANNEL — a `CLAUDINITE-FACET:` line from its session-start step,
// collected by the step runner (engine/pack_loader/run-pack-session-start.mjs)
// into the file `CLAUDINITE_SESSION_FACETS` names — and this step appends what it
// finds there. The channel rides the step because the facts worth stating are the
// ones a pack had to COMPUTE: a static count is already in prose the reader has.
//
// Fails soft to silence, and exits 0 always — a non-zero exit makes Claude Code
// DISCARD the orchestrator's whole stdout, including the steps that did work.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The prose is reported in TOKENS because that is the unit of the cost it
// imposes — a context window, not a disk. The estimate goes through WORDS at the
// standard English ratio of roughly 0.75 words per token: prose is words, and a
// character count is thrown off by exactly what this corpus is full of — code
// fences, paths, punctuation-dense Markdown. Rounded, because a session summary
// is a sense of scale, not an accounting.
const WORDS_PER_TOKEN = 0.75;
const TOKEN_ROUNDING = 500;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

try {
  const loaderDir = dirname(fileURLToPath(import.meta.url)); // <corpus>/engine/pack_loader
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let declared = [];
  const configPath = join(projectRoot, '.claudinite-checks.json');
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    if (Array.isArray(raw.packs)) declared = raw.packs;
  }

  const { loadPacks, isActive, bundledSkillSources } = await import(join(loaderDir, 'pack-registry.mjs'));
  const packs = await loadPacks({ localRoot: projectRoot });
  const active = packs.filter((pack) => isActive(pack, { packs: declared }));
  // Nothing active means this repo runs no Claudinite. Nothing loaded, so there
  // is nothing to state — the same silence the prose injector keeps.
  if (!active.length) process.exit(0);

  // The prose the injector actually emits: each active pack's own file, resolved
  // off the pack's directory, trimmed the way the injector trims it. The routing
  // table and the directory pointer are the injector's framing rather than a
  // pack's rules, so they are not counted here.
  let proseWords = 0;
  for (const pack of active) {
    if (!pack.prose) continue;
    const prosePath = join(pack.dir, pack.prose);
    if (!existsSync(prosePath)) continue;
    try {
      proseWords += readFileSync(prosePath, 'utf8').trim().split(/\s+/).filter(Boolean).length;
    } catch { /* an unreadable file counts as none */ }
  }
  const tokens = Math.round(proseWords / WORDS_PER_TOKEN / TOKEN_ROUNDING) * TOKEN_ROUNDING;

  // Checks are the active packs' rules, both scopes — what check_the_world and
  // check_the_work between them will run against this repo.
  const checks = active.reduce((n, pack) => n + (pack.rules?.length ?? 0), 0);

  const facets = [
    plural(active.length, 'pack'),
    plural(checks, 'check'),
    `${tokens.toLocaleString('en-US')} rule tokens`,
    plural(bundledSkillSources(active).size, 'available skill'),
  ];

  // Whatever the active packs' steps said about themselves, in the order the
  // runner ran them. Absent file, unreadable file, no channel at all: the engine
  // facets stand on their own.
  const facetsFile = process.env.CLAUDINITE_SESSION_FACETS;
  if (facetsFile && existsSync(facetsFile)) {
    try {
      for (const line of readFileSync(facetsFile, 'utf8').split('\n')) {
        if (line.trim()) facets.push(line.trim());
      }
    } catch { /* one unreadable channel is not the session's problem */ }
  }

  // The directive comes FIRST and the line it names comes last, quoted by the colon:
  // a reader picking the nearest line then picks the summary. Said the other way round,
  // with the summary above and a "repeat that line" below it, the nearest line is the
  // directive itself — and sessions duly opened their replies by reciting it.
  process.stdout.write(
    'SESSION-START SUMMARY — an instruction to you, not text to repeat. '
    + 'Open your first reply of this session with exactly this line, and nothing before it:\n\n'
    + `Claudinite loaded, ${facets.join(', ')}.\n`,
  );
} catch {
  // fail soft — a broken summary must never block a session
}

#!/usr/bin/env node
// World-scope conformance runner (see DESIGN.md): the rules that audit repo
// state as it exists now, plus the pack-agnostic settings/load integrity
// diagnostics (malformed config, an unknown pack, a broken pack.mjs). Rules that
// judge the current change (`scope: 'work'`) run in check_the_work.mjs, which
// this file shares no code with — only the scope-blind mechanism helpers
// (run-active-pack-rules.mjs, report-findings.mjs). It names NO pack: adoption
// interview hygiene is a skill-owned check that rides its own pack's activation,
// and a malformed `questions` field is a load fault the pack registry reports.
// Wired into the project's test/CI flow, not the Stop hook. Dependency-free Node ≥18.
//   (default)   whole-repo sweep — milliseconds on a text corpus, sees cross-file breakage
//   --changed   transitional: scope to files changed vs the merge-base with main
//               (adopting a repo with a backlog only — not the enforcement default)
//   --base REF  override the base ref
//   --list      machine-readable catalog of every rule, both scopes (id, severity, description, doc)
//   --init      write .claudinite-settings.json — basics plus the fingerprinted packs
import { buildContext } from './helpers/repo-context.mjs';
import { discoverPacks, packEntryId } from '../pack_loader/pack-registry.mjs';
import { runActivePackRules, packRules } from './run-active-pack-rules.mjs';
import { reportFindings } from './report-findings.mjs';

const configError = (what, fix) => ({
  rule: 'config', severity: 'blocking', file: '.claudinite-settings.json', line: null,
  what, why: 'the settings file is what executes — a bad key, value, or pack name silently changes what runs', fix, doc: 'engine/checks/README.md',
});

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
// The repo to sweep. `--root` first, then CLAUDE_PROJECT_DIR, and only then the cwd.
// The env var is not a convenience: the callers that run this from inside a converge
// (the update runner) have a cwd that no longer exists — the vendor step deletes
// `.claudinite/shared/`, which is where code-work's cwd lives — and `process.cwd()` then
// throws `ENOENT … uv_cwd` before a single check runs, which reads from the outside as
// "this mount has no checks" (#689). engine/selftest.mjs has always resolved its root
// this way; this closes the disagreement for every caller, not just that one.
const root = value('--root') || process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (has('--list')) {
  const { packs } = await discoverPacks({ localRoot: root });
  for (const r of packRules(packs)) {
    // A declared check carries neither a description nor a doc pointer — it
    // states its own case — so the catalog prints its failure message in that
    // column and leaves the pointer empty.
    console.log(`${r.id}\t${r.severity}\t${r.description ?? r.why ?? ''}\t${r.doc ?? ''}`);
  }
  process.exit(0);
}

if (has('--init')) {
  const { seedDeclaration } = await import('./helpers/seed-declaration.mjs');
  const { packs } = await discoverPacks({ localRoot: root });
  const { path, existed, declared } = seedDeclaration(root, packs);
  if (existed) {
    console.log(`${path} already exists — leaving it as-is.`);
    process.exit(0);
  }
  console.log(`Wrote ${path} (packs: ${declared.map(packEntryId).join(', ')}).`);
  // The adoption interview (surfacing each declared pack's pending questions) is
  // driven by the adopt-claudinite skill / bootstrap.md, and nudged every session
  // by the SessionStart interview-check step — not printed here, so this runner
  // imports no pack.
  process.exit(0);
}

const { packs, errors: packErrors } = await discoverPacks({ localRoot: root });
const ctx = buildContext({ root, mode: has('--changed') ? 'changed' : 'all', baseOverride: value('--base') });

// Settings/load integrity — pack-agnostic, so the world runner owns them.
// Settings validity is checked at load: malformed JSON, an unknown
// property, and a wrong pack name are all equally settings errors. loadConfig
// reports the first two; the runner adds unknown pack names (only it holds the
// registry) and broken/duplicate local pack.mjs faults.
const findings = [];
for (const e of ctx.config.errors) findings.push(configError(e.what, e.fix));
for (const e of packErrors) findings.push(configError(e.what, e.fix));
// knownIds spans canon AND local packs, so a declared local pack id is valid and
// the unknown-pack message lists it among the declarable packs. ctx.config.packs
// is loadConfig's normalized view — bare ids, a namespaced local_packs/<name>
// declaration already resolved through packEntryId.
const knownIds = new Set(packs.map((p) => p.id));
for (const name of ctx.config.packs) {
  if (typeof name === 'string' && !knownIds.has(name)) {
    findings.push(configError(`declares unknown pack "${name}"`, `remove it or fix the name — declarable packs: ${[...knownIds].sort().join(', ')}`));
  }
}
// (Adoption-interview hygiene is a skill-owned check that runs below with the
// other active-pack rules; a malformed `questions` field arrives as a load fault
// in packErrors above. Neither names a pack here.)

// The world rules: everything not scoped to the work. A broken contributedRules
// seam is a config-level fault surfaced here (the world runner owns diagnostics).
findings.push(...runActivePackRules(ctx, packs, {
  includeRule: (rule) => rule.scope !== 'work',
  onContributeError: (pack, e) => findings.push(configError(
    `the "${pack.id}" pack's contributedRules failed: ${e.message}`, 'fix the pack manifest, or the contribution it interprets')),
}));

const blocking = reportFindings(findings, ctx.config, { scopeLabel: 'world', mode: ctx.mode, baseRef: ctx.baseRef });
process.exit(blocking ? 1 : 0);

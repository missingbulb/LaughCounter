import { finding } from '../../engine/checks/helpers/findings.mjs';
import { resolveStore } from './store.mjs';

// Declaring this pack is a statement that this project's users HAVE a preferences
// store. If its entry names none — or names one that does not resolve — the pack is
// wired up and silently inert: every session reads its fail-soft note instead of
// anyone's preferences, and nothing else ever says so.
//
// ADVISORY, not blocking. The failure is a lost nicety, never a broken repo: no
// check, no task and no other pack depends on the store being reachable, and a
// project mid-adoption (declared, interview not yet answered) is in exactly this
// state legitimately for a while. It is a nudge with the fix in it.
const rule = {
  id: 'preferences-store-configured',
  severity: 'advisory',
  description: 'A declared claude-code-web-users-support pack names a store its session-start step can read',
  doc: 'packs/claude-code-web-users-support/RULES.md',
  why: 'a declared pack with no store injects nobody\'s preferences and says so only in a fail-soft note nobody reads twice',

  run(ctx) {
    // The pack's own entry config, through the engine's normalized per-pack view.
    const config = ctx.config.packConfig?.['claude-code-web-users-support'];
    if (resolveStore(config ?? null)) return [];
    return [finding(rule, {
      file: '.claudinite-checks.json',
      what: config === undefined
        ? 'the claude-code-web-users-support pack is declared but names no store'
        : `the claude-code-web-users-support pack's store does not resolve (${JSON.stringify(config)})`,
      fix: 'give the pack entry a "config": { "repo": "owner/name" } naming the repo that holds this project\'s users\' preferences — "path" is optional and defaults to preferences/',
    })];
  },
};

export default rule;

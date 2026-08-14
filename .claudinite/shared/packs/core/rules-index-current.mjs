import { posix } from 'node:path';
import { finding } from '../../engine/checks/helpers/findings.mjs';
import { packEntryId } from '../../engine/pack_loader/pack-registry.mjs';
import { RULES_INDEX_FILE, RULES_INDEX_IMPORT } from '../../engine/pack_loader/generate-rules-index.mjs';

// The rules index is the ONLY channel a pack's prose reaches a session on (#807). The
// SessionStart prose step that used to carry it is gone, deliberately — one channel, so
// no session can be running on a stale copy of one while the other is fine.
//
// That single channel is what makes this check load-bearing rather than tidy. Every
// converge writes the index, but a repo whose converge has stopped, whose CLAUDE.md was
// hand-edited, or that declared a pack since its last refresh has NO pack rules at all —
// and the loss is invisible from inside the session, which is precisely the property
// #807 was filed about. Going red is the only signal available: an agent cannot notice
// rules it never received.
//
// BLOCKING, and not by habit — an advisory would be read past by the very session that
// is missing the rules that would have told it not to.
//
// WHY IT DOES NOT RE-RENDER THE INDEX AND DIFF IT. The generator is async (loading a
// manifest is a dynamic import) and `runRule` spreads its result synchronously, so a
// rule cannot await. It also should not: rendering here would make the check agree with
// the generator by construction and test nothing. So this asks the questions that can
// be answered from the repo's own files — is there an index, does anything load it, does
// every import resolve, and is every DECLARED pack in it — and the canon's own
// `engine-tests/rules-index.test.mjs` holds the exact-content comparison.
//
// A subset test on purpose: the `requires` closure puts packs in the index that the
// declaration never names, so "every declared pack appears" cannot false-positive on a
// correct index, while still catching the case that matters — a pack declared since the
// last converge, whose rules are simply not loading.
const rule = {
  id: 'rules-index-current',
  severity: 'blocking',
  description: `${RULES_INDEX_FILE} must exist, import every declared pack's rules, and be imported by CLAUDE.md`,
  doc: 'vendoring/DESIGN.md',
  why: 'it is the only channel a pack\'s rules reach a session on; missing, stale or unimported means the session silently runs with none',

  run(ctx) {
    const declared = Array.isArray(ctx.config?.packs) ? ctx.config.packs : [];

    // RELEVANCE FIRST, like the scheduling guards beside it: the subject of this rule
    // is the index that OUGHT to exist, so if nothing would go in it there is nothing
    // to demand. A repo whose declared packs have no prose on disk has not converged
    // its mount yet — a different problem, already reported by the engine's own
    // unknown-pack error, and one this rule would only add noise to.
    //
    // `RULES.md` is spelled here rather than read off each manifest because a rule
    // cannot await a dynamic import (see above). It is safe: `prose` is only ever
    // 'RULES.md' or null across the whole corpus, and `every pack's prose is RULES.md
    // or null` in engine-tests/rules-index.test.mjs is what keeps it so.
    const heldIds = declared.map(packEntryId).filter((id) => id && [
      `.claudinite/shared/packs/${id}/RULES.md`, // a consumer's vendored mount
      `packs/${id}/RULES.md`,                    // the canon, which mounts nothing
      `.claudinite/local/packs/${id}/RULES.md`,  // the repo's own packs
      `.claudinite/local_packs/${id}/RULES.md`,  // …and their pre-rename location
    ].some((p) => ctx.exists(p)));
    if (!heldIds.length) return [];

    const regenerate = 'run `node .claudinite/shared/engine/pack_loader/generate-rules-index.mjs --write` (canon-side: `node engine/pack_loader/generate-rules-index.mjs --write`) and commit the result';
    const findings = [];

    const index = ctx.read(RULES_INDEX_FILE);
    if (index === null) {
      findings.push(finding(rule, {
        file: RULES_INDEX_FILE,
        what: 'the rules index is missing, so no pack\'s RULES.md loads into a session',
        fix: regenerate,
      }));
    } else {
      // Bare `@path` lines — the only thing this file holds, and the only shape the
      // harness follows (an import inside backticks is skipped).
      const imports = index.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('@') && !l.includes('`'))
        .map((l) => l.slice(1));

      for (const rel of imports) {
        // Resolved from the index's OWN directory, because that is what the harness
        // resolves against — the canon's imports climb out of `.claudinite/` with
        // `..`, so this has to normalize rather than concatenate. A dangling import is
        // #807 in a new costume: the channel works, the rules still do not arrive, and
        // nothing says so.
        if (!ctx.exists(posix.normalize(posix.join('.claudinite', rel)))) {
          findings.push(finding(rule, {
            file: RULES_INDEX_FILE,
            what: `the index imports \`${rel}\`, which does not exist — that pack's rules load as nothing`,
            fix: regenerate,
          }));
        }
      }

      // Every declared pack this repo HOLDS prose for must be imported. Gated on
      // held-ness so the rule agrees with the generator, which skips a pack whose
      // files are not vendored rather than emitting a dangling import.
      for (const id of heldIds) {
        if (!imports.some((rel) => rel.includes(`/packs/${id}/`))) {
          findings.push(finding(rule, {
            file: RULES_INDEX_FILE,
            what: `pack "${id}" is declared and its RULES.md is here, but the rules index does not import it — those rules never load`,
            fix: regenerate,
          }));
        }
      }
    }

    // The import must be matched OUTSIDE code spans: the harness skips `@` mentions in
    // backticks, so a CLAUDE.md that merely documents the line is one it never follows —
    // and reading that as wired would be the silent failure again in a new place.
    const claudeMd = ctx.read('CLAUDE.md');
    const imported = claudeMd !== null && claudeMd.split('\n')
      .some((line) => !line.includes('`') && line.includes(RULES_INDEX_IMPORT));
    if (!imported) {
      findings.push(finding(rule, {
        file: 'CLAUDE.md',
        what: `CLAUDE.md does not import ${RULES_INDEX_FILE}, so nothing loads it`,
        fix: `add the line \`${RULES_INDEX_IMPORT}\` to CLAUDE.md — outside backticks, or the harness will not follow it`,
      }));
    }
    return findings;
  },
};

export default rule;

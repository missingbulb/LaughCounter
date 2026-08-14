import { SHARED_SUBDIR } from '../../engine/pack_loader/pack-registry.mjs';

// Consumers must not couple to the vendored canon (vendoring/DESIGN.md): outside
// the wiring set, no file may reference .claudinite/ — product code that wants
// a canon helper inlines it, because depending on canon internals turns every
// canon refactor into a breaking migration for code the canon doesn't own.
//
// A CONTRIBUTED barrier: this module is pure data the barriers pack builds
// into the rule (basics `requires` barriers and carries this under
// `contributes` on its manifest — the declaration-and-configuration
// composition pack-independence mandates, replacing the old code-composed
// defineBarrier import). `gateDir` keeps it inert until the vendored mount
// exists (.claudinite/shared/) — so it never fires in the canon repo or in
// pre-flip consumers.
//
// The wiring carve-outs — the files that legitimately spell .claudinite/ paths:
// - '.claudinite': the mount subtree itself (local/packs/ referencing the canon;
//   the vendored files are already outside the scanned set).
// - '.claude': settings.json registers the hooks by path.
// - '.github/workflows': a repo's own workflow may run the vendored engine.
// - '.gitignore', '.gitattributes': the mount's housekeeping rules.
// - 'CLAUDE.md': the generated rules index's `@` import (#807 — see below).
// - '.claudinite-checks.json': settings legitimately spell paths.
// Coverage note: quoted references (imports, requires, config values) and
// relative traversals resolve and fire; a bare unquoted `.claudinite/...` in
// prose falls outside the engine's candidate shapes — accepted, since
// imports/wiring are the coupling class that matters.
export default {
  id: 'claudinite-isolation',
  // CLAUDE.md's carve-out has been removed once and restored once, and the round trip
  // is worth keeping straight. #384 retired the `@.claudinite/shared/CLAUDE.md` corpus
  // import and had converge-wiring strip it (`removeRetiredCorpusImport`); with the
  // only legitimate reference gone, the carve-out went too. #807 then measured what
  // replaced it: the SessionStart hook the corpus moved onto has no delivery receipt,
  // and ~80KB of guidance was silently truncated away on the way into a live session.
  // So a CLAUDE.md import is wiring again — `@.claudinite/claudinite-rules.GENERATED.md`, the
  // generated rules index (engine/pack_loader/generate-rules-index.mjs), converged by
  // the same flow that converges the hooks.
  //
  // The carve-out is the FILE, not the import: a CLAUDE.md may name the index, and the
  // reason the barrier existed still holds for everything else it could name. The
  // index itself is consumer-owned and sits BESIDE the mount (`.claudinite/`, not
  // `.claudinite/shared/`), so this is not a re-coupling to canon internals the way the
  // retired `shared/CLAUDE.md` import was — which is exactly why that one is still
  // stripped on every converge while this one is written by it.
  description: 'Outside the wiring files (.claude/, .gitignore, .gitattributes, .github/workflows/, CLAUDE.md, the settings file), nothing may reference .claudinite/ — inline what you need instead of importing the canon',
  why: 'the vendored canon is refreshed nightly and refactored upstream; code that reaches into it inherits every canon rename as a breaking change',
  doc: 'vendoring/DESIGN.md',
  // The remedy is to stop depending on the canon, not to relocate the
  // dependency: there is no shared folder both sides may use (the mount is
  // one-directional), and the canon is not the consumer's to restructure. The
  // engine's default first clause would say "route shared code through a
  // shared/contracts folder", which no consumer can act on.
  crossingRemedy: 'inline what you need into your own tree (copy the few lines; the canon is refreshed nightly and is not yours to depend on)',
  crossingExcuse: 'if the crossing is deliberate, excuse it with accept: [{ "rule": "claudinite-isolation", "path": "<file>", "reason": "..." }] in .claudinite-checks.json (a pack-shipped barrier takes no per-rule except entries)',
  gateDir: SHARED_SUBDIR,
  edges: [{
    from: '.',
    to: '.claudinite',
    matchUniqueFilenames: false,
    except: ['.claudinite', '.claude', '.github/workflows', '.gitignore', '.gitattributes', 'CLAUDE.md', '.claudinite-checks.json'],
    reason: 'consumer files must not couple to the vendored canon — the wiring files are the reviewed exceptions (vendoring/DESIGN.md)',
  }],
};

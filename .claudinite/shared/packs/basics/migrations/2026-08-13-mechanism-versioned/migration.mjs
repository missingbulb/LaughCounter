// The maintenance mechanism is renamed `updates` → `versioned` (#768).
//
// The mechanism and the task that runs it were one letter apart — `mechanism:
// "updates"` and `FORCE_TASKS=update` — and they appear together, in the same
// declaration and the same dispatch UI. `versioned` is what the design has called
// this scheme all along ("versioned updates"), and `update` stays the task's name,
// which is right for a thing a repo DOES.
//
// WHY A RECORD AND NOT A CONVERGE. The mechanism is a DECLARATION: the repo's own
// statement about how it wants to be maintained, in the file the repo owns. Nothing
// in the update flows rewrites a member's declaration wholesale — deliberately, since
// that file also holds the pack list, the answers to adoption interviews and every
// reviewed `accept`. So the rename travels the way declaration changes are supposed
// to: one version-ranged record, applied once, idempotent thereafter.
//
// THE ENGINE STILL ANSWERS TO BOTH NAMES while this record drains
// (engine/served-by.mjs, `LEGACY_MECHANISM`). A member reads its own declaration with
// the engine it currently has, which is one cycle behind this record — so if the old
// spelling stopped parsing the moment the record landed, a correctly-declared repo
// would read as `invalid` for exactly one cycle and be reported as misdeclared. The
// vocabulary loses `updates` a release later, once no member carries it.
export default {
  id: 'mechanism-versioned',
  landed: '2026-08-13',
  version: 2,
  summary: 'maintenance.mechanism renamed "updates" → "versioned"; the engine serves both names while this drains',

  // A literal, and one of the rare declaration changes where a literal is honest:
  // every member's `maintenance` block is written by the same automation, so the
  // exact text is shared across the fleet in a way pack lists and interview answers
  // never are. `rewrite` preserves the rest of the file byte for byte, which matters
  // more here than anywhere — this file carries every reviewed exception the repo has.
  rewrite: [{
    file: '.claudinite-checks.json',
    replace: [{ from: '"mechanism": "updates"', to: '"mechanism": "versioned"' }],
  }],

  // …and the half no rewrite can do. THE FIRST RECORD TO DECLARE THIS (#798): the
  // deterministic op above moves the declaration, and a member's OWN prose is where
  // the old name also lives — a README describing how the repo is maintained, a local
  // pack's rules, a comment in a workflow, an issue template. The canon cannot know
  // where those are, because they are member-authored and it has never seen them.
  //
  // This is exactly the boundary the apply stage exists on, and it is worth noting
  // what it is NOT: it is not "the rename might have missed something" — the rewrite
  // is exhaustive over the declaration. It is that the same word means something in
  // this repo's own writing, and only a reader of that writing can judge it.
  applyStage: {
    why: 'the mechanism rename meets whatever this repo wrote about how it is maintained',
    instructions: [
      'The deterministic half already renamed `maintenance.mechanism` in',
      '`.claudinite-checks.json`. Sweep this repo\'s OWN prose for the old name and',
      'update it where it refers to the maintenance mechanism: READMEs, local packs',
      'under `.claudinite/local/`, CONTRIBUTING notes, workflow comments.',
      '',
      'Two things to leave alone. The word "update" as a task id (`FORCE_TASKS=update`,',
      '`basics/update`) is unchanged and correct — only the MECHANISM was renamed, and',
      'the near-collision between the two is the reason it was. And anything under',
      '`.claudinite/shared/` is the vendored mount: it is replaced wholesale by the',
      'update flows and is never edited in a member.',
      '',
      'A repo that never wrote about its own maintenance needs nothing here, and that',
      'is the common case — converge to a no-op rather than inventing a mention.',
    ].join('\n'),
  },
};

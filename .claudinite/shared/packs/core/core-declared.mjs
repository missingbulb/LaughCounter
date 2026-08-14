import { finding } from '../../engine/checks/helpers/findings.mjs';
import { packEntryId } from '../../engine/pack_loader/pack-registry.mjs';

// This pack is mandatory in every member, and a member states that by naming it
// in its own `.claudinite-checks.json`. The declaration is what activates
// anything — a mounted-but-undeclared pack contributes nothing — so a member
// running Claudinite without this entry runs the machinery with none of the
// machinery's rules.
//
// WHAT CARRIES THE GUARANTEE IS NOT THIS RULE. Activation reads the literal
// `packs` list, so a member missing the entry is a member where this rule does not
// run. The entry gets there two other ways, and both are outside any check: the
// `requires` closure writes it whenever a declaration is written, and the
// core-seed record declares it into a member that already exists. What this rule
// adds is the third state — an entry deleted by hand after the fact, in a repo
// whose other packs still hold the declaration open. It reports; it cannot rescue.
//
// The id is a literal rather than a walk of every active pack's `requires`,
// because a rule's `run` is synchronous and loading a manifest is a dynamic
// import. The canon's own packs-tests/core/mandatory.test.mjs holds the rest of
// the invariant — the edge, the closure and the home's own declaration — so the
// literal cannot drift from the manifest that earns it.
//
// BLOCKING SINCE THE FLEET CARRIED IT. It shipped advisory on the
// `conformance-workflow` precedent (and the #555 failure both are drawn from):
// blocking from the start would have turned every member red on its very next
// update, before the record that declares this pack had reached it. The forced
// pass of 2026-08-14 landed the declaration in all 11 non-dormant members and the
// canon home, each read back individually, so the reason to hold it advisory is
// spent — and the same pass moved the update task into this pack, which makes a
// missing declaration cost a member its self-refresh rather than just its rules.
//
// The three self-declared dormant members are knowingly outside this (owner
// decision, 2026-08-14): they were never forced, so they do not carry the
// declaration, and a repo that wakes needs `"core"` added to its `packs` array by
// hand before its scheduler works again. This rule cannot report that — it does
// not run when the pack is undeclared — which is exactly why the repair is
// written down rather than left to be rediscovered.
const CORE = 'core';
const DECLARATION = '.claudinite-checks.json';

const rule = {
  id: 'core-declared',
  severity: 'blocking',
  description: `${DECLARATION} must declare the "${CORE}" pack — it is mandatory in every Claudinite member`,
  doc: 'packs/core/README.md',
  why: 'core carries Claudinite\'s own rules — the mount, the declaration, adoption, the update and the task contract — and a member that does not declare it runs the machinery with none of them',

  run(ctx) {
    // Relevance first: no declaration at all means this is not a member, and the
    // world runner already reports a malformed one as the settings error it is.
    if (!ctx.files.includes(DECLARATION)) return [];
    const declared = Array.isArray(ctx.config?.packs) ? ctx.config.packs : [];
    if (declared.some((entry) => packEntryId(entry) === CORE)) return [];
    return [finding(rule, {
      file: DECLARATION,
      what: `does not declare the mandatory "${CORE}" pack`,
      fix: `add "${CORE}" to "packs" — it is basics' own dependency, so the requires closure writes it back the next time the declaration is written`,
    })];
  },
};

export default rule;

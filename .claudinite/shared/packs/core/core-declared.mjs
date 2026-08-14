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
// ADVISORY UNTIL THE FLEET CARRIES IT (the `conformance-workflow` precedent, and
// the #555 failure both are drawn from): shipping this blocking would turn every
// member red on its very next update, before the record that declares it has
// reached them. It becomes blocking once the fleet is through — a one-line change.
const CORE = 'core';
const DECLARATION = '.claudinite-checks.json';

const rule = {
  id: 'core-declared',
  severity: 'advisory',
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

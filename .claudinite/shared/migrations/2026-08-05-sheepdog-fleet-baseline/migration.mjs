// The sheepdog pack's fleet-baseline WORKFLOW lives in the pack
// (packs/sheepdog/stubs/workflows/fleet-baseline.yml) and RUNS from the enforcer repo's
// own .github/ — GitHub reads workflows only from a repo's own .github/, never from the
// shared mount. So the enforcer hosts a MANAGED copy: the pack owns the content, the
// repo owns the file. (The logic the workflow runs is NOT vendored here; it stays in the
// mount at .claudinite/shared/packs/sheepdog/fleet-baseline/, which is why this record
// materializes exactly one file.)
//
// HOW IT LANDS, since a workflow file is the one thing the nightly cannot push itself:
// the mechanical apply writes it into the working tree as usual, preprocessing WITHHOLDS
// it from the commit (the Action's GITHUB_TOKEN may not write `.github/workflows/`, and
// the refusal would reject the whole ref), and baselining's AGENT stage lands it over MCP
// — a credential that does hold the `workflows` permission. That is
// `withheldWorkflowPaths` in the baselining worker plus §2b of its task.md; this record
// declares WHAT to vendor and stays out of how.
//
// STANDING, NOT TRANSITIONAL — the same shape (and the same reason) as
// `static-site-vendoring`. There is no old shape to move off: this workflow never
// existed anywhere else, so `legacyPresent` is false everywhere by construction — the
// record exists to keep the copy current, forever, applied from the fresh canon clone
// each member's baselining fetches (where every record loads regardless of age). If a
// general "keep a pack's vendored set current" mechanism is ever built, this record is
// one of the two it replaces.
//
// THE GATE is the repo's own declaration of the sheepdog pack — not the presence of the
// workflow it materializes. That is deliberate and different from the two other
// vendoring records, which gate on a file adoption already put there: declaring the
// enforcer pack IS the adoption here, so the first cycle after the declaration installs
// the workflow, with no separate bootstrap step. Claudinite itself does not declare
// sheepdog, so the canon never self-applies.
const DECLARATION = '.claudinite-checks.json';
const PACK = 'sheepdog';

export default {
  id: 'sheepdog-fleet-baseline',
  landed: '2026-08-05',
  summary: 'sheepdog fleet-baseline workflow kept byte-current in the enforcer repo own .github/',

  // The gate is ONE question — does this repo declare the sheepdog pack. A `packs` entry
  // is either the bare id or `{ id, ... }`, both legal in a declaration, so both are
  // matched. An unreadable or unparsable declaration means "not an enforcer as far as this
  // record can tell": skip, never guess a repo into hosting a fleet-wide lever.
  //
  // Whether the member can deliver a workflow file is not asked here — that belongs to the
  // machinery, not to each record that ships one: `applyMaterializations` skips a
  // `.github/workflows/` dest unless the running caller announced (WITHHOLD_CAPABLE_ENV)
  // that it can withhold the path from its push.
  appliesTo: async (read) => {
    const text = await read(DECLARATION);
    if (!text) return false;
    let cfg;
    try { cfg = JSON.parse(text); } catch { return false; }
    return (Array.isArray(cfg?.packs) ? cfg.packs : [])
      .some((e) => (typeof e === 'string' ? e : e?.id) === PACK);
  },

  materialize: [
    { template: 'packs/sheepdog/stubs/workflows/fleet-baseline.yml', dest: '.github/workflows/fleet-baseline.yml' },
  ],

  // Nothing to leave behind: this record exists to keep one copy current, not to move a
  // repo off an older shape.
  legacyPresent: async () => false,
};

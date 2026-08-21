// The declaration half of the github-actions collapse (#1079): the pack stopped
// existing and its skill and checks moved into git-github, which every repo already
// carries through basics' `requires` closure.
//
// NOTHING DEPENDS ON THIS HAVING RUN. `RENAMED_PACKS` resolves the absorbed id to
// git-github, so a member activates the right pack the moment the mount lands,
// declaration converged or not. What this buys is the day that map entry can be
// retired — and a declaration that stops naming a pack nobody can look up.
//
// Structural, and the ids come from the engine's rename map rather than from this
// record — see applyPackRenames in engine/migrations/registry.mjs. Every member
// declaring the absorbed pack carries git-github too, so the rewrite collides on all
// of them; the merge there is what keeps that member's own config and acceptances.
export default {
  id: 'github-actions-collapse',
  landed: '2026-08-19',
  version: 6,
  summary: 'github-actions collapsed into git-github; the declaration converges onto the surviving id (#1079)',

  renameDeclaredPacks: true,
};

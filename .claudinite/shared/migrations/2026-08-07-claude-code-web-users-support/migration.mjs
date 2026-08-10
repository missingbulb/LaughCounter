// One-time seed of the claude-code-web-users-support pack into the EXISTING fleet's
// declarations, naming this fleet's preferences store.
//
// The pack carries what a project can offer people working from Claude Code on the
// WEB, where the session knows who they are — today, reading the current user's
// personal interaction preferences into their session from a repo its config names. New repos get the pack from
// `--init` (it flags `seededByDefault`) and the store from its adoption question;
// this record catches the repos bootstrapped before the pack existed, so today's
// sessions do not silently lose the preferences they had.
//
// It carries the STORE as a literal, which is the one thing a canon record may do
// that shared code may not: a migration record is a dated one-off whose purpose is
// to move a specific fleet off a specific old shape, and it stops shipping once it
// ages out of the vendoring window. Nothing standing is left naming
// `missingbulb/Sheepdog` — the durable path is the pack's adoption question (new
// repos) and the sheepdog pack's fleet-preferences sweep, which reads the store
// from the enforcer repo's own config and so serves any fleet.
//
// SEED, NEVER OVERRIDE (the `declarePacks` op's contract): a repo that already
// declares the pack keeps its entry, and one that already names a store keeps that
// store. Both are decisions this record must not relitigate.
//
// The ORDER this depends on: baselining applies migration notes after it vendors the
// mount, and re-converges the mount when this pass changed the declaration — because
// a declared pack whose code is absent is a blocking `config` error. Both halves land
// in the one transactional commit.
//
// legacyPresent: a member carries a declaration that does not declare the pack at
// all. A repo with no declaration is not a member and is not this record's business;
// a member that declares the pack and deliberately configured it otherwise has
// converged as far as this record is concerned.
export default {
  id: 'claude-code-web-users-support',
  landed: '2026-08-07',
  summary: 'seed the claude-code-web-users-support pack into existing members, naming the fleet\'s preferences repo',
  declarePacks: [{ id: 'claude-code-web-users-support', config: { repo: 'missingbulb/Sheepdog' } }],
  legacyPresent: async (exists, read) => {
    const raw = await read('.claudinite-checks.json');
    if (raw == null) return false;
    try {
      const { packs } = JSON.parse(raw);
      if (!Array.isArray(packs)) return false;
      return !packs.some((e) => (typeof e === 'string' ? e : e?.id) === 'claude-code-web-users-support');
    } catch {
      return false; // unparsable settings are the world runner's finding, not this record's
    }
  },
};

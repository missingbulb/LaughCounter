// The static-website pack's release pipeline lives in the pack (packs/static-website/stubs/)
// and RUNS from each site repo's own .github/ — GitHub resolves a reusable workflow or a
// composite action only from the repo's own .github/, never from the shared mount. So every
// site repo hosts a MANAGED copy: the pack owns the content, the repo owns the file.
//
// This record is what makes "edit the pack, not the copy" true after adoption. The apply pass
// re-materializes the whole set on every cycle, so a hand-edited or stale copy self-heals and a
// canon fix reaches all three site repos the night it lands (#609).
//
// STANDING, NOT TRANSITIONAL — and that is why `retire: 'manual'`. Every other record here
// moves the fleet OFF an old shape and dies when the last repo has moved; this one has no old
// shape to leave behind (`legacyPresent` is false everywhere by construction), so the retire
// pass would otherwise stage its deletion after one quiet cycle and silently end the sync.
// If a general "keep a pack's vendored set current" mechanism is ever built, this record is
// what it replaces.
//
// The gate is the orchestrator's `name:`, so this only touches a repo that has actually adopted
// the standard (adoption vendors the set once; this keeps it current). Claudinite itself carries
// no such workflow, so the canon never self-applies.
const STUB = '.github/workflows/static-site-release.yml';
const S = 'packs/static-website/stubs';

export default {
  id: 'static-site-vendoring',
  landed: '2026-07-31',
  summary: 'static-website release pipeline kept byte-current in each site repo own .github/ (#609)',

  appliesTo: async (read) => {
    const text = await read(STUB);
    if (!text) return false;
    return /^name:\s*['"]?Release static site['"]?\s*$/m.test(text);
  },

  materialize: [
    { template: `${S}/workflows/static-site-release.yml`, dest: STUB },
    { template: `${S}/workflows/static-site-publish.yml`, dest: '.github/workflows/static-site-publish.yml' },
    { template: `${S}/workflows/static-site-deploy-pages.yml`, dest: '.github/workflows/static-site-deploy-pages.yml' },
    { template: `${S}/workflows/static-site-ci.yml`, dest: '.github/workflows/static-site-ci.yml' },
    { template: `${S}/actions/read-site-config/action.yml`, dest: '.github/actions/read-site-config/action.yml' },
    { template: `${S}/actions/read-site-config/read-config.mjs`, dest: '.github/actions/read-site-config/read-config.mjs' },
    { template: `${S}/actions/bump-site-version/action.yml`, dest: '.github/actions/bump-site-version/action.yml' },
    { template: `${S}/actions/bump-site-version/bump.mjs`, dest: '.github/actions/bump-site-version/bump.mjs' },
    { template: `${S}/actions/assemble-site/action.yml`, dest: '.github/actions/assemble-site/action.yml' },
  ],

  // Nothing to leave behind: this record exists to keep copies current, not to move a repo off
  // an older shape.
  legacyPresent: async () => false,
  retire: 'manual',
};

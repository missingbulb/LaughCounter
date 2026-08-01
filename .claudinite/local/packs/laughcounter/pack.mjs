import noLooseBuildArtifacts from './no-loose-build-artifacts.mjs';

// LaughCounter's general local pack: the working lessons about this repo that
// aren't about the on-device-privacy boundary (that one has its own pack).
//
// A local pack: declared by hand as `local/laughcounter`, never fingerprinted
// (detect/marker null).
export default {
  id: 'laughcounter',
  ruleRoutingGuidance: {
    belongs:
      "LaughCounter's general working lessons about this repo, its build, its macOS packaging, and how its own local-pack checks are authored",
    excludes: 'the on-device privacy boundary — that is on-device-privacy',
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [noLooseBuildArtifacts],
};

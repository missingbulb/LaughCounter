import engineConstructionConfined from './engine-construction-confined.mjs';
import signalTeardownRouting from './signal-teardown-routing.mjs';
import noSuddenTermination from './no-sudden-termination.mjs';

// The macOS microphone lifecycle, as a pack: AVAudioEngine, CoreAudio device
// state, and the sleep/wake and exit paths around them. LaughCounter holds a
// real mic open for hours and has repeatedly left one *wedged* — dead
// system-wide until re-plugged — so this is a technology domain with its own
// hard-won rules, none of which the canon shelf homes.
//
// The case history stays in `dev/procedures/mac-audio-lifecycle.md` (routed from
// the project CLAUDE.md); this pack carries the invariants and enforces the
// three that a scan can decide.
//
// A local pack: declared by hand as `local/macos-audio-lifecycle`, never
// fingerprinted (detect/marker null).
export default {
  id: 'macos-audio-lifecycle',
  ruleRoutingGuidance: {
    belongs:
      'holding a macOS microphone safely — AVAudioEngine and CoreAudio device lifecycle, sleep/wake and exit teardown, audio-arrival diagnostics',
    excludes:
      "the privacy boundary (on-device-privacy) and the repo's build, packaging and check-authoring lessons (laughcounter)",
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [engineConstructionConfined, signalTeardownRouting, noSuddenTermination],
};

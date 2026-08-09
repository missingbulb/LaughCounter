import countingCoreClockFree from './counting-core-clock-free.mjs';
import classifierKeywordsLowercase from './classifier-keywords-lowercase.mjs';
import hysteresisContract from './hysteresis-contract.mjs';

// The decision layer between a sound classifier and a number: how a stream of
// per-window confidences from Apple's built-in classifier becomes discrete,
// counted, attributed laughs. A domain of its own — the model is a black box
// nobody can retrain, so everything that makes the count right or wrong lives in
// the thresholds, the hysteresis, the class-identifier matching, the episode
// timing, and the you-vs-TV attribution (#5, #7).
//
// Deliberately not the neighbours' territory: `local/macos-audio` owns getting
// audio out of the device safely, `local/on-device-privacy` owns the boundary
// that audio never crosses, `local/laughcounter` owns the repo's build,
// packaging and check-authoring lessons.
//
// A local pack: declared by hand as `local/laugh-detection`, never fingerprinted
// (detect/marker null).
export default {
  id: 'laugh-detection',
  ruleRoutingGuidance: {
    belongs:
      "turning the classifier's stream into counted laughs — thresholds, hysteresis, class-identifier matching, episode timing, TV attribution, the laugh log",
    excludes:
      "getting audio out of the microphone (macos-audio), the privacy boundary (on-device-privacy), the repo's build and packaging (laughcounter)",
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [countingCoreClockFree, classifierKeywordsLowercase, hysteresisContract],
};

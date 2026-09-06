import inputNodeConfined from './input-node-confined.mjs';
import onDeviceSpeech from './on-device-speech.mjs';
import singleStorageDirectory from './single-storage-directory.mjs';

// LaughCounter's local pack — one per repo, named for the repo. Everything this
// project has learned about itself that no canon pack owns: the on-device
// privacy boundary that is the product's defining constraint, the microphone
// invariants that name this app's own types, and the repo's build, packaging,
// check-authoring and Claudinite-maintenance lessons.
//
// The portable half of the microphone knowledge lives in canon `macos`, which
// this repo declares; what stays here is what is about *this* app — which type
// owns the engine, where its files live, and its no-egress product promise.
//
// A local pack: declared by hand as `local/laugh-counter`, never fingerprinted
// (detect/marker null).
export default {
  id: 'laugh-counter',
  ruleRoutingGuidance: {
    belongs:
      "this app's own lessons — its privacy boundary, the types that own its microphone, its build, packaging and maintenance findings",
    excludes:
      'portable macOS knowledge — bundle, signing, notarization, device and sleep/exit lifecycle (canon `macos`)',
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [inputNodeConfined, onDeviceSpeech, singleStorageDirectory],
};

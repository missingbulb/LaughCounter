import onDeviceSpeech from './on-device-speech.mjs';
import singleStorageDirectory from './single-storage-directory.mjs';

// LaughCounter's defining constraint, as a pack: an always-on microphone in the
// living room, and the promise that what it hears never leaves the machine. The
// product requirements (docs/DESIGN-AND-TRADEOFFS.md §0/§6) and the README's
// Privacy section state it; nothing enforced it until this pack. It covers the
// native app (mac/Sources/), which is the whole product.
//
// A local pack: declared by hand as `local/on-device-privacy`, never
// fingerprinted (detect/marker null).
export default {
  id: 'on-device-privacy',
  ruleRoutingGuidance: {
    belongs: 'the promise that what the microphone hears never leaves the machine — the privacy boundary',
    excludes: "LaughCounter's other working lessons — those are laughcounter",
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [onDeviceSpeech, singleStorageDirectory],
};

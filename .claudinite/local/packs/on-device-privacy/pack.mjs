import noNetworkClient from './no-network-client.mjs';
import onDeviceSpeech from './on-device-speech.mjs';
import noAudioPersistence from './no-audio-persistence.mjs';
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
  detect: null,
  marker: null,
  prose: 'RULES.md',
  rules: [noNetworkClient, onDeviceSpeech, noAudioPersistence, singleStorageDirectory],
};

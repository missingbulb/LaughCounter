import noNetworkClient from './no-network-client.mjs';
import loopbackDefault from './loopback-default.mjs';
import onDeviceSpeech from './on-device-speech.mjs';
import singleHomeDirectory from './single-home-directory.mjs';
import jsonContentTypeGuard from './json-content-type-guard.mjs';

// LaughCounter's defining constraint, as a pack: an always-on microphone in the
// living room, and the promise that what it hears never leaves the machine. The
// product requirements (docs/DESIGN-AND-TRADEOFFS.md §0/§6) and the README's
// Privacy section state it; nothing enforced it until this pack. It spans both
// implementations — the Python reference (laughcounter/) and the native app
// (mac/Sources/) — because the boundary is the same on both sides.
//
// A local pack: declared by hand as `local/on-device-privacy`, never
// fingerprinted (detect/marker null).
export default {
  id: 'on-device-privacy',
  detect: null,
  marker: null,
  prose: 'RULES.md',
  rules: [noNetworkClient, loopbackDefault, onDeviceSpeech, singleHomeDirectory, jsonContentTypeGuard],
};

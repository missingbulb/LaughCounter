
// Technology pack: a native macOS app — the app bundle, TCC and Hardened
// Runtime, the Developer ID / notarization / DMG distribution lane, and the
// process-lifecycle rules a Mac agent app has to get right.
//
// Fingerprint: a `Package.swift` at the repo root or one directory down (a
// monorepo's `mac/` dir), never deeper, so a nested fixture package can't trip
// detection. The marker only SUSPECTS the pack — a Swift package can be a
// library or an iOS-only target, and declaration stays the project's call. An
// iOS app declares `ios`; a Flutter app's macOS runner declares `flutter`.
const hasMarkerNearRoot = (ctx, marker) =>
  ctx.tracked.some((f) => {
    const parts = f.split('/');
    return parts[parts.length - 1] === marker && parts.length <= 2;
  });

export default {
  version: '60906.1',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'native macOS apps: app-bundle assembly, TCC usage strings, Hardened Runtime entitlements, Developer ID signing, notarization and DMG distribution',
    excludes: 'Mac App Store submission — app-store-release; iPhone app targets — ios; workflow YAML mechanics — git-github',
  },
  marker: 'Package.swift (at the repo root or one directory down)',
  detect: (ctx) => hasMarkerNearRoot(ctx, 'Package.swift'),
  // Four checks, each on a rule whose static signature is false-positive-free
  // *because the rule is itself conditional*: each fires only where the tree
  // already shows the posture the rule is about — terminate-time teardown, an
  // AppKit app that installs a capture tap, a plist and a package manifest that
  // both state an OS floor, or a shell/workflow script probing for a Swift
  // toolchain. sudden-termination-vs-teardown lives in declared-checks.json
  // beside this file; the other three stay coded — an ordered-occurrence arm, a
  // cross-file comparison, and a same-or-earlier line-order scan respectively.
  // Everything else stays prose — runtime device behaviour, a CI
  // lane's shape, or a plist/entitlement judgment call, none of which a scan can
  // separate from a healthy repo.
};

---
name: macos-entitlements-and-tcc
description: Which gate a protected macOS resource sits behind — the TCC usage string in Info.plist, the Hardened Runtime entitlement, or both — and why the App Sandbox stays off the Developer ID track. Use when editing an .entitlements file or Info.plist, or adding a capability.
metadata:
  force-load-on-file-edits-paths:
    - "**/*.entitlements"
    - "**/Info.plist"
---

# TCC and the Hardened Runtime are two different gates — know which applies

- **Reaching for a protected resource** — give it its own **usage-description string** in
  `Info.plist`, the text the user consents to; without one the app is killed rather than prompted.
  Capabilities that feel like one feature take separate keys — an app that listens *and*
  transcribes needs `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`, or
  is killed at whichever it forgot — and only *some* resources also need a codesign entitlement,
  and only under the Hardened Runtime.

- **Capabilities gated purely by TCC plus their usage string need no entitlement at all** (speech
  recognition is the worked example). Adding one you don't need is noise; omitting one you do need
  is a runtime failure no build step catches.

- **Do not enable the App Sandbox on the Developer ID track.** The sandbox belongs to the Mac App
  Store lane, needs a different (Apple Distribution) certificate, and silently removes
  capabilities the direct-download build has — distributed notifications, for one.

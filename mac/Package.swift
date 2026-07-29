// swift-tools-version:5.9
import PackageDescription

// LaughCounter — a tiny native macOS menu-bar app.
//
// It depends on NOTHING outside the OS: AppKit (menu bar + sound), AVFoundation
// (microphone), SoundAnalysis (Apple's built-in laughter classifier) and Speech
// (on-device "I just laughed" voice command) all ship with macOS. That is the
// whole point — nothing to install, nothing left behind when you delete the app.
//
// `ObjCExceptionTrap` is our own source, not a dependency: a few lines of
// Objective-C are the only way to catch an `NSException`, which Swift cannot do
// and which AVFoundation raises from `installTapOnBus` (#61).

let package = Package(
    name: "LaughCounter",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "ObjCExceptionTrap",
            path: "Sources/ObjCExceptionTrap"
        ),
        .executableTarget(
            name: "LaughCounter",
            dependencies: ["ObjCExceptionTrap"],
            path: "Sources/LaughCounter"
        )
    ]
)

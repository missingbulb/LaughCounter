// swift-tools-version:5.9
import PackageDescription

// LaughCounter — a tiny native macOS menu-bar app.
//
// It depends on NOTHING outside the OS: AppKit (menu bar + sound), AVFoundation
// (microphone), SoundAnalysis (Apple's built-in laughter classifier) and Speech
// (on-device "I just laughed" voice command) all ship with macOS. That is the
// whole point — nothing to install, nothing left behind when you delete the app.

let package = Package(
    name: "LaughCounter",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "LaughCounter",
            path: "Sources/LaughCounter"
        )
    ]
)

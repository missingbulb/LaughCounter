import AppKit

// Menu-bar-only agent (no Dock icon). The status item is the "it's running"
// indicator the whole time the app is alive.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

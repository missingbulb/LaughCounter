import AppKit

// Menu-bar-only agent (no Dock icon). The status item is the "it's running"
// indicator the whole time the app is alive.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)

// Route catchable termination signals through the normal quit path.
// NSApplication installs no signal handlers, so a bare SIGTERM (Activity
// Monitor's Quit, `killall LaughCounter`), SIGINT (Ctrl-C when run from a
// terminal during development), or SIGHUP (that terminal closing) would kill
// the process without `applicationWillTerminate` — leaving the input tap's
// CoreAudio IOProc registered on the mic, which is exactly what wedges some
// USB webcam mics until they're re-plugged. `signal(sig, SIG_IGN)` must come
// BEFORE `resume()` so a signal landing in the gap can't still take the
// default (fatal) action. Top-level lets are globals, so the sources live as
// long as the process. (SIGKILL / Force Quit / crashes remain uncatchable.)
let signalSources: [DispatchSourceSignal] = [SIGTERM, SIGINT, SIGHUP].map { sig in
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { NSApp.terminate(nil) }  // → applicationWillTerminate
    source.resume()
    return source
}

app.run()

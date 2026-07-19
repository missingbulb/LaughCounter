# macOS audio lifecycle — releasing the mic on every path

Hard-won rules for `mac/Sources/LaughCounter/` (AudioHub, AppDelegate's restart
machinery, VoiceCommand). Read before touching engine start/stop, sleep/wake, or
exit handling.

**The invariant.** If this process ends — or intentionally stops capture — while
the `AVAudioEngine` input tap's CoreAudio IOProc is still registered on the
device, some USB webcam mics wedge: dead/silent, no input registered in System
Settings, until physically re-plugged. So the tap + engine must be torn down on
*every* path where capture ends, and the engine must never rapid-cycle or
overlap restarts. (#22)

## Exit paths: `applicationWillTerminate` is not "every exit path" by itself

`NSApp.terminate` (menu Quit, ⌘Q, the logout/shutdown quit Apple Event) runs
`applicationWillTerminate` — but **NSApplication installs no signal handlers**:
a bare SIGTERM (Activity Monitor "Quit", `killall`), SIGINT (Ctrl-C in a dev
terminal), or SIGHUP kills the process with no teardown. `main.swift` routes
those through `DispatchSourceSignal` → `NSApp.terminate`; the `signal(sig,
SIG_IGN)` must precede `resume()` or a signal in the gap still takes the fatal
default. SIGKILL/Force-Quit/crash remain uncoverable — residual risk, not a bug.
Don't add `NSSupportsSuddenTermination` to Info.plist: it would let logout
SIGKILL the app past all of this.

## Deferred work must be generation-guarded

`asyncAfter` timers scheduled before sleep **fire immediately on wake** — so any
delayed engine start (the +0.4s `finishListening`, the +1.0s wake resume) that a
stop raced with would otherwise re-acquire the mic going *into* sleep or
un-settled at wake. Every intentional stop bumps `restartGeneration`; every
delayed closure captures the generation at schedule time and aborts if it moved.
When cancelling in-flight restarts, also reset `restartInFlight` /
`restartQueued` / `suppressConfigChange`, or the latches stay stuck and block
all future starts.

## Config-change suppression must reconcile, not just drop

CoreAudio posts `.AVAudioEngineConfigurationChange` for our *own* stop/start
(react → infinite restart loop, hence the suppress window) **and** for genuine
device events — including while the machine heads into sleep (hence the
`sleeping` gate from `willSleep` until the post-wake settle). A genuine event
swallowed by the window is reconciled at settle time by *state*, not by the
notification: engine dead while `listening` → restart; start failed and an
event arrived → one retry per swallowed event (a dead mic emits no events, so
this can't poll).

## Misc gotchas that bit

- `engine.stop()` unconditionally in `AudioHub.stop()`: it's safe when not
  running and it releases what `prepare()` allocated — a prepare-then-throw
  path would otherwise keep the input unit holding the device.
- `installTap` with a format the hardware no longer matches raises an
  **uncatchable NSException** — re-validate the live format immediately before
  the tap (narrows, doesn't eliminate; there is no atomic API).
- `SFSpeechRecognizer` fed via `SFSpeechAudioBufferRecognitionRequest` never
  holds the device — it can't cause the wedge. But its state is touched from
  main, the Speech callback queue, *and* the audio tap thread: everything in
  `VoiceCommand` goes through one lock, and the two-phase `start()` gates the
  task store on *request identity* (`request === newRequest`), because a
  restart() between the phases leaves `running == true` — gating on `running`
  would store a dead task and permanently block the idempotency guard.

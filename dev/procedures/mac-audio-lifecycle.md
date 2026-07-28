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

## There is no "returned from standby" notification — fan in, then coalesce

macOS distinguishes sleep depths internally but exposes no standby-specific event:
`NSWorkspace.didWakeNotification` is all you get, and it is **not equivalent to "the
machine is back"** — a dark/Power-Nap wake fires it with nobody there and the Mac
re-sleeps moments later. So `systemDidReturn(reason:)` fans in four signals —
`didWake`, `screensDidWake`, `sessionDidBecomeActive`, and the distributed
`com.apple.screenIsUnlocked` — and coalesces them, because a real return fires
several of them in a burst and each must not schedule its own restart:

- **Coalesce with an id, not a bool.** `pendingResumeID` holds the one in-flight
  resume; a stale timer compares its captured id and returns without touching
  state. A bare `resumePending` bool deadlocks: a re-sleep during the delay
  invalidates the timer, the timer clears the bool, and whichever of the two
  orderings loses leaves the next wake either unable to schedule (flag stuck true)
  or double-scheduling.
- **Gate on owing a resume**, i.e. `sleeping || (listeningIntent && !listening)`.
  Displays wake and sessions activate with no sleep involved (screensaver, user
  switching); reacting to those would cycle a healthy engine — the wedge condition.
- **Always ungate `sleeping` in the resume timer**, even on the "stay off" path, or
  `requestListening` stays blocked forever and the menu's Start item does nothing.
- The distributed unlock notification is free here because the app is
  non–App Store (no App Sandbox). Under the sandbox it silently never arrives; the
  three workspace triggers still cover the case.

## Resume by *intent*, and retry — a failed post-standby start has no second event

`listening` ("the engine is running") is not the state a wake should branch on.
`listeningIntent` ("the counter is meant to be running") is: sleep suspends capture
without clearing it, so a return reactivates only a counter that was actually
active, while a start that merely *failed* keeps it and stays eligible for recovery.
Branching on `listening` instead would make any pre-sleep failure permanent.

The intent is stored as `offReason: String?` — nil means "meant to be running" and
`listeningIntent` is derived from it — rather than a bool beside a separate reason
string. The menu status, the tooltip and the wake log all render that one field, so
they cannot disagree about whether the counter is off or why ("paused",
"no microphone access", "starting up"). Menu **Pause listening** sets it; every
request to listen clears it, which is what asking to listen means.

After a long standby the USB bus was powered down and the mic can still be
re-enumerating when the settle window closes. That start throws, and — unlike the
config-change cases — **nothing else will ever fire** to recover from it, so the app
sits silently "not listening" until someone opens the menu. Hence
`scheduleStartRetry`: doubling 2s → 32s, capped at `maxStartRetries`, reset on every
success / system return / manual resume. Bounded on purpose (a mic that is gone for
good emits nothing and must not be polled forever) and slow on purpose (rapid-cycling
is what wedges the mic). The wake settle is also stretched 1.0s → 2.5s when the sleep
lasted longer than `standbyThreshold`; measure that span with `Date()`, **not**
`ProcessInfo.systemUptime`, which does not advance while the machine is asleep.

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

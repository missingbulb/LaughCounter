# The microphone's lifecycle — an app that must never damage the device it uses

LaughCounter holds a real microphone open for hours at a time, and the hardware
answers back: a USB webcam mic can be left **wedged** — dead system-wide, no
input meter anywhere, until it is physically re-plugged. Every rule here exists
because that happened, repeatedly, on the owner's Mac.

The checks in this pack hold the three mechanical parts (only `AudioHub` builds
an engine; termination signals reach `applicationWillTerminate`; the app never
opts into sudden termination). What follows is the judgment half — the rules a
scan cannot decide. The **case history** — which release, which measurement,
which theory survived — lives in
[`dev/procedures/mac-audio-lifecycle.md`](../../../../dev/procedures/mac-audio-lifecycle.md)
and stays there; don't copy it here, read it before touching engine start/stop,
sleep/wake, exit handling, or `VoiceCommand`.

**Never open the device to ask a question about it.** `AudioHub.makeEngine()`
touches `engine.inputNode`, and that property access opens the default input and
mints a hidden per-client aggregate device inside coreaudiod
(`CADefaultDeviceAggregate-<pid>-<n>`) — so a "cheap format read" in a retry
ladder is really a device open plus an aggregate create/destroy, measured at ~210
of them over 3h40m against hardware that was not there. Availability questions go
to `AudioDiagnostics`, which answers from `AudioObjectGetPropertyData` property
queries that open nothing. Cycling the device is the one mechanism by which this
app could plausibly damage it, so the cost of an answer is a property of the API
you ask, not of how often you ask.

**Presence is not usability, at any layer.** `outputFormat(forBus: 0)` reports a
plausible 48 kHz with the input torn down while `inputFormat` reports 0, so a
guard written against the wrong one waves through starts that cannot succeed
(`AudioHub.validatedFormat()` requires both, and requires them to agree). One
layer down, a device can be enumerated and `alive=y` with a zero sample rate and
an unreadable name mid-teardown — so `AudioDiagnostics.hasUsableInput` demands a
nonzero rate and a sane channel count, not mere presence. Any new probe inherits
this: whatever it reads, ask what that field says while the mic is absent.

**A duration is a claim about a span you observed.** "It has been present for N
seconds" is only as good as the watching behind it, and the sampling timer does
not fire while the Mac sleeps — which is why the settle gate was inert on exactly
the wake path it was built for (#107). Hence `inputAvailability` distinguishes
`.absent` from `.unobserved`, `noteObservationInterrupted()` is called from
`willSleep` so a sleep is declared rather than inferred, and the run is keyed on
the device's UID so a swap counts as a new arrival. Any future "X has been true
for N seconds" state gets the same three questions: was I watching, is it the
same device, and what does a gap in observation do to the claim?

**Pick the clock by whether the span may contain a sleep.** `systemUptime` for
"how long has the stream been silent *while we were awake*" (buffer accounting,
stall windows); `Date()` for anything that can span a sleep — the sleep-duration
stamp in `AppDelegate` and the elapsed-time interruption backstop in
`AudioDiagnostics`. Both directions are wrong the other way round, and each site
in the sources says which it is and why.

**Deferred work must be generation-guarded.** `asyncAfter` timers scheduled
before a sleep fire *immediately* on wake, so a delayed start that a stop raced
with would re-acquire the mic going into sleep or un-settled at wake. Every
intentional stop bumps `restartGeneration`; every delayed closure captures it and
aborts if it moved. When cancelling in-flight restarts, reset
`restartInFlight` / `restartQueued` / `suppressConfigChange` too, or the latches
stay stuck and block all future starts. Coalesce the wake fan-in with an **id**,
not a bool — a bool deadlocks when a re-sleep lands during the delay.

**Never claim to be listening on the strength of `engine.start()` returning.**
That is what let the menu bar say 😄 *listening* through an entire evening of a
dead device, and it is why both wedge investigations had to be reconstructed from
logs instead of noticed. State shown to the user is derived from
`AudioDiagnostics.health` (`ok` / `stalled` / `noSignal`) — measured buffers —
and when a state has exactly one known remedy the UI names *that* remedy
(no-signal says unplug the mic; "Restart listening" is measured not to work).

**Compile-green is not a gate for this code.** CI runs `swift build` and nothing
else, and every raise-vs-throw bug in this area is invisible to the compiler and
reachable in the first second of a run — two crash-on-launch builds shipped past
it. A change to `AudioHub`, the restart machinery, or the sleep/wake path is not
verified until it has actually started on a Mac. Reproduce the interesting case
without waiting for hardware to misbehave: let the display sleep, and coreaudiod
tears its contexts down seconds later.

**Assume no toolchain on the machine that runs it.** The owner's Mac installs the
DMG from CI and has no Xcode command line tools, so anything needed to diagnose a
live failure is either shell built into macOS or compiled into the app by CI —
that is why the HAL reads live in `AudioDiagnostics` rather than in a helper
script. `command -v swift` does **not** test for a toolchain (`/usr/bin/swift` is
a stub that prompts for an 8 GB install); gate on `xcode-select -p` instead.

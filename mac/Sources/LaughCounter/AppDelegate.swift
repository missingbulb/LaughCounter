import AppKit
import AVFoundation
import Speech

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let store = LaughStore()
    private let counter = LaughCounter()
    private let audio = AudioHub()
    private let detector = LaughDetector()
    private let voice = VoiceCommand()
    // Runs for the whole process lifetime, not just while capturing: it samples
    // buffer liveness and the CoreAudio device list continuously so a mic
    // failure records itself as it happens. Every previous round of "the mic is
    // dead after sleep" had to be reconstructed from a log that only ever said
    // "listening started".
    private let diagnostics = AudioDiagnostics()
    private var micGranted = false
    private var listening = false
    // (Re)starting the engine itself posts .AVAudioEngineConfigurationChange, so
    // we suppress that notification around our own (re)starts to avoid a restart
    // loop that would keep the engine from ever running long enough to detect.
    private var suppressConfigChange = false
    // Single-flight + rate-limit for (re)starts: repeatedly stop/starting a USB
    // mic in quick succession can wedge it, so restarts can never overlap or
    // rapid-cycle — an extra request while one is in flight is coalesced to one.
    private var restartInFlight = false
    private var restartQueued = false
    // Every intentional stop (sleep, terminate) and every accepted restart bumps
    // this; the delayed finishListening/settle closures capture it when scheduled
    // and abort if it moved. Without it, a stop can't cancel the +0.4s restart it
    // raced with — sleep during that gap would start the engine going *into*
    // sleep (carrying a live IOProc into sleep, the wedge condition), or fire it
    // at wake before the hardware settles. asyncAfter timers scheduled before
    // sleep fire immediately ON wake, which makes this race very reachable.
    private var restartGeneration = 0
    // A config-change notification arrived while suppressConfigChange was up.
    // The suppression must swallow our own stop/start echoes (reacting to them
    // would loop), but it can also swallow a *genuine* device event — noted here
    // so the settle closure can reconcile by state instead of losing the event.
    private var configChangeSwallowed = false
    // True from willSleep until the post-wake settle delay ends. Gates both
    // requestListening and the config-change handler: CoreAudio tears down /
    // switches devices while the machine heads into sleep, and reacting to those
    // notifications would restart capture into sleep right after the intentional
    // willSleep teardown.
    private var sleeping = false
    // Speech may only auto-(re)start once authorization was actually granted.
    private var speechAuthorized = false

    // Why the counter is *not* meant to be running — nil means it is. Held as one
    // field rather than a bool plus a separate reason so the menu, the tooltip and
    // the wake path always agree on both whether the counter is off and why.
    private var offReason: String? = "starting up"
    /// "The counter is meant to be running", as opposed to `listening` ("the engine
    /// actually is"). Sleep/standby suspends capture without touching this, so the
    /// return path knows the counter was active and switches it back on; a start
    /// that merely *failed* keeps the intent too, so the retry ladder below still
    /// applies. It is false only when we are not meant to be listening (paused,
    /// microphone denied, before the first start) — and then a return from standby
    /// deliberately resumes nothing.
    private var listeningIntent: Bool { offReason == nil }
    // Consecutive failed starts. Drives the post-standby retry ladder: a mic
    // that was powered down for a long standby can take several seconds longer
    // to re-enumerate than the wake settle delay allows, and a failed start
    // emits no further event to recover on. Reset on every successful start,
    // on a system return, and on a manual resume.
    private var startFailureStreak = 0
    // Identifies the one in-flight resume. Returning from standby fires a *burst*
    // of signals (wake, displays, session, unlock) that must schedule a single
    // resume between them; a stale timer compares its id and does nothing.
    private var resumeID = 0
    private var pendingResumeID: Int?
    // Wall-clock (not systemUptime, which does not advance while asleep) stamp of
    // the last willSleep, so the return path can tell a brief sleep from a long
    // standby and give the hardware proportionally longer to come back.
    private var sleepStartedAt: Date?

    /// Settle delay after an ordinary short sleep.
    private let wakeSettleDelay = 1.0
    /// Settle delay after a long sleep/standby, where the machine has powered the
    /// USB bus down and devices re-enumerate well after the wake notification.
    private let standbySettleDelay = 2.5
    /// A sleep at least this long is treated as standby for settling purposes.
    private let standbyThreshold = 300.0
    /// How many fast doubling attempts before dropping to `maxBackoffDelay`.
    private let maxStartRetries = 5
    /// Ceiling for the retry backoff, and the steady interval after it.
    private let maxBackoffDelay = 60.0

    // Opt-in "keep the Mac awake so it keeps hearing laughs during a long movie".
    // Off by default; the choice persists across launches. While enabled *and*
    // listening we hold a power assertion that blocks idle *system* sleep (the
    // display can still sleep — we only need audio to keep running). It does not
    // block lid-close or a manual Sleep, and it costs battery, so it's opt-in.
    private let keepAwakeDefaultsKey = "keepMacAwakeWhileListening"
    private var keepAwake = false
    private var sleepAssertion: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        keepAwake = UserDefaults.standard.bool(forKey: keepAwakeDefaultsKey)  // false if unset
        refreshTitle()
        buildMenu()
        wireUp()
        observeSystemEvents()
        AppLog.shared.log("app launched")
        // Before requesting the mic, so the log records what CoreAudio saw at
        // launch even if permission is denied or the first start fails.
        diagnostics.start()
        requestPermissionsAndStart()
    }

    // MARK: wiring

    private func wireUp() {
        // A counted laugh → log it with the you-vs-TV hypothesis, and blip only for
        // *your* laughs (blipping at every TV laugh would be maddening).
        counter.onLaugh = { [weak self] event in
            guard let self = self else { return }
            self.store.append(event)
            AppLog.shared.log(String(format: "laugh logged origin=%@ peak=%.2f dur=%.2f — %@",
                                     event.origin, event.peak, event.duration, event.originReason))
            if event.origin == "me" { Chime.play(times: 1) }
            DispatchQueue.main.async { self.refreshTitle() }
        }
        // Sub-threshold episode → log it as a candidate (silent, uncounted) so later
        // "I laughed" feedback has a nearby event to align to.
        counter.onCandidate = { [weak self] event in
            self?.store.append(event, label: "candidate")
            AppLog.shared.log(String(format: "candidate logged origin=%@ peak=%.2f dur=%.2f — %@",
                                     event.origin, event.peak, event.duration, event.originReason))
        }
        // Each analysis window → feed the counter (real audio timing inside).
        detector.onObservation = { [weak self] obs in
            self?.counter.update(obs)
        }
        // "I just laughed": spoken command vs the menu/keyboard get different sources.
        voice.onTrigger = { [weak self] in self?.markMissed(source: "voice") }
        // One mic tap, fanned out to both consumers. Diagnostics first, so a
        // buffer is recorded as having arrived even if a consumer below throws
        // or hangs — "did audio reach us" must not depend on what we do with it.
        audio.onBuffer = { [weak self] buffer, when in
            self?.diagnostics.noteBuffer(buffer)
            self?.detector.analyze(buffer, at: when)
            self?.voice.append(buffer)
        }
        // No buffers is the correct state when paused or stopped, so the stall
        // detector needs to know what we believe we are doing.
        diagnostics.isListening = { [weak self] in self?.listening ?? false }
        // The menu must stop claiming to listen the moment the capture path
        // stops delivering audio — that false "listening" is what hid this
        // failure for entire evenings, and then hid it again in its no-signal
        // shape while the diagnostics were logging the truth at ERROR. (#88)
        diagnostics.onHealthChanged = { [weak self] _ in
            guard let self = self else { return }
            self.refreshTitle()
            self.buildMenu()
        }
    }

    private func markMissed(source: String) {
        store.appendMissed(source: source)
        AppLog.shared.log("missed laugh logged via \(source)")
        Chime.play(times: 2)
        DispatchQueue.main.async { self.refreshTitle() }
    }

    // MARK: permissions + start

    private func requestPermissionsAndStart() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.micGranted = granted
                if granted {
                    self.requestListening()
                    self.requestSpeech()
                } else {
                    self.offReason = "no microphone access"
                    AppLog.shared.log("microphone access denied", level: "ERROR")
                    self.showMicDenied()
                }
            }
        }
    }

    /// Single-flight, rate-limited entry to (re)start listening. Every trigger
    /// (launch, wake, config-change, manual resume) goes through here so the audio
    /// engine can never overlap-restart or rapid-cycle — which can wedge a USB mic.
    /// Tears down, lets the input device settle briefly, then re-acquires.
    private func requestListening() {
        guard micGranted else { return }
        // Record the intent before the sleep gate, so a manual "Start listening"
        // clicked during a sleep transition is still honored by the resume — and
        // so it clears a pause, which is what asking to listen means.
        offReason = nil
        if sleeping {                  // heading into (or settling out of) sleep:
            // the post-wake resume is the one path out; log so a swallowed manual
            // click is visible in the activity log rather than silently ignored
            AppLog.shared.log("listening request ignored (sleep transition in progress)")
            return
        }
        if restartInFlight {           // coalesce; don't stack restarts
            restartQueued = true
            return
        }
        restartInFlight = true
        suppressConfigChange = true    // ignore the config-changes our stop/start emits
        configChangeSwallowed = false  // fresh window; note only events from this cycle
        restartGeneration &+= 1
        let generation = restartGeneration
        counter.flush()
        counter.reset()
        detector.reset()
        audio.stop()
        listening = false
        refreshTitle()
        // Let the (USB) input device release before re-acquiring — reacquiring
        // immediately after teardown is what can wedge some USB mics.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.finishListening(generation: generation)
        }
    }

    private func finishListening(generation: Int) {
        // A stop (sleep/terminate) superseded this restart while it waited — the
        // mic must stay released, not be re-acquired behind the stop's back.
        guard generation == restartGeneration else { return }
        do {
            // Configure the analyzer BEFORE audio flows, so no early buffers are
            // dropped and analysis reliably starts (matches the original order).
            let format = try audio.prepareFormat()
            try detector.configure(format: format)
            try audio.start(format: format)
            listening = true
            startFailureStreak = 0
            // Starts the stall clock from here, so the gap before the *first*
            // buffer counts: a start that returns cleanly and then delivers
            // nothing is the exact failure this is here to catch.
            diagnostics.noteCaptureStarted(format: format)
            AppLog.shared.log("listening started "
                + "(sampleRate=\(Int(format.sampleRate)), channels=\(format.channelCount))")
        } catch {
            audio.stop()
            listening = false
            startFailureStreak += 1
            diagnostics.noteCaptureStopped(reason: "start failed")
            AppLog.shared.log("could not start listening: \(error.localizedDescription)"
                + " — \(diagnostics.snapshotLine())", level: "ERROR")
        }
        refreshTitle()
        buildMenu()
        // Settle window: no further restart (or config-change reaction) until the
        // engine has run undisturbed for a moment. Then honor any coalesced request.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self = self, generation == self.restartGeneration else { return }
            self.suppressConfigChange = false
            self.restartInFlight = false
            let swallowed = self.configChangeSwallowed
            self.configChangeSwallowed = false
            if self.restartQueued {
                self.restartQueued = false
                self.requestListening()
            } else if self.listening && !self.audio.isRunning {
                // A genuine config change landed inside the suppress window and
                // halted the engine (AVAudioEngine stops rendering when the
                // device changes under it). The suppression rightly ignored the
                // notification — self-emitted ones would loop — so reconcile by
                // state instead: "listening" but engine dead means we owe a
                // restart, otherwise the UI claims listening while nothing flows.
                AppLog.shared.log("engine halted during settle — restarting", level: "WARN")
                self.requestListening()
            } else if !self.listening && swallowed {
                // Complementary case: this cycle's start FAILED (no device yet),
                // and the device's arrival notification landed inside the window.
                // Dropping it would leave the app "not listening" with no further
                // event to recover on. One retry per swallowed event — a dead mic
                // emits no events, so this can't poll forever.
                AppLog.shared.log("device event during settle after failed start — retrying")
                self.requestListening()
            } else if !self.listening && self.listeningIntent {
                // The counter is meant to be on but the start failed and no device
                // event arrived to hang a retry off. The reachable case is a return
                // from standby: the machine powered the USB bus down, so the mic is
                // still re-enumerating when the settle window ends and there is
                // nothing left to recover on — the app would sit silently "not
                // listening" until someone opened the menu. So back off and try
                // again, doubling each time (2s, 4s … 32s) and giving up after
                // `maxStartRetries`: bounded, because a mic that is gone for good
                // emits nothing and must not be polled forever, and slow, because
                // rapid-cycling a USB mic is what wedges it in the first place.
                self.scheduleStartRetry(generation: generation)
            }
        }
    }

    /// Back-off retry after a failed start, generation-guarded like every other
    /// deferred restart: an intentional stop, or any restart accepted meanwhile,
    /// moves the generation and this retry aborts rather than re-acquiring the mic
    /// behind it. Main-thread only.
    private func scheduleStartRetry(generation: Int) {
        let attempt = startFailureStreak
        // Double up to the ceiling, then keep checking at that interval for as
        // long as the counter is meant to be on. Deliberately never gives up: the
        // measured cause of a long outage is the input device being torn down
        // while the displays sleep, which lasted 28 minutes in one observation —
        // no bounded ladder covers that, and the old five attempts (~62s) expired
        // with the cause still fully present, telling the user to reconnect a
        // microphone that was fine. A start attempt is now a cheap format read
        // that throws before touching the tap, and one a minute is far below any
        // rate that could cycle a USB mic. (#76)
        let delay = min(Double(1 << min(attempt, 6)), maxBackoffDelay)
        if attempt <= maxStartRetries {
            AppLog.shared.log("start failed — retrying in \(Int(delay))s "
                + "(attempt \(attempt) of \(maxStartRetries))", level: "WARN")
        } else if attempt == maxStartRetries + 1 {
            // Announce the switch to slow checking once, then stay quiet until it
            // works — a line a minute for half an hour buries everything else.
            AppLog.shared.log("input device still unavailable — checking every "
                + "\(Int(maxBackoffDelay))s until it returns (expected while the "
                + "displays are asleep; no action needed)", level: "WARN")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, generation == self.restartGeneration else { return }
            guard self.listeningIntent, !self.listening else { return }
            self.requestListening()
        }
    }

    private func stopListening(reason: String) {
        // Invalidate the whole in-flight restart machinery, not just the queue
        // flag: a pending finishListening must never fire after an intentional
        // stop (it would re-acquire the mic right as the system sleeps), and the
        // in-flight/suppress latches must not stay stuck blocking future starts.
        restartGeneration &+= 1
        restartInFlight = false
        restartQueued = false
        suppressConfigChange = false
        pendingResumeID = nil   // a resume scheduled before this stop is void
        counter.flush()
        voice.stop()     // symmetric with resume; recognition restarts on wake
        audio.stop()
        listening = false
        diagnostics.noteCaptureStopped(reason: reason)
        AppLog.shared.log("listening stopped (\(reason))")
        refreshTitle()
        buildMenu()
    }

    private func requestSpeech() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    AppLog.shared.log("speech recognition not authorized", level: "WARN")
                    return
                }
                self?.speechAuthorized = true
                self?.voice.start()
                self?.buildMenu()
            }
        }
    }

    // MARK: system power / audio events

    private func observeSystemEvents() {
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(willSleep),
                       name: NSWorkspace.willSleepNotification, object: nil)
        // macOS has no "returned from standby" notification — standby is just a
        // deeper sleep, and the only guaranteed signal is the ordinary wake. But a
        // wake is not always a *return*: a dark/Power-Nap wake fires it with nobody
        // there and the machine drops straight back to sleep, and after a long
        // standby the mic can still be re-enumerating when our settle window ends.
        // So take the wake plus every other "the machine is back" signal and funnel
        // them into one coalesced resume; whichever lands first schedules it, the
        // later ones act as backstops if that resume didn't get the counter running.
        ws.addObserver(self, selector: #selector(didWake),
                       name: NSWorkspace.didWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(screensDidWake),
                       name: NSWorkspace.screensDidWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(sessionDidBecomeActive),
                       name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        // Unlocking after standby is the strongest "a person is actually back"
        // signal, but it only exists as a *distributed* notification. That is fine
        // for this app (non–App Store, no App Sandbox); under the sandbox it would
        // simply never arrive, and the workspace triggers above still cover us.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(screenDidUnlock),
            name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        // AudioHub owns the .AVAudioEngineConfigurationChange observation because
        // it replaces the engine on every start (#61) and an observer bound to a
        // superseded instance would silently stop firing. It delivers on main.
        audio.onConfigurationChange = { [weak self] in self?.audioConfigChanged() }
    }

    @objc private func willSleep() {
        // Gate BEFORE tearing down: CoreAudio switches/removes devices while the
        // machine heads into sleep, and the resulting config-change notifications
        // must not restart capture behind this intentional stop.
        sleeping = true
        sleepStartedAt = Date()
        // What the capture path looked like going *in*, so the log carries both
        // sides of the transition rather than only the transition itself.
        AppLog.shared.log("entering sleep — \(diagnostics.snapshotLine())")
        // stopListening deliberately leaves `listeningIntent` alone: this is a
        // suspend, not "the counter was switched off", and the return path reads
        // that intent to decide whether to switch it back on.
        stopListening(reason: "system sleep")
    }

    @objc private func didWake() { systemDidReturn(reason: "system woke") }
    @objc private func screensDidWake() { systemDidReturn(reason: "displays woke") }
    @objc private func sessionDidBecomeActive() { systemDidReturn(reason: "session became active") }
    @objc private func screenDidUnlock() {
        // Distributed notifications are delivered on the main thread for an app
        // with a run loop, but say so explicitly rather than rely on it.
        DispatchQueue.main.async { [weak self] in self?.systemDidReturn(reason: "screen unlocked") }
    }

    /// One entry point for every "the machine is back" signal (wake from sleep or
    /// standby, displays waking, the session returning, the screen unlocking).
    /// Reactivates the counter **only if it was active before** — a Mac that was
    /// not listening when it went down comes back not listening.
    private func systemDidReturn(reason: String) {
        // These signals also fire with no sleep involved at all: the display
        // waking from the screensaver, a user switching back. Only a machine that
        // actually owes a resume reacts — restarting capture on every display wake
        // would rapid-cycle the mic (the wedge condition) for nothing.
        guard sleeping || (listeningIntent && !listening) else { return }
        if pendingResumeID != nil { return }   // the burst is one return, one resume
        // How long we were down, measured from willSleep. Nil means we never slept:
        // the signal is then a backstop over a start that failed earlier, and it
        // buys exactly one more attempt — not a fresh retry ladder.
        let asleep = sleepStartedAt.map { Date().timeIntervalSince($0) }
        // After a long standby the USB bus was powered down and devices come back
        // well after the wake notification, so settle for longer before re-acquiring.
        let standby = (asleep ?? 0) >= standbyThreshold
        let settle = standby ? standbySettleDelay : wakeSettleDelay
        let what = listeningIntent ? "resuming listening shortly"
                                   : "counter is \(offReason ?? "off"), staying off"
        if let asleep = asleep {
            AppLog.shared.log(String(format: "%@ after %.0fs %@ — %@", reason, asleep,
                                     standby ? "standby" : "sleep", what))
        } else {
            AppLog.shared.log("\(reason) while listening was down — \(what)")
        }
        resumeID &+= 1
        let id = resumeID
        pendingResumeID = id
        // Stay gated (`sleeping`) through the settle delay so wake-time device
        // re-enumeration can't trigger an early, un-settled restart; this resume is
        // the one entry point out of sleep. Capture the generation so a quick
        // re-sleep (lid closed again during the delay) aborts it — willSleep bumps
        // the generation, and this timer would otherwise fire immediately on the
        // *next* wake, un-gating and restarting un-settled.
        let generation = restartGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + settle) { [weak self] in
            guard let self = self, self.pendingResumeID == id else { return }
            self.pendingResumeID = nil
            guard generation == self.restartGeneration else {
                AppLog.shared.log("wake resume superseded by a later stop — skipping")
                return
            }
            self.sleeping = false          // always ungate, even when staying off,
            self.sleepStartedAt = nil      // or a manual start would stay blocked
            guard self.listeningIntent else {
                AppLog.shared.log("listening not resumed — counter is "
                    + "\(self.offReason ?? "off") (it was not active before sleep)")
                return
            }
            // The other side of the sleep transition: what CoreAudio is offering
            // at the moment we decide to re-acquire, which is the state that
            // decides whether the start about to run can possibly succeed.
            AppLog.shared.log("settled after \(reason) — \(self.diagnostics.snapshotLine())")
            // A real return from sleep earns a fresh retry ladder; a backstop
            // signal (no sleep behind it) gets the single attempt below instead.
            if asleep != nil { self.startFailureStreak = 0 }
            self.requestListening()
            if self.speechAuthorized { self.voice.start() }   // idempotent
        }
    }

    /// Main-queue only — `AudioHub` delivers the notification there.
    private func audioConfigChanged() {
        guard !sleeping else { return }
        if suppressConfigChange {
            configChangeSwallowed = true   // reconciled at settle time
            return
        }
        AppLog.shared.log("audio configuration changed — reconfiguring "
            + "(\(diagnostics.snapshotLine()))")
        requestListening()   // single-flighted + rate-limited inside
    }

    // MARK: menu bar

    /// `v0.3.1 (5)` — shown in the menu header so the running build is
    /// identifiable without a terminal.
    ///
    /// Read from `Bundle.main`, never a constant in the source: `Info.plist` is
    /// the one place the version lives, and the release workflow derives the tag
    /// from it, so a second copy here could disagree with the DMG it shipped in.
    /// The **build number matters as much as the version**: a merge that doesn't
    /// change `CFBundleShortVersionString` refreshes the same Release, so several
    /// distinct builds shipped as `0.2.1` and telling them apart meant reading
    /// symbol names out of a crash report. `CFBundleVersion` is what separates
    /// them. (#74)
    private static var versionLabel: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        switch (short, build) {
        case let (version?, build?): return "v\(version) (\(build))"
        case let (version?, nil): return "v\(version)"
        default: return "(version unknown)"   // only reachable outside a bundle
        }
    }

    /// What the counter is actually doing, in one phrase, for the menu and the
    /// tooltip. `listening` alone is not enough to answer that: it only means
    /// `engine.start()` returned, so it stays true while the app holds a device
    /// that has stopped delivering *and* while it holds one that delivers
    /// nothing but zeros. The diagnostics' health is what separates the three,
    /// and every user-facing status renders this one property so they cannot
    /// disagree about it.
    private var statusText: String {
        guard listening else { return offReason ?? "not listening" }
        switch diagnostics.health {
        case .ok:       return "listening"
        case .stalled:  return "no audio arriving — microphone may be stuck"
        // Names the remedy, because it is the only one that works and it is not
        // one anybody guesses: the device looks perfectly healthy everywhere it
        // is reported, including in System Settings.
        case .noSignal: return "microphone is silent — unplug it and reconnect it"
        }
    }

    private func refreshTitle() {
        // A distinct icon per unhealthy state: neither is "listening", and
        // neither is "off" either — the app is holding a microphone that isn't
        // working, the state that used to be indistinguishable from working.
        // ⚠️ rather than 🔇 for no-signal because that one needs the owner to
        // get up and physically re-plug something; nothing else clears it.
        var icon = "🎙️"
        if listening {
            switch diagnostics.health {
            case .ok:       icon = "😄"
            case .stalled:  icon = "🔇"
            case .noSignal: icon = "⚠️"
            }
        }
        let me = store.todayCount(origin: "me")
        let tv = store.todayCount(origin: "tv")
        // Two counters: your laughs vs the TV's, today.
        statusItem.button?.title = "\(icon) \(me)  📺 \(tv)"
        // "open menu to resume" is wrong advice for no-signal — resuming cannot
        // fix a device that survives a full process exit, so don't offer it.
        let hint = diagnostics.health == .noSignal
            ? "(reconnect the microphone)" : "(open menu to resume)"
        statusItem.button?.toolTip = listening && diagnostics.health == .ok
            ? "Today — you: \(me) · TV: \(tv)"
            : "LaughCounter — \(statusText) \(hint)"
        // refreshTitle() is called after every `listening` transition, so it's the
        // one chokepoint that keeps the power assertion in sync with the state.
        updateSleepAssertion()
    }

    /// Hold the idle-system-sleep assertion iff the user opted in *and* we're
    /// actually listening; release it otherwise. Idempotent — safe to call on any
    /// state change. Main-thread only (every caller is already on main).
    private func updateSleepAssertion() {
        let shouldHold = keepAwake && listening
        if shouldHold, sleepAssertion == nil {
            sleepAssertion = ProcessInfo.processInfo.beginActivity(
                options: [.idleSystemSleepDisabled],
                reason: "LaughCounter is listening for laughs")
            AppLog.shared.log("keep-awake: holding idle-sleep assertion")
        } else if !shouldHold, let token = sleepAssertion {
            ProcessInfo.processInfo.endActivity(token)
            sleepAssertion = nil
            AppLog.shared.log("keep-awake: released idle-sleep assertion")
        }
    }

    private func buildMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "LaughCounter \(Self.versionLabel)",
                     action: nil, keyEquivalent: "")

        let stateItem = NSMenuItem(title: "Status: \(statusText)",
                                   action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        switch diagnostics.health {
        case .ok:
            break
        case .stalled:
            stateItem.toolTip = "The microphone is open but no audio has arrived for a "
                + "while. Try “Restart listening”; if that doesn't help, the device may "
                + "need to be unplugged and reconnected. Details are in the activity log."
        case .noSignal:
            // Deliberately does not suggest "Restart listening" first: measured
            // on this failure, restarting the engine, quitting the app entirely
            // and restarting coreaudiod all left the device streaming silence.
            // Only re-plugging it worked, so that is what the tooltip says. (#88)
            stateItem.toolTip = "The microphone is delivering audio at the normal rate, "
                + "but every sample is silent — the device is connected and not actually "
                + "capturing. Unplug it and plug it back in. Restarting listening or "
                + "quitting LaughCounter will not clear this, and the device still looks "
                + "healthy in System Settings. Details are in the activity log."
        }
        menu.addItem(stateItem)

        let voiceState = voice.isAvailable ? "on — say “I just laughed”" : "unavailable"
        let voiceItem = NSMenuItem(title: "Voice feedback: \(voiceState)",
                                   action: nil, keyEquivalent: "")
        voiceItem.isEnabled = false
        menu.addItem(voiceItem)

        menu.addItem(.separator())
        menu.addItem(withTitle: "I just laughed (log a miss)",
                     action: #selector(logMiss), keyEquivalent: "l")
        menu.addItem(withTitle: listening ? "Restart listening" : "Start listening",
                     action: #selector(resumeListening), keyEquivalent: "r")
        // Only offered while the counter is meant to be on: once paused, "Start
        // listening" above is the way back, so there is never a Pause and a Resume
        // item competing to describe the same state.
        if listeningIntent {
            let pauseItem = NSMenuItem(title: "Pause listening",
                                       action: #selector(pauseListening), keyEquivalent: "p")
            pauseItem.toolTip = "Stop counting and release the microphone until you "
                + "start it again. Sleeping the Mac while paused keeps it paused; "
                + "quitting and relaunching starts it listening again."
            menu.addItem(pauseItem)
        }

        let keepAwakeItem = NSMenuItem(title: "Keep Mac awake while listening",
                                       action: #selector(toggleKeepAwake), keyEquivalent: "")
        keepAwakeItem.state = keepAwake ? .on : .off
        keepAwakeItem.toolTip = "Blocks idle sleep so laughs are still heard during a long "
            + "movie. Won't stop lid-close or manual Sleep, and uses more battery."
        menu.addItem(keepAwakeItem)
        menu.addItem(withTitle: "Open laugh log…",
                     action: #selector(openLog), keyEquivalent: "")
        menu.addItem(withTitle: "Open activity log…",
                     action: #selector(openActivityLog), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit LaughCounter",
                     action: #selector(quit), keyEquivalent: "q")
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    @objc private func logMiss() { markMissed(source: "button") }
    @objc private func resumeListening() {
        AppLog.shared.log("manual resume requested")
        startFailureStreak = 0   // an explicit ask earns a full retry ladder again
        requestListening()       // clears any pause via offReason = nil
    }
    /// Switch the counter off until it's switched back on by hand. Deliberately
    /// *not* persisted: relaunching starts listening again, which is what an
    /// always-on box should do after a power cut. Because it clears the intent, a
    /// sleep/standby taken while paused comes back paused.
    @objc private func pauseListening() {
        offReason = "paused"
        startFailureStreak = 0            // nothing to recover from any more
        stopListening(reason: "paused by user")
    }
    @objc private func toggleKeepAwake() {
        keepAwake.toggle()
        UserDefaults.standard.set(keepAwake, forKey: keepAwakeDefaultsKey)
        AppLog.shared.log("keep-awake \(keepAwake ? "enabled" : "disabled")")
        updateSleepAssertion()
        buildMenu()   // reflect the checkmark
    }
    @objc private func openLog() { store.revealInFinder() }
    @objc private func openActivityLog() {
        NSWorkspace.shared.activateFileViewerSelecting([AppLog.shared.fileURL])
    }
    @objc private func quit() {
        AppLog.shared.log("app quitting")
        NSApp.terminate(nil)
    }

    /// Clean up before the process exits. Reached for every exit path that goes
    /// through `NSApp.terminate` — the menu Quit item, ⌘Q, the logout/shutdown
    /// quit Apple Event, and the SIGTERM/SIGINT/SIGHUP sources in main.swift that
    /// route catchable signals here. Not reached for SIGKILL (Force Quit,
    /// `kill -9`) or a crash — those are uncatchable; nothing in-process can
    /// release the mic on them.
    ///
    /// Releasing the microphone here is the whole point: if the process dies with
    /// the input tap still installed and the engine running, its CoreAudio IOProc
    /// stays registered on the input device. Some USB webcam mics get wedged by
    /// that and go silent — no input registered in System Settings — until they're
    /// physically unplugged and reconnected. Tearing down the tap + engine (and the
    /// speech recogniser, which also holds the audio stream) deregisters the IOProc
    /// so the device is handed cleanly back to the system.
    func applicationWillTerminate(_ notification: Notification) {
        sleeping = true          // gate any late config-change reaction during teardown
        AppLog.shared.log("terminating — \(diagnostics.snapshotLine())")
        diagnostics.stop()
        // stopListening: flushes the in-progress laugh, invalidates pending
        // restarts (generation bump), stops speech, removes the tap, stops the
        // engine, and (via refreshTitle) drops the keep-awake assertion.
        stopListening(reason: "app terminating")
        AppLog.shared.log("app terminated — microphone released")
    }

    private func showMicDenied() {
        statusItem.button?.title = "😄 ⚠️"
        let alert = NSAlert()
        alert.messageText = "LaughCounter needs the microphone"
        alert.informativeText = "Grant access in System Settings → Privacy & Security → "
            + "Microphone, then relaunch LaughCounter."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

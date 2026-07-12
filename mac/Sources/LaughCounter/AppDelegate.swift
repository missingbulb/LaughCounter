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

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        refreshTitle()
        buildMenu()
        wireUp()
        observeSystemEvents()
        AppLog.shared.log("app launched")
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
        // One mic tap, fanned out to both consumers.
        audio.onBuffer = { [weak self] buffer, when in
            self?.detector.analyze(buffer, at: when)
            self?.voice.append(buffer)
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
        if restartInFlight {           // coalesce; don't stack restarts
            restartQueued = true
            return
        }
        restartInFlight = true
        suppressConfigChange = true    // ignore the config-changes our stop/start emits
        counter.flush()
        counter.reset()
        detector.reset()
        audio.stop()
        listening = false
        refreshTitle()
        // Let the (USB) input device release before re-acquiring — reacquiring
        // immediately after teardown is what can wedge some USB mics.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.finishListening()
        }
    }

    private func finishListening() {
        do {
            // Configure the analyzer BEFORE audio flows, so no early buffers are
            // dropped and analysis reliably starts (matches the original order).
            let format = try audio.prepareFormat()
            try detector.configure(format: format)
            try audio.start(format: format)
            listening = true
            AppLog.shared.log("listening started "
                + "(sampleRate=\(Int(format.sampleRate)), channels=\(format.channelCount))")
        } catch {
            audio.stop()
            listening = false
            AppLog.shared.log("could not start listening: \(error.localizedDescription)",
                              level: "ERROR")
        }
        refreshTitle()
        buildMenu()
        // Settle window: no further restart (or config-change reaction) until the
        // engine has run undisturbed for a moment. Then honor any coalesced request.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self = self else { return }
            self.suppressConfigChange = false
            self.restartInFlight = false
            if self.restartQueued {
                self.restartQueued = false
                self.requestListening()
            }
        }
    }

    private func stopListening(reason: String) {
        restartQueued = false
        counter.flush()
        audio.stop()
        listening = false
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
        ws.addObserver(self, selector: #selector(didWake),
                       name: NSWorkspace.didWakeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(audioConfigChanged),
                                               name: .AVAudioEngineConfigurationChange,
                                               object: audio.engine)
    }

    @objc private func willSleep() {
        stopListening(reason: "system sleep")
    }

    @objc private func didWake() {
        AppLog.shared.log("system woke — resuming listening shortly")
        // Give the audio hardware a moment to settle after wake before restarting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.requestListening()
        }
    }

    @objc private func audioConfigChanged(_ note: Notification) {
        // The notification can arrive on any thread; touch state only on main.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.suppressConfigChange else { return }
            AppLog.shared.log("audio configuration changed — reconfiguring")
            self.requestListening()   // single-flighted + rate-limited inside
        }
    }

    // MARK: menu bar

    private func refreshTitle() {
        let icon = listening ? "😄" : "🎙️"
        let me = store.todayCount(origin: "me")
        let tv = store.todayCount(origin: "tv")
        // Two counters: your laughs vs the TV's, today.
        statusItem.button?.title = "\(icon) \(me)  📺 \(tv)"
        statusItem.button?.toolTip = listening
            ? "Today — you: \(me) · TV: \(tv)"
            : "LaughCounter — not listening (open menu to resume)"
    }

    private func buildMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "LaughCounter", action: nil, keyEquivalent: "")

        let stateItem = NSMenuItem(
            title: listening ? "Status: listening" : "Status: not listening",
            action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
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
        requestListening()
    }
    @objc private func openLog() { store.revealInFinder() }
    @objc private func openActivityLog() {
        NSWorkspace.shared.activateFileViewerSelecting([AppLog.shared.fileURL])
    }
    @objc private func quit() {
        counter.flush()
        AppLog.shared.log("app quitting")
        NSApp.terminate(nil)
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

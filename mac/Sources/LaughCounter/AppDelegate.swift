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
        // A detected laugh → log it and give one confirming blip.
        counter.onLaugh = { [weak self] event in
            guard let self = self else { return }
            self.store.append(event)
            AppLog.shared.log(String(format: "laugh logged type=%@ peak=%.2f dur=%.2f",
                                     event.type.isEmpty ? "?" : event.type,
                                     event.peak, event.duration))
            Chime.play(times: 1)
            DispatchQueue.main.async { self.refreshTitle() }
        }
        // A laugh judged to be TV / laugh-track audio → note it, don't count it.
        counter.onSuppressed = { _, reason in
            AppLog.shared.log("laugh suppressed (\(reason))")
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
                    self.startListening()
                    self.requestSpeech()
                } else {
                    AppLog.shared.log("microphone access denied", level: "ERROR")
                    self.showMicDenied()
                }
            }
        }
    }

    /// Idempotent "ensure we are listening": (re)configure the detector to the
    /// live input format and (re)start the engine. Safe to call on launch, after
    /// wake, on an audio-configuration change, or from the Resume menu item — this
    /// is the single recovery path for all of those.
    private func startListening() {
        guard micGranted else { return }
        counter.flush()
        counter.reset()
        detector.reset()
        audio.stop()
        do {
            let format = try audio.start()
            try detector.configure(format: format)
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
    }

    private func stopListening(reason: String) {
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.startListening()
        }
    }

    @objc private func audioConfigChanged(_ note: Notification) {
        AppLog.shared.log("audio configuration changed — reconfiguring")
        DispatchQueue.main.async { [weak self] in self?.startListening() }
    }

    // MARK: menu bar

    private func refreshTitle() {
        let icon = listening ? "😄" : "🎙️"
        statusItem.button?.title = "\(icon) \(store.todayCount())"
        statusItem.button?.toolTip = listening
            ? "LaughCounter is listening"
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
        menu.addItem(withTitle: listening ? "Restart listening" : "Resume listening",
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
        startListening()
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

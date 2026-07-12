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
    private var micReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        refreshTitle()
        buildMenu()
        wireUp()
        requestPermissionsAndStart()
    }

    // MARK: wiring

    private func wireUp() {
        // A detected laugh → log it and give one confirming blip.
        counter.onLaugh = { [weak self] event in
            guard let self = self else { return }
            self.store.append(event)
            Chime.play(times: 1)
            DispatchQueue.main.async { self.refreshTitle() }
        }
        // Each analysis result → feed the counter (wall-clock timestamp).
        detector.onLaughterScore = { [weak self] score in
            self?.counter.update(timestamp: Date().timeIntervalSince1970, score: score)
        }
        // "I just laughed" (voice or menu) → log a miss and blip twice.
        voice.onTrigger = { [weak self] in self?.markMissed() }
        // One mic tap, fanned out to both consumers.
        audio.onBuffer = { [weak self] buffer, when in
            self?.detector.analyze(buffer, at: when)
            self?.voice.append(buffer)
        }
    }

    private func markMissed() {
        store.appendMissed()
        Chime.play(times: 2)
        DispatchQueue.main.async { self.refreshTitle() }
    }

    // MARK: permissions + start

    private func requestPermissionsAndStart() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if granted {
                    self.startAudio()
                    self.requestSpeech()
                } else {
                    self.showMicDenied()
                }
            }
        }
    }

    private func startAudio() {
        do {
            try detector.configure(format: audio.inputFormat)
            try audio.start()
            micReady = true
            refreshTitle()
        } catch {
            NSLog("LaughCounter: could not start listening: \(error.localizedDescription)")
            statusItem.button?.title = "😄 ⚠️"
        }
    }

    private func requestSpeech() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else { return }
                self?.voice.start()
                self?.buildMenu()
            }
        }
    }

    // MARK: menu bar

    private func refreshTitle() {
        let icon = micReady ? "😄" : "🎙️"
        statusItem.button?.title = "\(icon) \(store.todayCount())"
        statusItem.button?.toolTip = micReady
            ? "LaughCounter is listening"
            : "LaughCounter — waiting for microphone access"
    }

    private func buildMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "LaughCounter", action: nil, keyEquivalent: "")
        let voiceState = voice.isAvailable ? "on — say “I just laughed”" : "unavailable"
        let voiceItem = NSMenuItem(title: "Voice feedback: \(voiceState)", action: nil, keyEquivalent: "")
        voiceItem.isEnabled = false
        menu.addItem(voiceItem)
        menu.addItem(.separator())
        menu.addItem(withTitle: "I just laughed (log a miss)",
                     action: #selector(logMiss), keyEquivalent: "l")
        menu.addItem(withTitle: "Open laugh log…",
                     action: #selector(openLog), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit LaughCounter",
                     action: #selector(quit), keyEquivalent: "q")
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    @objc private func logMiss() { markMissed() }
    @objc private func openLog() { store.revealInFinder() }
    @objc private func quit() { counter.flush(); NSApp.terminate(nil) }

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

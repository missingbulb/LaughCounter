import AVFoundation
import Speech

/// Hands-free feedback: listens (entirely **on-device**) for you saying
/// "I just laughed" and fires a callback so the app can log a laugh it missed.
///
/// It shares the microphone via `AudioHub`; call `append(_:)` with each captured
/// buffer. Recognition is restarted after each trigger (and on completion) both
/// to keep it running and to clear the transcript so one phrase fires once.
final class VoiceCommand {
    /// Called when a trigger phrase is recognised.
    var onTrigger: (() -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var lastTrigger = Date.distantPast
    private var running = false

    private let phrases = [
        "i just laughed", "just laughed", "i laughed",
        "mark my laugh", "mark laugh", "log my laugh",
    ]

    var isAvailable: Bool { recognizer?.isAvailable ?? false }

    func start() {
        guard let recognizer = recognizer, recognizer.isAvailable else { return }
        running = true

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true   // never leaves the Mac
        }
        self.request = request

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString.lowercased()
                if self.phrases.contains(where: { text.contains($0) }) {
                    self.fire()
                }
            }
            if error != nil || (result?.isFinal ?? false) {
                self.restart()
            }
        }
    }

    /// Feed a captured microphone buffer to the recogniser.
    func append(_ buffer: AVAudioPCMBuffer) {
        request?.append(buffer)
    }

    func stop() {
        running = false
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
    }

    private func fire() {
        let now = Date()
        if now.timeIntervalSince(lastTrigger) < 3 { return }  // debounce repeats
        lastTrigger = now
        onTrigger?()
        restart()  // clear the transcript so the same phrase can't re-fire
    }

    private func restart() {
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        guard running else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self, self.running else { return }
            self.start()
        }
    }
}

import AVFoundation
import Speech

/// Hands-free feedback: listens (entirely **on-device**) for you saying
/// "I just laughed" and fires a callback so the app can log a laugh it missed.
///
/// It shares the microphone via `AudioHub`; call `append(_:)` with each captured
/// buffer. Recognition is restarted after each trigger (and on completion) both
/// to keep it running and to clear the transcript so one phrase fires once.
///
/// Thread-safety: all mutable state (`request`/`task`/`running`/`generation`/
/// `lastTrigger`) is touched from three threads — main (`start`/`stop`), the
/// Speech framework's callback queue (the restart after each completion/error),
/// and the CoreAudio tap thread (`append`). One lock guards it all; `append`
/// copies the reference out under the lock so the tap thread never races an
/// ARC store (an unsynchronized read racing a release is undefined behavior,
/// not just a logic bug).
final class VoiceCommand {
    /// Called when a trigger phrase is recognised.
    var onTrigger: (() -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var running = false
    // Bumped by stop(); a delayed internal restart scheduled before the stop
    // aborts when it sees the generation moved, so a stop can't be resurrected.
    private var generation = 0
    private var lastTrigger = Date.distantPast

    private let phrases = [
        "i just laughed", "just laughed", "i laughed",
        "mark my laugh", "mark laugh", "log my laugh",
    ]

    var isAvailable: Bool { recognizer?.isAvailable ?? false }

    /// Idempotent: calling while recognition is already active is a no-op, so
    /// wake/resume paths can call it liberally. Main-thread only (as is `stop`;
    /// the delayed restart also lands on main, which serializes them).
    func start() {
        guard let recognizer = recognizer, recognizer.isAvailable else { return }

        let newRequest = SFSpeechAudioBufferRecognitionRequest()
        newRequest.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            newRequest.requiresOnDeviceRecognition = true   // never leaves the Mac
        }

        lock.lock()
        guard task == nil, request == nil else {   // already recognizing
            lock.unlock()
            return
        }
        running = true
        request = newRequest
        lock.unlock()

        let newTask = recognizer.recognitionTask(with: newRequest) { [weak self] result, error in
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

        lock.lock()
        if request === newRequest {
            task = newTask
            lock.unlock()
        } else {
            // A stop() OR an immediate-error restart() consumed our request while
            // the task was being created (the handler can fire on the Speech queue
            // before we get back here). Checking `running` isn't enough: restart()
            // leaves it true, and storing the already-dead task would make the
            // `task == nil` idempotency guard reject every future start() — voice
            // silently dead. Identity of the request is the invariant that holds
            // for both interveners: if it's no longer ours, discard the task.
            lock.unlock()
            newTask.cancel()
            newRequest.endAudio()
        }
    }

    /// Feed a captured microphone buffer to the recogniser (audio-thread safe).
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let current = request
        lock.unlock()
        current?.append(buffer)
    }

    func stop() {
        lock.lock()
        generation &+= 1        // invalidate any delayed restart in flight
        running = false
        let oldTask = task; task = nil
        let oldRequest = request; request = nil
        lock.unlock()
        oldTask?.cancel()
        oldRequest?.endAudio()
    }

    private func fire() {
        // Debounce under the lock too: an old task's final callback and the
        // replacement task's can arrive on different Speech queues concurrently.
        let now = Date()
        lock.lock()
        if now.timeIntervalSince(lastTrigger) < 3 {  // debounce repeats
            lock.unlock()
            return
        }
        lastTrigger = now
        lock.unlock()
        onTrigger?()
        restart()  // clear the transcript so the same phrase can't re-fire
    }

    private func restart() {
        lock.lock()
        let oldTask = task; task = nil
        let oldRequest = request; request = nil
        let shouldRestart = running
        let gen = generation
        lock.unlock()
        oldTask?.cancel()
        oldRequest?.endAudio()
        guard shouldRestart else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let stale = self.generation != gen || !self.running
            self.lock.unlock()
            if !stale { self.start() }
        }
    }
}

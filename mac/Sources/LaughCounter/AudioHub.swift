import AVFoundation

/// Owns the microphone. A single input tap fans each captured buffer out to
/// every consumer (the laughter detector *and* the speech recogniser), so the
/// two never fight over the input node.
final class AudioHub {
    let engine = AVAudioEngine()

    /// Called for every captured buffer, on the audio thread.
    var onBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    /// The input format currently in use (valid only once `start()` has run).
    private(set) var activeFormat: AVAudioFormat?

    var isRunning: Bool { engine.isRunning }

    /// Start capturing and return the live input format actually in use.
    ///
    /// The input node's format is only reliable *after* the engine is prepared —
    /// reading it too early (e.g. right after launch) can yield a 0 Hz / 0-channel
    /// format, which then silently produces no analysis results even though the tap
    /// is running. We prepare first, validate, and hand the real format back so the
    /// detector is configured to match. Idempotent: safe to call to (re)start.
    @discardableResult
    func start() throws -> AVAudioFormat {
        let input = engine.inputNode
        engine.prepare()
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "LaughCounter", code: 1, userInfo: [
                NSLocalizedDescriptionKey:
                    "microphone input format not ready (sampleRate=\(format.sampleRate), "
                    + "channels=\(format.channelCount))",
            ])
        }
        input.removeTap(onBus: 0)   // no-op if none installed; keeps restart clean
        input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
            self?.onBuffer?(buffer, when)
        }
        try engine.start()
        activeFormat = format
        return format
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        activeFormat = nil
    }
}

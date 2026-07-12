import AVFoundation

/// Owns the microphone. A single input tap fans each captured buffer out to
/// every consumer (the laughter detector *and* the speech recogniser), so the
/// two never fight over the input node.
final class AudioHub {
    let engine = AVAudioEngine()

    /// Called for every captured buffer, on the audio thread.
    var onBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    /// The input format currently in use (valid only once `start(format:)` ran).
    private(set) var activeFormat: AVAudioFormat?

    var isRunning: Bool { engine.isRunning }

    /// Prepare the engine and return the validated live input format **without**
    /// starting capture. The input node's format is only reliable after prepare;
    /// returning it first lets the detector be configured to match *before* any
    /// audio flows (the analyzer must exist before buffers arrive, or the first
    /// buffers are dropped and analysis can fail to start).
    func prepareFormat() throws -> AVAudioFormat {
        engine.prepare()
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "LaughCounter", code: 1, userInfo: [
                NSLocalizedDescriptionKey:
                    "microphone input format not ready (sampleRate=\(format.sampleRate), "
                    + "channels=\(format.channelCount))",
            ])
        }
        return format
    }

    /// Install the tap and start capture, using a format from `prepareFormat()`.
    func start(format: AVAudioFormat) throws {
        let input = engine.inputNode
        input.removeTap(onBus: 0)   // no-op if none installed; keeps restart clean
        input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
            self?.onBuffer?(buffer, when)
        }
        try engine.start()
        activeFormat = format
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        activeFormat = nil
    }
}

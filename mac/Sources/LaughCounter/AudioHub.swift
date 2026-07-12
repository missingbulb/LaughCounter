import AVFoundation

/// Owns the microphone. A single input tap fans each captured buffer out to
/// every consumer (the laughter detector *and* the speech recogniser), so the
/// two never fight over the input node.
final class AudioHub {
    let engine = AVAudioEngine()

    /// Called for every captured buffer, on the audio thread.
    var onBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    var inputFormat: AVAudioFormat { engine.inputNode.outputFormat(forBus: 0) }

    func start() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
            self?.onBuffer?(buffer, when)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

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
        // Re-validate the live hardware format right before installing the tap.
        // The device can vanish or change between prepareFormat() and here (dock
        // unplug, wake-time re-enumeration), and installTap with a format that no
        // longer matches the hardware raises an *uncatchable* NSException instead
        // of throwing. Checking now converts the realistic stale-format cases into
        // a catchable error the caller's teardown path handles — it narrows the
        // race window to microseconds but cannot close it entirely (AVAudioEngine
        // offers nothing atomic), so this path is hardened, not crash-proof.
        let live = input.outputFormat(forBus: 0)
        guard live.sampleRate == format.sampleRate,
              live.channelCount == format.channelCount else {
            throw NSError(domain: "LaughCounter", code: 2, userInfo: [
                NSLocalizedDescriptionKey:
                    "input device changed between prepare and start "
                    + "(expected \(format.sampleRate)Hz/\(format.channelCount)ch, "
                    + "live \(live.sampleRate)Hz/\(live.channelCount)ch)",
            ])
        }
        input.removeTap(onBus: 0)   // no-op if none installed; keeps restart clean
        input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
            self?.onBuffer?(buffer, when)
        }
        try engine.start()
        activeFormat = format
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        // Unconditional: engine.stop() is safe on a non-running engine, and it also
        // releases what engine.prepare() allocated — a prepare()-then-throw path
        // (prepareFormat/configure failing before start) would otherwise leave the
        // initialized input unit holding the device.
        engine.stop()
        activeFormat = nil
    }
}

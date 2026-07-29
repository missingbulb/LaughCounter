import AVFoundation
import ObjCExceptionTrap

/// Owns the microphone. A single input tap fans each captured buffer out to
/// every consumer (the laughter detector *and* the speech recogniser), so the
/// two never fight over the input node.
///
/// The `AVAudioEngine` is **rebuilt on every start** rather than held for the
/// process lifetime — see `prepareFormat()` for why that is load-bearing and not
/// tidiness. Because the engine instance changes, this class also owns the
/// `.AVAudioEngineConfigurationChange` observation and republishes it through
/// `onConfigurationChange`: an observer registered against a replaced engine goes
/// quiet, and a quiet config-change observer means the app stops noticing that
/// its microphone disappeared.
final class AudioHub {
    private var engine: AVAudioEngine
    private var configObserver: NSObjectProtocol?

    /// Called for every captured buffer, on the audio thread.
    var onBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    /// Called on the main queue when CoreAudio reports that the current engine's
    /// configuration changed (device added, removed, or switched under us).
    var onConfigurationChange: (() -> Void)?

    /// The input format currently in use (valid only once `start(format:)` ran).
    private(set) var activeFormat: AVAudioFormat?

    var isRunning: Bool { engine.isRunning }

    init() {
        engine = Self.makeEngine()
        observeConfigurationChange()
    }

    /// Build an engine that is safe to `prepare()`.
    ///
    /// `AVAudioEngine` initializes its graph inside `prepare()` and asserts that
    /// at least one node is attached — `inputNode != nullptr || outputNode !=
    /// nullptr` — raising an uncatchable NSException when none is. A freshly
    /// constructed engine has none: `inputNode` is created lazily *on first
    /// access*, and touching the property is what attaches it. So materialize it
    /// here, as part of building an engine, rather than leaving it to a call
    /// order somewhere else.
    ///
    /// The pre-rebuild code survived only by accident: `requestListening()` calls
    /// `stop()`, which reaches `engine.inputNode.removeTap(onBus: 0)` and
    /// materialized the node on the single long-lived engine long before any
    /// `prepare()`. Rebuilding the engine after that call removed the accident,
    /// and every launch crashed one second in. (#72)
    private static func makeEngine() -> AVAudioEngine {
        let engine = AVAudioEngine()
        _ = engine.inputNode   // attaches it; do not "simplify" this away
        return engine
    }

    deinit {
        if let observer = configObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Build a fresh engine and return its validated live input format, **without**
    /// starting capture. The input node's format is only reliable after prepare;
    /// returning it first lets the detector be configured to match *before* any
    /// audio flows (the analyzer must exist before buffers arrive, or the first
    /// buffers are dropped and analysis can fail to start).
    ///
    /// The engine is replaced here rather than reused, and that is the fix for
    /// #61. An `AVAudioEngine` caches the input hardware format when its input
    /// node is first materialized, and the cache does not follow the device: after
    /// CoreAudio tears the input down — a USB mic re-enumerating, or coreaudiod
    /// dropping its contexts when the display sleeps — `inputNode.outputFormat(
    /// forBus: 0)` keeps reporting the *old* rate. `installTap` validates against
    /// the freshly-queried hardware format instead, the two disagree, and it
    /// raises an uncatchable NSException. That killed the app on every single
    /// configuration change (six for six over fifteen days) — not the rare race
    /// the previous guard assumed, because comparing the stale cache against
    /// itself always passed. A new engine reads the hardware fresh, so the guard
    /// in `start(format:)` is meaningful again and the two formats agree.
    func prepareFormat() throws -> AVAudioFormat {
        renewEngine()
        // Trapped as well as installTap: #59 wrapped only the tap install, and
        // prepare() then raised from a path with no trap in it at all. Anything
        // that can raise on the way to capture gets the same treatment. (#72)
        try ObjCExceptionTrap.run { engine.prepare() }
        return try validatedFormat()
    }

    /// The tap format, checked against the *hardware* format that `installTap`
    /// asserts on.
    ///
    /// Read `inputFormat(forBus: 0)`, not `outputFormat`: `outputFormat` is the
    /// bus's output format, and with the input device torn down it still reports
    /// a plausible 48 kHz while `inputFormat` correctly reports 0. Checking
    /// `outputFormat` therefore could not detect an absent microphone at all — it
    /// waved through starts that could never succeed and left `installTap` to
    /// raise, which is what the exception trap kept catching once a minute while
    /// the displays slept. Requiring the two to agree means `installTap` is never
    /// reached in the mismatch state. (#76)
    private func validatedFormat() throws -> AVAudioFormat {
        let input = engine.inputNode
        let hardware = input.inputFormat(forBus: 0)
        let bus = input.outputFormat(forBus: 0)
        guard hardware.sampleRate > 0, hardware.channelCount > 0 else {
            throw NSError(domain: "LaughCounter", code: 1, userInfo: [
                NSLocalizedDescriptionKey:
                    "no input hardware — the microphone is not available "
                    + "(sampleRate=\(hardware.sampleRate), channels=\(hardware.channelCount))",
            ])
        }
        guard hardware.sampleRate == bus.sampleRate,
              hardware.channelCount == bus.channelCount else {
            throw NSError(domain: "LaughCounter", code: 2, userInfo: [
                NSLocalizedDescriptionKey:
                    "input format unsettled "
                    + "(hardware \(hardware.sampleRate)Hz/\(hardware.channelCount)ch, "
                    + "bus \(bus.sampleRate)Hz/\(bus.channelCount)ch)",
            ])
        }
        return bus
    }

    /// Install the tap and start capture, using a format from `prepareFormat()`.
    func start(format: AVAudioFormat) throws {
        let input = engine.inputNode
        // Re-validate against the hardware immediately before the tap: the device
        // can still vanish between prepareFormat() and here (dock unplug,
        // wake-time re-enumeration), and a mismatch reaching installTap is what
        // raises. Checking the same pair as prepareFormat did, because the bus
        // format alone cannot tell an absent device from a present one. (#76)
        let live = try validatedFormat()
        guard live.sampleRate == format.sampleRate,
              live.channelCount == format.channelCount else {
            throw NSError(domain: "LaughCounter", code: 3, userInfo: [
                NSLocalizedDescriptionKey:
                    "input device changed between prepare and start "
                    + "(expected \(format.sampleRate)Hz/\(format.channelCount)ch, "
                    + "live \(live.sampleRate)Hz/\(live.channelCount)ch)",
            ])
        }
        input.removeTap(onBus: 0)   // no-op if none installed; keeps restart clean
        // Backstop: installTap raises an *uncatchable* NSException if its format
        // disagrees with the live hardware, and Swift cannot catch one — it aborts
        // the process, skipping the tap teardown in applicationWillTerminate and
        // leaving the IOProc registered, which is exactly what wedges a USB webcam
        // mic until it is physically re-plugged. This is not theoretical and not
        // dead code: it demonstrably caught that exception once a minute while the
        // displays slept, which is the only reason the app survived. The guard
        // above should now keep us off that path; this stays because there is no
        // atomic API and being wrong here costs the microphone.
        try ObjCExceptionTrap.run {
            input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
                self?.onBuffer?(buffer, when)
            }
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

    /// Tear the current engine down and put a fresh one in its place. Stopping
    /// first is what keeps the release-the-mic invariant: dropping the last
    /// reference to a *running* engine would abandon its tap and IOProc on the
    /// device instead of deregistering them.
    private func renewEngine() {
        stop()
        engine = Self.makeEngine()
        observeConfigurationChange()
    }

    /// (Re)point the configuration-change observation at the current engine.
    private func observeConfigurationChange() {
        if let observer = configObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        // Delivered on the main queue so the callback can touch app state directly;
        // CoreAudio posts this from whatever thread noticed the change.
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            self?.onConfigurationChange?()
        }
    }
}

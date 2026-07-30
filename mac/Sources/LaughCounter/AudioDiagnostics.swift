import AVFoundation
import CoreAudio
import Foundation

/// Continuous health monitoring for the capture path, so a mic failure records
/// itself as it happens instead of being reconstructed afterwards.
///
/// Every previous round of "the mic is dead after sleep" was diagnosed from
/// whatever survived — and the app's own log only ever said `listening started`,
/// because that is all it knew. `listening` means `engine.start()` returned; it
/// has never meant that audio is arriving. So the app could hold a dead device
/// for hours and report itself healthy, which is exactly what it did.
///
/// This closes that gap with two cheap, continuous measurements:
///
/// - **Buffer liveness.** The tap reports every buffer here; a timer notices
///   when they stop while we believe we are capturing, and says so once
///   (`AUDIO STALL`), then says so again when they come back. That is the
///   difference between "listening" and "holding a dead device".
/// - **The device, from CoreAudio's own point of view.** Read straight from the
///   HAL, which is a property query — it does **not** open the device, so
///   sampling it costs nothing and cannot contribute to the rapid-cycling that
///   wedges a USB mic. `IsRunningSomewhere` is the one that matters: it is true
///   when *any* process has IO running on the device, so "no buffers arriving
///   while IsRunningSomewhere is true" says the stream is ours and it is dead,
///   rather than the device having simply gone away.
///
/// Logging is state-change-driven, not periodic: a line a minute for half an
/// hour buries everything else, so a routine heartbeat lands every ten minutes
/// and anything unusual (a stall starting or ending, the device set changing,
/// the format changing) is logged the moment it is seen.
final class AudioDiagnostics {

    // MARK: configuration

    /// How often the counters and the device are sampled. Cheap: a few HAL
    /// property reads and an integer swap.
    private let sampleInterval: TimeInterval = 5
    /// No buffers for this long, while we believe we are capturing, is a stall.
    /// Buffers arrive roughly every 0.17s (8192 frames at 48kHz), so this is
    /// two orders of magnitude of slack — it cannot fire on jitter.
    private let stallThreshold: TimeInterval = 15
    /// Routine "everything is fine" line, so the log shows the counter alive
    /// across a long quiet evening rather than going silent and looking dead.
    private let heartbeatInterval: TimeInterval = 600

    // MARK: tap-side counters
    //
    // Written on the audio thread, read on main. One lock, held for a handful of
    // instructions — the same shape VoiceCommand uses for the same reason.

    private let lock = NSLock()
    private var bufferCount = 0
    private var frameCount = 0
    private var peak: Float = 0
    /// Monotonic stamp of the last buffer. Deliberately `systemUptime`, which
    /// does **not** advance while the machine is asleep — the opposite of the
    /// choice in `AppDelegate.sleepStartedAt`, and for the opposite reason: this
    /// measures how long the stream has been silent *while we were awake*, so a
    /// sleep in the middle must not count as silence.
    private var lastBufferUptime: TimeInterval?

    // MARK: main-side state

    private var timer: Timer?
    private var stalled = false
    private var lastHeartbeat: TimeInterval = 0
    private var lastDevices: [InputDevice] = []
    private var activeFormat: AVAudioFormat?
    /// Cumulative across the process, for the heartbeat line — the per-sample
    /// counters are reset every tick.
    private var totalBuffers = 0
    private var totalFrames = 0

    /// "The app believes it is capturing." Supplied by `AppDelegate`; without it
    /// a stall is meaningless, since no buffers is correct when paused.
    var isListening: (() -> Bool)?
    /// Fired on main when the stall state flips, with the silence duration.
    /// Lets the menu bar stop claiming to listen while nothing is arriving.
    var onStallChanged: ((Bool, TimeInterval) -> Void)?

    /// Whether the capture path is currently believed dead. Main-thread only.
    private(set) var isStalled = false

    // MARK: lifecycle

    /// Begin sampling. Main-thread only; safe to call twice.
    func start() {
        guard timer == nil else { return }
        lastHeartbeat = ProcessInfo.processInfo.systemUptime
        lastDevices = Self.inputDevices()
        let timer = Timer(timeInterval: sampleInterval, repeats: true) { [weak self] _ in
            self?.sample()
        }
        // .common so the sampling keeps running while a menu is open — the one
        // moment someone is actually looking at the status it reports.
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        AppLog.shared.log("audio diagnostics started — \(Self.describe(lastDevices))")
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Called from the audio tap, on the audio thread, for every buffer.
    func noteBuffer(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        // Stride-sampled peak: telling silence from audio does not need every
        // frame, and the audio thread should not pay for what it does not need.
        var localPeak: Float = 0
        if let channel = buffer.floatChannelData?[0] {
            var index = 0
            while index < frames {
                localPeak = max(localPeak, abs(channel[index]))
                index += 16
            }
        }
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        bufferCount += 1
        frameCount += frames
        peak = max(peak, localPeak)
        lastBufferUptime = now
        lock.unlock()
    }

    /// Capture started. Starts the stall clock from here, so the window before
    /// the first buffer is measured too — a start that never delivers anything
    /// is precisely the failure this exists to catch.
    func noteCaptureStarted(format: AVAudioFormat) {
        activeFormat = format
        lock.lock()
        lastBufferUptime = ProcessInfo.processInfo.systemUptime
        lock.unlock()
        clearStall(logging: false)
    }

    /// Capture stopped on purpose. Clears the stall clock so an intentional stop
    /// is never reported as a stall.
    func noteCaptureStopped(reason: String) {
        activeFormat = nil
        lock.lock()
        lastBufferUptime = nil
        lock.unlock()
        clearStall(logging: false)
    }

    // MARK: sampling

    private func sample() {
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        let buffers = bufferCount
        let frames = frameCount
        let localPeak = peak
        let last = lastBufferUptime
        bufferCount = 0
        frameCount = 0
        peak = 0
        lock.unlock()
        totalBuffers += buffers
        totalFrames += frames

        let silence = last.map { now - $0 }
        let listening = isListening?() ?? false

        // Device changes are logged whenever they are seen: the set changing
        // under a running engine is the event that precedes most failures here,
        // and CoreAudio's own notification is suppressed around our restarts.
        let devices = Self.inputDevices()
        if devices != lastDevices {
            AppLog.shared.log("input devices changed — \(Self.describe(devices))",
                              level: "WARN")
            lastDevices = devices
        }

        if listening, let silence = silence, silence >= stallThreshold {
            if !stalled {
                stalled = true
                isStalled = true
                AppLog.shared.log("AUDIO STALL: no buffers for "
                    + String(format: "%.0fs", silence)
                    + " while listening — \(healthSuffix(devices: devices))", level: "ERROR")
                onStallChanged?(true, silence)
            }
        } else if buffers > 0 {
            clearStall(logging: true)
        }

        if now - lastHeartbeat >= heartbeatInterval {
            lastHeartbeat = now
            let state = listening ? (stalled ? "listening-but-STALLED" : "listening") : "not listening"
            AppLog.shared.log("audio health: \(state) "
                + "buffers=\(totalBuffers) frames=\(totalFrames) "
                + "peak=\(String(format: "%.4f", localPeak)) "
                + "\(healthSuffix(devices: devices))")
        }
    }

    private func clearStall(logging: Bool) {
        guard stalled else { return }
        stalled = false
        isStalled = false
        if logging {
            AppLog.shared.log("audio recovered — buffers are arriving again")
        }
        onStallChanged?(false, 0)
    }

    private func healthSuffix(devices: [InputDevice]) -> String {
        var parts: [String] = []
        if let format = activeFormat {
            parts.append("tapFormat=\(Int(format.sampleRate))Hz/\(format.channelCount)ch")
        }
        parts.append(Self.describe(devices))
        return parts.joined(separator: " ")
    }

    /// One line describing what the app currently believes about the capture
    /// path. Logged at every sleep, wake and configuration change, so the log
    /// carries the before/after around each transition rather than only the
    /// transition itself.
    func snapshotLine() -> String {
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        let last = lastBufferUptime
        lock.unlock()
        let silence = last.map { String(format: "%.1fs ago", now - $0) } ?? "never"
        return "audio snapshot: lastBuffer=\(silence) totalBuffers=\(totalBuffers) "
            + healthSuffix(devices: Self.inputDevices())
    }

    // MARK: the CoreAudio HAL
    //
    // Property reads only. None of this opens the device or touches an
    // AVAudioEngine, which is what makes it safe to run every few seconds
    // forever: building an engine to find out whether a mic is there is how the
    // device gets cycled open and shut, and cycling is what wedges a USB mic.

    struct InputDevice: Equatable {
        var name: String
        var uid: String
        var transport: String
        var sampleRate: Double
        var channels: Int
        var isAlive: Bool
        var isRunningSomewhere: Bool
        var isDefault: Bool
    }

    private static func address(
        _ selector: AudioObjectPropertySelector,
        _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope,
                                   mElement: kAudioObjectPropertyElementMain)
    }

    private static func uint32(_ object: AudioObjectID,
                               _ selector: AudioObjectPropertySelector) -> UInt32? {
        var addr = address(selector)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr
            ? value : nil
    }

    private static func float64(_ object: AudioObjectID,
                                _ selector: AudioObjectPropertySelector) -> Double? {
        var addr = address(selector)
        var value: Float64 = 0
        var size = UInt32(MemoryLayout<Float64>.size)
        return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr
            ? Double(value) : nil
    }

    private static func string(_ object: AudioObjectID,
                               _ selector: AudioObjectPropertySelector) -> String? {
        var addr = address(selector)
        var value: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        let err = withUnsafeMutablePointer(to: &value) { pointer -> OSStatus in
            AudioObjectGetPropertyData(object, &addr, 0, nil, &size, pointer)
        }
        return err == noErr ? (value as String) : nil
    }

    /// Total input channels. Zero means "not an input device" — or an input
    /// device whose stream configuration has gone out from under it.
    private static func inputChannels(_ device: AudioDeviceID) -> Int {
        var addr = address(kAudioDevicePropertyStreamConfiguration,
                           kAudioDevicePropertyScopeInput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr,
              size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, raw) == noErr else {
            return 0
        }
        let list = UnsafeMutableAudioBufferListPointer(
            raw.assumingMemoryBound(to: AudioBufferList.self))
        return list.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    private static func defaultInputDevice() -> AudioDeviceID {
        var addr = address(kAudioHardwarePropertyDefaultInputDevice)
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                         &addr, 0, nil, &size, &device) == noErr else {
            return AudioDeviceID(kAudioObjectUnknown)
        }
        return device
    }

    private static func fourCC(_ value: UInt32) -> String {
        let bytes = [UInt8((value >> 24) & 0xFF), UInt8((value >> 16) & 0xFF),
                     UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)]
        return (String(bytes: bytes, encoding: .macOSRoman) ?? "????")
            .trimmingCharacters(in: .whitespaces)
    }

    /// Every device that exposes input channels, as CoreAudio sees it now.
    static func inputDevices() -> [InputDevice] {
        var addr = address(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr,
              size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0,
                                  count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &ids) == noErr else {
            return []
        }
        let defaultDevice = defaultInputDevice()
        return ids.compactMap { id in
            let channels = inputChannels(id)
            guard channels > 0 else { return nil }
            return InputDevice(
                name: string(id, kAudioObjectPropertyName) ?? "(unnamed)",
                uid: string(id, kAudioDevicePropertyDeviceUID) ?? "(no uid)",
                transport: uint32(id, kAudioDevicePropertyTransportType).map(fourCC) ?? "????",
                sampleRate: float64(id, kAudioDevicePropertyNominalSampleRate) ?? 0,
                channels: channels,
                isAlive: (uint32(id, kAudioDevicePropertyDeviceIsAlive) ?? 0) != 0,
                // True when *any* process has IO running on this device. No
                // buffers arriving while this is true means the running stream
                // is ours and it is dead — as opposed to the device being gone.
                isRunningSomewhere:
                    (uint32(id, kAudioDevicePropertyDeviceIsRunningSomewhere) ?? 0) != 0,
                isDefault: id == defaultDevice)
        }
    }

    private static func describe(_ devices: [InputDevice]) -> String {
        guard !devices.isEmpty else { return "inputs=NONE" }
        let rendered = devices.map { device in
            "\(device.isDefault ? "*" : "")\"\(device.name)\"/\(device.transport)"
                + "/\(Int(device.sampleRate))Hz/\(device.channels)ch"
                + "/alive=\(device.isAlive ? "y" : "n")"
                + "/running=\(device.isRunningSomewhere ? "y" : "n")"
        }
        return "inputs=[\(rendered.joined(separator: " "))]"
    }
}

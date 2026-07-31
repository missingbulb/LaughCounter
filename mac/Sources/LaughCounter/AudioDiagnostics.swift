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
    /// Buffers arriving at the full rate with *every* sample exactly zero for
    /// this long is a dead stream, not a quiet room: a real microphone always
    /// has a noise floor, and this window covers ~350 buffers (~180k
    /// stride-sampled points), so an exact 0.0 across all of them cannot be
    /// silence in front of a live capsule. Judged per five-second sample, so it
    /// is caught in a minute rather than on the ten-minute heartbeat — the
    /// failure it names needs the owner to go and unplug something. (#88)
    private let noSignalThreshold: TimeInterval = 60
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
    /// Start of the current unbroken run of all-zero buffers (`systemUptime`),
    /// or nil if the last sample carried signal. Judged per sample rather than
    /// against `intervalPeak`, which spans the whole heartbeat and would smear
    /// one laugh across ten minutes of dead stream.
    private var zeroSince: TimeInterval?
    /// Start of the current unbroken run of "CoreAudio is offering an input
    /// device we could actually open" (`systemUptime`), nil if it is not.
    private var usableInputSince: TimeInterval?
    /// Whether we actually *saw* the current input device arrive, as opposed to
    /// finding it already there when sampling began. Only a witnessed arrival
    /// can be mid-enumeration from our point of view, so only a witnessed
    /// arrival has a settle time worth waiting out.
    private var witnessedArrival = false
    private var lastHeartbeat: TimeInterval = 0
    private var lastDevices: [InputDevice] = []
    private var activeFormat: AVAudioFormat?
    /// Cumulative across the process, for the heartbeat line — the per-sample
    /// counters are reset every tick.
    private var totalBuffers = 0
    private var totalFrames = 0
    /// Loudest sample seen since the last heartbeat. Spans the heartbeat
    /// interval so every number on that line describes the same window.
    private var intervalPeak: Float = 0

    /// What the capture path is *doing*, as distinct from what the app believes
    /// it is doing. `listening` only ever meant `engine.start()` returned, so it
    /// is true in all three of these states.
    enum Health: Equatable {
        /// Buffers arriving, carrying audio.
        case ok
        /// No buffers at all. The device went away, or the stream is dead.
        case stalled
        /// Buffers arriving at the full rate, every sample exactly zero: the
        /// device is enumerated and streaming, but not capturing. Measured once
        /// (#88) and it survived process exit *and* a coreaudiod restart — only
        /// physically re-plugging the microphone cleared it, so there is nothing
        /// this process can do about it beyond saying so.
        case noSignal
    }

    /// "The app believes it is capturing." Supplied by `AppDelegate`; without it
    /// a stall is meaningless, since no buffers is correct when paused.
    var isListening: (() -> Bool)?
    /// Fired on main whenever `health` changes. Lets the menu bar stop claiming
    /// to listen while the capture path is not actually delivering audio.
    var onHealthChanged: ((Health) -> Void)?

    /// What the capture path is currently believed to be doing. Main-thread only.
    private(set) var health: Health = .ok

    /// How long CoreAudio has *continuously* been offering an input device we
    /// could actually open, or nil if it is not offering one at all.
    ///
    /// This exists so nothing else has to build an `AVAudioEngine` to find out
    /// whether a microphone is there. Materializing `inputNode` opens the
    /// default input **and mints a hidden per-client aggregate device inside
    /// coreaudiod**, so asking that way costs a device open plus an aggregate
    /// create/destroy every time — which the retry ladder was doing once a
    /// minute, ~210 times over one 3h40m outage. This answer is already being
    /// computed every five seconds out of pure HAL property reads that never
    /// open anything, so the expensive way to ask was never buying information
    /// we didn't have. (#88)
    ///
    /// The *duration* rather than a bool because "it is there" and "it has
    /// finished arriving" are different claims: a USB mic is enumerating for a
    /// while after it first appears in the HAL, and opening one mid-enumeration
    /// is the other half of the same suspicion.
    ///
    /// A device that was **already present when we started watching** reports
    /// `.greatestFiniteMagnitude`, i.e. "settled, as far as anyone can tell".
    /// "It appeared N seconds ago" is a claim that can only be made about an
    /// arrival we witnessed; a mic that was there before this process existed
    /// has been there for however long the Mac has been up, and there is no
    /// enumeration race to lose. Measuring from first *observation* instead made
    /// every launch refuse for ~19s and look like the app hadn't started. (#100 follow-up)
    var usableInputFor: TimeInterval? {
        guard let since = usableInputSince else { return nil }
        guard witnessedArrival else { return .greatestFiniteMagnitude }
        return ProcessInfo.processInfo.systemUptime - since
    }

    // MARK: lifecycle

    /// Begin sampling. Main-thread only; safe to call twice.
    func start() {
        guard timer == nil else { return }
        lastHeartbeat = ProcessInfo.processInfo.systemUptime
        lastDevices = Self.inputDevices()
        // Seed the availability probe from this first look, because the timer
        // below does not fire until `sampleInterval` has elapsed — so without
        // this, `usableInputFor` is nil for the app's first five seconds and the
        // start path refuses on a microphone that is sitting right there. Not a
        // witnessed arrival: whatever is present now predates us. (#100 follow-up)
        if Self.hasUsableInput(lastDevices) {
            usableInputSince = ProcessInfo.processInfo.systemUptime
            witnessedArrival = false
        }
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
        resetHealth()
    }

    /// Capture stopped on purpose. Clears the stall clock so an intentional stop
    /// is never reported as a stall.
    func noteCaptureStopped(reason: String) {
        activeFormat = nil
        lock.lock()
        lastBufferUptime = nil
        lock.unlock()
        resetHealth()
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
        // Peak must span the whole heartbeat interval, not the last five-second
        // sample. Reported beside cumulative buffers/frames, a five-second peak
        // reads as if it covered the same span — so a laugh mid-interval could
        // be followed by a quiet moment and the line would report near-silence.
        intervalPeak = max(intervalPeak, localPeak)

        let silence = last.map { now - $0 }
        let listening = isListening?() ?? false

        // Device changes are logged whenever they are seen: the set changing
        // under a running engine is the event that precedes most failures here,
        // and CoreAudio's own notification is suppressed around our restarts.
        let devices = Self.inputDevices()
        if devices != lastDevices {
            // Two very different events wear the same diff, and conflating them
            // would bury the one that matters. A device appearing or vanishing
            // (or changing rate/channels/alive) is a hardware event worth a
            // WARN. `isRunningSomewhere` flipping is usually just us starting or
            // stopping capture — informative, but not an alarm. Observed
            // immediately in the field: the first restart after launch logged
            // "input devices changed" as a WARN when nothing had changed but our
            // own IO state.
            let changed = Self.identities(devices) != Self.identities(lastDevices)
            AppLog.shared.log(
                (changed ? "input devices changed — " : "input IO state changed — ")
                    + Self.describe(devices),
                level: changed ? "WARN" : "INFO")
            lastDevices = devices
        }

        // Track how long a genuinely openable input has been on offer, so the
        // start path can consult this instead of opening a device to find out.
        if Self.hasUsableInput(devices) {
            if usableInputSince == nil {
                // An arrival we watched happen — this one gets a settle window.
                usableInputSince = now
                witnessedArrival = true
            }
        } else {
            usableInputSince = nil
            witnessedArrival = false
        }

        // Extend or break the run of digital silence. Only judged when buffers
        // actually arrived: a sample with none says nothing about signal, and
        // treating it as either would make a stall look like a recovery.
        if listening, buffers > 0 {
            if localPeak > 0 {
                zeroSince = nil
            } else if zeroSince == nil {
                zeroSince = now
            }
        }

        // Stall outranks no-signal — with no buffers at all there is nothing to
        // judge the samples of, and "the stream stopped" is the more specific
        // claim. They are mutually exclusive in practice for the same reason.
        let next: Health
        if listening, let silence = silence, silence >= stallThreshold {
            next = .stalled
        } else if listening, let zeroSince = zeroSince,
                  now - zeroSince >= noSignalThreshold {
            next = .noSignal
        } else {
            next = .ok
        }
        setHealth(next, silence: silence, zeroFor: zeroSince.map { now - $0 },
                  devices: devices)

        if now - lastHeartbeat >= heartbeatInterval {
            lastHeartbeat = now
            var state = "not listening"
            if listening {
                switch health {
                case .ok:       state = "listening"
                case .stalled:  state = "listening-but-STALLED"
                case .noSignal: state = "listening-but-SILENT"
                }
            }
            AppLog.shared.log("audio health: \(state) "
                + "buffers=\(totalBuffers) frames=\(totalFrames) "
                + "peak=\(String(format: "%.4f", intervalPeak)) "
                + "\(healthSuffix(devices: devices))")
            intervalPeak = 0
        }
    }

    /// The one place a health transition is logged and published, so the log and
    /// the menu bar can never disagree about it. Logs on the *transition* only:
    /// the previous no-signal check was bolted to the heartbeat and repeated an
    /// identical ERROR every ten minutes for as long as the failure lasted,
    /// which is the line-a-minute noise this class is meant to avoid.
    private func setHealth(_ next: Health, silence: TimeInterval?,
                           zeroFor: TimeInterval?, devices: [InputDevice]) {
        guard next != health else { return }
        let previous = health
        health = next
        switch next {
        case .stalled:
            AppLog.shared.log("AUDIO STALL: no buffers for "
                + String(format: "%.0fs", silence ?? 0)
                + " while listening — \(healthSuffix(devices: devices))", level: "ERROR")
        case .noSignal:
            AppLog.shared.log("NO SIGNAL: buffers arriving at the normal rate for "
                + String(format: "%.0fs", zeroFor ?? 0)
                + " with every sample exactly zero — the microphone is enumerated but "
                + "not capturing. Unplugging it and reconnecting it is the only known "
                + "fix; quitting this app and restarting coreaudiod both leave it in "
                + "this state — \(healthSuffix(devices: devices))", level: "ERROR")
        case .ok:
            AppLog.shared.log(previous == .stalled
                ? "audio recovered — buffers are arriving again"
                : "audio recovered — the stream is carrying signal again")
        }
        onHealthChanged?(next)
    }

    /// Capture started or stopped on purpose: drop back to `.ok` without logging
    /// a recovery, because nothing recovered — we simply started or stopped.
    private func resetHealth() {
        zeroSince = nil
        guard health != .ok else { return }
        health = .ok
        onHealthChanged?(.ok)
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

    /// Is any of these a device we could actually open and capture from?
    ///
    /// Three requirements, and the last two are the ones that bite:
    ///
    /// - **Not an aggregate.** `CADefaultDeviceAggregate-<pid>-<n>` is the
    ///   hidden per-client device coreaudiod mints for *us* when we open the
    ///   default input. Counting it would make the probe report a usable input
    ///   because we already opened one — true and useless.
    /// - **A sane format, not mere presence.** Mid-teardown an input lists as
    ///   `"(unnamed)"/????/0Hz/2ch/alive=y`: readable enough to enumerate and
    ///   impossible to capture from. A probe that accepts presence waves
    ///   through starts that cannot succeed — the same trap `outputFormat` set
    ///   one layer up. (#79)
    /// - **Alive**, which is the cheap part and the only one anyone remembers.
    private static func hasUsableInput(_ devices: [InputDevice]) -> Bool {
        let aggregate = fourCC(UInt32(kAudioDeviceTransportTypeAggregate))
        return devices.contains {
            $0.isAlive && $0.sampleRate > 0 && $0.channels > 0
                && $0.transport != aggregate
        }
    }

    /// Everything about the input device set *except* whether IO is running on
    /// it — i.e. the part that changing means the hardware changed under us,
    /// rather than us having started or stopped capturing.
    private static func identities(_ devices: [InputDevice]) -> [String] {
        devices.map {
            "\($0.uid)|\($0.name)|\($0.transport)|\($0.sampleRate)|\($0.channels)"
                + "|\($0.isAlive)|\($0.isDefault)"
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

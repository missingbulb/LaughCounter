#!/usr/bin/env swift
//
// mic-probe.swift — a snapshot of what CoreAudio currently thinks of the input
// device. Run it when the mic looks dead (see `diagnose-mic.sh`, which calls it).
//
// It queries the HAL directly rather than going through AVAudioEngine, because
// HAL property reads are **not** TCC-gated: they report the truth even from a
// Terminal that was never granted microphone access. The AVAudioEngine section
// at the end *is* gated, and says so.
//
// The single most useful line it prints is `IsRunningSomewhere`. That is true
// when some process still has an IOProc running on the device — which is
// exactly the wedge state this project keeps chasing (a process that died with
// its tap installed leaves the IOProc registered and the mic goes silent for
// everyone until it is re-plugged). If the device is alive, has input channels,
// and `IsRunningSomewhere` is true while LaughCounter is *not* listening,
// something is holding the device that shouldn't be.
//
// Usage:
//   swift mic-probe.swift             # read-only: no tap, no capture
//   swift mic-probe.swift --capture   # additionally record ~3s and report peak
//
// --capture installs a real input tap, so it is opt-in: a probe that crashed
// with a tap installed would cause the very wedge we're diagnosing. The capture
// path tears the tap and engine down on every exit.

import AVFoundation
import CoreAudio

// MARK: - HAL helpers

func address(_ selector: AudioObjectPropertySelector,
             _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
        -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector,
                               mScope: scope,
                               mElement: kAudioObjectPropertyElementMain)
}

func getUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
               _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32? {
    var addr = address(selector, scope)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    let err = AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value)
    return err == noErr ? value : nil
}

func getFloat64(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector,
                _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> Float64? {
    var addr = address(selector, scope)
    var value: Float64 = 0
    var size = UInt32(MemoryLayout<Float64>.size)
    let err = AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value)
    return err == noErr ? value : nil
}

func getString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let err = withUnsafeMutablePointer(to: &value) { pointer -> OSStatus in
        AudioObjectGetPropertyData(object, &addr, 0, nil, &size, pointer)
    }
    return err == noErr ? (value as String) : nil
}

func allDevices() -> [AudioDeviceID] {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else {
        return []
    }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

/// Total input channels the device exposes. Zero means "not an input device"
/// — or an input device whose stream configuration has gone away under us.
func inputChannels(_ device: AudioDeviceID) -> Int {
    var addr = address(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else {
        return 0
    }
    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, raw) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func fourCC(_ value: UInt32) -> String {
    let bytes = [UInt8((value >> 24) & 0xFF), UInt8((value >> 16) & 0xFF),
                 UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)]
    let text = String(bytes: bytes, encoding: .macOSRoman) ?? "????"
    return text.trimmingCharacters(in: .whitespaces)
}

func yesNo(_ value: UInt32?) -> String {
    guard let value = value else { return "unreadable" }
    return value != 0 ? "YES" : "no"
}

// MARK: - Report

print("=== mic-probe ===")
print("time: \(ISO8601DateFormatter().string(from: Date()))")

var defaultAddr = address(kAudioHardwarePropertyDefaultInputDevice)
var defaultInput = AudioDeviceID(0)
var defaultSize = UInt32(MemoryLayout<AudioDeviceID>.size)
let defaultErr = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject), &defaultAddr, 0, nil, &defaultSize, &defaultInput)
if defaultErr != noErr {
    print("default input device: UNREADABLE (OSStatus \(defaultErr))")
} else if defaultInput == kAudioObjectUnknown {
    print("default input device: NONE — the system has no input device at all")
} else {
    print("default input device: id=\(defaultInput) "
        + "\(getString(defaultInput, kAudioObjectPropertyName) ?? "(unnamed)")")
}

print("")
print("--- input devices ---")
for device in allDevices() {
    let channels = inputChannels(device)
    guard channels > 0 else { continue }
    let name = getString(device, kAudioObjectPropertyName) ?? "(unnamed)"
    let uid = getString(device, kAudioDevicePropertyDeviceUID) ?? "(no uid)"
    let transport = getUInt32(device, kAudioDevicePropertyTransportType).map(fourCC) ?? "????"
    let rate = getFloat64(device, kAudioDevicePropertyNominalSampleRate,
                          kAudioDevicePropertyScopeInput)
        ?? getFloat64(device, kAudioDevicePropertyNominalSampleRate) ?? 0
    // IsAlive: the device object still backs real hardware.
    let alive = getUInt32(device, kAudioDevicePropertyDeviceIsAlive, kAudioDevicePropertyScopeInput)
        ?? getUInt32(device, kAudioDevicePropertyDeviceIsAlive)
    // IsRunningSomewhere: *any* process on the system has IO running on it.
    // True with LaughCounter stopped == something is holding the device.
    let runningSomewhere = getUInt32(device, kAudioDevicePropertyDeviceIsRunningSomewhere)
    // IsRunning: this process has IO running on it (always no here).
    let running = getUInt32(device, kAudioDevicePropertyDeviceIsRunning)
    let isDefault = device == defaultInput ? "  <== DEFAULT INPUT" : ""
    print("\(name)\(isDefault)")
    print("    id=\(device) uid=\(uid) transport=\(transport)")
    print("    inputChannels=\(channels) nominalRate=\(Int(rate))Hz")
    print("    IsAlive=\(yesNo(alive)) IsRunningSomewhere=\(yesNo(runningSomewhere)) "
        + "IsRunning(this process)=\(yesNo(running))")
}

// MARK: - The app's own view

// This is the pair AudioHub.validatedFormat() checks. inputFormat is the
// hardware format installTap asserts against; outputFormat is the bus format,
// which keeps reporting a plausible rate after the device is torn down. If
// inputFormat reads 0 here while the HAL section above shows a live device with
// input channels, the app's view of the mic is broken while the mic is fine.
print("")
print("--- AVAudioEngine view (TCC-gated: needs mic access for THIS terminal) ---")
switch AVCaptureDevice.authorizationStatus(for: .audio) {
case .authorized:   print("microphone authorization: authorized")
case .denied:       print("microphone authorization: DENIED — formats below may read 0 for that reason alone")
case .restricted:   print("microphone authorization: restricted")
case .notDetermined: print("microphone authorization: not determined (a prompt may appear)")
@unknown default:   print("microphone authorization: unknown")
}

let engine = AVAudioEngine()
let input = engine.inputNode   // materializes + attaches the node; required before prepare()
engine.prepare()
let hardware = input.inputFormat(forBus: 0)
let bus = input.outputFormat(forBus: 0)
print("inputFormat  (hardware): \(Int(hardware.sampleRate))Hz / \(hardware.channelCount)ch")
print("outputFormat (bus):      \(Int(bus.sampleRate))Hz / \(bus.channelCount)ch")
if hardware.sampleRate == 0 {
    print(">>> hardware format is 0 — this is the state in which LaughCounter refuses to start")
} else if hardware.sampleRate != bus.sampleRate || hardware.channelCount != bus.channelCount {
    print(">>> formats DISAGREE — this is the state that raises inside installTap")
}
engine.stop()

// MARK: - Optional capture

if CommandLine.arguments.contains("--capture") {
    print("")
    print("--- capture test (3s) ---")
    if AVCaptureDevice.authorizationStatus(for: .audio) != .authorized {
        print("skipped: this terminal does not have microphone access")
    } else if hardware.sampleRate == 0 {
        print("skipped: no hardware format, a tap here would raise")
    } else {
        // Everything is torn down before returning: a probe that exits with a
        // tap installed would leave the IOProc registered — the exact wedge
        // this script exists to detect.
        let captureEngine = AVAudioEngine()
        let captureInput = captureEngine.inputNode
        captureEngine.prepare()
        let format = captureInput.inputFormat(forBus: 0)
        var peak: Float = 0
        var buffers = 0
        var frames = 0
        captureInput.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            buffers += 1
            frames += Int(buffer.frameLength)
            guard let channel = buffer.floatChannelData?[0] else { return }
            for index in 0..<Int(buffer.frameLength) {
                peak = max(peak, abs(channel[index]))
            }
        }
        do {
            try captureEngine.start()
            RunLoop.current.run(until: Date().addingTimeInterval(3))
        } catch {
            print("engine.start() failed: \(error.localizedDescription)")
        }
        captureInput.removeTap(onBus: 0)
        captureEngine.stop()
        print("format: \(Int(format.sampleRate))Hz / \(format.channelCount)ch")
        print("buffers=\(buffers) frames=\(frames) peak=\(String(format: "%.5f", peak))")
        if buffers == 0 {
            print(">>> NO buffers arrived — the engine ran but delivered nothing")
        } else if peak == 0 {
            print(">>> buffers arrived but every sample is ZERO — the stream is silent, "
                + "not stopped (make some noise and re-run to be sure)")
        }
    }
}

print("")
print("=== end mic-probe ===")

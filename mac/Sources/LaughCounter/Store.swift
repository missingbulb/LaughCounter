import AppKit
import Foundation

/// Appends laugh events to a JSONL log under
/// `~/Library/Application Support/LaughCounter/laughs.jsonl`.
///
/// Same greppable spirit as the Python reference. Fields are written in a **fixed
/// order** every line (`start_iso, label, start, end, peak, duration, mean,
/// source`, then `type`/`context` when present) so the log diffs cleanly and is
/// easy to eyeball — `JSONSerialization` can't guarantee key order, so we render
/// the JSON ourselves. Confidence values are rounded (they carry no meaning past a
/// couple of decimals). No audio is stored — only metadata.
final class LaughStore {
    private let directory: URL
    let fileURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask)[0]
        directory = base.appendingPathComponent("LaughCounter", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory,
                                                 withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("laughs.jsonl")
    }

    /// Log a detected laugh.
    func append(_ event: LaughEvent, source: String = "mic", label: String = "auto") {
        var fields: [(String, JSON)] = [
            ("start_iso", .str(Self.iso(event.start))),
            ("label", .str(label)),
            ("start", .num(round3(event.start))),
            ("end", .num(round3(event.end))),
            ("peak", .num(round2(event.peak))),
            ("duration", .num(round2(event.duration))),
            ("mean", .num(round2(event.mean))),
            ("source", .str(source)),
            ("origin", .str(event.origin)),
            ("tv_signal", .num(round2(event.tvSignal))),
            ("origin_reason", .str(event.originReason)),
        ]
        if !event.type.isEmpty {
            fields.append(("type", .str(event.type)))
        }
        if !event.context.isEmpty {
            fields.append(("context", .arr(event.context.map { c in
                JSON.obj([("label", .str(c.label)), ("confidence", .num(round2(c.confidence)))])
            })))
        }
        write(JSON.obj(fields))
    }

    /// Log a laugh you told us we missed. `source` distinguishes the spoken
    /// command (`"voice"`) from a menu/keyboard click (`"button"`).
    func appendMissed(source: String = "voice") {
        let now = Date().timeIntervalSince1970
        // A miss you reported is, by definition, you.
        append(LaughEvent(start: now - 0.5, end: now, duration: 0.5,
                          peak: 0, mean: 0, type: "", context: [],
                          origin: "me", originReason: "you reported it", tvSignal: 0),
               source: source, label: "missed")
    }

    /// Count today's counted laughs (excludes candidates/rejects). Pass `origin`
    /// ("me" or "tv") to count just that bucket; omit for the total.
    func todayCount(origin: String? = nil) -> Int {
        guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { return 0 }
        let calendar = Calendar.current
        var count = 0
        for line in content.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let start = obj["start"] as? Double else { continue }
            // Candidates (sub-threshold, logged for alignment) and rejects don't count.
            if let label = obj["label"] as? String, label == "rejected" || label == "candidate" {
                continue
            }
            // Older entries predate attribution; treat a missing origin as "me".
            if let origin = origin, (obj["origin"] as? String ?? "me") != origin {
                continue
            }
            if calendar.isDateInToday(Date(timeIntervalSince1970: start)) { count += 1 }
        }
        return count
    }

    func revealInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }

    // MARK: - JSON with guaranteed field order

    private func write(_ json: JSON) {
        let line = json.encoded() + "\n"
        guard let bytes = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: fileURL) {
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            handle.write(bytes)
        } else {
            try? bytes.write(to: fileURL)
        }
    }

    private static func iso(_ epoch: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: Date(timeIntervalSince1970: epoch))
    }
}

private func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }
private func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }

/// A minimal ordered-JSON value, so object keys serialise in insertion order
/// (unlike `[String: Any]` + `JSONSerialization`).
private indirect enum JSON {
    case str(String)
    case num(Double)
    case obj([(String, JSON)])
    case arr([JSON])

    func encoded() -> String {
        switch self {
        case .str(let s): return JSON.encodeString(s)
        case .num(let d): return JSON.encodeNumber(d)
        case .obj(let pairs):
            return "{" + pairs.map { "\(JSON.encodeString($0.0)):\($0.1.encoded())" }
                .joined(separator: ",") + "}"
        case .arr(let items):
            return "[" + items.map { $0.encoded() }.joined(separator: ",") + "]"
        }
    }

    private static func encodeNumber(_ d: Double) -> String {
        guard d.isFinite else { return "0" }
        // Whole numbers as integers (0 not 0.0); Swift's String(Double) already
        // gives the shortest round-trippable form for the rest (0.63, not 0.6300…).
        if d == d.rounded() && abs(d) < 1e15 { return String(Int64(d)) }
        return String(d)
    }

    private static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}

import AppKit
import Foundation

/// Appends laugh events to a JSONL log under
/// `~/Library/Application Support/LaughCounter/laughs.jsonl`.
///
/// Same simple, greppable format as the Python reference, so the two are
/// interchangeable. No audio is stored — only metadata.
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
        write([
            "start": event.start,
            "end": event.end,
            "duration": event.duration,
            "peak": event.peak,
            "mean": event.mean,
            "source": source,
            "label": label,
            "start_iso": ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: event.start)),
        ])
    }

    /// Log a laugh you told us we missed (via voice command or the menu).
    func appendMissed(source: String = "voice") {
        let now = Date().timeIntervalSince1970
        append(LaughEvent(start: now - 0.5, end: now, duration: 0.5, peak: 0, mean: 0),
               source: source, label: "missed")
    }

    func todayCount() -> Int {
        guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { return 0 }
        let calendar = Calendar.current
        var count = 0
        for line in content.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let start = obj["start"] as? Double else { continue }
            if (obj["label"] as? String) == "rejected" { continue }
            if calendar.isDateInToday(Date(timeIntervalSince1970: start)) { count += 1 }
        }
        return count
    }

    func revealInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }

    private func write(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        guard let bytes = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: fileURL) {
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            handle.write(bytes)
        } else {
            try? bytes.write(to: fileURL)
        }
    }
}

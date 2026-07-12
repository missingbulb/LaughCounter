import Foundation

/// A tiny **operational** log — separate from `laughs.jsonl` — so that "the
/// service stopped" is self-diagnosing instead of invisible. It records lifecycle
/// events (started / stopped / slept / woke / reconfigured) and errors, one line
/// per event as `ISO8601␠␠LEVEL␠␠message`, to
/// `~/Library/Application Support/LaughCounter/laughcounter.log`.
///
/// Writes are serialised on a private queue and the file is rotated once when it
/// passes ~1 MB, so it can never grow without bound. Everything is also mirrored
/// to `NSLog` so it still shows up in Console.app.
final class AppLog {
    static let shared = AppLog()

    let fileURL: URL
    private let queue = DispatchQueue(label: "com.laughcounter.applog")
    private let maxBytes: UInt64 = 1_000_000
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("LaughCounter", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("laughcounter.log")
    }

    func log(_ message: String, level: String = "INFO") {
        NSLog("LaughCounter: %@", message)
        let stamp = iso.string(from: Date())
        queue.async { [weak self] in
            guard let self = self,
                  let data = "\(stamp)  \(level)  \(message)\n".data(using: .utf8) else { return }
            self.rotateIfNeeded()
            if let handle = try? FileHandle(forWritingTo: self.fileURL) {
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)
            } else {
                try? data.write(to: self.fileURL)
            }
        }
    }

    /// Rotate `laughcounter.log` → `laughcounter.1.log` once it passes `maxBytes`,
    /// keeping exactly one previous file. Called on the write queue.
    private func rotateIfNeeded() {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let size = attrs[.size] as? UInt64, size > maxBytes else { return }
        let rotated = fileURL.deletingPathExtension().appendingPathExtension("1.log")
        try? FileManager.default.removeItem(at: rotated)
        try? FileManager.default.moveItem(at: fileURL, to: rotated)
    }
}

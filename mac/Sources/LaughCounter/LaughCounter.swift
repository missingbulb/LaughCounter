import Foundation

/// One episode of detected laughter (not a single frame — a whole laugh).
struct LaughEvent {
    let start: Double   // epoch seconds
    let end: Double
    let duration: Double
    let peak: Double
    let mean: Double
}

/// Turns a stream of per-frame laughter *confidence* values into discrete
/// laughs, using the same hysteresis state machine as the Python reference:
///
/// * start when confidence rises to `enterThreshold`,
/// * keep going while it stays above the lower `exitThreshold` (hysteresis),
/// * bridge silences shorter than `mergeGap` (a fit of giggles = one laugh),
/// * only record episodes lasting at least `minDuration`.
///
/// Deterministic and I/O-free, so its behaviour matches the tested Python core.
final class LaughCounter {
    var enterThreshold = 0.5
    var exitThreshold = 0.3
    var minDuration = 0.4
    var mergeGap = 1.0
    var frameSeconds = 0.5   // ~how often SoundAnalysis emits a result

    /// Called (on the caller's thread) when a laugh episode is finalised.
    var onLaugh: ((LaughEvent) -> Void)?

    private var start: Double?
    private var lastActive = 0.0
    private var peak = 0.0
    private var sum = 0.0
    private var n = 0
    private var lastTs: Double?

    func update(timestamp ts: Double, score: Double) {
        if let last = lastTs, ts < last { return }  // ignore backward time
        lastTs = ts

        let loud = score >= enterThreshold
        let soft = score >= exitThreshold

        // Close a stale episode first, regardless of this frame's loudness, so a
        // laugh resuming after a > mergeGap silence is a new laugh, not a merge.
        if start != nil && ts - lastActive > mergeGap {
            finalizeEpisode()
        }

        if start == nil {
            if loud { begin(ts, score) }
        } else if soft {
            extend(ts, score)
        }
    }

    /// Finalise any episode still open (e.g. on shutdown).
    func flush() {
        if start != nil { finalizeEpisode() }
    }

    private func begin(_ ts: Double, _ score: Double) {
        start = ts; lastActive = ts; peak = score; sum = score; n = 1
    }

    private func extend(_ ts: Double, _ score: Double) {
        lastActive = ts; peak = max(peak, score); sum += score; n += 1
    }

    private func finalizeEpisode() {
        guard let s = start else { return }
        let end = lastActive + frameSeconds
        let duration = end - s
        if duration >= minDuration {
            onLaugh?(LaughEvent(start: s, end: end, duration: duration,
                                peak: peak, mean: n > 0 ? sum / Double(n) : 0))
        }
        start = nil; lastActive = 0; peak = 0; sum = 0; n = 0
    }
}

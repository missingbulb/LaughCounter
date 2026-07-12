import Foundation

/// A competing (non-laugh) sound class and its confidence, kept for TV
/// de-confliction and false-positive debugging.
struct ContextScore {
    let label: String
    let confidence: Double
}

/// One episode of detected laughter (not a single frame — a whole laugh).
struct LaughEvent {
    let start: Double   // epoch seconds
    let end: Double
    let duration: Double
    let peak: Double
    let mean: Double
    let type: String            // which laugh class dominated ("" if unknown)
    let context: [ContextScore] // top non-laugh classes heard during the episode
}

/// One analysed window handed to the counter. Carries the *real* audio timing
/// (from `SNClassificationResult.timeRange`) plus the winning laugh class and the
/// strongest TV-context class, so durations are accurate and TV audio can be told
/// apart from a person laughing in the room.
struct LaughObservation {
    let time: Double            // epoch seconds of the window start (real audio time)
    let windowDuration: Double  // real window length from SoundAnalysis
    let laughScore: Double      // max confidence across laugh classes
    let laughType: String       // which laugh class won ("" if none)
    let contextScore: Double    // max confidence across TV-context classes
    let contextLabel: String    // which TV-context class was strongest
    let context: [ContextScore] // a few top non-laugh classes (for logging)
}

/// Turns a stream of per-window observations into discrete laughs, using a
/// hysteresis state machine:
///
/// * start when confidence rises to `enterThreshold`,
/// * keep going while it stays above the lower `exitThreshold` (hysteresis),
/// * bridge silences shorter than `mergeGap` (a fit of giggles = one laugh),
/// * only record episodes lasting at least `minDuration`.
///
/// Episode length comes from the observations' real window bounds, so a laugh
/// that spans several windows reports its true duration instead of a fixed 0.5s.
/// Deterministic and I/O-free.
final class LaughCounter {
    var enterThreshold = 0.5
    var exitThreshold = 0.3
    var minDuration = 0.4
    var mergeGap = 1.0
    var frameSeconds = 0.5   // fallback window length if the API doesn't supply one

    /// TV de-confliction: suppress an episode when the strongest TV-context class
    /// in it is at least this fraction of the episode's peak laughter confidence.
    /// `1.0` (the default) is conservative — TV context must *out-score* the laugh
    /// before it's discarded; lower it to filter more aggressively.
    var tvContextRatio = 1.0

    /// Called (on the caller's thread) when a laugh episode is finalised and kept.
    var onLaugh: ((LaughEvent) -> Void)?
    /// Called when an episode was discarded as TV/laugh-track audio. The second
    /// argument is a human-readable reason for the operational log.
    var onSuppressed: ((LaughEvent, String) -> Void)?

    private var start: Double?
    private var lastActive = 0.0
    private var lastWindow = 0.5
    private var peak = 0.0
    private var sum = 0.0
    private var n = 0
    private var peakType = ""
    private var peakContext = 0.0
    private var peakContextLabel = ""
    private var contextAgg: [String: Double] = [:]
    private var lastTs: Double?

    func update(_ obs: LaughObservation) {
        if let last = lastTs, obs.time < last { return }  // ignore backward time
        lastTs = obs.time

        let loud = obs.laughScore >= enterThreshold
        let soft = obs.laughScore >= exitThreshold

        // Close a stale episode first, regardless of this window's loudness, so a
        // laugh resuming after a > mergeGap silence is a new laugh, not a merge.
        if start != nil && obs.time - lastActive > mergeGap {
            finalizeEpisode()
        }

        if start == nil {
            if loud { begin(obs) }
        } else if soft {
            extend(obs)
        }
    }

    /// Finalise any episode still open (e.g. on shutdown or before a pause).
    func flush() {
        if start != nil { finalizeEpisode() }
    }

    /// Drop all state, including the stream clock — call when (re)starting the
    /// audio stream so the new stream's timestamps aren't rejected as "backward".
    func reset() {
        resetEpisode()
        lastTs = nil
    }

    private func begin(_ o: LaughObservation) {
        start = o.time; lastActive = o.time; lastWindow = o.windowDuration
        peak = o.laughScore; sum = o.laughScore; n = 1; peakType = o.laughType
        peakContext = o.contextScore; peakContextLabel = o.contextLabel
        contextAgg = [:]; accumulateContext(o)
    }

    private func extend(_ o: LaughObservation) {
        lastActive = o.time; lastWindow = o.windowDuration
        if o.laughScore > peak { peak = o.laughScore; peakType = o.laughType }
        sum += o.laughScore; n += 1
        if o.contextScore > peakContext { peakContext = o.contextScore; peakContextLabel = o.contextLabel }
        accumulateContext(o)
    }

    private func accumulateContext(_ o: LaughObservation) {
        for c in o.context {
            contextAgg[c.label] = max(contextAgg[c.label] ?? 0, c.confidence)
        }
    }

    private func finalizeEpisode() {
        guard let s = start else { return }
        let end = lastActive + (lastWindow > 0 ? lastWindow : frameSeconds)
        let duration = end - s
        let capturedPeak = peak, capturedContext = peakContext, capturedLabel = peakContextLabel
        let event = LaughEvent(
            start: s, end: end, duration: duration,
            peak: peak, mean: n > 0 ? sum / Double(n) : 0,
            type: peakType,
            context: contextAgg.sorted { $0.value > $1.value }.prefix(3)
                .map { ContextScore(label: $0.key, confidence: $0.value) })
        resetEpisode()

        guard duration >= minDuration else { return }
        if capturedContext > 0 && capturedContext >= capturedPeak * tvContextRatio {
            let reason = String(format: "tv-context %@=%.2f >= laugh=%.2f",
                                capturedLabel.isEmpty ? "?" : capturedLabel,
                                capturedContext, capturedPeak)
            onSuppressed?(event, reason)
        } else {
            onLaugh?(event)
        }
    }

    private func resetEpisode() {
        start = nil; lastActive = 0; lastWindow = frameSeconds
        peak = 0; sum = 0; n = 0; peakType = ""
        peakContext = 0; peakContextLabel = ""; contextAgg = [:]
    }
}

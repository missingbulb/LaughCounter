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
    let origin: String          // hypothesis about the source: "me" | "tv"
    let originReason: String    // human-readable why, for the activity log
    let tvSignal: Double        // strongest produced-audio context confidence (0…1)
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
/// * start tracking when confidence rises to `enterThreshold`,
/// * keep going while it stays above the lower `exitThreshold` (hysteresis),
/// * bridge silences shorter than `mergeGap` (a fit of giggles = one laugh),
/// * only record episodes lasting at least `minDuration`.
///
/// An episode is **counted** as a real laugh only if its peak confidence reaches
/// `countThreshold`. Episodes that clear the lower `enterThreshold` but not
/// `countThreshold` are emitted as **candidates** (`onCandidate`) — logged for
/// later analysis / threshold tuning, but not counted.
///
/// Episode length comes from the observations' real window bounds, so a laugh
/// that spans several windows reports its true duration instead of a fixed 0.5s.
/// Deterministic and I/O-free.
final class LaughCounter {
    /// Peak confidence an episode must reach to be *counted* as a real laugh.
    var countThreshold = 0.5
    /// Lower bar at which we start tracking an episode at all. Deliberately low so
    /// near-misses are logged as candidates too — later "I laughed" feedback can be
    /// aligned against a nearby low-confidence event instead of nothing.
    var enterThreshold = 0.15
    /// Hysteresis exit — an open episode stays open while confidence holds above this.
    var exitThreshold = 0.1
    var minDuration = 0.4
    // Bridge gaps up to this long so one laugh spanning several analysis windows
    // is one episode, not several. The built-in classifier emits ~3s windows
    // every ~1.5s, so this must exceed that hop or every overlapping window
    // becomes its own (duplicate) laugh with a fixed ~3s duration.
    var mergeGap = 2.0
    var frameSeconds = 0.5   // fallback window length if the API doesn't supply one

    /// Emit sub-threshold episodes (peak below `countThreshold`) via `onCandidate`.
    var logCandidates = true

    /// You-vs-TV attribution: if the strongest "produced-audio" context class
    /// (music / speech / audience / instruments) reaches this confidence, the
    /// episode is hypothesised to come from the TV rather than a person in the
    /// room. A guess, not a verdict — laughs are still logged, just attributed.
    var tvThreshold = 0.3

    /// Called (on the caller's thread) when a counted laugh is finalised. The
    /// event's `origin` carries the you-vs-TV hypothesis.
    var onLaugh: ((LaughEvent) -> Void)?
    /// Called for a sub-threshold episode (peak < `countThreshold`) — logged for
    /// alignment/tuning, not counted. Also carries an `origin` hypothesis.
    var onCandidate: ((LaughEvent) -> Void)?

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
        let capPeak = peak
        let capMean = n > 0 ? sum / Double(n) : 0
        let capType = peakType
        let tvSignal = peakContext
        let tvLabel = peakContextLabel
        let ctx = contextAgg.sorted { $0.value > $1.value }.prefix(3)
            .map { ContextScore(label: $0.key, confidence: $0.value) }
        resetEpisode()

        guard duration >= minDuration else { return }

        // You-vs-TV hypothesis: a strong produced-audio context (soundtrack,
        // dialogue, audience, instruments) points at the TV; clean laughter with
        // little of that points at a person in the room.
        let origin: String
        let reason: String
        if tvSignal >= tvThreshold {
            origin = "tv"
            reason = String(format: "%@=%.2f (soundtrack/audience) → TV",
                            tvLabel.isEmpty ? "produced-audio" : tvLabel, tvSignal)
        } else {
            origin = "me"
            reason = String(format: "clean laughter, tv-context %.2f → you", tvSignal)
        }

        let event = LaughEvent(start: s, end: end, duration: duration,
                               peak: capPeak, mean: capMean, type: capType,
                               context: ctx, origin: origin,
                               originReason: reason, tvSignal: tvSignal)
        if capPeak < countThreshold {
            if logCandidates { onCandidate?(event) }
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

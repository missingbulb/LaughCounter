import AVFoundation
import CoreMedia
import SoundAnalysis

/// Laughter detection using Apple's **built-in** sound classifier (no model to
/// download, no third-party ML). For each analysed window it reports a full
/// `LaughObservation`: the laughter confidence and which laugh class won, the
/// strongest TV-context class (for de-conflicting TV audio), a few top competing
/// classes (for debugging false positives), and the window's *real* audio timing.
///
/// We match several related laugh class identifiers (laughter, giggle, chuckle …)
/// so we don't overfit to a single style of laugh.
final class LaughDetector: NSObject, SNResultsObserving {
    private var analyzer: SNAudioStreamAnalyzer?
    private let queue = DispatchQueue(label: "com.laughcounter.sound-analysis")

    /// Called with a full observation for each analysed window.
    var onObservation: ((LaughObservation) -> Void)?

    // Stems, not whole words: the classifier emits gerunds like "giggling", so
    // "giggle" would miss it — "giggl" matches both "giggle" and "giggling".
    private static let laughKeywords = ["laugh", "giggl", "chuckl", "chortl",
                                        "snicker", "cackl", "guffaw"]
    // Sounds that usually mean the laughter is coming from a TV / recording rather
    // than a person in the room. Matched as case-insensitive substrings so we're
    // robust to the exact spelling of the classifier's identifiers.
    private static let tvKeywords = ["applause", "crowd", "cheer", "audience",
                                     "television", "music", "clapping"]

    // The analyzer wants monotonically increasing frame positions starting near 0.
    // We anchor those positions (and the wall-clock epoch) to the first buffer of
    // each stream, so window timestamps are real audio times, valid across restarts.
    private var baseSampleTime: AVAudioFramePosition?
    private var startEpoch: Double = 0

    // One log line per stream confirming the analysis pipeline is delivering
    // results after a (re)start — so "it stopped detecting" is diagnosable.
    private var sawFirstResult = false

    func configure(format: AVAudioFormat) throws {
        let analyzer = SNAudioStreamAnalyzer(format: format)
        let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
        try analyzer.add(request, withObserver: self)
        self.analyzer = analyzer
        self.baseSampleTime = nil
    }

    func analyze(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime) {
        queue.async { [weak self] in
            guard let self = self, let analyzer = self.analyzer else { return }
            if self.baseSampleTime == nil {
                self.baseSampleTime = when.sampleTime
                self.startEpoch = Date().timeIntervalSince1970
            }
            let base = self.baseSampleTime ?? when.sampleTime
            analyzer.analyze(buffer, atAudioFramePosition: when.sampleTime - base)
        }
    }

    /// Forget the stream anchor so the next buffer re-anchors timing. Call when
    /// (re)starting the audio stream.
    func reset() {
        queue.async { [weak self] in
            self?.baseSampleTime = nil
            self?.sawFirstResult = false
        }
    }

    // MARK: SNResultsObserving

    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let classification = result as? SNClassificationResult else { return }

        var laughScore = 0.0, laughType = ""
        var tvScore = 0.0, tvLabel = ""
        var nonLaugh: [ContextScore] = []
        for c in classification.classifications {
            let id = c.identifier.lowercased()
            let conf = c.confidence
            if Self.laughKeywords.contains(where: { id.contains($0) }) {
                if conf > laughScore { laughScore = conf; laughType = c.identifier }
            } else {
                nonLaugh.append(ContextScore(label: c.identifier, confidence: conf))
                if Self.tvKeywords.contains(where: { id.contains($0) }), conf > tvScore {
                    tvScore = conf; tvLabel = c.identifier
                }
            }
        }
        let topContext = Array(nonLaugh.sorted { $0.confidence > $1.confidence }.prefix(3))

        let windowStart = CMTimeGetSeconds(classification.timeRange.start)
        var windowDur = CMTimeGetSeconds(classification.timeRange.duration)
        if !windowDur.isFinite || windowDur <= 0 { windowDur = 0.5 }
        let epoch = startEpoch + (windowStart.isFinite ? windowStart : 0)

        if !sawFirstResult {
            sawFirstResult = true
            AppLog.shared.log("first analysis result received")
        }

        onObservation?(LaughObservation(
            time: epoch, windowDuration: windowDur,
            laughScore: laughScore, laughType: laughType,
            contextScore: tvScore, contextLabel: tvLabel,
            context: topContext))
    }

    func request(_ request: SNRequest, didFailWithError error: Error) {
        AppLog.shared.log("sound analysis failed: \(error.localizedDescription)", level: "ERROR")
    }
}

import AVFoundation
import SoundAnalysis

/// Laughter detection using Apple's **built-in** sound classifier (no model to
/// download, no third-party ML). It reports a laughter *confidence* for each
/// short analysis window; the `LaughCounter` decides what counts as a laugh.
///
/// We match several related class identifiers (laughter, giggle, chuckle, …) so
/// we don't overfit to a single style of laugh.
final class LaughDetector: NSObject, SNResultsObserving {
    private var analyzer: SNAudioStreamAnalyzer?
    private let queue = DispatchQueue(label: "com.laughcounter.sound-analysis")

    /// Called with the laughter confidence (0…1) for each analysed window.
    var onLaughterScore: ((Double) -> Void)?

    private static let laughKeywords = ["laugh", "giggle", "chuckle", "chortle", "snicker"]

    func configure(format: AVAudioFormat) throws {
        let analyzer = SNAudioStreamAnalyzer(format: format)
        let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
        try analyzer.add(request, withObserver: self)
        self.analyzer = analyzer
    }

    func analyze(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime) {
        queue.async { [weak self] in
            self?.analyzer?.analyze(buffer, atAudioFramePosition: when.sampleTime)
        }
    }

    // MARK: SNResultsObserving

    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let classification = result as? SNClassificationResult else { return }
        let laughter = classification.classifications
            .filter { c in Self.laughKeywords.contains { c.identifier.lowercased().contains($0) } }
            .map { $0.confidence }
            .max() ?? 0
        onLaughterScore?(laughter)
    }

    func request(_ request: SNRequest, didFailWithError error: Error) {
        NSLog("LaughCounter: sound analysis failed: \(error.localizedDescription)")
    }
}

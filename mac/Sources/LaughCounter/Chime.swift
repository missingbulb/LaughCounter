import AppKit

/// The little confirmation sound. One blip = "I logged a laugh." Two blips =
/// "I heard your 'I just laughed' and marked it."
enum Chime {
    static func play(times: Int = 1) {
        guard times > 0 else { return }
        // A short, unobtrusive built-in macOS sound.
        NSSound(named: NSSound.Name("Pop"))?.play()
        if times > 1 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) {
                play(times: times - 1)
            }
        }
    }
}

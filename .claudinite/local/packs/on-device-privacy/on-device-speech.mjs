// The "I just laughed" voice command runs through Apple's Speech framework,
// which streams audio to Apple's servers unless the request opts out — so every
// SFSpeechAudioBufferRecognitionRequest the app builds must set
// requiresOnDeviceRecognition (VoiceCommand.swift:48, "never leaves the Mac";
// DESIGN §3/§6, and the Info.plist usage string promises the same to the user).
// Dependency-free (a local pack loads without the canon mount): plain findings.

const rule = {
  id: 'on-device-privacy/on-device-speech',
  severity: 'blocking',
  description: 'Every SFSpeech recognition request must set requiresOnDeviceRecognition',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: "Speech defaults to server-side recognition, which would ship living-room audio to Apple — the opposite of what the app's mic prompt promises",

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => f.startsWith('mac/Sources/') && f.endsWith('.swift'))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!/\bSFSpeechAudioBufferRecognitionRequest\s*\(/.test(lines[i])) continue;
        // The opt-out is set on the fresh request, near its construction — look
        // ahead a short window rather than requiring an exact line.
        const window = lines.slice(i, i + 12).join('\n');
        if (/requiresOnDeviceRecognition\s*=\s*true/.test(window)) continue;
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: i + 1,
          what: 'a speech recognition request is built without requiresOnDeviceRecognition = true',
          why: rule.why,
          fix: 'set requiresOnDeviceRecognition = true on the request right after constructing it',
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;

// "Never build an `AVAudioEngine` to ask whether a microphone exists" (#88), as
// a check: `AVAudioEngine` may only be constructed in `AudioHub`.
//
// Touching `engine.inputNode` — which `AudioHub.makeEngine()` must do, because
// `prepare()` asserts a node is attached (#72) — opens the default input device
// and mints a hidden per-client aggregate device inside coreaudiod
// (`CADefaultDeviceAggregate-<pid>-<n>`). So constructing an engine is never a
// cheap read: one measured outage ran that open/create/destroy cycle ~210 times
// over 3h40m against hardware that was not there at all. `AudioDiagnostics`
// exists so nothing else has to — it answers "is there a usable mic?" with
// `AudioObjectGetPropertyData` property queries that open nothing.
//
// A positive whitelist over the construction site, not a ban list on the callers
// that shouldn't do it: a new file that reaches for an engine is caught the day
// it lands, which enumerating today's innocent files could not do.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

// The one file allowed to build one. `AudioHub` owns the microphone, rebuilds the
// engine on every start (#61), and is where `makeEngine()` keeps the
// materialize-inputNode-before-prepare() rule in one place.
const OWNER = 'mac/Sources/LaughCounter/AudioHub.swift';

// A construction, not a mention: `AVAudioEngine()` with arguments-or-not, but not
// `var engine: AVAudioEngine` and not `AVAudioEngineConfigurationChange`.
const CONSTRUCTION = /\bAVAudioEngine\s*\(/g;

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'macos-audio/engine-construction-confined',
  severity: 'blocking',
  description: 'Only AudioHub builds an AVAudioEngine — nothing else opens the mic to ask a question (mac/Sources/)',
  doc: '.claudinite/local/packs/macos-audio/RULES.md',
  why: 'constructing an engine opens the default input and churns a hidden coreaudiod aggregate device — the one mechanism by which this app could plausibly wedge a mic',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      if (file === OWNER) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      CONSTRUCTION.lastIndex = 0;
      let m = CONSTRUCTION.exec(text);
      while (m !== null) {
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: text.slice(0, m.index).split('\n').length,
          what: `builds an AVAudioEngine outside ${OWNER} (${file})`,
          why: rule.why,
          fix: 'ask AudioDiagnostics instead — `hasUsableInput` / `inputAvailability` answer from HAL property queries that open no device; if capture really is needed, route it through AudioHub, which is the single owner of the engine lifecycle',
          doc: rule.doc,
        });
        m = CONSTRUCTION.exec(text);
      }
    }
    return out;
  },
};

export default rule;

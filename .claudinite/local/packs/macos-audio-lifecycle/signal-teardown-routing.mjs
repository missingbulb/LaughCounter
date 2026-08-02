// "`applicationWillTerminate` is not 'every exit path' by itself", as a check.
//
// NSApplication installs no signal handlers, so a bare SIGTERM (Activity
// Monitor's Quit, `killall`), SIGINT (Ctrl-C in a dev terminal) or SIGHUP (that
// terminal closing) kills the process with no teardown — leaving the input tap's
// IOProc registered on the device, which is what wedges some USB webcam mics
// until they are re-plugged (#22). `main.swift` routes those three through
// `DispatchSourceSignal` → `NSApp.terminate`, and `signal(sig, SIG_IGN)` must
// come *before* `resume()` or a signal landing in the gap still takes the fatal
// default.
//
// Two arms, both keyed on the tree actually installing an audio tap — no tap, no
// IOProc to abandon, nothing to enforce:
//   1. some file must set up signal sources at all, covering all three signals;
//   2. in that file, SIG_IGN must precede the first resume().
//
// The ordering arm compares first-occurrence offsets rather than parsing scopes:
// the two calls sit in one small setup block in this app (a `.map` over the
// signal list), and a file that acquired a second, unrelated `resume()` above the
// setup would be flagged — a false positive that is cheap to see and cheaper than
// missing the real ordering bug, which is invisible at runtime until the one
// signal that lands in the gap.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const REQUIRED_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'macos-audio-lifecycle/signal-teardown-routing',
  severity: 'blocking',
  description: 'Catchable termination signals reach applicationWillTerminate, and SIG_IGN precedes resume() (mac/Sources/)',
  doc: '.claudinite/local/packs/macos-audio-lifecycle/RULES.md',
  why: 'a signal that kills the process outright skips the tap teardown and abandons the IOProc on the microphone — the wedge condition the whole lifecycle is built around',

  run(ctx) {
    const swift = ctx.files.filter(inScope);
    const read = new Map();
    for (const file of swift) {
      const text = ctx.read(file);
      if (text !== null) read.set(file, text);
    }

    // Only an app that installs an audio tap has an IOProc to abandon.
    const tapSite = [...read.entries()].find(([, text]) => /\binstallTap\s*\(/.test(text));
    if (!tapSite) return [];

    const routing = [...read.entries()]
      .filter(([, text]) => /\bmakeSignalSource\s*\(/.test(text));

    if (routing.length === 0) {
      return [{
        rule: rule.id,
        severity: rule.severity,
        file: tapSite[0],
        line: 1,
        what: `an audio tap is installed in ${tapSite[0]} but nothing routes termination signals to NSApp.terminate`,
        why: rule.why,
        fix: 'in `main.swift`, map [SIGTERM, SIGINT, SIGHUP] to `DispatchSource.makeSignalSource(signal:queue:)` handlers that call `NSApp.terminate(nil)`, calling `signal(sig, SIG_IGN)` first and holding the sources in a top-level `let` so they outlive setup',
        doc: rule.doc,
      }];
    }

    const out = [];
    for (const [file, text] of routing) {
      const missing = REQUIRED_SIGNALS.filter((s) => !new RegExp(`\\b${s}\\b`).test(text));
      if (missing.length > 0) {
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: text.slice(0, text.search(/\bmakeSignalSource\s*\(/)).split('\n').length,
          what: `signal routing in ${file} does not cover ${missing.join(', ')}`,
          why: rule.why,
          fix: `add ${missing.join(', ')} to the routed set — each of them is fatal by default and leaves the tap installed`,
          doc: rule.doc,
        });
      }

      const ignore = text.search(/\bsignal\s*\([^)]*SIG_IGN/);
      const resume = text.search(/\.resume\s*\(\s*\)/);
      if (resume >= 0 && (ignore < 0 || ignore > resume)) {
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: text.slice(0, resume).split('\n').length,
          what: ignore < 0
            ? `${file} resumes a signal source without ever calling signal(…, SIG_IGN)`
            : `${file} calls signal(…, SIG_IGN) only after resume()`,
          why: rule.why,
          fix: 'call `signal(sig, SIG_IGN)` before `source.resume()` — until the default action is ignored, a signal arriving in the gap still terminates the process outright',
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;

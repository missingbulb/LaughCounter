import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';

// Converted from this pack's exit-path prose: `NSApplication` installs no signal
// handlers, so a bare SIGTERM (Activity Monitor's Quit, `killall`), SIGINT or
// SIGHUP kills the process with no teardown at all — leaving a capture tap's
// CoreAudio IOProc registered on the device, which is what wedges some USB input
// devices until they are physically re-plugged.
//
// Gated twice, so it speaks only where the rule applies: the tree must be an
// AppKit app (a command-line tool has no `NSApp.terminate` to route into) AND it
// must install a capture tap (no tap, no IOProc to abandon, nothing at stake).
// Everything is read with comments stripped — prose describing the trap is not
// an implementation of it, nor evidence against one.
//
// Three arms:
//   1. nothing anywhere routes those signals — any of the three mechanisms a Mac
//      app plausibly uses counts as routing (`DispatchSource.makeSignalSource`,
//      `sigaction`, a direct `signal(SIGTERM, …)` handler);
//   2. routing exists but one of the three signals is named nowhere in the
//      sources — the unrouted one stays fatal by default;
//   3. `SIG_IGN` comes after the source is resumed — until the default action is
//      ignored, a signal landing in the gap still terminates the process outright.
//
// Arm 3 compares offsets rather than parsing scopes, and deliberately only looks
// at the first `.resume()` that follows the file's first `makeSignalSource(` — an
// unrelated `resume()` earlier in the file (a URLSession task, a dispatch queue)
// is then not this rule's business.
//
// Blocking: every arm describes a path that skips teardown silently, and the
// damage shows up on hardware rather than in the build.

const SWIFT = /\.swift$/;

const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

// AppKit, not a CLI: only an app with an NSApplication has NSApp.terminate to
// route into, and only it gets `applicationWillTerminate` at all.
const APPKIT = /\bNSApplicationDelegate\b|\bNSApplicationMain\b|\bNSApp\b/;
// A capture tap is what registers the IOProc this rule protects.
const TAP = /\binstallTap\s*\(/;

const MAKE_SOURCE = /\bmakeSignalSource\s*\(/;
const ROUTING = [
  MAKE_SOURCE,
  /\bsigaction\s*\(/,
  new RegExp(`\\bsignal\\s*\\(\\s*(?:${SIGNALS.join('|')})\\b`),
];
const SIG_IGN = /\bsignal\s*\([^)]*SIG_IGN/;
const RESUME = /\.resume\s*\(\s*\)/g;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const rule = {
  id: 'signal-teardown-routing',
  severity: 'blocking',
  description: 'An AppKit app that installs a capture tap routes SIGTERM/SIGINT/SIGHUP into NSApp.terminate, with SIG_IGN before resume() (*.swift)',
  doc: 'packs/macos/RULES.md',
  why: 'NSApplication installs no signal handlers, so an unrouted SIGTERM/SIGINT/SIGHUP kills the process with no teardown and abandons the capture tap\'s IOProc on the device — the state that wedges some USB input devices until they are re-plugged',

  run(ctx) {
    const sources = new Map();
    for (const file of ctx.files.filter((f) => SWIFT.test(f))) {
      const text = ctx.read(file);
      if (text !== null) sources.set(file, stripComments(text));
    }

    const isApp = [...sources.values()].some((t) => APPKIT.test(t));
    const tapSite = [...sources.entries()].find(([, t]) => TAP.test(t));
    if (!isApp || !tapSite) return [];

    const routingFiles = [...sources.entries()].filter(([, t]) => ROUTING.some((r) => r.test(t)));

    if (routingFiles.length === 0) {
      const [file, text] = tapSite;
      return [finding(rule, {
        file,
        line: lineOf(text, text.search(TAP)),
        what: `a capture tap is installed in ${file} but nothing in the sources routes termination signals to NSApp.terminate`,
        fix: 'map [SIGTERM, SIGINT, SIGHUP] to `DispatchSource.makeSignalSource(signal:queue:)` handlers that call `NSApp.terminate(nil)` — calling `signal(sig, SIG_IGN)` before `resume()`, and holding the sources in a top-level `let` so they outlive setup',
      })];
    }

    const out = [];

    // Arm 2: a signal named nowhere in the sources is a signal nothing routes.
    const unrouted = SIGNALS.filter(
      (s) => ![...sources.values()].some((t) => new RegExp(`\\b${s}\\b`).test(t))
    );
    if (unrouted.length > 0) {
      const [file, text] = routingFiles[0];
      out.push(finding(rule, {
        file,
        line: lineOf(text, Math.max(text.search(MAKE_SOURCE), 0)),
        what: `signal routing exists but ${unrouted.join(', ')} appears nowhere in the sources`,
        fix: `route ${unrouted.join(', ')} the same way as the signals already handled — each of them is fatal by default and leaves the tap installed`,
      }));
    }

    // Arm 3: SIG_IGN must precede the resume() of the sources it protects.
    for (const [file, text] of routingFiles) {
      const setup = text.search(MAKE_SOURCE);
      if (setup < 0) continue;
      RESUME.lastIndex = setup;
      const resumed = RESUME.exec(text);
      if (resumed === null) continue;
      const ignore = text.search(SIG_IGN);
      if (ignore >= 0 && ignore < resumed.index) continue;
      out.push(finding(rule, {
        file,
        line: lineOf(text, resumed.index),
        what: ignore < 0
          ? `${file} resumes a signal source without ever calling signal(…, SIG_IGN)`
          : `${file} calls signal(…, SIG_IGN) only after resume()`,
        fix: 'call `signal(sig, SIG_IGN)` before `source.resume()` — until the default action is ignored, a signal arriving in the gap still terminates the process outright',
      }));
    }

    return out;
  },
};

export default rule;

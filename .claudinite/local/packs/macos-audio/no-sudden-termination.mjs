// The app's `Info.plist` may not declare `NSSupportsSuddenTermination`.
//
// The release-the-mic invariant depends on `applicationWillTerminate` actually
// running: if the process ends while the input tap's CoreAudio IOProc is still
// registered, some USB webcam mics wedge until physically re-plugged (#22).
// `main.swift` goes to the trouble of routing SIGTERM/SIGINT/SIGHUP through
// `NSApp.terminate` precisely so those paths reach that teardown. Opting into
// sudden termination tells macOS the app may be SIGKILLed at logout instead —
// which skips every one of those paths at once, silently, from a one-line plist
// edit that looks like a launch-time optimisation.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const KEY = 'NSSupportsSuddenTermination';

const inScope = (f) => f.startsWith('mac/Resources/') && f.endsWith('.plist');

const rule = {
  id: 'macos-audio/no-sudden-termination',
  severity: 'blocking',
  description: 'The app never opts into sudden termination — applicationWillTerminate must run (mac/Resources/*.plist)',
  doc: '.claudinite/local/packs/macos-audio/RULES.md',
  why: 'sudden termination lets logout SIGKILL the app past every teardown path, abandoning the input tap\'s IOProc on the device — the state that wedges a USB mic until it is re-plugged',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes(KEY)) continue;
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: i + 1,
          what: `${file} declares ${KEY}`,
          why: rule.why,
          fix: `remove the ${KEY} key — the app must be given the chance to remove its tap and stop the engine on the way out; if a launch/quit cost is the motivation, measure it against a wedged microphone`,
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;

# macos-audio — references

Rationale for the marked rules in `RULES.md`, recovered from
`dev/procedures/mac-audio-lifecycle.md`'s case history. Exists for maintenance
and review — never for daily agentic work: no rule sends its reader here, and
no session loads it.

- **(RULES-1)** The wedge recurred on 0.5.0 after a sleep, with the settle
  gate in place and doing nothing: `usableInputSince` was carried straight
  through the sleep because `AudioDiagnostics`' sampling timer does not fire
  while the machine is asleep, so a mic that re-enumerated during the sleep
  was reported as continuously present since before it, and
  `requireSettledInputDevice()` passed instantly with zero settle. (#107)
- **(RULES-2)** `listening` was set because `engine.start()` returned, so the
  app held a wedged device for an entire evening with the menu bar reporting
  "listening" — the one symptom the owner sees, saying the one thing that
  isn't true — and both wedge investigations had to be reconstructed after
  the fact from a log whose only claim was "listening started". (#79, #88)
- **(RULES-3)** Two crash-on-launch builds shipped past CI (which runs only
  `swift build`): the uncatchable `installTap` NSException from reusing an
  engine across a device change, and a separate crash reachable one second
  into every launch from touching `prepare()` before a node was attached.
  (#61, #72)

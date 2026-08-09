// The counter's two numeric contracts, as a check.
//
// 1. **Hysteresis ordering** — `exitThreshold < enterThreshold <= countThreshold`.
//    The three bars do three different jobs: `enter` opens an episode, the lower
//    `exit` holds it open across a dip (that gap *is* the hysteresis), and `count`
//    decides whether the finished episode is a real laugh or a logged candidate.
//    Invert `exit` and `enter` and the hysteresis is gone — an episode closes the
//    moment it dips below the bar that opened it, so one laugh shatters into
//    several. Put `count` below `enter` and the candidate band disappears, taking
//    the sub-threshold events later feedback aligns against with it.
//
// 2. **`mergeGap` must exceed the classifier's window hop.** The built-in
//    classifier emits ~3s windows every ~1.5s, so consecutive windows *overlap*.
//    A merge gap at or under the hop makes every overlapping window its own
//    episode: one laugh counted several times, each with a fixed ~3s duration.
//
// Both are stated in `LaughCounter.swift`'s own doc comments; this check makes
// them fail loudly instead of drifting the counts of a thing nobody can unit-test
// against a live room.
//
// Dependency-free by design (a local pack must load without the canon mount), so
// the finding objects are built by hand rather than via the engine helper.

const CORE = 'mac/Sources/LaughCounter/LaughCounter.swift';

// `var countThreshold = 0.5` — the tunables, with their defaults.
const SETTING = /^\s*var\s+(countThreshold|enterThreshold|exitThreshold|mergeGap)\s*(?::\s*\w+\s*)?=\s*([0-9]*\.?[0-9]+)/gm;

// The classifier's window hop: ~1.5s between ~3s windows.
const WINDOW_HOP = 1.5;

const rule = {
  id: 'laugh-detection/hysteresis-contract',
  severity: 'blocking',
  description: 'exitThreshold < enterThreshold <= countThreshold, and mergeGap exceeds the ~1.5s classifier hop (LaughCounter.swift)',
  doc: '.claudinite/local/packs/laugh-detection/RULES.md',
  why: 'these are the numbers that decide what counts as one laugh — inverted they shatter or duplicate episodes, and the only place that shows up is a count nobody can check against the room',

  run(ctx) {
    if (!ctx.files.includes(CORE)) return [];
    const text = ctx.read(CORE);
    if (text === null) return [];

    const found = {};
    SETTING.lastIndex = 0;
    let m = SETTING.exec(text);
    while (m !== null) {
      found[m[1]] = { value: Number(m[2]), line: text.slice(0, m.index).split('\n').length };
      m = SETTING.exec(text);
    }

    const out = [];
    const flag = (line, what, fix) => out.push({
      rule: rule.id, severity: rule.severity, file: CORE, line, what, why: rule.why, fix, doc: rule.doc,
    });

    const { exitThreshold: ex, enterThreshold: en, countThreshold: co, mergeGap: gap } = found;

    if (ex && en && !(ex.value < en.value)) {
      flag(ex.line,
        `exitThreshold (${ex.value}) is not below enterThreshold (${en.value}) — there is no hysteresis band`,
        'put exitThreshold strictly below enterThreshold: the lower bar is what holds an episode open across a dip, so a fit of giggles stays one laugh');
    }
    if (en && co && !(en.value <= co.value)) {
      flag(en.line,
        `enterThreshold (${en.value}) is above countThreshold (${co.value}) — the candidate band is inverted`,
        'keep enterThreshold at or below countThreshold: episodes between the two are the candidates logged (uncounted) for later alignment and threshold tuning');
    }
    if (gap && !(gap.value > WINDOW_HOP)) {
      flag(gap.line,
        `mergeGap (${gap.value}) does not exceed the classifier's ~${WINDOW_HOP}s window hop`,
        `raise mergeGap above ${WINDOW_HOP}: the built-in classifier emits ~3s windows every ~${WINDOW_HOP}s, so at or below the hop every overlapping window becomes its own duplicate laugh`);
    }

    return out;
  },
};

export default rule;

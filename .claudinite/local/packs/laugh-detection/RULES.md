# Counting laughs — the decision layer over a classifier you cannot retrain

macOS's Sound Analysis framework ships a fixed, pretrained classifier. It is a
**black box**: no retraining, no weights, no thresholds of its own you can move
(`docs/DESIGN-AND-TRADEOFFS.md` §2). Everything that makes the count right or
wrong therefore lives *after* it — in how confidences become episodes, how
episodes become counts, and what the log keeps about them. These are the rules
that decision layer runs by.

Neighbouring packs, so a rule lands once: `local/macos-audio` owns getting audio
out of the device at all, `local/on-device-privacy` owns the boundary that audio
never crosses, `local/laughcounter` the repo's build and packaging.

## Improve the decision, not the call into the model

When a laugh is missed, the reflex is to reach for the classifier — a different
request, a different identifier, a "better" configuration. There is nothing there
to reach for. A miss is either **near the bar** (the model heard it, under
threshold — fixable now, in the thresholds and the hysteresis) or **at the model's
floor** (scored near zero — no threshold helps, and the only real answer is a
custom Create ML sound classifier trained from saved clips, the roadmap's v3).
Say which of the two a miss is before proposing anything; a fix aimed at the wrong
one cannot work, whatever it does to the numbers.

## Match sound classes as lowercased stems, never whole words

The taxonomy inflects: it emits `giggling`, not `giggle`. Matching is done as a
case-insensitive **substring stem** against a lowercased identifier — `giggl`
catches both forms, `applause` catches `applause` and `audience_applause`. Equality
against a full identifier is a rule that quietly stops matching the day Apple
renames or inflects the class. Keep the stem the shortest one that can't collide
with something else in the taxonomy — and lowercase, or it never fires at all
(`classifier-keywords-lowercase`).

## The counter is handed time; it never asks what time it is

Every timestamp in an episode comes from the analysis window
(`SNClassificationResult.timeRange`) carried on the observation, never from the
wall clock (`counting-core-clock-free`). That is what makes a duration the length
of the *laugh* rather than the length of the analysis backlog, keeps it honest
across a stream restart, and keeps the whole counting rule set exercisable with a
table of made-up observations instead of a live room. The fixed frame length is a
**fallback for a window the API didn't dimension**, not a unit of measure (#5).

## An episode is a laugh; a window is not

A laugh spans several overlapping analysis windows and dips inside itself. The
hysteresis contract — open on `enterThreshold`, hold on the lower `exitThreshold`,
bridge silences shorter than `mergeGap`, keep only episodes past `minDuration` —
is what turns those windows into one laugh, and the numbers are load-bearing in
both directions (`hysteresis-contract`). When changing any of them, say which
failure you are trading against: too tight shatters one laugh into several, too
loose merges two laughs into one.

## Never drop a sub-threshold episode — log it as a candidate

An episode that clears `enterThreshold` but not `countThreshold` is written to the
log as a `candidate` and not counted. This is not debug noise: it is the only
record that lets a later "I just laughed" be aligned against something the model
*did* hear, which is what makes threshold tuning possible at all (and, at v3, what
labels a clip). Dropping candidates costs nothing today and removes the evidence
for every improvement afterwards.

## Attribution labels an event, it never suppresses one

You-vs-TV is a **hypothesis** from the strongest produced-audio context class
(soundtrack, dialogue, audience — #7), and it is recorded as `origin` plus a
human-readable `origin_reason`. It never decides whether a laugh is logged. Any
classifier-derived judgment about a laugh — who, where, from what — follows the
same shape: an extra field with its reasoning, so a wrong guess is visible and
re-derivable from the log rather than an event that silently never existed.

## The laugh log is a fixed-order, hand-rendered JSONL record

Fields are emitted in the same order on every line (`Store.swift`) because the log
is meant to be grepped, eyeballed and diffed by the person whose laughs it counts
(#5). `JSONSerialization`/`JSONEncoder` cannot promise key order, which is why the
writer renders JSON itself — a small ordered enum, not an oversight to tidy up.
Confidences are rounded on the way in; they carry no meaning past a couple of
decimals, and unrounded floats make the diffs unreadable.

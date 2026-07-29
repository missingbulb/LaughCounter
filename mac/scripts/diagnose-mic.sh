#!/bin/bash
#
# diagnose-mic.sh — collect everything needed to tell apart the ways "the mic is
# dead after sleep" can happen, and reach a verdict. Run it on the Mac *while
# the symptom is present*, before quitting or relaunching LaughCounter (a
# relaunch destroys most of the evidence).
#
#   bash diagnose-mic.sh              # read-only
#   bash diagnose-mic.sh --capture    # also record ~3s (needs swift; see below)
#
# Everything it needs ships with macOS — no Xcode, no command line tools, no
# swift. If `swift` happens to be installed and `mic-probe.swift` sits next to
# this script, it additionally reports the CoreAudio HAL state; without it the
# app's own activity log, the process state and the crash reports still separate
# all three failure states, which is what the verdict below is built on.
#
# It writes one report to /tmp/laughcounter-mic-diagnosis-<stamp>.txt, prints
# the path, and prints a verdict. The states it separates:
#
#   1. App died         — crash report present, or the process start time is
#                         AFTER the wake. The tap's IOProc was abandoned, so the
#                         device is wedged for everyone until re-plugged.
#   2. App alive, stuck — process predates the sleep, log ends in failed starts.
#                         The app is not re-acquiring the device.
#   3. App alive, silent— log says "listening started" after the wake, and
#                         nothing has been counted since. The engine is running
#                         and delivering nothing.

set -uo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/laughcounter-mic-diagnosis-${STAMP}.txt"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_LOG="$HOME/Library/Application Support/LaughCounter/laughcounter.log"

section() {
  {
    echo ""
    echo "================================================================"
    echo "== $1"
    echo "================================================================"
  } >>"$OUT"
}

exec 3>&1
{
  echo "LaughCounter mic diagnosis — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: $(sw_vers -productName) $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  echo "uptime: $(uptime)"
} >"$OUT"

# --- 1. Is the app running, and since when? -------------------------------
# A start time AFTER the last wake means it relaunched, which means it died.
# A process older than the sleep is state 2 or 3.
section "process"
PIDS="$(pgrep -x LaughCounter || true)"
FIRST_PID=""
APP_STARTED=""
if [ -z "$PIDS" ]; then
  echo "LaughCounter is NOT running" >>"$OUT"
else
  FIRST_PID="$(echo "$PIDS" | head -1)"
  APP_STARTED="$(ps -o lstart= -p "$FIRST_PID" 2>/dev/null | sed 's/^ *//')"
  echo "pids: $PIDS" >>"$OUT"
  # shellcheck disable=SC2086
  ps -o pid,lstart,etime,%cpu,%mem,rss,state,command -p $PIDS >>"$OUT" 2>&1
fi
echo "" >>"$OUT"
echo "installed app bundle:" >>"$OUT"
for APP in /Applications/LaughCounter.app "$HOME/Applications/LaughCounter.app"; do
  if [ -d "$APP" ]; then
    V="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
    B="$(defaults read "$APP/Contents/Info" CFBundleVersion 2>/dev/null)"
    echo "  $APP  v$V ($B)" >>"$OUT"
  fi
done

# --- 2. Did it crash? -----------------------------------------------------
# An uncatchable NSException aborts the process, applicationWillTerminate never
# runs, and the tap's IOProc is left registered. Anything here is the whole story.
section "crash reports (last 10)"
CRASH_LIST="$(find "$HOME/Library/Logs/DiagnosticReports" /Library/Logs/DiagnosticReports \
     -maxdepth 1 -iname 'LaughCounter*' 2>/dev/null)"
NEWEST_CRASH=""
if [ -n "$CRASH_LIST" ]; then
  echo "$CRASH_LIST" | tr '\n' '\0' | xargs -0 ls -lt 2>/dev/null | head -10 >>"$OUT"
  NEWEST_CRASH="$(echo "$CRASH_LIST" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null | head -1)"
fi
if [ -n "$NEWEST_CRASH" ]; then
  echo "" >>"$OUT"
  echo "--- head of newest: $NEWEST_CRASH ---" >>"$OUT"
  head -80 "$NEWEST_CRASH" >>"$OUT" 2>&1
  echo "" >>"$OUT"
  echo "--- exception / termination lines ---" >>"$OUT"
  grep -iE 'exception|termination|abort|required condition|signal' "$NEWEST_CRASH" \
    | head -30 >>"$OUT" 2>&1
else
  echo "(no LaughCounter crash reports found)" >>"$OUT"
fi

# --- 3. The app's own account of the sleep/wake ---------------------------
# This is the decisive section without swift: whether the wake was followed by a
# run of failed starts (the retry ladder churning the device open and shut once
# a minute) before any "listening started", and whether anything has been
# counted since that start.
section "app activity log (last 200 lines)"
RETRY_COUNT=0
SLOW_CHECK=0
FAIL_COUNT=0
EVENTS_SINCE_START=0
LAST_START=""
LAST_LINE=""
if [ -f "$APP_LOG" ]; then
  echo "path: $APP_LOG" >>"$OUT"
  echo "size: $(stat -f%z "$APP_LOG" 2>/dev/null) bytes, modified $(stat -f%Sm "$APP_LOG" 2>/dev/null)" >>"$OUT"
  echo "" >>"$OUT"
  tail -200 "$APP_LOG" >>"$OUT"

  LAST_LINE="$(tail -1 "$APP_LOG")"
  # Everything after the most recent successful start.
  START_LINE_NO="$(grep -n 'listening started' "$APP_LOG" | tail -1 | cut -d: -f1)"
  if [ -n "$START_LINE_NO" ]; then
    LAST_START="$(sed -n "${START_LINE_NO}p" "$APP_LOG")"
    AFTER_START="$(tail -n +"$((START_LINE_NO + 1))" "$APP_LOG")"
    # Laugh/candidate/miss lines are the proof that buffers are actually arriving.
    EVENTS_SINCE_START="$(printf '%s\n' "$AFTER_START" | grep -c 'logged' || true)"
    # Failed starts BEFORE that success is the number that matters: each one is
    # a full engine build + device open + teardown, so a long run of them is the
    # retry ladder churning the device once a minute before finally "succeeding".
    RETRY_COUNT="$(head -n "$((START_LINE_NO - 1))" "$APP_LOG" | grep -c 'start failed' || true)"
  else
    RETRY_COUNT="$(grep -c 'start failed' "$APP_LOG" || true)"
  fi
  # Churn indicators over the whole retained log.
  SLOW_CHECK="$(grep -c 'input device still unavailable' "$APP_LOG" || true)"
  FAIL_COUNT="$(grep -c 'could not start listening' "$APP_LOG" || true)"

  section "app log: start/stop/sleep/wake lines only (last 80)"
  grep -E 'listening started|listening stopped|could not start|start failed|still unavailable|woke|unlocked|session became|configuration changed|engine halted|app launched|terminated' \
    "$APP_LOG" | tail -80 >>"$OUT"
else
  echo "no activity log at $APP_LOG" >>"$OUT"
fi

# --- 4. Sleep/wake history ------------------------------------------------
section "power management sleep/wake history (last 60 events)"
pmset -g log 2>/dev/null \
  | grep -E 'Sleep  |Wake  |DarkWake|Notification' \
  | tail -60 >>"$OUT"

section "current power assertions"
# coreaudiod holding an assertion is a hint that audio IO is running somewhere.
pmset -g assertions >>"$OUT" 2>&1

# --- 5. Is the hardware still there? --------------------------------------
# Without swift this is the best available "is the device present and sane"
# read. A webcam that still enumerates on USB but exposes no audio input is the
# wedge; a device missing from both lists came unplugged or was powered down.
section "audio devices (system_profiler)"
system_profiler SPAudioDataType 2>/dev/null >>"$OUT"

section "USB devices (looking for the webcam/mic)"
system_profiler SPUSBDataType 2>/dev/null >>"$OUT"

section "coreaudiod"
CA_PID="$(pgrep -x coreaudiod | head -1)"
if [ -n "$CA_PID" ]; then
  ps -o pid,lstart,etime,%cpu,command -p "$CA_PID" >>"$OUT" 2>&1
else
  echo "coreaudiod is not running (!)" >>"$OUT"
fi

# --- 6. CoreAudio HAL probe (optional, needs swift) -----------------------
section "CoreAudio HAL probe"
# `command -v swift` is NOT a usable test: /usr/bin/swift ships on every Mac as
# a stub that pops the "install the command line developer tools?" dialog when
# run. Ask xcode-select whether a developer directory exists first — that fails
# quietly when the tools are absent, and no dialog appears.
if xcode-select -p >/dev/null 2>&1 && command -v swift >/dev/null 2>&1 \
   && [ -f "$HERE/mic-probe.swift" ]; then
  if [ "${1:-}" = "--capture" ]; then
    swift "$HERE/mic-probe.swift" --capture >>"$OUT" 2>&1
  else
    swift "$HERE/mic-probe.swift" >>"$OUT" 2>&1
  fi
else
  {
    echo "skipped — no Swift toolchain (and none is needed; do not install one)."
    echo ""
    echo "Nothing decisive is lost. The process state, crash reports and activity"
    echo "log above separate the failure states on their own. The HAL numbers the"
    echo "probe would add — IsRunningSomewhere, and the inputFormat/outputFormat"
    echo "pair the app gates on — are now sampled continuously by the app itself"
    echo "(AudioDiagnostics), so they appear in the activity log above as"
    echo "'audio health' / 'audio snapshot' / 'AUDIO STALL' lines."
  } >>"$OUT"
fi

# --- 7. Unified log -------------------------------------------------------
# Survives an abort, unlike the app's own log — it is the only record of what
# happened if the process died mid-write.
section "unified log: LaughCounter (last 3h)"
log show --last 3h --style compact \
  --predicate 'process == "LaughCounter" OR eventMessage CONTAINS "LaughCounter"' \
  2>/dev/null | tail -200 >>"$OUT"

section "unified log: coreaudiod errors/faults (last 3h)"
log show --last 3h --style compact --predicate \
  'process == "coreaudiod" AND (messageType == error OR messageType == fault)' \
  2>/dev/null | tail -150 >>"$OUT"

# --- Verdict --------------------------------------------------------------
# Printed to the terminal AND appended to the report, so the answer is visible
# without reading 2000 lines.
verdict() {
  echo ""
  echo "---------------- summary ----------------"
  if [ -z "$PIDS" ]; then
    echo "process:        NOT RUNNING"
  else
    echo "process:        running (pid $FIRST_PID), started $APP_STARTED"
  fi
  if [ -n "$NEWEST_CRASH" ]; then
    echo "crash reports:  PRESENT — newest $(basename "$NEWEST_CRASH")"
  else
    echo "crash reports:  none"
  fi
  if [ -f "$APP_LOG" ]; then
    echo "last log line:  $LAST_LINE"
    [ -n "$LAST_START" ] && echo "last start:     $LAST_START"
    echo "since that start: $EVENTS_SINCE_START laugh/candidate/miss events"
    echo "before it:      $RETRY_COUNT failed starts (each one opens and closes the device)"
    echo "log totals:     $FAIL_COUNT failed starts, $SLOW_CHECK slow-check announcements"
  fi
  echo ""
  echo "---------------- verdict ----------------"
  if [ -z "$PIDS" ] || [ -n "$NEWEST_CRASH" ]; then
    echo "STATE 1 — the app died. The tap's IOProc was abandoned; that wedges the"
    echo "device for every app until it is physically re-plugged. Read the crash"
    echo "report's exception lines in the report."
  elif [ -n "$LAST_START" ] && [ "$EVENTS_SINCE_START" -eq 0 ]; then
    echo "STATE 3 — the app is alive and believes it is listening, but nothing has"
    echo "been counted since that start. The engine is running and delivering"
    echo "nothing. Check the failed-start count above: a long run of failed starts"
    echo "before that 'listening started' means the retry ladder churned the input"
    echo "device open and shut once a minute before finally 'succeeding' on it."
  elif [ -n "$LAST_START" ]; then
    echo "STATE OK-ish — $EVENTS_SINCE_START events counted since the last start, so"
    echo "audio was flowing at some point after it. If the mic is dead now, it died"
    echo "after that; compare the timestamps of the last event and the wake."
  else
    echo "STATE 2 — the app is alive but has no successful start in the retained log."
    echo "It is not re-acquiring the device. The mic may well be fine at the OS level."
  fi
  echo ""
  echo "Full report: $OUT"
  echo "Send that file back (it contains no audio and no laugh data)."
}
verdict >>"$OUT"
verdict >&3

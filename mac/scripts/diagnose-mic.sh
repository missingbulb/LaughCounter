#!/bin/bash
#
# diagnose-mic.sh — collect everything needed to tell apart the three ways
# "the mic is dead after sleep" can happen. Run it on the Mac *while the
# symptom is present*, before quitting or relaunching LaughCounter (a relaunch
# destroys most of the evidence).
#
#   bash mac/scripts/diagnose-mic.sh              # read-only
#   bash mac/scripts/diagnose-mic.sh --capture    # also record ~3s (see below)
#
# It writes one report to /tmp/laughcounter-mic-diagnosis-<stamp>.txt and prints
# the path. The three states it separates:
#
#   1. App died         — crash report present, process gone or restarted. The
#                         tap's IOProc was abandoned, so the device is wedged
#                         for everyone until re-plugged.
#   2. App alive, stuck  — process is old and running, log shows failed starts
#                         or nothing at all since the wake. The mic is fine at
#                         the OS level; the app is not re-acquiring it.
#   3. App alive, silent — log says "listening started" after the wake and the
#                         engine is running, but no laughs are counted. The
#                         stream is running and delivering nothing.
#
# --capture opens the microphone from this script for three seconds, which
# needs the terminal to have microphone access. It is opt-in because it takes
# the device, and taking the device is the thing that can wedge it.

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
# An app whose start time is AFTER the last wake relaunched itself, which means
# it died. An app older than the sleep is state 2 or 3.
section "process"
PIDS="$(pgrep -x LaughCounter || true)"
if [ -z "$PIDS" ]; then
  echo "LaughCounter is NOT running" >>"$OUT"
else
  echo "pids: $PIDS" >>"$OUT"
  # shellcheck disable=SC2086
  ps -o pid,lstart,etime,%cpu,%mem,rss,state,command -p $PIDS >>"$OUT" 2>&1
fi
echo "" >>"$OUT"
echo "installed app bundle version:" >>"$OUT"
for APP in /Applications/LaughCounter.app "$HOME/Applications/LaughCounter.app"; do
  if [ -d "$APP" ]; then
    echo "  $APP  $(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null) " \
         "($(defaults read "$APP/Contents/Info" CFBundleVersion 2>/dev/null))" >>"$OUT"
  fi
done

# --- 2. Did it crash? -----------------------------------------------------
# An uncatchable NSException aborts the process, applicationWillTerminate never
# runs, and the tap's IOProc is left registered on the device. If anything shows
# up here, that is the whole story.
section "crash reports (last 10)"
CRASH_LIST="$(find "$HOME/Library/Logs/DiagnosticReports" /Library/Logs/DiagnosticReports \
     -maxdepth 1 -iname 'LaughCounter*' 2>/dev/null)"
NEWEST_CRASH=""
if [ -n "$CRASH_LIST" ]; then
  # shellcheck disable=SC2086
  echo "$CRASH_LIST" | tr '\n' '\0' | xargs -0 ls -lt 2>/dev/null | head -10 >>"$OUT"
  NEWEST_CRASH="$(echo "$CRASH_LIST" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null | head -1)"
fi
if [ -n "$NEWEST_CRASH" ]; then
  echo "" >>"$OUT"
  echo "--- head of newest crash report: $NEWEST_CRASH ---" >>"$OUT"
  head -80 "$NEWEST_CRASH" >>"$OUT" 2>&1
  echo "" >>"$OUT"
  echo "--- exception / termination lines ---" >>"$OUT"
  grep -iE 'exception|termination|abort|required condition|signal' "$NEWEST_CRASH" \
    | head -30 >>"$OUT" 2>&1
else
  echo "(no LaughCounter crash reports found)" >>"$OUT"
fi

# --- 3. The app's own account of the sleep/wake ---------------------------
section "app activity log (last 150 lines)"
if [ -f "$APP_LOG" ]; then
  echo "path: $APP_LOG" >>"$OUT"
  echo "size: $(stat -f%z "$APP_LOG") bytes, last modified $(stat -f%Sm "$APP_LOG")" >>"$OUT"
  echo "" >>"$OUT"
  tail -150 "$APP_LOG" >>"$OUT"
else
  echo "no activity log at $APP_LOG" >>"$OUT"
fi

# --- 4. Sleep/wake history ------------------------------------------------
# Lines up the app log against what the machine actually did: which wake it
# was, how long the sleep lasted, and whether it was a dark wake.
section "power management sleep/wake history (last 60 events)"
pmset -g log 2>/dev/null \
  | grep -E 'Sleep  |Wake  |DarkWake|Notification' \
  | tail -60 >>"$OUT"

section "current power assertions"
pmset -g assertions >>"$OUT" 2>&1

# --- 5. What CoreAudio thinks ---------------------------------------------
section "CoreAudio HAL probe"
if command -v swift >/dev/null 2>&1; then
  if [ "${1:-}" = "--capture" ]; then
    swift "$HERE/mic-probe.swift" --capture >>"$OUT" 2>&1
  else
    swift "$HERE/mic-probe.swift" >>"$OUT" 2>&1
  fi
else
  echo "swift not found — install the Xcode command line tools (xcode-select --install)" >>"$OUT"
fi

section "system_profiler audio input devices"
system_profiler SPAudioDataType 2>/dev/null >>"$OUT"

section "coreaudiod"
ps -o pid,lstart,etime,%cpu,command -p "$(pgrep -x coreaudiod | head -1)" >>"$OUT" 2>&1

# --- 6. Unified log around the wake ---------------------------------------
# NSLog from the app plus whatever coreaudiod said. The app's own log misses
# anything that happened after an abort; this does not.
section "unified log: LaughCounter (last 3h)"
log show --last 3h --style compact \
  --predicate 'process == "LaughCounter" OR eventMessage CONTAINS "LaughCounter"' \
  2>/dev/null | tail -200 >>"$OUT"

section "unified log: coreaudiod errors/faults (last 3h)"
log show --last 3h --style compact --predicate \
  'process == "coreaudiod" AND (messageType == error OR messageType == fault)' \
  2>/dev/null | tail -150 >>"$OUT"

section "unified log: device add/remove around the wake (last 3h)"
log show --last 3h --style compact --predicate \
  '(subsystem == "com.apple.coreaudio") AND (eventMessage CONTAINS[c] "device" OR eventMessage CONTAINS[c] "IOProc")' \
  2>/dev/null | tail -150 >>"$OUT"

echo "" >&3
echo "Report written to: $OUT" >&3
echo "" >&3
echo "Summary:" >&3
{
  if [ -z "$PIDS" ]; then
    echo "  process: NOT RUNNING"
  else
    FIRST_PID="$(echo "$PIDS" | head -1)"
    echo "  process: running (pid $FIRST_PID), started $(ps -o lstart= -p "$FIRST_PID" | xargs)"
  fi
  if [ -n "$NEWEST_CRASH" ]; then
    echo "  crash reports: present, newest $(basename "$NEWEST_CRASH")"
  else
    echo "  crash reports: none"
  fi
  if [ -f "$APP_LOG" ]; then
    echo "  last app log line: $(tail -1 "$APP_LOG")"
  fi
} >&3
echo "" >&3
echo "Send that file back (it contains no audio and no laugh data)." >&3

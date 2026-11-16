#!/usr/bin/env bash
# Thin sudo entry point for nusa-control: one exclusive lock for every verb, then the pinned controller. No decisions here.
set -euo pipefail
readonly LOCK_DIR=/run/nusa-control
readonly LOCK_FILE="${LOCK_DIR}/lock"
fail() { printf '{"ok":false,"code":"%s"}\n' "$1"; exit 75; }
[ -e "$LOCK_DIR" ] || install -d -o root -g root -m 0700 "$LOCK_DIR" || fail LOCK_DIR_CREATE_FAILED
[[ -d "$LOCK_DIR" && ! -L "$LOCK_DIR" ]] || fail LOCK_DIR_NOT_A_REAL_DIRECTORY
[[ "$(stat -c '%u:%g:%a' -- "$LOCK_DIR")" == "0:0:700" ]] || fail LOCK_DIR_UNSAFE
[[ ! -L "$LOCK_FILE" ]] || fail LOCK_FILE_IS_A_SYMLINK
umask 077
exec 9>>"$LOCK_FILE" || fail LOCK_OPEN_FAILED
# Checked on the OPEN file descriptor (stat -L on /proc/self/fd/9), not on the path: what is locked is what was verified.
[[ "$(stat -L -c '%F' /proc/self/fd/9)" == "regular file" || "$(stat -L -c '%F' /proc/self/fd/9)" == "regular empty file" ]] || fail LOCK_FILE_NOT_REGULAR
[[ "$(stat -L -c '%u:%g:%a' /proc/self/fd/9)" == "0:0:600" ]] || fail LOCK_FILE_UNSAFE
# reconcile and verify never wait for another command: the start gate runs INSIDE `collect` (which holds this lock while it
# restarts the runtime), so waiting would deadlock. With the lock busy they run read-only (see nusa-control.js).
case "${1:-}" in
  reconcile|verify)
    if ! flock -n 9; then exec /usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa-control/nusa-control.js "$@" --readonly; fi ;;
  # An emergency stop waits longer than a periodic verify can hold the lock (its retries are bounded, see nusa-control.js).
  # The stop marker is created BEFORE waiting for the lock (design C4 3.4): from then on the start gate denies every start. The marker names
  # this process (pid and start time) so a leftover one can be told from a live stop; it is exclusive (noclobber) and root-only.
  # If the lock is still not free after 90 s, the units are stopped directly (stopping is always safe) and the marker stays.
  stop)
    ident="$(sed -E 's/^.*\) //' "/proc/$$/stat" | cut -d' ' -f20)"
    ( set -o noclobber; printf '{"pid":%s,"ident":"%s","createdAt":%s}\n' "$$" "$ident" "$(date +%s%3N)" > "${LOCK_DIR}/stop-requested" ) 2>/dev/null || true
    if ! flock -w 90 9; then
      for unit in nusa-research.timer nusa.service nusa-research.service; do
        systemctl disable "$unit" >/dev/null 2>&1 || true
        systemctl stop "$unit" >/dev/null 2>&1 || true
      done
      printf '{"ok":false,"code":"STOP_UNLOCKED"}\n'; exit 75
    fi ;;
  *) flock -w 30 9 || fail LOCK_BUSY ;;
esac
exec /usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa-control/nusa-control.js "$@"

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
  stop) flock -w 90 9 || fail LOCK_BUSY ;;
  *) flock -w 30 9 || fail LOCK_BUSY ;;
esac
exec /usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa-control/nusa-control.js "$@"

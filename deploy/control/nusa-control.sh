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
[[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" ]] || fail LOCK_FILE_NOT_REGULAR
[[ "$(stat -c '%u:%g:%a' -- "$LOCK_FILE")" == "0:0:600" ]] || fail LOCK_FILE_UNSAFE
flock -w 30 9 || fail LOCK_BUSY
exec /usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa-control/nusa-control.js "$@"

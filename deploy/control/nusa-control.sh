#!/usr/bin/env bash
# Thin sudo entry point for nusa-control: one exclusive lock for every verb, then the pinned controller. No decisions here.
set -euo pipefail
readonly LOCK_DIR=/run/nusa-control
install -d -o root -g root -m 0700 "$LOCK_DIR"
exec 9>>"${LOCK_DIR}/lock"
flock -w 30 9 || { echo '{"ok":false,"code":"LOCK_BUSY"}'; exit 75; }
exec /usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa-control/nusa-control.js "$@"

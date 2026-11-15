#!/usr/bin/env bash
# One-time install of the NUSA host controller (design v5, C3b). Run as root on the PAPER host.
#
#   sudo bash install.sh <full-commit-sha> <sha256-of-nusa-control.js>            preflight only: READ-ONLY, changes nothing
#   sudo bash install.sh <full-commit-sha> <sha256-of-nusa-control.js> --apply    install, then init and collect
#   sudo bash install.sh <full-commit-sha> --rollback                              remove the controller, restore the old start
#
# The files come from the STAGED RELEASE of that commit (/opt/nusa/releases/<sha>/deploy/control); the hash given on the
# command line (printed in the reviewed pull request) must match the file, so a tampered release tree is refused. Preflight
# prints PASS or FAIL for every precondition; --apply refuses to run unless every one passes. It never touches the database,
# the lease, the release link, any secret or the order switch; the runtime environment file is only READ (one exact line).
# It can only close things: the controller can write COLLECT_ONLY and nothing else.
set -euo pipefail

SHA="${1:-}"; HASH_ARG="${2:-}"; MODE="preflight"
for a in "$@"; do case "$a" in --apply) MODE="apply";; --rollback) MODE="rollback";; esac; done
# NUSA_INSTALL_ROOT lets the tests run the whole script against a temporary directory tree; it is empty on the host.
R="${NUSA_INSTALL_ROOT:-}"
if [ -n "$R" ]; then OWN=(); else OWN=(-o root -g root); fi
SRC="$R/opt/nusa/releases/$SHA/deploy/control"
fails=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }
die() { printf 'STOP  %s\n' "$*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "first argument must be the full lowercase commit sha of the staged release"
safe_dir() { # real directory, owned by root, not writable by group or others
  local d="$R$1" owner mode
  [ -d "$d" ] && [ ! -L "$d" ] || return 1
  owner="$(stat -c '%u' -- "$d")"; mode="$(stat -c '%a' -- "$d")"
  { [ -n "$R" ] || [ "$owner" = 0 ]; } && [ $(( 8#$mode & 8#022 )) -eq 0 ]
}
control_hash() { sha256sum -- "$SRC/nusa-control.js" | cut -d' ' -f1; }
sysctl() { systemctl "$@"; }

preflight() {
  echo "== preflight (read-only) for $SHA"
  [ -n "$R" ] || check "running as root" test "$(id -u)" = 0
  check "release $SHA is staged" test -d "$R/opt/nusa/releases/$SHA"
  check "release $SHA is the active release" test "$(readlink -f "$R/opt/nusa/current" 2>/dev/null)" = "$(readlink -f "$R/opt/nusa/releases/$SHA" 2>/dev/null)"
  for f in nusa-control.js nusa-control.sh nusa-control-reconcile.service nusa-control-verify.service nusa-control-verify.timer dropins/nusa.service.d/10-control-gate.conf dropins/nusa.service.d/20-run-mode.conf dropins/nusa-research.timer.d/10-control-gate.conf dropins/nusa-research.service.d/10-control-gate.conf; do
    check "source file $f" test -f "$SRC/$f" -a ! -L "$SRC/$f"
  done
  if [ -f "$SRC/nusa-control.js" ]; then
    printf 'INFO  sha256 nusa-control.js = %s\n' "$(control_hash)"
    if [ -n "$HASH_ARG" ] && [[ "$HASH_ARG" =~ ^[0-9a-f]{64}$ ]]; then check "nusa-control.js matches the hash from the reviewed pull request" test "$(control_hash)" = "$HASH_ARG"; else [ "$MODE" = apply ] && fail "second argument must be the sha256 of nusa-control.js"; fi
  fi
  for d in /opt /opt/nusa /etc /etc/nusa /etc/systemd/system /var/lib; do check "directory $d is real, root-owned and not group/other-writable" safe_dir "$d"; done
  check "orders are explicitly OFF in the runtime environment (NUSA_PAPER_ORDER_PATH=OFF)" grep -qx 'NUSA_PAPER_ORDER_PATH=OFF' "$R/etc/nusa/cloud-runtime.env"
  check "no NUSA_RUN_MODE is set in the runtime environment file yet" bash -c "! grep -q '^NUSA_RUN_MODE=' '$R/etc/nusa/cloud-runtime.env'"
  check "nusa.service is active" sysctl is-active --quiet nusa.service
  local hf; hf="$(mktemp)"; trap 'rm -f "$hf"' RETURN
  curl -fsS -m 6 http://127.0.0.1:41731/health >"$hf" 2>/dev/null || true
  check "/health answers with this commit as the running build" grep -q "\"sourceCommitSha\":\"$SHA\"" "$hf"
  check "/health reports runMode COLLECT_ONLY (the new runtime is running)" grep -q '"runMode":"COLLECT_ONLY"' "$hf"
  check "no controller state file exists yet" test ! -e "$R/var/lib/nusa-control/state.json"
  check "the controller is not installed yet" test ! -e "$R/opt/nusa-control/nusa-control.js"
  echo "== preflight result: $fails failure(s)"
}

apply() {
  [ "$fails" -eq 0 ] || die "preflight has failures; nothing was changed"
  step() { printf '\n>> %s\n' "$*"; }
  trap 'echo "STOP  failed at: ${CURRENT:-?}. The controller may be partly installed. Nothing orders (orders are OFF). Run:  sudo bash $0 $SHA --rollback" >&2' ERR
  CURRENT="mode file"; step "$CURRENT"
  install "${OWN[@]}" -m 0644 /dev/stdin "$R/etc/nusa/run-mode.env" <<<"NUSA_RUN_MODE=COLLECT_ONLY"
  CURRENT="state directory"; step "$CURRENT"
  install "${OWN[@]}" -d -m 0700 "$R/var/lib/nusa-control"
  CURRENT="controller files"; step "$CURRENT"
  install "${OWN[@]}" -d -m 0755 "$R/opt/nusa-control"
  install "${OWN[@]}" -m 0755 "$SRC/nusa-control.js" "$R/opt/nusa-control/nusa-control.js"
  install "${OWN[@]}" -m 0755 "$SRC/nusa-control.sh" "$R/opt/nusa-control/nusa-control.sh"
  [ "$(sha256sum -- "$R/opt/nusa-control/nusa-control.js" | cut -d' ' -f1)" = "$HASH_ARG" ] || die "installed controller does not match the reviewed hash"
  CURRENT="units and drop-ins"; step "$CURRENT"
  for u in nusa-control-reconcile.service nusa-control-verify.service nusa-control-verify.timer; do install "${OWN[@]}" -m 0644 "$SRC/$u" "$R/etc/systemd/system/$u"; done
  for u in nusa.service nusa-research.timer nusa-research.service; do
    install "${OWN[@]}" -d -m 0755 "$R/etc/systemd/system/$u.d"
    for c in "$SRC"/dropins/"$u".d/*.conf; do install "${OWN[@]}" -m 0644 "$c" "$R/etc/systemd/system/$u.d/$(basename "$c")"; done
  done
  sysctl daemon-reload
  CURRENT="enable the gate and the periodic verify"; step "$CURRENT"
  sysctl enable nusa-control-reconcile.service nusa-control-verify.timer
  sysctl start nusa-control-verify.timer
  CURRENT="init (records the running build and STOPS every runtime unit)"; step "$CURRENT"
  "$R/opt/nusa-control/nusa-control.sh" init "$SHA"
  CURRENT="collect (starts the runtime in COLLECT_ONLY and verifies it)"; step "$CURRENT"
  "$R/opt/nusa-control/nusa-control.sh" collect
  CURRENT="status"; step "$CURRENT"
  "$R/opt/nusa-control/nusa-control.sh" status
  trap - ERR
  echo; echo "DONE  controller installed; runtime verified in COLLECT_ONLY."
}

rollback() {
  echo "== rollback: remove the controller and restore the previous start behaviour (orders stay OFF)"
  sysctl disable --now nusa-control-verify.timer 2>/dev/null || true
  sysctl disable nusa-control-reconcile.service 2>/dev/null || true
  for u in nusa.service nusa-research.timer nusa-research.service; do rm -f "$R/etc/systemd/system/$u.d/10-control-gate.conf" "$R/etc/systemd/system/$u.d/20-run-mode.conf"; rmdir "$R/etc/systemd/system/$u.d" 2>/dev/null || true; done
  rm -f "$R/etc/systemd/system/nusa-control-reconcile.service" "$R/etc/systemd/system/nusa-control-verify.service" "$R/etc/systemd/system/nusa-control-verify.timer" "$R/etc/nusa/run-mode.env"
  sysctl daemon-reload
  sysctl enable nusa.service nusa-research.timer
  sysctl restart nusa.service
  sysctl start nusa-research.timer
  echo "DONE  rolled back. The controller files and the state file are kept for inspection: /opt/nusa-control, /var/lib/nusa-control"
}

case "$MODE" in
  preflight) preflight; [ "$fails" -eq 0 ] && echo "Preflight passed. Re-run with --apply to install." || exit 1 ;;
  apply) preflight; apply ;;
  rollback) rollback ;;
esac

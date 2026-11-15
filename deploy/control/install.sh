#!/usr/bin/env bash
# One-time install of the NUSA host controller (design v5, C3b). Run as root on the PAPER host.
#
#   sudo bash install.sh <full-commit-sha> <manifest-sha256>            preflight only: READ-ONLY, changes nothing
#   sudo bash install.sh <full-commit-sha> <manifest-sha256> --apply    install, then init and collect
#   sudo bash install.sh <full-commit-sha> --rollback                    remove what this script installed, restore the old start
#
# The files come from the STAGED RELEASE of that commit (/opt/nusa/releases/<sha>/deploy/control). They are first copied into a
# root-only private directory; the manifest hash given on the command line (printed in the reviewed pull request, it covers
# EVERY file of deploy/control except this script) must match that private copy, and everything is installed from the copy, so
# a release tree that is changed after the check cannot change what is installed. Preflight
# prints PASS or FAIL for every precondition; --apply refuses to run unless every one passes. It never touches the database,
# the lease, the release link, any secret or the order switch; the runtime environment file is only READ (one exact line).
# NOT an access audit: it does not check other accounts' sudo rights, SSH settings, cron/at/polkit or runners. Do not cite it as such.
# It can only close things: the controller can write COLLECT_ONLY and nothing else.
set -euo pipefail

SHA="${1:-}"; HASH_ARG="${2:-}"; MODE="preflight"
for a in "$@"; do case "$a" in --apply) MODE="apply";; --rollback) MODE="rollback";; esac; done
# NUSA_INSTALL_ROOT lets the tests run the whole script against a temporary directory tree. It is refused unless the test flag is
# also set, so a stray variable can never redirect a root install on the host; on the host the PATH is fixed.
R="${NUSA_INSTALL_ROOT:-}"
if [ -n "$R" ]; then
  [ "${NUSA_INSTALL_TEST_MODE:-}" = "yes-this-is-a-test-tree" ] || { echo "STOP  NUSA_INSTALL_ROOT is for tests only; unset it" >&2; exit 1; }
  # The real host always has the release helper; a test root is refused there even with both variables set.
  if [ -e /opt/nusa/bin/nusa-release-step ]; then echo "STOP  this is the real host; a test root is not allowed here" >&2; exit 1; fi
else
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
fi
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
# One hash over every file of deploy/control except this script: "<sha256>  ./relative/path" lines, sorted by path.
manifest_of() { ( cd "$1" && find . -type f ! -name install.sh -print0 | LC_ALL=C sort -z | xargs -0 sha256sum ); }
manifest_hash() { manifest_of "$1" | sha256sum | cut -d' ' -f1; }
no_symlinks_in() { [ -z "$(find "$1" -type l -print -quit)" ]; }
# Orders must be OFF from EVERY environment source: exactly one NUSA_PAPER_ORDER_PATH line in the runtime env file and it is OFF,
# the unit's own Environment and any drop-in do not set it. Used before the install and again before a rollback restarts anything.
orders_off_everywhere() {
  [ "$(grep -c '^NUSA_PAPER_ORDER_PATH=' "$R/etc/nusa/cloud-runtime.env")" = 1 ] || return 1
  grep -qx 'NUSA_PAPER_ORDER_PATH=OFF' "$R/etc/nusa/cloud-runtime.env" || return 1
  # Fail closed: every systemd query must SUCCEED and make sense; a failed or empty query is "not proven", never "OFF".
  local id env files line f
  id="$(sysctl show nusa.service -p Id --value 2>/dev/null)" || return 1
  [ "$id" = "nusa.service" ] || return 1
  env="$(sysctl show nusa.service -p Environment --value 2>/dev/null)" || return 1
  if grep -q 'NUSA_PAPER_ORDER_PATH' <<<"$env"; then return 1; fi
  # Only these two files may feed the unit's environment; any other EnvironmentFile could set the order switch.
  files="$(sysctl show nusa.service -p EnvironmentFiles --value 2>/dev/null)" || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    f="${line%% (*}"
    case "$f" in "$R/etc/nusa/cloud-runtime.env"|"$R/etc/nusa/run-mode.env") ;; *) return 1;; esac
  done <<<"$files"
  # Only an assignment counts; the controller's own drop-in names the variable in UnsetEnvironment= (which closes it).
  ! grep -rEqs '^[[:space:]]*Environment=.*NUSA_PAPER_ORDER_PATH' "$R/etc/systemd/system/nusa.service" "$R/etc/systemd/system/nusa.service.d" 2>/dev/null || return 1
}
sysctl() { systemctl "$@"; }
UNITS_TOP="nusa-control-reconcile.service nusa-control-verify.service nusa-control-verify.timer"
DROPIN_UNITS="nusa.service nusa-research.timer nusa-research.service"
# Every file this script installs, relative to the root (no leading slash). The install manifest lists their hashes.
managed_files() {
  echo "etc/nusa/run-mode.env"; echo "opt/nusa-control/nusa-control.js"; echo "opt/nusa-control/nusa-control.sh"
  local u c; for u in $UNITS_TOP; do echo "etc/systemd/system/$u"; done
  for u in $DROPIN_UNITS; do for c in "$SRC"/dropins/"$u".d/*.conf; do echo "etc/systemd/system/$u.d/$(basename "$c")"; done; done
}
MANIFEST_FILE="$R/opt/nusa-control/INSTALL-MANIFEST"
# A second copy of the manifest's own hash is kept in the root-only state directory: changing the manifest AND the files is not enough.
MANIFEST_ANCHOR="$R/var/lib/nusa-control/install-manifest.sha256"
# Every managed file is a plain file (no link), owned by root (test trees: any owner) and not writable by group or others.
managed_files_sound() {
  local f p owner mode
  for f in $(managed_files) opt/nusa-control/INSTALL-MANIFEST; do
    p="$R/$f"
    [ -f "$p" ] && [ ! -L "$p" ] || return 1
    owner="$(stat -c '%u' -- "$p")"; mode="$(stat -c '%a' -- "$p")"
    { [ -n "$R" ] || [ "$owner" = 0 ]; } && [ $(( 8#$mode & 8#022 )) -eq 0 ] || return 1
  done
}

preflight() {
  echo "== preflight (read-only) for $SHA"
  [ -n "$R" ] || check "running as root" test "$(id -u)" = 0
  check "release $SHA is staged" test -d "$R/opt/nusa/releases/$SHA"
  check "release $SHA is the active release" test "$(readlink -f "$R/opt/nusa/current" 2>/dev/null)" = "$(readlink -f "$R/opt/nusa/releases/$SHA" 2>/dev/null)"
  check "source tree has no symlinks" no_symlinks_in "$SRC"
  for f in nusa-control.js nusa-control.sh nusa-control-reconcile.service nusa-control-verify.service nusa-control-verify.timer dropins/nusa.service.d/10-control-gate.conf dropins/nusa.service.d/20-run-mode.conf dropins/nusa-research.timer.d/10-control-gate.conf dropins/nusa-research.service.d/10-control-gate.conf; do
    check "source file $f" test -f "$SRC/$f" -a ! -L "$SRC/$f"
  done
  if [ -d "$SRC" ] && no_symlinks_in "$SRC"; then
    printf 'INFO  manifest sha256 of the release copy = %s\n' "$(manifest_hash "$SRC")"
    if [[ "$HASH_ARG" =~ ^[0-9a-f]{64}$ ]]; then check "every control file matches the manifest hash from the reviewed pull request" test "$(manifest_hash "$SRC")" = "$HASH_ARG"; else fail "second argument must be the manifest sha256 (64 lowercase hex) of the reviewed pull request"; fi
  fi
  for d in /opt /opt/nusa /etc /etc/nusa /etc/systemd/system /var/lib; do check "directory $d is real, root-owned and not group/other-writable" safe_dir "$d"; done
  check "orders are OFF from every environment source (one NUSA_PAPER_ORDER_PATH=OFF line, nothing in the unit or drop-ins)" orders_off_everywhere
  check "no NUSA_RUN_MODE is set in the runtime environment file yet" bash -c "! grep -q '^NUSA_RUN_MODE=' '$R/etc/nusa/cloud-runtime.env'"
  check "nusa.service is active" sysctl is-active --quiet nusa.service
  local health; health="$(curl -fsS -m 6 http://127.0.0.1:41731/health 2>/dev/null || true)"
  check "/health is valid JSON from the commit $SHA in mode COLLECT_ONLY (the new runtime is running)" node -e 'const h=JSON.parse(process.argv[1]).runtime; process.exit(h && h.sourceCommitSha===process.argv[2] && h.runMode==="COLLECT_ONLY" ? 0 : 1)' "$health" "$SHA"
  check "no controller state file exists yet" test ! -e "$R/var/lib/nusa-control/state.json"
  check "the controller is not installed yet" test ! -e "$R/opt/nusa-control/nusa-control.js"
  echo "== preflight result: $fails failure(s)"
}

apply() {
  [ "$fails" -eq 0 ] || die "preflight has failures; nothing was changed"
  step() { printf '\n>> %s\n' "$*"; }
  trap 'echo "STOP  failed at: ${CURRENT:-?}. The controller may be partly installed. Nothing orders (orders are OFF). Run:  sudo bash $0 $SHA --rollback" >&2' ERR
  CURRENT="private copy"; step "$CURRENT"
  # Copy once into a root-only directory, verify THAT copy, install only from it: later changes to the release tree cannot matter.
  stage="$(mktemp -d "$R/var/lib/.nusa-install.XXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT
  chmod 0700 "$stage"
  cp -a --no-dereference -- "$SRC/." "$stage/"
  no_symlinks_in "$stage" || die "the private copy contains a symlink"
  [ "$(manifest_hash "$stage")" = "$HASH_ARG" ] || die "the private copy does not match the reviewed manifest hash"
  local S="$stage"
  CURRENT="mode file"; step "$CURRENT"
  install "${OWN[@]}" -m 0644 /dev/stdin "$R/etc/nusa/run-mode.env" <<<"NUSA_RUN_MODE=COLLECT_ONLY"
  CURRENT="state directory"; step "$CURRENT"
  install "${OWN[@]}" -d -m 0700 "$R/var/lib/nusa-control"
  CURRENT="controller files"; step "$CURRENT"
  install "${OWN[@]}" -d -m 0755 "$R/opt/nusa-control"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.js" "$R/opt/nusa-control/nusa-control.js"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.sh" "$R/opt/nusa-control/nusa-control.sh"
  CURRENT="units and drop-ins"; step "$CURRENT"
  local u c
  for u in $UNITS_TOP; do install "${OWN[@]}" -m 0644 "$S/$u" "$R/etc/systemd/system/$u"; done
  for u in $DROPIN_UNITS; do
    install "${OWN[@]}" -d -m 0755 "$R/etc/systemd/system/$u.d"
    for c in "$S"/dropins/"$u".d/*.conf; do install "${OWN[@]}" -m 0644 "$c" "$R/etc/systemd/system/$u.d/$(basename "$c")"; done
  done
  CURRENT="install manifest"; step "$CURRENT"
  ( cd "${R:-/}" && managed_files | xargs sha256sum ) > "$stage/manifest.out"
  install "${OWN[@]}" -m 0644 "$stage/manifest.out" "$MANIFEST_FILE"
  sha256sum -- "$stage/manifest.out" | cut -d' ' -f1 | install "${OWN[@]}" -m 0600 /dev/stdin "$MANIFEST_ANCHOR"
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
  echo "== rollback: remove what this script installed and restore the previous start behaviour (orders stay OFF)"
  # Refuse unless the files on disk are exactly what the install wrote, and orders are OFF from every source: a rollback
  # restarts the runtime, so it must never run on a host that was changed by hand.
  [ -f "$MANIFEST_FILE" ] && [ ! -L "$MANIFEST_FILE" ] || die "no install manifest at $MANIFEST_FILE; refusing to roll back (nothing was changed)"
  [ -f "$MANIFEST_ANCHOR" ] && [ ! -L "$MANIFEST_ANCHOR" ] && [ "$(sha256sum -- "$MANIFEST_FILE" | cut -d' ' -f1)" = "$(cat -- "$MANIFEST_ANCHOR")" ] || die "the install manifest does not match its anchor in the state directory; refusing to roll back (nothing was changed)"
  managed_files_sound || die "a managed file is missing, is a link, or has unsafe owner or mode; refusing to roll back (nothing was changed)"
  ( cd "${R:-/}" && sha256sum --check --strict --quiet "$MANIFEST_FILE" ) >/dev/null 2>&1 || die "a managed file differs from the install manifest; refusing to roll back (nothing was changed)"
  orders_off_everywhere || die "orders are not OFF from every environment source; refusing to roll back (nothing was changed)"
  sysctl disable --now nusa-control-verify.timer 2>/dev/null || true
  sysctl disable nusa-control-reconcile.service 2>/dev/null || true
  local u
  for u in $DROPIN_UNITS; do rm -f "$R/etc/systemd/system/$u.d/10-control-gate.conf" "$R/etc/systemd/system/$u.d/20-run-mode.conf"; rmdir "$R/etc/systemd/system/$u.d" 2>/dev/null || true; done
  for u in $UNITS_TOP; do rm -f "$R/etc/systemd/system/$u"; done
  rm -f "$R/etc/nusa/run-mode.env"
  sysctl daemon-reload
  orders_off_everywhere || die "orders are not OFF after removing the drop-ins; NOT restarting anything"
  sysctl enable nusa.service nusa-research.timer
  sysctl restart nusa.service
  sysctl start nusa-research.timer
  echo "DONE  rolled back. The controller files, the install manifest and the state file are kept for inspection: /opt/nusa-control, /var/lib/nusa-control"
}

case "$MODE" in
  preflight) preflight; [ "$fails" -eq 0 ] && echo "Preflight passed. Re-run with --apply to install." || exit 1 ;;
  apply) preflight; apply ;;
  rollback) rollback ;;
esac

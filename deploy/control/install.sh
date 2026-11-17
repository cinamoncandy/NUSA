#!/usr/bin/env bash
# One-time install of the NUSA host controller (design v5, C3b). Run as root on the PAPER host.
#
#   sudo bash install.sh <full-commit-sha> <manifest-sha256>            preflight only: READ-ONLY, changes nothing
#   sudo bash install.sh <full-commit-sha> <manifest-sha256> --apply    install, then init and collect
#   sudo bash install.sh <full-commit-sha> --rollback                    remove what this script installed, restore the old start
#   ... <sha> <manifest-sha256> [--apply] --after-rollback               install again after a rollback of this script (see below)
#   ... <sha> <manifest-sha256> --upgrade-controller [--apply]           replace ONLY the two controller files and the manifest of an
#        installed, verified COLLECT_ONLY host with those of the staged release <sha> (units, drop-ins, state and runtime untouched,
#        nothing restarted); the release does NOT have to be the running one. Preflight (without --apply) is read-only. After the swap
#        the new controller must report the runtime verified by its read-only `status` (never by `verify`, which can stop the runtime);
#        otherwise the old files are put back (backups *.upgrade-backup-<UTC>-<pid> are kept).
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
AFTER=0; UPG=0
for a in "$@"; do case "$a" in --apply) MODE="apply";; --rollback) MODE="rollback";; --after-rollback) AFTER=1;; --upgrade-controller) UPG=1;; esac; done
if [ "$UPG" = 1 ] && { [ "$MODE" = rollback ] || [ "$AFTER" = 1 ]; }; then echo "STOP  --upgrade-controller cannot be combined with --rollback or --after-rollback" >&2; exit 1; fi
# NUSA_INSTALL_ROOT lets the tests run the whole script against a temporary directory tree. It is refused unless the test flag is
# also set, so a stray variable can never redirect a root install on the host; on the host the PATH is fixed.
R="${NUSA_INSTALL_ROOT:-}"
if [ -n "$R" ]; then
  [ "${NUSA_INSTALL_TEST_MODE:-}" = "yes-this-is-a-test-tree" ] || { echo "STOP  NUSA_INSTALL_ROOT is for tests only; unset it" >&2; exit 1; }
  # Any trace of a real installation (helper, release tree, runtime env, systemd unit, state) refuses a test root, even with both variables set.
  for real in /opt/nusa /etc/nusa /var/lib/nusa /var/lib/nusa-control /etc/systemd/system/nusa.service; do
    if [ -e "$real" ] || [ -L "$real" ]; then echo "STOP  this looks like the real host ($real exists); a test root is not allowed here" >&2; exit 1; fi
  done
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
# Orders must be OFF from EVERY environment source: every NUSA_PAPER_ORDER_PATH mention in the runtime env file is exactly the OFF line,
# the unit's own Environment and any drop-in do not set it. Used before the install and again before a rollback restarts anything.
orders_off_everywhere() {
  # The env file may repeat the OFF line (the real host has it twice); what matters is that EVERY line that mentions the switch,
  # in any spelling (spaces, export, quotes, comments), is exactly NUSA_PAPER_ORDER_PATH=OFF, and at least one exists.
  # grep -c exits 0 (matches) or 1 (none, prints 0); any other status is an error and means "not proven", even when it printed a number.
  local mentions exact rc=0
  mentions="$(grep -c 'NUSA_PAPER_ORDER_PATH' "$R/etc/nusa/cloud-runtime.env")" || rc=$?
  [ "$rc" = 0 ] || [ "$rc" = 1 ] || return 1
  rc=0
  exact="$(grep -cx 'NUSA_PAPER_ORDER_PATH=OFF' "$R/etc/nusa/cloud-runtime.env")" || rc=$?
  [ "$rc" = 0 ] || [ "$rc" = 1 ] || return 1
  [[ "$mentions" =~ ^[0-9]+$ && "$exact" =~ ^[0-9]+$ ]] || return 1
  [ "$mentions" -ge 1 ] && [ "$mentions" = "$exact" ] || return 1
  # Fail closed: every systemd query must SUCCEED and make sense; a failed or empty query is "not proven", never "OFF".
  local id env files line f
  id="$(sysctl show nusa.service -p Id --value 2>/dev/null)" || return 1
  [ "$id" = "nusa.service" ] || return 1
  env="$(sysctl show nusa.service -p Environment --value 2>/dev/null)" || return 1
  if grep -q 'NUSA_PAPER_ORDER_PATH' <<<"$env"; then return 1; fi
  # Only these two files may feed the unit's environment, and cloud-runtime.env (which holds the OFF line) MUST be one of them:
  # a unit that does not read it would not be proven OFF. systemd may print the files one per line or several on one line,
  # each followed by "(ignore_errors=no|yes)"; both are split into one path per line before checking.
  files="$(sysctl show nusa.service -p EnvironmentFiles --value 2>/dev/null)" || return 1
  # Parse into one "path flag" line per file FIRST; a failing parser is a failure (never a partial list).
  local parsed flag extra seen_runtime=0
  parsed="$(sed -E 's/[[:space:]]*\(ignore_errors=([a-z]*)\)[[:space:]]*/ \1\n/g' <<<"$files")" || return 1
  while read -r f flag extra; do
    [ -n "$f" ] || continue
    [ -z "$extra" ] && [ -n "$flag" ] || return 1
    case "$f" in
      "$R/etc/nusa/cloud-runtime.env") [ "$flag" = no ] || return 1; seen_runtime=1 ;;   # a missing OFF file must stop the start
      "$R/etc/nusa/run-mode.env") [ "$flag" = no ] || return 1 ;;
      *) return 1 ;;
    esac
  done <<<"$parsed"
  [ "$seen_runtime" = 1 ] || return 1
  # Only an assignment counts; the controller's own drop-in names the variable in UnsetEnvironment= (which closes it).
  # grep exit 1 = no match (good); 0 = match and 2 = error are both "not proven OFF". The files are listed first and must be readable.
  local unitfiles
  [ -f "$R/etc/systemd/system/nusa.service" ] && [ ! -L "$R/etc/systemd/system/nusa.service" ] || return 1
  unitfiles=("$R/etc/systemd/system/nusa.service")
  if [ -e "$R/etc/systemd/system/nusa.service.d" ]; then
    [ -d "$R/etc/systemd/system/nusa.service.d" ] && [ ! -L "$R/etc/systemd/system/nusa.service.d" ] || return 1
    local d; for d in "$R"/etc/systemd/system/nusa.service.d/*; do [ -e "$d" ] || continue; [ -f "$d" ] && [ ! -L "$d" ] && [ -r "$d" ] || return 1; unitfiles+=("$d"); done
  fi
  local rc=0
  grep -Eq '^[[:space:]]*Environment=.*NUSA_PAPER_ORDER_PATH' "${unitfiles[@]}" 2>/dev/null || rc=$?
  [ "$rc" = 1 ] || return 1
  # When the mode file exists it must say exactly COLLECT_ONLY (the only value the controller writes).
  if [ -e "$R/etc/nusa/run-mode.env" ]; then
    [ -f "$R/etc/nusa/run-mode.env" ] && [ ! -L "$R/etc/nusa/run-mode.env" ] && [ "$(cat -- "$R/etc/nusa/run-mode.env")" = "NUSA_RUN_MODE=COLLECT_ONLY" ] || return 1
  fi
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
  # the state directory and the anchor: real directory / plain file, root-owned, closed to group and others (0700 / 0600)
  local sd="$R/var/lib/nusa-control"
  [ -d "$sd" ] && [ ! -L "$sd" ] && [ -f "$MANIFEST_ANCHOR" ] && [ ! -L "$MANIFEST_ANCHOR" ] || return 1
  for p in "$sd" "$MANIFEST_ANCHOR"; do
    owner="$(stat -c '%u' -- "$p")"; mode="$(stat -c '%a' -- "$p")"
    { [ -n "$R" ] || [ "$owner" = 0 ]; } && [ $(( 8#$mode & 8#077 )) -eq 0 ] || return 1
  done
  for f in $(managed_files) opt/nusa-control/INSTALL-MANIFEST; do
    p="$R/$f"
    # not installed yet (or already removed): nothing to check; a rollback is allowed at every failure point
    if [ ! -e "$p" ] && [ ! -L "$p" ]; then continue; fi
    [ -f "$p" ] && [ ! -L "$p" ] || return 1
    owner="$(stat -c '%u' -- "$p")"; mode="$(stat -c '%a' -- "$p")"
    { [ -n "$R" ] || [ "$owner" = 0 ]; } && [ $(( 8#$mode & 8#022 )) -eq 0 ] || return 1
  done
}

S=""   # the verified private copy (set by apply)
# SHA-256 of what apply installs at a path relative to the root, from the verified private copy (or the literal mode file).
expected_hash() {
  case "$1" in
    etc/nusa/run-mode.env) printf 'NUSA_RUN_MODE=COLLECT_ONLY\n' | sha256sum | cut -d' ' -f1 ;;
    opt/nusa-control/nusa-control.js) sha256sum -- "$S/nusa-control.js" | cut -d' ' -f1 ;;
    opt/nusa-control/nusa-control.sh) sha256sum -- "$S/nusa-control.sh" | cut -d' ' -f1 ;;
    etc/systemd/system/*.d/*) sha256sum -- "$S/dropins/${1#etc/systemd/system/}" | cut -d' ' -f1 ;;
    etc/systemd/system/*) sha256sum -- "$S/${1##*/}" | cut -d' ' -f1 ;;
    *) return 1 ;;
  esac
}
# Every managed file that exists must match the manifest; a file that does not exist (not installed yet, or already removed)
# is fine, because a rollback is allowed at every failure point of an install.
verify_manifest_files() {
  local h p
  while read -r h p; do
    [[ "$h" =~ ^[0-9a-f]{64}$ ]] && [ -n "$p" ] || return 1
    if [ -e "$R/$p" ] || [ -L "$R/$p" ]; then
      [ -f "$R/$p" ] && [ ! -L "$R/$p" ] || return 1
      [ "$(sha256sum -- "$R/$p" | cut -d' ' -f1)" = "$h" ] || return 1
    fi
  done < "$MANIFEST_FILE"
}
# Everything that must change together is prepared as *.new files next to its target and then swapped in by renames: the
# controller files and the manifest with its anchor. With --after-rollback the old state, and any old file that is replaced,
# are moved aside first (*.rolled-back-<UTC>-<pid>: never deleted, collision-proof). If ANY step fails every step is undone and
# the old leftovers are exactly as they were; once it succeeds the manifest matches the controller files that are in place, so a
# rollback works at every later failure point.
swap_in_install_set() {
  local stamp state="$R/var/lib/nusa-control/state.json" undo_list=() item t
  RECOVERY_FAILED=()
  local new_files=("$MANIFEST_FILE" "$MANIFEST_ANCHOR" "$R/opt/nusa-control/nusa-control.js" "$R/opt/nusa-control/nusa-control.sh")
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  undo() {   # returns 1 when everything was put back, 2 when a restore failed (RECOVERY_FAILED lists what is left where)
    local i kind rest x y
    for (( i=${#undo_list[@]}-1; i>=0; i-- )); do
      item="${undo_list[$i]}"; kind="${item%%|*}"; rest="${item#*|}"; x="${rest%%|*}"; y="${rest#*|}"
      case "$kind" in
        M) if ! mv -n -- "$y" "$x" || [ ! -e "$x" ] || [ -e "$y" ]; then RECOVERY_FAILED+=("$y should be at $x"); fi ;;
        # A file that was already renamed into place is renamed back to its *.new name (the reverse of the rename-in), never
        # deleted: if a later restore fails, the bytes the owner needs for the recovery are all still there.
        P) if ! mv -n -- "$x" "$x.new" || [ -e "$x" ] || [ ! -e "$x.new" ]; then RECOVERY_FAILED+=("$x should be back at $x.new"); fi ;;
      esac
    done
    if [ "${#RECOVERY_FAILED[@]}" -gt 0 ]; then KEEP_NEW=1; return 2; fi
    for t in "${new_files[@]}"; do rm -f -- "$t.new"; done
    return 1
  }
  aside() {   # move $1 to its collision-proof name when it exists; the source must really be gone afterwards
    local src="$1" dst="$1.rolled-back-$stamp"
    if [ ! -e "$src" ] && [ ! -L "$src" ]; then return 0; fi
    if [ -e "$dst" ] || [ -L "$dst" ]; then return 1; fi
    mv -n -- "$src" "$dst" || true
    # Record the move only when it really happened; a move that did nothing (mv -n can skip silently) needs no restore.
    if [ ! -e "$src" ] && [ -e "$dst" ]; then undo_list+=("M|$src|$dst"); return 0; fi
    if [ -e "$src" ] && [ ! -e "$dst" ]; then return 1; fi
    undo_list+=("M|$src|$dst"); return 1     # anything else is inconsistent: let undo try and report it
  }
  place() {   # rename $1.new into place; the .new must really be gone afterwards
    mv -n -- "$1.new" "$1" || true
    if [ ! -e "$1.new" ] && [ -e "$1" ]; then undo_list+=("P|$1|"); return 0; fi
    if [ -e "$1.new" ] && [ ! -e "$1" ]; then return 1; fi
    undo_list+=("P|$1|"); return 1
  }
  if [ "$AFTER" = 1 ]; then aside "$state" || { undo; return $?; }; fi
  for t in "${new_files[@]}"; do
    if [ -e "$t" ] || [ -L "$t" ]; then aside "$t" || { undo; return $?; }; fi
    place "$t" || { undo; return $?; }
  done
}

# After a rollback of this script the controller files, the install manifest, its anchor and the state file are kept for
# inspection, so a plain install refuses. --after-rollback accepts exactly that leftover and nothing else: the state says
# STOPPED with no attempt, intent or grant; the manifest matches its anchor; the two controller files are the recorded ones;
# no unit, drop-in or mode file of the controller is installed any more. The leftovers are moved aside (never deleted).
rolled_back_leftovers_ok() {
  local state="$R/var/lib/nusa-control/state.json" f
  [ -f "$state" ] && [ ! -L "$state" ] || return 1
  [ -f "$MANIFEST_FILE" ] && [ ! -L "$MANIFEST_FILE" ] && [ -f "$MANIFEST_ANCHOR" ] && [ ! -L "$MANIFEST_ANCHOR" ] || return 1
  [ "$(sha256sum -- "$MANIFEST_FILE" | cut -d' ' -f1)" = "$(cat -- "$MANIFEST_ANCHOR")" ] || return 1
  for f in opt/nusa-control/nusa-control.js opt/nusa-control/nusa-control.sh; do
    [ -f "$R/$f" ] && [ ! -L "$R/$f" ] || return 1
    grep -qF "$(sha256sum -- "$R/$f" | cut -d' ' -f1)  $f" "$MANIFEST_FILE" || return 1
  done
  # The state must be a VALID controller state (the controller's own validator: schema, version, active, adopted, proven, no
  # unknown field, no attempt, no grant), STOPPED or COLLECT_ONLY (a rollback AFTER a verified install leaves COLLECT_ONLY: its units are
  # removed and the next init stops everything and writes a fresh state), with no pending intent. The controller file was verified against the manifest above.
  node -e 'const fs=require("fs"); const c=require(process.argv[1]); const s=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); c.validateState(s); process.exit((s.desired==="STOPPED" || s.desired==="COLLECT_ONLY") && s.intent===null ? 0 : 1)' "$R/opt/nusa-control/nusa-control.js" "$state" || return 1
  for f in $(managed_files); do
    case "$f" in opt/nusa-control/*) ;; *) [ ! -e "$R/$f" ] && [ ! -L "$R/$f" ] || return 1 ;; esac
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
  # A runtime that is busy for a few seconds (a synchronous research job) can miss one probe: ask up to 3 times, 5 s apart, read-only.
  health_ok() {
    local n health
    for n in 1 2 3; do
      health="$(curl -fsS -m 6 http://127.0.0.1:41731/health 2>/dev/null || true)"
      node -e 'const h=JSON.parse(process.argv[1]).runtime; process.exit(h && h.sourceCommitSha===process.argv[2] && h.runMode==="COLLECT_ONLY" ? 0 : 1)' "$health" "$SHA" >/dev/null 2>&1 && return 0
      [ "$n" = 3 ] || sleep "${NUSA_INSTALL_HEALTH_RETRY_SLEEP:-5}"
    done
    return 1
  }
  check "/health is valid JSON from the commit $SHA in mode COLLECT_ONLY (the new runtime is running)" health_ok
  if [ "$AFTER" = 1 ]; then
    check "only the leftovers of a rollback of this script exist (state STOPPED without attempt, intent or grant; manifest matches its anchor; controller files as recorded; no unit, drop-in or mode file installed)" rolled_back_leftovers_ok
  else
    check "no controller state file exists yet" test ! -e "$R/var/lib/nusa-control/state.json"
    check "the controller is not installed yet" test ! -e "$R/opt/nusa-control/nusa-control.js"
  fi
  echo "== preflight result: $fails failure(s)"
}

apply() {
  [ "$fails" -eq 0 ] || die "preflight has failures; nothing was changed"
  step() { printf '\n>> %s\n' "$*"; }
  trap 'echo "STOP  failed at: ${CURRENT:-?}. The controller may be partly installed. Nothing orders (orders are OFF). Run:  sudo bash $0 $SHA --rollback" >&2' ERR
  CURRENT="private copy"; step "$CURRENT"
  # Copy once into a root-only directory, verify THAT copy, install only from it: later changes to the release tree cannot matter.
  stage="$(mktemp -d "$R/var/lib/.nusa-install.XXXXXX")"
  KEEP_NEW=0
  trap 'rm -rf -- "$stage"; [ "$KEEP_NEW" = 1 ] || rm -f -- "$MANIFEST_FILE.new" "$MANIFEST_ANCHOR.new" "$R/opt/nusa-control/nusa-control.js.new" "$R/opt/nusa-control/nusa-control.sh.new"' EXIT
  chmod 0700 "$stage"
  cp -a --no-dereference -- "$SRC/." "$stage/"
  no_symlinks_in "$stage" || die "the private copy contains a symlink"
  [ "$(manifest_hash "$stage")" = "$HASH_ARG" ] || die "the private copy does not match the reviewed manifest hash"
  S="$stage"
  local u c f
  CURRENT="state directory and controller directory"; step "$CURRENT"
  install "${OWN[@]}" -d -m 0700 "$R/var/lib/nusa-control"
  install "${OWN[@]}" -d -m 0755 "$R/opt/nusa-control"
  CURRENT="controller files and install manifest"; step "$CURRENT"
  # The manifest records the verified private copy. It and the controller files are prepared as *.new and swapped in together
  # (see swap_in_install_set), so the manifest always matches the controller files in place and a rollback works from here on.
  for f in $(managed_files); do printf '%s  %s\n' "$(expected_hash "$f")" "$f"; done > "$stage/manifest.out"
  install "${OWN[@]}" -m 0644 "$stage/manifest.out" "$MANIFEST_FILE.new"
  sha256sum -- "$stage/manifest.out" | cut -d' ' -f1 | install "${OWN[@]}" -m 0600 /dev/stdin "$MANIFEST_ANCHOR.new"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.js" "$R/opt/nusa-control/nusa-control.js.new"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.sh" "$R/opt/nusa-control/nusa-control.sh.new"
  local rc=0
  swap_in_install_set || rc=$?
  if [ "$rc" = 2 ]; then
    trap - ERR
    {
      echo "RECOVERY_REQUIRED  the swap failed AND putting the old files back failed. Nothing orders (orders are OFF); the old units are unchanged."
      printf '  %s\n' "${RECOVERY_FAILED[@]}"
      echo "  Every moved file is kept (*.rolled-back-*), and the prepared *.new files are kept. Do NOT run --apply or --rollback now; send this output."
    } >&2
    exit 3
  fi
  [ "$rc" = 0 ] || die "could not swap in the controller files and the manifest; everything was put back and nothing else was changed"
  CURRENT="mode file"; step "$CURRENT"
  install "${OWN[@]}" -m 0644 /dev/stdin "$R/etc/nusa/run-mode.env" <<<"NUSA_RUN_MODE=COLLECT_ONLY"
  CURRENT="units and drop-ins"; step "$CURRENT"
  for u in $UNITS_TOP; do install "${OWN[@]}" -m 0644 "$S/$u" "$R/etc/systemd/system/$u"; done
  for u in $DROPIN_UNITS; do
    install "${OWN[@]}" -d -m 0755 "$R/etc/systemd/system/$u.d"
    for c in "$S"/dropins/"$u".d/*.conf; do install "${OWN[@]}" -m 0644 "$c" "$R/etc/systemd/system/$u.d/$(basename "$c")"; done
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
  echo "== rollback: remove what this script installed and restore the previous start behaviour (orders stay OFF)"
  # Refuse unless the files on disk are exactly what the install wrote, and orders are OFF from every source: a rollback
  # restarts the runtime, so it must never run on a host that was changed by hand.
  [ -f "$MANIFEST_FILE" ] && [ ! -L "$MANIFEST_FILE" ] || die "no install manifest at $MANIFEST_FILE; refusing to roll back (nothing was changed)"
  [ -f "$MANIFEST_ANCHOR" ] && [ ! -L "$MANIFEST_ANCHOR" ] && [ "$(sha256sum -- "$MANIFEST_FILE" | cut -d' ' -f1)" = "$(cat -- "$MANIFEST_ANCHOR")" ] || die "the install manifest does not match its anchor in the state directory; refusing to roll back (nothing was changed)"
  managed_files_sound || die "a managed file is missing, is a link, or has unsafe owner or mode; refusing to roll back (nothing was changed)"
  verify_manifest_files || die "a managed file differs from the install manifest; refusing to roll back (nothing was changed)"
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

# ---- --upgrade-controller: replace the controller files in place, without touching the runtime ------------------------------------
controller_status_ok() {   # the installed controller's own read-only status: COLLECT_ONLY, no pending intent, runtime verified
  local out
  out="$("$R/opt/nusa-control/nusa-control.sh" status 2>/dev/null)" || return 1
  node -e 'const o=JSON.parse(process.argv[1]); process.exit(o.ok===true && o.state && o.state.desired==="COLLECT_ONLY" && o.state.intent===null && o.runtime && o.runtime.ok===true ? 0 : 1)' "$out"
}
units_unchanged() {   # an upgrade never changes units, drop-ins or the mode file: they must already be exactly the release's
  local f exp
  for f in $(managed_files); do
    case "$f" in
      opt/nusa-control/*) continue ;;
      etc/nusa/run-mode.env) [ "$(cat -- "$R/$f" 2>/dev/null)" = "NUSA_RUN_MODE=COLLECT_ONLY" ] || return 1 ;;
      etc/systemd/system/*.d/*) exp="$SRC/dropins/${f#etc/systemd/system/}"; cmp -s -- "$R/$f" "$exp" || return 1 ;;
      etc/systemd/system/*) exp="$SRC/${f##*/}"; cmp -s -- "$R/$f" "$exp" || return 1 ;;
      *) return 1 ;;
    esac
  done
}
new_accepts_state() {   # the NEW controller's own validator must accept the current state file, which must be COLLECT_ONLY with no intent
  node -e 'const fs=require("fs"); const c=require(process.argv[1]); const s=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); c.validateState(s); process.exit(s.desired==="COLLECT_ONLY" && s.intent===null ? 0 : 1)' "$SRC/nusa-control.js" "$R/var/lib/nusa-control/state.json"
}
installed_sound() {
  [ -f "$MANIFEST_FILE" ] && [ ! -L "$MANIFEST_FILE" ] && [ -f "$MANIFEST_ANCHOR" ] && [ ! -L "$MANIFEST_ANCHOR" ] || return 1
  [ "$(sha256sum -- "$MANIFEST_FILE" | cut -d' ' -f1)" = "$(cat -- "$MANIFEST_ANCHOR")" ] || return 1
  managed_files_sound && verify_manifest_files
}
upgrade_preflight() {
  echo "== upgrade preflight (read-only) for $SHA: replaces ONLY the controller files and the manifest; the runtime is not touched"
  [ -n "$R" ] || check "running as root" test "$(id -u)" = 0
  check "release $SHA is staged" test -d "$R/opt/nusa/releases/$SHA"
  check "source tree has no symlinks" no_symlinks_in "$SRC"
  local f
  for f in nusa-control.js nusa-control.sh nusa-control-reconcile.service nusa-control-verify.service nusa-control-verify.timer dropins/nusa.service.d/10-control-gate.conf dropins/nusa.service.d/20-run-mode.conf dropins/nusa-research.timer.d/10-control-gate.conf dropins/nusa-research.service.d/10-control-gate.conf; do
    check "source file $f" test -f "$SRC/$f" -a ! -L "$SRC/$f"
  done
  if [ -d "$SRC" ] && no_symlinks_in "$SRC"; then
    printf 'INFO  manifest sha256 of the release copy = %s\n' "$(manifest_hash "$SRC")"
    if [[ "$HASH_ARG" =~ ^[0-9a-f]{64}$ ]]; then check "every control file matches the manifest hash from the reviewed pull request" test "$(manifest_hash "$SRC")" = "$HASH_ARG"; else fail "second argument must be the manifest sha256 (64 lowercase hex) of the reviewed pull request"; fi
  fi
  local d
  for d in /opt /opt/nusa /etc /etc/nusa /etc/systemd/system /var/lib; do check "directory $d is real, root-owned and not group/other-writable" safe_dir "$d"; done
  check "orders are OFF from every environment source" orders_off_everywhere
  check "nusa.service is active" sysctl is-active --quiet nusa.service
  check "the controller is installed; its install manifest matches its anchor; every managed file matches the manifest" installed_sound
  check "installed units, drop-ins and the mode file are exactly those of the staged release (an upgrade never changes them)" units_unchanged
  check "the new controller accepts the current state file, which says COLLECT_ONLY with no pending intent" new_accepts_state
  check "the installed controller reports the runtime verified in COLLECT_ONLY (read-only status)" controller_status_ok
  echo "== upgrade preflight result: $fails failure(s)"
}
upgrade_apply() {
  [ "$fails" -eq 0 ] || die "upgrade preflight has failures; nothing was changed"
  step() { printf '\n>> %s\n' "$*"; }
  local t f
  js="$R/opt/nusa-control/nusa-control.js"; sh="$R/opt/nusa-control/nusa-control.sh"   # global: the EXIT trap uses them
  step "private copy"
  stage="$(mktemp -d "$R/var/lib/.nusa-install.XXXXXX")"
  trap 'rm -rf -- "$stage"; rm -f -- "$MANIFEST_FILE.new" "$MANIFEST_ANCHOR.new" "$js.new" "$sh.new"' EXIT
  chmod 0700 "$stage"
  cp -a --no-dereference -- "$SRC/." "$stage/"
  no_symlinks_in "$stage" || die "the private copy contains a symlink"
  [ "$(manifest_hash "$stage")" = "$HASH_ARG" ] || die "the private copy does not match the reviewed manifest hash"
  S="$stage"
  step "prepare the new controller files and manifest"
  for f in $(managed_files); do printf '%s  %s\n' "$(expected_hash "$f")" "$f"; done > "$stage/manifest.out"
  install "${OWN[@]}" -m 0644 "$stage/manifest.out" "$MANIFEST_FILE.new"
  sha256sum -- "$stage/manifest.out" | cut -d' ' -f1 | install "${OWN[@]}" -m 0600 /dev/stdin "$MANIFEST_ANCHOR.new"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.js" "$js.new"
  install "${OWN[@]}" -m 0755 "$S/nusa-control.sh" "$sh.new"
  step "take the controller lock, back up, swap (each file is replaced by one rename)"
  install "${OWN[@]}" -d -m 0700 "$R/run/nusa-control"
  exec 9>>"$R/run/nusa-control/lock"
  flock -w 120 9 || die "the controller is busy (lock not free within 120 s); nothing was changed"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  for t in "$js" "$sh" "$MANIFEST_FILE" "$MANIFEST_ANCHOR"; do cp -a -- "$t" "$t.upgrade-backup-$stamp"; done
  # Put the backups back. Returns non-zero when ANY file could not be restored or does not equal its backup afterwards.
  restore() {
    local x rc=0
    for x in "$js" "$sh" "$MANIFEST_FILE" "$MANIFEST_ANCHOR"; do
      if cp -a -- "$x.upgrade-backup-$stamp" "$x.restore" && mv -f -- "$x.restore" "$x" && cmp -s -- "$x.upgrade-backup-$stamp" "$x"; then :; else rc=1; echo "STOP  could not restore $x from $x.upgrade-backup-$stamp" >&2; fi
    done
    return "$rc"
  }
  recovery_required() {
    {
      echo "RECOVERY_REQUIRED  $1"
      echo "  The old controller files are in *.upgrade-backup-$stamp beside the files (and the anchor in /var/lib/nusa-control). Nothing is deleted."
      echo "  Orders are OFF; the runtime was never restarted. Do NOT run --apply again. Send this output."
    } >&2
    exit 3
  }
  if ! { mv -f -- "$js.new" "$js" && mv -f -- "$sh.new" "$sh" && mv -f -- "$MANIFEST_FILE.new" "$MANIFEST_FILE" && mv -f -- "$MANIFEST_ANCHOR.new" "$MANIFEST_ANCHOR"; }; then
    restore || { exec 9>&-; recovery_required "the swap failed AND putting the old files back failed"; }
    exec 9>&-
    die "the swap failed; the old controller files were put back and verified equal to their backups (backups: *.upgrade-backup-$stamp); the runtime was never touched"
  fi
  exec 9>&-
  step "the new controller must report the runtime verified"
  if ! controller_status_ok; then
    # Restoring changes controller files: it needs the lock, like the swap. No lock means NO restore and a clear report.
    exec 9>>"$R/run/nusa-control/lock"
    if ! flock -w 120 9; then exec 9>&-; recovery_required "the new controller did not report the runtime verified AND the controller lock was not free within 120 s, so the old files were NOT put back (the new files are in place)"; fi
    if ! restore; then exec 9>&-; recovery_required "the new controller did not report the runtime verified AND restoring the old files failed"; fi
    exec 9>&-
    controller_status_ok && die "the new controller did not report the runtime verified; the OLD controller files were put back (equal to their backups) and it verifies (backups: *.upgrade-backup-$stamp)"
    die "the new controller did not report the runtime verified; the old files were put back (equal to their backups) but the status is still not ok; run: sudo /opt/nusa-control/nusa-control.sh status (backups: *.upgrade-backup-$stamp)"
  fi
  # NOT `verify`: the verify verb can stop the runtime (it stops on any mismatch or silence), and this mode promises not to touch it.
  # The read-only status above already proved the runtime verified by the NEW controller; the periodic timer runs verify as usual.
  echo; echo "DONE  controller upgraded in place to $SHA; runtime verified in COLLECT_ONLY; nothing was restarted. Backups of the old files: *.upgrade-backup-$stamp"
}

if [ "$UPG" = 1 ]; then
  upgrade_preflight
  if [ "$MODE" = apply ]; then upgrade_apply; else [ "$fails" -eq 0 ] && echo "Upgrade preflight passed. Re-run with --apply to upgrade in place." || exit 1; fi
  exit 0
fi
case "$MODE" in
  preflight) preflight; [ "$fails" -eq 0 ] && echo "Preflight passed. Re-run with --apply to install." || exit 1 ;;
  apply) preflight; apply ;;
  rollback) rollback ;;
esac

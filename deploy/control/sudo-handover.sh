#!/usr/bin/env bash
# ADDS (or removes again) exactly one sudoers file that lets the release runner call the host controller's fixed verbs
# (design C4 section 4). It does NOT touch any existing sudoers line: revoking the helper's `activate` is a separate step the
# owner takes after reading the output of sudo-audit.sh.
#
#   sudo bash sudo-handover.sh <runner-user>             prints the rule and checks it with visudo; changes nothing in the sudoers
#                                                        configuration (it uses one temporary file outside /etc, removed on exit)
#   sudo bash sudo-handover.sh <runner-user> --apply     writes /etc/sudoers.d/90-nusa-control after `visudo -cf` accepts it
#   sudo bash sudo-handover.sh <runner-user> --remove    removes that file again (and checks the whole configuration)
#   sudo bash sudo-handover.sh <runner-user> --check-exclusive   READ-ONLY: PASS only when the runner's EFFECTIVE sudo rights no longer
#                                                        include the old helper's `activate` (or ALL, or a wildcard in its place)
#
# THE HAND-OVER IS NOT COMPLETE until --check-exclusive passes. Adding the controller rule alone leaves the old path open: the runner could
# still call the helper's activate directly and bypass the controller's start gate. Removing that old line is a manual, owner-approved step
# (visudo), taken after sudo-audit.sh was read; this script never edits an existing sudoers line.
#
# The rule is exact: status, stop, collect, and `release` with a 40-character lowercase hex argument (forty bracket classes, no `*`).
# Nothing else. The runner can never grant orders: the controller has no such verb.
set -euo pipefail
R="${NUSA_HANDOVER_ROOT:-}"
if [ -n "$R" ]; then
  [ "${NUSA_HANDOVER_TEST_MODE:-}" = "yes-this-is-a-test-tree" ] || { echo "STOP  NUSA_HANDOVER_ROOT is for tests only; unset it" >&2; exit 1; }
  for real in /opt/nusa /opt/nusa-control /etc/nusa; do [ ! -e "$real" ] || { echo "STOP  this looks like the real host ($real exists); a test root is not allowed here" >&2; exit 1; }; done
else
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
  [ "$(id -u)" = 0 ] || { echo "STOP  run as root (sudo bash $0 ...)" >&2; exit 1; }
fi
USER_ARG="${1:-}"; MODE="preflight"
for a in "$@"; do case "$a" in --apply) MODE="apply";; --remove) MODE="remove";; --check-exclusive) MODE="exclusive";; esac; done
die() { printf 'STOP  %s\n' "$*" >&2; exit 1; }
[[ "$USER_ARG" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "first argument must be the runner account name"
[ "$USER_ARG" != root ] || die "the runner account must not be root"
id -u "$USER_ARG" >/dev/null 2>&1 || die "no such account: $USER_ARG"
DIR="$R/etc/sudoers.d"; FILE="$DIR/90-nusa-control"; CTL="/opt/nusa-control/nusa-control.sh"
HEX40="$(printf '[0-9a-f]%.0s' $(seq 1 40))"
rule() {
  cat <<RULE
# NUSA host controller: the release runner may call exactly these verbs as root (sudo-handover.sh, reviewed). Nothing else.
Cmnd_Alias NUSA_CONTROL = $CTL status, $CTL stop, $CTL collect, $CTL release $HEX40
$USER_ARG ALL=(root) NOPASSWD: NUSA_CONTROL
RULE
}
check_all() { visudo -c >/dev/null; }

# The effective policy as sudo itself reports it (sudo -l -U): the old helper verb `activate` must not be reachable, neither by name, nor
# by a bare helper entry or a wildcard argument (which cover every verb), nor by an ALL rule.
exclusive_ok() {
  local out bad
  out="$(sudo -n -l -U "$USER_ARG" 2>&1)" || { echo "FAIL  sudo -l -U could not be read; exclusivity is NOT proven"; return 1; }
  bad="$(printf '%s\n' "$out" | tr ',' '\n' | grep -E 'NOPASSWD: *ALL|\(ALL(:ALL)?\) +ALL$|nusa-release-step( +\*| +activate|[[:space:]]*$)' || true)"
  if [ -n "$bad" ]; then echo "FAIL  the runner can still reach the helper's activate (or everything):"; printf '    %s\n' "$bad"; return 1; fi
  echo "PASS  the runner's effective sudo rights do not include the helper's activate, a bare helper entry, a wildcard verb or ALL"
}
case "$MODE" in
  exclusive)
    exclusive_ok && echo "HAND-OVER COMPLETE for $USER_ARG (the controller is the only way to activate)" || { echo "HAND-OVER NOT COMPLETE: remove the old rule with visudo (owner-approved), then run --check-exclusive again" >&2; exit 1; }
    exit 0 ;;
  remove)
    [ -e "$FILE" ] || die "$FILE does not exist; nothing to remove"
    rm -f -- "$FILE"
    check_all || die "the sudoers configuration is not valid after removing the file; check it with visudo -c"
    echo "DONE  removed $FILE; the configuration is valid"; exit 0 ;;
esac

echo "== sudoers rule that would be installed in $FILE"
rule
echo
fails=0
chk() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then printf 'PASS  %s\n' "$name"; else printf 'FAIL  %s\n' "$name"; fails=$((fails + 1)); fi; }
chk "the controller entry point exists, is root-owned and not writable by group or others" bash -c '[ -f "$0" ] && [ ! -L "$0" ] && { [ -n "$1" ] || [ "$(stat -c %u "$0")" = 0 ]; } && [ $(( 8#$(stat -c %a "$0") & 8#022 )) -eq 0 ]' "$R$CTL" "$R"
chk "sudoers includes the directory /etc/sudoers.d" grep -Eq '^[#@]includedir[[:space:]]+/etc/sudoers\.d' "$R/etc/sudoers"
chk "$DIR is a real directory owned by root and not writable by others" bash -c '[ -d "$0" ] && [ ! -L "$0" ] && { [ -n "$1" ] || [ "$(stat -c %u "$0")" = 0 ]; } && [ $(( 8#$(stat -c %a "$0") & 8#022 )) -eq 0 ]' "$DIR" "$R"
if [ -e "$FILE" ]; then
  chk "the existing $FILE is exactly this rule (idempotent)" bash -c '[ "$(cat "$0")" = "$1" ]' "$FILE" "$(rule)"
fi
# The candidate for the syntax check lives in the temporary directory; only --apply writes anything into /etc/sudoers.d.
tmp="$(mktemp)"; tmp2=""
trap 'rm -f -- "$tmp" "$tmp2"' EXIT
chmod 0440 "$tmp"; rule > "$tmp"
chk "visudo accepts the rule (syntax check of the candidate only)" visudo -cf "$tmp"
chk "visudo accepts the current whole configuration" check_all
echo "== result: $fails failure(s). This script never revokes an existing rule."
[ "$fails" -eq 0 ] || exit 1
if [ "$MODE" != apply ]; then echo "Preflight passed. Re-run with --apply to install the rule."; exit 0; fi
[ ! -e "$FILE" ] || { cmp -s "$tmp" "$FILE" && { echo "DONE  already installed, identical"; exit 0; }; die "$FILE exists and differs; refusing to overwrite"; }
# Written beside the target (a dot in the name makes sudo ignore it until it is renamed), then renamed into place: one atomic step.
tmp2="$(mktemp "$DIR/.nusa-control.XXXXXX")"
rule > "$tmp2"; chmod 0440 "$tmp2"; [ -n "$R" ] || chown root:root "$tmp2"
visudo -cf "$tmp2" >/dev/null || die "the candidate in $DIR is not accepted by visudo; nothing was installed"
mv -n -- "$tmp2" "$FILE"; tmp2=""
if ! check_all; then rm -f -- "$FILE"; die "the whole configuration was not valid with the new file; the file was removed again"; fi
echo "DONE  installed $FILE (mode 0440); the whole sudoers configuration is valid."
if exclusive_ok; then echo "HAND-OVER COMPLETE for $USER_ARG"; else echo "HAND-OVER NOT COMPLETE: the old helper path is still open. Remove the runner's old sudo line for the helper (keep only stage, preflight, backup, prune) with visudo, owner-approved, then run --check-exclusive."; fi

#!/usr/bin/env bash
# READ-ONLY audit of what the release runner account may do as root (design C4 section 4, "unknown host facts" of design v5 C3).
#
#   sudo bash sudo-audit.sh [runner-user]
#
# It changes NOTHING: no file, no unit, no sudoers line. It prints facts and WARN lines for the owner to read; it is not an access audit
# of the whole host (SSH keys, cron, polkit, other accounts, containers are NOT covered) and must not be cited as one.
# Output contains no secret: sudoers files are printed without comment and blank lines (they hold command paths, not credentials).
set -uo pipefail
R="${NUSA_AUDIT_ROOT:-}"
if [ -n "$R" ]; then
  [ "${NUSA_AUDIT_TEST_MODE:-}" = "yes-this-is-a-test-tree" ] || { echo "STOP  NUSA_AUDIT_ROOT is for tests only; unset it" >&2; exit 1; }
  for real in /opt/nusa /opt/nusa-control /etc/nusa; do [ ! -e "$real" ] || { echo "STOP  this looks like the real host ($real exists); a test root is not allowed here" >&2; exit 1; }; done
else
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
  [ "$(id -u)" = 0 ] || { echo "STOP  run as root (sudo bash $0)" >&2; exit 1; }
fi
warns=0
warn() { printf 'WARN  %s\n' "$1"; warns=$((warns + 1)); }
info() { printf 'INFO  %s\n' "$1"; }
sec() { printf '\n== %s\n' "$1"; }

USER_ARG="${1:-}"
if [ -z "$USER_ARG" ]; then
  # The account of the GitHub Actions runner service(s), read from systemd (read-only).
  USER_ARG=""
  for u in $(systemctl list-units --type=service --all --no-legend 'actions.runner*' 2>/dev/null | awk '{print $1}' | grep -E '^actions\.runner[A-Za-z0-9._@-]*\.service$' || true); do
    cand="$(systemctl show -p User --value "$u" 2>/dev/null || true)"
    info "runner service $u runs as: ${cand:-none}"
    [ -n "$cand" ] && [ -z "$USER_ARG" ] && USER_ARG="$cand"
  done
fi
[[ "$USER_ARG" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "STOP  give the runner account as the first argument (could not find it from systemd)" >&2; exit 1; }
id -u "$USER_ARG" >/dev/null 2>&1 || { echo "STOP  no such account: $USER_ARG" >&2; exit 1; }

sec "account $USER_ARG"
id "$USER_ARG"
for g in $(id -nG "$USER_ARG"); do
  case "$g" in root|sudo|wheel|admin|docker|lxd|disk|adm|shadow) warn "the account is in group '$g' (can be a path to root or to broad read access)";; esac
done
[ "$(id -u "$USER_ARG")" != 0 ] || warn "the runner account is root itself"

sec "what sudo says this account may run (sudo -l -U)"
if out="$(sudo -n -l -U "$USER_ARG" 2>&1)"; then
  printf '%s\n' "$out"
  printf '%s\n' "$out" | grep -Eq 'NOPASSWD: *ALL|\(ALL(:ALL)?\) *(NOPASSWD: *)?ALL' && warn "the account may run ANY command as root (ALL)"
  printf '%s\n' "$out" | grep -E '^\s+\(.*\)' | grep -E '[*?]|\[' | grep -v '^$' | while read -r l; do printf 'WARN  a wildcard in an allowed command: %s\n' "$l"; done
else
  printf '%s\n' "$out"; warn "sudo -l -U failed; read the sudoers files below instead"
fi

sec "sudoers files (comments and blank lines removed)"
for f in "$R/etc/sudoers" "$R"/etc/sudoers.d/*; do
  [ -e "$f" ] || continue
  printf -- '--- %s  %s\n' "$f" "$(stat -c '%U:%G %a' -- "$f" 2>/dev/null)"
  grep -vE '^\s*(#|$)' "$f" 2>/dev/null | sed 's/^/    /'
  case "$(stat -c '%a' -- "$f" 2>/dev/null)" in 440|400|600|640) ;; *) warn "$f has mode $(stat -c '%a' -- "$f" 2>/dev/null); sudoers files should be 0440";; esac
  [ "$(stat -c '%U' -- "$f" 2>/dev/null)" = root ] || warn "$f is not owned by root"
done
grep -rEqs "^[^#]*(NOPASSWD: *ALL|nusa-release-step *\*|rm[[:space:]]+-rf|tar[[:space:]]+\*)" "$R/etc/sudoers" "$R"/etc/sudoers.d/ 2>/dev/null && warn "a broad or wildcard NOPASSWD rule exists (ALL, release-step with a star, recursive rm, tar with a star); see above"

sec "who can change what the runner runs as root"
for f in /opt/nusa/bin/nusa-release-step /opt/nusa-control/nusa-control.sh /opt/nusa-control/nusa-control.js /opt/nusa-control; do
  p="$R$f"; [ -e "$p" ] || { info "$f does not exist"; continue; }
  printf '%s  %s\n' "$(stat -c '%U:%G %a' -- "$p")" "$f"
  [ "$(stat -c '%U' -- "$p")" = root ] || warn "$f is not owned by root"
  [ $(( 8#$(stat -c '%a' -- "$p") & 8#022 )) -eq 0 ] || warn "$f is writable by group or others"
done
sec "result"
echo "audit finished: $warns WARN line(s). Nothing was changed. Send this output; no step is taken from it without the owner's approval."
exit 0

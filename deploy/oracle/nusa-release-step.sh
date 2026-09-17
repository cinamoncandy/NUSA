#!/usr/bin/env bash
# Single privileged entry point for the Oracle PAPER release.
#
# Without this the release needs eleven sudoers entries, two of them wildcards -- `tar *` and
# `rm -rf /opt/nusa/releases/*`. A wildcard in sudoers grants far more than the step needs: `tar`
# alone can write any path on the host, and the rm pattern depends on a shell variable the caller
# controls. Routing every privileged action through one verb lets sudoers grant exactly one
# command, and moves argument validation to where it can actually be enforced.
#
# This script is installed once at a fixed path OUTSIDE the release tree. That is deliberate: a
# privileged helper must not be replaceable by the releases it installs, or deploying a commit
# would be enough to rewrite the thing that runs as root.
#
# It grants no LIVE authority. It moves a symlink and restarts a PAPER_ONLY service.

set -euo pipefail

readonly DEPLOY_ROOT=/opt/nusa
readonly RELEASES="${DEPLOY_ROOT}/releases"
readonly SERVICE=nusa.service
readonly SERVICE_USER=nusa

die() { printf '%s\n' "nusa-release-step: $*" >&2; exit 1; }

# The SHA is the only caller-supplied value that reaches a path, so it is validated here rather
# than trusted from the workflow. Anything but a full lowercase commit SHA is refused outright.
validate_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die "expected a full lowercase commit SHA, refusing"
}

# Every path is rebuilt from the validated SHA. A caller cannot pass a path at all.
release_dir() { printf '%s/%s' "$RELEASES" "$1"; }

active_release() { readlink -f "${DEPLOY_ROOT}/current" 2>/dev/null || true; }

# Release scripts are read from the staged release itself, so the procedure always matches the
# commit being deployed rather than whatever happened to be installed earlier.
script_in() {
  local dir="$1" name="$2" path="${1}/scripts/${2}"
  [ -f "$path" ] || die "missing ${name} in ${dir}"
  printf '%s' "$path"
}

verb="${1:-}"
shift || true

case "$verb" in
  backup)
    exec runuser -u "$SERVICE_USER" -- node "$(script_in "$(active_release)" sqlite-backup.js)"
    ;;

  preflight)
    validate_sha "${1:-}"
    dir="$(release_dir "$1")"
    [ -d "$dir" ] || die "release not staged: $dir"
    node "$(script_in "$dir" host-security-validate.js)"
    exec node "$(script_in "$dir" oracle-validate.js)"
    ;;

  stage)
    validate_sha "${1:-}"
    source_tree="${2:-}"
    [ -d "$source_tree" ] || die "source tree is not a directory"
    dir="$(release_dir "$1")"
    # A staged release is immutable once `current` points at it. Replacing the active release
    # would mutate what the running service is executing.
    if [ -e "$dir" ]; then
      [ "$(readlink -f "$dir")" = "$(active_release)" ] && die "refusing to restage the active release"
      rm -rf -- "$dir"
    fi
    install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 -- "$dir"
    tar -cf - --exclude=.git -C "$source_tree" . | tar -xf - -C "$dir"
    chown -R "${SERVICE_USER}:${SERVICE_USER}" -- "$dir"
    ;;

  switch)
    validate_sha "${1:-}"
    dir="$(release_dir "$1")"
    NUSA_COMMIT_SHA="$1" exec node "$(script_in "$dir" atomic-deploy.js)"
    ;;

  rollback)
    NUSA_DEPLOY_ACTION=rollback exec node "$(script_in "$(active_release)" atomic-deploy.js)"
    ;;

  restart)
    systemctl daemon-reload
    exec systemctl restart "$SERVICE"
    ;;

  readiness)
    exec node "$(script_in "$(active_release)" oracle-readiness-check.js)"
    ;;

  *)
    die "unknown verb '${verb}'. Expected: backup|preflight|stage|switch|rollback|restart|readiness"
    ;;
esac

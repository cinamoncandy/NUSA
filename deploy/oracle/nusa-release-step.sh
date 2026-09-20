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
readonly RESEARCH_SERVICE=nusa-research.service
readonly RESEARCH_TIMER=nusa-research.timer
readonly AUTOPILOT_SERVICE=nusa-autopilot.service
readonly SERVICE_USER=nusa
readonly SYSTEMD_UNIT_DIR=/etc/systemd/system
readonly PREVIOUS_RELEASE_FILE="${DEPLOY_ROOT}/.previous-release"
readonly RELEASE_RETENTION=4

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

unit_in() {
  local dir="$1" name="$2" path="${dir}/deploy/oracle/${name}"
  [ -f "$path" ] || die "missing ${name} in ${dir}"
  printf '%s' "$path"
}

install_units_from_release() {
  local dir="$1"
  [ -d "$dir" ] || die "release directory missing: ${dir}"
  install -o root -g root -m 0644 "$(unit_in "$dir" nusa.service)" "${SYSTEMD_UNIT_DIR}/${SERVICE}"
  install -o root -g root -m 0644 "$(unit_in "$dir" nusa-research.service)" "${SYSTEMD_UNIT_DIR}/${RESEARCH_SERVICE}"
  install -o root -g root -m 0644 "$(unit_in "$dir" nusa-research.timer)" "${SYSTEMD_UNIT_DIR}/${RESEARCH_TIMER}"
  install -o root -g root -m 0644 "$(unit_in "$dir" nusa-autopilot.service)" "${SYSTEMD_UNIT_DIR}/${AUTOPILOT_SERVICE}"
  systemctl daemon-reload
}

enable_units() {
  systemctl enable "${SERVICE}" "${RESEARCH_TIMER}" "${AUTOPILOT_SERVICE}"
}

restart_units() {
  systemctl restart "${SERVICE}" "${AUTOPILOT_SERVICE}"
  systemctl start "${RESEARCH_TIMER}"
}

rollback_and_restore() {
  NUSA_DEPLOY_ACTION=rollback node "$(script_in "$(active_release)" atomic-deploy.js)"
  install_units_from_release "$(active_release)"
  enable_units
  restart_units
}

previous_release() {
  [ -f "$PREVIOUS_RELEASE_FILE" ] || return 0
  local path
  path="$(cat "$PREVIOUS_RELEASE_FILE" 2>/dev/null || true)"
  [ -n "$path" ] || return 0
  readlink -f "$path" 2>/dev/null || true
}

prune_releases() {
  [ -d "$RELEASES" ] || die "release directory missing: $RELEASES"
  local active previous dir name kept=0 removed=0
  active="$(active_release)"
  previous="$(previous_release)"

  mapfile -t dirs < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)

  # Validate the entire candidate set before deleting anything.
  for dir in "${dirs[@]}"; do
    name="${dir##*/}"
    [[ "$name" =~ ^[0-9a-f]{40}$ ]] || die "unexpected release directory name: $name"
    [ ! -L "$dir" ] || die "release directory must not be a symlink: $dir"
  done

  for dir in "${dirs[@]}"; do
    [ "$dir" = "$active" ] && continue
    [ -n "$previous" ] && [ "$dir" = "$previous" ] && continue
    if [ "$kept" -lt "$RELEASE_RETENTION" ]; then
      kept=$((kept + 1))
      continue
    fi
    rm -rf -- "$dir"
    removed=$((removed + 1))
  done

  printf '%s\n' "nusa-release-step: prune complete; keptRecent=$kept removed=$removed active=$active previous=${previous:-none}"
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
    NUSA_ORACLE_RELEASE_DIR="$dir" exec node "$(script_in "$dir" oracle-validate.js)"
    ;;

  install-units)
    validate_sha "${1:-}"
    dir="$(release_dir "$1")"
    [ -d "$dir" ] || die "release not staged: $dir"
    install_units_from_release "$dir"
    enable_units
    ;;

  prune)
    prune_releases
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
    enable_units
    restart_units
    ;;

  activate)
    validate_sha "${1:-}"
    dir="$(release_dir "$1")"
    [ -d "$dir" ] || die "release not staged: $dir"
    NUSA_COMMIT_SHA="$1" node "$(script_in "$dir" atomic-deploy.js)"
    if ! install_units_from_release "$dir" || ! enable_units || ! restart_units || ! node "$(script_in "$dir" oracle-readiness-check.js)" || ! node "$(script_in "$dir" autopilot-readiness.js)"; then
      printf '%s\n' "nusa-release-step: activation failed for $1; restoring previous release" >&2
      rollback_and_restore
      node "$(script_in "$(active_release)" oracle-readiness-check.js)" || die "rollback PAPER readiness failed"
      node "$(script_in "$(active_release)" autopilot-readiness.js)" || die "rollback Autopilot readiness failed"
      exit 1
    fi
    systemctl is-active --quiet "$SERVICE" || die "PAPER service is not active after activation"
    systemctl is-active --quiet "$AUTOPILOT_SERVICE" || die "Autopilot service is not active after activation"
    printf '%s\n' "nusa-release-step: activation accepted for $1"
    ;;

  readiness)
    exec node "$(script_in "$(active_release)" oracle-readiness-check.js)"
    ;;

  *)
    die "unknown verb '${verb}'. Expected: backup|preflight|install-units|prune|stage|switch|activate|rollback|restart|readiness"
    ;;
esac

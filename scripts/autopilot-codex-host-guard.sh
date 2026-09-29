#!/usr/bin/env bash
# Host guard for the autopilot Codex runner, which shares the 1 GB Oracle host with the PAPER
# runtime. PAPER always wins: exit 0 means Codex may (keep) running, non-zero means defer.
#
#   start  before Codex starts: enough free memory AND no Oracle PAPER release queued/running.
#          A GitHub API failure defers (fail closed).
#   watch  while Codex runs (called every few seconds): free memory above the floor AND, checked
#          at most once a minute, no Oracle PAPER release. A GitHub API failure keeps running,
#          because the memory floor still protects PAPER.
set -uo pipefail

mode="${1:-}"
meminfo="${NUSA_HOST_GUARD_MEMINFO:-/proc/meminfo}"
start_min_kb="${NUSA_HOST_GUARD_START_MIN_KB:-460800}"   # 450 MiB
watch_min_kb="${NUSA_HOST_GUARD_WATCH_MIN_KB:-204800}"   # 200 MiB
state_dir="${RUNNER_TEMP:-/tmp}"
release_workflow="oracle-paper-release.yml"

available_kb() {
  awk '/^MemAvailable:/ {print $2; found=1} END {if (!found) print 0}' "$meminfo" 2>/dev/null || echo 0
}

# Prints the number of queued + in-progress PAPER releases, or nothing on API failure.
active_releases() {
  if [ -n "${NUSA_HOST_GUARD_ACTIVE_RELEASES:-}" ]; then echo "$NUSA_HOST_GUARD_ACTIVE_RELEASES"; return; fi
  local total=0 status body count
  for status in queued in_progress; do
    body="$(curl -fsS --max-time 15 -H "Authorization: Bearer ${GH_TOKEN:-}" -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${release_workflow}/runs?status=${status}&per_page=1")" || return 0
    count="$(printf '%s' "$body" | sed -n 's/^[[:space:]]*"total_count":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
    [ -n "$count" ] || return 0
    total=$((total + count))
  done
  echo "$total"
}

mem="$(available_kb)"
case "$mode" in
  start)
    if [ "$mem" -lt "$start_min_kb" ]; then
      echo "::notice::Host guard: only ${mem} kB available (< ${start_min_kb} kB); deferring Codex so PAPER keeps its memory."
      exit 1
    fi
    releases="$(active_releases)"
    if [ -z "$releases" ]; then
      echo "::notice::Host guard: could not confirm that no Oracle PAPER release is running; deferring Codex."
      exit 1
    fi
    if [ "$releases" -gt 0 ]; then
      echo "::notice::Host guard: an Oracle PAPER release is queued or running; deferring Codex."
      exit 1
    fi
    date +%s > "${state_dir}/codex-host-guard-last-release-check"
    exit 0
    ;;
  watch)
    if [ "$mem" -lt "$watch_min_kb" ]; then
      echo "::warning::Host guard: available memory fell to ${mem} kB (< ${watch_min_kb} kB); stopping Codex to protect PAPER."
      exit 1
    fi
    stamp="${state_dir}/codex-host-guard-last-release-check"
    now="$(date +%s)"
    last="$(cat "$stamp" 2>/dev/null || echo 0)"
    if [ $((now - last)) -ge "${NUSA_HOST_GUARD_RELEASE_CHECK_SECONDS:-60}" ]; then
      echo "$now" > "$stamp"
      releases="$(active_releases)"
      if [ -n "$releases" ] && [ "$releases" -gt 0 ]; then
        echo "::warning::Host guard: an Oracle PAPER release started; stopping Codex so the release has the host."
        exit 1
      fi
    fi
    exit 0
    ;;
  *)
    echo "usage: $0 start|watch" >&2
    exit 2
    ;;
esac

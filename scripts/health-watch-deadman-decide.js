"use strict";
// Dead-man decision for the Health Watch (design v5, C5): "the watch itself is watched". Pure function; the workflow passes the completion time
// of the newest finished Health Watch run (or nothing) and the current time. The Health Watch is scheduled every 30 minutes, but GitHub starts
// scheduled runs on a best-effort basis. MEASURED 2026-11-19: only 16 scheduled runs in five days (expected about 240), spaced 6.5 to 8.8 hours
// (2026-11-17 02:01, 10:32, 19:19; 2026-11-18 01:49, 10:01, 18:47 UTC). A 2-hour limit therefore cried wolf on the first run (silent 842 minutes
// was a real, ordinary gap), so the limit is 12 hours: it catches a watch that was disabled or broken, not a slow scheduler. The watch is NOT a
// 30-minute watch here; the independent routine of the owner's session (every 2 hours, pushing only when something is wrong) covers the gap.
const MAX_SILENCE_MINUTES = 720;

function decideDeadman(latestRunCompletedAt, nowMs, maxSilenceMinutes = MAX_SILENCE_MINUTES) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxSilenceMinutes) || maxSilenceMinutes <= 0) return { alert: "CONFIG_INVALID", reason: "invalid_clock_or_limit" };
  if (latestRunCompletedAt == null || latestRunCompletedAt === "") return { alert: "WATCH_NEVER_RAN", reason: "no_finished_run_found" };
  const completedMs = Date.parse(String(latestRunCompletedAt));
  if (!Number.isFinite(completedMs)) return { alert: "CONFIG_INVALID", reason: "unreadable_run_time" };
  const silentMinutes = Math.floor((nowMs - completedMs) / 60_000);
  // A run time in the future is a clock problem, not proof of life.
  if (silentMinutes < 0) return { alert: "CONFIG_INVALID", reason: "run_time_in_the_future" };
  if (silentMinutes > maxSilenceMinutes) return { alert: "WATCH_SILENT", reason: `silent_${silentMinutes}_minutes` };
  return { alert: "NONE", reason: `last_run_${silentMinutes}_minutes_ago` };
}

if (require.main === module) {
  const result = decideDeadman(process.argv[2], Date.now(), process.argv[3] == null ? MAX_SILENCE_MINUTES : Number(process.argv[3]));
  console.log(`${result.alert} ${result.reason}`);
}

module.exports = { decideDeadman, MAX_SILENCE_MINUTES };

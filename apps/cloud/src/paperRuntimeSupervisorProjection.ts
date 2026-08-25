import type { PersonalPaperSupervisorProjection } from "../../../packages/contracts/src/personalPaperOperations";

function nonNegativeInteger(value: string | undefined): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function optionalExitCode(value: string | undefined): number | null | undefined {
  if (value == null || value === "") return null;
  if (!/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function readPaperRuntimeSupervisorProjection(env: NodeJS.ProcessEnv): PersonalPaperSupervisorProjection | undefined {
  if (env.NUSA_PAPER_SUPERVISOR_MANAGED !== "true") return undefined;
  const restartAttempt = nonNegativeInteger(env.NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT);
  const restartCount = nonNegativeInteger(env.NUSA_PAPER_SUPERVISOR_RESTART_COUNT);
  const startedAt = nonNegativeInteger(env.NUSA_PAPER_SUPERVISOR_STARTED_AT);
  if (restartAttempt == null || restartCount == null || startedAt == null) return undefined;

  const exitedAtRaw = env.NUSA_PAPER_SUPERVISOR_LAST_EXITED_AT;
  const uptimeRaw = env.NUSA_PAPER_SUPERVISOR_LAST_UPTIME_MS;
  let lastExit: PersonalPaperSupervisorProjection["lastExit"] = null;
  if (exitedAtRaw != null || uptimeRaw != null) {
    const exitedAt = nonNegativeInteger(exitedAtRaw);
    const uptimeMs = nonNegativeInteger(uptimeRaw);
    const code = optionalExitCode(env.NUSA_PAPER_SUPERVISOR_LAST_EXIT_CODE);
    const signalValue = env.NUSA_PAPER_SUPERVISOR_LAST_EXIT_SIGNAL;
    if (exitedAt == null || uptimeMs == null || code === undefined) return undefined;
    if (signalValue != null && signalValue !== "" && !/^[A-Z0-9]+$/.test(signalValue)) return undefined;
    lastExit = Object.freeze({ code, signal: signalValue == null || signalValue === "" ? null : signalValue, exitedAt, uptimeMs });
  }

  return Object.freeze({
    managed: true,
    status: "RUNNING",
    restartAttempt,
    restartCount,
    startedAt,
    lastExit,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

import type { PersistentExecutionStop } from "./executionCoordinator";

/**
 * Generalized AI capacity/cost protection state (owner directive 2026-09-24: keep the #2238
 * quota-stop structure, generalize it beyond the free-tier daily allocation). This is a pure
 * classifier over the one provider-capacity-wait record every Workers AI caller already shares
 * (coding proposals, scheduled evolution coding, independent Audit); it adds no new state and
 * changes no existing gate. Today the only stop reasons the codebase raises are
 * WORKERS_AI_DAILY_QUOTA_EXHAUSTED and WORKERS_AI_RATE_LIMITED (see classifyWorkersAiProviderStop
 * in codingRunner.ts); a HARD_STOP-classified reason not yet in that set still classifies as
 * HARD_STOP here rather than silently falling through to NORMAL, so a future stop reason (a paid
 * per-request cost ceiling, an operator-imposed budget) fails closed by default until it is
 * explicitly added to SOFT_BUDGET_STOP_REASONS below.
 *
 * NORMAL: no active provider wait, or one that has already elapsed. Ordinary routing.
 * CONSERVE: an active wait whose stop reason is a transient/soft one (rate limiting). AI work is
 *   still possible once the wait elapses; callers may prefer cheaper/deterministic routes over
 *   contending for the same limited window, but the underlying gate (nextRetryAt) already blocks
 *   the actual call, so CONSERVE is advisory only.
 * HARD_STOP: an active wait whose stop reason is a hard capacity/cost boundary (the daily free
 *   allocation, or any future paid cost-ceiling/provider-unavailable reason). New provider
 *   inference is blocked until nextRetryAt; deterministic Autopilot work (scheduling, discovery,
 *   dedupe, claim cleanup, telemetry, verification) is unaffected by this state -- callers must
 *   not use it to justify halting anything but their own AI inference calls.
 */
export type AiBudgetState = "NORMAL" | "CONSERVE" | "HARD_STOP";

/** Stop reasons that only advise conservation once cleared; everything else that is still an active wait is HARD_STOP. */
const SOFT_BUDGET_STOP_REASONS: ReadonlySet<string> = new Set(["WORKERS_AI_RATE_LIMITED"]);

export function classifyAiBudgetState(wait: Pick<PersistentExecutionStop, "stopReason" | "nextRetryAt"> | null | undefined, now: number): AiBudgetState {
  if (wait == null || !Number.isSafeInteger(wait.nextRetryAt) || now >= wait.nextRetryAt) return "NORMAL";
  return SOFT_BUDGET_STOP_REASONS.has(wait.stopReason) ? "CONSERVE" : "HARD_STOP";
}

import { tradingDayKey } from "../../../packages/contracts/src/risk-safety-integration";

/**
 * Pure planner for the daily research session. It only decides; it starts, stops and stores nothing.
 * One session per trading day (id `research-YYYY-MM-DD`), bounded by a daily experiment budget.
 * Anything uncertain fails closed to NONE with a reason.
 */
export const MAX_DAILY_RESEARCH_EXPERIMENTS = 1_000;

export interface PlannerSession {
  readonly sessionId: string;
  readonly state: "IDLE" | "RUNNING" | "PAUSED" | "HALTED" | "COMPLETED" | "FAILED";
}

export type ResearchSessionPlan =
  | { readonly action: "START"; readonly sessionId: string; readonly maxExperiments: number }
  | { readonly action: "NONE"; readonly reason: ResearchSessionPlanReason };

export type ResearchSessionPlanReason =
  | "INVALID_CLOCK"
  | "INVALID_BUDGET"
  | "INVALID_VARIANT"
  | "RECOVERY_NOT_READY"
  | "TODAY_SESSION_EXISTS"
  | "PREVIOUS_SESSION_STILL_RUNNING";

export function researchSessionIdFor(nowMs: number, variantId?: string): string {
  return `research-${tradingDayKey(nowMs)}${variantId == null ? "" : `-${variantId}`}`;
}

export function planResearchSession(input: {
  readonly nowMs: number;
  readonly sessions: readonly PlannerSession[];
  readonly dailyBudget: number;
  readonly recoveryReady: boolean;
  /** When set, the plan is for that variant only: its own session id, and only its own RUNNING sessions block it. */
  readonly variantId?: string;
}): ResearchSessionPlan {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) return Object.freeze({ action: "NONE", reason: "INVALID_CLOCK" });
  if (!Number.isSafeInteger(input.dailyBudget) || input.dailyBudget < 1 || input.dailyBudget > MAX_DAILY_RESEARCH_EXPERIMENTS) return Object.freeze({ action: "NONE", reason: "INVALID_BUDGET" });
  if (!input.recoveryReady) return Object.freeze({ action: "NONE", reason: "RECOVERY_NOT_READY" });
  if (input.variantId != null && !/^[a-z0-9][a-z0-9_]{0,31}$/.test(input.variantId)) return Object.freeze({ action: "NONE", reason: "INVALID_VARIANT" });
  const sessionId = researchSessionIdFor(input.nowMs, input.variantId);
  // Any state of today's session ends today's planning: COMPLETED means the budget is spent, and a
  // HALTED/FAILED/PAUSED session is never silently restarted (recovery owns that decision).
  if (input.sessions.some((session) => session.sessionId === sessionId)) return Object.freeze({ action: "NONE", reason: "TODAY_SESSION_EXISTS" });
  // The runtime supports a single RUNNING session; an earlier one must finish or be stopped first.
  const mine = (session: PlannerSession): boolean => input.variantId == null || session.sessionId.endsWith(`-${input.variantId}`);
  if (input.sessions.some((session) => session.state === "RUNNING" && mine(session))) return Object.freeze({ action: "NONE", reason: "PREVIOUS_SESSION_STILL_RUNNING" });
  return Object.freeze({ action: "START", sessionId, maxExperiments: input.dailyBudget });
}

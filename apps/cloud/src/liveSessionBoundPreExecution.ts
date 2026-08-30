import {
  evaluateLiveAutonomousPreExecution,
  type LiveAutonomousPreExecutionEnvelope,
  type LiveAutonomousPreExecutionRequest,
} from "./liveAutonomousPreExecutionGate";
import {
  evaluateLiveRuntimeSession,
  type LiveRuntimeSession,
} from "./liveRuntimeSessionBoundary";

export type LiveSessionBoundPreExecutionRequest = Omit<
  LiveAutonomousPreExecutionRequest,
  "investmentCapitalWeight" | "runtimeActive" | "killSwitchActive"
> & {
  readonly session: LiveRuntimeSession;
};

/**
 * Treats the durable LIVE session as the sole source of truth for owner-bound
 * capital weight and runtime/kill-switch state before pre-execution readiness.
 * This grants no broker authority and cannot enable production mutation.
 */
export function evaluateLiveSessionBoundPreExecution(
  request: LiveSessionBoundPreExecutionRequest,
): LiveAutonomousPreExecutionEnvelope {
  const sessionDecision = evaluateLiveRuntimeSession(
    request.session,
    request.ownerPrincipalId,
    request.now,
  );

  if (!sessionDecision.allowed) {
    return evaluateLiveAutonomousPreExecution({
      ...request,
      investmentCapitalWeight: 0,
      runtimeActive: false,
      killSwitchActive: request.session.killSwitchEngaged,
    });
  }

  return evaluateLiveAutonomousPreExecution({
    ...request,
    investmentCapitalWeight: sessionDecision.investmentCapitalWeight,
    runtimeActive: true,
    killSwitchActive: false,
  });
}

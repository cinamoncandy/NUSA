export type PaperValidationProfile = "CALENDAR_30_DAY" | "SCENARIO_BASED";

export type RequiredPaperFaultScenario =
  | "PERSISTENCE_FAILURE"
  | "WEBSOCKET_DISCONNECT"
  | "PARTIAL_WRITE"
  | "DUPLICATE_SIGNAL"
  | "KILL_SWITCH";

export interface ScenarioPaperEvidenceInput {
  readonly generatedAt: number;
  readonly observedSessions: number;
  readonly completedOrders: number;
  readonly marketRegimes: number;
  readonly restartRecoveryPasses: number;
  readonly duplicateOrderChecks: number;
  readonly passedFaultScenarios: readonly RequiredPaperFaultScenario[];
  readonly walkForwardPassed: boolean;
  readonly costStressPassed: boolean;
  readonly monteCarloPassed: boolean;
  readonly integrityChecksPassed: boolean;
}

export interface ScenarioPaperValidationResult {
  readonly profile: "SCENARIO_BASED";
  readonly generatedAt: number;
  readonly status: "PASS" | "FAIL";
  readonly reasons: readonly string[];
  readonly minimums: {
    readonly observedSessions: 20;
    readonly completedOrders: 50;
    readonly marketRegimes: 3;
    readonly restartRecoveryPasses: 3;
    readonly duplicateOrderChecks: 10;
  };
}

const REQUIRED_FAULTS: readonly RequiredPaperFaultScenario[] = Object.freeze([
  "PERSISTENCE_FAILURE",
  "WEBSOCKET_DISCONNECT",
  "PARTIAL_WRITE",
  "DUPLICATE_SIGNAL",
  "KILL_SWITCH"
]);

const count = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

export function evaluateScenarioPaperEvidence(input: ScenarioPaperEvidenceInput): ScenarioPaperValidationResult {
  count(input.generatedAt, "generatedAt");
  count(input.observedSessions, "observedSessions");
  count(input.completedOrders, "completedOrders");
  count(input.marketRegimes, "marketRegimes");
  count(input.restartRecoveryPasses, "restartRecoveryPasses");
  count(input.duplicateOrderChecks, "duplicateOrderChecks");
  if (new Set(input.passedFaultScenarios).size !== input.passedFaultScenarios.length) throw new Error("fault scenarios must be unique");
  if (input.passedFaultScenarios.some((scenario) => !REQUIRED_FAULTS.includes(scenario))) throw new Error("unsupported fault scenario");

  const reasons: string[] = [];
  if (input.observedSessions < 20) reasons.push("INSUFFICIENT_OBSERVED_SESSIONS");
  if (input.completedOrders < 50) reasons.push("INSUFFICIENT_COMPLETED_ORDERS");
  if (input.marketRegimes < 3) reasons.push("INSUFFICIENT_MARKET_REGIMES");
  if (input.restartRecoveryPasses < 3) reasons.push("INSUFFICIENT_RESTART_RECOVERY_PASSES");
  if (input.duplicateOrderChecks < 10) reasons.push("INSUFFICIENT_DUPLICATE_ORDER_CHECKS");
  for (const scenario of REQUIRED_FAULTS) if (!input.passedFaultScenarios.includes(scenario)) reasons.push(`FAULT_SCENARIO_${scenario}_MISSING`);
  if (!input.walkForwardPassed) reasons.push("WALK_FORWARD_NOT_PASSED");
  if (!input.costStressPassed) reasons.push("COST_STRESS_NOT_PASSED");
  if (!input.monteCarloPassed) reasons.push("MONTE_CARLO_NOT_PASSED");
  if (!input.integrityChecksPassed) reasons.push("INTEGRITY_CHECK_NOT_PASSED");

  return Object.freeze({
    profile: "SCENARIO_BASED" as const,
    generatedAt: input.generatedAt,
    status: reasons.length === 0 ? "PASS" as const : "FAIL" as const,
    reasons: Object.freeze(reasons.sort()),
    minimums: Object.freeze({
      observedSessions: 20 as const,
      completedOrders: 50 as const,
      marketRegimes: 3 as const,
      restartRecoveryPasses: 3 as const,
      duplicateOrderChecks: 10 as const
    })
  });
}

import type { AiCioDashboardSnapshot } from "./dashboardAggregator";
import type { RecoveryPlan, RecoveryScenario } from "./disasterRecovery";
import type { PaperValidationEvidence } from "./paperValidationEvidence";
import type { ReleaseReadinessReport } from "./releaseReadinessAudit";
import type { PaperValidationProfile, ScenarioPaperValidationResult } from "./scenarioPaperValidation";

export type OperationalCompletionStatus = "BLOCKED" | "WAITING_FOR_EVIDENCE" | "READY_FOR_OWNER_REVIEW";

export interface OperationalCompletionInput {
  readonly now: number;
  readonly dashboard: AiCioDashboardSnapshot;
  readonly paperEvidence: PaperValidationEvidence;
  readonly recoveryPlans: readonly RecoveryPlan[];
  readonly releaseReadiness: ReleaseReadinessReport;
  readonly validationProfile?: PaperValidationProfile;
  readonly scenarioEvidence?: ScenarioPaperValidationResult;
}

export interface OperationalCompletionResult {
  readonly status: OperationalCompletionStatus;
  readonly validationProfile: PaperValidationProfile;
  readonly generatedAt: number;
  readonly sourceCoverageComplete: boolean;
  readonly paperEvidenceComplete: boolean;
  readonly recoveryDrillsComplete: boolean;
  readonly releaseAuditComplete: boolean;
  readonly blockers: readonly string[];
  readonly pendingEvidence: readonly string[];
  readonly ownerReviewRequired: true;
  readonly automaticCompletionAllowed: false;
  readonly liveTradingAllowed: false;
}

const REQUIRED_RECOVERY_SCENARIOS: readonly RecoveryScenario[] = Object.freeze([
  "SQLITE_CORRUPTION",
  "SNAPSHOT_CORRUPTION",
  "RUNTIME_CRASH",
  "EVENT_LOG_GAP"
]);

const SECTION_NAMES = ["portfolio", "opportunities", "strategies", "committee", "execution", "research", "risk"] as const;

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

export function evaluateOperationalCompletion(input: OperationalCompletionInput): OperationalCompletionResult {
  assertTime(input.now, "now");
  for (const [field, value] of [
    ["dashboard.generatedAt", input.dashboard.generatedAt],
    ["paperEvidence.generatedAt", input.paperEvidence.generatedAt],
    ["releaseReadiness.generatedAt", input.releaseReadiness.generatedAt]
  ] as const) {
    assertTime(value, field);
    if (value > input.now) throw new Error(`${field} cannot be in the future`);
  }

  const validationProfile = input.validationProfile ?? "CALENDAR_30_DAY";
  if (validationProfile !== "CALENDAR_30_DAY" && validationProfile !== "SCENARIO_BASED") throw new Error("unsupported Paper validation profile");
  if (input.scenarioEvidence) {
    assertTime(input.scenarioEvidence.generatedAt, "scenarioEvidence.generatedAt");
    if (input.scenarioEvidence.generatedAt > input.now) throw new Error("scenarioEvidence.generatedAt cannot be in the future");
  }

  const blockers: string[] = [];
  const releaseValidationProfile = input.releaseReadiness.paperValidationProfile ?? "CALENDAR_30_DAY";
  if (releaseValidationProfile !== validationProfile) blockers.push("RELEASE_VALIDATION_PROFILE_MISMATCH");
  const pendingEvidence: string[] = [];
  const unavailableSources = SECTION_NAMES.filter((name) => (input.dashboard[name].availability ?? "AVAILABLE") !== "AVAILABLE");
  const sourceCoverageComplete = unavailableSources.length === 0 && input.dashboard.status === "HEALTHY";
  if (unavailableSources.length > 0) blockers.push(...unavailableSources.map((name) => `DASHBOARD_SOURCE_${name.toUpperCase()}_NOT_AVAILABLE`));
  if (input.dashboard.status !== "HEALTHY") blockers.push(`DASHBOARD_STATUS_${input.dashboard.status}`);

  const scenarios = new Map<RecoveryScenario, RecoveryPlan>();
  for (const plan of input.recoveryPlans) {
    if (scenarios.has(plan.scenario)) throw new Error(`duplicate recovery scenario: ${plan.scenario}`);
    scenarios.set(plan.scenario, plan);
  }
  for (const scenario of REQUIRED_RECOVERY_SCENARIOS) {
    const plan = scenarios.get(scenario);
    if (!plan) blockers.push(`RECOVERY_SCENARIO_${scenario}_MISSING`);
    else if (plan.status !== "READY" || !plan.paperResumeAllowed) blockers.push(`RECOVERY_SCENARIO_${scenario}_BLOCKED`);
  }
  const recoveryDrillsComplete = REQUIRED_RECOVERY_SCENARIOS.every((scenario) => {
    const plan = scenarios.get(scenario);
    return plan?.status === "READY" && plan.paperResumeAllowed;
  });

  const paperEvidenceComplete = validationProfile === "CALENDAR_30_DAY"
    ? input.paperEvidence.status === "PASS"
    : input.scenarioEvidence?.status === "PASS";
  if (!paperEvidenceComplete) {
    pendingEvidence.push(validationProfile === "CALENDAR_30_DAY"
      ? "PAPER_VALIDATION_EVIDENCE_INCOMPLETE"
      : "SCENARIO_PAPER_EVIDENCE_INCOMPLETE");
  }

  const nonPaperReleaseBlockers = input.releaseReadiness.requirements
    .filter((requirement) => requirement.required && !requirement.passed && requirement.id !== "PAPER_VALIDATION")
    .map((requirement) => `RELEASE_REQUIREMENT_${requirement.id}_FAILED`);
  blockers.push(...nonPaperReleaseBlockers);
  const calendarPaperRequirementPassed = input.releaseReadiness.requirements.find((requirement) => requirement.id === "PAPER_VALIDATION")?.passed === true;
  const paperRequirementPassed = validationProfile === "CALENDAR_30_DAY" ? calendarPaperRequirementPassed : paperEvidenceComplete;
  if (!paperRequirementPassed) pendingEvidence.push(validationProfile === "CALENDAR_30_DAY" ? "RELEASE_PAPER_VALIDATION_INCOMPLETE" : "SCENARIO_RELEASE_EVIDENCE_INCOMPLETE");
  const releaseAuditComplete = nonPaperReleaseBlockers.length === 0 && paperRequirementPassed;

  const uniqueBlockers = [...new Set(blockers)].sort();
  const uniquePending = [...new Set(pendingEvidence)].sort();
  const status: OperationalCompletionStatus = uniqueBlockers.length > 0
    ? "BLOCKED"
    : !paperEvidenceComplete || !paperRequirementPassed || !releaseAuditComplete
      ? "WAITING_FOR_EVIDENCE"
      : "READY_FOR_OWNER_REVIEW";

  return deepFreeze({
    status,
    validationProfile,
    generatedAt: input.now,
    sourceCoverageComplete,
    paperEvidenceComplete,
    recoveryDrillsComplete,
    releaseAuditComplete,
    blockers: uniqueBlockers,
    pendingEvidence: uniquePending,
    ownerReviewRequired: true as const,
    automaticCompletionAllowed: false as const,
    liveTradingAllowed: false as const
  });
}

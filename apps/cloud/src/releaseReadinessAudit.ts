import type { PaperValidationProfile } from "./scenarioPaperValidation";

export type ReleaseReadinessStatus = "READY" | "CONDITIONAL" | "BLOCKED";

export interface ReleaseReadinessInput {
  readonly generatedAt: number;
  readonly ciGreen: boolean;
  readonly typecheckPassed: boolean;
  readonly buildPassed: boolean;
  readonly testsPassed: boolean;
  readonly runtimeAuditPassed: boolean;
  readonly performanceAuditPassed: boolean;
  readonly securityAuditPassed: boolean;
  readonly recoveryProcedureDocumented: boolean;
  readonly operatorRunbookDocumented: boolean;
  readonly paperValidationDays: number;
  readonly paperValidationProfile?: PaperValidationProfile;
  readonly scenarioPaperValidationPassed?: boolean;
  readonly unresolvedCriticalFindings: number;
  readonly unresolvedHighFindings: number;
  readonly liveTradingEnabled: boolean;
  readonly pullRequestDraft: boolean;
}

export interface ReleaseReadinessRequirement {
  readonly id: string;
  readonly title: string;
  readonly required: boolean;
  readonly passed: boolean;
  readonly reason: string;
}

export interface ReleaseReadinessReport {
  readonly generatedAt: number;
  readonly status: ReleaseReadinessStatus;
  readonly paperValidationProfile: PaperValidationProfile;
  readonly score: number;
  readonly minimumPaperValidationDays: number;
  readonly requirements: readonly ReleaseReadinessRequirement[];
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly automaticReleaseAllowed: false;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const assertNonNegativeSafeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

export function buildReleaseReadinessReport(
  input: ReleaseReadinessInput,
  minimumPaperValidationDays = 30
): ReleaseReadinessReport {
  assertNonNegativeSafeInteger(input.generatedAt, "generatedAt");
  assertNonNegativeSafeInteger(input.paperValidationDays, "paperValidationDays");
  assertNonNegativeSafeInteger(input.unresolvedCriticalFindings, "unresolvedCriticalFindings");
  assertNonNegativeSafeInteger(input.unresolvedHighFindings, "unresolvedHighFindings");
  const paperValidationProfile = input.paperValidationProfile ?? "CALENDAR_30_DAY";
  if (paperValidationProfile !== "CALENDAR_30_DAY" && paperValidationProfile !== "SCENARIO_BASED") throw new Error("unsupported Paper validation profile");
  if (input.scenarioPaperValidationPassed !== undefined && typeof input.scenarioPaperValidationPassed !== "boolean") throw new Error("scenarioPaperValidationPassed must be boolean");
  if (!Number.isSafeInteger(minimumPaperValidationDays) || minimumPaperValidationDays <= 0) {
    throw new Error("minimumPaperValidationDays must be a positive safe integer");
  }

  const paperValidationPassed = paperValidationProfile === "CALENDAR_30_DAY"
    ? input.paperValidationDays >= minimumPaperValidationDays
    : input.scenarioPaperValidationPassed === true;
  const paperValidationTitle = paperValidationProfile === "CALENDAR_30_DAY"
    ? "Minimum Paper validation completed"
    : "Scenario Paper validation completed";
  const paperValidationReason = paperValidationProfile === "CALENDAR_30_DAY"
    ? `At least ${minimumPaperValidationDays} days of Paper operation are required`
    : "All required Paper sessions, orders, regimes, recovery, fault, research and integrity scenarios must pass";

  const requirements: ReleaseReadinessRequirement[] = [
    { id: "CI", title: "CI is green", required: true, passed: input.ciGreen, reason: "Latest required workflow must complete successfully" },
    { id: "TYPECHECK", title: "Typecheck passed", required: true, passed: input.typecheckPassed, reason: "TypeScript validation must be clean" },
    { id: "BUILD", title: "Build passed", required: true, passed: input.buildPassed, reason: "All required packages must build" },
    { id: "TESTS", title: "Tests passed", required: true, passed: input.testsPassed, reason: "Full isolated regression suite must pass" },
    { id: "RUNTIME_AUDIT", title: "Runtime audit passed", required: true, passed: input.runtimeAuditPassed, reason: "Fail-closed, immutable and append-only boundaries must hold" },
    { id: "PERFORMANCE_AUDIT", title: "Performance audit passed", required: true, passed: input.performanceAuditPassed, reason: "Runtime latency and memory behavior must meet the defined budget" },
    { id: "SECURITY_AUDIT", title: "Security audit passed", required: true, passed: input.securityAuditPassed, reason: "PAPER/DRY_RUN boundary must remain intact" },
    { id: "RECOVERY", title: "Recovery procedure documented", required: true, passed: input.recoveryProcedureDocumented, reason: "Operator recovery must be explicit and supported" },
    { id: "RUNBOOK", title: "Operator runbook documented", required: true, passed: input.operatorRunbookDocumented, reason: "Operational checks and escalation paths must be documented" },
    { id: "PAPER_VALIDATION", title: paperValidationTitle, required: true, passed: paperValidationPassed, reason: paperValidationReason },
    { id: "NO_CRITICAL", title: "No unresolved critical findings", required: true, passed: input.unresolvedCriticalFindings === 0, reason: "Critical findings block release" },
    { id: "NO_HIGH", title: "No unresolved high findings", required: false, passed: input.unresolvedHighFindings === 0, reason: "High findings require owner acceptance or remediation" },
    { id: "LIVE_DISABLED", title: "Live trading remains disabled", required: true, passed: !input.liveTradingEnabled, reason: "Release candidate remains PAPER/DRY_RUN only" },
    { id: "PR_DRAFT", title: "Pull request remains draft during audit", required: false, passed: input.pullRequestDraft, reason: "Draft state is recommended until owner review is complete" }
  ];

  const blockers = requirements.filter((item) => item.required && !item.passed).map((item) => item.title);
  const warnings = requirements.filter((item) => !item.required && !item.passed).map((item) => item.title);
  const passedCount = requirements.filter((item) => item.passed).length;
  const score = Math.round((passedCount / requirements.length) * 100);
  const status: ReleaseReadinessStatus = blockers.length > 0 ? "BLOCKED" : warnings.length > 0 ? "CONDITIONAL" : "READY";

  return deepFreeze({
    generatedAt: input.generatedAt,
    status,
    paperValidationProfile,
    score,
    minimumPaperValidationDays,
    requirements,
    blockers,
    warnings,
    automaticReleaseAllowed: false as const
  });
}

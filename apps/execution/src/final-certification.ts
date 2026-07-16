export enum CertificationImplementationStatus {
  PLANNED = "PLANNED",
  PARTIALLY_IMPLEMENTED = "PARTIALLY_IMPLEMENTED",
  IMPLEMENTED = "IMPLEMENTED",
  VERIFIED = "VERIFIED",
  PRODUCTION_OBSERVED = "PRODUCTION_OBSERVED",
  DEPRECATED = "DEPRECATED",
  NOT_FOUND = "NOT_FOUND"
}

export enum FinalCertificationDecision {
  AUTHORIZED = "AUTHORIZED",
  AUTHORIZED_WITH_LIMITATIONS = "AUTHORIZED_WITH_LIMITATIONS",
  RESTRICTED_OPERATIONS_ONLY = "RESTRICTED_OPERATIONS_ONLY",
  DEFERRED = "DEFERRED",
  REJECTED = "REJECTED",
  REVOKED = "REVOKED"
}

export enum CertificationRequirementStatus {
  PASS = "PASS",
  PASS_WITH_LIMITATIONS = "PASS_WITH_LIMITATIONS",
  FAIL = "FAIL",
  UNKNOWN = "UNKNOWN",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  NOT_VERIFIED = "NOT_VERIFIED",
  STALE = "STALE"
}

export interface CertificationRequirementResult {
  readonly id: string;
  readonly status: CertificationRequirementStatus;
  readonly nonWaivable: boolean;
  readonly reason?: string;
}

export interface TradingIntegrationPhaseInventoryItem {
  readonly phase: number;
  readonly name: string;
  readonly status: CertificationImplementationStatus;
  readonly evidence: readonly string[];
}

export interface FinalCertificationInput {
  readonly requirements: readonly CertificationRequirementResult[];
  readonly openCriticalFindings: number;
  readonly openHighFindings: number;
  readonly productionObserved: boolean;
  readonly independentReview: "INDEPENDENT" | "INDEPENDENCE_LIMITED" | "CONFLICTED" | "NOT_PERFORMED";
}

export interface FinalCertificationResult {
  readonly decision: FinalCertificationDecision;
  readonly productionMutationAllowed: boolean;
  readonly blockingRequirementIds: readonly string[];
  readonly limitations: readonly string[];
}

const unsafeRequirementStatuses = new Set<CertificationRequirementStatus>([
  CertificationRequirementStatus.FAIL,
  CertificationRequirementStatus.UNKNOWN,
  CertificationRequirementStatus.NOT_IMPLEMENTED,
  CertificationRequirementStatus.NOT_VERIFIED,
  CertificationRequirementStatus.STALE
]);

export function evaluateFinalCertification(input: FinalCertificationInput): FinalCertificationResult {
  const nonWaivableFailures = input.requirements.filter(requirement => requirement.nonWaivable && unsafeRequirementStatuses.has(requirement.status));
  const blockingRequirements = input.requirements.filter(requirement => unsafeRequirementStatuses.has(requirement.status));

  if (nonWaivableFailures.length > 0 || input.openCriticalFindings > 0 || input.independentReview === "CONFLICTED") {
    return Object.freeze({
      decision: FinalCertificationDecision.REJECTED,
      productionMutationAllowed: false,
      blockingRequirementIds: Object.freeze(nonWaivableFailures.map(requirement => requirement.id)),
      limitations: Object.freeze([
        ...(input.openCriticalFindings > 0 ? ["OPEN_CRITICAL_FINDINGS"] : []),
        ...(input.independentReview === "CONFLICTED" ? ["CONFLICTED_REVIEW"] : [])
      ])
    });
  }

  if (blockingRequirements.length > 0 || input.independentReview === "NOT_PERFORMED") {
    return Object.freeze({
      decision: FinalCertificationDecision.DEFERRED,
      productionMutationAllowed: false,
      blockingRequirementIds: Object.freeze(blockingRequirements.map(requirement => requirement.id)),
      limitations: Object.freeze(input.independentReview === "NOT_PERFORMED" ? ["INDEPENDENT_REVIEW_NOT_PERFORMED"] : [])
    });
  }

  const limitations = [
    ...input.requirements.filter(requirement => requirement.status === CertificationRequirementStatus.PASS_WITH_LIMITATIONS).map(requirement => requirement.id),
    ...(input.openHighFindings > 0 ? ["OPEN_HIGH_FINDINGS"] : []),
    ...(!input.productionObserved ? ["NO_PRODUCTION_OBSERVATION"] : []),
    ...(input.independentReview === "INDEPENDENCE_LIMITED" ? ["INDEPENDENCE_LIMITED"] : [])
  ];

  if (limitations.length > 0) {
    return Object.freeze({
      decision: FinalCertificationDecision.AUTHORIZED_WITH_LIMITATIONS,
      productionMutationAllowed: true,
      blockingRequirementIds: Object.freeze([]),
      limitations: Object.freeze(limitations)
    });
  }

  return Object.freeze({
    decision: FinalCertificationDecision.AUTHORIZED,
    productionMutationAllowed: true,
    blockingRequirementIds: Object.freeze([]),
    limitations: Object.freeze([])
  });
}

export function createReconstructedBaselineInventory(): readonly TradingIntegrationPhaseInventoryItem[] {
  const implemented = new Map<number, readonly string[]>([
    [1, ["packages/contracts/src/index.ts"]],
    [2, [
      "packages/storage/src/index.ts",
      "packages/storage/src/order-idempotency.ts",
      "packages/storage/src/order-execution.ts",
      "packages/storage/migrations/001_positions.sql",
      "packages/storage/migrations/002_order_idempotency.sql",
      "packages/storage/migrations/003_order_executions.sql"
    ]],
    [3, [
      "apps/execution/src/pre-trade-risk.ts",
      "apps/execution/src/order-admission.ts",
      "apps/execution/src/execution-gateway.ts",
      "apps/execution/src/order-reconciliation.ts",
      "tests/submission-reconciliation.test.js",
      "tests/order-reconciliation-worker.test.js"
    ]]
  ]);

  return Object.freeze(Array.from({ length: 45 }, (_, index) => {
    const phase = index + 1;
    const evidence = implemented.get(phase) ?? [];
    return Object.freeze({
      phase,
      name: `Trading Integration 2-${phase}`,
      status: evidence.length === 0 ? CertificationImplementationStatus.NOT_FOUND : CertificationImplementationStatus.PARTIALLY_IMPLEMENTED,
      evidence: Object.freeze([...evidence])
    });
  }));
}

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
      "packages/storage/src/order-reconciliation-evidence.ts",
      "packages/storage/src/order-restriction.ts",
      "packages/storage/src/order-restriction-release-evidence.ts",
      "packages/storage/src/position-reconciliation.ts",
      "packages/storage/src/position-reconciliation-run-evidence.ts",
      "packages/storage/src/balance-reconciliation.ts",
      "packages/storage/migrations/001_position_accounting.sql",
      "packages/storage/migrations/002_order_idempotency.sql",
      "packages/storage/migrations/003_order_executions.sql",
      "packages/storage/migrations/004_order_reconciliation_evidence.sql",
      "packages/storage/migrations/005_order_operational_restrictions.sql",
      "packages/storage/migrations/006_order_restriction_release_evidence.sql",
      "packages/storage/migrations/007_position_reconciliation.sql",
      "packages/storage/migrations/008_position_restriction_release_evidence.sql",
      "packages/storage/migrations/009_position_state_uncertainty.sql",
      "packages/storage/migrations/010_position_reconciliation_runs.sql",
      "packages/storage/migrations/011_position_reconciliation_stale.sql",
      "packages/storage/migrations/012_balance_reconciliation.sql",
      "packages/storage/migrations/013_balance_reconciliation_release.sql",
      "tests/order-execution-storage.test.js",
      "tests/order-idempotency-storage.test.js",
      "tests/reconstruction.test.js"
    ]],
    [3, [
      "apps/execution/src/pre-trade-risk.ts",
      "apps/execution/src/order-admission.ts",
      "apps/execution/src/execution-gateway.ts",
      "apps/execution/src/order-reconciliation.ts",
      "apps/execution/src/order-restriction.ts",
      "apps/execution/src/position-reconciliation.ts",
      "apps/execution/src/position-reconciliation-worker.ts",
      "apps/execution/src/balance-reconciliation.ts",
      "tests/submission-reconciliation.test.js",
      "tests/order-admission.test.js",
      "tests/execution-gateway.test.js",
      "tests/order-reconciliation-worker.test.js",
      "tests/order-reconciliation-evidence.test.js",
      "tests/order-operational-restriction.test.js",
      "tests/order-restriction-release.test.js",
      "tests/position-reconciliation.test.js",
      "tests/position-reconciliation-worker.test.js",
      "tests/position-reconciliation-run-evidence.test.js",
      "tests/position-reconciliation-freshness-guard.test.js",
      "tests/position-restriction-release-storage.test.js",
      "tests/balance-reconciliation.test.js",
      "tests/balance-reconciliation-release.test.js"
    ]],
    [4, [
      "packages/storage/src/funding-reconciliation.ts",
      "packages/storage/migrations/014_funding_reconciliation.sql",
      "packages/storage/migrations/015_funding_reconciliation_release.sql",
      "apps/execution/src/funding-reconciliation.ts",
      "tests/funding-reconciliation.test.js",
      "tests/funding-reconciliation-release.test.js"
    ]],
    [5, [
      "packages/storage/src/fee-reconciliation.ts",
      "packages/storage/migrations/016_fee_reconciliation.sql",
      "packages/storage/migrations/017_fee_reconciliation_release.sql",
      "apps/execution/src/fee-reconciliation.ts",
      "apps/execution/src/fee-reconciliation-lifecycle.ts",
      "tests/fee-reconciliation.test.js",
      "tests/fee-reconciliation-lifecycle.test.js"
    ]],
    [6, [
      "packages/storage/src/fill-reconciliation.ts",
      "packages/storage/migrations/018_fill_reconciliation.sql",
      "packages/storage/migrations/019_fill_reconciliation_release.sql",
      "apps/execution/src/fill-reconciliation.ts",
      "tests/fill-reconciliation.test.js"
    ]],
    [7, [
      "packages/storage/src/pnl-reconciliation.ts",
      "packages/storage/migrations/020_pnl_reconciliation.sql",
      "packages/storage/migrations/021_pnl_reconciliation_release.sql",
      "apps/execution/src/pnl-reconciliation.ts",
      "tests/pnl-reconciliation.test.js"
    ]],
    [8, [
      "packages/storage/src/liquidation-risk.ts",
      "packages/storage/migrations/022_liquidation_risk.sql",
      "apps/execution/src/liquidation-guard.ts",
      "apps/execution/src/exchange-constraints.ts",
      "apps/execution/src/rate-limit-manager.ts",
      "apps/execution/src/clock-synchronization.ts",
      "apps/execution/src/websocket-recovery.ts",
      "tests/liquidation-guard.test.js",
      "tests/exchange-constraints.test.js",
      "tests/connectivity-guards.test.js"
    ]],
    [9, [
      "packages/storage/src/recovery-evidence.ts",
      "packages/storage/migrations/023_recovery_and_startup_evidence.sql",
      "apps/execution/src/disaster-recovery.ts",
      "apps/execution/src/startup-consistency-gate.ts",
      "apps/execution/src/production-readiness.ts",
      "apps/execution/src/recovery-evidence.ts",
      "apps/execution/src/fault-injection.ts",
      "apps/execution/src/chaos-recovery-harness.ts",
      "apps/execution/src/invariant-monitor.ts",
      "tests/disaster-recovery-readiness.test.js",
      "tests/recovery-evidence-chaos.test.js"
    ]],
    [10, [
      "packages/storage/migrations/024_burn_in_and_certification_evidence.sql",
      "apps/execution/src/burn-in-harness.ts",
      "apps/execution/src/synthetic-certification-report.ts",
      "apps/execution/src/certification-evidence.ts",
      "tests/burn-in-certification.test.js",
      "tests/burn-in-evidence-persistence.test.js",
      "packages/storage/migrations/027_burn_in_sample_evidence.sql"
    ]],
    [11, [
      "packages/storage/migrations/025_release_candidate_freeze_evidence.sql",
      "apps/execution/src/release-candidate-freeze.ts",
      "apps/execution/src/release-freeze-evidence.ts",
      "apps/execution/src/artifact-manifest.ts",
      "apps/execution/src/release-candidate-promotion.ts",
      "apps/execution/src/independent-approval.ts",
      "apps/execution/src/independent-approval-evidence.ts",
      "apps/execution/src/promotion-evidence.ts",
      "tests/release-candidate-freeze.test.js",
      "tests/release-candidate-promotion.test.js"
    ]],
    [12, [
      "apps/execution/src/deployment-hard-block.ts",
      "apps/execution/src/deployment-attempt-evidence.ts",
      "apps/execution/src/credential-boundary.ts",
      "apps/execution/src/credential-boundary-evidence.ts",
      "apps/execution/src/production-adapter-attestation.ts",
      "apps/execution/src/production-adapter-attestation-evidence.ts",
      "apps/execution/src/deployment-evidence-chain.ts",
      "tests/deployment-boundary.test.js",
      "tests/promotion-approval-deployment.test.js",
      "tests/deployment-evidence-persistence.test.js"
    ]],
    [13, [
      "apps/execution/src/evidence-completeness-audit.ts",
      "apps/execution/src/evidence-completeness-audit-evidence.ts",
      "apps/execution/src/final-synthetic-release-envelope.ts",
      "apps/execution/src/final-envelope-evidence.ts",
      "tests/final-synthetic-release-envelope.test.js",
      "tests/final-envelope-revocation.test.js",
      "tests/final-envelope-persistence.test.js"
    ]],
    [14, [
      "apps/execution/src/evidence-graph-integrity.ts",
      "apps/execution/src/evidence-graph-seal.ts",
      "apps/execution/src/evidence-graph-seal-repository.ts",
      "packages/storage/src/evidence-graph-seal.ts",
      "packages/storage/migrations/026_evidence_graph_seal_chain.sql",
      "tests/evidence-graph-seal-chain.test.js"
    ]],
    [15, [
      "apps/execution/src/synthetic-release-revocation.ts",
      "apps/execution/src/revocation-evidence.ts",
      "apps/execution/src/synthetic-release-status.ts",
      "apps/execution/src/synthetic-release-status-evidence.ts",
      "tests/synthetic-release-status.test.js"
    ]],
    [16, [
      "apps/execution/src/certification-snapshot.ts",
      "apps/execution/src/synthetic-baseline-closure-report.ts",
      "tests/synthetic-baseline-closure.test.js"
    ]],
    [17, [
      "apps/execution/src/final-certification.ts",
      "tests/final-certification.test.js"
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

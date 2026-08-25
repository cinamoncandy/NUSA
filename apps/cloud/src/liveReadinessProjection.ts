import {
  collectLiveReadinessEvidence,
  type LiveReadinessSourceId,
  type LiveReadinessSourceSnapshot,
} from "./liveReadinessEvidence";
import { evaluateLiveReadiness } from "./liveReadinessGate";
import type { LiveReadinessProductionSourceSnapshot } from "./liveReadinessSourceProvider";
import {
  validateLiveReadinessObservabilitySnapshot,
  type LiveReadinessObservabilitySnapshot,
  type LiveReadinessProjectionIncident,
  type LiveReadinessProjectionSourceId,
} from "../../../packages/contracts/src/liveReadinessObservability";
import { buildCanonicalLiveLifecycleEvidence } from "./liveLifecycleEvidence";

const blockerSource = new Map<string, LiveReadinessProjectionSourceId>([
  ["PAPER_AUTO_LEARNING_NOT_STABLE", "paperAutoLearning"],
  ["SHADOW_REPLAY_EVIDENCE_MISSING", "shadowReplay"],
  ["REAL_ACCOUNT_READ_ONLY_UNHEALTHY", "realAccountMonitor"],
  ["GOVERNANCE_NOT_APPROVED", "governance"],
  ["TRADE_PERMISSION_REJECTED", "tradePermission"],
  ["RISK_AUTHORITY_UNHEALTHY", "riskAuthority"],
  ["RECONCILIATION_TESTS_FAILED", "reconciliationTests"],
  ["KILL_SWITCH_TESTS_FAILED", "killSwitchTests"],
  ["IDEMPOTENCY_TESTS_FAILED", "idempotencyTests"],
  ["EXCHANGE_FAULT_TESTS_FAILED", "exchangeFaultTests"],
  ["REQUIRED_CI_NOT_GREEN", "workflows"],
  ["WITHDRAWAL_OR_TRANSFER_PATH_PRESENT", "prohibitedFinancialMutationScan"],
  ["SOURCE_EVIDENCE_INCOMPLETE", "runtimeSafety"],
  ["ENVIRONMENT_FINGERPRINT_MISSING", "environmentFingerprint"],
  ["ACCOUNT_FINGERPRINT_MISSING", "accountFingerprint"],
  ["KILL_SWITCH_ACTIVE", "runtimeSafety"],
  ["STALE_MARKET_DATA", "runtimeSafety"],
  ["RECONCILIATION_MISMATCH", "runtimeSafety"],
  ["EXCHANGE_ERROR", "runtimeSafety"],
  ["ABNORMAL_BALANCE_DRIFT", "runtimeSafety"],
  ["RISK_BUDGET_BREACH", "runtimeSafety"],
  ["STRATEGY_INVALIDATED", "runtimeSafety"],
  ["LATENCY_OR_SLIPPAGE_BREACH", "runtimeSafety"],
  ["MUTATION_WITHOUT_BOUNDED_LIVE_AUTHORITY", "authority"],
  ["INCONSISTENT_LIVE_AUTHORITY_STATE", "authority"],
  ["ACTIVATION_LEASE_INVALID_OR_EXPIRED", "activationLeaseState"],
]);

const criticalBlockers = new Set([
  "KILL_SWITCH_ACTIVE", "STALE_MARKET_DATA", "RECONCILIATION_MISMATCH", "EXCHANGE_ERROR", "ABNORMAL_BALANCE_DRIFT",
  "RISK_BUDGET_BREACH", "STRATEGY_INVALIDATED", "LATENCY_OR_SLIPPAGE_BREACH", "MUTATION_WITHOUT_BOUNDED_LIVE_AUTHORITY",
  "INCONSISTENT_LIVE_AUTHORITY_STATE", "ACTIVATION_LEASE_INVALID_OR_EXPIRED",
]);

function provenanceObservedAt(snapshot: LiveReadinessSourceSnapshot, sourceId: LiveReadinessSourceId): string | undefined {
  return snapshot.provenance?.inputs.find((input) => input.sourceId === sourceId)?.observedAt;
}

function projectionIncident(snapshot: LiveReadinessSourceSnapshot, code: string): LiveReadinessProjectionIncident {
  const sourceId = blockerSource.get(code);
  return Object.freeze({
    code,
    severity: criticalBlockers.has(code) ? "CRITICAL" : "WARNING",
    ...(sourceId === undefined ? {} : { sourceId, ...(provenanceObservedAt(snapshot, sourceId) === undefined ? {} : { observedAt: provenanceObservedAt(snapshot, sourceId) }) }),
  });
}

function credentialReadiness(snapshot: LiveReadinessSourceSnapshot): "READY" | "NOT_READY" | "UNKNOWN" {
  if (snapshot.realAccountMonitor === "CONNECTED") return "READY";
  if (snapshot.realAccountMonitor === "UNKNOWN") return "UNKNOWN";
  return "NOT_READY";
}

/**
 * Projects the production provider into the GET-only cockpit contract. The existing gate is the
 * only policy evaluator: this function only maps its result and the already-normalized evidence.
 */
export function projectLiveReadinessObservabilitySnapshot(
  snapshot: LiveReadinessProductionSourceSnapshot,
): LiveReadinessObservabilitySnapshot {
  const evidence = collectLiveReadinessEvidence(snapshot);
  const result = evaluateLiveReadiness(evidence, snapshot.runtimeSafety, snapshot.authority, snapshot.provenance.generatedAt);
  const inputs = snapshot.provenance.inputs.map((input) => Object.freeze({
    sourceId: input.sourceId,
    fingerprint: input.fingerprint,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    freshness: input.freshness,
  }));
  const output = Object.freeze({
    schemaVersion: 1 as const,
    mode: "LIVE_READY" as const,
    readOnly: true as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
    status: result.status,
    blockers: Object.freeze([...result.blockers].sort()),
    currentHeadSha: snapshot.currentHeadSha,
    paperAutoLearning: snapshot.paperAutoLearning,
    shadowReplay: snapshot.shadowReplay,
    realAccountMonitor: snapshot.realAccountMonitor,
    credentialReadiness: credentialReadiness(snapshot),
    governance: snapshot.governance,
    tradePermission: snapshot.tradePermission,
    riskAuthority: snapshot.riskAuthority,
    reconciliationTests: snapshot.reconciliationTests,
    killSwitchTests: snapshot.killSwitchTests,
    idempotencyTests: snapshot.idempotencyTests,
    exchangeFaultTests: snapshot.exchangeFaultTests,
    workflows: Object.freeze({ ...snapshot.workflows }),
    prohibitedFinancialMutationScan: snapshot.prohibitedFinancialMutationScan,
    environmentFingerprint: snapshot.environmentFingerprint,
    accountFingerprint: snapshot.accountFingerprint,
    ...(snapshot.riskLimits == null ? {} : { riskLimits: Object.freeze({ ...snapshot.riskLimits, marketAllowlist: Object.freeze([...snapshot.riskLimits.marketAllowlist]) }) }),
    runtimeSafety: Object.freeze({ ...snapshot.runtimeSafety }),
    activationState: snapshot.activationState,
    activationLeaseState: snapshot.activationLeaseState,
    freshness: Object.freeze({ ...snapshot.freshness }),
    provenance: Object.freeze({
      generatedAt: snapshot.provenance.generatedAt,
      sourceVersion: snapshot.provenance.sourceVersion,
      sourceFingerprint: snapshot.provenance.sourceFingerprint,
      inputs: Object.freeze(inputs),
    }),
    incidents: Object.freeze([...result.blockers].sort().map((code) => projectionIncident(snapshot, code))),
    timeline: buildCanonicalLiveLifecycleEvidence(snapshot.provenance.sourceFingerprint, snapshot.provenance.generatedAt),
    lastRefresh: snapshot.provenance.generatedAt,
  });
  return validateLiveReadinessObservabilitySnapshot(output);
}

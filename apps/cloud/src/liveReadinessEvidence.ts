import type {
  LiveAuthorityState,
  LiveReadinessEvidence,
  LiveRiskLimits,
  LiveRuntimeSafetyState,
} from "./liveReadinessGate";

export type EvidenceHealth = "PASS" | "FAIL" | "UNKNOWN";
export type RealAccountMonitorHealth = "CONNECTED" | "STALE" | "AUTH_ERROR" | "RELAY_ERROR" | "OFFLINE" | "UNKNOWN";
export type LiveReadinessFreshness = "FRESH" | "STALE" | "UNKNOWN";
export type LiveReadinessSourceId =
  | "currentHeadSha"
  | "paperAutoLearning"
  | "shadowReplay"
  | "realAccountMonitor"
  | "governance"
  | "tradePermission"
  | "riskAuthority"
  | "reconciliationTests"
  | "killSwitchTests"
  | "idempotencyTests"
  | "exchangeFaultTests"
  | "workflows"
  | "prohibitedFinancialMutationScan"
  | "environmentFingerprint"
  | "accountFingerprint"
  | "riskLimits"
  | "runtimeSafety"
  | "authority"
  | "activationState"
  | "activationLeaseState";

export interface LiveReadinessSourceProvenanceInput {
  readonly sourceId: LiveReadinessSourceId;
  readonly fingerprint: string;
  readonly observedAt?: string;
  readonly freshness: LiveReadinessFreshness;
}

export interface LiveReadinessSourceProvenance {
  readonly generatedAt: string;
  readonly sourceVersion: string;
  readonly sourceFingerprint: string;
  readonly inputs: readonly LiveReadinessSourceProvenanceInput[];
}

export type LiveActivationState = "NOT_CONFIGURED" | "PENDING" | "READY_FOR_MANUAL_ENABLE" | "ENABLED" | "HALTED" | "UNKNOWN";
export type LiveActivationLeaseState = "ABSENT" | "VALID" | "EXPIRED" | "UNKNOWN";

export const LIVE_READINESS_SOURCE_IDS: readonly LiveReadinessSourceId[] = Object.freeze([
  "currentHeadSha", "paperAutoLearning", "shadowReplay", "realAccountMonitor", "governance",
  "tradePermission", "riskAuthority", "reconciliationTests", "killSwitchTests", "idempotencyTests",
  "exchangeFaultTests", "workflows", "prohibitedFinancialMutationScan", "environmentFingerprint",
  "accountFingerprint", "riskLimits", "runtimeSafety", "authority", "activationState", "activationLeaseState",
]);

export interface ExactHeadWorkflowEvidence {
  readonly headSha: string;
  readonly ci: EvidenceHealth;
  readonly mobileNative: EvidenceHealth;
  readonly restrictedLiveSafety: EvidenceHealth;
  readonly readOnlyBroker: EvidenceHealth;
  readonly aiZeroAuthority: EvidenceHealth;
}

export interface LiveReadinessSourceSnapshot {
  readonly currentHeadSha: string;
  readonly paperAutoLearning: "STABLE" | "UNSTABLE" | "UNKNOWN";
  readonly shadowReplay: "VALID" | "INVALID" | "MISSING";
  readonly realAccountMonitor: RealAccountMonitorHealth;
  readonly governance: "APPROVED" | "REJECTED" | "UNKNOWN";
  readonly tradePermission: "PERMIT" | "REJECT" | "UNKNOWN";
  readonly riskAuthority: "HEALTHY" | "HALTED" | "UNKNOWN";
  readonly reconciliationTests: EvidenceHealth;
  readonly killSwitchTests: EvidenceHealth;
  readonly idempotencyTests: EvidenceHealth;
  readonly exchangeFaultTests: EvidenceHealth;
  readonly workflows: ExactHeadWorkflowEvidence;
  readonly prohibitedFinancialMutationScan: "ABSENT" | "PRESENT" | "UNKNOWN";
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly riskLimits?: LiveRiskLimits;
  /** Populated by the production provider; legacy test fixtures may omit it. */
  readonly freshness?: Readonly<Record<LiveReadinessSourceId, LiveReadinessFreshness>>;
  /** Populated by the production provider; legacy test fixtures may omit it. */
  readonly provenance?: LiveReadinessSourceProvenance;
  /** Runtime authority is observed, never granted, by the source provider. */
  readonly authority?: LiveAuthorityState;
  /** Runtime safety state is read-only input to the existing evaluator. */
  readonly runtimeSafety?: LiveRuntimeSafetyState;
  readonly activationState?: LiveActivationState;
  readonly activationLeaseState?: LiveActivationLeaseState;
}

const allRequiredWorkflowsPassOnExactHead = (
  currentHeadSha: string,
  workflows: ExactHeadWorkflowEvidence,
): boolean =>
  Boolean(currentHeadSha.trim()) &&
  workflows.headSha === currentHeadSha &&
  workflows.ci === "PASS" &&
  workflows.mobileNative === "PASS" &&
  workflows.restrictedLiveSafety === "PASS" &&
  workflows.readOnlyBroker === "PASS" &&
  workflows.aiZeroAuthority === "PASS";

export function collectLiveReadinessEvidence(snapshot: LiveReadinessSourceSnapshot): LiveReadinessEvidence {
  return Object.freeze({
    paperAutoLearningStable: snapshot.paperAutoLearning === "STABLE",
    shadowReplayEvidenceValid: snapshot.shadowReplay === "VALID",
    realAccountReadOnlyHealthy: snapshot.realAccountMonitor === "CONNECTED",
    governanceApproved: snapshot.governance === "APPROVED",
    tradePermissionPasses: snapshot.tradePermission === "PERMIT",
    riskAuthorityHealthy: snapshot.riskAuthority === "HEALTHY",
    reconciliationTestsPass: snapshot.reconciliationTests === "PASS",
    killSwitchTestsPass: snapshot.killSwitchTests === "PASS",
    idempotencyTestsPass: snapshot.idempotencyTests === "PASS",
    exchangeFaultTestsPass: snapshot.exchangeFaultTests === "PASS",
    requiredCiPasses: allRequiredWorkflowsPassOnExactHead(snapshot.currentHeadSha, snapshot.workflows),
    noWithdrawalOrTransferPath: snapshot.prohibitedFinancialMutationScan === "ABSENT",
    environmentFingerprint: snapshot.environmentFingerprint,
    accountFingerprint: snapshot.accountFingerprint,
    riskLimits: snapshot.riskLimits,
    ...(snapshot.provenance == null || snapshot.freshness == null
      ? {}
      : { sourceEvidenceAvailable: LIVE_READINESS_SOURCE_IDS.every((sourceId) => snapshot.freshness?.[sourceId] === "FRESH") }),
  });
}

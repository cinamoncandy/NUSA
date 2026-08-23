import type { LiveReadinessEvidence, LiveRiskLimits } from "./liveReadinessGate";

export type EvidenceHealth = "PASS" | "FAIL" | "UNKNOWN";
export type RealAccountMonitorHealth = "CONNECTED" | "STALE" | "AUTH_ERROR" | "RELAY_ERROR" | "OFFLINE";

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
  });
}

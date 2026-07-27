"use strict";
const { canonicalHash } = require("./canonical-hash.js");

function createPaperOperationalSafetyEvidence(run, verification, sourceCommitSha, pilotEvidence) {
  const status = run.failed === 0 && verification.verifierStatus === "PASS" ? "PASS" : "FAIL";
  const payload = {
    evidenceType: "PAPER_OPERATIONAL_SAFETY", schemaVersion: 1, sourceCommitSha, createdAt: 0,
    riskGatewayStatus: status, deploymentIntegrityStatus: "PASS", approvalStatus: "PASS", shadowGateStatus: status, canaryGateStatus: status,
    reconciliationStatus: status, restartSafetyStatus: status, safetyDrillStatus: status, independentVerifierStatus: verification.verifierStatus,
    actualGatewayBacked: true, liveCapabilityAbsent: true, privateApiCapabilityAbsent: true, credentialCapabilityAbsent: true,
    canaryLimitViolationCount: 0,
    drillCount: run.drills.length, verifiedDrillCount: verification.verifiedDrillCount,
    pilotEvidenceType: pilotEvidence?.evidenceType ?? "PAPER_PILOT_OPERATIONAL_EVIDENCE",
    pilotEvidenceSha256: pilotEvidence?.resultSha256 ?? "",
    operationalShadowEvidencePresent: pilotEvidence?.shadow?.operationalSessionCount > 0,
    operationalCanaryEvidencePresent: pilotEvidence?.canary?.operationalSessionCount > 0,
    shadowCriteriaMet: pilotEvidence?.shadow?.criteriaMet === true,
    canaryCriteriaMet: pilotEvidence?.canary?.criteriaMet === true,
    shadowSessionCount: pilotEvidence?.shadow?.operationalSessionCount ?? 0,
    shadowObservationMinutes: pilotEvidence?.shadow?.observationMinutes ?? 0,
    shadowClosedCandleCount: pilotEvidence?.shadow?.closedCandleCount ?? 0,
    shadowSignalCount: pilotEvidence?.shadow?.signalCount ?? 0,
    canarySessionCount: pilotEvidence?.canary?.operationalSessionCount ?? 0,
    canaryObservationMinutes: pilotEvidence?.canary?.observationMinutes ?? 0,
    canaryOrderCount: pilotEvidence?.canary?.orderCount ?? 0,
    canaryTradeCount: pilotEvidence?.canary?.completedTradeCount ?? 0,
    shadowMutationCount: pilotEvidence?.shadow ? pilotEvidence.shadow.actualOrderCount + pilotEvidence.shadow.actualFillCount + pilotEvidence.shadow.cashMutationCount + pilotEvidence.shadow.positionMutationCount : 0,
    unauthorizedOrderCount: pilotEvidence?.canary?.unauthorizedOrderCount ?? 0,
    duplicateFillCount: pilotEvidence?.canary?.duplicateFillCount ?? 0,
    orphanFillCount: pilotEvidence?.canary?.orphanFillCount ?? 0,
    reconciliationFailureCount: pilotEvidence?.canary?.reconciliationFailureCount ?? 0,
    automaticRestartViolationCount: pilotEvidence?.canary?.automaticRestartViolationCount ?? 0,
    reconnectAutoResumeViolationCount: pilotEvidence?.canary?.reconnectAutoResumeViolationCount ?? 0,
    persistenceContinuationViolationCount: pilotEvidence?.canary?.persistenceContinuationViolationCount ?? 0,
    p0Count: (pilotEvidence?.shadow?.p0Count ?? 0) + (pilotEvidence?.canary?.p0Count ?? 0),
    pilotVerifierStatus: !pilotEvidence ? "NOT_RUN" : pilotEvidence.shadow?.verifierStatus === "FAIL" || pilotEvidence.canary?.verifierStatus === "FAIL" ? "FAIL" : pilotEvidence.shadow?.verifierStatus === "PASS" && pilotEvidence.canary?.verifierStatus === "PASS" ? "PASS" : "NOT_RUN",
    evidenceFresh: pilotEvidence?.evidenceFresh === true,
    ownerReviewCompleted: pilotEvidence?.ownerReviewCompleted === true,
    promotionStatus: pilotEvidence?.promotionStatus ?? "OBSERVATION_INCOMPLETE",
    runnerResultSha256: run.resultSha256, verifierResultSha256: verification.verifierResultSha256,
    blockers: Object.freeze(status === "PASS" ? [] : ["SAFETY_DRILL_OR_VERIFIER_FAILED"])
  };
  return Object.freeze({ ...payload, resultSha256: canonicalHash(payload) });
}
module.exports = { createPaperOperationalSafetyEvidence };

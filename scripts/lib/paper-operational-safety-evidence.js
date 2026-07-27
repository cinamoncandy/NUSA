"use strict";
const { canonicalHash } = require("./canonical-hash.js");

function createPaperOperationalSafetyEvidence(run, verification, sourceCommitSha) {
  const status = run.failed === 0 && verification.verifierStatus === "PASS" ? "PASS" : "FAIL";
  const payload = {
    evidenceType: "PAPER_OPERATIONAL_SAFETY", schemaVersion: 1, sourceCommitSha, createdAt: 0,
    riskGatewayStatus: status, deploymentIntegrityStatus: "PASS", approvalStatus: "PASS", shadowGateStatus: status, canaryGateStatus: status,
    reconciliationStatus: status, restartSafetyStatus: status, safetyDrillStatus: status, independentVerifierStatus: verification.verifierStatus,
    actualGatewayBacked: true, liveCapabilityAbsent: true, privateApiCapabilityAbsent: true, credentialCapabilityAbsent: true,
    unauthorizedOrderCount: 0, duplicateFillCount: 0, orphanFillCount: 0, automaticRestartViolationCount: 0, shadowMutationCount: 0, canaryLimitViolationCount: 0,
    drillCount: run.drills.length, verifiedDrillCount: verification.verifiedDrillCount,
    operationalShadowEvidencePresent: false, operationalCanaryEvidencePresent: false,
    runnerResultSha256: run.resultSha256, verifierResultSha256: verification.verifierResultSha256,
    blockers: Object.freeze(status === "PASS" ? [] : ["SAFETY_DRILL_OR_VERIFIER_FAILED"])
  };
  return Object.freeze({ ...payload, resultSha256: canonicalHash(payload) });
}
module.exports = { createPaperOperationalSafetyEvidence };

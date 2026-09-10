import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenXSCertificationResult } from "./module10XS";
import { selectModuleVersion10XS } from "./moduleReplacementPolicy10XS";

const INCUMBENT = "1".repeat(40);
const CANDIDATE = "2".repeat(40);
const LKG = "3".repeat(40);
const FINGERPRINT = "a".repeat(64);

function certification(status: TenXSCertificationResult["status"], reasons: readonly string[] = []): TenXSCertificationResult {
  return Object.freeze({
    stage: "RISK",
    targetTier: "10X-S",
    effectiveTier: status === "CERTIFIED" ? "10X-S" : status === "DEMOTED" ? "10X" : "LEVEL_10",
    status,
    reasons: Object.freeze([...reasons]),
    lastKnownGoodRef: LKG,
    evidenceFingerprint: FINGERPRINT
  });
}

describe("10X-S module replacement policy", () => {
  it("promotes only a certified challenger proven better", () => {
    const result = selectModuleVersion10XS({
      stage: "RISK",
      incumbentRef: INCUMBENT,
      candidateRef: CANDIDATE,
      lastKnownGoodRef: LKG,
      incumbentCertification: certification("CERTIFIED"),
      candidateCertification: certification("CERTIFIED"),
      comparison: "BETTER"
    });
    assert.equal(result.action, "PROMOTE_CANDIDATE");
    assert.equal(result.selectedRef, CANDIDATE);
    assert.equal(result.productionMutationAllowed, false);
  });

  it("keeps the incumbent when the challenger is unverified or demoted", () => {
    const unverified = selectModuleVersion10XS({
      stage: "RISK",
      incumbentRef: INCUMBENT,
      candidateRef: CANDIDATE,
      lastKnownGoodRef: LKG,
      incumbentCertification: certification("CERTIFIED"),
      candidateCertification: certification("CERTIFIED"),
      comparison: "UNVERIFIED"
    });
    assert.equal(unverified.action, "KEEP_INCUMBENT");
    assert.equal(unverified.selectedRef, INCUMBENT);

    const demoted = selectModuleVersion10XS({
      stage: "RISK",
      incumbentRef: INCUMBENT,
      candidateRef: CANDIDATE,
      lastKnownGoodRef: LKG,
      incumbentCertification: certification("CERTIFIED"),
      candidateCertification: certification("DEMOTED", ["REGRESSION_DETECTED"]),
      comparison: "BETTER"
    });
    assert.equal(demoted.action, "KEEP_INCUMBENT");
    assert.equal(demoted.selectedRef, INCUMBENT);
  });

  it("rolls back to the stage LKG when the incumbent is quarantined", () => {
    const result = selectModuleVersion10XS({
      stage: "RISK",
      incumbentRef: INCUMBENT,
      candidateRef: CANDIDATE,
      lastKnownGoodRef: LKG,
      incumbentCertification: certification("QUARANTINED", ["SAFETY_BOUNDARY_FAILED"]),
      candidateCertification: certification("CERTIFIED"),
      comparison: "BETTER"
    });
    assert.equal(result.action, "ROLLBACK_LKG");
    assert.equal(result.selectedRef, LKG);
    assert.equal(result.reasons.includes("INCUMBENT_QUARANTINED"), true);
  });
});

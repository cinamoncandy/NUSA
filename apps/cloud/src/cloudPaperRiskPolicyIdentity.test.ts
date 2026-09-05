import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";
import { CLOUD_PAPER_RISK_POLICY_FINGERPRINT, cloudPaperRiskPolicyFingerprint } from "./cloudPaperRiskPolicyIdentity";

describe("cloud PAPER risk policy identity", () => {
  it("binds the exported production limits with the same SHA-256 material used by the canonical gateway", () => {
    const expected = createHash("sha256").update(JSON.stringify(CLOUD_PAPER_RISK_LIMITS), "utf8").digest("hex");
    assert.equal(CLOUD_PAPER_RISK_POLICY_FINGERPRINT, expected);
    assert.equal(cloudPaperRiskPolicyFingerprint(), expected);
  });

  it("changes when any risk limit changes and rejects invalid limits", () => {
    assert.notEqual(cloudPaperRiskPolicyFingerprint({ ...CLOUD_PAPER_RISK_LIMITS, maxOrderNotional: CLOUD_PAPER_RISK_LIMITS.maxOrderNotional + 1 }), CLOUD_PAPER_RISK_POLICY_FINGERPRINT);
    assert.throws(() => cloudPaperRiskPolicyFingerprint({ ...CLOUD_PAPER_RISK_LIMITS, maxOrderNotional: Number.NaN }), /risk limit/);
  });
});

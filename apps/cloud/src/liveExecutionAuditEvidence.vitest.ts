import { describe, expect, it } from "vitest";
import { createLiveExecutionAuditEvidence } from "./liveExecutionAuditEvidence";

const request = {
  market: "BTC-USD",
  side: "buy" as const,
  notional: 100,
  ownerId: "owner-1",
  fingerprint: "a".repeat(64),
};

describe("LIVE execution audit evidence", () => {
  it("creates deterministic evidence for a transport outcome", () => {
    const first = createLiveExecutionAuditEvidence(request, { accepted: false, reason: "LIVE_TRANSPORT_DISABLED" }, 1_000);
    const second = createLiveExecutionAuditEvidence(request, { accepted: false, reason: "LIVE_TRANSPORT_DISABLED" }, 1_000);
    expect(first.status).toBe("RECORDED");
    expect(second).toEqual(first);
    if (first.status === "RECORDED") {
      expect(first.evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.evidence.authorizationFingerprintSha256).toBe(request.fingerprint);
      expect(first.evidence.transportAccepted).toBe(false);
    }
  });

  it("changes evidence identity when the transport outcome changes", () => {
    const denied = createLiveExecutionAuditEvidence(request, { accepted: false, reason: "DENIED" }, 1_000);
    const accepted = createLiveExecutionAuditEvidence(request, { accepted: true, reason: "ACCEPTED" }, 1_000);
    expect(denied.status).toBe("RECORDED");
    expect(accepted.status).toBe("RECORDED");
    if (denied.status === "RECORDED" && accepted.status === "RECORDED") {
      expect(denied.evidence.evidenceSha256).not.toBe(accepted.evidence.evidenceSha256);
    }
  });

  it("fails closed on malformed evidence inputs", () => {
    expect(createLiveExecutionAuditEvidence({ ...request, ownerId: " " }, { accepted: false, reason: "DENIED" }, 1_000)).toEqual({ status: "REJECTED", reason: "OWNER_INVALID" });
    expect(createLiveExecutionAuditEvidence({ ...request, fingerprint: "bad" }, { accepted: false, reason: "DENIED" }, 1_000)).toEqual({ status: "REJECTED", reason: "FINGERPRINT_INVALID" });
    expect(createLiveExecutionAuditEvidence(request, { accepted: false, reason: " " }, 1_000)).toEqual({ status: "REJECTED", reason: "RESULT_INVALID" });
    expect(createLiveExecutionAuditEvidence(request, { accepted: false, reason: "DENIED" }, -1)).toEqual({ status: "REJECTED", reason: "RECORDED_AT_INVALID" });
  });
});

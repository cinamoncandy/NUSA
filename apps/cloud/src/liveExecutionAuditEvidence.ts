import { createHash } from "node:crypto";
import type { LiveBrokerTransportRequest, LiveBrokerTransportResult } from "./liveBrokerTransportBoundaryV3";

export type LiveExecutionAuditEvidence = Readonly<{
  schemaVersion: 1;
  ownerId: string;
  market: string;
  side: "buy" | "sell";
  notional: number;
  authorizationFingerprintSha256: string;
  transportAccepted: boolean;
  transportReason: string;
  recordedAtMs: number;
  evidenceSha256: string;
}>;

export type LiveExecutionAuditEvidenceDecision =
  | Readonly<{ status: "RECORDED"; evidence: LiveExecutionAuditEvidence }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

export function createLiveExecutionAuditEvidence(
  request: LiveBrokerTransportRequest,
  result: LiveBrokerTransportResult,
  recordedAtMs: number,
): LiveExecutionAuditEvidenceDecision {
  if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) return { status: "REJECTED", reason: "RECORDED_AT_INVALID" };
  if (typeof request.ownerId !== "string" || !request.ownerId.trim()) return { status: "REJECTED", reason: "OWNER_INVALID" };
  if (typeof request.market !== "string" || !request.market.trim()) return { status: "REJECTED", reason: "MARKET_INVALID" };
  if (request.side !== "buy" && request.side !== "sell") return { status: "REJECTED", reason: "SIDE_INVALID" };
  if (!Number.isFinite(request.notional) || request.notional <= 0) return { status: "REJECTED", reason: "NOTIONAL_INVALID" };
  if (!/^[a-f0-9]{64}$/i.test(request.fingerprint)) return { status: "REJECTED", reason: "FINGERPRINT_INVALID" };
  if (typeof result.accepted !== "boolean" || typeof result.reason !== "string" || !result.reason.trim()) return { status: "REJECTED", reason: "RESULT_INVALID" };

  const canonical = JSON.stringify({
    schemaVersion: 1,
    ownerId: request.ownerId,
    market: request.market,
    side: request.side,
    notional: request.notional,
    authorizationFingerprintSha256: request.fingerprint.toLowerCase(),
    transportAccepted: result.accepted,
    transportReason: result.reason,
    recordedAtMs,
  });
  const evidenceSha256 = createHash("sha256").update(canonical).digest("hex");
  return {
    status: "RECORDED",
    evidence: Object.freeze({ ...JSON.parse(canonical), evidenceSha256 }) as LiveExecutionAuditEvidence,
  };
}

import { createHash } from "node:crypto";
import type { LiveAutonomousPreExecutionEnvelope } from "./liveAutonomousPreExecutionGate";
import type { ConsumeOnceResult, LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";

export interface LiveTransportRequest {
  readonly ownerPrincipalId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly requestedNotionalUsd: number;
  readonly authorizationFingerprintSha256: string;
}

export interface LiveTransportConsumeScope {
  readonly ownerPrincipalId: string;
  readonly sessionId: string;
  readonly sessionRevision: number;
}

export type LiveTransportDecision =
  | { readonly status: "READY"; readonly request: LiveTransportRequest }
  | { readonly status: "REJECTED"; readonly reason: "ENVELOPE_REJECTED" | "ENVELOPE_EXPIRED" | "ENVELOPE_ALREADY_CONSUMED" | "ENVELOPE_INVALID" };

function buildSessionScopedAuthorizationFingerprint(
  envelope: LiveAutonomousPreExecutionEnvelope,
  scope: LiveTransportConsumeScope,
): string | null {
  const ownerPrincipalId = scope.ownerPrincipalId.trim();
  const sessionId = scope.sessionId.trim();
  if (
    ownerPrincipalId.length === 0
    || ownerPrincipalId !== envelope.ownerPrincipalId
    || sessionId.length === 0
    || !Number.isSafeInteger(scope.sessionRevision)
    || scope.sessionRevision < 1
  ) {
    return null;
  }

  const canonical = [
    "live-authoritative-consume:v1",
    envelope.authorizationFingerprintSha256,
    ownerPrincipalId,
    sessionId,
    String(scope.sessionRevision),
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Final boundary before a future broker adapter.
 * This contract intentionally performs no network call and grants no production authority.
 * A broker implementation must consume the envelope successfully before it can receive a request.
 */
export async function prepareLiveTransportRequest(
  envelope: LiveAutonomousPreExecutionEnvelope,
  consumeOnce: LiveExecutionConsumeOnce,
  now: number,
  consumeScope?: LiveTransportConsumeScope,
): Promise<LiveTransportDecision> {
  if (envelope.status !== "READY") return { status: "REJECTED", reason: "ENVELOPE_REJECTED" };
  if (!Number.isSafeInteger(now) || now < envelope.issuedAt) {
    return { status: "REJECTED", reason: "ENVELOPE_INVALID" };
  }
  if (now >= envelope.expiresAt) return { status: "REJECTED", reason: "ENVELOPE_EXPIRED" };

  const authorizationFingerprintSha256 = consumeScope
    ? buildSessionScopedAuthorizationFingerprint(envelope, consumeScope)
    : envelope.authorizationFingerprintSha256;
  if (authorizationFingerprintSha256 === null) {
    return { status: "REJECTED", reason: "ENVELOPE_INVALID" };
  }

  const consumed: ConsumeOnceResult = await consumeOnce.consume({
    authorizationFingerprintSha256,
    expiresAt: envelope.expiresAt,
  }, now);
  if (!consumed.consumed) {
    if (consumed.reason === "EXPIRED") return { status: "REJECTED", reason: "ENVELOPE_EXPIRED" };
    if (consumed.reason === "ALREADY_CONSUMED") return { status: "REJECTED", reason: "ENVELOPE_ALREADY_CONSUMED" };
    return { status: "REJECTED", reason: "ENVELOPE_INVALID" };
  }

  return {
    status: "READY",
    request: Object.freeze({
      ownerPrincipalId: envelope.ownerPrincipalId,
      market: envelope.market,
      side: envelope.side,
      requestedNotionalUsd: envelope.requestedNotionalUsd,
      authorizationFingerprintSha256,
    }),
  };
}

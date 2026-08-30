import type { LiveAutonomousPreExecutionEnvelope } from "./liveAutonomousPreExecutionGate";
import type { ConsumeOnceResult, LiveExecutionConsumeOnce } from "./liveExecutionConsumeOnce";

export interface LiveTransportRequest {
  readonly ownerPrincipalId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly requestedNotionalUsd: number;
  readonly authorizationFingerprintSha256: string;
}

export type LiveTransportDecision =
  | { readonly status: "READY"; readonly request: LiveTransportRequest }
  | { readonly status: "REJECTED"; readonly reason: "ENVELOPE_REJECTED" | "ENVELOPE_EXPIRED" | "ENVELOPE_ALREADY_CONSUMED" | "ENVELOPE_INVALID" };

/**
 * Final boundary before a future broker adapter.
 * This contract intentionally performs no network call and grants no production authority.
 * A broker implementation must consume the envelope successfully before it can receive a request.
 */
export async function prepareLiveTransportRequest(
  envelope: LiveAutonomousPreExecutionEnvelope,
  consumeOnce: LiveExecutionConsumeOnce,
  now: number,
): Promise<LiveTransportDecision> {
  if (envelope.status !== "READY") return { status: "REJECTED", reason: "ENVELOPE_REJECTED" };
  if (!Number.isSafeInteger(now) || now < envelope.issuedAt) {
    return { status: "REJECTED", reason: "ENVELOPE_INVALID" };
  }
  if (now >= envelope.expiresAt) return { status: "REJECTED", reason: "ENVELOPE_EXPIRED" };

  const consumed: ConsumeOnceResult = await consumeOnce.consume(envelope, now);
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
      authorizationFingerprintSha256: envelope.authorizationFingerprintSha256,
    }),
  };
}

import type { LiveTransportRequest } from "./liveTransportContract";

export interface LiveBrokerTransportResult {
  readonly status: "REJECTED" | "NOT_CONFIGURED";
  readonly reason: "LIVE_AUTHORITY_DISABLED" | "BROKER_ADAPTER_NOT_CONFIGURED";
}

export interface LiveBrokerTransportAdapter {
  execute(request: LiveTransportRequest): Promise<LiveBrokerTransportResult>;
}

/**
 * Safe default adapter. It deliberately performs no broker/network mutation.
 * A production adapter must be explicitly supplied by a separately governed runtime.
 */
export class FailClosedLiveBrokerTransportAdapter implements LiveBrokerTransportAdapter {
  public async execute(_request: LiveTransportRequest): Promise<LiveBrokerTransportResult> {
    return { status: "NOT_CONFIGURED", reason: "BROKER_ADAPTER_NOT_CONFIGURED" };
  }
}

export function validateLiveTransportRequest(request: LiveTransportRequest): boolean {
  return (
    typeof request.ownerPrincipalId === "string" && request.ownerPrincipalId.length > 0 &&
    typeof request.market === "string" && request.market.length > 0 &&
    (request.side === "BUY" || request.side === "SELL") &&
    Number.isFinite(request.requestedNotionalUsd) && request.requestedNotionalUsd > 0 &&
    Number.isSafeInteger(request.requestedNotionalUsd * 100) &&
    /^[a-f0-9]{64}$/.test(request.authorizationFingerprintSha256)
  );
}

export async function executeThroughLiveBroker(
  adapter: LiveBrokerTransportAdapter,
  request: LiveTransportRequest,
): Promise<LiveBrokerTransportResult> {
  if (!validateLiveTransportRequest(request)) {
    return { status: "REJECTED", reason: "LIVE_AUTHORITY_DISABLED" };
  }
  return adapter.execute(Object.freeze({ ...request }));
}

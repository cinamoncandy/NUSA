export type LiveBrokerTransportRequest = Readonly<{ market: string; side: "buy" | "sell"; notional: number; ownerId: string; fingerprint: string }>;

export type LiveBrokerTransportResult = Readonly<{ accepted: boolean; reason: string }>;

export interface LiveBrokerTransport {
  submit(request: LiveBrokerTransportRequest): Promise<LiveBrokerTransportResult>;
}

export class FailClosedLiveBrokerTransport implements LiveBrokerTransport {
  async submit(_request: LiveBrokerTransportRequest): Promise<LiveBrokerTransportResult> {
    return { accepted: false, reason: "LIVE_TRANSPORT_DISABLED" };
  }
}

export function validateLiveBrokerTransportRequest(request: LiveBrokerTransportRequest): string | null {
  if (!request.ownerId.trim()) return "OWNER_REQUIRED";
  if (!request.market.trim()) return "MARKET_REQUIRED";
  if (!Number.isFinite(request.notional) || request.notional <= 0) return "NOTIONAL_INVALID";
  if (!/^[a-f0-9]{64}$/i.test(request.fingerprint)) return "FINGERPRINT_INVALID";
  return null;
}

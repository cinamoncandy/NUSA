import { describe, expect, it } from "vitest";
import { FailClosedLiveBrokerTransport, validateLiveBrokerTransportRequest } from "./liveBrokerTransportBoundaryV3";

describe("live broker transport boundary v3", () => {
  it("rejects invalid requests", () => {
    expect(validateLiveBrokerTransportRequest({ market: "", side: "buy", notional: 1, ownerId: "owner", fingerprint: "0".repeat(64) })).toBe("MARKET_REQUIRED");
    expect(validateLiveBrokerTransportRequest({ market: "BTC-USDT", side: "buy", notional: 0, ownerId: "owner", fingerprint: "0".repeat(64) })).toBe("NOTIONAL_INVALID");
    expect(validateLiveBrokerTransportRequest({ market: "BTC-USDT", side: "buy", notional: 1, ownerId: "owner", fingerprint: "bad" })).toBe("FINGERPRINT_INVALID");
  });

  it("fails closed without production mutation", async () => {
    const result = await new FailClosedLiveBrokerTransport().submit({ market: "BTC-USDT", side: "buy", notional: 1, ownerId: "owner", fingerprint: "0".repeat(64) });
    expect(result).toEqual({ accepted: false, reason: "LIVE_TRANSPORT_DISABLED" });
  });
});

import { describe, expect, it } from "vitest";
import { FailClosedLiveBrokerTransport } from "./liveBrokerTransportBoundaryV3";

describe("final reservation production safety", () => {
  it("keeps the default broker transport fail closed", async () => {
    const transport = new FailClosedLiveBrokerTransport();
    const result = await transport.submit({ ownerId: "owner", market: "BTC-USD", side: "buy", notional: 1, fingerprint: "d".repeat(64) });
    expect(result.accepted).toBe(false);
  });
});

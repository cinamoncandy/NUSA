import { describe, expect, it } from "vitest";
import { LiveExecutionConsumeOnce, type ConsumeOnceTransaction } from "./liveExecutionConsumeOnce";
import type { LiveBrokerTransport, LiveBrokerTransportRequest } from "./liveBrokerTransportBoundaryV3";
import type { LiveSessionBoundPreExecutionRequest } from "./liveSessionBoundPreExecution";
import { submitSessionBoundLiveOrder } from "./liveSessionBrokerAdapterBoundary";

class MemoryTransaction implements ConsumeOnceTransaction {
  constructor(private readonly values: Map<string, unknown>) {}
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}
class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (transaction: ConsumeOnceTransaction) => Promise<T>): Promise<T> {
    return callback(new MemoryTransaction(this.values));
  }
}
class RecordingTransport implements LiveBrokerTransport {
  public requests: LiveBrokerTransportRequest[] = [];
  async submit(request: LiveBrokerTransportRequest) {
    this.requests.push(request);
    return { accepted: false, reason: "TEST_TRANSPORT_NO_MUTATION" };
  }
}

const baseRequest = (): LiveSessionBoundPreExecutionRequest => ({
  ownerPrincipalId: "owner-1",
  policyOwnerPrincipalId: "owner-1",
  market: "BTC-USD",
  side: "BUY",
  requestedNotionalUsd: 100,
  totalEquityUsd: 1_000,
  riskApprovedNotionalUsd: 200,
  riskDecision: "ALLOW",
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  marketTrusted: true,
  observedAt: 1_000,
  decidedAt: 1_000,
  now: 1_100,
  session: {
    state: "ACTIVE",
    sessionId: "session-1",
    ownerPrincipalId: "owner-1",
    investmentCapitalWeight: 0.25,
    killSwitchEngaged: false,
    activatedAtMs: 900,
    expiresAtMs: 2_000,
  },
});

describe("session-bound LIVE broker adapter boundary", () => {
  it("rejects the legacy caller-supplied session path", async () => {
    const transport = new RecordingTransport();
    const result = await submitSessionBoundLiveOrder(baseRequest(), new LiveExecutionConsumeOnce(new MemoryStorage()), transport);
    expect(result).toEqual({ status: "REJECTED", reason: "AUTHORITATIVE_SESSION_REQUIRED" });
    expect(transport.requests).toHaveLength(0);
  });

  it("uses the disabled fail-closed transport by default", async () => {
    const result = await submitSessionBoundLiveOrder(baseRequest(), new LiveExecutionConsumeOnce(new MemoryStorage()));
    expect(result).toEqual({ status: "REJECTED", reason: "AUTHORITATIVE_SESSION_REQUIRED" });
  });

  it("does not reach transport when the session is expired", async () => {
    const transport = new RecordingTransport();
    const request = baseRequest();
    const result = await submitSessionBoundLiveOrder({ ...request, session: { ...request.session, expiresAtMs: request.now } }, new LiveExecutionConsumeOnce(new MemoryStorage()), transport);
    expect(result.status).toBe("REJECTED");
    expect(transport.requests).toHaveLength(0);
  });

  it("does not reach transport on replay", async () => {
    const transport = new RecordingTransport();
    const consumer = new LiveExecutionConsumeOnce(new MemoryStorage());
    expect((await submitSessionBoundLiveOrder(baseRequest(), consumer, transport)).status).toBe("REJECTED");
    expect((await submitSessionBoundLiveOrder(baseRequest(), consumer, transport)).status).toBe("REJECTED");
    expect(transport.requests).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { prepareAuthoritativeSessionBoundLiveTransport, type LiveAuthoritativeSessionRequest } from "./liveAuthoritativeSessionTransportChain";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";
import { LiveExecutionConsumeOnce, type ConsumeOnceStorage } from "./liveExecutionConsumeOnce";

class MemoryStorage implements LiveRuntimeSessionStorage, ConsumeOnceStorage {
  private readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: any) => Promise<T>): Promise<T> {
    return callback({ get: async (key: string) => this.values.get(key), put: async (key: string, value: unknown) => { this.values.set(key, value); } });
  }
}

const request: LiveAuthoritativeSessionRequest = {
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
  now: 1_001,
};

async function setup() {
  const storage = new MemoryStorage();
  const store = new LiveRuntimeSessionDurableStore(storage);
  await store.write({ sessionId: "s1", ownerPrincipalId: "owner-1", investmentCapitalWeight: 0.25, state: "ACTIVE", killSwitchEngaged: false, activatedAtMs: 900, expiresAtMs: 2_000 }, null);
  return { store, consume: new LiveExecutionConsumeOnce(storage) };
}

describe("authoritative LIVE session transport chain", () => {
  it("uses the persisted session as the execution authority source", async () => {
    const { store, consume } = await setup();
    const result = await prepareAuthoritativeSessionBoundLiveTransport(request, store, consume);
    expect(result.status).toBe("READY");
    if (result.status === "READY") expect(result.revision).toBe(1);
  });

  it("fails closed when no persisted session exists", async () => {
    const storage = new MemoryStorage();
    const result = await prepareAuthoritativeSessionBoundLiveTransport(request, new LiveRuntimeSessionDurableStore(storage), new LiveExecutionConsumeOnce(storage));
    expect(result).toEqual({ status: "REJECTED", reason: "AUTHORITATIVE_SESSION_UNAVAILABLE" });
  });

  it("uses persisted capital weight rather than caller input", async () => {
    const { store, consume } = await setup();
    const result = await prepareAuthoritativeSessionBoundLiveTransport({ ...request, requestedNotionalUsd: 300 }, store, consume);
    expect(result.status).toBe("REJECTED");
  });

  it("honors persisted stop state", async () => {
    const { store, consume } = await setup();
    const current = await store.read("owner-1");
    expect(current).toBeDefined();
    await store.write({ ...current!.session, state: "STOPPED" }, current!.revision);
    const result = await prepareAuthoritativeSessionBoundLiveTransport(request, store, consume);
    expect(result.status).toBe("REJECTED");
  });
});

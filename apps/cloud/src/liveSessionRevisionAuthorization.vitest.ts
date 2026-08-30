import { describe, expect, it } from "vitest";
import { authorizeCurrentLiveSessionRevision } from "./liveSessionRevisionAuthorization";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";
import type { LiveAuthoritativeSessionTransportResult } from "./liveAuthoritativeSessionTransportChain";

class MemoryStorage implements LiveRuntimeSessionStorage {
  private readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: any) => Promise<T>): Promise<T> {
    return callback({ get: async (key: string) => this.values.get(key), put: async (key: string, value: unknown) => { this.values.set(key, value); } });
  }
}

const prepared = (revision: number): LiveAuthoritativeSessionTransportResult => ({
  status: "READY",
  revision,
  chain: { preExecutionStatus: "READY", transport: { status: "READY", request: { ownerPrincipalId: "owner-1", market: "KRW-BTC", side: "BUY", requestedNotionalUsd: 10, authorizationFingerprintSha256: "a".repeat(64) } } },
});

async function setup() {
  const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
  await store.write({ sessionId: "s1", ownerPrincipalId: "owner-1", investmentCapitalWeight: 0.25, state: "ACTIVE", killSwitchEngaged: false, activatedAtMs: 1_000, expiresAtMs: 5_000 }, null);
  return store;
}

describe("LIVE session revision authorization", () => {
  it("authorizes an unchanged active persisted revision", async () => {
    const store = await setup();
    const result = await authorizeCurrentLiveSessionRevision(prepared(1), "owner-1", store, 2_000);
    expect(result).toEqual({ status: "AUTHORIZED", authorization: { ownerPrincipalId: "owner-1", sessionId: "s1", revision: 1 } });
  });

  it("rejects prepared work after any persisted revision change", async () => {
    const store = await setup();
    const record = await store.read("owner-1");
    if (!record) throw new Error("missing fixture");
    await store.write({ ...record.session, investmentCapitalWeight: 0.1 }, record.revision);
    expect(await authorizeCurrentLiveSessionRevision(prepared(1), "owner-1", store, 2_000)).toEqual({ status: "REJECTED", reason: "SESSION_REVISION_CHANGED" });
  });

  it("rejects a stop that occurs after preparation", async () => {
    const store = await setup();
    const record = await store.read("owner-1");
    if (!record) throw new Error("missing fixture");
    await store.write({ ...record.session, state: "STOPPED" }, record.revision);
    expect((await authorizeCurrentLiveSessionRevision(prepared(1), "owner-1", store, 2_000)).status).toBe("REJECTED");
  });

  it("rejects unavailable or expired authoritative sessions", async () => {
    const empty = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    expect(await authorizeCurrentLiveSessionRevision(prepared(1), "owner-1", empty, 2_000)).toEqual({ status: "REJECTED", reason: "AUTHORITATIVE_SESSION_UNAVAILABLE" });
    const store = await setup();
    expect(await authorizeCurrentLiveSessionRevision(prepared(1), "owner-1", store, 6_000)).toEqual({ status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" });
  });
});

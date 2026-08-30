import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLiveRuntimeSession,
  evaluateLiveRuntimeSession,
  revokeLiveRuntimeSession,
  setLiveRuntimeCapitalWeight,
  setLiveRuntimeKillSwitch,
  type LiveRuntimeSessionStorage,
} from "./liveRuntimeSessionState";

class MemoryStorage implements LiveRuntimeSessionStorage {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

async function storageWith(record: ReturnType<typeof createLiveRuntimeSession>): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await storage.put(`live-runtime-session:v1:${record.ownerPrincipalId}`, record);
  return storage;
}

describe("live runtime session state", () => {
  it("allows only an active, unexpired, capital-enabled bounded session", async () => {
    const record = createLiveRuntimeSession({ ownerPrincipalId: "owner", investmentCapitalWeight: 0.25, now: 1_000, ttlMs: 10_000 });
    const result = await evaluateLiveRuntimeSession(await storageWith(record), "owner", 5_000);
    assert.equal(result.usable, true);
    assert.equal(record.liveAuthority, "NONE");
    assert.equal(record.productionMutationAllowed, false);
  });

  it("fails closed on expiry, kill switch, zero capital, and revocation", async () => {
    const base = createLiveRuntimeSession({ ownerPrincipalId: "owner", investmentCapitalWeight: 0.25, now: 1_000, ttlMs: 10_000 });
    assert.equal((await evaluateLiveRuntimeSession(await storageWith(base), "owner", 11_000)).reason, "EXPIRED");
    assert.equal((await evaluateLiveRuntimeSession(await storageWith(setLiveRuntimeKillSwitch(base, true)), "owner", 5_000)).reason, "KILL_SWITCH_ACTIVE");
    assert.equal((await evaluateLiveRuntimeSession(await storageWith(setLiveRuntimeCapitalWeight(base, 0)), "owner", 5_000)).reason, "CAPITAL_DISABLED");
    assert.equal((await evaluateLiveRuntimeSession(await storageWith(revokeLiveRuntimeSession(base, 5_000)), "owner", 5_000)).reason, "REVOKED");
  });

  it("fails closed when storage state is uncertain", async () => {
    const storage: LiveRuntimeSessionStorage = {
      async get() { throw new Error("storage unavailable"); },
      async put() { throw new Error("storage unavailable"); },
    };
    assert.deepEqual(await evaluateLiveRuntimeSession(storage, "owner", 5_000), { usable: false, reason: "STORAGE_UNCERTAIN" });
  });

  it("rejects invalid capital weights and excessive session TTL", () => {
    assert.throws(() => createLiveRuntimeSession({ ownerPrincipalId: "owner", investmentCapitalWeight: 1.01, now: 1_000, ttlMs: 10_000 }), /INVALID_LIVE_RUNTIME_SESSION/);
    assert.throws(() => createLiveRuntimeSession({ ownerPrincipalId: "owner", investmentCapitalWeight: 0.25, now: 1_000, ttlMs: 86_400_001 }), /INVALID_LIVE_RUNTIME_SESSION/);
  });
});

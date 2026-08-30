import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";
import type { LiveRuntimeSession } from "./liveRuntimeSessionBoundary";

class MemoryStorage implements LiveRuntimeSessionStorage {
  readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: { get<U>(key: string): Promise<U | undefined>; put<U>(key: string, value: U): Promise<void> }) => Promise<T>): Promise<T> {
    return callback({
      get: async <U>(key: string) => this.values.get(key) as U | undefined,
      put: async <U>(key: string, value: U) => { this.values.set(key, value); },
    });
  }
}

const session: LiveRuntimeSession = {
  sessionId: "session-1",
  ownerPrincipalId: "owner-1",
  investmentCapitalWeight: 0.25,
  state: "ACTIVE",
  killSwitchEngaged: false,
  activatedAtMs: 1_000,
  expiresAtMs: 2_000,
};

describe("LiveRuntimeSessionDurableStore", () => {
  it("creates and reads an owner-bound session", async () => {
    const storage = new MemoryStorage();
    const store = new LiveRuntimeSessionDurableStore(storage);
    const created = await store.write(session, null);
    expect(created.status).toBe("STORED");
    expect((await store.read("owner-1"))?.revision).toBe(1);
  });

  it("atomically rejects stale revisions", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    await store.write(session, null);
    const updated = await store.write({ ...session, investmentCapitalWeight: 0.1 }, 1);
    expect(updated.status).toBe("STORED");
    expect(await store.write({ ...session, investmentCapitalWeight: 0.5 }, 1)).toEqual({ status: "REJECTED", reason: "REVISION_CONFLICT" });
  });

  it("prevents replacement without an expected revision", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    await store.write(session, null);
    expect(await store.write(session, null)).toEqual({ status: "REJECTED", reason: "SESSION_ALREADY_EXISTS" });
  });

  it("fails closed on corrupt or uncertain storage", async () => {
    const storage = new MemoryStorage();
    storage.values.set("live-runtime-session:v1:owner-1", { broken: true });
    const store = new LiveRuntimeSessionDurableStore(storage);
    expect(await store.write(session, 1)).toEqual({ status: "REJECTED", reason: "STORAGE_CORRUPT" });

    const uncertain = new LiveRuntimeSessionDurableStore({ transaction: async () => { throw new Error("storage unavailable"); } });
    expect(await uncertain.write(session, null)).toEqual({ status: "REJECTED", reason: "STORAGE_UNCERTAIN" });
  });

  it("rejects malformed sessions before storage", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    expect(await store.write({ ...session, investmentCapitalWeight: 2 }, null)).toEqual({ status: "REJECTED", reason: "SESSION_INVALID" });
  });
});

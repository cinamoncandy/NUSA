import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage } from "./liveRuntimeSessionDurableStore";
import type { LiveRuntimeSession } from "./liveRuntimeSessionBoundary";

class MemoryStorage implements LiveRuntimeSessionStorage {
  readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: { get<U>(key: string): Promise<U | undefined>; put<U>(key: string, value: U): Promise<void> }) => Promise<T>): Promise<T> {
    return callback({ get: async <U>(key: string) => this.values.get(key) as U | undefined, put: async <U>(key: string, value: U) => { this.values.set(key, value); } });
  }
}
const session: LiveRuntimeSession = { sessionId: "session-1", ownerPrincipalId: "owner-1", investmentCapitalWeight: 0.25, state: "ACTIVE", killSwitchEngaged: false, activatedAtMs: 1_000, expiresAtMs: 2_000 };
const fingerprint = "a".repeat(64);

describe("LiveRuntimeSessionDurableStore", () => {
  it("creates and reads an owner-bound session", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    expect((await store.write(session, null)).status).toBe("STORED");
    expect((await store.read("owner-1"))?.revision).toBe(1);
  });
  it("atomically rejects stale revisions", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    await store.write(session, null);
    expect((await store.write({ ...session, investmentCapitalWeight: 0.1 }, 1)).status).toBe("STORED");
    expect(await store.write({ ...session, investmentCapitalWeight: 0.5 }, 1)).toEqual({ status: "REJECTED", reason: "REVISION_CONFLICT" });
  });
  it("atomically validates revision and reserves final execution once", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    await store.write(session, null);
    expect((await store.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).status).toBe("RESERVED");
    expect(await store.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).toEqual({ status: "REJECTED", reason: "DUPLICATE_EXECUTION_SUPPRESSED" });
  });
  it("rejects STOP and revision changes before final reservation", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    await store.write(session, null);
    await store.write({ ...session, state: "STOPPED" }, 1);
    expect(await store.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).toEqual({ status: "REJECTED", reason: "SESSION_REVISION_CHANGED" });
    expect(await store.reserveFinalExecution("owner-1", "session-1", 2, fingerprint, 1_100)).toEqual({ status: "REJECTED", reason: "SESSION_STOPPED" });
  });
  it("rejects kill switch, revocation and expiry at reservation time", async () => {
    for (const changed of [
      { ...session, killSwitchEngaged: true },
      { ...session, state: "REVOKED" as const, revokedAtMs: 1_050 },
      { ...session, expiresAtMs: 1_100 },
    ]) {
      const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
      await store.write(changed, null);
      expect((await store.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).status).toBe("REJECTED");
    }
  });
  it("prevents replacement without an expected revision", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage()); await store.write(session, null);
    expect(await store.write(session, null)).toEqual({ status: "REJECTED", reason: "SESSION_ALREADY_EXISTS" });
  });
  it("fails closed on corrupt or uncertain storage", async () => {
    const storage = new MemoryStorage(); storage.values.set("live-runtime-session:v1:owner-1", { broken: true });
    const store = new LiveRuntimeSessionDurableStore(storage);
    expect(await store.write(session, 1)).toEqual({ status: "REJECTED", reason: "STORAGE_CORRUPT" });
    expect((await store.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).status).toBe("REJECTED");
    const uncertain = new LiveRuntimeSessionDurableStore({ transaction: async () => { throw new Error("storage unavailable"); } });
    expect(await uncertain.write(session, null)).toEqual({ status: "REJECTED", reason: "STORAGE_UNCERTAIN" });
    expect(await uncertain.reserveFinalExecution("owner-1", "session-1", 1, fingerprint, 1_100)).toEqual({ status: "REJECTED", reason: "STORAGE_UNCERTAIN" });
  });
  it("rejects malformed sessions before storage", async () => {
    const store = new LiveRuntimeSessionDurableStore(new MemoryStorage());
    expect(await store.write({ ...session, investmentCapitalWeight: 2 }, null)).toEqual({ status: "REJECTED", reason: "SESSION_INVALID" });
  });
});

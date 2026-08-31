import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";

class SerializedStorage {
  private readonly values = new Map<string, unknown>();
  private tail: Promise<void> = Promise.resolve();
  async transaction<T>(callback: (txn: LiveRuntimeSessionStorageTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({ get: async <U>(key: string) => this.values.get(key) as U | undefined, put: async <U>(key: string, value: U) => { this.values.set(key, value); } });
    } finally { release(); }
  }
}
const active = { sessionId: "session-1", ownerPrincipalId: "owner-1", investmentCapitalWeight: 0.25, state: "ACTIVE" as const, killSwitchEngaged: false, activatedAtMs: 1_000, expiresAtMs: 2_000 };
const fp = "b".repeat(64);

describe("final LIVE execution reservation serialization", () => {
  it("allows at most one concurrent reservation", async () => {
    const store = new LiveRuntimeSessionDurableStore(new SerializedStorage());
    await store.write(active, null);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.reserveFinalExecution("owner-1", "session-1", 1, fp, 1_100)));
    expect(results.filter((result) => result.status === "RESERVED")).toHaveLength(1);
    expect(results.filter((result) => result.status === "REJECTED")).toHaveLength(7);
  });

  it("serializes STOP before a stale reservation", async () => {
    const store = new LiveRuntimeSessionDurableStore(new SerializedStorage());
    await store.write(active, null);
    await store.write({ ...active, state: "STOPPED" }, 1);
    expect(await store.reserveFinalExecution("owner-1", "session-1", 1, fp, 1_100)).toEqual({ status: "REJECTED", reason: "SESSION_REVISION_CHANGED" });
  });
});

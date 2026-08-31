import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";

class Storage {
  private readonly values = new Map<string, unknown>();
  async transaction<T>(callback: (txn: LiveRuntimeSessionStorageTransaction) => Promise<T>): Promise<T> {
    return callback({ get: async <U>(key: string) => this.values.get(key) as U | undefined, put: async <U>(key: string, value: U) => { this.values.set(key, value); } });
  }
}

describe("final execution reservation fail-closed semantics", () => {
  it("rejects a capital-allocation revision change", async () => {
    const store = new LiveRuntimeSessionDurableStore(new Storage());
    const session = { sessionId: "s", ownerPrincipalId: "o", investmentCapitalWeight: 0.5, state: "ACTIVE" as const, killSwitchEngaged: false, activatedAtMs: 10, expiresAtMs: 100 };
    await store.write(session, null);
    await store.write({ ...session, investmentCapitalWeight: 0.25 }, 1);
    expect(await store.reserveFinalExecution("o", "s", 1, "c".repeat(64), 20)).toEqual({ status: "REJECTED", reason: "SESSION_REVISION_CHANGED" });
  });
});

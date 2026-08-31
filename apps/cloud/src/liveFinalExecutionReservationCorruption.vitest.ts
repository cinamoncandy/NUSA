import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";

describe("final reservation corrupt state", () => {
  it("fails closed on malformed authoritative record", async () => {
    const store = new LiveRuntimeSessionDurableStore({ transaction: async <T>(callback: (txn: LiveRuntimeSessionStorageTransaction) => Promise<T>) => callback({ get: async () => ({ broken: true }) as never, put: async () => undefined }) });
    expect(await store.reserveFinalExecution("owner", "session", 1, "f".repeat(64), 1)).toEqual({ status: "REJECTED", reason: "STORAGE_CORRUPT" });
  });
});

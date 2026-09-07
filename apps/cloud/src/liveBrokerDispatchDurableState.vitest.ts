import { describe, expect, it } from "vitest";
import { LiveBrokerDispatchDurableState } from "./liveBrokerDispatchDurableState";
import type { LiveRuntimeSessionStorage, LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";

class MemoryStorage implements LiveRuntimeSessionStorage {
  readonly values = new Map<string, unknown>();
  private queue = Promise.resolve();
  transaction<T>(callback: (txn: LiveRuntimeSessionStorageTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => callback({
      get: async <V>(key: string) => this.values.get(key) as V | undefined,
      put: async <V>(key: string, value: V) => { this.values.set(key, value); },
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

const fingerprint = "a".repeat(64);

describe("LiveBrokerDispatchDurableState", () => {
  it("allows exactly one concurrent dispatch acquisition", async () => {
    const state = new LiveBrokerDispatchDurableState(new MemoryStorage());
    const results = await Promise.all(Array.from({ length: 8 }, () => state.acquire(fingerprint, "owner", "session", 7, 100)));
    expect(results.filter((r) => r.status === "ACQUIRED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "EXISTING")).toHaveLength(7);
  });

  it("keeps a pre-call crash in DISPATCHING so retry cannot submit again", async () => {
    const state = new LiveBrokerDispatchDurableState(new MemoryStorage());
    expect((await state.acquire(fingerprint, "owner", "session", 7, 100)).status).toBe("ACQUIRED");
    const retry = await state.acquire(fingerprint, "owner", "session", 7, 101);
    expect(retry.status).toBe("EXISTING");
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("DISPATCHING");
  });

  it("marks an uncertain broker response and suppresses retry", async () => {
    const state = new LiveBrokerDispatchDurableState(new MemoryStorage());
    await state.acquire(fingerprint, "owner", "session", 7, 100);
    const uncertain = await state.markUncertain(fingerprint, "BROKER_RESULT_UNCERTAIN", 101);
    expect(uncertain.status).toBe("EXISTING");
    const retry = await state.acquire(fingerprint, "owner", "session", 7, 102);
    expect(retry.status).toBe("EXISTING");
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("UNCERTAIN");
  });

  it("records acknowledgement without permitting another attempt", async () => {
    const state = new LiveBrokerDispatchDurableState(new MemoryStorage());
    await state.acquire(fingerprint, "owner", "session", 7, 100);
    const done = await state.complete(fingerprint, true, "ACK", 101);
    expect(done.status).toBe("EXISTING");
    const retry = await state.acquire(fingerprint, "owner", "session", 7, 102);
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("ACKNOWLEDGED");
    else throw new Error("expected persisted acknowledgement");
  });

  it("fails closed on corrupt durable state", async () => {
    const storage = new MemoryStorage();
    storage.values.set(`live-broker-dispatch:v1:${fingerprint}`, { bad: true });
    const result = await new LiveBrokerDispatchDurableState(storage).acquire(fingerprint, "owner", "session", 7, 100);
    expect(result).toEqual({ status: "REJECTED", reason: "DISPATCH_STATE_CORRUPT" });
  });
});

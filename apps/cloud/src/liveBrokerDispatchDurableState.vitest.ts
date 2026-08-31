import { describe, expect, it } from "vitest";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionStorage, type LiveRuntimeSessionStorageTransaction } from "./liveRuntimeSessionDurableStore";

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
async function activeStore(storage = new MemoryStorage()) {
  const store = new LiveRuntimeSessionDurableStore(storage);
  const written = await store.write({
    sessionId: "session",
    ownerPrincipalId: "owner",
    investmentCapitalWeight: 0.25,
    state: "ACTIVE",
    killSwitchEngaged: false,
    activatedAtMs: 1,
    expiresAtMs: 10_000,
  }, null);
  if (written.status !== "STORED") throw new Error("failed to seed session");
  return { store, storage, revision: written.record.revision };
}

describe("session-bound final broker dispatch", () => {
  it("atomically creates one final reservation and one dispatch acquisition", async () => {
    const { store, storage, revision } = await activeStore();
    const results = await Promise.all(Array.from({ length: 8 }, () => store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 100)));
    expect(results.filter((r) => r.status === "ACQUIRED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "EXISTING")).toHaveLength(7);
    expect(storage.values.has(`live-final-execution-reservation:v1:${fingerprint}`)).toBe(true);
    expect(storage.values.has(`live-broker-dispatch:v1:${fingerprint}`)).toBe(true);
  });

  it("keeps a pre-call crash in DISPATCHING so retry cannot submit again", async () => {
    const { store, revision } = await activeStore();
    expect((await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 100)).status).toBe("ACQUIRED");
    const retry = await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 101);
    expect(retry.status).toBe("EXISTING");
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("DISPATCHING");
  });

  it("marks an uncertain broker response and suppresses retry", async () => {
    const { store, revision } = await activeStore();
    await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 100);
    const uncertain = await store.markFinalExecutionDispatchUncertain(fingerprint, "BROKER_RESULT_UNCERTAIN", 101);
    expect(uncertain.status).toBe("EXISTING");
    const retry = await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 102);
    expect(retry.status).toBe("EXISTING");
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("UNCERTAIN");
  });

  it("records acknowledgement without permitting another attempt", async () => {
    const { store, revision } = await activeStore();
    await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 100);
    const done = await store.completeFinalExecutionDispatch(fingerprint, true, "ACK", 101);
    expect(done.status).toBe("EXISTING");
    const retry = await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 102);
    if (retry.status === "EXISTING") expect(retry.record.state).toBe("ACKNOWLEDGED");
    else throw new Error("expected persisted acknowledgement");
  });

  it("fails closed if a reservation exists without its dispatch journal", async () => {
    const { store, storage, revision } = await activeStore();
    const reservation = await store.reserveFinalExecution("owner", "session", revision, fingerprint, 100);
    expect(reservation.status).toBe("RESERVED");
    expect(storage.values.has(`live-broker-dispatch:v1:${fingerprint}`)).toBe(false);
    const result = await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 101);
    expect(result).toEqual({ status: "REJECTED", reason: "FINAL_DISPATCH_STATE_MISSING" });
  });

  it("fails closed on corrupt durable dispatch state", async () => {
    const { store, storage, revision } = await activeStore();
    await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 100);
    storage.values.set(`live-broker-dispatch:v1:${fingerprint}`, { bad: true });
    const result = await store.acquireFinalExecutionDispatch("owner", "session", revision, fingerprint, 101);
    expect(result).toEqual({ status: "REJECTED", reason: "DISPATCH_STATE_CORRUPT" });
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DurableObjectLiveHumanApprovalConsumptionStore,
  type DurableApprovalConsumptionStorage,
  type DurableApprovalConsumptionTransaction,
} from "./liveHumanApprovalDurableConsumptionStore";

const KEY = "a".repeat(64);

class AtomicMemoryStorage implements DurableApprovalConsumptionStorage {
  readonly values = new Map<string, unknown>();
  transactionCalls = 0;
  private tail = Promise.resolve();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async transaction<T>(
    closure: (transaction: DurableApprovalConsumptionTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await closure(this);
    } finally {
      release();
    }
  }
}

test("durably consumes a valid approval key once", async () => {
  const storage = new AtomicMemoryStorage();
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  assert.equal(await store.consumeOnce(KEY), "CONSUMED");
  assert.equal(await store.consumeOnce(KEY), "ALREADY_CONSUMED");
  assert.equal(storage.transactionCalls, 2);
  assert.equal(storage.values.size, 1);
});

test("concurrent replay attempts yield exactly one successful consumption", async () => {
  const storage = new AtomicMemoryStorage();
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  const results = await Promise.all([store.consumeOnce(KEY), store.consumeOnce(KEY)]);
  assert.deepEqual(results.sort(), ["ALREADY_CONSUMED", "CONSUMED"]);
  assert.equal(storage.values.size, 1);
});

test("rejects malformed consumption keys before durable storage access", async () => {
  const storage = new AtomicMemoryStorage();
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  assert.equal(await store.consumeOnce("not-a-sha256"), "FAILED");
  assert.equal(storage.transactionCalls, 0);
  assert.equal(storage.values.size, 0);
});

test("fails closed when durable storage contains an unexpected marker", async () => {
  const storage = new AtomicMemoryStorage();
  const durableKey = `live-human-approval-consumed:v1:${KEY}`;
  storage.values.set(durableKey, false);
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  assert.equal(await store.consumeOnce(KEY), "FAILED");
  assert.equal(storage.values.get(durableKey), false);
});

test("fails closed when the durable transaction throws", async () => {
  const storage: DurableApprovalConsumptionStorage = {
    async get() {
      return undefined;
    },
    async put() {},
    async transaction() {
      throw new Error("durable storage unavailable");
    },
  };
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  assert.equal(await store.consumeOnce(KEY), "FAILED");
});

test("fails closed when the durable marker write throws", async () => {
  const storage: DurableApprovalConsumptionStorage = {
    async get() {
      return undefined;
    },
    async put() {
      throw new Error("write failed");
    },
    async transaction<T>(closure: (transaction: DurableApprovalConsumptionTransaction) => Promise<T>) {
      return closure(this);
    },
  };
  const store = new DurableObjectLiveHumanApprovalConsumptionStore(storage);

  assert.equal(await store.consumeOnce(KEY), "FAILED");
});

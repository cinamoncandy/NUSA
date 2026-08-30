import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionConsumeOnce, type ConsumeOnceTransaction } from "./liveExecutionConsumeOnce";

class MemoryTransaction implements ConsumeOnceTransaction {
  public constructor(private readonly values: Map<string, unknown>) {}
  public async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  public async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

class MemoryStorage {
  public readonly values = new Map<string, unknown>();
  public async transaction<T>(callback: (transaction: ConsumeOnceTransaction) => Promise<T>): Promise<T> {
    return callback(new MemoryTransaction(this.values));
  }
}

const fingerprint = "a".repeat(64);
const envelope = Object.freeze({ authorizationFingerprintSha256: fingerprint, expiresAt: 2_000 });

test("consumes a valid execution envelope once", async () => {
  const storage = new MemoryStorage();
  const consumer = new LiveExecutionConsumeOnce(storage);
  assert.deepEqual(await consumer.consume(envelope, 1_000), { consumed: true });
  assert.deepEqual(await consumer.consume(envelope, 1_001), { consumed: false, reason: "ALREADY_CONSUMED" });
});

test("rejects expired and malformed envelopes before storage", async () => {
  const storage = new MemoryStorage();
  const consumer = new LiveExecutionConsumeOnce(storage);
  assert.deepEqual(await consumer.consume({ ...envelope, expiresAt: 1_000 }, 1_000), { consumed: false, reason: "EXPIRED" });
  assert.deepEqual(await consumer.consume({ ...envelope, authorizationFingerprintSha256: "bad" }, 1_000), { consumed: false, reason: "INVALID" });
  assert.equal(storage.values.size, 0);
});

test("invalid clock input fails closed", async () => {
  const storage = new MemoryStorage();
  const consumer = new LiveExecutionConsumeOnce(storage);
  assert.deepEqual(await consumer.consume(envelope, Number.NaN), { consumed: false, reason: "INVALID" });
  assert.deepEqual(await consumer.consume(envelope, -1), { consumed: false, reason: "INVALID" });
});

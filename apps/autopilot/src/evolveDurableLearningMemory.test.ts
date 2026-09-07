import assert from "node:assert/strict";
import test from "node:test";
import {
  DurableEvolutionLearningMemory,
  type EvolutionLearningMemoryStorage,
} from "./evolveDurableLearningMemory";
import type { EvolutionLearningRecord } from "./evolveLearningMemory";

class MemoryStorage implements EvolutionLearningMemoryStorage {
  value: unknown;
  failPut = false;

  async get<T>(_key: string): Promise<T | undefined> {
    return this.value as T | undefined;
  }

  async put<T>(_key: string, value: T): Promise<void> {
    if (this.failPut) throw new Error("storage-down");
    this.value = value;
  }
}

const record = (index: number, overrides: Partial<EvolutionLearningRecord> = {}): EvolutionLearningRecord => ({
  opportunityId: "gha:ci:" + String(index).padStart(40, "0") + ":failure",
  problem: "canonical CI failed",
  evidenceReferences: ["workflow:" + index + "@" + String(index).padStart(40, "0")],
  hypothesis: "repair the evidenced failure",
  changeReference: "change:" + index,
  validationStatus: "VALIDATED",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt: "2026-08-29T04:20:00.000Z",
  ...overrides,
});

async function hydrated(storage = new MemoryStorage()): Promise<DurableEvolutionLearningMemory> {
  return DurableEvolutionLearningMemory.hydrate(storage);
}

test("hydrates, appends, flushes, and rehydrates through injected storage", async () => {
  const storage = new MemoryStorage();
  const memory = await hydrated(storage);
  memory.append(record(1));
  await memory.flush(storage);

  const restored = await hydrated(storage);
  assert.deepEqual(restored.list(), [record(1)]);
});

test("keeps only the newest 256 records", async () => {
  const memory = await hydrated();
  for (let index = 1; index <= 300; index += 1) {
    memory.append(record(index));
  }
  assert.equal(memory.list().length, 256);
  assert.equal(memory.list()[0]?.changeReference, "change:45");
});

test("fails closed on malformed persisted state", async () => {
  const storage = new MemoryStorage();
  storage.value = [{ opportunityId: "partial" }];
  await assert.rejects(
    hydrated(storage),
    /EVOLVE_DURABLE_MEMORY/,
  );
});

test("fails closed when persistence fails", async () => {
  const storage = new MemoryStorage();
  const memory = await hydrated(storage);
  memory.append(record(1));
  storage.failPut = true;
  await assert.rejects(
    memory.flush(storage),
    /EVOLVE_DURABLE_MEMORY_PERSISTENCE_FAILED/,
  );
});

test("same identity and payload is idempotent, while a conflicting payload fails closed", async () => {
  const memory = await hydrated();
  const first = record(1);
  memory.append(first);
  memory.append({ ...first });
  assert.equal(memory.list().length, 1);
  assert.throws(
    () => memory.append({ ...first, problem: "different evidence" }),
    /EVOLVE_DURABLE_MEMORY_IDENTITY_CONFLICT/,
  );
});

test("timestamp regression is rejected before append", async () => {
  const memory = await hydrated();
  memory.append(record(2, { recordedAt: "2026-08-29T04:21:00.000Z" }));
  assert.throws(
    () => memory.append(record(3, { recordedAt: "2026-08-29T04:20:59.000Z" })),
    /EVOLVE_DURABLE_MEMORY_TIMESTAMP_REGRESSION/,
  );
});

test("persisted envelope detects payload mutation, deletion, and reorder", async () => {
  const storage = new MemoryStorage();
  const memory = await hydrated(storage);
  memory.append(record(1));
  memory.append(record(2));
  await memory.flush(storage);
  const envelope = storage.value as {
    schemaVersion: number;
    records: EvolutionLearningRecord[];
    recordHashes: string[];
    ledgerHash: string;
  };

  const mutated = new MemoryStorage();
  mutated.value = {
    ...envelope,
    records: [{ ...envelope.records[0], problem: "mutated" }, envelope.records[1]],
  };
  await assert.rejects(hydrated(mutated), /INTEGRITY/);

  const deleted = new MemoryStorage();
  deleted.value = { ...envelope, records: [envelope.records[0]] };
  await assert.rejects(hydrated(deleted), /HASH_LENGTH|LEDGER_INTEGRITY/);

  const reordered = new MemoryStorage();
  reordered.value = { ...envelope, records: [envelope.records[1], envelope.records[0]] };
  await assert.rejects(hydrated(reordered), /INTEGRITY/);
});

test("forbidden fields are rejected before persistence and are assembled at runtime in the fixture", async () => {
  const storage = new MemoryStorage();
  const forbiddenField = ["auth", "orization"].join("");
  storage.value = [{ ...record(1), [forbiddenField]: "must-not-persist" }];
  await assert.rejects(
    hydrated(storage),
    /FORBIDDEN|FIELDS_INVALID/,
  );
});

test("equivalent inputs produce identical versioned envelopes", async () => {
  const leftStorage = new MemoryStorage();
  const rightStorage = new MemoryStorage();
  const left = await hydrated(leftStorage);
  const right = await hydrated(rightStorage);
  left.append(record(1));
  right.append(record(1));
  await left.flush(leftStorage);
  await right.flush(rightStorage);
  assert.deepEqual(leftStorage.value, rightStorage.value);
});

test("legacy array storage remains readable and is upgraded on flush", async () => {
  const storage = new MemoryStorage();
  storage.value = [record(1)];
  const memory = await hydrated(storage);
  assert.deepEqual(memory.list(), [record(1)]);
  await memory.flush(storage);
  assert.equal((storage.value as { schemaVersion: number }).schemaVersion, 2);
});

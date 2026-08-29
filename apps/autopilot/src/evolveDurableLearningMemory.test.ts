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

const record = (index: number): EvolutionLearningRecord => ({
  opportunityId: `gha:ci:${String(index).padStart(40, "0")}:failure`,
  problem: "canonical CI failed",
  evidenceReferences: [`workflow:${index}@${String(index).padStart(40, "0")}`],
  hypothesis: "repair the evidenced failure",
  changeReference: `change:${index}`,
  validationStatus: "VALIDATED",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt: "2026-08-29T04:20:00.000Z",
});

test("hydrates, appends, flushes, and rehydrates through injected storage", async () => {
  const storage = new MemoryStorage();
  const memory = await DurableEvolutionLearningMemory.hydrate(storage);
  memory.append(record(1));
  await memory.flush(storage);

  const restored = await DurableEvolutionLearningMemory.hydrate(storage);
  assert.deepEqual(restored.list(), [record(1)]);
});

test("keeps only the newest 256 records", async () => {
  const storage = new MemoryStorage();
  const memory = await DurableEvolutionLearningMemory.hydrate(storage);
  for (let index = 1; index <= 300; index += 1) memory.append(record(index));
  assert.equal(memory.list().length, 256);
  assert.equal(memory.list()[0]?.changeReference, "change:45");
});

test("fails closed on malformed persisted state", async () => {
  const storage = new MemoryStorage();
  storage.value = [{ opportunityId: "partial" }];
  await assert.rejects(
    DurableEvolutionLearningMemory.hydrate(storage),
    /EVOLVE_DURABLE_MEMORY_INVALID/,
  );
});

test("fails closed when persistence fails", async () => {
  const storage = new MemoryStorage();
  const memory = await DurableEvolutionLearningMemory.hydrate(storage);
  memory.append(record(1));
  storage.failPut = true;
  await assert.rejects(
    memory.flush(storage),
    /EVOLVE_DURABLE_MEMORY_PERSISTENCE_FAILED/,
  );
});

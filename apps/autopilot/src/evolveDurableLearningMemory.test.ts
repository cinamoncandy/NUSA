import { describe, expect, it } from "vitest";
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

describe("DurableEvolutionLearningMemory", () => {
  it("hydrates, appends, flushes, and rehydrates through injected storage", async () => {
    const storage = new MemoryStorage();
    const memory = await DurableEvolutionLearningMemory.hydrate(storage);
    memory.append(record(1));
    await memory.flush(storage);

    const restored = await DurableEvolutionLearningMemory.hydrate(storage);
    expect(restored.list()).toEqual([record(1)]);
  });

  it("keeps only the newest 256 records", async () => {
    const storage = new MemoryStorage();
    const memory = await DurableEvolutionLearningMemory.hydrate(storage);
    for (let index = 1; index <= 300; index += 1) memory.append(record(index));
    expect(memory.list()).toHaveLength(256);
    expect(memory.list()[0]?.changeReference).toBe("change:45");
  });

  it("fails closed on malformed persisted state", async () => {
    const storage = new MemoryStorage();
    storage.value = [{ opportunityId: "partial" }];
    await expect(DurableEvolutionLearningMemory.hydrate(storage)).rejects.toThrow("EVOLVE_DURABLE_MEMORY_INVALID");
  });

  it("fails closed when persistence fails", async () => {
    const storage = new MemoryStorage();
    const memory = await DurableEvolutionLearningMemory.hydrate(storage);
    memory.append(record(1));
    storage.failPut = true;
    await expect(memory.flush(storage)).rejects.toThrow("EVOLVE_DURABLE_MEMORY_PERSISTENCE_FAILED");
  });
});

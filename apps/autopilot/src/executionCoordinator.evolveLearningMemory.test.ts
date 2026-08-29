import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionCoordinator, createEvolutionLearningMemoryStorage, type DurableObjectIdLike, type DurableObjectStubLike, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

class Storage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

class Namespace implements ExecutionCoordinatorNamespace {
  private readonly coordinators = new Map<string, ExecutionCoordinator>();
  idFromName(name: string): DurableObjectIdLike { return { name } as DurableObjectIdLike; }
  get(id: DurableObjectIdLike): DurableObjectStubLike {
    const name = (id as { name: string }).name;
    let coordinator = this.coordinators.get(name);
    if (!coordinator) {
      coordinator = new ExecutionCoordinator({ storage: new Storage() });
      this.coordinators.set(name, coordinator);
    }
    return { fetch: (input, init) => coordinator!.fetch(new Request(input, init)) };
  }
}

test("persists Level 7 learning memory through the existing coordinator namespace", async () => {
  const namespace = new Namespace();
  const first = createEvolutionLearningMemoryStorage(namespace);
  await first.put("evolve-learning-memory-v1", [{ opportunityId: "gha:ci:1" }]);

  const second = createEvolutionLearningMemoryStorage(namespace);
  assert.deepEqual(await second.get("evolve-learning-memory-v1"), [{ opportunityId: "gha:ci:1" }]);
});

test("keeps learning memory isolated from scheduled receipt coordinator", async () => {
  const namespace = new Namespace();
  const memory = createEvolutionLearningMemoryStorage(namespace);
  await memory.put("evolve-learning-memory-v1", ["learning"]);

  const receiptStub = namespace.get(namespace.idFromName("scheduled-runtime-observability"));
  const response = await receiptStub.fetch("https://execution-coordinator/scheduled-receipt", { method: "GET" });
  assert.deepEqual(await response.json(), { receipt: null });
});

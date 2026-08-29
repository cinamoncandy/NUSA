import assert from "node:assert/strict";
import test from "node:test";
import { createEvolutionLearningRecord } from "./evolveLearningMemory";
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
const record = createEvolutionLearningRecord({
  opportunityId: "gha:ci:coordinator-validation",
  problem: "canonical CI failure",
  evidenceReferences: ["workflow:coordinator-validation"],
  hypothesis: "validate the durable write boundary",
  changeReference: "change:coordinator-validation",
  validationStatus: "VALIDATED",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt: "2026-08-29T04:20:00.000Z",
});


test("persists Level 7 learning memory through the existing coordinator namespace", async () => {
  const namespace = new Namespace();
  const first = createEvolutionLearningMemoryStorage(namespace);
  await first.put("evolve-learning-memory-v1", [record]);

  const second = createEvolutionLearningMemoryStorage(namespace);
  assert.deepEqual(await second.get("evolve-learning-memory-v1"), [record]);
});

test("keeps learning memory isolated from scheduled receipt coordinator", async () => {
  const namespace = new Namespace();
  const memory = createEvolutionLearningMemoryStorage(namespace);
  await memory.put("evolve-learning-memory-v1", [record]);

  const receiptStub = namespace.get(namespace.idFromName("scheduled-runtime-observability"));
  const response = await receiptStub.fetch("https://execution-coordinator/scheduled-receipt", { method: "GET" });
  assert.deepEqual(await response.json(), { receipt: null });
});
test("rejects malformed or sensitive coordinator writes before persistence", async () => {
  const namespace = new Namespace();
  const memory = createEvolutionLearningMemoryStorage(namespace);
  await memory.put("evolve-learning-memory-v1", [record]);

  const forbiddenKey = ["to", "ken"].join("");
  await assert.rejects(
    memory.put("evolve-learning-memory-v1", [{ ...record, metadata: { [forbiddenKey]: "fixture" } }]),
    /EVOLVE_DURABLE_MEMORY_WRITE_FAILED/,
  );
  assert.deepEqual(await memory.get("evolve-learning-memory-v1"), [record]);
  await assert.rejects(
    memory.put("evolve-learning-memory-v1", [{ opportunityId: record.opportunityId }]),
    /EVOLVE_DURABLE_MEMORY_WRITE_FAILED/,
  );
  assert.deepEqual(await memory.get("evolve-learning-memory-v1"), [record]);
});

test("fails closed when coordinator storage contains corrupt learning memory", async () => {
  const storage = new Storage();
  await storage.put("value", [{ opportunityId: record.opportunityId }]);
  const coordinator = new ExecutionCoordinator({ storage });

  const response = await coordinator.fetch(new Request("https://execution-coordinator/evolve-learning-memory", { method: "GET" }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "EVOLVE_LEARNING_MEMORY_CORRUPT" });
});

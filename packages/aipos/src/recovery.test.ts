import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAiposStore } from "./store";
import { RecoveryEngine } from "./recovery";

function createStore(): InMemoryAiposStore {
  return new InMemoryAiposStore({
    project: "NUSA",
    phase: "foundation",
    summary: "Build the minimum AIPOS capabilities required by NUSA.",
    updatedAt: "2026-07-31T00:00:00.000Z",
  });
}

test("recovery selects the first actionable deterministic work order", async () => {
  const store = createStore();
  await store.saveWorkOrder({
    id: "WO-002",
    title: "Second",
    status: "pending",
    objective: "Second task",
    acceptanceCriteria: ["done"],
  });
  await store.saveWorkOrder({
    id: "WO-001",
    title: "First",
    status: "pending",
    objective: "First task",
    acceptanceCriteria: ["done"],
  });

  const snapshot = await new RecoveryEngine(store).recover(new Date("2026-07-31T01:00:00.000Z"));

  assert.equal(snapshot.selectedWorkOrder?.id, "WO-001");
  assert.equal(snapshot.generatedAt, "2026-07-31T01:00:00.000Z");
});

test("recovery prefers explicit active work order", async () => {
  const store = new InMemoryAiposStore({
    project: "NUSA",
    phase: "foundation",
    summary: "Continue active work.",
    updatedAt: "2026-07-31T00:00:00.000Z",
    activeWorkOrderId: "WO-002",
  });
  await store.saveWorkOrder({
    id: "WO-001",
    title: "First",
    status: "pending",
    objective: "First task",
    acceptanceCriteria: ["done"],
  });
  await store.saveWorkOrder({
    id: "WO-002",
    title: "Active",
    status: "in_progress",
    objective: "Active task",
    acceptanceCriteria: ["done"],
  });

  const snapshot = await new RecoveryEngine(store).recover();
  assert.equal(snapshot.selectedWorkOrder?.id, "WO-002");
});

test("recovery excludes work orders with incomplete dependencies", async () => {
  const store = createStore();
  await store.saveWorkOrder({
    id: "WO-001",
    title: "Dependency",
    status: "pending",
    objective: "Dependency task",
    acceptanceCriteria: ["done"],
  });
  await store.saveWorkOrder({
    id: "WO-002",
    title: "Blocked by dependency",
    status: "pending",
    objective: "Dependent task",
    acceptanceCriteria: ["done"],
    dependencies: ["WO-001"],
  });

  const snapshot = await new RecoveryEngine(store).recover();
  assert.equal(snapshot.selectedWorkOrder?.id, "WO-001");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const orderExecutionStorage = require("../dist/packages/storage/src/order-execution.js");

const {
  InMemoryOrderExecutionRepository,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  reconcileUnknownSubmission
} = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderExecutionRepository } = orderExecutionStorage;

function unknownRecord(overrides = {}) {
  return {
    executionId: "execution-1",
    intentId: "intent-1",
    idempotencyKey: "client-order-1",
    payloadHash: "payload-1",
    status: OrderSubmissionStatus.SUBMISSION_UNKNOWN,
    reason: "response lost",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides
  };
}

test("provider lookup can resolve an unknown submission as accepted without submitting again", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [
    { status: "FOUND_ACCEPTED", providerOrderId: "provider-order-1" }
  ]);

  const result = reconcileUnknownSubmission("intent-1", 2000, repository, provider);

  assert.equal(result.resolved, true);
  assert.equal(result.after.status, OrderSubmissionStatus.ACCEPTED);
  assert.equal(result.after.providerOrderId, "provider-order-1");
  assert.equal(provider.submitCount, 0);
  assert.equal(provider.lookupCount, 1);
});

test("provider lookup can resolve an unknown submission as rejected", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [
    { status: "FOUND_REJECTED", reason: "provider rejected before acceptance" }
  ]);

  const result = reconcileUnknownSubmission("intent-1", 2000, repository, provider);

  assert.equal(result.resolved, true);
  assert.equal(result.after.status, OrderSubmissionStatus.REJECTED);
  assert.equal(result.after.reason, "provider rejected before acceptance");
  assert.equal(provider.submitCount, 0);
});

test("not found remains submission unknown and does not authorize resubmission", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [
    { status: "NOT_FOUND" }
  ]);

  const result = reconcileUnknownSubmission("intent-1", 2000, repository, provider);

  assert.equal(result.resolved, false);
  assert.equal(result.after.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.match(result.after.reason, /automatic resubmission remains prohibited/);
  assert.equal(provider.submitCount, 0);
});

test("lookup errors remain unknown instead of becoming rejected", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = {
    environment: "SYNTHETIC",
    submit() { throw new Error("submit must not be called"); },
    lookupByClientOrderId() { throw new Error("lookup unavailable"); }
  };

  const result = reconcileUnknownSubmission("intent-1", 2000, repository, provider);

  assert.equal(result.resolved, false);
  assert.equal(result.after.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.equal(result.after.reason, "lookup unavailable");
});

test("accepted or rejected executions cannot be reconciled again", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord({ status: OrderSubmissionStatus.ACCEPTED, providerOrderId: "provider-order-1" }));
  const provider = new ScriptedSyntheticOrderProvider([], []);

  assert.throws(
    () => reconcileUnknownSubmission("intent-1", 2000, repository, provider),
    /only submission-unknown executions can be reconciled/
  );
});

test("SQLite persists provider-verified resolution across database reopen", () => {
  const filename = `submission-reconciliation-${process.pid}-${Date.now()}.sqlite`;
  let db = new SqliteDatabase(filename);
  try {
    let repository = new SqliteOrderExecutionRepository(db);
    repository.save(unknownRecord());
    const provider = new ScriptedSyntheticOrderProvider([], [
      { status: "FOUND_ACCEPTED", providerOrderId: "provider-order-1" }
    ]);
    reconcileUnknownSubmission("intent-1", 2000, repository, provider);
    db.close();

    db = new SqliteDatabase(filename);
    repository = new SqliteOrderExecutionRepository(db);
    const restored = repository.getByIntentId("intent-1");
    assert.equal(restored.status, OrderSubmissionStatus.ACCEPTED);
    assert.equal(restored.providerOrderId, "provider-order-1");
  } finally {
    try { db.close(); } catch {}
    require("node:fs").rmSync(filename, { force: true });
  }
});

test("resolved accepted executions cannot transition back to unknown", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  repository.save(unknownRecord({
    status: OrderSubmissionStatus.ACCEPTED,
    providerOrderId: "provider-order-1",
    updatedAtMs: 2000
  }));

  assert.throws(
    () => repository.save(unknownRecord({ updatedAtMs: 3000 })),
    /execution status transition is not allowed/
  );
});

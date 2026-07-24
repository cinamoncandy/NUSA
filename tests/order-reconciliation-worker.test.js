const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  InMemoryOrderExecutionRepository,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  UnknownSubmissionAgeStatus,
  assessUnknownSubmission,
  reconcileUnknownSubmissions
} = execution;

function unknownRecord(overrides = {}) {
  return {
    executionId: "execution-1",
    intentId: "intent-1",
    idempotencyKey: "client-1",
    payloadHash: "hash-1",
    status: OrderSubmissionStatus.SUBMISSION_UNKNOWN,
    reason: "timeout",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides
  };
}

const policy = {
  overdueAfterMs: 100,
  criticalAfterMs: 500,
  maximumRecordsPerRun: 10
};

test("unknown submission age is classified without changing execution state", () => {
  const repository = new InMemoryOrderExecutionRepository();
  const record = repository.save(unknownRecord());
  assert.equal(assessUnknownSubmission(record, 1050, policy).ageStatus, UnknownSubmissionAgeStatus.RECENT);
  assert.equal(assessUnknownSubmission(record, 1100, policy).ageStatus, UnknownSubmissionAgeStatus.OVERDUE);
  assert.equal(assessUnknownSubmission(record, 1500, policy).ageStatus, UnknownSubmissionAgeStatus.CRITICAL);
  assert.equal(repository.getByIntentId("intent-1").status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
});

test("worker resolves provider-confirmed orders and reports unresolved overdue records", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  repository.save(unknownRecord({ executionId: "execution-2", intentId: "intent-2", idempotencyKey: "client-2", payloadHash: "hash-2" }));
  const provider = new ScriptedSyntheticOrderProvider([], [
    { status: "FOUND_ACCEPTED", providerOrderId: "provider-1" },
    { status: "NOT_FOUND" }
  ]);

  const run = reconcileUnknownSubmissions(1200, repository, provider, policy);
  assert.equal(run.scannedCount, 2);
  assert.equal(run.resolvedCount, 1);
  assert.equal(run.unresolvedCount, 1);
  assert.equal(run.overdueCount, 1);
  assert.equal(run.criticalCount, 0);
  assert.equal(repository.getByIntentId("intent-1").status, OrderSubmissionStatus.ACCEPTED);
  assert.equal(repository.getByIntentId("intent-2").status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.equal(provider.submitCount, 0);
});

test("critical unresolved records remain unknown and are counted", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [{ status: "THROW", reason: "lookup outage" }]);

  const run = reconcileUnknownSubmissions(1600, repository, provider, policy);
  assert.equal(run.resolvedCount, 0);
  assert.equal(run.criticalCount, 1);
  assert.equal(run.items[0].reconciliation.lookupStatus, "LOOKUP_FAILED");
  assert.equal(repository.getByIntentId("intent-1").status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.equal(provider.submitCount, 0);
});

test("worker applies a deterministic per-run scan bound", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  repository.save(unknownRecord({ executionId: "execution-2", intentId: "intent-2", idempotencyKey: "client-2", payloadHash: "hash-2", createdAtMs: 1001, updatedAtMs: 1001 }));
  const provider = new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]);

  const run = reconcileUnknownSubmissions(1200, repository, provider, { ...policy, maximumRecordsPerRun: 1 });
  assert.equal(run.scannedCount, 1);
  assert.equal(run.truncated, true);
  assert.equal(run.items[0].assessment.intentId, "intent-1");
  assert.equal(provider.lookupCount, 1);
});

test("invalid reconciliation policy is rejected before provider lookup", () => {
  const repository = new InMemoryOrderExecutionRepository();
  repository.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]);
  assert.throws(
    () => reconcileUnknownSubmissions(1200, repository, provider, { overdueAfterMs: 500, criticalAfterMs: 100, maximumRecordsPerRun: 1 }),
    /criticalAfterMs/
  );
  assert.equal(provider.lookupCount, 0);
});

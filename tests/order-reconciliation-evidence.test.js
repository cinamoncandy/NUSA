const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const evidenceStorage = require("../dist/packages/storage/src/order-reconciliation-evidence.js");

const {
  InMemoryOrderExecutionRepository,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  reconcileUnknownSubmissions
} = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderReconciliationEvidenceRepository } = evidenceStorage;

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

test("reconciliation run and item evidence are persisted append-only", () => {
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(unknownRecord());
  const provider = new ScriptedSyntheticOrderProvider([], [{ status: "FOUND_ACCEPTED", providerOrderId: "provider-1" }]);
  const db = new SqliteDatabase();
  try {
    const evidence = new SqliteOrderReconciliationEvidenceRepository(db);
    const run = reconcileUnknownSubmissions(1200, executions, provider, policy, {
      repository: evidence,
      createRunId: () => "reconciliation-run-1"
    });

    assert.equal(run.runId, "reconciliation-run-1");
    assert.deepEqual(evidence.listRuns(), [{
      runId: "reconciliation-run-1",
      startedAtMs: 1200,
      scannedCount: 1,
      resolvedCount: 1,
      unresolvedCount: 0,
      overdueCount: 0,
      criticalCount: 0,
      truncated: false
    }]);
    assert.deepEqual(evidence.listItems("reconciliation-run-1"), [{
      runId: "reconciliation-run-1",
      sequence: 0,
      intentId: "intent-1",
      executionId: "execution-1",
      ageMs: 200,
      ageStatus: "OVERDUE",
      beforeStatus: "SUBMISSION_UNKNOWN",
      afterStatus: "ACCEPTED",
      resolved: true,
      lookupStatus: "FOUND_ACCEPTED"
    }]);
  } finally {
    db.close();
  }
});

test("duplicate reconciliation run id is rejected without appending duplicate items", () => {
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(unknownRecord());
  const db = new SqliteDatabase();
  try {
    const evidence = new SqliteOrderReconciliationEvidenceRepository(db);
    reconcileUnknownSubmissions(
      1200,
      executions,
      new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]),
      policy,
      { repository: evidence, createRunId: () => "duplicate-run" }
    );

    assert.throws(
      () => evidence.append({
        runId: "duplicate-run",
        startedAtMs: 1300,
        scannedCount: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
        overdueCount: 0,
        criticalCount: 0,
        truncated: false,
        items: []
      }),
      /UNIQUE|constraint/i
    );
    assert.equal(evidence.listRuns().length, 1);
    assert.equal(evidence.listItems("duplicate-run").length, 1);
  } finally {
    db.close();
  }
});

test("empty generated run id is rejected", () => {
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(unknownRecord());
  const db = new SqliteDatabase();
  try {
    const evidence = new SqliteOrderReconciliationEvidenceRepository(db);
    assert.throws(
      () => reconcileUnknownSubmissions(
        1200,
        executions,
        new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]),
        policy,
        { repository: evidence, createRunId: () => "" }
      ),
      /run id/
    );
    assert.equal(evidence.listRuns().length, 0);
  } finally {
    db.close();
  }
});

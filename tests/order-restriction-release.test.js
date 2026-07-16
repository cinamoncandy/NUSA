const test = require("node:test");
const assert = require("node:assert/strict");

const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const restrictionStorage = require("../dist/packages/storage/src/order-restriction.js");
const releaseEvidenceStorage = require("../dist/packages/storage/src/order-restriction-release-evidence.js");

const {
  InMemoryOrderExecutionRepository,
  InMemoryOrderOperationalRestrictionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository,
  OrderSubmissionStatus,
  releaseOrderOperationalRestriction
} = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderOperationalRestrictionRepository } = restrictionStorage;
const { SqliteOrderOperationalRestrictionReleaseEvidenceRepository } = releaseEvidenceStorage;

function activeRestriction() {
  return {
    restrictionId: "restriction-1",
    accountId: "account-1",
    reason: "CRITICAL_UNKNOWN_SUBMISSION",
    sourceRunId: "run-1",
    sourceIntentIds: ["intent-1"],
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "ACTIVE",
    createdAtMs: 1000
  };
}

function executionRecord(status) {
  return {
    executionId: "execution-1",
    intentId: "intent-1",
    idempotencyKey: "client-1",
    payloadHash: "hash-1",
    status,
    providerOrderId: status === OrderSubmissionStatus.ACCEPTED ? "provider-1" : undefined,
    reason: status === OrderSubmissionStatus.REJECTED ? "rejected" : undefined,
    createdAtMs: 900,
    updatedAtMs: 1500
  };
}

function releaseInput(overrides = {}) {
  return {
    releaseId: "release-1",
    restrictionId: "restriction-1",
    requestedBy: "operator-a",
    verifiedBy: "operator-b",
    rationale: "Provider lookup resolved the uncertain submission and local state was reviewed.",
    nowMs: 2000,
    ...overrides
  };
}

test("restriction cannot be released while a source execution remains unknown", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save(activeRestriction());
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(executionRecord(OrderSubmissionStatus.SUBMISSION_UNKNOWN));
  const evidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();

  assert.throws(() => releaseOrderOperationalRestriction({
    ...releaseInput(), restrictions, executions, evidence
  }), /remains unresolved/);
  assert.equal(restrictions.getById("restriction-1").status, "ACTIVE");
  assert.equal(evidence.getByRestrictionId("restriction-1"), undefined);
});

test("requester and verifier must be different", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save(activeRestriction());
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(executionRecord(OrderSubmissionStatus.ACCEPTED));
  const evidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();

  assert.throws(() => releaseOrderOperationalRestriction({
    ...releaseInput({ verifiedBy: "operator-a" }), restrictions, executions, evidence
  }), /must be different/);
  assert.equal(restrictions.getById("restriction-1").status, "ACTIVE");
});

test("resolved source execution permits manual release with immutable evidence", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save(activeRestriction());
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(executionRecord(OrderSubmissionStatus.ACCEPTED));
  const evidence = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();

  const released = releaseOrderOperationalRestriction({
    ...releaseInput(), restrictions, executions, evidence
  });
  assert.equal(released.status, "RELEASED");
  assert.equal(restrictions.getActiveForAccount("account-1"), undefined);
  assert.deepEqual(evidence.getByRestrictionId("restriction-1").verifiedIntentIds, ["intent-1"]);
  assert.equal(evidence.getByRestrictionId("restriction-1").verifiedBy, "operator-b");
  assert.throws(() => evidence.append({ ...evidence.getByRestrictionId("restriction-1"), releaseId: "release-2" }), /already has release evidence/);
});

test("SQLite release state and evidence persist together", () => {
  const db = new SqliteDatabase(":memory:");
  const restrictions = new SqliteOrderOperationalRestrictionRepository(db);
  const evidence = new SqliteOrderOperationalRestrictionReleaseEvidenceRepository(db);
  const executions = new InMemoryOrderExecutionRepository();
  restrictions.save(activeRestriction());
  executions.save(executionRecord(OrderSubmissionStatus.REJECTED));

  const released = releaseOrderOperationalRestriction({
    ...releaseInput(), restrictions, executions, evidence, transaction: db
  });
  assert.equal(released.status, "RELEASED");
  assert.equal(restrictions.getById("restriction-1").status, "RELEASED");
  assert.equal(evidence.getByRestrictionId("restriction-1").rationale.includes("resolved"), true);
  db.close();
});

test("SQLite transaction rolls back release when evidence append fails", () => {
  const db = new SqliteDatabase(":memory:");
  const restrictions = new SqliteOrderOperationalRestrictionRepository(db);
  const evidence = new SqliteOrderOperationalRestrictionReleaseEvidenceRepository(db);
  const executions = new InMemoryOrderExecutionRepository();
  restrictions.save(activeRestriction());
  executions.save(executionRecord(OrderSubmissionStatus.ACCEPTED));
  evidence.append({
    releaseId: "existing-release",
    restrictionId: "restriction-1",
    accountId: "account-1",
    requestedBy: "operator-x",
    verifiedBy: "operator-y",
    rationale: "existing evidence",
    verifiedIntentIds: ["intent-1"],
    releasedAtMs: 1900
  });

  assert.throws(() => releaseOrderOperationalRestriction({
    ...releaseInput(), restrictions, executions, evidence, transaction: db
  }));
  assert.equal(restrictions.getById("restriction-1").status, "ACTIVE");
  db.close();
});

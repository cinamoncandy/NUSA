const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryIdempotencyStore,
  InMemoryOrderExecutionRepository,
  InMemoryOrderOperationalRestrictionRepository,
  OrderAdmissionDecisionType,
  OrderAdmissionReasonCode,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  admitOrder,
  reconcileUnknownSubmissions
} = execution;

function unknownRecord() {
  return {
    executionId: "execution-1",
    intentId: "intent-unknown",
    idempotencyKey: "client-unknown",
    payloadHash: "hash-unknown",
    status: OrderSubmissionStatus.SUBMISSION_UNKNOWN,
    reason: "timeout",
    createdAtMs: 1000,
    updatedAtMs: 1000
  };
}

function intent() {
  return {
    intentId: "intent-new",
    idempotencyKey: "client-new",
    environment: "SYNTHETIC",
    accountId: "account-1",
    strategyId: "strategy-1",
    symbol: "BTCUSDT",
    side: contracts.LedgerSide.BUY,
    orderType: "MARKET",
    baseQtyRaw: 1n,
    quoteQtyRaw: 100n,
    createdAtMs: 2000
  };
}

const policy = { overdueAfterMs: 100, criticalAfterMs: 500, maximumRecordsPerRun: 10 };

test("critical unresolved submission activates a manual-release new-exposure restriction", () => {
  const executions = new InMemoryOrderExecutionRepository();
  executions.save(unknownRecord());
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const provider = new ScriptedSyntheticOrderProvider([], [{ status: "NOT_FOUND" }]);

  const run = reconcileUnknownSubmissions(1600, executions, provider, policy, undefined, {
    accountId: "account-1",
    repository: restrictions,
    createRestrictionId: () => "restriction-1"
  });

  assert.equal(run.criticalCount, 1);
  const active = restrictions.getActiveForAccount("account-1");
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.blockNewExposure, true);
  assert.equal(active.manualReleaseRequired, true);
  assert.deepEqual(active.sourceIntentIds, ["intent-unknown"]);
});

test("active restriction blocks a new order before risk and idempotency mutation", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  restrictions.save({
    restrictionId: "restriction-1",
    accountId: "account-1",
    reason: "CRITICAL_UNKNOWN_SUBMISSION",
    sourceRunId: "run-1",
    sourceIntentIds: ["intent-unknown"],
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "ACTIVE",
    createdAtMs: 1500
  });
  const idempotency = new InMemoryIdempotencyStore();
  const decision = admitOrder(intent(), {
    nowMs: 2000,
    authorization: {
      environment: "SYNTHETIC",
      accountIds: ["account-1"],
      strategyIds: ["strategy-1"],
      symbols: ["BTCUSDT"],
      orderTypes: ["MARKET"],
      expiresAtMs: 3000
    },
    riskContext: {},
    operationalRestrictions: restrictions
  }, idempotency);

  assert.equal(decision.type, OrderAdmissionDecisionType.BLOCK);
  assert.equal(decision.reasonCode, OrderAdmissionReasonCode.OPERATIONAL_RESTRICTION_ACTIVE);
  assert.equal(idempotency.getByKey("client-new"), undefined);
});

test("released restriction cannot be reactivated", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const released = restrictions.save({
    restrictionId: "restriction-1",
    accountId: "account-1",
    reason: "CRITICAL_UNKNOWN_SUBMISSION",
    sourceRunId: "run-1",
    sourceIntentIds: ["intent-unknown"],
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "RELEASED",
    createdAtMs: 1000,
    releasedAtMs: 2000
  });
  assert.equal(released.status, "RELEASED");
  assert.throws(() => restrictions.save({ ...released, status: "ACTIVE", releasedAtMs: undefined }), /cannot be reactivated/);
});

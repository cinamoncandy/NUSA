const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const contracts = require("../dist/packages/contracts/src/index.js");
const execution = require("../dist/apps/execution/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const idempotencyStorage = require("../dist/packages/storage/src/order-idempotency.js");
const executionStorage = require("../dist/packages/storage/src/order-execution.js");

const { LedgerSide } = contracts;
const {
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  executeAdmittedOrder
} = execution;
const { SqliteDatabase } = storage;
const { SqliteOrderIdempotencyRepository } = idempotencyStorage;
const { SqliteOrderExecutionRepository } = executionStorage;

function intent(overrides = {}) {
  return {
    intentId: "execution-intent-1",
    idempotencyKey: "execution-key-1",
    environment: "SYNTHETIC",
    accountId: "account-1",
    strategyId: "strategy-1",
    symbol: "BTC-USDT",
    side: LedgerSide.BUY,
    orderType: "MARKET",
    baseQtyRaw: 1n,
    quoteQtyRaw: 10n,
    createdAtMs: 1000,
    ...overrides
  };
}

function context(nowMs = 1000) {
  return {
    nowMs,
    createExecutionId: () => "execution-1",
    admission: {
      nowMs,
      authorization: {
        environment: "SYNTHETIC",
        accountIds: ["account-1"],
        strategyIds: ["strategy-1"],
        symbols: ["BTC-USDT"],
        orderTypes: ["MARKET"],
        expiresAtMs: 5000
      },
      riskContext: { position: { baseQtyRaw: 0n, realizedPnlRaw: 0n } }
    }
  };
}

function withDatabaseFile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-execution-"));
  const filename = path.join(directory, "execution.sqlite");
  try { run(filename); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("accepted execution survives database close and reopen without provider resubmission", () => {
  withDatabaseFile(filename => {
    let db = new SqliteDatabase(filename);
    const provider = new ScriptedSyntheticOrderProvider([{ type: "ACCEPT", providerOrderId: "provider-1" }]);
    try {
      const first = executeAdmittedOrder(
        intent(),
        context(),
        new SqliteOrderIdempotencyRepository(db),
        new SqliteOrderExecutionRepository(db),
        provider
      );
      assert.equal(first.execution.status, OrderSubmissionStatus.ACCEPTED);
      assert.equal(provider.submitCount, 1);
    } finally { db.close(); }

    db = new SqliteDatabase(filename);
    try {
      const second = executeAdmittedOrder(
        intent(),
        context(2000),
        new SqliteOrderIdempotencyRepository(db),
        new SqliteOrderExecutionRepository(db),
        provider
      );
      assert.equal(second.execution.status, OrderSubmissionStatus.ACCEPTED);
      assert.equal(second.execution.providerOrderId, "provider-1");
      assert.equal(provider.submitCount, 1);
    } finally { db.close(); }
  });
});

test("submission unknown survives restart and is never automatically retried", () => {
  withDatabaseFile(filename => {
    let db = new SqliteDatabase(filename);
    const provider = new ScriptedSyntheticOrderProvider([
      { type: "THROW", reason: "connection lost after write" },
      { type: "ACCEPT", providerOrderId: "must-not-run" }
    ]);
    try {
      const first = executeAdmittedOrder(
        intent(),
        context(),
        new SqliteOrderIdempotencyRepository(db),
        new SqliteOrderExecutionRepository(db),
        provider
      );
      assert.equal(first.execution.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
    } finally { db.close(); }

    db = new SqliteDatabase(filename);
    try {
      const second = executeAdmittedOrder(
        intent(),
        context(2000),
        new SqliteOrderIdempotencyRepository(db),
        new SqliteOrderExecutionRepository(db),
        provider
      );
      assert.equal(second.execution.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
      assert.equal(provider.submitCount, 1);
    } finally { db.close(); }
  });
});

test("stranded submitting records become submission unknown during recovery", () => {
  const db = new SqliteDatabase();
  try {
    const repository = new SqliteOrderExecutionRepository(db);
    repository.save({
      executionId: "execution-stranded",
      intentId: "intent-stranded",
      idempotencyKey: "key-stranded",
      payloadHash: "hash-stranded",
      status: OrderSubmissionStatus.SUBMITTING,
      createdAtMs: 1000,
      updatedAtMs: 1000
    });
    const recovered = repository.recoverUncertainSubmissions(2000);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
    assert.match(recovered[0].reason, /restarted/);
  } finally { db.close(); }
});

test("terminal execution identity and state cannot be rewritten", () => {
  const db = new SqliteDatabase();
  try {
    const repository = new SqliteOrderExecutionRepository(db);
    const accepted = repository.save({
      executionId: "execution-final",
      intentId: "intent-final",
      idempotencyKey: "key-final",
      payloadHash: "hash-final",
      status: OrderSubmissionStatus.ACCEPTED,
      providerOrderId: "provider-final",
      createdAtMs: 1000,
      updatedAtMs: 1000
    });
    assert.throws(() => repository.save({ ...accepted, status: OrderSubmissionStatus.REJECTED, updatedAtMs: 2000 }), /terminal/);
    assert.throws(() => repository.save({ ...accepted, payloadHash: "changed", updatedAtMs: 2000 }), /identity/);
  } finally { db.close(); }
});

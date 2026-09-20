const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const {
  PaperTradingExecutionLoop,
  SqliteCloudPaperAccountRepository,
} = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");
const { buildPaperObservedExecutionQuote } = require("../dist/apps/cloud/src/paperRuntimeExecutionCostEvidence.js");

const candidateBinding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "sma-5-20",
  datasetId: "restart-fixture-dataset",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 500,
  periodStartAt: 900,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
  candidateStrategy: Object.freeze({
    candidateId: "sma-5-20",
    familyId: "sma-crossover",
    lineageId: "restart-fixture-lineage",
    specificationHash: "d".repeat(64),
    codeSha: "e".repeat(40),
    costModelVersion: "restart-cost-v1",
    parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 }),
  }),
});

const decision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 1,
  risk: "LOW",
  allocation: 0.1,
  leverage: 1,
  score: 1,
  reasons: Object.freeze(["restart fixture"]),
  decidedAt: 1_000,
  paperCandidateBinding: candidateBinding,
  paperCandidateStrategyDecision: Object.freeze({
    action: "BUY",
    score: 1,
    confidence: 1,
    reason: "SMA_CROSSOVER:5/20:restart",
    observedAt: 950,
  }),
});

function tick(now, observedAt, price, decisions, observedQuote) {
  return Object.freeze({
    now,
    market: "KRW-BTC",
    price,
    observedAt,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    portfolio: Object.freeze({
      allocations: Object.freeze([Object.freeze({
        symbol: "KRW-BTC",
        instrument: "SPOT",
        action: "BUY",
        capital: 1_000_000,
        share: 0.1,
        leverage: 1,
        confidence: 1,
        risk: "LOW",
      })]),
      deployedCapital: 1_000_000,
      cashCapital: 9_000_000,
      reservedCapital: 0,
      grossShare: 0.1,
      futuresShare: 0,
      decidedAt: 1_000,
    }),
    decisions: Object.freeze(decisions),
    observedQuote,
  });
}

function observedQuote(observedAt, askSize) {
  return buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt,
    totalAskSize: askSize,
    totalBidSize: 0.05,
    units: [Object.freeze({
      askPrice: 50_000_000,
      bidPrice: 49_000_000,
      askSize,
      bidSize: 0.05,
    })],
  });
}

test("SQLite restart preserves strategy depth residual and canonical fill-ledger continuation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-depth-working-restart-"));
  const databasePath = path.join(directory, "state.sqlite");
  let db = new SqliteDatabase(databasePath);
  let repository = new SqliteCloudPaperAccountRepository(db);
  try {
    const loop = new PaperTradingExecutionLoop({
      initialCapital: 10_000_000,
      feeRate: 0,
      repository,
      readP0State: () => ({ openP0: false }),
    });
    let riskCalls = 0;
    const boundary = new CloudPaperExecutionBoundary({
      loop,
      riskGate: {
        evaluate() {
          riskCalls += 1;
          return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) });
        },
      },
      readP0State: () => ({ openP0: false }),
    });

    const first = boundary.processTick(tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005)));
    assert.equal(first.status, "WAIT");
    assert.equal(first.reason, "PAPER_STRATEGY_WORKING_PARTIALLY_FILLED");
    assert.equal(riskCalls, 1);
    assert.equal(first.state.workingOrders.length, 1);
    assert.equal(repository.loadFills().length, 1);

    repository.close();
    db.close();

    db = new SqliteDatabase(databasePath);
    repository = new SqliteCloudPaperAccountRepository(db);
    const restoredLoop = new PaperTradingExecutionLoop({
      initialCapital: 10_000_000,
      feeRate: 0,
      repository,
      readP0State: () => ({ openP0: false }),
    });
    assert.equal(restoredLoop.snapshot().workingOrders.length, 1);
    assert.equal(restoredLoop.snapshot().workingOrders[0].lifecycle.remainingQuantity, 0.015);
    assert.equal(restoredLoop.snapshot().workingOrders[0].strategyExecution.remainingAllocationCapital, 750_000);

    const restoredBoundary = new CloudPaperExecutionBoundary({
      loop: restoredLoop,
      riskGate: {
        evaluate() {
          throw new Error("restored residual must not widen the original risk request");
        },
      },
      readP0State: () => ({ openP0: false }),
    });

    const terminal = restoredBoundary.processTick(tick(2_200, 2_100, 50_000_000, [], observedQuote(2_150, 0.02)));
    assert.equal(terminal.status, "FILLED");
    assert.equal(terminal.reason, "PAPER_STRATEGY_WORKING_FILLED");
    assert.equal(terminal.state.workingOrders.length, 0);
    assert.equal(terminal.state.positions[0].quantity, 0.02);
    assert.equal(terminal.state.cash, 9_000_000);

    const durableFills = repository.loadFills();
    assert.equal(durableFills.length, 2);
    assert.equal(durableFills.reduce((sum, fill) => sum + fill.quantity, 0), 0.02);
    assert.equal(durableFills.reduce((sum, fill) => sum + fill.orderBookExecutionReceipt.grossNotional, 0), 1_000_000);
    assert.equal(new Set(durableFills.map((fill) => fill.id)).size, 2);

    const finalSnapshot = structuredClone(restoredLoop.snapshot());
    repository.close();
    db.close();

    db = new SqliteDatabase(databasePath);
    repository = new SqliteCloudPaperAccountRepository(db);
    const replayed = new PaperTradingExecutionLoop({
      initialCapital: 10_000_000,
      feeRate: 0,
      repository,
      readP0State: () => ({ openP0: false }),
    });
    assert.deepEqual(replayed.snapshot(), finalSnapshot);
    assert.deepEqual(repository.loadFills(), durableFills);
  } finally {
    try { repository.close(); } catch {}
    try { db.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

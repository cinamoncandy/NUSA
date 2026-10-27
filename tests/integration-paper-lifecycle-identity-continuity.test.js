const test = require("node:test");
const assert = require("node:assert/strict");

const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { bindPaperCandidateForExecution } = require("../dist/packages/contracts/src/paperCandidateExecutionBinding.js");
const { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { buildPaperObservedExecutionQuote } = require("../dist/apps/cloud/src/paperRuntimeExecutionCostEvidence.js");
const { buildDurablePaperAccountingSource } = require("../dist/apps/cloud/src/paperAccountingLedger.js");
const { reconcileCanonicalPaperOutcomeWindow } = require("../dist/apps/cloud/src/paperCanonicalOutcomeReconciliation.js");
const { buildPaperPerformanceFromLedger } = require("../dist/apps/cloud/src/paperPerformanceFromLedger.js");
const { createPaperOrderLifecycle, transitionPaperOrderLifecycle } = require("../dist/apps/cloud/src/paperOrderLifecycle.js");

const candidateId = "candidate-integration-2018";
const datasetId = "dataset-integration-2018";
const datasetHash = "a".repeat(64);
const specificationHash = "b".repeat(64);

function fixture() {
  const candidateProvenance = Object.freeze([Object.freeze({
    candidateId,
    datasetId,
    datasetContentSha256: datasetHash
  })]);

  const advisory = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(500).toISOString(),
    policy: Object.freeze({
      maximumCandidateWeight: 1,
      minimumEvidenceBreadth: 1,
      maximumCandidateCount: 1,
      maximumFamilyWeight: 1
    }),
    entries: Object.freeze([Object.freeze({
      id: candidateId,
      familyId: "family-integration",
      rank: 1,
      leagueScore: 1,
      evidenceBreadth: 1,
      researchWeight: 1,
      reasons: Object.freeze(["integration-evidence"]),
      sourceDatasetIds: Object.freeze([datasetId])
    })]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze(["integration-evidence"]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze([datasetId]) })
  });

  const strategy = Object.freeze({
    candidateId,
    familyId: "family-integration",
    lineageId: "lineage-integration-2018",
    specificationHash,
    codeSha: "c".repeat(40),
    costModelVersion: "cost-v1",
    parameters: Object.freeze({ fastWindow: 5, slowWindow: 20 })
  });

  const binding = bindPaperCandidateForExecution(advisory, candidateProvenance, candidateId, 1000, strategy);
  const decision = Object.freeze({
    symbol: "KRW-BTC",
    action: "BUY",
    confidence: 1,
    risk: "LOW",
    allocation: 0.1,
    leverage: 1,
    score: 1,
    reasons: Object.freeze(["candidate-bound-integration-trace"]),
    decidedAt: 1400,
    paperCandidateBinding: binding
  });
  const observedQuote = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 1499,
    totalAskSize: 10,
    totalBidSize: 10,
    units: Object.freeze([
      Object.freeze({ askPrice: 100, bidPrice: 99, askSize: 10, bidSize: 10 })
    ])
  });

  const start = Object.freeze({
    version: 1,
    initialCapital: 1000,
    cash: 1000,
    equity: 1000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt: 1000
  });

  return { candidateProvenance, advisory, strategy, binding, decision, observedQuote, start };
}

function buildPeriod(advisory, candidateProvenance, start, end) {
  const receipt = reconcileCanonicalPaperOutcomeWindow({
    periodStartAt: start.updatedAt,
    periodEndAt: end.updatedAt,
    startState: start,
    endState: end
  });
  assert.equal(receipt.candidateIds.length, 1);
  assert.equal(receipt.candidateIds[0], candidateId);
  assert.ok(receipt.executionCostEvidenceKind);
  assert.ok(receipt.executionCostEvidenceFingerprint);

  return Object.freeze({
    record: Object.freeze({
      recordId: "period-integration-2018",
      periodIndex: 0,
      market: "KRW-BTC",
      advisory,
      periodStartAt: start.updatedAt,
      periodEndAt: end.updatedAt,
      realizedReturns: Object.freeze({ [candidateId]: receipt.netReturn }),
      benchmarkReturn: 0,
      turnoverCostRate: receipt.feeRate + receipt.spreadRate + receipt.slippageRate,
      costEvidence: Object.freeze({
        evidenceId: "paper-canonical-outcome:" + receipt.receiptFingerprint,
        source: "PAPER_EXECUTION_RECEIPT",
        evidenceKind: receipt.executionCostEvidenceKind,
        evidenceFingerprintSha256: receipt.executionCostEvidenceFingerprint,
        observedAt: end.updatedAt,
        feeRate: receipt.feeRate,
        spreadRate: receipt.spreadRate,
        slippageRate: receipt.slippageRate
      }),
      status: "COMPLETED",
      benchmarkEvidenceId: "benchmark-integration-2018",
      canonicalOutcomeReceiptFingerprint: receipt.receiptFingerprint
    }),
    candidateProvenance
  });
}

test("canonical PAPER identity remains continuous from candidate binding through fill, durable ledger and performance", () => {
  const { candidateProvenance, advisory, binding, decision, observedQuote, start } = fixture();
  const db = new SqliteDatabase(":memory:");
  let now = 1000;
  const repository = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "integration-2018",
    now: () => now,
    leaseDurationMs: 30000,
    heartbeatIntervalMs: 10000
  });

  try {
    repository.save(start);
    const loop = new PaperTradingExecutionLoop({
      initialCapital: 1000,
      feeRate: 0.001,
      repository,
      restoredState: start
    });

    now = 1500;
    const tick = Object.freeze({
      now,
      market: "KRW-BTC",
      price: 100,
      quantity: 1,
      observedAt: 1499,
      mode: "PAPER",
      killSwitchActive: false,
      tradingAllowed: true,
      overallHealth: "HEALTHY",
      decisions: Object.freeze([decision]),
      observedQuote
    });

    const executed = loop.processTick(tick);
    assert.equal(executed.status, "FILLED");
    assert.equal(executed.orders.length, 1);
    assert.equal(executed.fills.length, 1);

    const order = executed.orders[0];
    const fill = executed.fills[0];
    assert.equal(fill.orderId, order.id);
    assert.equal(fill.candidateProvenance.binding.bindingFingerprintSha256, binding.bindingFingerprintSha256);
    assert.equal(fill.candidateProvenance.binding.candidateId, candidateId);
    assert.equal(fill.candidateProvenance.binding.datasetId, datasetId);
    assert.equal(fill.candidateProvenance.binding.datasetContentSha256, datasetHash);
    assert.equal(fill.candidateProvenance.binding.candidateStrategy.specificationHash, specificationHash);
    assert.equal(fill.executionCostAttribution.candidateId, candidateId);

    const history = repository.loadHistory();
    assert.deepEqual(history.map((state) => state.updatedAt), [1000, 1500]);
    const ledger = buildDurablePaperAccountingSource(history, 1500);
    assert.equal(ledger.reconciled, true);
    assert.equal(ledger.fills.length, 1);
    assert.equal(ledger.fills[0].id, fill.id);

    const period = buildPeriod(advisory, candidateProvenance, start, executed.state);
    const performance = buildPaperPerformanceFromLedger({ period, accountHistory: history });
    assert.equal(performance.evidence.candidateId, candidateId);
    assert.equal(performance.familyId, "family-integration");
    assert.equal(performance.evidence.strategyId, "lineage-integration-2018");
    assert.equal(performance.evidence.strategyVersion, specificationHash);
    assert.equal(performance.evidence.sourceLedgerFingerprintSha256, ledger.ledgerFingerprintSha256);
    assert.equal(performance.ledgerSource.ledgerFingerprintSha256, ledger.ledgerFingerprintSha256);
    assert.equal(performance.evidence.evidenceKind, "PAPER");
    assert.equal(performance.evidence.authority, "PAPER_ONLY");
    assert.equal(performance.evidence.liveAuthority, "NONE");
    assert.equal(performance.evidence.productionMutationAllowed, false);
    assert.equal(performance.evidence.aiAuthority, "ZERO_AUTHORITY");

    const replay = buildPaperPerformanceFromLedger({ period, accountHistory: history });
    assert.deepEqual(replay, performance);

    const duplicate = loop.processTick(tick);
    assert.equal(duplicate.status, "DUPLICATE");
    const historyAfterDuplicate = repository.loadHistory();
    assert.equal(historyAfterDuplicate.length, history.length);
    assert.equal(
      buildDurablePaperAccountingSource(historyAfterDuplicate, 1500).ledgerFingerprintSha256,
      ledger.ledgerFingerprintSha256
    );
  } finally {
    repository.close();
    db.close();
  }
});

test("identity/provenance mismatch, ledger tamper and fabricated PAPER evidence all fail closed", () => {
  const { candidateProvenance, advisory, start } = fixture();

  const end = Object.freeze({
    version: 1,
    initialCapital: 1000,
    cash: 899.9,
    equity: 999.9,
    realizedPnL: 0,
    unrealizedPnL: -0.1,
    positions: Object.freeze([
      Object.freeze({ market: "KRW-BTC", quantity: 1, averageEntryPrice: 100.1, realizedPnL: 0, unrealizedPnL: -0.1, markPrice: 100 })
    ]),
    orders: Object.freeze([
      Object.freeze({
        id: "order-identity-test",
        idempotencyKey: "paper:identity:test",
        market: "KRW-BTC",
        side: "BUY",
        quantity: 1,
        price: 100,
        fee: 0.1,
        status: "FILLED",
        createdAt: 1500,
        filledAt: 1500
      })
    ]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze(["paper:identity:test"]),
    updatedAt: 1500
  });

  assert.throws(
    () => buildDurablePaperAccountingSource([start, end], 1500),
    /PAPER_LEDGER_RECONCILIATION_REQUIRED/
  );

  const valid = fixture();
  const db = new SqliteDatabase(":memory:");
  let now = 1000;
  const repository = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "integration-2018-negative",
    now: () => now,
    leaseDurationMs: 30000,
    heartbeatIntervalMs: 10000
  });
  try {
    repository.save(valid.start);
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1000, feeRate: 0.001, repository, restoredState: valid.start });
    now = 1500;
    const result = loop.processTick(Object.freeze({
      now,
      market: "KRW-BTC",
      price: 100,
      quantity: 1,
      observedAt: 1499,
      mode: "PAPER",
      killSwitchActive: false,
      tradingAllowed: true,
      overallHealth: "HEALTHY",
      decisions: Object.freeze([valid.decision]),
      observedQuote: valid.observedQuote
    }));
    assert.equal(result.status, "FILLED");
    const history = repository.loadHistory();
    const period = buildPeriod(valid.advisory, valid.candidateProvenance, valid.start, result.state);

    const wrongCandidatePeriod = Object.freeze({
      ...period,
      candidateProvenance: Object.freeze([
        Object.freeze({ candidateId: "candidate-other", datasetId, datasetContentSha256: datasetHash })
      ])
    });
    assert.throws(
      () => buildPaperPerformanceFromLedger({ period: wrongCandidatePeriod, accountHistory: history }),
      /PAPER_PERFORMANCE_(STRATEGY_IDENTITY_UNAVAILABLE|CANDIDATE_ATTRIBUTION_MISMATCH)/
    );

    const fabricated = Object.freeze({
      ...period,
      record: Object.freeze({
        ...period.record,
        canonicalOutcomeReceiptFingerprint: "f".repeat(64)
      })
    });
    assert.throws(
      () => buildPaperPerformanceFromLedger({ period: fabricated, accountHistory: history }),
      /PAPER_PERFORMANCE_OUTCOME_RECEIPT_MISMATCH/
    );

    const tamperedEnd = Object.freeze({ ...result.state, cash: result.state.cash + 1 });
    assert.throws(
      () => buildPaperPerformanceFromLedger({ period, accountHistory: [valid.start, tamperedEnd] }),
      /PAPER_LEDGER_RECONCILIATION_REQUIRED/
    );
  } finally {
    repository.close();
    db.close();
  }
});

test("terminal PAPER lifecycle cannot be reordered after completion", () => {
  let lifecycle = createPaperOrderLifecycle(1, 1000);
  lifecycle = transitionPaperOrderLifecycle(lifecycle, "ACCEPTED", 1100);
  lifecycle = transitionPaperOrderLifecycle(lifecycle, "FILLED", 1200, 1);
  assert.throws(
    () => transitionPaperOrderLifecycle(lifecycle, "OPEN", 1300),
    /terminal state cannot transition/
  );
});

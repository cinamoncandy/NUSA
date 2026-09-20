import assert from "node:assert/strict";
import test from "node:test";
import { projectPaperAccounting } from "./paperAccountingLedger";
import { buildPaperPerformanceEvidenceFromLedger } from "./paperPerformanceFromLedger";

test("binds PAPER performance evidence to the exact canonical ledger fingerprint", () => {
  const ledger = projectPaperAccounting(1000, [{
    id: "fill:1", orderId: "order:1", market: "KRW-BTC", side: "BUY",
    quantity: 1, price: 100, fee: 1, filledAt: 1000
  }], { "KRW-BTC": 110 });
  const evidence = buildPaperPerformanceEvidenceFromLedger({
    ledger,
    durableCompleteJournal: true,
    candidateId: "candidate-1",
    strategyId: "strategy-1",
    strategyVersion: "1",
    periodStartAt: 1000,
    periodEndAt: 2000,
    equityCurve: [{ observedAt: 1000, equity: 1000 }, { observedAt: 2000, equity: 1009 }],
    realizedPnL: 0,
    unrealizedPnL: 9,
    feeAmount: 1,
    fillCount: 1,
    benchmarkId: "KRW-CASH",
    calculationVersion: "paper-performance-v1",
    generatedAt: 2000
  });
  assert.equal(evidence.sourceLedgerFingerprintSha256, ledger.fingerprintSha256);
  assert.throws(() => buildPaperPerformanceEvidenceFromLedger({
    ledger,
    durableCompleteJournal: false,
    candidateId: "candidate-1", strategyId: "strategy-1", strategyVersion: "1",
    periodStartAt: 1000, periodEndAt: 2000,
    equityCurve: [{ observedAt: 1000, equity: 1000 }, { observedAt: 2000, equity: 1009 }],
    realizedPnL: 0, unrealizedPnL: 9, feeAmount: 1, fillCount: 1,
    benchmarkId: "KRW-CASH", calculationVersion: "paper-performance-v1", generatedAt: 2000
  }), /LEDGER_HISTORY_INCOMPLETE/);
});

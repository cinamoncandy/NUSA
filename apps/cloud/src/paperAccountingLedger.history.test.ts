import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { buildDurablePaperAccountingSource } from "./paperAccountingLedger";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository } from "./paperTradingExecutionLoop";
import type { PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";

const command = (idempotencyKey: string): PersonalPaperOrderCommand => ({
  schemaVersion: 1,
  authority: "PAPER_ONLY",
  productionMutationAllowed: false,
  idempotencyKey,
  market: "KRW-BTC",
  side: "BUY",
  orderType: "MARKET",
  quantity: 1,
});

const context = (now: number) => ({
  now,
  marketPrice: 100,
  observedAt: now,
  mode: "PAPER" as const,
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY" as const,
});

test("durable PAPER account history reconstructs one canonical accounting source", () => {
  const db = new SqliteDatabase(":memory:");
  let now = 1_000;
  const repository = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "ledger-history-test",
    now: () => now,
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 10_000,
  });
  try {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository });
    assert.equal(loop.submitManualOrder(command("history-buy-1"), context(1_000)).status, "FILLED");
    now = 2_000;
    assert.equal(loop.submitManualOrder(command("history-buy-2"), context(2_000)).status, "FILLED");

    const history = repository.loadHistory();
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((state) => state.updatedAt), [1_000, 2_000]);

    const source = buildDurablePaperAccountingSource(history, 2_000);
    assert.equal(source.durableCompleteJournal, true);
    assert.equal(source.reconciled, true);
    assert.equal(source.fills.length, 2);
    assert.equal(source.projection.cash, loop.snapshot().cash);
    assert.equal(source.projection.positions[0]?.quantity, 2);
    assert.match(source.ledgerFingerprintSha256, /^[a-f0-9]{64}$/);
  } finally {
    repository.close();
    db.close();
  }
});

test("durable PAPER accounting source fails closed when processed identity has no historical order", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "ledger-incomplete-test",
    now: () => 1_000,
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 10_000,
  });
  try {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0, repository });
    loop.submitManualOrder(command("history-buy-1"), context(1_000));
    const history = repository.loadHistory();
    const latest = history.at(-1)!;
    const corrupted = Object.freeze({
      ...latest,
      processedIdempotencyKeys: Object.freeze([...latest.processedIdempotencyKeys, "missing-history-order"]),
    });
    assert.throws(() => buildDurablePaperAccountingSource([...history.slice(0, -1), corrupted]), /PAPER_LEDGER_HISTORY_INCOMPLETE/);
  } finally {
    repository.close();
    db.close();
  }
});

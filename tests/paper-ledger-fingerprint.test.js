const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { paperLedgerFingerprint } = require("../dist/apps/cloud/src/paperLedgerFingerprint.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteCloudPaperAccountRepository, PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

const fill = (id, filledAt, side = "BUY") => ({ id, orderId: `o-${id}`, market: "KRW-XRP", side, quantity: 2, price: 800, fee: 0.8, filledAt });
const state = (over = {}) => ({
  version: 1, initialCapital: 10_000, cash: 8_399.2, equity: 10_010, realizedPnL: 0, unrealizedPnL: 10.8,
  positions: [{ market: "KRW-XRP", quantity: 2, averageEntryPrice: 800, realizedPnL: 0, unrealizedPnL: 10.8, markPrice: 805.4 }],
  orders: [], fills: [fill("f1", 1_000)], processedIdempotencyKeys: [], updatedAt: 1_000, ...over,
});

test("the ledger fingerprint ignores mark-dependent values and changes with any ledger fact", () => {
  const base = paperLedgerFingerprint(state());
  assert.match(base.ledgerFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual({ ...base, ledgerFingerprintSha256: "x" }, { ledgerFingerprintSha256: "x", fillCount: 1, openPositionCount: 1, lastFillAt: 1_000, ledgerUpdatedAt: 1_000 });
  const marked = paperLedgerFingerprint(state({ equity: 9_000, unrealizedPnL: -999, positions: [{ ...state().positions[0], unrealizedPnL: -999, markPrice: 300 }] }));
  assert.equal(marked.ledgerFingerprintSha256, base.ledgerFingerprintSha256, "a price move is not a ledger change");
  for (const changed of [state({ cash: 8_399.3 }), state({ realizedPnL: 1 }), state({ fills: [fill("f1", 1_000), fill("f2", 2_000, "SELL")] }), state({ fills: [{ ...fill("f1", 1_000), fee: 0.9 }] }), state({ positions: [{ ...state().positions[0], quantity: 3 }] })]) {
    assert.notEqual(paperLedgerFingerprint(changed).ledgerFingerprintSha256, base.ledgerFingerprintSha256);
  }
  assert.equal(paperLedgerFingerprint(state({ fills: [fill("b", 5), fill("a", 5)] })).ledgerFingerprintSha256, paperLedgerFingerprint(state({ fills: [fill("a", 5), fill("b", 5)] })).ledgerFingerprintSha256, "fill order is canonical");
});

test("a real PAPER fill restored after a restart produces the identical ledger fingerprint", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-ledger-fingerprint-"));
  const path = join(directory, "state.sqlite");
  const tick = { now: 1_000, market: "KRW-BTC", price: 100, observedAt: 1_000, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", investmentPercent: 100, decisions: [{ symbol: "KRW-BTC", action: "BUY", allocation: 0.1, decidedAt: 999 }] };
  try {
    const db = new SqliteDatabase(path);
    const repository = new SqliteCloudPaperAccountRepository(db);
    const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, repository, readP0State: () => ({ openP0: false }) });
    assert.equal(loop.processTick(tick).status, "FILLED");
    repository.save(loop.snapshot());
    const before = paperLedgerFingerprint(loop.snapshot());
    assert.equal(before.fillCount, 1);
    repository.close();
    db.close();

    const reopenedDb = new SqliteDatabase(path);
    const reopened = new SqliteCloudPaperAccountRepository(reopenedDb);
    try {
      const restored = new PaperTradingExecutionLoop({ initialCapital: 1_000, repository: reopened, readP0State: () => ({ openP0: false }) });
      assert.deepEqual(paperLedgerFingerprint(restored.snapshot()), before);
    } finally { reopened.close(); reopenedDb.close(); }
  } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

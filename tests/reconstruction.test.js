const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const contracts = require("../dist/packages/contracts/src/index.js");
const storage = require("../dist/packages/storage/src/index.js");
const execution = require("../dist/apps/execution/src/index.js");
const { LedgerSide, PositionScopeType, PositionStatus, RiskDecisionType, RiskReasonCode } = contracts;

function createSystem(filename) {
  const db = new storage.SqliteDatabase(filename);
  const ledger = new storage.SqlitePositionLedgerRepository(db);
  const walletSnapshots = new storage.SqliteWalletPositionSnapshotRepository(db);
  const strategySnapshots = new storage.SqliteStrategyPositionSnapshotRepository(db);
  const markers = new storage.SqliteAppliedLedgerMarkerRepository(db);
  return {
    db, ledger, walletSnapshots, strategySnapshots, markers,
    wallet: new storage.WalletPositionSnapshotService(ledger, walletSnapshots, markers, db),
    strategy: new storage.StrategyPositionSnapshotService(ledger, strategySnapshots, markers, db)
  };
}

function entry(id, side, baseQtyRaw, quoteQtyRaw, ts = "2026-01-01T00:00:00.000Z", createdAt = ts, strategyId = "alpha") {
  return contracts.makePositionLedgerEntry({ id, walletId: "wallet-1", strategyId, symbol: "BTC-USDT", side, baseQtyRaw, quoteQtyRaw, ts, createdAt });
}

test("wallet buy opens a bigint position with raw average entry", () => {
  const s = createSystem();
  const snapshot = s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  assert.deepEqual({ base: snapshot.baseQtyRaw, cost: snapshot.quoteCostRaw, avg: snapshot.avgEntryPriceRaw, status: snapshot.status }, { base: 10n, cost: 100n, avg: 10n, status: PositionStatus.OPEN });
  s.db.close();
});

test("additional buy uses weighted raw cost basis", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  const snapshot = s.wallet.appendAndApply(entry("buy-2", LedgerSide.BUY, 10n, 300n, "2026-01-02T00:00:00.000Z"));
  assert.equal(snapshot.avgEntryPriceRaw, 20n);
  assert.equal(snapshot.quoteCostRaw, 400n);
  s.db.close();
});

test("partial sell proportionally releases cost and realizes pnl", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  const snapshot = s.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 4n, 60n, "2026-01-02T00:00:00.000Z"));
  assert.deepEqual({ base: snapshot.baseQtyRaw, cost: snapshot.quoteCostRaw, pnl: snapshot.realizedPnlRaw }, { base: 6n, cost: 60n, pnl: 20n });
  s.db.close();
});

test("full sell closes the position and clears average entry", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  const snapshot = s.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 10n, 90n, "2026-01-02T00:00:00.000Z"));
  assert.equal(snapshot.status, PositionStatus.CLOSED);
  assert.equal(snapshot.avgEntryPriceRaw, undefined);
  assert.equal(snapshot.realizedPnlRaw, -10n);
  s.db.close();
});

test("quote-less buy changes quantity without inventing a quote amount", () => {
  const s = createSystem();
  const snapshot = s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 5n, undefined));
  assert.equal(snapshot.baseQtyRaw, 5n);
  assert.equal(snapshot.quoteCostRaw, 0n);
  s.db.close();
});

test("quote-less sell releases cost without realizing proceeds", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  const snapshot = s.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 5n, undefined, "2026-01-02T00:00:00.000Z"));
  assert.equal(snapshot.quoteCostRaw, 50n);
  assert.equal(snapshot.realizedPnlRaw, 0n);
  s.db.close();
});

test("oversell rejects the whole atomic projection", () => {
  const s = createSystem();
  assert.throws(() => s.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 1n, 10n)), /oversell/);
  assert.equal(s.ledger.list().length, 0);
  assert.equal(s.walletSnapshots.list().length, 0);
  assert.equal(s.markers.list(PositionScopeType.WALLET, "wallet-1|BTC-USDT").length, 0);
  s.db.close();
});

test("closed position can reopen while retaining realized pnl history", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 1n, 10n));
  s.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 1n, 11n, "2026-01-02T00:00:00.000Z"));
  const snapshot = s.wallet.appendAndApply(entry("buy-2", LedgerSide.BUY, 2n, 30n, "2026-01-03T00:00:00.000Z"));
  assert.equal(snapshot.status, PositionStatus.OPEN);
  assert.equal(snapshot.realizedPnlRaw, 1n);
  assert.equal(snapshot.avgEntryPriceRaw, 15n);
  s.db.close();
});

test("strategy projection is isolated from its wallet projection", () => {
  const s = createSystem();
  const e = entry("buy-1", LedgerSide.BUY, 2n, 20n);
  s.wallet.appendAndApply(e);
  const strategySnapshot = s.strategy.applyLedgerEntry(e);
  assert.equal(strategySnapshot.strategyId, "alpha");
  assert.equal(s.walletSnapshots.get("wallet-1", "BTC-USDT").baseQtyRaw, 2n);
  s.db.close();
});

test("ledger reads preserve ts then createdAt then id order", () => {
  const s = createSystem();
  s.ledger.append(entry("z", LedgerSide.BUY, 1n, 1n, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.000Z"));
  s.ledger.append(entry("b", LedgerSide.BUY, 1n, 1n, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"));
  s.ledger.append(entry("a", LedgerSide.BUY, 1n, 1n, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"));
  assert.deepEqual(s.ledger.list().map(row => row.id), ["a", "b", "z"]);
  s.db.close();
});

test("ledger duplicate append returns the original single immutable record", () => {
  const s = createSystem();
  const e = entry("buy-1", LedgerSide.BUY, 1n, 1n);
  s.ledger.append(e); const stored = s.ledger.append(e);
  assert.equal(s.ledger.list().length, 1);
  assert.equal(Object.isFrozen(stored), true);
  s.db.close();
});

test("audit reads do not mutate persisted snapshots", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 1n, 10n));
  const before = s.walletSnapshots.get("wallet-1", "BTC-USDT");
  const audit = s.walletSnapshots.list();
  const after = s.walletSnapshots.get("wallet-1", "BTC-USDT");
  assert.deepEqual(audit[0], before);
  assert.deepEqual(after, before);
  assert.equal(Object.isFrozen(audit[0]), true);
  s.db.close();
});

test("applied marker records an applied ledger entry and its order key", () => {
  const s = createSystem();
  const e = entry("buy-1", LedgerSide.BUY, 1n, 10n);
  s.wallet.appendAndApply(e);
  assert.deepEqual(s.markers.list(PositionScopeType.WALLET, "wallet-1|BTC-USDT"), [{ ledgerEntryId: "buy-1", ledgerOrderKey: storage.ledgerKey(e) }]);
  s.db.close();
});

test("applied marker prevents duplicate snapshot projection", () => {
  const s = createSystem();
  const e = entry("buy-1", LedgerSide.BUY, 2n, 20n);
  const first = s.wallet.appendAndApply(e);
  const second = s.wallet.appendAndApply(e);
  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(second.baseQtyRaw, 2n);
  s.db.close();
});

test("applied marker rejects a lower ledger order after projection", () => {
  const s = createSystem();
  s.wallet.appendAndApply(entry("later", LedgerSide.BUY, 1n, 10n, "2026-01-02T00:00:00.000Z"));
  assert.throws(() => s.wallet.appendAndApply(entry("earlier", LedgerSide.BUY, 1n, 10n, "2026-01-01T00:00:00.000Z")), /marker order/);
  assert.equal(s.ledger.getById("earlier"), undefined);
  s.db.close();
});

test("rebuild is an explicit mutation that restores a missing projection", () => {
  const s = createSystem();
  s.ledger.append(entry("buy-1", LedgerSide.BUY, 3n, 30n));
  assert.equal(s.walletSnapshots.get("wallet-1", "BTC-USDT"), undefined);
  const rebuilt = s.wallet.rebuildFromLedger("wallet-1", "BTC-USDT");
  assert.equal(rebuilt.baseQtyRaw, 3n);
  assert.equal(s.markers.list(PositionScopeType.WALLET, "wallet-1|BTC-USDT").length, 1);
  s.db.close();
});

test("rebuild is deterministic across repeated explicit invocations", () => {
  const s = createSystem();
  s.ledger.append(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  s.ledger.append(entry("sell-1", LedgerSide.SELL, 5n, 60n, "2026-01-02T00:00:00.000Z"));
  const first = s.wallet.rebuildFromLedger("wallet-1", "BTC-USDT");
  const second = s.wallet.rebuildFromLedger("wallet-1", "BTC-USDT");
  assert.deepEqual(second, first);
  s.db.close();
});

test("transaction rollback preserves the original error identity", () => {
  const s = createSystem();
  const expected = new Error("expected rollback");
  assert.throws(() => s.db.transaction(() => { s.ledger.append(entry("buy-1", LedgerSide.BUY, 1n, 1n)); throw expected; }), error => error === expected);
  assert.equal(s.ledger.list().length, 0);
  s.db.close();
});

test("transaction commit persists its ledger write", () => {
  const s = createSystem();
  s.db.transaction(() => s.ledger.append(entry("buy-1", LedgerSide.BUY, 1n, 1n)));
  assert.equal(s.ledger.list().length, 1);
  s.db.close();
});

test("file-backed SQLite survives restart with ledger snapshot and marker intact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dokkaebi-recovery-"));
  const filename = path.join(directory, "positions.sqlite");
  const first = createSystem(filename);
  first.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  first.db.close();
  const restarted = createSystem(filename);
  assert.equal(restarted.ledger.list().length, 1);
  assert.equal(restarted.walletSnapshots.get("wallet-1", "BTC-USDT").baseQtyRaw, 10n);
  assert.equal(restarted.markers.list(PositionScopeType.WALLET, "wallet-1|BTC-USDT").length, 1);
  restarted.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("file-backed restart can continue the existing projection", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dokkaebi-continue-"));
  const filename = path.join(directory, "positions.sqlite");
  const first = createSystem(filename);
  first.wallet.appendAndApply(entry("buy-1", LedgerSide.BUY, 10n, 100n));
  first.db.close();
  const restarted = createSystem(filename);
  const snapshot = restarted.wallet.appendAndApply(entry("sell-1", LedgerSide.SELL, 4n, 60n, "2026-01-02T00:00:00.000Z"));
  assert.deepEqual({ base: snapshot.baseQtyRaw, pnl: snapshot.realizedPnlRaw, version: snapshot.version }, { base: 6n, pnl: 20n, version: 2 });
  restarted.db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("risk engine allows a compliant buy without storage access", () => {
  const decision = execution.evaluatePreTradeRisk({ position: { baseQtyRaw: 1n, realizedPnlRaw: 0n } }, { side: LedgerSide.BUY, baseQtyRaw: 1n, quoteQtyRaw: 10n }, { maxPositionBaseRaw: 2n, maxOrderQuoteRaw: 10n });
  assert.equal(decision.type, RiskDecisionType.ALLOW);
});

test("risk engine blocks an oversell", () => {
  const decision = execution.evaluatePreTradeRisk({ position: { baseQtyRaw: 1n, realizedPnlRaw: 0n } }, { side: LedgerSide.SELL, baseQtyRaw: 2n }, {});
  assert.equal(decision.reasonCode, RiskReasonCode.OVERSOLD);
});

test("risk engine blocks an order over its raw quote limit", () => {
  const decision = execution.evaluatePreTradeRisk({}, { side: LedgerSide.BUY, baseQtyRaw: 1n, quoteQtyRaw: 11n }, { maxOrderQuoteRaw: 10n });
  assert.equal(decision.reasonCode, RiskReasonCode.MAX_NOTIONAL_EXCEEDED);
});

test("risk engine blocks a buy over its raw position limit", () => {
  const decision = execution.evaluatePreTradeRisk({ position: { baseQtyRaw: 10n, realizedPnlRaw: 0n } }, { side: LedgerSide.BUY, baseQtyRaw: 1n }, { maxPositionBaseRaw: 10n });
  assert.equal(decision.reasonCode, RiskReasonCode.MAX_POSITION_QTY_EXCEEDED);
});

test("risk engine blocks once realized loss exceeds the raw loss limit", () => {
  const decision = execution.evaluatePreTradeRisk({ position: { baseQtyRaw: 1n, realizedPnlRaw: -11n } }, { side: LedgerSide.BUY, baseQtyRaw: 1n }, { maxRealizedLossRaw: 10n });
  assert.equal(decision.reasonCode, RiskReasonCode.MAX_LOSS_EXCEEDED);
});

test("disabled risk policy permits a sell even without a position", () => {
  const decision = execution.evaluatePreTradeRisk({}, { side: LedgerSide.SELL, baseQtyRaw: 1n }, { enabled: false });
  assert.equal(decision.type, RiskDecisionType.ALLOW);
});

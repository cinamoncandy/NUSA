import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import {
  LEGACY_PAPER_ACCOUNTING_MIGRATION_VERSION,
  projectLegacyRound8WeightedEntryPaperAccountingV1,
  projectPaperAccounting,
} from "./paperAccountingLedger";
import {
  SqliteCloudPaperAccountRepository,
  type PaperAccountState,
  type PaperFillRecord,
  type PaperOrderRecord,
} from "./paperTradingExecutionLoop";

const INITIAL_CAPITAL = 10_000_000;
const round8 = (value: number): number => Number(value.toFixed(8));
const checksum = (state: PaperAccountState): string =>
  createHash("sha256").update(JSON.stringify(state), "utf8").digest("hex");

const fills: readonly PaperFillRecord[] = Object.freeze([
  Object.freeze({ id: "fill:doge:buy", orderId: "order:doge:buy", market: "KRW-DOGE", side: "BUY", quantity: 8415.25423729, price: 118, fee: 496.5, filledAt: 1788611616572 }),
  Object.freeze({ id: "fill:sol:buy:1", orderId: "order:sol:buy:1", market: "KRW-SOL", side: "BUY", quantity: 5.99180052, price: 143700, fee: 430.51086736, filledAt: 1788678404051 }),
  Object.freeze({ id: "fill:doge:sell", orderId: "order:doge:sell", market: "KRW-DOGE", side: "SELL", quantity: 8415.25423729, price: 121, fee: 509.12288136, filledAt: 1788701429640 }),
  Object.freeze({ id: "fill:sol:buy:2", orderId: "order:sol:buy:2", market: "KRW-SOL", side: "BUY", quantity: 5.98542086, price: 143900, fee: 430.65103088, filledAt: 1788735506439 }),
  Object.freeze({ id: "fill:sol:sell", orderId: "order:sol:sell", market: "KRW-SOL", side: "SELL", quantity: 11.97722138, price: 143300, fee: 858.16791188, filledAt: 1788743371892 }),
]);

function orderFor(fill: PaperFillRecord): PaperOrderRecord {
  return Object.freeze({
    id: fill.orderId,
    idempotencyKey: `idem:${fill.orderId}`,
    market: fill.market,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    status: "FILLED" as const,
    createdAt: fill.filledAt,
    filledAt: fill.filledAt,
  });
}

function buildLegacyState(prefix: readonly PaperFillRecord[]): PaperAccountState {
  const marks: Record<string, number> = {};
  for (const fill of prefix) marks[fill.market] = fill.price;
  const projection = projectLegacyRound8WeightedEntryPaperAccountingV1(INITIAL_CAPITAL, prefix, marks);
  const unrealizedPnL = round8(projection.positions.reduce((sum, position) => sum + position.unrealizedPnL, 0));
  const equity = round8(projection.cash + projection.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0));
  return Object.freeze({
    version: 1 as const,
    initialCapital: INITIAL_CAPITAL,
    cash: projection.cash,
    equity,
    realizedPnL: projection.realizedPnL,
    unrealizedPnL,
    positions: projection.positions,
    orders: Object.freeze(prefix.map(orderFor).reverse()),
    fills: Object.freeze([...prefix].reverse()),
    processedIdempotencyKeys: Object.freeze(prefix.map((fill) => `idem:${fill.orderId}`).reverse()),
    updatedAt: prefix.at(-1)!.filledAt,
  });
}

test("legacy round8 PAPER account migrates exactly once into canonical durable fill truth", () => {
  const db = new SqliteDatabase(":memory:");
  const states = fills.map((_, index) => buildLegacyState(fills.slice(0, index + 1)));
  const source = states.at(-1)!;
  assert.equal(source.cash, 10016532.83729639);
  assert.equal(source.realizedPnL, 16532.83729634);

  const insertHistory = db.connection.prepare(`
    INSERT INTO cloud_paper_account_history(account_id,schema_version,updated_at,state_json,checksum)
    VALUES('paper-default',1,?,?,?)
  `);
  for (const state of states) insertHistory.run(state.updatedAt, JSON.stringify(state), checksum(state));
  db.connection.prepare(`
    INSERT INTO cloud_paper_accounts(account_id,schema_version,updated_at,state_json,checksum,status)
    VALUES('paper-default',1,?,?,?,'CORRUPTED')
  `).run(source.updatedAt, JSON.stringify(source), checksum(source));

  const now = source.updatedAt + 1_000;
  const repository = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "legacy-recovery-1",
    now: () => now,
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 10_000,
  });
  const migrated = repository.loadLatest()!;
  const canonical = projectPaperAccounting(
    INITIAL_CAPITAL,
    fills,
    Object.fromEntries(source.positions.map((position) => [position.market, position.markPrice])),
  );
  assert.equal(migrated.cash, source.cash);
  assert.equal(migrated.cash, canonical.cash);
  assert.equal(migrated.realizedPnL, canonical.realizedPnL);
  assert.notEqual(migrated.realizedPnL, source.realizedPnL);
  assert.deepEqual(migrated.positions, canonical.positions);
  assert.equal(repository.loadFills().length, 5);
  assert.equal(repository.loadHistory().length, 6);

  const receipt = db.connection.prepare(`
    SELECT migration_version,source_checksum,fill_count,canonical_ledger_fingerprint,migrated_account_checksum,receipt_json,receipt_checksum
    FROM cloud_paper_legacy_reconciliation_receipts
    WHERE account_id='paper-default'
  `).get() as Record<string, string | number>;
  assert.equal(receipt.migration_version, LEGACY_PAPER_ACCOUNTING_MIGRATION_VERSION);
  assert.equal(receipt.source_checksum, checksum(source));
  assert.equal(Number(receipt.fill_count), 5);
  assert.equal(receipt.canonical_ledger_fingerprint, canonical.fingerprintSha256);
  assert.equal(receipt.migrated_account_checksum, checksum(migrated));
  assert.equal(
    receipt.receipt_checksum,
    createHash("sha256").update(String(receipt.receipt_json), "utf8").digest("hex"),
  );
  repository.close();

  const replay = new SqliteCloudPaperAccountRepository(db, {
    ownerId: "legacy-recovery-2",
    now: () => now + 1_000,
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 10_000,
  });
  assert.deepEqual(replay.loadLatest(), migrated);
  assert.equal(replay.loadFills().length, 5);
  assert.equal(Number((db.connection.prepare(
    "SELECT COUNT(*) AS count FROM cloud_paper_legacy_reconciliation_receipts WHERE account_id='paper-default'"
  ).get() as { count: number | bigint }).count), 1);
  assert.equal(replay.loadHistory().length, 6);
  replay.close();
  db.close();
});

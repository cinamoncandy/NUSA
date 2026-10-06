const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { SqliteDatabase, SqliteResearchCandleStore, ResearchCandleStoreError } = require("../dist/packages/storage/src/index.js");

const M = 60_000;
const candle = (n, o = 100, h = 110, l = 95, c = 105) => ({ closeTimeMs: (10 + n) * M, open: o, high: h, low: l, close: c });
const open = (max) => {
  const db = new SqliteDatabase(join(mkdtempSync(join(tmpdir(), "nusa-candles-")), "c.db"));
  return { db, store: new SqliteResearchCandleStore(db, max) };
};

test("migration 026 creates the table and the store records and reads candles in order", () => {
  const { db, store } = open();
  assert.equal(db.migrationResult.currentVersion, "027_research_holdout_usage");
  assert.equal(store.append("KRW-BTC", M, [candle(2), candle(0), candle(1)]), 3);
  assert.deepEqual(store.read("KRW-BTC", M, 0, 99 * M).map((c) => c.closeTimeMs), [10 * M, 11 * M, 12 * M]);
  assert.deepEqual(store.read("KRW-BTC", M, 11 * M, 11 * M).map((c) => c.closeTimeMs), [11 * M]);
  assert.equal(store.earliestCloseTime("KRW-BTC", M), 10 * M);
  assert.equal(store.earliestCloseTime("KRW-ETH", M), undefined);
  assert.equal(store.count("KRW-BTC", M), 3);
  db.close();
});

test("appending the same candle again is a no-op; a different candle for the same key is a conflict", () => {
  const { db, store } = open();
  store.append("KRW-BTC", M, [candle(0)]);
  assert.equal(store.append("KRW-BTC", M, [candle(0)]), 0);
  assert.throws(() => store.append("KRW-BTC", M, [candle(0, 100, 111, 95, 105)]), (e) => e instanceof ResearchCandleStoreError && e.code === "CANDLE_CONFLICT");
  assert.equal(store.count("KRW-BTC", M), 1);
  db.close();
});

test("a batch with any invalid candle writes nothing", () => {
  const { db, store } = open();
  const bad = [candle(0), candle(1, 100, 90, 95, 105)]; // high below open/close
  assert.throws(() => store.append("KRW-BTC", M, bad), (e) => e instanceof ResearchCandleStoreError && e.code === "INVALID_CANDLE");
  assert.equal(store.count("KRW-BTC", M), 0);
  for (const invalid of [{ ...candle(0), closeTimeMs: 10 * M + 1 }, { ...candle(0), open: 0 }, { ...candle(0), close: NaN }, { ...candle(0), low: -1 }, { ...candle(0), closeTimeMs: 0 }]) {
    assert.throws(() => store.append("KRW-BTC", M, [invalid]), ResearchCandleStoreError);
  }
  assert.throws(() => store.append("BTC-KRW", M, [candle(0)]), (e) => e.code === "INVALID_MARKET");
  assert.throws(() => store.append("KRW-BTC", 10, [candle(0)]), (e) => e.code === "INVALID_INTERVAL");
  assert.equal(store.count("KRW-BTC", M), 0);
  db.close();
});

test("retention keeps the newest candles per market and does not touch other markets", () => {
  const { db, store } = open(3);
  store.append("KRW-BTC", M, [candle(0), candle(1), candle(2), candle(3), candle(4)]);
  store.append("KRW-ETH", M, [candle(0)]);
  assert.deepEqual(store.read("KRW-BTC", M, 0, 99 * M).map((c) => c.closeTimeMs), [12 * M, 13 * M, 14 * M]);
  assert.equal(store.count("KRW-ETH", M), 1);
  assert.throws(() => new SqliteResearchCandleStore(db, 1), ResearchCandleStoreError);
  db.close();
});

test("a corrupted stored row is detected on read", () => {
  const { db, store } = open();
  store.append("KRW-BTC", M, [candle(0)]);
  db.connection.prepare("UPDATE research_closed_candles SET high = 999 WHERE market = ?").run("KRW-BTC");
  assert.throws(() => store.read("KRW-BTC", M, 0, 99 * M), (e) => e instanceof ResearchCandleStoreError && e.code === "CANDLE_CHECKSUM_MISMATCH");
  db.close();
});

test("read rejects an invalid window and an invalid market", () => {
  const { db, store } = open();
  assert.throws(() => store.read("KRW-BTC", M, 5, 1), (e) => e.code === "INVALID_WINDOW");
  assert.throws(() => store.read("nope", M, 1, 5), (e) => e.code === "INVALID_MARKET");
  db.close();
});

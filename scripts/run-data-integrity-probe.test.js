"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { probe } = require("./run-data-integrity-probe.js");

const M = 60_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, open REAL, high REAL, low REAL, close REAL, checksum TEXT, PRIMARY KEY (market, interval_ms, close_time_ms));
    CREATE TABLE research_orderbook_samples (market TEXT, captured_at_ms INTEGER, best_bid REAL, best_ask REAL, bid_size_5 REAL, ask_size_5 REAL, total_bid_size REAL, total_ask_size REAL, PRIMARY KEY (market, captured_at_ms));
    CREATE TABLE research_trade_ticks_v2 (market TEXT, traded_at_ms INTEGER, price REAL, volume REAL, side TEXT, PRIMARY KEY (market, traded_at_ms, price, volume, side));`);
  const candle = d.prepare("INSERT INTO research_closed_candles VALUES (?, ?, ?, 100, 101, 99, 100, 'c')");
  for (let k = 0; k < 120; k += 1) candle.run("KRW-BTC", M, NOW - 60 * M - k * M);
  d.prepare("INSERT INTO research_orderbook_samples VALUES ('KRW-ETH', ?, 10, 11, 1, 1, 1, 1)").run(NOW - M);
  d.prepare("INSERT INTO research_trade_ticks_v2 VALUES ('KRW-BTC', ?, 100, 1, 'BID')").run(NOW - M);
  return d;
}

test("a complete, current series with no future rows passes", () => {
  const d = db();
  const add = d.prepare("INSERT INTO research_closed_candles VALUES ('KRW-BTC', ?, ?, 100, 101, 99, 100, 'c')");
  for (let k = 1; k < 60; k += 1) add.run(M, NOW - k * M);
  assert.equal(probe({ db: d, now: NOW }).status, "PASS");
});

test("clean recent data passes except for a stale 1-minute series, which warns", () => {
  const d = db();
  const r = probe({ db: d, now: NOW });
  assert.equal(r.status, "WARN", "the newest candle is 60 minutes old");
  assert.equal(r.candleStaleSeries, 1);
  assert.equal(r.candleMissing7d, 0);
  assert.equal(r.candleRows7d, 120);
  assert.equal(r.orderBookMarkets24h, 1);
  assert.equal(r.tradeRows24h, 1);
  d.prepare("INSERT INTO research_closed_candles VALUES ('KRW-BTC', ?, ?, 100, 101, 99, 100, 'c')").run(M, NOW - M);
  assert.equal(probe({ db: d, now: NOW }).candleMissing7d, 58, "the 58 minutes between the old series and the new candle are missing");
});

test("gaps warn; future, misaligned, inconsistent and crossed rows fail", () => {
  const d = db();
  d.prepare("DELETE FROM research_closed_candles WHERE close_time_ms = ?").run(NOW - 100 * M);
  assert.equal(probe({ db: d, now: NOW }).candleMissing7d, 1);
  for (const [sql, field] of [
    ["INSERT INTO research_closed_candles VALUES ('KRW-X', 60000, " + (NOW + 10 * M) + ", 1, 1, 1, 1, 'c')", "candleFuture"],
    ["INSERT INTO research_closed_candles VALUES ('KRW-Y', 60000, " + (NOW - 30_001) + ", 1, 1, 1, 1, 'c')", "candleMisaligned"],
    ["INSERT INTO research_closed_candles VALUES ('KRW-Z', 60000, " + (NOW - 2 * M) + ", 5, 4, 1, 3, 'c')", "candleInvalidOhlc"],
    ["INSERT INTO research_orderbook_samples VALUES ('KRW-Q', " + (NOW - M) + ", 12, 11, 1, 1, 1, 1)", "orderBookCrossed"],
    ["INSERT INTO research_trade_ticks_v2 VALUES ('KRW-Q', " + (NOW + 10 * M) + ", 1, 1, 'ASK')", "tradeFuture"],
  ]) {
    const fresh = db();
    fresh.exec(sql);
    const r = probe({ db: fresh, now: NOW });
    assert.equal(r.status, "FAIL", field);
    assert.equal(r[field], 1, field);
  }
});

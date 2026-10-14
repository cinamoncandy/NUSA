"use strict";
/**
 * Read-only runtime evidence of the stored public-market research data (WO-DATA-20261014-INTEGRITY-PROBE). Runs on the PAPER host
 * inside the daily nusa-research service, opens NUSA_CLOUD_STATE_DB_PATH READ-ONLY and prints one line:
 *   DATA_INTEGRITY {"status":"PASS"|"WARN"|"FAIL", ...integer fields}
 * FAIL: a stored row is stamped in the future, a candle close time is not aligned to its interval, or a candle's OHLC is
 * inconsistent. WARN: missing candles in the last 7 days or a 1-minute series older than 10 minutes. It is evidence about the data
 * only: it changes nothing, gates nothing and grants nothing.
 */
const M = 60_000;
const DAY = 24 * 60 * M;
const FUTURE_SKEW_MS = 5_000;

function probe({ db, now = Date.now() }) {
  const since = now - 7 * DAY;
  const one = (sql, ...args) => Number(Object.values(db.prepare(sql).get(...args))[0] ?? 0);
  const series = db.prepare("SELECT market, interval_ms AS i, COUNT(*) AS n, MIN(close_time_ms) AS a, MAX(close_time_ms) AS b FROM research_closed_candles WHERE close_time_ms > ? GROUP BY market, interval_ms").all(since);
  let candleMissing = 0; let staleSeries = 0; let maxLatestAgeMs = 0;
  for (const s of series) {
    const expected = Math.floor((Number(s.b) - Number(s.a)) / Number(s.i)) + 1;
    candleMissing += Math.max(0, expected - Number(s.n));
    if (Number(s.i) === M) {
      const age = now - Number(s.b);
      maxLatestAgeMs = Math.max(maxLatestAgeMs, age);
      if (age > 10 * M) staleSeries += 1;
    }
  }
  const out = {
    candleSeries: series.length,
    candleRows7d: series.reduce((sum, s) => sum + Number(s.n), 0),
    candleMissing7d: candleMissing,
    candleMisaligned: one("SELECT COUNT(*) FROM research_closed_candles WHERE close_time_ms % interval_ms <> 0"),
    candleInvalidOhlc: one("SELECT COUNT(*) FROM research_closed_candles WHERE high < open OR high < close OR low > open OR low > close OR low > high"),
    candleFuture: one("SELECT COUNT(*) FROM research_closed_candles WHERE close_time_ms > ?", now + FUTURE_SKEW_MS),
    candleStaleSeries: staleSeries,
    candleMaxLatestAgeMs: maxLatestAgeMs,
    orderBookMarkets24h: one("SELECT COUNT(DISTINCT market) FROM research_orderbook_samples WHERE captured_at_ms > ?", now - DAY),
    orderBookRows24h: one("SELECT COUNT(*) FROM research_orderbook_samples WHERE captured_at_ms > ?", now - DAY),
    orderBookCrossed: one("SELECT COUNT(*) FROM research_orderbook_samples WHERE best_bid > best_ask"),
    orderBookFuture: one("SELECT COUNT(*) FROM research_orderbook_samples WHERE captured_at_ms > ?", now + FUTURE_SKEW_MS),
    tradeRows24h: one("SELECT COUNT(*) FROM research_trade_ticks_v2 WHERE traded_at_ms > ?", now - DAY),
    tradeFuture: one("SELECT COUNT(*) FROM research_trade_ticks_v2 WHERE traded_at_ms > ?", now + FUTURE_SKEW_MS),
  };
  const fail = out.candleMisaligned + out.candleInvalidOhlc + out.candleFuture + out.orderBookCrossed + out.orderBookFuture + out.tradeFuture > 0;
  const warn = out.candleMissing7d + out.candleStaleSeries > 0;
  return { status: fail ? "FAIL" : warn ? "WARN" : "PASS", ...out };
}

module.exports = { probe };

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { console.log("DATA_INTEGRITY", JSON.stringify(probe({ db }))); } finally { db.close(); }
  } catch { console.error("DATA_INTEGRITY_FAILED_CLOSED"); process.exitCode = 1; }
}

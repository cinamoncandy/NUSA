"use strict";
/**
 * Read-only extent of the stored 1-minute candle history of the five research markets (WO-LEARNING-20261120-CANDLE-EXTENT-PROBE).
 * Runs on the PAPER host inside the nusa-research service, opens NUSA_CLOUD_STATE_DB_PATH READ-ONLY and prints one line:
 *   CANDLE_EXTENT {"status":"OK", "<MKT>Rows", "<MKT>FirstMs", "<MKT>LastMs", "<MKT>AbsentMinutes", "<MKT>MissingMinutes" for BTC, DOGE, ETH, SOL, XRP}
 * Counts and close times only: **no candle value is read** (the query selects close_time_ms and nothing else, so reserved spans of the pre-registered
 * studies stay unread). Rows after 2026-11-20T00:00Z are counted but their values are never selected. It changes nothing, gates nothing, grants nothing.
 * MissingMinutes = minutes between the first and the last stored close that are neither stored nor proven exchange-absent.
 */
const M = 60_000;
const MARKETS = Object.freeze(["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"]);

function probe(db) {
  const out = { status: "OK" };
  for (const market of MARKETS) {
    const code = market.slice(4);
    const row = db.prepare("SELECT COUNT(*) AS n, MIN(close_time_ms) AS a, MAX(close_time_ms) AS b FROM research_closed_candles WHERE market = ? AND interval_ms = ?").get(market, M);
    const rows = Number(row.n); const first = rows === 0 ? 0 : Number(row.a); const last = rows === 0 ? 0 : Number(row.b);
    let absent = 0;
    if (rows > 0) {
      for (const r of db.prepare("SELECT first_absent_close_ms AS a, last_absent_close_ms AS b FROM research_candle_absence WHERE market = ? AND interval_ms = ? AND last_absent_close_ms >= ? AND first_absent_close_ms <= ?").iterate(market, M, first, last)) {
        absent += Math.floor((Math.min(Number(r.b), last) - Math.max(Number(r.a), first)) / M) + 1;
      }
    }
    const span = rows === 0 ? 0 : Math.floor((last - first) / M) + 1;
    out[`${code}Rows`] = rows; out[`${code}FirstMs`] = first; out[`${code}LastMs`] = last; out[`${code}AbsentMinutes`] = absent; out[`${code}MissingMinutes`] = Math.max(0, span - rows - absent);
  }
  return out;
}

module.exports = { probe, MARKETS };

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { console.log("CANDLE_EXTENT", JSON.stringify(probe(db))); } finally { db.close(); }
  } catch { console.error("CANDLE_EXTENT_FAILED_CLOSED"); process.exitCode = 1; }
}

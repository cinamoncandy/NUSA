"use strict";
/**
 * The order-book rows live in research_orderbook_samples (the collector keeps about 14 days) and, once the collector prunes them,
 * only the rows the studies read live on in research_orderbook_study_rows (migration 032). A study reads both as ONE source, by
 * index. A database without the archive table (before that migration) has only the live table.
 */
function orderBookSource(db) {
  const columns = "market, captured_at_ms, best_bid, best_ask, bid_size_5, ask_size_5, total_bid_size, total_ask_size";
  const hasArchive = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_orderbook_study_rows'").get() != null;
  return hasArchive ? `(SELECT ${columns} FROM research_orderbook_samples UNION ALL SELECT ${columns} FROM research_orderbook_study_rows)` : "research_orderbook_samples";
}

module.exports = { orderBookSource };

"use strict";
/**
 * Runner for the pre-registered studies S2, S3 and S4 (docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md). Opens the PAPER
 * host state database READ-ONLY, builds a book provider over research_orderbook_samples (one row per minute: the last sample of each
 * minute, as in scripts/run-orderbook-study.js) and prints one line per study:
 *   PREREG_STUDY {"study":"S2"|"S3"|"S4","status":"WAITING_DATA"|"INSUFFICIENT_DATA"|"HOLDOUT_PASS"|"HOLDOUT_FAIL"|"DATA_INTEGRITY_FAIL", ...numbers}
 * It places no order, writes nothing, and its result is research evidence only. The rules live in scripts/lib/dailyCrossSectionStudy.js.
 */
const crypto = require("node:crypto");
const { runDailyStudy, constants } = require("./lib/dailyCrossSectionStudy.js");
const { runMakerStudy } = require("./lib/makerExecutionStudy.js");
const { assertDesignFrozen } = require("./lib/preregisteredDesign.js");
const M = constants.M;

/**
 * Provider over the sample table that asks the database for exactly the window each rule needs (the table is indexed by market and time),
 * so memory stays small even with ~300 markets x 53 days. Every row actually returned is remembered and hashed at the end, so the dataset
 * identity is the data the study really consumed. Rows are coerced to numbers and anything crossed or non-positive is not a book.
 */
/**
 * The book rows live in research_orderbook_samples (about 14 days) and, after the collector prunes them, only the rows the studies read
 * live on in research_orderbook_study_rows (migration 032). Read both as one source; before that migration only the live table exists.
 */
function bookSource(db) {
  const cols = "market, captured_at_ms, best_bid, best_ask, bid_size_5, ask_size_5";
  const hasArchive = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_orderbook_study_rows'").get() != null;
  return hasArchive ? `(SELECT ${cols} FROM research_orderbook_samples UNION ALL SELECT ${cols} FROM research_orderbook_study_rows)` : "research_orderbook_samples";
}

function makeDbProvider(db, { from, to }) {
  const source = bookSource(db);
  const marketList = db.prepare(`SELECT DISTINCT market FROM ${source} WHERE captured_at_ms > ? AND captured_at_ms <= ? AND market LIKE 'KRW-%'`).all(from, to).map((r) => String(r.market)).sort();
  const latest = db.prepare(`SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a, bid_size_5 AS b5, ask_size_5 AS a5 FROM ${source} WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms DESC LIMIT 1`);
  const lastBid = db.prepare(`SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a, bid_size_5 AS b5, ask_size_5 AS a5 FROM ${source} WHERE market = ? AND captured_at_ms >= ? AND captured_at_ms <= ? ORDER BY captured_at_ms DESC LIMIT 1`);
  const between = db.prepare(`SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a, bid_size_5 AS b5, ask_size_5 AS a5 FROM ${source} WHERE market = ? AND captured_at_ms >= ? AND captured_at_ms < ? ORDER BY captured_at_ms`);
  const consumed = new Map(); // "market,stamp" -> canonical line
  const clean = (market, raw) => {
    if (raw == null) return undefined;
    const r = { t: Number(raw.t), b: Number(raw.b), a: Number(raw.a), b5: Number(raw.b5), a5: Number(raw.a5) };
    if (![r.t, r.b, r.a, r.b5, r.a5].every(Number.isFinite) || !(r.b > 0) || !(r.a >= r.b)) return undefined;
    consumed.set(`${market},${r.t}`, `${market},${r.t},${r.b},${r.a},${r.b5},${r.a5}`);
    return r;
  };
  const bookCache = new Map();
  const bookAt = (market, t) => {
    const key = `${market}|${t}`;
    if (bookCache.has(key)) return bookCache.get(key);
    const r = clean(market, latest.get(market, t - 2 * M, t));
    bookCache.set(key, r);
    return r;
  };
  // Latest valid snapshot in (fromExclusive, toInclusive]; an invalid latest snapshot means no book (no look-back). Study S5 reads (t+13m, t+15m].
  const bookIn = (market, fromExclusive, toInclusive) => clean(market, latest.get(market, fromExclusive, toInclusive));
  const lastBidBetween = (market, fromMs, toMs) => clean(market, lastBid.get(market, fromMs, toMs))?.b;
  // UNION ALL can in principle return the same (market, stamp) from both tables; one snapshot counts once toward the 5-snapshot rule.
  const booksBetween = (market, fromMs, toMs) => {
    const seen = new Set(), out = [];
    for (const raw of between.all(market, fromMs, toMs)) {
      const r = clean(market, raw);
      if (r != null && !seen.has(r.t)) { seen.add(r.t); out.push({ t: r.t, b: r.b, a: r.a }); }
    }
    return out;
  };
  const hashRows = () => {
    const hash = crypto.createHash("sha256");
    for (const key of [...consumed.keys()].sort()) hash.update(`${consumed.get(key)}\n`);
    return { sha256: hash.digest("hex"), rows: consumed.size };
  };
  return { markets: () => marketList, bookAt, bookIn, lastBidBetween, booksBetween, hashRows };
}

function runAll({ db, now = Date.now(), frozen = assertDesignFrozen }) {
  frozen(); // refuses to run while the design hash is PENDING or the design/addenda bytes changed
  const { TRAIN_START, HOLD_END, PRINT_AT } = constants;
  if (now < PRINT_AT) return ["S2", "S3", "S4"].map((study) => ({ study, status: "WAITING_DATA" }));
  // Any stored row stamped after the run time (beyond 5 s) means the clock or the source cannot be trusted.
  if (Number(db.prepare(`SELECT COUNT(*) AS n FROM ${bookSource(db)} WHERE captured_at_ms > ?`).get(now + 5_000).n) > 0) return ["S2", "S3", "S4"].map((study) => ({ study, status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" }));
  const provider = makeDbProvider(db, { from: TRAIN_START - 5 * 3_600_000, to: HOLD_END + 2 * 3_600_000 });
  const results = [runDailyStudy({ provider, study: "S2", now }), runMakerStudy({ provider, now }), runDailyStudy({ provider, study: "S4", now })];
  const identity = provider.hashRows();
  return results.map((r) => ({ ...r, datasetSha256: identity.sha256, datasetRows: identity.rows }));
}

if (require.main === module) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const path = String(process.env.NUSA_CLOUD_STATE_DB_PATH || "");
    if (!path.startsWith("/")) throw new Error("state path");
    const db = new DatabaseSync(path, { readOnly: true });
    try { for (const result of runAll({ db })) console.log("PREREG_STUDY", JSON.stringify(result)); } finally { db.close(); }
  } catch { console.error("PREREG_STUDY_FAILED_CLOSED"); process.exitCode = 1; }
}

module.exports = { makeDbProvider, runAll, bookSource };

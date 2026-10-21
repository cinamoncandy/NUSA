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
const M = constants.M;

/** Provider over the sample table. Rows of one market are loaded once, down-sampled to one per minute, and held for the run. */
function makeDbProvider(db, { from, to }) {
  const marketList = db.prepare("SELECT DISTINCT market FROM research_orderbook_samples WHERE captured_at_ms > ? AND captured_at_ms <= ?").all(from, to).map((r) => r.market).sort();
  const cache = new Map();
  const load = (market) => {
    let series = cache.get(market);
    if (series == null) {
      series = new Map();
      const stmt = db.prepare("SELECT captured_at_ms AS t, best_bid AS b, best_ask AS a, bid_size_5 AS b5, ask_size_5 AS a5 FROM research_orderbook_samples WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms");
      for (const r of stmt.iterate(market, from, to)) series.set(Math.floor(r.t / M), r);
      cache.set(market, series);
    }
    return series;
  };
  const bookAt = (market, t) => {
    const series = load(market);
    for (const minute of [Math.floor(t / M), Math.floor(t / M) - 1]) {
      const r = series.get(minute);
      if (r != null && r.t <= t && r.t > t - 2 * M && Number.isFinite(r.b) && Number.isFinite(r.a) && r.b > 0 && r.a >= r.b) return r;
    }
    return undefined;
  };
  const lastBidBetween = (market, fromMs, toMs) => {
    const series = load(market);
    for (let minute = Math.floor(toMs / M); minute >= Math.floor(fromMs / M); minute -= 1) {
      const r = series.get(minute);
      if (r != null && r.t >= fromMs && r.t <= toMs && r.b > 0) return r.b;
    }
    return undefined;
  };
  const booksBetween = (market, fromMs, toMs) => {
    const series = load(market), out = [];
    for (let minute = Math.floor(fromMs / M); minute <= Math.floor(toMs / M); minute += 1) {
      const r = series.get(minute);
      if (r != null && r.t >= fromMs && r.t < toMs && r.b > 0 && r.a >= r.b) out.push({ t: r.t, b: r.b, a: r.a });
    }
    return out;
  };
  return { markets: () => marketList, bookAt, lastBidBetween, booksBetween, hashRows: () => hashOf(cache) };
}

/** sha256 of the rows actually loaded, canonical lines sorted by (market, stamp). */
function hashOf(cache) {
  const hash = crypto.createHash("sha256");
  let rows = 0;
  for (const market of [...cache.keys()].sort()) {
    for (const minute of [...cache.get(market).keys()].sort((x, y) => x - y)) {
      const r = cache.get(market).get(minute);
      hash.update(`${market},${r.t},${r.b},${r.a},${r.b5},${r.a5}\n`); rows += 1;
    }
  }
  return { sha256: hash.digest("hex"), rows };
}

function runAll({ db, now = Date.now() }) {
  const { TRAIN_START, HOLD_END, PRINT_AT } = constants;
  if (now < PRINT_AT) return ["S2", "S3", "S4"].map((study) => ({ study, status: "WAITING_DATA" }));
  // Any stored row stamped after the run time (beyond 5 s) means the clock or the source cannot be trusted.
  if (Number(db.prepare("SELECT COUNT(*) AS n FROM research_orderbook_samples WHERE captured_at_ms > ?").get(now + 5_000).n) > 0) return ["S2", "S3", "S4"].map((study) => ({ study, status: "DATA_INTEGRITY_FAIL", reasonCode: "DATA_FUTURE" }));
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

module.exports = { makeDbProvider, runAll };

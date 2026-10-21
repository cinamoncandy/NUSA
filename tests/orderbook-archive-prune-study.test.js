const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteMarketMicrostructureStore } = require("../dist/packages/storage/src/marketMicrostructureStore.js");
const { runStudy, START, END } = require("../scripts/run-orderbook-study.js");

const M = 60_000;
const MARKETS = 6;

/** A real migrated database filled with one book per minute for each market over the study's whole span. */
function buildDb(dir, name) {
  const db = new SqliteDatabase(join(dir, name));
  const store = new SqliteMarketMicrostructureStore(db);
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let m = 0; m < MARKETS; m += 1) {
    let price = 1000 + m * 10;
    const rows = [];
    for (let t = START - 5 * 3_600_000; t <= END + 3_600_000; t += M) {
      price *= 1 + (rand() - 0.5) * 0.002;
      rows.push({ market: `KRW-M${m}`, sample: { capturedAtMs: t, bestBid: price * 0.9998, bestAsk: price * 1.0002, bidSize5: 1 + rand(), askSize5: 1 + rand(), totalBidSize: 10 + rand(), totalAskSize: 10 + rand() } });
    }
    for (let i = 0; i < rows.length; i += 5000) store.appendOrderBookRound(rows.slice(i, i + 5000));
  }
  return { db, store };
}

test("the pre-registered study returns the same numbers after the REAL collector prune moved old books into the archive, and not without it", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusa-archive-"));
  const full = buildDb(dir, "full.db"), pruned = buildDb(dir, "pruned.db"), lossy = buildDb(dir, "lossy.db");
  try {
    const now = END + 3 * 3_600_000;
    const read = (h) => runStudy({ db: h.db.connection, now });
    const expected = read(full);
    assert.match(expected.status, /^HOLDOUT_(PASS|FAIL)$/, JSON.stringify(expected));
    const markets = Array.from({ length: MARKETS }, (_, m) => `KRW-M${m}`);
    const cutoff = START + 6 * 86_400_000; // everything before day 6 is "older than 14 days"
    let deleted = 0, guard = 0;
    for (let n = -1; n !== 0 && guard < 30; guard += 1) { n = pruned.store.pruneOrderBookSamplesBefore(markets, cutoff); deleted += n; }
    assert.ok(deleted > 6 * 24 * 60 * MARKETS * 0.9, `the real prune removed the old per-minute rows (${deleted})`);
    assert.ok(guard > 2, "a multi-day backlog took several one-day-per-market calls");
    const comparable = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !["datasetFingerprint", "datasetRows", "datasetFirstAt", "datasetLastAt"].includes(k)));
    assert.deepEqual(comparable(read(pruned)), comparable(expected), "same eligibility, same trades, same verdict numbers");
    lossy.db.connection.prepare("DELETE FROM research_orderbook_samples WHERE captured_at_ms < ?").run(cutoff);
    assert.notDeepEqual(comparable(read(lossy)), comparable(expected), "pruning without the archive changes the study: that is the defect the archive fixes");
  } finally { full.db.close(); pruned.db.close(); lossy.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

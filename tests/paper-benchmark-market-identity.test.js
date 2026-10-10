const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase, SqlitePaperMarketObservationRepository } = require("../dist/packages/storage/src/index.js");
const { readCanonicalPaperTickerBenchmark } = require("../dist/apps/cloud/src/paperMarketBenchmark.js");

// Root cause of the 2026-10-07 learning-period close failure: the runtime streams only KRW-XRP (owner markets
// file, 2026-10-03), so a period bound to KRW-BTC finds no ticker evidence in its window and can never close.
test("a period bound to a market with no stored ticker evidence has no benchmark, while the streamed market does", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqlitePaperMarketObservationRepository(db);
  const start = Date.UTC(2026, 9, 6, 3, 0, 0);
  for (let i = 0; i < 5; i += 1) repository.append({ market: "KRW-XRP", observedAt: start + i * 60_000, price: 800 + i, signedChangeRate: 0, accumulatedVolume: 1, accumulatedPrice: 1, sourceFingerprint: String(i).repeat(64).slice(0, 64) });
  assert.equal(readCanonicalPaperTickerBenchmark(repository, "KRW-BTC", start - 1, start + 10 * 60_000), undefined);
  const xrp = readCanonicalPaperTickerBenchmark(repository, "KRW-XRP", start - 1, start + 10 * 60_000);
  assert.equal(xrp.market, "KRW-XRP");
  assert.equal(xrp.startPrice, 800);
  assert.equal(xrp.endPrice, 804);
  db.close();
});

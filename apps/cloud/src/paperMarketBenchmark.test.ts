import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { readCanonicalPaperTickerBenchmark } from "./paperMarketBenchmark";
import { SqlitePaperMarketObservationRepository } from "../../../packages/storage/src/paperMarketObservationRepository";

test("canonical ticker benchmark requires durable observations and preserves provenance across restart", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-paper-benchmark-")), "state.db");
  const first = new SqliteDatabase(filename);
  let expected;
  try {
    const repository = new SqlitePaperMarketObservationRepository(first);
    repository.append({ market: "KRW-BTC", observedAt: 1_000, price: 100 });
    repository.append({ market: "KRW-BTC", observedAt: 2_000, price: 110 });
    expected = readCanonicalPaperTickerBenchmark(repository, "krw-btc", 900, 2_100);
    assert.ok(expected);
    assert.equal(expected.market, "KRW-BTC");
    assert.equal(expected.source, "UPBIT_PUBLIC_TICKER");
    assert.equal(expected.startObservedAt, 1_000);
    assert.equal(expected.endObservedAt, 2_000);
    assert.equal(expected.startPrice, 100);
    assert.equal(expected.endPrice, 110);
    assert.ok(Math.abs(expected.benchmarkReturn - 0.1) < 1e-12);
    assert.match(expected.inputFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.equal(readCanonicalPaperTickerBenchmark(repository, "KRW-BTC", 1_500, 2_100), undefined);
  } finally { first.close(); }

  const restarted = new SqliteDatabase(filename);
  try {
    const repository = new SqlitePaperMarketObservationRepository(restarted);
    assert.deepEqual(readCanonicalPaperTickerBenchmark(repository, "KRW-BTC", 900, 2_100), expected);
  } finally { restarted.close(); }
});

test("benchmark source remains unavailable when there is not enough observed history", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const repository = new SqlitePaperMarketObservationRepository(db);
    repository.append({ market: "KRW-BTC", observedAt: 1_000, price: 100 });
    assert.equal(readCanonicalPaperTickerBenchmark(repository, "KRW-BTC", 900, 1_100), undefined);
    assert.equal(readCanonicalPaperTickerBenchmark(repository, undefined, 900, 1_100), undefined);
  } finally { db.close(); }
});

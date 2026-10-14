import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "./index";
import { SqliteMarketMicrostructureStore } from "./marketMicrostructureStore";

function withStore(run: (store: SqliteMarketMicrostructureStore) => void, samples = 600_000, ticks = 2_000_000): void {
  const dir = mkdtempSync(join(tmpdir(), "nusa-micro-"));
  const db = new SqliteDatabase(join(dir, "state.db"));
  try { run(new SqliteMarketMicrostructureStore(db, samples, ticks)); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}
const sample = (at: number) => ({ capturedAtMs: at, bestBid: 100, bestAsk: 101, bidSize5: 5, askSize5: 6, totalBidSize: 50, totalAskSize: 60 });
const tick = (id: number, at: number) => ({ tradedAtMs: at, price: 100 + id, volume: 0.5, side: "BID" as const });

describe("market microstructure store", () => {
  it("stores a multi-market round in one go and prunes only the named markets by age", () => withStore((store) => {
    assert.deepEqual(store.appendOrderBookRound([{ market: "KRW-A", sample: sample(10) }, { market: "KRW-B", sample: sample(10) }, { market: "bad", sample: sample(10) }, { market: "KRW-A", sample: sample(20) }]), { stored: 3, rejected: 1 });
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], 15), 1);
    assert.deepEqual(store.readOrderBookSamples("KRW-A", 0, 99).map((s) => s.capturedAtMs), [20]);
    assert.deepEqual(store.readOrderBookSamples("KRW-B", 0, 99).map((s) => s.capturedAtMs), [10], "other markets are untouched");
  }));

  it("stores samples and ticks idempotently and reads them back in time order", () => withStore((store) => {
    assert.deepEqual(store.appendOrderBookSamples("KRW-BTC", [sample(2), sample(1)]), { stored: 2, rejected: 0 });
    assert.deepEqual(store.appendOrderBookSamples("KRW-BTC", [sample(2)]), { stored: 0, rejected: 0 });
    assert.deepEqual(store.readOrderBookSamples("KRW-BTC", 0, 10).map((s) => s.capturedAtMs), [1, 2]);
    assert.deepEqual(store.appendTradeTicks("KRW-BTC", [tick(7, 5), tick(7, 5), tick(8, 6)]), { stored: 2, rejected: 0 });
    assert.deepEqual(store.readTradeTicks("KRW-BTC", 0, 10).map((t) => t.price), [107, 108]);
    assert.deepEqual(store.summary(), { orderBookSamples: 2, tradeTicks: 2, firstAt: 1, lastAt: 6 });
  }));

  it("identifies a trade by its content, not by Upbit's unsafe sequential id", () => withStore((store) => {
    const a = { tradedAtMs: 10, price: 100, volume: 1, side: "BID" as const };
    assert.deepEqual(store.appendTradeTicks("KRW-XRP", [a, { ...a }, { ...a, side: "ASK" as const }, { ...a, volume: 2 }]), { stored: 3, rejected: 0 });
  }));

  it("rejects invalid rows without storing them and refuses an invalid market", () => withStore((store) => {
    assert.deepEqual(store.appendOrderBookSamples("KRW-BTC", [{ ...sample(1), bestBid: 102 }, { ...sample(2), bidSize5: -1 }, sample(3)]), { stored: 1, rejected: 2 });
    assert.deepEqual(store.appendTradeTicks("KRW-BTC", [{ ...tick(1, 1), price: 0 }, { ...tick(2, 2), side: "X" as never }]), { stored: 0, rejected: 2 });
    assert.throws(() => store.appendTradeTicks("BTC", [tick(1, 1)]), /INVALID_MARKET|market is invalid/);
  }));

  it("keeps only the newest rows per market within retention", () => withStore((store) => {
    store.appendOrderBookSamples("KRW-BTC", Array.from({ length: 15 }, (_, i) => sample(i + 1)));
    assert.deepEqual(store.readOrderBookSamples("KRW-BTC", 0, 100).map((s) => s.capturedAtMs), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    store.appendTradeTicks("KRW-ETH", Array.from({ length: 12 }, (_, i) => tick(i, i + 1)));
    assert.equal(store.readTradeTicks("KRW-ETH", 0, 100).length, 10);
  }, 10, 10));
});

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

  const HOUR = 3_600_000, MIN = 60_000;
  const rowAt = (offsetMs: number, bid = 100) => ({ capturedAtMs: 1_000 * HOUR + offsetMs, bestBid: bid, bestAsk: bid + 1, bidSize5: 2, askSize5: 3, totalBidSize: 40, totalAskSize: 50 });
  const connection = (store: SqliteMarketMicrostructureStore) => (store as unknown as { db: { connection: { exec: (sql: string) => void } } }).db.connection;

  it("prune archives exactly the minutes the studies read (58, 59 and 0 of each hour, 1..10 on 4-hourly marks, 43..45 of each hour), with their values, before deleting", () => withStore((store) => {
    // The edges of every kept range and the first millisecond outside it.
    const edges: Array<[number, boolean]> = [[0, true], [10 * MIN + 59_999, true], [11 * MIN, false], [42 * MIN + 59_999, false], [43 * MIN, true], [45 * MIN + 59_999, true], [46 * MIN, false], [57 * MIN + 59_999, false], [58 * MIN, true], [59 * MIN + 59_999, true]];
    store.appendOrderBookRound(edges.map(([ms], i) => ({ market: "KRW-A", sample: rowAt(ms, 100 + i) })));
    store.appendOrderBookRound([{ market: "KRW-B", sample: rowAt(5 * MIN, 7) }, { market: "KRW-B", sample: rowAt(30 * MIN, 8) }]);
    const cutoff = 1_000 * HOUR + 2 * HOUR;
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A", "KRW-B"], cutoff), edges.length + 2, "every live row before the cutoff is deleted as before");
    assert.deepEqual(store.readOrderBookSamples("KRW-A", 0, 1_000 * HOUR + 9 * HOUR), []);
    const kept = store.readStudyRows("KRW-A", 0, 1_000 * HOUR + 9 * HOUR);
    assert.deepEqual(kept.map((r) => r.capturedAtMs - 1_000 * HOUR), edges.filter(([, k]) => k).map(([ms]) => ms));
    assert.deepEqual(kept[0], { capturedAtMs: 1_000 * HOUR, bestBid: 100, bestAsk: 101, bidSize5: 2, askSize5: 3, totalBidSize: 40, totalAskSize: 50 }, "archived values are the live values");
    assert.deepEqual(store.readStudyRows("KRW-B", 0, 1_000 * HOUR + 9 * HOUR).map((r) => r.bestBid), [7], "each market is archived on its own");
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A", "KRW-B"], cutoff), 0, "pruning twice is harmless");
    assert.equal(store.readStudyRows("KRW-A", 0, 1_000 * HOUR + 9 * HOUR).length, kept.length);
  }));

  it("minutes 1..10 are archived only on 4-hourly UTC marks, while 58, 59, 0 and 43..45 are archived every hour", () => withStore((store) => {
    // 1000 * HOUR is 16:00 UTC (1000 mod 24 = 16), a 4-hourly mark; one hour later (17:00) is not.
    assert.equal(((1_000 * HOUR) % (24 * HOUR)) / HOUR % 4, 0);
    const samples: Array<[number, boolean]> = [[5 * MIN, true], [59 * MIN, true], [HOUR, true], [HOUR + 5 * MIN, false], [HOUR + 10 * MIN, false], [HOUR + 43 * MIN, true], [HOUR + 58 * MIN, true], [4 * HOUR + 7 * MIN, true], [3 * HOUR + 7 * MIN, false]];
    store.appendOrderBookRound(samples.map(([off], i) => ({ market: "KRW-A", sample: rowAt(off, 100 + i) })));
    store.pruneOrderBookSamplesBefore(["KRW-A"], 1_000 * HOUR + 9 * HOUR);
    const kept = store.readStudyRows("KRW-A", 0, 2_000 * HOUR).map((r) => r.capturedAtMs - 1_000 * HOUR).sort((a, b) => a - b);
    assert.deepEqual(kept, samples.filter(([, keep]) => keep).map(([off]) => off).sort((a, b) => a - b));
  }));

  it("rows at or after the cutoff are neither archived nor deleted", () => withStore((store) => {
    const cutoff = 1_000 * HOUR + 3 * MIN;
    store.appendOrderBookRound([{ market: "KRW-A", sample: rowAt(MIN) }, { market: "KRW-A", sample: rowAt(3 * MIN) }, { market: "KRW-A", sample: rowAt(4 * MIN) }]);
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], cutoff), 1);
    assert.deepEqual(store.readOrderBookSamples("KRW-A", 0, 1_000 * HOUR + HOUR).map((r) => r.capturedAtMs - 1_000 * HOUR), [3 * MIN, 4 * MIN]);
    assert.deepEqual(store.readStudyRows("KRW-A", 0, 1_000 * HOUR + HOUR).map((r) => r.capturedAtMs - 1_000 * HOUR), [MIN]);
  }));

  it("if the archive copy fails, NOTHING is deleted and the error surfaces", () => withStore((store) => {
    store.appendOrderBookRound([{ market: "KRW-A", sample: rowAt(MIN) }, { market: "KRW-B", sample: rowAt(2 * MIN) }]);
    connection(store).exec("CREATE TRIGGER fail_archive BEFORE INSERT ON research_orderbook_study_rows BEGIN SELECT RAISE(ABORT, 'archive down'); END;");
    assert.throws(() => store.pruneOrderBookSamplesBefore(["KRW-A", "KRW-B"], 1_000 * HOUR + HOUR), /archive down/);
    assert.deepEqual(store.readOrderBookSamples("KRW-A", 0, 2_000 * HOUR).length, 1, "the live row is still there");
    assert.deepEqual(store.readOrderBookSamples("KRW-B", 0, 2_000 * HOUR).length, 1, "and so is the other market's row (the whole call rolled back)");
    connection(store).exec("DROP TRIGGER fail_archive");
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A", "KRW-B"], 1_000 * HOUR + HOUR), 2, "once the archive works the prune completes");
  }));

  it("a long backlog is worked off one day per market per call, and the archive is itself bounded", () => withStore((store) => {
    const DAY = 24 * HOUR;
    store.appendOrderBookRound([0, 1, 2].map((d) => ({ market: "KRW-A", sample: rowAt(d * DAY + 5 * MIN) })));
    const cutoff = 1_000 * HOUR + 10 * DAY;
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], cutoff), 1, "only the oldest day goes in the first call");
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], cutoff), 1);
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], cutoff), 1);
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], cutoff), 0);
    assert.equal(store.readStudyRows("KRW-A", 0, 3_000 * HOUR).length, 3);
    assert.equal(store.pruneOrderBookSamplesBefore(["KRW-A"], 1_000 * HOUR + 120 * DAY), 0);
    assert.equal(store.readStudyRows("KRW-A", 0, 3_000 * HOUR).length, 0, "archive rows older than the live retention plus 61 days are removed");
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

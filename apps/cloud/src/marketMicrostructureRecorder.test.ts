import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MarketMicrostructureRecorder, microstructureRecorderEnabled, type MarketMicrostructureSink } from "./marketMicrostructureRecorder";

function sink(fail = false) {
  const samples: Array<{ market: string; at: number; bidSize5: number }> = [];
  const ticks: Array<{ market: string; id: number }> = [];
  const value: MarketMicrostructureSink = {
    appendOrderBookSamples: (market, rows) => { if (fail) throw new Error("disk full"); rows.forEach((r) => samples.push({ market, at: r.capturedAtMs, bidSize5: r.bidSize5 })); return { stored: rows.length, rejected: 0 }; },
    appendTradeTicks: (market, rows) => { if (fail) throw new Error("disk full"); rows.forEach((r) => ticks.push({ market, id: r.sequentialId })); return { stored: rows.length, rejected: 0 }; },
    summary: () => ({ orderBookSamples: 3, tradeTicks: 4, lastAt: 9 }),
  };
  return { value, samples, ticks };
}
const book = (code = "krw-xrp") => ({ code, total_ask_size: 60, total_bid_size: 50, orderbook_units: Array.from({ length: 7 }, (_, i) => ({ ask_price: 101 + i, bid_price: 100 - i, ask_size: 1, bid_size: 2 })) });
const trade = (id?: number) => ({ code: "KRW-XRP", trade_price: 100, trade_volume: 1, ask_bid: "BID" as const, trade_timestamp: 1_000, ...(id === undefined ? {} : { sequential_id: id }) });

describe("market microstructure recorder", () => {
  it("samples each market's order book at most once per interval and sums the top five levels", () => {
    const s = sink();
    const recorder = new MarketMicrostructureRecorder(s.value, () => 0, 5_000);
    recorder.recordOrderBook(book(), 10_000);
    recorder.recordOrderBook(book(), 12_000);
    recorder.recordOrderBook(book(), 15_000);
    recorder.recordOrderBook(book("KRW-BTC"), 12_000);
    assert.deepEqual(s.samples, [{ market: "KRW-XRP", at: 10_000, bidSize5: 10 }, { market: "KRW-XRP", at: 15_000, bidSize5: 10 }, { market: "KRW-BTC", at: 12_000, bidSize5: 10 }]);
    assert.equal(recorder.status().orderBookSamples, 3 + 3, "seeded from the durable summary");
  });

  it("buffers trades until flush and skips ticks without a sequential id", () => {
    const s = sink();
    const recorder = new MarketMicrostructureRecorder(s.value, () => 20_000);
    recorder.recordTrade(trade(1)); recorder.recordTrade(trade()); recorder.recordTrade(trade(2));
    assert.equal(s.ticks.length, 0);
    recorder.flush();
    assert.deepEqual(s.ticks.map((t) => t.id), [1, 2]);
    assert.equal(recorder.status().tradeTicks, 4 + 2);
    assert.equal(recorder.status().lastRecordedAt, 20_000);
  });

  it("never throws into the runtime: write failures are counted", () => {
    const s = sink(true);
    const recorder = new MarketMicrostructureRecorder(s.value);
    assert.doesNotThrow(() => { recorder.recordOrderBook(book(), 1); recorder.recordTrade(trade(1)); recorder.flush(); });
    assert.equal(recorder.status().writeFailures, 2);
  });

  it("is enabled unless explicitly disabled", () => {
    assert.equal(microstructureRecorderEnabled({}), true);
    assert.equal(microstructureRecorderEnabled({ NUSA_MICROSTRUCTURE_RECORDER: "ENABLED" }), true);
    assert.equal(microstructureRecorderEnabled({ NUSA_MICROSTRUCTURE_RECORDER: "DISABLED" }), false);
  });
});

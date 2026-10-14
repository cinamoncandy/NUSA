import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ORDERBOOK_COLLECTOR_RETENTION_MS, ResearchOrderBookCollector, researchOrderBookCollectorEnabled } from "./researchOrderBookCollector";

const book = (market: string, timestamp: number) => ({ market, timestamp, total_ask_size: 10, total_bid_size: 12, orderbook_units: [{ ask_price: 101, bid_price: 100, ask_size: 1, bid_size: 2 }, { ask_price: 102, bid_price: 99, ask_size: 3, bid_size: 4 }] });

function fakeFetch(markets: string[], failOrderbook = false): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/v1/market/all")) return new Response(JSON.stringify(markets.map((market) => ({ market }))), { status: 200 });
    if (failOrderbook) return new Response("busy", { status: 503 });
    const requested = new URL(u).searchParams.get("markets")!.split(",");
    return new Response(JSON.stringify(requested.map((m) => book(m, 1_000))), { status: 200 });
  }) as typeof fetch;
}

describe("research all-KRW order-book collector", () => {
  it("stores one top-of-book summary per KRW market, skips WebSocket-recorded markets, and prunes its rows by age", async () => {
    const rounds: { market: string; sample: { bidSize5: number; bestBid: number } }[][] = [];
    const pruned: { markets: readonly string[]; cutoff: number }[] = [];
    const markets = ["KRW-BTC", "BTC-ETH", ...Array.from({ length: 45 }, (_, i) => `KRW-C${i}`)];
    const collector = new ResearchOrderBookCollector({
      appendOrderBookRound: (rows) => { rounds.push(rows as never); return { stored: rows.length, rejected: 0 }; },
      pruneOrderBookSamplesBefore: (m, cutoff) => { pruned.push({ markets: m, cutoff }); return 0; },
    }, { fetchImpl: fakeFetch(markets), now: () => 1_000_000_000_000, skipMarkets: () => new Set(["KRW-BTC"]), sleep: async () => undefined });
    assert.equal(await collector.collectOnce(), 45);
    assert.equal(rounds.length, 3, "chunks of 20 markets");
    assert.ok(rounds.flat().every((r) => r.market !== "KRW-BTC" && r.market.startsWith("KRW-")));
    assert.equal(rounds[0]![0]!.sample.bidSize5, 6);
    assert.equal(pruned[0]!.cutoff, 1_000_000_000_000 - ORDERBOOK_COLLECTOR_RETENTION_MS);
    assert.deepEqual({ ...collector.status() }, { rounds: 1, markets: 46, samplesStored: 45, failures: 0, lastRoundAt: 1_000_000_000_000 });
  });

  it("counts failures and never throws", async () => {
    const collector = new ResearchOrderBookCollector({ appendOrderBookRound: () => ({ stored: 0, rejected: 0 }), pruneOrderBookSamplesBefore: () => 0 }, { fetchImpl: fakeFetch(["KRW-A"], true), now: () => 5, sleep: async () => undefined });
    assert.equal(await collector.collectOnce(), 0);
    assert.equal(collector.status().failures, 1);
  });

  it("is on unless explicitly disabled", () => {
    assert.equal(researchOrderBookCollectorEnabled({}), true);
    assert.equal(researchOrderBookCollectorEnabled({ NUSA_RESEARCH_ORDERBOOK_COLLECTOR: "DISABLED" }), false);
  });
});

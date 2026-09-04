const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { WatchlistRepository, buildWatchlistViewModel, parseWatchlistMarkets, freshestObservedAtMs, formatFeedAgeMs } = require("../dist/apps/mobile/src/watchlist.js");

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: async () => value,
    setItem: async (_key, next) => { value = next; },
    read: () => value,
  };
}

const markets = [
  { market: "KRW-BTC", price: 100, changeRate: 0.02, volume: 5, observedAt: "2026-08-03T00:00:00.000Z", source: "UPBIT_PUBLIC_TICKER" },
  { market: "KRW-ETH", price: 200, changeRate: -0.01, volume: 9, observedAt: "2026-08-03T00:00:01.000Z", source: "UPBIT_PUBLIC_TICKER" },
];

test("watchlist repository persists, deduplicates, restores and removes market ids", async () => {
  const storage = memoryStorage();
  const repository = new WatchlistRepository(storage);
  assert.deepEqual(await repository.add("krw-btc"), ["KRW-BTC"]);
  assert.deepEqual(await repository.add("KRW-BTC"), ["KRW-BTC"]);
  assert.deepEqual(await repository.add("KRW-ETH"), ["KRW-BTC", "KRW-ETH"]);
  const restored = new WatchlistRepository(storage);
  assert.deepEqual(await restored.load(), ["KRW-BTC", "KRW-ETH"]);
  assert.match(storage.read(), /KRW-BTC/);
  assert.deepEqual(await restored.remove("KRW-BTC"), ["KRW-ETH"]);
});

test("invalid persisted watchlist fails closed", async () => {
  await assert.rejects(() => new WatchlistRepository(memoryStorage("{bad")).load(), /stored watchlist is invalid/);
  await assert.rejects(() => new WatchlistRepository(memoryStorage(JSON.stringify(["not-a-market"]))).load(), /stored watchlist is invalid/);
});

test("market parser rejects estimated or malformed public data", () => {
  assert.deepEqual(parseWatchlistMarkets(markets).map((market) => market.market), ["KRW-BTC", "KRW-ETH"]);
  assert.throws(() => parseWatchlistMarkets([{ ...markets[0], source: "ESTIMATED" }]), /market 0 is invalid/);
  assert.throws(() => parseWatchlistMarkets([{ ...markets[0], price: 0 }]), /market 0 is invalid/);
  assert.throws(() => parseWatchlistMarkets([{ ...markets[0], volume: -1 }]), /market 0 is invalid/);
});

test("watchlist view model supports search, sort and fail-closed states", () => {
  const ready = buildWatchlistViewModel({ rawMarkets: markets, watchlist: ["KRW-BTC"], query: "eth", sort: "PRICE" });
  assert.equal(ready.state, "READY");
  assert.deepEqual(ready.activeMarkets.map((market) => market.market), ["KRW-BTC"]);
  assert.deepEqual(ready.searchResults.map((market) => market.market), ["KRW-ETH"]);
  assert.equal(buildWatchlistViewModel({ rawMarkets: null, watchlist: null, query: "", sort: "MARKET" }).state, "LOADING");
  assert.equal(buildWatchlistViewModel({ rawMarkets: [], watchlist: [], query: "", sort: "MARKET" }).state, "EMPTY");
  assert.equal(buildWatchlistViewModel({ rawMarkets: [{ ...markets[0], source: "ESTIMATED" }], watchlist: [], query: "", sort: "MARKET" }).state, "ERROR");
});

test("feed freshness picks the newest valid observation and formats Korean relative age", () => {
  const parsed = parseWatchlistMarkets(markets);
  assert.equal(freshestObservedAtMs(parsed), Date.parse("2026-08-03T00:00:01.000Z"));
  assert.equal(freshestObservedAtMs([]), null);
  assert.equal(formatFeedAgeMs(Date.parse("2026-08-03T00:00:01.000Z"), Date.parse("2026-08-03T00:00:05.000Z")), "방금");
  assert.equal(formatFeedAgeMs(Date.parse("2026-08-03T00:00:01.000Z"), Date.parse("2026-08-03T00:00:31.000Z")), "30초 전");
  assert.equal(formatFeedAgeMs(Date.parse("2026-08-03T00:00:01.000Z"), Date.parse("2026-08-03T00:05:01.000Z")), "5분 전");
  assert.equal(formatFeedAgeMs(Date.parse("2026-08-03T00:00:01.000Z"), Date.parse("2026-08-03T02:00:01.000Z")), "2시간 전");
  assert.equal(formatFeedAgeMs(Date.parse("2026-08-03T00:00:02.000Z"), Date.parse("2026-08-03T00:00:01.000Z")), null);
  assert.equal(formatFeedAgeMs(Number.NaN, Date.now()), null);
});

test("watchlist header exposes feed freshness without weakening read-only contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "watchlistView.tsx"), "utf8");
  assert.match(source, /watchlist-freshness/);
  assert.match(source, /StatusChip label="STALE"/);
});
test("watchlist UI remains read-only and is wired into the markets workspace", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "watchlistView.tsx"), "utf8");
  assert.match(source, /시장 검색/);
  assert.match(source, /관심시장/);
  assert.match(source, /전체 결과/);
  assert.match(source, /watchlist-toggle-/);
  assert.match(source, /watchlist-loading/);
  assert.match(source, /watchlist-error/);
  assert.match(source, /StatusChip label="READ ONLY"/);
  assert.doesNotMatch(source, /PUBLIC · READ ONLY/);
  assert.match(source, /계좌·주문 권한과 연결되지 않습니다/);
  assert.match(source, /SegmentedControl/);
  assert.match(source, /favorite: \{ minWidth: 52, minHeight: 48/);
  assert.doesNotMatch(source, /placeOrder|cancelOrder|withdraw|fetch\(/);

  const primitives = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "uxPrimitives.tsx"), "utf8");
  assert.match(primitives, /segment: \{ flex: 1, minHeight: 44/);

  const marketsView = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");
  assert.match(marketsView, /WatchlistView/);
  assert.match(marketsView, /ChartView/);
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "personalPaperOperationsClient.ts"), "utf8");
  assert.match(app, /AsyncStorage/);
  assert.match(app, /loadPersonalPaperOperations/);
  assert.match(app, /<MarketsView/);
  assert.match(app, /rawMarkets=\{publicMarkets\.markets === null \? null : \[\.\.\.publicMarkets\.markets\]\}/);
  assert.doesNotMatch(app, /\/api\/(?:markets|candles|account|status)/);
  assert.match(client, /\/api\/paper-operations/);
});

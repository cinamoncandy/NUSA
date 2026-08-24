const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadUpbitPublicCandles,
  loadUpbitPublicMarkets,
} = require("../dist/apps/mobile/src/upbitPublicQuotationClient.js");

const ticker = () => ({ market: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_volume_24h: 10, timestamp: 1_700_000_000_000 });
const candle = () => ({ market: "KRW-BTC", candle_date_time_utc: "2023-11-14T22:13:00", opening_price: 100, high_price: 110, low_price: 90, trade_price: 105, candle_acc_trade_volume: 2 });

function mockRequest(payload, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("configured canonical Cloud origin does not reroute isolated public Upbit quotation", async () => {
  const previous = process.env.EXPO_PUBLIC_NUSA_API_BASE_URL;
  process.env.EXPO_PUBLIC_NUSA_API_BASE_URL = "https://nusa-api.example";
  try {
    const calls = [];
    await loadUpbitPublicMarkets({ request: mockRequest([ticker()], calls) });
    await loadUpbitPublicCandles({ market: "KRW-BTC", count: 120, request: mockRequest([candle()], calls) });

    assert.equal(calls[0].url, "https://api.upbit.com/v1/ticker/all?quote_currencies=KRW");
    assert.equal(calls[1].url, "https://api.upbit.com/v1/candles/minutes/1?market=KRW-BTC&count=120");
    assert.equal(calls.every((call) => !call.url.startsWith("https://nusa-api.example")), true);
    assert.equal(calls.every((call) => call.init.method === "GET"), true);
    assert.equal(calls.every((call) => call.init.headers === undefined), true);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_NUSA_API_BASE_URL;
    else process.env.EXPO_PUBLIC_NUSA_API_BASE_URL = previous;
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PUBLIC_UPBIT_TICKER_PATH,
  PUBLIC_UPBIT_CANDLE_PATH,
  UPBIT_PUBLIC_TICKER_URL,
  handlePublicUpbitQuotationHttp,
} = require("../dist/apps/cloud/src/publicUpbitQuotationHttp.js");

function upstream(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("public ticker relay is GET-only and forwards only to fixed Upbit quotation URL", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return upstream([{ market: "KRW-BTC" }]); };
  const result = await handlePublicUpbitQuotationHttp(PUBLIC_UPBIT_TICKER_PATH, "GET", fetchImpl);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, UPBIT_PUBLIC_TICKER_URL);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers, undefined);

  const denied = await handlePublicUpbitQuotationHttp(PUBLIC_UPBIT_TICKER_PATH, "POST", fetchImpl);
  assert.equal(denied.status, 405);
  assert.equal(calls.length, 1);
});

test("public candle relay validates market/count and cannot become an arbitrary proxy", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return upstream([{ market: "KRW-BTC" }]); };
  const result = await handlePublicUpbitQuotationHttp(`${PUBLIC_UPBIT_CANDLE_PATH}?market=KRW-BTC&count=120`, "GET", fetchImpl);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.upbit.com/v1/candles/minutes/1?market=KRW-BTC&count=120");
  assert.equal(calls[0].init.headers, undefined);

  for (const url of [
    `${PUBLIC_UPBIT_CANDLE_PATH}?market=BTC&count=120`,
    `${PUBLIC_UPBIT_CANDLE_PATH}?market=KRW-BTC&count=201`,
    `${PUBLIC_UPBIT_CANDLE_PATH}?market=KRW-BTC&count=120&url=https://evil.example`,
  ]) {
    const rejected = await handlePublicUpbitQuotationHttp(url, "GET", fetchImpl);
    assert.equal(rejected.status, 400);
  }
  assert.equal(calls.length, 1);
});

test("upstream failure is sanitized and fails closed", async () => {
  const fetchImpl = async () => upstream({ error: { message: "provider detail" } }, 400);
  const result = await handlePublicUpbitQuotationHttp(PUBLIC_UPBIT_TICKER_PATH, "GET", fetchImpl);
  assert.equal(result.status, 502);
  assert.deepEqual(JSON.parse(result.body), { error: "UPSTREAM_FAILURE" });
});

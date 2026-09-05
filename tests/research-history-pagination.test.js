const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEARCH_MARKETS,
  SMA_PARAMETER_NEIGHBORHOOD,
  fetchResearchCandles,
  researchCandleCount,
  buildParameterRobustnessRequest
} = require("../scripts/research-real-market-run.js");
const { createHistoricalDatasetManifest } = require("../dist/apps/desktop/src/cloud/researchDataset.js");

const DAY = 86_400_000;
const dataAsOf = Date.UTC(2026, 8, 5, 12);
function pageFor(request) {
  const params = new URL(request, "https://api.upbit.com").searchParams;
  const before = Date.parse(params.get("to"));
  const market = params.get("market");
  return Array.from({ length: Number(params.get("count")) }, (_, index) => ({
    market,
    candle_date_time_utc: new Date(before - (index + 1) * DAY).toISOString().slice(0, 19),
    opening_price: 100, high_price: 110, low_price: 90, trade_price: 105,
    candle_acc_trade_volume: 10
  }));
}

test("research horizon is bounded and never selected from performance", () => {
  assert.equal(researchCandleCount(undefined), 2000);
  for (const value of [200, 1000, 2000]) assert.equal(researchCandleCount(String(value)), value);
  for (const value of [0, 199, 2001, Infinity, "", "200.5", "1e3", " 200", null]) {
    assert.throws(() => researchCandleCount(value), /integer from 200 to 2000/);
  }
});

test("independent regime markets are predeclared and immutable", () => {
  assert.deepEqual(RESEARCH_MARKETS, ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]);
  assert.ok(Object.isFrozen(RESEARCH_MARKETS));
});

test("SMA candidate neighborhood is predeclared, immutable, and includes fast evidence cells", () => {
  assert.deepEqual(SMA_PARAMETER_NEIGHBORHOOD, [
    { shortPeriod: 2, longPeriod: 8 },
    { shortPeriod: 3, longPeriod: 10 },
    { shortPeriod: 4, longPeriod: 10 },
    { shortPeriod: 3, longPeriod: 15 },
    { shortPeriod: 5, longPeriod: 15 },
    { shortPeriod: 5, longPeriod: 20 },
    { shortPeriod: 5, longPeriod: 25 },
    { shortPeriod: 8, longPeriod: 20 },
    { shortPeriod: 10, longPeriod: 30 }
  ]);
  assert.ok(Object.isFrozen(SMA_PARAMETER_NEIGHBORHOOD));
  assert.ok(SMA_PARAMETER_NEIGHBORHOOD.every(Object.isFrozen));
});

test("fast SMA cells are covered by a predeclared robustness reference without relaxing gates", () => {
  const request = buildParameterRobustnessRequest({
    candles: [{ market: "KRW-BTC" }],
    manifest: {
      market: "KRW-BTC",
      datasetId: "dataset:test",
      contentSha256: "a".repeat(64)
    }
  });
  assert.deepEqual(request.referenceParameters, [
    { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 },
    { source: "MANUAL_RESEARCH_REFERENCE", shortWindow: 2, longWindow: 8 }
  ]);
  assert.equal(request.minimumTrades, 0);
  assert.equal(request.evaluation.mode, "BOTH");
  assert.deepEqual(request.evaluation.oosWindows, {
    trainingCandles: 120,
    testCandles: 20,
    stepCandles: 20
  });

  const fastReference = request.referenceParameters[1];
  const grid = new Set();
  for (const shortOffset of request.neighborhood.shortOffsets) {
    for (const longOffset of request.neighborhood.longOffsets) {
      grid.add(`${fastReference.shortWindow + shortOffset}/${fastReference.longWindow + longOffset}`);
    }
  }
  for (const candidate of SMA_PARAMETER_NEIGHBORHOOD.slice(0, 3)) {
    assert.ok(grid.has(`${candidate.shortPeriod}/${candidate.longPeriod}`));
  }
});

test("ten pages restore 2000 completed days with stable request provenance and checksum", async () => {
  const pauses = [];
  const options = { dataAsOf, fetchPage: pageFor, pause: async (ms) => pauses.push(ms) };
  const first = await fetchResearchCandles(options);
  const second = await fetchResearchCandles({ ...options, fetchPage: (request) => pageFor(request).reverse() });
  assert.deepEqual(first, second);
  assert.equal(first.candles.length, 2000);
  assert.equal(first.sourceRequests.length, 10);
  assert.equal(first.candles.at(-1).closeTime, Math.floor(dataAsOf / DAY) * DAY);
  assert.ok(pauses.every((ms) => ms >= 100));
  const manifest = (result) => createHistoricalDatasetManifest(result.candles, {
    source: "upbit-public-api", sourceRequest: result.sourceRequests.join(" | "), createdAt: new Date(dataAsOf).toISOString()
  });
  assert.equal(manifest(first).contentSha256, manifest(second).contentSha256);
});

test("market-specific pagination binds request, candles, and provenance to the requested market", async () => {
  const result = await fetchResearchCandles({ market: "KRW-ETH", dataAsOf, count: 200, fetchPage: pageFor, pause: async () => {} });
  assert.equal(result.candles.length, 200);
  assert.ok(result.candles.every((candle) => candle.market === "KRW-ETH"));
  assert.ok(result.sourceRequests.every((request) => request.includes("market=KRW-ETH")));
  await assert.rejects(
    fetchResearchCandles({ market: "KRW-ADA", dataAsOf, count: 200, fetchPage: pageFor }),
    /unsupported research market/
  );
});

test("partial last page requests only the remaining count", async () => {
  const result = await fetchResearchCandles({ dataAsOf, count: 201, fetchPage: pageFor, pause: async () => {} });
  assert.equal(result.candles.length, 201);
  assert.match(result.sourceRequests[1], /count=1&to=/);
});

for (const [name, corrupt] of Object.entries({
  duplicate: (rows) => { rows[1] = rows[0]; return rows; },
  wrongMarket: (rows) => { rows[0].market = "KRW-ETH"; return rows; },
  future: (rows) => { rows[0].candle_date_time_utc = new Date(dataAsOf).toISOString().slice(0, 19); return rows; },
  malformed: (rows) => { rows[0].trade_price = NaN; return rows; },
  short: (rows) => rows.slice(1),
  empty: () => [],
  invalidPayload: () => ({ error: "unavailable" })
})) {
  test(`rejects ${name} before manifest/qualification`, async () => {
    await assert.rejects(fetchResearchCandles({ dataAsOf, count: 200, fetchPage: (request) => corrupt(pageFor(request)) }));
  });
}

test("overlapping/stale cursor page fails closed without retrying", async () => {
  let calls = 0;
  let first;
  await assert.rejects(fetchResearchCandles({ dataAsOf, count: 400, pause: async () => {}, fetchPage: (request) => {
    calls += 1;
    first ??= pageFor(request);
    return first;
  } }), /cursor mismatch/);
  assert.equal(calls, 2);
});

test("HTTP/rate-limit failure is not silently retried or substituted", async () => {
  let calls = 0;
  await assert.rejects(fetchResearchCandles({ dataAsOf, fetchPage: () => { calls += 1; throw new Error("HTTP 429"); } }), /HTTP 429/);
  assert.equal(calls, 1);
});

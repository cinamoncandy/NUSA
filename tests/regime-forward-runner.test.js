const test = require("node:test");
const assert = require("node:assert/strict");
const { runForwardStudy } = require("../scripts/lib/regime-forward-runner");
const START = Date.parse("2026-10-14T00:00:00Z"), END = Date.parse("2026-12-13T00:00:00Z");
const execute = options => runForwardStudy({ ...options, executionSourceSha: "a".repeat(40) });
const candles = () => Array.from({ length: 1440 }, (_, i) => ({ market: "KRW-BTC", interval: "60m", openTime: START + i * 3600000, closeTime: START + (i + 1) * 3600000,
  open: 100, high: 101, low: 99, close: 100, volume: 1 }));
test("waiting never fetches or evaluates future data", async () => {
  const result = await execute({ now: () => END - 1, fetchCandles: () => { throw Error("unexpected"); }, evaluate: () => { throw Error("unexpected"); } });
  assert.equal(result.status, "WAITING_HOLDOUT");
});
test("screen pass is not qualification; blocks and stressed costs are fixed", async () => {
  const calls = [];
  const result = await execute({ now: () => END, fetchCandles: async () => ({ candles: candles(), sourceRequests: [] }), evaluate: (points, config) => {
    calls.push({ points, config }); const run = { metrics: { totalReturn: 0.01, maxDrawdown: 0.02, benchmarkReturn: 0 }, trades: Array(30).fill({}) }; return { candidate: run, comparator: run };
  } });
  assert.equal(result.status, "RESEARCH_SCREEN_PASS"); assert.equal(result.qualification, "NOT_QUALIFIED");
  assert.equal(result.executionSourceSha, "a".repeat(40)); assert.notEqual(result.executionSourceSha, result.specificationSourceSha);
  assert.equal(calls.length, 8); assert.equal(calls[1].config.feeRate, calls[0].config.feeRate * 2);
  for (const call of calls.slice(2)) for (const p of call.config.warmupPoints) assert.ok(p.timestamp < call.points[0].timestamp);
});
test("real canonical flat-data screen remains insufficient, never a strategy promotion", async () => {
  const result = await execute({ now: () => END, fetchCandles: async () => ({ candles: candles(), sourceRequests: [] }) });
  assert.equal(result.status, "INSUFFICIENT_DATA"); assert.equal(result.completedTrades, 0);
});
test("missing execution source and API failure fail closed", async () => {
  await assert.rejects(runForwardStudy({ executionSourceSha: "invalid" }), /SOURCE_UNVERIFIED/);
  await assert.rejects(execute({ now: () => END, fetchCandles: async () => { throw Error("HTTP_FAILED"); } }), /HTTP_FAILED/);
});

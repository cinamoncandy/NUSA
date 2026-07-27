const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation, summarizeGroup } = require("../scripts/lib/cross-market-validation-runner.js");

const dir = path.join(__dirname, "fixtures", "cross-market");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("one market summary is produced per distinct symbol", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  const symbols = new Set(request.datasets.map((dataset) => dataset.symbol));
  assert.equal(result.fullAvailablePeriod.marketSummaries.length, symbols.size);
});

test("market summaries are ordered canonically by symbol", () => {
  const summaries = runCrossMarketValidation(load("multi-market-multi-period")).fullAvailablePeriod.marketSummaries;
  const keys = summaries.map((summary) => summary.key);
  assert.deepEqual(keys, [...keys].sort());
});

test("each market summary's cell count equals the number of periods it covers", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  for (const summary of result.fullAvailablePeriod.marketSummaries) {
    const expected = request.datasets.filter((dataset) => dataset.symbol === summary.key).length;
    assert.equal(summary.cellCount, expected);
  }
});

test("positive and negative cell counts never exceed the evaluated count", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  for (const summary of result.fullAvailablePeriod.marketSummaries) {
    assert.ok(summary.positiveCellCount + summary.negativeCellCount <= summary.evaluatedCellCount);
  }
});

test("a market summary's median return lies between its worst and best return", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  for (const summary of result.fullAvailablePeriod.marketSummaries) {
    if (summary.evaluatedCellCount === 0) continue;
    assert.ok(summary.medianReturn >= summary.worstReturn - 1e-12);
    assert.ok(summary.medianReturn <= summary.bestReturn + 1e-12);
  }
});

test("severe-cost survivors never exceed the evaluated cell count", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  for (const summary of result.fullAvailablePeriod.marketSummaries) {
    assert.ok(summary.severeSurvivorCount <= summary.evaluatedCellCount);
  }
});

test("summarizeGroup keeps blocked cells in the count rather than dropping them", () => {
  const cells = [
    { symbol: "A", status: "BLOCKED" },
    { symbol: "A", status: "PASS", byCondition: { BASE: { totalReturn: 0.1, maxDrawdown: 0, netProfit: 5, tradeCount: 1, profitFactor: 2 }, SEVERE: { totalReturn: 0.05 } }, beatsCash: true, beatsBuyAndHold: true }
  ];
  const [summary] = summarizeGroup(cells, "symbol");
  assert.equal(summary.cellCount, 2);
  assert.equal(summary.blockedCellCount, 1);
  assert.equal(summary.evaluatedCellCount, 1);
});

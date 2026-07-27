const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation } = require("../scripts/lib/cross-market-validation-runner.js");

const dir = path.join(__dirname, "fixtures", "cross-market");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

test("one period summary is produced per distinct period label", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  const periods = new Set(request.datasets.map((dataset) => dataset.periodLabel));
  assert.equal(result.fullAvailablePeriod.periodSummaries.length, periods.size);
});

test("period summaries are ordered canonically by label", () => {
  const summaries = runCrossMarketValidation(load("multi-market-multi-period")).fullAvailablePeriod.periodSummaries;
  const keys = summaries.map((summary) => summary.key);
  assert.deepEqual(keys, [...keys].sort());
});

test("each period summary spans every market that has data in that period", () => {
  const request = load("multi-market-multi-period");
  const result = runCrossMarketValidation(request);
  for (const summary of result.fullAvailablePeriod.periodSummaries) {
    const expected = request.datasets.filter((dataset) => dataset.periodLabel === summary.key).length;
    assert.equal(summary.cellCount, expected);
  }
});

test("market and period summaries cover the same total cell count", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  const byMarket = result.fullAvailablePeriod.marketSummaries.reduce((sum, summary) => sum + summary.cellCount, 0);
  const byPeriod = result.fullAvailablePeriod.periodSummaries.reduce((sum, summary) => sum + summary.cellCount, 0);
  assert.equal(byMarket, byPeriod);
  assert.equal(byMarket, result.fullAvailablePeriod.aggregate.cellCount);
});

test("period net profit totals reconcile with the cells in that period", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  for (const summary of result.fullAvailablePeriod.periodSummaries) {
    const cells = result.fullAvailablePeriod.cells.filter((cell) => cell.periodLabel === summary.key && cell.status === "PASS");
    const total = cells.reduce((sum, cell) => sum + cell.byCondition.BASE.netProfit, 0);
    assert.ok(Math.abs(total - summary.totalNetProfit) < 1e-6);
  }
});

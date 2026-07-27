const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation, buildCellPlan, computeCommonPeriod, FIXED_BENCHMARK_PARAMETER } = require("../scripts/lib/cross-market-validation-runner.js");

const fixturePath = path.join(__dirname, "fixtures", "cross-market", "multi-market-multi-period.json");
const loadRequest = () => JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("the cell plan produces exactly one cell per dataset", () => {
  const request = loadRequest();
  assert.equal(buildCellPlan(request.datasets).length, request.datasets.length);
});

test("cells are ordered canonically by symbol then start time", () => {
  const plan = buildCellPlan(loadRequest().datasets);
  for (let index = 1; index < plan.length; index += 1) {
    const order = plan[index - 1].symbol.localeCompare(plan[index].symbol) || (plan[index - 1].startTime - plan[index].startTime);
    assert.ok(order <= 0, `cell ${index} is out of canonical order`);
  }
});

test("cell ordering is independent of the order datasets are supplied in", () => {
  const request = loadRequest();
  const forward = buildCellPlan(request.datasets).map((cell) => cell.datasetId);
  const reversed = buildCellPlan([...request.datasets].reverse()).map((cell) => cell.datasetId);
  assert.deepEqual(forward, reversed);
});

test("the common period is the intersection across symbols, not the union", () => {
  const request = loadRequest();
  const common = computeCommonPeriod(request.datasets);
  assert.ok(common !== null);
  // Each symbol's own span is min(start)..max(end) over its datasets; the common window
  // is the intersection of those spans, so its start is the LATEST per-symbol start.
  const perSymbolStart = new Map();
  for (const dataset of request.datasets) {
    const start = dataset.candles[0].openTime;
    perSymbolStart.set(dataset.symbol, Math.min(perSymbolStart.get(dataset.symbol) ?? Infinity, start));
  }
  assert.equal(common.startTime, Math.max(...perSymbolStart.values()));
});

test("symbols with no overlapping window yield no common period and BLOCKED common-period cells", () => {
  const request = loadRequest();
  // Push one symbol's data far into the future so nothing overlaps.
  const offset = 10_000_000_000;
  for (const dataset of request.datasets) {
    if (dataset.symbol !== "KRW-XRP") continue;
    dataset.candles = dataset.candles.map((candle) => ({ ...candle, openTime: candle.openTime + offset, closeTime: candle.closeTime + offset }));
  }
  assert.equal(computeCommonPeriod(request.datasets), null);
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "PASS");
  assert.ok(result.commonPeriod.cells.every((cell) => cell.status === "BLOCKED"));
  assert.ok(result.commonPeriod.cells.every((cell) => cell.blockedReason === "NO_COMMON_PERIOD"));
});

test("the full-available-period and common-period views are reported separately, never merged", () => {
  const result = runCrossMarketValidation(loadRequest());
  assert.ok(result.fullAvailablePeriod);
  assert.ok(result.commonPeriod);
  assert.notEqual(result.fullAvailablePeriod, result.commonPeriod);
  assert.equal(result.fullAvailablePeriod.commonPeriod, null);
  assert.ok(result.commonPeriod.commonPeriod !== null);
});

test("a cell with too few candles is BLOCKED and counted, never silently dropped", () => {
  const request = loadRequest();
  request.datasets[0].candles = request.datasets[0].candles.slice(0, 30);
  const result = runCrossMarketValidation(request);
  assert.equal(result.status, "PASS");
  const cells = result.fullAvailablePeriod.cells;
  assert.equal(cells.length, request.datasets.length, "the blocked cell is still present in the plan");
  const blocked = cells.find((cell) => cell.status === "BLOCKED");
  assert.ok(blocked);
  assert.equal(blocked.blockedReason, "INSUFFICIENT_DATA");
  assert.equal(result.fullAvailablePeriod.aggregate.blockedCellCount, 1);
});

test("a losing cell is retained in the results rather than excluded", () => {
  const result = runCrossMarketValidation(loadRequest());
  const evaluated = result.fullAvailablePeriod.cells.filter((cell) => cell.status === "PASS");
  const losers = evaluated.filter((cell) => cell.byCondition.BASE.totalReturn < 0);
  assert.ok(losers.length > 0, "the fixture is expected to contain at least one losing cell");
  assert.equal(evaluated.length, result.fullAvailablePeriod.aggregate.evaluatedCellCount);
});

test("every evaluated cell carries all three cost conditions", () => {
  const result = runCrossMarketValidation(loadRequest());
  for (const cell of result.fullAvailablePeriod.cells) {
    if (cell.status === "BLOCKED") continue;
    for (const condition of ["BASE", "MODERATE", "SEVERE"]) assert.ok(cell.byCondition[condition]);
  }
});

test("the fixed 5/20 benchmark is the production default and is never re-selected per market", () => {
  assert.deepEqual(FIXED_BENCHMARK_PARAMETER, { shortWindow: 5, longWindow: 20 });
  const result = runCrossMarketValidation(loadRequest());
  for (const cell of result.fullAvailablePeriod.cells) {
    if (cell.status === "BLOCKED") continue;
    assert.ok(typeof cell.benchmarks.fixedParameter5x20Return === "number");
    assert.equal(cell.benchmarks.cashReturn, 0);
  }
});

test("every cell records the same declared dataset content hash set", () => {
  const request = loadRequest();
  const result = runCrossMarketValidation(request);
  assert.equal(result.datasets.length, request.datasets.length);
  for (const declared of result.datasets) assert.match(declared.contentSha256, /^[0-9a-f]{64}$/);
});

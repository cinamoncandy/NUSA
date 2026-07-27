const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runCrossMarketValidation, assessGeneralization, assessSizingComparability } = require("../scripts/lib/cross-market-validation-runner.js");

const dir = path.join(__dirname, "fixtures", "cross-market");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));

const cell = (symbol, periodLabel, totalReturn, beatsBuyAndHold = true) => ({
  symbol, periodLabel, status: "PASS", beatsCash: totalReturn > 0, beatsBuyAndHold,
  byCondition: { BASE: { totalReturn, netProfit: totalReturn * 100, maxDrawdown: 0, tradeCount: 5, profitFactor: 1 }, SEVERE: { totalReturn } }
});
const summariesFrom = (cells, keyName) => {
  const keys = [...new Set(cells.map((c) => c[keyName]))].sort();
  return keys.map((key) => {
    const group = cells.filter((c) => c[keyName] === key);
    return {
      key, cellCount: group.length, evaluatedCellCount: group.length,
      positiveCellCount: group.filter((c) => c.byCondition.BASE.totalReturn > 0).length,
      negativeCellCount: group.filter((c) => c.byCondition.BASE.totalReturn < 0).length
    };
  });
};
const assess = (cells, comparable = true) =>
  assessGeneralization(cells, summariesFrom(cells, "symbol"), summariesFrom(cells, "periodLabel"), { comparable });

test("consistently positive results across markets and periods are BROADLY_GENERALIZABLE", () => {
  const cells = [cell("A", "P1", 0.1), cell("A", "P2", 0.1), cell("B", "P1", 0.1), cell("B", "P2", 0.1)];
  assert.equal(assess(cells), "BROADLY_GENERALIZABLE");
});

test("one market winning while another consistently loses is MARKET_CONCENTRATED", () => {
  const cells = [cell("A", "P1", 0.1), cell("A", "P2", 0.1), cell("B", "P1", -0.1), cell("B", "P2", -0.1)];
  assert.equal(assess(cells), "MARKET_CONCENTRATED");
});

test("one period winning while another consistently loses is PERIOD_CONCENTRATED", () => {
  const cells = [cell("A", "P1", 0.1), cell("B", "P1", 0.1), cell("A", "P2", -0.1), cell("B", "P2", -0.1)];
  assert.equal(assess(cells), "PERIOD_CONCENTRATED");
});

test("wins clustered into one market AND one period is MARKET_AND_PERIOD_CONCENTRATED", () => {
  // A wins only in P1; B never wins; P2 never wins. Both axes are split, and the
  // positive ratio stays above the BROADLY_WEAK floor so the concentration branch is
  // the one under test.
  const cells = [
    cell("A", "P1", 0.1), cell("A", "P2", -0.1),
    cell("B", "P1", -0.1), cell("B", "P2", -0.1),
    cell("C", "P1", 0.1), cell("C", "P2", -0.1)
  ];
  assert.equal(assess(cells), "MARKET_AND_PERIOD_CONCENTRATED");
});

test("mostly losing results are BROADLY_WEAK, and that verdict outranks a concentration label", () => {
  // 1 win out of 4 is a 0.25 positive ratio. This is also technically split on both
  // axes, but "weak" is the honest headline when three quarters of the matrix loses.
  const cells = [cell("A", "P1", -0.1), cell("A", "P2", -0.1), cell("B", "P1", -0.1), cell("B", "P2", 0.01)];
  assert.equal(assess(cells), "BROADLY_WEAK");
});

test("a thin matrix with fewer than two markets is INCONCLUSIVE", () => {
  const cells = [cell("A", "P1", 0.1), cell("A", "P2", 0.1)];
  assert.equal(assess(cells), "INCONCLUSIVE");
});

test("incomparable sizing forces INCONCLUSIVE even when every cell is positive", () => {
  const cells = [cell("A", "P1", 0.1), cell("A", "P2", 0.1), cell("B", "P1", 0.1), cell("B", "P2", 0.1)];
  assert.equal(assess(cells, true), "BROADLY_GENERALIZABLE");
  assert.equal(assess(cells, false), "INCONCLUSIVE");
});

test("a fixed quantity across markets at similar price levels is comparable", () => {
  const datasets = [
    { symbol: "A", candles: [{ close: 100_000 }, { close: 101_000 }] },
    { symbol: "B", candles: [{ close: 98_000 }, { close: 99_000 }] }
  ];
  const comparability = assessSizingComparability(datasets, 0.001, 2);
  assert.equal(comparability.comparable, true);
});

test("a fixed quantity across wildly different price levels is NOT comparable", () => {
  const datasets = [
    { symbol: "A", candles: [{ close: 100_000 }, { close: 100_000 }] },
    { symbol: "B", candles: [{ close: 800 }, { close: 800 }] }
  ];
  const comparability = assessSizingComparability(datasets, 0.001, 2);
  assert.equal(comparability.comparable, false);
  assert.equal(comparability.reason, "NOTIONAL_EXPOSURE_SPREAD_EXCEEDS_TOLERANCE");
  assert.ok(comparability.notionalSpreadRatio > 100);
});

test("incomparable sizing suppresses the concentration numbers instead of publishing them", () => {
  const result = runCrossMarketValidation(load("sizing-not-comparable"));
  assert.equal(result.status, "PASS");
  assert.equal(result.sizingComparability.comparable, false);
  assert.equal(result.fullAvailablePeriod.concentration.status, "NOT_COMPARABLE");
  assert.equal(result.fullAvailablePeriod.concentration.byMarket, null);
  assert.ok(result.warnings.some((w) => w.startsWith("CONCENTRATION_NOT_COMPARABLE")));
});

test("NO_CROSS_MARKET_AGGREGATION policy suppresses concentration even when sizing is comparable", () => {
  const request = load("multi-market-multi-period");
  request.comparisonPolicy.aggregationPolicy = "NO_CROSS_MARKET_AGGREGATION";
  const result = runCrossMarketValidation(request);
  assert.equal(result.sizingComparability.comparable, true);
  assert.equal(result.fullAvailablePeriod.concentration.status, "NOT_COMPARABLE");
  assert.equal(result.fullAvailablePeriod.concentration.reason, "AGGREGATION_POLICY_DISABLED");
});

test("synthetic provenance forces researchAssessment to INCONCLUSIVE regardless of the computed pattern", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  assert.equal(result.dataProvenance, "SYNTHETIC_FIXTURE");
  assert.equal(result.executionStatus, "PASS");
  assert.equal(result.researchAssessment, "INCONCLUSIVE");
  assert.ok(result.syntheticPatternObserved !== null, "the computed pattern is still reported, but only as a pipeline result");
  assert.ok(result.warnings.includes("SYNTHETIC_DATA_NO_RESEARCH_CONCLUSION"));
});

test("execution status and research assessment are reported as separate fields", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  assert.notEqual(result.executionStatus, result.researchAssessment);
  assert.ok(typeof result.researchAssessmentBasis === "string");
});

test("selection and survivorship bias are always disclosed", () => {
  const result = runCrossMarketValidation(load("multi-market-multi-period"));
  assert.equal(result.selectionBiasDisclosure.survivorshipBiasPresent, true);
  assert.equal(result.selectionBiasDisclosure.marketsAreResearcherSelected, true);
  assert.equal(result.selectionBiasDisclosure.delistedOrHaltedMarketsIncluded, false);
});

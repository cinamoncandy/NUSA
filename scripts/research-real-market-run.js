"use strict";

const { mapUpbitDayCandlesToResearchCandles } = require("../dist/apps/desktop/src/upbitCandleAdapter.js");
const { createHistoricalDatasetManifest, runWalkForwardExperiment } = require("../dist/apps/desktop/src/researchDataset.js");
const { SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategyEngine.js");

const MARKET = "KRW-BTC";
const CANDLE_COUNT = 200;
const REQUEST_PATH = `/v1/candles/days?market=${MARKET}&count=${CANDLE_COUNT}`;

// Matches the live desktop runtime's own conservative fee/cost assumptions
// (apps/desktop/src/main.ts FEE_RATE, FILL_MODEL) so this research run does not
// silently assume friction-free execution.
const BACKTEST_CONFIG = {
  market: MARKET,
  feeRate: 0.0005,
  orderQuantity: 0.001,
  executionCosts: { spreadBps: 5, slippageBps: 5 }
};

const WALK_FORWARD_CONFIG = {
  trainSize: 120,
  testSize: 20,
  minimumWindows: 2,
  backtestConfig: BACKTEST_CONFIG,
  selectionPolicy: { minimumClosedTrades: 0 }
};

async function fetchRealDayCandles() {
  const response = await fetch(`https://api.upbit.com${REQUEST_PATH}`);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body;
}

async function main() {
  const raw = await fetchRealDayCandles();
  const candles = mapUpbitDayCandlesToResearchCandles(raw);
  const manifest = createHistoricalDatasetManifest(candles, {
    source: "upbit-public-api",
    sourceRequest: `GET ${REQUEST_PATH}`,
    createdAt: new Date().toISOString()
  });

  const result = runWalkForwardExperiment(
    { candles, manifest },
    [{ id: "sma-5-20", strategyFactory: () => new SmaCrossoverStrategy(5, 20), parameters: { shortPeriod: 5, longPeriod: 20 } }],
    WALK_FORWARD_CONFIG,
    { generatedAt: new Date().toISOString() }
  );

  const oos = result.walkForwardResult.combinedOutOfSampleMetrics;
  console.log(JSON.stringify({
    NOTICE: "REAL_MARKET_DATA_RESEARCH_TIER_ONLY -- not operational Paper evidence, does not authorize release",
    dataset: {
      datasetId: manifest.datasetId,
      market: manifest.market,
      interval: manifest.interval,
      candleCount: manifest.candleCount,
      startOpenTime: new Date(manifest.startOpenTime).toISOString(),
      endCloseTime: new Date(manifest.endCloseTime).toISOString(),
      contentSha256: manifest.contentSha256
    },
    windowCount: result.walkForwardResult.windows.length,
    outOfSample: {
      totalOosPoints: oos.totalOosPoints,
      totalOosClosedTrades: oos.totalOosClosedTrades,
      winRate: oos.winRate,
      totalReturn: oos.totalReturn,
      maximumDrawdown: oos.maximumDrawdown,
      profitFactor: oos.profitFactor ?? null,
      turnover: oos.turnover,
      totalTradingCost: oos.totalTradingCost,
      profitableWindowRatio: oos.profitableWindowRatio,
      benchmarkOutperformanceWindowRatio: oos.benchmarkOutperformanceWindowRatio
    },
    warnings: result.warnings
  }, null, 2));
}

main().catch((error) => {
  console.error("research real-market run failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

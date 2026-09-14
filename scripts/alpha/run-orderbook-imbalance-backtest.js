"use strict";
/**
 * Runs the order-book imbalance pipeline end to end against a recorded dataset:
 *
 *   snapshots -> computeOrderbookImbalanceFeature -> evaluateOrderbookImbalanceStrategy
 *             -> runOrderbookImbalanceBacktest -> metrics
 *
 * The strategy, feature and backtest modules already existed and were fully tested; nothing had
 * ever fed them, so the alpha registry held no evidence and no result had ever been produced.
 * This is the missing wiring, not new research.
 *
 *   node scripts/alpha/run-orderbook-imbalance-backtest.js --data ob.jsonl [--json out.json]
 */
const { readFileSync, writeFileSync } = require("node:fs");

const { computeOrderbookImbalanceFeature } = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceFeature.js");
const {
  createInitialOrderbookImbalanceStrategyState,
  evaluateOrderbookImbalanceStrategy,
  recordOrderbookImbalanceTradeOutcome
} = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceStrategy.js");
const { runOrderbookImbalanceBacktest } = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceBacktest.js");

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}
const numeric = (name, fallback) => {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
};

const FEATURE_POLICY = Object.freeze({
  featureVersion: 1,
  depthLevels: 5,
  minimumTotalQuantity: 0.05,
  // Upbit KRW majors sit far inside this; a wider book is refused as untradeable rather than
  // entered at a spread the backtest would have to pretend away.
  maximumSpreadRate: 0.002,
  staleAfterMs: 5_000
});

const STRATEGY_POLICY = Object.freeze({
  strategyVersion: 1,
  minimumBookImbalance: numeric("min-book-imbalance", 0.25),
  minimumQueueImbalance: numeric("min-queue-imbalance", 0.2),
  minimumMicropriceDeviationRate: numeric("min-microprice", 0.00002),
  maximumEntrySpreadRate: numeric("max-entry-spread", 0.0006),
  exitImbalanceAbsolute: numeric("exit-imbalance", 0.08),
  stopMicropriceDeviationRate: numeric("stop-microprice", 0.0004),
  maximumHoldingSnapshots: numeric("max-holding", 20),
  cooldownSnapshots: numeric("cooldown", 3),
  maximumConsecutiveLosses: numeric("max-losses", 4)
});

const BACKTEST_POLICY = Object.freeze({
  engineVersion: 1,
  initialEquity: numeric("equity", 10_000_000),
  notionalPerTrade: numeric("notional", 1_000_000),
  // Upbit KRW spot taker fee is 0.05%. Understating it is the commonest way a microstructure
  // backtest reports an edge it does not have.
  takerFeeRate: numeric("fee", 0.0005),
  slippageRate: numeric("slippage", 0.0002),
  maximumParticipationRate: numeric("participation", 0.1),
  annualizationFactor: numeric("annualization", 365 * 24 * 60 * 60)
});

function main() {
  const dataPath = argument("data", undefined);
  if (dataPath == null) throw new Error("--data <snapshots.jsonl> is required");
  const snapshots = readFileSync(dataPath, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (snapshots.length < 2) throw new Error("at least two snapshots are required");

  // Datasets recorded before the collector carried this guard, or produced elsewhere, can hold
  // books the exchange served out of order. They are dropped, never sorted: reordering would
  // present the strategy a sequence the market never produced.
  const ordered = [];
  let regressed = 0;
  for (const snapshot of snapshots) {
    const previous = ordered[ordered.length - 1];
    if (previous != null && Date.parse(snapshot.capturedAt) <= Date.parse(previous.capturedAt)) { regressed += 1; continue; }
    ordered.push(snapshot);
  }

  const features = [];
  const decisions = [];
  let state = createInitialOrderbookImbalanceStrategyState();
  let skipped = 0;

  for (const snapshot of ordered) {
    let feature;
    // A snapshot the feature refuses is dropped rather than coerced: a book too thin or too wide
    // to trade is not an observation the strategy is entitled to act on.
    try { feature = computeOrderbookImbalanceFeature(snapshot, snapshot.capturedAt, FEATURE_POLICY); }
    catch { skipped += 1; continue; }
    features.push(feature);
    const decision = evaluateOrderbookImbalanceStrategy(`d:${feature.snapshotId}`, feature, state, STRATEGY_POLICY);
    decisions.push(decision);
    state = decision.nextState;
  }

  if (features.length < 2) throw new Error(`only ${features.length} snapshot(s) survived the feature policy`);

  const result = runOrderbookImbalanceBacktest({ features, decisions }, new Date().toISOString(), BACKTEST_POLICY);
  const eligible = features.filter((feature) => feature.eligible).length;
  const actions = decisions.reduce((counts, decision) => ({ ...counts, [decision.action]: (counts[decision.action] ?? 0) + 1 }), {});

  const report = {
    dataset: { path: dataPath, snapshots: snapshots.length, outOfOrderDropped: regressed, features: features.length, skippedByFeaturePolicy: skipped, eligible },
    market: result.market,
    window: { from: features[0].generatedAt, to: features[features.length - 1].generatedAt },
    actions,
    metrics: result.metrics,
    warnings: result.warnings,
    resultHash: result.resultHash,
    policies: { feature: FEATURE_POLICY, strategy: STRATEGY_POLICY, backtest: BACKTEST_POLICY }
  };

  const jsonOut = argument("json", undefined);
  if (jsonOut != null) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();

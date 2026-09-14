"use strict";
/**
 * Measures how the order-book imbalance signal's GROSS edge scales with holding period, against
 * the cost a round trip actually pays.
 *
 * This is a diagnostic, not a parameter search. ADR-0022 recorded that a 20-snapshot hold loses
 * because a round trip costs 0.14% while that horizon offers 0.02-0.05% to capture. The open
 * question is whether gross edge grows with the horizon at all: if gross-per-trade stays near
 * zero as the hold lengthens, no cost structure rescues the signal, and lengthening the hold is
 * not the fix. The whole curve is reported for that reason -- picking the best cell out of a
 * sweep on one dataset would be selection, not evidence.
 *
 * A random-entry control runs at each horizon with the same trade count, so "the signal is
 * informative" can be told apart from "anything held this long looks like this".
 *
 *   node scripts/alpha/diagnose-holding-horizon.js --data ob.jsonl [--holds 5,10,20,40,80,160]
 */
const { readFileSync } = require("node:fs");
const { computeOrderbookImbalanceFeature } = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceFeature.js");
const {
  createInitialOrderbookImbalanceStrategyState,
  evaluateOrderbookImbalanceStrategy
} = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceStrategy.js");
const { runOrderbookImbalanceBacktest } = require("../../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceBacktest.js");

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
};

const FEATURE_POLICY = Object.freeze({ featureVersion: 1, depthLevels: 5, minimumTotalQuantity: 0.05, maximumSpreadRate: 0.002, staleAfterMs: 5_000 });
const BACKTEST_POLICY = Object.freeze({
  engineVersion: 1, initialEquity: 10_000_000, notionalPerTrade: 1_000_000,
  takerFeeRate: 0.0005, slippageRate: 0.0002, maximumParticipationRate: 0.1,
  annualizationFactor: 365 * 24 * 60 * 60
});
const strategyPolicy = (maximumHoldingSnapshots) => Object.freeze({
  strategyVersion: 1, minimumBookImbalance: 0.25, minimumQueueImbalance: 0.2,
  minimumMicropriceDeviationRate: 0.00002, maximumEntrySpreadRate: 0.0006,
  exitImbalanceAbsolute: 0.08, stopMicropriceDeviationRate: 0.0004,
  maximumHoldingSnapshots, cooldownSnapshots: 3, maximumConsecutiveLosses: 4
});

/** Deterministic PRNG so the control is reproducible from the reported seed. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadFeatures(dataPath) {
  const rows = readFileSync(dataPath, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const ordered = [];
  for (const snapshot of rows) {
    const previous = ordered[ordered.length - 1];
    if (previous != null && Date.parse(snapshot.capturedAt) <= Date.parse(previous.capturedAt)) continue;
    ordered.push(snapshot);
  }
  const features = [];
  for (const snapshot of ordered) {
    try { features.push(computeOrderbookImbalanceFeature(snapshot, snapshot.capturedAt, FEATURE_POLICY)); } catch { /* refused book */ }
  }
  return features;
}

function decide(features, policy) {
  const decisions = [];
  let state = createInitialOrderbookImbalanceStrategyState();
  for (const feature of features) {
    const decision = evaluateOrderbookImbalanceStrategy(`d:${feature.snapshotId}`, feature, state, policy);
    decisions.push(decision);
    state = decision.nextState;
  }
  return decisions;
}

/**
 * Replaces the entry SIGN with a coin flip while keeping every entry moment, hold and exit rule
 * identical. What remains is the direction the signal chose, which is the only thing under test.
 */
function randomiseDirection(decisions, random) {
  return decisions.map((decision) => {
    if (decision.action !== "ENTER_LONG" && decision.action !== "ENTER_SHORT") return decision;
    const flipped = random() < 0.5 ? "ENTER_LONG" : "ENTER_SHORT";
    if (flipped === decision.action) return decision;
    const position = flipped === "ENTER_LONG" ? "LONG" : "SHORT";
    return Object.freeze({ ...decision, action: flipped, targetPosition: position, nextState: Object.freeze({ ...decision.nextState, position }) });
  });
}

const per = (value, count) => (count === 0 ? null : Number((value / count).toFixed(2)));

function main() {
  const dataPath = argument("data", undefined);
  if (dataPath == null) throw new Error("--data is required");
  const holds = (argument("holds", "5,10,20,40,80,160")).split(",").map(Number);
  const trials = Number(argument("control-trials", "20"));
  const features = loadFeatures(dataPath);
  if (features.length < 50) throw new Error(`only ${features.length} features; need at least 50`);

  const rows = [];
  for (const hold of holds) {
    const decisions = decide(features, strategyPolicy(hold));
    let result;
    try { result = runOrderbookImbalanceBacktest({ features, decisions }, new Date().toISOString(), BACKTEST_POLICY); }
    catch (error) { rows.push({ hold, error: error instanceof Error ? error.message : "failed" }); continue; }
    const { tradeCount, grossPnl, netPnl, totalFees, totalSlippageCost, winRate } = result.metrics;

    const controlGross = [];
    for (let trial = 0; trial < trials; trial += 1) {
      const random = mulberry32(1_000 + trial * 7919 + hold);
      try {
        const control = runOrderbookImbalanceBacktest({ features, decisions: randomiseDirection(decisions, random) }, new Date().toISOString(), BACKTEST_POLICY);
        controlGross.push(control.metrics.grossPnl);
      } catch { /* a flipped sequence the engine refuses is skipped */ }
    }
    controlGross.sort((a, b) => a - b);
    const median = controlGross.length === 0 ? null : Number(controlGross[Math.floor(controlGross.length / 2)].toFixed(0));
    // Share of coin-flip runs that did WORSE than the signal. Near 0.5 means the direction the
    // signal chose carried no information beyond the entry timing it shares with the control.
    const beaten = controlGross.length === 0 ? null : Number((controlGross.filter((value) => value < grossPnl).length / controlGross.length).toFixed(2));

    rows.push({
      hold, trades: tradeCount, winRate: Number(winRate.toFixed(3)),
      grossPerTrade: per(grossPnl, tradeCount),
      costPerTrade: per(totalFees + totalSlippageCost, tradeCount),
      netPerTrade: per(netPnl, tradeCount),
      controlGrossMedian: median, signalBeatsControl: beaten
    });
  }

  console.log(JSON.stringify({
    dataset: { path: dataPath, features: features.length },
    note: "In-sample diagnostic over one dataset. No cell here is a validated parameter.",
    controlTrials: trials,
    rows
  }, null, 2));
}

main();

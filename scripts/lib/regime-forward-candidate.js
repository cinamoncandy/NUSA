"use strict";

// Offline research only. The canonical engine owns execution, costs and accounting.
const { classifyPriceRegime } = require("../../dist/packages/core/src/regimePolicy.js");
const { SmaCrossoverStrategy } = require("../../dist/packages/core/src/strategyEngine.js");
const { runBacktest } = require("../../dist/apps/desktop/src/strategy/backtestEngine.js");

function maskResearchEntry(signal, tick, prices) {
  if (signal.type !== "BUY") return signal;
  const regime = classifyPriceRegime([...prices.slice(-20), tick.price], tick.timestamp);
  if (regime === "STRONG_UPTREND" || regime === "WEAK_UPTREND") return signal;
  return { ...signal, type: "HOLD", confidence: 0, reason: "RESEARCH_ENTRY_REGIME_BLOCKED" };
}

function createRegimeCandidate() {
  const underlying = new SmaCrossoverStrategy(20, 100);
  return {
    id: underlying.id,
    name: "Research SMA 20/100 upward-regime entry mask",
    onTick(tick, context) {
      return maskResearchEntry(underlying.onTick(tick, context), tick, context.prices);
    },
    reset() { underlying.reset(); },
  };
}

function evaluateRegimeCandidate(points, config) {
  // Both runs receive identical caller-owned input and canonical execution config.
  // This API does not claim a dataset is held out or qualified for deployment.
  return {
    authority: "RESEARCH_ONLY",
    candidate: runBacktest(points, createRegimeCandidate, config),
    comparator: runBacktest(points, () => new SmaCrossoverStrategy(20, 100), config),
  };
}

module.exports = { maskResearchEntry, createRegimeCandidate, evaluateRegimeCandidate };

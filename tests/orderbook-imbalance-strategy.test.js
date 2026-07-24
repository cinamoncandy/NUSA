const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  createInitialOrderbookImbalanceStrategyState,
  evaluateOrderbookImbalanceStrategy,
  recordOrderbookImbalanceTradeOutcome
} = require("../dist/apps/cloud/src/alpha/orderbook/OrderbookImbalanceStrategy.js");

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const feature = (overrides = {}) => Object.freeze({
  featureVersion: 1,
  snapshotId: "S-1",
  market: "BTCUSDT",
  generatedAt: "2026-01-01T00:00:00.000Z",
  bestBid: 99,
  bestAsk: 101,
  midPrice: 100,
  spread: 2,
  spreadRate: 0.0005,
  bidQuantity: 80,
  askQuantity: 20,
  bookImbalance: 0.6,
  queueImbalance: 0.7,
  microprice: 100.1,
  micropriceDeviationRate: 0.001,
  depthLevelsUsed: 2,
  eligible: true,
  reasons: Object.freeze(["FEATURE_ELIGIBLE"]),
  provenance: Object.freeze(["S-1", "TEST"]),
  contentHash: hash({ seed: overrides.seed || "BASE" }),
  ...overrides
});

const policy = Object.freeze({
  strategyVersion: 1,
  minimumBookImbalance: 0.4,
  minimumQueueImbalance: 0.4,
  minimumMicropriceDeviationRate: 0.0005,
  maximumEntrySpreadRate: 0.001,
  exitImbalanceAbsolute: 0.1,
  stopMicropriceDeviationRate: 0.001,
  maximumHoldingSnapshots: 3,
  cooldownSnapshots: 2,
  maximumConsecutiveLosses: 2
});

test("enters long and short deterministically", () => {
  const state = createInitialOrderbookImbalanceStrategyState();
  const longA = evaluateOrderbookImbalanceStrategy("D-1", feature(), state, policy);
  const longB = evaluateOrderbookImbalanceStrategy("D-1", feature(), state, policy);
  assert.deepEqual(longA, longB);
  assert.equal(longA.action, "ENTER_LONG");
  assert.equal(longA.targetPosition, "LONG");
  assert.match(longA.contentHash, /^[a-f0-9]{64}$/);
  const short = evaluateOrderbookImbalanceStrategy("D-2", feature({ seed: "SHORT", bookImbalance: -0.7, queueImbalance: -0.8, micropriceDeviationRate: -0.001 }), state, policy);
  assert.equal(short.action, "ENTER_SHORT");
  assert.equal(short.targetPosition, "SHORT");
});

test("abstains for ineligible, cooldown, spread, and weak signals", () => {
  const flat = createInitialOrderbookImbalanceStrategyState();
  assert.equal(evaluateOrderbookImbalanceStrategy("D-1", feature({ eligible: false, reasons: Object.freeze(["SNAPSHOT_STALE"]) }), flat, policy).action, "ABSTAIN");
  assert.equal(evaluateOrderbookImbalanceStrategy("D-2", feature(), Object.freeze({ ...flat, cooldownRemaining: 1 }), policy).reasons[0], "COOLDOWN_ACTIVE");
  assert.equal(evaluateOrderbookImbalanceStrategy("D-3", feature({ spreadRate: 0.01 }), flat, policy).reasons[0], "ENTRY_SPREAD_TOO_WIDE");
  assert.equal(evaluateOrderbookImbalanceStrategy("D-4", feature({ bookImbalance: 0.1, queueImbalance: 0.1, micropriceDeviationRate: 0 }), flat, policy).reasons[0], "ENTRY_THRESHOLDS_NOT_MET");
});

test("holds then exits on mean reversion, stop, time, or liquidity failure", () => {
  const longState = Object.freeze({ position: "LONG", holdingSnapshots: 1, cooldownRemaining: 0, consecutiveLosses: 0 });
  const hold = evaluateOrderbookImbalanceStrategy("D-1", feature(), longState, policy);
  assert.equal(hold.action, "HOLD");
  assert.equal(hold.nextState.holdingSnapshots, 2);
  const mean = evaluateOrderbookImbalanceStrategy("D-2", feature({ bookImbalance: 0.05 }), longState, policy);
  assert.equal(mean.action, "EXIT");
  assert.ok(mean.reasons.includes("IMBALANCE_MEAN_REVERTED"));
  const stop = evaluateOrderbookImbalanceStrategy("D-3", feature({ micropriceDeviationRate: -0.002 }), longState, policy);
  assert.ok(stop.reasons.includes("ADVERSE_MICROPRICE_STOP"));
  const timed = evaluateOrderbookImbalanceStrategy("D-4", feature(), Object.freeze({ ...longState, holdingSnapshots: 3 }), policy);
  assert.ok(timed.reasons.includes("MAXIMUM_HOLDING_REACHED"));
  const liquidity = evaluateOrderbookImbalanceStrategy("D-5", feature({ eligible: false }), longState, policy);
  assert.equal(liquidity.action, "EXIT");
  assert.ok(liquidity.reasons.includes("LIQUIDITY_GUARD_EXIT"));
});

test("enforces consecutive-loss guard and validates state", () => {
  let state = createInitialOrderbookImbalanceStrategyState();
  state = recordOrderbookImbalanceTradeOutcome(state, false);
  state = recordOrderbookImbalanceTradeOutcome(state, false);
  const blocked = evaluateOrderbookImbalanceStrategy("D-1", feature(), state, policy);
  assert.equal(blocked.action, "ABSTAIN");
  assert.ok(blocked.reasons.includes("CONSECUTIVE_LOSS_GUARD"));
  assert.equal(recordOrderbookImbalanceTradeOutcome(state, true).consecutiveLosses, 0);
  assert.throws(() => recordOrderbookImbalanceTradeOutcome(Object.freeze({ position: "LONG", holdingSnapshots: 1, cooldownRemaining: 0, consecutiveLosses: 0 }), false), /only be recorded while flat/);
});

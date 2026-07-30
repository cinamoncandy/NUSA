"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StrategyRegistry } = require("../apps/desktop/src/strategyRegistry");

function registration(overrides = {}) {
  const descriptor = {
    id: "test-strategy",
    name: "Test Strategy",
    version: "1.0.0",
    markets: ["KRW-BTC"],
    timeframes: ["1m"],
    riskProfile: "BALANCED",
    requiredHistory: 20,
    lifecycle: "PAPER",
    ...overrides
  };

  return {
    descriptor,
    create: () => ({
      id: descriptor.id,
      name: descriptor.name,
      onTick: (tick) => ({ type: "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp }),
      reset: () => {}
    })
  };
}

test("registers and creates independent strategy instances", () => {
  const registry = new StrategyRegistry();
  registry.register(registration());

  assert.equal(registry.size(), 1);
  assert.equal(registry.require("test-strategy", "1.0.0").descriptor.name, "Test Strategy");
  assert.notEqual(registry.create("test-strategy", "1.0.0"), registry.create("test-strategy", "1.0.0"));
});

test("rejects duplicate strategy versions", () => {
  const registry = new StrategyRegistry();
  registry.register(registration());

  assert.throws(() => registry.register(registration()), /already registered/);
});

test("rejects a factory whose strategy id disagrees with metadata", () => {
  const registry = new StrategyRegistry();
  const candidate = registration();
  candidate.create = () => ({ id: "different", name: "Different", onTick: () => ({ type: "HOLD", reason: "test", confidence: 0, timestamp: 0 }), reset: () => {} });

  assert.throws(() => registry.register(candidate), /factory id mismatch/);
  assert.equal(registry.size(), 0);
});

test("filters active strategies deterministically by market and timeframe", () => {
  const registry = new StrategyRegistry();
  registry.register(registration({ id: "zeta", version: "2.0.0", markets: ["KRW-ETH", "KRW-BTC"], timeframes: ["5m", "1m"] }));
  registry.register(registration({ id: "alpha", version: "1.0.0" }));
  registry.register(registration({ id: "retired", version: "1.0.0", lifecycle: "RETIRED" }));

  assert.deepEqual(registry.findForMarket("KRW-BTC", "1m").map((item) => item.descriptor.id), ["alpha", "zeta"]);
  assert.deepEqual(registry.list().map((item) => item.descriptor.id), ["alpha", "retired", "zeta"]);
});

test("normalizes descriptor lists and protects registry metadata", () => {
  const registry = new StrategyRegistry();
  registry.register(registration({ markets: ["KRW-ETH", "KRW-BTC", "KRW-BTC"], timeframes: ["5m", "1m"] }));

  const descriptor = registry.require("test-strategy", "1.0.0").descriptor;
  assert.deepEqual(descriptor.markets, ["KRW-BTC", "KRW-ETH"]);
  assert.deepEqual(descriptor.timeframes, ["1m", "5m"]);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.markets), true);
});

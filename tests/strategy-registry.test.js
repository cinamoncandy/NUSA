"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { StrategyRegistry } = require("../dist/apps/desktop/src/strategy/strategyRegistry.js");

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

const hash = `sha256:${"a".repeat(64)}`;

test("registers deterministic metadata and creates independent strategy instances", () => {
  const registry = new StrategyRegistry();
  registry.register(registration());

  const descriptor = registry.require("test-strategy", "1.0.0").descriptor;
  assert.equal(registry.size(), 1);
  assert.equal(descriptor.identityKey, "test-strategy@1.0.0");
  assert.equal(descriptor.governanceRole, "RESEARCH");
  assert.equal(descriptor.executionAuthority, "NONE");
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

test("filters active strategies deterministically by market, timeframe, and governance role", () => {
  const registry = new StrategyRegistry();
  registry.register(registration({ id: "zeta", version: "2.0.0", markets: ["KRW-ETH", "KRW-BTC"], timeframes: ["5m", "1m"], lifecycle: "CHALLENGER" }));
  registry.register(registration({ id: "alpha", version: "1.0.0", lifecycle: "CHAMPION" }));
  registry.register(registration({ id: "retired", version: "1.0.0", lifecycle: "RETIRED" }));

  assert.deepEqual(registry.findForMarket("KRW-BTC", "1m").map((item) => item.descriptor.id), ["alpha", "zeta"]);
  assert.deepEqual(registry.findByGovernanceRole("CHAMPION").map((item) => item.descriptor.id), ["alpha"]);
  assert.deepEqual(registry.findByGovernanceRole("CHALLENGER").map((item) => item.descriptor.id), ["zeta"]);
  assert.deepEqual(registry.list().map((item) => item.descriptor.id), ["alpha", "retired", "zeta"]);
});

test("normalizes, deduplicates, sorts, and freezes descriptor metadata", () => {
  const registry = new StrategyRegistry();
  registry.register(registration({
    markets: ["KRW-ETH", "KRW-BTC", "KRW-BTC"],
    timeframes: ["5m", "1m", "1m"],
    tags: ["beta", "alpha", "beta"],
    identity: { id: "test-strategy", version: "1.0.0", canonicalHash: hash }
  }));

  const descriptor = registry.require("test-strategy", "1.0.0").descriptor;
  assert.deepEqual(descriptor.markets, ["KRW-BTC", "KRW-ETH"]);
  assert.deepEqual(descriptor.timeframes, ["1m", "5m"]);
  assert.deepEqual(descriptor.tags, ["alpha", "beta"]);
  assert.deepEqual(descriptor.identity, { id: "test-strategy", version: "1.0.0", canonicalHash: hash });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.markets), true);
  assert.equal(Object.isFrozen(descriptor.timeframes), true);
  assert.equal(Object.isFrozen(descriptor.tags), true);
  assert.equal(Object.isFrozen(descriptor.identity), true);
});

test("validates identity references and current research timeframe vocabulary", () => {
  const registry = new StrategyRegistry();
  assert.throws(() => registry.register(registration({ identity: { id: "other", version: "1.0.0", canonicalHash: hash } })), /identity reference mismatch/);
  assert.throws(() => registry.register(registration({ identity: { id: "test-strategy", version: "1.0.0", canonicalHash: "bad" } })), /canonicalHash/);
  assert.throws(() => registry.register(registration({ timeframes: ["2m"] })), /unsupported research timeframe/);
  assert.equal(registry.size(), 0);
});

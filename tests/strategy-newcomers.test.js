"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BollingerBreakoutStrategy,
  MacdMomentumStrategy,
  RsiMeanReversionStrategy,
  SmaCrossoverStrategy,
  StrategyEngine,
} = require("../dist/packages/core/src/strategyEngine.js");
const { StrategyRegistry } = require("../dist/apps/desktop/src/strategy/strategyRegistry.js");

const FACTORIES = {
  "sma-crossover": () => new SmaCrossoverStrategy(5, 20),
  "rsi-mean-reversion": () => new RsiMeanReversionStrategy(14, 30, 70),
  "bollinger-breakout": () => new BollingerBreakoutStrategy(20, 2),
  "macd-momentum": () => new MacdMomentumStrategy(12, 26, 9),
};

function drive(factory, prices, startTimestamp = 1_000) {
  const engine = new StrategyEngine(factory());
  engine.start();
  return prices.map((price, index) =>
    engine.onTick({ market: "KRW-BTC", price, timestamp: startTimestamp + index }, 0)
  );
}

function reasons(signals) {
  return signals.map((signal) => `${signal.type}:${signal.reason}`);
}

test("newcomers reject invalid construction parameters", () => {
  assert.throws(() => new RsiMeanReversionStrategy(1), /invalid RSI period/);
  assert.throws(() => new RsiMeanReversionStrategy(14, 70, 30), /invalid RSI thresholds/);
  assert.throws(() => new RsiMeanReversionStrategy(14, 0, 70), /invalid RSI thresholds/);
  assert.throws(() => new BollingerBreakoutStrategy(1), /invalid Bollinger period/);
  assert.throws(() => new BollingerBreakoutStrategy(20, 0), /invalid Bollinger multiplier/);
  assert.throws(() => new MacdMomentumStrategy(26, 12, 9), /invalid MACD periods/);
  assert.throws(() => new MacdMomentumStrategy(12, 26, 1), /invalid MACD period/);
  assert.equal(new RsiMeanReversionStrategy().id, "rsi-mean-reversion");
  assert.equal(new BollingerBreakoutStrategy().id, "bollinger-breakout");
  assert.equal(new MacdMomentumStrategy().id, "macd-momentum");
});

test("newcomers hold during warm-up with zero confidence", () => {
  for (const create of Object.values(FACTORIES)) {
    const signals = drive(create, [100, 101, 102]);
    assert.equal(signals[0].type, "HOLD");
    assert.equal(signals[0].reason, "warming-up");
    assert.equal(signals[0].confidence, 0);
  }
});

test("RSI buys recovery from oversold and sells rejection from overbought", () => {
  const decline = Array.from({ length: 15 }, (_, index) => 100 - index);
  const recovery = drive(FACTORIES["rsi-mean-reversion"], [...decline, 95, 97, 99]);
  assert.ok(
    reasons(recovery).includes("BUY:rsi-recovered-from-oversold"),
    `expected oversold recovery BUY, got ${reasons(recovery).join(",")}`
  );
  const rally = Array.from({ length: 15 }, (_, index) => 86 + index);
  const rejection = drive(FACTORIES["rsi-mean-reversion"], [...rally, 95, 93, 91]);
  assert.ok(
    reasons(rejection).includes("SELL:rsi-rejected-from-overbought"),
    `expected overbought rejection SELL, got ${reasons(rejection).join(",")}`
  );
});

test("Bollinger buys upper-band breakout and sells lower-band breakdown at exact ticks", () => {
  const flat = Array.from({ length: 20 }, () => 100);
  const breakout = drive(FACTORIES["bollinger-breakout"], [...flat, 103]);
  assert.deepEqual(
    [breakout.at(-1).type, breakout.at(-1).reason],
    ["BUY", "close-broke-above-upper-band"]
  );
  const reset = Array.from({ length: 20 }, () => 103);
  const breakdown = drive(FACTORIES["bollinger-breakout"], [...flat, 103, ...reset, 100]);
  assert.deepEqual(
    [breakdown.at(-1).type, breakdown.at(-1).reason],
    ["SELL", "close-broke-below-lower-band"]
  );
  for (const signal of [...breakout, ...breakdown]) {
    assert.ok(signal.confidence >= 0 && signal.confidence <= 1, `confidence out of bounds: ${signal.confidence}`);
  }
});

test("MACD buys sustained rallies and sells sustained declines", () => {
  const down = (count, from) => Array.from({ length: count }, (_, index) => from - index);
  const up = (count, from) => Array.from({ length: count }, (_, index) => from + index);
  const rallySignals = drive(FACTORIES["macd-momentum"], [...down(40, 140), ...up(30, 100)]);
  assert.ok(
    rallySignals.some((signal) => signal.type === "BUY" && signal.reason === "macd-crossed-above-signal"),
    `expected MACD BUY, got ${reasons(rallySignals).join(",")}`
  );
  const declineSignals = drive(FACTORIES["macd-momentum"], [...up(40, 100), ...down(30, 140)]);
  assert.ok(
    declineSignals.some((signal) => signal.type === "SELL" && signal.reason === "macd-crossed-below-signal"),
    `expected MACD SELL, got ${reasons(declineSignals).join(",")}`
  );
  for (const signal of [...rallySignals, ...declineSignals]) {
    assert.ok(signal.confidence >= 0 && signal.confidence <= 1, `confidence out of bounds: ${signal.confidence}`);
    assert.ok(Number.isSafeInteger(signal.timestamp));
  }
});

test("newcomers re-establish baseline after reset", () => {
  const series = Array.from({ length: 45 }, (_, index) => 100 + Math.sin(index) * 5 + index * 0.2);
  for (const [id, create] of Object.entries(FACTORIES)) {
    if (id === "sma-crossover") continue;
    const strategy = create();
    const engine = new StrategyEngine(strategy);
    engine.start();
    series.forEach((price, index) => engine.onTick({ market: "KRW-BTC", price, timestamp: 1_000 + index }, 0));
    strategy.reset();
    const next = engine.onTick({ market: "KRW-BTC", price: series.at(-1), timestamp: 2_000 }, 0);
    assert.equal(next.reason, "baseline-established", `${id} did not re-establish baseline after reset`);
  }
});

test("newcomers register as PAPER strategies with zero execution authority", () => {
  const registry = new StrategyRegistry();
  const descriptors = {
    "rsi-mean-reversion": { name: "RSI Mean Reversion", requiredHistory: 15 },
    "bollinger-breakout": { name: "Bollinger Breakout", requiredHistory: 20 },
    "macd-momentum": { name: "MACD Momentum", requiredHistory: 35 },
  };
  for (const [id, meta] of Object.entries(descriptors)) {
    registry.register({
      descriptor: {
        id,
        name: meta.name,
        version: "1.0.0",
        markets: ["KRW-BTC"],
        timeframes: ["1m"],
        riskProfile: "BALANCED",
        requiredHistory: meta.requiredHistory,
        lifecycle: "PAPER",
      },
      create: FACTORIES[id],
    });
  }
  assert.equal(registry.size(), 3);
  for (const id of Object.keys(descriptors)) {
    const descriptor = registry.require(id, "1.0.0").descriptor;
    assert.equal(descriptor.executionAuthority, "NONE");
    assert.equal(descriptor.lifecycle, "PAPER");
    assert.equal(registry.create(id, "1.0.0").id, id);
  }
});

test("all strategies are trailing-only: future candles never rewrite past signals", () => {
  const prices = Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index * 0.7) * 8 + index * 0.1);
  for (const [id, create] of Object.entries(FACTORIES)) {
    const prefix = drive(create, prices.slice(0, 40), 1_000);
    const extended = drive(create, prices, 1_000);
    assert.deepEqual(
      extended.slice(0, 40),
      prefix,
      `${id} rewrote past signals after seeing future candles (lookahead bias)`
    );
  }
});

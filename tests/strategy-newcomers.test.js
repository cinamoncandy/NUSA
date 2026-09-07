"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BollingerBreakoutStrategy,
  DonchianBreakoutStrategy,
  MacdMomentumStrategy,
  RegimeGatedStrategy,
  RsiMeanReversionStrategy,
  SmaCrossoverStrategy,
  StochasticOscillatorStrategy,
  StrategyEngine,
} = require("../dist/packages/core/src/strategyEngine.js");
const { StrategyRegistry } = require("../dist/apps/desktop/src/strategy/strategyRegistry.js");

const FACTORIES = {
  "sma-crossover": () => new SmaCrossoverStrategy(5, 20),
  "rsi-mean-reversion": () => new RsiMeanReversionStrategy(14, 30, 70),
  "bollinger-breakout": () => new BollingerBreakoutStrategy(20, 2),
  "macd-momentum": () => new MacdMomentumStrategy(12, 26, 9),
  "stochastic-oscillator": () => new StochasticOscillatorStrategy(14, 3, 20, 80),
  "donchian-breakout": () => new DonchianBreakoutStrategy(20),
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
  assert.throws(() => new StochasticOscillatorStrategy(1), /invalid Stochastic period/);
  assert.throws(() => new StochasticOscillatorStrategy(14, 3, 80, 20), /invalid Stochastic thresholds/);
  assert.equal(new RsiMeanReversionStrategy().id, "rsi-mean-reversion");
  assert.equal(new BollingerBreakoutStrategy().id, "bollinger-breakout");
  assert.equal(new MacdMomentumStrategy().id, "macd-momentum");
  assert.equal(new StochasticOscillatorStrategy().id, "stochastic-oscillator");
  assert.equal(new DonchianBreakoutStrategy(20).id, "donchian-breakout");
  assert.throws(() => new DonchianBreakoutStrategy(1), /invalid Donchian period/);
  assert.throws(() => new RegimeGatedStrategy(null), /requires an inner strategy/);
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

test("Stochastic buys oversold recovery and sells overbought rejection", () => {
  const decline = Array.from({ length: 16 }, (_, index) => 100 - index);
  const recovery = drive(FACTORIES["stochastic-oscillator"], [...decline, 90, 93, 96]);
  assert.ok(
    reasons(recovery).includes("BUY:stochastic-recovered-from-oversold"),
    `expected stochastic recovery BUY, got ${reasons(recovery).join(",")}`
  );
  const rally = Array.from({ length: 16 }, (_, index) => 84 + index);
  const rejection = drive(FACTORIES["stochastic-oscillator"], [...rally, 94, 91, 88]);
  assert.ok(
    reasons(rejection).includes("SELL:stochastic-rejected-from-overbought"),
    `expected stochastic rejection SELL, got ${reasons(rejection).join(",")}`
  );
});

test("Donchian buys channel breakout and sells breakdown at exact ticks", () => {
  const flat = Array.from({ length: 21 }, () => 100);
  const breakout = drive(FACTORIES["donchian-breakout"], [...flat, 105]);
  assert.deepEqual(
    [breakout.at(-1).type, breakout.at(-1).reason],
    ["BUY", "close-broke-above-donchian-channel"]
  );
  const reset = Array.from({ length: 21 }, () => 105);
  const breakdown = drive(FACTORIES["donchian-breakout"], [...flat, 105, ...reset, 100]);
  assert.deepEqual(
    [breakdown.at(-1).type, breakdown.at(-1).reason],
    ["SELL", "close-broke-below-donchian-channel"]
  );
});

test("regime gate suppresses entries in forbidden regimes but never exits", () => {
  const alwaysBuy = {
    id: "stub-always-buy",
    name: "Stub Always Buy",
    onTick: (tick) => ({ type: "BUY", reason: "stub", confidence: 1, timestamp: tick.timestamp }),
    reset: () => {},
  };
  const gated = new RegimeGatedStrategy(alwaysBuy);
  assert.equal(gated.id, "stub-always-buy+regime-gate");
  assert.equal(gated.name, "Stub Always Buy + Regime Gate");
  const decline = Array.from({ length: 30 }, (_, index) => 100 - index);
  const gatedSignals = drive(() => gated, decline);
  assert.ok(gatedSignals.length > 0);
  // Classifier warm-up passes through; once the regime resolves, entries stop.
  assert.ok(gatedSignals.slice(0, 5).every((signal) => signal.type === "BUY"));
  for (const signal of gatedSignals.slice(-5)) {
    assert.equal(signal.type, "HOLD");
    assert.match(signal.reason, /^regime-gated:(STRONG_DOWNTREND|HIGH_VOLATILITY)$/);
    assert.equal(signal.confidence, 0);
  }
  const alwaysSell = {
    id: "stub-always-sell",
    name: "Stub Always Sell",
    onTick: (tick) => ({ type: "SELL", reason: "stub", confidence: 1, timestamp: tick.timestamp }),
    reset: () => {},
  };
  const sellSignals = drive(() => new RegimeGatedStrategy(alwaysSell), decline);
  assert.ok(sellSignals.every((signal) => signal.type === "SELL"), "gate must never suppress exits");
});

test("regime gate passes signals when the regime is unknown or allowed", () => {
  const alwaysBuy = {
    id: "stub-always-buy",
    name: "Stub Always Buy",
    onTick: (tick) => ({ type: "BUY", reason: "stub", confidence: 1, timestamp: tick.timestamp }),
    reset: () => {},
  };
  const short = drive(() => new RegimeGatedStrategy(alwaysBuy), [100, 101, 102]);
  assert.ok(short.every((signal) => signal.type === "BUY"), "unknown regime must pass through");
  const custom = new RegimeGatedStrategy(alwaysBuy, ["SIDEWAYS"]);
  const sideways = Array.from({ length: 30 }, (_, index) => 100 + ((index % 2 === 0) ? 0.05 : -0.05));
  const { classifyPriceRegime } = require("../dist/packages/core/src/regimePolicy.js");
  assert.equal(
    classifyPriceRegime(sideways, 2_000),
    "SIDEWAYS",
    "fixture must produce SIDEWAYS or the gate assertion below is vacuous"
  );
  const customSignals = drive(() => custom, sideways);
  assert.equal(customSignals.at(-1).type, "HOLD");
  assert.equal(customSignals.at(-1).reason, "regime-gated:SIDEWAYS");
});

test("regime gate delegates reset to the inner strategy", () => {
  let resets = 0;
  const inner = {
    id: "stub",
    name: "stub",
    onTick: (tick) => ({ type: "HOLD", reason: "stub", confidence: 0, timestamp: tick.timestamp }),
    reset: () => { resets += 1; },
  };
  new RegimeGatedStrategy(inner).reset();
  assert.equal(resets, 1);
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
    "stochastic-oscillator": { name: "Stochastic Oscillator", requiredHistory: 16 },
    "donchian-breakout": { name: "Donchian Breakout", requiredHistory: 21 },
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
  assert.equal(registry.size(), 5);
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

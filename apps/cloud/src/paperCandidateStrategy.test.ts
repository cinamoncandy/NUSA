import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

const spec: PaperCandidateStrategySpec = Object.freeze({
  candidateId: "candidate-a",
  familyId: "sma-crossover",
  lineageId: "sma-v1",
  specificationHash: "a".repeat(64),
  codeSha: "b".repeat(40),
  costModelVersion: "cost-v1",
  parameters: Object.freeze({ shortPeriod: 2, longPeriod: 3 }),
});

function observations(prices: readonly number[]): readonly IntelligenceObservation[] {
  return Object.freeze(prices.map((price, index) => Object.freeze({
    id: `tick-${index}`,
    source: "CHART" as const,
    market: "KRW-BTC",
    price,
    sentiment: 0,
    confidence: 1,
    observedAt: index + 1,
    expiresAt: 100,
    summary: `price=${price}`,
  })));
}

describe("PAPER candidate strategy semantics", () => {
  it("uses the bound SMA parameters to produce a deterministic direction", () => {
    const rising = evaluatePaperCandidateStrategy(spec, observations([100, 101, 103]), 10, "KRW-BTC");
    const falling = evaluatePaperCandidateStrategy(spec, observations([103, 101, 100]), 10, "KRW-BTC");
    assert.equal(rising.action, "BUY");
    assert.equal(falling.action, "SELL");
    assert.equal(rising.reason, "SMA_CROSSOVER:2/3:short=102:long=101.3333");
    assert.deepEqual(rising, evaluatePaperCandidateStrategy(spec, [...observations([100, 101, 103])].reverse().reverse(), 10, "KRW-BTC"));
  });

  it("waits without fabricating a signal until the exact lookback is available", () => {
    const result = evaluatePaperCandidateStrategy(spec, observations([100, 101]), 10, "KRW-BTC");
    assert.equal(result.action, "WAIT");
    assert.equal(result.score, 0);
    assert.match(result.reason, /^INSUFFICIENT_SMA_OBSERVATIONS:/);
  });


  it("replays exact RSI mean-reversion crossing semantics from the immutable binding", () => {
    const rsiSpec: PaperCandidateStrategySpec = Object.freeze({
      ...spec,
      candidateId: "rsi-2-40-60",
      familyId: "rsi-mean-reversion",
      lineageId: "rsi-v1",
      parameters: Object.freeze({ period: 2, oversold: 40, overbought: 60 }),
    });
    const recovered = evaluatePaperCandidateStrategy(rsiSpec, observations([100, 90, 80, 100]), 10, "KRW-BTC");
    const rejected = evaluatePaperCandidateStrategy(rsiSpec, observations([100, 110, 120, 100]), 10, "KRW-BTC");
    assert.equal(recovered.action, "BUY");
    assert.equal(rejected.action, "SELL");
    assert.match(recovered.reason, /^RSI_MEAN_REVERSION:2:40\/60:/);
  });

  it("RSI waits until enough point-in-time observations exist", () => {
    const rsiSpec: PaperCandidateStrategySpec = Object.freeze({
      ...spec, familyId: "rsi-mean-reversion", parameters: Object.freeze({ period: 14, oversold: 30, overbought: 70 }),
    });
    const result = evaluatePaperCandidateStrategy(rsiSpec, observations([100, 99, 98]), 10, "KRW-BTC");
    assert.equal(result.action, "WAIT");
    assert.match(result.reason, /^INSUFFICIENT_RSI_OBSERVATIONS:/);
  });


  it("replays exact Donchian breakout transition semantics from the immutable binding", () => {
    const donchianSpec: PaperCandidateStrategySpec = Object.freeze({
      ...spec,
      candidateId: "donchian-2",
      familyId: "donchian-breakout",
      lineageId: "donchian-breakout-v1",
      parameters: Object.freeze({ channelPeriod: 2 }),
    });
    const baseline = evaluatePaperCandidateStrategy(donchianSpec, observations([100, 101, 102]), 10, "KRW-BTC");
    const breakout = evaluatePaperCandidateStrategy(donchianSpec, observations([100, 101, 101, 103]), 10, "KRW-BTC");
    const breakdown = evaluatePaperCandidateStrategy(donchianSpec, observations([103, 102, 102, 100]), 10, "KRW-BTC");
    assert.equal(baseline.action, "HOLD", "first eligible observation establishes the same stateful baseline as the core strategy");
    assert.equal(breakout.action, "BUY");
    assert.equal(breakdown.action, "SELL");
    assert.match(breakout.reason, /^DONCHIAN_BREAKOUT:2:prior=0:current=1:/);
  });

  it("Donchian excludes the current observation from its channel and waits before a baseline exists", () => {
    const donchianSpec: PaperCandidateStrategySpec = Object.freeze({
      ...spec, familyId: "donchian-breakout", parameters: Object.freeze({ channelPeriod: 3 }),
    });
    const short = evaluatePaperCandidateStrategy(donchianSpec, observations([100, 101, 102]), 10, "KRW-BTC");
    const selfExtension = evaluatePaperCandidateStrategy(donchianSpec, observations([100, 101, 102, 103]), 10, "KRW-BTC");
    assert.equal(short.action, "WAIT");
    assert.match(short.reason, /^INSUFFICIENT_DONCHIAN_OBSERVATIONS:/);
    assert.equal(selfExtension.action, "HOLD", "the first breakout-shaped close establishes baseline instead of self-confirming a trade");
  });

  it("fails closed for an unsupported candidate family", () => {
    assert.throws(() => evaluatePaperCandidateStrategy({ ...spec, familyId: "unknown-family" }, observations([100, 101, 103]), 10, "KRW-BTC"), /unsupported PAPER candidate strategy family/);
  });
});

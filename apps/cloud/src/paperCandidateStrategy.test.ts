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

  it("fails closed for an unsupported candidate family", () => {
    assert.throws(() => evaluatePaperCandidateStrategy({ ...spec, familyId: "unknown-family" }, observations([100, 101, 103]), 10, "KRW-BTC"), /unsupported PAPER candidate strategy family/);
  });
});

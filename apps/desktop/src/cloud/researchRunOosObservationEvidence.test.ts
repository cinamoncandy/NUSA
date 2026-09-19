import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResearchRunOosObservations, ResearchRunOosObservationError } from "./researchRunOosObservationEvidence";
import { runBacktest, type BacktestPoint, type BacktestResult } from "../strategy/backtestEngine";
import type { MarketTick, StrategyContext, TradingStrategy } from "../strategy/strategyEngine";

function runResearchFixture(): any {
  const points = [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }];
  return {
    manifest: { datasetId: "dataset-a", market: "KRW-BTC" },
    experimentConfig: { candidates: [{ id: "candidate-a" }] },
    walkForwardResult: { windows: [{ window: { index: 0, testPoints: points }, testResult: { decisions: [{ timestamp: 1, market: "KRW-BTC", price: 100, signal: { type: "BUY", reason: "fixture-signal", confidence: 0.8, timestamp: 1 }, outcome: "FILLED", equityBefore: 1000, equityAfter: 1000, executionPrice: 100 }] } }] },
  };
}

function buyOnceStrategy(): TradingStrategy {
  let seen = 0;
  return {
    id: "fixture-buy-once",
    name: "Fixture Buy Once",
    reset(): void { seen = 0; },
    onTick(tick: MarketTick, _context: StrategyContext) {
      seen += 1;
      return seen === 1
        ? { type: "BUY" as const, reason: "fixture-buy", confidence: 1, timestamp: tick.timestamp }
        : { type: "HOLD" as const, reason: "fixture-hold", confidence: 0, timestamp: tick.timestamp };
    },
  };
}

function experimentFromBacktest(points: readonly BacktestPoint[], result: BacktestResult): any {
  return {
    manifest: { datasetId: "dataset-a", market: "KRW-BTC" },
    experimentConfig: { candidates: [{ id: "candidate-a" }] },
    walkForwardResult: { windows: [{ window: { index: 0, testPoints: points }, testResult: result }] },
  };
}

describe("research run OOS observation provenance", () => {
  it("preserves canonical candle-level decisions with dataset identity", () => {
    const fixture = runResearchFixture();
    const result = extractResearchRunOosObservations("candidate-a", fixture);
    assert.ok(result.length > 0);
    assert.equal(result.every((item) => item.datasetId === fixture.manifest.datasetId), true);
    assert.equal(result.some((item) => item.outcome === "FILLED"), true);
  });

  it("rejects candidate identity mismatch instead of borrowing another run", () => {
    assert.throws(() => extractResearchRunOosObservations("candidate-b", runResearchFixture()), (error) => error instanceof ResearchRunOosObservationError && error.code === "CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH");
  });

  it("reports an absent OOS window as missing evidence", () => {
    const fixture = runResearchFixture();
    fixture.walkForwardResult.windows = [];
    assert.throws(() => extractResearchRunOosObservations("candidate-a", fixture), (error) => error instanceof ResearchRunOosObservationError && error.code === "MISSING_OOS_OBSERVATION_SOURCE");
  });

  it("rejects an OOS decision whose market differs from the dataset", () => {
    const fixture = runResearchFixture();
    fixture.walkForwardResult.windows[0].testResult.decisions[0].market = "KRW-ETH";
    assert.throws(() => extractResearchRunOosObservations("candidate-a", fixture), (error) => error instanceof ResearchRunOosObservationError && error.code === "MARKET_IDENTITY_MISMATCH");
  });

  it("rejects a signal timestamp that is not bound to the decision", () => {
    const fixture = runResearchFixture();
    fixture.walkForwardResult.windows[0].testResult.decisions[0].signal.timestamp = 2;
    assert.throws(() => extractResearchRunOosObservations("candidate-a", fixture), (error) => error instanceof ResearchRunOosObservationError && error.code === "SIGNAL_TIMESTAMP_MISMATCH");
  });

  it("rejects rejected decisions without a reason and filled decisions without execution price", () => {
    const rejected = runResearchFixture();
    const rejectedDecision = rejected.walkForwardResult.windows[0].testResult.decisions[0];
    rejectedDecision.outcome = "REJECTED";
    rejectedDecision.executionPrice = undefined;
    assert.throws(() => extractResearchRunOosObservations("candidate-a", rejected), (error) => error instanceof ResearchRunOosObservationError && error.code === "MISSING_REJECTION_REASON");

    const filled = runResearchFixture();
    filled.walkForwardResult.windows[0].testResult.decisions[0].executionPrice = undefined;
    assert.throws(() => extractResearchRunOosObservations("candidate-a", filled), (error) => error instanceof ResearchRunOosObservationError && error.code === "INVALID_FILLED_DECISION");
  });
  it("preserves terminal UNFILLED from a real causal backtest result", () => {
    const points: BacktestPoint[] = [{ timestamp: 1, close: 100 }];
    const backtest = runBacktest(points, buyOnceStrategy, { initialCash: 1_000, orderQuantity: 1 });
    assert.equal(backtest.decisions[0]?.outcome, "UNFILLED");
    assert.equal(backtest.decisions[0]?.executionPrice, undefined);

    const observations = extractResearchRunOosObservations("candidate-a", experimentFromBacktest(points, backtest));
    assert.equal(observations[0]?.outcome, "UNFILLED");
    assert.equal(observations[0]?.executionPrice, undefined);
  });

  it("preserves attempted execution price for a real next-observation REJECTED result", () => {
    const points: BacktestPoint[] = [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }];
    const backtest = runBacktest(points, buyOnceStrategy, { initialCash: 50, orderQuantity: 1 });
    assert.equal(backtest.decisions[0]?.outcome, "REJECTED");
    assert.equal(backtest.decisions[0]?.executionPrice, 101);
    assert.ok(backtest.decisions[0]?.rejectionReason);

    const observations = extractResearchRunOosObservations("candidate-a", experimentFromBacktest(points, backtest));
    assert.equal(observations[0]?.outcome, "REJECTED");
    assert.equal(observations[0]?.executionPrice, 101);
    assert.equal(observations[0]?.rejectionReason, backtest.decisions[0]?.rejectionReason);
  });
});
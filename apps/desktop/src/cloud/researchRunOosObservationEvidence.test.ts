import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResearchRunOosObservations, ResearchRunOosObservationError } from "./researchRunOosObservationEvidence";

function runResearchFixture(): any {
  const points = [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }];
  return {
    manifest: { datasetId: "dataset-a", market: "KRW-BTC" },
    experimentConfig: { candidates: [{ id: "candidate-a" }] },
    walkForwardResult: { windows: [{ window: { index: 0, testPoints: points }, testResult: { decisions: [{ timestamp: 1, market: "KRW-BTC", price: 100, signal: { type: "BUY", reason: "fixture-signal", confidence: 0.8, timestamp: 1 }, outcome: "FILLED", equityBefore: 1000, equityAfter: 1000, executionPrice: 100 }] } }] },
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
});
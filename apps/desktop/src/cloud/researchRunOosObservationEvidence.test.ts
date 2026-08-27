import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResearchRunOosObservations, ResearchRunOosObservationError } from "./researchRunOosObservationEvidence";

function runResearchFixture(): any {
  const points = [{ timestamp: 1, close: 100 }, { timestamp: 2, close: 101 }];
  return {
    manifest: { datasetId: "dataset-a" },
    experimentConfig: { candidates: [{ id: "candidate-a" }] },
    walkForwardResult: { windows: [{ window: { index: 0, testPoints: points }, testResult: { decisions: [{ timestamp: 1, market: "KRW-BTC", price: 100, signal: { type: "BUY" }, outcome: "FILLED", equityBefore: 1000, equityAfter: 1000, executionPrice: 100 }] } }] },
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
});

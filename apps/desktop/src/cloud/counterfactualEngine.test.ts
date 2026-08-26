import { describe, expect, it } from "vitest";
import { assessCounterfactual, CounterfactualError } from "./counterfactualEngine";
import type { GhostExecutionResult } from "./ghostExecution";

function actual(netReturn = 0.01): GhostExecutionResult {
  return {
    schemaVersion: 1,
    status: "SIMULATED",
    side: "LONG",
    entryTime: 1,
    exitTime: 2,
    holdingPeriodMs: 1,
    modeledEntryPrice: 100,
    modeledExitPrice: 101,
    grossReturn: 0.012,
    totalCostRate: 0.002,
    netReturn,
    reasons: [],
    sourceDatasetIds: ["dataset-a"],
  };
}

describe("assessCounterfactual", () => {
  it("computes regret against the best alternative and preserves provenance", () => {
    const result = assessCounterfactual(actual(0.01), [
      { label: "HOLD", netReturn: 0, sourceDatasetIds: ["dataset-a"] },
      { label: "ALT_SIGNAL", netReturn: 0.03, sourceDatasetIds: ["dataset-b"] },
    ]);

    expect(result.bestAlternativeLabel).toBe("ALT_SIGNAL");
    expect(result.regret).toBeCloseTo(0.02);
    expect(result.relativeRank).toBe(2);
    expect(result.evaluatedOutcomeCount).toBe(3);
    expect(result.reasons).toEqual(["BETTER_ALTERNATIVE_OBSERVED"]);
    expect(result.sourceDatasetIds).toEqual(["dataset-a", "dataset-b"]);
  });

  it("records zero regret when actual is best", () => {
    const result = assessCounterfactual(actual(0.04), [
      { label: "HOLD", netReturn: 0, sourceDatasetIds: ["dataset-a"] },
      { label: "ALT", netReturn: 0.02, sourceDatasetIds: ["dataset-a"] },
    ]);

    expect(result.regret).toBe(0);
    expect(result.relativeRank).toBe(1);
    expect(result.reasons).toEqual(["ACTUAL_WAS_BEST_OR_TIED"]);
  });

  it("fails closed when actual execution was skipped", () => {
    expect(() => assessCounterfactual({ ...actual(), status: "SKIPPED", netReturn: undefined }, [])).toThrowError(CounterfactualError);
  });

  it("rejects duplicate labels and malformed evidence", () => {
    expect(() => assessCounterfactual(actual(), [
      { label: "ACTUAL_DECISION", netReturn: 0.02, sourceDatasetIds: ["dataset-a"] },
    ])).toThrowError(CounterfactualError);

    expect(() => assessCounterfactual(actual(), [
      { label: "ALT", netReturn: Number.NaN, sourceDatasetIds: ["dataset-a"] },
    ])).toThrowError(CounterfactualError);
  });
});

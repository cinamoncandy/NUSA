import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

    assert.equal(result.bestAlternativeLabel, "ALT_SIGNAL");
    assert.ok(Math.abs(result.regret - 0.02) < 1e-12);
    assert.equal(result.relativeRank, 2);
    assert.equal(result.evaluatedOutcomeCount, 3);
    assert.deepEqual(result.reasons, ["BETTER_ALTERNATIVE_OBSERVED"]);
    assert.deepEqual(result.sourceDatasetIds, ["dataset-a", "dataset-b"]);
  });

  it("records zero regret when actual is best", () => {
    const result = assessCounterfactual(actual(0.04), [
      { label: "HOLD", netReturn: 0, sourceDatasetIds: ["dataset-a"] },
      { label: "ALT", netReturn: 0.02, sourceDatasetIds: ["dataset-a"] },
    ]);

    assert.equal(result.regret, 0);
    assert.equal(result.relativeRank, 1);
    assert.deepEqual(result.reasons, ["ACTUAL_WAS_BEST_OR_TIED"]);
  });

  it("fails closed when actual execution was skipped", () => {
    assert.throws(() => assessCounterfactual({ ...actual(), status: "SKIPPED", netReturn: undefined }, []), CounterfactualError);
  });

  it("rejects duplicate labels and malformed evidence", () => {
    assert.throws(() => assessCounterfactual(actual(), [
      { label: "ACTUAL_DECISION", netReturn: 0.02, sourceDatasetIds: ["dataset-a"] },
    ]), CounterfactualError);

    assert.throws(() => assessCounterfactual(actual(), [
      { label: "ALT", netReturn: Number.NaN, sourceDatasetIds: ["dataset-a"] },
    ]), CounterfactualError);
  });
});

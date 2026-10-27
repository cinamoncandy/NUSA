import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTOMATIC_PAPER_MIN_CONFIDENCE,
  automaticPaperConfidenceAllowsAction,
} from "./automaticPaperExecutionPolicy";

describe("automatic PAPER execution confidence policy", () => {
  it("uses one fail-closed threshold for candidate and execution admission", () => {
    assert.equal(AUTOMATIC_PAPER_MIN_CONFIDENCE, 0.55);
    assert.equal(automaticPaperConfidenceAllowsAction(0.5), false);
    assert.equal(automaticPaperConfidenceAllowsAction(0.5499), false);
    assert.equal(automaticPaperConfidenceAllowsAction(0.55), true);
    assert.equal(automaticPaperConfidenceAllowsAction(1), true);
    assert.equal(automaticPaperConfidenceAllowsAction(Number.NaN), false);
    assert.equal(automaticPaperConfidenceAllowsAction(1.01), false);
  });
});

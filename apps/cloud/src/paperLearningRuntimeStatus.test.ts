import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPaperLearningRuntimeStatus } from "./paperLearningReadOnlyProjection";

describe("classifyPaperLearningRuntimeStatus", () => {
  it("keeps a rejected stale ticker diagnostic from halting an otherwise running PAPER projection", () => {
    assert.equal(classifyPaperLearningRuntimeStatus({ hasRuntimeHaltReason: false, lastError: "PUBLIC_MARKET_EVENT_REJECTED:FEED_STALE", autoRunning: true, transport: "ONLINE" }), "RUNNING");
  });

  it("still halts on canonical halt reasons", () => {
    assert.equal(classifyPaperLearningRuntimeStatus({ hasRuntimeHaltReason: true, lastError: "PUBLIC_MARKET_EVENT_REJECTED:FEED_STALE", autoRunning: true, transport: "ONLINE" }), "HALTED");
  });

  it("still halts on non-diagnostic runtime errors", () => {
    assert.equal(classifyPaperLearningRuntimeStatus({ hasRuntimeHaltReason: false, lastError: "PAPER_EXECUTION_FAILED", autoRunning: true, transport: "ONLINE" }), "HALTED");
  });

  it("pauses when runtime or transport is unavailable", () => {
    assert.equal(classifyPaperLearningRuntimeStatus({ hasRuntimeHaltReason: false, lastError: null, autoRunning: true, transport: "OFFLINE" }), "PAUSED");
  });
});

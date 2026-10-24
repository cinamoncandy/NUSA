import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClosedLearningChain, LearningChainError } from "./closedLearningChain";

const APP = "a".repeat(64);
const DECISION = "b".repeat(64);

function emptyChain(): ClosedLearningChain {
  const evolution = {
    append: () => { throw new Error("append is not used by this read-only test"); },
    list: () => [],
  };
  const holdouts = {
    claim: () => { throw new Error("claim is not used by this read-only test"); },
    isUsed: () => false,
  };
  const evidenceAuthority = { readResearch: () => undefined, readPaper: () => undefined };
  return new ClosedLearningChain(evolution as never, holdouts as never, evidenceAuthority);
}

function stubApplied(chain: ClosedLearningChain, cycleId: string): void {
  const internals = chain as unknown as {
    applications: { latestApplied: () => unknown };
    decisions: { byFingerprint: (fingerprint: string) => unknown };
  };
  internals.applications.latestApplied = () => ({
    receipt: { learningDecisionFingerprint: DECISION, learningCycleId: cycleId },
    fingerprint: APP,
    recordedAt: 1,
    replayed: false,
  });
}

describe("section 8 causal parent restoration", () => {
  it("fails closed when an APPLIED application cannot restore its durable decision", () => {
    const chain = emptyChain();
    stubApplied(chain, "cycle-a");
    const internals = chain as unknown as { decisions: { byFingerprint: (fingerprint: string) => unknown } };
    internals.decisions.byFingerprint = () => undefined;

    assert.throws(
      () => chain.latestAppliedLearning(),
      (error: unknown) => error instanceof LearningChainError && error.code === "LEARNING_CAUSAL_PARENT_MISSING_DECISION",
    );
  });

  it("fails closed when the APPLIED application and durable decision name different cycles", () => {
    const chain = emptyChain();
    stubApplied(chain, "cycle-a");
    const internals = chain as unknown as { decisions: { byFingerprint: (fingerprint: string) => unknown } };
    internals.decisions.byFingerprint = () => ({ fingerprint: DECISION, learningCycleId: "cycle-b" });

    assert.throws(
      () => chain.latestAppliedLearning(),
      (error: unknown) => error instanceof LearningChainError && error.code === "LEARNING_CAUSAL_PARENT_CYCLE_MISMATCH",
    );
  });
});

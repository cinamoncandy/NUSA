import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createResearchPrecommit,
  researchPrecommitFingerprint,
  researchSpecCausedByApplication,
  verifyResearchPrecommit,
  type ResearchPrecommitInput,
  type ResearchLearningParent,
} from "./researchPrecommit";

/**
 * v2 section 8 - the causal binding from a bounded learning application to the research request it
 * caused.
 *
 * Before this existed, `longBarTickEvery` could change and a research run could happen afterwards,
 * with nothing in provenance connecting the two. That is a coincidence of timing, not causation, and
 * it is exactly what the preflight refused to accept. These tests hold the request to naming its
 * parent, and hold the link to being restorable in both directions.
 */

const APP = "a".repeat(64);
const DECISION = "b".repeat(64);
const CYCLE = "cycle-1";

const PARENT: ResearchLearningParent = Object.freeze({
  type: "learning-application",
  learningCycleId: CYCLE,
  applicationFingerprint: APP,
  learningDecisionFingerprint: DECISION,
});

function input(overrides: Partial<ResearchPrecommitInput> = {}): ResearchPrecommitInput {
  return Object.freeze({
    schemaVersion: 1,
    experimentIdentity: "exp-1",
    candidateIdentity: "challenger@1",
    strategyIdentity: "challenger@1",
    datasetBinding: { market: "KRW-BTC", intervalMs: 60_000 },
    sourceSha: "d".repeat(40),
    parameterPlan: { longBarTickEvery: 2 },
    costPlan: { feeModel: "fee-v1" },
    regimePlan: { status: "NOT_APPLICABLE" },
    evaluationPlan: { splitIdentity: "split-1" },
    validationPolicyIdentity: "split-1",
    createdAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  });
}

describe("section 8 - a research request names the learning application that caused it", () => {
  it("carries no learning parent unless one was actually supplied", () => {
    const precommit = createResearchPrecommit(input());
    assert.equal(precommit.causedByLearning, undefined, "a request that was not learning-caused invents no parent");
    assert.equal(researchSpecCausedByApplication(precommit, APP), false, "and it is never credited with causing something it did not cause");
  });

  it("restores the causal parent in both directions", () => {
    const precommit = createResearchPrecommit(input({ causedByLearning: PARENT }));
    assert.equal(precommit.causedByLearning?.applicationFingerprint, APP);
    assert.equal(precommit.causedByLearning?.learningDecisionFingerprint, DECISION);
    assert.equal(precommit.causedByLearning?.learningCycleId, CYCLE);

    // Application -> research spec N+1, and research spec N+1 -> application.
    assert.equal(researchSpecCausedByApplication(precommit, APP), true);
    assert.equal(researchSpecCausedByApplication(precommit, "e".repeat(64)), false, "a different application is not this request's parent");
  });

  it("folds the parent into the spec identity, so the link cannot be edited after the fact", () => {
    const withParent = createResearchPrecommit(input({ causedByLearning: PARENT }));
    const withoutParent = createResearchPrecommit(input());
    assert.notEqual(withParent.fingerprint, withoutParent.fingerprint, "causation is part of what the spec is, not a note attached to it");

    const other = createResearchPrecommit(input({ causedByLearning: Object.freeze({ ...PARENT, applicationFingerprint: "e".repeat(64) }) }));
    assert.notEqual(other.fingerprint, withParent.fingerprint, "two different parents are two different specs, never collapsed");
    assert.notEqual(researchPrecommitFingerprint(input({ causedByLearning: PARENT })), researchPrecommitFingerprint(input({ causedByLearning: other.causedByLearning as ResearchLearningParent })));
  });

  it("fails closed on a parent that is incomplete or not an identity", () => {
    for (const [label, parent] of [
      ["being null", null],
      ["missing the cycle", { type: "learning-application", applicationFingerprint: APP, learningDecisionFingerprint: DECISION }],
      ["missing the decision", { type: "learning-application", learningCycleId: CYCLE, applicationFingerprint: APP }],
      ["missing the application", { type: "learning-application", learningCycleId: CYCLE, learningDecisionFingerprint: DECISION }],
      ["carrying a non-digest", { type: "learning-application", learningCycleId: CYCLE, applicationFingerprint: "not-a-digest", learningDecisionFingerprint: DECISION }],
      ["carrying an invalid type", { type: "other", learningCycleId: CYCLE, applicationFingerprint: APP, learningDecisionFingerprint: DECISION }],
    ] as ReadonlyArray<readonly [string, unknown]>) {
      assert.throws(
        () => createResearchPrecommit(input({ causedByLearning: parent as ResearchLearningParent })),
        /INVALID_LEARNING_CAUSATION|must name its cycle/,
        label + " must not be accepted as a causal link",
      );
    }
  });

  it("detects a parent edited after the precommit was formed", () => {
    const precommit = createResearchPrecommit(input({ causedByLearning: PARENT }));
    const tampered = { ...precommit, causedByLearning: { ...PARENT, applicationFingerprint: "e".repeat(64) } };
    assert.throws(() => verifyResearchPrecommit(tampered as never), /PRECOMMIT_FINGERPRINT_MISMATCH|precommit fingerprint mismatch/, "the recorded causation is inside the content hash");
  });

  it("leaves an unparented request verifiable, so the binding stays additive", () => {
    const precommit = createResearchPrecommit(input());
    verifyResearchPrecommit(precommit);
    assert.equal(precommit.fingerprint, researchPrecommitFingerprint(input()));
  });
});

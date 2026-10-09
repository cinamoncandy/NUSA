import test from "node:test";
import assert from "node:assert/strict";
import { isCompleteClosedLearningCycle } from "./closedLearningLoopCoordinator";

const deployment = Object.freeze({ deploymentId: "d", candidateId: "c", candidateVersion: "v", authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });
const decision = (outcome: "REJECTED" | "INSUFFICIENT" | "QUALIFIED_FOR_LEAGUE") => Object.freeze({ decisionId: "x", outcome, decisionReference: "r", reasons: Object.freeze([]) });

test("a cycle is complete unless it is a qualified decision still missing its PAPER deployment receipt", () => {
  assert.equal(isCompleteClosedLearningCycle(undefined), false);
  assert.equal(isCompleteClosedLearningCycle({ decision: decision("REJECTED") }), true);
  assert.equal(isCompleteClosedLearningCycle({ decision: decision("INSUFFICIENT") }), true);
  assert.equal(isCompleteClosedLearningCycle({ decision: decision("QUALIFIED_FOR_LEAGUE") }), false, "the coordinator resumes this record when run again");
  assert.equal(isCompleteClosedLearningCycle({ decision: decision("QUALIFIED_FOR_LEAGUE"), paperDeployment: deployment }), true);
});

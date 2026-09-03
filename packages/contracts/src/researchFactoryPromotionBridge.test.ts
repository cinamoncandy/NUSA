import test from "node:test";
import assert from "node:assert/strict";
import { decideResearchFactoryOutcome, type ResearchFactoryEvidence } from "./researchFactoryOutcome";
import { bridgeResearchFactoryDecisionToPromotion } from "./researchFactoryPromotionBridge";

const passEvidence: ResearchFactoryEvidence = {
  provenanceIntegrity: "PASS",
  costEvidence: "PASS",
  outOfSampleEvidence: "PASS",
  multipleTestingControl: "PASS",
  regimeRobustness: "PASS",
  sensitivityAndStress: "PASS",
  denominatorIntegrity: "PASS",
  replayDeterminism: "PASS",
};

const bridgeInput = (evidence: ResearchFactoryEvidence) => ({
  decision: decideResearchFactoryOutcome({ candidateId: "cand-1", evaluationId: "eval-1", evidence }),
  evidence,
  promotionCommandId: "promotion-1",
  expectedCurrentChampionCandidateId: null,
  evidenceHash: "a".repeat(64),
  ownerActorRef: "owner-1",
  requestedAt: 1_788_439_320_000,
});

test("qualified Research Factory decision enters only the existing PAPER promotion boundary", () => {
  const result = bridgeResearchFactoryDecisionToPromotion(bridgeInput(passEvidence));
  assert.equal(result.eligibleForExistingPromotionBoundary, true);
  assert.equal(result.reason, "QUALIFIED_FOR_LEAGUE");
  assert.equal(result.command?.candidateId, "cand-1");
  assert.equal(result.command?.evidenceEvaluationId, "eval-1");
  assert.equal(result.command?.reason, "RESEARCH_FACTORY:QUALIFIED_FOR_LEAGUE");
  assert.equal(result.authority, "PAPER_ONLY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("insufficient evidence cannot create a promotion command", () => {
  const evidence = { ...passEvidence, regimeRobustness: "UNKNOWN" as const };
  const result = bridgeResearchFactoryDecisionToPromotion(bridgeInput(evidence));
  assert.equal(result.eligibleForExistingPromotionBoundary, false);
  assert.equal(result.reason, "RESEARCH_FACTORY_INSUFFICIENT");
  assert.equal(result.command, null);
});

test("explicit failed evidence cannot create a promotion command", () => {
  const evidence = { ...passEvidence, outOfSampleEvidence: "FAIL" as const };
  const result = bridgeResearchFactoryDecisionToPromotion(bridgeInput(evidence));
  assert.equal(result.eligibleForExistingPromotionBoundary, false);
  assert.equal(result.reason, "RESEARCH_FACTORY_REJECTED");
  assert.equal(result.command, null);
});

test("forged qualification mismatched with evidence fails closed", () => {
  const evidence = { ...passEvidence, costEvidence: "UNKNOWN" as const };
  const forged = bridgeInput(passEvidence);
  const result = bridgeResearchFactoryDecisionToPromotion({ ...forged, evidence });
  assert.equal(result.eligibleForExistingPromotionBoundary, false);
  assert.equal(result.reason, "DECISION_EVIDENCE_MISMATCH");
  assert.equal(result.command, null);
});

test("malformed command metadata fails closed even after qualification", () => {
  const input = bridgeInput(passEvidence);
  const result = bridgeResearchFactoryDecisionToPromotion({ ...input, evidenceHash: "bad" });
  assert.equal(result.eligibleForExistingPromotionBoundary, false);
  assert.equal(result.reason, "DECISION_EVIDENCE_MISMATCH");
  assert.equal(result.command, null);
});

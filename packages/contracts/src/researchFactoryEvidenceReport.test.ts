import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchFactoryEvidenceReport } from "./researchFactoryEvidenceReport";
import { decideResearchFactoryOutcome, type ResearchFactoryEvidence } from "./researchFactoryOutcome";

const allPass: ResearchFactoryEvidence = {
  provenanceIntegrity: "PASS",
  costEvidence: "PASS",
  outOfSampleEvidence: "PASS",
  multipleTestingControl: "PASS",
  regimeRobustness: "PASS",
  sensitivityAndStress: "PASS",
  denominatorIntegrity: "PASS",
  replayDeterminism: "PASS",
};

test("qualified report remains PAPER-only and explains qualification", () => {
  const decision = decideResearchFactoryOutcome({ candidateId: "candidate-1", evaluationId: "eval-1", evidence: allPass });
  const report = buildResearchFactoryEvidenceReport(decision, allPass);
  assert.equal(report.outcome, "QUALIFIED_FOR_LEAGUE");
  assert.match(report.summary, /League\/PAPER evaluation only/);
  assert.deepEqual(report.failedEvidence, []);
  assert.deepEqual(report.missingEvidence, []);
  assert.deepEqual(report.costSensitivity, ["EXPLICIT_COST_AND_STRESS_EVIDENCE_PASSED"]);
  assert.equal(report.authority, "PAPER_ONLY");
  assert.equal(report.liveAuthority, "NONE");
  assert.equal(report.productionMutationAllowed, false);
  assert.equal(report.aiAuthority, "ZERO_AUTHORITY");
});

test("rejected report exposes counter-evidence, regime gaps, overfit and cost risks", () => {
  const evidence: ResearchFactoryEvidence = {
    ...allPass,
    costEvidence: "FAIL",
    outOfSampleEvidence: "FAIL",
    multipleTestingControl: "FAIL",
    regimeRobustness: "FAIL",
  };
  const decision = decideResearchFactoryOutcome({ candidateId: "candidate-2", evaluationId: "eval-2", evidence });
  const report = buildResearchFactoryEvidenceReport(decision, evidence);
  assert.equal(report.outcome, "REJECTED");
  assert.ok(report.counterEvidence.includes("FAILED:costEvidence"));
  assert.deepEqual(report.regimeGaps, ["REGIME_ROBUSTNESS_FAILED"]);
  assert.ok(report.overfitRisks.includes("OOS_EVIDENCE_FAILED"));
  assert.ok(report.overfitRisks.includes("MULTIPLE_TESTING_CONTROL_FAILED"));
  assert.ok(report.costSensitivity.includes("COST_EVIDENCE_FAILED"));
});

test("insufficient report never invents missing evidence", () => {
  const evidence: ResearchFactoryEvidence = { ...allPass, replayDeterminism: "UNKNOWN", sensitivityAndStress: "UNKNOWN" };
  const decision = decideResearchFactoryOutcome({ candidateId: "candidate-3", evaluationId: "eval-3", evidence });
  const report = buildResearchFactoryEvidenceReport(decision, evidence);
  assert.equal(report.outcome, "INSUFFICIENT");
  assert.ok(report.missingEvidence.includes("replayDeterminism"));
  assert.ok(report.missingEvidence.includes("sensitivityAndStress"));
  assert.ok(report.costSensitivity.includes("SENSITIVITY_STRESS_MISSING"));
});

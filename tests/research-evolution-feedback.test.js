const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildResearchEvolutionFeedback,
} = require("../dist/apps/cloud/src/researchEvolutionFeedback.js");

const baseAdvisory = (overrides = {}) => ({
  advisoryId: "adv-1",
  currentState: "PROMOTED",
  recommendedState: "DEMOTED",
  recommendation: "DEMOTE",
  reasons: ["CALIBRATION_DETERIORATION"],
  candidateId: "cand-1",
  strategyFamilyId: "fam-1",
  regime: "RISK_ON",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  ...overrides,
});

test("maps calibration deterioration to calibration research priority", () => {
  const result = buildResearchEvolutionFeedback({ feedbackId: "fb-1", advisory: baseAdvisory() });
  assert.deepEqual(result.actions, ["PRIORITIZE_CALIBRATION"]);
  assert.equal(result.researchPriorityMutationAllowed, false);
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
});

test("maps multiple deterioration reasons deterministically", () => {
  const result = buildResearchEvolutionFeedback({
    feedbackId: "fb-2",
    advisory: baseAdvisory({
      reasons: ["DRAWDOWN_DETERIORATION", "COST_EROSION", "REGIME_DEGRADATION"],
    }),
  });
  assert.deepEqual(result.actions, [
    "PRIORITIZE_COST_ROBUSTNESS",
    "PRIORITIZE_DRAWDOWN_CONTROL",
    "PRIORITIZE_REGIME_ROBUSTNESS",
  ]);
});

test("quarantine evidence prioritizes repair without changing authority", () => {
  const result = buildResearchEvolutionFeedback({
    feedbackId: "fb-3",
    advisory: baseAdvisory({
      recommendation: "QUARANTINE",
      recommendedState: "QUARANTINED",
      reasons: ["PROVENANCE_FAILURE", "INFRASTRUCTURE_FAILURE"],
    }),
  });
  assert.deepEqual(result.actions, [
    "PRIORITIZE_INFRASTRUCTURE_REPAIR",
    "PRIORITIZE_PROVENANCE_REPAIR",
  ]);
  assert.equal(result.researchPriorityMutationAllowed, false);
});

test("retirement prioritizes replacement research", () => {
  const result = buildResearchEvolutionFeedback({
    feedbackId: "fb-4",
    advisory: baseAdvisory({
      recommendation: "RETIRE",
      recommendedState: "RETIRED",
      reasons: ["REPEATED_INDEPENDENT_FAILURES"],
    }),
  });
  assert.deepEqual(result.actions, ["PRIORITIZE_REPLACEMENT_RESEARCH"]);
});

test("hold without negative evidence maintains current research", () => {
  const result = buildResearchEvolutionFeedback({
    feedbackId: "fb-5",
    advisory: baseAdvisory({
      recommendation: "HOLD",
      recommendedState: "PROMOTED",
      reasons: ["NO_EVIDENCE_BACKED_STATE_CHANGE"],
    }),
  });
  assert.deepEqual(result.actions, ["MAINTAIN_CURRENT_RESEARCH"]);
});

test("uncertain evidence prioritizes robustness research but remains advisory only", () => {
  const result = buildResearchEvolutionFeedback({
    feedbackId: "fb-6",
    advisory: baseAdvisory({ reasons: ["EVIDENCE_UNCERTAIN_FAIL_CLOSED"] }),
  });
  assert.deepEqual(result.actions, ["PRIORITIZE_REGIME_ROBUSTNESS"]);
  assert.equal(result.researchPriorityMutationAllowed, false);
});

test("rejects advisory authority expansion", () => {
  assert.throws(
    () => buildResearchEvolutionFeedback({
      feedbackId: "fb-7",
      advisory: baseAdvisory({ aiAuthority: "SELF_AUTHORIZED" }),
    }),
    /authority invariant failed/,
  );
});

test("rejects incomplete feedback identity", () => {
  assert.throws(
    () => buildResearchEvolutionFeedback({ feedbackId: "", advisory: baseAdvisory() }),
    /feedbackId is required/,
  );
});

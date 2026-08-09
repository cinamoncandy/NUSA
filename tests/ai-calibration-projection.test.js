const test = require("node:test");
const assert = require("node:assert/strict");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");

const digest = "a".repeat(64);
const promptArtifactId = "nusa.ai.strategy_proposer";
const promptArtifactVersion = "1.0.0";
const baseResult = () => ({
  status: "COMPLETED", orchestrationRunId: "run-1", governanceDecision: { result: "preview_candidate", unresolvedDisagreements: [], vetoReasons: [] }, independence: { reasonCodes: [] },
  agents: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", definitionVersion: promptArtifactVersion, promptArtifactId, promptArtifactDigest: digest, correlatedGroupId: "model:openai:model-v1" }], contexts: [],
  runs: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", promptArtifactDigest: digest, completedAt: 100 }], failureCodes: [], outputHashes: [],
  structuredOutputs: [
    { schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: ["e-1"], payload: { rawProbability: 0.8, rationaleClaims: ["candidate"], uncertainty: "medium" } },
    { schemaVersion: 1, role: "ADVERSARIAL_CRITIC", evidenceReferences: ["e-1"], payload: { counterClaims: [], severity: "low" } }
  ], liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false
});
const cohort = { providerId: "openai", modelVersionId: "model-v1", promptArtifactId, promptArtifactVersion, promptArtifactDigest: digest, outcomeDefinitionId: "next-period-positive", outcomeDefinitionVersion: "1" };
const profile = (overrides = {}) => ({ cohort, status: "CALIBRATED", sampleCount: 25, expectedCalibrationError: 0.05, brierScore: 0.1, rawProbability: 0.8, calibratedProbability: 0.6, effectiveConfidence: 0.6, reliabilityBuckets: [], provenance: "VERIFIED_RUNTIME_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, ...overrides });
const providerComparison = (comparisonState, disagreementCodes = []) => ({
  schemaVersion: 1,
  comparisonRunId: "run-1:nversion",
  comparisonState,
  trustDisposition: comparisonState === "CONSENSUS" ? "NO_UPLIFT" : "ABSTAIN",
  independentGroupCount: 2,
  completedGroupCount: comparisonState === "INCOMPLETE" ? 1 : 2,
  policyIdentity: "p".repeat(64),
  comparisonIdentity: "c".repeat(64),
  groups: [],
  metrics: { decisionAgreement: comparisonState === "CONSENSUS", uncertaintyAgreement: true, maxProbabilityDelta: 0.02, minimumEvidenceReferenceOverlap: 1, minimumAssumptionOverlap: 1, disagreementCodes },
  inferenceResources: {
    schemaVersion: 1,
    health: "HEALTHY",
    policy: { schemaVersion: 1, policyId: "NVERSION_TEST", policyVersion: "1", maxModelCalls: 2, maxTotalAttempts: 4, maxCumulativeOutputTokens: 8192, maxInputBytes: 1024, maxWallClockMs: 30000, requireUsageAccounting: true },
    modelCalls: 2,
    attempts: 2,
    reservedOutputTokens: 4096,
    inputBytes: 100,
    usageAccountingStatus: "VERIFIED",
    actualInputTokens: 20,
    actualOutputTokens: 10,
    actualTotalTokens: 30,
    elapsedMs: 100,
    attemptsEvidence: [],
    liveAuthority: "NONE",
    productionMutationAllowed: false
  },
  liveAuthority: "NONE",
  realOrderAuthority: false,
  realTransferAuthority: false,
  productionMutationAllowed: false
});

test("raw probability without verified calibration remains visible but untrusted", () => {
  const projection = projectAiReadOnly(baseResult());
  assert.equal(projection.rawProbability, 0.8); assert.equal(projection.calibrationStatus, "UNVERIFIED"); assert.equal(projection.confidence, 0); assert.equal(projection.effectiveConfidence, 0); assert.equal(projection.calibratedProbability, null); assert.equal(projection.liveAuthority, "NONE"); assert.equal(projection.productionMutationAllowed, false);
});

test("a runtime-bound calibration profile is honored by the existing read-only projection call path", () => {
  const projection = projectAiReadOnly({ ...baseResult(), calibrationProfile: profile() });
  assert.equal(projection.calibrationStatus, "CALIBRATED");
  assert.equal(projection.rawProbability, 0.8);
  assert.equal(projection.calibratedProbability, 0.6);
  assert.equal(projection.confidence, 0.6);
});

test("insufficient and degraded calibration can never create trusted confidence", () => {
  for (const status of ["INSUFFICIENT_DATA", "DEGRADED"]) {
    const projection = projectAiReadOnly(baseResult(), profile({ status, calibratedProbability: null, effectiveConfidence: 0 }));
    assert.equal(projection.calibrationStatus, status); assert.equal(projection.rawProbability, 0.8); assert.equal(projection.confidence, 0); assert.equal(projection.effectiveConfidence, 0); assert.equal(projection.calibratedProbability, null);
  }
});

test("calibrated confidence is exposed conservatively and never exceeds raw probability", () => {
  const verified = projectAiReadOnly(baseResult(), profile());
  assert.equal(verified.calibrationStatus, "CALIBRATED"); assert.equal(verified.rawProbability, 0.8); assert.equal(verified.calibratedProbability, 0.6); assert.equal(verified.confidence, 0.6); assert.equal(verified.effectiveConfidence, 0.6); assert.equal(verified.calibrationSampleCount, 25); assert.equal(verified.calibrationExpectedError, 0.05); assert.equal(verified.calibrationBrierScore, 0.1);
  const defensive = projectAiReadOnly(baseResult(), profile({ calibratedProbability: 0.95, effectiveConfidence: 0.95 }));
  assert.equal(defensive.confidence, 0.8); assert.equal(defensive.effectiveConfidence, 0.8);
});

test("calibration identity mismatch fails closed instead of borrowing another cohort", () => {
  for (const mismatched of [
    profile({ rawProbability: 0.7 }),
    profile({ cohort: { ...cohort, providerId: "other" } }),
    profile({ cohort: { ...cohort, modelVersionId: "other-model" } }),
    profile({ cohort: { ...cohort, promptArtifactId: "other-prompt" } }),
    profile({ cohort: { ...cohort, promptArtifactVersion: "2.0.0" } }),
    profile({ cohort: { ...cohort, promptArtifactDigest: "b".repeat(64) } })
  ]) {
    const projection = projectAiReadOnly(baseResult(), mismatched);
    assert.equal(projection.calibrationStatus, "UNVERIFIED"); assert.equal(projection.confidence, 0); assert.equal(projection.calibratedProbability, null); assert.equal(projection.calibrationCohort, null);
  }
});

test("incomplete governance suppresses trusted confidence even with a valid calibrated profile", () => {
  const result = baseResult(); result.governanceDecision = { result: "incomplete", unresolvedDisagreements: ["critic"], vetoReasons: [] };
  const projection = projectAiReadOnly(result, profile());
  assert.equal(projection.status, "INCOMPLETE"); assert.equal(projection.rawProbability, 0.8); assert.equal(projection.calibrationStatus, "CALIBRATED"); assert.equal(projection.confidence, 0); assert.equal(projection.effectiveConfidence, 0);
});

test("independent provider consensus never uplifts verified calibrated confidence", () => {
  const comparison = providerComparison("CONSENSUS");
  const projection = projectAiReadOnly({ ...baseResult(), providerComparison: comparison }, profile());
  assert.equal(projection.status, "AVAILABLE");
  assert.equal(projection.confidence, 0.6, "consensus must preserve, not increase, the calibrated primary confidence");
  assert.equal(projection.effectiveConfidence, 0.6);
  assert.equal(projection.providerComparisonState, "CONSENSUS");
  assert.equal(projection.providerTrustDisposition, "NO_UPLIFT");
  assert.equal(projection.providerIndependentGroupCount, 2);
  assert.equal(projection.providerComparisonModelCalls, 2);
  assert.equal(projection.liveAuthority, "NONE");
});

test("independent provider disagreement forces abstention and zero trusted confidence", () => {
  const comparison = providerComparison("DISAGREEMENT", ["DECISION_MISMATCH", "PROBABILITY_DELTA_EXCEEDED"]);
  const projection = projectAiReadOnly({ ...baseResult(), providerComparison: comparison }, profile());
  assert.equal(projection.status, "INCOMPLETE");
  assert.equal(projection.thesis, null);
  assert.equal(projection.rawProbability, 0.8, "raw model probability remains observable");
  assert.equal(projection.calibratedProbability, 0.6, "calibration evidence remains observable but cannot be trusted for action");
  assert.equal(projection.confidence, 0);
  assert.equal(projection.effectiveConfidence, 0);
  assert.equal(projection.providerComparisonState, "DISAGREEMENT");
  assert.equal(projection.providerTrustDisposition, "ABSTAIN");
  assert.ok(projection.disagreements.includes("DECISION_MISMATCH"));
  assert.ok(projection.disagreements.includes("PROVIDER_COMPARISON_DISAGREEMENT"));
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
});

test("partial or unverified N-version comparison cannot be presented as a valid primary recommendation", () => {
  for (const state of ["INCOMPLETE", "INSUFFICIENT_INDEPENDENCE", "UNVERIFIED"]) {
    const projection = projectAiReadOnly({ ...baseResult(), providerComparison: providerComparison(state) }, profile());
    assert.equal(projection.status, "INCOMPLETE");
    assert.equal(projection.confidence, 0);
    assert.equal(projection.effectiveConfidence, 0);
    assert.equal(projection.providerComparisonState, state);
    assert.equal(projection.providerTrustDisposition, "ABSTAIN");
  }
});

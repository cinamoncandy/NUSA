const test = require("node:test");
const assert = require("node:assert/strict");
const { projectAiReadOnly } = require("../dist/apps/cloud/src/ai/projection.js");

const digest = "a".repeat(64);
const promptArtifactId = "nusa.ai.strategy_proposer";
const promptArtifactVersion = "1.0.0";

function baseResult({ evidenceObservations, strategyPayload }) {
  return {
    status: "COMPLETED",
    orchestrationRunId: "run-1",
    governanceDecision: { result: "preview_candidate", unresolvedDisagreements: [], vetoReasons: [] },
    independence: { reasonCodes: [] },
    agents: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", definitionVersion: promptArtifactVersion, promptArtifactId, promptArtifactDigest: digest, correlatedGroupId: "model:openai:model-v1" }],
    contexts: [],
    runs: [{ agentId: "ai-strategy-proposer", modelVersionId: "model-v1", promptArtifactDigest: digest, completedAt: 100 }],
    failureCodes: [],
    outputHashes: [],
    structuredOutputs: [
      { schemaVersion: 1, role: "EVIDENCE_PRODUCER", evidenceReferences: ["e-1"], payload: { observations: evidenceObservations, missingEvidence: [], evidenceBundleHash: digest } },
      { schemaVersion: 1, role: "STRATEGY_PROPOSER", evidenceReferences: ["e-1"], payload: strategyPayload },
      { schemaVersion: 1, role: "ADVERSARIAL_CRITIC", evidenceReferences: ["e-1"], payload: { counterClaims: [], severity: "low" } }
    ],
    liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false
  };
}

const factObservation = (claim) => ({ claim, claimType: "fact", evidenceReferences: ["e-1"], confidence: "high", freshnessStatus: "fresh" });

test("a null orchestration result carries no explanation-faithfulness fields", () => {
  const projection = projectAiReadOnly(null);
  assert.equal(projection.explanationFaithfulnessStrength, undefined);
});

test("a grounded, complete rationale is FAITHFUL and surfaced on the projection", () => {
  const result = baseResult({
    evidenceObservations: [factObservation("Price observed at 91,327,000 with volume up 5%.")],
    strategyPayload: {
      rawProbability: 0.7,
      rationaleClaims: ["Price at 91,327,000 supports the candidate, however this could be noise."],
      uncertainty: "Real uncertainty remains and the read may reverse."
    }
  });
  const projection = projectAiReadOnly(result);
  assert.equal(projection.explanationFaithfulnessStrength, "FAITHFUL");
  assert.deepEqual(projection.explanationFaithfulnessReasonCodes, []);
  assert.deepEqual(projection.explanationFaithfulnessUngroundedNumbers, []);
});

test("a rationale citing a number absent from the evidence producer's facts is flagged ungrounded", () => {
  const result = baseResult({
    evidenceObservations: [factObservation("Price observed at 91,327,000.")],
    strategyPayload: {
      rawProbability: 0.7,
      rationaleClaims: ["Price surged to 999,999,999 which strongly supports the candidate, however this may be noise."],
      uncertainty: "There is uncertainty here."
    }
  });
  const projection = projectAiReadOnly(result);
  assert.ok(projection.explanationFaithfulnessReasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
  assert.deepEqual(projection.explanationFaithfulnessUngroundedNumbers, [999_999_999]);
  assert.equal(projection.explanationFaithfulnessStrength, "UNFAITHFUL");
});

test("only fact-typed observations count as grounding evidence, not assumptions", () => {
  const result = baseResult({
    evidenceObservations: [
      { claim: "Price could plausibly reach 500,000,000 under an assumption.", claimType: "assumption", evidenceReferences: ["e-1"], confidence: "low", freshnessStatus: "fresh" }
    ],
    strategyPayload: {
      rawProbability: 0.7,
      rationaleClaims: ["Price at 500,000,000 supports the candidate, however this may be noise."],
      uncertainty: "There is uncertainty here."
    }
  });
  const projection = projectAiReadOnly(result);
  // 500,000,000 was only ever an assumption-typed claim, never a fact -- it must not ground the proposer's number.
  assert.ok(projection.explanationFaithfulnessReasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("a rationale missing uncertainty/counter-evidence discussion is downgraded, not silently accepted", () => {
  const result = baseResult({
    evidenceObservations: [factObservation("Price observed at 91,327,000.")],
    strategyPayload: {
      rawProbability: 0.7,
      rationaleClaims: ["Price at 91,327,000 strongly supports the candidate."],
      uncertainty: ""
    }
  });
  const projection = projectAiReadOnly(result);
  assert.notEqual(projection.explanationFaithfulnessStrength, "FAITHFUL");
  assert.ok(projection.explanationFaithfulnessReasonCodes.length > 0);
});

test("an empty rationale (no claims, no uncertainty) leaves the projection without faithfulness fields rather than fabricating a verdict", () => {
  const result = baseResult({
    evidenceObservations: [factObservation("Price observed at 91,327,000.")],
    strategyPayload: { rawProbability: 0.7, rationaleClaims: [], uncertainty: "" }
  });
  const projection = projectAiReadOnly(result);
  assert.equal(projection.explanationFaithfulnessStrength, undefined);
});

test("the wiring never sets liveAuthority or productionMutationAllowed away from their zero-authority defaults", () => {
  const result = baseResult({
    evidenceObservations: [factObservation("Price observed at 91,327,000.")],
    strategyPayload: { rawProbability: 0.7, rationaleClaims: ["91,327,000 supports it, however uncertain."], uncertainty: "uncertain" }
  });
  const projection = projectAiReadOnly(result);
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
});
